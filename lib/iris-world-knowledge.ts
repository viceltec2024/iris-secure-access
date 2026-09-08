import { extractSearchTopic } from "./iris-query.ts";

type WikiSearch = { query?: { search?: Array<{ title?: string }> } };
type WikiSummary = { title?: string; extract?: string; description?: string; content_urls?: { desktop?: { page?: string } } };

async function fetchWiki(url: string, headers: Record<string, string>, ms = 3500) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    return await fetch(url, { headers, signal: controller.signal });
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export function composeWorldAnswer(extract: string, title: string, language: "es" | "en", name: string) {
  const clean = extract.replace(/\s+/g, " ").trim();
  const body = clean.split(/(?<=[.!?])\s+/).filter(Boolean).slice(0, 3).join(" ");
  const headed = title && !new RegExp(title.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i").test(body)
    ? `${title}. ${body}`
    : body;
  if (language === "es") {
    return `${headed} ${name}, si quieres lo vemos con un ejemplo.`.replace(/\s+/g, " ").trim();
  }
  return `${headed} ${name}, say if you want an example.`.replace(/\s+/g, " ").trim();
}

export async function irisWorldAnswer(question: string, language: "es" | "en", name: string) {
  const topic = extractSearchTopic(question);
  if (!topic || topic.length < 2) return "";
  const lang = language === "es" ? "es" : "en";
  const headers = { Accept: "application/json", "User-Agent": "IRIS-Secure-Access/1.0 (Ask IRIS)" };
  const search = await fetchWiki(`https://${lang}.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(topic)}&srlimit=1&format=json`, headers);
  if (!search?.ok) return "";
  const found = await search.json().catch(() => ({})) as WikiSearch;
  const title = found.query?.search?.[0]?.title?.trim();
  if (!title) return "";
  const summary = await fetchWiki(`https://${lang}.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title)}`, headers);
  if (!summary?.ok) return "";
  const page = await summary.json().catch(() => ({})) as WikiSummary;
  const extract = page.extract?.trim();
  if (!extract) return "";
  return composeWorldAnswer(extract, page.title || title, language, name);
}
