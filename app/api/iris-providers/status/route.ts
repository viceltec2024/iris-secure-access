import { env } from "cloudflare:workers";
import { getChatGPTUser } from "../../../chatgpt-auth";
import { provisionIrisUser } from "../../../../lib/authz";
import { listProviderStatus, routeIrisVoice } from "../../../../lib/iris-model-router";

export const dynamic = "force-dynamic";

/** Estado de proveedores (solo booleans; nunca expone claves). */
export async function GET() {
  const identity = await getChatGPTUser();
  if (!identity) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const user = await provisionIrisUser(identity);
  if (user.status !== "ACTIVE") return Response.json({ error: "IRIS access is suspended." }, { status: 403 });

  const bindings = env as unknown as Record<string, string | undefined>;
  const providers = listProviderStatus(bindings);
  const voice = routeIrisVoice(bindings);
  return Response.json({
    refreshedAt: new Date().toISOString(),
    providers,
    voice,
    coordination: {
      edit: "muse",
      analysis: "openai",
      speech: voice.provider === "elevenlabs" ? "elevenlabs" : "browser",
      fallback: "local",
    },
  });
}
