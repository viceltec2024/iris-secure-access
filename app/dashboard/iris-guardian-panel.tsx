"use client";

/* eslint-disable react-hooks/set-state-in-effect -- Guardian panel polls the real audit-backed feed */
import { useCallback, useEffect, useState } from "react";
import { ShieldCheck, ShieldWarning, Siren, Warning } from "@phosphor-icons/react";
import type { Language } from "./dashboard-i18n";
import type { ActorTrack, PostureFinding, Quarantine, ThreatEvent, ThreatReport, ThreatSeverity, AuditChainResult } from "../../lib/iris-threats-core";
import { auditTimestamp } from "../../lib/iris-threats-core";

type Snapshot = {
  generatedAt: string;
  scope: "organization" | "own";
  report: ThreatReport;
  threats: ThreatEvent[];
  actors: ActorTrack[];
  quarantines: Quarantine[];
  posture: PostureFinding[];
  auditChain: AuditChainResult | null;
};

const POLL_MS = 5_000;

const SEVERITY_LABEL: Record<ThreatSeverity, [string, string]> = {
  critical: ["Crítica", "Critical"],
  high: ["Alta", "High"],
  medium: ["Media", "Medium"],
  low: ["Baja", "Low"],
};

function ago(value: string, es: boolean, now: number) {
  const at = auditTimestamp(value);
  if (!Number.isFinite(at)) return value;
  const seconds = Math.max(0, Math.round((now - at) / 1000));
  if (seconds < 60) return es ? `hace ${seconds} s` : `${seconds}s ago`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return es ? `hace ${minutes} min` : `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return es ? `hace ${hours} h` : `${hours} h ago`;
  return new Date(at).toLocaleString(es ? "es" : "en");
}

export default function IrisGuardianPanel({ language, isAdmin }: { language: Language; isAdmin: boolean }) {
  const es = language === "es";
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState("");
  const [now, setNow] = useState(() => Date.now());
  const [paused, setPaused] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const response = await fetch(`/api/iris-threats?language=${language}`, { cache: "no-store" });
      const payload = await response.json() as Snapshot & { error?: string };
      if (!response.ok) throw new Error(payload.error || (es ? "No se pudo leer Guardian." : "Could not read Guardian."));
      setSnapshot(payload);
      setError("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }, [language, es]);

  useEffect(() => {
    void refresh();
    if (paused) return;
    const timer = window.setInterval(() => { if (document.visibilityState === "visible") void refresh(); }, POLL_MS);
    return () => window.clearInterval(timer);
  }, [refresh, paused]);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, []);

  async function act(action: "release" | "suspend", email: string) {
    if (action === "suspend" && !window.confirm(es ? `¿Suspender la cuenta ${email}? Podrás reactivarla desde Accesos.` : `Suspend ${email}? You can reactivate it from Access.`)) return;
    setBusy(`${action}:${email}`);
    setNotice("");
    try {
      const response = await fetch("/api/iris-threats", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action, email }) });
      const payload = await response.json() as { error?: string };
      if (!response.ok) throw new Error(payload.error || "error");
      setNotice(action === "release"
        ? (es ? `Cuarentena levantada para ${email}.` : `Quarantine lifted for ${email}.`)
        : (es ? `Cuenta ${email} suspendida.` : `Account ${email} suspended.`));
      await refresh();
    } catch (cause) {
      setNotice(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy("");
    }
  }

  const report = snapshot?.report;
  const updated = snapshot ? Math.max(0, Math.round((now - Date.parse(snapshot.generatedAt)) / 1000)) : null;
  const statusLabel = !report ? "" : report.status === "under_attack"
    ? (es ? "Bajo ataque" : "Under attack")
    : report.status === "watch" ? (es ? "En vigilancia" : "Watching") : (es ? "Sin ataques" : "All clear");

  return <section className="guardian-panel">
    <header className={`guardian-status ${report?.status || "loading"}`}>
      {report?.status === "under_attack" ? <Siren weight="fill" /> : report?.status === "watch" ? <ShieldWarning weight="fill" /> : <ShieldCheck weight="fill" />}
      <div>
        <strong>{report ? statusLabel : (es ? "Conectando con Guardian…" : "Connecting to Guardian…")}</strong>
        <span>
          {paused ? (es ? "Pausado" : "Paused") : <><i className="guardian-live-dot" /> {es ? "En vivo" : "Live"}</>}
          {updated !== null && ` · ${es ? `actualizado hace ${updated} s` : `updated ${updated}s ago`}`}
          {snapshot?.scope === "own" && ` · ${es ? "solo tu cuenta" : "your account only"}`}
        </span>
      </div>
      <button type="button" onClick={() => setPaused(value => !value)}>{paused ? (es ? "Reanudar" : "Resume") : (es ? "Pausar" : "Pause")}</button>
    </header>

    {error && <p className="guardian-error"><Warning /> {error}</p>}
    {notice && <p className="guardian-notice">{notice}</p>}

    {report && <article className="guardian-report">
      <h2>{es ? "Reporte de Guardian" : "Guardian report"}</h2>
      <p>{report.spoken}</p>
      {report.recommendations.length > 0 && <ul>{report.recommendations.map(item => <li key={item}>{item}</li>)}</ul>}
      <small>{es ? "Pregunta a Ask IRIS «¿hay ataques?» para escucharlo en voz alta." : "Ask IRIS “any attacks?” to hear it out loud."}</small>
    </article>}

    {report && <div className="guardian-counts">
      {(["critical", "high", "medium", "low"] as ThreatSeverity[]).map(level => <article key={level} className={`sev-${level}`}>
        <span>{es ? SEVERITY_LABEL[level][0] : SEVERITY_LABEL[level][1]}</span><strong>{report.counts[level]}</strong>
      </article>)}
      <article><span>{es ? "Cuarentenas" : "Quarantines"}</span><strong>{report.activeQuarantines}</strong></article>
    </div>}

    <div className="guardian-grid">
      <article className="guardian-feed">
        <h3>{es ? "Ataques en tiempo real" : "Live attacks"}</h3>
        {snapshot && !snapshot.threats.length && <p className="guardian-empty">{es ? "No hay ataques registrados. Esta lista solo muestra eventos reales del registro de auditoría." : "No recorded attacks. This list only shows real audit-log events."}</p>}
        <ol>
          {snapshot?.threats.map(item => <li key={item.id} className={`sev-${item.severity}`}>
            <div><b>{item.title}</b><time>{ago(item.at, es, now)}</time></div>
            <p>{item.explanation}</p>
            <small>{item.actionTaken}</small>
            <small className="guardian-meta">#{item.id} · {item.actor}{item.ip ? ` · IP ${item.ip}` : ""} · {item.code}</small>
          </li>)}
        </ol>
      </article>

      <aside className="guardian-side">
        {isAdmin && <article>
          <h3>{es ? "Cuentas rastreadas" : "Tracked accounts"}</h3>
          {snapshot && !snapshot.actors.length && <p className="guardian-empty">{es ? "Ninguna." : "None."}</p>}
          {snapshot?.actors.map(actor => {
            const quarantined = snapshot.quarantines.find(item => item.email === actor.actor);
            return <div key={actor.actor} className={`guardian-actor sev-${actor.maxSeverity}`}>
              <strong>{actor.actor}</strong>
              <span>{actor.total} {es ? "eventos" : "events"} · {es ? "último" : "last"} {ago(actor.lastAt, es, now)}{actor.ips.length ? ` · IP ${actor.ips.join(", ")}` : ""}</span>
              {quarantined && <span className="guardian-tag">{es ? `En cuarentena hasta ${new Date(quarantined.until).toLocaleTimeString(es ? "es" : "en")}` : `Quarantined until ${new Date(quarantined.until).toLocaleTimeString()}`}</span>}
              <div className="guardian-actions">
                {quarantined && <button type="button" disabled={Boolean(busy)} onClick={() => act("release", actor.actor)}>{es ? "Levantar cuarentena" : "Lift quarantine"}</button>}
                <button type="button" className="danger" disabled={Boolean(busy)} onClick={() => act("suspend", actor.actor)}>{es ? "Suspender cuenta" : "Suspend account"}</button>
              </div>
            </div>;
          })}
        </article>}

        {isAdmin && <article>
          <h3>{es ? "Vulnerabilidades de configuración" : "Configuration weaknesses"}</h3>
          {snapshot && !snapshot.posture.length && <p className="guardian-empty">{es ? "No encontré puntos débiles en la configuración revisada." : "No weaknesses found in the reviewed configuration."}</p>}
          {snapshot?.posture.map(finding => <div key={finding.code} className={`guardian-finding sev-${finding.severity}`}>
            <strong>{finding.title}</strong><p>{finding.detail}</p><small>{finding.fix}</small>
          </div>)}
          {snapshot?.auditChain && <small className="guardian-meta">
            {es
              ? `Cadena de auditoría: ${snapshot.auditChain.checked} eventos verificados, ${snapshot.auditChain.broken.length} alterados${snapshot.auditChain.contended ? `, ${snapshot.auditChain.contended} con contención` : ""}.`
              : `Audit chain: ${snapshot.auditChain.checked} events verified, ${snapshot.auditChain.broken.length} tampered${snapshot.auditChain.contended ? `, ${snapshot.auditChain.contended} contended` : ""}.`}
          </small>}
        </article>}
      </aside>
    </div>
  </section>;
}
