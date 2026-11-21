import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { buildIrisAgentInstructions, MAX_AGENT_TOOL_CALLS, withinAgentToolLimit } from "../lib/iris-agent-workflow.ts";

test("IRIS agent tools are read-only security lookups", () => {
  const source = readFileSync(new URL("../lib/iris-agent.ts", import.meta.url), "utf8");
  assert.match(source, /get_security_overview/);
  assert.match(source, /list_active_alerts/);
  assert.match(source, /get_device_details/);
  assert.match(source, /lookup_wikipedia/);
  assert.match(source, /reportedDeviceStatus/);
  assert.doesNotMatch(source, /OPENAI_API_KEY\s*[:=]\s*['\"]sk-/);
  assert.doesNotMatch(source, /child_process|execSync|privateKey/);
  assert.doesNotMatch(source, /name: "execute_/);
});

test("IRIS agent run falls back locally and stays inside five steps", () => {
  const route = readFileSync(new URL("../app/api/agent/run/route.ts", import.meta.url), "utf8");
  assert.match(route, /MAX_STEPS = 5/);
  assert.match(route, /resolveIrisAsk/);
  assert.match(route, /buildSocReasonedAnswerForAsk/);
  assert.match(route, /ASK_IRIS_MEMORY_CONSENT/);
  assert.match(route, /route\.kind !== "agent"/);
  assert.match(route, /IRIS_AGENT_TOOLS/);
  assert.match(route, /withinAgentToolLimit/);
  assert.match(route, /runMuseEditAgent/);
  assert.doesNotMatch(route, /arbitrary shell/);
});

test("agent workflow instructions are bilingual and require evidence review without exposing private reasoning", () => {
  for (const language of ["es", "en"]) {
    const instructions = buildIrisAgentInstructions(language);
    assert.match(instructions, /five|cinco/);
    assert.match(instructions, /read-only|solo lectura/);
    assert.match(instructions, /Before responding|Antes de responder/);
    assert.match(instructions, /Never expose private chain-of-thought|No reveles razonamiento privado/);
  }
});

test("agent tool execution is capped across model rounds", () => {
  assert.equal(MAX_AGENT_TOOL_CALLS, 5);
  assert.equal(withinAgentToolLimit(0), true);
  assert.equal(withinAgentToolLimit(4), true);
  assert.equal(withinAgentToolLimit(5), false);
  assert.equal(withinAgentToolLimit(-1), false);
});

test("Ask IRIS shows investigation steps without chain of thought", () => {
  const panel = readFileSync(new URL("../app/dashboard/ask-iris-panel.tsx", import.meta.url), "utf8");
  assert.match(panel, /Revisé el estado de seguridad/);
  assert.match(panel, /Muse editó el texto/);
  assert.match(panel, /Consulté Wikipedia/);
  assert.match(panel, /iris-chat-steps/);
  assert.doesNotMatch(panel, /chain-of-thought|thinking out loud/i);
});
