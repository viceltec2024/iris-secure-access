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
import { enforceRateLimit } from "../../../lib/rate-limit";
import { loadSettingCas, saveSettingCas } from "../../../lib/iris-settings-cas";

export const dynamic = "force-dynamic";

const DESK_KEY = "iris_mission_desk";
const MEMORY_KEY = "iris_memory";

async function currentUser() {
  const identity = await getChatGPTUser();
  return identity ? provisionIrisUser(identity) : null;
}

async function saveDeskCas(email: string, key: string, expectedUpdatedAt: string | null, value: string) {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const saved = await saveSettingCas({
      key,
      value,
      actorEmail: email,
      expectedUpdatedAt: attempt === 0 ? expectedUpdatedAt : (await loadSettingCas(key)).updatedAt,
    });
    if (saved.ok) return;
  }
  throw new Error("concurrent_update");
}

async function appendMissionMemory(email: string, missionId: string, summary: string, language: "es" | "en") {
  const key = `${MEMORY_KEY}:${email}`;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const loaded = await loadSettingCas(key);
    const store = loaded.value ? parseMemoryStore(loaded.value) : emptyMemoryStore();
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
    const saved = await saveSettingCas({
      key,
      value: JSON.stringify(next),
      actorEmail: email,
      expectedUpdatedAt: loaded.updatedAt,
    });
    if (saved.ok) return;
  }
  throw new Error("memory_cas_conflict");
}

async function appendErrorMemory(email: string, missionId: string, error: string, language: "es" | "en") {
  const key = `${MEMORY_KEY}:${email}`;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const loaded = await loadSettingCas(key);
    const store = loaded.value ? parseMemoryStore(loaded.value) : emptyMemoryStore();
    const next = appendMemory(store, recordErrorSolution({
      id: crypto.randomUUID(),
      title: language === "es" ? `Error misión ${missionId.slice(0, 8)}` : `Mission error ${missionId.slice(0, 8)}`,
      error,
      solution: language === "es"
        ? "Reintentar con objetivo más seguro, revisar Guardian, o cancelar la misión. Nunca auto-modificar el núcleo."
        : "Retry with a safer objective, review Guardian, or cancel. Never self-modify core.",
      actorEmail: email,
      sourceId: missionId,
    }));
    const saved = await saveSettingCas({
      key,
      value: JSON.stringify(next),
      actorEmail: email,
      expectedUpdatedAt: loaded.updatedAt,
    });
    if (saved.ok) return;
  }
}

export async function GET() {
  const user = await currentUser();
  if (!user || user.status !== "ACTIVE") return Response.json({ error: "Unauthorized" }, { status: 401 });
  const loaded = await loadSettingCas(`${DESK_KEY}:${user.email}`);
  const desk = loaded.value ? parseMissionDesk(loaded.value) : emptyMissionDesk();
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
  const key = `${DESK_KEY}:${user.email}`;
  const loaded = await loadSettingCas(key);
  const desk = loaded.value ? parseMissionDesk(loaded.value) : emptyMissionDesk();

  try {
    if (body.action === "start" || body.action === "enqueue") {
      const objective = normalizeObjective(body.objective);
      if (!objective) {
        return Response.json({
          error: language === "es" ? "Describe el objetivo en al menos 8 caracteres." : "Describe the objective in at least 8 characters.",
        }, { status: 400 });
      }
      const planned = planAndEnqueueMission({
        id: crypto.randomUUID(),
        objective,
        ownerEmail: user.email,
        language,
        desk,
      });
      const processed = processMissionQueue(planned.desk, language);
      await saveDeskCas(user.email, key, loaded.updatedAt, JSON.stringify(processed.desk));
      const mission = processed.desk.missions.find(item => item.id === planned.mission.id) || planned.mission;
      await appendMissionMemory(user.email, mission.id, mission.result?.summary || mission.status, language);
      if (mission.status === "failed") {
        await appendErrorMemory(user.email, mission.id, mission.result?.summary || "failed", language);
      }
      await logAudit(user.email, "IRIS_MISSION_STARTED", mission.id, "SUCCESS", {
        status: mission.status,
        verified: mission.status === "verified",
        evidencePassed: mission.verification?.passed ?? null,
        specialty: mission.agent?.blueprint.specialty || "",
        jobId: mission.jobId || "",
      });
      return Response.json({ ...processed.desk, started: mission });
    }

    if (body.action === "process") {
      const processed = processMissionQueue(desk, language);
      await saveDeskCas(user.email, key, loaded.updatedAt, JSON.stringify(processed.desk));
      await logAudit(user.email, "IRIS_MISSION_PROCESS", processed.job?.id || "queue", "SUCCESS", {
        processed: Boolean(processed.processed),
        status: processed.processed?.status || "idle",
      });
      return Response.json({ ...processed.desk, processed: processed.processed, job: processed.job });
    }

    if (body.action === "approve" || body.action === "accept") {
      const result = acceptMission(desk, String(body.missionId || ""), user.email);
      await saveDeskCas(user.email, key, loaded.updatedAt, JSON.stringify(result.desk));
      await logAudit(user.email, "IRIS_MISSION_ACCEPTED", result.mission.id, "SUCCESS", {
        appliedToRepo: false,
        selfModifiedCore: false,
        wasVerified: result.mission.verification?.passed ?? false,
      });
      return Response.json({ ...result.desk, approved: result.mission, accepted: result.mission });
    }

    if (body.action === "reject") {
      const result = rejectMission(desk, String(body.missionId || ""));
      await saveDeskCas(user.email, key, loaded.updatedAt, JSON.stringify(result.desk));
      await logAudit(user.email, "IRIS_MISSION_REJECTED", result.mission.id, "SUCCESS", {});
      return Response.json({ ...result.desk, rejected: result.mission });
    }

    if (body.action === "cancel") {
      const result = cancelMission(desk, String(body.missionId || ""), user.email);
      await saveDeskCas(user.email, key, loaded.updatedAt, JSON.stringify(result.desk));
      await logAudit(user.email, "IRIS_MISSION_CANCELLED", result.mission.id, "SUCCESS", {});
      return Response.json({ ...result.desk, cancelled: result.mission });
    }

    return Response.json({ error: "Unknown action" }, { status: 400 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "mission";
    await logAudit(user.email, "IRIS_MISSION_DENIED", String(body.missionId || "mission"), "DENIED", { message, action: body.action });
    return Response.json({ error: message }, { status: 400 });
  }
}
