import { and, eq, gt, sql } from "drizzle-orm";
import { getDb } from "../db";
import { rateLimits } from "../db/schema";

/**
 * Shared token-bucket rate limiter backed by the D1 rateLimits table.
 *
 * Returns true when the request is within the limit and increments the counter.
 * Returns false when the limit has already been reached.
 *
 * The counter increment is a single conditional UPDATE so concurrent requests
 * cannot race past the limit by reading the same count simultaneously.
 */
export async function enforceRateLimit(key: string, limit: number, windowMs: number): Promise<boolean> {
  const db = getDb();
  const now = Date.now();
  const expiresAt = new Date(now + windowMs).toISOString();
  const nowIso = new Date(now).toISOString();

  // Upsert: open a fresh window (count=0) when no row exists yet, or when the
  // stored window has already expired.  The WHERE clause prevents overwriting a
  // still-valid window.
  await db
    .insert(rateLimits)
    .values({ key, count: 0, expiresAt })
    .onConflictDoUpdate({
      target: rateLimits.key,
      set: { count: 0, expiresAt },
      where: sql`${rateLimits.expiresAt} <= ${nowIso}`,
    });

  // Single atomic increment — only succeeds when the window is still valid and
  // the count has not yet reached the limit.  No read-then-write race possible.
  const result = await db
    .update(rateLimits)
    .set({ count: sql`${rateLimits.count} + 1` })
    .where(and(eq(rateLimits.key, key), gt(rateLimits.expiresAt, nowIso), sql`${rateLimits.count} < ${limit}`))
    .returning({ count: rateLimits.count });

  return result.length > 0;
}
