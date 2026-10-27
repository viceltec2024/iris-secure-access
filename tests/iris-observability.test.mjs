import assert from "node:assert/strict";
import test from "node:test";
import { appendObsSample, emptyObsStore, summarizeObs } from "../lib/iris-observability.ts";
import { enqueueApprovedAgentTicks, processAgentTickQueue } from "../lib/iris-agent-runtime.ts";
import { addCreatedAgent, approveCreatedAgent, designAgentFromPrompt, emptyCreatorDesk } from "../lib/iris-creator.ts";

test("observability summarizes ask latency and guardian blocks", () => {
  let store = emptyObsStore();
  const now = Date.now();
  store = appendObsSample(store, { kind: "ask_latency_ms", value: 40, at: new Date(now - 1000).toISOString() });
  store = appendObsSample(store, { kind: "ask_latency_ms", value: 120, at: new Date(now - 2000).toISOString() });
  store = appendObsSample(store, { kind: "guardian_block", value: 1, at: new Date(now - 3000).toISOString(), label: "IGNORE_PRIOR" });
  const summary = summarizeObs(store, now);
  assert.equal(summary.askCount, 2);
  assert.equal(summary.askP50Ms, 40);
  assert.equal(summary.guardianBlocks, 1);
});

test("creator desk enqueues and drains agent_tick without applying repo changes", () => {
  const designed = designAgentFromPrompt({
    id: "tick-agent",
    prompt: "Crea una IA especializada en soporte",
    language: "es",
    schedule: "always_on",
  });
  const approved = approveCreatedAgent(
    addCreatedAgent(emptyCreatorDesk(), designed),
    designed.id,
    "owner@iris.local",
    "2026-10-25T10:00:00.000Z",
  );
  const queued = enqueueApprovedAgentTicks({
    state: approved.state,
    ownerEmail: "owner@iris.local",
    now: "2026-10-25T10:01:00.000Z",
  });
  assert.ok(queued.queue.jobs.some(job => job.kind === "agent_tick" && job.status === "queued"));
  const drained = processAgentTickQueue({
    state: queued,
    ownerEmail: "owner@iris.local",
    language: "es",
    now: "2026-10-25T10:02:00.000Z",
  });
  assert.equal(drained.tick?.ok, true);
  assert.equal(drained.tick?.appliedToRepo, false);
  assert.equal(drained.job?.status, "succeeded");
  assert.equal(drained.state.agents[0].lastTickAt, "2026-10-25T10:02:00.000Z");
});
