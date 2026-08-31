import { inArray } from "drizzle-orm";
import { getChatGPTUser } from "../../../chatgpt-auth";
import { getDb } from "../../../../db";
import { appSettings } from "../../../../db/schema";
import { findIrisUser, logAudit } from "../../../../lib/authz";

type AgentState = "QUEUED" | "RUNNING" | "DONE" | "FAILED";
type AgentConfig = { id: string; role: string; defaultState: AgentState };

const AGENTS: AgentConfig[] = [
  { id: "architect", role: "Agente Arquitecto", defaultState: "DONE" },
  { id: "backend-auth", role: "Agente Backend/Auth", defaultState: "RUNNING" },
  { id: "frontend-ux", role: "Agente Frontend/UX", defaultState: "RUNNING" },
  { id: "qa-ci", role: "Agente QA/CI", defaultState: "QUEUED" },
  { id: "security", role: "Agente Security", defaultState: "QUEUED" },
];

const STATUS_KEY_PREFIX = "iris_agent_runtime_status:";

function statusKey(agentId: string) {
  return `${STATUS_KEY_PREFIX}${agentId}`;
}

function parseStoredValue(value: string | null | undefined): { status: AgentState | null; updatedAt: string | null; updatedBy: string | null } {
  if (!value) return { status: null, updatedAt: null, updatedBy: null };
  try {
    const parsed = JSON.parse(value) as { status?: string; updatedAt?: string; updatedBy?: string };
    return {
      status: ["QUEUED", "RUNNING", "DONE", "FAILED"].includes(parsed.status || "") ? parsed.status as AgentState : null,
      updatedAt: typeof parsed.updatedAt === "string" ? parsed.updatedAt : null,
      updatedBy: typeof parsed.updatedBy === "string" ? parsed.updatedBy : null,
    };
  } catch {
    return { status: null, updatedAt: null, updatedBy: null };
  }
}

async function resolveCurrentUser() {
  const identity = await getChatGPTUser();
  return identity ? findIrisUser(identity) : null;
}

export async function GET() {
  const user = await resolveCurrentUser();
  if (!user || user.status !== "ACTIVE") return Response.json({ error: "Unauthorized" }, { status: 401 });

  const keys = AGENTS.map(agent => statusKey(agent.id));
  const rows = await getDb().select().from(appSettings).where(inArray(appSettings.key, keys));
  const mapped = new Map(rows.map(row => [row.key, row.value]));
  const agents = AGENTS.map(agent => {
    const parsed = parseStoredValue(mapped.get(statusKey(agent.id)));
    return { id: agent.id, role: agent.role, status: parsed.status || agent.defaultState, updatedAt: parsed.updatedAt, updatedBy: parsed.updatedBy };
  });
  return Response.json({ enabled: true, refreshedAt: new Date().toISOString(), agents });
}

export async function PATCH(request: Request) {
  const user = await resolveCurrentUser();
  if (!user || user.status !== "ACTIVE") return Response.json({ error: "Unauthorized" }, { status: 401 });
  if (user.role !== "ADMIN") return Response.json({ error: "Administrator approval required" }, { status: 403 });

  const body = await request.json().catch(() => ({})) as { agentId?: string; status?: string };
  const agentId = String(body.agentId || "");
  const status = String(body.status || "");
  if (!AGENTS.some(agent => agent.id === agentId)) return Response.json({ error: "Invalid agent id" }, { status: 400 });
  if (!["QUEUED", "RUNNING", "DONE", "FAILED"].includes(status)) return Response.json({ error: "Invalid status" }, { status: 400 });

  const now = new Date().toISOString();
  const value = JSON.stringify({ status, updatedAt: now, updatedBy: user.email });
  await getDb().insert(appSettings).values({ key: statusKey(agentId), value, updatedBy: user.email, updatedAt: now }).onConflictDoUpdate({ target: appSettings.key, set: { value, updatedBy: user.email, updatedAt: now } });
  await logAudit(user.email, "AGENT_RUNTIME_STATUS_UPDATED", agentId, "SUCCESS", { status });
  return Response.json({ ok: true });
}
