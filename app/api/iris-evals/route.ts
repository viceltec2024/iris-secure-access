import { getChatGPTUser } from "../../chatgpt-auth";
import { logAudit, provisionIrisUser } from "../../../lib/authz";
import { PRIORITY_CAPABILITIES, capabilityScorecard } from "../../../lib/iris-capability-audit";
import { runIrisEvaluationSuite } from "../../../lib/iris-evals";
import {
  appendMemory,
  buildLessonFromEval,
  decideLessonPromotion,
  emptyMemoryStore,
  parseMemoryStore,
} from "../../../lib/iris-memory";
import { loadOrgDeskValue, saveOrgDeskValue } from "../../../lib/iris-org-store";
import { readOrgObsSummary, recordOrgObs } from "../../../lib/iris-obs-store";
import { enforceRateLimit } from "../../../lib/rate-limit";
import { requireOrgContext } from "../../../lib/iris-tenant";

export const dynamic = "force-dynamic";

async function currentUser() {
  const identity = await getChatGPTUser();
  return identity ? provisionIrisUser(identity) : null;
}

export async function GET(request: Request) {
  const user = await currentUser();
  if (!user || user.status !== "ACTIVE") return Response.json({ error: "Unauthorized" }, { status: 401 });
  const language = new URL(request.url).searchParams.get("language") === "en" ? "en" : "es";
  const ctx = await requireOrgContext(user.email);
  const loaded = await loadOrgDeskValue({ kind: "memory", organizationId: ctx.organization.id, email: user.email });
  const store = loaded.value ? parseMemoryStore(loaded.value) : emptyMemoryStore();
  const obs = await readOrgObsSummary(ctx.organization.id);
  return Response.json({
    scorecard: capabilityScorecard(PRIORITY_CAPABILITIES),
    capabilities: PRIORITY_CAPABILITIES,
    memory: store,
    observability: obs.summary,
    language,
    organizationId: ctx.organization.id,
  });
}

export async function POST(request: Request) {
  const user = await currentUser();
  if (!user || user.status !== "ACTIVE") return Response.json({ error: "Unauthorized" }, { status: 401 });

  if (!(await enforceRateLimit(`iris-evals:${user.email}`, 20, 60 * 1000))) {
    await logAudit(user.email, "IRIS_EVALS", "evals", "DENIED", { reason: "rate_limited" });
    return Response.json({ error: "Demasiadas evaluaciones. Espera un momento." }, { status: 429, headers: { "Retry-After": "60" } });
  }

  const body = await request.json().catch(() => ({})) as {
    action?: string;
    language?: string;
    lessonId?: string;
  };
  const language = body.language === "en" ? "en" : "es";
  const ctx = await requireOrgContext(user.email, { mutate: true });
  const orgId = ctx.organization.id;
  const loaded = await loadOrgDeskValue({ kind: "memory", organizationId: orgId, email: user.email });
  const store = loaded.value ? parseMemoryStore(loaded.value) : emptyMemoryStore();

  try {
    if (body.action === "run") {
      const report = runIrisEvaluationSuite({
        id: crypto.randomUUID(),
        language,
      });
      let next = appendMemory(store, {
        id: crypto.randomUUID(),
        kind: "eval_result",
        title: language === "es" ? `Eval ${report.summary.passRate}%` : `Eval ${report.summary.passRate}%`,
        body: JSON.stringify({
          summary: report.summary,
          failed: report.cases.filter(item => item.status === "fail").map(item => item.id),
        }),
        score: report.summary.passRate,
        tags: ["eval", "suite"],
        createdAt: report.ranAt,
        createdBy: user.email,
        promotion: "none",
        sourceId: report.id,
      });
      if (report.summary.failed > 0) {
        next = appendMemory(next, buildLessonFromEval({
          id: crypto.randomUUID(),
          evalId: report.id,
          title: language === "es" ? "Lección: reforzar casos fallidos" : "Lesson: reinforce failed cases",
          body: language === "es"
            ? `Fallaron ${report.summary.failed} casos. Revisar Guardian/sandbox antes de ampliar autonomía.`
            : `${report.summary.failed} cases failed. Review Guardian/sandbox before expanding autonomy.`,
          score: report.summary.passRate,
          actorEmail: user.email,
          now: report.ranAt,
        }));
      }
      await saveOrgDeskValue({
        kind: "memory",
        organizationId: orgId,
        email: user.email,
        expectedUpdatedAt: loaded.updatedAt,
        value: JSON.stringify(next),
      });
      await logAudit(user.email, "IRIS_EVAL_RUN", report.id, "SUCCESS", {
        passRate: report.summary.passRate,
        failed: report.summary.failed,
      }, orgId);
      await recordOrgObs({
        organizationId: orgId,
        actorEmail: user.email,
        kind: "eval_run",
        value: report.summary.passRate,
        label: report.id,
      }).catch(() => null);
      return Response.json({
        report,
        scorecard: capabilityScorecard(PRIORITY_CAPABILITIES),
        memory: next,
        organizationId: orgId,
      });
    }

    if (body.action === "approve_lesson" || body.action === "reject_lesson") {
      const decision = body.action === "approve_lesson" ? "approve" : "reject";
      const result = decideLessonPromotion(store, String(body.lessonId || ""), decision, user.email);
      await saveOrgDeskValue({
        kind: "memory",
        organizationId: orgId,
        email: user.email,
        expectedUpdatedAt: loaded.updatedAt,
        value: JSON.stringify(result.store),
      });
      await logAudit(user.email, decision === "approve" ? "IRIS_LESSON_APPROVED" : "IRIS_LESSON_REJECTED", result.record.id, "SUCCESS", {
        sourceId: result.record.sourceId || "",
      }, orgId);
      return Response.json({ memory: result.store, lesson: result.record, scorecard: capabilityScorecard(), organizationId: orgId });
    }

    return Response.json({ error: "Unknown action" }, { status: 400 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "evals";
    await logAudit(user.email, "IRIS_EVAL_DENIED", "evals", "DENIED", { message, action: body.action }, orgId);
    return Response.json({ error: message }, { status: 400 });
  }
}
