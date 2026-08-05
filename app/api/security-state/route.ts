import { desc, eq, inArray } from "drizzle-orm";
import { getChatGPTUser } from "../../chatgpt-auth";
import { getDb } from "../../../db";
import { agentRequestNonces, devices, incidentStates, remediationPlans, responseActions, securityAlerts, trustedApplications } from "../../../db/schema";
import { logAudit, provisionIrisUser } from "../../../lib/authz";

const knownIncidents = new Set(["IR-1042", "IR-1041", "IR-1039", "IR-1036", "IR-1032"]);
const ONLINE_WINDOW_MS = 5 * 60 * 1000;

type AgentTelemetry = { hostname?: string; osVersion?: string; architecture?: string; diskUsedPercent?: number; memoryUsedPercent?: number; firewallEnabled?: boolean; gatekeeperEnabled?: boolean; fileVaultEnabled?: boolean; sipEnabled?: boolean; automaticUpdatesEnabled?: boolean; installedApplicationCount?: number; riskyApplications?: string[]; trustedApplications?: string[]; xProtectPresent?: boolean; xProtectVersion?: string; malwareRemovalToolPresent?: boolean; persistenceItemCount?: number; unsignedPersistenceItems?: string[]; securityFindings?: string[]; changes?: string[]; changeDetectedAt?: string; collectedAt?: string };

function deviceView(device: typeof devices.$inferSelect, trustedNames: string[] = []) {
  let telemetry: AgentTelemetry | null = null;
  try {
    const parsed = JSON.parse(device.telemetry || "{}");
    if (parsed && typeof parsed === "object" && Object.keys(parsed).length) telemetry = parsed as AgentTelemetry;
  } catch { telemetry = null; }
  const reportedAt = device.lastSeenAt ? Date.parse(device.lastSeenAt) : Number.NaN;
  const fresh = Number.isFinite(reportedAt) && Date.now() - reportedAt <= ONLINE_WINDOW_MS;
  const enrolled = Boolean(device.agentTokenHash);
  if (telemetry) {
    telemetry.trustedApplications = trustedNames;
    telemetry.riskyApplications = (telemetry.riskyApplications || []).filter(name => !trustedNames.includes(name));
    if (!telemetry.riskyApplications.length) telemetry.securityFindings = (telemetry.securityFindings || []).filter(finding => finding !== "UNVERIFIED_APPLICATIONS_FOUND");
  }
  let healthScore: number | null = telemetry ? 100 : null;
  if (healthScore !== null) {
    if (telemetry!.firewallEnabled === false) healthScore -= 30;
    if (telemetry!.gatekeeperEnabled === false) healthScore -= 20;
    if (telemetry!.fileVaultEnabled === false) healthScore -= 25;
    if (telemetry!.sipEnabled === false) healthScore -= 25;
    if (telemetry!.automaticUpdatesEnabled === false) healthScore -= 10;
    if (telemetry!.xProtectPresent === false) healthScore -= 30;
    if (telemetry!.malwareRemovalToolPresent === false) healthScore -= 15;
    if (telemetry!.unsignedPersistenceItems?.length) healthScore -= Math.min(30, telemetry!.unsignedPersistenceItems.length * 10);
    if (telemetry!.riskyApplications?.length) healthScore -= Math.min(20, telemetry!.riskyApplications.length * 5);
    if ((telemetry!.diskUsedPercent ?? 0) >= 95) healthScore -= 30; else if ((telemetry!.diskUsedPercent ?? 0) >= 85) healthScore -= 15;
    if ((telemetry!.memoryUsedPercent ?? 0) >= 95) healthScore -= 20; else if ((telemetry!.memoryUsedPercent ?? 0) >= 85) healthScore -= 10;
    if (!fresh) healthScore -= 20;
    healthScore = Math.max(0, healthScore);
  }
  return { id: device.id, name: device.name, platform: device.platform, status: !enrolled ? "PENDING" : fresh ? "ONLINE" : "OFFLINE", risk: device.risk, enrollmentCode: device.enrollmentCode, lastSeenAt: device.lastSeenAt, telemetry, healthScore, provenance: enrolled && telemetry ? "REAL" : "UNVERIFIED" };
}

async function currentUser() {
  const identity = await getChatGPTUser();
  if (!identity) return null;
  return provisionIrisUser(identity);
}

export async function GET() {
  const user = await currentUser();
  if (!user || user.status !== "ACTIVE") return Response.json({ error: "Unauthorized" }, { status: 401 });
  const db = getDb();
  const deviceRows = user.role === "ADMIN"
    ? await db.select().from(devices).orderBy(desc(devices.createdAt))
    : await db.select().from(devices).where(eq(devices.ownerEmail, user.email)).orderBy(desc(devices.createdAt));
  const trustedRows = deviceRows.length ? await db.select().from(trustedApplications).where(inArray(trustedApplications.deviceId, deviceRows.map(device => device.id))) : [];
  const alerts = deviceRows.length ? await db.select().from(securityAlerts).where(inArray(securityAlerts.deviceId, deviceRows.map(device => device.id))).orderBy(desc(securityAlerts.lastSeenAt)).limit(100) : [];
  const remediations = deviceRows.length ? await db.select().from(remediationPlans).where(inArray(remediationPlans.deviceId, deviceRows.map(device => device.id))).orderBy(desc(remediationPlans.approvedAt)).limit(100) : [];
  const incidents = user.role === "ADMIN" ? await db.select().from(incidentStates) : [];
  const actions = user.role === "ADMIN" ? await db.select().from(responseActions).orderBy(desc(responseActions.createdAt)).limit(30) : await db.select().from(responseActions).where(eq(responseActions.actorEmail, user.email)).orderBy(desc(responseActions.createdAt)).limit(30);
  return Response.json({ incidents, actions, alerts, remediations, devices: deviceRows.map(device => deviceView(device, trustedRows.filter(row => row.deviceId === device.id).map(row => row.appName))) });
}

export async function POST(request: Request) {
  const user = await currentUser();
  if (!user || user.status !== "ACTIVE") return Response.json({ error: "Unauthorized" }, { status: 401 });
  const body = await request.json().catch(() => ({})) as { type?: string; name?: string; platform?: string; deviceId?: string; appName?: string };
  if (body.type === "trust_application" && body.deviceId && body.appName) {
    const db = getDb();
    const [device] = await db.select().from(devices).where(eq(devices.id, body.deviceId)).limit(1);
    if (!device || (user.role !== "ADMIN" && device.ownerEmail !== user.email)) return Response.json({ error: "Device not found" }, { status: 404 });
    let telemetry: AgentTelemetry = {};
    try { telemetry = JSON.parse(device.telemetry || "{}"); } catch { telemetry = {}; }
    const appName = String(body.appName).trim().slice(0, 100);
    if (!(telemetry.riskyApplications || []).includes(appName)) return Response.json({ error: "Application is not awaiting review" }, { status: 400 });
    await db.insert(trustedApplications).values({ id: crypto.randomUUID(), deviceId: device.id, appName, approvedBy: user.email }).onConflictDoNothing();
    await logAudit(user.email, "APPLICATION_TRUSTED", device.id, "SUCCESS", { appName });
    const trustedRows = await db.select().from(trustedApplications).where(eq(trustedApplications.deviceId, device.id));
    return Response.json({ device: deviceView(device, trustedRows.map(row => row.appName)) });
  }
  if (body.type === "rotate_device_code" && body.deviceId) {
    const [device] = await getDb().select().from(devices).where(eq(devices.id, body.deviceId)).limit(1);
    if (!device || (user.role !== "ADMIN" && device.ownerEmail !== user.email)) return Response.json({ error: "Device not found" }, { status: 404 });
    const enrollmentCode = crypto.randomUUID().replaceAll("-", "").slice(0, 16).toUpperCase();
    const [updated] = await getDb().update(devices).set({ enrollmentCode, agentTokenHash: null, agentTokenIssuedAt: null, agentTokenExpiresAt: null, status: "PENDING", risk: "UNKNOWN", lastSeenAt: null, telemetry: "{}" }).where(eq(devices.id, device.id)).returning();
    await logAudit(user.email, "DEVICE_ENROLLMENT_ROTATED", device.id, "SUCCESS");
    return Response.json({ device: deviceView(updated) });
  }
  if (body.type !== "device_enrollment") return Response.json({ error: "Unsupported request" }, { status: 400 });
  const name = String(body.name || "My Mac").trim().slice(0, 80);
  const platform = String(body.platform || "macOS").trim().slice(0, 40);
  const id = crypto.randomUUID();
  const enrollmentCode = crypto.randomUUID().replaceAll("-", "").slice(0, 16).toUpperCase();
  const [created] = await getDb().insert(devices).values({ id, ownerEmail: user.email, name, platform, enrollmentCode }).returning();
  await logAudit(user.email, "DEVICE_ENROLLMENT_CREATED", id, "SUCCESS", { name, platform });
  return Response.json({ device: deviceView(created) }, { status: 201 });
}

export async function DELETE(request: Request) {
  const user = await currentUser();
  if (!user || user.status !== "ACTIVE") return Response.json({ error: "Unauthorized" }, { status: 401 });
  const body = await request.json().catch(() => ({})) as { deviceId?: string };
  if (!body.deviceId) return Response.json({ error: "Device ID is required" }, { status: 400 });

  const db = getDb();
  const [device] = await db.select().from(devices).where(eq(devices.id, body.deviceId)).limit(1);
  if (!device || (user.role !== "ADMIN" && device.ownerEmail !== user.email)) {
    return Response.json({ error: "Device not found" }, { status: 404 });
  }

  await db.delete(trustedApplications).where(eq(trustedApplications.deviceId, device.id));
  await db.delete(securityAlerts).where(eq(securityAlerts.deviceId, device.id));
  await db.delete(remediationPlans).where(eq(remediationPlans.deviceId, device.id));
  await db.delete(agentRequestNonces).where(eq(agentRequestNonces.deviceId, device.id));
  await db.delete(devices).where(eq(devices.id, device.id));
  await logAudit(user.email, "DEVICE_DELETED", device.id, "SUCCESS", { name: device.name, platform: device.platform });
  return Response.json({ deleted: true, deviceId: device.id });
}

export async function PATCH(request: Request) {
  const user = await currentUser();
  if (!user || user.status !== "ACTIVE") return Response.json({ error: "Unauthorized" }, { status: 401 });
  const body = await request.json().catch(() => ({})) as { type?: string; alertId?: string; alertStatus?: "ACKNOWLEDGED" | "RESOLVED"; incidentId?: string; decision?: "approve" | "reject" };
  if (body.type === "start_remediation" && body.alertId) {
    const db = getDb();
    const [alert] = await db.select().from(securityAlerts).where(eq(securityAlerts.id, body.alertId)).limit(1);
    if (!alert || alert.status === "RESOLVED" || (user.role !== "ADMIN" && alert.ownerEmail !== user.email)) return Response.json({ error: "Active alert not found" }, { status: 404 });
    const now = new Date().toISOString();
    const [plan] = await db.insert(remediationPlans).values({ id: crypto.randomUUID(), alertId: alert.id, deviceId: alert.deviceId, ownerEmail: alert.ownerEmail, actionCode: alert.code, status: "VERIFYING", approvedBy: user.email, approvedAt: now, lastCheckedAt: now }).onConflictDoUpdate({ target: remediationPlans.alertId, set: { status: "VERIFYING", approvedBy: user.email, approvedAt: now, lastCheckedAt: now, verifiedAt: null } }).returning();
    await db.update(securityAlerts).set({ status: "ACKNOWLEDGED", updatedBy: user.email }).where(eq(securityAlerts.id, alert.id));
    await logAudit(user.email, "SAFE_REMEDIATION_APPROVED", alert.deviceId, "SUCCESS", { alertId: alert.id, actionCode: alert.code, execution: "USER_GUIDED_AGENT_VERIFIED" });
    return Response.json({ remediation: plan });
  }
  if (body.type === "alert_action" && body.alertId && ["ACKNOWLEDGED", "RESOLVED"].includes(body.alertStatus || "")) {
    const db = getDb();
    const [alert] = await db.select().from(securityAlerts).where(eq(securityAlerts.id, body.alertId)).limit(1);
    if (!alert || (user.role !== "ADMIN" && alert.ownerEmail !== user.email)) return Response.json({ error: "Alert not found" }, { status: 404 });
    const now = new Date().toISOString();
    const [updated] = await db.update(securityAlerts).set({ status: body.alertStatus!, updatedBy: user.email, resolvedAt: body.alertStatus === "RESOLVED" ? now : null }).where(eq(securityAlerts.id, alert.id)).returning();
    await logAudit(user.email, body.alertStatus === "RESOLVED" ? "SECURITY_ALERT_RESOLVED" : "SECURITY_ALERT_ACKNOWLEDGED", alert.deviceId, "SUCCESS", { alertId: alert.id, code: alert.code });
    return Response.json({ alert: updated });
  }
  if (!body.incidentId || !knownIncidents.has(body.incidentId) || !["approve", "reject"].includes(body.decision || "")) return Response.json({ error: "Invalid action" }, { status: 400 });
  const approved = body.decision === "approve";
  const now = new Date().toISOString();
  if (approved) await getDb().insert(incidentStates).values({ incidentId: body.incidentId, status: "Contained", updatedBy: user.email, updatedAt: now }).onConflictDoUpdate({ target: incidentStates.incidentId, set: { status: "Contained", updatedBy: user.email, updatedAt: now } });
  await getDb().insert(responseActions).values({ incidentId: body.incidentId, actorEmail: user.email, action: approved ? "CONTAIN_INCIDENT" : "REJECT_RESPONSE_PLAN", outcome: approved ? "COMPLETED" : "REJECTED", mode: "SIMULATION" });
  await logAudit(user.email, approved ? "INCIDENT_RESPONSE_APPROVED" : "INCIDENT_RESPONSE_REJECTED", body.incidentId, "SUCCESS", { mode: "SIMULATION" });
  return Response.json({ incidentId: body.incidentId, status: approved ? "Contained" : null, decision: body.decision });
}
