import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  analyzeSeries,
  briefingFromBoard,
  chartUrl,
  extractTicker,
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
});
