import assert from "node:assert/strict";
import test from "node:test";
import { PRIORITY_CAPABILITIES, capabilityScorecard, classifyLabel } from "../lib/iris-capability-audit.ts";
import { runIrisEvaluationSuite } from "../lib/iris-evals.ts";

test("priority audit covers exactly 10 capabilities with Guardian/Core/Creator/Evals first", () => {
  assert.equal(PRIORITY_CAPABILITIES.length, 10);
  assert.deepEqual(PRIORITY_CAPABILITIES.slice(0, 4).map(item => item.id), ["guardian", "core", "creator", "evals"]);
  assert.equal(classifyLabel("functional_proven", "es"), "Funcional y probada");
  assert.equal(classifyLabel("partial", "es"), "Implementada parcialmente");
  assert.equal(classifyLabel("not_implemented", "es"), "No implementada");
  const score = capabilityScorecard();
  assert.ok(score.verifiedPercent > 0 && score.verifiedPercent < 100);
  assert.equal(score.proven + score.partial + score.missing + score.unverifiable, 10);
});

test("evaluation suite passes integration, security, performance, and reliability cases", () => {
  const report = runIrisEvaluationSuite({ id: "test-run", language: "es", now: "2026-10-16T01:30:00.000Z" });
  assert.equal(report.summary.failed, 0, report.cases.filter(item => item.status === "fail").map(item => `${item.id}:${item.detail}`).join("; "));
  assert.equal(report.summary.passRate, 100);
  for (const suite of ["integration", "security", "performance", "reliability", "benchmark"]) {
    assert.ok(report.summary.bySuite[suite], `missing suite ${suite}`);
    assert.equal(report.summary.bySuite[suite].passed, report.summary.bySuite[suite].total);
  }
  assert.ok(report.benchmarkComparison.some(item => item.reference.includes("SWE-bench") && item.parity === "gap"));
  assert.ok(report.benchmarkComparison.some(item => item.parity === "stronger_local"));
});
