"use client";

/* eslint-disable react-hooks/set-state-in-effect -- memory panel loads memory + consents from API on mount/language, same as the other dashboard panels */

/**
 * IRIS — Panel de memoria con permiso (cierre etapas 3–4).
 *
 * Usa solo la API /api/iris-memory, que ya exige sesión activa y
 * contexto de organización: el panel nunca ve registros de otra
 * organización ni secretos. Listar y exportar solo devuelven registros
 * con consentimiento vigente y no borrados (fail closed en el servidor);
 * consentir, revocar y borrar son acciones del usuario con sesión, con
 * revisión de concurrencia (expectedRevision) y auditoría en el servidor.
 * El borrado pide una segunda pulsación de confirmación; nunca se borra
 * con una sola pulsación accidental.
 */
import { useEffect, useState } from "react";
import { ArrowClockwise, CheckCircle, DownloadSimple, Eye, Trash, Warning, X } from "@phosphor-icons/react";
import type { Language } from "./dashboard-i18n";

type MemoryConsentEntry = {
  category: string;
  granted: boolean;
  grantedBy?: string;
  grantedAt?: string;
  expiresAt?: string;
} | null;

type MemoryListItem = {
  id: string;
  kind: string;
  category: string;
  title: string;
  bodyPreview: string;
  createdAt: string;
  createdBy: string;
  promotion: string;
};

type MemoryState = {
  revision: number;
  records: MemoryListItem[];
  deletedCount: number;
  consents: Array<{ category: string; latest: MemoryConsentEntry }>;
};

const CATEGORIES = ["leccion", "evaluacion", "mision", "nota_operador", "error_solucion"] as const;

const CATEGORY_LABEL: Record<string, [string, string]> = {
  leccion: ["Lecciones aprobadas", "Approved lessons"],
  evaluacion: ["Resultados de evaluación", "Evaluation results"],
  mision: ["Resultados de misión", "Mission results"],
  nota_operador: ["Notas del operador", "Operator notes"],
  error_solucion: ["Errores y soluciones", "Errors and solutions"],
};

const KIND_LABEL: Record<string, [string, string]> = {
  lesson: ["Lección", "Lesson"],
  eval_result: ["Evaluación", "Evaluation"],
  mission_result: ["Misión", "Mission"],
  operator_note: ["Nota", "Note"],
  error_solution: ["Error resuelto", "Solved error"],
};

export default function IrisMemoryPanel({ language }: { language: Language }) {
  const es = language === "es";
  const [state, setState] = useState<MemoryState | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  // Instante capturado al cargar (no en render): así el render sigue siendo
  // puro y la caducidad se evalúa contra el momento de la carga, igual que antes.
  const [now, setNow] = useState(0);

  async function refresh() {
    setNow(Date.now());
    try {
      const response = await fetch("/api/iris-memory", { cache: "no-store" });
      if (!response.ok) throw new Error(es ? "No se pudo cargar la memoria." : "Memory could not be loaded.");
      setState(await response.json() as MemoryState);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : (es ? "No se pudo cargar la memoria." : "Memory could not be loaded."));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void refresh();
    // refresh cierra sobre `es`, igual que los demás paneles del dashboard.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [es]);

  async function post(body: Record<string, unknown>) {
    setBusy(true);
    setNotice("");
    try {
      const response = await fetch("/api/iris-memory", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...body, expectedRevision: state?.revision }),
      });
      const payload = await response.json() as { error?: string; records?: MemoryListItem[] };
      if (!response.ok) throw new Error(payload.error || (es ? "No se pudo completar la operación." : "The operation could not be completed."));
      if (body.action === "export") {
        const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
        const url = URL.createObjectURL(blob);
        const anchor = document.createElement("a");
        anchor.href = url;
        anchor.download = `iris-memoria-${new Date().toISOString().slice(0, 10)}.json`;
        anchor.click();
        URL.revokeObjectURL(url);
        setNotice(es ? "Exportación descargada: solo incluye registros con consentimiento vigente." : "Export downloaded: it only includes records with active consent.");
        return;
      }
      await refresh();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : (es ? "No se pudo completar la operación." : "The operation could not be completed."));
    } finally {
      setBusy(false);
    }
  }

  if (loading || !state) {
    return <section className="module-panel iris-memory-panel"><p>{es ? "Cargando memoria…" : "Loading memory…"}</p></section>;
  }

  const consentByCategory = new Map(state.consents.map(entry => [entry.category, entry.latest]));

  return (
    <section className="module-panel iris-memory-panel">
      <header>
        <h2>{es ? "Memoria con permiso" : "Memory with consent"}</h2>
        <p>
          {es
            ? "Sin tu consentimiento vigente, IRIS no usa ni muestra la memoria de una categoría. Borrar deja una constancia sin contenido y el registro no vuelve a aparecer."
            : "Without your active consent, IRIS neither uses nor shows memory from a category. Deleting leaves a content-free record and the entry never reappears."}
        </p>
      </header>

      <div>
        <h3>{es ? "Consentimiento por categoría" : "Consent by category"}</h3>
        {CATEGORIES.map(category => {
          const latest = consentByCategory.get(category) || null;
          const granted = Boolean(latest?.granted);
          const expired = Boolean(latest?.granted && latest?.expiresAt && Date.parse(latest.expiresAt) <= now);
          return (
            <div key={category}>
              <strong>{(CATEGORY_LABEL[category] || [category, category])[es ? 0 : 1]}</strong>
              <span> {granted && !expired ? (es ? "· consentido" : "· consented") : granted && expired ? (es ? "· caducado" : "· expired") : (es ? "· sin consentimiento" : "· no consent")}</span>
              <button disabled={busy} onClick={() => void post({ action: "grant", category })}><CheckCircle /> {es ? "Consentir" : "Consent"}</button>
              <button disabled={busy} onClick={() => void post({ action: "revoke", category })}><X /> {es ? "Revocar" : "Revoke"}</button>
            </div>
          );
        })}
      </div>

      <div>
        <button disabled={busy} onClick={() => void post({ action: "export" })}><DownloadSimple /> {es ? "Exportar memoria consentida" : "Export consented memory"}</button>
        <button disabled={busy} onClick={() => void refresh()}><ArrowClockwise /> {es ? "Recargar" : "Reload"}</button>
        <span> {es ? `Registros visibles: ${state.records.length} · Borrados: ${state.deletedCount}` : `Visible records: ${state.records.length} · Deleted: ${state.deletedCount}`}</span>
      </div>

      {notice && <p className="creator-notice" role="status" aria-live="polite"><Warning /> {notice}</p>}

      <div>
        <h3>{es ? "Registros visibles" : "Visible records"}</h3>
        {state.records.length === 0 && <p>{es ? "Nada visible: consiente una categoría para ver su memoria." : "Nothing visible: consent to a category to see its memory."}</p>}
        {state.records.map(record => (
          <article key={record.id}>
            <header>
              <strong>{record.title}</strong>
              <span> {(KIND_LABEL[record.kind] || [record.kind, record.kind])[es ? 0 : 1]} · {record.createdAt.slice(0, 10)} · {record.promotion}</span>
            </header>
            <p><Eye /> {record.bodyPreview}</p>
            {confirmDeleteId === record.id ? (
              <span>
                <button disabled={busy} onClick={() => { setConfirmDeleteId(null); void post({ action: "delete", recordId: record.id }); }}><Trash /> {es ? "Sí, borrar para siempre" : "Yes, delete permanently"}</button>
                <button disabled={busy} onClick={() => setConfirmDeleteId(null)}>{es ? "Cancelar" : "Cancel"}</button>
              </span>
            ) : (
              <button disabled={busy} onClick={() => setConfirmDeleteId(record.id)}><Trash /> {es ? "Borrar" : "Delete"}</button>
            )}
          </article>
        ))}
      </div>
    </section>
  );
}
