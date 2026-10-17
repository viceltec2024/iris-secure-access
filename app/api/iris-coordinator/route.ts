import { env } from "cloudflare:workers";
import { getChatGPTUser } from "../../chatgpt-auth";
import { logAudit, provisionIrisUser } from "../../../lib/authz";
import { buildCoordinatorSnapshot, decideCoordinatorTask } from "../../../lib/iris-coordinator";
import { emptyCreatorDesk, parseCreatorDesk } from "../../../lib/iris-creator";
import { emptyMissionDesk, parseMissionDesk } from "../../../lib/iris-mission";
import { loadOrgDeskValue } from "../../../lib/iris-org-store";
import { probeAllProviders } from "../../../lib/iris-provider-probe";
import { enforceRateLimit } from "../../../lib/rate-limit";
import { requireOrgContext } from "../../../lib/iris-tenant";
import { recordUsageEvent } from "../../../lib/iris-usage";

export const dynamic = "force-dynamic";

async function currentUser() {
  const identity = await getChatGPTUser();
  return identity ? provisionIrisUser(identity) : null;
}

export async function GET() {
  const user = await currentUser();
  if (!user || user.status !== "ACTIVE") return Response.json({ error: "Unauthorized" }, { status: 401 });

  const ctx = await requireOrgContext(user.email);
  const bindings = env as unknown as Record<string, string | undefined>;
  const creatorRaw = await loadOrgDeskValue({ kind: "creator", organizationId: ctx.organization.id, email: user.email });
  const missionRaw = await loadOrgDeskValue({ kind: "mission", organizationId: ctx.organization.id, email: user.email });
  const creator = creatorRaw.value ? parseCreatorDesk(creatorRaw.value) : emptyCreatorDesk();
  const missions = missionRaw.value ? parseMissionDesk(missionRaw.value) : emptyMissionDesk();

  return Response.json({
    organizationId: ctx.organization.id,
    snapshot: buildCoordinatorSnapshot({
      env: bindings,
      creator,
      missions,
      queue: missions.queue,
    }),
    honesty: {
      liveProvidersRequireProbe: true,
      configuredKeyIsNotLiveProof: true,
      isolation: "worker_request_isolate+policy_sandbox",
      claimsContainerOrVm: false,
      multiTenant: true,
    },
  });
}

export async function POST(request: Request) {
  const user = await currentUser();
  if (!user || user.status !== "ACTIVE") return Response.json({ error: "Unauthorized" }, { status: 401 });

  if (!(await enforceRateLimit(`iris-coordinator:${user.email}`, 40, 60 * 1000))) {
    await logAudit(user.email, "IRIS_COORDINATOR", "coordinator", "DENIED", { reason: "rate_limited" });
    return Response.json({ error: "Demasiadas solicitudes al coordinador." }, { status: 429, headers: { "Retry-After": "60" } });
  }

  const body = await request.json().catch(() => ({})) as {
    action?: string;
    question?: string;
    language?: string;
  };
  const bindings = env as unknown as Record<string, string | undefined>;
  const ctx = await requireOrgContext(user.email);

  if (body.action === "route") {
    const question = String(body.question || "").trim();
    if (question.length < 2) return Response.json({ error: "Question required" }, { status: 400 });
    const decision = decideCoordinatorTask({ question, env: bindings });
    await recordUsageEvent({ organizationId: ctx.organization.id, actorEmail: user.email, kind: "request", metadata: { task: decision.task } });
    await logAudit(user.email, "IRIS_COORDINATOR_ROUTE", decision.task, "SUCCESS", {
      provider: decision.route?.provider || null,
      tool: decision.tool?.tool || null,
      allowed: decision.tool?.allowed ?? null,
    }, ctx.organization.id);
    return Response.json({ decision, organizationId: ctx.organization.id });
  }

  if (body.action === "probe_providers") {
    const report = await probeAllProviders(bindings);
    await logAudit(user.email, "IRIS_PROVIDER_PROBE", "providers", "SUCCESS", {
      results: report.providers.map(item => ({ id: item.id, status: item.status, httpStatus: item.httpStatus || null })),
    }, ctx.organization.id);
    return Response.json({ ...report, organizationId: ctx.organization.id });
  }

  return Response.json({ error: "Unknown action" }, { status: 400 });
}
