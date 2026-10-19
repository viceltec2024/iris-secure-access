# Auditoría técnica IRIS AI — 2026-10-19

Fuente primaria: `iris-system-report-20261019T152850Z.zip` + re-pruebas live en `http://127.0.0.1:5173` + suite `tests/*.mjs` (sin `rendered-html`).

**Alcance:** entorno de desarrollo local. Sin publicación a producción, sin compras, sin cambios de recursos de producción.

---

## 1. Veredicto

IRIS ya funciona como consola SOC + coordinador multi-modelo **local-first** con Guardian, misiones supervisadas y memoria append-only. El scorecard interno marca **~60%** (3 proven / 6 partial / 1 blocked by design). Para nivel empresarial “completamente funcional” faltan: claves live probadas, telemetría Mac real, runtime durable de agentes y (opcional) contrato token on-chain.

---

## 2. Servidor y endpoints

| Área | Estado | Evidencia |
|------|--------|-----------|
| Vite + Miniflare | OK | Dashboard `200`, identity `owner@iris.local` |
| SOC `/api/security-state` | OK | Live devices/alerts/audit (0 Mac enrolados) |
| Providers `/api/iris-providers/status` | OK | Solo `local` configured |
| Coordinator GET + `probe_providers` | OK | Honestidad: key ≠ live proof |
| Coordinator `route` | OK | Enruta a `local` sin OpenAI |
| Creator / Mission / Evals / Orgs | OK | Create/start/export/run verificados |
| Ask IRIS | OK | Respuesta escrita `source=local` |
| Voice POST | Esperado `503` | Sin `ELEVENLABS_API_KEY` → browser TTS |
| Token ops / base-wallet sin params | Esperado `404`/`400` | Contrato no configurado / address requerida |

Matriz inicial: **20/25 HTTP 2xx**; los 5 no-2xx son validación o configuración ausente, no caídas del servidor.

---

## 3. Cloudflare D1 — 27 tablas y migraciones

Inventario live (reporte): **27 nombres** = 24 tablas de aplicación + `_cf_METADATA` + `_local_migrations` + `sqlite_sequence`.

| Migración | Rol |
|-----------|-----|
| `0000`–`0010` | Núcleo SOC, auth, passkeys, chain, rate limits |
| `0011_saas_organizations` | Orgs / members / usage |
| `0012_saas_phase_b` | Invites, API keys, billing events |

Las **13 migraciones** del journal están aplicadas (`_local_migrations` = 13). `CREATE TABLE` en SQL coincide 1:1 con las 24 tablas de app en Miniflare.

Filas relevantes al auditar: `users=1`, `organizations=1`, `organization_members=1`, `audit_events≥41`, `devices=0`, `security_alerts=0`.

---

## 4. Credenciales (sin divulgar valores)

| Variable | Dónde se configura | Lectura en runtime | Estado en este entorno |
|----------|--------------------|--------------------|------------------------|
| `OPENAI_API_KEY` | `.env.local` (dev) / bindings Cloudflare Sites (prod) | `ask-iris`, `agent/run`, `iris-transcribe`, registry/probe | **EMPTY** |
| `MODEL_API_KEY` (+ alias `MUSE_API_KEY`) | idem | `lib/iris-muse.ts`, Creator models, probe | **EMPTY** |
| `ELEVENLABS_API_KEY` (+ voice/model opcionales) | idem | `/api/iris-voice` | **EMPTY** |
| `IRIS_DEV_SKIP_STEPUP` / `IRIS_DEV_EMAIL` / `IRIS_OWNER_EMAIL` | `.env.example` → `.env.local` | `app/dev-auth.ts`, `lib/authz.ts` | **SET** (solo local) |

Plantilla documentada: `.env.example`, `AGENTS.md`, `docs/IRIS-1.0-OPS.md`. Las rutas de API **no** incrustan literales de secretos (suite de seguridad).

---

## 5. Integraciones: real vs simulación / local

| Integración | ¿Puede llamar red real? | Estado ahora | Fallback |
|-------------|-------------------------|--------------|----------|
| IRIS local mind | N/A (local) | **Live** | — |
| OpenAI (análisis) | Sí, con clave | No configurada | Analista local |
| Meta Muse (`api.meta.ai`) | Sí, con clave | No configurada | Borrador Muse local |
| ElevenLabs TTS | Sí, con clave | No configurada | `speechSynthesis` |
| Cloudflare Workers AI | Binding `AI` | Ausente | — |
| Base RPC / Blockscout | Sí (lectura) | Requiere contrato/wallet | Errores honestos 400/404 |
| Compras / Stripe | Código Phase B test | No ejercido (prohibido aquí) | `chargeEnabled=false` en test |
| Mac agent | HMAC check-in real | 0 dispositivos | OFFLINE si `lastSeenAt` > 5 min |

Regla de honestidad del coordinador: **clave configurada ≠ integración live probada**; hace falta `probe_providers` con HTTP OK.

---

## 6. Pruebas ejecutadas

| Suite | Resultado |
|-------|-----------|
| Unitarios (sin `rendered-html`) | **154 pass / 0 fail** |
| Focused coord/creator/memory/mission/security/router/evals | **36 pass** |
| `npm run lint` | **0 errors** (1 warning preexistente `no-img-element`) |
| Live Ask IRIS | Respuesta ES, `source=local` |
| Live Creator `create` | Agente `awaiting_approval`, Guardian ON |
| Live Mission `start` | `verified` por evidencia; `appliedToRepo=false`; `selfModifiedCore=false` |
| Live Voice POST | `503` esperado sin clave |
| Live `probe_providers` | `skipped_no_key` para externos; `local_ready` |

---

## 7. Listo / incompleto / errores

### Listo (funcional y probado)
- Guardian + puertas humanas
- Ask IRIS + SOC local + offline 5 min
- Evals + scorecard
- Multi-tenant org desks + rate limits + audit log
- Coordinador con sonda honesta

### Incompleto (parcial)
- Creator: diseño/sandbox/aprobación OK; sin worker durable ni apply a repo
- Misiones: cola + sandbox de política (no contenedor/VM)
- Memoria: append-only; sin retrieval vectorial ni auto-promoción
- Mac telemetry: pipeline listo; falta agente enrolado
- Multi-modelo / voz neural: código listo; faltan claves + probe live
- Token Base: sin contrato en `app_settings`

### Errores corregidos en esta auditoría (solo dev)
1. **Specialty con `:`** — prompts `especializada en: …` generaban `IRIS · : Nombre`. Fix en `extractSpecialty` + prompt de misión.
2. **Ask IRIS validación en inglés** con UI ES — mensajes de error ahora respetan idioma.

### No es bug
- `503` voz sin ElevenLabs
- `404` token ops sin contrato
- `400` base-wallet sin `address`
- Automejora del núcleo: **bloqueada a propósito**

---

## 8. Plan de implementación por prioridades

### P0 — Activar valor empresarial (sin debilitar seguridad)
1. Cargar en `.env.local` (dev) y secrets Sites (staging): `OPENAI_API_KEY`, `MODEL_API_KEY`, `ELEVENLABS_API_KEY`.
2. Ejecutar `POST /api/iris-coordinator` `{ "action": "probe_providers" }` y guardar evidencia `live_ok`.
3. Enrolar un Mac de laboratorio; verificar `ONLINE` solo con `lastSeenAt` < 5 min.
4. Smoke: Ask IRIS (OpenAI), edición Muse, TTS ElevenLabs, sin tocar producción.

### P1 — Plataforma de agentes
1. Runtime durable de agentes aprobados (cola D1 + worker periódico) **sin** auto-apply.
2. Extender Guardian a cada tool call fuera de Creator.
3. UI de memoria: promover/rechazar lecciones (ya API).
4. ACK de comandos del agente Mac + remediaciones verificadas por nuevo reporte.

### P2 — Enterprise SaaS
1. Completar Phase B billing en **test mode** (`IRIS_BILLING_TEST=1`, nunca live sin autorización).
2. Export compliance / retención (`docs/IRIS-DATA-GOVERNANCE.md`).
3. Observabilidad: board continuo de `/api/iris-evals`.
4. Contrato IRIS token + multisig solo con autorización expresa.

### P3 — No hacer
- Auto-modificar el core de IRIS
- Deploy/producción sin autorización del owner
- Inventar telemetría ONLINE o incidentes demo (`IR-1039` / `IR-1042`)

---

## 9. Cambios de código en este PR

- `lib/iris-creator.ts` — specialty sin prefijo `:`
- `lib/iris-mission.ts` — prompt sin `en:`
- `app/api/ask-iris/route.ts` — errores ES/EN
- `tests/iris-creator.test.mjs` — regresión del colon

Artefactos de evidencia (no commitados):  
`/opt/cursor/artifacts/iris-enterprise-audit-20261019.zip`
