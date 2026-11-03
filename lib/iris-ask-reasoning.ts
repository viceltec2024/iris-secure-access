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
  type ReasonedAnswer,
} from "./iris-reasoning.ts";
import { irisWorldAnswerWithCitations } from "./iris-cited-answer.ts";

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
