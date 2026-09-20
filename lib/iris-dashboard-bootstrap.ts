import { desc, eq, inArray } from "drizzle-orm";
import { headers } from "next/headers";
import { getDb } from "../db";
import { devices, trustedApplications } from "../db/schema";
import { deviceView } from "./iris-device-view";
import { irisReconnectOrigin } from "./iris-origin";

export async function dashboardDeviceBootstrap(user: { email: string; role: string }) {
  const headerList = await headers();
  const host = (headerList.get("x-forwarded-host") || headerList.get("host") || "").split(",")[0].trim();
  const proto = (headerList.get("x-forwarded-proto") || (host.includes("localhost") || host.startsWith("127.") || host.startsWith("[::1]") ? "http" : "https")).split(",")[0].trim();
  const pageOrigin = host ? `${proto}://${host}` : "http://127.0.0.1";
  const db = getDb();
  const deviceRows = user.role === "ADMIN"
    ? await db.select().from(devices).orderBy(desc(devices.createdAt))
    : await db.select().from(devices).where(eq(devices.ownerEmail, user.email)).orderBy(desc(devices.createdAt));
  const trustedRows = deviceRows.length ? await db.select().from(trustedApplications).where(inArray(trustedApplications.deviceId, deviceRows.map(device => device.id))) : [];
  return {
    devices: deviceRows.map(device => deviceView(device, trustedRows.filter(row => row.deviceId === device.id).map(row => row.appName))),
    agentOrigin: irisReconnectOrigin(pageOrigin, process.env.IRIS_PUBLIC_ORIGIN || ""),
  };
}
