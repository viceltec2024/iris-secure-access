/**
 * IRIS Etapa 3 — Memoria con permiso.
 *
 * Capa aditiva sobre lib/iris-memory.ts. NO cambia las reglas existentes:
 * los registros siguen siendo append-only con max 200, la promoción de
 * lecciones sigue exigiendo un humano, y memoryAllowsSelfModify() sigue
 * siendo false (ese módulo no se toca). Lo que añade esta capa:
 *
 *   - Consentimiento por categoría de dato, con caducidad opcional.
 *     Sin una entrada concedida y vigente, la categoría NO se lista, NO
 *     se exporta y NO se usa en búsquedas de esta capa (fail closed).
 *   - Listar / exportar: solo registros consentidos y no borrados.
 *   - Borrar: exige un actor humano verificado (email con @) y CAS
 *     opcional; elimina el registro del store y deja una lápida
 *     (tombstone) con id, kind, fecha y autor — sin el contenido — de
 *     modo que aunque el registro reaparezca en una mezcla de datos
 *     antiguos, el filtro de esta capa vuelve a excluirlo.
 *   - Cita: una respuesta que use memoria cita el registro por su id
 *     interno ("memoria interna [id]"), nunca como fuente web.
 *
 * Migración (cierre de etapas 3–4): la ruta Ask ya usa esta capa.
 * resolveIrisAsk (lib/iris-ask.ts) filtra lecciones e hits por
 * consentimiento vigente con applyMemoryConsentToAsk (fail closed) y la
 * ruta app/api/ask-iris/route.ts audita la memoria suprimida por falta
 * de consentimiento. El panel del dashboard y la API /api/iris-memory
 * usan esta misma capa.
 */

import {
  activeLessons,
  appendMemory,
  searchMemory,
  type MemoryConsent,
  type MemoryDataCategory,
  type MemoryKind,
  type MemoryRecord,
  type MemoryStore,
  type MemoryTombstone,
} from "./iris-memory.ts";

export type { MemoryConsent, MemoryDataCategory, MemoryTombstone };

export const MEMORY_CATEGORIES: MemoryDataCategory[] = [
  "leccion",
  "evaluacion",
  "mision",
  "nota_operador",
  "error_solucion",
];

export function categoryOfRecord(record: Pick<MemoryRecord, "kind">): MemoryDataCategory {
  switch (record.kind) {
    case "lesson": return "leccion";
    case "eval_result": return "evaluacion";
    case "mission_result": return "mision";
    case "operator_note": return "nota_operador";
    case "error_solution": return "error_solucion";
  }
}

function requireHumanActor(actorEmail: string) {
  if (!actorEmail || !actorEmail.includes("@")) {
    throw new Error("verified_human_actor_required");
  }
}

function checkRevision(store: MemoryStore, expectedRevision?: number) {
  if (expectedRevision !== undefined && expectedRevision !== (store.revision || 0)) {
    throw new Error("revision_conflict");
  }
}

/** La entrada de consentimiento vigente más reciente de una categoría. */
export function latestConsent(store: MemoryStore, category: MemoryDataCategory): MemoryConsent | null {
  const entries = (store.consents || []).filter(entry => entry.category === category);
  return entries.length ? entries[entries.length - 1] : null;
}

/** True solo si hay consentimiento concedido y no caducado en `now`. */
export function consentAllows(store: MemoryStore, category: MemoryDataCategory, now = new Date().toISOString()): boolean {
  const entry = latestConsent(store, category);
  if (!entry || !entry.granted) return false;
  if (entry.expiresAt) {
    const expiry = Date.parse(entry.expiresAt);
    if (Number.isFinite(expiry) && Date.parse(now) >= expiry) return false;
  }
  return true;
}

/** Conceder (o renovar) el consentimiento de una categoría. Solo humanos. */
export function grantMemoryConsent(
  store: MemoryStore,
  category: MemoryDataCategory,
  actorEmail: string,
  now = new Date().toISOString(),
  expiresAt?: string,
  expectedRevision?: number,
): MemoryStore {
  requireHumanActor(actorEmail);
  checkRevision(store, expectedRevision);
  if (!MEMORY_CATEGORIES.includes(category)) throw new Error("unknown_memory_category");
  if (expiresAt !== undefined && Number.isNaN(Date.parse(expiresAt))) throw new Error("invalid_expires_at");
  const entry: MemoryConsent = {
    category,
    granted: true,
    grantedBy: actorEmail,
    grantedAt: now,
    ...(expiresAt ? { expiresAt } : {}),
  };
  return {
    ...store,
    revision: (store.revision || 0) + 1,
    consents: [...(store.consents || []), entry],
  };
}

/** Revocar: deja constancia (granted:false) en vez de borrar el historial. */
export function revokeMemoryConsent(
  store: MemoryStore,
  category: MemoryDataCategory,
  actorEmail: string,
  now = new Date().toISOString(),
  expectedRevision?: number,
): MemoryStore {
  requireHumanActor(actorEmail);
  checkRevision(store, expectedRevision);
  if (!MEMORY_CATEGORIES.includes(category)) throw new Error("unknown_memory_category");
  const entry: MemoryConsent = { category, granted: false, grantedBy: actorEmail, grantedAt: now };
  return {
    ...store,
    revision: (store.revision || 0) + 1,
    consents: [...(store.consents || []), entry],
  };
}

export function isDeleted(store: MemoryStore, recordId: string): boolean {
  return (store.deletions || []).some(entry => entry.id === recordId);
}

/** Registros visibles para esta capa: consentidos y no borrados. */
export function visibleMemoryRecords(store: MemoryStore, now = new Date().toISOString()): MemoryRecord[] {
  const deleted = new Set((store.deletions || []).map(entry => entry.id));
  return store.records.filter(record => {
    if (deleted.has(record.id)) return false;
    return consentAllows(store, categoryOfRecord(record), now);
  });
}

/** Resumen para listar en el panel (cuerpo recortado, sin secretos). */
export type MemoryListItem = {
  id: string;
  kind: MemoryKind;
  category: MemoryDataCategory;
  title: string;
  bodyPreview: string;
  createdAt: string;
  createdBy: string;
  promotion: MemoryRecord["promotion"];
};

export function listMemory(store: MemoryStore, now = new Date().toISOString()): MemoryListItem[] {
  return visibleMemoryRecords(store, now).map(record => ({
    id: record.id,
    kind: record.kind,
    category: categoryOfRecord(record),
    title: record.title,
    bodyPreview: record.body.slice(0, 280),
    createdAt: record.createdAt,
    createdBy: record.createdBy,
    promotion: record.promotion,
  }));
}

/**
 * Exportación: solo registros visibles, con el estado de consentimiento y
 * el conteo de borrados. Nunca incluye claves ni credenciales: los
 * cuerpos se exportan tal cual están guardados, y el guardado ya limita
 * el tamaño; la ruta que sirve esto exige sesión y rol activo.
 */
export function exportMemory(store: MemoryStore, now = new Date().toISOString()) {
  return {
    exportedAt: now,
    recordCount: visibleMemoryRecords(store, now).length,
    totalRecords: store.records.length,
    deletedCount: (store.deletions || []).length,
    consents: MEMORY_CATEGORIES.map(category => ({
      category,
      granted: consentAllows(store, category, now),
      latest: latestConsent(store, category),
    })),
    records: visibleMemoryRecords(store, now),
  };
}

/**
 * Borrar un registro: exige humano verificado, elimina el contenido del
 * store y deja una lápida. El contenido borrado no vuelve a aparecer en
 * listMemory, exportMemory ni searchMemoryConsented, aunque el registro
 * se reintroduzca después (la lápida lo filtra de nuevo).
 */
export function deleteMemoryRecord(
  store: MemoryStore,
  recordId: string,
  actorEmail: string,
  now = new Date().toISOString(),
  expectedRevision?: number,
): { store: MemoryStore; tombstone: MemoryTombstone } {
  requireHumanActor(actorEmail);
  checkRevision(store, expectedRevision);
  const record = store.records.find(item => item.id === recordId);
  if (!record) throw new Error("Memory record not found");
  const tombstone: MemoryTombstone = {
    id: record.id,
    kind: record.kind,
    deletedAt: now,
    deletedBy: actorEmail,
  };
  const next: MemoryStore = {
    ...store,
    revision: (store.revision || 0) + 1,
    records: store.records.filter(item => item.id !== recordId),
    deletions: [...(store.deletions || []).filter(entry => entry.id !== recordId), tombstone],
  };
  return { store: next, tombstone };
}

/** Añadir con guarda: un id con lápida no puede volver a entrar. */
export function appendMemoryGuarded(store: MemoryStore, record: MemoryRecord): MemoryStore {
  if (isDeleted(store, record.id)) throw new Error("memory_record_deleted");
  return appendMemory(store, record);
}

/** Búsqueda TF-IDF existente, filtrada por consentimiento y borrados. */
export function searchMemoryConsented(store: MemoryStore, query: string, limit = 8, now = new Date().toISOString()): MemoryRecord[] {
  const visible = new Set(visibleMemoryRecords(store, now).map(record => record.id));
  return searchMemory(store, query, limit * 3)
    .filter(record => visible.has(record.id))
    .slice(0, limit);
}

export type AskMemoryConsent = {
  /** True si alguna lección o hit de memoria llegó al contexto del Ask. */
  used: boolean;
  /** Registros que se habrían usado sin consentimiento y quedaron fuera. */
  suppressedCount: number;
  consentedCategories: MemoryDataCategory[];
  lessons: MemoryRecord[];
  memoryHits: MemoryRecord[];
};

/**
 * Etapa 3 en Ask (cierre): la memoria solo entra al contexto con
 * consentimiento vigente por categoría. Sin consentimiento, fail closed:
 * ni lecciones aprobadas ni hits de búsqueda se usan, y el conteo
 * suprimido queda para auditoría en la ruta. Función pura (sin DB) para
 * poder probarla sin sesión ni base de datos; vive aquí — y no en
 * lib/iris-ask.ts — precisamente para no arrastrar drizzle ni la DB a
 * los tests. No toca memoryAllowsSelfModify() ni las reglas append-only.
 */
export function applyMemoryConsentToAsk(
  store: MemoryStore,
  question: string,
  now = new Date().toISOString(),
): AskMemoryConsent {
  const visible = new Set(visibleMemoryRecords(store, now).map(record => record.id));
  const approved = activeLessons(store);
  const related = searchMemory(store, question, 4);
  const lessons = approved.filter(record => visible.has(record.id));
  const memoryHits = searchMemoryConsented(store, question, 4, now);
  const suppressedIds = new Set(
    [...approved, ...related].filter(record => !visible.has(record.id)).map(record => record.id),
  );
  return {
    used: lessons.length > 0 || memoryHits.length > 0,
    suppressedCount: suppressedIds.size,
    consentedCategories: MEMORY_CATEGORIES.filter(category => consentAllows(store, category, now)),
    lessons,
    memoryHits,
  };
}

/** Cita interna de un registro de memoria, para respuestas que lo usen. */
export function citeMemoryRecord(record: MemoryRecord, language: "es" | "en" = "es"): string {
  const label = language === "es" ? "Memoria interna" : "Internal memory";
  return `${label} [${record.id}] — ${record.title} (${categoryOfRecord(record)}, ${record.createdAt.slice(0, 10)})`;
}

export function formatMemoryCitations(records: MemoryRecord[], language: "es" | "en" = "es"): string {
  const heading = language === "es" ? "Memoria interna consultada:" : "Internal memory consulted:";
  return [heading, ...records.map((record, index) => `${index + 1}. ${citeMemoryRecord(record, language)}`)].join("\n");
}
