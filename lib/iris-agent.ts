import { desc, eq, inArray } from "drizzle-orm";
import { getDb } from "../db";
import { devices, securityAlerts } from "../db/schema";
import { parseJsonRecord, reportedDeviceStatus } from "./iris-device-view.ts";

export type IrisAgentUser = {
  email: string;
  role: "ADMIN" | "USER";
};

export type IrisAgentStep = {
  tool: string;
  arguments: Record<string, unknown>;
  ok: boolean;
};

export const IRIS_AGENT_TOOL_LABELS: Record<string, { es: string; en: string }> = {
  get_security_overview: { es: "Revisé el estado de seguridad", en: "Reviewed security overview" },
  list_active_alerts: { es: "Revisé las alertas activas", en: "Checked active alerts" },
  get_device_details: { es: "Revisé la telemetría del dispositivo", en: "Reviewed device telemetry" },
};

export const IRIS_AGENT_TOOLS = [
  {
    type: "function",
    name: "get_security_overview",
    description: "Get the current IRIS security overview for devices visible to the signed-in user. Status is ONLINE only when the agent reported in the last 5 minutes.",
    parameters: { type: "object", properties: {}, additionalProperties: false },
    strict: true,
  },
  {
    type: "function",
    name: "list_active_alerts",
    description: "List unresolved security alerts for devices visible to the signed-in user. Alerts from OFFLINE devices are last-report findings, not live state.",
    parameters: {
      type: "object",
      properties: { limit: { type: "integer", minimum: 1, maximum: 25 } },
      required: ["limit"],
      additionalProperties: false,
    },
    strict: true,
  },
  {
    type: "function",
    name: "get_device_details",
    description: "Get trusted IRIS telemetry for a specific device visible to the signed-in user. Do not treat stale telemetry as a live scan.",
    parameters: {
      type: "object",
      properties: { deviceId: { type: "string", minLength: 1, maxLength: 120 } },
      required: ["deviceId"],
      additionalProperties: false,
    },
    strict: true,
  },
] as const;

async function visibleDevices(user: IrisAgentUser) {
  const db = getDb();
  return user.role === "ADMIN"
    ? db.select().from(devices).orderBy(desc(devices.createdAt)).limit(50)
    : db.select().from(devices).where(eq(devices.ownerEmail, user.email)).orderBy(desc(devices.createdAt)).limit(50);
}

function deviceSummary(device: { id: string; name: string; platform: string; status: "PENDING" | "ONLINE" | "OFFLINE"; risk: string; lastSeenAt: string | null; agentTokenHash?: string | null }) {
  const status = reportedDeviceStatus(device);
  return {
    id: device.id,
    name: device.name,
    platform: device.platform,
    status,
    risk: device.risk,
    lastSeenAt: device.lastSeenAt,
    reportFresh: status === "ONLINE",
  };
}

export async function runIrisTool(user: IrisAgentUser, name: string, rawArguments: string) {
  let args: Record<string, unknown> = {};
  try { args = JSON.parse(rawArguments || "{}") as Record<string, unknown>; } catch { throw new Error("Invalid tool arguments"); }

  const deviceRows = await visibleDevices(user);
  const visibleIds = deviceRows.map(device => device.id);
  const statusById = new Map(deviceRows.map(device => [device.id, reportedDeviceStatus(device)]));

  if (name === "get_security_overview") {
    const db = getDb();
    const alerts = visibleIds.length
      ? await db.select().from(securityAlerts).where(inArray(securityAlerts.deviceId, visibleIds)).orderBy(desc(securityAlerts.lastSeenAt)).limit(100)
      : [];
    const mapped = deviceRows.map(deviceSummary);
    const unresolved = alerts.filter(alert => alert.status !== "RESOLVED");
    return {
      generatedAt: new Date().toISOString(),
      onlineWindowSeconds: 300,
      devices: mapped,
      activeAlerts: unresolved.map(alert => ({
        id: alert.id,
        deviceId: alert.deviceId,
        code: alert.code,
        severity: alert.severity,
        status: alert.status,
        lastSeenAt: alert.lastSeenAt,
        deviceStatus: statusById.get(alert.deviceId) || "OFFLINE",
        live: statusById.get(alert.deviceId) === "ONLINE",
      })),
    };
  }

  if (name === "list_active_alerts") {
    const limit = Math.max(1, Math.min(25, Number(args.limit) || 10));
    const db = getDb();
    const alerts = visibleIds.length
      ? await db.select().from(securityAlerts).where(inArray(securityAlerts.deviceId, visibleIds)).orderBy(desc(securityAlerts.lastSeenAt)).limit(100)
      : [];
    return alerts.filter(alert => alert.status !== "RESOLVED").slice(0, limit).map(alert => ({
      id: alert.id,
      deviceId: alert.deviceId,
      code: alert.code,
      severity: alert.severity,
      status: alert.status,
      evidence: parseJsonRecord(alert.evidence),
      firstSeenAt: alert.firstSeenAt,
      lastSeenAt: alert.lastSeenAt,
      deviceStatus: statusById.get(alert.deviceId) || "OFFLINE",
      live: statusById.get(alert.deviceId) === "ONLINE",
    }));
  }

  if (name === "get_device_details") {
    const deviceId = String(args.deviceId || "").slice(0, 120);
    const device = deviceRows.find(row => row.id === deviceId);
    if (!device) throw new Error("Device not found or not authorized");
    const status = reportedDeviceStatus(device);
    const telemetry = parseJsonRecord(device.telemetry);
    return {
      id: device.id,
      name: device.name,
      platform: device.platform,
      status,
      risk: device.risk,
      lastSeenAt: device.lastSeenAt,
      reportFresh: status === "ONLINE",
      telemetry: status === "ONLINE" ? telemetry : { stale: true, lastReport: telemetry },
    };
  }

  throw new Error("Unknown IRIS tool");
}
