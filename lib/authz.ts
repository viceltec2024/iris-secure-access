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

  const [{ value: userCount }] = await db.select({ value: count() }).from(users);
  const role: IrisRole = userCount === 0 ? "ADMIN" : "USER";
  const [created] = await db.insert(users).values({ email: normalizedEmail, displayName: identity.fullName, role }).returning();
  await logAudit(normalizedEmail, "USER_PROVISIONED", "iris_workspace", "SUCCESS", { role });
  return created;
}

export async function logAudit(actorEmail: string, action: string, resource: string, outcome: "SUCCESS" | "DENIED", metadata: Record<string, unknown> = {}) {
  await getDb().insert(auditEvents).values({ actorEmail, action, resource, outcome, metadata: JSON.stringify(metadata) });
}

export async function listRecentAudit(actorEmail: string, role: IrisRole) {
  const db = getDb();
  if (role === "ADMIN") return db.select().from(auditEvents).orderBy(desc(auditEvents.createdAt)).limit(12);
  return db.select().from(auditEvents).where(and(eq(auditEvents.actorEmail, actorEmail))).orderBy(desc(auditEvents.createdAt)).limit(12);
}
