import "server-only";

import { and, desc, eq, gt } from "drizzle-orm";
import { cookies } from "next/headers";
import { isoBase64URL } from "@simplewebauthn/server/helpers";
import { getDb } from "../db";
import { biometricSessions, passkeyChallenges, passkeyCredentials } from "../db/schema";

export const PASSKEY_RP_NAME = "IRIS Secure Access";
export const PASSKEY_RP_ID = "iris-secure-access.taylor-667.chatgpt.site";
export const PASSKEY_ORIGIN = `https://${PASSKEY_RP_ID}`;
export const BIOMETRIC_COOKIE = "iris_biometric_session";
const CHALLENGE_TTL_MS = 5 * 60 * 1000;
const SESSION_TTL_SECONDS = 12 * 60 * 60;

export const encodePublicKey = (value: Uint8Array) => isoBase64URL.fromBuffer(value);
export const decodePublicKey = (value: string) => isoBase64URL.toBuffer(value);

export async function passkeysFor(ownerEmail: string) {
  return getDb().select().from(passkeyCredentials).where(eq(passkeyCredentials.ownerEmail, ownerEmail));
}

export async function storeChallenge(ownerEmail: string, purpose: "REGISTER" | "AUTHENTICATE", challenge: string) {
  const db = getDb();
  await db.delete(passkeyChallenges).where(and(eq(passkeyChallenges.ownerEmail, ownerEmail), eq(passkeyChallenges.purpose, purpose)));
  await db.insert(passkeyChallenges).values({
    id: crypto.randomUUID(), ownerEmail, purpose, challenge,
    expiresAt: new Date(Date.now() + CHALLENGE_TTL_MS).toISOString(),
  });
}

export async function consumeChallenge(ownerEmail: string, purpose: "REGISTER" | "AUTHENTICATE") {
  const db = getDb();
  const [record] = await db.select().from(passkeyChallenges).where(and(
    eq(passkeyChallenges.ownerEmail, ownerEmail),
    eq(passkeyChallenges.purpose, purpose),
    gt(passkeyChallenges.expiresAt, new Date().toISOString()),
  )).orderBy(desc(passkeyChallenges.createdAt)).limit(1);
  if (!record) return null;
  await db.delete(passkeyChallenges).where(eq(passkeyChallenges.id, record.id));
  return record.challenge;
}

async function digest(value: string) {
  const bytes = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)));
  return Array.from(bytes, byte => byte.toString(16).padStart(2, "0")).join("");
}

export async function issueBiometricSession(ownerEmail: string) {
  const rawToken = `${crypto.randomUUID()}${crypto.randomUUID()}`;
  const tokenHash = await digest(rawToken);
  const expiresAt = new Date(Date.now() + SESSION_TTL_SECONDS * 1000).toISOString();
  const db = getDb();
  await db.delete(biometricSessions).where(eq(biometricSessions.ownerEmail, ownerEmail));
  await db.insert(biometricSessions).values({ tokenHash, ownerEmail, expiresAt });
  const jar = await cookies();
  jar.set(BIOMETRIC_COOKIE, rawToken, { httpOnly: true, secure: true, sameSite: "strict", path: "/", maxAge: SESSION_TTL_SECONDS });
}

export async function isBiometricVerified(ownerEmail: string) {
  const rawToken = (await cookies()).get(BIOMETRIC_COOKIE)?.value;
  if (!rawToken) return false;
  const [session] = await getDb().select().from(biometricSessions).where(and(
    eq(biometricSessions.tokenHash, await digest(rawToken)),
    eq(biometricSessions.ownerEmail, ownerEmail),
    gt(biometricSessions.expiresAt, new Date().toISOString()),
  )).limit(1);
  return Boolean(session);
}

export async function stableUserId(email: string) {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(email)));
}
