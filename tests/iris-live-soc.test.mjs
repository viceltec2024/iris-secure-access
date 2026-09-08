import assert from "node:assert/strict";
import test from "node:test";
import {
  applySavedStatuses,
  buildLiveIncidents,
  emptyLiveIncident,
  liveConnectionLine,
  liveIncidentsFromAlerts,
  liveIntelligence,
  liveWorkers,
  relativeTime,
} from "../lib/iris-live-soc.ts";
import { commandsForAlert } from "../lib/iris-live-soc.ts";

const alert = {
  id: "alert-1",
  deviceId: "mac-1",
  code: "FIREWALL_DISABLED",
  severity: "MEDIUM",
  status: "NEW",
  evidence: JSON.stringify({ hostname: "Eze-Mac", applications: [] }),
  lastSeenAt: "2026-09-08T01:00:00.000Z",
};

test("live incidents come from agent alerts, not training IDs", () => {
  const incidents = liveIncidentsFromAlerts([alert], [{ id: "mac-1", name: "Mac de Eze" }], "es");
  assert.equal(incidents.length, 1);
  assert.equal(incidents[0].id, "alert-1");
  assert.doesNotMatch(incidents[0].id, /^IR-10/);
  assert.match(incidents[0].title, /FIREWALL/i);
  assert.match(incidents[0].summary, /telemetr[ií]a verificada/i);
  assert.equal(incidents[0].kind, "alert");
});

test("offline Mac and pending purchases become real approval items", () => {
  const incidents = buildLiveIncidents({
    alerts: [],
    devices: [{ id: "mac-2", name: "Studio", status: "OFFLINE", lastSeenAt: "2026-09-08T00:00:00.000Z" }],
    purchases: [{ id: "buy-1", asset: "ETH", amountUsd: 25, source: "robinhood", checkoutUrl: "https://robinhood.com/crypto/ETH", status: "awaiting_approval" }],
    language: "es",
  });
  assert.equal(incidents.some(item => item.id === "device:mac-2"), true);
  assert.equal(incidents.some(item => item.id === "purchase:buy-1"), true);
  assert.equal(incidents.find(item => item.id === "purchase:buy-1")?.checkoutUrl, "https://robinhood.com/crypto/ETH");
});

test("saved statuses overlay live incidents without inventing demo rows", () => {
  const incidents = applySavedStatuses(
    [{ ...emptyLiveIncident("en"), id: "device:mac-2", status: "Open", kind: "device" }],
    [{ incidentId: "device:mac-2", status: "Contained" }],
  );
  assert.equal(incidents[0].status, "Contained");
  assert.equal(emptyLiveIncident("es").kind, "empty");
});

test("connection line and workers reflect live Mac, wallet, and market", () => {
  assert.match(liveConnectionLine({ online: 1, devices: 1, openAlerts: 2, wallet: true, language: "es" }), /agente.*en vivo/i);
  assert.match(liveConnectionLine({ online: 0, devices: 0, openAlerts: 0, language: "en" }), /No agent connected/);
  const workers = liveWorkers({
    devices: [{ id: "mac-1", name: "Mac", status: "ONLINE" }],
    walletConnected: true,
    walletAddress: "0x49BeAEc30C7431235c3262a2B1C0C5d8b5a0d3E1",
    marketLive: true,
    auditCount: 12,
    pendingPurchases: 1,
    language: "es",
  });
  assert.equal(workers.find(item => item.id === "mac-agent")?.status, "RUNNING");
  assert.equal(workers.find(item => item.id === "wallet")?.status, "RUNNING");
  assert.equal(workers.find(item => item.id === "market")?.status, "RUNNING");
  assert.doesNotMatch(workers.map(item => item.id).join(" "), /architect|backend-auth|frontend-ux/);
});

test("intelligence and relative time stay on live alerts", () => {
  const intel = liveIntelligence([alert, { ...alert, id: "alert-2", status: "RESOLVED", severity: "HIGH" }], "es");
  assert.equal(intel.open, 1);
  assert.equal(intel.resolved, 1);
  assert.equal(intel.techniques[0].label, "FIREWALL DISABLED");
  assert.equal(relativeTime(new Date(Date.now() - 20_000).toISOString(), "es"), "ahora mismo");
});

test("approving a firewall finding queues a real Mac action", () => {
  const commands = commandsForAlert("FIREWALL_DISABLED", "es");
  assert.equal(commands.some(item => item.code === "ENABLE_FIREWALL"), true);
  assert.equal(commands.some(item => item.code === "NOTIFY"), true);
  assert.equal(commandsForAlert("FILEVAULT_DISABLED", "en").some(item => item.code === "ENABLE_FIREWALL"), false);
});
