import { extractSearchTopic } from "./iris-query.ts";

type WikiSearch = { query?: { search?: Array<{ title?: string }> } };
type WikiSummary = { title?: string; extract?: string; description?: string; content_urls?: { desktop?: { page?: string } } };

export function composeWorldAnswer(extract: string, title: string, language: "es" | "en", name: string) {
  const clean = extract.replace(/\s+/g, " ").trim();
  if (language === "es") {
    return `${clean} Eso es lo esencial sobre ${title}. Si quieres, ${name}, lo bajo a un ejemplo, te lo explico más simple o lo aplicamos a tu caso.`;
  }
  return `${clean} That is the core of ${title}. If you want, ${name}, I can give an example, simplify it, or apply it to your situation.`;
}

export async function irisWorldAnswer(question: string, language: "es" | "en", name: string) {
  const topic = extractSearchTopic(question);
  if (!topic || topic.length < 2) return "";
  const lang = language === "es" ? "es" : "en";
  const headers = { Accept: "application/json", "User-Agent": "IRIS-Secure-Access/1.0 (Ask IRIS)" };
  const search = await fetch(`https://${lang}.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(topic)}&srlimit=1&format=json`, { headers }).catch(() => null);
  if (!search?.ok) return "";
  const found = await search.json().catch(() => ({})) as WikiSearch;
  const title = found.query?.search?.[0]?.title?.trim();
  if (!title) return "";
  const summary = await fetch(`https://${lang}.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title)}`, { headers }).catch(() => null);
  if (!summary?.ok) return "";
  const page = await summary.json().catch(() => ({})) as WikiSummary;
  const extract = page.extract?.trim();
  if (!extract) return "";
  return composeWorldAnswer(extract, page.title || title, language, name);
}
