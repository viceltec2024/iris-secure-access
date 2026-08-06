import type { RegistrationResponseJSON } from "@simplewebauthn/server";
import { verifyRegistrationResponse } from "@simplewebauthn/server";
import { getDb } from "../../../../../db";
import { passkeyCredentials } from "../../../../../db/schema";
import { getChatGPTUser } from "../../../../chatgpt-auth";
import { logAudit, provisionIrisUser } from "../../../../../lib/authz";
import { consumeChallenge, encodePublicKey, issueBiometricSession, PASSKEY_ORIGIN, PASSKEY_RP_ID } from "../../../../../lib/passkeys";

export async function POST(request: Request) {
  const identity = await getChatGPTUser();
  if (!identity) return Response.json({ error: "Authentication required" }, { status: 401 });
  const user = await provisionIrisUser(identity);
  const response = await request.json() as RegistrationResponseJSON;
  const challenge = await consumeChallenge(user.email, "REGISTER");
  if (!challenge) return Response.json({ error: "The verification expired. Try again." }, { status: 400 });
  try {
    const verification = await verifyRegistrationResponse({ response, expectedChallenge: challenge, expectedOrigin: PASSKEY_ORIGIN, expectedRPID: PASSKEY_RP_ID, requireUserVerification: true });
    if (!verification.verified || !verification.registrationInfo) throw new Error("Touch ID was not verified");
    const info = verification.registrationInfo;
    await getDb().insert(passkeyCredentials).values({
      id: info.credential.id, ownerEmail: user.email, publicKey: encodePublicKey(info.credential.publicKey),
      counter: info.credential.counter, transports: JSON.stringify(info.credential.transports || []),
      deviceType: info.credentialDeviceType, backedUp: info.credentialBackedUp,
    }).onConflictDoNothing();
    await issueBiometricSession(user.email);
    await logAudit(user.email, "PASSKEY_REGISTERED", "biometric_access", "SUCCESS", { deviceType: info.credentialDeviceType });
    return Response.json({ verified: true });
  } catch (error) {
    await logAudit(user.email, "PASSKEY_REGISTERED", "biometric_access", "DENIED");
    return Response.json({ error: error instanceof Error ? error.message : "Touch ID verification failed" }, { status: 400 });
  }
}
