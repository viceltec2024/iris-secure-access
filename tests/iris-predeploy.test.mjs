import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { identityHeadersTrusted, trustedIdentityHosts, withoutUntrustedIdentity } from "../lib/iris-origin.ts";

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const forged = url => new Request(url, { headers: { "oai-authenticated-user-email": "owner@iris.local", "oai-authenticated-user-full-name": "Owner" } });

test("identity headers are kept on the production Sites host", () => {
  const request = withoutUntrustedIdentity(forged("https://iris-secure-access.taylor-667.chatgpt.site/api/security-state"), trustedIdentityHosts(), false);
  assert.equal(request.headers.get("oai-authenticated-user-email"), "owner@iris.local");
});

test("forged identity headers are stripped on a direct workers.dev URL", () => {
  const request = withoutUntrustedIdentity(forged("https://iris.example.workers.dev/api/security-state"), trustedIdentityHosts(), false);
  assert.equal(request.headers.get("oai-authenticated-user-email"), null);
  assert.equal(request.headers.get("oai-authenticated-user-full-name"), null);
});

test("loopback keeps identity headers only outside production", () => {
  assert.equal(identityHeadersTrusted("127.0.0.1", trustedIdentityHosts(), true), true);
  assert.equal(identityHeadersTrusted("127.0.0.1", trustedIdentityHosts(), false), false);
});

test("IRIS_TRUSTED_HOSTS replaces the default trusted host", () => {
  const hosts = trustedIdentityHosts(" iris.example.com , OTHER.example.com");
  assert.deepEqual(hosts, ["iris.example.com", "other.example.com"]);
  assert.equal(identityHeadersTrusted("iris-secure-access.taylor-667.chatgpt.site", hosts, false), false);
});

test("requests without identity headers pass through untouched", () => {
  const original = new Request("https://iris.example.workers.dev/api/agent/check-in", { method: "POST", body: "{}" });
  assert.equal(withoutUntrustedIdentity(original, trustedIdentityHosts(), false), original);
});

test("worker strips untrusted identity headers before routing", () => {
  const worker = read("worker/index.ts");
  assert.match(worker, /withoutUntrustedIdentity\(\s*incoming,/);
  assert.match(worker, /IRIS_TRUSTED_HOSTS/);
});

test("IRIS Chain seals blocks with an atomic D1 batch, not db.transaction", () => {
  const route = read("app/api/iris-chain/route.ts");
  assert.doesNotMatch(route, /db\.transaction\(/);
  assert.match(route, /await db\.batch\(\[first, \.\.\.rest, sealBlock\]\)/);
  // El bloque se inserta al final y solo si se confirmaron todas las pendientes.
  assert.match(route, /WHERE block_height = \$\{height\}\) = \$\{pending\.length\}/);
  assert.match(route, /ELSE NULL/);
  assert.match(route, /isNull\(irisChainTransactions\.blockHeight\)\)\)/);
  assert.match(route, /status: 409/);
  // Drizzle's D1 batch cannot bind parameters of raw db.run(sql) statements.
  assert.doesNotMatch(route, /db\.run\(/);
  assert.match(route, /const sealBlock = db\.insert\(irisChainBlocks\)/);
  assert.match(route, /NOT NULL\|UNIQUE\|PRIMARY KEY\|constraint/);
  assert.match(route, /throw error;/);
});

test("generated build artifacts are ignored", () => {
  const ignore = read(".gitignore");
  assert.match(ignore, /\*\.tsbuildinfo/);
  assert.match(ignore, /\/\.vinext\//);
});
