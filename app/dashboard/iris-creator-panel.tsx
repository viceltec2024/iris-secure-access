"use client";

/* eslint-disable react-hooks/set-state-in-effect -- creator panel polls approved agent heartbeats */
import { useEffect, useState } from "react";
import { CheckCircle, Robot, ShieldCheck, Warning, X } from "@phosphor-icons/react";
import type { Language } from "./dashboard-i18n";
import { ALLOWED_CREATOR_TOOLS, type AgentSchedule, type CreatedAgent, type CreatorDeskState } from "../../lib/iris-creator";

const emptyDesk: CreatorDeskState = { agents: [] };

function statusLabel(status: CreatedAgent["status"], es: boolean) {
  const map: Record<CreatedAgent["status"], [string, string]> = {
    draft: ["Draft", "Borrador"],
    sandbox_passed: ["Sandbox passed", "Sandbox OK"],
    sandbox_failed: ["Sandbox failed", "Sandbox falló"],
    awaiting_approval: ["Awaiting approval", "Espera tu OK"],
    approved: ["Active 24/7", "Activo 24/7"],
    rejected: ["Rejected", "Rechazado"],
    paused: ["Paused", "Pausado"],
    stopped: ["Emergency stop", "Detenido"],
  };
  return map[status][es ? 1 : 0];
}

function scheduleLabel(schedule: AgentSchedule, es: boolean) {
  if (schedule === "always_on") return es ? "24/7 supervisado" : "24/7 supervised";
  if (schedule === "business_hours") return es ? "Horario laboral" : "Business hours";
  return es ? "Bajo demanda" : "On demand";
}

export default function IrisCreatorPanel({ language }: { language: Language }) {
  const es = language === "es";
  const [desk, setDesk] = useState<CreatorDeskState>(emptyDesk);
  const [prompt, setPrompt] = useState(es
    ? "IRIS, crea un agente que administre las tareas de marketing de Pet Grooming Store."
    : "IRIS, create an agent that manages marketing tasks for Pet Grooming Store.");
  const [schedule, setSchedule] = useState<AgentSchedule>("always_on");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [pending, setPending] = useState<CreatedAgent | null>(null);
  const [editTools, setEditTools] = useState<string[]>([]);

  async function refresh() {
    const response = await fetch("/api/iris-creator", { cache: "no-store" });
    if (response.ok) setDesk(await response.json() as CreatorDeskState);
  }

  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => void refresh(), 20_000);
    return () => window.clearInterval(timer);
  }, []);

  async function post(body: Record<string, unknown>) {
    setBusy(true);
    setNotice("");
    try {
      const response = await fetch("/api/iris-creator", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...body, language }),
      });
      const payload = await response.json() as CreatorDeskState & {
        error?: string;
        created?: CreatedAgent;
        approved?: CreatedAgent;
        updated?: CreatedAgent;
      };
      if (!response.ok) throw new Error(payload.error || "creator");
      setDesk(payload);
      return payload;
    } catch (error) {
      setNotice(error instanceof Error ? error.message : (es ? "No se pudo procesar el agente." : "The agent could not be processed."));
      return null;
    } finally {
      setBusy(false);
    }
  }

  function openReview(agent: CreatedAgent) {
    setPending(agent);
    setEditTools(agent.blueprint.tools.slice());
  }

  async function createAgent() {
    const result = await post({ action: "create", prompt, schedule });
    if (!result?.created) return;
    if (result.created.status === "awaiting_approval") {
      openReview(result.created);
      setNotice(es
        ? "Guardian pasó el sandbox. Revisa herramientas, código y aprueba."
        : "Guardian passed the sandbox. Review tools, code, and approve.");
      return;
    }
    setNotice(es
      ? "Guardian bloqueó el agente. Revisa los hallazgos y prueba otra descripción."
      : "Guardian blocked the agent. Review the findings and try another description.");
  }

  async function saveTools() {
    if (!pending) return;
    const result = await post({ action: "update_tools", agentId: pending.id, tools: editTools });
    if (!result?.updated) return;
    if (result.updated.status === "awaiting_approval") openReview(result.updated);
    else setPending(result.updated);
    setNotice(es ? "Herramientas actualizadas y sandbox reejecutado." : "Tools updated and sandbox re-run.");
  }

  async function confirmApproval() {
    if (!pending) return;
    const result = await post({ action: "approve", agentId: pending.id });
    if (!result?.approved) return;
    setPending(null);
    setNotice(es
      ? `${result.approved.name} quedó activo 24/7 con supervisión.`
      : `${result.approved.name} is active 24/7 under supervision.`);
  }

  const waiting = desk.agents.filter(item => item.status === "awaiting_approval");
  const active = desk.agents.filter(item => item.status === "approved");
  const history = desk.agents.filter(item => item.status !== "awaiting_approval").slice(0, 8);

  return <section className="module-panel iris-creator-panel">
    {pending && <div className="approval-backdrop" role="presentation">
      <section className="approval-dialog creator-approve-dialog" role="dialog" aria-modal="true" aria-labelledby="creator-approve-title">
        <button className="approval-close" aria-label={es ? "Cerrar" : "Close"} onClick={() => setPending(null)}><X /></button>
        <span className="approval-icon"><ShieldCheck weight="duotone" /></span>
        <p>{es ? "IRIS GUARDIAN · APROBACIÓN REQUERIDA" : "IRIS GUARDIAN · APPROVAL REQUIRED"}</p>
        <h2 id="creator-approve-title">{pending.name}</h2>
        <div className="token-deploy-summary">
          <span><b>{pending.blueprint.specialty}</b></span>
          <span>{scheduleLabel(pending.schedule, es)}</span>
          <span>{pending.sandbox.passed ? "Sandbox OK" : (es ? "Sandbox falló" : "Sandbox failed")}</span>
        </div>
        <div className="creator-approve-body">
          <strong>{es ? "Herramientas autorizadas" : "Authorized tools"}</strong>
          <div className="creator-tools">
            {ALLOWED_CREATOR_TOOLS.map(tool => <label key={tool}>
              <input
                type="checkbox"
                checked={editTools.includes(tool)}
                onChange={event => setEditTools(current => event.target.checked ? [...current, tool] : current.filter(item => item !== tool))}
              />
              <span>{tool}</span>
            </label>)}
          </div>
          <button type="button" className="creator-tools-save" disabled={busy || editTools.length === 0} onClick={() => void saveTools()}>
            {es ? "Guardar tools y re-probar" : "Save tools and re-test"}
          </button>
          <strong>{es ? "Metas" : "Goals"}</strong>
          <ul>{pending.blueprint.goals.map(goal => <li key={goal}>{goal}</li>)}</ul>
          <strong>{es ? "Resultados sandbox" : "Sandbox results"}</strong>
          <ul className="creator-findings">
            {pending.sandbox.checks.map(check => <li key={check.id} className={check.ok ? "info" : "block"}>
              <Warning weight="fill" />{check.label}: {check.detail}
            </li>)}
          </ul>
          <strong>{es ? "Guardian" : "Guardian"}</strong>
          <ul className="creator-findings">
            {pending.guardian.findings.map(finding => <li key={finding.code} className={finding.severity}>
              <Warning weight="fill" />{finding.message}
            </li>)}
          </ul>
          <strong>{es ? "Código generado" : "Generated code"}</strong>
          <pre className="creator-source">{pending.sourcePreview.slice(0, 700)}</pre>
          <strong>{es ? "Pruebas generadas" : "Generated tests"}</strong>
          <pre className="creator-source">{(pending.testPreview || "").slice(0, 700)}</pre>
        </div>
        <div className="token-gas-warning">
          <Warning weight="fill" />
          <span>
            <strong>{es ? "IRIS no despliega sola" : "IRIS does not deploy alone"}</strong>
            {es
              ? " Al aprobar, el agente puede trabajar 24/7 con permisos mínimos. No gasta dinero, no ejecuta shell y no cambia el núcleo sin otra autorización."
              : " On approval, the agent may work 24/7 with least privilege. It does not spend money, run shell, or change the core without another authorization."}
          </span>
        </div>
        <div className="approval-actions">
          <button type="button" className="creator-approve-primary" disabled={busy || !pending.sandbox.passed} autoFocus onClick={() => void confirmApproval()}>
            <CheckCircle />{busy ? (es ? "Activando…" : "Activating…") : (es ? "Aprobar e implementar" : "Approve and deploy")}
          </button>
          <button type="button" disabled={busy} onClick={() => void post({ action: "reject", agentId: pending.id }).then(result => { if (result) setPending(null); })}>
            {es ? "Rechazar" : "Reject"}
          </button>
        </div>
      </section>
    </div>}

    <div className="module-toolbar">
      <div>
        <h2>IRIS Creator</h2>
        <p>{es
          ? "Diseña agentes, edita tools, prueba en sandbox con Guardian y activa solo con tu OK."
          : "Design agents, edit tools, test in a Guardian sandbox, and activate only with your OK."}</p>
      </div>
      <span className="live-pill"><i />CREATOR</span>
    </div>

    <div className="creator-desk">
      <div className="creator-desk-head">
        <div>
          <span>{es ? "CREATOR + GUARDIAN · FASE 1" : "CREATOR + GUARDIAN · PHASE 1"}</span>
          <h3>{es ? "IRIS diseña. Guardian prueba. Tú apruebas." : "IRIS designs. Guardian tests. You approve."}</h3>
          <p>{es
            ? "MVP local: especificación, tools editables, código/pruebas, sandbox, aprobación, pause/stop/delete. Backend FastAPI en platform/iris-api."
            : "Local MVP: specification, editable tools, code/tests, sandbox, approval, pause/stop/delete. FastAPI backend in platform/iris-api."}</p>
        </div>
        <div className="creator-stats">
          <article><span>{es ? "Activos" : "Active"}</span><strong>{active.length}</strong></article>
          <article><span>{es ? "Pendientes" : "Pending"}</span><strong>{waiting.length}</strong></article>
        </div>
      </div>

      <form className="creator-composer" onSubmit={event => { event.preventDefault(); void createAgent(); }}>
        <label className="creator-prompt">
          <span>{es ? "Describe el agente" : "Describe the agent"}</span>
          <textarea
            value={prompt}
            onChange={event => setPrompt(event.target.value)}
            rows={3}
            maxLength={500}
            placeholder={es ? "Ejemplo: marketing de Pet Grooming Store" : "Example: marketing for Pet Grooming Store"}
          />
        </label>
        <label>
          <span>{es ? "Horario" : "Schedule"}</span>
          <select value={schedule} onChange={event => setSchedule(event.target.value as AgentSchedule)}>
            <option value="always_on">{es ? "24 horas / supervisado" : "24 hours / supervised"}</option>
            <option value="business_hours">{es ? "Horario laboral" : "Business hours"}</option>
            <option value="on_demand">{es ? "Bajo demanda" : "On demand"}</option>
          </select>
        </label>
        <button type="submit" disabled={busy || prompt.trim().length < 8}>
          <Robot />{busy ? (es ? "Diseñando…" : "Designing…") : (es ? "Crear agente" : "Create agent")}
        </button>
      </form>

      {notice && <p className="creator-notice">{notice}</p>}

      {waiting.length > 0 && <div className="creator-waiting">
        <strong>{es ? "Guardian espera tu aprobación" : "Guardian is waiting for your approval"}</strong>
        {waiting.map(item => <article key={item.id}>
          <span><Robot /></span>
          <div>
            <b>{item.name}</b>
            <small>{item.blueprint.specialty} · {scheduleLabel(item.schedule, es)}</small>
          </div>
          <button disabled={busy} onClick={() => openReview(item)}>{es ? "Revisar" : "Review"}</button>
          <button disabled={busy} onClick={() => void post({ action: "reject", agentId: item.id })}>{es ? "Rechazar" : "Reject"}</button>
        </article>)}
      </div>}

      <div className="creator-columns">
        <div>
          <h4>{es ? "Agentes activos" : "Active agents"}</h4>
          {active.length === 0 && <p>{es ? "Ninguno activo todavía." : "None active yet."}</p>}
          {active.map(item => <article className="creator-card" key={item.id}>
            <div>
              <b>{item.name}</b>
              <small>{scheduleLabel(item.schedule, es)} · {item.lastTickAt ? (es ? `latido ${new Date(item.lastTickAt).toLocaleTimeString(language)}` : `tick ${new Date(item.lastTickAt).toLocaleTimeString(language)}`) : (es ? "sin latido" : "no tick")}</small>
            </div>
            <div className="creator-card-actions">
              <button disabled={busy} onClick={() => void post({ action: "pause", agentId: item.id })}>{es ? "Pausar" : "Pause"}</button>
              <button disabled={busy} onClick={() => void post({ action: "emergency_stop", agentId: item.id })}>{es ? "Detener" : "Stop"}</button>
              <button disabled={busy} onClick={() => void post({ action: "delete", agentId: item.id })}>{es ? "Eliminar" : "Delete"}</button>
            </div>
          </article>)}
        </div>
        <div>
          <h4>{es ? "Historial" : "History"}</h4>
          {history.length === 0 && <p>{es ? "Aún no hay diseños." : "No designs yet."}</p>}
          {history.map(item => <article className={`creator-history ${item.status}`} key={item.id}>
            <CheckCircle weight="fill" />
            <div>
              <b>{item.name}</b>
              <small>{statusLabel(item.status, es)} · {item.sandbox.passed ? "sandbox OK" : (es ? "sandbox falló" : "sandbox failed")} · {(item.blueprint.tools || []).length} tools</small>
            </div>
            {(item.status === "paused" || item.status === "stopped" || item.status === "rejected") && <button disabled={busy} onClick={() => void post({ action: "delete", agentId: item.id })}>{es ? "Eliminar" : "Delete"}</button>}
          </article>)}
        </div>
      </div>
    </div>
  </section>;
}
