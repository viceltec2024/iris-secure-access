import { generateAuthenticationOptions } from "@simplewebauthn/server";
import { getChatGPTUser } from "../../../../chatgpt-auth";
import { provisionIrisUser } from "../../../../../lib/authz";
import { PASSKEY_RP_ID, passkeysFor, storeChallenge } from "../../../../../lib/passkeys";

export async function POST() {
  const identity = await getChatGPTUser();
  if (!identity) return Response.json({ error: "Authentication required" }, { status: 401 });
  const user = await provisionIrisUser(identity);
  const credentials = await passkeysFor(user.email);
  if (!credentials.length) return Response.json({ error: "Touch ID is not configured" }, { status: 404 });
  const options = await generateAuthenticationOptions({
    rpID: PASSKEY_RP_ID, userVerification: "required",
    allowCredentials: credentials.map(item => ({ id: item.id, transports: JSON.parse(item.transports) })),
  });
  await storeChallenge(user.email, "AUTHENTICATE", options.challenge);
  return Response.json(options);
}
