import { eq, lt } from "drizzle-orm";
import { getDb } from "../../../../db";
import { agentRequestNonces, devices, rateLimits, securityAlerts, trustedApplications } from "../../../../db/schema";

const MAX_BODY_BYTES = 32_768;
const TOKEN_LIFETIME_MS = 90 * 24 * 60 * 60 * 1000;
const SIGNATURE_SKEW_MS = 5 * 60 * 1000;

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

async function hmacSha256(secret: string, value: string) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(value));
  return Array.from(new Uint8Array(signature), byte => byte.toString(16).padStart(2, "0")).join("");
}

function secureEqual(a: string, b: string) {
  if (a.length !== b.length) return false;
  let difference = 0;
  for (let index = 0; index < a.length; index += 1) difference |= a.charCodeAt(index) ^ b.charCodeAt(index);
  return difference === 0;
}

async function enforceRateLimit(key: string, limit: number, windowMs: number) {
  const db = getDb();
  const now = new Date();
  const [row] = await db.select().from(rateLimits).where(eq(rateLimits.key, key)).limit(1);
  if (!row || Date.parse(row.expiresAt) <= now.getTime()) {
    await db.insert(rateLimits).values({ key, count: 1, expiresAt: new Date(now.getTime() + windowMs).toISOString() }).onConflictDoUpdate({ target: rateLimits.key, set: { count: 1, expiresAt: new Date(now.getTime() + windowMs).toISOString() } });
    return true;
  }
  if (row.count >= limit) return false;
  await db.update(rateLimits).set({ count: row.count + 1 }).where(eq(rateLimits.key, key));
  return true;
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
  const declaredLength = Number(request.headers.get("content-length") || 0);
  if (declaredLength > MAX_BODY_BYTES) return Response.json({ error: "Request too large" }, { status: 413 });
  const rawBody = await request.text().catch(() => "");
  if (!rawBody || new TextEncoder().encode(rawBody).byteLength > MAX_BODY_BYTES) return Response.json({ error: "Invalid or oversized request" }, { status: 400 });
  let body: { enrollmentCode?: string; telemetry?: Telemetry };
  try { body = JSON.parse(rawBody); } catch { return Response.json({ error: "Invalid JSON" }, { status: 400 }); }
  const db = getDb();
  let telemetry = cleanTelemetry(body.telemetry || {});
  const authorization = request.headers.get("authorization") || "";

  if (body.enrollmentCode) {
    const ip = request.headers.get("cf-connecting-ip") || "unknown";
    if (!(await enforceRateLimit(`enroll:${ip}`, 12, 10 * 60 * 1000))) return Response.json({ error: "Too many enrollment attempts" }, { status: 429, headers: { "Retry-After": "600" } });
    const code = body.enrollmentCode.trim().toUpperCase();
    const [device] = await db.select().from(devices).where(eq(devices.enrollmentCode, code)).limit(1);
    if (!device || device.agentTokenHash) return Response.json({ error: "Invalid or already-used enrollment code" }, { status: 401 });
    telemetry = enrichTelemetry(telemetry);
    const token = `${crypto.randomUUID().replaceAll("-", "")}${crypto.randomUUID().replaceAll("-", "")}`;
    const issuedAt = new Date();
    await db.update(devices).set({ agentTokenHash: await sha256(token), agentTokenIssuedAt: issuedAt.toISOString(), agentTokenExpiresAt: new Date(issuedAt.getTime() + TOKEN_LIFETIME_MS).toISOString(), status: "ONLINE", risk: calculateRisk(telemetry), telemetry: JSON.stringify(telemetry), lastSeenAt: issuedAt.toISOString() }).where(eq(devices.id, device.id));
    await syncAlerts(device, telemetry);
    return Response.json({ agentToken: token, deviceId: device.id, status: "ONLINE", intervalSeconds: 120 });
  }

  if (!authorization.startsWith("Bearer ")) return Response.json({ error: "Missing agent token" }, { status: 401 });
  const tokenHash = await sha256(authorization.slice(7));
  const [device] = await db.select().from(devices).where(eq(devices.agentTokenHash, tokenHash)).limit(1);
  if (!device) return Response.json({ error: "Invalid agent token" }, { status: 401 });
  if (!device.agentTokenExpiresAt || Date.parse(device.agentTokenExpiresAt) <= Date.now()) return Response.json({ error: "Agent token expired; enroll the device again" }, { status: 401 });
  if (!(await enforceRateLimit(`checkin:${device.id}`, 90, 10 * 60 * 1000))) return Response.json({ error: "Too many check-ins" }, { status: 429, headers: { "Retry-After": "120" } });
  const timestamp = request.headers.get("x-iris-timestamp") || "";
  const nonce = request.headers.get("x-iris-nonce") || "";
  const signature = (request.headers.get("x-iris-signature") || "").toLowerCase();
  if (!/^\d{10,13}$/.test(timestamp) || !/^[a-f0-9]{32,64}$/i.test(nonce) || !/^[a-f0-9]{64}$/.test(signature)) return Response.json({ error: "Missing or invalid request signature" }, { status: 401 });
  const timestampMs = timestamp.length === 10 ? Number(timestamp) * 1000 : Number(timestamp);
  if (!Number.isFinite(timestampMs) || Math.abs(Date.now() - timestampMs) > SIGNATURE_SKEW_MS) return Response.json({ error: "Expired request timestamp" }, { status: 401 });
  const expectedSignature = await hmacSha256(authorization.slice(7), `${timestamp}.${nonce}.${rawBody}`);
  if (!secureEqual(signature, expectedSignature)) return Response.json({ error: "Invalid request signature" }, { status: 401 });
  const [usedNonce] = await db.select().from(agentRequestNonces).where(eq(agentRequestNonces.nonce, nonce)).limit(1);
  if (usedNonce) return Response.json({ error: "Repeated request" }, { status: 409 });
  await db.insert(agentRequestNonces).values({ nonce, deviceId: device.id });
  await db.delete(agentRequestNonces).where(lt(agentRequestNonces.createdAt, new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()));
  let previous: Telemetry | undefined;
  try { previous = JSON.parse(device.telemetry || "{}"); } catch { previous = undefined; }
  telemetry = enrichTelemetry(telemetry, previous);
  const risk = calculateRisk(telemetry);
  await db.update(devices).set({ status: "ONLINE", risk, telemetry: JSON.stringify(telemetry), lastSeenAt: new Date().toISOString() }).where(eq(devices.id, device.id));
  await syncAlerts(device, telemetry);
  return Response.json({ deviceId: device.id, status: "ONLINE", risk, intervalSeconds: 120 });
}
