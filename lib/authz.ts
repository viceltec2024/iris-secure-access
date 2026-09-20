import { and, count, desc, eq } from "drizzle-orm";
import { getDb } from "../db";
import { auditEvents, users } from "../db/schema";
import type { ChatGPTUser } from "../app/chatgpt-auth";

export type IrisRole = "ADMIN" | "USER";

export async function provisionIrisUser(identity: ChatGPTUser) {
  const db = getDb();
  const normalizedEmail = identity.email.trim().toLowerCase();
  const existing = await db.select().from(users).where(eq(users.email, normalizedEmail)).limit(1);

  if (existing[0]) {
    await db.update(users).set({ displayName: identity.fullName, lastSeenAt: new Date().toISOString() }).where(eq(users.email, normalizedEmail));
    await logAudit(normalizedEmail, "SESSION_STARTED", "iris_workspace", "SUCCESS");
    return { ...existing[0], displayName: identity.fullName, lastSeenAt: new Date().toISOString() };
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

export async function logAudit(actorEmail: string, action: string, resource: string, outcome: "SUCCESS" | "DENIED", metadata: Record<string, unknown> = {}) {
  const db = getDb();
  const normalizedMetadata = JSON.stringify(metadata);
  const [previous] = await db.select().from(auditEvents).orderBy(desc(auditEvents.id)).limit(1);
  const previousHash = previous?.eventHash || "GENESIS";
  const material = JSON.stringify({ previousHash, actorEmail, action, resource, outcome, metadata: normalizedMetadata });
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(material));
  const eventHash = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
  await db.insert(auditEvents).values({ actorEmail, action, resource, outcome, metadata: normalizedMetadata, previousHash, eventHash });
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
