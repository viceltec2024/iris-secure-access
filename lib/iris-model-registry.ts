/**
 * Honest model / provider coordination status for IRIS.
 * Reports capability presence only — never secret values.
 */

export type ModelProviderId = "openai" | "elevenlabs" | "cloudflare_ai" | "meta_ai" | "local_iris";

export type ModelProviderStatus = {
  id: ModelProviderId;
  label: string;
  role: string;
  status: "ready" | "configured_untested" | "missing" | "unavailable";
  detail: string;
  provenInCode: boolean;
};

export type ModelCoordinationReport = {
  generatedAt: string;
  coordinators: ModelProviderStatus[];
  notes: string[];
};

type BindingFlags = {
  OPENAI_API_KEY?: string;
  ELEVENLABS_API_KEY?: string;
  AI?: unknown;
};

function hasSecret(value: string | undefined) {
  return Boolean(value && value.trim());
}

export function buildModelCoordinationReport(
  bindings: BindingFlags,
  language: "es" | "en" = "es",
  now = new Date().toISOString(),
): ModelCoordinationReport {
  const openaiReady = hasSecret(bindings.OPENAI_API_KEY);
  const elevenReady = hasSecret(bindings.ELEVENLABS_API_KEY);
  const cfAiReady = Boolean(bindings.AI);

  const coordinators: ModelProviderStatus[] = [
    {
      id: "local_iris",
      label: "IRIS Local Mind",
      role: language === "es" ? "Respuestas SOC y fallback" : "SOC answers and fallback",
      status: "ready",
      detail: language === "es"
        ? "Operativo sin clave externa. Probado por tests unitarios."
        : "Works without an external key. Covered by unit tests.",
      provenInCode: true,
    },
    {
      id: "openai",
      label: "OpenAI / ChatGPT",
      role: language === "es" ? "Ask IRIS cloud + agent/run + Whisper" : "Ask IRIS cloud + agent/run + Whisper",
      status: openaiReady ? "configured_untested" : "missing",
      detail: openaiReady
        ? (language === "es"
          ? "Clave presente en el entorno. Ruta de código lista; no sustituye una prueba live reciente."
          : "Key present in the environment. Code path ready; does not replace a recent live proof.")
        : (language === "es"
          ? "OPENAI_API_KEY ausente. Ask IRIS usa el analista local."
          : "OPENAI_API_KEY missing. Ask IRIS uses the local analyst."),
      provenInCode: true,
    },
    {
      id: "elevenlabs",
      label: "ElevenLabs",
      role: language === "es" ? "Voz neural Ask IRIS" : "Ask IRIS neural voice",
      status: elevenReady ? "ready" : "missing",
      detail: elevenReady
        ? (language === "es"
          ? "Clave local presente. /api/iris-voice habla por ElevenLabs; si falla, browser speechSynthesis."
          : "Local key present. /api/iris-voice speaks via ElevenLabs; falls back to browser speechSynthesis.")
        : (language === "es"
          ? "ELEVENLABS_API_KEY ausente. Solo voz del navegador."
          : "ELEVENLABS_API_KEY missing. Browser voice only."),
      provenInCode: true,
    },
    {
      id: "cloudflare_ai",
      label: "Cloudflare Workers AI",
      role: language === "es" ? "Fallback STT Whisper" : "STT Whisper fallback",
      status: cfAiReady ? "configured_untested" : "missing",
      detail: cfAiReady
        ? (language === "es"
          ? "Binding AI detectado. Fallback de transcripción disponible."
          : "AI binding detected. Transcription fallback available.")
        : (language === "es"
          ? "Binding AI no declarado en hosting local. STT depende de OpenAI o del cliente."
          : "AI binding not declared in local hosting. STT depends on OpenAI or the client."),
      provenInCode: true,
    },
    {
      id: "meta_ai",
      label: "Meta AI",
      role: language === "es" ? "Coordinación multi-modelo" : "Multi-model coordination",
      status: "unavailable",
      detail: language === "es"
        ? "Sin código, sin env y sin binding. No está integrado."
        : "No code, no env, and no binding. Not integrated.",
      provenInCode: false,
    },
  ];

  const notes = language === "es"
    ? [
      "Una clave configurada no equivale a una integración probada en producción.",
      "agent-orchestration simula un tablero con temporizador; no crea workers reales.",
      "IRIS Creator genera agentes supervisados; el latido aprobado no ejecuta shell ni despliega.",
    ]
    : [
      "A configured key is not the same as a production-proven integration.",
      "agent-orchestration simulates a timer board; it does not spawn real workers.",
      "IRIS Creator builds supervised agents; an approved heartbeat does not run shell or deploy.",
    ];

  return { generatedAt: now, coordinators, notes };
}
