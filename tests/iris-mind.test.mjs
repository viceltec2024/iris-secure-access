import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { irisMindAnswer } from "../lib/iris-mind.ts";
import { composeWorldAnswer, irisWorldAnswer } from "../lib/iris-world-knowledge.ts";
import { extractSearchTopic, isIdentityQuestion, tryEvaluateMath } from "../lib/iris-query.ts";

const base = {
  language: "es",
  userName: "Ezephian",
  section: "operations",
  devices: [],
  alerts: [],
  agents: [],
  wallet: { connected: false, address: "" },
};

test("Ask IRIS uses the local mind when OpenAI is not configured", () => {
  const route = readFileSync(new URL("../app/api/ask-iris/route.ts", import.meta.url), "utf8");
  assert.match(route, /irisMindAnswer/);
  assert.doesNotMatch(route, /localIrisAnswer\(/);
});

test("Ask IRIS names itself instead of dumping SOC status", async () => {
  assert.equal(isIdentityQuestion("quién eres"), true);
  const result = await irisMindAnswer({ ...base, question: "quién eres" });
  assert.equal(result.source, "local");
  assert.match(result.answer, /Soy IRIS/);
  assert.doesNotMatch(result.answer, /0 dispositivo/);
});

test("Ask IRIS evaluates simple math locally", async () => {
  assert.equal(tryEvaluateMath("cuánto es 12*8", "es"), "El resultado es 96.");
  const result = await irisMindAnswer({ ...base, question: "cuánto es 12*8" });
  assert.equal(result.source, "local");
  assert.match(result.answer, /96/);
});

test("Ask IRIS extracts a world-knowledge topic", () => {
  assert.equal(extractSearchTopic("¿qué es la fotosíntesis?"), "fotosíntesis");
  assert.match(composeWorldAnswer("Las plantas convierten luz en energía.", "Fotosíntesis", "es", "Ezephian"), /Fotosíntesis/);
});

test("Ask IRIS answers general questions from public knowledge", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async (input) => {
    const url = String(input);
    if (url.includes("api.php")) {
      return new Response(JSON.stringify({ query: { search: [{ title: "Fotosíntesis" }] } }), { status: 200 });
    }
    return new Response(JSON.stringify({
      title: "Fotosíntesis",
      extract: "La fotosíntesis es el proceso por el cual las plantas convierten luz en energía química.",
    }), { status: 200 });
  };
  try {
    const wiki = await irisWorldAnswer("qué es la fotosíntesis", "es", "Ezephian");
    assert.match(wiki, /fotosíntesis/i);
    const result = await irisMindAnswer({ ...base, question: "qué es la fotosíntesis" });
    assert.equal(result.source, "world");
    assert.match(result.answer, /plantas/i);
  } finally {
    globalThis.fetch = original;
  }
});
