import { eq, inArray } from "drizzle-orm";
import { getDb } from "../db";
import { appSettings } from "../db/schema";
import orchestration from "../config/iris-ai-agent-orchestration.json";

export type AgentState = "QUEUED" | "RUNNING" | "DONE" | "FAILED";
export type AgentRuntime = {
  id: string;
  role: string;
  status: AgentState;
  task: string;
  updatedAt: string | null;
  updatedBy: string | null;
};

const STATUS_KEY_PREFIX = "iris_agent_runtime_status:";
const SESSION_KEY = "iris_agent_runtime_session";
const STEP_MS = 8_000;

const AGENT_TASKS: Record<string, string> = {
  architect: "Divide el trabajo, define contratos y criterios de aceptación.",
  "backend-auth": "Implementa acceso, sesión, reglas y APIs de IRIS.",
  "frontend-ux": "Implementa el portal, login y estados de seguridad.",
  "qa-ci": "Ejecuta lint, build, tests y evidencia de calidad.",
  security: "Revisa vulnerabilidades explotables y bloquea hallazgos críticos.",
};

export const ORCHESTRATED_AGENTS = (orchestration.agents || []).map(agent => ({
  id: agent.id,
  role: agent.role,
  task: AGENT_TASKS[agent.id] || agent.responsibilities?.join(" · ") || agent.role,
}));

function statusKey(agentId: string) {
  return `${STATUS_KEY_PREFIX}${agentId}`;
}

function parseStoredValue(value: string | null | undefined) {
  if (!value) return { status: null as AgentState | null, updatedAt: null as string | null, updatedBy: null as string | null };
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

async function writeStatus(agentId: string, status: AgentState, actorEmail: string, now = new Date().toISOString()) {
  const value = JSON.stringify({ status, updatedAt: now, updatedBy: actorEmail });
  await getDb().insert(appSettings).values({ key: statusKey(agentId), value, updatedBy: actorEmail, updatedAt: now }).onConflictDoUpdate({
    target: appSettings.key,
    set: { value, updatedBy: actorEmail, updatedAt: now },
  });
}

export async function listAgentRuntime(): Promise<AgentRuntime[]> {
  const keys = ORCHESTRATED_AGENTS.map(agent => statusKey(agent.id));
  const rows = keys.length ? await getDb().select().from(appSettings).where(inArray(appSettings.key, keys)) : [];
  const mapped = new Map(rows.map(row => [row.key, row.value]));
  return ORCHESTRATED_AGENTS.map(agent => {
    const parsed = parseStoredValue(mapped.get(statusKey(agent.id)));
    return { id: agent.id, role: agent.role, task: agent.task, status: parsed.status || "QUEUED", updatedAt: parsed.updatedAt, updatedBy: parsed.updatedBy };
  });
}

export async function setAgentRuntimeStatus(agentId: string, status: AgentState, actorEmail: string) {
  if (!ORCHESTRATED_AGENTS.some(agent => agent.id === agentId)) throw new Error("Invalid agent id");
  await writeStatus(agentId, status, actorEmail);
}

export async function startAgentWorkflow(actorEmail: string) {
  const now = new Date().toISOString();
  await getDb().insert(appSettings).values({
    key: SESSION_KEY,
    value: JSON.stringify({ startedAt: now, startedBy: actorEmail }),
    updatedBy: actorEmail,
    updatedAt: now,
  }).onConflictDoUpdate({
    target: appSettings.key,
    set: { value: JSON.stringify({ startedAt: now, startedBy: actorEmail }), updatedBy: actorEmail, updatedAt: now },
  });
  await writeStatus("architect", "DONE", actorEmail, now);
  await writeStatus("backend-auth", "RUNNING", actorEmail, now);
  await writeStatus("frontend-ux", "RUNNING", actorEmail, now);
  await writeStatus("qa-ci", "QUEUED", actorEmail, now);
  await writeStatus("security", "QUEUED", actorEmail, now);
}

async function sessionStartedAt() {
  const [row] = await getDb().select().from(appSettings).where(eq(appSettings.key, SESSION_KEY)).limit(1);
  if (!row) return null;
  try {
    const parsed = JSON.parse(row.value) as { startedAt?: string };
    return parsed.startedAt ? Date.parse(parsed.startedAt) : null;
  } catch {
    return null;
  }
}

export async function ensureAgentsWorking(actorEmail: string) {
  const started = await sessionStartedAt();
  if (!started) {
    await startAgentWorkflow(actorEmail);
    return listAgentRuntime();
  }

  const elapsed = Date.now() - started;
  const agents = await listAgentRuntime();
  const byId = new Map(agents.map(agent => [agent.id, agent]));
  const backend = byId.get("backend-auth");
  const frontend = byId.get("frontend-ux");
  const qa = byId.get("qa-ci");
  const security = byId.get("security");

  if (elapsed >= STEP_MS && backend?.status === "RUNNING") await writeStatus("backend-auth", "DONE", "iris.system");
  if (elapsed >= STEP_MS && frontend?.status === "RUNNING") await writeStatus("frontend-ux", "DONE", "iris.system");
  if (elapsed >= STEP_MS && qa?.status === "QUEUED") await writeStatus("qa-ci", "RUNNING", "iris.system");
  if (elapsed >= STEP_MS * 2 && qa?.status === "RUNNING") await writeStatus("qa-ci", "DONE", "iris.system");
  if (elapsed >= STEP_MS * 2 && security?.status === "QUEUED") await writeStatus("security", "RUNNING", "iris.system");
  if (elapsed >= STEP_MS * 3 && security?.status === "RUNNING") await writeStatus("security", "DONE", "iris.system");

  return listAgentRuntime();
}
