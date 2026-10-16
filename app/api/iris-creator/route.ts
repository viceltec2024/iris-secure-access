import { eq } from "drizzle-orm";
import { getChatGPTUser } from "../../chatgpt-auth";
import { getDb } from "../../../db";
import { appSettings } from "../../../db/schema";
import { logAudit, provisionIrisUser } from "../../../lib/authz";
import {
  addCreatedAgent,
  approveCreatedAgent,
  designAgentFromPrompt,
  emptyCreatorDesk,
  normalizeCreatorPrompt,
  parseCreatorDesk,
  pauseCreatedAgent,
  rejectCreatedAgent,
  tickApprovedAgents,
  type AgentSchedule,
  type CreatorDeskState,
} from "../../../lib/iris-creator";

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

export async function GET() {
  const user = await currentUser();
  if (!user || user.status !== "ACTIVE") return Response.json({ error: "Unauthorized" }, { status: 401 });
  const { key, state } = await loadDesk(user.email);
  const next = tickApprovedAgents(state);
  if (JSON.stringify(next) !== JSON.stringify(state)) await saveDesk(user.email, key, next);
  return Response.json(next);
}

export async function POST(request: Request) {
  const user = await currentUser();
  if (!user || user.status !== "ACTIVE") return Response.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json().catch(() => ({})) as {
    action?: string;
    prompt?: string;
    language?: string;
    schedule?: string;
    agentId?: string;
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
      return Response.json({ ...next, created: agent });
    }

    if (body.action === "approve") {
      const result = approveCreatedAgent(state, String(body.agentId || ""), user.email);
      await saveDesk(user.email, key, result.state);
      await logAudit(user.email, "IRIS_CREATOR_APPROVED", result.agent.id, "SUCCESS", {
        specialty: result.agent.blueprint.specialty,
        schedule: result.agent.schedule,
      });
      return Response.json({ ...result.state, approved: result.agent });
    }

    if (body.action === "reject") {
      const result = rejectCreatedAgent(state, String(body.agentId || ""));
      await saveDesk(user.email, key, result.state);
      await logAudit(user.email, "IRIS_CREATOR_REJECTED", result.agent.id, "SUCCESS", {
        specialty: result.agent.blueprint.specialty,
      });
      return Response.json({ ...result.state, rejected: result.agent });
    }

    if (body.action === "pause") {
      const result = pauseCreatedAgent(state, String(body.agentId || ""));
      await saveDesk(user.email, key, result.state);
      await logAudit(user.email, "IRIS_CREATOR_PAUSED", result.agent.id, "SUCCESS", {
        specialty: result.agent.blueprint.specialty,
      });
      return Response.json({ ...result.state, paused: result.agent });
    }

    return Response.json({ error: "Unknown action" }, { status: 400 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "creator";
    await logAudit(user.email, "IRIS_CREATOR_DENIED", String(body.agentId || "creator"), "DENIED", { message, action: body.action });
    return Response.json({ error: message }, { status: 400 });
  }
}
