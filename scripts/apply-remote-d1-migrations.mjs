// Apply committed Drizzle SQL migrations to the remote Cloudflare D1 database.
// Requires Wrangler auth (CLOUDFLARE_API_TOKEN or `wrangler login`).

import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const d1Config = JSON.parse(
  await readFile(path.join(projectRoot, "config", "d1.json"), "utf8"),
);

const wrangler = path.join(projectRoot, "node_modules", ".bin", "wrangler");
const result = spawnSync(
  wrangler,
  [
    "d1",
    "migrations",
    "apply",
    d1Config.database_name,
    "--remote",
    "--config",
    "wrangler.jsonc",
  ],
  {
    cwd: projectRoot,
    stdio: "inherit",
    env: process.env,
  },
);

process.exit(result.status ?? 1);
