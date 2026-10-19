import { env } from "cloudflare:workers";
import { getChatGPTUser } from "../../../chatgpt-auth";
import { provisionIrisUser } from "../../../../lib/authz";
import { listProviderStatus, routeIrisVoice } from "../../../../lib/iris-model-router";
import { providerCatalogPublic } from "../../../../lib/iris-provider-catalog";
import { assertNoSecretsInPayload } from "../../../../lib/iris-secret-hygiene";

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
  const payload = {
    refreshedAt: new Date().toISOString(),
    note: "configured_untested ≠ live_ok. Use POST /api/iris-coordinator action=probe_providers for HTTP proof.",
    catalog: providerCatalogPublic(),
    providers,
    voice,
    coordination: {
      edit: "muse",
      analysis: "openai",
      speech: voice.provider === "elevenlabs" ? "elevenlabs" : "browser",
      fallback: "local",
    },
  };
  assertNoSecretsInPayload(payload, "providers-status");
  return Response.json(payload);
}
