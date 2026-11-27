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

export type MemoryStore = {
  records: MemoryRecord[];
  /** Soft cap to avoid unbounded growth in appSettings JSON. */
  maxRecords: number;
  /** Monotonic revision for optimistic concurrency / CAS. */
  revision: number;
};

const MAX_RECORDS = 200;
const MAX_BODY = 4000;

export function emptyMemoryStore(): MemoryStore {
  return { records: [], maxRecords: MAX_RECORDS, revision: 0 };
}

export function parseMemoryStore(value: string): MemoryStore {
  try {
    const parsed = JSON.parse(value) as Partial<MemoryStore>;
    const seen = new Set<string>();
    const records = (Array.isArray(parsed.records) ? parsed.records : [])
      .filter(isMemoryRecord)
      .map(normalizeStoredRecord)
      .filter(record => (seen.has(record.id) ? false : (seen.add(record.id), true)));
    const revision = typeof parsed.revision === "number" && Number.isFinite(parsed.revision) && parsed.revision >= 0 ? Math.floor(parsed.revision) : 0;
    return { records, maxRecords: MAX_RECORDS, revision };
  } catch {
    return emptyMemoryStore();
  }
}

function isMemoryRecord(value: unknown): value is MemoryRecord {
  if (!value || typeof value !== "object") return false;
  const row = value as MemoryRecord;
  return Boolean(
    row.id
    && typeof row.id === "string"
    && typeof row.title === "string"
    && typeof row.body === "string"
    && typeof row.createdBy === "string"
    && ["eval_result", "mission_result", "lesson", "operator_note", "error_solution"].includes(row.kind)
    && ["none", "pending", "approved", "rejected"].includes(row.promotion)
  );
}

/** Un registro guardado con `tags` corrupto rompía searchMemory (tags.join). */
function normalizeStoredRecord(record: MemoryRecord): MemoryRecord {
  const tags = Array.isArray(record.tags) ? record.tags.filter((tag): tag is string => typeof tag === "string") : [];
  const createdAt = typeof record.createdAt === "string" ? record.createdAt : "";
  const normalized: MemoryRecord = { ...record, tags, createdAt };
  // Solo una lección puede estar aprobada, y solo con un humano registrado.
  if (normalized.kind !== "lesson" && normalized.promotion !== "none") normalized.promotion = "none";
  if (normalized.promotion === "approved" && !isHumanActor(normalized.promotedBy)) normalized.promotion = "pending";
  return normalized;
}

function isHumanActor(value: unknown): value is string {
  return typeof value === "string" && value.includes("@");
}

/**
 * Las lecciones aprobadas las activó un humano: el tope de registros nunca
 * las borra. Las pendientes se protegen hasta MAX_PROTECTED_PENDING (las más
 * recientes), para que evaluaciones fallidas repetidas no hagan crecer la
 * memoria sin límite. Se descartan primero los registros más antiguos.
 */
const MAX_PROTECTED_PENDING = 50;

function capRecords(records: MemoryRecord[], max: number): MemoryRecord[] {
  if (records.length <= max) return records;
  let pendingRoom = MAX_PROTECTED_PENDING;
  const isProtected = records.map(item => {
    if (item.kind !== "lesson") return false;
    if (item.promotion === "approved") return true;
    if (item.promotion === "pending" && pendingRoom > 0) { pendingRoom -= 1; return true; }
    return false;
  });
  let room = Math.max(max - isProtected.filter(Boolean).length, 0);
  return records.filter((_, index) => {
    if (isProtected[index]) return true;
    if (room > 0) { room -= 1; return true; }
    return false;
  });
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
  if (!record.id || store.records.some(item => item.id === record.id)) {
    throw new Error("duplicate_memory_id");
  }
  // Append-only: nada entra ya aprobado. Una lección nueva queda pendiente y
  // solo decideLessonPromotion (con un humano) puede activarla.
  const { promotedAt: _promotedAt, promotedBy: _promotedBy, ...rest } = record;
  void _promotedAt; void _promotedBy;
  const promotion: MemoryRecord["promotion"] = record.kind === "lesson"
    ? (record.promotion === "none" || record.promotion === "rejected" ? record.promotion : "pending")
    : "none";
  const next: MemoryRecord = {
    ...rest,
    promotion,
    title: record.title.slice(0, 160),
    body: record.body.slice(0, MAX_BODY),
    tags: (Array.isArray(record.tags) ? record.tags : []).slice(0, 12).map(tag => String(tag).slice(0, 40)),
  };
  return {
    ...store,
    revision: (store.revision || 0) + 1,
    records: capRecords([next, ...store.records], store.maxRecords || MAX_RECORDS),
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
