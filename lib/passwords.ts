import "server-only";

import { eq } from "drizzle-orm";
import { getDb } from "../db";
import { rateLimits, userPasswords } from "../db/schema";
import { enforceRateLimit } from "./rate-limit";

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
  // Atomically checks-and-consumes one attempt slot so concurrent requests
  // cannot race past the limit (see lib/rate-limit.ts for the same pattern).
  return enforceRateLimit(`password:${ownerEmail}`, ATTEMPT_LIMIT, ATTEMPT_WINDOW_MS);
}

export async function changePassword(ownerEmail: string, currentPassword: string, newPassword: string) {
  if (!(await passwordConfigured(ownerEmail))) throw new Error("No se ha configurado ninguna contraseña de IRIS.");
  if (!(await verifyPassword(ownerEmail, currentPassword))) throw new Error("La contraseña actual es incorrecta.");
  if (newPassword.length < 12 || newPassword.length > 128) throw new Error("La contraseña debe tener entre 12 y 128 caracteres.");
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const passwordHash = await derive(newPassword, salt, PASSWORD_ITERATIONS);
  await getDb().update(userPasswords)
    .set({ passwordHash: toHex(passwordHash), salt: toHex(salt), iterations: PASSWORD_ITERATIONS, updatedAt: new Date().toISOString() })
    .where(eq(userPasswords.ownerEmail, ownerEmail));
}

export async function verifyPassword(ownerEmail: string, password: string) {
  const db = getDb();
  const [record] = await db.select().from(userPasswords).where(eq(userPasswords.ownerEmail, ownerEmail)).limit(1);
  if (!record) return false;
  const candidate = await derive(password.slice(0, 128), fromHex(record.salt), record.iterations);
  const verified = secureEqual(candidate, fromHex(record.passwordHash));
  // The attempt slot is already consumed atomically by canAttemptPassword;
  // only clear it here on success so legitimate users aren't left rate-limited.
  if (verified) await db.delete(rateLimits).where(eq(rateLimits.key, `password:${ownerEmail}`));
  return verified;
}
