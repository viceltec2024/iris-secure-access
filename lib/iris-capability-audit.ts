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
    evidence: "Sandbox + blocked capabilities + human approval gates in lib/iris-creator.ts; unit tests block exec_shell/spend_money.",
    gap: "Does not yet gate every model tool call at runtime outside Creator.",
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
    evidence: "Design → Guardian sandbox → approve/pause; code/test proposals with human OK.",
    gap: "Approved agents only heartbeat; no durable worker runtime or repo apply pipeline.",
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
    evidence: "Append-only memory store (lib/iris-memory.ts) with human promotion of lessons.",
    gap: "No vector/pgvector retrieval; lessons do not auto-mutate core prompts.",
  },
  {
    id: "mac_telemetry",
    name: "Mac agent real telemetry",
    priority: 7,
    classification: "partial",
    evidence: "Enroll/check-in/HMAC/script + offline overlay; audit on enroll/meaningful check-in.",
    gap: "Requires real Mac + reachable origin; command execution ACK incomplete.",
  },
  {
    id: "model_coordination",
    name: "Multi-model coordination",
    priority: 8,
    classification: "partial",
    evidence: "Coordinator + router + provider probes (OpenAI/Muse/ElevenLabs/CF AI/local). Probes never invent live_ok.",
    gap: "Live provider OK requires real keys + successful HTTP probe in the target environment.",
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
