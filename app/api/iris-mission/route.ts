import { eq } from "drizzle-orm";
import { getChatGPTUser } from "../../chatgpt-auth";
import { getDb } from "../../../db";
import { appSettings } from "../../../db/schema";
import { logAudit, provisionIrisUser } from "../../../lib/authz";
import {
  addMission,
  approveMission,
  emptyMissionDesk,
  normalizeObjective,
  parseMissionDesk,
  rejectMission,
  runMission,
} from "../../../lib/iris-mission";
import { appendMemory, emptyMemoryStore, parseMemoryStore } from "../../../lib/iris-memory";
import { enforceRateLimit } from "../../../lib/rate-limit";

export const dynamic = "force-dynamic";

const DESK_KEY = "iris_mission_desk";
const MEMORY_KEY = "iris_memory";

async function currentUser() {
  const identity = await getChatGPTUser();
  return identity ? provisionIrisUser(identity) : null;
}

async function loadDesk(email: string) {
  const key = `${DESK_KEY}:${email}`;
  const [row] = await getDb().select().from(appSettings).where(eq(appSettings.key, key)).limit(1);
  return { key, desk: row ? parseMissionDesk(row.value) : emptyMissionDesk() };
}

async function saveDesk(email: string, key: string, value: string) {
  const now = new Date().toISOString();
  await getDb().insert(appSettings).values({ key, value, updatedBy: email, updatedAt: now }).onConflictDoUpdate({
    target: appSettings.key,
    set: { value, updatedBy: email, updatedAt: now },
  });
}

async function appendMissionMemory(email: string, missionId: string, summary: string, language: "es" | "en") {
  const key = `${MEMORY_KEY}:${email}`;
  const [row] = await getDb().select().from(appSettings).where(eq(appSettings.key, key)).limit(1);
  const store = row ? parseMemoryStore(row.value) : emptyMemoryStore();
  const next = appendMemory(store, {
    id: crypto.randomUUID(),
    kind: "mission_result",
    title: language === "es" ? `Misión ${missionId.slice(0, 8)}` : `Mission ${missionId.slice(0, 8)}`,
    body: summary.slice(0, 4000),
    tags: ["mission"],
    createdAt: new Date().toISOString(),
    createdBy: email,
    promotion: "none",
    sourceId: missionId,
  });
  const now = new Date().toISOString();
  const value = JSON.stringify(next);
  await getDb().insert(appSettings).values({ key, value, updatedBy: email, updatedAt: now }).onConflictDoUpdate({
    target: appSettings.key,
    set: { value, updatedBy: email, updatedAt: now },
  });
}

export async function GET() {
  const user = await currentUser();
  if (!user || user.status !== "ACTIVE") return Response.json({ error: "Unauthorized" }, { status: 401 });
  const { desk } = await loadDesk(user.email);
  return Response.json(desk);
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
  const { key, desk } = await loadDesk(user.email);

  try {
    if (body.action === "start") {
      const objective = normalizeObjective(body.objective);
      if (!objective) {
        return Response.json({
          error: language === "es" ? "Describe el objetivo en al menos 8 caracteres." : "Describe the objective in at least 8 characters.",
        }, { status: 400 });
      }
      const mission = runMission({
        id: crypto.randomUUID(),
        objective,
        language,
      });
      const next = addMission(desk, mission);
      await saveDesk(user.email, key, JSON.stringify(next));
      await appendMissionMemory(user.email, mission.id, mission.result?.summary || mission.status, language);
      await logAudit(user.email, "IRIS_MISSION_STARTED", mission.id, "SUCCESS", {
        status: mission.status,
        specialty: mission.agent?.blueprint.specialty || "",
      });
      return Response.json({ ...next, started: mission });
    }

    if (body.action === "approve") {
      const result = approveMission(desk, String(body.missionId || ""), user.email);
      await saveDesk(user.email, key, JSON.stringify(result.desk));
      await logAudit(user.email, "IRIS_MISSION_APPROVED", result.mission.id, "SUCCESS", {
        appliedToRepo: false,
        selfModifiedCore: false,
      });
      return Response.json({ ...result.desk, approved: result.mission });
    }

    if (body.action === "reject") {
      const result = rejectMission(desk, String(body.missionId || ""));
      await saveDesk(user.email, key, JSON.stringify(result.desk));
      await logAudit(user.email, "IRIS_MISSION_REJECTED", result.mission.id, "SUCCESS", {});
      return Response.json({ ...result.desk, rejected: result.mission });
    }

    return Response.json({ error: "Unknown action" }, { status: 400 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "mission";
    await logAudit(user.email, "IRIS_MISSION_DENIED", String(body.missionId || "mission"), "DENIED", { message, action: body.action });
    return Response.json({ error: message }, { status: 400 });
  }
}
