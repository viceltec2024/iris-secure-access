/**
 * Organization invitation tokens — store hash only; plaintext returned once.
 */

import { and, desc, eq } from "drizzle-orm";
import { getDb } from "../db";
import { organizationInvites, organizationMembers } from "../db/schema";
import { logAudit } from "./authz.ts";
import { randomToken, sha256Hex } from "./iris-secret-hygiene.ts";
import {
  canAdminOrg,
  evaluateInviteAcceptability,
  sanitizeInviteRole,
  type OrgRole,
} from "./iris-tenant-core.ts";

export { inviteRoleAllowed, sanitizeInviteRole, evaluateInviteAcceptability } from "./iris-tenant-core.ts";

const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export async function createOrgInvite(input: {
  organizationId: string;
  actorEmail: string;
  actorRole: OrgRole;
  email: string;
  role?: string;
}) {
  if (!canAdminOrg(input.actorRole)) throw new Error("Administrator access required");
  const email = input.email.trim().toLowerCase();
  if (!email.includes("@")) throw new Error("Valid email required");
  const role = sanitizeInviteRole(input.role);

  const [existingMember] = await getDb()
    .select()
    .from(organizationMembers)
    .where(and(
      eq(organizationMembers.organizationId, input.organizationId),
      eq(organizationMembers.userEmail, email),
      eq(organizationMembers.status, "ACTIVE"),
    ))
    .limit(1);
  if (existingMember) throw new Error("Member already exists");

  const [pending] = await getDb()
    .select()
    .from(organizationInvites)
    .where(and(
      eq(organizationInvites.organizationId, input.organizationId),
      eq(organizationInvites.email, email),
      eq(organizationInvites.status, "PENDING"),
    ))
    .limit(1);
  if (pending && new Date(pending.expiresAt).getTime() > Date.now()) {
    throw new Error("Invite already pending for this email");
  }

  const token = randomToken("iris_inv_");
  const tokenHash = await sha256Hex(token);
  const now = new Date();
  const [row] = await getDb().insert(organizationInvites).values({
    id: crypto.randomUUID(),
    organizationId: input.organizationId,
    email,
    role,
    tokenHash,
    tokenPrefix: token.slice(0, 12),
    invitedBy: input.actorEmail.trim().toLowerCase(),
    status: "PENDING",
    expiresAt: new Date(now.getTime() + INVITE_TTL_MS).toISOString(),
    createdAt: now.toISOString(),
  }).returning();

  await logAudit(input.actorEmail, "ORG_INVITE_CREATED", input.organizationId, "SUCCESS", {
    email,
    role,
    inviteId: row.id,
    tokenPrefix: row.tokenPrefix,
  }, input.organizationId);

  return {
    invite: publicInvite(row),
    // Returned once — never persisted or logged in full.
    acceptToken: token,
    acceptPath: `/api/iris-orgs?action=accept_invite`,
  };
}

export async function expireStaleInvites(organizationId: string, now = new Date()) {
  const rows = await getDb()
    .select()
    .from(organizationInvites)
    .where(and(
      eq(organizationInvites.organizationId, organizationId),
      eq(organizationInvites.status, "PENDING"),
    ));
  let expired = 0;
  for (const row of rows) {
    if (Date.parse(row.expiresAt) < now.getTime()) {
      await getDb().update(organizationInvites).set({ status: "EXPIRED" }).where(eq(organizationInvites.id, row.id));
      expired += 1;
    }
  }
  return expired;
}

export async function listOrgInvites(organizationId: string) {
  await expireStaleInvites(organizationId);
  const rows = await getDb()
    .select()
    .from(organizationInvites)
    .where(eq(organizationInvites.organizationId, organizationId))
    .orderBy(desc(organizationInvites.createdAt));
  return rows.map(publicInvite);
}

export async function revokeOrgInvite(input: {
  organizationId: string;
  inviteId: string;
  actorEmail: string;
  actorRole: OrgRole;
}) {
  if (!canAdminOrg(input.actorRole)) throw new Error("Administrator access required");
  const [row] = await getDb()
    .select()
    .from(organizationInvites)
    .where(and(
      eq(organizationInvites.id, input.inviteId),
      eq(organizationInvites.organizationId, input.organizationId),
    ))
    .limit(1);
  if (!row) throw new Error("Invite not found");
  if (row.status !== "PENDING") throw new Error("Invite is not pending");
  await getDb().update(organizationInvites).set({ status: "REVOKED" }).where(eq(organizationInvites.id, row.id));
  await logAudit(input.actorEmail, "ORG_INVITE_REVOKED", input.organizationId, "SUCCESS", { inviteId: row.id, email: row.email }, input.organizationId);
  return { ok: true, inviteId: row.id };
}

export async function acceptOrgInvite(input: {
  token: string;
  actorEmail: string;
}) {
  const email = input.actorEmail.trim().toLowerCase();
  const token = String(input.token || "").trim();
  if (!token.startsWith("iris_inv_")) throw new Error("Invalid invite token");
  const tokenHash = await sha256Hex(token);
  const [row] = await getDb()
    .select()
    .from(organizationInvites)
    .where(eq(organizationInvites.tokenHash, tokenHash))
    .limit(1);
  if (!row) throw new Error("Invite not found");
  const decision = evaluateInviteAcceptability({
    status: row.status as "PENDING" | "ACCEPTED" | "REVOKED" | "EXPIRED",
    expiresAt: row.expiresAt,
    inviteEmail: row.email,
    actorEmail: email,
  });
  if (!decision.ok) {
    if (decision.code === "EXPIRED" && row.status === "PENDING") {
      await getDb().update(organizationInvites).set({ status: "EXPIRED" }).where(eq(organizationInvites.id, row.id));
    }
    throw new Error(decision.detail);
  }

  const now = new Date().toISOString();
  const [existing] = await getDb()
    .select()
    .from(organizationMembers)
    .where(and(
      eq(organizationMembers.organizationId, row.organizationId),
      eq(organizationMembers.userEmail, email),
    ))
    .limit(1);

  let membership;
  if (existing) {
    const [updated] = await getDb().update(organizationMembers).set({
      role: row.role,
      status: "ACTIVE",
      updatedAt: now,
    }).where(eq(organizationMembers.id, existing.id)).returning();
    membership = updated;
  } else {
    const [created] = await getDb().insert(organizationMembers).values({
      id: crypto.randomUUID(),
      organizationId: row.organizationId,
      userEmail: email,
      role: row.role,
      status: "ACTIVE",
      createdAt: now,
      updatedAt: now,
    }).returning();
    membership = created;
  }

  await getDb().update(organizationInvites).set({
    status: "ACCEPTED",
    acceptedAt: now,
  }).where(eq(organizationInvites.id, row.id));

  await logAudit(email, "ORG_INVITE_ACCEPTED", row.organizationId, "SUCCESS", {
    inviteId: row.id,
    role: row.role,
  }, row.organizationId);

  return { membership, organizationId: row.organizationId, role: row.role };
}

function publicInvite(row: typeof organizationInvites.$inferSelect) {
  return {
    id: row.id,
    organizationId: row.organizationId,
    email: row.email,
    role: row.role,
    status: row.status,
    tokenPrefix: row.tokenPrefix,
    invitedBy: row.invitedBy,
    expiresAt: row.expiresAt,
    acceptedAt: row.acceptedAt,
    createdAt: row.createdAt,
  };
}
