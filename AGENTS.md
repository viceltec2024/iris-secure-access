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
- Do not restore neural TTS (`/api/iris-voice`) or Vinext Geist fonts.

## Cloudflare D1 deploy

Production D1 is `site-creator-d1` (`65d60391-61a8-4977-9e1b-a574447fa195`), declared in `config/d1.json` and `wrangler.jsonc`. Do not deploy with the Sites placeholder id `00000000-0000-4000-8000-000000000000`.

If Cloudflare Workers Builds still runs `npx wrangler deploy`, prefer deploy command:

```bash
npm run deploy:cf
```

or:

```bash
node scripts/patch-generated-wrangler-d1.mjs && npx wrangler deploy -c dist/server/wrangler.json
```

Empty remote D1 needs one-time schema apply (Wrangler auth required):

```bash
npm run db:remote
```

## Done

A change is done when the tests above pass, the dashboard still signs in locally, and Ask IRIS returns a written reply for a typed question.
