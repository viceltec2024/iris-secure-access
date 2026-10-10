# IRIS Creator Platform API (Fase 1)

FastAPI service for designing, sandboxed-testing, approving, and supervising generated agents.

## Run locally (SQLite, no Docker)

```bash
cd platform/iris-api
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8088
```

- Health: `GET http://127.0.0.1:8088/health`
- Bootstrap admin: `POST /auth/bootstrap`
- Login: `POST /auth/login` with `admin@iris.local` / `iris-admin-change-me` (change in env)

## Tests

```bash
cd platform/iris-api
source .venv/bin/activate
pytest -q
```

## What works in Fase 1

- Admin bootstrap + JWT login
- Design agent from Spanish/English prompt
- Edit allowlisted tools and regenerate sandbox
- Isolated subprocess tests (not full Docker jail)
- Approve / reject / pause / emergency-stop / delete
- Audit + task history

## Pending

- pgvector memory
- Celery orchestrator workers
- Dashboard authenticated bridge to this API (UI still uses the vinext `/api/iris-creator` path)
- Real model providers beyond `local-sim` allowlist stubs
