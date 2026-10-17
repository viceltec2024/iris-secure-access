import assert from "node:assert/strict";
import test from "node:test";
import { designAgentFromPrompt } from "../lib/iris-creator.ts";
import { runMission, approveMission, addMission } from "../lib/iris-mission.ts";
import { runIrisEvaluationSuite } from "../lib/iris-evals.ts";

test("reliability: repeated missions stay supervised and non-destructive", () => {
  for (let index = 0; index < 5; index += 1) {
    const mission = runMission({
      id: `rel-${index}`,
      objective: "Crear agente de seguimiento de compras pendientes",
      language: "es",
    });
    assert.equal(mission.agent?.autonomy, "supervised");
    assert.equal(mission.result?.appliedToRepo, false);
    assert.equal(mission.result?.selfModifiedCore, false);
  }
});

test("reliability: human accept does not flip appliedToRepo or invent verification alone", () => {
  const mission = runMission({
    id: "rel-approve",
    objective: "Crear agente de reportes semanales de seguridad",
    language: "es",
  });
  assert.equal(mission.status, "verified");
  assert.equal(mission.verification?.passed, true);
  const approved = approveMission(addMission({ missions: [] }, mission), mission.id, "owner@iris.local");
  assert.equal(approved.mission.status, "accepted");
  assert.equal(approved.mission.result?.appliedToRepo, false);
  assert.equal(approved.mission.result?.selfModifiedCore, false);
});

test("reliability: evaluation suite is deterministic on pass/fail set", () => {
  const a = runIrisEvaluationSuite({ language: "es", now: "2026-10-16T00:00:00.000Z" });
  const b = runIrisEvaluationSuite({ language: "es", now: "2026-10-16T00:00:00.000Z" });
  assert.deepEqual(a.cases.map(item => [item.id, item.status]), b.cases.map(item => [item.id, item.status]));
  const agent = designAgentFromPrompt({
    id: "rel-agent",
    prompt: "Create an AI specialized in bookstore ops",
    language: "en",
  });
  assert.equal(agent.guardian.requiresHumanApproval, true);
});
