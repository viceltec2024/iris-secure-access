import { getChatGPTUser } from "../../../chatgpt-auth";
import { logAudit, provisionIrisUser } from "../../../../lib/authz";
import { issueBiometricSession } from "../../../../lib/passkeys";
import { canAttemptPassword, verifyPassword } from "../../../../lib/passwords";

export async function POST(request: Request) {
  const identity = await getChatGPTUser();
  if (!identity) return Response.json({ error: "Authentication required" }, { status: 401 });
  const user = await provisionIrisUser(identity);
  if (!(await canAttemptPassword(user.email))) {
    await logAudit(user.email, "IRIS_PASSWORD_VERIFIED", "step_up_access", "DENIED", { reason: "rate_limited" });
    return Response.json({ error: "Demasiados intentos. Espera 15 minutos." }, { status: 429 });
  }
  const body = await request.json().catch(() => ({})) as { password?: string };
  const verified = typeof body.password === "string" && await verifyPassword(user.email, body.password);
  await logAudit(user.email, "IRIS_PASSWORD_VERIFIED", "step_up_access", verified ? "SUCCESS" : "DENIED");
  if (!verified) return Response.json({ error: "Contraseña incorrecta." }, { status: 401 });
  await issueBiometricSession(user.email);
  return Response.json({ verified: true });
}
