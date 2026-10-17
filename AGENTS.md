# IRIS Secure Access

IRIS is a live security console, not a demo. Codex and Cursor both work in this repo.

## Run

```bash
npm ci
cp -n .env.example .env.local
npm run dev:local
```

Open `http://127.0.0.1:5173/dashboard`. Local identity is `owner@iris.local` (ADMIN). Production ChatGPT Sites must keep `/dev/sign-in` as 404.

Codex sandbox (`CODEX_SANDBOX`): `npm run dev` or `npm run dev:local`. Vite listens on IPv4 and IPv6. Local owner auth is on automatically. Do not commit `.env.local`.

Provider keys in `.env.local` (never commit):
- `OPENAI_API_KEY` — ChatGPT / analysis agent (`/api/agent/run`)
- `MODEL_API_KEY` — Muse edit agent for “edita / reescribe / improve” (`muse-spark-1.3`)
- `ELEVENLABS_API_KEY` — neural TTS via `/api/iris-voice` (Sarah voice by default); without it, browser `speechSynthesis`

Coordination: edit → Muse, SOC/tools → OpenAI, speech → ElevenLabs, otherwise → local IRIS mind. Check `/api/iris-providers/status` or `POST /api/iris-coordinator` (`probe_providers`) for honest readiness. A configured key is not a proven live integration. Agent/mission isolation is `worker_request_isolate+policy_sandbox` (not container/VM).

## Test

```bash
node --experimental-strip-types --test tests/*.mjs
```

Skip `tests/rendered-html.test.mjs` unless you already ran `npm run build`. `npm run lint` must stay at 0 errors.

## Product rules

- User-facing copy is Spanish.
- Ask IRIS must keep the written conversation visible and answer every question.
- Never fake a Mac as ONLINE. `lastSeenAt` older than 5 minutes is OFFLINE.
- Live SOC uses the Mac agent, offline devices, and pending purchases. No `IR-1039` / `IR-1042` demo incidents.
- Official wallet URLs only. Do not invent OAuth tokens or Robinhood sessions.
- Ask IRIS speaks through ElevenLabs (`/api/iris-voice`) when `ELEVENLABS_API_KEY` is set; otherwise use the browser voice. Do not restore Vinext Geist fonts or OpenAI neural TTS.
- IRIS Creator designs supervised agents with Guardian sandbox + human approval. Proposals (code/tests) never auto-apply, push, or deploy.
- Missions (`/api/iris-mission`) may plan and sandbox only; completion needs human approval. `appliedToRepo` and `selfModifiedCore` stay false.
- Memory/lessons are append-only; promotion into active lessons requires a human. Memory never authorizes self-modification of IRIS core.
- Do not claim Meta AI, Muse, OpenAI, or ElevenLabs are live unless code + a proven call with a real key exist.
- Do not deploy or publish production changes without explicit owner authorization.
- Do not allow autonomous modifications of IRIS core or the main branch.

## Done

A change is done when the tests above pass, the dashboard still signs in locally, and Ask IRIS returns a written reply for a typed question.
