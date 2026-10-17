import { eq } from "drizzle-orm";
import { env } from "cloudflare:workers";
import { getChatGPTUser } from "../../chatgpt-auth";
import { getDb } from "../../../db";
import { appSettings } from "../../../db/schema";
import { logAudit, provisionIrisUser } from "../../../lib/authz";
import {
  addAgentProposal,
  addCreatedAgent,
  approveCreatedAgent,
  buildImprovementProposal,
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
import { buildModelCoordinationReport } from "../../../lib/iris-model-registry";
import { enforceRateLimit } from "../../../lib/rate-limit";

export const dynamic = "force-dynamic";

const DESK_KEY = "iris_creator_desk";

async function currentUser() {
  const identity = await getChatGPTUser();
  return identity ? provisionIrisUser(identity) : null;
}

async function loadDesk(email: string) {
  const key = `${DESK_KEY}:${email}`;
  const [row] = await getDb().select().from(appSettings).where(eq(appSettings.key, key)).limit(1);
  return { key, state: row ? parseCreatorDesk(row.value) : emptyCreatorDesk() };
}

async function saveDesk(email: string, key: string, state: CreatorDeskState) {
  const now = new Date().toISOString();
  await getDb().insert(appSettings).values({ key, value: JSON.stringify(state), updatedBy: email, updatedAt: now }).onConflictDoUpdate({
    target: appSettings.key,
    set: { value: JSON.stringify(state), updatedBy: email, updatedAt: now },
  });
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
  const { key, state } = await loadDesk(user.email);
  const next = tickApprovedAgents(state);
  if (JSON.stringify(next) !== JSON.stringify(state)) await saveDesk(user.email, key, next);
  return Response.json(deskPayload(next, language));
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
  };

  const { key, state } = await loadDesk(user.email);
  const language = body.language === "en" ? "en" : "es";

  try {
    if (body.action === "create") {
      const prompt = normalizeCreatorPrompt(body.prompt);
      if (!prompt) {
        return Response.json({
          error: language === "es" ? "Describe el agente en al menos 8 caracteres." : "Describe the agent in at least 8 characters.",
        }, { status: 400 });
      }
      const agent = designAgentFromPrompt({
        id: crypto.randomUUID(),
        prompt,
        language,
        schedule: body.schedule as AgentSchedule | undefined,
      });
      const next = addCreatedAgent(state, agent);
      await saveDesk(user.email, key, next);
      await logAudit(user.email, "IRIS_CREATOR_DESIGNED", agent.id, "SUCCESS", {
        status: agent.status,
        specialty: agent.blueprint.specialty,
        sandboxPassed: agent.sandbox.passed,
      });
      return Response.json({ ...deskPayload(next, language), created: agent });
    }

    if (body.action === "approve") {
      const result = approveCreatedAgent(state, String(body.agentId || ""), user.email);
      await saveDesk(user.email, key, result.state);
      await logAudit(user.email, "IRIS_CREATOR_APPROVED", result.agent.id, "SUCCESS", {
        specialty: result.agent.blueprint.specialty,
        schedule: result.agent.schedule,
      });
      return Response.json({ ...deskPayload(result.state, language), approved: result.agent });
    }

    if (body.action === "reject") {
      const result = rejectCreatedAgent(state, String(body.agentId || ""));
      await saveDesk(user.email, key, result.state);
      await logAudit(user.email, "IRIS_CREATOR_REJECTED", result.agent.id, "SUCCESS", {
        specialty: result.agent.blueprint.specialty,
      });
      return Response.json({ ...deskPayload(result.state, language), rejected: result.agent });
    }

    if (body.action === "pause") {
      const result = pauseCreatedAgent(state, String(body.agentId || ""));
      await saveDesk(user.email, key, result.state);
      await logAudit(user.email, "IRIS_CREATOR_PAUSED", result.agent.id, "SUCCESS", {
        specialty: result.agent.blueprint.specialty,
      });
      return Response.json({ ...deskPayload(result.state, language), paused: result.agent });
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
      await saveDesk(user.email, key, result.state);
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
      await saveDesk(user.email, key, result.state);
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
