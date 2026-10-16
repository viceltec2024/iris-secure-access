import { eq } from "drizzle-orm";
import { getChatGPTUser } from "../../chatgpt-auth";
import { getDb } from "../../../db";
import { appSettings } from "../../../db/schema";
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

export const dynamic = "force-dynamic";

const MEMORY_KEY = "iris_memory";

async function currentUser() {
  const identity = await getChatGPTUser();
  return identity ? provisionIrisUser(identity) : null;
}

async function loadMemory(email: string) {
  const key = `${MEMORY_KEY}:${email}`;
  const [row] = await getDb().select().from(appSettings).where(eq(appSettings.key, key)).limit(1);
  return { key, store: row ? parseMemoryStore(row.value) : emptyMemoryStore() };
}

async function saveMemory(email: string, key: string, value: string) {
  const now = new Date().toISOString();
  await getDb().insert(appSettings).values({ key, value, updatedBy: email, updatedAt: now }).onConflictDoUpdate({
    target: appSettings.key,
    set: { value, updatedBy: email, updatedAt: now },
  });
}

export async function GET(request: Request) {
  const user = await currentUser();
  if (!user || user.status !== "ACTIVE") return Response.json({ error: "Unauthorized" }, { status: 401 });
  const language = new URL(request.url).searchParams.get("language") === "en" ? "en" : "es";
  const { store } = await loadMemory(user.email);
  return Response.json({
    scorecard: capabilityScorecard(PRIORITY_CAPABILITIES),
    capabilities: PRIORITY_CAPABILITIES,
    memory: store,
    language,
  });
}

export async function POST(request: Request) {
  const user = await currentUser();
  if (!user || user.status !== "ACTIVE") return Response.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json().catch(() => ({})) as {
    action?: string;
    language?: string;
    lessonId?: string;
  };
  const language = body.language === "en" ? "en" : "es";
  const { key, store } = await loadMemory(user.email);

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
      await saveMemory(user.email, key, JSON.stringify(next));
      await logAudit(user.email, "IRIS_EVAL_RUN", report.id, "SUCCESS", {
        passRate: report.summary.passRate,
        failed: report.summary.failed,
      });
      return Response.json({
        report,
        scorecard: capabilityScorecard(PRIORITY_CAPABILITIES),
        memory: next,
      });
    }

    if (body.action === "approve_lesson" || body.action === "reject_lesson") {
      const decision = body.action === "approve_lesson" ? "approve" : "reject";
      const result = decideLessonPromotion(store, String(body.lessonId || ""), decision, user.email);
      await saveMemory(user.email, key, JSON.stringify(result.store));
      await logAudit(user.email, decision === "approve" ? "IRIS_LESSON_APPROVED" : "IRIS_LESSON_REJECTED", result.record.id, "SUCCESS", {
        sourceId: result.record.sourceId || "",
      });
      return Response.json({ memory: result.store, lesson: result.record, scorecard: capabilityScorecard() });
    }

    return Response.json({ error: "Unknown action" }, { status: 400 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "evals";
    await logAudit(user.email, "IRIS_EVAL_DENIED", "evals", "DENIED", { message, action: body.action });
    return Response.json({ error: message }, { status: 400 });
  }
}
