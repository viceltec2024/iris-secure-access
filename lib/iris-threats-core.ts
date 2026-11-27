/**
 * IRIS Guardian — registro de amenazas, rastreo y reporte (puro, sin BD).
 *
 * Solo trabaja con eventos REALES del registro de auditoría: si no hay
 * eventos, el reporte dice que no hay ataques. No inventa incidentes,
 * ubicaciones ni acciones. "Eliminar" una amenaza significa contenerla
 * (bloqueo, cuarentena temporal y reversible) y avisar al administrador;
 * suspender a un usuario o tocar un equipo exige una decisión humana.
 */

export type ThreatSeverity = "low" | "medium" | "high" | "critical";
export type ThreatCategory =
  | "prompt_injection"
  | "attack_probe"
  | "credential_attack"
  | "step_up_bypass"
  | "privilege_escalation"
  | "tenant_boundary"
  | "abuse_rate_limit"
  | "containment";

export type AuditRow = {
  id: number;
  actorEmail: string;
  action: string;
  resource: string;
  outcome: string;
  metadata: string;
  createdAt: string;
};

export type ThreatEvent = {
  id: number;
  at: string;
  actor: string;
  ip: string | null;
  category: ThreatCategory;
  code: string;
  severity: ThreatSeverity;
  title: string;
  explanation: string;
  actionTaken: string;
  source: string;
};

const SEVERITY_RANK: Record<ThreatSeverity, number> = { low: 1, medium: 2, high: 3, critical: 4 };
export const QUARANTINE_WINDOW_MS = 10 * 60 * 1000;
export const QUARANTINE_DURATION_MS = 15 * 60 * 1000;
/** Bloqueos de Guardian de severidad alta, o de cualquier severidad, en la ventana. */
export const QUARANTINE_HIGH_THRESHOLD = 3;
export const QUARANTINE_ANY_THRESHOLD = 5;

const GUARDIAN_HIGH_CODES = new Set(["SECRET_EXFIL", "CORE_MUTATION", "SHELL_ESCAPE", "ROLE_HIJACK", "PROMPT_LEAK", "SSRF_METADATA"]);

/** D1 guarda CURRENT_TIMESTAMP como "YYYY-MM-DD HH:MM:SS" (UTC, sin zona). */
export function auditTimestamp(value: string): number {
  const raw = String(value || "").trim();
  if (!raw) return Number.NaN;
  const iso = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(raw) ? `${raw.replace(" ", "T")}Z` : raw;
  return Date.parse(iso);
}

function parseMetadata(value: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(value || "{}") as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

function baseCode(code: string) {
  return code.replace(/_(PARAPHRASE|ENCODED)$/, "");
}

type Copy = { title: string; explanation: string; actionTaken: string };

function guardianCopy(code: string, source: string, es: boolean): Copy {
  const base = baseCode(code);
  const encoded = code.endsWith("_ENCODED");
  const where = source === "agent" ? (es ? "al agente de análisis" : "to the analysis agent") : (es ? "a Ask IRIS" : "to Ask IRIS");
  const titles: Record<string, [string, string]> = {
    IGNORE_PRIOR: ["Intento de anular las reglas de IRIS", "Attempt to override IRIS rules"],
    ROLE_HIJACK: ["Intento de secuestrar el rol de IRIS", "Attempt to hijack IRIS's role"],
    SECRET_EXFIL: ["Intento de robar claves o contraseñas", "Attempt to steal keys or passwords"],
    CORE_MUTATION: ["Intento de modificar el núcleo de IRIS", "Attempt to modify IRIS core"],
    SHELL_ESCAPE: ["Intento de ejecutar comandos del sistema", "Attempt to run system commands"],
    PROMPT_LEAK: ["Intento de extraer las instrucciones internas", "Attempt to extract internal instructions"],
    SSRF_METADATA: ["Intento de alcanzar servicios internos", "Attempt to reach internal services"],
    OVERSIZE: ["Mensaje enorme para esconder una orden", "Oversized message to hide an instruction"],
  };
  const explanations: Record<string, [string, string]> = {
    IGNORE_PRIOR: ["Alguien pidió a IRIS que olvidara sus instrucciones de seguridad para que obedeciera otras.", "Someone asked IRIS to forget its security instructions so it would follow others."],
    ROLE_HIJACK: ["El mensaje intentaba que IRIS actuara como un administrador o un asistente sin límites.", "The message tried to make IRIS act as an admin or an unrestricted assistant."],
    SECRET_EXFIL: ["El mensaje pedía mostrar o volcar claves de API, tokens o contraseñas.", "The message asked to show or dump API keys, tokens or passwords."],
    CORE_MUTATION: ["El mensaje pedía que IRIS cambiara su propio código o empujara cambios a main.", "The message asked IRIS to change its own code or push to main."],
    SHELL_ESCAPE: ["El mensaje contenía comandos de terminal peligrosos (borrar, descargar o ejecutar).", "The message contained dangerous terminal commands (delete, download or execute)."],
    PROMPT_LEAK: ["El mensaje intentaba que IRIS revelara sus instrucciones internas, que sirven para preparar ataques más precisos.", "The message tried to make IRIS reveal its internal instructions, which help craft sharper attacks."],
    SSRF_METADATA: ["El mensaje apuntaba a direcciones internas de metadatos de la nube, donde suele haber credenciales.", "The message pointed at internal cloud metadata addresses, where credentials often live."],
    OVERSIZE: ["El mensaje era demasiado grande para analizarlo entero; se bloqueó completo por seguridad.", "The message was too large to scan completely; it was blocked entirely for safety."],
  };
  const [titleEs, titleEn] = titles[base] || ["Instrucción insegura bloqueada", "Unsafe instruction blocked"];
  const [explEs, explEn] = explanations[base] || ["Guardian detectó un patrón inseguro en el mensaje.", "Guardian detected an unsafe pattern in the message."];
  const encodedNote = encoded ? (es ? " Venía codificado para esquivar el filtro." : " It was encoded to evade the filter.") : "";
  return {
    title: es ? titleEs : titleEn,
    explanation: (es ? explEs : explEn) + encodedNote,
    actionTaken: es ? `Guardian bloqueó el mensaje antes de que llegara ${where}.` : `Guardian blocked the message before it reached ${where}.`,
  };
}

/**
 * Convierte un evento de auditoría en una amenaza, o `null` si no es una
 * señal de ataque (la mayoría de eventos son actividad normal).
 */
export function classifyAuditEvent(row: AuditRow, language: "es" | "en" = "es"): ThreatEvent | null {
  const es = language === "es";
  const meta = parseMetadata(row.metadata);
  const ip = typeof meta.ip === "string" && meta.ip ? meta.ip.slice(0, 64) : null;
  const reason = typeof meta.reason === "string" ? meta.reason : "";
  const base = { id: row.id, at: row.createdAt, actor: row.actorEmail, ip };
  const make = (category: ThreatCategory, code: string, severity: ThreatSeverity, copy: Copy, source = row.resource): ThreatEvent => ({ ...base, category, code, severity, source, ...copy });

  if (row.action === "ASK_IRIS_GUARDIAN_BLOCKED" || row.action === "IRIS_AGENT_GUARDIAN_BLOCKED") {
    const code = typeof meta.code === "string" ? meta.code : "UNKNOWN";
    const phase = typeof meta.phase === "string" ? meta.phase : "";
    if (phase) {
      // Inyección indirecta: la orden venía en la salida del modelo o de una
      // herramienta, no la escribió el usuario. No cuenta para su cuarentena.
      const copy = guardianCopy(code, "agent", es);
      return make("prompt_injection", code, GUARDIAN_HIGH_CODES.has(baseCode(code)) ? "high" : "medium", {
        title: copy.title,
        explanation: es
          ? `${phase === "model_output" ? "La respuesta del modelo" : "El resultado de una herramienta"} traía esta instrucción insegura (inyección indirecta). ${copy.explanation}`
          : `${phase === "model_output" ? "The model's reply" : "A tool result"} carried this unsafe instruction (indirect injection). ${copy.explanation}`,
        actionTaken: es ? "Guardian cortó la ejecución del agente en ese paso." : "Guardian stopped the agent run at that step.",
      }, "agent_output");
    }
    const source = row.action === "IRIS_AGENT_GUARDIAN_BLOCKED" ? "agent" : "ask";
    return make("prompt_injection", code, GUARDIAN_HIGH_CODES.has(baseCode(code)) ? "high" : "medium", guardianCopy(code, source, es), source);
  }
  if (row.action === "GUARDIAN_HISTORY_DROPPED") {
    return make("prompt_injection", "HISTORY_INJECTION", "medium", {
      title: es ? "Instrucción escondida en el historial" : "Instruction hidden in history",
      explanation: es ? "Un mensaje anterior de la conversación traía una orden insegura (puede haberse falsificado desde el navegador)." : "An earlier message carried an unsafe instruction (it may have been forged from the browser).",
      actionTaken: es ? "Guardian quitó ese mensaje antes de enviar la conversación al modelo." : "Guardian removed that message before sending the conversation to the model.",
    });
  }
  if (row.action === "GUARDIAN_ATTACK_SIGNAL") {
    const codes = Array.isArray(meta.codes) ? meta.codes.filter((item): item is string => typeof item === "string") : [];
    const labels = Array.isArray(meta.labels) ? meta.labels.filter((item): item is string => typeof item === "string") : [];
    return make("attack_probe", codes[0] || "ATTACK_PROBE", "low", {
      title: es ? "Sonda de ataque web" : "Web attack probe",
      explanation: es
        ? `El mensaje traía la forma de un ataque contra aplicaciones (${labels.join(", ") || "sonda"}). IRIS usa consultas parametrizadas y escapa el HTML, así que no tiene efecto, pero indica que alguien está probando.`
        : `The message had the shape of an application attack (${labels.join(", ") || "probe"}). IRIS uses parameterized queries and escapes HTML, so it has no effect, but it shows someone is probing.`,
      actionTaken: es ? "Registrado para rastrear al actor; no se bloquea porque también es una pregunta válida." : "Logged to track the actor; not blocked because it is also a valid question.",
    });
  }
  if (row.action === "GUARDIAN_QUARANTINE") {
    const until = typeof meta.until === "string" ? meta.until : "";
    return make("containment", "QUARANTINE", "high", {
      title: es ? "Actor en cuarentena" : "Actor quarantined",
      explanation: es
        ? `Guardian detectó ataques repetidos de esta cuenta (${String(meta.count ?? "?")} en 10 minutos).`
        : `Guardian detected repeated attacks from this account (${String(meta.count ?? "?")} in 10 minutes).`,
      actionTaken: es
        ? `Ask IRIS, agentes, Creator y Misiones quedan bloqueados para esta cuenta${until ? ` hasta ${until}` : ""}. Un administrador puede levantarlo o suspender la cuenta.`
        : `Ask IRIS, agents, Creator and Missions are blocked for this account${until ? ` until ${until}` : ""}. An admin can lift it or suspend the account.`,
    }, "guardian");
  }
  if (row.outcome !== "DENIED") return null;

  if (row.action === "STEP_UP_FACTOR_ENROLLMENT") {
    return make("step_up_bypass", "FACTOR_ENROLLMENT_BLOCKED", "high", {
      title: es ? "Intento de añadir una passkey sin verificar" : "Attempt to add a passkey without verifying",
      explanation: es ? "Alguien con la sesión de ChatGPT intentó inscribir su propia passkey o contraseña sin verificar la que ya existe. Es la forma típica de usar una sesión robada." : "Someone with the ChatGPT session tried to enroll their own passkey or password without verifying the existing one. That is the typical way to use a stolen session.",
      actionTaken: es ? "Rechazado. Si no fuiste tú, cierra sesión en ChatGPT en todos los dispositivos." : "Rejected. If it wasn't you, sign out of ChatGPT on every device.",
    });
  }
  if (row.action === "IRIS_PASSWORD_VERIFIED" || row.action === "BIOMETRIC_VERIFICATION" || row.action === "IRIS_PASSWORD_CHANGED") {
    const limited = reason === "rate_limited";
    return make("credential_attack", limited ? "PASSWORD_RATE_LIMITED" : "VERIFICATION_FAILED", limited ? "high" : "medium", {
      title: limited ? (es ? "Demasiados intentos de contraseña" : "Too many password attempts") : (es ? "Verificación fallida" : "Failed verification"),
      explanation: limited
        ? (es ? "Se superó el límite de intentos de contraseña: parece un intento de adivinarla." : "The password attempt limit was exceeded: it looks like a guessing attempt.")
        : (es ? "Una contraseña o passkey de IRIS no se pudo verificar." : "An IRIS password or passkey could not be verified."),
      actionTaken: limited ? (es ? "Bloqueado 15 minutos por el límite de intentos." : "Blocked for 15 minutes by the attempt limit.") : (es ? "Acceso denegado." : "Access denied."),
    });
  }
  if (["USER_ACCESS_CHANGED", "USER_LIST_VIEWED", "USER_AUDIT_VIEWED", "ADMIN_USERS_OPENED"].includes(row.action)) {
    if (reason === "self_lockout_prevented" || reason === "last_admin_protected") return null;
    return make("privilege_escalation", reason === "step_up_required" ? "ADMIN_WITHOUT_STEP_UP" : "ADMIN_ACCESS_DENIED", "high", {
      title: es ? "Intento de entrar en la administración" : "Attempt to reach administration",
      explanation: reason === "step_up_required"
        ? (es ? "Se intentó abrir la administración de usuarios sin verificar la passkey o contraseña." : "User administration was opened without verifying the passkey or password.")
        : (es ? "Una cuenta sin rol de administrador intentó ver o cambiar accesos de usuarios." : "A non-admin account tried to view or change user access."),
      actionTaken: es ? "Denegado y registrado." : "Denied and logged.",
    });
  }
  if (row.action === "ORG_DENIED" || row.action === "ORG_ACCESS") {
    return make("tenant_boundary", "ORG_BOUNDARY", "medium", {
      title: es ? "Intento de acceder a otra organización" : "Attempt to access another organization",
      explanation: es ? "Una cuenta pidió datos o acciones de una organización a la que no pertenece." : "An account requested data or actions from an organization it does not belong to.",
      actionTaken: es ? "Denegado por el aislamiento entre organizaciones." : "Denied by tenant isolation.",
    });
  }
  if (reason === "rate_limited") {
    return make("abuse_rate_limit", "RATE_LIMITED", "low", {
      title: es ? "Uso excesivo" : "Excessive use",
      explanation: es ? `Se superó el límite de peticiones en ${row.action}.` : `The request limit was exceeded on ${row.action}.`,
      actionTaken: es ? "Peticiones frenadas temporalmente." : "Requests temporarily throttled.",
    });
  }
  return null;
}

export function classifyAuditEvents(rows: AuditRow[], language: "es" | "en" = "es"): ThreatEvent[] {
  return rows.map(row => classifyAuditEvent(row, language)).filter((item): item is ThreatEvent => Boolean(item));
}

export type ActorTrack = {
  actor: string;
  ips: string[];
  total: number;
  inWindow: number;
  highInWindow: number;
  maxSeverity: ThreatSeverity;
  categories: ThreatCategory[];
  lastAt: string;
  shouldQuarantine: boolean;
};

/** Agrupa amenazas por cuenta y decide si hace falta cuarentena. */
export function trackActors(threats: ThreatEvent[], now = Date.now(), windowMs = QUARANTINE_WINDOW_MS): ActorTrack[] {
  const byActor = new Map<string, ActorTrack>();
  for (const threat of threats) {
    if (threat.category === "containment") continue;
    const track = byActor.get(threat.actor) || {
      actor: threat.actor, ips: [], total: 0, inWindow: 0, highInWindow: 0, maxSeverity: "low" as ThreatSeverity,
      categories: [], lastAt: threat.at, shouldQuarantine: false,
    };
    track.total += 1;
    const at = auditTimestamp(threat.at);
    const recent = Number.isFinite(at) && now - at <= windowMs && now - at >= -60_000;
    if (recent && threat.category === "prompt_injection" && threat.source !== "agent_output") {
      track.inWindow += 1;
      if (SEVERITY_RANK[threat.severity] >= SEVERITY_RANK.high) track.highInWindow += 1;
    }
    if (SEVERITY_RANK[threat.severity] > SEVERITY_RANK[track.maxSeverity]) track.maxSeverity = threat.severity;
    if (!track.categories.includes(threat.category)) track.categories.push(threat.category);
    if (threat.ip && !track.ips.includes(threat.ip) && track.ips.length < 5) track.ips.push(threat.ip);
    if (auditTimestamp(threat.at) > auditTimestamp(track.lastAt)) track.lastAt = threat.at;
    byActor.set(threat.actor, track);
  }
  return [...byActor.values()]
    .map(track => ({ ...track, shouldQuarantine: track.highInWindow >= QUARANTINE_HIGH_THRESHOLD || track.inWindow >= QUARANTINE_ANY_THRESHOLD }))
    .sort((a, b) => SEVERITY_RANK[b.maxSeverity] - SEVERITY_RANK[a.maxSeverity] || b.total - a.total);
}

export type Quarantine = { email: string; until: string; reason: string; count: number; createdAt: string };

export function parseQuarantine(value: string): Quarantine | null {
  try {
    const parsed = JSON.parse(value || "") as Partial<Quarantine>;
    if (typeof parsed.email !== "string" || typeof parsed.until !== "string") return null;
    return {
      email: parsed.email,
      until: parsed.until,
      reason: typeof parsed.reason === "string" ? parsed.reason : "",
      count: typeof parsed.count === "number" ? parsed.count : 0,
      createdAt: typeof parsed.createdAt === "string" ? parsed.createdAt : "",
    };
  } catch {
    return null;
  }
}

export function quarantineActive(quarantine: Quarantine | null, now = Date.now()): boolean {
  if (!quarantine) return false;
  const until = Date.parse(quarantine.until);
  return Number.isFinite(until) && until > now;
}

export function newQuarantine(track: ActorTrack, now = Date.now()): Quarantine {
  return {
    email: track.actor,
    until: new Date(now + QUARANTINE_DURATION_MS).toISOString(),
    reason: track.highInWindow >= QUARANTINE_HIGH_THRESHOLD ? "repeated_high_severity_injection" : "repeated_injection",
    count: track.inWindow,
    createdAt: new Date(now).toISOString(),
  };
}

/** "02:25 UTC": legible en texto y en voz, sin depender de la zona del servidor. */
export function quarantineUntilLabel(until: string): string {
  const at = Date.parse(until);
  if (!Number.isFinite(at)) return until;
  return `${new Date(at).toISOString().slice(11, 16)} UTC`;
}

export function quarantineBody(quarantine: Quarantine, language: "es" | "en" = "es") {
  const label = quarantineUntilLabel(quarantine.until);
  return {
    error: language === "en"
      ? `Guardian paused AI features for this account after repeated attacks, until ${label} (about 15 minutes). An administrator was notified.`
      : `Guardian pausó las funciones de IA de esta cuenta tras ataques repetidos, hasta las ${label} (unos 15 minutos). Se avisó al administrador.`,
    code: "guardian_quarantine",
    until: quarantine.until,
  };
}

export type PostureFinding = { code: string; severity: ThreatSeverity; title: string; detail: string; fix: string };

export type PostureInput = {
  nodeEnv: string;
  devSkipStepUp: boolean;
  ownerEmail: string;
  billingLive: boolean;
  admins: Array<{ email: string; factorEnrolled: boolean }>;
  activeUsers: number;
  usersWithoutFactor: number;
  auditChain: AuditChainResult;
};

/** Revisión de vulnerabilidades de configuración, solo con datos reales. */
export function assessPosture(input: PostureInput, language: "es" | "en" = "es"): PostureFinding[] {
  const es = language === "es";
  const findings: PostureFinding[] = [];
  const production = input.nodeEnv === "production";
  if (production && input.devSkipStepUp) {
    findings.push({ code: "DEV_STEP_UP_IN_PRODUCTION", severity: "critical", title: es ? "Modo local activo en producción" : "Local mode enabled in production", detail: es ? "IRIS_DEV_SKIP_STEPUP=1 está definido en producción." : "IRIS_DEV_SKIP_STEPUP=1 is set in production.", fix: es ? "Quita IRIS_DEV_SKIP_STEPUP de los secretos de producción." : "Remove IRIS_DEV_SKIP_STEPUP from production secrets." });
  }
  if (!input.ownerEmail) {
    findings.push({ code: "OWNER_EMAIL_MISSING", severity: "high", title: es ? "Sin propietario configurado" : "No owner configured", detail: es ? "IRIS_OWNER_EMAIL no está definido: nadie nuevo recibe el rol ADMIN." : "IRIS_OWNER_EMAIL is not set: no new user receives ADMIN.", fix: es ? "Define IRIS_OWNER_EMAIL con el correo del propietario." : "Set IRIS_OWNER_EMAIL to the owner's email." });
  }
  if (input.billingLive) {
    findings.push({ code: "BILLING_LIVE", severity: "high", title: es ? "Cobros reales activos" : "Live billing enabled", detail: es ? "IRIS_BILLING_LIVE está activo." : "IRIS_BILLING_LIVE is enabled.", fix: es ? "Desactívalo salvo autorización expresa del propietario." : "Disable it unless the owner explicitly authorized it." });
  }
  const unprotectedAdmins = input.admins.filter(admin => !admin.factorEnrolled);
  if (unprotectedAdmins.length) {
    findings.push({ code: "ADMIN_WITHOUT_FACTOR", severity: "high", title: es ? "Administradores sin passkey ni contraseña" : "Admins without passkey or password", detail: es ? `${unprotectedAdmins.length} administrador(es) entran solo con la sesión de ChatGPT: ${unprotectedAdmins.map(item => item.email).join(", ")}.` : `${unprotectedAdmins.length} admin(s) sign in with the ChatGPT session only: ${unprotectedAdmins.map(item => item.email).join(", ")}.`, fix: es ? "Cada administrador debe crear una passkey o contraseña de IRIS." : "Every admin should create an IRIS passkey or password." });
  }
  if (input.usersWithoutFactor > 0) {
    findings.push({ code: "USERS_WITHOUT_FACTOR", severity: "medium", title: es ? "Usuarios sin segundo factor" : "Users without a second factor", detail: es ? `${input.usersWithoutFactor} de ${input.activeUsers} usuarios activos no tienen passkey ni contraseña.` : `${input.usersWithoutFactor} of ${input.activeUsers} active users have no passkey or password.`, fix: es ? "Pídeles que protejan su acceso desde el aviso del dashboard." : "Ask them to protect their access from the dashboard prompt." });
  }
  if (input.auditChain.broken.length) {
    findings.push({ code: "AUDIT_CHAIN_BROKEN", severity: "critical", title: es ? "Registro de auditoría alterado" : "Audit log tampered", detail: es ? `${input.auditChain.broken.length} evento(s) no cuadran con su hash (primero: #${input.auditChain.broken[0]}).` : `${input.auditChain.broken.length} event(s) do not match their hash (first: #${input.auditChain.broken[0]}).`, fix: es ? "Exporta el registro, revisa quién tiene acceso a la base de datos D1 y rota credenciales." : "Export the log, review who can access the D1 database and rotate credentials." });
  }
  return findings.sort((a, b) => SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity]);
}

export type AuditChainRow = {
  id: number;
  actorEmail: string;
  organizationId: string | null;
  action: string;
  resource: string;
  outcome: "SUCCESS" | "DENIED";
  metadata: string;
  previousHash: string | null;
  eventHash: string | null;
};

export type AuditChainResult = { checked: number; broken: number[]; contended: number; legacy: number };

/**
 * Recalcula el hash de cada evento (orden ascendente por id). Un hash que no
 * cuadra es una alteración. Un evento marcado `auditChainContended` puede no
 * encadenar con el anterior por contención (ver logAudit) y no se cuenta
 * como roto; los eventos antiguos sin hash se cuentan como `legacy`.
 */
export async function verifyAuditChain(rows: AuditChainRow[], hash: (row: AuditChainRow) => Promise<string>): Promise<AuditChainResult> {
  const result: AuditChainResult = { checked: 0, broken: [], contended: 0, legacy: 0 };
  let previous: AuditChainRow | null = null;
  for (const row of rows) {
    if (!row.eventHash) { result.legacy += 1; previous = row; continue; }
    result.checked += 1;
    const contended = row.metadata.includes("\"auditChainContended\":true");
    if (contended) result.contended += 1;
    const recomputed = await hash(row);
    const linked = !previous || !previous.eventHash || row.previousHash === previous.eventHash || contended;
    if (recomputed !== row.eventHash || !linked) result.broken.push(row.id);
    previous = row;
  }
  return result;
}

export type ThreatReport = {
  generatedAt: string;
  status: "clear" | "watch" | "under_attack";
  counts: Record<ThreatSeverity, number>;
  totalThreats: number;
  activeQuarantines: number;
  spoken: string;
  recommendations: string[];
};

/**
 * Reporte para el administrador. `spoken` es texto plano (sin markdown) para
 * leerlo en voz alta en Ask IRIS.
 */
export function buildThreatReport(input: {
  threats: ThreatEvent[];
  actors: ActorTrack[];
  quarantines: Quarantine[];
  posture: PostureFinding[];
  language?: "es" | "en";
  userName?: string;
  now?: number;
  windowLabel?: string;
}): ThreatReport {
  const es = (input.language || "es") === "es";
  const now = input.now ?? Date.now();
  const counts: Record<ThreatSeverity, number> = { low: 0, medium: 0, high: 0, critical: 0 };
  const attacks = input.threats.filter(item => item.category !== "containment");
  for (const threat of attacks) counts[threat.severity] += 1;
  const active = input.quarantines.filter(item => quarantineActive(item, now));
  const recentHigh = attacks.filter(item => SEVERITY_RANK[item.severity] >= SEVERITY_RANK.high && now - auditTimestamp(item.at) <= 60 * 60 * 1000).length;
  const status: ThreatReport["status"] = active.length || recentHigh >= 3 ? "under_attack" : attacks.length || input.posture.length ? "watch" : "clear";
  const name = input.userName ? `${input.userName}, ` : "";
  const parts: string[] = [];
  const windowLabel = input.windowLabel || (es ? "en los eventos recientes" : "in recent events");

  if (!attacks.length) {
    parts.push(es ? `${name}no hay ataques registrados ${windowLabel}. Guardian está activo y no ha tenido que bloquear nada.` : `${name}there are no recorded attacks ${windowLabel}. Guardian is active and has not had to block anything.`);
  } else {
    const latest = attacks[0];
    parts.push(es
      ? `${name}Guardian registró ${attacks.length} ${attacks.length === 1 ? "amenaza" : "amenazas"} ${windowLabel}: ${counts.critical + counts.high} de severidad alta, ${counts.medium} media y ${counts.low} baja.`
      : `${name}Guardian recorded ${attacks.length} ${attacks.length === 1 ? "threat" : "threats"} ${windowLabel}: ${counts.critical + counts.high} high, ${counts.medium} medium and ${counts.low} low.`);
    parts.push(es
      ? `La más reciente: ${latest.title.toLowerCase()}, desde la cuenta ${latest.actor}. ${latest.explanation} ${latest.actionTaken}`
      : `Most recent: ${latest.title.toLowerCase()}, from account ${latest.actor}. ${latest.explanation} ${latest.actionTaken}`);
    const top = input.actors[0];
    if (top && top.total > 1) {
      parts.push(es ? `La cuenta más activa es ${top.actor}, con ${top.total} eventos.` : `The most active account is ${top.actor}, with ${top.total} events.`);
    }
  }
  if (active.length) {
    parts.push(es
      ? `${active.length === 1 ? "Hay una cuenta" : `Hay ${active.length} cuentas`} en cuarentena: ${active.map(item => item.email).join(", ")}.`
      : `${active.length === 1 ? "One account is" : `${active.length} accounts are`} quarantined: ${active.map(item => item.email).join(", ")}.`);
  }
  if (input.posture.length) {
    const first = input.posture[0];
    parts.push(es
      ? `En la configuración encontré ${input.posture.length} ${input.posture.length === 1 ? "punto débil" : "puntos débiles"}. El más importante: ${first.title.toLowerCase()}. ${first.fix}`
      : `I found ${input.posture.length} configuration ${input.posture.length === 1 ? "weakness" : "weaknesses"}. The most important: ${first.title.toLowerCase()}. ${first.fix}`);
  }

  const recommendations: string[] = [];
  for (const finding of input.posture.slice(0, 3)) recommendations.push(finding.fix);
  for (const quarantine of active) {
    recommendations.push(es
      ? `Revisa la actividad de ${quarantine.email}: si es un ataque real, suspende la cuenta; si fue un falso positivo, levanta la cuarentena.`
      : `Review ${quarantine.email}'s activity: if it is a real attack, suspend the account; if it was a false positive, lift the quarantine.`);
  }
  if (attacks.some(item => item.category === "step_up_bypass")) {
    recommendations.push(es ? "Hubo intentos de añadir passkeys sin verificar: cierra la sesión de ChatGPT en todos los dispositivos del usuario afectado." : "There were attempts to add passkeys without verifying: sign the affected user out of ChatGPT on every device.");
  }
  if (!recommendations.length && attacks.length) {
    recommendations.push(es ? "No hace falta actuar ahora: Guardian contuvo todo. Vigila si la misma cuenta repite." : "No action needed now: Guardian contained everything. Watch whether the same account repeats.");
  }

  return {
    generatedAt: new Date(now).toISOString(),
    status,
    counts,
    totalThreats: attacks.length,
    activeQuarantines: active.length,
    spoken: parts.join(" "),
    recommendations,
  };
}

/** ¿La pregunta es sobre ataques a IRIS (no sobre el Mac)? */
export function isThreatQuestion(question: string): boolean {
  const text = String(question || "").toLowerCase();
  if (/\b(mac|macbook|dispositivo|equipo|firewall|filevault|gatekeeper|disco|xprotect)\b/.test(text)) return false;
  return /\b(ataques?|atacando|amenazas?|hacke(?:o|ar|ando|ado)|hack(?:ers?|ing)?|intrus[oa]s?|intrusi[oó]n|vulnerabilidad(?:es)?|guardi[aá]n|reporte de seguridad|cuarentena|attacks?|threats?|vulnerabilit(?:y|ies)|intrusions?)\b/.test(text);
}
