import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";

const REAL_ID = "65d60391-61a8-4977-9e1b-a574447fa195";
const PLACEHOLDER = "00000000-0000-4000-8000-000000000000";
const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("patch script rewrites placeholder D1 ids in generated wrangler.json", () => {
  const staging = mkdtempSync(path.join(tmpdir(), "iris-d1-patch-"));
  const distServer = path.join(staging, "dist", "server");
  mkdirSync(distServer, { recursive: true });
  mkdirSync(path.join(staging, "config"), { recursive: true });
  mkdirSync(path.join(staging, "scripts"), { recursive: true });

  writeFileSync(
    path.join(staging, "config", "d1.json"),
    readFileSync(path.join(projectRoot, "config", "d1.json"), "utf8"),
  );
  writeFileSync(
    path.join(staging, "scripts", "patch-generated-wrangler-d1.mjs"),
    readFileSync(path.join(projectRoot, "scripts", "patch-generated-wrangler-d1.mjs"), "utf8"),
  );
  writeFileSync(
    path.join(distServer, "wrangler.json"),
    JSON.stringify(
      {
        name: "iris-secure-access",
        d1_databases: [
          {
            binding: "DB",
            database_name: "site-creator-d1",
            database_id: PLACEHOLDER,
          },
          {
            binding: "DB",
            database_name: "site-creator-d1",
            database_id: PLACEHOLDER,
          },
        ],
      },
      null,
      2,
    ),
  );

  try {
    const result = spawnSync(
      process.execPath,
      ["scripts/patch-generated-wrangler-d1.mjs"],
      { cwd: staging, encoding: "utf8" },
    );
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const patched = JSON.parse(readFileSync(path.join(distServer, "wrangler.json"), "utf8"));
    assert.equal(patched.d1_databases.length, 1);
    assert.equal(patched.d1_databases[0].database_id, REAL_ID);
    assert.equal(patched.d1_databases[0].migrations_dir, "drizzle");
    assert.match(result.stdout, new RegExp(REAL_ID));
  } finally {
    rmSync(staging, { recursive: true, force: true });
  }
});
