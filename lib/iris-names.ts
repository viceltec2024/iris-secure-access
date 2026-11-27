import "server-only";

import { eq } from "drizzle-orm";
import { getDb } from "../db";
import { appSettings } from "../db/schema";
import { cleanPreferredName, friendlyName, preferredNameKey } from "./iris-name-core.ts";

export async function getPreferredName(email: string): Promise<string | null> {
  const [row] = await getDb().select().from(appSettings).where(eq(appSettings.key, preferredNameKey(email))).limit(1);
  return row ? cleanPreferredName(row.value) : null;
}

export async function setPreferredName(email: string, name: string) {
  const clean = cleanPreferredName(name);
  if (!clean) throw new Error("invalid_name");
  await getDb().insert(appSettings).values({ key: preferredNameKey(email), value: clean, updatedBy: email })
    .onConflictDoUpdate({ target: appSettings.key, set: { value: clean, updatedBy: email, updatedAt: new Date().toISOString() } });
  return clean;
}

export async function userFriendlyName(user: { email: string; displayName?: string | null }) {
  const preferred = await getPreferredName(user.email).catch(() => null);
  return friendlyName({ preferred, displayName: user.displayName, email: user.email });
}
