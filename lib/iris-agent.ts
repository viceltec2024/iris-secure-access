import { desc, eq, inArray } from "drizzle-orm";
import { getDb } from "../db";
import { devices, remediationPlans, responseActions, securityAlerts, trustedApplications } from "../db/schema";
import { logAudit } from "./authz";
import { queueAgentCommands } from "./iris-agent-commands";
import { parseJsonRecord, reportedDeviceStatus } from "./iris-device-view.ts";
import { commandsForAlert } from "./iris-live-soc";

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
  explain_alert: { es: "Expliqué la alerta", en: "Explained the alert" },
  trust_application: { es: "Marqué la app como confiable", en: "Trusted the application" },
  update_alert_status: { es: "Actualicé el estado de la alerta", en: "Updated the alert status" },
  approve_remediation: { es: "Aprobé la corrección en el Mac", en: "Approved Mac remediation" },
  request_device_recheck: { es: "Pedí un nuevo reporte al Mac", en: "Requested a fresh Mac report" },
};

const ALERT_GUIDE: Record<string, { es: { why: string; steps: string[] }; en: { why: string; steps: string[] } }> = {
  FIREWALL_DISABLED: {
    es: { why: "Sin firewall el Mac acepta conexiones de red con menos control.", steps: ["Confirma que quieres activarlo.", "IRIS puede encolar ENABLE_FIREWALL (macOS pedirá tu contraseña).", "Espera el siguiente reporte para verificar."] },
    en: { why: "Without the firewall the Mac accepts network connections with less control.", steps: ["Confirm you want it enabled.", "IRIS can queue ENABLE_FIREWALL (macOS may ask for your password).", "Wait for the next report to verify."] },
  },
  UNVERIFIED_APPLICATIONS_FOUND: {
    es: { why: "Hay apps cuya firma no se pudo verificar; pueden ser legítimas o dudosas.", steps: ["Revisa la lista de aplicaciones.", "Si las reconoces, confírmalas como confiables.", "Si no, elimínalas desde el Mac."] },
    en: { why: "Some apps could not be signature-verified; they may be legitimate or risky.", steps: ["Review the application list.", "If you recognize them, mark them trusted.", "If not, remove them on the Mac."] },
  },
  UNSIGNED_PERSISTENCE_FOUND: {
    es: { why: "Hay elementos de inicio sin firma válida.", steps: ["Revisa LaunchAgents/Daemons listados.", "Elimina lo que no reconozcas en el Mac.", "Pide un nuevo reporte."] },
    en: { why: "Unsigned startup items were found.", steps: ["Review the listed LaunchAgents/Daemons.", "Remove anything you do not recognize on the Mac.", "Request a fresh report."] },
  },
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
  {
    type: "function",
    name: "explain_alert",
    description: "Explain one security alert with evidence and recommended next steps. Read-only.",
    parameters: {
      type: "object",
      properties: {
        alertId: { type: "string", minLength: 1, maxLength: 120 },
        language: { type: "string", enum: ["es", "en"] },
      },
      required: ["alertId", "language"],
      additionalProperties: false,
    },
    strict: true,
  },
  {
    type: "function",
    name: "trust_application",
    description: "Mark an application as trusted for a device after the user clearly confirmed in chat. Requires userConfirmed=true.",
    parameters: {
      type: "object",
      properties: {
        deviceId: { type: "string", minLength: 1, maxLength: 120 },
        appName: { type: "string", minLength: 1, maxLength: 100 },
        userConfirmed: { type: "boolean" },
      },
      required: ["deviceId", "appName", "userConfirmed"],
      additionalProperties: false,
    },
    strict: true,
  },
  {
    type: "function",
    name: "update_alert_status",
    description: "Acknowledge or resolve an alert after the user clearly confirmed in chat. Requires userConfirmed=true.",
    parameters: {
      type: "object",
      properties: {
        alertId: { type: "string", minLength: 1, maxLength: 120 },
        status: { type: "string", enum: ["ACKNOWLEDGED", "RESOLVED"] },
        userConfirmed: { type: "boolean" },
      },
      required: ["alertId", "status", "userConfirmed"],
      additionalProperties: false,
    },
    strict: true,
  },
  {
    type: "function",
    name: "approve_remediation",
    description: "Approve a safe remediation for an alert (may queue ENABLE_FIREWALL / NOTIFY / REVERIFY to the Mac agent). Requires userConfirmed=true. macOS may ask the user for their password for firewall changes.",
    parameters: {
      type: "object",
      properties: {
        alertId: { type: "string", minLength: 1, maxLength: 120 },
        language: { type: "string", enum: ["es", "en"] },
        userConfirmed: { type: "boolean" },
      },
      required: ["alertId", "language", "userConfirmed"],
      additionalProperties: false,
    },
    strict: true,
  },
  {
    type: "function",
    name: "request_device_recheck",
    description: "Queue a REVERIFY command so the Mac agent sends a fresh report on the next check-in. Requires userConfirmed=true.",
    parameters: {
      type: "object",
      properties: {
        deviceId: { type: "string", minLength: 1, maxLength: 120 },
        language: { type: "string", enum: ["es", "en"] },
        userConfirmed: { type: "boolean" },
      },
      required: ["deviceId", "language", "userConfirmed"],
      additionalProperties: false,
    },
    strict: true,
  },
] as const;

function requireConfirmation(args: Record<string, unknown>) {
  if (args.userConfirmed !== true) {
    throw new Error("Action blocked: set userConfirmed=true only after the user clearly authorized this action in chat.");
  }
}

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

function canAccessDevice(user: IrisAgentUser, device: { ownerEmail: string }) {
  return user.role === "ADMIN" || device.ownerEmail === user.email;
}

export async function runIrisTool(user: IrisAgentUser, name: string, rawArguments: string) {
  let args: Record<string, unknown> = {};
  try { args = JSON.parse(rawArguments || "{}") as Record<string, unknown>; } catch { throw new Error("Invalid tool arguments"); }

  const deviceRows = await visibleDevices(user);
  const visibleIds = deviceRows.map(device => device.id);
  const statusById = new Map(deviceRows.map(device => [device.id, reportedDeviceStatus(device)]));
  const db = getDb();

  if (name === "get_security_overview") {
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
      capabilities: {
        canTrustApps: true,
        canUpdateAlerts: true,
        canApproveRemediation: true,
        canRequestRecheck: true,
        note: "Action tools require explicit user confirmation in chat (userConfirmed=true).",
      },
    };
  }

  if (name === "list_active_alerts") {
    const limit = Math.max(1, Math.min(25, Number(args.limit) || 10));
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
    const trusted = await db.select().from(trustedApplications).where(eq(trustedApplications.deviceId, device.id));
    const trustedNames = trusted.map(row => row.appName);
    const risky = Array.isArray(telemetry.riskyApplications)
      ? (telemetry.riskyApplications as string[]).filter(app => !trustedNames.includes(app))
      : [];
    return {
      id: device.id,
      name: device.name,
      platform: device.platform,
      status,
      risk: device.risk,
      lastSeenAt: device.lastSeenAt,
      reportFresh: status === "ONLINE",
      trustedApplications: trustedNames,
      untrustedApplications: risky,
      telemetry: status === "ONLINE" ? { ...telemetry, riskyApplications: risky } : { stale: true, lastReport: telemetry },
    };
  }

  if (name === "explain_alert") {
    const alertId = String(args.alertId || "").slice(0, 120);
    const language = args.language === "en" ? "en" : "es";
    const [alert] = await db.select().from(securityAlerts).where(eq(securityAlerts.id, alertId)).limit(1);
    if (!alert || !visibleIds.includes(alert.deviceId)) throw new Error("Alert not found or not authorized");
    const device = deviceRows.find(row => row.id === alert.deviceId);
    const guide = ALERT_GUIDE[alert.code]?.[language] || {
      why: language === "es" ? "Alerta de seguridad reportada por el agente Mac." : "Security alert reported by the Mac agent.",
      steps: language === "es"
        ? ["Revisa la evidencia.", "Decide si confiar, corregir o resolver.", "Confirma en el chat para que IRIS actúe."]
        : ["Review the evidence.", "Decide whether to trust, remediate, or resolve.", "Confirm in chat so IRIS can act."],
    };
    return {
      id: alert.id,
      code: alert.code,
      severity: alert.severity,
      status: alert.status,
      deviceId: alert.deviceId,
      deviceName: device?.name || alert.deviceId,
      deviceStatus: statusById.get(alert.deviceId) || "OFFLINE",
      evidence: parseJsonRecord(alert.evidence),
      whyItMatters: guide.why,
      recommendedSteps: guide.steps,
      availableActions: ["update_alert_status", "approve_remediation", alert.code === "UNVERIFIED_APPLICATIONS_FOUND" ? "trust_application" : null].filter(Boolean),
    };
  }

  if (name === "trust_application") {
    requireConfirmation(args);
    const deviceId = String(args.deviceId || "").slice(0, 120);
    const appName = String(args.appName || "").trim().slice(0, 100);
    const device = deviceRows.find(row => row.id === deviceId);
    if (!device || !canAccessDevice(user, device)) throw new Error("Device not found or not authorized");
    if (!appName) throw new Error("Application name is required");
    let telemetry: Record<string, unknown> = {};
    try { telemetry = JSON.parse(device.telemetry || "{}") as Record<string, unknown>; } catch { telemetry = {}; }
    const risky = Array.isArray(telemetry.riskyApplications) ? telemetry.riskyApplications as string[] : [];
    if (!risky.includes(appName)) {
      const trusted = await db.select().from(trustedApplications).where(eq(trustedApplications.deviceId, device.id));
      if (trusted.some(row => row.appName === appName)) {
        return { ok: true, alreadyTrusted: true, deviceId, appName };
      }
      throw new Error("Application is not awaiting trust review on this device");
    }
    await db.insert(trustedApplications).values({
      id: crypto.randomUUID(),
      deviceId: device.id,
      appName,
      approvedBy: user.email,
    }).onConflictDoNothing();
    await logAudit(user.email, "APPLICATION_TRUSTED", device.id, "SUCCESS", { appName, via: "ask_iris_agent" });
    const trusted = await db.select().from(trustedApplications).where(eq(trustedApplications.deviceId, device.id));
    return { ok: true, deviceId, appName, trustedApplications: trusted.map(row => row.appName) };
  }

  if (name === "update_alert_status") {
    requireConfirmation(args);
    const alertId = String(args.alertId || "").slice(0, 120);
    const status = args.status === "RESOLVED" ? "RESOLVED" : args.status === "ACKNOWLEDGED" ? "ACKNOWLEDGED" : null;
    if (!status) throw new Error("status must be ACKNOWLEDGED or RESOLVED");
    const [alert] = await db.select().from(securityAlerts).where(eq(securityAlerts.id, alertId)).limit(1);
    if (!alert || !visibleIds.includes(alert.deviceId)) throw new Error("Alert not found or not authorized");
    const now = new Date().toISOString();
    const [updated] = await db.update(securityAlerts).set({
      status,
      updatedBy: user.email,
      resolvedAt: status === "RESOLVED" ? now : null,
    }).where(eq(securityAlerts.id, alert.id)).returning();
    await logAudit(user.email, status === "RESOLVED" ? "SECURITY_ALERT_RESOLVED" : "SECURITY_ALERT_ACKNOWLEDGED", alert.deviceId, "SUCCESS", { alertId: alert.id, code: alert.code, via: "ask_iris_agent" });
    return { ok: true, alert: { id: updated.id, code: updated.code, status: updated.status, resolvedAt: updated.resolvedAt } };
  }

  if (name === "approve_remediation") {
    requireConfirmation(args);
    const alertId = String(args.alertId || "").slice(0, 120);
    const language = args.language === "en" ? "en" : "es";
    const [alert] = await db.select().from(securityAlerts).where(eq(securityAlerts.id, alertId)).limit(1);
    if (!alert || alert.status === "RESOLVED" || !visibleIds.includes(alert.deviceId)) throw new Error("Active alert not found or not authorized");
    const now = new Date().toISOString();
    const [plan] = await db.insert(remediationPlans).values({
      id: crypto.randomUUID(),
      alertId: alert.id,
      deviceId: alert.deviceId,
      ownerEmail: alert.ownerEmail,
      actionCode: alert.code,
      status: "VERIFYING",
      approvedBy: user.email,
      approvedAt: now,
      lastCheckedAt: now,
    }).onConflictDoUpdate({
      target: remediationPlans.alertId,
      set: { status: "VERIFYING", approvedBy: user.email, approvedAt: now, lastCheckedAt: now, verifiedAt: null },
    }).returning();
    await db.update(securityAlerts).set({ status: "ACKNOWLEDGED", updatedBy: user.email }).where(eq(securityAlerts.id, alert.id));
    const queued = await queueAgentCommands(alert.deviceId, user.email, commandsForAlert(alert.code, language), alert.id);
    await db.insert(responseActions).values({
      incidentId: alert.id,
      actorEmail: user.email,
      action: "DISPATCH_AGENT_COMMANDS",
      outcome: "COMPLETED",
      mode: "LIVE",
    });
    await logAudit(user.email, "INCIDENT_RESPONSE_APPROVED", alert.id, "SUCCESS", {
      mode: "LIVE",
      actionCode: alert.code,
      commands: queued.map(item => item.code),
      via: "ask_iris_agent",
    });
    return {
      ok: true,
      alertId: alert.id,
      remediationId: plan.id,
      commandsQueued: queued.map(item => item.code),
      note: language === "es"
        ? "Comandos encolados. El Mac los aplicará en el próximo check-in (~2 min). ENABLE_FIREWALL puede pedir contraseña en macOS."
        : "Commands queued. The Mac applies them on the next check-in (~2 min). ENABLE_FIREWALL may prompt for the macOS password.",
    };
  }

  if (name === "request_device_recheck") {
    requireConfirmation(args);
    const deviceId = String(args.deviceId || "").slice(0, 120);
    const language = args.language === "en" ? "en" : "es";
    const device = deviceRows.find(row => row.id === deviceId);
    if (!device || !canAccessDevice(user, device)) throw new Error("Device not found or not authorized");
    const queued = await queueAgentCommands(device.id, user.email, [{
      code: "REVERIFY",
      title: "IRIS",
      message: language === "es" ? "IRIS pide un nuevo reporte de seguridad." : "IRIS requested a fresh security report.",
    }]);
    await logAudit(user.email, "DEVICE_RECHECK_REQUESTED", device.id, "SUCCESS", { via: "ask_iris_agent", commands: queued.map(item => item.code) });
    return {
      ok: true,
      deviceId: device.id,
      commandsQueued: queued.map(item => item.code),
      note: language === "es"
        ? "REVERIFY encolado. El Mac debería reportar en el próximo ciclo (~2 min) si está ONLINE."
        : "REVERIFY queued. The Mac should report on the next cycle (~2 min) if ONLINE.",
    };
  }

  throw new Error("Unknown IRIS tool");
}
