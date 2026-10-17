import { getChatGPTUser } from "../../chatgpt-auth";
import { logAudit, provisionIrisUser } from "../../../lib/authz";
import {
  acceptMission,
  cancelMission,
  emptyMissionDesk,
  normalizeObjective,
  parseMissionDesk,
  planAndEnqueueMission,
  processMissionQueue,
  rejectMission,
} from "../../../lib/iris-mission";
import { appendMemory, emptyMemoryStore, parseMemoryStore, recordErrorSolution } from "../../../lib/iris-memory";
import { loadOrgDeskValue, saveOrgDeskValue } from "../../../lib/iris-org-store";
import type { IrisPlanId } from "../../../lib/iris-plans";
import { enforceRateLimit } from "../../../lib/rate-limit";
import { requireOrgContext } from "../../../lib/iris-tenant";
import { assertOrgWithinLimits, recordUsageEvent } from "../../../lib/iris-usage";

export const dynamic = "force-dynamic";

async function currentUser() {
  const identity = await getChatGPTUser();
  return identity ? provisionIrisUser(identity) : null;
}

async function appendOrgMemory(input: {
  organizationId: string;
  email: string;
  missionId: string;
  summary: string;
  language: "es" | "en";
  kind?: "mission_result" | "error";
  error?: string;
}) {
  const loaded = await loadOrgDeskValue({ kind: "memory", organizationId: input.organizationId, email: input.email });
  const store = loaded.value ? parseMemoryStore(loaded.value) : emptyMemoryStore();
  const record = input.kind === "error"
    ? recordErrorSolution({
      id: crypto.randomUUID(),
      title: input.language === "es" ? `Error misión ${input.missionId.slice(0, 8)}` : `Mission error ${input.missionId.slice(0, 8)}`,
      error: input.error || input.summary,
      solution: input.language === "es"
        ? "Reintentar con objetivo más seguro o cancelar. Nunca auto-modificar el núcleo."
        : "Retry with a safer objective or cancel. Never self-modify core.",
      actorEmail: input.email,
      sourceId: input.missionId,
    })
    : {
      id: crypto.randomUUID(),
      kind: "mission_result" as const,
      title: input.language === "es" ? `Misión ${input.missionId.slice(0, 8)}` : `Mission ${input.missionId.slice(0, 8)}`,
      body: input.summary.slice(0, 4000),
      tags: ["mission"],
      createdAt: new Date().toISOString(),
      createdBy: input.email,
      promotion: "none" as const,
      sourceId: input.missionId,
    };
  const next = appendMemory(store, record);
  await saveOrgDeskValue({
    kind: "memory",
    organizationId: input.organizationId,
    email: input.email,
    expectedUpdatedAt: loaded.updatedAt,
    value: JSON.stringify(next),
  });
}

export async function GET() {
  const user = await currentUser();
  if (!user || user.status !== "ACTIVE") return Response.json({ error: "Unauthorized" }, { status: 401 });
  const ctx = await requireOrgContext(user.email);
  const loaded = await loadOrgDeskValue({ kind: "mission", organizationId: ctx.organization.id, email: user.email });
  const desk = loaded.value ? parseMissionDesk(loaded.value) : emptyMissionDesk();
  return Response.json({ ...desk, organizationId: ctx.organization.id });
}

export async function POST(request: Request) {
  const user = await currentUser();
  if (!user || user.status !== "ACTIVE") return Response.json({ error: "Unauthorized" }, { status: 401 });

  if (!(await enforceRateLimit(`iris-mission:${user.email}`, 30, 60 * 1000))) {
    await logAudit(user.email, "IRIS_MISSION", "mission", "DENIED", { reason: "rate_limited" });
    return Response.json({ error: "Demasiadas misiones. Espera un momento." }, { status: 429, headers: { "Retry-After": "60" } });
  }

  const body = await request.json().catch(() => ({})) as {
    action?: string;
    objective?: string;
    language?: string;
    missionId?: string;
  };
  const language = body.language === "en" ? "en" : "es";
  const ctx = await requireOrgContext(user.email, { mutate: true });
  const orgId = ctx.organization.id;
  const loaded = await loadOrgDeskValue({ kind: "mission", organizationId: orgId, email: user.email });
  const desk = loaded.value ? parseMissionDesk(loaded.value) : emptyMissionDesk();

  async function persist(nextDesk: typeof desk) {
    await saveOrgDeskValue({
      kind: "mission",
      organizationId: orgId,
      email: user.email,
      expectedUpdatedAt: loaded.updatedAt,
      value: JSON.stringify(nextDesk),
    });
  }

  try {
    if (body.action === "start" || body.action === "enqueue") {
      const objective = normalizeObjective(body.objective);
      if (!objective) {
        return Response.json({
          error: language === "es" ? "Describe el objetivo en al menos 8 caracteres." : "Describe the objective in at least 8 characters.",
        }, { status: 400 });
      }
      const limit = await assertOrgWithinLimits({
        organizationId: orgId,
        plan: ctx.organization.plan as IrisPlanId,
        orgStatus: ctx.organization.status,
        budgetCentsMonthly: ctx.organization.budgetCentsMonthly,
        action: "mission",
      });
      if (!limit.allowed) {
        await logAudit(user.email, "IRIS_MISSION", orgId, "DENIED", { reason: limit.code }, orgId);
        return Response.json({ error: limit.detail, code: limit.code }, { status: 402 });
      }
      const planned = planAndEnqueueMission({
        id: crypto.randomUUID(),
        objective,
        ownerEmail: user.email,
        language,
        desk,
      });
      const processed = processMissionQueue(planned.desk, language);
      await persist(processed.desk);
      const mission = processed.desk.missions.find(item => item.id === planned.mission.id) || planned.mission;
      await appendOrgMemory({
        organizationId: orgId,
        email: user.email,
        missionId: mission.id,
        summary: mission.result?.summary || mission.status,
        language,
      });
      if (mission.status === "failed") {
        await appendOrgMemory({
          organizationId: orgId,
          email: user.email,
          missionId: mission.id,
          summary: mission.result?.summary || "failed",
          language,
          kind: "error",
          error: mission.result?.summary || "failed",
        });
      }
      await recordUsageEvent({
        organizationId: orgId,
        actorEmail: user.email,
        kind: "mission",
        metadata: { missionId: mission.id, status: mission.status },
      });
      await logAudit(user.email, "IRIS_MISSION_STARTED", mission.id, "SUCCESS", {
        status: mission.status,
        verified: mission.status === "verified",
        organizationId: orgId,
      }, orgId);
      return Response.json({ ...processed.desk, started: mission, organizationId: orgId });
    }

    if (body.action === "process") {
      const processed = processMissionQueue(desk, language);
      await persist(processed.desk);
      await logAudit(user.email, "IRIS_MISSION_PROCESS", processed.job?.id || "queue", "SUCCESS", {
        processed: Boolean(processed.processed),
        status: processed.processed?.status || "idle",
      }, orgId);
      return Response.json({ ...processed.desk, processed: processed.processed, job: processed.job, organizationId: orgId });
    }

    if (body.action === "approve" || body.action === "accept") {
      const result = acceptMission(desk, String(body.missionId || ""), user.email);
      await persist(result.desk);
      await logAudit(user.email, "IRIS_MISSION_ACCEPTED", result.mission.id, "SUCCESS", {
        appliedToRepo: false,
        wasVerified: result.mission.verification?.passed ?? false,
      }, orgId);
      return Response.json({ ...result.desk, approved: result.mission, accepted: result.mission, organizationId: orgId });
    }

    if (body.action === "reject") {
      const result = rejectMission(desk, String(body.missionId || ""));
      await persist(result.desk);
      await logAudit(user.email, "IRIS_MISSION_REJECTED", result.mission.id, "SUCCESS", {}, orgId);
      return Response.json({ ...result.desk, rejected: result.mission, organizationId: orgId });
    }

    if (body.action === "cancel") {
      const result = cancelMission(desk, String(body.missionId || ""), user.email);
      await persist(result.desk);
      await logAudit(user.email, "IRIS_MISSION_CANCELLED", result.mission.id, "SUCCESS", {}, orgId);
      return Response.json({ ...result.desk, cancelled: result.mission, organizationId: orgId });
    }

    return Response.json({ error: "Unknown action" }, { status: 400 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "mission";
    await logAudit(user.email, "IRIS_MISSION_DENIED", String(body.missionId || "mission"), "DENIED", { message, action: body.action }, orgId);
    return Response.json({ error: message }, { status: 400 });
  }
}
