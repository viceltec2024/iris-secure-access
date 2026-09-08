import { formatUtcClock } from "./iris-time.ts";

export type LiveAlert = {
  id: string;
  deviceId: string;
  code: string;
  severity: "CRITICAL" | "HIGH" | "MEDIUM" | "LOW";
  status: "NEW" | "ACKNOWLEDGED" | "RESOLVED";
  evidence: string;
  lastSeenAt: string;
};

export type LiveDevice = {
  id: string;
  name: string;
  status?: string;
  provenance?: string;
  lastSeenAt?: string | null;
};

export type LivePurchase = {
  id: string;
  asset: string;
  amountUsd: number;
  source: string;
  checkoutUrl: string;
  status: string;
  createdAt?: string;
};

export type SavedIncidentStatus = {
  incidentId: string;
  status: LiveIncident["status"];
};

export type LiveIncident = {
  id: string;
  title: string;
  subject: string;
  severity: "Critical" | "High" | "Medium" | "Low";
  status: "Open" | "Investigating" | "Contained";
  time: string;
  source: string;
  summary: string;
  cause: string;
  impact: string;
  confidence: number;
  evidence: string[];
  actions: string[];
  recommendation: string;
  kind: "alert" | "device" | "purchase" | "empty";
  checkoutUrl?: string;
};

export const AGENT_COMMAND_CODES = ["NOTIFY", "REVERIFY", "ENABLE_FIREWALL"] as const;
export type AgentCommandCode = (typeof AGENT_COMMAND_CODES)[number];

export function commandsForAlert(code: string, language: "es" | "en") {
  const es = language === "es";
  const label = code.replaceAll("_", " ");
  const notify = {
    code: "NOTIFY" as const,
    title: "IRIS",
    message: es ? `IRIS detectó ${label}. Abre el centro de control.` : `IRIS detected ${label}. Open the command center.`,
  };
  const reverify = {
    code: "REVERIFY" as const,
    title: "IRIS",
    message: es ? "IRIS pide un nuevo reporte de seguridad." : "IRIS requested a fresh security report.",
  };
  if (code === "FIREWALL_DISABLED") {
    return [
      notify,
      {
        code: "ENABLE_FIREWALL" as const,
        title: "IRIS",
        message: es ? "IRIS va a activar el firewall. macOS puede pedir tu contraseña." : "IRIS will enable the firewall. macOS may ask for your password.",
      },
      reverify,
    ];
  }
  return [notify, reverify];
}

export type LiveWorker = {
  id: string;
  role: string;
  status: "QUEUED" | "RUNNING" | "DONE" | "FAILED";
  task: string;
  updatedAt: string | null;
};

const SEVERITY = { CRITICAL: "Critical", HIGH: "High", MEDIUM: "Medium", LOW: "Low" } as const;
const STATUS = { NEW: "Open", ACKNOWLEDGED: "Investigating", RESOLVED: "Contained" } as const;

export function parseAlertEvidence(value: string) {
  try {
    return JSON.parse(value) as { hostname?: string; applications?: string[]; startupItems?: string[]; xProtectVersion?: string; collectedAt?: string };
  } catch {
    return {};
  }
}

export function relativeTime(value: string | null | undefined, language: "es" | "en", now = Date.now()) {
  if (!value) return "—";
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) return value;
  const delta = Math.max(0, now - parsed);
  const es = language === "es";
  if (delta < 45_000) return es ? "ahora mismo" : "just now";
  if (delta < 90_000) return es ? "hace 1 min" : "1 min ago";
  if (delta < 3_600_000) {
    const minutes = Math.round(delta / 60_000);
    return es ? `hace ${minutes} min` : `${minutes} min ago`;
  }
  if (delta < 36 * 3_600_000) {
    const hours = Math.round(delta / 3_600_000);
    return es ? `hace ${hours} h` : `${hours} hr ago`;
  }
  return formatUtcClock(parsed);
}

export function emptyLiveIncident(language: "es" | "en"): LiveIncident {
  const es = language === "es";
  return {
    id: "",
    title: es ? "Sin incidentes reales" : "No live incidents",
    subject: es ? "Esperando al agente" : "Waiting for the agent",
    severity: "Low",
    status: "Contained",
    time: "—",
    source: "IRIS",
    summary: es ? "No hay alertas del agente ni compras pendientes. Registra tu Mac para que IRIS vea controles reales." : "There are no agent alerts or pending purchases. Register your Mac so IRIS can see real controls.",
    cause: es ? "Todavía no hay telemetría verificada." : "There is no verified telemetry yet.",
    impact: es ? "Ningún equipo está en riesgo reportado." : "No device has a reported risk.",
    confidence: 100,
    evidence: [es ? "Cero alertas abiertas del agente" : "Zero open agent alerts"],
    actions: [es ? "Registra tu Mac" : "Register your Mac", es ? "Instala el agente" : "Install the agent"],
    recommendation: es ? "La protección real empieza cuando el agente reporta." : "Real protection starts when the agent reports.",
    kind: "empty",
  };
}

export function liveIncidentsFromAlerts(alerts: LiveAlert[], devices: LiveDevice[], language: "es" | "en"): LiveIncident[] {
  return alerts.map(alert => {
    const es = language === "es";
    const evidence = parseAlertEvidence(alert.evidence);
    const device = devices.find(item => item.id === alert.deviceId);
    const title = alert.code.replaceAll("_", " ");
    const host = device?.name || evidence.hostname || (es ? "Dispositivo" : "Device");
    const extras = [
      ...(evidence.applications || []).map(item => `${es ? "Aplicación" : "App"}: ${item}`),
      ...(evidence.startupItems || []).map(item => `${es ? "Inicio" : "Startup"}: ${item}`),
      evidence.xProtectVersion ? `XProtect ${evidence.xProtectVersion}` : "",
    ].filter(Boolean);
    return {
      id: alert.id,
      title,
      subject: host,
      severity: SEVERITY[alert.severity],
      status: STATUS[alert.status],
      time: alert.lastSeenAt,
      source: es ? "Agente IRIS" : "IRIS agent",
      summary: device?.status === "OFFLINE"
        ? (es
          ? `Último reporte (Mac OFFLINE): ${title.toLowerCase()} en ${host}. No es el estado actual hasta que el agente vuelva a reportar.`
          : `Last report (Mac OFFLINE): ${title.toLowerCase()} on ${host}. This is not current until the agent reports again.`)
        : (es
          ? `El agente reportó ${title.toLowerCase()} en ${host}. Esto viene de telemetría verificada, no de un escenario de entrenamiento.`
          : `The agent reported ${title.toLowerCase()} on ${host}. This comes from verified telemetry, not a training scenario.`),
      cause: es ? "Un control o cambio real en el equipo protegido." : "A real control or change on the protected device.",
      impact: device?.status === "OFFLINE"
        ? (es ? "Sin reporte fresco IRIS no afirma este hallazgo como estado actual." : "Without a fresh report IRIS does not treat this finding as current.")
        : (es ? "El riesgo permanece mientras el agente siga viendo el mismo hallazgo." : "The risk remains while the agent still sees the same finding."),
      confidence: 92,
      evidence: extras.length ? extras : [es ? "Reporte del agente autorizado" : "Authorized agent report"],
      actions: es
        ? ["Avisar al Mac con una notificación real", "Corregir el control (el agente puede activar el firewall si lo aprobaste)", "Esperar el siguiente reporte del agente"]
        : ["Notify the Mac with a real notification", "Fix the control (the agent can enable the firewall if you approved it)", "Wait for the next agent report"],
      recommendation: es
        ? "Al aprobar, IRIS avisa al Mac y espera que el agente verifique. IRIS no cambia macOS en silencio."
        : "When you approve, IRIS notifies the Mac and waits for the agent to verify. IRIS does not change macOS silently.",
      kind: "alert",
    };
  });
}

export function liveIncidentsFromDevices(devices: LiveDevice[], language: "es" | "en"): LiveIncident[] {
  const es = language === "es";
  return devices.filter(device => device.status === "OFFLINE").map(device => ({
    id: `device:${device.id}`,
    title: es ? "Agente sin reporte reciente" : "Agent stopped reporting",
    subject: device.name,
    severity: "High" as const,
    status: "Open" as const,
    time: device.lastSeenAt || "",
    source: es ? "Agente IRIS" : "IRIS agent",
    summary: es
      ? `${device.name} dejó de reportar hace más de 5 minutos. IRIS no puede aislar un Mac apagado; el siguiente reporte confirmará si sigue protegido.`
      : `${device.name} stopped reporting more than 5 minutes ago. IRIS cannot isolate a Mac that is offline; the next report will confirm whether it is still protected.`,
    cause: es ? "El agente no envió telemetría dentro de la ventana de 5 minutos." : "The agent did not send telemetry inside the 5-minute window.",
    impact: es ? "Sin reporte fresco IRIS no puede afirmar el estado del firewall, FileVault o las aplicaciones." : "Without a fresh report IRIS cannot assert firewall, FileVault, or application state.",
    confidence: 88,
    evidence: [device.lastSeenAt ? `${es ? "Último reporte" : "Last report"}: ${device.lastSeenAt}` : (es ? "Nunca reportó" : "Never reported")],
    actions: es
      ? ["Confirmar que el Mac está encendido y en red", "Reinstalar el agente si sigue sin reportar", "Marcar como reconocido cuando lo hayas revisado"]
      : ["Confirm the Mac is on and online", "Reinstall the agent if it still does not report", "Mark as acknowledged after you have reviewed it"],
    recommendation: es
      ? "Revisa el Mac. Aprobar aquí solo registra que ya lo viste; no enciende el equipo."
      : "Check the Mac. Approving here only records that you reviewed it; it does not wake the machine.",
    kind: "device",
  }));
}

export function liveIncidentsFromPurchases(purchases: LivePurchase[], language: "es" | "en"): LiveIncident[] {
  const es = language === "es";
  return purchases.filter(item => item.status === "awaiting_approval").map(item => ({
    id: `purchase:${item.id}`,
    title: es ? `Compra ${item.asset} pendiente` : `${item.asset} purchase pending`,
    subject: `${item.amountUsd} USD · ${item.source}`,
    severity: "Medium" as const,
    status: "Open" as const,
    time: item.createdAt || "",
    source: item.source === "robinhood" ? "Robinhood" : "MetaMask",
    summary: es
      ? `IRIS propuso comprar ${item.asset} por ${item.amountUsd} USD. No se ha gastado nada. Al aprobar se abre solo la URL oficial.`
      : `IRIS proposed buying ${item.asset} for ${item.amountUsd} USD. Nothing has been spent. Approving opens only the official URL.`,
    cause: es ? "Un plan de compra que tú creaste llegó a su hora." : "A purchase plan you created became due.",
    impact: es ? "Sin tu aprobación no hay cargo ni transacción." : "Without your approval there is no charge and no transaction.",
    confidence: 100,
    evidence: [`${item.amountUsd} USD`, item.source, item.checkoutUrl],
    actions: es
      ? ["Revisar el monto y el activo", "Aprobar para abrir el checkout oficial", "Completar la compra en Robinhood o MetaMask"]
      : ["Review the amount and asset", "Approve to open the official checkout", "Complete the purchase in Robinhood or MetaMask"],
    recommendation: es
      ? "IRIS nunca paga sola. Aprobar aquí autoriza el checkout oficial; tú confirmas en Robinhood o MetaMask."
      : "IRIS never pays alone. Approving here authorizes the official checkout; you confirm in Robinhood or MetaMask.",
    kind: "purchase",
    checkoutUrl: item.checkoutUrl,
  }));
}

export function applySavedStatuses(incidents: LiveIncident[], saved: SavedIncidentStatus[]) {
  if (!saved.length) return incidents;
  return incidents.map(item => {
    const match = saved.find(row => row.incidentId === item.id);
    return match ? { ...item, status: match.status } : item;
  });
}

export function buildLiveIncidents(input: {
  alerts: LiveAlert[];
  devices: LiveDevice[];
  purchases?: LivePurchase[];
  saved?: SavedIncidentStatus[];
  language: "es" | "en";
}) {
  const incidents = [
    ...liveIncidentsFromAlerts(input.alerts, input.devices, input.language),
    ...liveIncidentsFromDevices(input.devices, input.language),
    ...liveIncidentsFromPurchases(input.purchases || [], input.language),
  ];
  return applySavedStatuses(incidents, input.saved || []);
}

export function liveSocMetrics(devices: Array<{
  status?: string;
  provenance?: string;
  healthScore?: number | null;
  telemetry?: { firewallEnabled?: boolean } | null;
}>) {
  const online = devices.filter(device => device.status === "ONLINE" && device.provenance !== "UNVERIFIED");
  const healthScores = online.map(device => device.healthScore).filter((score): score is number => typeof score === "number");
  const firewallKnown = online.filter(device => typeof device.telemetry?.firewallEnabled === "boolean");
  return {
    onlineCount: online.length,
    deviceCount: devices.length,
    averageHealth: healthScores.length ? Math.round(healthScores.reduce((sum, score) => sum + score, 0) / healthScores.length) : null,
    firewallProtected: firewallKnown.filter(device => device.telemetry?.firewallEnabled === true).length,
    firewallKnown: firewallKnown.length,
  };
}

export function liveConnectionLine(input: {
  online: number;
  devices: number;
  openAlerts: number;
  wallet?: boolean;
  language: "es" | "en";
}) {
  const es = input.language === "es";
  const wallet = input.wallet ? (es ? "wallet en vivo" : "live wallet") : "";
  if (!input.devices && !input.wallet) return es ? "Sin agente conectado" : "No agent connected";
  if (input.online) {
    const line = es
      ? `${input.online} agente${input.online === 1 ? "" : "s"} en vivo · ${input.openAlerts} alerta${input.openAlerts === 1 ? "" : "s"}`
      : `${input.online} live agent${input.online === 1 ? "" : "s"} · ${input.openAlerts} alert${input.openAlerts === 1 ? "" : "s"}`;
    return wallet ? `${line} · ${wallet}` : line;
  }
  if (input.devices) return es ? "Agente inscrito, sin reporte reciente" : "Agent enrolled, no recent report";
  return wallet;
}

export function liveIntelligence(alerts: LiveAlert[], language: "es" | "en", devices: LiveDevice[] = []) {
  const onlineIds = new Set(devices.filter(device => device.status === "ONLINE").map(device => device.id));
  const current = devices.length ? alerts.filter(alert => alert.status === "RESOLVED" || onlineIds.has(alert.deviceId)) : alerts;
  const open = current.filter(item => item.status !== "RESOLVED");
  const resolved = alerts.filter(item => item.status === "RESOLVED").length;
  const critical = open.filter(item => item.severity === "CRITICAL" || item.severity === "HIGH").length;
  const counts = new Map<string, number>();
  for (const alert of open) counts.set(alert.code, (counts.get(alert.code) || 0) + 1);
  const techniques = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4).map(([code, value]) => ({
    label: code.replaceAll("_", " "),
    value,
  }));
  const feed = open.slice(0, 6).map(alert => ({
    id: alert.id,
    label: `${alert.code.replaceAll("_", " ")} · ${alert.severity}`,
    at: alert.lastSeenAt,
  }));
  return {
    open: open.length,
    critical,
    resolved,
    techniques,
    feed,
    empty: language === "es" ? "No hay indicadores reales todavía." : "There are no live indicators yet.",
  };
}

export function liveWorkers(input: {
  devices: LiveDevice[];
  walletConnected?: boolean;
  walletAddress?: string;
  marketLive?: boolean;
  auditCount?: number;
  pendingPurchases?: number;
  language: "es" | "en";
  now?: string;
}): LiveWorker[] {
  const es = input.language === "es";
  const now = input.now || null;
  const online = input.devices.filter(device => device.status === "ONLINE");
  const offline = input.devices.filter(device => device.status === "OFFLINE");
  const macStatus = online.length ? "RUNNING" : offline.length ? "FAILED" : input.devices.length ? "QUEUED" : "QUEUED";
  const macTask = online.length
    ? (es ? `${online.length} Mac reportando cada 2 minutos` : `${online.length} Mac reporting every 2 minutes`)
    : offline.length
      ? (es ? "Sin reporte fresco" : "No fresh report")
      : (es ? "Registra e instala el agente" : "Register and install the agent");
  const walletTask = input.walletConnected && input.walletAddress
    ? `${input.walletAddress.slice(0, 8)}…${input.walletAddress.slice(-6)}`
    : (es ? "Sin wallet conectada" : "No wallet connected");
  return [
    { id: "mac-agent", role: es ? "Agente Mac" : "Mac agent", status: macStatus, task: macTask, updatedAt: now },
    { id: "wallet", role: es ? "Wallet Base" : "Base wallet", status: input.walletConnected ? "RUNNING" : "QUEUED", task: walletTask, updatedAt: now },
    { id: "market", role: es ? "Bolsa en vivo" : "Live market", status: input.marketLive ? "RUNNING" : "QUEUED", task: es ? "Cinta Yahoo cada 8 s" : "Yahoo tape every 8s", updatedAt: now },
    { id: "audit", role: es ? "Auditoría" : "Audit trail", status: (input.auditCount || 0) > 0 ? "RUNNING" : "QUEUED", task: `${input.auditCount || 0} ${es ? "eventos reales" : "live events"}`, updatedAt: now },
    { id: "purchases", role: es ? "Compras" : "Purchases", status: (input.pendingPurchases || 0) > 0 ? "RUNNING" : "DONE", task: es ? `${input.pendingPurchases || 0} esperando tu OK` : `${input.pendingPurchases || 0} waiting for your OK`, updatedAt: now },
  ];
}
