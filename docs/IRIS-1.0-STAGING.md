# IRIS AI 1.0 — Preparación staging (sin desplegar)

Este documento prepara staging. **No autoriza** deploy, merge a `main`, ni gastos.

## Separación de entornos

| Entorno | Branch / artifact | Secretos | Datos |
|---------|-------------------|----------|-------|
| Development | local + PR branches | `.env.local` / `.dev.vars` (gitignored) | D1 Miniflare local |
| Staging | preview Sites / CF worker (pendiente OK) | Secrets de plataforma staging | D1 staging dedicada |
| Production | `main` deploy (pendiente OK expresa) | Secrets de producción | D1 prod + backups |

Regla: nunca reutilizar secretos de prod en local. Nunca commitear `.env*`.

## Protección de claves API

1. Solo env / Cloudflare secrets / GitHub Actions secrets
2. Probes: `POST /api/iris-coordinator` `{ "action": "probe_providers" }` → `live_ok` | `skipped_no_key` | `live_failed`
3. Status APIs nunca devuelven valores de claves
4. CI secret hygiene scan en cada PR

## Base de datos y migraciones

- Schema: `drizzle/*.sql` + `db/schema.ts`
- Local: `scripts/apply-local-d1-migrations.mjs` (idempotente)
- Staging/prod: migraciones vía plataforma Sites/CF en deploy autorizado
- Persistencia CAS: `lib/iris-settings-cas.ts` evita lost updates en `app_settings`

## Backups y restauración (procedimiento, no ejecutado en prod)

1. Export D1 staging/prod con herramienta CF (`wrangler d1 export` cuando se autorice)
2. Guardar artifact versionado fuera del repo
3. Restore drill en staging: import → `npm run db:local` pattern / CF import → smoke `/dashboard` + Ask IRIS
4. Criterio: restore drill documentado con timestamp antes de declarar prod-ready

**Estado actual:** procedimiento documentado; restore drill en CF **no ejecutado** (sin staging desplegado).

## Monitoreo y alertas

Mínimo recomendado (sin servicios de pago nuevos hasta OK):

- Cloudflare Workers analytics (incluido en plan existente)
- Audit trail IRIS (`audit_events`)
- CI rojo en GitHub Actions como alerta de regresión

Opcional de pago (requiere autorización): Sentry, Better Stack, etc.

## Control de costos

Ver `docs/IRIS-1.0-OPS.md`. Límites sugeridos pre-prod:

- OpenAI / Muse: presupuesto mensual explícito del owner
- ElevenLabs: free tier o plan autorizado
- CF: plan actual sin add-ons hasta OK

## Recuperación ante fallos

| Fallo | Recuperación |
|-------|--------------|
| Job timeout | `reclaimExpiredLeases` → requeue hasta `maxAttempts` → `dead_letter` |
| CAS conflict | retry ≤5 en APIs Creator/Mission/Memory |
| Provider down | fallback local / browser TTS / muse-local |
| Worker crash | CF isolate restart; jobs leased reclaimed by timeout |

## Rollback

1. No auto-deploy: solo promote manual tras OK
2. Rollback = redeploy artifact anterior de Sites/CF o revert del PR en staging
3. DB: restaurar export D1 previo si la migración no es backward-compatible
4. Documentar artifact ID + migration revision en cada promote

## Multi-tenant (SaaS)

- Migración `0011_saas_organizations` obligatoria antes de staging
- Cookie `iris_org_id` + membership server-side en cada API de producto
- Claves de desks: `iris_*:org:{organizationId}` (ver `docs/IRIS-SAAS-PROPOSAL.md`)
- Gobernanza: `docs/IRIS-DATA-GOVERNANCE.md` (retención / export / delete)
- Cobros: `BillingProvider.chargeEnabled = false` hasta autorización expresa

## Checklist staging (antes de pedir prod)

- [ ] Secrets staging cargados (no git)
- [ ] Migraciones aplicadas en D1 staging (incluye 0011 orgs)
- [ ] Probe providers ejecutado; integraciones live o explícitamente disabled
- [ ] Smoke: sign-in, Ask IRIS, Creator run_task, Mission verified≠accept
- [ ] Smoke multi-tenant: crear org B, confirmar que no lee desks de org A
- [ ] Export org (`POST /api/iris-orgs` action=export) como OWNER
- [ ] Backup export + restore drill
- [ ] Rollback ensayado una vez
- [ ] CI verde en el commit candidato
