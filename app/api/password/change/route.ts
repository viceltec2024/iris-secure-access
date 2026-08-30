import { getChatGPTUser } from "../../../chatgpt-auth";
import { logAudit, provisionIrisUser } from "../../../../lib/authz";
import { canAttemptPassword, changePassword } from "../../../../lib/passwords";

export async function POST(request: Request) {
  const identity = await getChatGPTUser();
  if (!identity) return Response.json({ error: "Authentication required" }, { status: 401 });
  const user = await provisionIrisUser(identity);

  if (!(await canAttemptPassword(user.email))) {
    await logAudit(user.email, "IRIS_PASSWORD_CHANGED", "step_up_access", "DENIED", { reason: "rate_limited" });
    return Response.json({ error: "Demasiados intentos. Espera 15 minutos." }, { status: 429 });
  }

  const body = await request.json().catch(() => ({})) as { currentPassword?: string; newPassword?: string; confirmation?: string };
  if (!body.currentPassword || !body.newPassword || body.newPassword !== body.confirmation) {
    return Response.json({ error: "Verifica los campos e intenta de nuevo." }, { status: 400 });
  }

  try {
    await changePassword(user.email, body.currentPassword, body.newPassword);
    await logAudit(user.email, "IRIS_PASSWORD_CHANGED", "step_up_access", "SUCCESS");
    return Response.json({ changed: true });
  } catch (error) {
    await logAudit(user.email, "IRIS_PASSWORD_CHANGED", "step_up_access", "DENIED");
    return Response.json({ error: error instanceof Error ? error.message : "No se pudo cambiar la contraseña." }, { status: 400 });
  }
}
