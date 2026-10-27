import {
  recallKnowledge,
  rememberKnowledge,
  seededKnowledgeStore,
  type KnowledgeOrigin,
  type KnowledgeStore,
} from "./iris-knowledge.ts";
import { extractSearchTopic } from "./iris-query.ts";

const WIKI_UA = "IRIS-Secure-Access/1.1 (https://github.com/viceltec2024/iris-secure-access; Ask IRIS)";
const WIKI_HOST = /^https:\/\/(es|en)\.wikipedia\.org\//i;
const DISAMBIGUATION = /\b(puede referirse a|may refer to|desambiguaci[oó]n|disambiguation)\b/i;

type WikiPage = {
  title?: string;
  extract?: string;
  index?: number;
  fullurl?: string;
  pageprops?: { disambiguation?: string };
};

type WikiQuery = { query?: { pages?: WikiPage[] | Record<string, WikiPage> } };

export type WikipediaHit = {
  title: string;
  extract: string;
  url: string;
  language: "es" | "en";
};

async function fetchWiki(url: string, signal: AbortSignal) {
  if (!WIKI_HOST.test(url)) return null;
  try {
    return await fetch(url, {
      headers: { Accept: "application/json", "User-Agent": WIKI_UA },
      signal,
    });
  } catch {
    return null;
  }
}

function wikiPages(data: WikiQuery): WikiPage[] {
  const pages = data.query?.pages;
  if (!pages) return [];
  const list = Array.isArray(pages) ? pages : Object.values(pages);
  return list
    .filter(page => page && typeof page === "object")
    .sort((left, right) => (left.index || 99) - (right.index || 99));
}

function isDisambiguation(page: WikiPage) {
  if (page.pageprops && "disambiguation" in page.pageprops) return true;
  return DISAMBIGUATION.test(String(page.extract || ""));
}

async function queryWikipedia(lang: "es" | "en", topic: string, signal: AbortSignal): Promise<WikipediaHit | null> {
  const url = new URL(`https://${lang}.wikipedia.org/w/api.php`);
  url.search = new URLSearchParams({
    action: "query",
    generator: "search",
    gsrsearch: topic,
    gsrlimit: "5",
    prop: "extracts|pageprops|info",
    exintro: "1",
    explaintext: "1",
    redirects: "1",
    inprop: "url",
    format: "json",
    formatversion: "2",
  }).toString();
  const response = await fetchWiki(url.toString(), signal);
  if (!response?.ok) return null;
  const data = await response.json().catch(() => ({})) as WikiQuery;
  const pages = wikiPages(data);
  const page = pages.find(item => item.extract?.trim() && !isDisambiguation(item)) || pages.find(item => item.extract?.trim());
  const extract = page?.extract?.replace(/\s+/g, " ").trim();
  const title = page?.title?.trim();
  if (!page || !extract || !title || isDisambiguation(page)) return null;
  const link = page.fullurl && WIKI_HOST.test(page.fullurl)
    ? page.fullurl
    : `https://${lang}.wikipedia.org/wiki/${encodeURIComponent(title.replace(/ /g, "_"))}`;
  return { title, extract, url: link, language: lang };
}

export async function lookupWikipedia(topic: string, language: "es" | "en"): Promise<WikipediaHit | null> {
  const query = topic.replace(/\s+/g, " ").trim().slice(0, 140);
  if (query.length < 2) return null;
  const order: Array<"es" | "en"> = language === "es" ? ["es", "en"] : ["en", "es"];
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 4000);
  try {
    for (const lang of order) {
      if (controller.signal.aborted) return null;
      const hit = await queryWikipedia(lang, query, controller.signal);
      if (hit) return hit;
    }
  } finally {
    clearTimeout(timer);
  }
  return null;
}

export function composeWorldAnswer(extract: string, title: string, language: "es" | "en", name: string) {
  const clean = extract.replace(/[\u200B-\u200D\uFEFF]/g, "").replace(/\s+/g, " ").trim();
  const body = clean.split(/(?<=[.!?])\s+/).filter(Boolean).slice(0, 3).join(" ");
  const headed = title && !new RegExp(title.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i").test(body)
    ? `${title}. ${body}`
    : body;
  if (language === "es") {
    return `${name}, esto lo tengo en mi inteligencia: ${headed} Si quieres, lo vemos con un ejemplo. Fuente: Wikipedia.`.replace(/\s+/g, " ").trim();
  }
  return `${name}, this is in my own knowledge: ${headed} Say if you want an example. Source: Wikipedia.`.replace(/\s+/g, " ").trim();
}

export type IrisKnowledgeAnswer = {
  answer: string;
  store: KnowledgeStore;
  origin: KnowledgeOrigin | "wikipedia" | null;
};

export async function resolveIrisKnowledge(input: {
  question: string;
  language: "es" | "en";
  name: string;
  store?: KnowledgeStore;
}): Promise<IrisKnowledgeAnswer> {
  const store = seededKnowledgeStore(input.store);
  const topic = extractSearchTopic(input.question);
  const recalled = recallKnowledge(store, topic, input.language);
  if (recalled) {
    return {
      answer: composeWorldAnswer(recalled.extract, recalled.title, input.language, input.name),
      store,
      origin: recalled.origin,
    };
  }
  const hit = await lookupWikipedia(topic, input.language);
  if (!hit) return { answer: "", store, origin: null };
  const next = rememberKnowledge(store, { topic, title: hit.title, extract: hit.extract, url: hit.url, language: hit.language });
  return {
    answer: composeWorldAnswer(hit.extract, hit.title, input.language, input.name),
    store: next,
    origin: "wikipedia",
  };
}

export async function irisWorldAnswer(question: string, language: "es" | "en", name: string, store?: KnowledgeStore) {
  const resolved = await resolveIrisKnowledge({ question, language, name, store });
  return resolved.answer;
}
