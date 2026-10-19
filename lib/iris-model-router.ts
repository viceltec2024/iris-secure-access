/**
 * Coordinación de proveedores IRIS:
 * - Muse (Meta) → edición / reescritura de texto
 * - ChatGPT (OpenAI) → análisis SOC con herramientas
 * - ElevenLabs → voz neural (TTS)
 * - Local mind → fallback cuando no hay LLM configurado
 */

import { isEditAssistRequest, isMuseConfigured } from "./iris-muse.ts";
import {
  IRIS_PROVIDER_CATALOG,
  PROVIDER_REQUEST_TIMEOUT_MS,
  resolveOpenAiModel,
} from "./iris-provider-catalog.ts";

export type IrisProviderId = "openai" | "muse" | "elevenlabs" | "local";
export type IrisRouteKind = "edit" | "agent" | "ask" | "voice";

export type IrisProviderEnv = Record<string, string | undefined>;

export type IrisProviderStatus = {
  id: IrisProviderId;
  configured: boolean;
  role: string;
  endpoint: string;
  /** Never implies live_ok — only whether a key/binding is present. */
  operationalClaim: "configured_untested" | "local_ready" | "missing";
};

export type IrisRouteDecision = {
  kind: IrisRouteKind;
  provider: IrisProviderId;
  reason: string;
  model?: string;
  timeoutMs: number;
  fallback?: IrisProviderId;
};

function readKey(env: IrisProviderEnv, ...names: string[]) {
  for (const name of names) {
    const direct = String(env[name] || "").trim();
    if (direct) return direct;
    if (typeof process !== "undefined") {
      const fromProcess = String(process.env[name] || "").trim();
      if (fromProcess) return fromProcess;
    }
  }
  return "";
}

export function openaiConfigured(env: IrisProviderEnv = {}) {
  return Boolean(readKey(env, "OPENAI_API_KEY"));
}

export function elevenLabsConfigured(env: IrisProviderEnv = {}) {
  return Boolean(readKey(env, "ELEVENLABS_API_KEY"));
}

export function listProviderStatus(env: IrisProviderEnv = {}): IrisProviderStatus[] {
  return [
    {
      id: "openai",
      configured: openaiConfigured(env),
      role: "ChatGPT · análisis SOC y herramientas",
      endpoint: IRIS_PROVIDER_CATALOG.openai.baseUrl,
      operationalClaim: openaiConfigured(env) ? "configured_untested" : "missing",
    },
    {
      id: "muse",
      configured: isMuseConfigured(env),
      role: "Muse · edición de texto",
      endpoint: IRIS_PROVIDER_CATALOG.muse.baseUrl,
      operationalClaim: isMuseConfigured(env) ? "configured_untested" : "missing",
    },
    {
      id: "elevenlabs",
      configured: elevenLabsConfigured(env),
      role: "ElevenLabs · voz neural",
      endpoint: IRIS_PROVIDER_CATALOG.elevenlabs.baseUrl,
      operationalClaim: elevenLabsConfigured(env) ? "configured_untested" : "missing",
    },
    {
      id: "local",
      configured: true,
      role: "IRIS local · mente y SOC sin LLM",
      endpoint: "local",
      operationalClaim: "local_ready",
    },
  ];
}

/** Decide qué proveedor responde un mensaje de Ask IRIS / agent run. */
export function routeIrisTextRequest(input: {
  question: string;
  env?: IrisProviderEnv;
}): IrisRouteDecision {
  const env = input.env || {};
  if (isEditAssistRequest(input.question)) {
    if (isMuseConfigured(env)) {
      return {
        kind: "edit",
        provider: "muse",
        reason: "edit_intent",
        model: IRIS_PROVIDER_CATALOG.muse.defaultModel,
        timeoutMs: PROVIDER_REQUEST_TIMEOUT_MS,
        fallback: "local",
      };
    }
    return {
      kind: "edit",
      provider: "local",
      reason: "edit_intent_without_muse_key",
      model: "muse-local-fallback",
      timeoutMs: PROVIDER_REQUEST_TIMEOUT_MS,
    };
  }
  if (openaiConfigured(env)) {
    return {
      kind: "agent",
      provider: "openai",
      reason: "soc_or_general",
      model: resolveOpenAiModel(env),
      timeoutMs: PROVIDER_REQUEST_TIMEOUT_MS,
      fallback: "local",
    };
  }
  return {
    kind: "ask",
    provider: "local",
    reason: "no_openai_key",
    model: "iris-local-analyst",
    timeoutMs: PROVIDER_REQUEST_TIMEOUT_MS,
  };
}

/** Decide TTS: ElevenLabs si hay clave; si no, navegador. */
export function routeIrisVoice(env: IrisProviderEnv = {}): IrisRouteDecision {
  if (elevenLabsConfigured(env)) {
    return {
      kind: "voice",
      provider: "elevenlabs",
      reason: "elevenlabs_configured",
      model: IRIS_PROVIDER_CATALOG.elevenlabs.defaultModel,
      timeoutMs: PROVIDER_REQUEST_TIMEOUT_MS,
      fallback: "local",
    };
  }
  return {
    kind: "voice",
    provider: "local",
    reason: "browser_speech_synthesis",
    model: "speechSynthesis",
    timeoutMs: PROVIDER_REQUEST_TIMEOUT_MS,
  };
}
