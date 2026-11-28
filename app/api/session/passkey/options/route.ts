import { generateAuthenticationOptions } from "@simplewebauthn/server";
import { cookies } from "next/headers";
import { parsePasskeyTransports, passkeysFor, storeChallenge } from "../../../../../lib/passkeys";
import { passkeyRelyingParty } from "../../../../../lib/iris-origin";
import { enforceRateLimit } from "../../../../../lib/rate-limit";
import {
  LOGIN_RATE_LIMITED_ERROR,
  PASSKEY_LOGIN_COOKIE,
  PASSKEY_LOGIN_TTL_SECONDS,
  normalizeLoginEmail,
  passkeyLoginChallengeKey,
  sameOriginRequest,
} from "../../../../../lib/iris-login-core";

export const dynamic = "force-dynamic";

/**
 * Reto para entrar con Face ID (iPhone) o Touch ID (Mac) sin ChatGPT.
 * Sin correo usa passkeys descubribles (las de iCloud lo son); con correo
 * limita el reto a sus passkeys. La respuesta es igual exista o no la cuenta.
 */
export async function POST(request: Request) {
  if (!sameOriginRequest(request.url, request.headers.get("origin"))) {
    return Response.json({ error: "Origen no permitido." }, { status: 403 });
  }
  const ip = request.headers.get("cf-connecting-ip") || "unknown";
  if (!(await enforceRateLimit(`passkey-login-options:${ip}`, 20, 5 * 60 * 1000))) {
    return Response.json({ error: LOGIN_RATE_LIMITED_ERROR }, { status: 429, headers: { "Retry-After": "300" } });
  }
  const body = await request.json().catch(() => ({})) as { email?: unknown };
  const email = normalizeLoginEmail(body.email);
  const credentials = email ? await passkeysFor(email) : [];
  const { rpID } = passkeyRelyingParty(request.url);
  const options = await generateAuthenticationOptions({
    rpID,
    userVerification: "required",
    allowCredentials: credentials.map(item => ({ id: item.id, transports: parsePasskeyTransports(item.transports) })),
  });
  const nonce = crypto.randomUUID();
  await storeChallenge(passkeyLoginChallengeKey(nonce)!, "AUTHENTICATE", options.challenge);
  (await cookies()).set(PASSKEY_LOGIN_COOKIE, nonce, {
    httpOnly: true,
    secure: passkeyRelyingParty(request.url).secureCookie,
    sameSite: "strict",
    path: "/api/session/passkey",
    maxAge: PASSKEY_LOGIN_TTL_SECONDS,
  });
  return Response.json(options);
}
