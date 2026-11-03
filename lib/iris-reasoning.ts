/**
 * IRIS reasoning — coherent answers, step by step.
 *
 * Pure, deterministic, no network, no secrets, no execution. This module
 * does NOT generate facts: the caller supplies, per step, the claim it
 * wants to present and the sources it actually consulted in this
 * execution. The module only:
 *   1. decomposes a question into steps,
 *   2. identifies what is known and what is missing per step,
 *   3. verifies each step against its validated sources (reusing the
 *      Etapa 2 citation rules: 2+ distinct allowed hosts -> verificado,
 *      1 -> parcial, 0 -> no_verificado),
 *   4. detects contradictions between step claims, and
 *   5. drafts a coherent final answer: direct answer first, then a
 *      summarized reasoning, then sources. A step that is not verified
 *      is reported as "No sé" at that point — its claim is never
 *      presented as fact — and a contradicted step is never presented
 *      as fact either.
 *
 * Limits, stated honestly: verification is source-based, not semantic
 * entailment. A claim is "supported" when its validated sources exist
 * and, if evidence text is supplied, at least one significant word of
 * the claim appears in that evidence. Contradiction detection is a
 * deterministic heuristic (negation over a shared claim, or a different
 * number for the same shared claim), not a full natural-language
 * understanding. It catches the contradictions it is designed for and
 * must not be presented as proof that no contradiction exists.
 */

import {
  deriveConfidence,
  formatCitations,
  validateSources,
  type CitedConfidence,
  type CitedSource,
} from "./iris-cited-answer.ts";

export type ReasoningStepStatus =
  | "verificado"
  | "parcial"
  | "sin_datos"
  | "contradiccion";

export type ReasoningStepInput = {
  question: string;
  claim?: string;
  sources: CitedSource[];
  /** Optional excerpt actually read for this step; used for support check. */
  evidence?: string;
};

export type ReasoningStepResult = {
  index: number;
  question: string;
  claim: string;
  status: ReasoningStepStatus;
  sources: CitedSource[];
  droppedSources: Array<{ title: string; reason: string }>;
  missing: string | null;
};

export type ReasonedAnswer = {
  answer: string;
  directAnswer: string;
  reasoning: string[];
  confidence: CitedConfidence;
  sources: CitedSource[];
  droppedSources: Array<{ title: string; reason: string }>;
  steps: ReasoningStepResult[];
  contradictions: string[];
  unknownSteps: string[];
  coherent: boolean;
  language: "es" | "en";
};

const STOPWORDS = new Set([
  "el", "la", "los", "las", "un", "una", "unos", "unas", "de", "del",
  "en", "y", "o", "que", "es", "son", "se", "su", "sus", "con", "por",
  "para", "como", "the", "a", "an", "is", "are", "of", "in", "and", "or",
  "to", "for", "with", "que", "cual", "cuando", "donde", "porque",
]);

export function normalizeReasoningText(text: string): string {
  return String(text || "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[áàäâ]/g, "a")
    .replace(/[éèëê]/g, "e")
    .replace(/[íìïî]/g, "i")
    .replace(/[óòöô]/g, "o")
    .replace(/[úùüû]/g, "u")
    .replace(/ñ/g, "n")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function significantWords(text: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const word of normalizeReasoningText(text).split(" ").filter(Boolean)) {
    if (word.length <= 3 || STOPWORDS.has(word)) continue;
    if (!seen.has(word)) {
      seen.add(word);
      out.push(word);
    }
  }
  return out;
}

function sharedWords(a: string, b: string): string[] {
  const setB = new Set(significantWords(b));
  return significantWords(a).filter(word => setB.has(word));
}

function numbersOf(text: string): string[] {
  return normalizeReasoningText(text).match(/\d+(?:\.\d+)?/g) || [];
}

/**
 * Heuristic contradiction: two claims share at least two significant
 * words, and either (a) one negates what the other affirms (removing
 * "no"/"not" makes them identical, e.g. "es un mamifero" vs
 * "no es un mamifero"), or (b) they give different numbers for the same
 * shared claim. Anything else is not a contradiction.
 */
export function claimsContradict(a: string, b: string): boolean {
  const normA = normalizeReasoningText(a);
  const normB = normalizeReasoningText(b);
  if (!normA || !normB || normA === normB) return false;
  if (sharedWords(a, b).length < 2) return false;
  // Negation usually precedes the verb ("no es un mamifero"), not the
  // noun, so compare the claims with "no"/"not" removed: if they become
  // identical, one negates exactly what the other affirms.
  const stripNegation = (text: string) =>
    text.split(" ").filter(word => word !== "no" && word !== "not").join(" ");
  const negatedA = /\bno\b|\bnot\b/.test(normA);
  const negatedB = /\bno\b|\bnot\b/.test(normB);
  if (negatedA !== negatedB && stripNegation(normA) === stripNegation(normB)) return true;
  const numsA = numbersOf(a);
  const numsB = numbersOf(b);
  if (numsA.length && numsB.length && numsA.join(",") !== numsB.join(",")) return true;
  return false;
}

export function findContradictions(claims: string[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < claims.length; i++) {
    for (let j = i + 1; j < claims.length; j++) {
      if (claims[i] && claims[j] && claimsContradict(claims[i], claims[j])) {
        out.push(`Pasos ${i + 1} y ${j + 1} se contradicen: "${claims[i]}" frente a "${claims[j]}".`);
      }
    }
  }
  return out;
}

/**
 * Decompose a question into steps, deterministically. Splits on
 * question marks and on " y " / " and " between clauses, trims, dedupes
 * (case/diacritic-insensitive) and caps at 5 steps. An empty or
 * undecomposable question yields one step: the question itself.
 */
export function decomposeQuestion(question: string): string[] {
  const raw = String(question || "").trim();
  if (!raw) return [];
  const parts = raw
    .split(/[?¿]/)
    .flatMap(part => part.split(/\s+y\s+|\s+and\s+/i))
    .map(part => part.trim().replace(/^[¿¡\s]+|[?!\s]+$/g, "").trim())
    .filter(Boolean);
  const seen = new Set<string>();
  const steps: string[] = [];
  for (const part of parts) {
    const key = normalizeReasoningText(part);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    steps.push(part);
  }
  if (!steps.length) steps.push(raw);
  return steps.slice(0, 5);
}

function evidenceSupports(claim: string, evidence: string): boolean {
  const claimWords = significantWords(claim);
  if (!claimWords.length) return false;
  const evidenceWords = new Set(significantWords(evidence));
  return claimWords.some(word => evidenceWords.has(word));
}

export function verifyReasoningSteps(
  steps: ReasoningStepInput[],
  language: "es" | "en",
): { results: ReasoningStepResult[]; contradictions: string[] } {
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
  const results: ReasoningStepResult[] = steps.map((step, index) => {
    const question = String(step.question || "").trim();
    const claim = String(step.claim || "").trim();
    const { valid, dropped } = validateSources(step.sources || []);
    if (contradictionPairs.has(index)) {
      return {
        index, question, claim, status: "contradiccion", sources: valid,
        droppedSources: dropped,
        missing: language === "es"
          ? "Esta afirmación se contradice con otro paso y no se presenta como hecho."
          : "This claim contradicts another step and is not presented as fact.",
      };
    }
    if (!claim) {
      return {
        index, question, claim, status: "sin_datos", sources: valid,
        droppedSources: dropped,
        missing: language === "es"
          ? "No hay una afirmación verificada para este paso."
          : "There is no verified claim for this step.",
      };
    }
    if (!valid.length) {
      return {
        index, question, claim, status: "sin_datos", sources: valid,
        droppedSources: dropped,
        missing: language === "es"
          ? "Falta una fuente permitida consultada para este paso."
          : "A consulted allowed source is missing for this step.",
      };
    }
    if (step.evidence !== undefined && !evidenceSupports(claim, step.evidence)) {
      return {
        index, question, claim, status: "sin_datos", sources: valid,
        droppedSources: dropped,
        missing: language === "es"
          ? "La evidencia consultada no respalda esta afirmación."
          : "The consulted evidence does not support this claim.",
      };
    }
    const hosts = new Set(valid.map(item => {
      try { return new URL(item.url).hostname.toLowerCase(); } catch { return ""; }
    }).filter(Boolean));
    return {
      index, question, claim, status: hosts.size >= 2 ? "verificado" : "parcial",
      sources: valid, droppedSources: dropped, missing: null,
    };
  });
  return { results, contradictions };
}

/**
 * Build the coherent final answer. Only verified/parcial step claims
 * enter the direct answer; sin_datos and contradiccion steps are
 * reported explicitly as "No sé" / contradiction, never as facts.
 * Overall confidence reuses the Etapa 2 derivation over all validated
 * sources, capped at "parcial" when any step is unverified, and
 * "no_verificado" (first line "No sé") when no step is verified.
 */
export function buildReasonedAnswer(input: {
  language: "es" | "en";
  question: string;
  steps: ReasoningStepInput[];
}): ReasonedAnswer {
  const language = input.language;
  const { results, contradictions } = verifyReasoningSteps(input.steps, language);
  const verifiedSteps = results.filter(step => step.status === "verificado" || step.status === "parcial");
  const unknownSteps = results.filter(step => step.status === "sin_datos" || step.status === "contradiccion");
  const allSources = results.flatMap(step => step.sources);
  const allDropped = results.flatMap(step => step.droppedSources);
  let confidence = deriveConfidence(allSources);
  if (!verifiedSteps.length) confidence = "no_verificado";
  else if (unknownSteps.length) confidence = "parcial";

  const noSe = language === "es" ? "No sé" : "I don't know";
  const reasoning: string[] = results.map(step => {
    if (step.status === "verificado" || step.status === "parcial") {
      return language === "es"
        ? `Paso ${step.index + 1} (${step.status}): ${step.question} — ${step.claim}`
        : `Step ${step.index + 1} (${step.status}): ${step.question} — ${step.claim}`;
    }
    return language === "es"
      ? `Paso ${step.index + 1} (${step.status}): ${step.question} — ${noSe}: ${step.missing}`
      : `Step ${step.index + 1} (${step.status}): ${step.question} — ${noSe}: ${step.missing}`;
  });

  let directAnswer: string;
  let answer: string;
  if (!verifiedSteps.length) {
    const firstLine = language === "es"
      ? "No sé la respuesta con datos verificados."
      : "I don't know the answer from verified data.";
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
    if (allSources.length) sections.push(formatCitations(allSources, language));
    answer = sections.join("\n\n");
  }

  return {
    answer, directAnswer, reasoning, confidence,
    sources: allSources, droppedSources: allDropped,
    steps: results, contradictions, unknownSteps: unknownSteps.map(step => step.question),
    coherent: contradictions.length === 0,
    language,
  };
}
