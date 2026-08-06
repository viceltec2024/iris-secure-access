import type { AuthenticationResponseJSON } from "@simplewebauthn/server";
import { verifyAuthenticationResponse } from "@simplewebauthn/server";
import { and, eq } from "drizzle-orm";
import { getDb } from "../../../../../db";
import { passkeyCredentials } from "../../../../../db/schema";
import { getChatGPTUser } from "../../../../chatgpt-auth";
import { logAudit, provisionIrisUser } from "../../../../../lib/authz";
import { consumeChallenge, decodePublicKey, issueBiometricSession, PASSKEY_ORIGIN, PASSKEY_RP_ID } from "../../../../../lib/passkeys";

export async function POST(request: Request) {
  const identity = await getChatGPTUser();
  if (!identity) return Response.json({ error: "Authentication required" }, { status: 401 });
  const user = await provisionIrisUser(identity);
  const response = await request.json() as AuthenticationResponseJSON;
  const challenge = await consumeChallenge(user.email, "AUTHENTICATE");
  if (!challenge) return Response.json({ error: "The verification expired. Try again." }, { status: 400 });
  const db = getDb();
  const [record] = await db.select().from(passkeyCredentials).where(and(eq(passkeyCredentials.id, response.id), eq(passkeyCredentials.ownerEmail, user.email))).limit(1);
  if (!record) return Response.json({ error: "Credential not recognized" }, { status: 400 });
  try {
    const verification = await verifyAuthenticationResponse({
      response, expectedChallenge: challenge, expectedOrigin: PASSKEY_ORIGIN, expectedRPID: PASSKEY_RP_ID, requireUserVerification: true,
      credential: { id: record.id, publicKey: decodePublicKey(record.publicKey), counter: record.counter, transports: JSON.parse(record.transports) },
    });
    if (!verification.verified) throw new Error("Touch ID was not verified");
    await db.update(passkeyCredentials).set({ counter: verification.authenticationInfo.newCounter, lastUsedAt: new Date().toISOString() }).where(eq(passkeyCredentials.id, record.id));
    await issueBiometricSession(user.email);
    await logAudit(user.email, "BIOMETRIC_VERIFICATION", "iris_dashboard", "SUCCESS");
    return Response.json({ verified: true });
  } catch (error) {
    await logAudit(user.email, "BIOMETRIC_VERIFICATION", "iris_dashboard", "DENIED");
    return Response.json({ error: error instanceof Error ? error.message : "Touch ID verification failed" }, { status: 400 });
  }
}
