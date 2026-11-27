import "server-only";

import { and, asc, desc, eq, gt, inArray, or, sql } from "drizzle-orm";
import { getDb } from "../db";
import { appSettings, auditEvents, passkeyCredentials, userPasswords, users } from "../db/schema";
import { logAudit } from "./authz";
import { auditEventHash } from "./iris-audit-chain.ts";
import { appendMemory, emptyMemoryStore, parseMemoryStore, type MemoryRecord } from "./iris-memory.ts";
import { mutateOrgDeskValue } from "./iris-org-store.ts";
import { requireOrgContext } from "./iris-tenant";
import { devAuthEnabled } from "../app/dev-auth";
import {
  assessPosture,
  buildThreatReport,
  classifyAuditEvents,
  newQuarantine,
  parseQuarantine,
  QUARANTINE_WINDOW_MS,
  quarantineActive,
  quarantineBody,
  trackActors,
  verifyAuditChain,
  type AuditChainRow,
  type AuditRow,
  type Quarantine,
} from "./iris-threats-core.ts";
import { detectAttackSignals } from "./iris-guardian.ts";

const QUARANTINE_PREFIX = "iris_guardian_quarantine:";
const THREAT_ACTIONS = [
  "ASK_IRIS_GUARDIAN_BLOCKED",
  "IRIS_AGENT_GUARDIAN_BLOCKED",
  "GUARDIAN_HISTORY_DROPPED",
  "GUARDIAN_ATTACK_SIGNAL",
  "GUARDIAN_QUARANTINE",
];

function quarantineKey(email: string) {
  return `${QUARANTINE_PREFIX}${email.trim().toLowerCase()}`;
}

/** Eventos de auditoría que pueden ser amenazas, del más reciente al más antiguo. */
export async function loadThreatRows(input: { email?: string; limit?: number } = {}): Promise<AuditRow[]> {
  const limit = Math.min(Math.max(input.limit ?? 200, 1), 500);
  const relevant = or(eq(auditEvents.outcome, "DENIED"), inArray(auditEvents.action, THREAT_ACTIONS));
  const where = input.email ? and(relevant, eq(auditEvents.actorEmail, input.email)) : relevant;
  const rows = await getDb().select().from(auditEvents).where(where).orderBy(desc(auditEvents.id)).limit(limit);
  return rows.map(row => ({ ...row, metadata: row.metadata || "{}" }));
}

export async function getQuarantine(email: string): Promise<Quarantine | null> {
  const [row] = await getDb().select().from(appSettings).where(eq(appSettings.key, quarantineKey(email))).limit(1);
  return row ? parseQuarantine(row.value) : null;
}

/** 423 si la cuenta está en cuarentena; `null` si puede seguir. */
export async function requireNotQuarantined(email: string, language: "es" | "en" = "es"): Promise<Response | null> {
  const quarantine = await getQuarantine(email);
  if (!quarantineActive(quarantine)) return null;
  return Response.json(quarantineBody(quarantine!, language), { status: 423 });
}

export async function listQuarantines(): Promise<Quarantine[]> {
  const rows = await getDb().select().from(appSettings).where(sql`${appSettings.key} LIKE ${`${QUARANTINE_PREFIX}%`}`).limit(100);
  return rows.map(row => parseQuarantine(row.value)).filter((item): item is Quarantine => Boolean(item));
}

export async function releaseQuarantine(email: string) {
  await getDb().delete(appSettings).where(eq(appSettings.key, quarantineKey(email)));
}

/**
 * Tras un bloqueo de Guardian: si la cuenta acumula ataques en la ventana,
 * la pone en cuarentena, lo registra para el administrador y deja una
 * lección PENDIENTE (un humano decide si se activa). Nunca falla la petición.
 */
export async function afterGuardianBlock(email: string): Promise<Quarantine | null> {
  try {
    if (quarantineActive(await getQuarantine(email))) return null;
    const since = new Date(Date.now() - QUARANTINE_WINDOW_MS - 60_000).toISOString().replace("T", " ").slice(0, 19);
    const rows = await getDb().select().from(auditEvents).where(and(
      eq(auditEvents.actorEmail, email),
      inArray(auditEvents.action, ["ASK_IRIS_GUARDIAN_BLOCKED", "IRIS_AGENT_GUARDIAN_BLOCKED", "GUARDIAN_HISTORY_DROPPED"]),
      gt(auditEvents.createdAt, since),
    )).orderBy(desc(auditEvents.id)).limit(50);
    const [track] = trackActors(classifyAuditEvents(rows));
    if (!track?.shouldQuarantine) return null;
    const quarantine = newQuarantine(track);
    await getDb().insert(appSettings).values({ key: quarantineKey(email), value: JSON.stringify(quarantine), updatedBy: "guardian" })
      .onConflictDoUpdate({ target: appSettings.key, set: { value: JSON.stringify(quarantine), updatedBy: "guardian", updatedAt: new Date().toISOString() } });
    const codes = [...new Set<string>(rows.map((row: { metadata: string | null }) => metadataCode(row.metadata)).filter(Boolean))].slice(0, 6);
    await logAudit(email, "GUARDIAN_QUARANTINE", "guardian", "SUCCESS", { until: quarantine.until, count: quarantine.count, reason: quarantine.reason, codes });
    await recordQuarantineLesson(email, quarantine, codes);
    return quarantine;
  } catch {
    return null;
  }
}

function metadataCode(metadata: string | null): string {
  try {
    const code = (JSON.parse(metadata || "{}") as { code?: unknown }).code;
    return typeof code === "string" ? code : "";
  } catch {
    return "";
  }
}

async function recordQuarantineLesson(email: string, quarantine: Quarantine, codes: string[]) {
  try {
    const ctx = await requireOrgContext(email);
    const lesson: MemoryRecord = {
      id: crypto.randomUUID(),
      kind: "lesson",
      title: `Guardian: ataques repetidos (${codes.join(", ") || "inyección"})`,
      body: `Guardian puso en cuarentena a ${email} tras ${quarantine.count} bloqueos en 10 minutos (${codes.join(", ") || "sin código"}). `
        + "Revisar si fue un ataque real (suspender la cuenta) o un falso positivo (levantar la cuarentena y proponer un ajuste del patrón, con revisión humana). "
        + "Esta lección no cambia el núcleo de IRIS.",
      tags: ["guardian", "threat", ...codes.slice(0, 4).map(code => code.toLowerCase())],
      createdAt: new Date().toISOString(),
      createdBy: "guardian@iris.local",
      promotion: "pending",
      sourceId: `quarantine:${email}:${quarantine.createdAt}`,
    };
    await mutateOrgDeskValue({
      kind: "memory",
      organizationId: ctx.organization.id,
      email,
      mutate: value => ({ value: JSON.stringify(appendMemory(value ? parseMemoryStore(value) : emptyMemoryStore(), lesson)), result: null }),
    });
  } catch {
    // aprender es best-effort; la cuarentena ya quedó registrada
  }
}

/** Registra señales de ataque web (no bloquean) para poder rastrear al actor. */
export async function recordAttackSignals(email: string, text: string, ip: string | null, language: "es" | "en" = "es") {
  const signals = detectAttackSignals(text, language);
  if (!signals.length) return;
  await logAudit(email, "GUARDIAN_ATTACK_SIGNAL", "ask_iris", "SUCCESS", {
    codes: signals.map(item => item.code),
    labels: signals.map(item => item.label),
    ...(ip ? { ip } : {}),
  }).catch(() => null);
}

export function requestIp(request: Request): string | null {
  const value = request.headers.get("cf-connecting-ip") || "";
  return value ? value.slice(0, 64) : null;
}

const CHAIN_SAMPLE = 300;

async function auditChainStatus() {
  const rows = await getDb().select().from(auditEvents).orderBy(desc(auditEvents.id)).limit(CHAIN_SAMPLE);
  const ascending = [...rows].reverse() as AuditChainRow[];
  return verifyAuditChain(ascending, row => auditEventHash(row.previousHash || "GENESIS", row.actorEmail, row.organizationId, row.action, row.resource, row.outcome, row.metadata));
}

export async function postureFindings(language: "es" | "en" = "es") {
  const db = getDb();
  const activeUsers = await db.select({ email: users.email, role: users.role }).from(users).where(eq(users.status, "ACTIVE")).orderBy(asc(users.email)).limit(500);
  const emails = activeUsers.map(item => item.email);
  const withPasskey = emails.length ? await db.selectDistinct({ email: passkeyCredentials.ownerEmail }).from(passkeyCredentials).where(inArray(passkeyCredentials.ownerEmail, emails)) : [];
  const withPassword = emails.length ? await db.select({ email: userPasswords.ownerEmail }).from(userPasswords).where(inArray(userPasswords.ownerEmail, emails)) : [];
  const protectedEmails = new Set([...withPasskey, ...withPassword].map(item => item.email));
  const chain = await auditChainStatus();
  const devSkip = devAuthEnabled();
  return {
    chain,
    findings: assessPosture({
      nodeEnv: String(process.env.NODE_ENV || ""),
      devSkipStepUp: String(process.env.IRIS_DEV_SKIP_STEPUP || "") === "1",
      ownerEmail: String(process.env.IRIS_OWNER_EMAIL || "").trim(),
      billingLive: String(process.env.IRIS_BILLING_LIVE || "") === "1",
      // En local el step-up está desactivado a propósito: no se reportan
      // cuentas sin factor como vulnerabilidad de producción.
      admins: devSkip ? [] : activeUsers.filter(item => item.role === "ADMIN").map(item => ({ email: item.email, factorEnrolled: protectedEmails.has(item.email) })),
      activeUsers: activeUsers.length,
      usersWithoutFactor: devSkip ? 0 : activeUsers.filter(item => !protectedEmails.has(item.email)).length,
      auditChain: chain,
    }, language),
  };
}

// La revisión de postura recalcula ~300 hashes de auditoría. El panel sondea
// cada 5 s, así que el resultado se reutiliza 60 s dentro del mismo isolate.
const POSTURE_TTL_MS = 60_000;
const postureCache = new Map<string, { at: number; value: Awaited<ReturnType<typeof postureFindings>> }>();

async function cachedPosture(language: "es" | "en") {
  const hit = postureCache.get(language);
  if (hit && Date.now() - hit.at < POSTURE_TTL_MS) return hit.value;
  const value = await postureFindings(language);
  postureCache.set(language, { at: Date.now(), value });
  return value;
}

/** Todo lo que ve el panel y el reporte: siempre datos reales. */
export async function threatSnapshot(input: { email: string; role: string; language: "es" | "en"; userName?: string }) {
  const admin = input.role === "ADMIN";
  const rows = await loadThreatRows(admin ? {} : { email: input.email });
  const threats = classifyAuditEvents(rows, input.language);
  const actors = admin ? trackActors(threats) : [];
  const quarantines = admin ? await listQuarantines() : [];
  const own = admin ? null : await getQuarantine(input.email);
  const posture = admin ? await cachedPosture(input.language) : { findings: [], chain: null };
  const report = buildThreatReport({
    threats,
    actors,
    quarantines: admin ? quarantines : own ? [own] : [],
    posture: posture.findings,
    language: input.language,
    userName: input.userName,
    windowLabel: input.language === "es" ? `en los últimos ${rows.length} eventos de seguridad` : `in the last ${rows.length} security events`,
  });
  return {
    generatedAt: report.generatedAt,
    scope: admin ? "organization" : "own",
    report,
    threats: threats.slice(0, 100),
    actors: actors.slice(0, 25),
    quarantines: quarantines.filter(item => quarantineActive(item)),
    posture: posture.findings,
    auditChain: posture.chain,
  };
}
