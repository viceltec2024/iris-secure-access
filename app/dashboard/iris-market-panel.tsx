"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ChartLineUp, MagnifyingGlass, Pulse, TrendDown, TrendUp, Wallet } from "@phosphor-icons/react";
import type { Language } from "./dashboard-i18n";
import { LIVE_REFRESH_MS, type MarketAnalysis, type MarketBar, type MarketBoard, type MarketQuote, type MarketRange } from "../../lib/iris-market";

type LiveTape = { updatedAt: string; live: boolean; quotes: MarketQuote[] };
type LiveChart = { quote: MarketQuote; bars: MarketBar[]; analysis: MarketAnalysis; live?: boolean };

const ranges: Array<{ id: MarketRange; es: string; en: string }> = [
  { id: "1d", es: "En vivo", en: "Live" },
  { id: "5d", es: "5 días", en: "5 days" },
  { id: "1mo", es: "1 mes", en: "1 month" },
  { id: "6mo", es: "6 meses", en: "6 months" },
  { id: "1y", es: "1 año", en: "1 year" },
  { id: "5y", es: "5 años", en: "5 years" },
];

function chartPoints(values: number[], width = 640, height = 180) {
  if (!values.length) return "";
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = Math.max(max - min, 0.0001);
  return values.map((value, index) => `${values.length === 1 ? width : (index / (values.length - 1)) * width},${height - 8 - ((value - min) / span) * (height - 20)}`).join(" ");
}

function money(value: number, currency = "USD") {
  return `${value.toLocaleString("en-US", { maximumFractionDigits: value >= 100 ? 2 : 4 })} ${currency}`;
}

function signed(value: number) {
  return `${value >= 0 ? "+" : ""}${value.toFixed(2)}%`;
}

export default function IrisMarketPanel({ language, onOpenPurchases }: { language: Language; onOpenPurchases: () => void }) {
  const es = language === "es";
  const [tape, setTape] = useState<LiveTape | null>(null);
  const [board, setBoard] = useState<MarketBoard | null>(null);
  const [symbol, setSymbol] = useState("NVDA");
  const [range, setRange] = useState<MarketRange>("1d");
  const [chart, setChart] = useState<LiveChart | null>(null);
  const [group, setGroup] = useState<"all" | "indices" | "actions" | "crypto" | "latam">("all");
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<Array<{ symbol: string; name: string }>>([]);
  const [tick, setTick] = useState(0);
  const previous = useRef<Record<string, number>>({});

  useEffect(() => {
    let active = true;
    const loadTape = () => void fetch("/api/iris-market?view=live", { cache: "no-store" }).then(response => response.ok ? response.json() : null).then(data => {
      if (!active || !data?.quotes) return;
      setTape(data as LiveTape);
      setTick(current => current + 1);
    }).catch(() => undefined);
    const loadBoard = () => void fetch(`/api/iris-market?view=board&language=${language}`, { cache: "no-store" }).then(response => response.ok ? response.json() : null).then(data => { if (active && data?.quotes) setBoard(data as MarketBoard); }).catch(() => undefined);
    loadTape();
    loadBoard();
    const tapeTimer = window.setInterval(loadTape, LIVE_REFRESH_MS);
    const boardTimer = window.setInterval(loadBoard, LIVE_REFRESH_MS);
    return () => { active = false; window.clearInterval(tapeTimer); window.clearInterval(boardTimer); };
  }, [language]);

  useEffect(() => {
    let active = true;
    const load = () => void fetch(`/api/iris-market?view=chart&symbol=${encodeURIComponent(symbol)}&range=${range}`, { cache: "no-store" }).then(response => response.ok ? response.json() : null).then(data => { if (active && data?.quote) setChart(data as LiveChart); }).catch(() => undefined);
    load();
    const timer = window.setInterval(load, range === "1d" ? LIVE_REFRESH_MS : LIVE_REFRESH_MS * 2);
    return () => { active = false; window.clearInterval(timer); };
  }, [symbol, range]);

  useEffect(() => {
    if (!query.trim()) { setHits([]); return; }
    const timer = window.setTimeout(() => {
      void fetch(`/api/iris-market?view=search&q=${encodeURIComponent(query)}`, { cache: "no-store" }).then(response => response.ok ? response.json() : null).then(data => setHits(data?.results || [])).catch(() => undefined);
    }, 250);
    return () => window.clearTimeout(timer);
  }, [query]);

  const quotes = board?.quotes.length ? board.quotes : tape?.quotes || [];
  const visible = quotes.filter(item => group === "all" || item.group === group);
  const flashes = useMemo(() => {
    const next: Record<string, "up" | "down"> = {};
    for (const quote of tape?.quotes || []) {
      const prior = previous.current[quote.symbol];
      if (prior != null && prior !== quote.price) next[quote.symbol] = quote.price > prior ? "up" : "down";
      previous.current[quote.symbol] = quote.price;
    }
    return next;
  }, [tape, tick]);

  const lesson = chart && (language === "es"
    ? `Lectura en vivo de ${chart.quote.symbol}: precio ${money(chart.quote.price, chart.quote.currency)}, tendencia ${chart.analysis.trend === "up" ? "alcista" : chart.analysis.trend === "down" ? "bajista" : "lateral"}, RSI ${chart.analysis.rsi14 ?? "—"}. El gráfico se mueve solo. Esto enseña el mercado; no es una orden.`
    : `Live reading of ${chart.quote.symbol}: price ${money(chart.quote.price, chart.quote.currency)}, trend ${chart.analysis.trend}, RSI ${chart.analysis.rsi14 ?? "—"}. The chart moves on its own. This teaches the market; it is not an order.`);

  return <section className="module-panel iris-market-panel">
    <div className="market-live-head">
      <div>
        <span className={`market-live-pill ${tape?.live || board?.live ? "on" : ""}`}><i />{es ? "LECTURAS EN VIVO" : "LIVE READINGS"}</span>
        <h2>IRIS JAR</h2>
        <p>{board?.briefing[language] || tape && (es ? "IRIS JAR está leyendo la cinta en vivo." : "IRIS JAR is reading the live tape.") || (es ? "Conectando IRIS JAR a la bolsa…" : "Connecting IRIS JAR to the market…")}</p>
      </div>
      <div className="market-live-clock">
        <Pulse />
        <strong>{es ? "Sincronizado" : "Synced"}</strong>
        <small>{tape?.updatedAt ? new Date(tape.updatedAt).toLocaleTimeString(language) : "—"} · {es ? "cada 8 s" : "every 8s"}</small>
      </div>
    </div>

    <div className="market-tape">
      {(tape?.quotes || []).map(quote => <button key={quote.symbol} className={`market-tick ${quote.changePercent >= 0 ? "up" : "down"} ${flashes[quote.symbol] || ""}`} onClick={() => setSymbol(quote.symbol)}>
        <b>{quote.symbol.replace("-USD", "")}</b>
        <strong>{quote.price.toLocaleString(language, { maximumFractionDigits: 2 })}</strong>
        <small>{signed(quote.changePercent)}</small>
      </button>)}
      {!tape && <div className="wallet-empty"><Pulse /><strong>{es ? "Abriendo cinta en vivo…" : "Opening the live tape…"}</strong></div>}
    </div>

    <form className="market-search" onSubmit={event => { event.preventDefault(); if (query.trim()) { setSymbol(query.trim().toUpperCase()); setHits([]); } }}>
      <label><MagnifyingGlass /><input value={query} onChange={event => setQuery(event.target.value)} placeholder={es ? "Busca cualquier ticker: AAPL, NVDA, BTC-USD, AMXL.MX…" : "Search any ticker: AAPL, NVDA, BTC-USD, AMXL.MX…"} /></label>
      <div className="market-groups">
        {(["all", "indices", "actions", "crypto", "latam"] as const).map(item => <button type="button" key={item} className={group === item ? "active" : ""} onClick={() => setGroup(item)}>{{ all: es ? "Todo" : "All", indices: es ? "Índices" : "Indexes", actions: es ? "Acciones" : "Stocks", crypto: "Crypto", latam: "LatAm" }[item]}</button>)}
      </div>
    </form>
    {!!hits.length && <div className="market-hits">{hits.map(hit => <button key={hit.symbol} onClick={() => { setSymbol(hit.symbol); setQuery(""); setHits([]); }}><b>{hit.symbol}</b><span>{hit.name}</span></button>)}</div>}

    <div className="market-stage">
      <article className="market-chart-card">
        <header>
          <div>
            <span className={`market-live-pill ${chart?.quote.live ? "on" : ""}`}><i />LIVE · {chart?.quote.exchange || "Yahoo"}</span>
            <h3>{chart?.quote.name || symbol} <code>{symbol}</code></h3>
            <strong className={chart && chart.quote.changePercent >= 0 ? "up" : "down"}>{chart ? money(chart.quote.price, chart.quote.currency) : "—"} <small>{chart ? signed(chart.quote.changePercent) : ""}</small></strong>
          </div>
          <div className="market-range">{ranges.map(item => <button key={item.id} className={range === item.id ? "active" : ""} onClick={() => setRange(item.id)}>{es ? item.es : item.en}</button>)}</div>
        </header>
        <svg viewBox="0 0 640 190" preserveAspectRatio="none" role="img" aria-label={es ? "Gráfico en vivo" : "Live chart"}>
          <path className="chart-grid-lines" d="M0 38H640M0 76H640M0 114H640M0 152H640" />
          {chart && <polyline className={`chart-line ${chart.quote.changePercent >= 0 ? "height" : "pending"}`} points={chartPoints(chart.bars.map(bar => bar.close))} />}
        </svg>
        <p className="market-lesson"><ChartLineUp />{lesson}</p>
        <div className="market-readouts">
          <span>{es ? "Media 20" : "SMA 20"}<b>{chart?.analysis.sma20 ? money(chart.analysis.sma20, chart.quote.currency) : "—"}</b></span>
          <span>{es ? "Media 50" : "SMA 50"}<b>{chart?.analysis.sma50 ? money(chart.analysis.sma50, chart.quote.currency) : "—"}</b></span>
          <span>RSI 14<b>{chart?.analysis.rsi14 ?? "—"}</b></span>
          <span>{es ? "Soporte" : "Support"}<b>{chart?.analysis.support ? money(chart.analysis.support, chart.quote.currency) : "—"}</b></span>
          <span>{es ? "Resistencia" : "Resistance"}<b>{chart?.analysis.resistance ? money(chart.analysis.resistance, chart.quote.currency) : "—"}</b></span>
          <span>{es ? "Lectura" : "Reading"}<b>{chart?.analysis.score ?? "—"}/100</b></span>
        </div>
      </article>
      <aside className="market-ideas">
        <h3>{es ? "Mejores lecturas en vivo" : "Best live readings"}</h3>
        {(board?.ideas || []).map(idea => <button key={idea.symbol} className={`market-idea ${idea.stance}`} onClick={() => setSymbol(idea.symbol)}>
          <div><b>{idea.symbol}</b><small>{signed(idea.changePercent)}</small></div>
          <strong>{idea.score}</strong>
          <p>{idea.reason}</p>
          <em>{idea.lesson}</em>
        </button>)}
        {!board?.ideas.length && <p>{es ? "IRIS está calculando las lecturas en vivo…" : "IRIS is calculating live readings…"}</p>}
        <button className="market-buy" onClick={onOpenPurchases}><Wallet />{es ? "Si quieres comprar, IRIS pide tu aprobación" : "If you want to buy, IRIS asks for your approval"}</button>
      </aside>
    </div>

    <div className="market-board">
      {visible.map(quote => <button key={quote.symbol} className={`market-row ${quote.changePercent >= 0 ? "up" : "down"}`} onClick={() => setSymbol(quote.symbol)}>
        <span>{quote.changePercent >= 0 ? <TrendUp /> : <TrendDown />}</span>
        <div><b>{quote.symbol}</b><small>{quote.name}</small></div>
        <strong>{quote.price.toLocaleString(language, { maximumFractionDigits: 2 })}</strong>
        <small>{signed(quote.changePercent)}</small>
        <i className={quote.live ? "on" : ""} />
      </button>)}
    </div>
  </section>;
}
