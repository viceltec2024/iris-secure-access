import assert from "node:assert/strict";
import test from "node:test";
import { severityLabel, text } from "../app/dashboard/dashboard-i18n.ts";

test("severity Low has Spanish copy (empty incident default)", () => {
  assert.equal(severityLabel("Low", "es"), "Bajo");
  assert.equal(severityLabel("Low", "en"), "Low");
  assert.equal(text("filterLow", "es"), "Bajo");
});

test("missing copy keys do not throw (dashboard stays up)", () => {
  assert.doesNotThrow(() => text("alerts", "es"));
  assert.equal(text("alerts", "es"), "alerts");
});
