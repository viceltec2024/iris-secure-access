import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("IRIS agent tools are read-only security lookups", () => {
  const source = readFileSync(new URL("../lib/iris-agent.ts", import.meta.url), "utf8");
  assert.match(source, /get_security_overview/);
  assert.match(source, /list_active_alerts/);
  assert.match(source, /get_device_details/);
  assert.match(source, /reportedDeviceStatus/);
  assert.doesNotMatch(source, /child_process|execSync|privateKey/);
  assert.doesNotMatch(source, /name: "execute_/);
});

test("IRIS agent run falls back locally and stays inside five steps", () => {
  const route = readFileSync(new URL("../app/api/agent/run/route.ts", import.meta.url), "utf8");
  assert.match(route, /MAX_STEPS = 5/);
  assert.match(route, /resolveIrisAsk/);
  assert.match(route, /IRIS_AGENT_TOOLS/);
  assert.doesNotMatch(route, /arbitrary shell/);
});

test("Ask IRIS shows investigation steps without chain of thought", () => {
  const panel = readFileSync(new URL("../app/dashboard/ask-iris-panel.tsx", import.meta.url), "utf8");
  assert.match(panel, /Revisé el estado de seguridad/);
  assert.match(panel, /iris-chat-steps/);
  assert.doesNotMatch(panel, /chain-of-thought|thinking out loud/i);
});
