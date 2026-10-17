# IRIS AI SaaS — Fase B

**Estado:** implementada en PR #18  
**Producción / cobros reales / merge:** no autorizados

## Alcance entregado

1. **Invitaciones empresariales** — token `iris_inv_*` (hash en D1), TTL 7 días, aceptar/revocar
2. **Admin de usuarios/roles** — update role, remove member, protección del último OWNER
3. **Claves API de organización** — `iris_ak_*`, secreto una sola vez, solo hash persistido
4. **Secretos de plataforma** — panel de presencia (configured/missing), nunca valores
5. **Billing modo prueba** — `IRIS_BILLING_TEST=1`; checkout simulado; `chargeEnabled` siempre `false`; `sk_live_` / `IRIS_BILLING_LIVE=1` bloqueados
6. **Staging prep** — checklist ampliada en `docs/IRIS-1.0-STAGING.md`

## Migración

`drizzle/0012_saas_phase_b.sql`: invites, api_keys, billing_events + columnas billing en organizations.

## Criterios

| Criterio | Estado |
|----------|--------|
| Invite token no se guarda en claro | Sí (SHA-256) |
| API key secret one-time | Sí |
| Respuestas sin secretos de proveedor | Sí (`assertNoSecretsInPayload` + presencia) |
| chargeEnabled false | Sí |
| Aislamiento org | Conservado + tests |
| Deploy prod | No |

## Pendiente lanzamiento comercial

- Autorizar Stripe live / cobros reales
- Deploy staging + restore/rollback drills
- Email delivery de invitaciones (hoy: token en UI admin)
- R2 archivos por tenant
- Merge a `main` solo con OK expresa
