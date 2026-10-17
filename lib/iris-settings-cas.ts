/**
 * Compare-and-swap persistence for app_settings JSON blobs.
 * Prevents lost updates when two requests read-modify-write the same key.
 */

import { and, eq } from "drizzle-orm";
import { getDb } from "../db";
import { appSettings } from "../db/schema";

export type CasLoadResult = {
  key: string;
  value: string;
  updatedAt: string | null;
  updatedBy: string | null;
};

export async function loadSettingCas(key: string): Promise<CasLoadResult> {
  const [row] = await getDb().select().from(appSettings).where(eq(appSettings.key, key)).limit(1);
  return {
    key,
    value: row?.value || "",
    updatedAt: row?.updatedAt || null,
    updatedBy: row?.updatedBy || null,
  };
}

/**
 * Insert or update only if the row is new or still at expectedUpdatedAt.
 * Returns false on concurrent conflict (caller should reload and retry).
 */
export async function saveSettingCas(input: {
  key: string;
  value: string;
  actorEmail: string;
  expectedUpdatedAt: string | null;
  now?: string;
}): Promise<{ ok: true; updatedAt: string } | { ok: false; reason: "conflict" }> {
  const db = getDb();
  const now = input.now || new Date().toISOString();

  if (!input.expectedUpdatedAt) {
    try {
      await db.insert(appSettings).values({
        key: input.key,
        value: input.value,
        updatedBy: input.actorEmail,
        updatedAt: now,
      });
      return { ok: true, updatedAt: now };
    } catch {
      // Row appeared concurrently — treat as conflict.
      return { ok: false, reason: "conflict" };
    }
  }

  const updated = await db
    .update(appSettings)
    .set({
      value: input.value,
      updatedBy: input.actorEmail,
      updatedAt: now,
    })
    .where(and(eq(appSettings.key, input.key), eq(appSettings.updatedAt, input.expectedUpdatedAt)))
    .returning({ updatedAt: appSettings.updatedAt });

  if (!updated.length) return { ok: false, reason: "conflict" };
  return { ok: true, updatedAt: updated[0].updatedAt };
}

/** Retry helper for CAS loops. */
export async function withSettingCas<T>(input: {
  key: string;
  actorEmail: string;
  attempts?: number;
  mutate: (value: string, meta: CasLoadResult) => { value: string; result: T };
}): Promise<T> {
  const attempts = Math.max(1, Math.min(input.attempts ?? 5, 8));
  let lastError: Error | null = null;
  for (let i = 0; i < attempts; i += 1) {
    const loaded = await loadSettingCas(input.key);
    const next = input.mutate(loaded.value, loaded);
    const saved = await saveSettingCas({
      key: input.key,
      value: next.value,
      actorEmail: input.actorEmail,
      expectedUpdatedAt: loaded.updatedAt,
    });
    if (saved.ok) return next.result;
    lastError = new Error("cas_conflict");
  }
  throw lastError || new Error("cas_conflict");
}
