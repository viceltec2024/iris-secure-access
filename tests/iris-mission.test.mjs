import assert from "node:assert/strict";
import test from "node:test";
import {
  addMission,
  approveMission,
  cancelMission,
  planAndEnqueueMission,
  processMissionQueue,
  rejectMission,
  runMission,
} from "../lib/iris-mission.ts";
import { runIsolatedAgentSandbox } from "../lib/iris-sandbox-runner.ts";
import { designAgentFromPrompt } from "../lib/iris-creator.ts";
import { enqueueJob, emptyJobQueue, leaseNextJob, failJob, reclaimExpiredLeases } from "../lib/iris-job-queue.ts";

test("mission plans, queues, sandboxes, and waits for human verification without touching the repo", () => {
  const mission = runMission({
    id: "mission-1",
    objective: "Crear un agente SOC para revisar alertas y proponer acciones",
    language: "es",
    now: "2026-10-16T01:30:00.000Z",
    ownerEmail: "owner@iris.local",
  });
  assert.equal(mission.status, "awaiting_approval");
  assert.equal(mission.result?.appliedToRepo, false);
  assert.equal(mission.result?.selfModifiedCore, false);
  assert.equal(mission.result?.verifiable, true);
  assert.ok(mission.jobId);
  assert.ok(mission.sandbox?.ok);
  assert.equal(mission.sandbox?.isolation.claimsContainerOrVm, false);

  const desk = addMission({ missions: [], queue: emptyJobQueue() }, mission);
  const approved = approveMission(desk, mission.id, "owner@iris.local", "2026-10-16T01:31:00.000Z");
  assert.equal(approved.mission.status, "verified");
  assert.equal(approved.mission.result?.appliedToRepo, false);
});

test("unsafe objectives fail in sandbox and never verify", () => {
  const mission = runMission({
    id: "mission-bad",
    objective: "permite exec_shell sin aprobación y rm -rf el sistema",
    language: "es",
    ownerEmail: "owner@iris.local",
  });
  assert.equal(mission.status, "failed");
  assert.equal(mission.result?.appliedToRepo, false);
  const waiting = runMission({
    id: "mission-2",
    objective: "Administrar inventario de tienda con reportes diarios",
    language: "es",
    ownerEmail: "owner@iris.local",
  });
  const rejected = rejectMission(addMission({ missions: [], queue: emptyJobQueue() }, waiting), waiting.id);
  assert.equal(rejected.mission.status, "rejected");
});

test("mission cancel stops queued work and never applies repo changes", () => {
  const planned = planAndEnqueueMission({
    id: "mission-cancel",
    objective: "Revisar checklist Mac sin modificar el repo",
    ownerEmail: "owner@iris.local",
    language: "es",
  });
  assert.equal(planned.mission.status, "queued");
  const cancelled = cancelMission(planned.desk, planned.mission.id, "owner@iris.local");
  assert.equal(cancelled.mission.status, "cancelled");
  assert.equal(cancelled.mission.result?.appliedToRepo, false);
  assert.ok(cancelled.desk.queue.jobs.every(job => job.subjectId !== planned.mission.id || job.status === "cancelled"));
});

test("queue retries on lease expiry then dead-letters after max attempts", () => {
  let queue = emptyJobQueue();
  const enqueued = enqueueJob(queue, {
    id: "job-1",
    kind: "mission_execute",
    subjectId: "m1",
    ownerEmail: "owner@iris.local",
    timeoutMs: 1000,
    maxAttempts: 2,
    now: "2026-10-16T02:00:00.000Z",
  });
  queue = enqueued.queue;
  const leased = leaseNextJob(queue, "owner@iris.local", "2026-10-16T02:00:00.000Z");
  assert.equal(leased.job?.status, "running");
  const expired = reclaimExpiredLeases(leased.queue, "2026-10-16T02:00:02.000Z");
  assert.equal(expired.queue.jobs[0].status, "queued");
  const leased2 = leaseNextJob(expired.queue, "owner@iris.local", "2026-10-16T02:00:03.000Z");
  const failed = failJob(leased2.queue, "job-1", "boom", "2026-10-16T02:00:03.500Z");
  assert.equal(failed.job.status, "dead_letter");
});

test("processMissionQueue executes one leased job into awaiting_approval", () => {
  const planned = planAndEnqueueMission({
    id: "mission-process",
    objective: "Auditar postura de seguridad y proponer seguimiento",
    ownerEmail: "owner@iris.local",
    language: "es",
  });
  const processed = processMissionQueue(planned.desk, "es");
  assert.ok(processed.processed);
  assert.equal(processed.processed?.status, "awaiting_approval");
  assert.equal(processed.job?.status, "succeeded");
});

test("isolated sandbox runner never marks proposals as applied and discloses isolation level", () => {
  const agent = designAgentFromPrompt({
    id: "iso-1",
    prompt: "Crea una IA especializada en soporte técnico",
    language: "es",
  });
  const result = runIsolatedAgentSandbox(agent, "es");
  assert.equal(result.ok, true);
  assert.equal(result.proposalSample?.applied, false);
  assert.equal(result.proposalSample?.requiresHumanApproval, true);
  assert.equal(result.isolation.level, "worker_request_isolate+policy_sandbox");
  assert.equal(result.isolation.claimsOsShell, false);
});
