#!/usr/bin/env bash
# Local development entry point that runs the Vite/Vinext dev server and applies
# the committed Drizzle migrations to the local Miniflare D1 database once the
# server is reachable. The migration step runs in the background and is
# idempotent, so DB-backed routes work on a fresh checkout without a manual
# migration step. Production D1 migrations are still applied by the Sites
# platform at deploy time; this only prepares the local development database.
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
project_root="$(cd "${script_dir}/.." && pwd)"
cd "${project_root}"

# Seed the local D1 database in the background. It waits for the dev server to
# become ready before applying migrations, and never blocks server startup.
node --experimental-sqlite "${script_dir}/apply-local-d1-migrations.mjs" &

exec npm run dev
