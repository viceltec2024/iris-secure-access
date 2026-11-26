import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { irisMindAnswer } from "../lib/iris-mind.ts";
import { composeWorldAnswer, irisWorldAnswer } from "../lib/iris-world-knowledge.ts";
import { extractSearchTopic, isConversationStart, isIdentityQuestion, isOwnIntelligenceQuestion, isSocQuestion, tryEvaluateMath } from "../lib/iris-query.ts";

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
  const ask = readFileSync(new URL("../lib/iris-ask.ts", import.meta.url), "utf8");
  const agent = readFileSync(new URL("../app/api/agent/run/route.ts", import.meta.url), "utf8");
  assert.match(ask, /irisMindAnswer/);
  assert.doesNotMatch(ask, /localIrisAnswer\(/);
  assert.match(agent, /resolveIrisAsk/);
});

test("Ask IRIS names itself instead of dumping SOC status", async () => {
  assert.equal(isIdentityQuestion("quién eres"), true);
  const result = await irisMindAnswer({ ...base, question: "quién eres" });
  assert.equal(result.source, "local");
  assert.match(result.answer, /Soy IRIS/);
  assert.match(result.answer, /inteligencia propia/);
  assert.doesNotMatch(result.answer, /0 dispositivo/);
});

test("Ask IRIS says Wikipedia lives inside its own intelligence", async () => {
  assert.equal(isOwnIntelligenceQuestion("quiero que IRIS tenga inteligencia propia"), true);
  assert.equal(isOwnIntelligenceQuestion("wikipedia dentro del sistema"), true);
  const result = await irisMindAnswer({ ...base, question: "quiero wikipedia dentro del sistema y inteligencia propia" });
  assert.equal(result.source, "local");
  assert.match(result.answer, /Wikipedia está dentro de IRIS|inteligencia/i);
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
  assert.equal(extractSearchTopic("cuentame de Einstein"), "Einstein");
  assert.match(composeWorldAnswer("Las plantas convierten luz en energía.", "Fotosíntesis", "es", "Ezephian"), /plantas/i);
  assert.match(composeWorldAnswer("Las plantas convierten luz en energía.", "Fotosíntesis", "es", "Ezephian"), /Wikipedia/i);
  assert.doesNotMatch(composeWorldAnswer("Las plantas convierten luz en energía.", "Fotosíntesis", "es", "Ezephian"), /Eso es lo esencial/i);
});

test("Ask IRIS answers seeded encyclopedia topics from its own knowledge", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async () => {
    throw new Error("seeded knowledge must not call Wikipedia");
  };
  try {
    const wiki = await irisWorldAnswer("qué es la fotosíntesis", "es", "Ezephian");
    assert.match(wiki, /fotosíntesis|plantas/i);
    assert.match(wiki, /inteligencia/i);
    const result = await irisMindAnswer({ ...base, question: "qué es la fotosíntesis" });
    assert.equal(result.source, "world");
    assert.match(result.answer, /plantas|azúcares|oxígeno/i);
    assert.match(result.answer, /Wikipedia/i);
    const mars = await irisMindAnswer({ ...base, question: "explícame Marte" });
    assert.match(mars.answer, /cuarto planeta|planeta rojo/i);
    const curie = await irisMindAnswer({ ...base, question: "quién fue Marie Curie" });
    assert.match(curie.answer, /Nobel|radiactividad/i);
  } finally {
    globalThis.fetch = original;
  }
});

test("Ask IRIS learns a Wikipedia topic into its own knowledge", async () => {
  const original = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async (input) => {
    calls += 1;
    const url = String(input);
    assert.match(url, /^https:\/\/es\.wikipedia\.org\/w\/api\.php/);
    return new Response(JSON.stringify({
      query: {
        pages: [{
          title: "Quimioterapia",
          extract: "La quimioterapia es un tratamiento con fármacos para destruir células que se dividen rápido, usado sobre todo contra el cáncer.",
          index: 1,
          fullurl: "https://es.wikipedia.org/wiki/Quimioterapia",
        }],
      },
    }), { status: 200 });
  };
  try {
    const first = await irisMindAnswer({ ...base, question: "qué es la quimioterapia" });
    assert.equal(first.source, "world");
    assert.match(first.answer, /cáncer|fármacos/i);
    assert.equal(calls, 1);
    const second = await irisMindAnswer({ ...base, question: "qué es la quimioterapia", knowledge: first.knowledge });
    assert.equal(second.source, "world");
    assert.match(second.answer, /cáncer|fármacos/i);
    assert.equal(calls, 1);
  } finally {
    globalThis.fetch = original;
  }
});

test("Ask IRIS skips Wikipedia disambiguation pages", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({
    query: {
      pages: [
        { title: "Mercurio", extract: "Mercurio puede referirse a: Mercurio (planeta).", index: 1, pageprops: { disambiguation: "" } },
        { title: "Mercurio (planeta)", extract: "Mercurio es el planeta más cercano al Sol.", index: 2, fullurl: "https://es.wikipedia.org/wiki/Mercurio_(planeta)" },
      ],
    },
  }), { status: 200 });
  try {
    const result = await irisMindAnswer({ ...base, question: "explícame Mercurio" });
    assert.equal(result.source, "world");
    assert.match(result.answer, /más cercano al Sol/i);
    assert.doesNotMatch(result.answer, /puede referirse/i);
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
    const result = await irisMindAnswer({ ...base, question: "cuéntame algo de la magnetosfera" });
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
    assert.equal(isSocQuestion("Usa la herramienta get_security_overview y dime el estado de seguridad de IRIS."), true);
    assert.equal(isSocQuestion("Revisa el overview de seguridad ahora."), true);
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

test("Ask IRIS routes agent-creation requests to IRIS Creator", async () => {
  const result = await irisMindAnswer({
    ...base,
    question: "IRIS, crea una inteligencia artificial especializada en administrar mi tienda Pet Grooming Store",
  });
  assert.equal(result.source, "local");
  assert.match(result.answer, /IRIS Creator/);
  assert.match(result.answer, /Pet Grooming Store|Guardian|aprobaci[oó]n/i);
});
