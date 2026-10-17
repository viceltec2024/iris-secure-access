import assert from "node:assert/strict";
import test from "node:test";
import { buildCoordinatorSnapshot, classifyCoordinatorTask, decideCoordinatorTask } from "../lib/iris-coordinator.ts";
import { authorizeTool, isForbiddenTool } from "../lib/iris-tool-acl.ts";
import { emptyCreatorDesk } from "../lib/iris-creator.ts";
import { emptyMissionDesk } from "../lib/iris-mission.ts";
import { emptyJobQueue } from "../lib/iris-job-queue.ts";
import { probeAllProviders, probeOpenAI, probeLocal } from "../lib/iris-provider-probe.ts";
import { searchMemory, appendMemory, emptyMemoryStore, recordErrorSolution, memoryAllowsSelfModify } from "../lib/iris-memory.ts";

test("coordinator routes edit/mission/creator tasks without inventing live providers", () => {
  assert.equal(classifyCoordinatorTask("reescribe: activa el firewall"), "edit");
  assert.equal(classifyCoordinatorTask("Inicia una misión para auditar el SOC"), "mission");
  assert.equal(classifyCoordinatorTask("Crea un agente para inventario"), "creator");
  const decision = decideCoordinatorTask({
    question: "¿Cuál es el estado del sistema?",
    env: {},
  });
  assert.equal(decision.task, "ask");
  assert.equal(decision.route?.provider, "local");
  assert.equal(decision.isolation.claimsContainerOrVm, false);
});

test("tool ACL blocks forbidden and unknown tools", () => {
  assert.equal(isForbiddenTool("exec_shell"), true);
  assert.equal(authorizeTool({ tool: "exec_shell" }).allowed, false);
  assert.equal(authorizeTool({ tool: "policy_sandbox" }).allowed, true);
  assert.equal(authorizeTool({ tool: "proposal_queue", humanApproved: false }).allowed, false);
});

test("provider probes never claim live_ok without keys", async () => {
  const openai = await probeOpenAI({});
  assert.equal(openai.status, "skipped_no_key");
  const local = probeLocal();
  assert.equal(local.status, "local_ready");
  const all = await probeAllProviders({});
  assert.ok(all.providers.every(item => item.status !== "live_ok" || item.id === "cloudflare_ai"));
  assert.ok(all.providers.some(item => item.id === "openai" && item.status === "skipped_no_key"));
  assert.ok(all.providers.some(item => item.id === "muse" && item.status === "skipped_no_key"));
  assert.ok(all.providers.some(item => item.id === "elevenlabs" && item.status === "skipped_no_key"));
});

test("coordinator snapshot exposes queue and honest isolation claim", () => {
  const snapshot = buildCoordinatorSnapshot({
    env: {},
    creator: emptyCreatorDesk(),
    missions: emptyMissionDesk(),
    queue: emptyJobQueue(),
  });
  assert.match(snapshot.isolationClaim, /policy_sandbox/);
  assert.equal(snapshot.agents.total, 0);
  assert.equal(snapshot.queue.queued, 0);
});

test("memory search retrieves error solutions and never allows self-modify", () => {
  let store = emptyMemoryStore();
  store = appendMemory(store, recordErrorSolution({
    id: "err-1",
    title: "Sandbox falló",
    error: "Guardian blocked exec_shell",
    solution: "Remove shell request and retry mission",
    actorEmail: "owner@iris.local",
  }));
  const hits = searchMemory(store, "exec_shell guardian");
  assert.equal(hits.length, 1);
  assert.equal(hits[0].kind, "error_solution");
  assert.equal(memoryAllowsSelfModify(), false);
});
