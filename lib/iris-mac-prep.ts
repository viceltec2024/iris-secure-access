/** Mac agent preparation checklist — no fake ONLINE devices. */

export type MacPrepStep = {
  id: string;
  title: string;
  detail: string;
  doneWhen: string;
};

export function macAgentPrepSteps(language: "es" | "en" = "es"): MacPrepStep[] {
  if (language === "en") {
    return [
      {
        id: "register",
        title: "Register the Mac in Devices",
        detail: "Create an enrollment record. Status stays PENDING until the agent checks in.",
        doneWhen: "A device row exists with an enrollment code.",
      },
      {
        id: "public_origin",
        title: "Reachable IRIS origin",
        detail: "The Mac must call a public or tunneled IRIS URL (IRIS_PUBLIC_ORIGIN / Sites). Local-only Vite is not enough for a remote Mac.",
        doneWhen: "curl to /api/agent/check-in from the Mac succeeds.",
      },
      {
        id: "install",
        title: "Install iris-agent-macos.sh",
        detail: "Paste the install command in Terminal and enter the enrollment code. The agent stores a token and reports every 120s.",
        doneWhen: "Device status becomes ONLINE with lastSeenAt under 5 minutes.",
      },
      {
        id: "verify",
        title: "Verify real telemetry",
        detail: "Confirm Firewall/Gatekeeper/FileVault/SIP and encryption AES-256-CBC+HMAC on the device card. Never invent ONLINE.",
        doneWhen: "Controls show REAL provenance from a fresh report.",
      },
    ];
  }
  return [
    {
      id: "register",
      title: "Registrar el Mac en Dispositivos",
      detail: "Crea el registro de inscripción. El estado sigue PENDING hasta el primer check-in del agente.",
      doneWhen: "Existe una fila de dispositivo con código de inscripción.",
    },
    {
      id: "public_origin",
      title: "Origen IRIS alcanzable",
      detail: "El Mac debe llamar a una URL pública o con túnel (IRIS_PUBLIC_ORIGIN / Sites). Vite solo local no alcanza a un Mac remoto.",
      doneWhen: "curl a /api/agent/check-in desde el Mac responde.",
    },
    {
      id: "install",
      title: "Instalar iris-agent-macos.sh",
      detail: "Pega el comando de instalación en Terminal e introduce el código. El agente guarda un token y reporta cada 120s.",
      doneWhen: "El dispositivo pasa a ONLINE con lastSeenAt menor a 5 minutos.",
    },
    {
      id: "verify",
      title: "Verificar telemetría real",
      detail: "Confirma Firewall/Gatekeeper/FileVault/SIP y cifrado AES-256-CBC+HMAC en la tarjeta. Nunca inventes ONLINE.",
      doneWhen: "Los controles muestran procedencia REAL de un reporte fresco.",
    },
  ];
}
