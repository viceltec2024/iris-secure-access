// Apply committed Drizzle migrations to the local Miniflare D1 database.
//
// The Sites platform applies generated migrations to the real D1 database at
// deploy time. For local development the Cloudflare Vite plugin creates an
// empty Miniflare-backed SQLite file lazily on first query, so DB-backed routes
// 500 with "no such table" until the schema is applied. This script waits for
// the dev server, forces the local D1 file to be created, and then replays the
// committed migrations from `drizzle/` idempotently.
//
// It is safe to run repeatedly: already-applied migrations are tracked in a
// `_local_migrations` bookkeeping table and skipped.

import { DatabaseSync } from "node:sqlite";
import { readFile, readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const drizzleDir = path.join(projectRoot, "drizzle");
const d1Dir = path.join(projectRoot, ".wrangler", "state", "v3", "d1", "miniflare-D1DatabaseObject");
const baseUrl = process.env.SITES_DEV_URL ?? "http://localhost:5173";
const readinessTimeoutMs = Number(process.env.SITES_DEV_READY_TIMEOUT_MS ?? 120000);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitForServer() {
  const deadline = Date.now() + readinessTimeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${baseUrl}/`, { headers: { accept: "text/html" } });
      if (response.ok) return true;
    } catch {
      // dev server not listening yet
    }
    await sleep(1000);
  }
  return false;
}

async function forceD1Creation() {
  // Any request that touches the D1 binding makes Miniflare materialize the
  // local SQLite file. The identity header routes through the DB-backed path.
  try {
    await fetch(`${baseUrl}/api/security-state`, {
      headers: { "oai-authenticated-user-email": "local-setup@iris.local" },
    });
  } catch {
    // ignored: we only need the side effect of creating the D1 file
  }
}

async function findD1File() {
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    if (existsSync(d1Dir)) {
      const entries = await readdir(d1Dir);
      const dbFile = entries.find(
        (name) => name.endsWith(".sqlite") && name !== "metadata.sqlite",
      );
      if (dbFile) return path.join(d1Dir, dbFile);
    }
    await forceD1Creation();
    await sleep(1000);
  }
  return null;
}

function splitStatements(sql) {
  return sql
    .split("--> statement-breakpoint")
    .map((statement) => statement.trim())
    .filter((statement) => statement.length > 0);
}

async function main() {
  console.log("[local-d1] waiting for the dev server to become ready...");
  const ready = await waitForServer();
  if (!ready) {
    console.error(`[local-d1] dev server was not reachable at ${baseUrl} within ${readinessTimeoutMs}ms.`);
    process.exitCode = 1;
    return;
  }

  await forceD1Creation();
  const dbPath = await findD1File();
  if (!dbPath) {
    console.error(`[local-d1] could not locate the local D1 SQLite file under ${d1Dir}.`);
    process.exitCode = 1;
    return;
  }
  console.log(`[local-d1] using local D1 database at ${path.relative(projectRoot, dbPath)}`);

  const journalRaw = await readFile(path.join(drizzleDir, "meta", "_journal.json"), "utf8");
  const journal = JSON.parse(journalRaw);
  const tags = (journal.entries ?? [])
    .sort((a, b) => a.idx - b.idx)
    .map((entry) => entry.tag);

  const db = new DatabaseSync(dbPath);
  db.exec("PRAGMA busy_timeout = 15000;");
  db.exec(
    "CREATE TABLE IF NOT EXISTS _local_migrations (tag TEXT PRIMARY KEY, applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);",
  );

  const appliedRows = db.prepare("SELECT tag FROM _local_migrations;").all();
  const applied = new Set(appliedRows.map((row) => row.tag));

  let newlyApplied = 0;
  for (const tag of tags) {
    if (applied.has(tag)) continue;
    const migrationSql = await readFile(path.join(drizzleDir, `${tag}.sql`), "utf8");
    const statements = splitStatements(migrationSql);
    db.exec("BEGIN;");
    try {
      for (const statement of statements) db.exec(statement);
      db.prepare("INSERT INTO _local_migrations (tag) VALUES (?);").run(tag);
      db.exec("COMMIT;");
    } catch (error) {
      db.exec("ROLLBACK;");
      db.close();
      console.error(`[local-d1] failed applying migration ${tag}:`, error);
      process.exitCode = 1;
      return;
    }
    newlyApplied += 1;
    console.log(`[local-d1] applied migration ${tag}`);
  }

  db.close();
  if (newlyApplied === 0) {
    console.log(`[local-d1] schema already up to date (${tags.length} migrations).`);
  } else {
    console.log(`[local-d1] applied ${newlyApplied} migration(s); schema is up to date.`);
  }
}

main().catch((error) => {
  console.error("[local-d1] unexpected error:", error);
  process.exitCode = 1;
});
