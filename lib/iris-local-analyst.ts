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
      ? `Los cinco agentes de orquestación están conectados. En ejecución: ${runningAgents.map(agent => agent.role).join(", ") || "ninguno"}. Completados: ${doneAgents.map(agent => agent.role).join(", ") || "ninguno"}.`
      : `The five orchestration agents are connected. Running: ${runningAgents.map(agent => agent.role).join(", ") || "none"}. Completed: ${doneAgents.map(agent => agent.role).join(", ") || "none"}.`
    : es
      ? "Todavía no hay un runtime de orquestación reportado."
      : "No orchestration runtime has been reported yet.";

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

  if (/(agente|agent|orquest)/.test(question)) {
    const detail = input.agents.map(agent => `${agent.role}: ${agent.status}${agent.task ? ` · ${agent.task}` : ""}`).join(es ? "; " : "; ");
    return es
      ? `${name}, ya conecté el equipo de agentes y los puse a trabajar. ${agentBlock} Detalle: ${detail || "sin filas todavía"}.`
      : `${name}, the agent team is connected and working. ${agentBlock} Detail: ${detail || "no rows yet"}.`;
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
        ? `No hay hallazgos verificados abiertos. ${statusBlock} Los incidentes de demostración no se tratan como amenazas reales en tu Mac.`
        : `There are no open verified findings. ${statusBlock} Demonstration incidents are not treated as real threats on your Mac.`;
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
