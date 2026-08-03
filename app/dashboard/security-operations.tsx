"use client";

import { useMemo, useState } from "react";
import { Bell, ChartLineUp, CheckCircle, Eye, LockKey, Pulse, ShieldCheck, SignOut, Siren, UsersThree, Warning, X } from "@phosphor-icons/react";
import AskIrisPanel from "./ask-iris-panel";

type Incident = { id: string; title: string; subject: string; severity: "Critical" | "High" | "Medium" | "Low"; status: "Open" | "Investigating" | "Contained"; time: string; source: string; summary: string; cause: string; impact: string; confidence: number; evidence: string[]; actions: string[]; recommendation: string };
type Section = "operations" | "incidents" | "intelligence" | "audit";

const seedIncidents: Incident[] = [
  { id: "IR-1042", title: "Anomalous outbound connection", subject: "10.0.4.25 → 203.0.113.45", severity: "Critical", status: "Open", time: "2 min ago", source: "Network sensor", summary: "El equipo WS-1025 inició una transferencia inusual hacia un destino nunca observado. El patrón puede indicar extracción de datos o comunicación con un servidor de mando y control.", cause: "Proceso desconocido ejecutado después de un inicio de sesión privilegiado.", impact: "Posible exposición de datos y control remoto del equipo afectado.", confidence: 94, evidence: ["Destino observado por primera vez", "4.8 GB transferidos en 11 minutos", "La conexión ocurrió después de un acceso privilegiado"], actions: ["Aislar WS-1025 de la red", "Bloquear 203.0.113.45", "Conservar memoria y registros", "Abrir investigación forense"], recommendation: "Aislar el equipo, bloquear el destino y preservar la evidencia antes de cerrar conexiones o procesos." },
  { id: "IR-1041", title: "Suspicious login blocked", subject: "jdoe@agency.gov", severity: "High", status: "Contained", time: "8 min ago", source: "Identity", summary: "Se bloqueó un intento de acceso incompatible con la ubicación habitual del usuario y con múltiples fallos de autenticación.", cause: "Credenciales posiblemente comprometidas o intento automatizado de acceso.", impact: "La sesión fue bloqueada; no hay evidencia de acceso exitoso.", confidence: 89, evidence: ["Desplazamiento imposible detectado", "Dos desafíos MFA fallidos", "IP de origen con mala reputación"], actions: ["Revocar sesiones activas", "Solicitar cambio de contraseña", "Verificar al usuario por un canal aprobado"], recommendation: "Restablecer las sesiones y verificar la identidad del usuario antes de reactivar el acceso." },
  { id: "IR-1039", title: "Database activity anomaly", subject: "DB-PROD-01", severity: "High", status: "Investigating", time: "19 min ago", source: "Database", summary: "La base de datos recibió un volumen de consultas muy superior al normal mediante una cuenta de servicio fuera de su horario habitual.", cause: "Automatización defectuosa, credencial expuesta o cambio no documentado.", impact: "Riesgo de lectura masiva de información y degradación del servicio.", confidence: 86, evidence: ["Volumen de consultas 6.2× sobre la línea base", "Cuenta utilizada fuera del horario normal", "No existe ticket de cambio aprobado"], actions: ["Pausar temporalmente la credencial", "Capturar las consultas recientes", "Comparar con el registro de despliegues"], recommendation: "Pausar la credencial de servicio y validar las consultas antes de restaurarla." },
  { id: "IR-1036", title: "Privileged access granted", subject: "admin.service@agency.gov", severity: "Medium", status: "Investigating", time: "34 min ago", source: "PAM", summary: "Se otorgó acceso administrativo temporal a una cuenta de servicio. La aprobación existe, pero la sesión continúa bajo observación.", cause: "Elevación programada para realizar una tarea administrativa.", impact: "Riesgo controlado mientras la sesión permanezca grabada y dentro del tiempo autorizado.", confidence: 78, evidence: ["Rol administrativo temporal otorgado", "Cadena de aprobación completa", "Grabación de sesión activa"], actions: ["Vigilar la sesión", "Confirmar el ticket de trabajo", "Revocar el privilegio al vencimiento"], recommendation: "Mantener la supervisión y confirmar el cierre del ticket antes de dar por resuelto el incidente." },
  { id: "IR-1032", title: "Policy check completed", subject: "Data Loss Prevention Policy", severity: "Low", status: "Contained", time: "1 hr ago", source: "Compliance", summary: "La evaluación DLP finalizó sin fallos críticos. Dos controles produjeron advertencias que requieren revisión programada.", cause: "Dos configuraciones no cumplen completamente el nivel recomendado.", impact: "Sin impacto activo; existe una brecha menor de cumplimiento.", confidence: 97, evidence: ["148 controles evaluados", "2 advertencias registradas", "Ningún fallo crítico"], actions: ["Revisar los dos controles", "Asignar responsable", "Validar nuevamente en el próximo ciclo"], recommendation: "Revisar las advertencias durante el siguiente ciclo de políticas." },
];

const severityRank = { Critical: 4, High: 3, Medium: 2, Low: 1 };

export default function SecurityOperations({ user, auditCount, signOutPath }: { user: { email: string; displayName: string; role: string }, auditCount: number, signOutPath: string }) {
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

  function contain() {
    setIncidents(all => all.map(i => i.id === selected.id ? { ...i, status: "Contained" } : i));
    setSelected({ ...selected, status: "Contained" });
    setApprovalOpen(false);
    setExecutionNote(`Plan aprobado y ejecutado en modo demostración para ${selected.id}. No se modificó ningún equipo real.`);
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
        <button className={section === "operations" ? "active" : ""} onClick={() => setSection("operations")}><Pulse /> Operations</button>
        <button className={section === "incidents" ? "active" : ""} onClick={() => setSection("incidents")}><Siren /> Incidents <b>{open}</b></button>
        <button className={section === "intelligence" ? "active" : ""} onClick={() => setSection("intelligence")}><ChartLineUp /> Intelligence</button>
        <button className={section === "audit" ? "active" : ""} onClick={() => setSection("audit")}><LockKey /> Audit log <b>{auditCount}</b></button>
        {user.role === "ADMIN" && <a href="/admin/users"><UsersThree /> Access control</a>}
      </nav>
      <div className="soc-user"><span className="avatar">{user.displayName.slice(0,1).toUpperCase()}</span><div><strong>{user.displayName}</strong><small>{user.role}</small></div></div>
    </aside>

    <section className="soc-main">
      <header className="soc-header"><div><p>IRIS COMMAND CENTER</p><h1>{{ operations: "Security operations", incidents: "Incident response", intelligence: "Threat intelligence", audit: "Audit log" }[section]}</h1><span><i /> All systems connected · Updated {lastUpdate}</span></div><div className="header-actions"><button aria-label="Refresh data" onClick={() => setLastUpdate("just now")}><Pulse /></button><button aria-label="Open incidents" onClick={() => setSection("incidents")}><Bell /><b>{open}</b></button><a href={signOutPath}><SignOut /> Sign out</a></div></header>

      {section === "operations" && <><section className="metric-row">
        <article><span>Risk score</span><strong>{risk}<small>/100</small></strong><em className="risk-high">Elevated</em></article>
        <article><span>Open incidents</span><strong>{open}</strong><em>{critical} critical</em></article>
        <article><span>Protected assets</span><strong>1,284</strong><em className="healthy">98.7% healthy</em></article>
        <article><span>Mean response</span><strong>4m 12s</strong><em className="healthy">↓ 18% today</em></article>
      </section>

      <section className="soc-grid">
        <div className="incident-card">
          <div className="card-head"><div><h2>Live security activity</h2><p>Correlated signals ranked by operational risk</p></div><div className="filters">{["All","Critical","High","Medium"].map(f => <button className={filter === f ? "active" : ""} onClick={() => setFilter(f)} key={f}>{f}</button>)}</div></div>
          <div className="incident-list">{visible.map(i => <button key={i.id} className={`incident-row ${selected.id === i.id ? "selected" : ""}`} onClick={() => selectIncident(i)}><span className={`severity ${i.severity.toLowerCase()}`}><Warning weight="fill" /></span><span className="incident-copy"><strong>{i.title}</strong><small>{i.subject} · {i.source}</small></span><span className={`status ${i.status.toLowerCase()}`}>{i.status}</span><time>{i.time}</time></button>)}</div>
        </div>

        <aside className="analysis-card">
          <div className="iris-orb"><Eye weight="duotone" /></div><div className="analysis-title"><span>ASK IRIS</span><i>LIVE ANALYSIS</i></div>
          <h2>{selected.title}</h2><p className="case-id">{selected.id} · {selected.subject}</p>
          <div className="evidence"><strong>Correlated evidence</strong>{selected.evidence.map(e => <span key={e}><CheckCircle weight="fill" /> {e}</span>)}</div>
          <div className="recommendation"><strong>Recommended response</strong><p>{selected.recommendation}</p></div>
          <button className="contain-btn" disabled={selected.status === "Contained"} onClick={() => { setSection("incidents"); setApprovalOpen(true); }}>{selected.status === "Contained" ? <><CheckCircle /> Contained</> : <><ShieldCheck /> Review response plan</>}</button>
        </aside>
      </section>

      </>}

      {section === "incidents" && <section className="module-panel">
        <div className="module-toolbar"><div><h2>Todos los incidentes</h2><p>Selecciona un incidente para ver el análisis, la evidencia y aprobar su corrección.</p></div><div className="filters">{["All","Critical","High","Medium"].map(f => <button className={filter === f ? "active" : ""} onClick={() => setFilter(f)} key={f}>{f}</button>)}</div></div>
        <div className="module-split"><div className="incident-list expanded">{visible.map(i => <button key={i.id} className={`incident-row ${selected.id === i.id ? "selected" : ""}`} onClick={() => selectIncident(i)}><span className={`severity ${i.severity.toLowerCase()}`}><Warning weight="fill" /></span><span className="incident-copy"><strong>{i.title}</strong><small>{i.id} · {i.subject} · {i.source}</small></span><span className={`status ${i.status.toLowerCase()}`}>{i.status}</span><time>{i.time}</time></button>)}</div><aside className="module-detail">
          <div className="detail-heading"><span className={`module-severity ${selected.severity.toLowerCase()}`}>{selected.severity}</span><span className={`status ${selected.status.toLowerCase()}`}>{selected.status}</span></div>
          <h2>{selected.title}</h2><p>{selected.id} · {selected.subject} · {selected.source}</p>
          <div className="incident-summary"><strong>¿Qué ocurrió?</strong><p>{selected.summary}</p></div>
          <div className="detail-facts"><article><span>Causa probable</span><p>{selected.cause}</p></article><article><span>Impacto</span><p>{selected.impact}</p></article><article><span>Confianza de IRIS</span><b>{selected.confidence}%</b></article></div>
          <h3>Evidencia correlacionada</h3>{selected.evidence.map(e => <span className="detail-line" key={e}><CheckCircle weight="fill" />{e}</span>)}
          <h3>Plan que IRIS propone ejecutar</h3><ol className="response-steps">{selected.actions.map((action,index)=><li key={action}><b>{index+1}</b><span>{action}</span></li>)}</ol>
          <div className="demo-warning"><Warning weight="fill" /><span><strong>Modo de prueba</strong>Estas acciones se simulan. IRIS no tiene conexión con tu computadora, firewall o directorio de usuarios.</span></div>
          {executionNote && <p className="execution-note"><CheckCircle weight="fill" />{executionNote}</p>}
          <button className="contain-btn" disabled={selected.status === "Contained"} onClick={() => setApprovalOpen(true)}>{selected.status === "Contained" ? "Incidente contenido" : "Solicitar mi aprobación"}</button>
        </aside></div>
      </section>}

      {approvalOpen && <div className="approval-backdrop" role="presentation" onMouseDown={() => setApprovalOpen(false)}><section className="approval-dialog" role="dialog" aria-modal="true" aria-labelledby="approval-title" onMouseDown={event => event.stopPropagation()}><button className="approval-close" aria-label="Cerrar" onClick={() => setApprovalOpen(false)}><X /></button><span className="approval-icon"><ShieldCheck weight="duotone" /></span><p>APROBACIÓN REQUERIDA</p><h2 id="approval-title">Autorizar respuesta para {selected.id}</h2><div className="approval-list">{selected.actions.map(action=><span key={action}><CheckCircle weight="fill" />{action}</span>)}</div><div className="demo-warning"><Warning weight="fill" /><span><strong>Confirmación segura</strong>En esta etapa de prueba solo se actualizará el estado dentro de IRIS. No se ejecutarán cambios en sistemas reales.</span></div><div className="approval-actions"><button onClick={() => setApprovalOpen(false)}>Cancelar</button><button onClick={contain}><ShieldCheck /> Aprobar y ejecutar simulación</button></div></section></div>}

      {section === "intelligence" && <section className="module-panel intelligence-view">
        <div className="module-toolbar"><div><h2>Threat intelligence</h2><p>Current indicators, attack patterns, and exposure trends.</p></div><span className="live-pill"><i /> LIVE FEED</span></div>
        <div className="intel-metrics"><article><span>Malicious indicators</span><strong>247</strong><small>+18 in 24 hours</small></article><article><span>Active campaigns</span><strong>6</strong><small>2 target your sector</small></article><article><span>Blocked connections</span><strong>1,842</strong><small>Past 7 days</small></article></div>
        <div className="intel-grid"><article><h3>Threat activity trend</h3><div className="bar-chart" aria-label="Threat activity over seven days">{[38,54,44,71,63,86,58].map((height,index)=><span key={index} style={{height:`${height}%`}}><i>{["M","T","W","T","F","S","S"][index]}</i></span>)}</div></article><article><h3>Top observed techniques</h3>{[["Credential abuse",78],["Command and control",61],["Data exfiltration",44],["Privilege escalation",32]].map(([label,value])=><div className="technique" key={label}><span>{label}</span><b>{value}%</b><i><em style={{width:`${value}%`}} /></i></div>)}</article><article className="intel-feed"><h3>Latest indicators</h3>{["203.0.113.45 · Command & control","admin.service · Privilege anomaly","DB-PROD-01 · Query spike","WS-1025 · Endpoint isolated"].map((item,index)=><p key={item}><Warning weight="fill" /><span>{item}<small>{index * 7 + 2} min ago</small></span></p>)}</article></div>
      </section>}

      {section === "audit" && <section className="module-panel">
        <div className="module-toolbar"><div><h2>Immutable audit trail</h2><p>Authentication, investigation, and response actions recorded by IRIS.</p></div><span className="audit-total">{auditCount} records</span></div>
        <div className="audit-table" role="table" aria-label="Audit activity"><div className="audit-table-head" role="row"><span>Time</span><span>Actor</span><span>Action</span><span>Resource</span><span>Outcome</span></div>{[
          ["Just now",user.email,"SESSION_STARTED","iris_workspace","SUCCESS"],
          ["2 min ago",user.email,"INCIDENT_VIEWED","IR-1042","SUCCESS"],
          ["8 min ago","iris.system","LOGIN_BLOCKED","jdoe@agency.gov","SUCCESS"],
          ["19 min ago","iris.system","ANOMALY_DETECTED","DB-PROD-01","SUCCESS"],
          ["34 min ago","admin.service","PRIVILEGE_GRANTED","PAM-session-82","SUCCESS"],
          ["1 hr ago","iris.system","POLICY_CHECK","DLP-policy","SUCCESS"]
        ].map(row=><div className="audit-table-row" role="row" key={row.join("-")}><span>{row[0]}</span><span>{row[1]}</span><span>{row[2].replaceAll("_"," ")}</span><span>{row[3]}</span><span className="audit-success"><CheckCircle weight="fill" />{row[4]}</span></div>)}</div>
      </section>}
      <AskIrisPanel section={section} selectedIncident={selected} incidents={incidents} userRole={user.role} />
    </section>
  </main>;
}
