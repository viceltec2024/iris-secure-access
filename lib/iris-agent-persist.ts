/**
 * Persistent supervised execution for approved Creator agents.
 * Every cycle re-runs Guardian, records activity, and meters estimated cost.
 * Never applies repo changes, never self-modifies IRIS core, never spends money.
 */

import {
  runGuardianChecks,
  type CreatedAgent,
  type CreatorDeskState,
  type GuardianFinding,
} from "./iris-creator.ts";
import { runAuthorizedAgentTask, type AgentTaskResult } from "./iris-agent-runtime.ts";
import type { MemoryStore } from "./iris-memory.ts";

export const MAX_ACTIVITY_ENTRIES = 50;
/** Estimated local heartbeat cost in cents (metering only — no real charge). */
export const PERSIST_HEARTBEAT_COST_CENTS = 1;

export type AgentActivityKind =
  | "tick"
  | "heartbeat"
  | "guardian_block"
  | "budget_block"
  | "schedule_skip"
  | "task";

export type AgentActivityEntry = {
  id: string;
  at: string;
  kind: AgentActivityKind;
  task?: string;
  ok: boolean;
  summary: string;
  evidence: string[];
  estimatedCostCents: number;
  guardian: { passed: boolean; codes: string[] };
  appliedToRepo: false;
  selfModifiedCore: false;
};

export type AgentCostAccounting = {
  runCount: number;
  estimatedCostCents: number;
  lastRunAt: string | null;
  lastBlockReason: string | null;
};

export type PersistCycleLimits = {
  allowed: boolean;
  code: string;
  detail: string;
};

export type PersistCycleResult = {
  state: CreatorDeskState;
  ranAt: string;
  ran: number;
  blocked: number;
  skipped: number;
  estimatedCostCents: number;
  activity: AgentActivityEntry[];
  appliedToRepo: false;
  selfModifiedCore: false;
};

function emptyCost(): AgentCostAccounting {
  return { runCount: 0, estimatedCostCents: 0, lastRunAt: null, lastBlockReason: null };
}

export function agentActivityLog(agent: CreatedAgent): AgentActivityEntry[] {
  const raw = (agent as CreatedAgent & { activityLog?: unknown }).activityLog;
  return Array.isArray(raw) ? raw.filter(isActivityEntry).slice(0, MAX_ACTIVITY_ENTRIES) : [];
}

export function agentCostAccounting(agent: CreatedAgent): AgentCostAccounting {
  const raw = (agent as CreatedAgent & { cost?: Partial<AgentCostAccounting> }).cost;
  if (!raw || typeof raw !== "object") return emptyCost();
  return {
    runCount: Math.max(0, Number(raw.runCount) || 0),
    estimatedCostCents: Math.max(0, Number(raw.estimatedCostCents) || 0),
    lastRunAt: typeof raw.lastRunAt === "string" ? raw.lastRunAt : null,
    lastBlockReason: typeof raw.lastBlockReason === "string" ? raw.lastBlockReason : null,
  };
}

function isActivityEntry(value: unknown): value is AgentActivityEntry {
  if (!value || typeof value !== "object") return false;
  const entry = value as AgentActivityEntry;
  return Boolean(
    entry.id
    && typeof entry.at === "string"
    && typeof entry.kind === "string"
    && typeof entry.ok === "boolean"
    && entry.appliedToRepo === false
    && entry.selfModifiedCore === false
  );
}

export function appendAgentActivity(agent: CreatedAgent, entry: AgentActivityEntry): CreatedAgent {
  const activityLog = [entry, ...agentActivityLog(agent)].slice(0, MAX_ACTIVITY_ENTRIES);
  const prev = agentCostAccounting(agent);
  const cost: AgentCostAccounting = {
    runCount: prev.runCount + (entry.ok && entry.kind === "heartbeat" ? 1 : 0),
    estimatedCostCents: prev.estimatedCostCents + Math.max(0, entry.estimatedCostCents || 0),
    lastRunAt: entry.ok ? entry.at : prev.lastRunAt,
    lastBlockReason: entry.ok ? null : entry.summary.slice(0, 160),
  };
  return {
    ...agent,
    activityLog,
    cost,
    lastTickAt: entry.at,
    updatedAt: entry.at,
  } as CreatedAgent;
}

export function isWithinAgentSchedule(agent: CreatedAgent, now = new Date()) {
  if (agent.schedule === "on_demand") return false;
  if (agent.schedule === "always_on") return true;
  // business_hours: Mon–Fri 13:00–22:00 UTC (approx daytime Americas/EU overlap)
  const day = now.getUTCDay();
  if (day === 0 || day === 6) return false;
  const hour = now.getUTCHours();
  return hour >= 13 && hour < 22;
}

export function evaluatePersistentGuardian(agent: CreatedAgent, language: "es" | "en" = "es"): {
  passed: boolean;
  findings: GuardianFinding[];
  codes: string[];
} {
  if (agent.autonomy !== "supervised" || agent.guardian.requiresHumanApproval !== true) {
    return {
      passed: false,
      findings: [{
        severity: "block",
        code: "SUPERVISION_REQUIRED",
        message: language === "es"
          ? "Guardian exige autonomía supervisada y puerta humana."
          : "Guardian requires supervised autonomy and a human gate.",
      }],
      codes: ["SUPERVISION_REQUIRED"],
    };
  }
  const findings = runGuardianChecks(agent, language);
  const blocked = findings.some(item => item.severity === "block");
  return {
    passed: !blocked,
    findings,
    codes: findings.map(item => item.code),
  };
}

function makeActivity(input: {
  id: string;
  at: string;
  kind: AgentActivityKind;
  task?: string;
  ok: boolean;
  summary: string;
  evidence?: string[];
  estimatedCostCents?: number;
  guardian: { passed: boolean; codes: string[] };
}): AgentActivityEntry {
  return {
    id: input.id,
    at: input.at,
    kind: input.kind,
    task: input.task,
    ok: input.ok,
    summary: input.summary.slice(0, 280),
    evidence: (input.evidence || []).slice(0, 12),
    estimatedCostCents: Math.max(0, input.estimatedCostCents || 0),
    guardian: input.guardian,
    appliedToRepo: false,
    selfModifiedCore: false,
  };
}

/**
 * Run one persistent cycle over approved scheduled agents.
 * Budget/limit gating is decided by the caller (`limits`); this never charges money.
 */
export function runPersistentAgentCycle(input: {
  state: CreatorDeskState;
  limits: PersistCycleLimits;
  language?: "es" | "en";
  memory?: MemoryStore;
  now?: string;
  idFactory?: () => string;
}): PersistCycleResult {
  const language = input.language || "es";
  const now = input.now || new Date().toISOString();
  const idFactory = input.idFactory || (() => crypto.randomUUID());
  const activity: AgentActivityEntry[] = [];
  let ran = 0;
  let blocked = 0;
  let skipped = 0;
  let estimatedCostCents = 0;

  if (!input.limits.allowed) {
    const entry = makeActivity({
      id: idFactory(),
      at: now,
      kind: "budget_block",
      ok: false,
      summary: language === "es"
        ? `Ciclo bloqueado por límites: ${input.limits.code}`
        : `Cycle blocked by limits: ${input.limits.code}`,
      evidence: [`code=${input.limits.code}`, `detail=${input.limits.detail}`],
      guardian: { passed: true, codes: [] },
    });
    activity.push(entry);
    return {
      state: input.state,
      ranAt: now,
      ran: 0,
      blocked: 1,
      skipped: 0,
      estimatedCostCents: 0,
      activity,
      appliedToRepo: false,
      selfModifiedCore: false,
    };
  }

  const agents = input.state.agents.map(agent => {
    if (agent.status !== "approved") return agent;

    if (!isWithinAgentSchedule(agent, new Date(now))) {
      skipped += 1;
      const entry = makeActivity({
        id: idFactory(),
        at: now,
        kind: "schedule_skip",
        ok: true,
        summary: language === "es"
          ? `Fuera de horario (${agent.schedule}).`
          : `Outside schedule (${agent.schedule}).`,
        evidence: [`schedule=${agent.schedule}`],
        guardian: { passed: true, codes: [] },
      });
      activity.push(entry);
      return appendAgentActivity(agent, entry);
    }

    const guardian = evaluatePersistentGuardian(agent, language);
    if (!guardian.passed) {
      blocked += 1;
      const entry = makeActivity({
        id: idFactory(),
        at: now,
        kind: "guardian_block",
        ok: false,
        summary: language === "es"
          ? "Guardian bloqueó el ciclo persistente."
          : "Guardian blocked the persistent cycle.",
        evidence: guardian.codes.map(code => `guardian=${code}`),
        guardian: { passed: false, codes: guardian.codes },
      });
      activity.push(entry);
      return {
        ...appendAgentActivity(agent, entry),
        status: "paused" as const,
        guardian: {
          ...agent.guardian,
          findings: guardian.findings,
        },
      };
    }

    const taskResult: AgentTaskResult = runAuthorizedAgentTask({
      agent,
      task: "heartbeat",
      memory: input.memory,
      language,
      now,
    });

    if (!taskResult.ok) {
      blocked += 1;
      const entry = makeActivity({
        id: idFactory(),
        at: now,
        kind: "heartbeat",
        task: "heartbeat",
        ok: false,
        summary: taskResult.error || "heartbeat_failed",
        evidence: taskResult.evidence,
        guardian: { passed: true, codes: guardian.codes },
      });
      activity.push(entry);
      return appendAgentActivity(agent, entry);
    }

    ran += 1;
    estimatedCostCents += PERSIST_HEARTBEAT_COST_CENTS;
    const entry = makeActivity({
      id: idFactory(),
      at: now,
      kind: "heartbeat",
      task: "heartbeat",
      ok: true,
      summary: language === "es"
        ? `Latido persistente supervisado · ${agent.blueprint.specialty}`
        : `Supervised persistent heartbeat · ${agent.blueprint.specialty}`,
      evidence: [...taskResult.evidence, `cost_cents=${PERSIST_HEARTBEAT_COST_CENTS}`, "charge=false"],
      estimatedCostCents: PERSIST_HEARTBEAT_COST_CENTS,
      guardian: { passed: true, codes: guardian.codes },
    });
    activity.push(entry);
    return appendAgentActivity(agent, entry);
  });

  return {
    state: { agents },
    ranAt: now,
    ran,
    blocked,
    skipped,
    estimatedCostCents,
    activity,
    appliedToRepo: false,
    selfModifiedCore: false,
  };
}
