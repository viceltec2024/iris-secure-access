"use client";

/* eslint-disable react-hooks/set-state-in-effect -- mission panel loads desk + scorecard on mount/language */
import { useEffect, useState } from "react";
import { CheckCircle, Flag, ShieldCheck, Warning } from "@phosphor-icons/react";
import type { Language } from "./dashboard-i18n";
import type { MissionDesk, MissionRecord } from "../../lib/iris-mission";
import type { EvalRunReport } from "../../lib/iris-evals";
import type { PriorityCapability } from "../../lib/iris-capability-audit";
import { classifyLabel } from "../../lib/iris-capability-audit";

type Scorecard = {
  verifiedPercent: number;
  proven: number;
  partial: number;
  missing: number;
  total: number;
};

export default function IrisMissionPanel({ language }: { language: Language }) {
  const es = language === "es";
  const [desk, setDesk] = useState<MissionDesk>({ missions: [] });
  const [objective, setObjective] = useState(es
    ? "Auditar la postura de seguridad y proponer un agente de seguimiento SOC"
    : "Audit security posture and propose a SOC follow-up agent");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [scorecard, setScorecard] = useState<Scorecard | null>(null);
  const [capabilities, setCapabilities] = useState<PriorityCapability[]>([]);
  const [lastEval, setLastEval] = useState<EvalRunReport | null>(null);

  async function refresh() {
    const [missionRes, evalRes] = await Promise.all([
      fetch("/api/iris-mission", { cache: "no-store" }),
      fetch(`/api/iris-evals?language=${language}`, { cache: "no-store" }),
    ]);
    if (missionRes.ok) setDesk(await missionRes.json() as MissionDesk);
    if (evalRes.ok) {
      const payload = await evalRes.json() as { scorecard: Scorecard; capabilities: PriorityCapability[] };
      setScorecard(payload.scorecard);
      setCapabilities(payload.capabilities || []);
    }
  }

  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [language]);

  async function startMission() {
    setBusy(true);
    setNotice("");
    try {
      const response = await fetch("/api/iris-mission", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "start", objective, language }),
      });
      const payload = await response.json() as MissionDesk & { error?: string; started?: MissionRecord };
      if (!response.ok) throw new Error(payload.error || "mission");
      setDesk(payload);
      setNotice(payload.started?.result?.summary || (es ? "Misión creada." : "Mission created."));
    } catch (error) {
      setNotice(error instanceof Error ? error.message : (es ? "No se pudo iniciar la misión." : "Could not start mission."));
    } finally {
      setBusy(false);
    }
  }

  async function decide(missionId: string, action: "approve" | "reject" | "cancel") {
    setBusy(true);
    try {
      const response = await fetch("/api/iris-mission", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action, missionId, language }),
      });
      const payload = await response.json() as MissionDesk & { error?: string };
      if (!response.ok) throw new Error(payload.error || "mission");
      setDesk(payload);
      setNotice(action === "approve"
        ? (es ? "Informe aceptado por humano. La verificación por evidencia es independiente." : "Report accepted by human. Evidence verification is independent.")
        : action === "cancel"
          ? (es ? "Misión cancelada." : "Mission cancelled.")
          : (es ? "Misión rechazada." : "Mission rejected."));
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "error");
    } finally {
      setBusy(false);
    }
  }

  async function runEvals() {
    setBusy(true);
    setNotice("");
    try {
      const response = await fetch("/api/iris-evals", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "run", language }),
      });
      const payload = await response.json() as { error?: string; report?: EvalRunReport; scorecard?: Scorecard };
      if (!response.ok) throw new Error(payload.error || "evals");
      if (payload.report) setLastEval(payload.report);
      if (payload.scorecard) setScorecard(payload.scorecard);
      setNotice(es
        ? `Evaluación: ${payload.report?.summary.passed}/${payload.report?.summary.total} OK (${payload.report?.summary.passRate}%).`
        : `Evaluation: ${payload.report?.summary.passed}/${payload.report?.summary.total} OK (${payload.report?.summary.passRate}%).`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "evals");
    } finally {
      setBusy(false);
    }
  }

  const waiting = desk.missions.filter(item => ["executed", "awaiting_approval", "verified"].includes(item.status));

  return <section className="module-panel iris-mission-panel">
    <div className="module-toolbar">
      <div>
        <h2>{es ? "IRIS Mission + Evals" : "IRIS Mission + Evals"}</h2>
        <p>{es
          ? "Objetivo → plan → cola → policy sandbox → verificación humana. Sin contenedor/VM ni auto-modificar IRIS."
          : "Objective → plan → queue → policy sandbox → human verification. No container/VM and no IRIS self-modification."}</p>
      </div>
      <button type="button" className="add-device" disabled={busy} onClick={() => void runEvals()}>
        <ShieldCheck />{busy ? (es ? "Evaluando…" : "Evaluating…") : (es ? "Correr evaluaciones" : "Run evaluations")}
      </button>
    </div>

    {scorecard && <div className="mission-scorecard">
      <article><span>{es ? "Verificado vs previsto" : "Verified vs planned"}</span><strong>{scorecard.verifiedPercent}%</strong></article>
      <article><span>{es ? "Probadas" : "Proven"}</span><strong>{scorecard.proven}</strong></article>
      <article><span>{es ? "Parciales" : "Partial"}</span><strong>{scorecard.partial}</strong></article>
      <article><span>{es ? "No implementadas" : "Missing"}</span><strong>{scorecard.missing}</strong></article>
    </div>}

    <div className="mission-grid">
      <form className="mission-composer" onSubmit={event => { event.preventDefault(); void startMission(); }}>
        <label>
          <span>{es ? "Objetivo" : "Objective"}</span>
          <textarea value={objective} onChange={event => setObjective(event.target.value)} rows={3} maxLength={500} />
        </label>
        <button type="submit" disabled={busy || objective.trim().length < 8}>
          <Flag />{busy ? (es ? "Planificando…" : "Planning…") : (es ? "Iniciar misión" : "Start mission")}
        </button>
      </form>

      <div className="mission-capabilities">
        <strong>{es ? "10 capacidades prioritarias" : "10 priority capabilities"}</strong>
        <ul>
          {capabilities.map(item => <li key={item.id}>
            <b>{item.name}</b>
            <em data-class={item.classification}>{classifyLabel(item.classification, language)}</em>
          </li>)}
        </ul>
      </div>
    </div>

    {notice && <p className="creator-notice">{notice}</p>}

    {waiting.length > 0 && <div className="creator-waiting">
      <strong>{es ? "Misiones ejecutadas — aceptación humana" : "Executed missions — human acceptance"}</strong>
      {waiting.map(item => <article key={item.id}>
        <span><Flag /></span>
        <div>
          <b>{item.agent?.name || item.id.slice(0, 8)}</b>
          <small>{item.objective.slice(0, 120)}</small>
          <small>{es ? "Estado" : "Status"}: {item.status} · {item.verification?.passed ? (es ? "evidencia OK" : "evidence OK") : (es ? "evidencia pendiente" : "evidence pending")}</small>
        </div>
        <button disabled={busy} onClick={() => void decide(item.id, "approve")}><CheckCircle />{es ? "Aceptar" : "Accept"}</button>
        <button disabled={busy} onClick={() => void decide(item.id, "reject")}>{es ? "Rechazar" : "Reject"}</button>
        <button disabled={busy} onClick={() => void decide(item.id, "cancel")}>{es ? "Cancelar" : "Cancel"}</button>
      </article>)}
    </div>}

    <div className="mission-history">
      <h4>{es ? "Historial reciente" : "Recent history"}</h4>
      {desk.missions.slice(0, 6).map(item => <article key={item.id}>
        <div>
          <b>{item.status}</b>
          <small>{item.objective.slice(0, 140)}</small>
          {item.result && <p>{item.result.summary}</p>}
          {item.result && <code>{item.result.evidence.join(" · ")}</code>}
        </div>
        {!item.result?.verifiable && <Warning />}
      </article>)}
      {desk.missions.length === 0 && <p>{es ? "Aún no hay misiones." : "No missions yet."}</p>}
    </div>

    {lastEval && <div className="mission-eval-report">
      <strong>{es ? "Última evaluación" : "Latest evaluation"}</strong>
      <p>{lastEval.summary.passed}/{lastEval.summary.total} · {lastEval.summary.passRate}%</p>
      <ul>
        {lastEval.cases.map(item => <li key={item.id} data-status={item.status}>
          <b>{item.suite}</b> {item.name} — {item.status} ({item.durationMs}ms)
        </li>)}
      </ul>
    </div>}
  </section>;
}
