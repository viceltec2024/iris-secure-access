import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  elevenLabsConfigured,
  listProviderStatus,
  openaiConfigured,
  routeIrisTextRequest,
  routeIrisVoice,
} from "../lib/iris-model-router.ts";

test("router sends edit intents to Muse when MODEL_API_KEY is set", () => {
  const decision = routeIrisTextRequest({
    question: "Reescribe: activa el firewall",
    env: { MODEL_API_KEY: "LLM|test" },
  });
  assert.equal(decision.provider, "muse");
  assert.equal(decision.kind, "edit");
});

test("router falls back to local muse draft without Muse key", () => {
  const decision = routeIrisTextRequest({
    question: "Edita esta recomendación",
    env: {},
  });
  assert.equal(decision.provider, "local");
  assert.equal(decision.kind, "edit");
});

test("router sends SOC questions to OpenAI when configured", () => {
  const decision = routeIrisTextRequest({
    question: "¿Cómo está mi Mac?",
    env: { OPENAI_API_KEY: "sk-test" },
  });
  assert.equal(decision.provider, "openai");
  assert.equal(decision.kind, "agent");
});

test("router uses local mind without OpenAI", () => {
  const decision = routeIrisTextRequest({
    question: "hola iris",
    env: {},
  });
  assert.equal(decision.provider, "local");
});

test("voice routes to ElevenLabs or browser", () => {
  assert.equal(routeIrisVoice({ ELEVENLABS_API_KEY: "el-test" }).provider, "elevenlabs");
  assert.equal(routeIrisVoice({}).provider, "local");
  assert.equal(elevenLabsConfigured({}), false);
  assert.equal(openaiConfigured({ OPENAI_API_KEY: "x" }), true);
});

test("provider status never includes secret values", () => {
  const status = listProviderStatus({
    OPENAI_API_KEY: "sk-secret",
    MODEL_API_KEY: "LLM|secret",
    ELEVENLABS_API_KEY: "el-secret",
  });
  const blob = JSON.stringify(status);
  assert.doesNotMatch(blob, /sk-secret|LLM\|secret|el-secret/);
  assert.equal(status.find(item => item.id === "openai")?.configured, true);
  assert.equal(status.find(item => item.id === "muse")?.configured, true);
  assert.equal(status.find(item => item.id === "elevenlabs")?.configured, true);
});

test("providers status route and voice route stay secret-safe", () => {
  const statusRoute = readFileSync(new URL("../app/api/iris-providers/status/route.ts", import.meta.url), "utf8");
  const voiceRoute = readFileSync(new URL("../app/api/iris-voice/route.ts", import.meta.url), "utf8");
  assert.match(statusRoute, /listProviderStatus/);
  assert.doesNotMatch(statusRoute, /apiKey|sk-/);
  assert.match(voiceRoute, /elevenlabs/);
  assert.doesNotMatch(voiceRoute, /sk-[a-zA-Z0-9]/);
});
