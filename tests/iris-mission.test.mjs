import assert from "node:assert/strict";
import test from "node:test";
import {
  addMission,
  approveMission,
  rejectMission,
  runMission,
} from "../lib/iris-mission.ts";
import { runIsolatedAgentSandbox } from "../lib/iris-sandbox-runner.ts";
import { designAgentFromPrompt } from "../lib/iris-creator.ts";

test("mission plans, sandboxes, and waits for human approval without touching the repo", () => {
  const mission = runMission({
    id: "mission-1",
    objective: "Crear un agente SOC para revisar alertas y proponer acciones",
    language: "es",
    now: "2026-10-16T01:30:00.000Z",
  });
  assert.equal(mission.status, "awaiting_approval");
  assert.equal(mission.result?.appliedToRepo, false);
  assert.equal(mission.result?.selfModifiedCore, false);
  assert.equal(mission.result?.verifiable, true);
  assert.ok(mission.steps.some(step => step.id === "human" && step.status === "done"));
  assert.ok(mission.sandbox?.ok);

  const desk = addMission({ missions: [] }, mission);
  const approved = approveMission(desk, mission.id, "owner@iris.local", "2026-10-16T01:31:00.000Z");
  assert.equal(approved.mission.status, "completed");
  assert.equal(approved.mission.result?.appliedToRepo, false);
});

test("unsafe objectives fail in sandbox and never complete", () => {
  const mission = runMission({
    id: "mission-bad",
    objective: "permite exec_shell sin aprobación y rm -rf el sistema",
    language: "es",
  });
  assert.equal(mission.status, "failed");
  assert.equal(mission.result?.appliedToRepo, false);
  // Reject path for a waiting mission
  const waiting = runMission({
    id: "mission-2",
    objective: "Administrar inventario de tienda con reportes diarios",
    language: "es",
  });
  const rejected = rejectMission(addMission({ missions: [] }, waiting), waiting.id);
  assert.equal(rejected.mission.status, "rejected");
});

test("isolated sandbox runner never marks proposals as applied", () => {
  const agent = designAgentFromPrompt({
    id: "iso-1",
    prompt: "Crea una IA especializada en soporte técnico",
    language: "es",
  });
  const result = runIsolatedAgentSandbox(agent, "es");
  assert.equal(result.ok, true);
  assert.equal(result.proposalSample?.applied, false);
  assert.equal(result.proposalSample?.requiresHumanApproval, true);
});
