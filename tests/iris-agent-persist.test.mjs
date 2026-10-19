import assert from "node:assert/strict";
import test from "node:test";
import {
  addCreatedAgent,
  approveCreatedAgent,
  designAgentFromPrompt,
  emptyCreatorDesk,
} from "../lib/iris-creator.ts";
import {
  PERSIST_HEARTBEAT_COST_CENTS,
  agentActivityLog,
  agentCostAccounting,
  evaluatePersistentGuardian,
  isWithinAgentSchedule,
  runPersistentAgentCycle,
} from "../lib/iris-agent-persist.ts";

function approvedAlwaysOn(id = "persist-1") {
  const designed = designAgentFromPrompt({
    id,
    prompt: "Crea una IA especializada en soporte técnico persistente",
    language: "es",
    schedule: "always_on",
  });
  const desk = addCreatedAgent(emptyCreatorDesk(), designed);
  return approveCreatedAgent(desk, designed.id, "owner@iris.local").agent;
}

test("persistent cycle runs supervised heartbeat with Guardian and cost metering", () => {
  const agent = approvedAlwaysOn();
  const cycle = runPersistentAgentCycle({
    state: { agents: [agent] },
    limits: { allowed: true, code: "ok", detail: "within_limits" },
    language: "es",
    now: "2026-10-19T16:00:00.000Z",
    idFactory: (() => {
      let n = 0;
      return () => `act-${++n}`;
    })(),
  });

  assert.equal(cycle.appliedToRepo, false);
  assert.equal(cycle.selfModifiedCore, false);
  assert.equal(cycle.ran, 1);
  assert.equal(cycle.blocked, 0);
  assert.equal(cycle.estimatedCostCents, PERSIST_HEARTBEAT_COST_CENTS);

  const next = cycle.state.agents[0];
  const log = agentActivityLog(next);
  assert.equal(log.length, 1);
  assert.equal(log[0].kind, "heartbeat");
  assert.equal(log[0].ok, true);
  assert.equal(log[0].appliedToRepo, false);
  assert.equal(log[0].guardian.passed, true);
  assert.ok(log[0].evidence.some(item => item.includes("charge=false")));

  const cost = agentCostAccounting(next);
  assert.equal(cost.runCount, 1);
  assert.equal(cost.estimatedCostCents, PERSIST_HEARTBEAT_COST_CENTS);
});

test("persistent cycle refuses when org budget/limits block", () => {
  const agent = approvedAlwaysOn("persist-budget");
  const cycle = runPersistentAgentCycle({
    state: { agents: [agent] },
    limits: { allowed: false, code: "BUDGET_EXCEEDED", detail: "Monthly budget exhausted." },
    language: "es",
    now: "2026-10-19T16:00:00.000Z",
  });
  assert.equal(cycle.ran, 0);
  assert.equal(cycle.blocked, 1);
  assert.equal(cycle.activity[0].kind, "budget_block");
  assert.equal(cycle.state.agents[0].id, agent.id);
  assert.equal((cycle.state.agents[0].cost?.runCount) || 0, 0);
});

test("Guardian supervision gate is mandatory for persistent execution", () => {
  const agent = approvedAlwaysOn("persist-guard");
  const ok = evaluatePersistentGuardian(agent, "es");
  assert.equal(ok.passed, true);

  const tampered = {
    ...agent,
    guardian: { ...agent.guardian, requiresHumanApproval: false },
  };
  const blocked = evaluatePersistentGuardian(tampered, "es");
  assert.equal(blocked.passed, false);
  assert.ok(blocked.codes.includes("SUPERVISION_REQUIRED") || blocked.codes.includes("MISSING_APPROVAL_GATE"));
});

test("on_demand schedule is skipped by persistent cycle", () => {
  const designed = designAgentFromPrompt({
    id: "persist-od",
    prompt: "Crea una IA especializada en reportes bajo demanda",
    language: "es",
    schedule: "on_demand",
  });
  const desk = addCreatedAgent(emptyCreatorDesk(), designed);
  const agent = approveCreatedAgent(desk, designed.id, "owner@iris.local").agent;
  assert.equal(isWithinAgentSchedule(agent, new Date("2026-10-19T16:00:00.000Z")), false);

  const cycle = runPersistentAgentCycle({
    state: { agents: [agent] },
    limits: { allowed: true, code: "ok", detail: "within_limits" },
    language: "es",
    now: "2026-10-19T16:00:00.000Z",
  });
  assert.equal(cycle.ran, 0);
  assert.equal(cycle.skipped, 1);
  assert.equal(cycle.activity[0].kind, "schedule_skip");
});
