import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  extractEditableDraft,
  isEditAssistRequest,
  isMuseConfigured,
  localMuseEditFallback,
  museApiKey,
  museEditInstructions,
  MUSE_BASE_URL,
  MUSE_EDIT_MODEL,
} from "../lib/iris-muse.ts";
import { liveWorkers } from "../lib/iris-live-soc.ts";

test("Muse detects Spanish and English edit intents", () => {
  assert.equal(isEditAssistRequest("Edita esta recomendación para que sea más clara"), true);
  assert.equal(isEditAssistRequest("Reescribe el mensaje de la alerta"), true);
  assert.equal(isEditAssistRequest("Improve this wording and make it shorter"), true);
  assert.equal(isEditAssistRequest("¿Cómo está mi Mac?"), false);
  assert.equal(isEditAssistRequest("hola iris"), false);
});

test("Muse local fallback polishes draft text without inventing SOC status", () => {
  assert.equal(extractEditableDraft("Reescribe: activa el firewall y vuelve a reportar"), "activa el firewall y vuelve a reportar");
  const answer = localMuseEditFallback("Reescribe: activa el firewall y vuelve a reportar", "es");
  assert.match(answer, /Activa el firewall y vuelve a reportar\./);
  assert.match(answer, /MODEL_API_KEY/);
  assert.doesNotMatch(answer, /0 dispositivos|hallazgos verificados/);
});

test("Muse API key resolves from MODEL_API_KEY without hardcoding secrets", () => {
  assert.equal(museApiKey({}), "");
  assert.equal(isMuseConfigured({}), false);
  assert.equal(museApiKey({ MODEL_API_KEY: " LLM|test-key " }), "LLM|test-key");
  assert.equal(isMuseConfigured({ MUSE_API_KEY: "LLM|alt" }), true);
  const source = readFileSync(new URL("../lib/iris-muse.ts", import.meta.url), "utf8");
  assert.doesNotMatch(source, /LLM\|[0-9]/);
  assert.match(source, /api\.meta\.ai\/v1/);
  assert.equal(MUSE_BASE_URL, "https://api.meta.ai/v1");
  assert.equal(MUSE_EDIT_MODEL, "muse-spark-1.3");
});

test("Muse edit instructions stay Spanish-first and non-destructive", () => {
  const es = museEditInstructions("es");
  assert.match(es, /Muse/);
  assert.match(es, /No inventes hechos/);
  assert.match(es, /No ejecutes comandos/);
  const en = museEditInstructions("en");
  assert.match(en, /Never invent security facts/);
});

test("Live SOC lists Muse as the editing agent", () => {
  const queued = liveWorkers({ devices: [], language: "es" });
  const muse = queued.find(item => item.id === "muse-edit");
  assert.ok(muse);
  assert.equal(muse.status, "QUEUED");
  assert.match(muse.task, /MODEL_API_KEY/);

  const ready = liveWorkers({ devices: [], language: "es", museReady: true });
  assert.equal(ready.find(item => item.id === "muse-edit")?.status, "RUNNING");
  assert.match(ready.find(item => item.id === "muse-edit")?.task || "", /Reescribe/);
});

test("Ask IRIS routes edit intents through Muse before OpenAI", () => {
  const agent = readFileSync(new URL("../app/api/agent/run/route.ts", import.meta.url), "utf8");
  const ask = readFileSync(new URL("../app/api/ask-iris/route.ts", import.meta.url), "utf8");
  assert.match(agent, /isEditAssistRequest/);
  assert.match(agent, /runMuseEditAgent/);
  assert.match(agent, /muse_edit/);
  assert.match(ask, /runMuseEditAgent/);
  assert.match(ask, /muse_edit|muse\.source/);
});

test("Orchestration includes Muse edit agent", () => {
  const config = JSON.parse(readFileSync(new URL("../config/iris-ai-agent-orchestration.json", import.meta.url), "utf8"));
  assert.ok(config.agents.some(agent => agent.id === "muse-edit"));
  assert.ok(config.workflow.some(step => Array.isArray(step.parallelOwners) && step.parallelOwners.includes("muse-edit")));
  const orch = readFileSync(new URL("../lib/agent-orchestration.ts", import.meta.url), "utf8");
  assert.match(orch, /muse-edit/);
});
