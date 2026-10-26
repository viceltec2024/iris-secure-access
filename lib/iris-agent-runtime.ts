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
  return { state: { agents }, ticks };
}
