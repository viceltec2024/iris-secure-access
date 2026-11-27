import { and, count, desc, eq, sql } from "drizzle-orm";
import { getDb } from "../db";
import { auditEvents, users } from "../db/schema";
import type { ChatGPTUser } from "../app/chatgpt-auth";
import { auditEventHash } from "./iris-audit-chain.ts";

export { auditEventHash };

export type IrisRole = "ADMIN" | "USER";

export async function provisionIrisUser(identity: ChatGPTUser) {
  const db = getDb();
  const normalizedEmail = identity.email.trim().toLowerCase();
  const existing = await db.select().from(users).where(eq(users.email, normalizedEmail)).limit(1);

  if (existing[0]) {
    // Si ChatGPT no envía el nombre en esta petición, se conserva el guardado
    // (antes se borraba y Ask IRIS dejaba de llamar al usuario por su nombre).
    const displayName = identity.fullName || existing[0].displayName;
    await db.update(users).set({ displayName, lastSeenAt: new Date().toISOString() }).where(eq(users.email, normalizedEmail));
    await logAudit(normalizedEmail, "SESSION_STARTED", "iris_workspace", "SUCCESS");
    return { ...existing[0], displayName, lastSeenAt: new Date().toISOString() };
  }

  const configuredOwner = String(process.env.IRIS_OWNER_EMAIL || "").trim().toLowerCase();
  const role: IrisRole = configuredOwner && normalizedEmail === configuredOwner ? "ADMIN" : "USER";
  const [created] = await db.insert(users).values({ email: normalizedEmail, displayName: identity.fullName, role }).returning();
  await logAudit(normalizedEmail, "USER_PROVISIONED", "iris_workspace", "SUCCESS", { role });
  return created;
}

export async function findIrisUser(identity: ChatGPTUser) {
  const normalizedEmail = identity.email.trim().toLowerCase();
  const [existing] = await getDb().select().from(users).where(eq(users.email, normalizedEmail)).limit(1);
  return existing || null;
}

const AUDIT_APPEND_ATTEMPTS = 5;

export async function logAudit(
  actorEmail: string,
  action: string,
  resource: string,
  outcome: "SUCCESS" | "DENIED",
  metadata: Record<string, unknown> = {},
  organizationId?: string | null,
) {
  const db = getDb();
  const normalizedMetadata = JSON.stringify(metadata);
  // La cadena de hashes se bifurcaba si dos peticiones leían el mismo último
  // evento antes de insertar. D1 no tiene transacciones interactivas, así que
  // el INSERT solo se aplica si el último hash sigue siendo el que leímos
  // (una sola sentencia SQLite, atómica). Si otro evento entró antes, se
  // vuelve a leer y a calcular.
  for (let attempt = 0; attempt < AUDIT_APPEND_ATTEMPTS; attempt += 1) {
    const [previous] = await db.select().from(auditEvents).orderBy(desc(auditEvents.id)).limit(1);
    const previousHash = previous?.eventHash || "GENESIS";
    const eventHash = await auditEventHash(previousHash, actorEmail, organizationId, action, resource, outcome, normalizedMetadata);
    const result = await db.run(sql`
      INSERT INTO audit_events (actor_email, organization_id, action, resource, outcome, metadata, previous_hash, event_hash)
      SELECT ${actorEmail}, ${organizationId || null}, ${action}, ${resource}, ${outcome}, ${normalizedMetadata}, ${previousHash}, ${eventHash}
      WHERE COALESCE((SELECT NULLIF(event_hash, '') FROM audit_events ORDER BY id DESC LIMIT 1), 'GENESIS') = ${previousHash}
    `);
    if (Number(result?.meta?.changes ?? 0) > 0) return;
  }
  // Con mucha contención, nunca se pierde un evento de auditoría: se inserta
  // igualmente y queda marcado para que la verificación lo explique.
  const [previous] = await db.select().from(auditEvents).orderBy(desc(auditEvents.id)).limit(1);
  const previousHash = previous?.eventHash || "GENESIS";
  const contendedMetadata = JSON.stringify({ ...metadata, auditChainContended: true });
  const eventHash = await auditEventHash(previousHash, actorEmail, organizationId, action, resource, outcome, contendedMetadata);
  await db.insert(auditEvents).values({
    actorEmail,
    organizationId: organizationId || null,
    action,
    resource,
    outcome,
    metadata: contendedMetadata,
    previousHash,
    eventHash,
  });
}

export async function listRecentAudit(actorEmail: string, role: IrisRole, limit = 20) {
  const db = getDb();
  const cap = Math.min(limit, 100);
  if (role === "ADMIN") return db.select().from(auditEvents).orderBy(desc(auditEvents.createdAt)).limit(cap);
  return db.select().from(auditEvents).where(and(eq(auditEvents.actorEmail, actorEmail))).orderBy(desc(auditEvents.createdAt)).limit(cap);
}

export async function listUsersForAdmin(actorEmail: string, role: IrisRole, limit = 50, offset = 0) {
  if (role !== "ADMIN") {
    await logAudit(actorEmail, "USER_LIST_VIEWED", "user_directory", "DENIED");
    throw new Error("Administrator access required");
  }
  return getDb().select().from(users).orderBy(desc(users.lastSeenAt)).limit(Math.min(limit, 200)).offset(offset);
}

export async function listUserAuditForAdmin(actorEmail: string, role: IrisRole, targetEmail?: string) {
  if (role !== "ADMIN") {
    await logAudit(actorEmail, "USER_AUDIT_VIEWED", targetEmail || "user_directory", "DENIED");
    throw new Error("Administrator access required");
  }
  const db = getDb();
  if (targetEmail) return db.select().from(auditEvents).where(eq(auditEvents.actorEmail, targetEmail)).orderBy(desc(auditEvents.createdAt)).limit(30);
  return db.select().from(auditEvents).orderBy(desc(auditEvents.createdAt)).limit(30);
}

export async function updateUserAccess(actorEmail: string, actorRole: IrisRole, targetEmail: string, nextRole: IrisRole, nextStatus: "ACTIVE" | "SUSPENDED") {
  const db = getDb();
  const normalizedTarget = targetEmail.trim().toLowerCase();
  if (actorRole !== "ADMIN") {
    await logAudit(actorEmail, "USER_ACCESS_CHANGED", normalizedTarget, "DENIED", { nextRole, nextStatus });
    throw new Error("Administrator access required");
  }

  const [target] = await db.select().from(users).where(eq(users.email, normalizedTarget)).limit(1);
  if (!target) throw new Error("User not found");
  if (normalizedTarget === actorEmail && (nextRole !== "ADMIN" || nextStatus !== "ACTIVE")) {
    await logAudit(actorEmail, "USER_ACCESS_CHANGED", normalizedTarget, "DENIED", { reason: "self_lockout_prevented" });
    throw new Error("You cannot remove or suspend your own administrator access");
  }

  if (target.role === "ADMIN" && target.status === "ACTIVE" && (nextRole !== "ADMIN" || nextStatus !== "ACTIVE")) {
    const [{ value: activeAdminCount }] = await db.select({ value: count() }).from(users).where(and(eq(users.role, "ADMIN"), eq(users.status, "ACTIVE")));
    if (activeAdminCount <= 1) {
      await logAudit(actorEmail, "USER_ACCESS_CHANGED", normalizedTarget, "DENIED", { reason: "last_admin_protected" });
      throw new Error("IRIS must keep at least one active administrator");
    }
  }

  await db.update(users).set({ role: nextRole, status: nextStatus }).where(eq(users.email, normalizedTarget));
  await logAudit(actorEmail, "USER_ACCESS_CHANGED", normalizedTarget, "SUCCESS", { previousRole: target.role, previousStatus: target.status, nextRole, nextStatus });
}
