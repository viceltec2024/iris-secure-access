/**
 * IRIS own knowledge — Wikipedia lives inside the local mind.
 * Seeded public facts answer without a network call. Learned facts persist
 * in app_settings and never modify IRIS core. Attribution stays Wikipedia.
 */

export const IRIS_KNOWLEDGE_SETTING = "iris_own_knowledge";
const MAX_LEARNED = 80;
const MAX_EXTRACT = 900;

export type KnowledgeOrigin = "seed" | "learned";

export type KnowledgeFact = {
  topic: string;
  aliases: string[];
  title: string;
  extract: string;
  url: string;
  language: "es" | "en";
  origin: KnowledgeOrigin;
  learnedAt: string;
};

export type KnowledgeStore = {
  facts: KnowledgeFact[];
  maxFacts: number;
};

export function normalizeKnowledgeTopic(value: string) {
  return value
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLocaleLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function emptyKnowledgeStore(): KnowledgeStore {
  return { facts: [], maxFacts: MAX_LEARNED };
}

export function parseKnowledgeStore(value: string): KnowledgeStore {
  try {
    const parsed = JSON.parse(value) as Partial<KnowledgeStore>;
    const facts = Array.isArray(parsed.facts) ? parsed.facts.filter(isKnowledgeFact) : [];
    return { facts, maxFacts: MAX_LEARNED };
  } catch {
    return emptyKnowledgeStore();
  }
}

export function serializeLearnedKnowledge(store: KnowledgeStore) {
  return JSON.stringify({
    facts: store.facts.filter(item => item.origin === "learned").slice(0, MAX_LEARNED),
    maxFacts: MAX_LEARNED,
  });
}

function isKnowledgeFact(value: unknown): value is KnowledgeFact {
  if (!value || typeof value !== "object") return false;
  const row = value as KnowledgeFact;
  return Boolean(
    typeof row.topic === "string"
    && Array.isArray(row.aliases)
    && typeof row.title === "string"
    && typeof row.extract === "string"
    && typeof row.url === "string"
    && (row.language === "es" || row.language === "en")
    && (row.origin === "seed" || row.origin === "learned")
  );
}

function wikiUrl(language: "es" | "en", title: string) {
  return `https://${language}.wikipedia.org/wiki/${encodeURIComponent(title.replace(/ /g, "_"))}`;
}

function seedFact(
  topic: string,
  aliases: string[],
  title: string,
  extract: string,
  language: "es" | "en" = "es",
): KnowledgeFact {
  return {
    topic: normalizeKnowledgeTopic(topic),
    aliases: aliases.map(normalizeKnowledgeTopic).filter(Boolean),
    title,
    extract,
    url: wikiUrl(language, title),
    language,
    origin: "seed",
    learnedAt: "seed",
  };
}

/** Compact public-knowledge seed so IRIS can answer without waiting on Wikipedia. */
export function irisKnowledgeSeed(): KnowledgeFact[] {
  return [
    seedFact("fotosintesis", ["fotosíntesis", "photosynthesis"], "Fotosíntesis",
      "La fotosíntesis es el proceso de plantas, algas y algunas bacterias para convertir luz, agua y dióxido de carbono en azúcares y oxígeno. Ahí queda guardada la energía de la luz en forma química."),
    seedFact("marte", ["planeta marte", "mars"], "Marte (planeta)",
      "Marte es el cuarto planeta del sistema solar y el segundo más pequeño después de Mercurio. Se le llama planeta rojo por el óxido de hierro de su superficie."),
    seedFact("marie curie", ["maria sklodowska", "madame curie", "sklodowska curie"], "Marie Curie",
      "Marie Curie fue una física y química polaca nacionalizada francesa, pionera de la radiactividad. Es la única persona con dos premios Nobel en disciplinas científicas distintas: Física y Química."),
    seedFact("einstein", ["albert einstein"], "Albert Einstein",
      "Albert Einstein fue un físico teórico que formuló la relatividad especial y general. Su trabajo cambió la idea de espacio, tiempo y gravedad, y recibió el Nobel de Física en 1921."),
    seedFact("inteligencia artificial", ["ia", "ai", "artificial intelligence"], "Inteligencia artificial",
      "La inteligencia artificial es el campo de la informática que construye sistemas capaces de percibir, aprender o decidir. IRIS usa una mente local propia: el SOC lo lee del agente y el conocimiento del mundo vive dentro de IRIS."),
    seedFact("wikipedia", ["enciclopedia wikipedia"], "Wikipedia",
      "Wikipedia es una enciclopedia libre y colaborativa. IRIS la tiene integrada en su mente: consulta artículos públicos, los guarda y te responde con su propia voz, citando la fuente."),
    seedFact("tierra", ["planeta tierra", "earth"], "Tierra",
      "La Tierra es el tercer planeta del sistema solar y el único donde se conoce vida. Gira alrededor del Sol y tiene una atmósfera que permite agua líquida en la superficie."),
    seedFact("sol", ["estrella sol", "the sun"], "Sol",
      "El Sol es la estrella del sistema solar. Es una esfera de plasma cuya luz y calor hacen posible el clima y la vida en la Tierra."),
    seedFact("luna", ["the moon", "satelite natural"], "Luna",
      "La Luna es el satélite natural de la Tierra. Provoca las mareas y es el único cuerpo al que han llegado personas."),
    seedFact("agua", ["h2o", "water"], "Agua",
      "El agua es una sustancia de hidrógeno y oxígeno, esencial para la vida. Cubre la mayor parte de la superficie de la Tierra en océanos, hielo y vapor."),
    seedFact("oxigeno", ["oxígeno", "oxygen"], "Oxígeno",
      "El oxígeno es un elemento químico esencial para la respiración de la mayoría de los seres vivos. Las plantas lo liberan durante la fotosíntesis."),
    seedFact("internet", ["la red", "world wide web"], "Internet",
      "Internet es la red mundial de computadoras que intercambia datos con protocolos comunes. Encima de ella viven la web, el correo y los servicios que usa IRIS."),
    seedFact("electricidad", ["electricity"], "Electricidad",
      "La electricidad es el conjunto de fenómenos de las cargas eléctricas: corriente, voltaje y campos. Mueve motores, redes y los equipos que IRIS protege."),
    seedFact("adn", ["dna", "acido desoxirribonucleico"], "ADN",
      "El ADN es la molécula que guarda la información genética de los seres vivos. Su doble hélice permite copiarse y dirigir la síntesis de proteínas."),
  ];
}

export function seededKnowledgeStore(learned: KnowledgeStore = emptyKnowledgeStore()): KnowledgeStore {
  const seed = irisKnowledgeSeed();
  const seedTopics = new Set(seed.map(item => item.topic));
  const extras = learned.facts.filter(item => item.origin === "learned" && !seedTopics.has(item.topic));
  return { facts: [...seed, ...extras].slice(0, seed.length + MAX_LEARNED), maxFacts: MAX_LEARNED };
}

function factMatches(fact: KnowledgeFact, topic: string) {
  if (!topic) return false;
  if (fact.topic === topic) return true;
  if (fact.aliases.includes(topic)) return true;
  const title = normalizeKnowledgeTopic(fact.title);
  if (title === topic) return true;
  if (topic.length >= 4 && (fact.topic.includes(topic) || title.includes(topic))) return true;
  return false;
}

export function recallKnowledge(store: KnowledgeStore, topic: string, language: "es" | "en") {
  const needle = normalizeKnowledgeTopic(topic);
  if (needle.length < 2) return null;
  const facts = store.facts.length ? store.facts : irisKnowledgeSeed();
  const sameLang = facts.filter(item => item.language === language);
  const pool = sameLang.length ? sameLang : facts;
  return pool.find(item => factMatches(item, needle)) || null;
}

export function rememberKnowledge(
  store: KnowledgeStore,
  input: { topic: string; title: string; extract: string; url: string; language: "es" | "en" },
): KnowledgeStore {
  const topic = normalizeKnowledgeTopic(input.topic || input.title);
  if (topic.length < 2) return store;
  const extract = input.extract.replace(/\s+/g, " ").trim().slice(0, MAX_EXTRACT);
  if (!extract) return store;
  const next: KnowledgeFact = {
    topic,
    aliases: [normalizeKnowledgeTopic(input.title)].filter(alias => alias && alias !== topic),
    title: input.title.trim().slice(0, 160),
    extract,
    url: input.url,
    language: input.language,
    origin: "learned",
    learnedAt: new Date().toISOString(),
  };
  const others = store.facts.filter(item => item.topic !== topic && item.origin === "learned");
  return {
    facts: [...irisKnowledgeSeed(), next, ...others].slice(0, irisKnowledgeSeed().length + MAX_LEARNED),
    maxFacts: MAX_LEARNED,
  };
}
