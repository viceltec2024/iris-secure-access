import { findIrisUser, logAudit } from "../../../../lib/authz";
import { issueBiometricSession } from "../../../../lib/passkeys";
import { canAttemptPassword, verifyPasswordForLogin } from "../../../../lib/passwords";
import { enforceRateLimit } from "../../../../lib/rate-limit";
import {
  LOGIN_GENERIC_ERROR,
  LOGIN_IP_LIMIT,
  LOGIN_RATE_LIMITED_ERROR,
  LOGIN_WINDOW_MS,
  normalizeLoginEmail,
  sameOriginRequest,
  validPasswordInput,
} from "../../../../lib/iris-login-core";

export const dynamic = "force-dynamic";

/** Inicio de sesión con correo y contraseña de IRIS, sin ChatGPT. */
export async function POST(request: Request) {
  if (!sameOriginRequest(request.url, request.headers.get("origin"))) {
    return Response.json({ error: "Origen no permitido." }, { status: 403 });
  }
  const ip = request.headers.get("cf-connecting-ip") || "unknown";
  if (!(await enforceRateLimit(`login-ip:${ip}`, LOGIN_IP_LIMIT, LOGIN_WINDOW_MS))) {
    return Response.json({ error: LOGIN_RATE_LIMITED_ERROR }, { status: 429, headers: { "Retry-After": "900" } });
  }

  const body = await request.json().catch(() => ({})) as { email?: unknown; password?: unknown };
  const email = normalizeLoginEmail(body.email);
  if (!email || !validPasswordInput(body.password)) {
    return Response.json({ error: LOGIN_GENERIC_ERROR }, { status: 401 });
  }
  if (!(await canAttemptPassword(email))) {
    await logAudit(email, "IRIS_PASSWORD_LOGIN", "session", "DENIED", { reason: "rate_limited", ip });
    return Response.json({ error: LOGIN_RATE_LIMITED_ERROR }, { status: 429, headers: { "Retry-After": "900" } });
  }

  const verified = await verifyPasswordForLogin(email, body.password);
  const user = verified ? await findIrisUser({ email, displayName: email, fullName: null }) : null;
  if (!verified || !user || user.status !== "ACTIVE") {
    await logAudit(email, "IRIS_PASSWORD_LOGIN", "session", "DENIED", { reason: !verified ? "bad_credentials" : "inactive_user", ip });
    return Response.json({ error: LOGIN_GENERIC_ERROR }, { status: 401 });
  }

  await issueBiometricSession(email, request.url);
  await logAudit(email, "IRIS_PASSWORD_LOGIN", "session", "SUCCESS", { ip });
  return Response.json({ signedIn: true });
}
