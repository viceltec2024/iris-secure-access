import { AGENT_COMMAND_CODES, type AgentCommandCode } from "./iris-live-soc.ts";

export type { AgentCommandCode };

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

export function isCommandStatus(value: unknown): value is AgentCommandStatus {
  return typeof value === "string" && (AGENT_COMMAND_STATUSES as readonly string[]).includes(value);
}

export function parseAgentCommands(value: string | null | undefined): AgentCommand[] {
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
