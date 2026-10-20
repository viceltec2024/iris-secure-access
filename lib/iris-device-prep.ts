/** Device agent preparation checklists — no fake ONLINE devices. */

export type DevicePrepStep = {
  id: string;
  title: string;
  detail: string;
  doneWhen: string;
};

export function deviceAgentPrepSteps(
  platform: "macOS" | "Windows" | "any" = "any",
  language: "es" | "en" = "es",
): DevicePrepStep[] {
  const windows = platform === "Windows";
  const mac = platform === "macOS";
  if (language === "en") {
    return [
      {
        id: "register",
        title: windows ? "Register the Windows PC in Devices" : mac ? "Register the Mac in Devices" : "Register a Mac or Windows PC",
        detail: "Create an enrollment record. Status stays PENDING until the agent checks in.",
        doneWhen: "A device row exists with an enrollment code.",
      },
      {
        id: "public_origin",
        title: "Reachable IRIS origin",
        detail: "The device must call a public or tunneled IRIS URL (IRIS_PUBLIC_ORIGIN / Sites). Local-only Vite is not enough for a remote PC.",
        doneWhen: "HTTP to /api/agent/check-in from the device succeeds.",
      },
      {
        id: "install",
        title: windows
          ? "Install iris-agent-windows.ps1"
          : mac
            ? "Install iris-agent-macos.sh"
            : "Install the Mac or Windows agent",
        detail: windows
          ? "Paste the PowerShell install command and enter the enrollment code. The agent stores a token and reports every 120s via Scheduled Task."
          : mac
            ? "Paste the install command in Terminal and enter the enrollment code. The agent stores a token and reports every 120s."
            : "Use the Mac Terminal command or the Windows PowerShell command shown on the device card.",
        doneWhen: "Device status becomes ONLINE with lastSeenAt under 5 minutes.",
      },
      {
        id: "verify",
        title: "Verify real telemetry",
        detail: windows
          ? "Confirm Firewall / Defender / BitLocker / Updates on the device card. Never invent ONLINE."
          : "Confirm Firewall/Gatekeeper/FileVault/SIP and encryption AES-256-CBC+HMAC. Never invent ONLINE.",
        doneWhen: "Controls show REAL provenance from a fresh report.",
      },
    ];
  }
  return [
    {
      id: "register",
      title: windows ? "Registrar el PC Windows en Dispositivos" : mac ? "Registrar el Mac en Dispositivos" : "Registrar un Mac o un PC Windows",
      detail: "Crea el registro de inscripción. El estado sigue PENDING hasta el primer check-in del agente.",
      doneWhen: "Existe una fila de dispositivo con código de inscripción.",
    },
    {
      id: "public_origin",
      title: "Origen IRIS alcanzable",
      detail: "El equipo debe llamar a una URL pública o con túnel (IRIS_PUBLIC_ORIGIN / Sites). Vite solo local no alcanza a un PC remoto.",
      doneWhen: "HTTP a /api/agent/check-in desde el dispositivo responde.",
    },
    {
      id: "install",
      title: windows
        ? "Instalar iris-agent-windows.ps1"
        : mac
          ? "Instalar iris-agent-macos.sh"
          : "Instalar el agente Mac o Windows",
      detail: windows
        ? "Pega el comando PowerShell e introduce el código. El agente guarda un token y reporta cada 120s con Tarea programada."
        : mac
          ? "Pega el comando de instalación en Terminal e introduce el código. El agente guarda un token y reporta cada 120s."
          : "Usa el comando de Terminal (Mac) o PowerShell (Windows) de la tarjeta del dispositivo.",
      doneWhen: "El dispositivo pasa a ONLINE con lastSeenAt menor a 5 minutos.",
    },
    {
      id: "verify",
      title: "Verificar telemetría real",
      detail: windows
        ? "Confirma Firewall / Defender / BitLocker / Actualizaciones. Nunca inventes ONLINE."
        : "Confirma Firewall/Gatekeeper/FileVault/SIP y cifrado AES-256-CBC+HMAC. Nunca inventes ONLINE.",
      doneWhen: "Los controles muestran procedencia REAL de un reporte fresco.",
    },
  ];
}
