/**
 * Honest provider probes. Never invents a successful live connection.
 * Without a key, status is disabled/missing. With a key, a real HTTP probe
 * may upgrade to live_ok or live_failed — never "ready" without a response.
 * Probes never authorize self_modify_core and never bypass human Guardian gates.
 */

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
};

export type ProviderProbeEnv = Record<string, string | undefined> & {
  AI?: unknown;
};

function keyOf(env: ProviderProbeEnv, name: string) {
  return String(env[name] || "").trim();
}

export async function probeOpenAI(env: ProviderProbeEnv, now = new Date().toISOString()): Promise<ProviderProbeResult> {
  const endpoint = "https://api.openai.com/v1/models";
  const apiKey = keyOf(env, "OPENAI_API_KEY");
  if (!apiKey) {
    return {
      id: "openai",
      endpoint,
      configured: false,
      status: "skipped_no_key",
      detail: "OPENAI_API_KEY ausente. Ask IRIS usa analista local.",
      checkedAt: now,
    };
  }
  try {
    const response = await fetch(endpoint, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    if (!response.ok) {
      return {
        id: "openai",
        endpoint,
        configured: true,
        status: "live_failed",
        httpStatus: response.status,
        detail: `OpenAI respondió HTTP ${response.status}. Integración no operativa.`,
        checkedAt: now,
      };
    }
    return {
      id: "openai",
      endpoint,
      configured: true,
      status: "live_ok",
      httpStatus: response.status,
      detail: "OpenAI Models API respondió OK.",
      checkedAt: now,
    };
  } catch (error) {
    return {
      id: "openai",
      endpoint,
      configured: true,
      status: "live_failed",
      detail: error instanceof Error ? error.message : "OpenAI network error",
      checkedAt: now,
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
      detail: "MODEL_API_KEY ausente. Edición usa muse-local.",
      checkedAt: now,
    };
  }
  try {
    const response = await fetch(endpoint, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    if (!response.ok) {
      // Some tenants only expose chat/completions; try a tiny dry failure path is still a probe.
      return {
        id: "muse",
        endpoint: MUSE_BASE_URL,
        configured: true,
        status: "live_failed",
        httpStatus: response.status,
        detail: `Meta Muse ${MUSE_EDIT_MODEL} probe HTTP ${response.status}. No se declara operativo.`,
        checkedAt: now,
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
    };
  } catch (error) {
    return {
      id: "muse",
      endpoint: MUSE_BASE_URL,
      configured: true,
      status: "live_failed",
      detail: error instanceof Error ? error.message : "Muse network error",
      checkedAt: now,
    };
  }
}

export async function probeElevenLabs(env: ProviderProbeEnv, now = new Date().toISOString()): Promise<ProviderProbeResult> {
  const endpoint = "https://api.elevenlabs.io/v1/user";
  const apiKey = keyOf(env, "ELEVENLABS_API_KEY");
  if (!apiKey) {
    return {
      id: "elevenlabs",
      endpoint: "https://api.elevenlabs.io/v1",
      configured: false,
      status: "skipped_no_key",
      detail: "ELEVENLABS_API_KEY ausente. Solo speechSynthesis del navegador.",
      checkedAt: now,
    };
  }
  try {
    const response = await fetch(endpoint, {
      headers: { "xi-api-key": apiKey },
    });
    if (!response.ok) {
      return {
        id: "elevenlabs",
        endpoint,
        configured: true,
        status: "live_failed",
        httpStatus: response.status,
        detail: `ElevenLabs HTTP ${response.status}. Voz neural no operativa.`,
        checkedAt: now,
      };
    }
    return {
      id: "elevenlabs",
      endpoint,
      configured: true,
      status: "live_ok",
      httpStatus: response.status,
      detail: "ElevenLabs user endpoint OK.",
      checkedAt: now,
    };
  } catch (error) {
    return {
      id: "elevenlabs",
      endpoint,
      configured: true,
      status: "live_failed",
      detail: error instanceof Error ? error.message : "ElevenLabs network error",
      checkedAt: now,
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
    providers: [
      probeLocal(now),
      openai,
      muse,
      elevenlabs,
      probeCloudflareAi(env, now),
    ],
  };
}
