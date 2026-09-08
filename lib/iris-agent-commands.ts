import { eq } from "drizzle-orm";
import { getDb } from "../db";
import { appSettings } from "../db/schema";
import { AGENT_COMMAND_CODES, commandsForAlert, type AgentCommandCode } from "./iris-live-soc";

export { AGENT_COMMAND_CODES, commandsForAlert };
export type { AgentCommandCode };

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

export function commandsForAlert(code: string, language: "es" | "en") {
  const es = language === "es";
  const label = code.replaceAll("_", " ");
  const notify = {
    code: "NOTIFY" as const,
    title: "IRIS",
    message: es ? `IRIS detectó ${label}. Abre el centro de control.` : `IRIS detected ${label}. Open the command center.`,
  };
  const reverify = {
    code: "REVERIFY" as const,
    title: "IRIS",
    message: es ? "IRIS pide un nuevo reporte de seguridad." : "IRIS requested a fresh security report.",
  };
  if (code === "FIREWALL_DISABLED") {
    return [
      notify,
      {
        code: "ENABLE_FIREWALL" as const,
        title: "IRIS",
        message: es ? "IRIS va a activar el firewall. macOS puede pedir tu contraseña." : "IRIS will enable the firewall. macOS may ask for your password.",
      },
      reverify,
    ];
  }
  return [notify, reverify];
}

export async function queueAgentCommands(deviceId: string, actorEmail: string, drafts: ReturnType<typeof commandsForAlert>, alertId?: string) {
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
