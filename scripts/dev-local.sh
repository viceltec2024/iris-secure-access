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

if [[ -f .env.local ]]; then
  set -a
  # shellcheck disable=SC1091
  source .env.local
  set +a
fi

# Codex previews have no gitignored .env.local. Keep local owner auth on
# so Ask IRIS and the dashboard work without ChatGPT Sites OAuth.
if [[ -n "${CODEX_SANDBOX:-}" ]]; then
  export IRIS_DEV_SKIP_STEPUP="${IRIS_DEV_SKIP_STEPUP:-1}"
  export IRIS_DEV_EMAIL="${IRIS_DEV_EMAIL:-owner@iris.local}"
  export IRIS_OWNER_EMAIL="${IRIS_OWNER_EMAIL:-owner@iris.local}"
fi

# Seed the local D1 database in the background. It waits for the dev server to
# become ready before applying migrations, and never blocks server startup.
node --experimental-sqlite "${script_dir}/apply-local-d1-migrations.mjs" &

exec npm run dev
