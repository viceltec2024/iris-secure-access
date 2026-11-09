/**
 * IRIS — MDN fetcher (segunda fuente live para preguntas técnicas).
 *
 * Consults developer.mozilla.org only, through its public search API.
 * Never invents a source: it returns null on any failure, timeout or
 * irrelevant result, and the caller (iris-cited-answer) only cites a hit
 * it actually received in this execution, with title, URL and
 * consultation date. No API key, no secret, no user data is sent beyond
 * the search query itself.
 *
 * Safety limits, mirroring lookupWikipedia: 4 s timeout, one search
 * page, results capped, excerpt capped at 500 chars, and a relevance
 * check so an unrelated MDN page never backs a general question.
 */

import { extractSearchTopic } from "./iris-query.ts";
import { significantWords } from "./iris-reasoning.ts";

export type MdnHit = {
  title: string;
  url: string;
  excerpt: string;
  language: "es" | "en";
};

const MDN_UA = "IRIS-Secure-Access/1.1 (https://github.com/viceltec2024/iris-secure-access; Ask IRIS)";
const MDN_HOST = /^https:\/\/developer\.mozilla\.org\//i;
const MAX_BODY_CHARS = 300_000;
const TIMEOUT_MS = 4000;

/** Technical topics only: MDN is a web-technology reference, not a general encyclopedia. */
const TECHNICAL = /\b(web|html|css|javascript|typescript|js|ts|api|http|https|fetch|dom|node|react|vue|browser|navegador|array|object|promise|async|await|event|evento|function|funcion|función|variable|loop|bucle|json|xml|sql|regex|git|css grid|flexbox|canvas|svg|websocket|service worker|accessibility|accesibilidad)\b/i;

export function isTechnicalTopic(topic: string): boolean {
  return TECHNICAL.test(String(topic || ""));
}

function relevant(topic: string, hit: { title: string; excerpt: string }): boolean {
  const topicWords = new Set(significantWords(topic));
  if (!topicWords.size) return false;
  const hitWords = new Set(significantWords(`${hit.title} ${hit.excerpt}`));
  return [...topicWords].some(word => hitWords.has(word));
}

type MdnSearchDoc = {
  title?: string;
  slug?: string;
  mdn_url?: string;
  summary?: string;
};

type MdnSearchPayload = {
  documents?: MdnSearchDoc[];
};

export async function lookupMdn(
  topic: string,
  language: "es" | "en",
  fetchFn: typeof fetch = fetch,
): Promise<MdnHit | null> {
  const query = String(topic || "").replace(/\s+/g, " ").trim().slice(0, 140);
  if (query.length < 2 || !isTechnicalTopic(query)) return null;
  const locale = language === "es" ? "es" : "en-US";
  const url = new URL(`https://developer.mozilla.org/api/v1/search`);
  url.search = new URLSearchParams({ q: query, locale }).toString();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetchFn(url.toString(), {
      headers: { Accept: "application/json", "User-Agent": MDN_UA },
      signal: controller.signal,
    }).catch(() => null);
    if (!response?.ok) return null;
    const text = await response.text().catch(() => "");
    if (!text || text.length > MAX_BODY_CHARS) return null;
    const data = JSON.parse(text) as MdnSearchPayload;
    const docs = Array.isArray(data?.documents) ? data.documents : [];
    for (const doc of docs.slice(0, 5)) {
      const title = String(doc?.title || "").trim();
      const slug = String(doc?.slug || "").trim();
      const rawUrl = String(doc?.mdn_url || "").trim();
      const link = rawUrl && MDN_HOST.test(rawUrl)
        ? rawUrl
        : slug
          ? `https://developer.mozilla.org/${locale}/docs/${slug.replace(/^\/+/, "")}`
          : "";
      const excerpt = String(doc?.summary || "").replace(/\s+/g, " ").trim().slice(0, 500);
      if (!title || !link || !excerpt) continue;
      const hit: MdnHit = { title, url: link, excerpt, language };
      if (relevant(query, hit)) return hit;
    }
    return null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** Topic extraction shared with the world path, for tests and callers. */
export function mdnTopicForQuestion(question: string): string {
  return extractSearchTopic(question);
}
