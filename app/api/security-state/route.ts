import { desc, eq } from "drizzle-orm";
import { getChatGPTUser } from "../../chatgpt-auth";
import { getDb } from "../../../db";
import { devices, incidentStates, responseActions } from "../../../db/schema";
import { logAudit, provisionIrisUser } from "../../../lib/authz";

const knownIncidents = new Set(["IR-1042", "IR-1041", "IR-1039", "IR-1036", "IR-1032"]);

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
  return Response.json({ incidents: await db.select().from(incidentStates), actions: await db.select().from(responseActions).orderBy(desc(responseActions.createdAt)).limit(30), devices: deviceRows });
}

export async function POST(request: Request) {
  const user = await currentUser();
  if (!user || user.status !== "ACTIVE") return Response.json({ error: "Unauthorized" }, { status: 401 });
  const body = await request.json().catch(() => ({})) as { type?: string; name?: string; platform?: string; deviceId?: string };
  if (body.type === "rotate_device_code" && body.deviceId) {
    const [device] = await getDb().select().from(devices).where(eq(devices.id, body.deviceId)).limit(1);
    if (!device || (user.role !== "ADMIN" && device.ownerEmail !== user.email)) return Response.json({ error: "Device not found" }, { status: 404 });
    const enrollmentCode = crypto.randomUUID().replaceAll("-", "").slice(0, 16).toUpperCase();
    const [updated] = await getDb().update(devices).set({ enrollmentCode, agentTokenHash: null, status: "PENDING", risk: "UNKNOWN", lastSeenAt: null, telemetry: "{}" }).where(eq(devices.id, device.id)).returning();
    await logAudit(user.email, "DEVICE_ENROLLMENT_ROTATED", device.id, "SUCCESS");
    return Response.json({ device: updated });
  }
  if (body.type !== "device_enrollment") return Response.json({ error: "Unsupported request" }, { status: 400 });
  const name = String(body.name || "My Mac").trim().slice(0, 80);
  const platform = String(body.platform || "macOS").trim().slice(0, 40);
  const id = crypto.randomUUID();
  const enrollmentCode = crypto.randomUUID().replaceAll("-", "").slice(0, 16).toUpperCase();
  const [created] = await getDb().insert(devices).values({ id, ownerEmail: user.email, name, platform, enrollmentCode }).returning();
  await logAudit(user.email, "DEVICE_ENROLLMENT_CREATED", id, "SUCCESS", { name, platform });
  return Response.json({ device: created }, { status: 201 });
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

  await db.delete(devices).where(eq(devices.id, device.id));
  await logAudit(user.email, "DEVICE_DELETED", device.id, "SUCCESS", { name: device.name, platform: device.platform });
  return Response.json({ deleted: true, deviceId: device.id });
}

export async function PATCH(request: Request) {
  const user = await currentUser();
  if (!user || user.status !== "ACTIVE") return Response.json({ error: "Unauthorized" }, { status: 401 });
  const body = await request.json().catch(() => ({})) as { incidentId?: string; decision?: "approve" | "reject" };
  if (!body.incidentId || !knownIncidents.has(body.incidentId) || !["approve", "reject"].includes(body.decision || "")) return Response.json({ error: "Invalid action" }, { status: 400 });
  const approved = body.decision === "approve";
  const now = new Date().toISOString();
  if (approved) await getDb().insert(incidentStates).values({ incidentId: body.incidentId, status: "Contained", updatedBy: user.email, updatedAt: now }).onConflictDoUpdate({ target: incidentStates.incidentId, set: { status: "Contained", updatedBy: user.email, updatedAt: now } });
  await getDb().insert(responseActions).values({ incidentId: body.incidentId, actorEmail: user.email, action: approved ? "CONTAIN_INCIDENT" : "REJECT_RESPONSE_PLAN", outcome: approved ? "COMPLETED" : "REJECTED", mode: "SIMULATION" });
  await logAudit(user.email, approved ? "INCIDENT_RESPONSE_APPROVED" : "INCIDENT_RESPONSE_REJECTED", body.incidentId, "SUCCESS", { mode: "SIMULATION" });
  return Response.json({ incidentId: body.incidentId, status: approved ? "Contained" : null, decision: body.decision });
}
