# IRIS AI 1.0 — Operaciones (staging / rollback / costos)

Documento operativo. **No autoriza** deploy a producción ni compra de servicios de pago.

## Entornos

| Entorno | Propósito | Cómo |
|---------|-----------|------|
| Local | Desarrollo | `npm ci` → `cp -n .env.example .env.local` → `npm run dev:local` |
| CI (GitHub Actions) | Gate de PR | `.github/workflows/ci.yml` (lint, tests, build, secret scan) |
| Staging | Validación pre-prod | Cloudflare / ChatGPT Sites preview **solo con tu autorización** |
| Production | Cliente real | **Prohibido sin autorización expresa** |

## Variables (nunca en git)

- `OPENAI_API_KEY` — ChatGPT / agent tools
- `MODEL_API_KEY` — Meta Muse (`https://api.meta.ai/v1`)
- `ELEVENLABS_API_KEY` (+ opcionales voice/model)
- `IRIS_DEV_*` — solo local / Codex preview

Una clave configurada **no** equivale a integración live. Usar `POST /api/iris-coordinator` con `probe_providers`.

## Aislamiento (honestidad)

IRIS ejecuta agentes/misiones en:

`worker_request_isolate + policy_sandbox`

- Sí: allowlist de tools, timeouts, cancel, ACL, sin shell/fs/git push
- No: Docker, microVM ni proceso OS dedicados

## CI/CD actual

1. PR → GitHub Actions
2. Lint + unit/security + build + rendered-html
3. Secret hygiene scan

No hay auto-deploy. Rollback = revertir el PR / redeploy del artifact anterior en Cloudflare (requiere tu OK).

## Backups D1

- Local: `.wrangler/state/v3/d1/.../*.sqlite` (no commitear)
- Producción: backups D1 de Cloudflare — activar solo tras autorización (puede tener costo de plataforma)

## Costos mensuales estimados (orientativos, sin compromiso)

| Ítem | Si se usa | Estimación baja | Notas |
|------|-----------|-----------------|-------|
| Cloudflare Workers / D1 / Sites | Hosting IRIS | $0–$25 | Depende de plan Sites/CF existente |
| OpenAI API | Ask IRIS cloud + agent | $20–$200 | Uso variable |
| Meta Muse (`MODEL_API_KEY`) | Edición | $10–$100 | Pay-as-you-go Meta |
| ElevenLabs | Voz neural | $0–$22 | Free tier limitado; planes pagos aparte |
| GitHub Actions | CI | $0 | Minutos incluidos en plan |

**No se añadirá ningún servicio de pago nuevo sin tu autorización explícita.**

## Criterios de producción (bloqueantes)

1. Compilación reproducible (`npm run build`) OK
2. Tests obligatorios en CI OK
3. Sin vulnerabilidades críticas/altas sin mitigar
4. Integraciones live **probadas** con claves reales (probe `live_ok`) o explícitamente deshabilitadas con fallback
5. Monitoreo/alertas configurados
6. Backup/restore D1 probado
7. Rollback ensayado
8. Documentación operativa actualizada

Hasta que todos pasen: **IRIS no está production-ready.**
