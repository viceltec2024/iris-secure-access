import type { AuthenticationResponseJSON } from "@simplewebauthn/server";
import { verifyAuthenticationResponse } from "@simplewebauthn/server";
import { cookies } from "next/headers";
import { eq } from "drizzle-orm";
import { getDb } from "../../../../../db";
import { passkeyCredentials } from "../../../../../db/schema";
import { findIrisUser, logAudit } from "../../../../../lib/authz";
import { consumeChallenge, decodePublicKey, issueBiometricSession, parsePasskeyTransports } from "../../../../../lib/passkeys";
import { passkeyRelyingParty } from "../../../../../lib/iris-origin";
import { PASSKEY_LOGIN_COOKIE, passkeyLoginChallengeKey, sameOriginRequest } from "../../../../../lib/iris-login-core";

export const dynamic = "force-dynamic";

const FAILED = "No se pudo verificar Face ID / Touch ID. Inténtalo de nuevo o entra con tu contraseña.";

/** Verifica Face ID / Touch ID y abre la sesión de IRIS de esa cuenta. */
export async function POST(request: Request) {
  if (!sameOriginRequest(request.url, request.headers.get("origin"))) {
    return Response.json({ error: "Origen no permitido." }, { status: 403 });
  }
  const jar = await cookies();
  const key = passkeyLoginChallengeKey(jar.get(PASSKEY_LOGIN_COOKIE)?.value || "");
  jar.set(PASSKEY_LOGIN_COOKIE, "", { path: "/api/session/passkey", maxAge: 0 });
  const challenge = key ? await consumeChallenge(key, "AUTHENTICATE") : null;
  if (!challenge) return Response.json({ error: "La verificación caducó. Inténtalo de nuevo." }, { status: 400 });

  const response = await request.json().catch(() => null) as AuthenticationResponseJSON | null;
  if (!response || typeof response.id !== "string" || response.id.length > 1024) {
    return Response.json({ error: FAILED }, { status: 400 });
  }
  const db = getDb();
  const [record] = await db.select().from(passkeyCredentials).where(eq(passkeyCredentials.id, response.id)).limit(1);
  if (!record) return Response.json({ error: FAILED }, { status: 401 });

  try {
    const { origin, rpID } = passkeyRelyingParty(request.url);
    const verification = await verifyAuthenticationResponse({
      response, expectedChallenge: challenge, expectedOrigin: origin, expectedRPID: rpID, requireUserVerification: true,
      credential: { id: record.id, publicKey: decodePublicKey(record.publicKey), counter: record.counter, transports: parsePasskeyTransports(record.transports) },
    });
    if (!verification.verified) throw new Error("not_verified");
    const user = await findIrisUser({ email: record.ownerEmail, displayName: record.ownerEmail, fullName: null });
    if (!user || user.status !== "ACTIVE") throw new Error("inactive_user");
    await db.update(passkeyCredentials).set({ counter: verification.authenticationInfo.newCounter, lastUsedAt: new Date().toISOString() }).where(eq(passkeyCredentials.id, record.id));
    await issueBiometricSession(record.ownerEmail, request.url);
    await logAudit(record.ownerEmail, "IRIS_PASSKEY_LOGIN", "session", "SUCCESS", { deviceType: record.deviceType });
    return Response.json({ signedIn: true });
  } catch (error) {
    await logAudit(record.ownerEmail, "IRIS_PASSKEY_LOGIN", "session", "DENIED", { reason: error instanceof Error ? error.message : "failed" });
    return Response.json({ error: FAILED }, { status: 401 });
  }
}
