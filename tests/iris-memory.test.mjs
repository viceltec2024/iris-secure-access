import assert from "node:assert/strict";
import test from "node:test";
import {
  appendMemory,
  buildLessonFromEval,
  decideLessonPromotion,
  emptyMemoryStore,
  memoryAllowsSelfModify,
  activeLessons,
  searchMemory,
} from "../lib/iris-memory.ts";

test("TF-IDF searchMemory ranks relevant lessons above unrelated noise", () => {
  let store = emptyMemoryStore();
  store = appendMemory(store, buildLessonFromEval({
    id: "lesson-fw",
    evalId: "eval-fw",
    title: "Firewall del Mac",
    body: "Cuando FIREWALL_DISABLED aparece, aprobar la remediación y esperar el reporte del agente.",
    score: 90,
    actorEmail: "owner@iris.local",
  }));
  store = appendMemory(store, {
    id: "noise-1",
    kind: "operator_note",
    title: "Wallet Base",
    body: "MetaMask y Robinhood solo abren checkout oficial",
    tags: ["wallet"],
    createdAt: new Date().toISOString(),
    createdBy: "owner@iris.local",
    promotion: "none",
  });
  const approved = decideLessonPromotion(store, "lesson-fw", "approve", "owner@iris.local").store;
  const hits = searchMemory(approved, "firewall mac agente remediacion", 3);
  assert.ok(hits.length >= 1);
  assert.equal(hits[0].id, "lesson-fw");
});

test("memory is append-only and lessons require human promotion", () => {
  assert.equal(memoryAllowsSelfModify(), false);
  let store = emptyMemoryStore();
  const lesson = buildLessonFromEval({
    id: "lesson-1",
    evalId: "eval-1",
    title: "Reforzar Guardian",
    body: "Mantener bloqueo de exec_shell",
    score: 100,
    actorEmail: "owner@iris.local",
  });
  store = appendMemory(store, lesson);
  assert.equal(store.records[0].promotion, "pending");
  assert.equal(activeLessons(store).length, 0);
  const decided = decideLessonPromotion(store, lesson.id, "approve", "owner@iris.local");
  assert.equal(decided.record.promotion, "approved");
  assert.equal(activeLessons(decided.store).length, 1);
  assert.equal(memoryAllowsSelfModify(), false);
});
