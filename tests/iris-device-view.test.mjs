import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { deviceView, irisAgentShellCommand, parseJsonRecord, reportedDeviceStatus } from "../lib/iris-device-view.ts";

test("broken telemetry JSON does not crash device views", () => {
  assert.deepEqual(parseJsonRecord("{not-json"), {});
  assert.deepEqual(parseJsonRecord("[]"), {});
  assert.equal(parseJsonRecord('{"hostname":"Eze-Mac"}').hostname, "Eze-Mac");
});

test("stale enrolled Macs are OFFLINE even if the database still says ONLINE", () => {
  assert.equal(reportedDeviceStatus({ agentTokenHash: "abc", lastSeenAt: "2026-09-07T21:54:00.000Z" }, Date.parse("2026-09-08T02:25:00.000Z")), "OFFLINE");
  assert.equal(reportedDeviceStatus({ agentTokenHash: "abc", lastSeenAt: "2026-09-08T02:24:00.000Z" }, Date.parse("2026-09-08T02:25:00.000Z")), "ONLINE");
  assert.equal(reportedDeviceStatus({ agentTokenHash: null, lastSeenAt: null }, Date.parse("2026-09-08T02:25:00.000Z")), "PENDING");
});

test("reconnect command targets this IRIS origin", () => {
  const command = irisAgentShellCommand("https://iris.example", true);
  assert.match(command, /iris-agent-macos\.sh\?v=36/);
  assert.match(command, /IRIS_API_URL="https:\/\/iris\.example\/api\/agent\/check-in"/);
  assert.match(command, /reconnect$/);
  assert.doesNotMatch(irisAgentShellCommand("https://iris.example", false), /reconnect/);
});

test("device health drops when the report is stale", () => {
  const view = deviceView({
    id: "mac-1",
    name: "My Mac",
    platform: "macOS",
    status: "ONLINE",
    risk: "MEDIUM",
    enrollmentCode: "ABC",
    agentTokenHash: "hash",
    lastSeenAt: "2026-09-07T21:54:00.000Z",
    telemetry: JSON.stringify({ firewallEnabled: false, gatekeeperEnabled: true, fileVaultEnabled: true, sipEnabled: true, automaticUpdatesEnabled: true, xProtectPresent: true, malwareRemovalToolPresent: true }),
  }, [], Date.parse("2026-09-08T02:25:00.000Z"));
  assert.equal(view.status, "OFFLINE");
  assert.equal(view.healthScore, 50);
});

test("macOS agent can reconnect to a chosen IRIS URL", () => {
  const source = readFileSync(new URL("../public/iris-agent-macos.sh", import.meta.url), "utf8");
  assert.match(source, /reconnect\) reconnect_agent/);
  assert.match(source, /IRIS_API_URL/);
  assert.match(source, /api-url/);
  assert.match(source, /kickstart/);
});
