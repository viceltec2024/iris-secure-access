import { env } from "cloudflare:workers";
import { logAudit, provisionIrisUser } from "../../../../lib/authz";
import { issueBiometricSession } from "../../../../lib/passkeys";
import { createPassword, passwordConfigured } from "../../../../lib/passwords";
import { enforceRateLimit } from "../../../../lib/rate-limit";
import {
  LOGIN_RATE_LIMITED_ERROR,
  LOGIN_WINDOW_MS,
  normalizeLoginEmail,
  ownerBootstrapAllowed,
  ownerBootstrapMessage,
  sameOriginRequest,
} from "../../../../lib/iris-login-core";

export const dynamic = "force-dynamic";

/**
 * Primer acceso del propietario sin ChatGPT. Requiere IRIS_OWNER_EMAIL e
 * IRIS_SETUP_CODE (16+ caracteres) en el entorno del Worker. Solo funciona
 * una vez: si la contraseña ya existe, hay que iniciar sesión con ella.
 */
export async function POST(request: Request) {
  if (!sameOriginRequest(request.url, request.headers.get("origin"))) {
    return Response.json({ error: "Origen no permitido." }, { status: 403 });
  }
  const ip = request.headers.get("cf-connecting-ip") || "unknown";
  if (!(await enforceRateLimit(`owner-setup-ip:${ip}`, 5, LOGIN_WINDOW_MS))) {
    return Response.json({ error: LOGIN_RATE_LIMITED_ERROR }, { status: 429, headers: { "Retry-After": "900" } });
  }

  const body = await request.json().catch(() => ({})) as { email?: unknown; setupCode?: unknown; password?: unknown; confirmation?: unknown };
  const email = normalizeLoginEmail(body.email) || "";
  const bindings = env as unknown as Record<string, string | undefined>;
  const ownerEmail = String(bindings.IRIS_OWNER_EMAIL || process.env.IRIS_OWNER_EMAIL || "");
  const configuredSetupCode = String(bindings.IRIS_SETUP_CODE || process.env.IRIS_SETUP_CODE || "");
  const password = typeof body.password === "string" ? body.password : "";
  const decision = ownerBootstrapAllowed({
    email,
    ownerEmail,
    configuredSetupCode,
    providedSetupCode: typeof body.setupCode === "string" ? body.setupCode : "",
    passwordAlreadyConfigured: email ? await passwordConfigured(email) : false,
    password,
    confirmation: typeof body.confirmation === "string" ? body.confirmation : "",
  });
  if (!decision.allowed) {
    await logAudit(email || "unknown", "IRIS_OWNER_SETUP", "session", "DENIED", { reason: decision.reason, ip });
    return Response.json({ error: ownerBootstrapMessage(decision.reason) }, { status: decision.reason === "weak_password" || decision.reason === "mismatch" ? 400 : 403 });
  }

  const user = await provisionIrisUser({ email, displayName: email, fullName: null });
  if (user.status !== "ACTIVE") {
    return Response.json({ error: ownerBootstrapMessage("not_owner") }, { status: 403 });
  }
  await createPassword(email, password);
  await issueBiometricSession(email, request.url);
  await logAudit(email, "IRIS_OWNER_SETUP", "session", "SUCCESS", { ip, role: user.role });
  return Response.json({ signedIn: true });
}
