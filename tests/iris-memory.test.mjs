import assert from "node:assert/strict";
import test from "node:test";
import {
  appendMemory,
  buildLessonFromEval,
  decideLessonPromotion,
  emptyMemoryStore,
  memoryAllowsSelfModify,
  activeLessons,
} from "../lib/iris-memory.ts";

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
