import { getChatGPTUser } from "../../chatgpt-auth";
import { logAudit, provisionIrisUser, updateUserAccess } from "../../../lib/authz";
import { requireStepUp } from "../../../lib/iris-step-up";
import { enforceRateLimit } from "../../../lib/rate-limit";
import { getQuarantine, releaseQuarantine, threatSnapshot } from "../../../lib/iris-threats";
import { quarantineActive } from "../../../lib/iris-threats-core";
import { userFriendlyName } from "../../../lib/iris-names";
import { getDb } from "../../../db";
import { users } from "../../../db/schema";
import { eq } from "drizzle-orm";

export const dynamic = "force-dynamic";

async function currentUser() {
  const identity = await getChatGPTUser();
  return identity ? provisionIrisUser(identity) : null;
}

/**
 * Panel de Guardian en tiempo real. Lee solo el registro de auditoría: no
 * inventa ataques. El panel lo consulta cada pocos segundos.
 */
export async function GET(request: Request) {
  const user = await currentUser();
  if (!user || user.status !== "ACTIVE") return Response.json({ error: "Unauthorized" }, { status: 401 });
  const stepUp = await requireStepUp(user.email);
  if (stepUp) return stepUp;
  if (!(await enforceRateLimit(`iris-threats:${user.email}`, 40, 60 * 1000))) {
    return Response.json({ error: "Demasiadas consultas. Espera un momento." }, { status: 429, headers: { "Retry-After": "60" } });
  }
  const params = new URL(request.url).searchParams;
  const language = params.get("language") === "en" ? "en" : "es";
  const snapshot = await threatSnapshot({
    email: user.email,
    role: user.role,
    language,
    userName: await userFriendlyName(user),
  });
  return Response.json(snapshot, { headers: { "Cache-Control": "no-store" } });
}

/**
 * Acciones del administrador sobre una amenaza. Guardian solo contiene;
 * suspender una cuenta o levantar una cuarentena es una decisión humana.
 */
export async function POST(request: Request) {
  const user = await currentUser();
  if (!user || user.status !== "ACTIVE") return Response.json({ error: "Unauthorized" }, { status: 401 });
  const stepUp = await requireStepUp(user.email);
  if (stepUp) return stepUp;
  if (user.role !== "ADMIN") {
    await logAudit(user.email, "GUARDIAN_ADMIN_ACTION", "guardian", "DENIED", { reason: "admin_required" });
    return Response.json({ error: "Solo un administrador puede actuar sobre amenazas." }, { status: 403 });
  }
  const body = await request.json().catch(() => ({})) as { action?: string; email?: string };
  const target = String(body.email || "").trim().toLowerCase();
  if (!target.includes("@")) return Response.json({ error: "Indica la cuenta." }, { status: 400 });

  if (body.action === "release") {
    const quarantine = await getQuarantine(target);
    if (!quarantineActive(quarantine)) return Response.json({ error: "Esa cuenta no está en cuarentena." }, { status: 404 });
    await releaseQuarantine(target);
    await logAudit(user.email, "GUARDIAN_QUARANTINE_RELEASED", target, "SUCCESS", { until: quarantine!.until });
    return Response.json({ released: true, email: target });
  }

  if (body.action === "suspend") {
    const [targetUser] = await getDb().select().from(users).where(eq(users.email, target)).limit(1);
    if (!targetUser) return Response.json({ error: "Usuario no encontrado." }, { status: 404 });
    try {
      // updateUserAccess ya impide suspenderse a uno mismo y dejar IRIS sin administradores.
      await updateUserAccess(user.email, user.role, target, targetUser.role, "SUSPENDED");
    } catch (error) {
      return Response.json({ error: error instanceof Error ? error.message : "No se pudo suspender." }, { status: 400 });
    }
    await logAudit(user.email, "GUARDIAN_THREAT_SUSPENDED", target, "SUCCESS", {});
    return Response.json({ suspended: true, email: target });
  }

  return Response.json({ error: "Acción desconocida." }, { status: 400 });
}
