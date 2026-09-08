import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("IRIS brand mark is a centered emblem without a duotone ghost path", () => {
  const source = readFileSync(new URL("../app/iris-brand-mark.tsx", import.meta.url), "utf8");
  assert.match(source, /viewBox="0 0 32 32"/);
  assert.doesNotMatch(source, /opacity/);
  assert.doesNotMatch(source, /ShieldCheck/);
});

test("sidebar and home lockups use the IRIS brand mark", () => {
  const sidebar = readFileSync(new URL("../app/dashboard/security-operations.tsx", import.meta.url), "utf8");
  const home = readFileSync(new URL("../app/page.tsx", import.meta.url), "utf8");
  assert.match(sidebar, /<div className="soc-brand"><IrisBrandMark/);
  assert.doesNotMatch(sidebar, /soc-brand"><ShieldCheck/);
  assert.match(home, /<IrisBrandMark size=\{88\} \/>/);
});
