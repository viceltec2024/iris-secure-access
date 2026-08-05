import { eq } from "drizzle-orm";
import { getDb } from "../../../../db";
import { devices, securityAlerts, trustedApplications } from "../../../../db/schema";

type Telemetry = {
  hostname?: string; osVersion?: string; architecture?: string; diskUsedPercent?: number; memoryUsedPercent?: number;
  firewallEnabled?: boolean; gatekeeperEnabled?: boolean; fileVaultEnabled?: boolean; sipEnabled?: boolean; automaticUpdatesEnabled?: boolean;
  installedApplicationCount?: number; applicationInventoryHash?: string; riskyApplications?: string[];
  securityFindings?: string[]; changes?: string[]; changeDetectedAt?: string; collectedAt?: string;
};

async function sha256(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
}

function cleanTelemetry(input: Telemetry): Telemetry {
  const percent = (value: unknown) => typeof value === "number" && Number.isFinite(value) ? Math.max(0, Math.min(100, Math.round(value))) : undefined;
  const flag = (value: unknown) => typeof value === "boolean" ? value : undefined;
  return {
    hostname: String(input.hostname || "Mac").slice(0, 80),
    osVersion: String(input.osVersion || "macOS").slice(0, 80),
    architecture: String(input.architecture || "unknown").slice(0, 20),
    diskUsedPercent: percent(input.diskUsedPercent),
    memoryUsedPercent: percent(input.memoryUsedPercent),
    firewallEnabled: flag(input.firewallEnabled),
    gatekeeperEnabled: flag(input.gatekeeperEnabled),
    fileVaultEnabled: flag(input.fileVaultEnabled),
    sipEnabled: flag(input.sipEnabled),
    automaticUpdatesEnabled: flag(input.automaticUpdatesEnabled),
    installedApplicationCount: typeof input.installedApplicationCount === "number" ? Math.max(0, Math.min(10000, Math.round(input.installedApplicationCount))) : undefined,
    applicationInventoryHash: String(input.applicationInventoryHash || "").replace(/[^a-f0-9]/gi, "").slice(0, 64) || undefined,
    riskyApplications: Array.isArray(input.riskyApplications) ? input.riskyApplications.slice(0, 20).map(name => String(name).slice(0, 100)) : [],
    collectedAt: new Date().toISOString(),
  };
}

function enrichTelemetry(current: Telemetry, previous?: Telemetry): Telemetry {
  const securityFindings: string[] = [];
  if (current.firewallEnabled === false) securityFindings.push("FIREWALL_DISABLED");
  if (current.gatekeeperEnabled === false) securityFindings.push("GATEKEEPER_DISABLED");
  if (current.fileVaultEnabled === false) securityFindings.push("FILEVAULT_DISABLED");
  if (current.sipEnabled === false) securityFindings.push("SIP_DISABLED");
  if (current.automaticUpdatesEnabled === false) securityFindings.push("AUTOMATIC_UPDATES_DISABLED");
  if (current.riskyApplications?.length) securityFindings.push("UNVERIFIED_APPLICATIONS_FOUND");
  if ((current.diskUsedPercent || 0) >= 95) securityFindings.push("DISK_CRITICALLY_FULL");
  if ((current.memoryUsedPercent || 0) >= 98) securityFindings.push("MEMORY_CRITICALLY_HIGH");

  const changes: string[] = [];
  if (previous) {
    const changed = (key: keyof Telemetry) => previous[key] !== undefined && current[key] !== previous[key];
    if (changed("firewallEnabled")) changes.push("FIREWALL_STATE_CHANGED");
    if (changed("gatekeeperEnabled")) changes.push("GATEKEEPER_STATE_CHANGED");
    if (changed("fileVaultEnabled")) changes.push("FILEVAULT_STATE_CHANGED");
    if (changed("sipEnabled")) changes.push("SIP_STATE_CHANGED");
    if (changed("automaticUpdatesEnabled")) changes.push("AUTOMATIC_UPDATES_STATE_CHANGED");
    if (previous.applicationInventoryHash && current.applicationInventoryHash && previous.applicationInventoryHash !== current.applicationInventoryHash) changes.push("APPLICATION_INVENTORY_CHANGED");
  }
  let changeDetectedAt: string | undefined;
  if (changes.length) changeDetectedAt = new Date().toISOString();
  else if (previous?.changes?.length && previous.changeDetectedAt && Date.now() - Date.parse(previous.changeDetectedAt) < 24 * 60 * 60 * 1000) {
    changes.push(...previous.changes);
    changeDetectedAt = previous.changeDetectedAt;
  }
  return { ...current, securityFindings, changes, changeDetectedAt };
}

function calculateRisk(telemetry: Telemetry): "LOW" | "MEDIUM" | "HIGH" {
  if ((telemetry.diskUsedPercent || 0) >= 95 || (telemetry.memoryUsedPercent || 0) >= 98 || telemetry.sipEnabled === false || telemetry.fileVaultEnabled === false) return "HIGH";
  if (telemetry.firewallEnabled === false || telemetry.gatekeeperEnabled === false || telemetry.automaticUpdatesEnabled === false || telemetry.riskyApplications?.length || (telemetry.diskUsedPercent || 0) >= 85) return "MEDIUM";
  return "LOW";
}

function alertSeverity(code: string): "CRITICAL" | "HIGH" | "MEDIUM" | "LOW" {
  if (["SIP_DISABLED", "FILEVAULT_DISABLED", "DISK_CRITICALLY_FULL", "MEMORY_CRITICALLY_HIGH"].includes(code)) return "HIGH";
  if (["FIREWALL_DISABLED", "GATEKEEPER_DISABLED", "AUTOMATIC_UPDATES_DISABLED", "UNVERIFIED_APPLICATIONS_FOUND"].includes(code)) return "MEDIUM";
  return "LOW";
}

async function syncAlerts(device: typeof devices.$inferSelect, telemetry: Telemetry) {
  const db = getDb();
  const trusted = await db.select().from(trustedApplications).where(eq(trustedApplications.deviceId, device.id));
  const trustedNames = trusted.map(row => row.appName);
  const untrustedApps = (telemetry.riskyApplications || []).filter(name => !trustedNames.includes(name));
  const findings = (telemetry.securityFindings || []).filter(code => code !== "UNVERIFIED_APPLICATIONS_FOUND" || untrustedApps.length > 0);
  const currentCodes = [...new Set([...findings, ...(telemetry.changes || [])])];
  const existing = await db.select().from(securityAlerts).where(eq(securityAlerts.deviceId, device.id));
  const now = new Date().toISOString();
  for (const code of currentCodes) {
    const prior = existing.find(alert => alert.code === code);
    const evidence = JSON.stringify({ hostname: telemetry.hostname, applications: code === "UNVERIFIED_APPLICATIONS_FOUND" ? untrustedApps : undefined, collectedAt: telemetry.collectedAt });
    if (prior) {
      await db.update(securityAlerts).set({ status: prior.status === "RESOLVED" ? "NEW" : prior.status, severity: alertSeverity(code), evidence, lastSeenAt: now, resolvedAt: null, updatedBy: prior.status === "RESOLVED" ? "iris.system" : prior.updatedBy }).where(eq(securityAlerts.id, prior.id));
    } else {
      await db.insert(securityAlerts).values({ id: crypto.randomUUID(), deviceId: device.id, ownerEmail: device.ownerEmail, fingerprint: `${device.id}:${code}`, code, severity: alertSeverity(code), evidence, firstSeenAt: now, lastSeenAt: now });
    }
  }
  for (const alert of existing.filter(item => item.status !== "RESOLVED" && !currentCodes.includes(item.code))) {
    await db.update(securityAlerts).set({ status: "RESOLVED", resolvedAt: now, updatedBy: "iris.system" }).where(eq(securityAlerts.id, alert.id));
  }
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({})) as { enrollmentCode?: string; telemetry?: Telemetry };
  const db = getDb();
  let telemetry = cleanTelemetry(body.telemetry || {});
  const authorization = request.headers.get("authorization") || "";

  if (body.enrollmentCode) {
    const code = body.enrollmentCode.trim().toUpperCase();
    const [device] = await db.select().from(devices).where(eq(devices.enrollmentCode, code)).limit(1);
    if (!device || device.agentTokenHash) return Response.json({ error: "Invalid or already-used enrollment code" }, { status: 401 });
    telemetry = enrichTelemetry(telemetry);
    const token = `${crypto.randomUUID().replaceAll("-", "")}${crypto.randomUUID().replaceAll("-", "")}`;
    await db.update(devices).set({ agentTokenHash: await sha256(token), status: "ONLINE", risk: calculateRisk(telemetry), telemetry: JSON.stringify(telemetry), lastSeenAt: new Date().toISOString() }).where(eq(devices.id, device.id));
    await syncAlerts(device, telemetry);
    return Response.json({ agentToken: token, deviceId: device.id, status: "ONLINE", intervalSeconds: 120 });
  }

  if (!authorization.startsWith("Bearer ")) return Response.json({ error: "Missing agent token" }, { status: 401 });
  const tokenHash = await sha256(authorization.slice(7));
  const [device] = await db.select().from(devices).where(eq(devices.agentTokenHash, tokenHash)).limit(1);
  if (!device) return Response.json({ error: "Invalid agent token" }, { status: 401 });
  let previous: Telemetry | undefined;
  try { previous = JSON.parse(device.telemetry || "{}"); } catch { previous = undefined; }
  telemetry = enrichTelemetry(telemetry, previous);
  const risk = calculateRisk(telemetry);
  await db.update(devices).set({ status: "ONLINE", risk, telemetry: JSON.stringify(telemetry), lastSeenAt: new Date().toISOString() }).where(eq(devices.id, device.id));
  await syncAlerts(device, telemetry);
  return Response.json({ deviceId: device.id, status: "ONLINE", risk, intervalSeconds: 120 });
}
