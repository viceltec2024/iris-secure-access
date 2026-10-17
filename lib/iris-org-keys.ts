/**
 * Organization API keys — plaintext shown once; only SHA-256 hash stored.
 */

import { and, desc, eq, isNull } from "drizzle-orm";
import { getDb } from "../db";
import { organizationApiKeys } from "../db/schema";
import { logAudit } from "./authz.ts";
import { randomToken, sha256Hex } from "./iris-secret-hygiene.ts";
import { canAdminOrg, normalizeOrgKeyScopes, type OrgKeyScope, type OrgRole } from "./iris-tenant-core.ts";

export type { OrgKeyScope };
export const normalizeScopes = normalizeOrgKeyScopes;

export async function createOrgApiKey(input: {
  organizationId: string;
  actorEmail: string;
  actorRole: OrgRole;
  name: string;
  scopes?: unknown;
}) {
  if (!canAdminOrg(input.actorRole)) throw new Error("Administrator access required");
  const name = String(input.name || "").trim().slice(0, 80);
  if (name.length < 2) throw new Error("API key name required");
  const scopes = normalizeScopes(input.scopes);
  const token = randomToken("iris_ak_");
  const keyHash = await sha256Hex(token);
  const now = new Date().toISOString();
  const [row] = await getDb().insert(organizationApiKeys).values({
    id: crypto.randomUUID(),
    organizationId: input.organizationId,
    name,
    keyPrefix: token.slice(0, 12),
    keyHash,
    scopes: JSON.stringify(scopes),
    createdBy: input.actorEmail.trim().toLowerCase(),
    createdAt: now,
  }).returning();

  await logAudit(input.actorEmail, "ORG_API_KEY_CREATED", input.organizationId, "SUCCESS", {
    keyId: row.id,
    name,
    keyPrefix: row.keyPrefix,
    scopes,
  }, input.organizationId);

  return {
    key: publicKey(row),
    // Returned once — never stored or returned again.
    secret: token,
  };
}

export async function listOrgApiKeys(organizationId: string) {
  const rows = await getDb()
    .select()
    .from(organizationApiKeys)
    .where(eq(organizationApiKeys.organizationId, organizationId))
    .orderBy(desc(organizationApiKeys.createdAt));
  return rows.map(publicKey);
}

export async function revokeOrgApiKey(input: {
  organizationId: string;
  keyId: string;
  actorEmail: string;
  actorRole: OrgRole;
}) {
  if (!canAdminOrg(input.actorRole)) throw new Error("Administrator access required");
  const [row] = await getDb()
    .select()
    .from(organizationApiKeys)
    .where(and(
      eq(organizationApiKeys.id, input.keyId),
      eq(organizationApiKeys.organizationId, input.organizationId),
    ))
    .limit(1);
  if (!row) throw new Error("API key not found");
  if (row.revokedAt) throw new Error("API key already revoked");
  const now = new Date().toISOString();
  await getDb().update(organizationApiKeys).set({ revokedAt: now }).where(eq(organizationApiKeys.id, row.id));
  await logAudit(input.actorEmail, "ORG_API_KEY_REVOKED", input.organizationId, "SUCCESS", {
    keyId: row.id,
    keyPrefix: row.keyPrefix,
  }, input.organizationId);
  return { ok: true, keyId: row.id };
}

export async function verifyOrgApiKey(token: string) {
  const value = String(token || "").trim();
  if (!value.startsWith("iris_ak_")) return null;
  const keyHash = await sha256Hex(value);
  const [row] = await getDb()
    .select()
    .from(organizationApiKeys)
    .where(and(eq(organizationApiKeys.keyHash, keyHash), isNull(organizationApiKeys.revokedAt)))
    .limit(1);
  if (!row) return null;
  await getDb().update(organizationApiKeys).set({ lastUsedAt: new Date().toISOString() }).where(eq(organizationApiKeys.id, row.id));
  return {
    keyId: row.id,
    organizationId: row.organizationId,
    scopes: normalizeScopes(JSON.parse(row.scopes || "[]")),
    name: row.name,
  };
}

function publicKey(row: typeof organizationApiKeys.$inferSelect) {
  return {
    id: row.id,
    organizationId: row.organizationId,
    name: row.name,
    keyPrefix: row.keyPrefix,
    scopes: normalizeScopes(JSON.parse(row.scopes || "[]")),
    createdBy: row.createdBy,
    createdAt: row.createdAt,
    lastUsedAt: row.lastUsedAt,
    revokedAt: row.revokedAt,
  };
}
