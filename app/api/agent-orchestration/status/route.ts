import { inArray } from "drizzle-orm";
import { getChatGPTUser } from "../../../chatgpt-auth";
import { getDb } from "../../../../db";
import { appSettings } from "../../../../db/schema";
import { logAudit, provisionIrisUser } from "../../../../lib/authz";

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

function parseState(value: string | null | undefined): AgentState | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as { status?: string };
    return ["QUEUED", "RUNNING", "DONE", "FAILED"].includes(parsed.status || "") ? parsed.status as AgentState : null;
  } catch {
    return null;
  }
}

function parseMeta(value: string | null | undefined): { updatedAt: string | null; updatedBy: string | null } {
  if (!value) return { updatedAt: null, updatedBy: null };
  try {
    const parsed = JSON.parse(value) as { updatedAt?: string; updatedBy?: string };
    return { updatedAt: typeof parsed.updatedAt === "string" ? parsed.updatedAt : null, updatedBy: typeof parsed.updatedBy === "string" ? parsed.updatedBy : null };
  } catch {
    return { updatedAt: null, updatedBy: null };
  }
}

async function currentUser() {
  const identity = await getChatGPTUser();
  return identity ? provisionIrisUser(identity) : null;
}

export async function GET() {
  const user = await currentUser();
  if (!user || user.status !== "ACTIVE") return Response.json({ error: "Unauthorized" }, { status: 401 });

  const keys = AGENTS.map(agent => statusKey(agent.id));
  const rows = await getDb().select().from(appSettings).where(inArray(appSettings.key, keys));
  const mapped = new Map(rows.map(row => [row.key, row.value]));
  const agents = AGENTS.map(agent => {
    const raw = mapped.get(statusKey(agent.id));
    const status = parseState(raw) || agent.defaultState;
    const meta = parseMeta(raw);
    return { id: agent.id, role: agent.role, status, updatedAt: meta.updatedAt, updatedBy: meta.updatedBy };
  });
  return Response.json({ enabled: true, refreshedAt: new Date().toISOString(), agents });
}

export async function PATCH(request: Request) {
  const user = await currentUser();
  if (!user || user.status !== "ACTIVE") return Response.json({ error: "Unauthorized" }, { status: 401 });
  if (user.role !== "ADMIN") return Response.json({ error: "Administrator approval required" }, { status: 403 });

  const body = await request.json().catch(() => ({})) as { agentId?: string; status?: string };
  const agentId = String(body.agentId || "");
  const status = String(body.status || "");
  if (!AGENTS.some(agent => agent.id === agentId)) return Response.json({ error: "Invalid agent id" }, { status: 400 });
  if (!["QUEUED", "RUNNING", "DONE", "FAILED"].includes(status)) return Response.json({ error: "Invalid status" }, { status: 400 });

  const value = JSON.stringify({ status, updatedAt: new Date().toISOString(), updatedBy: user.email });
  await getDb().insert(appSettings).values({ key: statusKey(agentId), value, updatedBy: user.email, updatedAt: new Date().toISOString() }).onConflictDoUpdate({ target: appSettings.key, set: { value, updatedBy: user.email, updatedAt: new Date().toISOString() } });
  await logAudit(user.email, "AGENT_RUNTIME_STATUS_UPDATED", agentId, "SUCCESS", { status });
  return Response.json({ ok: true });
}
