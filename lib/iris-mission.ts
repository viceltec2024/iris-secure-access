/**
 * Mission loop: objective → plan → specialized agent → isolated sandbox → verifiable report.
 * Completion beyond sandbox always requires human approval. Never mutates IRIS core.
 */

import {
  designAgentFromPrompt,
  type CreatedAgent,
} from "./iris-creator.ts";
import { runIsolatedAgentSandbox, type IsolatedRunResult } from "./iris-sandbox-runner.ts";

export const MISSION_STATUSES = [
  "draft",
  "planned",
  "sandbox_running",
  "awaiting_approval",
  "completed",
  "failed",
  "rejected",
] as const;

export type MissionStatus = (typeof MISSION_STATUSES)[number];

export type MissionStep = {
  id: string;
  title: string;
  status: "pending" | "done" | "failed" | "blocked";
  detail: string;
};

export type MissionRecord = {
  id: string;
  objective: string;
  status: MissionStatus;
  language: "es" | "en";
  steps: MissionStep[];
  agent: CreatedAgent | null;
  sandbox: IsolatedRunResult | null;
  result: {
    summary: string;
    evidence: string[];
    verifiable: boolean;
    appliedToRepo: false;
    selfModifiedCore: false;
  } | null;
  createdAt: string;
  updatedAt: string;
  approvedAt?: string;
  approvedBy?: string;
};

export type MissionDesk = {
  missions: MissionRecord[];
};

const MAX_MISSIONS = 40;
const MAX_OBJECTIVE = 500;

export function emptyMissionDesk(): MissionDesk {
  return { missions: [] };
}

export function parseMissionDesk(value: string): MissionDesk {
  try {
    const parsed = JSON.parse(value) as Partial<MissionDesk>;
    return {
      missions: Array.isArray(parsed.missions)
        ? parsed.missions.filter(item => item && typeof item === "object" && typeof (item as MissionRecord).id === "string") as MissionRecord[]
        : [],
    };
  } catch {
    return emptyMissionDesk();
  }
}

export function normalizeObjective(value: unknown) {
  const objective = String(value || "").trim().replace(/\s+/g, " ");
  if (objective.length < 8 || objective.length > MAX_OBJECTIVE) return null;
  return objective;
}

export function buildMissionPlan(objective: string, language: "es" | "en" = "es"): MissionStep[] {
  const titles = language === "es"
    ? [
      ["parse", "Interpretar objetivo", `Objetivo recibido: ${objective.slice(0, 160)}`],
      ["plan", "Planificar pasos verificables", "Definir diseño, sandbox y puerta humana"],
      ["design", "Crear agente especializado", "IRIS Creator genera spec supervisado"],
      ["sandbox", "Ejecutar pruebas aisladas", "Sin shell, sin escritura al repo"],
      ["human", "Esperar aprobación humana", "Ningún cambio importante sin OK"],
      ["report", "Entregar resultado verificable", "Evidencia + appliedToRepo=false"],
    ]
    : [
      ["parse", "Parse objective", `Received: ${objective.slice(0, 160)}`],
      ["plan", "Plan verifiable steps", "Design, sandbox, and human gate"],
      ["design", "Create specialized agent", "IRIS Creator builds supervised spec"],
      ["sandbox", "Run isolated tests", "No shell, no repo writes"],
      ["human", "Await human approval", "No important change without OK"],
      ["report", "Deliver verifiable result", "Evidence + appliedToRepo=false"],
    ];
  return titles.map(([id, title, detail]) => ({
    id,
    title,
    status: "pending" as const,
    detail,
  }));
}

function markSteps(steps: MissionStep[], doneIds: string[], failedId?: string): MissionStep[] {
  return steps.map(step => {
    if (failedId && step.id === failedId) return { ...step, status: "failed" };
    if (doneIds.includes(step.id)) return { ...step, status: "done" };
    if (failedId) return step.status === "done" ? step : { ...step, status: "blocked" };
    return step;
  });
}

export function runMission(input: {
  id: string;
  objective: string;
  language?: "es" | "en";
  now?: string;
}): MissionRecord {
  const language = input.language || "es";
  const objective = normalizeObjective(input.objective);
  if (!objective) {
    throw new Error(language === "es" ? "Describe el objetivo en al menos 8 caracteres." : "Describe the objective in at least 8 characters.");
  }
  const now = input.now || new Date().toISOString();
  let steps = buildMissionPlan(objective, language);
  steps = markSteps(steps, ["parse", "plan"]);

  const agent = designAgentFromPrompt({
    id: `${input.id}-agent`,
    prompt: language === "es"
      ? `Crea una inteligencia artificial especializada en: ${objective}`
      : `Create an AI specialized in: ${objective}`,
    language,
    now,
  });
  steps = markSteps(steps, ["parse", "plan", "design"]);

  const sandbox = runIsolatedAgentSandbox(agent, language);
  if (!sandbox.ok || !agent.sandbox.passed || agent.status === "sandbox_failed") {
    steps = markSteps(steps, ["parse", "plan", "design"], "sandbox");
    return {
      id: input.id,
      objective,
      status: "failed",
      language,
      steps,
      agent,
      sandbox,
      result: {
        summary: language === "es"
          ? "La misión falló en sandbox/Guardian. No se aplicó nada al sistema."
          : "Mission failed in sandbox/Guardian. Nothing was applied to the system.",
        evidence: [
          `agent_status=${agent.status}`,
          `sandbox_ok=${sandbox.ok}`,
          ...sandbox.errors.map(error => `error=${error}`),
        ],
        verifiable: true,
        appliedToRepo: false,
        selfModifiedCore: false,
      },
      createdAt: now,
      updatedAt: now,
    };
  }

  steps = markSteps(steps, ["parse", "plan", "design", "sandbox", "human"]);
  return {
    id: input.id,
    objective,
    status: "awaiting_approval",
    language,
    steps,
    agent,
    sandbox,
    result: {
      summary: language === "es"
        ? `Plan y sandbox OK para “${agent.blueprint.specialty}”. Esperando tu aprobación para marcar la misión completa. IRIS no escribió en el repo.`
        : `Plan and sandbox OK for “${agent.blueprint.specialty}”. Waiting for your approval to complete the mission. IRIS did not write to the repo.`,
      evidence: [
        `specialty=${agent.blueprint.specialty}`,
        `sandbox_checks=${sandbox.checks.filter(check => check.ok).length}/${sandbox.checks.length}`,
        `duration_ms=${sandbox.durationMs}`,
        "appliedToRepo=false",
        "selfModifiedCore=false",
      ],
      verifiable: true,
      appliedToRepo: false,
      selfModifiedCore: false,
    },
    createdAt: now,
    updatedAt: now,
  };
}

export function approveMission(desk: MissionDesk, missionId: string, actorEmail: string, now = new Date().toISOString()) {
  const mission = desk.missions.find(item => item.id === missionId);
  if (!mission) throw new Error("Mission not found");
  if (mission.status !== "awaiting_approval") throw new Error("Mission is not awaiting approval");
  const steps = markSteps(mission.steps, ["parse", "plan", "design", "sandbox", "human", "report"]);
  const next: MissionRecord = {
    ...mission,
    status: "completed",
    steps,
    approvedAt: now,
    approvedBy: actorEmail,
    updatedAt: now,
    result: mission.result
      ? {
        ...mission.result,
        summary: `${mission.result.summary} · approved_by=${actorEmail}`,
        appliedToRepo: false,
        selfModifiedCore: false,
      }
      : null,
  };
  return {
    desk: { missions: desk.missions.map(item => item.id === missionId ? next : item) },
    mission: next,
  };
}

export function rejectMission(desk: MissionDesk, missionId: string, now = new Date().toISOString()) {
  const mission = desk.missions.find(item => item.id === missionId);
  if (!mission) throw new Error("Mission not found");
  if (mission.status !== "awaiting_approval") throw new Error("Mission is not awaiting approval");
  const next: MissionRecord = {
    ...mission,
    status: "rejected",
    updatedAt: now,
    result: mission.result
      ? { ...mission.result, summary: `${mission.result.summary} · rejected`, appliedToRepo: false, selfModifiedCore: false }
      : null,
  };
  return {
    desk: { missions: desk.missions.map(item => item.id === missionId ? next : item) },
    mission: next,
  };
}

export function addMission(desk: MissionDesk, mission: MissionRecord): MissionDesk {
  return { missions: [mission, ...desk.missions].slice(0, MAX_MISSIONS) };
}
