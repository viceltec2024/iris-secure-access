import { eq } from "drizzle-orm";
import { getDb } from "../db";
import { appSettings } from "../db/schema";
import { AGENT_COMMAND_CODES, type AgentCommandCode } from "./iris-live-soc";

export type { AgentCommandCode };
type CommandDraft = { code: AgentCommandCode; title: string; message: string };

export const AGENT_COMMAND_STATUSES = [
  "PENDING",
  "DELIVERED",
  "ACKED",
  "EXECUTED",
  "FAILED",
] as const;

export type AgentCommandStatus = (typeof AGENT_COMMAND_STATUSES)[number];

export type AgentCommand = {
  id: string;
  code: AgentCommandCode;
  title: string;
  message: string;
  status: AgentCommandStatus;
  alertId?: string;
  createdAt: string;
  approvedBy: string;
  deliveredAt?: string;
  acknowledgedAt?: string;
  resultDetail?: string;
};

export type AgentCommandResultInput = {
  id: string;
  status: "ACKED" | "EXECUTED" | "FAILED";
  detail?: string;
};

function commandsKey(deviceId: string) {
  return `iris_agent_commands:${deviceId}`;
}

function isCommandStatus(value: unknown): value is AgentCommandStatus {
  return typeof value === "string" && (AGENT_COMMAND_STATUSES as readonly string[]).includes(value);
}

function parseCommands(value: string | null | undefined): AgentCommand[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value) as AgentCommand[];
    return Array.isArray(parsed)
      ? parsed.filter(item => item && AGENT_COMMAND_CODES.includes(item.code) && item.id && isCommandStatus(item.status))
      : [];
  } catch {
    return [];
  }
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
  return parseCommands(row?.value);
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

/** Apply Mac agent ACK/EXECUTED/FAILED results for previously delivered commands. */
export function applyCommandResults(
  commands: AgentCommand[],
  results: AgentCommandResultInput[],
  now = new Date().toISOString(),
) {
  if (!results.length) return { commands, updated: [] as AgentCommand[] };
  const byId = new Map(results.map(item => [item.id, item]));
  const updated: AgentCommand[] = [];
  const next = commands.map(command => {
    const result = byId.get(command.id);
    if (!result) return command;
    if (command.status === "PENDING") return command;
    if (command.status === "EXECUTED" || command.status === "FAILED") return command;
    const status = result.status;
    const patched: AgentCommand = {
      ...command,
      status,
      acknowledgedAt: now,
      resultDetail: String(result.detail || "").slice(0, 240) || undefined,
    };
    updated.push(patched);
    return patched;
  });
  return { commands: next, updated };
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

export function commandStatusLabel(status: AgentCommandStatus, language: "es" | "en" = "es") {
  const map = {
    PENDING: { es: "Pendiente", en: "Pending" },
    DELIVERED: { es: "Entregado", en: "Delivered" },
    ACKED: { es: "Recibido", en: "Acknowledged" },
    EXECUTED: { es: "Ejecutado", en: "Executed" },
    FAILED: { es: "Falló", en: "Failed" },
  } as const;
  return map[status][language];
}
