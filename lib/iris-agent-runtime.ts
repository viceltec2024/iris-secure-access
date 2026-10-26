/**
 * Real authorized task execution for approved Creator agents.
 * Runs allowlisted tools only. Never applies repo changes or self-modifies core.
 */

import {
  buildImprovementProposal,
  type CreatedAgent,
  type CreatorDeskState,
  type ProposalType,
} from "./iris-creator.ts";
import { authorizeTool, defaultToolsForAgent } from "./iris-tool-acl.ts";
import { searchMemory, type MemoryStore } from "./iris-memory.ts";
import { detectPromptInjection } from "./iris-guardian.ts";
import {
  completeJob,
  enqueueJob,
  failJob,
  leaseNextJob,
  type IrisJob,
} from "./iris-job-queue.ts";

export const AGENT_TASK_KINDS = [
  "heartbeat",
  "draft_reply",
  "read_business_context",
  "enqueue_proposal",
  "memory_lookup",
] as const;

export type AgentTaskKind = (typeof AGENT_TASK_KINDS)[number];

export type AgentTaskResult = {
  ok: boolean;
  task: AgentTaskKind;
  output: Record<string, unknown>;
  appliedToRepo: false;
  selfModifiedCore: false;
  requiresHumanApproval: boolean;
  evidence: string[];
  error?: string;
};

function requireApproved(agent: CreatedAgent) {
  if (agent.status !== "approved") {
    throw new Error("agent_not_approved");
  }
}

export function runAuthorizedAgentTask(input: {
  agent: CreatedAgent;
  task: AgentTaskKind;
  payload?: Record<string, unknown>;
  memory?: MemoryStore;
  language?: "es" | "en";
  now?: string;
}): AgentTaskResult {
  const language = input.language || "es";
  const now = input.now || new Date().toISOString();
  const payload = input.payload || {};
  const evidence: string[] = [`task=${input.task}`, `agent=${input.agent.id}`, `at=${now}`];

  try {
    requireApproved(input.agent);

    const injection = detectPromptInjection(JSON.stringify(payload));
    if (injection.blocked) {
      return {
        ok: false,
        task: input.task,
        output: {},
        appliedToRepo: false,
        selfModifiedCore: false,
        requiresHumanApproval: true,
        evidence: [...evidence, `injection=${injection.code}`],
        error: injection.message,
      };
    }

    if (input.task === "heartbeat") {
      const acl = authorizeTool({
        tool: "policy_sandbox",
        allowedTools: defaultToolsForAgent(),
        agentStatus: input.agent.status,
      });
      if (!acl.allowed) throw new Error(`tool_denied:${acl.reason}`);
      if (!input.agent.permissions.includes("run_on_schedule") && input.agent.schedule === "always_on") {
        throw new Error("permission_denied");
      }
      return {
        ok: true,
        task: input.task,
        output: {
          status: "heartbeat",
          specialty: input.agent.blueprint.specialty,
          autonomy: "supervised",
        },
        appliedToRepo: false,
        selfModifiedCore: false,
        requiresHumanApproval: false,
        evidence: [...evidence, "heartbeat=ok"],
      };
    }

    if (input.task === "draft_reply") {
      const acl = authorizeTool({
        tool: "draft_composer",
        allowedTools: defaultToolsForAgent(),
        agentStatus: input.agent.status,
      });
      if (!acl.allowed) throw new Error(`tool_denied:${acl.reason}`);
      if (!input.agent.permissions.includes("draft_replies")) throw new Error("permission_denied");
      const topic = String(payload.topic || payload.text || input.agent.blueprint.specialty).slice(0, 280);
      const draft = language === "es"
        ? `Borrador supervisado (${input.agent.blueprint.specialty}): ${topic}. Requiere revisión humana antes de enviar.`
        : `Supervised draft (${input.agent.blueprint.specialty}): ${topic}. Requires human review before sending.`;
      return {
        ok: true,
        task: input.task,
        output: { draft, topic },
        appliedToRepo: false,
        selfModifiedCore: false,
        requiresHumanApproval: true,
        evidence: [...evidence, `draft_len=${draft.length}`],
      };
    }

    if (input.task === "read_business_context") {
      const acl = authorizeTool({
        tool: "business_context",
        allowedTools: defaultToolsForAgent(),
        agentStatus: input.agent.status,
      });
      if (!acl.allowed) throw new Error(`tool_denied:${acl.reason}`);
      if (!input.agent.permissions.includes("read_business_context")) throw new Error("permission_denied");
      return {
        ok: true,
        task: input.task,
        output: {
          specialty: input.agent.blueprint.specialty,
          goals: input.agent.blueprint.goals,
          tools: input.agent.blueprint.tools,
          constraints: input.agent.blueprint.constraints,
          permissions: input.agent.permissions,
        },
        appliedToRepo: false,
        selfModifiedCore: false,
        requiresHumanApproval: false,
        evidence: [...evidence, "context=read"],
      };
    }

    if (input.task === "enqueue_proposal") {
      const acl = authorizeTool({
        tool: "proposal_queue",
        allowedTools: defaultToolsForAgent(),
        agentStatus: input.agent.status,
        humanApproved: true,
      });
      if (!acl.allowed) throw new Error(`tool_denied:${acl.reason}`);
      const type: ProposalType = payload.type === "test_plan" ? "test_plan" : "code_improvement";
      if (type === "test_plan" && !input.agent.permissions.includes("propose_tests")) throw new Error("permission_denied");
      if (type === "code_improvement" && !input.agent.permissions.includes("propose_code_changes")) throw new Error("permission_denied");
      const proposal = buildImprovementProposal({
        id: String(payload.id || crypto.randomUUID()),
        agent: input.agent,
        type,
        language,
        now,
      });
      return {
        ok: true,
        task: input.task,
        output: {
          proposal,
          applied: false,
        },
        appliedToRepo: false,
        selfModifiedCore: false,
        requiresHumanApproval: true,
        evidence: [...evidence, `proposal=${proposal.id}`, "applied=false"],
      };
    }

    if (input.task === "memory_lookup") {
      const acl = authorizeTool({
        tool: "memory_read",
        allowedTools: defaultToolsForAgent(),
        agentStatus: input.agent.status,
      });
      if (!acl.allowed) throw new Error(`tool_denied:${acl.reason}`);
      const query = String(payload.query || "").slice(0, 200);
      const hits = input.memory ? searchMemory(input.memory, query, 5) : [];
      return {
        ok: true,
        task: input.task,
        output: {
          query,
          hits: hits.map(item => ({
            id: item.id,
            kind: item.kind,
            title: item.title,
            promotion: item.promotion,
          })),
        },
        appliedToRepo: false,
        selfModifiedCore: false,
        requiresHumanApproval: false,
        evidence: [...evidence, `hits=${hits.length}`],
      };
    }

    return {
      ok: false,
      task: input.task,
      output: {},
      appliedToRepo: false,
      selfModifiedCore: false,
      requiresHumanApproval: true,
      evidence,
      error: "unknown_task",
    };
  } catch (error) {
    return {
      ok: false,
      task: input.task,
      output: {},
      appliedToRepo: false,
      selfModifiedCore: false,
      requiresHumanApproval: true,
      evidence,
      error: error instanceof Error ? error.message : "task_failed",
    };
  }
}

/**
 * Request-scoped drain for approved scheduled agents.
 * Runs a real heartbeat task (Guardian + ACL). Never applies repo changes.
 */
export function runApprovedAgentTicks(input: {
  state: CreatorDeskState;
  language?: "es" | "en";
  memory?: MemoryStore;
  now?: string;
}): { state: CreatorDeskState; ticks: AgentTaskResult[] } {
  const language = input.language || "es";
  const now = input.now || new Date().toISOString();
  const ticks: AgentTaskResult[] = [];
  const agents = input.state.agents.map(agent => {
    if (agent.status !== "approved") return agent;
    if (agent.schedule === "on_demand") return agent;
    const result = runAuthorizedAgentTask({
      agent,
      task: "heartbeat",
      memory: input.memory,
      language,
      now,
    });
    ticks.push(result);
    if (!result.ok) return agent;
    return { ...agent, lastTickAt: now, updatedAt: now };
  });
  return { state: { ...input.state, agents }, ticks };
}

/** Enqueue agent_tick jobs for approved scheduled agents (deduped by queue). */
export function enqueueApprovedAgentTicks(input: {
  state: CreatorDeskState;
  ownerEmail: string;
  now?: string;
}): CreatorDeskState {
  const now = input.now || new Date().toISOString();
  let queue = input.state.queue;
  for (const agent of input.state.agents) {
    if (agent.status !== "approved") continue;
    if (agent.schedule === "on_demand") continue;
    try {
      const enqueued = enqueueJob(queue, {
        id: crypto.randomUUID(),
        kind: "agent_tick",
        subjectId: agent.id,
        ownerEmail: input.ownerEmail,
        timeoutMs: 10_000,
        maxAttempts: 2,
        now,
      });
      queue = enqueued.queue;
    } catch {
      // duplicate_active_job — already queued/running
    }
  }
  return { ...input.state, queue };
}

/**
 * Lease and run at most one agent_tick job.
 * Never applies repo changes; proposals still require human approval.
 */
export function processAgentTickQueue(input: {
  state: CreatorDeskState;
  language?: "es" | "en";
  memory?: MemoryStore;
  ownerEmail: string;
  now?: string;
}): { state: CreatorDeskState; job: IrisJob | null; tick: AgentTaskResult | null } {
  const language = input.language || "es";
  const now = input.now || new Date().toISOString();
  const leased = leaseNextJob(input.state.queue, input.ownerEmail, now);
  if (!leased.job || leased.job.kind !== "agent_tick") {
    return { state: { ...input.state, queue: leased.queue }, job: null, tick: null };
  }
  const agent = input.state.agents.find(item => item.id === leased.job!.subjectId);
  if (!agent || agent.status !== "approved") {
    const failed = failJob(leased.queue, leased.job.id, "agent_missing_or_not_approved", now);
    return { state: { ...input.state, queue: failed.queue }, job: failed.job, tick: null };
  }
  const tick = runAuthorizedAgentTask({
    agent,
    task: "heartbeat",
    memory: input.memory,
    language,
    now,
  });
  if (!tick.ok) {
    const failed = failJob(leased.queue, leased.job.id, tick.error || "tick_failed", now);
    return { state: { ...input.state, queue: failed.queue }, job: failed.job, tick };
  }
  const done = completeJob(leased.queue, leased.job.id, tick.evidence.join("; "), now);
  const agents = input.state.agents.map(item => item.id === agent.id
    ? { ...item, lastTickAt: now, updatedAt: now }
    : item);
  return {
    state: { ...input.state, agents, queue: done.queue },
    job: done.job,
    tick,
  };
}
