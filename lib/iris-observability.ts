/**
 * Lightweight org-scoped observability for IRIS.
 * Stored in appSettings JSON. Never authorizes core mutation.
 */

export type ObsKind =
  | "ask_latency_ms"
  | "guardian_block"
  | "agent_tick"
  | "provider_probe"
  | "eval_run";

export type ObsSample = {
  kind: ObsKind;
  at: string;
  value: number;
  label?: string;
};

export type ObsStore = {
  revision: number;
  samples: ObsSample[];
  maxSamples: number;
};

const MAX_SAMPLES = 200;

export function emptyObsStore(): ObsStore {
  return { revision: 0, samples: [], maxSamples: MAX_SAMPLES };
}

export function parseObsStore(value: string): ObsStore {
  try {
    const parsed = JSON.parse(value) as Partial<ObsStore>;
    const samples = Array.isArray(parsed.samples)
      ? parsed.samples.filter(item => item && typeof item === "object" && typeof (item as ObsSample).kind === "string" && typeof (item as ObsSample).value === "number") as ObsSample[]
      : [];
    return {
      revision: typeof parsed.revision === "number" && parsed.revision >= 0 ? Math.floor(parsed.revision) : 0,
      samples: samples.slice(0, MAX_SAMPLES),
      maxSamples: MAX_SAMPLES,
    };
  } catch {
    return emptyObsStore();
  }
}

export function appendObsSample(store: ObsStore, sample: ObsSample): ObsStore {
  return {
    revision: (store.revision || 0) + 1,
    maxSamples: MAX_SAMPLES,
    samples: [sample, ...store.samples].slice(0, store.maxSamples || MAX_SAMPLES),
  };
}

export function obsKey(organizationId: string) {
  return `iris_obs:org:${organizationId}`;
}

export function summarizeObs(store: ObsStore, now = Date.now()) {
  const windowMs = 24 * 60 * 60 * 1000;
  const recent = store.samples.filter(item => {
    const at = Date.parse(item.at);
    return Number.isFinite(at) && now - at <= windowMs;
  });
  const latencies = recent.filter(item => item.kind === "ask_latency_ms").map(item => item.value).sort((a, b) => a - b);
  const guardianBlocks = recent.filter(item => item.kind === "guardian_block").length;
  const agentTicks = recent.filter(item => item.kind === "agent_tick").length;
  const probes = recent.filter(item => item.kind === "provider_probe").length;
  const evalRuns = recent.filter(item => item.kind === "eval_run").length;
  const percentile = (values: number[], p: number) => {
    if (!values.length) return null;
    const index = Math.min(values.length - 1, Math.max(0, Math.ceil((p / 100) * values.length) - 1));
    return values[index];
  };
  return {
    windowHours: 24,
    askCount: latencies.length,
    askP50Ms: percentile(latencies, 50),
    askP95Ms: percentile(latencies, 95),
    guardianBlocks,
    agentTicks,
    providerProbes: probes,
    evalRuns,
  };
}
