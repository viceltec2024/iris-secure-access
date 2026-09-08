import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { irisMindAnswer } from "../lib/iris-mind.ts";
import { composeWorldAnswer, irisWorldAnswer } from "../lib/iris-world-knowledge.ts";
import { extractSearchTopic, isConversationStart, isIdentityQuestion, isSocQuestion, tryEvaluateMath } from "../lib/iris-query.ts";

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

test("Ask IRIS talks when the user wants a conversation", async () => {
  assert.equal(isConversationStart("hola, quiero hablar contigo"), true);
  const result = await irisMindAnswer({ ...base, question: "hola, quiero hablar contigo" });
  assert.equal(result.source, "local");
  assert.match(result.answer, /Hola, Ezephian|Estoy conectada/i);
  assert.doesNotMatch(result.answer, /Karol|canci[oó]n|Contigo/i);
});

test("Ask IRIS evaluates simple math locally", async () => {
  assert.equal(tryEvaluateMath("cuánto es 12*8", "es"), "El resultado es 96.");
  const result = await irisMindAnswer({ ...base, question: "cuánto es 12*8" });
  assert.equal(result.source, "local");
  assert.match(result.answer, /96/);
});

test("Ask IRIS extracts a world-knowledge topic", () => {
  assert.equal(extractSearchTopic("¿qué es la fotosíntesis?"), "fotosíntesis");
  assert.equal(extractSearchTopic("para qué sirve el firewall"), "firewall");
  assert.match(composeWorldAnswer("Las plantas convierten luz en energía.", "Fotosíntesis", "es", "Ezephian"), /plantas/i);
  assert.doesNotMatch(composeWorldAnswer("Las plantas convierten luz en energía.", "Fotosíntesis", "es", "Ezephian"), /Eso es lo esencial/i);
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

test("Ask IRIS stops waiting on hung world knowledge", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = (_input, init) => new Promise((_resolve, reject) => {
    init?.signal?.addEventListener("abort", () => reject(Object.assign(new Error("Aborted"), { name: "AbortError" })));
  });
  const started = Date.now();
  try {
    const result = await irisMindAnswer({ ...base, question: "cuéntame algo de marte" });
    assert.equal(result.source, "local");
    assert.match(result.answer, /Ezephian|marte/i);
    assert.ok(Date.now() - started < 5000);
  } finally {
    globalThis.fetch = original;
  }
});

test("Ask IRIS answers live Mac questions instead of Wikipedia", async () => {
  assert.equal(isSocQuestion("cómo está mi mac"), true);
  const original = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({ title: "Mac", extract: "Karol G Contigo" }), { status: 200 });
  try {
    const result = await irisMindAnswer({
      ...base,
      question: "cómo está mi mac",
      devices: [{
        id: "mac-1",
        name: "My Mac",
        platform: "macOS",
        status: "ONLINE",
        risk: "LOW",
        lastSeenAt: new Date().toISOString(),
        telemetry: { hostname: "MacBookAir", firewallEnabled: true, fileVaultEnabled: true },
      }],
    });
    assert.equal(result.source, "local");
    assert.match(result.answer, /ONLINE/i);
    assert.match(result.answer, /My Mac|MacBookAir/);
    assert.doesNotMatch(result.answer, /Karol|Contigo/i);
  } finally {
    globalThis.fetch = original;
  }
});

test("Ask IRIS treats stop and para as halt, not Wikipedia", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({ title: "Para", extract: "Para puede referirse a un prefijo." }), { status: 200 });
  try {
    const result = await irisMindAnswer({ ...base, question: "para" });
    assert.equal(result.source, "local");
    assert.match(result.answer, /Paré|seguir/i);
    assert.doesNotMatch(result.answer, /prefijo|Wikipedia|hidrocarburo/i);
    const stop = await irisMindAnswer({ ...base, question: "stop" });
    assert.match(stop.answer, /Paré|Stopped/i);
  } finally {
    globalThis.fetch = original;
  }
});

test("Ask IRIS routes alerts, system review, and follow-ups to the live stack", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({ title: "Alerta tsunamis", extract: "Una alerta de tsunami." }), { status: 200 });
  const live = {
    ...base,
    devices: [{
      id: "mac-1",
      name: "My Mac",
      platform: "macOS",
      status: "ONLINE",
      risk: "MEDIUM",
      lastSeenAt: new Date().toISOString(),
      telemetry: { hostname: "MacBookAir", firewallEnabled: false, fileVaultEnabled: true },
    }],
    alerts: [{ deviceId: "mac-1", code: "FIREWALL_DISABLED", severity: "MEDIUM", status: "NEW" }],
  };
  try {
    assert.equal(isSocQuestion("qué alertas hay"), true);
    assert.equal(isSocQuestion("revisa el sistema"), true);
    assert.equal(isSocQuestion("dime el estado"), true);
    assert.equal(isSocQuestion("el sistema solar"), false);
    assert.equal(isSocQuestion("para qué sirve el firewall"), false);
    assert.equal(isSocQuestion("está el firewall"), true);
    const alerts = await irisMindAnswer({ ...live, question: "qué alertas hay" });
    assert.equal(alerts.source, "local");
    assert.match(alerts.answer, /FIREWALL DISABLED|firewall/i);
    assert.doesNotMatch(alerts.answer, /tsunami/i);
    const review = await irisMindAnswer({ ...live, question: "revisa el sistema" });
    assert.equal(review.source, "local");
    assert.match(review.answer, /My Mac|MacBookAir|ONLINE/i);
    const status = await irisMindAnswer({ ...live, question: "dime el estado" });
    assert.equal(status.source, "local");
    assert.match(status.answer, /dispositivo|ONLINE|My Mac/i);
    const next = await irisMindAnswer({ ...live, question: "y ahora qué hago" });
    assert.equal(next.source, "local");
    assert.match(next.answer, /FIREWALL|firewall|aprueba/i);
    assert.doesNotMatch(next.answer, /tsunami|telenovela|Ahora qu[eé] hago/i);
  } finally {
    globalThis.fetch = original;
  }
});

test("Ask IRIS explains firewall instead of dumping live Mac status", async () => {
  const result = await irisMindAnswer({
    ...base,
    question: "para qué sirve el firewall",
    devices: [{
      id: "mac-1",
      name: "My Mac",
      platform: "macOS",
      status: "ONLINE",
      risk: "LOW",
      lastSeenAt: new Date().toISOString(),
      telemetry: { hostname: "MacBookAir", firewallEnabled: true },
    }],
  });
  assert.equal(result.source, "local");
  assert.match(result.answer, /barrera|conexiones/i);
  assert.doesNotMatch(result.answer, /ONLINE/);
});

test("Ask IRIS uses the selected incident when asked about it", async () => {
  const result = await irisMindAnswer({
    ...base,
    question: "este incidente",
    incident: {
      id: "IR-2001",
      title: "Firewall apagado",
      subject: "My Mac",
      severity: "Medium",
      status: "Open",
      source: "agent",
      evidence: ["firewallEnabled=false"],
      recommendation: "Aprueba ENABLE FIREWALL.",
    },
  });
  assert.equal(result.source, "local");
  assert.match(result.answer, /IR-2001/);
  assert.match(result.answer, /Aprueba ENABLE FIREWALL/);
});
