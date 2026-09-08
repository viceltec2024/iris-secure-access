"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Bell, ArrowClockwise, ChartLineUp, CheckCircle, CopySimple, Cube, Desktop, Eye, LockKey, Plus, Pulse, ShieldCheck, SignOut, Siren, Trash, TrendUp, UsersThree, Warning, Wrench, X } from "@phosphor-icons/react";
import IrisBrandMark from "../iris-brand-mark";
import AskIrisPanel from "./ask-iris-panel";
import IrisChainPanel from "./iris-chain-panel";
import IrisMarketPanel from "./iris-market-panel";
import { Language, text } from "./dashboard-i18n";
import { buildLiveIncidents, emptyLiveIncident, liveConnectionLine, liveIntelligence, liveWorkers, relativeTime, type LiveIncident, type LivePurchase, type LiveWorker } from "../../lib/iris-live-soc";
import { IRIS_AGENT_SCRIPT_VERSION, irisAgentShellCommand } from "../../lib/iris-device-view";
import { formatUtcClock } from "../../lib/iris-time";

type Incident = LiveIncident;
type Section = "operations" | "alerts" | "incidents" | "intelligence" | "devices" | "chain" | "market" | "approvals" | "audit";
type AuditEvent = { id: number; actorEmail: string; action: string; resource: string; outcome: string; createdAt: string };
type WalletState = { connected: boolean; address: string; mode?: string };
type DeviceTelemetry = { hostname?: string; osVersion?: string; architecture?: string; diskUsedPercent?: number; memoryUsedPercent?: number; firewallEnabled?: boolean; gatekeeperEnabled?: boolean; fileVaultEnabled?: boolean; sipEnabled?: boolean; automaticUpdatesEnabled?: boolean; installedApplicationCount?: number; riskyApplications?: string[]; trustedApplications?: string[]; xProtectPresent?: boolean; xProtectVersion?: string; malwareRemovalToolPresent?: boolean; persistenceItemCount?: number; unsignedPersistenceItems?: string[]; securityFindings?: string[]; changes?: string[]; changeDetectedAt?: string; collectedAt?: string; transportEncryption?: "TLS+HMAC" | "AES-256-CBC+HMAC-SHA256" };
type Device = { id: string; name: string; platform: string; status: "PENDING" | "ONLINE" | "OFFLINE"; risk: "UNKNOWN" | "LOW" | "MEDIUM" | "HIGH"; enrollmentCode: string; lastSeenAt: string | null; telemetry: DeviceTelemetry | null; healthScore: number | null; provenance: "REAL" | "UNVERIFIED" };
type ResponseAction = { id: number; incidentId: string; actorEmail: string; action: string; mode: string; outcome: string; createdAt: string };
type SecurityAlert = { id: string; deviceId: string; ownerEmail: string; fingerprint: string; code: string; severity: "CRITICAL" | "HIGH" | "MEDIUM" | "LOW"; status: "NEW" | "ACKNOWLEDGED" | "RESOLVED"; evidence: string; firstSeenAt: string; lastSeenAt: string; resolvedAt: string | null; updatedBy: string | null };
type RemediationPlan = { id: string; alertId: string; deviceId: string; ownerEmail: string; actionCode: string; status: "VERIFYING" | "VERIFIED" | "CANCELLED"; approvedBy: string; approvedAt: string; lastCheckedAt: string | null; verifiedAt: string | null };
type AgentRuntime = LiveWorker;

function remediationGuide(code: string, language: Language) {
  const es = language === "es";
  const guides: Record<string, { title: string; risk: string; steps: string[] }> = {
    FIREWALL_DISABLED: { title: es ? "Activar el firewall de macOS" : "Enable the macOS firewall", risk: es ? "Sin firewall, conexiones entrantes no autorizadas tienen menos protección." : "Without the firewall, unauthorized inbound connections have less protection.", steps: es ? ["Abre Configuración del Sistema.", "Selecciona Red y luego Firewall.", "Activa Firewall. No desactives otras protecciones."] : ["Open System Settings.", "Select Network, then Firewall.", "Turn Firewall on. Do not disable other protections."] },
    GATEKEEPER_DISABLED: { title: es ? "Restaurar Gatekeeper" : "Restore Gatekeeper", risk: es ? "Gatekeeper desactivado permite ejecutar software no verificado con mayor facilidad." : "Disabled Gatekeeper makes unverified software easier to run.", steps: es ? ["Abre Privacidad y seguridad.", "En Seguridad, permite aplicaciones de App Store y desarrolladores identificados.", "No abras aplicaciones cuya procedencia desconozcas."] : ["Open Privacy & Security.", "Under Security, allow apps from the App Store and identified developers.", "Do not open apps from unknown sources."] },
    FILEVAULT_DISABLED: { title: es ? "Activar FileVault" : "Enable FileVault", risk: es ? "Los datos del disco no están protegidos completamente si el Mac se pierde o es robado." : "Disk data is not fully protected if the Mac is lost or stolen.", steps: es ? ["Conecta el Mac a la corriente.", "Abre Privacidad y seguridad y selecciona FileVault.", "Actívalo y guarda la clave de recuperación en un lugar seguro."] : ["Connect the Mac to power.", "Open Privacy & Security and select FileVault.", "Turn it on and store the recovery key safely."] },
    SIP_DISABLED: { title: es ? "Restaurar la protección del sistema" : "Restore System Integrity Protection", risk: es ? "SIP desactivado permite cambios profundos en archivos protegidos de macOS." : "Disabled SIP permits deep changes to protected macOS files.", steps: es ? ["Guarda tu trabajo y apaga el Mac.", "Inicia Recuperación de macOS manteniendo presionado el botón de encendido.", "En Utilidades abre Terminal, ejecuta csrutil enable y reinicia."] : ["Save your work and shut down the Mac.", "Start macOS Recovery by holding the power button.", "From Utilities open Terminal, run csrutil enable, and restart."] },
    AUTOMATIC_UPDATES_DISABLED: { title: es ? "Activar actualizaciones automáticas" : "Enable automatic updates", risk: es ? "El Mac puede permanecer expuesto a fallas que Apple ya corrigió." : "The Mac may remain exposed to flaws Apple has already fixed.", steps: es ? ["Abre General y selecciona Actualización de software.", "Abre Actualizaciones automáticas.", "Activa las actualizaciones de macOS y las respuestas de seguridad."] : ["Open General and select Software Update.", "Open Automatic Updates.", "Enable macOS updates and security responses."] },
    UNVERIFIED_APPLICATIONS_FOUND: { title: es ? "Revisar aplicaciones no verificadas" : "Review unverified applications", risk: es ? "Una aplicación sin firma válida puede estar modificada o venir de una fuente no confiable." : "An app without a valid signature may be modified or come from an untrusted source.", steps: es ? ["Confirma que reconoces cada aplicación mostrada.", "Descárgala nuevamente desde su sitio oficial o App Store si tienes dudas.", "Elimina cualquier aplicación que no reconozcas."] : ["Confirm that you recognize every listed app.", "Download it again from its official site or the App Store if unsure.", "Remove any app you do not recognize."] },
    DISK_CRITICALLY_FULL: { title: es ? "Liberar espacio de forma segura" : "Safely free disk space", risk: es ? "Un disco casi lleno puede impedir actualizaciones y afectar la estabilidad." : "A nearly full disk can prevent updates and affect stability.", steps: es ? ["Abre General, Almacenamiento.", "Revisa archivos grandes y descargas.", "Elimina solo archivos que reconozcas y vacía la Papelera."] : ["Open General, Storage.", "Review large files and downloads.", "Delete only files you recognize and empty Trash."] },
    MEMORY_CRITICALLY_HIGH: { title: es ? "Reducir el uso de memoria" : "Reduce memory usage", risk: es ? "La presión extrema de memoria puede congelar procesos de seguridad." : "Extreme memory pressure can freeze security processes.", steps: es ? ["Guarda tu trabajo.", "Cierra aplicaciones que no estés usando.", "Reinicia el Mac si el uso continúa alto."] : ["Save your work.", "Close apps you are not using.", "Restart the Mac if usage remains high."] },
    XPROTECT_MISSING: { title: es ? "Restaurar XProtect" : "Restore XProtect", risk: es ? "La protección antimalware integrada de Apple no fue detectada." : "Apple's built-in antimalware protection was not detected.", steps: es ? ["Abre Actualización de software.", "Instala todas las respuestas de seguridad disponibles.", "Reinicia el Mac y permite que IRIS verifique nuevamente."] : ["Open Software Update.", "Install every available security response.", "Restart the Mac and let IRIS verify again."] },
    MALWARE_REMOVAL_TOOL_MISSING: { title: es ? "Restaurar la herramienta de eliminación de malware" : "Restore the Malware Removal Tool", risk: es ? "macOS podría no disponer de su componente integrado para retirar malware conocido." : "macOS may be missing its built-in component for removing known malware.", steps: es ? ["Instala todas las actualizaciones de macOS.", "Activa respuestas de seguridad y archivos del sistema.", "Reinicia el Mac."] : ["Install all macOS updates.", "Enable security responses and system files.", "Restart the Mac."] },
    UNSIGNED_PERSISTENCE_FOUND: { title: es ? "Revisar un programa de inicio sin firma" : "Review an unsigned startup program", risk: es ? "Un ejecutable sin firma intenta permanecer activo al iniciar macOS." : "An unsigned executable is configured to remain active when macOS starts.", steps: es ? ["No elimines archivos todavía.", "Abre General, Ítems de inicio y extensiones.", "Desactiva cualquier elemento que no reconozcas y confirma su origen."] : ["Do not delete files yet.", "Open General, Login Items & Extensions.", "Disable anything you do not recognize and confirm its source."] },
  };
  return guides[code] || { title: es ? "Revisar el cambio detectado" : "Review the detected change", risk: es ? "IRIS detectó un cambio que debe confirmarse antes de cerrarlo." : "IRIS detected a change that should be confirmed before closure.", steps: es ? ["Revisa el control indicado en Configuración del Sistema.", "Confirma que el cambio fue intencional.", "Restaura la configuración anterior si no lo reconoces."] : ["Review the indicated control in System Settings.", "Confirm the change was intentional.", "Restore the previous setting if you do not recognize it."] };
}

export default function SecurityOperations({ user, auditCount, signOutPath }: { user: { email: string; displayName: string; role: string }, auditCount: number, signOutPath: string }) {
  const [language, setLanguage] = useState<Language>("es");
  const [pageOrigin, setPageOrigin] = useState("");
  const [incidents, setIncidents] = useState<Incident[]>([]);
  const [selected, setSelected] = useState<Incident>(() => emptyLiveIncident("es"));
  const [filter, setFilter] = useState("All");
  const [lastUpdate, setLastUpdate] = useState("ahora mismo");
  const [section, setSection] = useState<Section>("operations");
  const [approvalOpen, setApprovalOpen] = useState(false);
  const [executionNote, setExecutionNote] = useState("");
  const [devices, setDevices] = useState<Device[]>([]);
  const [alerts, setAlerts] = useState<SecurityAlert[]>([]);
  const [remediations, setRemediations] = useState<RemediationPlan[]>([]);
  const [remediationAlert, setRemediationAlert] = useState<SecurityAlert | null>(null);
  const [startingRemediation, setStartingRemediation] = useState(false);
  const [responseHistory, setResponseHistory] = useState<ResponseAction[]>([]);
  const [creatingDevice, setCreatingDevice] = useState(false);
  const [copiedDeviceId, setCopiedDeviceId] = useState<string | null>(null);
  const [deletingDeviceId, setDeletingDeviceId] = useState<string | null>(null);
  const [approvingApplication, setApprovingApplication] = useState<string | null>(null);
  const [agentRuntime, setAgentRuntime] = useState<AgentRuntime[]>([]);
  const [auditEvents, setAuditEvents] = useState<AuditEvent[]>([]);
  const [wallet, setWallet] = useState<WalletState>({ connected: false, address: "" });
  const [purchases, setPurchases] = useState<LivePurchase[]>([]);
  const [marketLive, setMarketLive] = useState(false);
  const [liveAuditCount, setLiveAuditCount] = useState(auditCount);

  const rebuildIncidents = useCallback((nextAlerts: SecurityAlert[], nextDevices: Device[], nextPurchases: LivePurchase[], saved: { incidentId: string; status: Incident["status"] }[], nextLanguage: Language) => {
    const next = buildLiveIncidents({
      alerts: nextAlerts,
      devices: nextDevices,
      purchases: nextPurchases,
      saved,
      language: nextLanguage,
    });
    setIncidents(next);
    setSelected(current => {
      const match = next.find(item => item.id === current.id);
      return match || next[0] || emptyLiveIncident(nextLanguage);
    });
    return next;
  }, []);

  const waitingForAgent = devices.some(device => device.status !== "ONLINE");

  useEffect(() => {
    const stored = localStorage.getItem("iris-language");
    if (stored === "en" || stored === "es") {
      setLanguage(stored);
      setLastUpdate(stored === "es" ? "ahora mismo" : "just now");
    }
    setPageOrigin(window.location.origin);
  }, []);

  useEffect(() => {
    const loadSecurityState = () => void fetch("/api/security-state").then(response => response.json()).then((data: {
      incidents?: { incidentId: string; status: Incident["status"] }[];
      devices?: Device[];
      actions?: ResponseAction[];
      alerts?: SecurityAlert[];
      remediations?: RemediationPlan[];
      audit?: AuditEvent[];
      purchases?: LivePurchase[];
      wallet?: WalletState;
    }) => {
      const nextDevices = data.devices || [];
      const nextAlerts = data.alerts || [];
      const nextPurchases = data.purchases || [];
      if (data.devices) setDevices(nextDevices);
      if (data.actions) setResponseHistory(data.actions);
      if (data.alerts) setAlerts(nextAlerts);
      if (data.remediations) setRemediations(data.remediations);
      if (data.audit) {
        setAuditEvents(data.audit);
        setLiveAuditCount(data.audit.length);
      }
      if (data.purchases) setPurchases(nextPurchases);
      if (data.wallet) setWallet(data.wallet);
      rebuildIncidents(nextAlerts, nextDevices, nextPurchases, data.incidents || [], language);
    }).catch(() => undefined);
    loadSecurityState();
    const refreshTimer = window.setInterval(loadSecurityState, waitingForAgent ? 8_000 : 30_000);
    return () => window.clearInterval(refreshTimer);
  }, [language, rebuildIncidents, waitingForAgent]);

  useEffect(() => {
    const loadMarket = () => void fetch("/api/iris-market?view=live", { cache: "no-store" }).then(response => response.json()).then((data: { live?: boolean }) => {
      setMarketLive(Boolean(data.live));
    }).catch(() => setMarketLive(false));
    loadMarket();
    const marketTimer = window.setInterval(loadMarket, 30_000);
    return () => window.clearInterval(marketTimer);
  }, []);

  useEffect(() => {
    setAgentRuntime(liveWorkers({
      devices,
      walletConnected: wallet.connected,
      walletAddress: wallet.address,
      marketLive,
      auditCount: liveAuditCount,
      pendingPurchases: purchases.length,
      language,
      now: new Date().toISOString(),
    }));
  }, [devices, wallet, marketLive, liveAuditCount, purchases, language]);

  const visible = useMemo(() => incidents.filter(i => filter === "All" || i.severity === filter), [incidents, filter]);
  const open = incidents.filter(i => i.status !== "Contained").length;
  const verifiedDevices = devices.filter(device => device.provenance === "REAL");
  const onlineDevices = verifiedDevices.filter(device => device.status === "ONLINE");
  const measuredHealth = verifiedDevices.map(device => device.healthScore).filter((score): score is number => score !== null);
  const averageHealth = measuredHealth.length ? Math.round(measuredHealth.reduce((sum, score) => sum + score, 0) / measuredHealth.length) : null;
  const firewallProtected = verifiedDevices.filter(device => device.telemetry?.firewallEnabled === true).length;
  const activeAlerts = alerts.filter(alert => alert.status !== "RESOLVED");
  const newAlerts = alerts.filter(alert => alert.status === "NEW");
  const t = (key: Parameters<typeof text>[0]) => text(key, language);
  const localized = (incident: Incident): Incident => incident;
  const connectionLine = liveConnectionLine({ online: onlineDevices.length, devices: devices.length, openAlerts: activeAlerts.length, wallet: wallet.connected, language });
  const intel = liveIntelligence(alerts, language);
  const selectedView = localized(selected);
  const statusLabel = (status: Incident["status"]) => t(status === "Open" ? "statusOpen" : status === "Investigating" ? "statusInvestigating" : "statusContained");
  const controlMark = (value: boolean | undefined) => value === undefined ? "—" : value ? "✓" : "⚠";
  const changeLanguage = (next: Language) => { setLanguage(next); localStorage.setItem("iris-language", next); setLastUpdate(next === "es" ? "ahora mismo" : "just now"); };

  async function decide(decision: "approve" | "reject") {
    if (!selected.id) { setApprovalOpen(false); return; }
    const response = await fetch("/api/security-state", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ incidentId: selected.id, decision, language }) });
    const data = await response.json().catch(() => ({})) as { status?: Incident["status"] | null; checkoutUrl?: string; commands?: string[]; error?: string };
    if (!response.ok) { setExecutionNote(data.error || (language === "es" ? "No se pudo guardar la decisión. Inténtalo nuevamente." : "The decision could not be saved. Please try again.")); return; }
    if (decision === "reject") {
      setApprovalOpen(false);
      setExecutionNote(language === "es" ? `Plan rechazado. No se envió ninguna orden al agente ni se abrió un checkout.` : `Plan rejected. No agent command was sent and no checkout was opened.`);
      return;
    }
    const nextStatus = data.status || (selected.kind === "alert" ? "Investigating" : "Contained");
    setIncidents(all => all.map(i => i.id === selected.id ? { ...i, status: nextStatus } : i));
    setSelected({ ...selected, status: nextStatus });
    setApprovalOpen(false);
    if (data.checkoutUrl) {
      window.open(data.checkoutUrl, "_blank", "noopener,noreferrer");
      setExecutionNote(language === "es" ? `Compra aprobada en vivo. Se abrió el checkout oficial para que tú confirmes.` : `Purchase approved live. The official checkout opened so you can confirm.`);
    } else if (selected.kind === "alert") {
      setExecutionNote(language === "es" ? `Aprobado en vivo. IRIS avisó al Mac${(data.commands || []).includes("ENABLE_FIREWALL") ? " y pedirá activar el firewall" : ""} y espera el siguiente reporte del agente.` : `Approved live. IRIS notified the Mac${(data.commands || []).includes("ENABLE_FIREWALL") ? " and will ask to enable the firewall" : ""} and is waiting for the next agent report.`);
    } else {
      setExecutionNote(language === "es" ? `Revisión registrada en vivo. IRIS no puede encender un Mac apagado.` : `Review recorded live. IRIS cannot wake a Mac that is offline.`);
    }
    setResponseHistory(current => [{ id: Date.now(), incidentId: selected.id, actorEmail: user.email, action: selected.kind === "purchase" ? "APPROVE_PURCHASE" : "DISPATCH_AGENT_COMMANDS", mode: "LIVE", outcome: "COMPLETED", createdAt: new Date().toISOString() }, ...current]);
  }

  async function copyReconnectCommand(device: Device) {
    const command = irisAgentShellCommand(window.location.origin, device.status !== "PENDING");
    try {
      await navigator.clipboard.writeText(command);
      setCopiedDeviceId(device.id);
      window.setTimeout(() => setCopiedDeviceId(current => current === device.id ? null : current), 5000);
    } catch {
      window.prompt(language === "es" ? "Copia este comando y pégalo en Terminal en tu Mac:" : "Copy this command and paste it in Terminal on your Mac:", command);
    }
  }

  async function createDeviceEnrollment() {
    setCreatingDevice(true);
    try { const response = await fetch("/api/security-state", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ type: "device_enrollment", name: "My Mac", platform: "macOS" }) }); const data = await response.json() as { device?: Device }; if (response.ok && data.device) setDevices(current => [data.device!, ...current]); } finally { setCreatingDevice(false); }
  }

  async function rotateEnrollmentCode(deviceId: string) {
    const response = await fetch("/api/security-state", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ type: "rotate_device_code", deviceId }) });
    const data = await response.json() as { device?: Device };
    if (response.ok && data.device) setDevices(current => current.map(device => device.id === deviceId ? data.device! : device));
  }

  async function deleteDevice(device: Device) {
    const confirmed = window.confirm(language === "es"
      ? `¿Eliminar ${device.name}? Esta acción revocará su acceso a IRIS y no se puede deshacer.`
      : `Delete ${device.name}? This will revoke its access to IRIS and cannot be undone.`);
    if (!confirmed) return;

    setDeletingDeviceId(device.id);
    try {
      const response = await fetch("/api/security-state", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ deviceId: device.id }),
      });
      if (response.ok) setDevices(current => current.filter(item => item.id !== device.id));
      else window.alert(language === "es" ? "No se pudo eliminar el dispositivo." : "The device could not be deleted.");
    } finally {
      setDeletingDeviceId(null);
    }
  }

  async function trustApplication(deviceId: string, appName: string) {
    const confirmed = window.confirm(language === "es" ? `¿Confirmas que instalaste ${appName} desde una fuente oficial y confías en esta aplicación?` : `Do you confirm that you installed ${appName} from an official source and trust this application?`);
    if (!confirmed) return;
    setApprovingApplication(`${deviceId}:${appName}`);
    try {
      const response = await fetch("/api/security-state", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ type: "trust_application", deviceId, appName }) });
      const data = await response.json() as { device?: Device };
      if (response.ok && data.device) setDevices(current => current.map(device => device.id === deviceId ? data.device! : device));
    } finally { setApprovingApplication(null); }
  }

  async function updateAlert(alertId: string, alertStatus: "ACKNOWLEDGED" | "RESOLVED") {
    const response = await fetch("/api/security-state", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ type: "alert_action", alertId, alertStatus }) });
    const data = await response.json() as { alert?: SecurityAlert };
    if (response.ok && data.alert) setAlerts(current => current.map(alert => alert.id === alertId ? data.alert! : alert));
  }

  async function startRemediation(alert: SecurityAlert) {
    setStartingRemediation(true);
    try {
      const response = await fetch("/api/security-state", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ type: "start_remediation", alertId: alert.id }) });
      const data = await response.json() as { remediation?: RemediationPlan };
      if (response.ok && data.remediation) {
        setRemediations(current => [data.remediation!, ...current.filter(item => item.alertId !== alert.id)]);
        setAlerts(current => current.map(item => item.id === alert.id ? { ...item, status: "ACKNOWLEDGED", updatedBy: user.email } : item));
        setRemediationAlert(null);
      }
    } finally { setStartingRemediation(false); }
  }

  function evidenceFor(alert: SecurityAlert) {
    try { return JSON.parse(alert.evidence) as { hostname?: string; applications?: string[]; startupItems?: string[]; xProtectVersion?: string; collectedAt?: string }; }
    catch { return {}; }
  }

  function selectIncident(incident: Incident) {
    setSelected(incident);
    setExecutionNote("");
    setApprovalOpen(false);
  }

  return <main className="soc-shell">
    <aside className="soc-sidebar">
      <div className="soc-brand"><IrisBrandMark /><div><strong>IRIS</strong><span>SECURITY AI</span></div></div>
      <nav aria-label="IRIS modules">
        <button className={section === "operations" ? "active" : ""} onClick={() => setSection("operations")}><Pulse /> {t("operations")}</button>
        <button className={section === "alerts" ? "active" : ""} onClick={() => setSection("alerts")}><Bell /> {language === "es" ? "Alertas reales" : "Real alerts"} <b>{activeAlerts.length}</b></button>
        <button className={section === "incidents" ? "active" : ""} onClick={() => setSection("incidents")}><Siren /> {t("incidents")} <b>{open}</b></button>
        <button className={section === "intelligence" ? "active" : ""} onClick={() => setSection("intelligence")}><ChartLineUp /> {t("intelligence")}</button>
        <button className={section === "devices" ? "active" : ""} onClick={() => setSection("devices")}><Desktop /> {language === "es" ? "Dispositivos" : "Devices"} <b>{devices.length}</b></button>
        <button className={section === "chain" ? "active" : ""} onClick={() => setSection("chain")}><Cube /> IRIS Chain</button>
        <button className={section === "market" ? "active" : ""} onClick={() => setSection("market")}><TrendUp /> {language === "es" ? "Bolsa en vivo" : "Live market"}</button>
        <button className={section === "approvals" ? "active" : ""} onClick={() => setSection("approvals")}><ShieldCheck /> {t("approvals")} <b>{open}</b></button>
        <button className={section === "audit" ? "active" : ""} onClick={() => setSection("audit")}><LockKey /> {t("audit")} <b>{liveAuditCount}</b></button>
        {user.role === "ADMIN" && <a href="/admin/users"><UsersThree /> {t("access")}</a>}
      </nav>
      <div className="soc-user"><span className="avatar">{user.displayName.slice(0,1).toUpperCase()}</span><div><strong>{user.displayName}</strong><small>{user.role}</small></div></div>
    </aside>

    <section className="soc-main">
      <header className="soc-header"><div><p>{t("command")}</p><h1>{{ operations: t("securityOperations"), alerts: language === "es" ? "Centro de alertas reales" : "Real alert center", incidents: t("incidentResponse"), intelligence: t("threatIntelligence"), devices: language === "es" ? "Dispositivos protegidos" : "Protected devices", chain: "IRIS Chain", market: language === "es" ? "Bolsa en vivo" : "Live market", approvals: t("approvalCenter"), audit: t("audit") }[section]}</h1><span><i /> {connectionLine} · {t("updated")} {lastUpdate}</span></div><div className="header-actions"><div className="language-switch" aria-label="Language"><button className={language === "en" ? "active" : ""} onClick={() => changeLanguage("en")}>EN</button><button className={language === "es" ? "active" : ""} onClick={() => changeLanguage("es")}>ES</button></div><button aria-label="Refresh data" onClick={() => setLastUpdate(t("now"))}><Pulse /></button><button aria-label="Open real alerts" onClick={() => setSection("alerts")}><Bell /><b>{activeAlerts.length}</b></button><a href={signOutPath}><SignOut /> {t("signOut")}</a></div></header>

      {section === "operations" && <><section className="metric-row">
        <article><span>{language === "es" ? "Salud real" : "Real health"}</span><strong>{averageHealth ?? "—"}{averageHealth !== null && <small>/100</small>}</strong><em className={averageHealth === null ? "" : "healthy"}>{averageHealth === null ? (language === "es" ? "NO VERIFICADO" : "UNVERIFIED") : "REAL"}</em></article>
        <article><span>{language === "es" ? "Agentes conectados" : "Connected agents"}</span><strong>{onlineDevices.length}<small>/{devices.length}</small></strong><em>{language === "es" ? "telemetría reciente" : "recent telemetry"}</em></article>
        <article><span>{language === "es" ? "Firewall activo" : "Firewall enabled"}</span><strong>{firewallProtected}<small>/{verifiedDevices.length || "—"}</small></strong><em className={firewallProtected === verifiedDevices.length && verifiedDevices.length ? "healthy" : ""}>REAL</em></article>
        <article><span>{language === "es" ? "Alertas reales activas" : "Active real alerts"}</span><strong>{activeAlerts.length}</strong><em className={activeAlerts.length ? "" : "healthy"}>REAL · {newAlerts.length} {language === "es" ? "nuevas" : "new"}</em></article>
      </section>

      <div className="provenance-legend"><span><b>REAL</b>{language === "es" ? "Reportado por un agente autorizado" : "Reported by an authorized agent"}</span><span><b>EN VIVO</b>{language === "es" ? "Wallet, bolsa o compras pendientes" : "Wallet, market, or pending purchases"}</span><span><b>NO VERIFICADO</b>{language === "es" ? "Sin reporte del agente" : "No agent report"}</span></div>

      <section className="agent-live-monitor">
        <div className="module-toolbar">
          <div>
            <h2>{language === "es" ? "Sistemas en vivo" : "Live systems"}</h2>
            <p>{language === "es" ? "Estos estados salen de tu Mac, la wallet, la bolsa y el registro de auditoría. No son un reloj de demostración." : "These statuses come from your Mac, wallet, market, and audit log. They are not a demonstration clock."}</p>
          </div>
          <div className="agent-toolbar-actions">
            <span className="live-pill"><i />LIVE</span>
          </div>
        </div>
        <div className="agent-runtime-grid">
          {agentRuntime.map(agent => <article key={agent.id}>
            <div>
              <strong>{agent.role}</strong>
              <small>{agent.task || agent.id}</small>
            </div>
            <span className={`agent-state ${agent.status.toLowerCase()}`}>{agent.status}</span>
            {agent.updatedAt && <time>{new Date(agent.updatedAt).toLocaleTimeString(language)}</time>}
          </article>)}
        </div>
      </section>

      <section className="soc-grid">
        <div className="incident-card">
          <div className="card-head"><div><h2>{t("liveActivity")} <small className="provenance-badge real">REAL</small></h2><p>{t("rankedSignals")}</p></div><div className="filters">{["All","Critical","High","Medium"].map(f => <button className={filter === f ? "active" : ""} onClick={() => setFilter(f)} key={f}>{t((`filter${f}`) as "filterAll")}</button>)}</div></div>
          <div className="incident-list">{visible.map(i => { const v=localized(i); return <button key={i.id} className={`incident-row ${selected.id === i.id ? "selected" : ""}`} onClick={() => selectIncident(i)}><span className={`severity ${i.severity.toLowerCase()}`}><Warning weight="fill" /></span><span className="incident-copy"><strong>{v.title}</strong><small>{i.subject} · {v.source}</small></span><span className={`status ${i.status.toLowerCase()}`}>{statusLabel(i.status)}</span><time>{relativeTime(i.time, language)}</time></button>})}{visible.length === 0 && <div className="empty-alerts"><CheckCircle weight="fill" /><h3>{language === "es" ? "Sin incidentes reales" : "No live incidents"}</h3><p>{language === "es" ? "Cuando el agente, la wallet o una compra tengan algo que revisar, aparece aquí." : "When the agent, wallet, or a purchase has something to review, it appears here."}</p></div>}</div>
        </div>

        <aside className="analysis-card">
          <div className="iris-orb"><Eye weight="duotone" /></div><div className="analysis-title"><span>ASK IRIS</span><i>{language === "es" ? "ANÁLISIS EN VIVO" : "LIVE ANALYSIS"}</i></div>
          <h2>{selectedView.title}</h2><p className="case-id">{selected.id} · {selected.subject}</p>
          <div className="evidence"><strong>{t("evidence")}</strong>{selectedView.evidence.map(e => <span key={e}><CheckCircle weight="fill" /> {e}</span>)}</div>
          <div className="recommendation"><strong>{t("recommended")}</strong><p>{selectedView.recommendation}</p></div>
          <button className="contain-btn" disabled={!selected.id || selected.status === "Contained"} onClick={() => { setSection("incidents"); setApprovalOpen(true); }}>{!selected.id ? (language === "es" ? "Sin incidente en vivo" : "No live incident") : selected.status === "Contained" ? <><CheckCircle /> {t("contained")}</> : <><ShieldCheck /> {t("reviewPlan")}</>}</button>
        </aside>
      </section>

      </>}

      {section === "alerts" && <section className="module-panel real-alert-center">
        <div className="module-toolbar"><div><h2>{language === "es" ? "Alertas y respuesta segura" : "Alerts and safe response"}</h2><p>{language === "es" ? "IRIS te guía, solicita aprobación y espera un nuevo reporte del agente antes de confirmar la corrección." : "IRIS guides you, requests approval, and waits for a new agent report before confirming the fix."}</p></div><span className="provenance-badge real">REAL</span></div>
        <div className="alert-summary"><span><b>{newAlerts.length}</b>{language === "es" ? "Nuevas" : "New"}</span><span><b>{alerts.filter(alert => alert.status === "ACKNOWLEDGED").length}</b>{language === "es" ? "Reconocidas" : "Acknowledged"}</span><span><b>{alerts.filter(alert => alert.status === "RESOLVED").length}</b>{language === "es" ? "Resueltas" : "Resolved"}</span></div>
        <div className="real-alert-list">{alerts.map(alert => { const evidence = evidenceFor(alert); const device = devices.find(item => item.id === alert.deviceId); const remediation = remediations.find(item => item.alertId === alert.id); return <article className={`real-alert-item severity-${alert.severity.toLowerCase()}`} key={alert.id}>
          <span className="alert-icon"><Warning weight="fill" /></span><div className="alert-copy"><div><strong>{alert.code.replaceAll("_", " ")}</strong><span className={`alert-status ${alert.status.toLowerCase()}`}>{alert.status === "NEW" ? (language === "es" ? "NUEVA" : "NEW") : alert.status === "ACKNOWLEDGED" ? (language === "es" ? "RECONOCIDA" : "ACKNOWLEDGED") : (language === "es" ? "RESUELTA" : "RESOLVED")}</span></div><p>{device?.name || evidence.hostname || (language === "es" ? "Dispositivo" : "Device")} · {alert.severity}</p>{!!evidence.applications?.length && <small>{language === "es" ? "Aplicaciones: " : "Applications: "}{evidence.applications.join(", ")}</small>}{!!evidence.startupItems?.length && <small>{language === "es" ? "Inicio automático: " : "Startup: "}{evidence.startupItems.join(", ")}</small>}<time>{language === "es" ? "Última detección" : "Last detected"}: {formatUtcClock(alert.lastSeenAt)}</time></div>
          <div className="real-alert-actions">{remediation?.status === "VERIFIED" ? <span className="remediation-state verified"><CheckCircle weight="fill" />{language === "es" ? "VERIFICADA POR EL AGENTE" : "AGENT VERIFIED"}</span> : remediation?.status === "VERIFYING" ? <span className="remediation-state verifying"><Pulse />{language === "es" ? "ESPERANDO REPORTE" : "AWAITING REPORT"}</span> : alert.status !== "RESOLVED" ? <button className="safe-fix" onClick={() => setRemediationAlert(alert)}><Wrench />{language === "es" ? "Corregir con IRIS" : "Fix with IRIS"}</button> : null}{alert.status === "NEW" && <button onClick={() => void updateAlert(alert.id, "ACKNOWLEDGED")}>{language === "es" ? "Reconocer" : "Acknowledge"}</button>}</div>
        </article>})}{alerts.length === 0 && <div className="empty-alerts"><CheckCircle weight="fill" /><h3>{language === "es" ? "No hay alertas reales" : "No real alerts"}</h3><p>{language === "es" ? "IRIS mostrará aquí cualquier cambio o amenaza comprobada por el agente." : "IRIS will show any agent-verified change or threat here."}</p></div>}</div>
      </section>}

      {remediationAlert && <div className="approval-backdrop" role="presentation" onMouseDown={() => setRemediationAlert(null)}><section className="approval-dialog remediation-dialog" role="dialog" aria-modal="true" aria-labelledby="remediation-title" onMouseDown={event => event.stopPropagation()}><button className="approval-close" aria-label={language === "es" ? "Cerrar" : "Close"} onClick={() => setRemediationAlert(null)}><X /></button><span className="approval-icon"><Wrench weight="duotone" /></span><p>{language === "es" ? "RESPUESTA SEGURA · APROBACIÓN REQUERIDA" : "SAFE RESPONSE · APPROVAL REQUIRED"}</p><h2 id="remediation-title">{remediationGuide(remediationAlert.code, language).title}</h2><div className="remediation-risk"><Warning weight="fill" /><span><strong>{language === "es" ? "Por qué importa" : "Why it matters"}</strong>{remediationGuide(remediationAlert.code, language).risk}</span></div><ol className="remediation-steps">{remediationGuide(remediationAlert.code, language).steps.map((step, index) => <li key={step}><b>{index + 1}</b><span>{step}</span></li>)}</ol><div className="safe-boundary"><ShieldCheck weight="fill" /><span><strong>{language === "es" ? "Control humano" : "Human control"}</strong>{language === "es" ? "IRIS no escribirá tu contraseña ni cambiará macOS silenciosamente. Después de completar los pasos, el agente verificará el resultado en su próximo reporte." : "IRIS will not enter your password or silently change macOS. After you complete the steps, the agent will verify the result in its next report."}</span></div><div className="approval-actions"><button onClick={() => setRemediationAlert(null)}>{language === "es" ? "Cancelar" : "Cancel"}</button><button disabled={startingRemediation} onClick={() => void startRemediation(remediationAlert)}><ShieldCheck />{startingRemediation ? (language === "es" ? "Guardando…" : "Saving…") : (language === "es" ? "Ya lo corregí: verificar" : "I fixed it: verify")}</button></div></section></div>}

      {section === "incidents" && <section className="module-panel">
        <div className="module-toolbar"><div><h2>{t("allIncidents")}</h2><p>{t("selectIncident")}</p></div><div className="filters">{["All","Critical","High","Medium"].map(f => <button className={filter === f ? "active" : ""} onClick={() => setFilter(f)} key={f}>{t((`filter${f}`) as "filterAll")}</button>)}</div></div>
        <div className="module-split"><div className="incident-list expanded">{visible.map(i => { const v=localized(i); return <button key={i.id} className={`incident-row ${selected.id === i.id ? "selected" : ""}`} onClick={() => selectIncident(i)}><span className={`severity ${i.severity.toLowerCase()}`}><Warning weight="fill" /></span><span className="incident-copy"><strong>{v.title}</strong><small>{i.subject} · {v.source}</small></span><span className={`status ${i.status.toLowerCase()}`}>{statusLabel(i.status)}</span><time>{relativeTime(i.time, language)}</time></button>})}{visible.length === 0 && <div className="empty-alerts"><CheckCircle weight="fill" /><h3>{language === "es" ? "Sin incidentes reales" : "No live incidents"}</h3></div>}</div><aside className="module-detail">
          <div className="detail-heading"><span className={`module-severity ${selected.severity.toLowerCase()}`}>{t((`filter${selected.severity}`) as "filterAll")}</span><span className={`status ${selected.status.toLowerCase()}`}>{statusLabel(selected.status)}</span></div>
          <h2>{selectedView.title}</h2><p>{selected.id} · {selected.subject} · {selectedView.source}</p>
          <div className="incident-summary"><strong>{t("whatHappened")}</strong><p>{selectedView.summary}</p></div>
          <div className="detail-facts"><article><span>{t("probableCause")}</span><p>{selectedView.cause}</p></article><article><span>{t("impact")}</span><p>{selectedView.impact}</p></article><article><span>{t("confidence")}</span><b>{selected.confidence}%</b></article></div>
          <h3>{t("evidence")}</h3>{selectedView.evidence.map(e => <span className="detail-line" key={e}><CheckCircle weight="fill" />{e}</span>)}
          <h3>{t("proposedPlan")}</h3><ol className="response-steps">{selectedView.actions.map((action,index)=><li key={action}><b>{index+1}</b><span>{action}</span></li>)}</ol>
          <div className="demo-warning"><Warning weight="fill" /><span><strong>{t("demoMode")}</strong>{t("demoWarning")}</span></div>
          {executionNote && <p className="execution-note"><CheckCircle weight="fill" />{executionNote}</p>}
          <button className="contain-btn" disabled={!selected.id || selected.status === "Contained"} onClick={() => setApprovalOpen(true)}>{!selected.id ? (language === "es" ? "Nada que aprobar" : "Nothing to approve") : selected.status === "Contained" ? t("incidentContained") : t("requestApproval")}</button>
        </aside></div>
      </section>}

      {approvalOpen && selected.id && <div className="approval-backdrop" role="presentation" onMouseDown={() => setApprovalOpen(false)}><section className="approval-dialog" role="dialog" aria-modal="true" aria-labelledby="approval-title" onMouseDown={event => event.stopPropagation()}><button className="approval-close" aria-label={t("cancel")} onClick={() => setApprovalOpen(false)}><X /></button><span className="approval-icon"><ShieldCheck weight="duotone" /></span><p>{t("approvalRequired")}</p><h2 id="approval-title">{t("authorize")} {selectedView.title}</h2><div className="approval-list">{selectedView.actions.map(action=><span key={action}><CheckCircle weight="fill" />{action}</span>)}</div><div className="demo-warning"><Warning weight="fill" /><span><strong>{t("secureConfirmation")}</strong>{t("simulationOnly")}</span></div><div className="approval-actions"><button onClick={() => void decide("reject")}>{language === "es" ? "Rechazar" : "Reject"}</button><button onClick={() => void decide("approve")}><ShieldCheck /> {t("approveSimulation")}</button></div></section></div>}

      {section === "approvals" && <section className="module-panel approvals-view"><div className="module-toolbar"><div><h2>{t("pendingApprovals")}</h2><p>{t("approvalExplain")}</p></div><span className="audit-total">{open}</span></div><div className="approval-queue">{incidents.filter(i => i.status !== "Contained").map(i => { const v=localized(i); return <article key={i.id}><span className={`severity ${i.severity.toLowerCase()}`}><Warning weight="fill" /></span><div><strong>{v.title}</strong><p>{i.id} · {i.subject}</p><small>{v.actions.length} {language === "es" ? "acciones propuestas" : "proposed actions"}</small></div><button onClick={() => { selectIncident(i); setApprovalOpen(true); }}>{t("review")}</button></article>})}{open === 0 && <p className="empty-approvals"><CheckCircle weight="fill" />{t("noPending")}</p>}</div></section>}

      {section === "devices" && <section className="module-panel devices-view">
        <div className="module-toolbar"><div><h2>{language === "es" ? "Protección real de dispositivos" : "Real device protection"}</h2><p>{language === "es" ? "IRIS verifica controles, aplicaciones y cambios mediante el agente autorizado." : "IRIS verifies controls, applications, and changes through the authorized agent."}</p></div><button className="add-device" onClick={createDeviceEnrollment} disabled={creatingDevice}><Plus />{creatingDevice ? (language === "es" ? "Creando…" : "Creating…") : (language === "es" ? "Registrar mi Mac" : "Register my Mac")}</button></div>
        <div className="device-grid">{devices.map(device => <article key={device.id}>
          <div className="device-card-head"><div className="device-icon"><Desktop weight="duotone" /></div><div><strong>{device.name}</strong><span>{device.telemetry?.hostname || device.platform}</span></div><b className={`provenance-badge ${device.provenance.toLowerCase()}`}>{device.provenance === "REAL" ? "REAL" : (language === "es" ? "NO VERIFICADO" : "UNVERIFIED")}</b></div>
          <div className="device-status-line"><b className={`device-state ${device.status.toLowerCase()}`}>{device.status === "PENDING" ? (language === "es" ? "PENDIENTE" : "PENDING") : device.status}</b><strong>{language === "es" ? "Salud" : "Health"}: {device.healthScore ?? "—"}{device.healthScore !== null && "/100"}</strong></div>
          <dl className="security-controls">
            <div><dt>Firewall</dt><dd>{controlMark(device.telemetry?.firewallEnabled)}</dd></div>
            <div><dt>Gatekeeper</dt><dd>{controlMark(device.telemetry?.gatekeeperEnabled)}</dd></div>
            <div><dt>FileVault</dt><dd>{controlMark(device.telemetry?.fileVaultEnabled)}</dd></div>
            <div><dt>SIP</dt><dd>{controlMark(device.telemetry?.sipEnabled)}</dd></div>
            <div><dt>{language === "es" ? "Actualizaciones" : "Updates"}</dt><dd>{controlMark(device.telemetry?.automaticUpdatesEnabled)}</dd></div>
            <div><dt>{language === "es" ? "Aplicaciones" : "Applications"}</dt><dd>{device.telemetry?.installedApplicationCount ?? "—"}</dd></div>
            <div><dt>XProtect</dt><dd>{controlMark(device.telemetry?.xProtectPresent)} {device.telemetry?.xProtectVersion && device.telemetry.xProtectVersion !== "unknown" ? device.telemetry.xProtectVersion : ""}</dd></div>
            <div><dt>{language === "es" ? "Eliminación malware" : "Malware removal"}</dt><dd>{controlMark(device.telemetry?.malwareRemovalToolPresent)}</dd></div>
            <div><dt>{language === "es" ? "Ítems de inicio" : "Startup items"}</dt><dd>{device.telemetry?.persistenceItemCount ?? "—"}</dd></div>
            <div><dt>{language === "es" ? "Último reporte" : "Last report"}</dt><dd>{device.lastSeenAt ? formatUtcClock(device.lastSeenAt) : (language === "es" ? "Nunca" : "Never")}</dd></div>
            <div><dt>{language === "es" ? "Cifrado del reporte" : "Report encryption"}</dt><dd>{device.telemetry?.transportEncryption === "AES-256-CBC+HMAC-SHA256" ? (language === "es" ? "✓ EXTREMO A EXTREMO" : "✓ END TO END") : (language === "es" ? "TLS · ACTUALIZA AGENTE" : "TLS · UPDATE AGENT")}</dd></div>
          </dl>
          {!!device.telemetry?.changes?.length && <div className="real-alerts"><strong>{language === "es" ? "CAMBIOS DETECTADOS" : "CHANGES DETECTED"}</strong>{device.telemetry.changes.map(change => <span key={change}><Warning weight="fill" />{change.replaceAll("_", " ")}</span>)}</div>}
          {!!device.telemetry?.securityFindings?.length && <div className="security-findings"><strong>{language === "es" ? "ATENCIÓN REQUERIDA" : "ATTENTION REQUIRED"}</strong>{device.telemetry.securityFindings.map(finding => <span key={finding}><Warning weight="fill" />{finding.replaceAll("_", " ")}</span>)}</div>}
          {!!device.telemetry?.riskyApplications?.length && <div className="risky-apps"><strong>{language === "es" ? "Aplicaciones pendientes de revisión" : "Applications awaiting review"}</strong>{device.telemetry.riskyApplications.map(appName => <span className="app-review-row" key={appName}><b>{appName}</b><button disabled={approvingApplication === `${device.id}:${appName}`} onClick={() => void trustApplication(device.id, appName)}>{approvingApplication === `${device.id}:${appName}` ? (language === "es" ? "Guardando…" : "Saving…") : (language === "es" ? "Marcar como confiable" : "Mark as trusted")}</button></span>)}</div>}
          {!!device.telemetry?.unsignedPersistenceItems?.length && <div className="security-findings"><strong>{language === "es" ? "PROGRAMAS DE INICIO SIN FIRMA" : "UNSIGNED STARTUP PROGRAMS"}</strong>{device.telemetry.unsignedPersistenceItems.map(item => <span key={item}><Warning weight="fill" />{item}</span>)}</div>}
          {!!device.telemetry?.trustedApplications?.length && <div className="trusted-apps"><strong>{language === "es" ? "APLICACIONES APROBADAS" : "APPROVED APPLICATIONS"}</strong><span><CheckCircle weight="fill" />{device.telemetry.trustedApplications.join(", ")}</span></div>}
          <div className="enrollment-code"><span>{language === "es" ? "Código de inscripción" : "Enrollment code"}</span><code>{device.enrollmentCode}</code></div>
          {device.status !== "ONLINE" && pageOrigin && <div className="reconnect-box"><p>{device.status === "OFFLINE" ? (language === "es" ? "El agente está inscrito, pero no reporta. Pega este comando en Terminal en tu Mac para reconectar a esta IRIS:" : "The agent is enrolled, but it is not reporting. Paste this command in Terminal on your Mac to reconnect to this IRIS:") : (language === "es" ? "Pega este comando en Terminal en tu Mac e introduce el código de inscripción:" : "Paste this command in Terminal on your Mac and enter the enrollment code:")}</p><code className="reconnect-command">{irisAgentShellCommand(pageOrigin, device.status !== "PENDING")}</code></div>}
          <div className="device-actions">{device.status !== "ONLINE" && <button type="button" className="reconnect-device" onClick={() => void copyReconnectCommand(device)}>{copiedDeviceId === device.id ? <CheckCircle weight="fill" /> : device.status === "OFFLINE" ? <ArrowClockwise weight="bold" /> : <CopySimple weight="bold" />}{copiedDeviceId === device.id ? (language === "es" ? "Comando copiado" : "Command copied") : device.status === "OFFLINE" ? (language === "es" ? "Reconectar Mac" : "Reconnect Mac") : (language === "es" ? "Copiar instalación" : "Copy install command")}</button>}<a href={`/iris-agent-macos.sh?v=${IRIS_AGENT_SCRIPT_VERSION}`} download>{language === "es" ? "Descargar agente cifrado" : "Download encrypted agent"}</a><button onClick={() => void rotateEnrollmentCode(device.id)}>{language === "es" ? "Generar código nuevo" : "Generate new code"}</button><button className="delete-device" disabled={deletingDeviceId === device.id} onClick={() => void deleteDevice(device)}><Trash weight="bold" />{deletingDeviceId === device.id ? (language === "es" ? "Eliminando…" : "Deleting…") : (language === "es" ? "Eliminar dispositivo" : "Delete device")}</button></div>
          <p><Warning weight="fill" />{device.status === "ONLINE" ? (language === "es" ? "Protección real activa. El agente revisa cada 2 minutos." : "Real protection active. The agent checks every 2 minutes.") : device.status === "OFFLINE" ? (language === "es" ? "Alerta: el agente dejó de reportar hace más de 5 minutos. IRIS no puede encenderlo desde el navegador." : "Alert: the agent stopped reporting more than 5 minutes ago. IRIS cannot start it from the browser.") : (language === "es" ? "Instala el agente nuevo para comenzar la protección real." : "Install the new agent to start real protection.")}</p>
        </article>)}{devices.length === 0 && <div className="empty-devices"><Desktop weight="duotone" /><h3>{language === "es" ? "No hay dispositivos conectados" : "No connected devices"}</h3><p>{language === "es" ? "Registra tu Mac e instala el agente para comenzar la protección real." : "Register your Mac and install the agent to begin real protection."}</p></div>}</div>
      </section>}

      {section === "intelligence" && <section className="module-panel intelligence-view">
        <div className="module-toolbar"><div><h2>{t("threatIntelligence")}</h2><p>{language === "es" ? "Indicadores tomados de los reportes reales de tu agente." : "Indicators taken from the real reports of your agent."}</p></div><span className="provenance-badge real">REAL</span></div>
        <div className="intel-metrics"><article><span>{language === "es" ? "Alertas abiertas" : "Open alerts"}</span><strong>{intel.open}</strong><small>{language === "es" ? "del agente" : "from the agent"}</small></article><article><span>{language === "es" ? "Críticas o altas" : "Critical or high"}</span><strong>{intel.critical}</strong><small>{t("hours")}</small></article><article><span>{language === "es" ? "Resueltas" : "Resolved"}</span><strong>{intel.resolved}</strong><small>{t("pastWeek")}</small></article></div>
        <div className="intel-grid"><article><h3>{t("techniques")}</h3>{intel.techniques.length ? intel.techniques.map(item => <div className="technique" key={item.label}><span>{item.label}</span><b>{item.value}</b><i><em style={{width:`${Math.min(100, item.value * 25)}%`}} /></i></div>) : <p className="empty-approvals">{intel.empty}</p>}</article><article className="intel-feed"><h3>{t("latestIndicators")}</h3>{intel.feed.length ? intel.feed.map(item => <p key={item.id}><Warning weight="fill" /><span>{item.label}<small>{relativeTime(item.at, language)}</small></span></p>) : <p className="empty-approvals">{intel.empty}</p>}</article></div>
      </section>}

      {section === "audit" && <section className="module-panel">
        <div className="module-toolbar"><div><h2>{t("immutableAudit")}</h2><p>{t("auditExplain")}</p></div><span className="audit-total">{liveAuditCount} {t("records")}</span></div>
        <div className="audit-table" role="table" aria-label={t("audit")}><div className="audit-table-head" role="row"><span>{t("time")}</span><span>{t("actor")}</span><span>{t("action")}</span><span>{t("resource")}</span><span>{t("outcome")}</span></div>{auditEvents.map(row => <div className="audit-table-row" role="row" key={row.id}><span>{relativeTime(row.createdAt, language)}</span><span>{row.actorEmail}</span><span>{row.action.replaceAll("_"," ")}</span><span>{row.resource}</span><span className="audit-success"><CheckCircle weight="fill" />{row.outcome}</span></div>)}{responseHistory.filter(row => !auditEvents.some(event => event.resource === row.incidentId && event.action.includes(row.action.split("_")[0] || "NONE"))).slice(0,8).map(row=><div className="audit-table-row" role="row" key={`response-${row.id}`}><span>{relativeTime(row.createdAt, language)}</span><span>{row.actorEmail}</span><span>{row.action.replaceAll("_"," ")}</span><span>{row.incidentId}</span><span className="audit-success"><CheckCircle weight="fill" />{row.outcome} · {row.mode}</span></div>)}{auditEvents.length === 0 && responseHistory.length === 0 && <div className="empty-alerts"><LockKey weight="fill" /><h3>{language === "es" ? "Aún no hay eventos reales" : "No live events yet"}</h3></div>}</div>
      </section>}
      {section === "chain" && <IrisChainPanel language={language} isAdmin={user.role === "ADMIN"} />}
      {section === "market" && <IrisMarketPanel language={language} onOpenPurchases={() => setSection("chain")} />}
      <AskIrisPanel section={section} selectedIncident={selectedView} incidents={incidents.map(localized)} devices={devices} userRole={user.role} userName={user.displayName.split(" ")[0]} language={language} />
    </section>
  </main>;
}
