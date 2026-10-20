import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  analyzeSeries,
  briefingFromBoard,
  buildBtcSignalBoard,
  chartUrl,
  extractTicker,
  formatBtcSignalsAnswer,
  horizonSignalFromBars,
  isBtcSignalQuestion,
  isMarketQuestion,
  parseChartPayload,
  rsi,
  sma,
} from "../lib/iris-market.ts";

test("live chart URL uses one-minute bars for the trading day", () => {
  assert.match(chartUrl("NVDA", "1d"), /interval=1m/);
  assert.match(chartUrl("NVDA", "1d"), /range=1d/);
  assert.match(chartUrl("^GSPC", "1d"), /%5EGSPC|GSPC/);
});

test("IRIS hears market questions and tickers", () => {
  assert.equal(isMarketQuestion("cuales son las mejores opciones de la bolsa"), true);
  assert.equal(isMarketQuestion("precio de NVDA en vivo"), true);
  assert.equal(extractTicker("como va NVDA ahora"), "NVDA");
  assert.equal(extractTicker("precio del bitcoin"), "BTC-USD");
  assert.equal(extractTicker("$AAPL"), "AAPL");
  assert.equal(extractTicker("hola"), "");
  assert.equal(extractTicker("cuál es el estado del sistema"), "");
  assert.equal(isMarketQuestion("hola"), false);
  assert.equal(isMarketQuestion("cuál es el estado del sistema"), false);
  assert.equal(isMarketQuestion("dime el estado"), false);
  assert.equal(isMarketQuestion("cómo está mi mac"), false);
});

test("Ask IRIS does not send every market-section question to the tape", () => {
  const ask = readFileSync(new URL("../lib/iris-ask.ts", import.meta.url), "utf8");
  assert.match(ask, /if \(isMarketQuestion\(question\)\)/);
  assert.doesNotMatch(ask, /isMarketQuestion\(question\) \|\| preferences\.section === ["']market["']/);
  assert.match(ask, /incident/);
});

test("live readings mark a fresh Yahoo tick as live", () => {
  const now = Math.floor(Date.now() / 1000);
  const parsed = parseChartPayload({
    chart: {
      result: [{
        meta: { symbol: "AAPL", shortName: "Apple", regularMarketPrice: 190.25, chartPreviousClose: 188, regularMarketTime: now, currency: "USD", regularMarketVolume: 12 },
        timestamp: [now - 120, now - 60, now],
        indicators: { quote: [{ open: [188, 189, 190], high: [189, 190, 191], low: [187, 188, 189], close: [188.5, 189.4, 190.2], volume: [1, 2, 3] }] },
      }],
    },
  });
  assert.equal(parsed?.quote.live, true);
  assert.equal(parsed?.quote.price, 190.25);
  assert.ok(parsed?.quote.asOf > Date.now() - 5000);
});

test("live briefing says IRIS and keeps the full sentence", () => {
  const quote = (symbol, changePercent, price = 100) => ({
    symbol, name: symbol, kind: "index", group: "indices", price, previousClose: price, change: 0, changePercent, currency: "USD", exchange: "INDEX", volume: 1, asOf: Date.now(), live: true,
  });
  const briefing = briefingFromBoard([quote("^GSPC", -0.29), quote("^IXIC", 0.1), quote("^VIX", 0, 15.3)], []);
  assert.match(briefing.en, /^IRIS is live\./);
  assert.match(briefing.es, /^IRIS en vivo\./);
  assert.doesNotMatch(briefing.en, /JAR/);
  assert.doesNotMatch(briefing.es, /JAR/);
  assert.match(briefing.en, /Nothing is bought until you approve\.$/);
});

test("SMA and RSI stay deterministic for the live lesson", () => {
  const values = [10, 11, 12, 13, 14, 15, 16, 17, 18, 19];
  assert.equal(sma(values, 5), 17);
  const up = Array.from({ length: 20 }, (_, index) => 10 + index);
  assert.equal(rsi(up), 100);
  const bars = up.map((close, index) => ({ time: index, open: close, high: close, low: close, close, volume: 1000 }));
  const analysis = analyzeSeries("TEST", bars);
  assert.equal(analysis.trend, "up");
  assert.equal(analysis.rsi14, 100);
});

test("live market desk is a dense trading watchlist, not stacked cards", () => {
  const panel = readFileSync(new URL("../app/dashboard/iris-market-panel.tsx", import.meta.url), "utf8");
  const css = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");
  assert.match(panel, /market-watchlist/);
  assert.match(panel, /market-watchlist-head/);
  assert.match(panel, /market-index-strip/);
  assert.match(panel, /Último/);
  assert.match(panel, /Mesa de trading/);
  assert.doesNotMatch(panel, /market-board/);
  assert.match(css, /\.market-tape\{[^}]*display:flex/);
  assert.match(css, /\.market-watchlist\{/);
  assert.match(css, /font-variant-numeric:tabular-nums/);
  assert.doesNotMatch(css, /@media\(max-width:980px\)\{[^}]*\.market-tape/);
  assert.doesNotMatch(css, /\.market-board\{display:grid;grid-template-columns:repeat\(3/);
  assert.match(css, /\.market-chart-card > svg\.market-chart/);
  assert.doesNotMatch(css, /\.market-chart-card svg\{width:100%;height:168px\}/);
  assert.doesNotMatch(panel, /Live reading of /);
  assert.match(panel, /El gráfico se mueve solo/);
  assert.match(panel, /btc-signal-rail/);
  assert.match(panel, /view=btc-signals/);
  assert.match(css, /\.btc-signal-rail\{/);
  assert.match(css, /\.btc-signal\.buy strong/);
  assert.match(css, /\.btc-signal\.sell strong/);
  assert.match(css, /#5ee0a6/);
  assert.match(css, /#ff8f99/);
});

test("BTC horizon signals stay probabilistic and never claim certainty", () => {
  assert.equal(isBtcSignalQuestion("predice bitcoin a 15 minutos"), true);
  assert.equal(isBtcSignalQuestion("señales de compra btc"), true);
  assert.equal(isMarketQuestion("señales bitcoin 5 15 30"), true);
  const rising = Array.from({ length: 40 }, (_, index) => {
    const close = 100 + index * 0.4;
    return { time: index * 60_000, open: close - 0.1, high: close + 0.2, low: close - 0.2, close, volume: 1000 + index * 50 };
  });
  const buyish = horizonSignalFromBars(rising, 15);
  assert.equal(buyish.horizonMin, 15);
  assert.ok(buyish.confidence <= 78);
  assert.ok(buyish.confidence >= 22);
  assert.match(buyish.rationale.es, /no una garantía/i);
  const falling = Array.from({ length: 40 }, (_, index) => {
    const close = 120 - index * 0.45;
    return { time: index * 60_000, open: close + 0.1, high: close + 0.2, low: close - 0.2, close, volume: 2000 + index * 40 };
  });
  const sellish = horizonSignalFromBars(falling, 5);
  assert.ok(["SELL", "HOLD"].includes(sellish.action));
  const board = buildBtcSignalBoard(rising, { price: rising.at(-1).close, currency: "USD", live: true, asOf: Date.now() });
  assert.equal(board.signals.length, 3);
  assert.deepEqual(board.signals.map(item => item.horizonMin), [5, 15, 30]);
  assert.match(board.disclaimer.es, /No son consejo financiero/);
  assert.match(formatBtcSignalsAnswer(board, "es"), /IRIS BTC en vivo/);
  const route = readFileSync(new URL("../app/api/iris-market/route.ts", import.meta.url), "utf8");
  assert.match(route, /btc-signals/);
  assert.match(route, /fetchBtcHorizonSignals/);
});
