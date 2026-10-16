// Fail the build/deploy if the generated Worker config still points at the
// Sites placeholder D1 UUID or is missing the production binding.

import { readFile, access } from "node:fs/promises";
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

let checked = 0;
for (const wranglerPath of candidates) {
  if (!(await exists(wranglerPath))) continue;
  checked += 1;

  const config = JSON.parse(await readFile(wranglerPath, "utf8"));
  const databases = Array.isArray(config.d1_databases) ? config.d1_databases : [];
  const relative = path.relative(projectRoot, wranglerPath);

  if (databases.length !== 1) {
    console.error(
      `[d1] ${relative} must declare exactly one D1 binding (found ${databases.length}).`,
    );
    process.exitCode = 1;
    continue;
  }

  const database = databases[0] ?? {};
  const problems = [];
  if (database.binding !== d1Config.binding) {
    problems.push(`binding=${database.binding ?? "<missing>"} (expected ${d1Config.binding})`);
  }
  if (database.database_name !== d1Config.database_name) {
    problems.push(
      `database_name=${database.database_name ?? "<missing>"} (expected ${d1Config.database_name})`,
    );
  }
  if (database.database_id !== d1Config.database_id) {
    problems.push(
      `database_id=${database.database_id ?? "<missing>"} (expected ${d1Config.database_id})`,
    );
  }
  if (database.database_id === PLACEHOLDER_DATABASE_ID) {
    problems.push("Sites placeholder UUID is still present");
  }
  if (database.migrations_dir !== d1Config.migrations_dir) {
    problems.push(
      `migrations_dir=${database.migrations_dir ?? "<missing>"} (expected ${d1Config.migrations_dir})`,
    );
  }

  if (problems.length > 0) {
    console.error(`[d1] ${relative} is not ready to deploy:\n  - ${problems.join("\n  - ")}`);
    process.exitCode = 1;
  } else {
    console.log(`[d1] ${relative} OK → ${d1Config.database_name} (${d1Config.database_id})`);
  }
}

if (checked === 0) {
  console.error(
    "[d1] no generated wrangler.json found under dist/. Run the build first.",
  );
  process.exitCode = 1;
}
