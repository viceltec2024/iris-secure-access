import assert from "node:assert/strict";
import test from "node:test";
import { designAgentFromPrompt } from "../lib/iris-creator.ts";
import { runMission } from "../lib/iris-mission.ts";
import { runIsolatedAgentSandbox } from "../lib/iris-sandbox-runner.ts";
import { runIrisEvaluationSuite } from "../lib/iris-evals.ts";

test("performance: mission + sandbox complete under 1000ms locally", () => {
  const started = Date.now();
  const mission = runMission({
    id: "perf-mission",
    objective: "Proponer agente de inventario con checklist diaria",
    language: "es",
  });
  const elapsed = Date.now() - started;
  assert.ok(mission.sandbox);
  assert.ok(elapsed < 1000, `mission too slow: ${elapsed}ms`);
});

test("performance: evaluation suite under 1500ms locally", () => {
  const started = Date.now();
  const report = runIrisEvaluationSuite({ language: "es" });
  const elapsed = Date.now() - started;
  assert.equal(report.summary.failed, 0);
  assert.ok(elapsed < 1500, `eval suite too slow: ${elapsed}ms`);
});

test("performance: designAgentFromPrompt under 200ms", () => {
  const started = Date.now();
  const agent = designAgentFromPrompt({
    id: "perf-agent",
    prompt: "Crea una IA especializada en logística",
    language: "es",
  });
  const isolated = runIsolatedAgentSandbox(agent, "es");
  const elapsed = Date.now() - started;
  assert.equal(isolated.ok, true);
  assert.ok(elapsed < 200, `design+sandbox too slow: ${elapsed}ms`);
});
