import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("IRIS agent tools include investigation and confirmed actions", () => {
  const source = readFileSync(new URL("../lib/iris-agent.ts", import.meta.url), "utf8");
  assert.match(source, /get_security_overview/);
  assert.match(source, /list_active_alerts/);
  assert.match(source, /get_device_details/);
  assert.match(source, /explain_alert/);
  assert.match(source, /trust_application/);
  assert.match(source, /update_alert_status/);
  assert.match(source, /approve_remediation/);
  assert.match(source, /request_device_recheck/);
  assert.match(source, /userConfirmed/);
  assert.match(source, /reportedDeviceStatus/);
  assert.doesNotMatch(source, /OPENAI_API_KEY\s*[:=]\s*['\"]sk-/);
  assert.doesNotMatch(source, /child_process|execSync|privateKey/);
  assert.doesNotMatch(source, /name: "execute_/);
});

test("IRIS agent run requires confirmation for actions and stays inside seven steps", () => {
  const route = readFileSync(new URL("../app/api/agent/run/route.ts", import.meta.url), "utf8");
  assert.match(route, /MAX_STEPS = 7/);
  assert.match(route, /resolveIrisAsk/);
  assert.match(route, /IRIS_AGENT_TOOLS/);
  assert.match(route, /userConfirmed=true/);
  assert.doesNotMatch(route, /arbitrary shell/);
});

test("Ask IRIS shows investigation steps without chain of thought", () => {
  const panel = readFileSync(new URL("../app/dashboard/ask-iris-panel.tsx", import.meta.url), "utf8");
  assert.match(panel, /Revisé el estado de seguridad/);
  assert.match(panel, /Marqué la app como confiable/);
  assert.match(panel, /iris-chat-steps/);
  assert.doesNotMatch(panel, /chain-of-thought|thinking out loud/i);
});
