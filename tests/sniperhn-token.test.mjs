import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { spawnSync } from "node:child_process";

const root = process.cwd();

test("compiles SNIPERHN for Remix and writes artifacts", () => {
  const result = spawnSync("node", ["scripts/compile-sniperhn.mjs"], { cwd: root, encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr || result.stdout);

  const artifact = fs.readFileSync(path.join(root, "app/sniperhn/sniperhn-artifact.ts"), "utf8");
  assert.match(artifact, /export const SNIPERHN_ABI/);
  assert.match(artifact, /"name":"MAX_SUPPLY"/);
  assert.match(artifact, /"name":"transfer"/);
  assert.match(artifact, /export const SNIPERHN_BYTECODE = "0x[0-9a-f]+"/);

  const remix = fs.readFileSync(path.join(root, "app/sniperhn/sniperhn-remix.ts"), "utf8");
  assert.match(remix, /export const SNIPERHN_NAME = "SNIPERHN"/);
  assert.match(remix, /export const SNIPERHN_SYMBOL = "SNIPERHN"/);
  assert.match(remix, /https:\/\/app\.remix\.live\/\?#/);
  assert.match(remix, /@openzeppelin\/contracts@5\.6\.1\/token\/ERC20\/ERC20\.sol/);

  const flattened = fs.readFileSync(path.join(root, "contracts/remix/SNIPERHN.flattened.sol"), "utf8");
  assert.match(flattened, /contract SNIPERHN is ERC20/);
  assert.doesNotMatch(flattened, /^\s*import /m);
  assert.match(flattened, /constructor\(\) ERC20\("SNIPERHN", "SNIPERHN"\)/);
});
