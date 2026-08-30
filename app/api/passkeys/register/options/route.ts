import { generateRegistrationOptions } from "@simplewebauthn/server";
import { getChatGPTUser } from "../../../../chatgpt-auth";
import { provisionIrisUser } from "../../../../../lib/authz";
import { PASSKEY_RP_ID, PASSKEY_RP_NAME, passkeysFor, stableUserId, storeChallenge } from "../../../../../lib/passkeys";
import { enforceRateLimit } from "../../../../../lib/rate-limit";

export async function POST(request: Request) {
  const identity = await getChatGPTUser();
  if (!identity) return Response.json({ error: "Authentication required" }, { status: 401 });
  const user = await provisionIrisUser(identity);

  const ip = request.headers.get("cf-connecting-ip") || "unknown";
  if (!(await enforceRateLimit(`passkey-register-options:${ip}`, 10, 10 * 60 * 1000))) {
    return Response.json({ error: "Too many requests. Please wait a moment." }, { status: 429, headers: { "Retry-After": "600" } });
  }

  const existing = await passkeysFor(user.email);
  const options = await generateRegistrationOptions({
    rpName: PASSKEY_RP_NAME, rpID: PASSKEY_RP_ID,
    userID: await stableUserId(user.email), userName: user.email,
    userDisplayName: user.displayName || user.email,
    attestationType: "none",
    excludeCredentials: existing.map(item => ({ id: item.id, transports: JSON.parse(item.transports) })),
    authenticatorSelection: { residentKey: "preferred", userVerification: "required" },
  });
  await storeChallenge(user.email, "REGISTER", options.challenge);
  return Response.json(options);
}
