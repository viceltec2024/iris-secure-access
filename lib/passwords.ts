import "server-only";

import { eq } from "drizzle-orm";
import { getDb } from "../db";
import { rateLimits, userPasswords } from "../db/schema";

const PASSWORD_ITERATIONS = 600_000;
const ATTEMPT_LIMIT = 5;
const ATTEMPT_WINDOW_MS = 15 * 60 * 1000;

function toHex(bytes: Uint8Array) {
  return Array.from(bytes, byte => byte.toString(16).padStart(2, "0")).join("");
}

function fromHex(value: string) {
  return new Uint8Array(value.match(/.{2}/g)?.map(byte => Number.parseInt(byte, 16)) || []);
}

async function derive(password: string, salt: Uint8Array, iterations: number) {
  const material = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations }, material, 256));
}

function secureEqual(a: Uint8Array, b: Uint8Array) {
  if (a.length !== b.length) return false;
  let difference = 0;
  for (let index = 0; index < a.length; index += 1) difference |= a[index] ^ b[index];
  return difference === 0;
}

export async function passwordConfigured(ownerEmail: string) {
  const [record] = await getDb().select({ ownerEmail: userPasswords.ownerEmail }).from(userPasswords).where(eq(userPasswords.ownerEmail, ownerEmail)).limit(1);
  return Boolean(record);
}

export async function createPassword(ownerEmail: string, password: string) {
  if (password.length < 12 || password.length > 128) throw new Error("La contraseña debe tener entre 12 y 128 caracteres.");
  if (await passwordConfigured(ownerEmail)) throw new Error("Ya existe una contraseña de IRIS.");
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const passwordHash = await derive(password, salt, PASSWORD_ITERATIONS);
  await getDb().insert(userPasswords).values({ ownerEmail, passwordHash: toHex(passwordHash), salt: toHex(salt), iterations: PASSWORD_ITERATIONS });
}

export async function canAttemptPassword(ownerEmail: string) {
  const db = getDb();
  const key = `password:${ownerEmail}`;
  const now = Date.now();
  const [row] = await db.select().from(rateLimits).where(eq(rateLimits.key, key)).limit(1);
  if (!row || Date.parse(row.expiresAt) <= now) {
    await db.insert(rateLimits).values({ key, count: 0, expiresAt: new Date(now + ATTEMPT_WINDOW_MS).toISOString() }).onConflictDoUpdate({ target: rateLimits.key, set: { count: 0, expiresAt: new Date(now + ATTEMPT_WINDOW_MS).toISOString() } });
    return true;
  }
  return row.count < ATTEMPT_LIMIT;
}

export async function verifyPassword(ownerEmail: string, password: string) {
  const db = getDb();
  const key = `password:${ownerEmail}`;
  const [record] = await db.select().from(userPasswords).where(eq(userPasswords.ownerEmail, ownerEmail)).limit(1);
  if (!record) return false;
  const candidate = await derive(password.slice(0, 128), fromHex(record.salt), record.iterations);
  const verified = secureEqual(candidate, fromHex(record.passwordHash));
  if (verified) await db.delete(rateLimits).where(eq(rateLimits.key, key));
  else {
    const [row] = await db.select().from(rateLimits).where(eq(rateLimits.key, key)).limit(1);
    await db.update(rateLimits).set({ count: (row?.count || 0) + 1 }).where(eq(rateLimits.key, key));
  }
  return verified;
}
