import { headers } from "next/headers";
import { chatGPTSignOutPath } from "../chatgpt-auth";
import { endBiometricSession } from "../../lib/passkeys";

export const dynamic = "force-dynamic";

/**
 * Cierra la sesión de IRIS (contraseña o passkey) y, si se entró con
 * ChatGPT, también la de ChatGPT.
 */
export async function GET(request: Request) {
  await endBiometricSession();
  const viaChatGPT = Boolean((await headers()).get("oai-authenticated-user-email"));
  const target = viaChatGPT ? chatGPTSignOutPath("/iniciar-sesion") : "/iniciar-sesion";
  return Response.redirect(new URL(target, request.url), 303);
}
