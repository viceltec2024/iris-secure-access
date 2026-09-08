import { irisAgentShellCommand } from "./iris-device-view.ts";

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
};

function firstName(value: string) {
  return value.split(/[\s@]/)[0] || "operador";
}

function recent(lastSeenAt: string | null) {
  if (!lastSeenAt) return false;
  const parsed = Date.parse(lastSeenAt);
  return Number.isFinite(parsed) && Date.now() - parsed <= 5 * 60 * 1000;
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

  const statusBlock = es
    ? `Ahora mismo IRIS ve ${input.devices.length} dispositivo${input.devices.length === 1 ? "" : "s"}: ${online.length} en línea con telemetría reciente, ${pending.length} pendiente${pending.length === 1 ? "" : "s"} de enrolar y ${offline.length} sin reporte fresco. Hay ${activeAlerts.length} alerta${activeAlerts.length === 1 ? "" : "s"} verificada${activeAlerts.length === 1 ? "" : "s"} abierta${activeAlerts.length === 1 ? "" : "s"}.`
    : `IRIS currently sees ${input.devices.length} device${input.devices.length === 1 ? "" : "s"}: ${online.length} online with recent telemetry, ${pending.length} pending enrollment, and ${offline.length} without a fresh report. There ${activeAlerts.length === 1 ? "is" : "are"} ${activeAlerts.length} open verified alert${activeAlerts.length === 1 ? "" : "s"}.`;

  const agentBlock = input.agents.length
    ? es
      ? `Sistemas en vivo: ${runningAgents.map(agent => agent.role).join(", ") || "ninguno en ejecución"}. En cola o listos: ${doneAgents.map(agent => agent.role).join(", ") || "ninguno"}.`
      : `Live systems: ${runningAgents.map(agent => agent.role).join(", ") || "none running"}. Queued or ready: ${doneAgents.map(agent => agent.role).join(", ") || "none"}.`
    : es
      ? "Todavía no hay sistemas en vivo reportados."
      : "No live systems have been reported yet.";

  const walletBlock = wallet
    ? es
      ? `La wallet está conectada y IRIS la monitorea en Base: ${wallet.slice(0, 8)}…${wallet.slice(-6)}. Puedes conectar MetaMask en este navegador, Robinhood Wallet, o pegar cualquier dirección 0x.`
      : `The wallet is connected and IRIS is monitoring it on Base: ${wallet.slice(0, 8)}…${wallet.slice(-6)}. You can connect MetaMask in this browser, Robinhood Wallet, or paste any 0x address.`
    : es
      ? "No hay una wallet de Base conectada en esta sesión."
      : "No Base wallet is connected in this session.";

  const location = input.alerts.flatMap(alert => {
    const evidence = alert.evidence || {};
    const locations = Array.isArray(evidence.locations) ? evidence.locations : [];
    return locations.filter((path): path is string => typeof path === "string" && path.startsWith("/"));
  });

  if (/(hola|hello|hi\b|buenas)/.test(question)) {
    return es
      ? `Hola, ${name}. Estoy conectada y lista. ${statusBlock} ${agentBlock} ¿Quieres el estado completo o revisamos un dispositivo?`
      : `Hi, ${name}. I'm connected and ready. ${statusBlock} ${agentBlock} Do you want the full status or should we review a device?`;
  }

  if ((/(\bconect\b|\bconectar(me)?\b|\breconect)/.test(question) && !/(wallet|metamask|robinhood|base|token|compra|comprar|purchase|buy|agentes|orquest|bolsa|mercado)/.test(question)) || /conectar\s+(el\s+)?(mac|dispositivo|iris)/.test(question)) {
    const target = offline[0] || pending[0] || online[0];
    const hostname = typeof target?.telemetry?.hostname === "string" ? target.telemetry.hostname : "";
    const label = target ? `${target.name}${hostname && hostname !== target.name ? ` (${hostname})` : ""}` : "";
    const command = irisAgentShellCommand(input.origin || "", Boolean(target) && target.status !== "PENDING");
    if (!input.devices.length) {
      return es
        ? `${name}, todavía no hay un Mac inscrito en esta sesión. En Dispositivos pulsa Registrar mi Mac, copia el código de 16 caracteres y pega este comando en Terminal en tu Mac: ${command}`
        : `${name}, no Mac is enrolled in this session yet. In Devices tap Register my Mac, copy the 16-character code, and paste this command in Terminal on your Mac: ${command}`;
    }
    if (online.length && !offline.length && !pending.length) {
      return es
        ? `${name}, ${label || "tu Mac"} ya está ONLINE: el agente reportó hace menos de 5 minutos. El firewall es otra cosa: si ves FIREWALL DISABLED, aprueba esa alerta para que el agente lo active en el siguiente reporte.`
        : `${name}, ${label || "your Mac"} is already ONLINE: the agent reported less than 5 minutes ago. Firewall is separate: if you see FIREWALL DISABLED, approve that alert so the agent can enable it on the next report.`;
    }
    if (pending.length && !offline.length) {
      return es
        ? `${name}, ${label || "tu Mac"} está PENDIENTE: IRIS todavía no recibió el primer reporte. En Dispositivos copia el código de inscripción e instala el agente con este comando en Terminal: ${command}`
        : `${name}, ${label || "your Mac"} is PENDING: IRIS has not received the first report yet. In Devices copy the enrollment code and install the agent with this Terminal command: ${command}`;
    }
    return es
      ? `${name}, ${label || "tu Mac"} está inscrito pero OFFLINE: el agente no envió telemetría en los últimos 5 minutos, así que IRIS no puede tratarlo como un enlace en vivo. No puedo arrancar el LaunchAgent desde aquí. En Dispositivos pulsa Reconectar, o pega esto en Terminal en el Mac (debe estar encendido y en red): ${command} Cuando el reporte llegue, el estado pasa a ONLINE solo. El firewall apagado se arregla después, aprobando la alerta.`
      : `${name}, ${label || "your Mac"} is enrolled but OFFLINE: the agent did not send telemetry in the last 5 minutes, so IRIS cannot treat it as a live link. I cannot start the LaunchAgent from here. In Devices tap Reconnect, or paste this in Terminal on the Mac (it must be awake and on the network): ${command} When the report arrives, the status flips to ONLINE by itself. A disabled firewall is fixed after that by approving the alert.`;
  }

  if (/(agente|agent|orquest)/.test(question)) {
    const detail = input.agents.map(agent => `${agent.role}: ${agent.status}${agent.task ? ` · ${agent.task}` : ""}`).join(es ? "; " : "; ");
    return es
      ? `${name}, estos son los sistemas reales conectados ahora. ${agentBlock} Detalle: ${detail || "sin filas todavía"}.`
      : `${name}, these are the real systems connected now. ${agentBlock} Detail: ${detail || "no rows yet"}.`;
  }

  if (/(bolsa|mercado|nasdaq|ticker|cotiz|acci[oó]n|jarvis|\bjar\b)/.test(question)) {
    return es
      ? `${name}, IRIS se conecta a la bolsa en vivo. En Bolsa en vivo ves la cinta, el gráfico y las lecturas que se actualizan solas cada 8 segundos. Pregúntame por NVDA, AAPL o Bitcoin y te explico el gráfico.`
      : `${name}, IRIS connects to the live market. In Live market you see the tape, the chart, and readings that refresh every 8 seconds. Ask me about NVDA, AAPL, or Bitcoin and I will teach the chart.`;
  }

  if (/(wallet|metamask|robinhood|base|token|compra|comprar|purchase|buy)/.test(question)) {
    return es
      ? `${walletBlock} En IRIS Chain puedes conectar MetaMask de forma directa o Robinhood Wallet. IRIS puede programar compras automáticas de ETH, USDC, BTC o SOL, pero nunca paga sola: cada compra espera tu aprobación y se completa en MetaMask o Robinhood.`
      : `${walletBlock} In IRIS Chain you can connect MetaMask directly or Robinhood Wallet. IRIS can schedule automatic ETH, USDC, BTC, or SOL buys, but it never pays alone: every purchase waits for your approval and finishes in MetaMask or Robinhood.`;
  }

  if (/(amenaza|threat|malware|ubicaci[oó]n|d[oó]nde|where)/.test(question)) {
    if (!activeAlerts.length) {
      return es
        ? `No hay hallazgos verificados abiertos. ${statusBlock} IRIS solo trata como amenaza lo que reporta tu agente.`
        : `There are no open verified findings. ${statusBlock} IRIS only treats as a threat what your agent reports.`;
    }
    const codes = activeAlerts.map(alert => alert.code.replaceAll("_", " ")).join(", ");
    const pathText = location.length
      ? es ? `Rutas verificadas: ${location.slice(0, 4).join(", ")}.` : `Verified paths: ${location.slice(0, 4).join(", ")}.`
      : es ? "IRIS conoce el dispositivo o la aplicación afectada, pero todavía no hay una ruta de archivo verificada." : "IRIS knows the affected device or application, but does not yet have a verified filesystem path.";
    return `${es ? "Hallazgos abiertos" : "Open findings"}: ${codes}. ${pathText}`;
  }

  if (/(dispositivo|device|mac|telemetr)/.test(question)) {
    if (!input.devices.length) {
      return es
        ? "No hay dispositivos enrolados. En Dispositivos registra tu Mac e instala el agente cifrado para que IRIS reciba telemetría real."
        : "No devices are enrolled. In Devices, register your Mac and install the encrypted agent so IRIS can receive real telemetry.";
    }
    const lines = input.devices.slice(0, 5).map(device => `${device.name} (${device.platform}) · ${device.status} · ${device.risk}`);
    return es
      ? `Dispositivos: ${lines.join("; ")}. ${statusBlock} La telemetría ONLINE reciente se puede describir como reporte del agente; PENDING u OFFLINE no es un escaneo en vivo.`
      : `Devices: ${lines.join("; ")}. ${statusBlock} Recent ONLINE telemetry can be described as an agent report; PENDING or OFFLINE is not a live scan.`;
  }

  return es
    ? `${name}, te resumo lo que sí está verificado. ${statusBlock} ${agentBlock} ${walletBlock} Estamos en la sección ${input.section}. Si quieres, reviso un dispositivo, una alerta o el estado de la wallet con más detalle.`
    : `${name}, here is what is actually verified. ${statusBlock} ${agentBlock} ${walletBlock} We are in the ${input.section} section. I can go deeper on a device, an alert, or the wallet next.`;
}
