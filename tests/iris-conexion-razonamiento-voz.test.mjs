import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { buildWorldReasonedAnswer } from "../lib/iris-ask-reasoning.ts";

const route = readFileSync(new URL("../app/api/ask-iris/route.ts", import.meta.url), "utf8");
const voiceRoute = readFileSync(new URL("../app/api/iris-voice/route.ts", import.meta.url), "utf8");

function wikiFetch(pages) {
  return async () => ({
    ok: true,
    json: async () => ({ query: { pages } }),
  });
}

test("reasoned world answer uses a source actually consulted, never invented", async () => {
  const realFetch = globalThis.fetch;
  globalThis.fetch = wikiFetch([{
    title: "Fotosíntesis",
    extract: "La fotosíntesis es un proceso que convierte luz en energía química.",
    fullurl: "https://es.wikipedia.org/wiki/Fotos%C3%ADntesis",
    index: 1,
  }]);
  try {
    const reasoned = await buildWorldReasonedAnswer({ question: "¿Qué es la fotosíntesis?", language: "es" });
    assert.ok(reasoned, "expected a reasoned answer when a source was consulted");
    assert.equal(reasoned.confidence, "parcial", "one host (Wikipedia) is parcial, never verificado");
    assert.match(reasoned.answer, /fotosíntesis/i);
    assert.match(reasoned.answer, /Razonamiento:/);
    assert.match(reasoned.answer, /Fuentes consultadas:/);
    assert.match(reasoned.answer, /es\.wikipedia\.org/);
    assert.ok(reasoned.steps.length >= 1);
    assert.ok(reasoned.steps.every(step => step.status === "verificado" || step.status === "parcial"));
    assert.equal(reasoned.unknownSteps.length, 0);
    assert.doesNotMatch(reasoned.answer, /No sé/);
  } finally {
    globalThis.fetch = realFetch;
  }
});

test("no consulted source means no reasoned answer is fabricated", async () => {
  const realFetch = globalThis.fetch;
  globalThis.fetch = wikiFetch([]);
  try {
    const reasoned = await buildWorldReasonedAnswer({ question: "¿Qué es un tema que no existe en absoluto?", language: "es" });
    assert.equal(reasoned, null);
  } finally {
    globalThis.fetch = realFetch;
  }
});

test("Ask IRIS route wires reasoning after Guardian, before the OpenAI path", () => {
  assert.match(route, /buildWorldReasonedAnswer/);
  assert.match(route, /resolved\.source === "world"/);
  assert.match(route, /source: "reasoned_world"/);
  assert.match(route, /confidence: reasoned\.confidence/);
  const guardianAt = route.indexOf("detectPromptInjection(lastUser");
  const reasonedAt = route.indexOf("buildWorldReasonedAnswer({ question: lastUser");
  const openaiAt = route.indexOf("api.openai.com/v1/responses");
  assert.ok(guardianAt >= 0 && reasonedAt > guardianAt, "Guardian must block before reasoning runs");
  assert.ok(openaiAt > reasonedAt, "world reasoned answers must return before the OpenAI branch");
  // Edit-assist answers still return earlier and are untouched by reasoning.
  assert.ok(route.indexOf("runMuseEditAgent") < reasonedAt);
});

test("ElevenLabs voice route reads the key only from the environment and stays safe", () => {
  assert.match(voiceRoute, /ELEVENLABS_API_KEY/);
  assert.match(voiceRoute, /EXAVITQu4vr4xnSDxMaL/);
  assert.match(voiceRoute, /eleven_multilingual_v2/);
  assert.match(voiceRoute, /enforceRateLimit\(`iris-voice:\$\{user\.email\}`, 30, 60 \* 1000\)/);
  // Session is required before any TTS work.
  assert.ok(voiceRoute.indexOf("getChatGPTUser()") < voiceRoute.indexOf("enforceRateLimit(`iris-voice"));
  // GET only reports whether TTS is configured, never the key.
  const getBlock = voiceRoute.slice(voiceRoute.indexOf("export async function GET()"), voiceRoute.indexOf("export async function POST"));
  assert.match(getBlock, /tts: Boolean\(apiKey && voiceId\)/);
  // The tts response object itself carries only the boolean, never the key.
  const ttsLine = getBlock.split("\n").find(line => line.includes("tts: Boolean"));
  assert.ok(ttsLine);
  assert.doesNotMatch(ttsLine, /apiKey:/);
  assert.match(ttsLine, /provider: "elevenlabs"/);
});
