/**
 * Official provider catalog for IRIS integrations.
 * Presence of a key ≠ live_ok. Use probes for operational proof.
 *
 * Sources (verified 2026-10-17):
 * - OpenAI Responses: https://developers.openai.com/api/docs/guides/text
 * - OpenAI Models: https://developers.openai.com/api/docs/models/gpt-4o
 * - Meta Model API: https://dev.meta.ai/docs / https://api.meta.ai/v1
 * - ElevenLabs TTS: https://elevenlabs.io/docs/api-reference/text-to-speech/convert
 */

export const IRIS_PROVIDER_CATALOG = {
  openai: {
    id: "openai" as const,
    label: "OpenAI",
    baseUrl: "https://api.openai.com/v1",
    probeEndpoint: "https://api.openai.com/v1/models",
    chatEndpoint: "https://api.openai.com/v1/responses",
    /** Documented Responses-capable model; overridable via OPENAI_MODEL. */
    defaultModel: "gpt-4o",
    authHeader: "Authorization: Bearer",
    docs: "https://developers.openai.com/api/docs/models/gpt-4o",
  },
  muse: {
    id: "muse" as const,
    label: "Meta Muse (Model API)",
    baseUrl: "https://api.meta.ai/v1",
    probeEndpoint: "https://api.meta.ai/v1/models",
    chatEndpoint: "https://api.meta.ai/v1/chat/completions",
    defaultModel: "muse-spark-1.3",
    authHeader: "Authorization: Bearer",
    docs: "https://dev.meta.ai/docs",
  },
  elevenlabs: {
    id: "elevenlabs" as const,
    label: "ElevenLabs",
    baseUrl: "https://api.elevenlabs.io/v1",
    probeEndpoint: "https://api.elevenlabs.io/v1/user",
    ttsEndpoint: "https://api.elevenlabs.io/v1/text-to-speech/{voice_id}",
    defaultModel: "eleven_multilingual_v2",
    authHeader: "xi-api-key",
    docs: "https://elevenlabs.io/docs/api-reference/text-to-speech/convert",
  },
} as const;

export const PROVIDER_PROBE_TIMEOUT_MS = 8_000;
export const PROVIDER_REQUEST_TIMEOUT_MS = 30_000;

export function resolveOpenAiModel(env: Record<string, string | undefined> = {}) {
  const override = String(env.OPENAI_MODEL || (typeof process !== "undefined" ? process.env.OPENAI_MODEL : "") || "").trim();
  return override || IRIS_PROVIDER_CATALOG.openai.defaultModel;
}

export function providerCatalogPublic() {
  return Object.values(IRIS_PROVIDER_CATALOG).map(item => ({
    id: item.id,
    label: item.label,
    baseUrl: item.baseUrl,
    defaultModel: item.defaultModel,
    docs: item.docs,
  }));
}
