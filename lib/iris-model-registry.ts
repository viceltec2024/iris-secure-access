/**
 * Honest model / provider coordination status for IRIS.
 * Reports capability presence only — never secret values.
 * A configured key is not a live-proven integration.
 */

export type ModelProviderId =
  | "openai"
  | "elevenlabs"
  | "cloudflare_ai"
  | "muse"
  | "local_iris";

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
  MODEL_API_KEY?: string;
  MUSE_API_KEY?: string;
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
  const museReady = hasSecret(bindings.MODEL_API_KEY) || hasSecret(bindings.MUSE_API_KEY);
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
          ? "Clave presente. Ruta oficial https://api.openai.com/v1 lista; no sustituye una prueba live reciente."
          : "Key present. Official https://api.openai.com/v1 path ready; does not replace a recent live proof.")
        : (language === "es"
          ? "OPENAI_API_KEY ausente. Ask IRIS usa el analista local."
          : "OPENAI_API_KEY missing. Ask IRIS uses the local analyst."),
      provenInCode: true,
    },
    {
      id: "muse",
      label: "Meta Muse (Model API)",
      role: language === "es" ? "Edición / reescritura en Ask IRIS" : "Edit / rewrite in Ask IRIS",
      status: museReady ? "configured_untested" : "missing",
      detail: museReady
        ? (language === "es"
          ? "MODEL_API_KEY presente. Ruta oficial https://api.meta.ai/v1 (muse-spark-1.3); live no confirmado aquí."
          : "MODEL_API_KEY present. Official https://api.meta.ai/v1 (muse-spark-1.3); live not confirmed here.")
        : (language === "es"
          ? "MODEL_API_KEY ausente. Edición usa borrador local Muse."
          : "MODEL_API_KEY missing. Edit intents use the local Muse draft."),
      provenInCode: true,
    },
    {
      id: "elevenlabs",
      label: "ElevenLabs",
      role: language === "es" ? "Voz neural Ask IRIS" : "Ask IRIS neural voice",
      status: elevenReady ? "configured_untested" : "missing",
      detail: elevenReady
        ? (language === "es"
          ? "Clave local presente. /api/iris-voice apunta a https://api.elevenlabs.io/v1; live no confirmado sin prueba."
          : "Local key present. /api/iris-voice targets https://api.elevenlabs.io/v1; live not confirmed without a proof call.")
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
  ];

  const notes = language === "es"
    ? [
      "Una clave configurada no equivale a una integración probada en producción.",
      "agent-orchestration simula un tablero con temporizador; no crea workers reales.",
      "IRIS Creator genera agentes supervisados; el latido aprobado no ejecuta shell ni despliega.",
      "Muse/OpenAI/ElevenLabs usan endpoints oficiales; no se declaran operativos sin prueba live.",
    ]
    : [
      "A configured key is not the same as a production-proven integration.",
      "agent-orchestration simulates a timer board; it does not spawn real workers.",
      "IRIS Creator builds supervised agents; an approved heartbeat does not run shell or deploy.",
      "Muse/OpenAI/ElevenLabs use official endpoints; they are not claimed live without a proof call.",
    ];

  return { generatedAt: now, coordinators, notes };
}
