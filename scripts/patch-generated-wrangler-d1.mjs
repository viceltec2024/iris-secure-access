// Ensure the Vite/Cloudflare-generated deploy config binds the real D1 database.
// OpenAI Sites used a placeholder UUID that Miniflare accepts locally; Cloudflare
// Workers Builds deploys dist/server/wrangler.json as-is, so the placeholder must
// be rewritten before `wrangler deploy`.

import { readFile, writeFile, access } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

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

let patched = 0;
for (const wranglerPath of candidates) {
  if (!(await exists(wranglerPath))) continue;

  const raw = await readFile(wranglerPath, "utf8");
  const config = JSON.parse(raw);
  const databases = Array.isArray(config.d1_databases) ? config.d1_databases : [];
  let changed = false;

  for (const database of databases) {
    if (!database || typeof database !== "object") continue;
    const id = database.database_id;
    if (id === PLACEHOLDER_DATABASE_ID || id !== d1Config.database_id) {
      database.binding = d1Config.binding;
      database.database_name = d1Config.database_name;
      database.database_id = d1Config.database_id;
      database.migrations_dir = d1Config.migrations_dir;
      changed = true;
    } else if (!database.migrations_dir) {
      database.migrations_dir = d1Config.migrations_dir;
      changed = true;
    }
  }

  if (changed) {
    await writeFile(wranglerPath, `${JSON.stringify(config, null, 2)}\n`, "utf8");
    console.log(
      `[d1] patched ${path.relative(projectRoot, wranglerPath)} → ${d1Config.database_id}`,
    );
    patched += 1;
  } else {
    console.log(
      `[d1] ${path.relative(projectRoot, wranglerPath)} already binds ${d1Config.database_id}`,
    );
  }
}

if (patched === 0 && !(await exists(candidates[0])) && !(await exists(candidates[1]))) {
  console.error(
    "[d1] no generated wrangler.json found under dist/. Run the build first.",
  );
  process.exitCode = 1;
}
