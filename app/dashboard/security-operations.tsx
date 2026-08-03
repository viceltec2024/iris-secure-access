"use client";

import { useMemo, useState } from "react";
import { Bell, ChartLineUp, CheckCircle, Eye, LockKey, Pulse, ShieldCheck, SignOut, Siren, UsersThree, Warning, X } from "@phosphor-icons/react";
import AskIrisPanel from "./ask-iris-panel";
import { incidentSpanish, Language, text } from "./dashboard-i18n";

type Incident = { id: string; title: string; subject: string; severity: "Critical" | "High" | "Medium" | "Low"; status: "Open" | "Investigating" | "Contained"; time: string; source: string; summary: string; cause: string; impact: string; confidence: number; evidence: string[]; actions: string[]; recommendation: string };
type Section = "operations" | "incidents" | "intelligence" | "approvals" | "audit";

const seedIncidents: Incident[] = [
  { id: "IR-1042", title: "Anomalous outbound connection", subject: "10.0.4.25 → 203.0.113.45", severity: "Critical", status: "Open", time: "2 min ago", source: "Network sensor", summary: "Endpoint WS-1025 started an unusual transfer to a destination never seen before. The pattern may indicate data exfiltration or command-and-control traffic.", cause: "Unknown process executed after a privileged login.", impact: "Possible data exposure and remote control of the affected endpoint.", confidence: 94, evidence: ["First-seen destination", "4.8 GB transferred in 11 minutes", "Connection followed privileged login"], actions: ["Isolate WS-1025 from the network", "Block 203.0.113.45", "Preserve memory and logs", "Open a forensic investigation"], recommendation: "Isolate the endpoint, block the destination, and preserve evidence before closing connections or processes." },
  { id: "IR-1041", title: "Suspicious login blocked", subject: "jdoe@agency.gov", severity: "High", status: "Contained", time: "8 min ago", source: "Identity", summary: "An access attempt inconsistent with the user's usual location was blocked after multiple authentication failures.", cause: "Possibly compromised credentials or an automated access attempt.", impact: "The session was blocked; there is no evidence of successful access.", confidence: 89, evidence: ["Impossible travel detected", "Two failed MFA challenges", "Source IP has poor reputation"], actions: ["Revoke active sessions", "Require a password reset", "Verify the user through an approved channel"], recommendation: "Reset active sessions and verify the user's identity before restoring access." },
  { id: "IR-1039", title: "Database activity anomaly", subject: "DB-PROD-01", severity: "High", status: "Investigating", time: "19 min ago", source: "Database", summary: "The database received a query volume far above normal through a service account outside its usual schedule.", cause: "Faulty automation, exposed credential, or undocumented change.", impact: "Risk of bulk data access and service degradation.", confidence: 86, evidence: ["Query volume 6.2× above baseline", "Service account used outside normal hours", "No approved change ticket exists"], actions: ["Temporarily pause the credential", "Capture recent queries", "Compare against deployment records"], recommendation: "Pause the service credential and validate the queries before restoring it." },
  { id: "IR-1036", title: "Privileged access granted", subject: "admin.service@agency.gov", severity: "Medium", status: "Investigating", time: "34 min ago", source: "PAM", summary: "Temporary administrative access was granted to a service account. Approval exists, but the session remains under observation.", cause: "Scheduled elevation for an administrative task.", impact: "Controlled risk while the session remains recorded and within its approved time.", confidence: 78, evidence: ["Temporary admin role granted", "Approval chain complete", "Session recording active"], actions: ["Monitor the session", "Confirm the work ticket", "Revoke privilege at expiration"], recommendation: "Maintain monitoring and confirm ticket closure before resolving the incident." },
  { id: "IR-1032", title: "Policy check completed", subject: "Data Loss Prevention Policy", severity: "Low", status: "Contained", time: "1 hr ago", source: "Compliance", summary: "The DLP assessment completed without critical failures. Two controls produced warnings that require scheduled review.", cause: "Two configurations do not fully meet the recommended level.", impact: "No active impact; a minor compliance gap remains.", confidence: 97, evidence: ["148 controls evaluated", "2 warnings recorded", "No critical failure"], actions: ["Review the two controls", "Assign an owner", "Validate again in the next cycle"], recommendation: "Review the warnings during the next policy cycle." },
];

const severityRank = { Critical: 4, High: 3, Medium: 2, Low: 1 };

export default function SecurityOperations({ user, auditCount, signOutPath }: { user: { email: string; displayName: string; role: string }, auditCount: number, signOutPath: string }) {
  const [language, setLanguage] = useState<Language>(() => typeof window === "undefined" ? "en" : (localStorage.getItem("iris-language") === "es" ? "es" : "en"));
  const [incidents, setIncidents] = useState(seedIncidents);
  const [selected, setSelected] = useState<Incident>(seedIncidents[0]);
  const [filter, setFilter] = useState("All");
  const [lastUpdate, setLastUpdate] = useState("just now");
  const [section, setSection] = useState<Section>("operations");
  const [approvalOpen, setApprovalOpen] = useState(false);
  const [executionNote, setExecutionNote] = useState("");

  const visible = useMemo(() => incidents.filter(i => filter === "All" || i.severity === filter), [incidents, filter]);
  const open = incidents.filter(i => i.status !== "Contained").length;
  const critical = incidents.filter(i => i.severity === "Critical" && i.status !== "Contained").length;
  const risk = Math.min(99, incidents.reduce((sum, i) => sum + (i.status === "Contained" ? 0 : severityRank[i.severity] * 7), 18));
  const t = (key: Parameters<typeof text>[0]) => text(key, language);
  const localized = (incident: Incident): Incident => language === "es" ? { ...incident, ...incidentSpanish[incident.id] } : incident;
  const selectedView = localized(selected);
  const statusLabel = (status: Incident["status"]) => t(status === "Open" ? "statusOpen" : status === "Investigating" ? "statusInvestigating" : "statusContained");
  const changeLanguage = (next: Language) => { setLanguage(next); localStorage.setItem("iris-language", next); };

  function contain() {
    setIncidents(all => all.map(i => i.id === selected.id ? { ...i, status: "Contained" } : i));
    setSelected({ ...selected, status: "Contained" });
    setApprovalOpen(false);
    setExecutionNote(language === "es" ? `Plan aprobado y ejecutado en modo demostración para ${selected.id}. No se modificó ningún equipo real.` : `Plan approved and executed in demo mode for ${selected.id}. No real device was modified.`);
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
        <button className={section === "incidents" ? "active" : ""} onClick={() => setSection("incidents")}><Siren /> {t("incidents")} <b>{open}</b></button>
        <button className={section === "intelligence" ? "active" : ""} onClick={() => setSection("intelligence")}><ChartLineUp /> {t("intelligence")}</button>
        <button className={section === "approvals" ? "active" : ""} onClick={() => setSection("approvals")}><ShieldCheck /> {t("approvals")} <b>{open}</b></button>
        <button className={section === "audit" ? "active" : ""} onClick={() => setSection("audit")}><LockKey /> {t("audit")} <b>{auditCount}</b></button>
        {user.role === "ADMIN" && <a href="/admin/users"><UsersThree /> {t("access")}</a>}
      </nav>
      <div className="soc-user"><span className="avatar">{user.displayName.slice(0,1).toUpperCase()}</span><div><strong>{user.displayName}</strong><small>{user.role}</small></div></div>
    </aside>

    <section className="soc-main">
      <header className="soc-header"><div><p>{t("command")}</p><h1>{{ operations: t("securityOperations"), incidents: t("incidentResponse"), intelligence: t("threatIntelligence"), approvals: t("approvalCenter"), audit: t("audit") }[section]}</h1><span><i /> {t("connected")} · {t("updated")} {lastUpdate}</span></div><div className="header-actions"><div className="language-switch" aria-label="Language"><button className={language === "en" ? "active" : ""} onClick={() => changeLanguage("en")}>EN</button><button className={language === "es" ? "active" : ""} onClick={() => changeLanguage("es")}>ES</button></div><button aria-label="Refresh data" onClick={() => setLastUpdate(t("now"))}><Pulse /></button><button aria-label="Open approvals" onClick={() => setSection("approvals")}><Bell /><b>{open}</b></button><a href={signOutPath}><SignOut /> {t("signOut")}</a></div></header>

      {section === "operations" && <><section className="metric-row">
        <article><span>{t("riskScore")}</span><strong>{risk}<small>/100</small></strong><em className="risk-high">{t("elevated")}</em></article>
        <article><span>{t("openIncidents")}</span><strong>{open}</strong><em>{critical} {t("critical")}</em></article>
        <article><span>{t("protectedAssets")}</span><strong>1,284</strong><em className="healthy">98.7% {t("healthy")}</em></article>
        <article><span>{t("meanResponse")}</span><strong>4m 12s</strong><em className="healthy">↓ 18% {t("today")}</em></article>
      </section>

      <section className="soc-grid">
        <div className="incident-card">
          <div className="card-head"><div><h2>{t("liveActivity")}</h2><p>{t("rankedSignals")}</p></div><div className="filters">{["All","Critical","High","Medium"].map(f => <button className={filter === f ? "active" : ""} onClick={() => setFilter(f)} key={f}>{t((`filter${f}`) as "filterAll")}</button>)}</div></div>
          <div className="incident-list">{visible.map(i => { const v=localized(i); return <button key={i.id} className={`incident-row ${selected.id === i.id ? "selected" : ""}`} onClick={() => selectIncident(i)}><span className={`severity ${i.severity.toLowerCase()}`}><Warning weight="fill" /></span><span className="incident-copy"><strong>{v.title}</strong><small>{i.subject} · {v.source}</small></span><span className={`status ${i.status.toLowerCase()}`}>{statusLabel(i.status)}</span><time>{i.time}</time></button>})}</div>
        </div>

        <aside className="analysis-card">
          <div className="iris-orb"><Eye weight="duotone" /></div><div className="analysis-title"><span>ASK IRIS</span><i>LIVE ANALYSIS</i></div>
          <h2>{selectedView.title}</h2><p className="case-id">{selected.id} · {selected.subject}</p>
          <div className="evidence"><strong>{t("evidence")}</strong>{selectedView.evidence.map(e => <span key={e}><CheckCircle weight="fill" /> {e}</span>)}</div>
          <div className="recommendation"><strong>{t("recommended")}</strong><p>{selectedView.recommendation}</p></div>
          <button className="contain-btn" disabled={selected.status === "Contained"} onClick={() => { setSection("incidents"); setApprovalOpen(true); }}>{selected.status === "Contained" ? <><CheckCircle /> {t("contained")}</> : <><ShieldCheck /> {t("reviewPlan")}</>}</button>
        </aside>
      </section>

      </>}

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

      {approvalOpen && <div className="approval-backdrop" role="presentation" onMouseDown={() => setApprovalOpen(false)}><section className="approval-dialog" role="dialog" aria-modal="true" aria-labelledby="approval-title" onMouseDown={event => event.stopPropagation()}><button className="approval-close" aria-label={t("cancel")} onClick={() => setApprovalOpen(false)}><X /></button><span className="approval-icon"><ShieldCheck weight="duotone" /></span><p>{t("approvalRequired")}</p><h2 id="approval-title">{t("authorize")} {selected.id}</h2><div className="approval-list">{selectedView.actions.map(action=><span key={action}><CheckCircle weight="fill" />{action}</span>)}</div><div className="demo-warning"><Warning weight="fill" /><span><strong>{t("secureConfirmation")}</strong>{t("simulationOnly")}</span></div><div className="approval-actions"><button onClick={() => setApprovalOpen(false)}>{t("cancel")}</button><button onClick={contain}><ShieldCheck /> {t("approveSimulation")}</button></div></section></div>}

      {section === "approvals" && <section className="module-panel approvals-view"><div className="module-toolbar"><div><h2>{t("pendingApprovals")}</h2><p>{t("approvalExplain")}</p></div><span className="audit-total">{open}</span></div><div className="approval-queue">{incidents.filter(i => i.status !== "Contained").map(i => { const v=localized(i); return <article key={i.id}><span className={`severity ${i.severity.toLowerCase()}`}><Warning weight="fill" /></span><div><strong>{v.title}</strong><p>{i.id} · {i.subject}</p><small>{v.actions.length} {language === "es" ? "acciones propuestas" : "proposed actions"}</small></div><button onClick={() => { selectIncident(i); setApprovalOpen(true); }}>{t("review")}</button></article>})}{open === 0 && <p className="empty-approvals"><CheckCircle weight="fill" />{t("noPending")}</p>}</div></section>}

      {section === "intelligence" && <section className="module-panel intelligence-view">
        <div className="module-toolbar"><div><h2>{t("threatIntelligence")}</h2><p>{language === "es" ? "Indicadores actuales, patrones de ataque y tendencias de exposición." : "Current indicators, attack patterns, and exposure trends."}</p></div><span className="live-pill"><i /> {t("liveFeed")}</span></div>
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
        ].map(row=><div className="audit-table-row" role="row" key={row.join("-")}><span>{row[0]}</span><span>{row[1]}</span><span>{row[2].replaceAll("_"," ")}</span><span>{row[3]}</span><span className="audit-success"><CheckCircle weight="fill" />{row[4]}</span></div>)}</div>
      </section>}
      <AskIrisPanel section={section} selectedIncident={selectedView} incidents={incidents.map(localized)} userRole={user.role} language={language} />
    </section>
  </main>;
}
