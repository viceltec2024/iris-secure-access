"use client";

import { useEffect, useMemo, useState } from "react";
import { Bell, ChartLineUp, CheckCircle, Desktop, Eye, LockKey, Plus, Pulse, ShieldCheck, SignOut, Siren, Trash, UsersThree, Warning, X } from "@phosphor-icons/react";
import AskIrisPanel from "./ask-iris-panel";
import { incidentSpanish, Language, text } from "./dashboard-i18n";

type Incident = { id: string; title: string; subject: string; severity: "Critical" | "High" | "Medium" | "Low"; status: "Open" | "Investigating" | "Contained"; time: string; source: string; summary: string; cause: string; impact: string; confidence: number; evidence: string[]; actions: string[]; recommendation: string };
type Section = "operations" | "alerts" | "incidents" | "intelligence" | "devices" | "approvals" | "audit";
type DeviceTelemetry = { hostname?: string; osVersion?: string; architecture?: string; diskUsedPercent?: number; memoryUsedPercent?: number; firewallEnabled?: boolean; gatekeeperEnabled?: boolean; fileVaultEnabled?: boolean; sipEnabled?: boolean; automaticUpdatesEnabled?: boolean; installedApplicationCount?: number; riskyApplications?: string[]; trustedApplications?: string[]; securityFindings?: string[]; changes?: string[]; changeDetectedAt?: string; collectedAt?: string };
type Device = { id: string; name: string; platform: string; status: "PENDING" | "ONLINE" | "OFFLINE"; risk: "UNKNOWN" | "LOW" | "MEDIUM" | "HIGH"; enrollmentCode: string; lastSeenAt: string | null; telemetry: DeviceTelemetry | null; healthScore: number | null; provenance: "REAL" | "UNVERIFIED" };
type ResponseAction = { id: number; incidentId: string; actorEmail: string; action: string; mode: string; outcome: string; createdAt: string };
type SecurityAlert = { id: string; deviceId: string; ownerEmail: string; fingerprint: string; code: string; severity: "CRITICAL" | "HIGH" | "MEDIUM" | "LOW"; status: "NEW" | "ACKNOWLEDGED" | "RESOLVED"; evidence: string; firstSeenAt: string; lastSeenAt: string; resolvedAt: string | null; updatedBy: string | null };

const seedIncidents: Incident[] = [
  { id: "IR-1042", title: "Anomalous outbound connection", subject: "10.0.4.25 → 203.0.113.45", severity: "Critical", status: "Open", time: "2 min ago", source: "Network sensor", summary: "Endpoint WS-1025 started an unusual transfer to a destination never seen before. The pattern may indicate data exfiltration or command-and-control traffic.", cause: "Unknown process executed after a privileged login.", impact: "Possible data exposure and remote control of the affected endpoint.", confidence: 94, evidence: ["First-seen destination", "4.8 GB transferred in 11 minutes", "Connection followed privileged login"], actions: ["Isolate WS-1025 from the network", "Block 203.0.113.45", "Preserve memory and logs", "Open a forensic investigation"], recommendation: "Isolate the endpoint, block the destination, and preserve evidence before closing connections or processes." },
  { id: "IR-1041", title: "Suspicious login blocked", subject: "jdoe@agency.gov", severity: "High", status: "Contained", time: "8 min ago", source: "Identity", summary: "An access attempt inconsistent with the user's usual location was blocked after multiple authentication failures.", cause: "Possibly compromised credentials or an automated access attempt.", impact: "The session was blocked; there is no evidence of successful access.", confidence: 89, evidence: ["Impossible travel detected", "Two failed MFA challenges", "Source IP has poor reputation"], actions: ["Revoke active sessions", "Require a password reset", "Verify the user through an approved channel"], recommendation: "Reset active sessions and verify the user's identity before restoring access." },
  { id: "IR-1039", title: "Database activity anomaly", subject: "DB-PROD-01", severity: "High", status: "Investigating", time: "19 min ago", source: "Database", summary: "The database received a query volume far above normal through a service account outside its usual schedule.", cause: "Faulty automation, exposed credential, or undocumented change.", impact: "Risk of bulk data access and service degradation.", confidence: 86, evidence: ["Query volume 6.2× above baseline", "Service account used outside normal hours", "No approved change ticket exists"], actions: ["Temporarily pause the credential", "Capture recent queries", "Compare against deployment records"], recommendation: "Pause the service credential and validate the queries before restoring it." },
  { id: "IR-1036", title: "Privileged access granted", subject: "admin.service@agency.gov", severity: "Medium", status: "Investigating", time: "34 min ago", source: "PAM", summary: "Temporary administrative access was granted to a service account. Approval exists, but the session remains under observation.", cause: "Scheduled elevation for an administrative task.", impact: "Controlled risk while the session remains recorded and within its approved time.", confidence: 78, evidence: ["Temporary admin role granted", "Approval chain complete", "Session recording active"], actions: ["Monitor the session", "Confirm the work ticket", "Revoke privilege at expiration"], recommendation: "Maintain monitoring and confirm ticket closure before resolving the incident." },
  { id: "IR-1032", title: "Policy check completed", subject: "Data Loss Prevention Policy", severity: "Low", status: "Contained", time: "1 hr ago", source: "Compliance", summary: "The DLP assessment completed without critical failures. Two controls produced warnings that require scheduled review.", cause: "Two configurations do not fully meet the recommended level.", impact: "No active impact; a minor compliance gap remains.", confidence: 97, evidence: ["148 controls evaluated", "2 warnings recorded", "No critical failure"], actions: ["Review the two controls", "Assign an owner", "Validate again in the next cycle"], recommendation: "Review the warnings during the next policy cycle." },
];

export default function SecurityOperations({ user, auditCount, signOutPath }: { user: { email: string; displayName: string; role: string }, auditCount: number, signOutPath: string }) {
  const [language, setLanguage] = useState<Language>(() => typeof window === "undefined" ? "en" : (localStorage.getItem("iris-language") === "es" ? "es" : "en"));
  const [incidents, setIncidents] = useState(seedIncidents);
  const [selected, setSelected] = useState<Incident>(seedIncidents[0]);
  const [filter, setFilter] = useState("All");
  const [lastUpdate, setLastUpdate] = useState("just now");
  const [section, setSection] = useState<Section>("operations");
  const [approvalOpen, setApprovalOpen] = useState(false);
  const [executionNote, setExecutionNote] = useState("");
  const [devices, setDevices] = useState<Device[]>([]);
  const [alerts, setAlerts] = useState<SecurityAlert[]>([]);
  const [responseHistory, setResponseHistory] = useState<ResponseAction[]>([]);
  const [creatingDevice, setCreatingDevice] = useState(false);
  const [deletingDeviceId, setDeletingDeviceId] = useState<string | null>(null);
  const [approvingApplication, setApprovingApplication] = useState<string | null>(null);

  useEffect(() => {
    void fetch("/api/security-state").then(response => response.json()).then((data: { incidents?: { incidentId: string; status: Incident["status"] }[]; devices?: Device[]; actions?: ResponseAction[]; alerts?: SecurityAlert[] }) => {
      if (data.incidents?.length) setIncidents(current => current.map(item => ({ ...item, status: data.incidents?.find(saved => saved.incidentId === item.id)?.status || item.status })));
      if (data.devices) setDevices(data.devices);
      if (data.actions) setResponseHistory(data.actions);
      if (data.alerts) setAlerts(data.alerts);
    }).catch(() => undefined);
  }, []);

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
  const localized = (incident: Incident): Incident => language === "es" ? { ...incident, ...incidentSpanish[incident.id] } : incident;
  const selectedView = localized(selected);
  const statusLabel = (status: Incident["status"]) => t(status === "Open" ? "statusOpen" : status === "Investigating" ? "statusInvestigating" : "statusContained");
  const controlMark = (value: boolean | undefined) => value === undefined ? "—" : value ? "✓" : "⚠";
  const changeLanguage = (next: Language) => { setLanguage(next); localStorage.setItem("iris-language", next); };

  async function decide(decision: "approve" | "reject") {
    const response = await fetch("/api/security-state", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ incidentId: selected.id, decision }) });
    if (!response.ok) { setExecutionNote(language === "es" ? "No se pudo guardar la decisión. Inténtalo nuevamente." : "The decision could not be saved. Please try again."); return; }
    if (decision === "reject") { setApprovalOpen(false); setExecutionNote(language === "es" ? `Plan rechazado para ${selected.id}. No se realizaron cambios.` : `Plan rejected for ${selected.id}. No changes were made.`); return; }
    setIncidents(all => all.map(i => i.id === selected.id ? { ...i, status: "Contained" } : i));
    setSelected({ ...selected, status: "Contained" });
    setApprovalOpen(false);
    setExecutionNote(language === "es" ? `Plan aprobado y ejecutado en modo demostración para ${selected.id}. No se modificó ningún equipo real.` : `Plan approved and executed in demo mode for ${selected.id}. No real device was modified.`);
    setResponseHistory(current => [{ id: Date.now(), incidentId: selected.id, actorEmail: user.email, action: "CONTAIN_INCIDENT", mode: "SIMULATION", outcome: "COMPLETED", createdAt: new Date().toISOString() }, ...current]);
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

  function evidenceFor(alert: SecurityAlert) {
    try { return JSON.parse(alert.evidence) as { hostname?: string; applications?: string[]; collectedAt?: string }; }
    catch { return {}; }
  }

  function selectIncident(incident: Incident) {
    setSelected(incident);
    setExecutionNote("");
    setApprovalOpen(false);
  }

  return <main className="soc-shell">
    <aside className="soc-sidebar">
      <div className="soc-brand"><ShieldCheck weight="duotone" /><div><strong>IRIS</strong><span>SECURITY AI</span></div></div>
      <nav aria-label="IRIS modules">
        <button className={section === "operations" ? "active" : ""} onClick={() => setSection("operations")}><Pulse /> {t("operations")}</button>
        <button className={section === "alerts" ? "active" : ""} onClick={() => setSection("alerts")}><Bell /> {language === "es" ? "Alertas reales" : "Real alerts"} <b>{activeAlerts.length}</b></button>
        <button className={section === "incidents" ? "active" : ""} onClick={() => setSection("incidents")}><Siren /> {t("incidents")} <b>{open}</b></button>
        <button className={section === "intelligence" ? "active" : ""} onClick={() => setSection("intelligence")}><ChartLineUp /> {t("intelligence")}</button>
        <button className={section === "devices" ? "active" : ""} onClick={() => setSection("devices")}><Desktop /> {language === "es" ? "Dispositivos" : "Devices"} <b>{devices.length}</b></button>
        <button className={section === "approvals" ? "active" : ""} onClick={() => setSection("approvals")}><ShieldCheck /> {t("approvals")} <b>{open}</b></button>
        <button className={section === "audit" ? "active" : ""} onClick={() => setSection("audit")}><LockKey /> {t("audit")} <b>{auditCount}</b></button>
        {user.role === "ADMIN" && <a href="/admin/users"><UsersThree /> {t("access")}</a>}
      </nav>
      <div className="soc-user"><span className="avatar">{user.displayName.slice(0,1).toUpperCase()}</span><div><strong>{user.displayName}</strong><small>{user.role}</small></div></div>
    </aside>

    <section className="soc-main">
      <header className="soc-header"><div><p>{t("command")}</p><h1>{{ operations: t("securityOperations"), alerts: language === "es" ? "Centro de alertas reales" : "Real alert center", incidents: t("incidentResponse"), intelligence: t("threatIntelligence"), devices: language === "es" ? "Dispositivos protegidos" : "Protected devices", approvals: t("approvalCenter"), audit: t("audit") }[section]}</h1><span><i /> {t("connected")} · {t("updated")} {lastUpdate}</span></div><div className="header-actions"><div className="language-switch" aria-label="Language"><button className={language === "en" ? "active" : ""} onClick={() => changeLanguage("en")}>EN</button><button className={language === "es" ? "active" : ""} onClick={() => changeLanguage("es")}>ES</button></div><button aria-label="Refresh data" onClick={() => setLastUpdate(t("now"))}><Pulse /></button><button aria-label="Open real alerts" onClick={() => setSection("alerts")}><Bell /><b>{activeAlerts.length}</b></button><a href={signOutPath}><SignOut /> {t("signOut")}</a></div></header>

      {section === "operations" && <><section className="metric-row">
        <article><span>{language === "es" ? "Salud real" : "Real health"}</span><strong>{averageHealth ?? "—"}{averageHealth !== null && <small>/100</small>}</strong><em className={averageHealth === null ? "" : "healthy"}>{averageHealth === null ? (language === "es" ? "NO VERIFICADO" : "UNVERIFIED") : "REAL"}</em></article>
        <article><span>{language === "es" ? "Agentes conectados" : "Connected agents"}</span><strong>{onlineDevices.length}<small>/{devices.length}</small></strong><em>{language === "es" ? "telemetría reciente" : "recent telemetry"}</em></article>
        <article><span>{language === "es" ? "Firewall activo" : "Firewall enabled"}</span><strong>{firewallProtected}<small>/{verifiedDevices.length || "—"}</small></strong><em className={firewallProtected === verifiedDevices.length && verifiedDevices.length ? "healthy" : ""}>REAL</em></article>
        <article><span>{language === "es" ? "Alertas reales activas" : "Active real alerts"}</span><strong>{activeAlerts.length}</strong><em className={activeAlerts.length ? "" : "healthy"}>REAL · {newAlerts.length} {language === "es" ? "nuevas" : "new"}</em></article>
      </section>

      <div className="provenance-legend"><span><b>REAL</b>{language === "es" ? "Reportado por un agente autorizado" : "Reported by an authorized agent"}</span><span><b>SIMULATION</b>{language === "es" ? "Datos de entrenamiento" : "Training data"}</span><span><b>NO VERIFICADO</b>{language === "es" ? "Sin reporte del agente" : "No agent report"}</span></div>

      <section className="soc-grid">
        <div className="incident-card">
          <div className="card-head"><div><h2>{t("liveActivity")} <small className="simulation-badge">SIMULATION</small></h2><p>{t("rankedSignals")}</p></div><div className="filters">{["All","Critical","High","Medium"].map(f => <button className={filter === f ? "active" : ""} onClick={() => setFilter(f)} key={f}>{t((`filter${f}`) as "filterAll")}</button>)}</div></div>
          <div className="incident-list">{visible.map(i => { const v=localized(i); return <button key={i.id} className={`incident-row ${selected.id === i.id ? "selected" : ""}`} onClick={() => selectIncident(i)}><span className={`severity ${i.severity.toLowerCase()}`}><Warning weight="fill" /></span><span className="incident-copy"><strong>{v.title}</strong><small>{i.subject} · {v.source}</small></span><span className={`status ${i.status.toLowerCase()}`}>{statusLabel(i.status)}</span><time>{i.time}</time></button>})}</div>
        </div>

        <aside className="analysis-card">
          <div className="iris-orb"><Eye weight="duotone" /></div><div className="analysis-title"><span>ASK IRIS</span><i>SIMULATION ANALYSIS</i></div>
          <h2>{selectedView.title}</h2><p className="case-id">{selected.id} · {selected.subject}</p>
          <div className="evidence"><strong>{t("evidence")}</strong>{selectedView.evidence.map(e => <span key={e}><CheckCircle weight="fill" /> {e}</span>)}</div>
          <div className="recommendation"><strong>{t("recommended")}</strong><p>{selectedView.recommendation}</p></div>
          <button className="contain-btn" disabled={selected.status === "Contained"} onClick={() => { setSection("incidents"); setApprovalOpen(true); }}>{selected.status === "Contained" ? <><CheckCircle /> {t("contained")}</> : <><ShieldCheck /> {t("reviewPlan")}</>}</button>
        </aside>
      </section>

      </>}

      {section === "alerts" && <section className="module-panel real-alert-center">
        <div className="module-toolbar"><div><h2>{language === "es" ? "Alertas del agente de tu Mac" : "Alerts from your Mac agent"}</h2><p>{language === "es" ? "Solo eventos comprobados por un agente autorizado. Puedes reconocerlos o resolverlos." : "Only events verified by an authorized agent. You can acknowledge or resolve them."}</p></div><span className="provenance-badge real">REAL</span></div>
        <div className="alert-summary"><span><b>{newAlerts.length}</b>{language === "es" ? "Nuevas" : "New"}</span><span><b>{alerts.filter(alert => alert.status === "ACKNOWLEDGED").length}</b>{language === "es" ? "Reconocidas" : "Acknowledged"}</span><span><b>{alerts.filter(alert => alert.status === "RESOLVED").length}</b>{language === "es" ? "Resueltas" : "Resolved"}</span></div>
        <div className="real-alert-list">{alerts.map(alert => { const evidence = evidenceFor(alert); const device = devices.find(item => item.id === alert.deviceId); return <article className={`real-alert-item severity-${alert.severity.toLowerCase()}`} key={alert.id}>
          <span className="alert-icon"><Warning weight="fill" /></span><div className="alert-copy"><div><strong>{alert.code.replaceAll("_", " ")}</strong><span className={`alert-status ${alert.status.toLowerCase()}`}>{alert.status === "NEW" ? (language === "es" ? "NUEVA" : "NEW") : alert.status === "ACKNOWLEDGED" ? (language === "es" ? "RECONOCIDA" : "ACKNOWLEDGED") : (language === "es" ? "RESUELTA" : "RESOLVED")}</span></div><p>{device?.name || evidence.hostname || (language === "es" ? "Dispositivo" : "Device")} · {alert.severity}</p>{!!evidence.applications?.length && <small>{language === "es" ? "Aplicaciones: " : "Applications: "}{evidence.applications.join(", ")}</small>}<time>{language === "es" ? "Última detección" : "Last detected"}: {new Date(alert.lastSeenAt).toLocaleString(language)}</time></div>
          <div className="real-alert-actions">{alert.status === "NEW" && <button onClick={() => void updateAlert(alert.id, "ACKNOWLEDGED")}>{language === "es" ? "Reconocer" : "Acknowledge"}</button>}{alert.status !== "RESOLVED" && <button className="resolve-alert" onClick={() => void updateAlert(alert.id, "RESOLVED")}><CheckCircle />{language === "es" ? "Resolver" : "Resolve"}</button>}</div>
        </article>})}{alerts.length === 0 && <div className="empty-alerts"><CheckCircle weight="fill" /><h3>{language === "es" ? "No hay alertas reales" : "No real alerts"}</h3><p>{language === "es" ? "IRIS mostrará aquí cualquier cambio o amenaza comprobada por el agente." : "IRIS will show any agent-verified change or threat here."}</p></div>}</div>
      </section>}

      {section === "incidents" && <section className="module-panel">
        <div className="module-toolbar"><div><h2>{t("allIncidents")}</h2><p>{t("selectIncident")}</p></div><div className="filters">{["All","Critical","High","Medium"].map(f => <button className={filter === f ? "active" : ""} onClick={() => setFilter(f)} key={f}>{t((`filter${f}`) as "filterAll")}</button>)}</div></div>
        <div className="module-split"><div className="incident-list expanded">{visible.map(i => { const v=localized(i); return <button key={i.id} className={`incident-row ${selected.id === i.id ? "selected" : ""}`} onClick={() => selectIncident(i)}><span className={`severity ${i.severity.toLowerCase()}`}><Warning weight="fill" /></span><span className="incident-copy"><strong>{v.title}</strong><small>{i.id} · {i.subject} · {v.source}</small></span><span className={`status ${i.status.toLowerCase()}`}>{statusLabel(i.status)}</span><time>{i.time}</time></button>})}</div><aside className="module-detail">
          <div className="detail-heading"><span className={`module-severity ${selected.severity.toLowerCase()}`}>{t((`filter${selected.severity}`) as "filterAll")}</span><span className={`status ${selected.status.toLowerCase()}`}>{statusLabel(selected.status)}</span></div>
          <h2>{selectedView.title}</h2><p>{selected.id} · {selected.subject} · {selectedView.source}</p>
          <div className="incident-summary"><strong>{t("whatHappened")}</strong><p>{selectedView.summary}</p></div>
          <div className="detail-facts"><article><span>{t("probableCause")}</span><p>{selectedView.cause}</p></article><article><span>{t("impact")}</span><p>{selectedView.impact}</p></article><article><span>{t("confidence")}</span><b>{selected.confidence}%</b></article></div>
          <h3>{t("evidence")}</h3>{selectedView.evidence.map(e => <span className="detail-line" key={e}><CheckCircle weight="fill" />{e}</span>)}
          <h3>{t("proposedPlan")}</h3><ol className="response-steps">{selectedView.actions.map((action,index)=><li key={action}><b>{index+1}</b><span>{action}</span></li>)}</ol>
          <div className="demo-warning"><Warning weight="fill" /><span><strong>{t("demoMode")}</strong>{t("demoWarning")}</span></div>
          {executionNote && <p className="execution-note"><CheckCircle weight="fill" />{executionNote}</p>}
          <button className="contain-btn" disabled={selected.status === "Contained"} onClick={() => setApprovalOpen(true)}>{selected.status === "Contained" ? t("incidentContained") : t("requestApproval")}</button>
        </aside></div>
      </section>}

      {approvalOpen && <div className="approval-backdrop" role="presentation" onMouseDown={() => setApprovalOpen(false)}><section className="approval-dialog" role="dialog" aria-modal="true" aria-labelledby="approval-title" onMouseDown={event => event.stopPropagation()}><button className="approval-close" aria-label={t("cancel")} onClick={() => setApprovalOpen(false)}><X /></button><span className="approval-icon"><ShieldCheck weight="duotone" /></span><p>{t("approvalRequired")}</p><h2 id="approval-title">{t("authorize")} {selected.id}</h2><div className="approval-list">{selectedView.actions.map(action=><span key={action}><CheckCircle weight="fill" />{action}</span>)}</div><div className="demo-warning"><Warning weight="fill" /><span><strong>{t("secureConfirmation")}</strong>{t("simulationOnly")}</span></div><div className="approval-actions"><button onClick={() => void decide("reject")}>{language === "es" ? "Rechazar" : "Reject"}</button><button onClick={() => void decide("approve")}><ShieldCheck /> {t("approveSimulation")}</button></div></section></div>}

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
            <div><dt>{language === "es" ? "Último reporte" : "Last report"}</dt><dd>{device.lastSeenAt ? new Date(device.lastSeenAt).toLocaleString(language) : (language === "es" ? "Nunca" : "Never")}</dd></div>
          </dl>
          {!!device.telemetry?.changes?.length && <div className="real-alerts"><strong>{language === "es" ? "CAMBIOS DETECTADOS" : "CHANGES DETECTED"}</strong>{device.telemetry.changes.map(change => <span key={change}><Warning weight="fill" />{change.replaceAll("_", " ")}</span>)}</div>}
          {!!device.telemetry?.securityFindings?.length && <div className="security-findings"><strong>{language === "es" ? "ATENCIÓN REQUERIDA" : "ATTENTION REQUIRED"}</strong>{device.telemetry.securityFindings.map(finding => <span key={finding}><Warning weight="fill" />{finding.replaceAll("_", " ")}</span>)}</div>}
          {!!device.telemetry?.riskyApplications?.length && <div className="risky-apps"><strong>{language === "es" ? "Aplicaciones pendientes de revisión" : "Applications awaiting review"}</strong>{device.telemetry.riskyApplications.map(appName => <span className="app-review-row" key={appName}><b>{appName}</b><button disabled={approvingApplication === `${device.id}:${appName}`} onClick={() => void trustApplication(device.id, appName)}>{approvingApplication === `${device.id}:${appName}` ? (language === "es" ? "Guardando…" : "Saving…") : (language === "es" ? "Marcar como confiable" : "Mark as trusted")}</button></span>)}</div>}
          {!!device.telemetry?.trustedApplications?.length && <div className="trusted-apps"><strong>{language === "es" ? "APLICACIONES APROBADAS" : "APPROVED APPLICATIONS"}</strong><span><CheckCircle weight="fill" />{device.telemetry.trustedApplications.join(", ")}</span></div>}
          <div className="enrollment-code"><span>{language === "es" ? "Código de inscripción" : "Enrollment code"}</span><code>{device.enrollmentCode}</code></div>
          <div className="device-actions"><a href="/iris-agent-macos.sh?v=26" download>{language === "es" ? "Descargar agente seguro" : "Download secure agent"}</a><button onClick={() => void rotateEnrollmentCode(device.id)}>{language === "es" ? "Generar código nuevo" : "Generate new code"}</button><button className="delete-device" disabled={deletingDeviceId === device.id} onClick={() => void deleteDevice(device)}><Trash weight="bold" />{deletingDeviceId === device.id ? (language === "es" ? "Eliminando…" : "Deleting…") : (language === "es" ? "Eliminar dispositivo" : "Delete device")}</button></div>
          <p><Warning weight="fill" />{device.status === "ONLINE" ? (language === "es" ? "Protección real activa. El agente revisa cada 2 minutos." : "Real protection active. The agent checks every 2 minutes.") : device.status === "OFFLINE" ? (language === "es" ? "Alerta: el agente dejó de reportar hace más de 5 minutos." : "Alert: the agent stopped reporting more than 5 minutes ago.") : (language === "es" ? "Instala el agente nuevo para comenzar la protección real." : "Install the new agent to start real protection.")}</p>
        </article>)}{devices.length === 0 && <div className="empty-devices"><Desktop weight="duotone" /><h3>{language === "es" ? "No hay dispositivos conectados" : "No connected devices"}</h3><p>{language === "es" ? "Registra tu Mac e instala el agente para comenzar la protección real." : "Register your Mac and install the agent to begin real protection."}</p></div>}</div>
      </section>}

      {section === "intelligence" && <section className="module-panel intelligence-view">
        <div className="module-toolbar"><div><h2>{t("threatIntelligence")}</h2><p>{language === "es" ? "Escenario de entrenamiento; no representa actividad real de tu Mac." : "Training scenario; this is not real activity from your Mac."}</p></div><span className="simulation-badge">SIMULATION</span></div>
        <div className="intel-metrics"><article><span>{t("malicious")}</span><strong>247</strong><small>+18 {t("hours")}</small></article><article><span>{t("campaigns")}</span><strong>6</strong><small>2 {t("sector")}</small></article><article><span>{t("blocked")}</span><strong>1,842</strong><small>{t("pastWeek")}</small></article></div>
        <div className="intel-grid"><article><h3>{t("trend")}</h3><div className="bar-chart" aria-label={t("trend")}>{[38,54,44,71,63,86,58].map((height,index)=><span key={index} style={{height:`${height}%`}}><i>{["M","T","W","T","F","S","S"][index]}</i></span>)}</div></article><article><h3>{t("techniques")}</h3>{(language === "es" ? [["Abuso de credenciales",78],["Mando y control",61],["Extracción de datos",44],["Escalada de privilegios",32]] : [["Credential abuse",78],["Command and control",61],["Data exfiltration",44],["Privilege escalation",32]]).map(([label,value])=><div className="technique" key={label}><span>{label}</span><b>{value}%</b><i><em style={{width:`${value}%`}} /></i></div>)}</article><article className="intel-feed"><h3>{t("latestIndicators")}</h3>{(language === "es" ? ["203.0.113.45 · Mando y control","admin.service · Anomalía de privilegios","DB-PROD-01 · Pico de consultas","WS-1025 · Equipo aislado"] : ["203.0.113.45 · Command & control","admin.service · Privilege anomaly","DB-PROD-01 · Query spike","WS-1025 · Endpoint isolated"]).map((item,index)=><p key={item}><Warning weight="fill" /><span>{item}<small>{index * 7 + 2} min</small></span></p>)}</article></div>
      </section>}

      {section === "audit" && <section className="module-panel">
        <div className="module-toolbar"><div><h2>{t("immutableAudit")}</h2><p>{t("auditExplain")}</p></div><span className="audit-total">{auditCount} {t("records")}</span></div>
        <div className="audit-table" role="table" aria-label={t("audit")}><div className="audit-table-head" role="row"><span>{t("time")}</span><span>{t("actor")}</span><span>{t("action")}</span><span>{t("resource")}</span><span>{t("outcome")}</span></div>{[
          ["Just now",user.email,"SESSION_STARTED","iris_workspace","SUCCESS"],
          ["2 min ago",user.email,"INCIDENT_VIEWED","IR-1042","SUCCESS"],
          ["8 min ago","iris.system","LOGIN_BLOCKED","jdoe@agency.gov","SUCCESS"],
          ["19 min ago","iris.system","ANOMALY_DETECTED","DB-PROD-01","SUCCESS"],
          ["34 min ago","admin.service","PRIVILEGE_GRANTED","PAM-session-82","SUCCESS"],
          ["1 hr ago","iris.system","POLICY_CHECK","DLP-policy","SUCCESS"]
        ].map(row=><div className="audit-table-row" role="row" key={row.join("-")}><span>{row[0]}</span><span>{row[1]}</span><span>{row[2].replaceAll("_"," ")}</span><span>{row[3]}</span><span className="audit-success"><CheckCircle weight="fill" />{row[4]}</span></div>)}{responseHistory.slice(0,8).map(row=><div className="audit-table-row" role="row" key={`response-${row.id}`}><span>{new Date(row.createdAt).toLocaleString(language)}</span><span>{row.actorEmail}</span><span>{row.action.replaceAll("_"," ")}</span><span>{row.incidentId}</span><span className="audit-success"><CheckCircle weight="fill" />{row.outcome}</span></div>)}</div>
      </section>}
      <AskIrisPanel section={section} selectedIncident={selectedView} incidents={incidents.map(localized)} devices={devices} userRole={user.role} userName={user.displayName.split(" ")[0]} language={language} />
    </section>
  </main>;
}
