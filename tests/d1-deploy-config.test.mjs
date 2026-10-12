import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const PLACEHOLDER = "00000000-0000-4000-8000-000000000000";
const REAL_ID = "65d60391-61a8-4977-9e1b-a574447fa195";

test("committed D1 config points at the real site-creator-d1 database", () => {
  const d1 = JSON.parse(readFileSync(new URL("../config/d1.json", import.meta.url), "utf8"));
  assert.equal(d1.binding, "DB");
  assert.equal(d1.database_name, "site-creator-d1");
  assert.equal(d1.database_id, REAL_ID);
  assert.equal(d1.migrations_dir, "drizzle");
  assert.notEqual(d1.database_id, PLACEHOLDER);
});

test("wrangler.jsonc and vite config use the committed D1 database id", () => {
  const d1 = JSON.parse(readFileSync(new URL("../config/d1.json", import.meta.url), "utf8"));
  const wrangler = readFileSync(new URL("../wrangler.jsonc", import.meta.url), "utf8");
  const vite = readFileSync(new URL("../vite.config.ts", import.meta.url), "utf8");
  const patch = readFileSync(new URL("../scripts/patch-generated-wrangler-d1.mjs", import.meta.url), "utf8");
  const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));

  assert.match(wrangler, new RegExp(d1.database_id));
  assert.match(wrangler, /"database_name": "site-creator-d1"/);
  assert.match(wrangler, /"migrations_dir": "drizzle"/);
  assert.doesNotMatch(wrangler, new RegExp(PLACEHOLDER));
  assert.match(vite, /wrangler\.jsonc/);
  assert.doesNotMatch(vite, /config:\s*localBindingConfig/);
  assert.doesNotMatch(vite, /database_id:\s*["']00000000-0000-4000-8000-000000000000["']/);
  assert.match(patch, new RegExp(PLACEHOLDER));
  assert.match(patch, /normalizeDatabases/);
  assert.equal(pkg.scripts["db:remote"], "node scripts/apply-remote-d1-migrations.mjs");
  assert.match(pkg.scripts["deploy:cf"], /patch-generated-wrangler-d1/);
});

test("build rewrites generated wrangler D1 bindings before artifact validation", () => {
  const build = readFileSync(new URL("../scripts/build-verified.sh", import.meta.url), "utf8");
  assert.match(build, /patch-generated-wrangler-d1\.mjs/);
});
