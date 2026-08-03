import { eq } from "drizzle-orm";
import { getDb } from "../../../../db";
import { devices } from "../../../../db/schema";

type Telemetry = { hostname?: string; osVersion?: string; architecture?: string; diskUsedPercent?: number; memoryUsedPercent?: number; firewallEnabled?: boolean; collectedAt?: string };

async function sha256(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
}

function cleanTelemetry(input: Telemetry): Telemetry {
  const percent = (value: unknown) => typeof value === "number" && Number.isFinite(value) ? Math.max(0, Math.min(100, Math.round(value))) : undefined;
  return {
    hostname: String(input.hostname || "Mac").slice(0, 80),
    osVersion: String(input.osVersion || "macOS").slice(0, 80),
    architecture: String(input.architecture || "unknown").slice(0, 20),
    diskUsedPercent: percent(input.diskUsedPercent),
    memoryUsedPercent: percent(input.memoryUsedPercent),
    firewallEnabled: typeof input.firewallEnabled === "boolean" ? input.firewallEnabled : undefined,
    collectedAt: new Date().toISOString(),
  };
}

function calculateRisk(telemetry: Telemetry): "LOW" | "MEDIUM" | "HIGH" {
  if ((telemetry.diskUsedPercent || 0) >= 95 || (telemetry.memoryUsedPercent || 0) >= 98) return "HIGH";
  if (telemetry.firewallEnabled === false || (telemetry.diskUsedPercent || 0) >= 85) return "MEDIUM";
  return "LOW";
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({})) as { enrollmentCode?: string; telemetry?: Telemetry };
  const db = getDb();
  const telemetry = cleanTelemetry(body.telemetry || {});
  const authorization = request.headers.get("authorization") || "";

  if (body.enrollmentCode) {
    const code = body.enrollmentCode.trim().toUpperCase();
    const [device] = await db.select().from(devices).where(eq(devices.enrollmentCode, code)).limit(1);
    if (!device || device.agentTokenHash) return Response.json({ error: "Invalid or already-used enrollment code" }, { status: 401 });
    const token = `${crypto.randomUUID().replaceAll("-", "")}${crypto.randomUUID().replaceAll("-", "")}`;
    await db.update(devices).set({ agentTokenHash: await sha256(token), status: "ONLINE", risk: calculateRisk(telemetry), telemetry: JSON.stringify(telemetry), lastSeenAt: new Date().toISOString() }).where(eq(devices.id, device.id));
    return Response.json({ agentToken: token, deviceId: device.id, status: "ONLINE", intervalSeconds: 120 });
  }

  if (!authorization.startsWith("Bearer ")) return Response.json({ error: "Missing agent token" }, { status: 401 });
  const tokenHash = await sha256(authorization.slice(7));
  const [device] = await db.select().from(devices).where(eq(devices.agentTokenHash, tokenHash)).limit(1);
  if (!device) return Response.json({ error: "Invalid agent token" }, { status: 401 });
  const risk = calculateRisk(telemetry);
  await db.update(devices).set({ status: "ONLINE", risk, telemetry: JSON.stringify(telemetry), lastSeenAt: new Date().toISOString() }).where(eq(devices.id, device.id));
  return Response.json({ deviceId: device.id, status: "ONLINE", risk, intervalSeconds: 120 });
}
