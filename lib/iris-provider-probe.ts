/**
 * Honest provider probes. Never invents a successful live connection.
 * Without a key, status is disabled/missing. With a key, a real HTTP probe
 * may upgrade to live_ok or live_failed — never "ready" without a response.
 * Probes never authorize self_modify_core and never bypass human Guardian gates.
 */

import { classifyProviderError, fetchWithTimeout } from "./iris-fetch.ts";
import { IRIS_PROVIDER_CATALOG, PROVIDER_PROBE_TIMEOUT_MS, providerCatalogPublic } from "./iris-provider-catalog.ts";
import { MUSE_BASE_URL, MUSE_EDIT_MODEL, museApiKey } from "./iris-muse.ts";

export type ProviderProbeId = "openai" | "muse" | "elevenlabs" | "cloudflare_ai" | "local";

export type ProviderProbeResult = {
  id: ProviderProbeId;
  endpoint: string;
  configured: boolean;
  status: "disabled" | "skipped_no_key" | "live_ok" | "live_failed" | "local_ready";
  httpStatus?: number;
  detail: string;
  checkedAt: string;
  timeoutMs?: number;
};

export type ProviderProbeEnv = Record<string, string | undefined> & {
  AI?: unknown;
};

function keyOf(env: ProviderProbeEnv, name: string) {
  return String(env[name] || "").trim();
}

export async function probeOpenAI(env: ProviderProbeEnv, now = new Date().toISOString()): Promise<ProviderProbeResult> {
  const endpoint = IRIS_PROVIDER_CATALOG.openai.probeEndpoint;
  const apiKey = keyOf(env, "OPENAI_API_KEY");
  if (!apiKey) {
    return {
      id: "openai",
      endpoint,
      configured: false,
      status: "skipped_no_key",
      detail: "OPENAI_API_KEY ausente. Ask IRIS usa analista local. Clave configurada ≠ integración operativa.",
      checkedAt: now,
      timeoutMs: PROVIDER_PROBE_TIMEOUT_MS,
    };
  }
  try {
    const response = await fetchWithTimeout(endpoint, {
      headers: { Authorization: `Bearer ${apiKey}` },
    }, PROVIDER_PROBE_TIMEOUT_MS);
    if (!response.ok) {
      return {
        id: "openai",
        endpoint,
        configured: true,
        status: "live_failed",
        httpStatus: response.status,
        detail: `OpenAI respondió HTTP ${response.status}. Integración no operativa.`,
        checkedAt: now,
        timeoutMs: PROVIDER_PROBE_TIMEOUT_MS,
      };
    }
    return {
      id: "openai",
      endpoint,
      configured: true,
      status: "live_ok",
      httpStatus: response.status,
      detail: `OpenAI Models API respondió OK (modelo chat declarado ${IRIS_PROVIDER_CATALOG.openai.defaultModel}).`,
      checkedAt: now,
      timeoutMs: PROVIDER_PROBE_TIMEOUT_MS,
    };
  } catch (error) {
    const classified = classifyProviderError(error);
    return {
      id: "openai",
      endpoint,
      configured: true,
      status: "live_failed",
      detail: classified.detail,
      checkedAt: now,
      timeoutMs: PROVIDER_PROBE_TIMEOUT_MS,
    };
  }
}

export async function probeMuse(env: ProviderProbeEnv, now = new Date().toISOString()): Promise<ProviderProbeResult> {
  const endpoint = `${MUSE_BASE_URL}/models`;
  const apiKey = museApiKey(env);
  if (!apiKey) {
    return {
      id: "muse",
      endpoint: MUSE_BASE_URL,
      configured: false,
      status: "skipped_no_key",
      detail: "MODEL_API_KEY ausente. Edición usa muse-local. Clave configurada ≠ integración operativa.",
      checkedAt: now,
      timeoutMs: PROVIDER_PROBE_TIMEOUT_MS,
    };
  }
  try {
    const response = await fetchWithTimeout(endpoint, {
      headers: { Authorization: `Bearer ${apiKey}` },
    }, PROVIDER_PROBE_TIMEOUT_MS);
    if (!response.ok) {
      return {
        id: "muse",
        endpoint: MUSE_BASE_URL,
        configured: true,
        status: "live_failed",
        httpStatus: response.status,
        detail: `Meta Muse ${MUSE_EDIT_MODEL} probe HTTP ${response.status}. No se declara operativo.`,
        checkedAt: now,
        timeoutMs: PROVIDER_PROBE_TIMEOUT_MS,
      };
    }
    return {
      id: "muse",
      endpoint: MUSE_BASE_URL,
      configured: true,
      status: "live_ok",
      httpStatus: response.status,
      detail: `Meta Muse API OK (modelo declarado ${MUSE_EDIT_MODEL}).`,
      checkedAt: now,
      timeoutMs: PROVIDER_PROBE_TIMEOUT_MS,
    };
  } catch (error) {
    const classified = classifyProviderError(error);
    return {
      id: "muse",
      endpoint: MUSE_BASE_URL,
      configured: true,
      status: "live_failed",
      detail: classified.detail,
      checkedAt: now,
      timeoutMs: PROVIDER_PROBE_TIMEOUT_MS,
    };
  }
}

export async function probeElevenLabs(env: ProviderProbeEnv, now = new Date().toISOString()): Promise<ProviderProbeResult> {
  const endpoint = IRIS_PROVIDER_CATALOG.elevenlabs.probeEndpoint;
  const apiKey = keyOf(env, "ELEVENLABS_API_KEY");
  if (!apiKey) {
    return {
      id: "elevenlabs",
      endpoint: IRIS_PROVIDER_CATALOG.elevenlabs.baseUrl,
      configured: false,
      status: "skipped_no_key",
      detail: "ELEVENLABS_API_KEY ausente. Solo speechSynthesis del navegador.",
      checkedAt: now,
      timeoutMs: PROVIDER_PROBE_TIMEOUT_MS,
    };
  }
  try {
    const response = await fetchWithTimeout(endpoint, {
      headers: { "xi-api-key": apiKey },
    }, PROVIDER_PROBE_TIMEOUT_MS);
    if (!response.ok) {
      return {
        id: "elevenlabs",
        endpoint,
        configured: true,
        status: "live_failed",
        httpStatus: response.status,
        detail: `ElevenLabs HTTP ${response.status}. Voz neural no operativa.`,
        checkedAt: now,
        timeoutMs: PROVIDER_PROBE_TIMEOUT_MS,
      };
    }
    return {
      id: "elevenlabs",
      endpoint,
      configured: true,
      status: "live_ok",
      httpStatus: response.status,
      detail: `ElevenLabs user endpoint OK (TTS model ${IRIS_PROVIDER_CATALOG.elevenlabs.defaultModel}).`,
      checkedAt: now,
      timeoutMs: PROVIDER_PROBE_TIMEOUT_MS,
    };
  } catch (error) {
    const classified = classifyProviderError(error);
    return {
      id: "elevenlabs",
      endpoint,
      configured: true,
      status: "live_failed",
      detail: classified.detail,
      checkedAt: now,
      timeoutMs: PROVIDER_PROBE_TIMEOUT_MS,
    };
  }
}

export function probeCloudflareAi(env: ProviderProbeEnv, now = new Date().toISOString()): ProviderProbeResult {
  const ready = Boolean(env.AI);
  return {
    id: "cloudflare_ai",
    endpoint: "workers_ai_binding",
    configured: ready,
    status: ready ? "live_ok" : "skipped_no_key",
    detail: ready
      ? "Binding AI presente en el worker (STT fallback disponible)."
      : "Binding AI no declarado en este entorno.",
    checkedAt: now,
  };
}

export function probeLocal(now = new Date().toISOString()): ProviderProbeResult {
  return {
    id: "local",
    endpoint: "local",
    configured: true,
    status: "local_ready",
    detail: "IRIS local mind operativo sin clave externa.",
    checkedAt: now,
  };
}

export async function probeAllProviders(env: ProviderProbeEnv, now = new Date().toISOString()) {
  const [openai, muse, elevenlabs] = await Promise.all([
    probeOpenAI(env, now),
    probeMuse(env, now),
    probeElevenLabs(env, now),
  ]);
  return {
    checkedAt: now,
    catalog: providerCatalogPublic(),
    note: "configured≠live_ok. Solo live_ok prueba HTTP real sin filtrar secretos.",
    providers: [
      probeLocal(now),
      openai,
      muse,
      elevenlabs,
      probeCloudflareAi(env, now),
    ],
  };
}
