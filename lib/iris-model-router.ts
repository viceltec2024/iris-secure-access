/**
 * Coordinación de proveedores IRIS:
 * - Muse (Meta) → edición / reescritura de texto
 * - ChatGPT (OpenAI) → análisis SOC con herramientas
 * - ElevenLabs → voz neural (TTS)
 * - Local mind → inteligencia propia (Wikipedia integrada) y SOC sin LLM
 */

import { isSocFollowUp, isSocQuestion } from "./iris-query.ts";
import { isEditAssistRequest, isMuseConfigured } from "./iris-muse.ts";

export type IrisProviderId = "openai" | "muse" | "elevenlabs" | "local";
export type IrisRouteKind = "edit" | "agent" | "ask" | "voice";

export type IrisProviderEnv = Record<string, string | undefined>;

export type IrisProviderStatus = {
  id: IrisProviderId;
  configured: boolean;
  role: string;
  endpoint: string;
};

export type IrisRouteDecision = {
  kind: IrisRouteKind;
  provider: IrisProviderId;
  reason: string;
  model?: string;
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
      endpoint: "https://api.openai.com/v1",
    },
    {
      id: "muse",
      configured: isMuseConfigured(env),
      role: "Muse · edición de texto",
      endpoint: "https://api.meta.ai/v1",
    },
    {
      id: "elevenlabs",
      configured: elevenLabsConfigured(env),
      role: "ElevenLabs · voz neural",
      endpoint: "https://api.elevenlabs.io/v1",
    },
    {
      id: "local",
      configured: true,
      role: "IRIS local · inteligencia propia y SOC",
      endpoint: "local",
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
      return { kind: "edit", provider: "muse", reason: "edit_intent", model: "muse-spark-1.3" };
    }
    return { kind: "edit", provider: "local", reason: "edit_intent_without_muse_key", model: "muse-local-fallback" };
  }
  if (openaiConfigured(env) && (isSocQuestion(input.question) || isSocFollowUp(input.question))) {
    return { kind: "agent", provider: "openai", reason: "soc_tools", model: "gpt-5.6-sol" };
  }
  return {
    kind: "ask",
    provider: "local",
    reason: openaiConfigured(env) ? "general_wikipedia_or_mind" : "no_openai_key",
    model: "iris-local-analyst",
  };
}

/** Decide TTS: ElevenLabs si hay clave; si no, navegador. */
export function routeIrisVoice(env: IrisProviderEnv = {}): IrisRouteDecision {
  if (elevenLabsConfigured(env)) {
    return { kind: "voice", provider: "elevenlabs", reason: "elevenlabs_configured", model: "eleven_multilingual_v2" };
  }
  return { kind: "voice", provider: "local", reason: "browser_speech_synthesis", model: "speechSynthesis" };
}
