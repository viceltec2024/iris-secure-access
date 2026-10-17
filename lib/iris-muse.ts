/** Muse (Meta Model API) — agente de edición de texto para Ask IRIS. */

import { fetchWithTimeout } from "./iris-fetch.ts";
import { PROVIDER_REQUEST_TIMEOUT_MS } from "./iris-provider-catalog.ts";

export const MUSE_BASE_URL = "https://api.meta.ai/v1";
export const MUSE_EDIT_MODEL = "muse-spark-1.3";

const EDIT_INTENT =
  /\b(edita(?:r)?|reescrib(?:e|ir|í)|mejora(?:r)?|corrig(?:e|ir)|redacta(?:r)?|pulir|pul[ií]|acorta(?:r)?|ampl[ií]a(?:r)?|clarifica(?:r)?|simplifica(?:r)?|reformula(?:r)?|ajusta(?:r)?(?:\s+el)?\s+(?:tono|texto|mensaje|copy|redacci[oó]n)|cambia(?:r)?(?:\s+el)?\s+(?:tono|texto|mensaje)|haz(?:me)?\s+(?:m[aá]s\s+)?(?:corto|claro|formal|directo|profesional)|rewrite|rephrase|edit(?:ing)?|improve|proofread|polish|shorten|clarify|make\s+(?:it\s+)?(?:shorter|clearer|more\s+formal|more\s+direct))\b/i;

const EDIT_OBJECT =
  /\b(texto|mensaje|copy|redacci[oó]n|recomendaci[oó]n|resumen|alerta|incidente|asunto|t[ií]tulo|p[aá]rrafo|frase|correo|email|notificaci[oó]n|draft|wording|subject|title|paragraph|sentence)\b/i;

export type MuseEnv = Record<string, string | undefined>;

export type MuseChatMessage = { role: "user" | "assistant"; content: string };

export type MuseEditResult = {
  answer: string;
  model: string;
  source: "muse";
};

export function museApiKey(env: MuseEnv = {}) {
  const fromEnv =
    env.MODEL_API_KEY ||
    env.MUSE_API_KEY ||
    (typeof process !== "undefined"
      ? process.env.MODEL_API_KEY || process.env.MUSE_API_KEY
      : undefined);
  const key = String(fromEnv || "").trim();
  return key || "";
}

export function isMuseConfigured(env: MuseEnv = {}) {
  return Boolean(museApiKey(env));
}

/** Pedidos de edición/reescritura de texto (no SOC ni chat general). */
export function isEditAssistRequest(question: string) {
  const text = question.trim();
  if (!text || text.length < 4) return false;
  if (EDIT_INTENT.test(text)) return true;
  if (EDIT_OBJECT.test(text) && /\b(mejor|claro|corto|formal|directo|en espa[nñ]ol|in english)\b/i.test(text)) {
    return true;
  }
  return false;
}

export function museEditInstructions(language: "es" | "en") {
  return language === "es"
    ? `Eres Muse, el agente de edición de IRIS Secure Access.
Ayudas a editar, reescribir, acortar, clarificar o pulir texto operativo (alertas, recomendaciones, mensajes, copy en español).
Reglas:
- Devuelve solo el texto editado listo para usar, seguido de una línea breve que diga qué cambiaste.
- No inventes hechos de seguridad, dispositivos, alertas, rutas ni acciones completadas.
- No ejecutes comandos ni digas que aplicaste cambios en el sistema; solo propones redacción.
- Mantén el idioma del usuario (normalmente español). Sé directo y humano, sin relleno corporativo.
- Si el pedido es ambiguo, pide el texto a editar en una frase.`
    : `You are Muse, the IRIS Secure Access editing agent.
You help edit, rewrite, shorten, clarify, or polish operational text (alerts, recommendations, messages, copy).
Rules:
- Return only the edited text ready to use, then one short line on what you changed.
- Never invent security facts, devices, alerts, paths, or completed actions.
- Do not claim you applied system changes; you only propose wording.
- Match the user's language. Be direct and human, no corporate filler.
- If the request is ambiguous, ask for the text to edit in one sentence.`;
}

/** Extrae el texto a editar tras “:”, comillas o la frase completa. */
export function extractEditableDraft(question: string) {
  const trimmed = question.trim();
  const quoted = trimmed.match(/[«"“]([\s\S]+?)[»"”]/);
  if (quoted?.[1]?.trim()) return quoted[1].trim().slice(0, 2000);
  const colon = trimmed.match(/:\s*([\s\S]+)$/);
  if (colon?.[1]?.trim() && colon[1].trim().length >= 8) return colon[1].trim().slice(0, 2000);
  return "";
}

function lightPolish(draft: string, language: "es" | "en") {
  let text = draft.replace(/\s+/g, " ").trim();
  if (!text) return "";
  text = text.charAt(0).toLocaleUpperCase() + text.slice(1);
  if (!/[.!?…]$/.test(text)) text += ".";
  if (language === "es") {
    text = text
      .replace(/\bmac\b/gi, "Mac")
      .replace(/\bfirewall\b/gi, "firewall")
      .replace(/\bpor favor\b/gi, "por favor");
  }
  return text;
}

/**
 * Respuesta local cuando Muse no está configurado o falló.
 * Propone un pulido básico del draft y recuerda configurar MODEL_API_KEY.
 */
export function localMuseEditFallback(question: string, language: "es" | "en") {
  const draft = extractEditableDraft(question);
  const polished = draft ? lightPolish(draft, language) : "";
  if (language === "es") {
    if (polished) {
      return `${polished}\n\n(Borrador local. Con MODEL_API_KEY, Muse reescribe con más matices.)`;
    }
    return "Soy Muse, el agente de edición de IRIS. Pégame el texto tras dos puntos o entre comillas — por ejemplo: Reescribe: activa el firewall y vuelve a reportar — o configura MODEL_API_KEY en .env.local para usar Meta Muse.";
  }
  if (polished) {
    return `${polished}\n\n(Local draft. With MODEL_API_KEY, Muse rewrites with more nuance.)`;
  }
  return "I'm Muse, IRIS's editing agent. Paste the text after a colon or in quotes — e.g. Rewrite: enable the firewall and report again — or set MODEL_API_KEY in .env.local to use Meta Muse.";
}

export async function runMuseEditAgent(input: {
  apiKey: string;
  messages: MuseChatMessage[];
  language: "es" | "en";
  contextNote?: string;
  model?: string;
}): Promise<MuseEditResult> {
  const model = input.model || MUSE_EDIT_MODEL;
  const transcript = input.messages
    .slice(-10)
    .map(message => ({ role: message.role, content: message.content.slice(0, 4000) }));
  const messages: Array<{ role: string; content: string }> = [
    { role: "developer", content: museEditInstructions(input.language) },
  ];
  if (input.contextNote?.trim()) {
    messages.push({
      role: "developer",
      content: `Contexto IRIS (solo referencia, no inventes datos):\n${input.contextNote.trim().slice(0, 6000)}`,
    });
  }
  messages.push(...transcript);

  const response = await fetchWithTimeout(`${MUSE_BASE_URL}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${input.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      messages,
      max_completion_tokens: 1200,
      reasoning_effort: "low",
    }),
  }, PROVIDER_REQUEST_TIMEOUT_MS);

  const payload = await response.json() as {
    error?: { message?: string };
    choices?: Array<{ message?: { content?: string | null } }>;
  };
  if (!response.ok) {
    throw new Error(payload.error?.message || "Muse request failed");
  }
  const answer = String(payload.choices?.[0]?.message?.content || "").trim();
  if (!answer) throw new Error("Muse returned an empty edit");
  return { answer, model, source: "muse" };
}
