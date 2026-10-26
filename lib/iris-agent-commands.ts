import { eq } from "drizzle-orm";
import { getDb } from "../db";
import { appSettings } from "../db/schema";
import {
  applyCommandResults,
  parseAgentCommands,
  type AgentCommand,
  type AgentCommandResultInput,
} from "./iris-agent-command-state.ts";
import { type AgentCommandCode } from "./iris-live-soc";

export type { AgentCommandCode };
export {
  AGENT_COMMAND_STATUSES,
  applyCommandResults,
  commandStatusLabel,
  parseAgentCommands,
  type AgentCommand,
  type AgentCommandResultInput,
  type AgentCommandStatus,
} from "./iris-agent-command-state.ts";

type CommandDraft = { code: AgentCommandCode; title: string; message: string };

function commandsKey(deviceId: string) {
  return `iris_agent_commands:${deviceId}`;
}

async function saveCommands(deviceId: string, commands: AgentCommand[], actorEmail: string) {
  const key = commandsKey(deviceId);
  const now = new Date().toISOString();
  const value = JSON.stringify(commands.slice(0, 40));
  const db = getDb();
  await db.insert(appSettings).values({
    key,
    value,
    updatedBy: actorEmail,
    updatedAt: now,
  }).onConflictDoUpdate({
    target: appSettings.key,
    set: { value, updatedBy: actorEmail, updatedAt: now },
  });
}

export async function listAgentCommands(deviceId: string) {
  const key = commandsKey(deviceId);
  const db = getDb();
  const [row] = await db.select().from(appSettings).where(eq(appSettings.key, key)).limit(1);
  return parseAgentCommands(row?.value);
}

export async function listAgentCommandsForDevices(deviceIds: string[]) {
  const unique = [...new Set(deviceIds.filter(Boolean))];
  const rows = await Promise.all(unique.map(async deviceId => ({
    deviceId,
    commands: await listAgentCommands(deviceId),
  })));
  return rows.flatMap(row => row.commands.map(command => ({ ...command, deviceId: row.deviceId })));
}

export async function queueAgentCommands(deviceId: string, actorEmail: string, drafts: CommandDraft[], alertId?: string) {
  const existing = await listAgentCommands(deviceId);
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
  await saveCommands(deviceId, next, actorEmail);
  return next.filter(item => item.status === "PENDING");
}

export async function takePendingAgentCommands(deviceId: string) {
  const existing = await listAgentCommands(deviceId);
  const pending = existing.filter(item => item.status === "PENDING");
  if (!pending.length) return [];
  const now = new Date().toISOString();
  const delivered = existing.map(item => item.status === "PENDING"
    ? { ...item, status: "DELIVERED" as const, deliveredAt: now }
    : item);
  await saveCommands(deviceId, delivered, "iris.agent");
  return pending.map(({ id, code, title, message }) => ({ id, code, title, message }));
}

export async function acknowledgeAgentCommands(deviceId: string, results: AgentCommandResultInput[]) {
  const cleaned = (Array.isArray(results) ? results : [])
    .filter(item => item && typeof item.id === "string" && ["ACKED", "EXECUTED", "FAILED"].includes(item.status))
    .map(item => ({
      id: String(item.id).slice(0, 80),
      status: item.status as AgentCommandResultInput["status"],
      detail: typeof item.detail === "string" ? item.detail.slice(0, 240) : undefined,
    }))
    .slice(0, 20);
  if (!cleaned.length) return [];
  const existing = await listAgentCommands(deviceId);
  const applied = applyCommandResults(existing, cleaned);
  if (!applied.updated.length) return [];
  await saveCommands(deviceId, applied.commands, "iris.agent");
  return applied.updated;
}
