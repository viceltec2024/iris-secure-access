import type { AuthenticationResponseJSON } from "@simplewebauthn/server";
import { verifyAuthenticationResponse } from "@simplewebauthn/server";
import { and, eq } from "drizzle-orm";
import { getDb } from "../../../../../db";
import { passkeyCredentials } from "../../../../../db/schema";
import { getChatGPTUser } from "../../../../chatgpt-auth";
import { logAudit, provisionIrisUser } from "../../../../../lib/authz";
import { consumeChallenge, decodePublicKey, issueBiometricSession, parsePasskeyTransports } from "../../../../../lib/passkeys";
import { passkeyRelyingParty } from "../../../../../lib/iris-origin";

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
    const { origin, rpID } = passkeyRelyingParty(request.url);
    const verification = await verifyAuthenticationResponse({
      response, expectedChallenge: challenge, expectedOrigin: origin, expectedRPID: rpID, requireUserVerification: true,
      credential: { id: record.id, publicKey: decodePublicKey(record.publicKey), counter: record.counter, transports: parsePasskeyTransports(record.transports) },
    });
    if (!verification.verified) throw new Error("Touch ID was not verified");
    await db.update(passkeyCredentials).set({ counter: verification.authenticationInfo.newCounter, lastUsedAt: new Date().toISOString() }).where(eq(passkeyCredentials.id, record.id));
    await issueBiometricSession(user.email, request.url);
    await logAudit(user.email, "BIOMETRIC_VERIFICATION", "iris_dashboard", "SUCCESS");
    return Response.json({ verified: true });
  } catch (error) {
    await logAudit(user.email, "BIOMETRIC_VERIFICATION", "iris_dashboard", "DENIED");
    return Response.json({ error: error instanceof Error ? error.message : "Touch ID verification failed" }, { status: 400 });
  }
}
