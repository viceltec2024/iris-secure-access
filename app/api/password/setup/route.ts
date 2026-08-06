import { getChatGPTUser } from "../../../chatgpt-auth";
import { logAudit, provisionIrisUser } from "../../../../lib/authz";
import { issueBiometricSession } from "../../../../lib/passkeys";
import { createPassword } from "../../../../lib/passwords";

export async function POST(request: Request) {
  const identity = await getChatGPTUser();
  if (!identity) return Response.json({ error: "Authentication required" }, { status: 401 });
  const user = await provisionIrisUser(identity);
  const body = await request.json().catch(() => ({})) as { password?: string; confirmation?: string };
  if (!body.password || body.password !== body.confirmation) return Response.json({ error: "Las contraseñas no coinciden." }, { status: 400 });
  try {
    await createPassword(user.email, body.password);
    await issueBiometricSession(user.email);
    await logAudit(user.email, "IRIS_PASSWORD_CREATED", "step_up_access", "SUCCESS");
    return Response.json({ configured: true });
  } catch (error) {
    await logAudit(user.email, "IRIS_PASSWORD_CREATED", "step_up_access", "DENIED");
    return Response.json({ error: error instanceof Error ? error.message : "No se pudo crear la contraseña." }, { status: 400 });
  }
}
