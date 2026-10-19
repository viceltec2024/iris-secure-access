/**
 * Mission engine: objective → plan → queue → execute (policy sandbox) → evidence verify → human accept.
 * `verified` means execution evidence passed — never a human rubber-stamp alone.
 * Never mutates IRIS core or the git repo.
 */

import {
  designAgentFromPrompt,
  type CreatedAgent,
} from "./iris-creator.ts";
import { runIsolatedAgentSandbox, type IsolatedRunResult } from "./iris-sandbox-runner.ts";
import {
  completeJob,
  enqueueJob,
  failJob,
  leaseNextJob,
  type IrisJob,
  type JobQueueState,
  emptyJobQueue,
} from "./iris-job-queue.ts";
import { authorizeTool, defaultToolsForAgent } from "./iris-tool-acl.ts";

export const MISSION_STATUSES = [
  "draft",
  "planned",
  "queued",
  "executing",
  "executed", // sandbox finished; evidence may or may not pass
  "awaiting_approval", // legacy alias for executed (UI compat)
  "verified", // evidence checker passed (NOT human approval)
  "accepted", // human accepted a verified/executed report
  "completed", // legacy alias for accepted
  "failed",
  "rejected",
  "cancelled",
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
  jobId?: string;
  attempts: number;
  maxAttempts: number;
  timeoutMs: number;
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
  verifiedAt?: string;
  verification?: {
    passed: boolean;
    reasons: string[];
  };
  acceptedAt?: string;
  acceptedBy?: string;
  cancelledAt?: string;
  cancelledBy?: string;
};

export type MissionDesk = {
  missions: MissionRecord[];
  queue: JobQueueState;
};

const MAX_MISSIONS = 40;
const MAX_OBJECTIVE = 500;
const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_MAX_ATTEMPTS = 3;

export function emptyMissionDesk(): MissionDesk {
  return { missions: [], queue: emptyJobQueue() };
}

export function parseMissionDesk(value: string): MissionDesk {
  try {
    const parsed = JSON.parse(value) as Partial<MissionDesk>;
    return {
      missions: Array.isArray(parsed.missions)
        ? parsed.missions.filter(item => item && typeof item === "object" && typeof (item as MissionRecord).id === "string").map(normalizeMission) as MissionRecord[]
        : [],
      queue: parsed.queue && typeof parsed.queue === "object"
        ? { jobs: Array.isArray((parsed.queue as JobQueueState).jobs) ? (parsed.queue as JobQueueState).jobs : [] }
        : emptyJobQueue(),
    };
  } catch {
    return emptyMissionDesk();
  }
}

function normalizeMission(raw: MissionRecord): MissionRecord {
  return {
    ...raw,
    attempts: typeof raw.attempts === "number" ? raw.attempts : 0,
    maxAttempts: typeof raw.maxAttempts === "number" ? raw.maxAttempts : DEFAULT_MAX_ATTEMPTS,
    timeoutMs: typeof raw.timeoutMs === "number" ? raw.timeoutMs : DEFAULT_TIMEOUT_MS,
    result: raw.result
      ? { ...raw.result, appliedToRepo: false, selfModifiedCore: false }
      : null,
  };
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
      ["plan", "Planificar pasos verificables", "Definir diseño, cola, sandbox y puerta humana"],
      ["queue", "Encolar ejecución", "Job mission_execute con timeout y reintentos"],
      ["design", "Crear agente especializado", "IRIS Creator genera spec supervisado"],
      ["sandbox", "Ejecutar policy sandbox", "Sin shell, sin escritura al repo"],
      ["report", "Verificar evidencia automática", "verified solo con evidencia; no basta un OK humano"],
      ["human", "Aceptación humana (opcional)", "Aceptar/rechazar el informe; no sustituye evidencia"],
    ]
    : [
      ["parse", "Parse objective", `Received: ${objective.slice(0, 160)}`],
      ["plan", "Plan verifiable steps", "Design, queue, sandbox, human gate"],
      ["queue", "Enqueue execution", "mission_execute job with timeout/retries"],
      ["design", "Create specialized agent", "IRIS Creator builds supervised spec"],
      ["sandbox", "Run policy sandbox", "No shell, no repo writes"],
      ["report", "Auto-verify evidence", "verified requires evidence; human OK is not enough"],
      ["human", "Human acceptance (optional)", "Accept/reject the report; does not replace evidence"],
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

/** Plan + enqueue only. Does not pretend execution already happened. */
export function planAndEnqueueMission(input: {
  id: string;
  objective: string;
  ownerEmail: string;
  language?: "es" | "en";
  now?: string;
  timeoutMs?: number;
  maxAttempts?: number;
  desk?: MissionDesk;
}): { desk: MissionDesk; mission: MissionRecord; job: IrisJob } {
  const language = input.language || "es";
  const objective = normalizeObjective(input.objective);
  if (!objective) {
    throw new Error(language === "es" ? "Describe el objetivo en al menos 8 caracteres." : "Describe the objective in at least 8 characters.");
  }
  const acl = authorizeTool({
    tool: "mission_plan",
    allowedTools: [...defaultToolsForAgent(), "mission_plan"],
  });
  if (!acl.allowed) throw new Error(`tool_denied:${acl.reason}`);

  const now = input.now || new Date().toISOString();
  const desk = input.desk || emptyMissionDesk();
  let steps = buildMissionPlan(objective, language);
  steps = markSteps(steps, ["parse", "plan"]);

  const jobId = `${input.id}-job`;
  const enqueued = enqueueJob(desk.queue, {
    id: jobId,
    kind: "mission_execute",
    subjectId: input.id,
    ownerEmail: input.ownerEmail,
    timeoutMs: input.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    maxAttempts: input.maxAttempts ?? DEFAULT_MAX_ATTEMPTS,
    now,
  });
  steps = markSteps(steps, ["parse", "plan", "queue"]);

  const mission: MissionRecord = {
    id: input.id,
    objective,
    status: "queued",
    language,
    steps,
    agent: null,
    sandbox: null,
    jobId,
    attempts: 0,
    maxAttempts: enqueued.job.maxAttempts,
    timeoutMs: enqueued.job.timeoutMs,
    result: {
      summary: language === "es"
        ? "Misión planificada y en cola. Aún no ejecutada."
        : "Mission planned and queued. Not executed yet.",
      evidence: [`jobId=${jobId}`, "appliedToRepo=false", "selfModifiedCore=false"],
      verifiable: true,
      appliedToRepo: false,
      selfModifiedCore: false,
    },
    createdAt: now,
    updatedAt: now,
  };

  return {
    desk: {
      missions: [mission, ...desk.missions].slice(0, MAX_MISSIONS),
      queue: enqueued.queue,
    },
    mission,
    job: enqueued.job,
  };
}

/**
 * Backward-compatible helper used by existing tests/UI "start":
 * plan → enqueue → process immediately once.
 */
export function runMission(input: {
  id: string;
  objective: string;
  language?: "es" | "en";
  now?: string;
  ownerEmail?: string;
}): MissionRecord {
  const planned = planAndEnqueueMission({
    ...input,
    ownerEmail: input.ownerEmail || "system@iris.local",
  });
  const processed = processMissionQueue(planned.desk, planned.mission.language, input.now);
  const mission = processed.desk.missions.find(item => item.id === input.id) || planned.mission;
  return mission;
}

export function executeMissionJob(input: {
  mission: MissionRecord;
  now?: string;
}): MissionRecord {
  const language = input.mission.language;
  const now = input.now || new Date().toISOString();
  let steps = input.mission.steps.length ? input.mission.steps : buildMissionPlan(input.mission.objective, language);
  steps = markSteps(steps, ["parse", "plan", "queue"]);

  const agent = designAgentFromPrompt({
    id: `${input.mission.id}-agent`,
    prompt: language === "es"
      ? `Crea una inteligencia artificial especializada en ${input.mission.objective}`
      : `Create an AI specialized in ${input.mission.objective}`,
    language,
    now,
  });
  steps = markSteps(steps, ["parse", "plan", "queue", "design"]);

  const sandboxAcl = authorizeTool({
    tool: "policy_sandbox",
    allowedTools: defaultToolsForAgent(),
    agentStatus: agent.status,
  });
  if (!sandboxAcl.allowed) {
    return {
      ...input.mission,
      status: "failed",
      steps: markSteps(steps, ["parse", "plan", "queue", "design"], "sandbox"),
      agent,
      sandbox: null,
      attempts: input.mission.attempts + 1,
      updatedAt: now,
      result: {
        summary: language === "es"
          ? `ACL bloqueó policy_sandbox (${sandboxAcl.reason}).`
          : `ACL blocked policy_sandbox (${sandboxAcl.reason}).`,
        evidence: [`acl=${sandboxAcl.reason}`, "appliedToRepo=false"],
        verifiable: true,
        appliedToRepo: false,
        selfModifiedCore: false,
      },
    };
  }

  const sandbox = runIsolatedAgentSandbox(agent, language);
  if (!sandbox.ok || !agent.sandbox.passed || agent.status === "sandbox_failed") {
    steps = markSteps(steps, ["parse", "plan", "queue", "design"], "sandbox");
    return {
      ...input.mission,
      status: "failed",
      language,
      steps,
      agent,
      sandbox,
      attempts: input.mission.attempts + 1,
      updatedAt: now,
      result: {
        summary: language === "es"
          ? "La misión falló en sandbox/Guardian. No se aplicó nada al sistema."
          : "Mission failed in sandbox/Guardian. Nothing was applied to the system.",
        evidence: [
          `agent_status=${agent.status}`,
          `sandbox_ok=${sandbox.ok}`,
          `isolation=${sandbox.isolation.level}`,
          ...sandbox.errors.map(error => `error=${error}`),
        ],
        verifiable: true,
        appliedToRepo: false,
        selfModifiedCore: false,
      },
    };
  }

  steps = markSteps(steps, ["parse", "plan", "queue", "design", "sandbox"]);
  const executed: MissionRecord = {
    ...input.mission,
    status: "executed",
    language,
    steps,
    agent,
    sandbox,
    attempts: input.mission.attempts + 1,
    updatedAt: now,
    result: {
      summary: language === "es"
        ? `Ejecutada en policy sandbox para “${agent.blueprint.specialty}”. La evidencia se evalúa automáticamente; la aceptación humana es un paso aparte.`
        : `Executed in policy sandbox for “${agent.blueprint.specialty}”. Evidence is evaluated automatically; human acceptance is separate.`,
      evidence: [
        `specialty=${agent.blueprint.specialty}`,
        `sandbox_checks=${sandbox.checks.filter(check => check.ok).length}/${sandbox.checks.length}`,
        `duration_ms=${sandbox.durationMs}`,
        `isolation=${sandbox.isolation.level}`,
        `tool_trace=${sandbox.toolTrace.length}`,
        "appliedToRepo=false",
        "selfModifiedCore=false",
      ],
      verifiable: true,
      appliedToRepo: false,
      selfModifiedCore: false,
    },
  };
  return markVerifiedFromEvidence(executed, now);
}

/** Evidence-only verification. Human approval never calls this as a rubber stamp. */
export function evaluateMissionEvidence(mission: MissionRecord): { passed: boolean; reasons: string[] } {
  const reasons: string[] = [];
  if (!mission.sandbox) reasons.push("missing_sandbox");
  if (!mission.result) reasons.push("missing_result");
  if (!mission.agent) reasons.push("missing_agent");
  if (mission.result?.appliedToRepo !== false) reasons.push("appliedToRepo_not_false");
  if (mission.result?.selfModifiedCore !== false) reasons.push("selfModifiedCore_not_false");
  if (mission.sandbox && !mission.sandbox.ok) reasons.push("sandbox_not_ok");
  if (mission.sandbox && mission.sandbox.isolation.claimsContainerOrVm) reasons.push("false_isolation_claim");
  if (mission.sandbox && mission.sandbox.isolation.claimsOsShell) reasons.push("false_shell_claim");
  if (mission.sandbox && !mission.sandbox.checks.every(check => check.ok)) reasons.push("sandbox_checks_failed");
  if (mission.sandbox && mission.sandbox.proposalSample?.applied !== false) reasons.push("proposal_marked_applied");
  if (mission.sandbox && !mission.sandbox.proposalSample?.requiresHumanApproval) reasons.push("proposal_missing_human_gate");
  if (!(mission.result?.evidence || []).some(item => item.startsWith("sandbox_checks="))) reasons.push("missing_sandbox_checks_evidence");
  if (!(mission.result?.evidence || []).some(item => item.includes("appliedToRepo=false"))) reasons.push("missing_appliedToRepo_evidence");
  if (!["executed", "awaiting_approval", "verified", "accepted", "completed"].includes(mission.status)
    && mission.status !== "executing") {
    // allow evaluation during post-exec transition
  }
  const passed = reasons.length === 0 && Boolean(mission.sandbox?.ok) && Boolean(mission.result?.verifiable);
  if (passed) reasons.push("evidence_ok");
  return { passed, reasons };
}

export function markVerifiedFromEvidence(mission: MissionRecord, now = new Date().toISOString()): MissionRecord {
  const verification = evaluateMissionEvidence({ ...mission, status: "executed" });
  if (!verification.passed) {
    return {
      ...mission,
      status: "executed",
      verification,
      updatedAt: now,
      result: mission.result
        ? {
          ...mission.result,
          summary: `${mission.result.summary} · evidence_pending=${verification.reasons.join(",")}`,
          appliedToRepo: false,
          selfModifiedCore: false,
        }
        : null,
    };
  }
  const steps = markSteps(mission.steps, ["parse", "plan", "queue", "design", "sandbox", "report"]);
  return {
    ...mission,
    status: "verified",
    steps,
    verification,
    verifiedAt: now,
    updatedAt: now,
    result: mission.result
      ? {
        ...mission.result,
        summary: `${mission.result.summary} · verified_by=evidence`,
        evidence: [...mission.result.evidence, `verified_at=${now}`, "verifier=evidence"],
        appliedToRepo: false,
        selfModifiedCore: false,
      }
      : null,
  };
}

/** Lease and run at most one mission_execute job for this desk. */
export function processMissionQueue(
  desk: MissionDesk,
  language: "es" | "en" = "es",
  now = new Date().toISOString(),
): { desk: MissionDesk; processed: MissionRecord | null; job: IrisJob | null } {
  const queued = desk.queue.jobs.find(job => job.status === "queued");
  const leaseOwner = queued?.ownerEmail || "system@iris.local";
  const leased = leaseNextJob(desk.queue, leaseOwner, now);
  if (!leased.job || leased.job.kind !== "mission_execute") {
    return { desk: { ...desk, queue: leased.queue }, processed: null, job: null };
  }

  const mission = desk.missions.find(item => item.id === leased.job!.subjectId);
  if (!mission || mission.status === "cancelled") {
    const failed = failJob(leased.queue, leased.job.id, "mission_missing_or_cancelled", now);
    return { desk: { ...desk, queue: failed.queue }, processed: null, job: failed.job };
  }

  const executing: MissionRecord = {
    ...mission,
    status: "executing",
    updatedAt: now,
  };
  try {
    const executed = executeMissionJob({ mission: executing, now });
    if (executed.status === "failed") {
      const failed = failJob(leased.queue, leased.job.id, executed.result?.summary || "sandbox_failed", now);
      return {
        desk: {
          missions: desk.missions.map(item => item.id === executed.id ? executed : item),
          queue: failed.queue,
        },
        processed: executed,
        job: failed.job,
      };
    }
    const done = completeJob(
      leased.queue,
      leased.job.id,
      executed.result?.summary || "awaiting_approval",
      now,
    );
    return {
      desk: {
        missions: desk.missions.map(item => item.id === executed.id ? executed : item),
        queue: done.queue,
      },
      processed: executed,
      job: done.job,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "execute_failed";
    const failed = failJob(leased.queue, leased.job.id, message, now);
    const failedMission: MissionRecord = {
      ...executing,
      status: "failed",
      updatedAt: now,
      result: {
        summary: language === "es" ? `Error de ejecución: ${message}` : `Execution error: ${message}`,
        evidence: [`error=${message}`, "appliedToRepo=false"],
        verifiable: true,
        appliedToRepo: false,
        selfModifiedCore: false,
      },
    };
    return {
      desk: {
        missions: desk.missions.map(item => item.id === failedMission.id ? failedMission : item),
        queue: failed.queue,
      },
      processed: failedMission,
      job: failed.job,
    };
  }
}

/**
 * Human acceptance of an executed/verified report.
 * Does NOT set status=verified — verification is evidence-only.
 */
export function acceptMission(desk: MissionDesk, missionId: string, actorEmail: string, now = new Date().toISOString()) {
  const mission = desk.missions.find(item => item.id === missionId);
  if (!mission) throw new Error("Mission not found");
  if (!["executed", "awaiting_approval", "verified"].includes(mission.status)) {
    throw new Error("Mission is not awaiting human acceptance");
  }
  const steps = markSteps(mission.steps, ["parse", "plan", "queue", "design", "sandbox", "human", "report"]);
  const next: MissionRecord = {
    ...mission,
    status: "accepted",
    steps,
    acceptedAt: now,
    acceptedBy: actorEmail,
    approvedAt: now,
    approvedBy: actorEmail,
    updatedAt: now,
    result: mission.result
      ? {
        ...mission.result,
        summary: `${mission.result.summary} · accepted_by=${actorEmail}`,
        appliedToRepo: false,
        selfModifiedCore: false,
      }
      : null,
  };
  return {
    desk: {
      ...desk,
      missions: desk.missions.map(item => item.id === missionId ? next : item),
    },
    mission: next,
  };
}

/** @deprecated Use acceptMission — kept for API alias; never marks verified. */
export function approveMission(desk: MissionDesk, missionId: string, actorEmail: string, now = new Date().toISOString()) {
  return acceptMission(desk, missionId, actorEmail, now);
}

export function rejectMission(desk: MissionDesk, missionId: string, now = new Date().toISOString()) {
  const mission = desk.missions.find(item => item.id === missionId);
  if (!mission) throw new Error("Mission not found");
  if (!["awaiting_approval", "executed", "verified", "queued", "planned"].includes(mission.status)) {
    throw new Error("Mission cannot be rejected in its current state");
  }
  const next: MissionRecord = {
    ...mission,
    status: "rejected",
    updatedAt: now,
    result: mission.result
      ? { ...mission.result, summary: `${mission.result.summary} · rejected`, appliedToRepo: false, selfModifiedCore: false }
      : null,
  };
  return {
    desk: {
      ...desk,
      missions: desk.missions.map(item => item.id === missionId ? next : item),
    },
    mission: next,
  };
}

export function cancelMission(
  desk: MissionDesk,
  missionId: string,
  actorEmail: string,
  now = new Date().toISOString(),
) {
  const mission = desk.missions.find(item => item.id === missionId);
  if (!mission) throw new Error("Mission not found");
  if (["accepted", "completed", "rejected", "cancelled"].includes(mission.status)) {
    throw new Error("Mission already finished");
  }
  const jobs = desk.queue.jobs.map(job => {
    if (job.subjectId !== missionId) return job;
    if (!["queued", "running"].includes(job.status)) return job;
    return {
      ...job,
      status: "cancelled" as const,
      updatedAt: now,
      finishedAt: now,
      cancelledBy: actorEmail,
    };
  });
  const next: MissionRecord = {
    ...mission,
    status: "cancelled",
    updatedAt: now,
    cancelledAt: now,
    cancelledBy: actorEmail,
    result: mission.result
      ? { ...mission.result, summary: `${mission.result.summary} · cancelled_by=${actorEmail}`, appliedToRepo: false, selfModifiedCore: false }
      : {
        summary: `cancelled_by=${actorEmail}`,
        evidence: ["appliedToRepo=false"],
        verifiable: true,
        appliedToRepo: false,
        selfModifiedCore: false,
      },
  };
  return {
    desk: {
      missions: desk.missions.map(item => item.id === missionId ? next : item),
      queue: { jobs },
    },
    mission: next,
  };
}

export function addMission(desk: MissionDesk, mission: MissionRecord): MissionDesk {
  return {
    ...desk,
    missions: [mission, ...desk.missions].slice(0, MAX_MISSIONS),
  };
}
