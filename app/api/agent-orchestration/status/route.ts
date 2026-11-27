import { getChatGPTUser } from "../../../chatgpt-auth";
import { findIrisUser, logAudit, provisionIrisUser } from "../../../../lib/authz";
import { ensureAgentsWorking, ORCHESTRATED_AGENTS, setAgentRuntimeStatus, startAgentWorkflow } from "../../../../lib/agent-orchestration";
import { requireStepUp } from "../../../../lib/iris-step-up";

export const dynamic = "force-dynamic";

type AgentState = "QUEUED" | "RUNNING" | "DONE" | "FAILED";

async function currentUser() {
  const identity = await getChatGPTUser();
  if (!identity) return null;
  // findIrisUser devuelve una promesa: sin await, `??` nunca caía en
  // provisionIrisUser y un usuario aún no creado recibía 401.
  return (await findIrisUser(identity)) ?? provisionIrisUser(identity);
}

export async function GET() {
  const user = await currentUser();
  if (!user || user.status !== "ACTIVE") return Response.json({ error: "Unauthorized" }, { status: 401 });
  const stepUp = await requireStepUp(user.email);
  if (stepUp) return stepUp;
  const agents = await ensureAgentsWorking(user.email);
  return Response.json({
    enabled: true,
    name: "iris-secure-access-agent-orchestration",
    refreshedAt: new Date().toISOString(),
    agents,
  });
}

export async function POST(request: Request) {
  const user = await currentUser();
  if (!user || user.status !== "ACTIVE") return Response.json({ error: "Unauthorized" }, { status: 401 });
  const stepUp = await requireStepUp(user.email);
  if (stepUp) return stepUp;
  if (user.role !== "ADMIN") return Response.json({ error: "Administrator approval required" }, { status: 403 });

  const body = await request.json().catch(() => ({})) as { action?: string };
  if (body.action !== "start") return Response.json({ error: "Unsupported request" }, { status: 400 });
  await startAgentWorkflow(user.email);
  await logAudit(user.email, "AGENT_WORKFLOW_STARTED", "agent_orchestration", "SUCCESS");
  const agents = await ensureAgentsWorking(user.email);
  return Response.json({ ok: true, agents });
}

export async function PATCH(request: Request) {
  const user = await currentUser();
  if (!user || user.status !== "ACTIVE") return Response.json({ error: "Unauthorized" }, { status: 401 });
  const stepUp = await requireStepUp(user.email);
  if (stepUp) return stepUp;
  if (user.role !== "ADMIN") return Response.json({ error: "Administrator approval required" }, { status: 403 });

  const body = await request.json().catch(() => ({})) as { agentId?: string; status?: string };
  const agentId = String(body.agentId || "");
  const status = String(body.status || "") as AgentState;
  if (!ORCHESTRATED_AGENTS.some(agent => agent.id === agentId)) return Response.json({ error: "Invalid agent id" }, { status: 400 });
  if (!["QUEUED", "RUNNING", "DONE", "FAILED"].includes(status)) return Response.json({ error: "Invalid status" }, { status: 400 });

  await setAgentRuntimeStatus(agentId, status, user.email);
  await logAudit(user.email, "AGENT_RUNTIME_STATUS_UPDATED", agentId, "SUCCESS", { status });
  return Response.json({ ok: true });
}
