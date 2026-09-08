export type MarketKind = "index" | "equity" | "etf" | "crypto";

export type MarketInstrument = {
  symbol: string;
  name: string;
  kind: MarketKind;
  group: "indices" | "actions" | "crypto" | "latam";
};

export type MarketQuote = {
  symbol: string;
  name: string;
  kind: MarketKind;
  group: MarketInstrument["group"];
  price: number;
  previousClose: number;
  change: number;
  changePercent: number;
  currency: string;
  exchange: string;
  volume: number;
  asOf: number;
  live: boolean;
};

export type MarketBar = {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
};

export type MarketAnalysis = {
  symbol: string;
  price: number;
  sma20: number | null;
  sma50: number | null;
  rsi14: number | null;
  trend: "up" | "down" | "sideways";
  support: number | null;
  resistance: number | null;
  volumeBias: "high" | "normal" | "low";
  score: number;
  stance: "watch" | "constructive" | "cautious" | "overheated";
};

export type MarketIdea = MarketQuote & MarketAnalysis & {
  reason: string;
  lesson: string;
};

export type MarketBoard = {
  updatedAt: string;
  live: boolean;
  quotes: MarketQuote[];
  ideas: MarketIdea[];
  briefing: { es: string; en: string };
};

export const LIVE_REFRESH_MS = 8_000;
export const LIVE_CHART_TTL_MS = 5_000;
export const LIVE_BOARD_TTL_MS = 8_000;
export const LIVE_CORE_SYMBOLS = ["^GSPC", "^DJI", "^IXIC", "^VIX", "SPY", "QQQ", "AAPL", "MSFT", "NVDA", "TSLA", "AMZN", "META", "BTC-USD", "ETH-USD", "SOL-USD", "AMXL.MX"];

export const MARKET_UNIVERSE: MarketInstrument[] = [
  { symbol: "^GSPC", name: "S&P 500", kind: "index", group: "indices" },
  { symbol: "^DJI", name: "Dow Jones", kind: "index", group: "indices" },
  { symbol: "^IXIC", name: "Nasdaq", kind: "index", group: "indices" },
  { symbol: "^RUT", name: "Russell 2000", kind: "index", group: "indices" },
  { symbol: "^VIX", name: "VIX", kind: "index", group: "indices" },
  { symbol: "^GDAXI", name: "DAX", kind: "index", group: "indices" },
  { symbol: "^FTSE", name: "FTSE 100", kind: "index", group: "indices" },
  { symbol: "^N225", name: "Nikkei 225", kind: "index", group: "indices" },
  { symbol: "SPY", name: "SPDR S&P 500", kind: "etf", group: "indices" },
  { symbol: "QQQ", name: "Invesco QQQ", kind: "etf", group: "indices" },
  { symbol: "AAPL", name: "Apple", kind: "equity", group: "actions" },
  { symbol: "MSFT", name: "Microsoft", kind: "equity", group: "actions" },
  { symbol: "NVDA", name: "NVIDIA", kind: "equity", group: "actions" },
  { symbol: "AMZN", name: "Amazon", kind: "equity", group: "actions" },
  { symbol: "GOOGL", name: "Alphabet", kind: "equity", group: "actions" },
  { symbol: "META", name: "Meta", kind: "equity", group: "actions" },
  { symbol: "TSLA", name: "Tesla", kind: "equity", group: "actions" },
  { symbol: "AVGO", name: "Broadcom", kind: "equity", group: "actions" },
  { symbol: "JPM", name: "JPMorgan", kind: "equity", group: "actions" },
  { symbol: "AMD", name: "AMD", kind: "equity", group: "actions" },
  { symbol: "NFLX", name: "Netflix", kind: "equity", group: "actions" },
  { symbol: "BRK-B", name: "Berkshire", kind: "equity", group: "actions" },
  { symbol: "BTC-USD", name: "Bitcoin", kind: "crypto", group: "crypto" },
  { symbol: "ETH-USD", name: "Ethereum", kind: "crypto", group: "crypto" },
  { symbol: "SOL-USD", name: "Solana", kind: "crypto", group: "crypto" },
  { symbol: "AMXL.MX", name: "América Móvil", kind: "equity", group: "latam" },
  { symbol: "WALMEX.MX", name: "Walmart México", kind: "equity", group: "latam" },
  { symbol: "GFNORTEO.MX", name: "Banorte", kind: "equity", group: "latam" },
  { symbol: "FEMSAUBD.MX", name: "FEMSA", kind: "equity", group: "latam" },
  { symbol: "NU", name: "Nu Holdings", kind: "equity", group: "latam" },
];

export const MARKET_RANGES = {
  "1d": { range: "1d", interval: "1m" },
  "5d": { range: "5d", interval: "15m" },
  "1mo": { range: "1mo", interval: "1d" },
  "6mo": { range: "6mo", interval: "1d" },
  "1y": { range: "1y", interval: "1d" },
  "5y": { range: "5y", interval: "1wk" },
} as const;

export type MarketRange = keyof typeof MARKET_RANGES;

const SYMBOL_PATTERN = /^[A-Z0-9.^%=-]{1,24}$/;
const MARKET_QUESTION = /\b(bolsa|mercado|acci[oó]n|acciones|stock|stocks|nasdaq|s&p|dow|vix|ticker|gr[aá]fico|grafico|cotiz|opci[oó]n|opciones|invertir|inversi[oó]n|crypto|bitcoin|ethereum|nvda|apple|tesla|robinhood)\b/i;

export function isMarketSymbol(value: string) {
  return SYMBOL_PATTERN.test(value.trim().toUpperCase());
}

export function normalizeMarketSymbol(value: string) {
  return value.trim().toUpperCase().replace(/\s+/g, "");
}

export function isMarketRange(value: string): value is MarketRange {
  return Object.prototype.hasOwnProperty.call(MARKET_RANGES, value);
}

export function isMarketQuestion(question: string) {
  return MARKET_QUESTION.test(question) || Boolean(extractTicker(question));
}

const TICKER_STOPWORDS = new Set(["COMO", "PARA", "ESTA", "ESTE", "ESTO", "TODO", "BOLSA", "PRECIO", "MEJOR", "AHORA", "VIVO", "LIVE", "THE", "AND", "QUE", "CUAL", "SON", "LAS", "LOS", "DEL", "UNA", "POR", "CON", "IRIS", "JAR", "USD", "CEO", "OK", "VA", "EN"]);

export function extractTicker(question: string) {
  if (/bitcoin/i.test(question)) return "BTC-USD";
  if (/ethereum|ether\b/i.test(question)) return "ETH-USD";
  if (/\bsolana\b/i.test(question)) return "SOL-USD";
  const tokens = [...question.toUpperCase().matchAll(/\b(\^[A-Z]{2,6}|[A-Z]{1,5}(?:-[A-Z]{3})?(?:\.[A-Z]{1,4})?)\b/g)].map(item => item[1]);
  const known = tokens.find(token => MARKET_UNIVERSE.some(item => item.symbol === token || item.symbol === `${token}-USD`));
  if (known) return MARKET_UNIVERSE.some(item => item.symbol === known) ? known : `${known}-USD`;
  const ticker = [...tokens].reverse().find(token => !TICKER_STOPWORDS.has(token) && isMarketSymbol(token));
  return ticker || "";
}

export function sma(values: number[], period: number) {
  if (values.length < period) return null;
  const window = values.slice(-period);
  return round(window.reduce((sum, value) => sum + value, 0) / period, 4);
}

export function rsi(values: number[], period = 14) {
  if (values.length <= period) return null;
  let gain = 0;
  let loss = 0;
  for (let index = values.length - period; index < values.length; index += 1) {
    const delta = values[index] - values[index - 1];
    if (delta >= 0) gain += delta;
    else loss -= delta;
  }
  if (loss === 0) return 100;
  const relative = (gain / period) / (loss / period);
  return round(100 - 100 / (1 + relative), 2);
}

export function analyzeSeries(symbol: string, bars: MarketBar[]): MarketAnalysis {
  const closes = bars.map(bar => bar.close).filter(value => Number.isFinite(value) && value > 0);
  const volumes = bars.map(bar => bar.volume).filter(value => Number.isFinite(value));
  const price = closes.at(-1) || 0;
  const sma20 = sma(closes, Math.min(20, closes.length));
  const sma50 = sma(closes, Math.min(50, closes.length >= 50 ? 50 : closes.length));
  const rsi14 = rsi(closes);
  const recent = closes.slice(-20);
  const support = recent.length ? round(Math.min(...recent), 4) : null;
  const resistance = recent.length ? round(Math.max(...recent), 4) : null;
  const avgVolume = volumes.length ? volumes.reduce((sum, value) => sum + value, 0) / volumes.length : 0;
  const lastVolume = volumes.at(-1) || 0;
  const volumeBias = !avgVolume ? "normal" : lastVolume > avgVolume * 1.4 ? "high" : lastVolume < avgVolume * 0.6 ? "low" : "normal";
  const trend = sma20 != null && price > sma20 * 1.008 && (sma50 == null || sma20 >= sma50)
    ? "up"
    : sma20 != null && price < sma20 * 0.992
      ? "down"
      : "sideways";
  let score = 50;
  if (trend === "up") score += 18;
  if (trend === "down") score -= 16;
  if (rsi14 != null && rsi14 >= 45 && rsi14 <= 65) score += 14;
  if (rsi14 != null && rsi14 > 75) score -= 18;
  if (rsi14 != null && rsi14 < 30) score += 6;
  if (volumeBias === "high" && trend === "up") score += 10;
  if (volumeBias === "high" && trend === "down") score -= 8;
  score = Math.max(1, Math.min(99, Math.round(score)));
  const stance = rsi14 != null && rsi14 > 75 ? "overheated" : trend === "down" || (rsi14 != null && rsi14 < 35) ? "cautious" : trend === "up" && score >= 62 ? "constructive" : "watch";
  return { symbol, price, sma20, sma50, rsi14, trend, support, resistance, volumeBias, score, stance };
}

export function ideaCopy(quote: MarketQuote, analysis: MarketAnalysis, language: "es" | "en"): { reason: string; lesson: string } {
  const es = language === "es";
  const change = `${quote.changePercent >= 0 ? "+" : ""}${quote.changePercent.toFixed(2)}%`;
  if (analysis.stance === "overheated") {
    return {
      reason: es
        ? `${quote.name} sube ${change}, pero el RSI ${analysis.rsi14} está caliente. No es la mejor entrada inmediata.`
        : `${quote.name} is up ${change}, but RSI ${analysis.rsi14} is hot. It is not the cleanest immediate entry.`,
      lesson: es
        ? "Cuando el RSI pasa de 70, el gráfico enseña euforia. El precio puede seguir, pero el riesgo de recorte sube."
        : "When RSI moves above 70, the chart is teaching euphoria. Price can keep running, but pullback risk rises.",
    };
  }
  if (analysis.stance === "constructive") {
    return {
      reason: es
        ? `${quote.name} cotiza sobre su media de 20${analysis.sma50 ? " y la de 50" : ""}. Momentum ${change}, lectura ${analysis.score}/100.`
        : `${quote.name} is holding above its 20-day average${analysis.sma50 ? " and the 50-day" : ""}. Momentum ${change}, reading ${analysis.score}/100.`,
      lesson: es
        ? "Una tendencia alcista se enseña así: el precio camina sobre las medias y el volumen confirma. IRIS la marca como lectura fuerte, no como promesa."
        : "An uptrend teaches this: price walks above the averages and volume confirms. IRIS marks it as a strong reading, not a promise.",
    };
  }
  if (analysis.stance === "cautious") {
    return {
      reason: es
        ? `${quote.name} está ${change}. El precio perdió la media corta. IRIS pide paciencia, no persecución.`
        : `${quote.name} is ${change}. Price lost the short average. IRIS wants patience, not a chase.`,
      lesson: es
        ? "Si el precio rompe por debajo de la media de 20, el gráfico está avisando debilidad. Espera un piso o un rebote claro."
        : "If price breaks below the 20-day average, the chart is warning of weakness. Wait for a floor or a clean bounce.",
    };
  }
  return {
    reason: es
      ? `${quote.name} se mueve ${change} en rango. IRIS la vigila, todavía no es la mejor opción.`
      : `${quote.name} is moving ${change} in a range. IRIS is watching it; it is not the best option yet.`,
    lesson: es
      ? "Un mercado lateral enseña espera. Las mejores opciones aparecen cuando el precio elige un lado con volumen."
      : "A sideways market teaches waiting. The better options appear when price chooses a side with volume.",
  };
}

export function rankIdeas(quotes: MarketQuote[], analyses: MarketAnalysis[], language: "es" | "en") {
  const bySymbol = new Map(analyses.map(item => [item.symbol, item]));
  return quotes
    .map(quote => {
      const analysis = bySymbol.get(quote.symbol);
      if (!analysis) return null;
      const copy = ideaCopy(quote, analysis, language);
      return { ...quote, ...analysis, ...copy };
    })
    .filter((item): item is MarketIdea => Boolean(item))
    .sort((left, right) => right.score - left.score)
    .slice(0, 5);
}

export function teachChart(quote: MarketQuote, analysis: MarketAnalysis, language: "es" | "en") {
  const es = language === "es";
  const trendText = analysis.trend === "up" ? (es ? "alcista" : "uptrend") : analysis.trend === "down" ? (es ? "bajista" : "downtrend") : (es ? "lateral" : "sideways");
  return es
    ? `Mira ${quote.symbol} como te lo enseñaría un analista: el precio está en ${formatMoney(analysis.price, quote.currency)}. La media de 20 queda en ${formatMoney(analysis.sma20, quote.currency)} y la de 50 en ${formatMoney(analysis.sma50, quote.currency)}. El piso reciente es ${formatMoney(analysis.support, quote.currency)} y el techo ${formatMoney(analysis.resistance, quote.currency)}. RSI ${analysis.rsi14 ?? "—"}. La tendencia se lee ${trendText}. Esto es una clase sobre el gráfico, no una orden de compra.`
    : `Read ${quote.symbol} the way an analyst would teach it: price is ${formatMoney(analysis.price, quote.currency)}. The 20-day average is ${formatMoney(analysis.sma20, quote.currency)} and the 50-day is ${formatMoney(analysis.sma50, quote.currency)}. Recent support is ${formatMoney(analysis.support, quote.currency)} and resistance is ${formatMoney(analysis.resistance, quote.currency)}. RSI ${analysis.rsi14 ?? "—"}. The trend reads ${trendText}. This is a chart lesson, not a buy order.`;
}

export function briefingFromBoard(quotes: MarketQuote[], ideas: MarketIdea[]) {
  const spy = quotes.find(item => item.symbol === "^GSPC" || item.symbol === "SPY");
  const nasdaq = quotes.find(item => item.symbol === "^IXIC" || item.symbol === "QQQ");
  const vix = quotes.find(item => item.symbol === "^VIX");
  const best = ideas[0];
  const es = spy
    ? `IRIS en vivo. El S&P va ${signed(spy.changePercent)} y el Nasdaq ${nasdaq ? signed(nasdaq.changePercent) : "sin dato"}.${vix ? ` El VIX está en ${vix.price.toFixed(2)}.` : ""} ${best ? `Lectura en vivo más limpia: ${best.symbol} (${best.score}/100). ${best.reason}` : "Sincronizando lecturas en vivo."} Nada se compra hasta que tú apruebes.`
    : "IRIS se está conectando en vivo a la bolsa.";
  const en = spy
    ? `IRIS is live. The S&P is ${signed(spy.changePercent)} and Nasdaq is ${nasdaq ? signed(nasdaq.changePercent) : "unavailable"}.${vix ? ` VIX is ${vix.price.toFixed(2)}.` : ""} ${best ? `Live reading: ${best.symbol} (${best.score}/100). ${best.reason}` : "Syncing live readings."} Nothing is bought until you approve.`
    : "IRIS is connecting live to the market.";
  return { es, en };
}

export function chartUrl(symbol: string, range: MarketRange) {
  const spec = MARKET_RANGES[range];
  const url = new URL(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}`);
  url.searchParams.set("interval", spec.interval);
  url.searchParams.set("range", spec.range);
  url.searchParams.set("includePrePost", "true");
  return url.toString();
}

export function searchUrl(query: string) {
  const url = new URL("https://query1.finance.yahoo.com/v1/finance/search");
  url.searchParams.set("q", query.slice(0, 40));
  url.searchParams.set("quotesCount", "8");
  url.searchParams.set("newsCount", "0");
  return url.toString();
}

export function parseChartPayload(payload: unknown, fallback?: MarketInstrument) {
  const root = payload as { chart?: { result?: Array<{ meta?: Record<string, unknown>; timestamp?: number[]; indicators?: { quote?: Array<{ open?: Array<number | null>; high?: Array<number | null>; low?: Array<number | null>; close?: Array<number | null>; volume?: Array<number | null> }> } }> } };
  const result = root.chart?.result?.[0];
  if (!result?.timestamp?.length) return null;
  const quote = result.indicators?.quote?.[0];
  const bars: MarketBar[] = result.timestamp.map((time, index) => ({
    time: time * 1000,
    open: Number(quote?.open?.[index]),
    high: Number(quote?.high?.[index]),
    low: Number(quote?.low?.[index]),
    close: Number(quote?.close?.[index]),
    volume: Number(quote?.volume?.[index] || 0),
  })).filter(bar => Number.isFinite(bar.close) && bar.close > 0);
  if (!bars.length) return null;
  const meta = result.meta || {};
  const price = Number(meta.regularMarketPrice ?? bars.at(-1)?.close);
  const previousClose = Number(meta.chartPreviousClose ?? meta.previousClose ?? bars.at(0)?.close);
  const change = price - previousClose;
  const instrument = fallback || MARKET_UNIVERSE.find(item => item.symbol === String(meta.symbol || ""));
  const asOf = Number(meta.regularMarketTime) > 0 ? Number(meta.regularMarketTime) * 1000 : (bars.at(-1)?.time || Date.now());
  const snapshot: MarketQuote = {
    symbol: String(meta.symbol || instrument?.symbol || ""),
    name: String(meta.shortName || meta.longName || instrument?.name || meta.symbol || ""),
    kind: instrument?.kind || "equity",
    group: instrument?.group || "actions",
    price,
    previousClose,
    change,
    changePercent: previousClose ? (change / previousClose) * 100 : 0,
    currency: String(meta.currency || "USD"),
    exchange: String(meta.fullExchangeName || meta.exchangeName || ""),
    volume: Number(meta.regularMarketVolume ?? bars.at(-1)?.volume ?? 0),
    asOf,
    live: Date.now() - asOf <= 20 * 60 * 1000,
  };
  return { quote: snapshot, bars, analysis: analyzeSeries(snapshot.symbol, bars) };
}

type CacheEntry<T> = { at: number; value: T };
const memory = new Map<string, CacheEntry<unknown>>();

function cached<T>(key: string, ttlMs: number, load: () => Promise<T>) {
  const hit = memory.get(key) as CacheEntry<T> | undefined;
  if (hit && Date.now() - hit.at < ttlMs) return Promise.resolve(hit.value);
  return load().then(value => {
    memory.set(key, { at: Date.now(), value });
    return value;
  });
}

async function yahoo<T>(url: string) {
  const response = await fetch(url, {
    headers: {
      Accept: "application/json",
      "User-Agent": "Mozilla/5.0 IRIS-Secure-Access",
    },
  });
  if (!response.ok) throw new Error(`Market feed unavailable (${response.status})`);
  return response.json() as Promise<T>;
}

async function mapPool<T, R>(items: T[], size: number, worker: (item: T) => Promise<R>) {
  const results: R[] = [];
  for (let index = 0; index < items.length; index += size) {
    results.push(...await Promise.all(items.slice(index, index + size).map(worker)));
  }
  return results;
}

export async function fetchMarketChart(symbol: string, range: MarketRange = "6mo") {
  const normalized = normalizeMarketSymbol(symbol);
  if (!isMarketSymbol(normalized)) throw new Error("Invalid symbol");
  const ttl = range === "1d" ? LIVE_CHART_TTL_MS : LIVE_BOARD_TTL_MS;
  return cached(`chart:${normalized}:${range}`, ttl, async () => {
    const payload = await yahoo(chartUrl(normalized, range));
    const parsed = parseChartPayload(payload, MARKET_UNIVERSE.find(item => item.symbol === normalized));
    if (!parsed) throw new Error("No chart data");
    return parsed;
  });
}

export async function fetchLiveTape() {
  return cached("live-tape", LIVE_CHART_TTL_MS, async () => {
    const core = MARKET_UNIVERSE.filter(item => LIVE_CORE_SYMBOLS.includes(item.symbol));
    const rows = await mapPool(core, 8, async instrument => {
      try {
        const chart = await fetchMarketChart(instrument.symbol, "1d");
        return { ...chart.quote, name: instrument.name, kind: instrument.kind, group: instrument.group };
      } catch {
        return null;
      }
    });
    const quotes = rows.filter((item): item is MarketQuote => Boolean(item));
    return { updatedAt: new Date().toISOString(), live: quotes.some(item => item.live), quotes };
  });
}

export async function fetchMarketBoard(language: "es" | "en" = "es"): Promise<MarketBoard> {
  return cached(`board:${language}`, LIVE_BOARD_TTL_MS, async () => {
    const rows = await mapPool(MARKET_UNIVERSE, 6, async instrument => {
      try {
        const chart = await fetchMarketChart(instrument.symbol, instrument.kind === "index" ? "5d" : "1mo");
        return { quote: { ...chart.quote, name: instrument.name, kind: instrument.kind, group: instrument.group }, analysis: chart.analysis };
      } catch {
        return null;
      }
    });
    const ready = rows.filter((item): item is { quote: MarketQuote; analysis: MarketAnalysis } => Boolean(item));
    const quotes = ready.map(item => item.quote);
    const ideas = rankIdeas(quotes.filter(item => item.kind !== "index"), ready.map(item => item.analysis), language);
    return {
      updatedAt: new Date().toISOString(),
      live: quotes.some(item => item.live),
      quotes,
      ideas,
      briefing: briefingFromBoard(quotes, ideas),
    };
  });
}

export async function searchMarket(query: string) {
  const cleaned = query.trim();
  if (cleaned.length < 1) return [];
  return cached(`search:${cleaned.toLowerCase()}`, 60_000, async () => {
    const payload = await yahoo<{ quotes?: Array<{ symbol?: string; shortname?: string; longname?: string; quoteType?: string; exchDisp?: string }> }>(searchUrl(cleaned));
    return (payload.quotes || []).filter(item => item.symbol && isMarketSymbol(item.symbol)).slice(0, 8).map(item => ({
      symbol: item.symbol || "",
      name: item.shortname || item.longname || item.symbol || "",
      type: item.quoteType || "EQUITY",
      exchange: item.exchDisp || "",
    }));
  });
}

export function marketAnswer(question: string, language: "es" | "en", board: MarketBoard, chart?: { quote: MarketQuote; analysis: MarketAnalysis } | null) {
  const es = language === "es";
  if (chart) {
    return `${es ? "IRIS en la bolsa." : "IRIS on the market."} ${teachChart(chart.quote, chart.analysis, language)} ${ideaCopy(chart.quote, chart.analysis, language).reason}`;
  }
  const ticker = extractTicker(question);
  const quote = ticker ? board.quotes.find(item => item.symbol === ticker) : null;
  if (quote) {
    return es
      ? `IRIS conectada. ${quote.name} (${quote.symbol}) cotiza ${formatMoney(quote.price, quote.currency)} (${signed(quote.changePercent)}). ${board.briefing.es}`
      : `IRIS is connected. ${quote.name} (${quote.symbol}) is ${formatMoney(quote.price, quote.currency)} (${signed(quote.changePercent)}). ${board.briefing.en}`;
  }
  return language === "es" ? board.briefing.es : board.briefing.en;
}

function formatMoney(value: number | null, currency: string) {
  if (value == null || !Number.isFinite(value)) return "—";
  return `${value.toLocaleString("en-US", { maximumFractionDigits: value >= 100 ? 2 : 4 })} ${currency}`;
}

function signed(value: number) {
  return `${value >= 0 ? "+" : ""}${value.toFixed(2)}%`;
}

function round(value: number, digits: number) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}
