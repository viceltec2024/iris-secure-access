import assert from "node:assert/strict";
import test from "node:test";
import { formatUtcClock } from "../lib/iris-time.ts";

test("formatUtcClock renders UTC timestamps", () => {
  assert.equal(formatUtcClock("2026-11-26T13:00:00Z"), "2026-11-26 13:00 UTC");
  assert.equal(formatUtcClock(new Date("2026-01-02T03:04:05Z")), "2026-01-02 03:04 UTC");
});

test("formatUtcClock handles missing and invalid values", () => {
  assert.equal(formatUtcClock(null), "—");
  assert.equal(formatUtcClock(undefined), "—");
  assert.equal(formatUtcClock(""), "—");
  assert.equal(formatUtcClock("not-a-date"), "not-a-date");
});
