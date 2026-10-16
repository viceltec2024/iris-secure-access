// Ensure the Vite/Cloudflare-generated deploy config binds the real D1 database.
// OpenAI Sites used a placeholder UUID that Miniflare accepts locally; Cloudflare
// Workers Builds deploys dist/server/wrangler.json as-is, so the placeholder must
// be rewritten before `wrangler deploy`.

import { readFile, writeFile, access } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PLACEHOLDER_DATABASE_ID = "00000000-0000-4000-8000-000000000000";
const d1Config = JSON.parse(
  await readFile(path.join(projectRoot, "config", "d1.json"), "utf8"),
);

const candidates = [
  path.join(projectRoot, "dist", "server", "wrangler.json"),
  path.join(projectRoot, "dist", "wrangler.json"),
];

async function exists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

function normalizeDatabases(databases) {
  const byBinding = new Map();
  for (const database of databases) {
    if (!database || typeof database !== "object") continue;
    const binding = database.binding || d1Config.binding;
    byBinding.set(binding, {
      binding,
      database_name: d1Config.database_name,
      database_id: d1Config.database_id,
      migrations_dir: d1Config.migrations_dir,
    });
  }
  if (byBinding.size === 0) {
    byBinding.set(d1Config.binding, {
      binding: d1Config.binding,
      database_name: d1Config.database_name,
      database_id: d1Config.database_id,
      migrations_dir: d1Config.migrations_dir,
    });
  }
  return [...byBinding.values()];
}

let touched = 0;
for (const wranglerPath of candidates) {
  if (!(await exists(wranglerPath))) continue;
  touched += 1;

  const raw = await readFile(wranglerPath, "utf8");
  const config = JSON.parse(raw);
  const before = JSON.stringify(config.d1_databases ?? null);
  const databases = Array.isArray(config.d1_databases) ? config.d1_databases : [];
  const hadPlaceholder = databases.some(
    (database) => database?.database_id === PLACEHOLDER_DATABASE_ID,
  );
  config.d1_databases = normalizeDatabases(databases);
  const after = JSON.stringify(config.d1_databases);

  if (before !== after || hadPlaceholder) {
    await writeFile(wranglerPath, `${JSON.stringify(config, null, 2)}\n`, "utf8");
    console.log(
      `[d1] patched ${path.relative(projectRoot, wranglerPath)} → ${d1Config.database_id}` +
        (config.d1_databases.length === 1 ? "" : ` (${config.d1_databases.length} bindings)`),
    );
  } else {
    // Still rewrite for stable formatting so assert + deploy see a consistent file.
    await writeFile(wranglerPath, `${JSON.stringify(config, null, 2)}\n`, "utf8");
    console.log(
      `[d1] ${path.relative(projectRoot, wranglerPath)} already binds ${d1Config.database_id}`,
    );
  }
}

if (touched === 0) {
  console.error(
    "[d1] no generated wrangler.json found under dist/. Run the build first.",
  );
  process.exitCode = 1;
} else {
  const assertResult = spawnSync(
    process.execPath,
    [path.join(projectRoot, "scripts", "assert-generated-d1.mjs")],
    { cwd: projectRoot, stdio: "inherit", env: process.env },
  );
  if ((assertResult.status ?? 1) !== 0) {
    process.exitCode = assertResult.status ?? 1;
  }
}
