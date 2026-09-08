import { desc, eq, inArray } from "drizzle-orm";
import { getChatGPTUser } from "../../chatgpt-auth";
import { getDb } from "../../../db";
import { agentRequestNonces, appSettings, devices, incidentStates, remediationPlans, responseActions, securityAlerts, trustedApplications } from "../../../db/schema";
import { queueAgentCommands } from "../../../lib/iris-agent-commands";
import { type AgentTelemetry, deviceView } from "../../../lib/iris-device-view";
import { commandsForAlert } from "../../../lib/iris-live-soc";
import { irisReconnectOrigin } from "../../../lib/iris-origin";
import { listRecentAudit, logAudit, provisionIrisUser } from "../../../lib/authz";
import { parseWalletSessionValue } from "../../../lib/iris-chain";
import { approveProposal, parsePurchaseDesk, rejectProposal } from "../../../lib/iris-purchases";

const WALLET_KEY = "iris_local_wallet_session";
const DESK_KEY = "iris_purchase_desk";

async function currentUser() {
  const identity = await getChatGPTUser();
  if (!identity) return null;
  return provisionIrisUser(identity);
}

export async function GET(request: Request) {
  const user = await currentUser();
  if (!user || user.status !== "ACTIVE") return Response.json({ error: "Unauthorized" }, { status: 401 });
  const db = getDb();
  const deviceRows = user.role === "ADMIN"
    ? await db.select().from(devices).orderBy(desc(devices.createdAt))
    : await db.select().from(devices).where(eq(devices.ownerEmail, user.email)).orderBy(desc(devices.createdAt));
  const trustedRows = deviceRows.length ? await db.select().from(trustedApplications).where(inArray(trustedApplications.deviceId, deviceRows.map(device => device.id))) : [];
  const alerts = deviceRows.length ? await db.select().from(securityAlerts).where(inArray(securityAlerts.deviceId, deviceRows.map(device => device.id))).orderBy(desc(securityAlerts.lastSeenAt)).limit(100) : [];
  const remediations = deviceRows.length ? await db.select().from(remediationPlans).where(inArray(remediationPlans.deviceId, deviceRows.map(device => device.id))).orderBy(desc(remediationPlans.approvedAt)).limit(100) : [];
  const incidents = await db.select().from(incidentStates);
  const actions = user.role === "ADMIN" ? await db.select().from(responseActions).orderBy(desc(responseActions.createdAt)).limit(30) : await db.select().from(responseActions).where(eq(responseActions.actorEmail, user.email)).orderBy(desc(responseActions.createdAt)).limit(30);
  const audit = await listRecentAudit(user.email, user.role, 40);
  const [walletRow] = await db.select().from(appSettings).where(eq(appSettings.key, `${WALLET_KEY}:${user.email}`)).limit(1);
  const wallet = parseWalletSessionValue(walletRow?.value || "");
  const [deskRow] = await db.select().from(appSettings).where(eq(appSettings.key, `${DESK_KEY}:${user.email}`)).limit(1);
  const purchases = parsePurchaseDesk(deskRow?.value || "").proposals.filter(item => item.status === "awaiting_approval");
  return Response.json({
    live: true,
    agentOrigin: irisReconnectOrigin(new URL(request.url).origin, process.env.IRIS_PUBLIC_ORIGIN || ""),
    incidents,
    actions,
    alerts,
    remediations,
    audit,
    purchases,
    wallet: wallet ? { connected: true, address: wallet.address, mode: wallet.mode } : { connected: false, address: "", mode: "watch" },
    devices: deviceRows.map(device => deviceView(device, trustedRows.filter(row => row.deviceId === device.id).map(row => row.appName))),
  });
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
  const body = await request.json().catch(() => ({})) as { type?: string; alertId?: string; alertStatus?: "ACKNOWLEDGED" | "RESOLVED"; incidentId?: string; decision?: "approve" | "reject"; language?: "es" | "en" };
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
  if (!body.incidentId || !["approve", "reject"].includes(body.decision || "")) return Response.json({ error: "Invalid action" }, { status: 400 });
  const approved = body.decision === "approve";
  const now = new Date().toISOString();
  const db = getDb();
  const language = body.language === "en" ? "en" : "es";

  if (body.incidentId.startsWith("purchase:")) {
    const proposalId = body.incidentId.slice("purchase:".length);
    const deskKey = `${DESK_KEY}:${user.email}`;
    const [deskRow] = await db.select().from(appSettings).where(eq(appSettings.key, deskKey)).limit(1);
    const desk = parsePurchaseDesk(deskRow?.value || "");
    try {
      if (approved) {
        const result = approveProposal(desk, proposalId);
        await db.insert(appSettings).values({ key: deskKey, value: JSON.stringify(result.state), updatedBy: user.email, updatedAt: now }).onConflictDoUpdate({
          target: appSettings.key,
          set: { value: JSON.stringify(result.state), updatedBy: user.email, updatedAt: now },
        });
        await db.insert(incidentStates).values({ incidentId: body.incidentId, status: "Contained", updatedBy: user.email, updatedAt: now }).onConflictDoUpdate({ target: incidentStates.incidentId, set: { status: "Contained", updatedBy: user.email, updatedAt: now } });
        await db.insert(responseActions).values({ incidentId: body.incidentId, actorEmail: user.email, action: "APPROVE_PURCHASE", outcome: "COMPLETED", mode: "LIVE" });
        await logAudit(user.email, "IRIS_PURCHASE_APPROVED", result.proposal.id, "SUCCESS", { mode: "LIVE", checkoutUrl: result.proposal.checkoutUrl });
        return Response.json({ incidentId: body.incidentId, status: "Contained", decision: "approve", checkoutUrl: result.proposal.checkoutUrl, mode: "LIVE" });
      }
      rejectProposal(desk, proposalId);
      await db.insert(appSettings).values({ key: deskKey, value: JSON.stringify(desk), updatedBy: user.email, updatedAt: now }).onConflictDoUpdate({
        target: appSettings.key,
        set: { value: JSON.stringify(desk), updatedBy: user.email, updatedAt: now },
      });
      await db.insert(responseActions).values({ incidentId: body.incidentId, actorEmail: user.email, action: "REJECT_PURCHASE", outcome: "REJECTED", mode: "LIVE" });
      await logAudit(user.email, "IRIS_PURCHASE_REJECTED", proposalId, "SUCCESS", { mode: "LIVE" });
      return Response.json({ incidentId: body.incidentId, status: null, decision: "reject", mode: "LIVE" });
    } catch (error) {
      return Response.json({ error: error instanceof Error ? error.message : "Purchase decision failed" }, { status: 400 });
    }
  }

  if (body.incidentId.startsWith("device:")) {
    const deviceId = body.incidentId.slice("device:".length);
    const [device] = await db.select().from(devices).where(eq(devices.id, deviceId)).limit(1);
    if (!device || (user.role !== "ADMIN" && device.ownerEmail !== user.email)) return Response.json({ error: "Device not found" }, { status: 404 });
    if (approved) await db.insert(incidentStates).values({ incidentId: body.incidentId, status: "Contained", updatedBy: user.email, updatedAt: now }).onConflictDoUpdate({ target: incidentStates.incidentId, set: { status: "Contained", updatedBy: user.email, updatedAt: now } });
    await db.insert(responseActions).values({ incidentId: body.incidentId, actorEmail: user.email, action: approved ? "ACKNOWLEDGE_OFFLINE_AGENT" : "REJECT_RESPONSE_PLAN", outcome: approved ? "COMPLETED" : "REJECTED", mode: "LIVE" });
    await logAudit(user.email, approved ? "INCIDENT_RESPONSE_APPROVED" : "INCIDENT_RESPONSE_REJECTED", body.incidentId, "SUCCESS", { mode: "LIVE", kind: "device" });
    return Response.json({ incidentId: body.incidentId, status: approved ? "Contained" : null, decision: body.decision, mode: "LIVE" });
  }

  const [alert] = await db.select().from(securityAlerts).where(eq(securityAlerts.id, body.incidentId)).limit(1);
  if (!alert || (user.role !== "ADMIN" && alert.ownerEmail !== user.email)) return Response.json({ error: "Live incident not found" }, { status: 404 });
  if (approved) {
    const [plan] = await db.insert(remediationPlans).values({ id: crypto.randomUUID(), alertId: alert.id, deviceId: alert.deviceId, ownerEmail: alert.ownerEmail, actionCode: alert.code, status: "VERIFYING", approvedBy: user.email, approvedAt: now, lastCheckedAt: now }).onConflictDoUpdate({ target: remediationPlans.alertId, set: { status: "VERIFYING", approvedBy: user.email, approvedAt: now, lastCheckedAt: now, verifiedAt: null } }).returning();
    await db.update(securityAlerts).set({ status: "ACKNOWLEDGED", updatedBy: user.email }).where(eq(securityAlerts.id, alert.id));
    const queued = await queueAgentCommands(alert.deviceId, user.email, commandsForAlert(alert.code, language), alert.id);
    await db.insert(incidentStates).values({ incidentId: alert.id, status: "Investigating", updatedBy: user.email, updatedAt: now }).onConflictDoUpdate({ target: incidentStates.incidentId, set: { status: "Investigating", updatedBy: user.email, updatedAt: now } });
    await db.insert(responseActions).values({ incidentId: alert.id, actorEmail: user.email, action: "DISPATCH_AGENT_COMMANDS", outcome: "COMPLETED", mode: "LIVE" });
    await logAudit(user.email, "INCIDENT_RESPONSE_APPROVED", alert.id, "SUCCESS", { mode: "LIVE", actionCode: alert.code, commands: queued.map(item => item.code) });
    return Response.json({ incidentId: alert.id, status: "Investigating", decision: "approve", mode: "LIVE", remediation: plan, commands: queued.map(item => item.code) });
  }
  await db.insert(responseActions).values({ incidentId: alert.id, actorEmail: user.email, action: "REJECT_RESPONSE_PLAN", outcome: "REJECTED", mode: "LIVE" });
  await logAudit(user.email, "INCIDENT_RESPONSE_REJECTED", alert.id, "SUCCESS", { mode: "LIVE" });
  return Response.json({ incidentId: alert.id, status: null, decision: "reject", mode: "LIVE" });
}
