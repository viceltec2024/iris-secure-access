import { generateRegistrationOptions } from "@simplewebauthn/server";
import { getChatGPTUser } from "../../../../chatgpt-auth";
import { provisionIrisUser } from "../../../../../lib/authz";
import { PASSKEY_RP_ID, PASSKEY_RP_NAME, passkeysFor, stableUserId, storeChallenge } from "../../../../../lib/passkeys";

export async function POST() {
  const identity = await getChatGPTUser();
  if (!identity) return Response.json({ error: "Authentication required" }, { status: 401 });
  const user = await provisionIrisUser(identity);
  const existing = await passkeysFor(user.email);
  const options = await generateRegistrationOptions({
    rpName: PASSKEY_RP_NAME, rpID: PASSKEY_RP_ID,
    userID: await stableUserId(user.email), userName: user.email,
    userDisplayName: user.displayName || user.email,
    attestationType: "none",
    excludeCredentials: existing.map(item => ({ id: item.id, transports: JSON.parse(item.transports) })),
    authenticatorSelection: { authenticatorAttachment: "platform", residentKey: "required", userVerification: "required" },
  });
  await storeChallenge(user.email, "REGISTER", options.challenge);
  return Response.json(options);
}
