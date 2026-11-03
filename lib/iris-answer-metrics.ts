/**
 * IRIS answer metrics — Etapa 1, cimientos medibles.
 *
 * Pure functions, no network, no secrets. A metric records only what the
 * caller actually measured for one answer: provider, latency, tokens (when
 * the provider reports them), tools used, and whether the answer came from
 * a live check (live=true) or from a merely configured / local fallback
 * (live=false). "configured" and "live" are never merged: a provider that
 * is only configured contributes live=false.
 * Cost is only summed when the caller supplies costUsd; otherwise it stays
 * unmeasured (null), never invented from a price table.
 */

export type AnswerMetrics = {
  provider: string;
  model?: string;
  latencyMs: number;
  tokensIn?: number;
  tokensOut?: number;
  toolsUsed: string[];
  live: boolean;
  costUsd?: number;
};

export type AnswerMetricsSummary = {
  count: number;
  avgLatencyMs: number;
  p50LatencyMs: number;
  p95LatencyMs: number;
  totalTokens: number;
  totalCostUsd: number | null;
  costMeasuredCount: number;
  liveCount: number;
  notLiveCount: number;
  byProvider: Record<string, number>;
};

export function percentile(values: number[], p: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  if (!sorted.length) return 0;
  const rank = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, Math.min(rank, sorted.length - 1))];
}

export function summarizeAnswerMetrics(metrics: AnswerMetrics[]): AnswerMetricsSummary {
  const latencies = metrics.map(item => Math.max(0, item.latencyMs));
  const totalTokens = metrics.reduce(
    (sum, item) => sum + (item.tokensIn || 0) + (item.tokensOut || 0),
    0,
  );
  const withCost = metrics.filter(item => typeof item.costUsd === "number");
  const byProvider: Record<string, number> = {};
  for (const item of metrics) byProvider[item.provider] = (byProvider[item.provider] || 0) + 1;
  return {
    count: metrics.length,
    avgLatencyMs: latencies.length
      ? latencies.reduce((sum, value) => sum + value, 0) / latencies.length
      : 0,
    p50LatencyMs: percentile(latencies, 50),
    p95LatencyMs: percentile(latencies, 95),
    totalTokens,
    totalCostUsd: withCost.length
      ? withCost.reduce((sum, item) => sum + (item.costUsd || 0), 0)
      : null,
    costMeasuredCount: withCost.length,
    liveCount: metrics.filter(item => item.live).length,
    notLiveCount: metrics.filter(item => !item.live).length,
    byProvider,
  };
}
