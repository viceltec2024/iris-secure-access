/**
 * IRIS Ask reasoning connector — wires the tested reasoning library into
 * the live Ask IRIS route, honestly.
 *
 * What it does:
 *   - For general/world questions it actually consults Wikipedia through
 *     irisWorldAnswerWithCitations (Etapa 2), then runs the result through
 *     buildReasonedAnswer: question decomposed into steps, each step
 *     verified against the source actually consulted, contradictions
 *     detected, final format direct answer -> steps -> sources ->
 *     confidence. A step with no verified source is reported as "No sé"
 *     and never presented as fact.
 *
 * What it deliberately does NOT do:
 *   - It does not run SOC / local-context answers through citation
 *     reasoning. Their evidence is internal IRIS telemetry, incidents and
 *     approved lessons — not allowed web hosts — so forcing them through
 *     validateSources would either drop them all to a false "No sé" or
 *     require inventing citations. Those answers keep their existing
 *     route and are never presented as citation-verified.
 *   - It never invents a source. If Wikipedia returns no hit, it returns
 *     null and the route keeps its existing local fallback, instead of
 *     fabricating a reasoned answer with no source.
 *   - It never touches Guardian (the route blocks before this runs), the
 *     human gate, or memory rules.
 */
import {
  buildReasonedAnswer,
  decomposeQuestion,
  significantWords,
  type ReasonedAnswer,
} from "./iris-reasoning.ts";
import { irisWorldAnswerWithCitations } from "./iris-cited-answer.ts";
import {
  alertToInternalEvidence,
  buildSocReasonedAnswer,
  deviceToInternalEvidence,
  incidentToInternalEvidence,
  memoryRecordToInternalEvidence,
  type InternalEvidence,
  type SocReasonedAnswer,
} from "./iris-soc-reasoning.ts";
import type { MemoryRecord } from "./iris-memory.ts";

export type WorldReasonedAnswer = ReasonedAnswer & {
  /** The decomposed questions, also useful for clients on any answer. */
  stepQuestions: string[];
};

/**
 * Build a reasoned world answer, or null when no allowed source was
 * actually consulted (caller must fall back to its existing answer).
 */
export async function buildWorldReasonedAnswer(input: {
  question: string;
  language: "es" | "en";
}): Promise<WorldReasonedAnswer | null> {
  const cited = await irisWorldAnswerWithCitations({
    question: input.question,
    language: input.language,
  });
  if (cited.confidence === "no_verificado" || !cited.sources.length) {
    return null;
  }
  // cited.answer is "body\n\nFuentes consultadas:\n..." — the claim must
  // be the body only, never the citation block itself.
  const body = cited.answer
    .split(/\n\n(?:Fuentes consultadas|Sources consulted):/)[0]
    .trim();
  const stepQuestions = decomposeQuestion(input.question);
  const excerpt = cited.sources[0]?.excerpt || body;
  const reasoned = buildReasonedAnswer({
    language: input.language,
    question: input.question,
    steps: stepQuestions.map(question => ({
      question,
      claim: body,
      sources: cited.sources,
      evidence: excerpt,
    })),
  });
  return { ...reasoned, stepQuestions };
}

// ---------------------------------------------------------------------------
// SOC/local (Etapas 3–4, pendiente de PR #35): conecta la evidencia interna
// al razonamiento SIN inventar citas web.
//
// Construye una respuesta razonada SOC a partir del contexto que ya reúne
// resolveIrisAsk (dispositivos, alertas, incidente seleccionado, lecciones
// aprobadas y hits de memoria). Cada paso descompuesto recibe solo la
// evidencia interna cuyas palabras coinciden con la pregunta del paso;
// un paso sin evidencia coincidente queda "sin_datos" ("No sé").
// Devuelve null cuando no hay evidencia interna o cuando ningún paso se
// verifica, para que la ruta conserve su respuesta local existente en
// vez de sustituirla por un "No sé" menos útil. La ruta ask-iris NO se
// toca en esta entrega: cablear este conector en la ruta es el paso
// siguiente, con revisión y verificación en vivo (sesión + DB), porque
// cambiaría respuestas visibles sin poder probarlo aquí.
// ---------------------------------------------------------------------------

export type SocAnalystContext = {
  devices?: Array<{
    id: string;
    name: string;
    status: string;
    lastSeenAt?: string | null;
    telemetry?: Record<string, unknown>;
  }>;
  alerts?: Array<{
    id?: string;
    deviceId: string;
    code: string;
    severity: string;
    status: string;
  }>;
  incident?: {
    id: string;
    title: string;
    subject: string;
    severity: string;
    status: string;
    recommendation?: string;
  } | null;
  lessons?: MemoryRecord[];
  memoryHits?: MemoryRecord[];
};

export function buildSocReasonedAnswerFromContext(input: {
  question: string;
  language: "es" | "en";
  context: SocAnalystContext;
  now?: number;
}): (SocReasonedAnswer & { stepQuestions: string[]; droppedMemory: Array<{ id: string; reason: string }> }) | null {
  const now = input.now ?? Date.now();
  const pool: InternalEvidence[] = [];
  const droppedMemory: Array<{ id: string; reason: string }> = [];

  for (const device of input.context.devices || []) {
    const telemetry = device.telemetry || {};
    const controls: string[] = [];
    if (typeof telemetry.firewallEnabled === "boolean") {
      controls.push(telemetry.firewallEnabled ? "firewall activo" : "firewall apagado");
    }
    if (typeof telemetry.fileVaultEnabled === "boolean") {
      controls.push(telemetry.fileVaultEnabled ? "FileVault encendido" : "FileVault apagado");
    }
    pool.push(deviceToInternalEvidence({
      id: device.id,
      name: device.name,
      status: device.status,
      lastSeenAt: device.lastSeenAt ?? null,
      controls: controls.join(", "),
      now,
    }));
  }
  const deviceNames = new Map((input.context.devices || []).map(device => [device.id, device.name]));
  for (const alert of input.context.alerts || []) {
    if (alert.status === "RESOLVED") continue;
    pool.push(alertToInternalEvidence({
      id: alert.id || `${alert.deviceId}:${alert.code}`,
      code: alert.code,
      severity: alert.severity,
      status: alert.status,
      deviceName: deviceNames.get(alert.deviceId),
    }));
  }
  if (input.context.incident?.id) {
    pool.push(incidentToInternalEvidence(input.context.incident));
  }
  for (const record of [...(input.context.lessons || []), ...(input.context.memoryHits || [])]) {
    const converted = memoryRecordToInternalEvidence(record);
    if (converted.evidence) pool.push(converted.evidence);
    else if (converted.droppedReason) droppedMemory.push({ id: record.id, reason: converted.droppedReason });
  }
  if (!pool.length) return null;

  const stepQuestions = decomposeQuestion(input.question);
  const reasoned = buildSocReasonedAnswer({
    language: input.language,
    question: input.question,
    steps: stepQuestions.map(question => {
      const questionWords = new Set(significantWords(question));
      const candidates = pool.filter(item => {
        const textWords = new Set(significantWords(`${item.title} ${item.excerpt}`));
        return [...questionWords].some(word => textWords.has(word));
      });
      // Sin candidatos para este paso, el paso queda sin evidencia y el
      // razonamiento lo reporta como "No sé" (nunca como hecho).
      const claim = candidates.length
        ? candidates.map(item => item.title).join("; ")
        : "";
      return { question, claim, evidence: candidates };
    }),
  });
  if (reasoned.confidence === "no_verificado") return null;
  return { ...reasoned, stepQuestions, droppedMemory };
}
