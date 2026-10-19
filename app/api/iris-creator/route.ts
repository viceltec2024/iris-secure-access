import { env } from "cloudflare:workers";
import { getChatGPTUser } from "../../chatgpt-auth";
import { logAudit, provisionIrisUser } from "../../../lib/authz";
import {
  addAgentProposal,
  addCreatedAgent,
  approveCreatedAgent,
  buildImprovementProposal,
  cancelCreatedAgent,
  decideAgentProposal,
  designAgentFromPrompt,
  emptyCreatorDesk,
  normalizeCreatorPrompt,
  parseCreatorDesk,
  pauseCreatedAgent,
  rejectCreatedAgent,
  tickApprovedAgents,
  type AgentSchedule,
  type CreatorDeskState,
  type ProposalType,
} from "../../../lib/iris-creator";
import { runAuthorizedAgentTask, type AgentTaskKind } from "../../../lib/iris-agent-runtime";
import { runPersistentAgentCycle } from "../../../lib/iris-agent-persist";
import { emptyMemoryStore, parseMemoryStore } from "../../../lib/iris-memory";
import { buildModelCoordinationReport } from "../../../lib/iris-model-registry";
import { enforceRateLimit } from "../../../lib/rate-limit";
import { loadOrgDeskValue, saveOrgDeskValue } from "../../../lib/iris-org-store";
import type { IrisPlanId } from "../../../lib/iris-plans";
import { requireOrgContext } from "../../../lib/iris-tenant";
import { assertOrgWithinLimits, recordUsageEvent } from "../../../lib/iris-usage";

export const dynamic = "force-dynamic";

async function currentUser() {
  const identity = await getChatGPTUser();
  return identity ? provisionIrisUser(identity) : null;
}

function modelBindings() {
  return env as unknown as {
    OPENAI_API_KEY?: string;
    ELEVENLABS_API_KEY?: string;
    MODEL_API_KEY?: string;
    MUSE_API_KEY?: string;
    AI?: unknown;
  };
}

function deskPayload(state: CreatorDeskState, language: "es" | "en" = "es") {
  return {
    ...state,
    models: buildModelCoordinationReport(modelBindings(), language),
  };
}

export async function GET(request: Request) {
  const user = await currentUser();
  if (!user || user.status !== "ACTIVE") return Response.json({ error: "Unauthorized" }, { status: 401 });
  const language = new URL(request.url).searchParams.get("language") === "en" ? "en" : "es";
  const ctx = await requireOrgContext(user.email);
  const loaded = await loadOrgDeskValue({ kind: "creator", organizationId: ctx.organization.id, email: user.email });
  const state = loaded.value ? parseCreatorDesk(loaded.value) : emptyCreatorDesk();
  const next = tickApprovedAgents(state);
  if (JSON.stringify(next) !== JSON.stringify(state)) {
    await saveOrgDeskValue({
      kind: "creator",
      organizationId: ctx.organization.id,
      email: user.email,
      expectedUpdatedAt: loaded.updatedAt,
      value: JSON.stringify(next),
    });
  }
  return Response.json({ ...deskPayload(next, language), organizationId: ctx.organization.id });
}

export async function POST(request: Request) {
  const user = await currentUser();
  if (!user || user.status !== "ACTIVE") return Response.json({ error: "Unauthorized" }, { status: 401 });

  if (!(await enforceRateLimit(`iris-creator:${user.email}`, 40, 60 * 1000))) {
    await logAudit(user.email, "IRIS_CREATOR", "creator", "DENIED", { reason: "rate_limited" });
    return Response.json({ error: "Demasiadas solicitudes. Espera un momento." }, { status: 429, headers: { "Retry-After": "60" } });
  }

  const body = await request.json().catch(() => ({})) as {
    action?: string;
    prompt?: string;
    language?: string;
    schedule?: string;
    agentId?: string;
    proposalId?: string;
    proposalType?: string;
    task?: string;
    payload?: Record<string, unknown>;
  };

  const mutate = body.action !== undefined && body.action !== "list";
  const ctx = await requireOrgContext(user.email, { mutate });
  const loaded = await loadOrgDeskValue({ kind: "creator", organizationId: ctx.organization.id, email: user.email });
  const state = loaded.value ? parseCreatorDesk(loaded.value) : emptyCreatorDesk();
  const language = body.language === "en" ? "en" : "es";
  const orgId = ctx.organization.id;

  async function persist(next: CreatorDeskState) {
    await saveOrgDeskValue({
      kind: "creator",
      organizationId: orgId,
      email: user.email,
      expectedUpdatedAt: loaded.updatedAt,
      value: JSON.stringify(next),
    });
  }

  try {
    if (body.action === "create") {
      const prompt = normalizeCreatorPrompt(body.prompt);
      if (!prompt) {
        return Response.json({
          error: language === "es" ? "Describe el agente en al menos 8 caracteres." : "Describe the agent in at least 8 characters.",
        }, { status: 400 });
      }
      const limit = await assertOrgWithinLimits({
        organizationId: orgId,
        plan: ctx.organization.plan as IrisPlanId,
        orgStatus: ctx.organization.status,
        budgetCentsMonthly: ctx.organization.budgetCentsMonthly,
        action: "agent_create",
        agentCount: state.agents.filter(item => item.status === "approved" || item.status === "awaiting_approval").length,
      });
      if (!limit.allowed) {
        await logAudit(user.email, "IRIS_CREATOR", orgId, "DENIED", { reason: limit.code }, orgId);
        return Response.json({ error: limit.detail, code: limit.code }, { status: 402 });
      }
      const agent = designAgentFromPrompt({
        id: crypto.randomUUID(),
        prompt,
        language,
        schedule: body.schedule as AgentSchedule | undefined,
      });
      const next = addCreatedAgent(state, agent);
      await persist(next);
      await recordUsageEvent({ organizationId: orgId, actorEmail: user.email, kind: "agent_create", metadata: { agentId: agent.id } });
      await logAudit(user.email, "IRIS_CREATOR_DESIGNED", agent.id, "SUCCESS", {
        status: agent.status,
        specialty: agent.blueprint.specialty,
        sandboxPassed: agent.sandbox.passed,
        organizationId: orgId,
      }, orgId);
      return Response.json({ ...deskPayload(next, language), created: agent, organizationId: orgId });
    }

    if (body.action === "approve") {
      const result = approveCreatedAgent(state, String(body.agentId || ""), user.email);
      await persist(result.state);
      await logAudit(user.email, "IRIS_CREATOR_APPROVED", result.agent.id, "SUCCESS", {
        specialty: result.agent.blueprint.specialty,
        schedule: result.agent.schedule,
      });
      return Response.json({ ...deskPayload(result.state, language), approved: result.agent, organizationId: orgId });
    }

    if (body.action === "reject") {
      const result = rejectCreatedAgent(state, String(body.agentId || ""));
      await persist(result.state);
      await logAudit(user.email, "IRIS_CREATOR_REJECTED", result.agent.id, "SUCCESS", {
        specialty: result.agent.blueprint.specialty,
      });
      return Response.json({ ...deskPayload(result.state, language), rejected: result.agent, organizationId: orgId });
    }

    if (body.action === "pause") {
      const result = pauseCreatedAgent(state, String(body.agentId || ""));
      await persist(result.state);
      await logAudit(user.email, "IRIS_CREATOR_PAUSED", result.agent.id, "SUCCESS", {
        specialty: result.agent.blueprint.specialty,
      });
      return Response.json({ ...deskPayload(result.state, language), paused: result.agent, organizationId: orgId });
    }

    if (body.action === "cancel") {
      const result = cancelCreatedAgent(state, String(body.agentId || ""));
      await persist(result.state);
      await logAudit(user.email, "IRIS_CREATOR_CANCELLED", result.agent.id, "SUCCESS", {
        specialty: result.agent.blueprint.specialty,
      });
      return Response.json({ ...deskPayload(result.state, language), cancelled: result.agent, organizationId: orgId });
    }

    if (body.action === "run_cycle") {
      const limit = await assertOrgWithinLimits({
        organizationId: orgId,
        plan: ctx.organization.plan as IrisPlanId,
        orgStatus: ctx.organization.status,
        budgetCentsMonthly: ctx.organization.budgetCentsMonthly,
        action: "agent_run",
        agentCount: state.agents.filter(item => item.status === "approved").length,
      });
      const memoryLoaded = await loadOrgDeskValue({ kind: "memory", organizationId: orgId, email: user.email });
      const memory = memoryLoaded.value ? parseMemoryStore(memoryLoaded.value) : emptyMemoryStore();
      const cycle = runPersistentAgentCycle({
        state,
        limits: { allowed: limit.allowed, code: limit.code, detail: limit.detail },
        language,
        memory,
      });
      await persist(cycle.state);
      if (cycle.ran > 0) {
        await recordUsageEvent({
          organizationId: orgId,
          actorEmail: user.email,
          kind: "agent_run",
          quantity: cycle.ran,
          estimatedCostCents: cycle.estimatedCostCents,
          metadata: { action: "run_cycle", blocked: cycle.blocked, skipped: cycle.skipped, chargeEnabled: false },
        });
      }
      await logAudit(user.email, "IRIS_CREATOR_CYCLE", orgId, limit.allowed ? "SUCCESS" : "DENIED", {
        ran: cycle.ran,
        blocked: cycle.blocked,
        skipped: cycle.skipped,
        estimatedCostCents: cycle.estimatedCostCents,
        appliedToRepo: false,
        selfModifiedCore: false,
        limitCode: limit.code,
      }, orgId);
      return Response.json({
        ...deskPayload(cycle.state, language),
        cycle: {
          ranAt: cycle.ranAt,
          ran: cycle.ran,
          blocked: cycle.blocked,
          skipped: cycle.skipped,
          estimatedCostCents: cycle.estimatedCostCents,
          activity: cycle.activity,
          appliedToRepo: false,
          selfModifiedCore: false,
          limits: limit,
        },
        organizationId: orgId,
      });
    }

    if (body.action === "run_task") {
      const agentId = String(body.agentId || "");
      const agent = state.agents.find(item => item.id === agentId);
      if (!agent) throw new Error("Agent not found");
      const task = String(body.task || "") as AgentTaskKind;
      const limit = await assertOrgWithinLimits({
        organizationId: orgId,
        plan: ctx.organization.plan as IrisPlanId,
        orgStatus: ctx.organization.status,
        budgetCentsMonthly: ctx.organization.budgetCentsMonthly,
        action: "agent_run",
        agentCount: state.agents.filter(item => item.status === "approved").length,
      });
      if (!limit.allowed) {
        await logAudit(user.email, "IRIS_CREATOR_TASK", agentId, "DENIED", { reason: limit.code, task }, orgId);
        return Response.json({ error: limit.detail, code: limit.code }, { status: 402 });
      }
      const memoryLoaded = await loadOrgDeskValue({ kind: "memory", organizationId: orgId, email: user.email });
      const memory = memoryLoaded.value ? parseMemoryStore(memoryLoaded.value) : emptyMemoryStore();
      const result = runAuthorizedAgentTask({
        agent,
        task,
        payload: body.payload || {},
        memory,
        language,
      });
      let nextState = state;
      if (result.ok && task === "enqueue_proposal" && result.output.proposal) {
        const proposal = result.output.proposal as ReturnType<typeof buildImprovementProposal>;
        const queued = addAgentProposal(state, agentId, proposal);
        nextState = queued.state;
        await persist(nextState);
      }
      if (result.ok) {
        await recordUsageEvent({
          organizationId: orgId,
          actorEmail: user.email,
          kind: "agent_run",
          quantity: 1,
          estimatedCostCents: 1,
          metadata: { action: "run_task", task, agentId, chargeEnabled: false },
        });
      }
      await logAudit(user.email, "IRIS_CREATOR_TASK", agentId, result.ok ? "SUCCESS" : "DENIED", {
        task,
        appliedToRepo: false,
        requiresHumanApproval: result.requiresHumanApproval,
        error: result.error || null,
      }, orgId);
      return Response.json({
        ...deskPayload(nextState, language),
        taskResult: result,
        organizationId: orgId,
      });
    }

    if (body.action === "propose_improvement") {
      const agentId = String(body.agentId || "");
      const agent = state.agents.find(item => item.id === agentId);
      if (!agent) throw new Error("Agent not found");
      const proposal = buildImprovementProposal({
        id: crypto.randomUUID(),
        agent,
        type: body.proposalType as ProposalType | undefined,
        language,
      });
      const result = addAgentProposal(state, agentId, proposal);
      await persist(result.state);
      await logAudit(user.email, "IRIS_CREATOR_PROPOSAL", proposal.id, "SUCCESS", {
        agentId,
        type: proposal.type,
        status: proposal.status,
      });
      return Response.json({ ...deskPayload(result.state, language), proposal: result.proposal });
    }

    if (body.action === "approve_proposal" || body.action === "reject_proposal") {
      const decision = body.action === "approve_proposal" ? "approve" : "reject";
      const result = decideAgentProposal(
        state,
        String(body.agentId || ""),
        String(body.proposalId || ""),
        decision,
        user.email,
      );
      await persist(result.state);
      await logAudit(
        user.email,
        decision === "approve" ? "IRIS_CREATOR_PROPOSAL_APPROVED" : "IRIS_CREATOR_PROPOSAL_REJECTED",
        result.proposal.id,
        "SUCCESS",
        {
          agentId: result.agent.id,
          type: result.proposal.type,
          applied: false,
        },
      );
      return Response.json({ ...deskPayload(result.state, language), proposal: result.proposal });
    }

    return Response.json({ error: "Unknown action" }, { status: 400 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "creator";
    await logAudit(user.email, "IRIS_CREATOR_DENIED", String(body.agentId || "creator"), "DENIED", { message, action: body.action });
    return Response.json({ error: message }, { status: 400 });
  }
}
