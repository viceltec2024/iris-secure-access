import { eq } from "drizzle-orm";
import { getDb } from "../db";
import { rateLimits } from "../db/schema";

/**
 * Shared token-bucket rate limiter backed by the D1 rateLimits table.
 *
 * Returns true when the request is within the limit and increments the counter.
 * Returns false when the limit has already been reached.
 *
 * Each (key, windowMs) pair gets its own sliding window.  When the window
 * expires the counter resets automatically on the next call.
 */
export async function enforceRateLimit(key: string, limit: number, windowMs: number): Promise<boolean> {
  const db = getDb();
  const now = Date.now();
  const [row] = await db.select().from(rateLimits).where(eq(rateLimits.key, key)).limit(1);

  if (!row || Date.parse(row.expiresAt) <= now) {
    // No record or expired window — open a fresh window starting at count 1.
    await db
      .insert(rateLimits)
      .values({ key, count: 1, expiresAt: new Date(now + windowMs).toISOString() })
      .onConflictDoUpdate({ target: rateLimits.key, set: { count: 1, expiresAt: new Date(now + windowMs).toISOString() } });
    return true;
  }

  if (row.count >= limit) return false;

  await db.update(rateLimits).set({ count: row.count + 1 }).where(eq(rateLimits.key, key));
  return true;
}
