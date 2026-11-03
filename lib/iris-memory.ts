/**
 * Append-only persistent memory for IRIS learning.
 * Lessons never mutate core code. Promotion requires a human actor.
 */

export type MemoryKind = "eval_result" | "mission_result" | "lesson" | "operator_note" | "error_solution";

export type MemoryRecord = {
  id: string;
  kind: MemoryKind;
  title: string;
  body: string;
  score?: number;
  tags: string[];
  createdAt: string;
  createdBy: string;
  /** Lessons stay pending until a human promotes them into the active set. */
  promotion: "none" | "pending" | "approved" | "rejected";
  promotedAt?: string;
  promotedBy?: string;
  sourceId?: string;
};

/**
 * Etapa 3 (consentimiento y borrado) — campos opcionales y auditables que
 * viajan dentro del mismo JSON del store, sin cambiar el comportamiento
 * existente: los registros siguen siendo append-only, max 200, y la
 * promoción de lecciones sigue exigiendo un humano. Un store antiguo sin
 * estos campos se lee igual que antes (se tratan como listas vacías).
 */
export type MemoryDataCategory =
  | "leccion"
  | "evaluacion"
  | "mision"
  | "nota_operador"
  | "error_solucion";

export type MemoryConsent = {
  category: MemoryDataCategory;
  granted: boolean;
  grantedBy: string;
  grantedAt: string;
  /** Sin expiresAt el consentimiento no caduca; con fecha, caduca al llegar. */
  expiresAt?: string;
};

export type MemoryTombstone = {
  id: string;
  kind: MemoryKind;
  deletedAt: string;
  deletedBy: string;
};

export type MemoryStore = {
  records: MemoryRecord[];
  /** Soft cap to avoid unbounded growth in appSettings JSON. */
  maxRecords: number;
  /** Monotonic revision for optimistic concurrency / CAS. */
  revision: number;
  /** Etapa 3: consentimiento por categoría (ausente = sin consentir). */
  consents?: MemoryConsent[];
  /** Etapa 3: registro de borrados; un id aquí nunca vuelve a listarse. */
  deletions?: MemoryTombstone[];
};

const MAX_RECORDS = 200;
const MAX_BODY = 4000;

export function emptyMemoryStore(): MemoryStore {
  return { records: [], maxRecords: MAX_RECORDS, revision: 0 };
}

const MEMORY_CATEGORIES: MemoryDataCategory[] = [
  "leccion",
  "evaluacion",
  "mision",
  "nota_operador",
  "error_solucion",
];

function isMemoryConsent(value: unknown): value is MemoryConsent {
  if (!value || typeof value !== "object") return false;
  const row = value as MemoryConsent;
  return MEMORY_CATEGORIES.includes(row.category)
    && typeof row.granted === "boolean"
    && typeof row.grantedBy === "string"
    && typeof row.grantedAt === "string"
    && (row.expiresAt === undefined || typeof row.expiresAt === "string");
}

function isMemoryTombstone(value: unknown): value is MemoryTombstone {
  if (!value || typeof value !== "object") return false;
  const row = value as MemoryTombstone;
  return typeof row.id === "string" && Boolean(row.id)
    && ["eval_result", "mission_result", "lesson", "operator_note", "error_solution"].includes(row.kind)
    && typeof row.deletedAt === "string"
    && typeof row.deletedBy === "string";
}

export function parseMemoryStore(value: string): MemoryStore {
  try {
    const parsed = JSON.parse(value) as Partial<MemoryStore>;
    const records = Array.isArray(parsed.records) ? parsed.records.filter(isMemoryRecord) : [];
    const revision = typeof parsed.revision === "number" && parsed.revision >= 0 ? Math.floor(parsed.revision) : 0;
    // Etapa 3: se preservan consentimientos y borrados cuando existen;
    // un JSON antiguo sin ellos se lee igual que antes.
    const consents = Array.isArray(parsed.consents) ? parsed.consents.filter(isMemoryConsent) : [];
    const deletions = Array.isArray(parsed.deletions) ? parsed.deletions.filter(isMemoryTombstone) : [];
    return { records, maxRecords: MAX_RECORDS, revision, consents, deletions };
  } catch {
    return emptyMemoryStore();
  }
}

function isMemoryRecord(value: unknown): value is MemoryRecord {
  if (!value || typeof value !== "object") return false;
  const row = value as MemoryRecord;
  return Boolean(
    row.id
    && typeof row.title === "string"
    && typeof row.body === "string"
    && typeof row.createdBy === "string"
    && ["eval_result", "mission_result", "lesson", "operator_note", "error_solution"].includes(row.kind)
    && ["none", "pending", "approved", "rejected"].includes(row.promotion)
  );
}

/**
 * CAS: si se pasa expectedRevision y no coincide con store.revision, se
 * rechaza con "revision_conflict" en vez de pisar una escritura concurrente.
 * Sin expectedRevision el comportamiento anterior se mantiene.
 */
export function appendMemory(store: MemoryStore, record: MemoryRecord, expectedRevision?: number): MemoryStore {
  if (expectedRevision !== undefined && expectedRevision !== (store.revision || 0)) {
    throw new Error("revision_conflict");
  }
  const next: MemoryRecord = {
    ...record,
    title: record.title.slice(0, 160),
    body: record.body.slice(0, MAX_BODY),
    tags: (record.tags || []).slice(0, 12).map(tag => String(tag).slice(0, 40)),
  };
  return {
    ...store,
    revision: (store.revision || 0) + 1,
    records: [next, ...store.records].slice(0, store.maxRecords || MAX_RECORDS),
  };
}

export function requestLessonPromotion(store: MemoryStore, recordId: string, expectedRevision?: number): MemoryStore {
  if (expectedRevision !== undefined && expectedRevision !== (store.revision || 0)) {
    throw new Error("revision_conflict");
  }
  const record = store.records.find(item => item.id === recordId);
  if (!record) throw new Error("Memory record not found");
  if (record.kind !== "lesson") throw new Error("Only lessons can be promoted");
  if (record.promotion === "approved") return store;
  const next: MemoryRecord = { ...record, promotion: "pending" };
  return {
    ...store,
    revision: (store.revision || 0) + 1,
    records: store.records.map(item => item.id === recordId ? next : item),
  };
}

export function decideLessonPromotion(
  store: MemoryStore,
  recordId: string,
  decision: "approve" | "reject",
  actorEmail: string,
  now = new Date().toISOString(),
  expectedRevision?: number,
) {
  if (expectedRevision !== undefined && expectedRevision !== (store.revision || 0)) {
    throw new Error("revision_conflict");
  }
  if (!actorEmail || !actorEmail.includes("@")) {
    throw new Error("verified_human_actor_required");
  }
  const record = store.records.find(item => item.id === recordId);
  if (!record) throw new Error("Memory record not found");
  if (record.kind !== "lesson") throw new Error("Only lessons can be promoted");
  if (record.promotion !== "pending" && record.promotion !== "none") {
    throw new Error("Lesson is not awaiting promotion");
  }
  const next: MemoryRecord = {
    ...record,
    promotion: decision === "approve" ? "approved" : "rejected",
    promotedAt: now,
    promotedBy: actorEmail,
  };
  return {
    store: {
      ...store,
      revision: (store.revision || 0) + 1,
      records: store.records.map(item => item.id === recordId ? next : item),
    },
    record: next,
  };
}

export function activeLessons(store: MemoryStore) {
  return store.records.filter(item => item.kind === "lesson" && item.promotion === "approved");
}

export function buildLessonFromEval(input: {
  id: string;
  evalId: string;
  title: string;
  body: string;
  score: number;
  actorEmail: string;
  now?: string;
}): MemoryRecord {
  return {
    id: input.id,
    kind: "lesson",
    title: input.title.slice(0, 160),
    body: input.body.slice(0, MAX_BODY),
    score: input.score,
    tags: ["eval", "learning"],
    createdAt: input.now || new Date().toISOString(),
    createdBy: input.actorEmail,
    promotion: "pending",
    sourceId: input.evalId,
  };
}

function tokenizeMemoryText(value: string) {
  return String(value || "")
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter(token => token.length >= 3)
    .slice(0, 64);
}

function termFrequency(tokens: string[]) {
  const tf = new Map<string, number>();
  for (const token of tokens) tf.set(token, (tf.get(token) || 0) + 1);
  const length = Math.max(tokens.length, 1);
  for (const [token, count] of tf) tf.set(token, count / length);
  return tf;
}

/** Local TF-IDF semantic-ish retrieval (no external embeddings). Never mutates store. */
export function searchMemory(store: MemoryStore, query: string, limit = 8) {
  const queryTokens = tokenizeMemoryText(query).slice(0, 16);
  if (!queryTokens.length) {
    return store.records.slice(0, limit);
  }

  const docs = store.records.map(record => ({
    record,
    tokens: tokenizeMemoryText(`${record.title} ${record.body} ${record.tags.join(" ")}`),
  }));
  const documentCount = Math.max(docs.length, 1);
  const df = new Map<string, number>();
  for (const doc of docs) {
    for (const token of new Set(doc.tokens)) {
      df.set(token, (df.get(token) || 0) + 1);
    }
  }
  const idf = (token: string) => Math.log((1 + documentCount) / (1 + (df.get(token) || 0))) + 1;
  const queryTf = termFrequency(queryTokens);

  const scored = docs.map(doc => {
    if (!doc.tokens.length) return { record: doc.record, score: 0 };
    const docTf = termFrequency(doc.tokens);
    let score = 0;
    for (const [token, qWeight] of queryTf) {
      const dWeight = docTf.get(token) || 0;
      if (!dWeight) continue;
      score += qWeight * dWeight * idf(token);
    }
    if (doc.record.kind === "lesson" && doc.record.promotion === "approved") score += 0.15;
    return { record: doc.record, score };
  });

  return scored
    .filter(item => item.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(item => item.record);
}

export function recordErrorSolution(input: {
  id: string;
  title: string;
  error: string;
  solution: string;
  actorEmail: string;
  sourceId?: string;
  now?: string;
}): MemoryRecord {
  return {
    id: input.id,
    kind: "error_solution",
    title: input.title.slice(0, 160),
    body: `ERROR:\n${input.error.slice(0, 1500)}\n\nSOLUTION:\n${input.solution.slice(0, 2000)}`,
    tags: ["error", "solution"],
    createdAt: input.now || new Date().toISOString(),
    createdBy: input.actorEmail,
    promotion: "none",
    sourceId: input.sourceId,
  };
}

/** Hard rule: memory never authorizes self-modification of IRIS core. */
export function memoryAllowsSelfModify() {
  return false;
}
