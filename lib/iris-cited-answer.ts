/**
 * IRIS cited answers — Etapa 2, razonamiento y fuentes confiables.
 *
 * This module never fetches and never invents a source. It only formats
 * and validates sources the caller actually consulted in this execution,
 * and it derives confidence from those validated sources:
 *   - 2+ distinct allowed hosts  -> "verificado"
 *   - 1 allowed host             -> "parcial"
 *   - 0 valid sources            -> "no_verificado"
 * With no valid source the answer's first line says "No sé" / "I don't
 * know" and no unverified body is presented as fact.
 *
 * Allowed hosts today: Wikipedia editions and MDN. The live world path
 * (irisWorldAnswerWithCitations) consults Wikipedia and, for technical
 * questions, MDN through lib/iris-mdn.ts — both actually consulted in
 * this execution. Two distinct allowed hosts -> "verificado"; one ->
 * "parcial"; none -> "no_verificado". A source that was not actually
 * fetched in this execution is never cited.
 */

import { extractSearchTopic } from "./iris-query.ts";
import { lookupWikipedia, type WikipediaHit } from "./iris-world-knowledge.ts";
import { lookupMdn, type MdnHit } from "./iris-mdn.ts";

export type CitedConfidence = "verificado" | "parcial" | "no_verificado";

export type CitedSource = {
  title: string;
  url: string;
  consultedAt: string;
  excerpt?: string;
};

export type CitedAnswer = {
  answer: string;
  confidence: CitedConfidence;
  sources: CitedSource[];
  droppedSources: Array<{ title: string; reason: string }>;
  language: "es" | "en";
};

const ALLOWED_HOST = /^(?:[a-z]{2}\.wikipedia\.org|developer\.mozilla\.org)$/i;

export function isAllowedSourceUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" && ALLOWED_HOST.test(parsed.hostname);
  } catch {
    return false;
  }
}

export function validateSources(sources: CitedSource[]): {
  valid: CitedSource[];
  dropped: Array<{ title: string; reason: string }>;
} {
  const valid: CitedSource[] = [];
  const dropped: Array<{ title: string; reason: string }> = [];
  for (const source of sources || []) {
    const title = String(source?.title || "").trim();
    if (!title) {
      dropped.push({ title: "", reason: "missing_title" });
      continue;
    }
    if (!isAllowedSourceUrl(String(source?.url || ""))) {
      dropped.push({ title, reason: "host_not_allowed" });
      continue;
    }
    const consulted = Date.parse(String(source?.consultedAt || ""));
    if (Number.isNaN(consulted)) {
      dropped.push({ title, reason: "missing_or_invalid_consultedAt" });
      continue;
    }
    valid.push({
      title,
      url: String(source.url),
      consultedAt: new Date(consulted).toISOString(),
      excerpt: source.excerpt ? String(source.excerpt).slice(0, 500) : undefined,
    });
  }
  return { valid, dropped };
}

export function deriveConfidence(sources: CitedSource[]): CitedConfidence {
  const hosts = new Set(
    sources.map(item => {
      try {
        return new URL(item.url).hostname.toLowerCase();
      } catch {
        return "";
      }
    }).filter(Boolean),
  );
  if (hosts.size >= 2) return "verificado";
  if (hosts.size === 1) return "parcial";
  return "no_verificado";
}

export function formatCitations(sources: CitedSource[], language: "es" | "en"): string {
  const heading = language === "es" ? "Fuentes consultadas:" : "Sources consulted:";
  return [
    heading,
    ...sources.map((source, index) => {
      const date = source.consultedAt.slice(0, 10);
      return `${index + 1}. ${source.title} — ${source.url} (consultado: ${date})`;
    }),
  ].join("\n");
}

export function buildCitedAnswer(input: {
  language: "es" | "en";
  answerBody: string;
  sources: CitedSource[];
}): CitedAnswer {
  const language = input.language;
  const { valid, dropped } = validateSources(input.sources);
  const confidence = deriveConfidence(valid);
  if (confidence === "no_verificado") {
    const firstLine =
      language === "es"
        ? "No sé la respuesta con datos verificados."
        : "I don't know the answer from verified data.";
    const missing =
      language === "es"
        ? "Para verificarlo hace falta consultar al menos una fuente permitida (por ejemplo, Wikipedia) y citarla con título, URL y fecha de consulta."
        : "To verify it, at least one allowed source (for example, Wikipedia) must be consulted and cited with title, URL and consultation date.";
    return { answer: `${firstLine}\n${missing}`, confidence, sources: [], droppedSources: dropped, language };
  }
  const body = String(input.answerBody || "").trim();
  const answer = body
    ? `${body}\n\n${formatCitations(valid, language)}`
    : formatCitations(valid, language);
  return { answer, confidence, sources: valid, droppedSources: dropped, language };
}

function firstSentences(extract: string, max = 3): string {
  return String(extract || "")
    .replace(/[\u200B-\u200D\uFEFF]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .split(/(?<=[.!?])\s+/)
    .filter(Boolean)
    .slice(0, max)
    .join(" ");
}

/**
 * Live world path: consults Wikipedia through lookupWikipedia and, for
 * technical questions, MDN through lookupMdn — both actually fetched in
 * this execution. One hit -> "parcial". Two distinct allowed hosts ->
 * "verificado". No hit -> "no_verificado" with a first-line "No sé".
 * Never a fabricated citation.
 */
export async function irisWorldAnswerWithCitations(input: {
  question: string;
  language: "es" | "en";
  name?: string;
}): Promise<CitedAnswer> {
  const language = input.language;
  const topic = extractSearchTopic(input.question);
  const [wikiResult, mdnResult] = await Promise.allSettled([
    (async (): Promise<WikipediaHit | null> => {
      try {
        return await lookupWikipedia(topic, language);
      } catch {
        return null;
      }
    })(),
    (async (): Promise<MdnHit | null> => {
      try {
        return await lookupMdn(topic, language);
      } catch {
        return null;
      }
    })(),
  ]);
  const hit = wikiResult.status === "fulfilled" ? wikiResult.value : null;
  const mdnHit = mdnResult.status === "fulfilled" ? mdnResult.value : null;
  if (!hit && !mdnHit) {
    return buildCitedAnswer({ language, answerBody: "", sources: [] });
  }
  const primary = hit || { title: mdnHit!.title, extract: mdnHit!.excerpt };
  const body = firstSentences(primary.extract, 3);
  const headed = new RegExp(
    primary.title.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
    "i",
  ).test(body)
    ? body
    : `${primary.title}. ${body}`;
  const sources: CitedAnswer["sources"] = [];
  if (hit) {
    sources.push({
      title: hit.title,
      url: hit.url,
      consultedAt: new Date().toISOString(),
      excerpt: hit.extract.slice(0, 500),
    });
  }
  if (mdnHit) {
    sources.push({
      title: mdnHit.title,
      url: mdnHit.url,
      consultedAt: new Date().toISOString(),
      excerpt: mdnHit.excerpt.slice(0, 500),
    });
  }
  return buildCitedAnswer({ language, answerBody: headed, sources });
}
