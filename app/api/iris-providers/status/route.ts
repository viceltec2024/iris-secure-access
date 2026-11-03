import { env } from "cloudflare:workers";
import { getChatGPTUser } from "../../../chatgpt-auth";
import { provisionIrisUser } from "../../../../lib/authz";
import { listProviderStatus, routeIrisVoice } from "../../../../lib/iris-model-router";
import { probeAllProviders } from "../../../../lib/iris-provider-probe";
import { enforceRateLimit } from "../../../../lib/rate-limit";
import { requireOrgContext } from "../../../../lib/iris-tenant";
import { recordOrgObs } from "../../../../lib/iris-obs-store";

export const dynamic = "force-dynamic";

/** Estado de proveedores. `?probe=1` ejecuta sondas honestas (key ≠ live). */
export async function GET(request: Request) {
  const identity = await getChatGPTUser();
  if (!identity) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const user = await provisionIrisUser(identity);
  if (user.status !== "ACTIVE") return Response.json({ error: "IRIS access is suspended." }, { status: 403 });

  const bindings = env as unknown as Record<string, string | undefined>;
  const providers = listProviderStatus(bindings);
  const voice = routeIrisVoice(bindings);
  const wantProbe = new URL(request.url).searchParams.get("probe") === "1";
  let probes = null as Awaited<ReturnType<typeof probeAllProviders>> | null;
  if (wantProbe) {
    // A probe triggers real outbound calls with provider keys on every
    // request, so it is rate-limited per user even though the plain
    // status read is not: 10 probes/min, then 429.
    if (!(await enforceRateLimit(`iris-providers-probe:${user.email}`, 10, 60 * 1000))) {
      return Response.json({ error: "Rate limit exceeded. Try again in a minute." }, { status: 429 });
    }
    probes = await probeAllProviders(bindings);
    try {
      const ctx = await requireOrgContext(user.email);
      await recordOrgObs({
        organizationId: ctx.organization.id,
        actorEmail: user.email,
        kind: "provider_probe",
        value: probes.providers.filter(item => item.status === "live_ok" || item.status === "local_ready").length,
        label: "status_probe",
      });
    } catch {
      // org optional for probe snapshot
    }
  }

  const probeSummary = probes
    ? {
      liveVerified: probes.providers.filter(item => item.status === "live_ok").map(item => item.id),
      configuredOnly: probes.providers.filter(item => item.configured && item.status !== "live_ok").map(item => item.id),
      notConfigured: probes.providers.filter(item => !item.configured).map(item => item.id),
      // liveVerified means a real HTTP probe succeeded; configuredOnly means
      // a key is present but no live call has proven the integration.
      providers: probes.providers.map(item => ({
        id: item.id,
        configured: item.configured,
        liveVerified: item.status === "live_ok",
        status: item.status,
        httpStatus: item.httpStatus ?? null,
        detail: item.detail,
      })),
    }
    : null;

  return Response.json({
    refreshedAt: new Date().toISOString(),
    providers,
    voice,
    probes,
    probeSummary,
    honesty: {
      configuredIsNotLive: true,
      note: "Una clave configurada no prueba integración live. Usa probe=1 o POST /api/iris-coordinator probe_providers. Solo liveVerified=true (HTTP real OK) significa probado en vivo.",
    },
    coordination: {
      edit: "muse",
      analysis: "openai",
      speech: voice.provider === "elevenlabs" ? "elevenlabs" : "browser",
      fallback: "local",
    },
  });
}
