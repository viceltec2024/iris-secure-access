/**
 * Priority capability audit for IRIS Secure Access.
 * Classifications are evidence-based: code path + automated proof when claimed "proven".
 */

export type CapabilityClass =
  | "functional_proven"
  | "partial"
  | "not_implemented"
  | "not_verifiable";

export type PriorityCapability = {
  id: string;
  name: string;
  priority: number;
  classification: CapabilityClass;
  evidence: string;
  gap: string;
};

/** Ten competitive priorities. Order reflects product focus: Guardian, Core, Creator, Evals first. */
export const PRIORITY_CAPABILITIES: PriorityCapability[] = [
  {
    id: "guardian",
    name: "IRIS Guardian",
    priority: 1,
    classification: "functional_proven",
    evidence: "Sandbox + Creator gates; Ask IRIS first-message Guardian; agent/run mid-stream on model output, tool args, and tool results.",
    gap: "Muse edit path still relies on first-message gate + local fallback rather than per-token streaming filters.",
  },
  {
    id: "core",
    name: "IRIS Core (Ask IRIS + SOC mind)",
    priority: 2,
    classification: "functional_proven",
    evidence: "Local mind/analyst answers via /api/ask-iris; live SOC state; offline rule <5m; unit + live local tests.",
    gap: "Cloud OpenAI path exists but is not live-proven without OPENAI_API_KEY.",
  },
  {
    id: "creator",
    name: "IRIS Creator",
    priority: 3,
    classification: "partial",
    evidence: "Design → sandbox → approve; agent_tick jobs enqueue/lease via Creator desk queue; process_ticks drains without repo apply.",
    gap: "No Sites cron yet; drain is request-scoped (GET Creator / process_ticks). Repo apply stays human-gated and off.",
  },
  {
    id: "evals",
    name: "Evaluation system",
    priority: 4,
    classification: "functional_proven",
    evidence: "lib/iris-evals.ts + /api/iris-evals run integration/security/performance/reliability/benchmark analogs; 100% local pass proven in tests and live API.",
    gap: "No continuous eval board in production Sites; no official SWE-bench/GAIA leaderboard submission.",
  },
  {
    id: "mission_loop",
    name: "Goal → plan → agents → sandbox → verifiable results",
    priority: 5,
    classification: "partial",
    evidence: "Mission queue (timeout/retry/cancel) + policy sandbox + human verify in lib/iris-mission.ts / iris-job-queue.ts.",
    gap: "Policy sandbox is not a container/VM. No durable worker fleet beyond request-scoped queue state in D1.",
  },
  {
    id: "memory_learning",
    name: "Persistent memory + eval-based learning",
    priority: 6,
    classification: "partial",
    evidence: "Append-only memory + human promote UI; local TF-IDF retrieval; Ask IRIS injects approved lessons read-only.",
    gap: "No external vector DB; lessons never auto-mutate IRIS core (by design).",
  },
  {
    id: "mac_telemetry",
    name: "Mac agent real telemetry",
    priority: 7,
    classification: "partial",
    evidence: "Enroll/check-in/HMAC/script + offline overlay; command lifecycle PENDING→DELIVERED→ACKED|EXECUTED|FAILED with agent commandResults.",
    gap: "Requires real Mac + reachable origin for live telemetry; remediations still also verify via next report.",
  },
  {
    id: "model_coordination",
    name: "Multi-model coordination",
    priority: 8,
    classification: "partial",
    evidence: "Coordinator + router + GET /api/iris-providers/status?probe=1 + Org UI probe chips. Probes never invent live_ok.",
    gap: "Live provider OK still requires real keys + successful HTTP probe in the target environment.",
  },
  {
    id: "voice",
    name: "Neural voice (ElevenLabs)",
    priority: 9,
    classification: "partial",
    evidence: "GET/POST /api/iris-voice uses official api.elevenlabs.io with auth + rate limit; browser speechSynthesis fallback.",
    gap: "Live TTS not claimed without a successful keyed call; depends on external quota.",
  },
  {
    id: "self_improvement",
    name: "Autonomous self-modification of IRIS core",
    priority: 10,
    classification: "not_implemented",
    evidence: "Blocked by design (deploy_without_approval / self_modify_core).",
    gap: "Intentionally forbidden without explicit human authorization — competitive safety requirement.",
  },
];

export function classifyLabel(classification: CapabilityClass, language: "es" | "en" = "es") {
  const map = {
    functional_proven: { es: "Funcional y probada", en: "Functional and proven" },
    partial: { es: "Implementada parcialmente", en: "Partially implemented" },
    not_implemented: { es: "No implementada", en: "Not implemented" },
    not_verifiable: { es: "No verificable", en: "Not verifiable" },
  } as const;
  return map[classification][language];
}

export function capabilityScorecard(capabilities: PriorityCapability[] = PRIORITY_CAPABILITIES) {
  const total = capabilities.length;
  const proven = capabilities.filter(item => item.classification === "functional_proven").length;
  const partial = capabilities.filter(item => item.classification === "partial").length;
  const missing = capabilities.filter(item => item.classification === "not_implemented").length;
  const unverifiable = capabilities.filter(item => item.classification === "not_verifiable").length;
  // Partial counts as half toward verified percentage of planned capabilities.
  const verifiedRatio = total ? (proven + partial * 0.5) / total : 0;
  return {
    total,
    proven,
    partial,
    missing,
    unverifiable,
    verifiedPercent: Math.round(verifiedRatio * 1000) / 10,
    plannedPercentBasis: "proven=1.0, partial=0.5, missing/unverifiable=0",
  };
}
