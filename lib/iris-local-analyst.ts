import { irisAgentShellCommand } from "./iris-device-view.ts";
import { isConceptExplainer, isSocFollowUp } from "./iris-query.ts";

type DeviceContext = {
  id: string;
  name: string;
  platform: string;
  status: string;
  risk: string;
  lastSeenAt: string | null;
  telemetry?: Record<string, unknown>;
};

type AlertContext = {
  deviceId: string;
  code: string;
  severity: string;
  status: string;
  evidence?: Record<string, unknown>;
  lastSeenAt?: string;
};

type AgentContext = {
  id: string;
  role: string;
  status: string;
  task?: string;
};

export type IrisIncidentContext = {
  id: string;
  title: string;
  subject: string;
  severity: string;
  status: string;
  source: string;
  evidence: string[];
  recommendation: string;
};

export type IrisAnalystInput = {
  language: "es" | "en";
  question: string;
  userName: string;
  section: string;
  origin?: string;
  devices: DeviceContext[];
  alerts: AlertContext[];
  agents: AgentContext[];
  wallet?: { address?: string; connected?: boolean };
  incident?: IrisIncidentContext | null;
};

function firstName(value: string) {
  return value.split(/[\s@]/)[0] || "operador";
}

function recent(lastSeenAt: string | null) {
  if (!lastSeenAt) return false;
  const parsed = Date.parse(lastSeenAt);
  return Number.isFinite(parsed) && Date.now() - parsed <= 5 * 60 * 1000;
}

function hostLabel(device: DeviceContext) {
  const hostname = typeof device.telemetry?.hostname === "string" ? device.telemetry.hostname : "";
  return hostname && hostname !== device.name ? `${device.name} (${hostname})` : device.name;
}

function controlLine(device: DeviceContext, es: boolean) {
  if (!recent(device.lastSeenAt) || !device.telemetry) return "";
  const parts: string[] = [];
  if (typeof device.telemetry.firewallEnabled === "boolean") {
    parts.push(device.telemetry.firewallEnabled ? (es ? "firewall activo" : "firewall on") : (es ? "firewall apagado" : "firewall off"));
  }
  if (typeof device.telemetry.fileVaultEnabled === "boolean") {
    parts.push(device.telemetry.fileVaultEnabled ? (es ? "FileVault encendido" : "FileVault on") : (es ? "FileVault apagado" : "FileVault off"));
  }
  return parts.join(es ? ", " : ", ");
}

export function explainIrisControl(question: string, language: "es" | "en", userName: string) {
  const es = language === "es";
  const name = firstName(userName);
  const text = question.toLocaleLowerCase();
  if (/\bfirewall\b/.test(text)) {
    return es
      ? `${name}, el firewall del Mac es la barrera que decide qué conexiones de red entran o salen. En IRIS, si el agente reporta FIREWALL DISABLED, el siguiente paso es aprobar esa alerta para que lo active. Si quieres el estado en vivo, pregúntame “está el firewall”.`
      : `${name}, the Mac firewall is the barrier that decides which network connections go in or out. In IRIS, if the agent reports FIREWALL DISABLED, the next step is to approve that alert so it can turn it on. For live status, ask “is the firewall on”.`;
  }
  if (/\bfilevault\b/.test(text)) {
    return es
      ? `${name}, FileVault cifra el disco del Mac para que, si alguien lo pierde o lo abre, no pueda leer tus archivos. IRIS solo confirma si el agente lo vio encendido en el último reporte. Pregúntame “está FileVault” si quieres el dato en vivo.`
      : `${name}, FileVault encrypts the Mac disk so a lost or opened machine cannot expose your files. IRIS only confirms it when the agent saw it on in the last report. Ask “is FileVault on” for the live reading.`;
  }
  if (/\bgatekeeper\b/.test(text)) {
    return es
      ? `${name}, Gatekeeper es el control de macOS que comprueba si una app está firmada antes de abrirla. IRIS no inventa malware: solo habla de lo que el agente verificó.`
      : `${name}, Gatekeeper is the macOS control that checks whether an app is signed before it opens. IRIS does not invent malware: it only talks about what the agent verified.`;
  }
  return "";
}

function nextActionAnswer(input: IrisAnalystInput, es: boolean, name: string, mac: DeviceContext | undefined, online: DeviceContext[], pending: DeviceContext[], offline: DeviceContext[], activeAlerts: AlertContext[]) {
  if (offline[0]) {
    const command = irisAgentShellCommand(input.origin || "", true);
    return es
      ? `${name}, lo primero es reconectar ${hostLabel(offline[0])}: el agente no reportó en los últimos 5 minutos. En Dispositivos pulsa Reconectar, o pega esto en Terminal: ${command}`
      : `${name}, first reconnect ${hostLabel(offline[0])}: the agent did not report in the last 5 minutes. In Devices tap Reconnect, or paste this in Terminal: ${command}`;
  }
  if (pending[0]) {
    const command = irisAgentShellCommand(input.origin || "", false);
    return es
      ? `${name}, espera el primer reporte de ${hostLabel(pending[0])}. Instala el agente con: ${command}`
      : `${name}, wait for the first report from ${hostLabel(pending[0])}. Install the agent with: ${command}`;
  }
  const firewall = activeAlerts.find(alert => /FIREWALL/i.test(alert.code));
  if (firewall) {
    return es
      ? `${name}, el siguiente paso es aprobar la alerta ${firewall.code.replaceAll("_", " ")} para que el agente encienda el firewall en el próximo reporte.`
      : `${name}, the next step is to approve the ${firewall.code.replaceAll("_", " ")} alert so the agent can turn the firewall on in the next report.`;
  }
  if (input.incident?.id) {
    return es
      ? `${name}, sigue con el incidente ${input.incident.id}: ${input.incident.recommendation || "revisa la evidencia y decide si apruebas el plan."}`
      : `${name}, stay with incident ${input.incident.id}: ${input.incident.recommendation || "review the evidence and decide whether to approve the plan."}`;
  }
  if (activeAlerts[0]) {
    const codes = activeAlerts.map(alert => alert.code.replaceAll("_", " ")).join(", ");
    return es
      ? `${name}, abre ${codes} en el tablero y aprueba solo lo que quieras que el agente ejecute.`
      : `${name}, open ${codes} on the board and approve only what you want the agent to run.`;
  }
  if (online[0] || mac) {
    return es
      ? `${name}, no hay un paso urgente. ${mac ? describeDevice(mac, es) : ""} Si quieres, te reviso un control o una alerta concreta.`
      : `${name}, there is no urgent next step. ${mac ? describeDevice(mac, es) : ""} Ask if you want a specific control or alert.`;
  }
  return es
    ? `${name}, registra tu Mac e instala el agente. Sin ese reporte no hay un siguiente paso real.`
    : `${name}, register your Mac and install the agent. Without that report there is no real next step.`;
}

function describeDevice(device: DeviceContext, es: boolean) {
  const label = hostLabel(device);
  const controls = controlLine(device, es);
  if (device.status === "ONLINE" && recent(device.lastSeenAt)) {
    return es
      ? `${label} está ONLINE, con reporte fresco${controls ? `. Tiene ${controls}` : ""}.`
      : `${label} is ONLINE, with a fresh report${controls ? `. It has ${controls}` : ""}.`;
  }
  if (device.status === "PENDING") {
    return es ? `${label} está PENDIENTE: todavía no llegó el primer reporte del agente.` : `${label} is PENDING: the first agent report has not arrived yet.`;
  }
  return es ? `${label} está OFFLINE: el agente no reportó en los últimos 5 minutos.` : `${label} is OFFLINE: the agent did not report in the last 5 minutes.`;
}

export function localIrisAnswer(input: IrisAnalystInput) {
  const es = input.language === "es";
  const name = firstName(input.userName);
  const question = input.question.toLocaleLowerCase();
  const online = input.devices.filter(device => device.status === "ONLINE" && recent(device.lastSeenAt));
  const pending = input.devices.filter(device => device.status === "PENDING");
  const offline = input.devices.filter(device => device.status === "OFFLINE");
  const activeAlerts = input.alerts.filter(alert => alert.status !== "RESOLVED");
  const runningAgents = input.agents.filter(agent => agent.status === "RUNNING");
  const doneAgents = input.agents.filter(agent => agent.status === "DONE");
  const wallet = input.wallet?.connected && input.wallet.address ? input.wallet.address : "";
  const mac = online[0] || offline[0] || pending[0] || input.devices[0];

  const statusBlock = es
    ? `Ahora mismo veo ${input.devices.length} dispositivo${input.devices.length === 1 ? "" : "s"}: ${online.length} en línea, ${pending.length} pendiente${pending.length === 1 ? "" : "s"} y ${offline.length} sin reporte fresco. Hay ${activeAlerts.length} alerta${activeAlerts.length === 1 ? "" : "s"} abierta${activeAlerts.length === 1 ? "" : "s"}.`
    : `I currently see ${input.devices.length} device${input.devices.length === 1 ? "" : "s"}: ${online.length} online, ${pending.length} pending, and ${offline.length} without a fresh report. There ${activeAlerts.length === 1 ? "is" : "are"} ${activeAlerts.length} open alert${activeAlerts.length === 1 ? "" : "s"}.`;

  const agentBlock = input.agents.length
    ? es
      ? `En vivo: ${runningAgents.map(agent => agent.role).join(", ") || "nadie ejecutándose"}. En cola o listos: ${doneAgents.map(agent => agent.role).join(", ") || "nadie"}.`
      : `Live: ${runningAgents.map(agent => agent.role).join(", ") || "none running"}. Queued or ready: ${doneAgents.map(agent => agent.role).join(", ") || "none"}.`
    : es
      ? "Todavía no hay sistemas en vivo reportados."
      : "No live systems have been reported yet.";

  const walletBlock = wallet
    ? es
      ? `La wallet está conectada en Base: ${wallet.slice(0, 8)}…${wallet.slice(-6)}. Puedes usar MetaMask, Robinhood Wallet, o pegar una dirección 0x.`
      : `The wallet is connected on Base: ${wallet.slice(0, 8)}…${wallet.slice(-6)}. You can use MetaMask, Robinhood Wallet, or paste a 0x address.`
    : es
      ? "No hay una wallet de Base conectada en esta sesión."
      : "No Base wallet is connected in this session.";

  const location = input.alerts.flatMap(alert => {
    const evidence = alert.evidence || {};
    const locations = Array.isArray(evidence.locations) ? evidence.locations : [];
    const threats = Array.isArray(evidence.threatLocations) ? evidence.threatLocations : [];
    return [...locations, ...threats].filter((path): path is string => typeof path === "string" && path.startsWith("/"));
  });

  if (/(hola|hello|hi\b|buenas)/.test(question)) {
    return es
      ? `Hola, ${name}. Te escucho. Dime qué quieres saber: tu Mac, una alerta, o cualquier otra cosa.`
      : `Hi, ${name}. I'm listening. Tell me what you want: your Mac, an alert, or anything else.`;
  }

  if (isConceptExplainer(input.question)) {
    const explained = explainIrisControl(input.question, input.language, input.userName);
    if (explained) return explained;
  }

  if (isSocFollowUp(input.question) || /\b(?:qu[eé] hago|siguiente paso|qu[eé] recomiendas)\b/.test(question)) {
    return nextActionAnswer(input, es, name, mac, online, pending, offline, activeAlerts);
  }

  if (/(este incidente|esta alerta|el incidente(?: seleccionado)?)/.test(question)) {
    if (!input.incident?.id) {
      return es
        ? `${name}, no hay un incidente seleccionado en el tablero. Elige uno y pregúntame otra vez.`
        : `${name}, there is no incident selected on the board. Pick one and ask me again.`;
    }
    const evidence = input.incident.evidence.filter(Boolean).slice(0, 4).join(es ? "; " : "; ");
    return es
      ? `${name}, el incidente abierto es ${input.incident.id}: ${input.incident.title || input.incident.subject}. Severidad ${input.incident.severity}, estado ${input.incident.status}. ${evidence ? `Evidencia: ${evidence}. ` : ""}${input.incident.recommendation || "Revisa el plan en el tablero antes de aprobar."}`
      : `${name}, the open incident is ${input.incident.id}: ${input.incident.title || input.incident.subject}. Severity ${input.incident.severity}, status ${input.incident.status}. ${evidence ? `Evidence: ${evidence}. ` : ""}${input.incident.recommendation || "Review the plan on the board before you approve."}`;
  }

  if (/(alerta|alert|hallazgo)/.test(question) && !/(firewall|filevault|gatekeeper)/.test(question)) {
    if (!activeAlerts.length) {
      return es
        ? `${name}, no hay alertas abiertas. ${mac ? describeDevice(mac, es) : statusBlock}`
        : `${name}, there are no open alerts. ${mac ? describeDevice(mac, es) : statusBlock}`;
    }
    const codes = activeAlerts.map(alert => alert.code.replaceAll("_", " ")).join(", ");
    return es
      ? `${name}, alertas abiertas: ${codes}. Si quieres, te digo el siguiente paso o miramos el incidente seleccionado.`
      : `${name}, open alerts: ${codes}. Ask if you want the next step or the selected incident.`;
  }

  if ((/(\bconect\b|\bconectar(me)?\b|\breconect)/.test(question) && !/(wallet|metamask|robinhood|base|token|compra|comprar|purchase|buy|agentes|orquest|bolsa|mercado)/.test(question)) || /conectar\s+(el\s+)?(mac|dispositivo|iris)/.test(question)) {
    const target = offline[0] || pending[0] || online[0];
    const label = target ? hostLabel(target) : "";
    const command = irisAgentShellCommand(input.origin || "", Boolean(target) && target.status !== "PENDING");
    if (!input.devices.length) {
      return es
        ? `${name}, todavía no hay un Mac inscrito. En Dispositivos pulsa Registrar mi Mac, copia el código de 16 caracteres y pega este comando en Terminal: ${command}`
        : `${name}, no Mac is enrolled yet. In Devices tap Register my Mac, copy the 16-character code, and paste this command in Terminal: ${command}`;
    }
    if (online.length && !offline.length && !pending.length) {
      return es
        ? `${name}, ${label || "tu Mac"} ya está ONLINE: el agente reportó hace menos de 5 minutos. El firewall es otra cosa: si ves FIREWALL DISABLED, aprueba esa alerta para que el agente lo active en el siguiente reporte.`
        : `${name}, ${label || "your Mac"} is already ONLINE: the agent reported less than 5 minutes ago. Firewall is separate: if you see FIREWALL DISABLED, approve that alert so the agent can enable it on the next report.`;
    }
    if (pending.length && !offline.length) {
      return es
        ? `${name}, ${label || "tu Mac"} está PENDIENTE: IRIS todavía no recibió el primer reporte. En Dispositivos copia el código e instala el agente con este comando: ${command}`
        : `${name}, ${label || "your Mac"} is PENDING: IRIS has not received the first report yet. In Devices copy the enrollment code and install the agent with this command: ${command}`;
    }
    return es
      ? `${name}, ${label || "tu Mac"} está inscrito pero OFFLINE: el agente no envió telemetría en los últimos 5 minutos. No puedo arrancar el LaunchAgent desde aquí. En Dispositivos pulsa Reconectar, o pega esto en Terminal (el Mac debe estar encendido y en red): ${command} Cuando el reporte llegue, pasa a ONLINE solo. El firewall apagado se arregla después, aprobando la alerta.`
      : `${name}, ${label || "your Mac"} is enrolled but OFFLINE: the agent did not send telemetry in the last 5 minutes. I cannot start the LaunchAgent from here. In Devices tap Reconnect, or paste this in Terminal (the Mac must be awake and on the network): ${command} When the report arrives, the status flips to ONLINE by itself. A disabled firewall is fixed after that by approving the alert.`;
  }

  if (/(agente|agent|orquest)/.test(question)) {
    const detail = input.agents.map(agent => `${agent.role}: ${agent.status}${agent.task ? ` · ${agent.task}` : ""}`).join("; ");
    return es
      ? `${name}, estos son los sistemas reales ahora. ${agentBlock} Detalle: ${detail || "sin filas todavía"}.`
      : `${name}, these are the real systems right now. ${agentBlock} Detail: ${detail || "no rows yet"}.`;
  }

  if (/(bolsa|mercado|nasdaq|ticker|cotiz|acci[oó]n|jarvis|\bjar\b)/.test(question)) {
    return es
      ? `${name}, en Bolsa en vivo ves la cinta, el gráfico y las lecturas que se actualizan cada 8 segundos. Pregúntame por NVDA, AAPL o Bitcoin y te explico el gráfico.`
      : `${name}, in Live market you see the tape, the chart, and readings that refresh every 8 seconds. Ask me about NVDA, AAPL, or Bitcoin and I will teach the chart.`;
  }

  if (/(wallet|metamask|robinhood|base|token|compra|comprar|purchase|buy)/.test(question)) {
    return es
      ? `${walletBlock} IRIS puede programar compras de ETH, USDC, BTC o SOL, pero nunca paga sola: cada compra espera tu aprobación y se completa en MetaMask o Robinhood.`
      : `${walletBlock} IRIS can schedule ETH, USDC, BTC, or SOL buys, but it never pays alone: every purchase waits for your approval and finishes in MetaMask or Robinhood.`;
  }

  if (/(amenaza|threat|malware|ubicaci[oó]n|d[oó]nde|where|firewall|filevault|gatekeeper)/.test(question)) {
    if (mac && /(firewall|filevault|gatekeeper)/.test(question) && recent(mac.lastSeenAt)) {
      const controls = controlLine(mac, es);
      return es
        ? `${name}, ${describeDevice(mac, es)} ${activeAlerts.length ? `Alertas abiertas: ${activeAlerts.map(alert => alert.code.replaceAll("_", " ")).join(", ")}.` : "No hay alertas abiertas."}`
        : `${name}, ${describeDevice(mac, es)} ${activeAlerts.length ? `Open alerts: ${activeAlerts.map(alert => alert.code.replaceAll("_", " ")).join(", ")}.` : "There are no open alerts."}${controls ? "" : ""}`;
    }
    if (!activeAlerts.length) {
      return es
        ? `${name}, no hay hallazgos verificados abiertos. ${mac ? describeDevice(mac, es) : statusBlock} Solo trato como amenaza lo que reporta tu agente.`
        : `${name}, there are no open verified findings. ${mac ? describeDevice(mac, es) : statusBlock} I only treat as a threat what your agent reports.`;
    }
    const codes = activeAlerts.map(alert => alert.code.replaceAll("_", " ")).join(", ");
    const pathText = location.length
      ? es ? `Rutas verificadas: ${location.slice(0, 4).join(", ")}.` : `Verified paths: ${location.slice(0, 4).join(", ")}.`
      : es ? "Conozco el dispositivo o la app, pero todavía no hay una ruta de archivo verificada." : "I know the affected device or app, but do not yet have a verified filesystem path.";
    return es ? `${name}, hallazgos abiertos: ${codes}. ${pathText}` : `${name}, open findings: ${codes}. ${pathText}`;
  }

  if (/(dispositivo|device|mac|telemetr|c[oó]mo est[aá]|estado|sistema|online|offline|en l[ií]nea)/.test(question)) {
    if (!input.devices.length) {
      return es
        ? `${name}, no hay dispositivos enrolados. En Dispositivos registra tu Mac e instala el agente para que reciba telemetría real.`
        : `${name}, no devices are enrolled. In Devices, register your Mac and install the agent so IRIS can receive real telemetry.`;
    }
    const lines = input.devices.slice(0, 5).map(device => describeDevice(device, es));
    return es
      ? `${name}, ${lines.join(" ")} ${statusBlock}`
      : `${name}, ${lines.join(" ")} ${statusBlock}`;
  }

  return es
    ? `${name}, te lo digo con lo que sí está verificado. ${mac ? describeDevice(mac, es) : statusBlock} ${agentBlock} ${walletBlock} Si quieres, bajamos a un dispositivo, una alerta o la wallet.`
    : `${name}, here is what is actually verified. ${mac ? describeDevice(mac, es) : statusBlock} ${agentBlock} ${walletBlock} I can go deeper on a device, an alert, or the wallet next.`;
}
