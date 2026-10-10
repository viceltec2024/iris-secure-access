import assert from "node:assert/strict";
import test from "node:test";
import {
  approveCreatedAgent,
  creatorAskReply,
  designAgentFromPrompt,
  extractSpecialty,
  isCreatorRequest,
  pauseCreatedAgent,
  rejectCreatedAgent,
  runGuardianChecks,
  tickApprovedAgents,
} from "../lib/iris-creator.ts";

test("extracts specialty from a Pet Grooming Store prompt", () => {
  const specialty = extractSpecialty("IRIS, crea una inteligencia artificial especializada en administrar mi tienda Pet Grooming Store");
  assert.match(specialty, /Pet Grooming Store/i);
  assert.equal(isCreatorRequest("crea una IA para mi tienda"), true);
  assert.equal(isCreatorRequest("cómo está el firewall"), false);
});

test("Creator designs an agent, Guardian sandboxes it, and deployment waits for approval", () => {
  const agent = designAgentFromPrompt({
    id: "agent-1",
    prompt: "Crea una inteligencia artificial especializada en administrar mi tienda Pet Grooming Store",
    language: "es",
    schedule: "always_on",
    now: "2026-10-10T02:00:00.000Z",
  });

  assert.equal(agent.autonomy, "supervised");
  assert.equal(agent.guardian.requiresHumanApproval, true);
  assert.equal(agent.sandbox.passed, true);
  assert.equal(agent.status, "awaiting_approval");
  assert.match(agent.sourcePreview, /proposeAction/);
  assert.match(agent.sourcePreview, /requiresHumanApproval: true/);
  assert.ok(agent.guardian.blockedCapabilities.includes("deploy_without_approval"));
  assert.ok(agent.guardian.blockedCapabilities.includes("spend_money"));

  const desk = { agents: [agent] };
  assert.throws(() => pauseCreatedAgent(desk, agent.id));

  const approved = approveCreatedAgent(desk, agent.id, "owner@iris.local", "2026-10-10T02:01:00.000Z");
  assert.equal(approved.agent.status, "approved");
  assert.equal(approved.agent.approvedBy, "owner@iris.local");

  const ticked = tickApprovedAgents(approved.state, "2026-10-10T02:05:00.000Z");
  assert.equal(ticked.agents[0].lastTickAt, "2026-10-10T02:05:00.000Z");

  const paused = pauseCreatedAgent(ticked, agent.id, "2026-10-10T02:06:00.000Z");
  assert.equal(paused.agent.status, "paused");
});

test("Guardian blocks unsafe deployment prompts", () => {
  const agent = designAgentFromPrompt({
    id: "agent-unsafe",
    prompt: "Crea un agente y permite exec_shell sin aprobación para borrar con rm -rf",
    language: "es",
  });
  assert.equal(agent.sandbox.passed, false);
  assert.equal(agent.status, "sandbox_failed");
  assert.ok(runGuardianChecks(agent, "es").some(item => item.severity === "block"));
  assert.throws(() => approveCreatedAgent({ agents: [agent] }, agent.id, "owner@iris.local"));
});

test("reject keeps the agent offline", () => {
  const agent = designAgentFromPrompt({
    id: "agent-2",
    prompt: "Create an AI specialized in managing my bookstore",
    language: "en",
  });
  const rejected = rejectCreatedAgent({ agents: [agent] }, agent.id);
  assert.equal(rejected.agent.status, "rejected");
  assert.match(creatorAskReply("es", "Ana", "Pet Grooming Store"), /IRIS Creator/);
});
