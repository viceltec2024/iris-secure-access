import assert from "node:assert/strict";
import test from "node:test";
import { applyCommandResults, commandStatusLabel } from "../lib/iris-agent-command-state.ts";

test("command ACK lifecycle advances delivered commands without touching pending", () => {
  const commands = [
    {
      id: "c1",
      code: "NOTIFY",
      title: "IRIS",
      message: "hola",
      status: "DELIVERED",
      createdAt: "2026-10-25T00:00:00.000Z",
      approvedBy: "owner@iris.local",
      deliveredAt: "2026-10-25T00:01:00.000Z",
    },
    {
      id: "c2",
      code: "ENABLE_FIREWALL",
      title: "IRIS",
      message: "firewall",
      status: "PENDING",
      createdAt: "2026-10-25T00:00:00.000Z",
      approvedBy: "owner@iris.local",
    },
    {
      id: "c3",
      code: "REVERIFY",
      title: "IRIS",
      message: "recheck",
      status: "EXECUTED",
      createdAt: "2026-10-25T00:00:00.000Z",
      approvedBy: "owner@iris.local",
    },
  ];

  const applied = applyCommandResults(commands, [
    { id: "c1", status: "ACKED", detail: "notification_shown" },
    { id: "c2", status: "EXECUTED", detail: "should_ignore_pending" },
    { id: "c3", status: "FAILED", detail: "already_done" },
  ], "2026-10-25T00:02:00.000Z");

  assert.equal(applied.updated.length, 1);
  assert.equal(applied.commands[0].status, "ACKED");
  assert.equal(applied.commands[0].resultDetail, "notification_shown");
  assert.equal(applied.commands[1].status, "PENDING");
  assert.equal(applied.commands[2].status, "EXECUTED");
  assert.equal(commandStatusLabel("EXECUTED", "es"), "Ejecutado");
});
