import { eq } from "drizzle-orm";
import { getDb } from "../db";
import { appSettings } from "../db/schema";
import { AGENT_COMMAND_CODES, type AgentCommandCode } from "./iris-live-soc";

export type { AgentCommandCode };
type CommandDraft = { code: AgentCommandCode; title: string; message: string };

export type AgentCommand = {
  id: string;
  code: AgentCommandCode;
  title: string;
  message: string;
  status: "PENDING" | "DELIVERED";
  alertId?: string;
  createdAt: string;
  approvedBy: string;
};

function commandsKey(deviceId: string) {
  return `iris_agent_commands:${deviceId}`;
}

function parseCommands(value: string | null | undefined): AgentCommand[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value) as AgentCommand[];
    return Array.isArray(parsed) ? parsed.filter(item => item && AGENT_COMMAND_CODES.includes(item.code) && item.id) : [];
  } catch {
    return [];
  }
}

export async function queueAgentCommands(deviceId: string, actorEmail: string, drafts: CommandDraft[], alertId?: string) {
  const key = commandsKey(deviceId);
  const db = getDb();
  const [row] = await db.select().from(appSettings).where(eq(appSettings.key, key)).limit(1);
  const existing = parseCommands(row?.value);
  const now = new Date().toISOString();
  const next = [
    ...drafts.map(draft => ({
      id: crypto.randomUUID(),
      code: draft.code,
      title: draft.title,
      message: draft.message,
      status: "PENDING" as const,
      alertId,
      createdAt: now,
      approvedBy: actorEmail,
    })),
    ...existing,
  ].slice(0, 40);
  await db.insert(appSettings).values({
    key,
    value: JSON.stringify(next),
    updatedBy: actorEmail,
    updatedAt: now,
  }).onConflictDoUpdate({
    target: appSettings.key,
    set: { value: JSON.stringify(next), updatedBy: actorEmail, updatedAt: now },
  });
  return next.filter(item => item.status === "PENDING");
}

export async function takePendingAgentCommands(deviceId: string) {
  const key = commandsKey(deviceId);
  const db = getDb();
  const [row] = await db.select().from(appSettings).where(eq(appSettings.key, key)).limit(1);
  const existing = parseCommands(row?.value);
  const pending = existing.filter(item => item.status === "PENDING");
  if (!pending.length) return [];
  const now = new Date().toISOString();
  const delivered = existing.map(item => item.status === "PENDING" ? { ...item, status: "DELIVERED" as const } : item);
  await db.insert(appSettings).values({
    key,
    value: JSON.stringify(delivered),
    updatedBy: "iris.agent",
    updatedAt: now,
  }).onConflictDoUpdate({
    target: appSettings.key,
    set: { value: JSON.stringify(delivered), updatedBy: "iris.agent", updatedAt: now },
  });
  return pending.map(({ id, code, title, message }) => ({ id, code, title, message }));
}
