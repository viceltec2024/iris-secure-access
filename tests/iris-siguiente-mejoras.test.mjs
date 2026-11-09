import assert from "node:assert/strict";
import test from "node:test";
import { isTechnicalTopic, lookupMdn } from "../lib/iris-mdn.ts";
import {
  buildCitedAnswer,
  isAllowedSourceUrl,
} from "../lib/iris-cited-answer.ts";
import {
  canAccessOrgScopedRow,
  filterOrgScopedRows,
  purchaseLegacyKey,
  purchaseOrgKey,
  scopedReadKeys,
  scopedWriteKey,
  walletLegacyKey,
  walletOrgKey,
} from "../lib/iris-org-scope.ts";
import { approveCreatedAgent, designAgentFromPrompt } from "../lib/iris-creator.ts";
import { acceptMission, planAndEnqueueMission, emptyMissionDesk, processMissionQueue } from "../lib/iris-mission.ts";
import { memoryAllowsSelfModify } from "../lib/iris-memory.ts";

// --- 1. MDN fetcher -------------------------------------------------------

test("siguiente: MDN solo para temas técnicos", () => {
  assert.equal(isTechnicalTopic("cómo funciona fetch en JavaScript"), true);
  assert.equal(isTechnicalTopic("qué es un gato"), false);
  assert.equal(isTechnicalTopic("CSS Grid layout"), true);
});

function mdnStub(documents) {
  return async (url, options) => {
    assert.match(url, /^https:\/\/developer\.mozilla\.org\/api\/v1\/search/);
    assert.ok(options.signal, "timeout signal set");
    return {
      ok: true,
      text: async () => JSON.stringify({ documents }),
    };
  };
}

test("siguiente: MDN devuelve un hit real consultado, con URL permitida", async () => {
  const hit = await lookupMdn("fetch API JavaScript", "en", mdnStub([
    { title: "Fetch API", slug: "en-US/docs/Web/API/Fetch_API", mdn_url: "https://developer.mozilla.org/en-US/docs/Web/API/Fetch_API", summary: "The Fetch API provides an interface for fetching resources across the network." },
  ]));
  assert.ok(hit);
  assert.equal(hit.url, "https://developer.mozilla.org/en-US/docs/Web/API/Fetch_API");
  assert.equal(isAllowedSourceUrl(hit.url), true);
  // Dos hosts distintos (Wikipedia + MDN) dan "verificado", nunca inventado.
  const cited = buildCitedAnswer({
    language: "en",
    answerBody: "The Fetch API provides an interface for fetching resources.",
    sources: [
      { title: "Fetch API", url: "https://en.wikipedia.org/wiki/Fetch_API", consultedAt: "2026-11-03T00:00:00.000Z" },
      { title: hit.title, url: hit.url, consultedAt: "2026-11-03T00:00:00.000Z", excerpt: hit.excerpt },
    ],
  });
  assert.equal(cited.confidence, "verificado");
  assert.equal(cited.sources.length, 2);
});

test("siguiente: MDN no devuelve hits irrelevantes ni ante fallos", async () => {
  const irrelevant = await lookupMdn("fetch API JavaScript", "en", mdnStub([
    { title: "Gatos domésticos", slug: "en-US/docs/Web/API/Cat", mdn_url: "https://developer.mozilla.org/en-US/docs/Web/API/Cat", summary: "Los gatos son animales domésticos." },
  ]));
  assert.equal(irrelevant, null);
  const failing = await lookupMdn("fetch API JavaScript", "en", async () => { throw new Error("red"); });
  assert.equal(failing, null);
  const notTechnical = await lookupMdn("qué es un gato", "es", mdnStub([]));
  assert.equal(notTechnical, null);
  const oversized = await lookupMdn("fetch API JavaScript", "en", async () => ({
    ok: true, text: async () => "x".repeat(300_001),
  }));
  assert.equal(oversized, null);
});

// --- 2. Aislamiento por organización --------------------------------------

const DEV_A = { id: "d-a", ownerEmail: "a@org-a.example" };
const DEV_B = { id: "d-b", ownerEmail: "b@org-b.example" };

test("siguiente: claves con alcance org primero, legadas después", () => {
  assert.equal(walletOrgKey("org-1"), "iris_local_wallet_session:org:org-1");
  assert.equal(walletLegacyKey("A@Example.com"), "iris_local_wallet_session:a@example.com");
  assert.equal(purchaseOrgKey("org-1"), "iris_purchase_desk:org:org-1");
  assert.equal(purchaseLegacyKey("a@example.com"), "iris_purchase_desk:a@example.com");
  assert.deepEqual(
    scopedReadKeys({ organizationId: "org-1", email: "a@example.com", base: "wallet" }),
    ["iris_local_wallet_session:org:org-1", "iris_local_wallet_session:a@example.com"],
  );
  assert.deepEqual(
    scopedReadKeys({ organizationId: null, email: "a@example.com", base: "purchase" }),
    ["iris_purchase_desk:a@example.com"],
  );
  assert.equal(scopedWriteKey({ organizationId: "org-1", email: "a@example.com", base: "wallet" }), "iris_local_wallet_session:org:org-1");
});

test("siguiente: una org no lee dispositivos de otra; sin contexto, solo los propios", () => {
  const rows = [DEV_A, DEV_B];
  const orgA = filterOrgScopedRows(rows, { actorEmail: "a@org-a.example", memberEmails: ["a@org-a.example", "teammate@org-a.example"] });
  assert.deepEqual(orgA, [DEV_A]);
  assert.equal(canAccessOrgScopedRow(DEV_B, { actorEmail: "a@org-a.example", memberEmails: ["a@org-a.example"] }), false);
  assert.equal(canAccessOrgScopedRow(DEV_A, { actorEmail: "a@org-a.example", memberEmails: ["a@org-a.example"] }), true);
  // Retrocompatible: sin lista de miembros, solo el propio email.
  assert.deepEqual(filterOrgScopedRows(rows, { actorEmail: "b@org-b.example", memberEmails: null }), [DEV_B]);
  // El ADMIN global de plataforma es la única excepción documentada.
  assert.deepEqual(filterOrgScopedRows(rows, { actorEmail: "admin@iris.local", isGlobalAdmin: true }), rows);
});

// --- 3. CAS en aprobaciones (el panel ya envía expectedRevision) -----------

test("siguiente: aprobar con revisión obsoleta se rechaza, con revisión vigente pasa", () => {
  const agent = designAgentFromPrompt({
    id: "agent-cas",
    prompt: "Crea una inteligencia artificial especializada en administrar mi tienda Pet Grooming Store",
    language: "es",
    schedule: "always_on",
    now: "2026-11-03T00:00:00.000Z",
  });
  assert.equal(agent.status, "awaiting_approval");
  const desk = { agents: [agent], queue: { jobs: [] }, revision: 3 };
  assert.throws(
    () => approveCreatedAgent(desk, agent.id, "owner@iris.local", "2026-11-03T00:01:00.000Z", 2),
    /revision_conflict/,
  );
  const approved = approveCreatedAgent(desk, agent.id, "owner@iris.local", "2026-11-03T00:01:00.000Z", 3);
  assert.equal(approved.agent.status, "approved");
});

test("siguiente: aceptar misión con revisión obsoleta se rechaza, con vigente pasa", () => {
  const planned = planAndEnqueueMission({
    id: "mission-cas",
    objective: "Auditar la postura de seguridad y proponer un agente de seguimiento SOC",
    ownerEmail: "owner@iris.local",
    language: "es",
    desk: emptyMissionDesk(),
  });
  // Tras procesar la cola la misión queda "verified": aceptable por humano.
  const processed = processMissionQueue(planned.desk, "es").desk;
  const desk = { ...processed, revision: 7 };
  const mission = desk.missions.find(item => item.id === "mission-cas");
  assert.ok(mission, "misión planificada");
  assert.equal(mission.status, "verified");
  // assertMissionRevision se comprueba antes que el estado: una revisión
  // obsoleta da revision_conflict aunque la misión sea aceptable.
  assert.throws(
    () => acceptMission(desk, "mission-cas", "owner@iris.local", "2026-11-03T00:01:00.000Z", 6),
    /revision_conflict/,
  );
  const accepted = acceptMission(desk, "mission-cas", "owner@iris.local", "2026-11-03T00:01:00.000Z", 7);
  assert.equal(accepted.mission.status, "accepted");
  assert.equal(memoryAllowsSelfModify(), false);
});
