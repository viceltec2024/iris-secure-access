import assert from "node:assert/strict";
import test from "node:test";
import {
  parseKnowledgeStore,
  recallKnowledge,
  rememberKnowledge,
  seededKnowledgeStore,
  serializeLearnedKnowledge,
} from "../lib/iris-knowledge.ts";
import { isOwnIntelligenceQuestion } from "../lib/iris-query.ts";

test("IRIS knowledge seed answers Wikipedia topics without a network call", () => {
  const store = seededKnowledgeStore();
  const photo = recallKnowledge(store, "fotosíntesis", "es");
  assert.equal(photo?.origin, "seed");
  assert.match(photo?.extract || "", /plantas/i);
  const mars = recallKnowledge(store, "Marte", "es");
  assert.match(mars?.title || "", /Marte/);
  const curie = recallKnowledge(store, "Marie Curie", "es");
  assert.match(curie?.extract || "", /Nobel/i);
});

test("IRIS knowledge store remembers learned Wikipedia facts", () => {
  const learned = rememberKnowledge(seededKnowledgeStore(), {
    topic: "quimioterapia",
    title: "Quimioterapia",
    extract: "Tratamiento con fármacos contra el cáncer.",
    url: "https://es.wikipedia.org/wiki/Quimioterapia",
    language: "es",
  });
  const blob = serializeLearnedKnowledge(learned);
  assert.doesNotMatch(blob, /fotosintesis|Fotosíntesis/);
  assert.match(blob, /quimioterapia/i);
  const restored = seededKnowledgeStore(parseKnowledgeStore(blob));
  assert.equal(recallKnowledge(restored, "quimioterapia", "es")?.origin, "learned");
  assert.equal(recallKnowledge(restored, "fotosíntesis", "es")?.origin, "seed");
});

test("own-intelligence phrasing is recognized", () => {
  assert.equal(isOwnIntelligenceQuestion("quiero que tenga inteligencia propia"), true);
  assert.equal(isOwnIntelligenceQuestion("wikipedia dentro del sistema"), true);
  assert.equal(isOwnIntelligenceQuestion("cómo está mi mac"), false);
});
