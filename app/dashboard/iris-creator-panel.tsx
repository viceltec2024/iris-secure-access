"use client";

/* eslint-disable react-hooks/set-state-in-effect -- creator panel polls approved agent heartbeats */
import { useEffect, useState } from "react";
import { CheckCircle, Robot, ShieldCheck, Warning, X } from "@phosphor-icons/react";
import type { Language } from "./dashboard-i18n";
import type { AgentSchedule, CreatedAgent, CreatorDeskState } from "../../lib/iris-creator";
import type { ModelCoordinationReport } from "../../lib/iris-model-registry";

type CreatorDeskResponse = CreatorDeskState & { models?: ModelCoordinationReport };

const emptyDesk: CreatorDeskState = { agents: [] };
const emptyModels: ModelCoordinationReport = { generatedAt: "", coordinators: [], notes: [] };

function statusLabel(status: CreatedAgent["status"], es: boolean) {
  const map: Record<CreatedAgent["status"], [string, string]> = {
    draft: ["Draft", "Borrador"],
    sandbox_passed: ["Sandbox passed", "Sandbox OK"],
    sandbox_failed: ["Sandbox failed", "Sandbox falló"],
    awaiting_approval: ["Awaiting approval", "Espera tu OK"],
    approved: ["Active 24/7", "Activo 24/7"],
    rejected: ["Rejected", "Rechazado"],
    paused: ["Paused", "Pausado"],
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
  const [models, setModels] = useState<ModelCoordinationReport>(emptyModels);
  const [prompt, setPrompt] = useState(es
    ? "Crea una inteligencia artificial especializada en administrar mi tienda Pet Grooming Store"
    : "Create an AI specialized in managing my Pet Grooming Store");
  const [schedule, setSchedule] = useState<AgentSchedule>("always_on");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [pending, setPending] = useState<CreatedAgent | null>(null);

  function applyDesk(payload: CreatorDeskResponse) {
    setDesk({ agents: payload.agents || [] });
    if (payload.models) setModels(payload.models);
  }

  async function refresh() {
    const response = await fetch(`/api/iris-creator?language=${language}`, { cache: "no-store" });
    if (response.ok) applyDesk(await response.json() as CreatorDeskResponse);
  }

  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => void refresh(), 20_000);
    return () => window.clearInterval(timer);
    // Poll Creator desk + model coordination; refresh closes over language.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [language]);

  async function post(body: Record<string, unknown>) {
    setBusy(true);
    setNotice("");
    try {
      const response = await fetch("/api/iris-creator", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...body, language }),
      });
      const payload = await response.json() as CreatorDeskResponse & {
        error?: string;
        created?: CreatedAgent;
        approved?: CreatedAgent;
        proposal?: { id: string; title: string; status: string };
        taskResult?: { ok: boolean; error?: string };
      };
      if (!response.ok) throw new Error(payload.error || "creator");
      applyDesk(payload);
      return payload;
    } catch (error) {
      setNotice(error instanceof Error ? error.message : (es ? "No se pudo procesar el agente." : "The agent could not be processed."));
      return null;
    } finally {
      setBusy(false);
    }
  }

  async function createAgent() {
    const result = await post({ action: "create", prompt, schedule });
    if (!result?.created) return;
    if (result.created.status === "awaiting_approval") {
      setPending(result.created);
      setNotice(es
        ? "Guardian pasó el sandbox. Revisa y aprueba para activarlo."
        : "Guardian passed the sandbox. Review and approve to activate it.");
      return;
    }
    setNotice(es
      ? "Guardian bloqueó el agente. Revisa los hallazgos y prueba otra descripción."
      : "Guardian blocked the agent. Review the findings and try another description.");
  }

  async function confirmApproval() {
    if (!pending) return;
    const result = await post({ action: "approve", agentId: pending.id });
    if (!result?.approved) return;
    setPending(null);
    setNotice(es
      ? `${result.approved.name} quedó activo 24/7 con supervisión. Solo propone acciones preaprobadas.`
      : `${result.approved.name} is active 24/7 under supervision. It only proposes pre-approved actions.`);
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
          <span>{es ? "Sandbox OK" : "Sandbox OK"}</span>
        </div>
        <div className="creator-approve-body">
          <strong>{es ? "Metas" : "Goals"}</strong>
          <ul>{pending.blueprint.goals.map(goal => <li key={goal}>{goal}</li>)}</ul>
          <strong>{es ? "Guardian" : "Guardian"}</strong>
          <ul className="creator-findings">
            {pending.guardian.findings.map(finding => <li key={finding.code} className={finding.severity}>
              <Warning weight="fill" />{finding.message}
            </li>)}
          </ul>
          <strong>{es ? "Código sandbox" : "Sandbox code"}</strong>
          <pre className="creator-source">{pending.sourcePreview.slice(0, 900)}</pre>
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
          <button type="button" className="creator-approve-primary" disabled={busy} autoFocus onClick={() => void confirmApproval()}>
            <CheckCircle />{busy ? (es ? "Activando…" : "Activating…") : (es ? "Aprobar y activar (supervisado)" : "Approve and activate (supervised)")}
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
          ? "Diseña agentes, pruébalos en sandbox con Guardian y actívalos solo con tu aprobación."
          : "Design agents, test them in a Guardian sandbox, and activate them only with your approval."}</p>
      </div>
      <span className="live-pill"><i />CREATOR</span>
    </div>

    <div className="creator-desk">
      <div className="creator-desk-head">
        <div>
          <span>{es ? "CREATOR + GUARDIAN · MVP" : "CREATOR + GUARDIAN · MVP"}</span>
          <h3>{es ? "IRIS diseña. Guardian prueba. Tú apruebas." : "IRIS designs. Guardian tests. You approve."}</h3>
          <p>{es
            ? "Los agentes aprobados pueden operar 24/7 con acciones preaprobadas. Los cambios importantes siguen pidiendo tu OK."
            : "Approved agents can operate 24/7 with pre-approved actions. Important changes still need your OK."}</p>
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
            placeholder={es ? "Ejemplo: administra mi tienda Pet Grooming Store" : "Example: manage my Pet Grooming Store"}
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

      {models.coordinators.length > 0 ? <div className="creator-models">
        <strong>{es ? "Coordinación de modelos (estado real)" : "Model coordination (honest status)"}</strong>
        <div className="creator-model-grid">
          {models.coordinators.map(item => <article key={item.id} className={`creator-model ${item.status}`}>
            <b>{item.label}</b>
            <small>{item.role}</small>
            <span>{item.status.replaceAll("_", " ")}</span>
            <p>{item.detail}</p>
          </article>)}
        </div>
        {models.notes.slice(0, 2).map(note => <p key={note} className="creator-model-note">{note}</p>)}
      </div> : null}

      {waiting.length > 0 && <div className="creator-waiting">
        <strong>{es ? "Guardian espera tu aprobación" : "Guardian is waiting for your approval"}</strong>
        {waiting.map(item => <article key={item.id}>
          <span><Robot /></span>
          <div>
            <b>{item.name}</b>
            <small>{item.blueprint.specialty} · {scheduleLabel(item.schedule, es)}</small>
          </div>
          <button disabled={busy} onClick={() => setPending(item)}>{es ? "Revisar" : "Review"}</button>
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
              <button disabled={busy} onClick={() => void post({ action: "propose_improvement", agentId: item.id, proposalType: "code_improvement" }).then(result => {
                if (result?.proposal) setNotice(es ? `Propuesta lista: ${result.proposal.title}. Requiere tu OK (no aplica cambios al repo).` : `Proposal ready: ${result.proposal.title}. Needs your OK (does not apply repo changes).`);
              })}>{es ? "Proponer código" : "Propose code"}</button>
              <button disabled={busy} onClick={() => void post({ action: "propose_improvement", agentId: item.id, proposalType: "test_plan" }).then(result => {
                if (result?.proposal) setNotice(es ? `Plan de pruebas propuesto. Aún no se ejecutó CI.` : `Test plan proposed. CI was not run.`);
              })}>{es ? "Proponer tests" : "Propose tests"}</button>
              <button disabled={busy} onClick={() => void post({ action: "run_task", agentId: item.id, task: "heartbeat" }).then(result => {
                if (result?.taskResult?.ok) setNotice(es ? "Latido real ejecutado (sin cambios al repo)." : "Real heartbeat ran (no repo changes).");
                else if (result?.taskResult?.error) setNotice(result.taskResult.error);
              })}>{es ? "Latido" : "Heartbeat"}</button>
              <button disabled={busy} onClick={() => void post({ action: "pause", agentId: item.id })}>{es ? "Pausar" : "Pause"}</button>
            </div>
            {(item.proposals || []).filter(proposal => proposal.status === "awaiting_approval").slice(0, 3).map(proposal => <div className="creator-proposal" key={proposal.id}>
              <div>
                <b>{proposal.title}</b>
                <pre>{proposal.body.slice(0, 420)}</pre>
              </div>
              <button disabled={busy} onClick={() => void post({ action: "approve_proposal", agentId: item.id, proposalId: proposal.id }).then(result => {
                if (result) setNotice(es ? "Propuesta aprobada como registro. IRIS no desplegó ni publicó cambios." : "Proposal approved as a record. IRIS did not deploy or publish changes.");
              })}>{es ? "Aprobar propuesta" : "Approve proposal"}</button>
              <button disabled={busy} onClick={() => void post({ action: "reject_proposal", agentId: item.id, proposalId: proposal.id })}>{es ? "Rechazar" : "Reject"}</button>
            </div>)}
          </article>)}
        </div>
        <div>
          <h4>{es ? "Historial" : "History"}</h4>
          {history.length === 0 && <p>{es ? "Aún no hay diseños." : "No designs yet."}</p>}
          {history.map(item => <article className={`creator-history ${item.status}`} key={item.id}>
            <CheckCircle weight="fill" />
            <div>
              <b>{item.name}</b>
              <small>{statusLabel(item.status, es)} · {item.sandbox.passed ? (es ? "sandbox OK" : "sandbox OK") : (es ? "sandbox falló" : "sandbox failed")}</small>
            </div>
          </article>)}
        </div>
      </div>
    </div>
  </section>;
}
