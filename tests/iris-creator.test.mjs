import assert from "node:assert/strict";
import test from "node:test";
import {
  addAgentProposal,
  approveCreatedAgent,
  buildImprovementProposal,
  creatorAskReply,
  decideAgentProposal,
  designAgentFromPrompt,
  extractSpecialty,
  isCreatorRequest,
  pauseCreatedAgent,
  rejectCreatedAgent,
  runGuardianChecks,
  tickApprovedAgents,
} from "../lib/iris-creator.ts";
import { buildModelCoordinationReport } from "../lib/iris-model-registry.ts";
import { macAgentPrepSteps } from "../lib/iris-mac-prep.ts";

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

test("approved agents propose code/tests that still need human approval and never auto-apply", () => {
  const agent = designAgentFromPrompt({
    id: "agent-3",
    prompt: "Crea una IA especializada en administrar mi librería",
    language: "es",
  });
  const approved = approveCreatedAgent({ agents: [agent] }, agent.id, "owner@iris.local");
  const proposal = buildImprovementProposal({
    id: "prop-1",
    agent: approved.agent,
    type: "code_improvement",
    language: "es",
  });
  assert.match(proposal.body, /no aplicada|no aplica/i);
  assert.equal(proposal.status, "awaiting_approval");
  const queued = addAgentProposal(approved.state, agent.id, proposal);
  assert.equal(queued.agent.proposals.length, 1);
  const decided = decideAgentProposal(queued.state, agent.id, proposal.id, "approve", "owner@iris.local");
  assert.equal(decided.proposal.status, "approved");
  assert.match(decided.proposal.body, /no aplicada|no aplica/i);
  assert.ok(approved.agent.permissions.includes("propose_code_changes"));
  assert.ok(approved.agent.permissions.includes("propose_tests"));
});

test("model registry reports Meta AI as unavailable and does not invent readiness", () => {
  const report = buildModelCoordinationReport({ ELEVENLABS_API_KEY: "sk_test" }, "es");
  const meta = report.coordinators.find(item => item.id === "meta_ai");
  const eleven = report.coordinators.find(item => item.id === "elevenlabs");
  const openai = report.coordinators.find(item => item.id === "openai");
  assert.equal(meta?.status, "unavailable");
  assert.equal(meta?.provenInCode, false);
  assert.equal(eleven?.status, "ready");
  assert.equal(openai?.status, "missing");
  assert.ok(report.notes.some(note => /clave configurada|configured key/i.test(note)));
});

test("Mac prep checklist never claims ONLINE without enrollment", () => {
  const steps = macAgentPrepSteps("es");
  assert.equal(steps.length, 4);
  const text = steps.map(step => `${step.title} ${step.detail} ${step.doneWhen}`).join(" ");
  assert.match(text, /Nunca inventes ONLINE/);
  assert.match(text, /lastSeenAt menor a 5 minutos/);
  assert.doesNotMatch(text, /dispositivo ya está ONLINE|already ONLINE/i);
});
