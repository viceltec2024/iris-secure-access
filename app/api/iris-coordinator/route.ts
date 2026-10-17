import { eq } from "drizzle-orm";
import { env } from "cloudflare:workers";
import { getChatGPTUser } from "../../chatgpt-auth";
import { getDb } from "../../../db";
import { appSettings } from "../../../db/schema";
import { logAudit, provisionIrisUser } from "../../../lib/authz";
import { buildCoordinatorSnapshot, decideCoordinatorTask } from "../../../lib/iris-coordinator";
import { emptyCreatorDesk, parseCreatorDesk } from "../../../lib/iris-creator";
import { emptyMissionDesk, parseMissionDesk } from "../../../lib/iris-mission";
import { probeAllProviders } from "../../../lib/iris-provider-probe";
import { enforceRateLimit } from "../../../lib/rate-limit";

export const dynamic = "force-dynamic";

const CREATOR_KEY = "iris_creator_desk";
const MISSION_KEY = "iris_mission_desk";

async function currentUser() {
  const identity = await getChatGPTUser();
  return identity ? provisionIrisUser(identity) : null;
}

async function loadJson(key: string) {
  const [row] = await getDb().select().from(appSettings).where(eq(appSettings.key, key)).limit(1);
  return row?.value || "";
}

export async function GET() {
  const user = await currentUser();
  if (!user || user.status !== "ACTIVE") return Response.json({ error: "Unauthorized" }, { status: 401 });

  const bindings = env as unknown as Record<string, string | undefined>;
  const creatorRaw = await loadJson(`${CREATOR_KEY}:${user.email}`);
  const missionRaw = await loadJson(`${MISSION_KEY}:${user.email}`);
  const creator = creatorRaw ? parseCreatorDesk(creatorRaw) : emptyCreatorDesk();
  const missions = missionRaw ? parseMissionDesk(missionRaw) : emptyMissionDesk();

  return Response.json({
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

  if (body.action === "route") {
    const question = String(body.question || "").trim();
    if (question.length < 2) return Response.json({ error: "Question required" }, { status: 400 });
    const decision = decideCoordinatorTask({ question, env: bindings });
    await logAudit(user.email, "IRIS_COORDINATOR_ROUTE", decision.task, "SUCCESS", {
      provider: decision.route?.provider || null,
      tool: decision.tool?.tool || null,
      allowed: decision.tool?.allowed ?? null,
    });
    return Response.json({ decision });
  }

  if (body.action === "probe_providers") {
    const report = await probeAllProviders(bindings);
    await logAudit(user.email, "IRIS_PROVIDER_PROBE", "providers", "SUCCESS", {
      results: report.providers.map(item => ({ id: item.id, status: item.status, httpStatus: item.httpStatus || null })),
    });
    return Response.json(report);
  }

  return Response.json({ error: "Unknown action" }, { status: 400 });
}
