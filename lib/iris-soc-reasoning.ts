/**
 * IRIS — Razonamiento SOC/local con evidencia interna (pendiente de la
 * conexión de razonamiento de PR #35).
 *
 * El problema que resuelve: las respuestas SOC/local NO podían pasar por
 * el razonamiento con citas web (Etapa 2), porque su evidencia es
 * telemetría interna, incidentes y lecciones aprobadas — no hosts web
 * permitidos. Forzarlas por validateSources las habría degradado todas a
 * un falso "No sé" o habría exigido inventar citas. Este módulo cierra
 * ese hueco sin inventar nada:
 *
 *   - La evidencia interna se cita por su propio ID y fuente interna,
 *     con el formato `interno:<kind>:<id>` (p. ej.
 *     `interno:incidente:alert-9`). NUNCA se presenta como URL ni como
 *     host web, y nunca pasa por validateSources.
 *   - Un paso sin evidencia interna queda "sin_datos" y se reporta como
 *     "No sé" en ese paso, nunca como hecho.
 *   - Un paso con evidencia que no respalda la afirmación (sin palabras
 *     significativas en común con el texto de evidencia) también queda
 *     "sin_datos".
 *   - Las contradicciones reutilizan la heurística determinista de
 *     iris-reasoning.ts (negación o número distinto sobre la misma
 *     afirmación compartida); es una heurística, no una garantía.
 *   - Memoria: solo cuentan como evidencia las lecciones APROBADAS por
 *     un humano y los demás registros (notas, errores, resultados) tal
 *     cual; una lección pendiente o rechazada se descarta y se reporta
 *     como descartada.
 *   - Telemetría: un dispositivo solo es "reporte fresco" si su
 *     lastSeenAt está dentro de los 5 minutos (regla del producto);
 *     fuera de esa ventana, su evidencia se marca como no fresca y no
 *     respalda afirmaciones de estado actual.
 *
 * Confianza propia, distinta de la web: "verificado_interno" (todos los
 * pasos verificados con evidencia interna), "parcial_interno" (algunos)
 * y "no_verificado" (ninguno; primera línea "No sé").
 */

import {
  findContradictions,
  significantWords,
} from "./iris-reasoning.ts";
import type { MemoryRecord } from "./iris-memory.ts";

export type SocConfidence = "verificado_interno" | "parcial_interno" | "no_verificado";

export type InternalEvidenceKind =
  | "telemetria"
  | "incidente"
  | "alerta"
  | "leccion_aprobada"
  | "memoria"
  | "dispositivo";

export type InternalEvidence = {
  id: string;
  kind: InternalEvidenceKind;
  title: string;
  /** Texto realmente consultado (extracto, resumen o línea de estado). */
  excerpt: string;
  /** Etiqueta de fuente interna legible, p. ej. "Agente IRIS". */
  sourceLabel: string;
  /** Solo para telemetría/dispositivos: true si el reporte es fresco. */
  fresh?: boolean;
};

export type SocReasoningStepInput = {
  question: string;
  claim?: string;
  evidence: InternalEvidence[];
};

export type SocReasoningStepStatus =
  | "verificado_interno"
  | "sin_datos"
  | "contradiccion";

export type SocReasoningStepResult = {
  index: number;
  question: string;
  claim: string;
  status: SocReasoningStepStatus;
  evidence: InternalEvidence[];
  droppedEvidence: Array<{ id: string; reason: string }>;
  missing: string | null;
};

export type SocReasonedAnswer = {
  answer: string;
  directAnswer: string;
  reasoning: string[];
  confidence: SocConfidence;
  evidence: InternalEvidence[];
  droppedEvidence: Array<{ id: string; reason: string }>;
  steps: SocReasoningStepResult[];
  contradictions: string[];
  unknownSteps: string[];
  coherent: boolean;
  language: "es" | "en";
};

/** Identificador de cita interna: nunca una URL, nunca un host web. */
export function internalEvidenceRef(evidence: InternalEvidence): string {
  return `interno:${evidence.kind}:${evidence.id}`;
}

export function formatInternalCitations(evidence: InternalEvidence[], language: "es" | "en"): string {
  const heading = language === "es" ? "Evidencia interna consultada:" : "Internal evidence consulted:";
  return [
    heading,
    ...evidence.map((item, index) => `${index + 1}. [${internalEvidenceRef(item)}] ${item.title} — ${item.sourceLabel}`),
  ].join("\n");
}

/** Regla del producto: reporte fresco = lastSeenAt dentro de 5 minutos. */
export function isFreshTelemetry(lastSeenAt: string | null | undefined, now = Date.now()): boolean {
  if (!lastSeenAt) return false;
  const parsed = Date.parse(lastSeenAt);
  return Number.isFinite(parsed) && now - parsed <= 5 * 60 * 1000 && now - parsed >= 0;
}

/**
 * Palabras genéricas que aparecen en casi toda evidencia interna y que,
 * solas, no respaldan nada ("alerta" no prueba que sea de firewall).
 * El respaldo exige palabras distintivas compartidas: al menos 2 cuando
 * la afirmación tiene más de una palabra significativa, o 1 cuando la
 * afirmación tiene una sola (p. ej. "ONLINE"). Más estricto que el
 * chequeo de la Etapa 2 web, a propósito: la evidencia interna es
 * homogénea y el chequeo laxo la habría dado por válida siempre.
 */
const GENERIC_EVIDENCE_WORDS = new Set([
  "alerta", "alert", "incidente", "incident", "dispositivo", "device",
  "estado", "status", "equipo", "reporte", "report", "agente", "agent",
  "iris", "interno", "internal",
]);

function evidenceSupports(claim: string, evidence: InternalEvidence[]): boolean {
  const claimWords = significantWords(claim);
  if (!claimWords.length) return false;
  const text = evidence.map(item => `${item.title} ${item.excerpt}`).join(" ");
  const evidenceWords = new Set(significantWords(text));
  const shared = claimWords.filter(word => evidenceWords.has(word));
  if (!shared.length) return false;
  const distinctive = shared.filter(word => !GENERIC_EVIDENCE_WORDS.has(word));
  if (claimWords.length <= 1) return distinctive.length >= 1;
  return distinctive.length >= 2;
}

/** Una lección solo es evidencia si un humano la aprobó; si no, se descarta. */
export function memoryRecordToInternalEvidence(
  record: MemoryRecord,
): { evidence: InternalEvidence | null; droppedReason: string | null } {
  if (record.kind === "lesson" && record.promotion !== "approved") {
    return { evidence: null, droppedReason: "lesson_not_approved" };
  }
  return {
    evidence: {
      id: record.id,
      kind: record.kind === "lesson" ? "leccion_aprobada" : "memoria",
      title: record.title,
      excerpt: record.body.slice(0, 500),
      sourceLabel: record.kind === "lesson" ? "Lección aprobada por un humano" : "Memoria interna IRIS",
    },
    droppedReason: null,
  };
}

export function alertToInternalEvidence(input: {
  id: string;
  code: string;
  severity: string;
  status: string;
  deviceName?: string;
}): InternalEvidence {
  return {
    id: input.id,
    kind: "alerta",
    title: `${input.code.replaceAll("_", " ")} · ${input.severity}`,
    excerpt: `Alerta ${input.code} en ${input.deviceName || "dispositivo"}; estado ${input.status}.`,
    sourceLabel: "Agente IRIS",
  };
}

export function incidentToInternalEvidence(input: {
  id: string;
  title: string;
  subject: string;
  severity: string;
  status: string;
  recommendation?: string;
}): InternalEvidence {
  return {
    id: input.id,
    kind: "incidente",
    title: input.title || input.subject,
    excerpt: `${input.subject}. Severidad ${input.severity}, estado ${input.status}. ${input.recommendation || ""}`.trim(),
    sourceLabel: "Incidente interno IRIS",
  };
}

export function deviceToInternalEvidence(input: {
  id: string;
  name: string;
  status: string;
  lastSeenAt?: string | null;
  controls?: string;
  now?: number;
}): InternalEvidence {
  const fresh = isFreshTelemetry(input.lastSeenAt, input.now);
  return {
    id: input.id,
    kind: input.status === "ONLINE" && fresh ? "telemetria" : "dispositivo",
    title: `${input.name} · ${input.status}`,
    excerpt: fresh
      ? `${input.name} ONLINE con reporte fresco${input.controls ? `: ${input.controls}` : ""}.`
      : `${input.name} ${input.status}: sin reporte fresco en los últimos 5 minutos.`,
    sourceLabel: "Agente IRIS",
    fresh,
  };
}

export function verifySocSteps(
  steps: SocReasoningStepInput[],
  language: "es" | "en",
): { results: SocReasoningStepResult[]; contradictions: string[] } {
  const claims = steps.map(step => String(step.claim || "").trim());
  const contradictionPairs = new Set<number>();
  const contradictions = findContradictions(claims);
  for (const text of contradictions) {
    const match = /Pasos (\d+) y (\d+)/.exec(text);
    if (match) {
      contradictionPairs.add(Number(match[1]) - 1);
      contradictionPairs.add(Number(match[2]) - 1);
    }
  }
  const es = language === "es";
  const results: SocReasoningStepResult[] = steps.map((step, index) => {
    const question = String(step.question || "").trim();
    const claim = String(step.claim || "").trim();
    const evidence = (step.evidence || []).filter(item => item && typeof item.id === "string" && item.id.trim());
    const droppedEvidence: Array<{ id: string; reason: string }> = [];
    // La evidencia no fresca no respalda afirmaciones de estado actual.
    const usable = evidence.filter(item => {
      if (item.fresh === false && (item.kind === "telemetria" || item.kind === "dispositivo")) {
        droppedEvidence.push({ id: item.id, reason: "stale_telemetry" });
        return false;
      }
      return true;
    });
    if (contradictionPairs.has(index)) {
      return {
        index, question, claim, status: "contradiccion", evidence: usable,
        droppedEvidence,
        missing: es
          ? "Esta afirmación se contradice con otro paso y no se presenta como hecho."
          : "This claim contradicts another step and is not presented as fact.",
      };
    }
    if (!claim) {
      return {
        index, question, claim, status: "sin_datos", evidence: usable,
        droppedEvidence,
        missing: es ? "No hay una afirmación verificada para este paso." : "There is no verified claim for this step.",
      };
    }
    if (!usable.length) {
      return {
        index, question, claim, status: "sin_datos", evidence: usable,
        droppedEvidence,
        missing: es
          ? "No hay evidencia interna consultada para este paso."
          : "No internal evidence was consulted for this step.",
      };
    }
    if (!evidenceSupports(claim, usable)) {
      return {
        index, question, claim, status: "sin_datos", evidence: usable,
        droppedEvidence,
        missing: es
          ? "La evidencia interna consultada no respalda esta afirmación."
          : "The consulted internal evidence does not support this claim.",
      };
    }
    return { index, question, claim, status: "verificado_interno", evidence: usable, droppedEvidence, missing: null };
  });
  return { results, contradictions };
}

export function buildSocReasonedAnswer(input: {
  language: "es" | "en";
  question: string;
  steps: SocReasoningStepInput[];
}): SocReasonedAnswer {
  const language = input.language;
  const { results, contradictions } = verifySocSteps(input.steps, language);
  const verifiedSteps = results.filter(step => step.status === "verificado_interno");
  const unknownSteps = results.filter(step => step.status !== "verificado_interno");
  const allEvidence = results.flatMap(step => step.evidence);
  const allDropped = results.flatMap(step => step.droppedEvidence);
  let confidence: SocConfidence = "no_verificado";
  if (verifiedSteps.length === results.length && results.length > 0) confidence = "verificado_interno";
  else if (verifiedSteps.length > 0) confidence = "parcial_interno";

  const noSe = language === "es" ? "No sé" : "I don't know";
  const reasoning: string[] = results.map(step => {
    if (step.status === "verificado_interno") {
      return language === "es"
        ? `Paso ${step.index + 1} (verificado_interno): ${step.question} — ${step.claim}`
        : `Step ${step.index + 1} (verified_internal): ${step.question} — ${step.claim}`;
    }
    return language === "es"
      ? `Paso ${step.index + 1} (${step.status}): ${step.question} — ${noSe}: ${step.missing}`
      : `Step ${step.index + 1} (${step.status}): ${step.question} — ${noSe}: ${step.missing}`;
  });

  let directAnswer: string;
  let answer: string;
  if (!verifiedSteps.length) {
    const firstLine = language === "es"
      ? "No sé la respuesta con evidencia interna verificada."
      : "I don't know the answer from verified internal evidence.";
    directAnswer = firstLine;
    const sections = [firstLine];
    if (reasoning.length) sections.push(language === "es" ? "Razonamiento:" : "Reasoning:", ...reasoning);
    if (contradictions.length) sections.push(language === "es" ? "Contradicciones detectadas:" : "Contradictions detected:", ...contradictions);
    answer = sections.join("\n");
  } else {
    directAnswer = verifiedSteps.map(step => step.claim).join(" ");
    const sections = [directAnswer];
    if (reasoning.length) sections.push(language === "es" ? "Razonamiento:" : "Reasoning:", ...reasoning);
    if (unknownSteps.length) {
      sections.push(language === "es" ? "Pendiente de verificar:" : "Pending verification:");
      for (const step of unknownSteps) {
        sections.push(language === "es"
          ? `- Paso ${step.index + 1}: ${noSe} — ${step.missing}`
          : `- Step ${step.index + 1}: ${noSe} — ${step.missing}`);
      }
    }
    if (contradictions.length) sections.push(language === "es" ? "Contradicciones detectadas:" : "Contradictions detected:", ...contradictions);
    if (allEvidence.length) sections.push(formatInternalCitations(allEvidence, language));
    answer = sections.join("\n\n");
  }

  return {
    answer, directAnswer, reasoning, confidence,
    evidence: allEvidence, droppedEvidence: allDropped,
    steps: results, contradictions, unknownSteps: unknownSteps.map(step => step.question),
    coherent: contradictions.length === 0,
    language,
  };
}
