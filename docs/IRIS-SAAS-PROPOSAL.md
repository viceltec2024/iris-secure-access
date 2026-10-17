# IRIS AI SaaS — Propuesta técnica multiempresa

**Estado:** Fase A + Fase B en PR #18 (draft)  
**Producción / merge / cobros reales:** no autorizados

## 1. Objetivo

Convertir IRIS Secure Access en una plataforma SaaS B2B donde cada empresa (organización) contrata un plan, aísla datos y opera Creator / Guardian / Missions / Memory bajo supervisión humana.

## 2. Arquitectura multi-tenant

### Modelo

- **Tenant = Organization** (`organizations`)
- **Membership** (`organization_members`): roles `OWNER | ADMIN | OPERATOR | VIEWER`
- **Platform ADMIN** (usuario global `users.role=ADMIN`) ≠ rol de organización
- **Active org** por cookie `iris_org_id` (servidor valida membership en cada request)
- **Datos de producto** (Creator/Mission/Memory desks) con claves `*:org:{organizationId}` — nunca solo email

```
Request → Auth identity → resolveActiveOrganization(email, cookie)
       → requireOrgPermission(action)
       → assertUsageWithinPlan(org)
       → mutate only org-scoped keys / rows
       → audit(organizationId, actorEmail, …)
```

### Controles

| Capa | Mecanismo |
|------|-----------|
| API | `requireOrgContext` + role checks |
| Persistencia | Keys y columnas `organization_id` |
| Auditoría | `organization_id` en `audit_events` |
| Tests | Cross-tenant deny (A no lee B) |

### No incluido aún (requiere OK)

- Stripe **live** / cobros reales (`chargeEnabled` permanece `false`)
- Deploy staging/prod
- Object storage de archivos por tenant (R2) — diseño listo, no contratado
- Envío de email SMTP para invitaciones (hoy: token one-time en UI admin)

## 3. Migraciones D1

`drizzle/0011_saas_organizations.sql`:

- `organizations`
- `organization_members`
- `organization_usage_monthly`
- `usage_events`
- `audit_events.organization_id` (nullable para legado)

Backfill: al primer login se crea org personal `personal-{slug}` plan Starter y membership OWNER.

## 4. Planes (límites, sin cobro)

| Plan | Agentes | Misiones/mes | Requests/mes | Tokens/mes (soft) | Budget USD soft |
|------|---------|--------------|--------------|-------------------|-----------------|
| Starter | 3 | 50 | 5_000 | 200_000 | 25 |
| Business | 25 | 500 | 50_000 | 2_000_000 | 250 |
| Enterprise | 200 | 5_000 | 500_000 | 20_000_000 | 2500 |

Al superar límites: **suspender operaciones mutantes** (`USAGE_LIMIT` / `BUDGET_EXCEEDED`), lectura permitida.

Pagos: interfaz `BillingProvider` stub; integración real **solo tras autorización**.

## 5. Módulos empresariales

- Creator / Guardian / Missions / Memory: scoped por org
- Dashboard org: miembros, plan, uso, auditoría filtrada
- Retención/export/delete: documentados en `docs/IRIS-DATA-GOVERNANCE.md`

## 6. Riesgos

1. Migración de desks email→org (compat: leer legacy email key una vez, reescribir a org)
2. Cookie org spoofing → mitigado por membership check server-side
3. Shared D1 → aislamiento lógico; R2/DO más tarde si se autoriza costo
4. Platform ADMIN ve todo → restringir en prod a operaciones de soporte

## 7. Costos estimados (sin nuevos contratos)

| Ítem | Estimación |
|------|------------|
| CF Workers/D1 (plan actual) | $0–$25 |
| OpenAI/Muse/ElevenLabs (por tenant usage) | variable; meterizado |
| Pasarela pagos | $0 hasta autorización |
| R2 / monitoring pago | $0 hasta autorización |

## 8. Criterios de aceptación (fase multi-tenant)

1. Org A no puede leer Creator/Mission/Memory de org B (tests + API)
2. Roles org deniegan acciones no permitidas
3. Límites de plan bloquean mutaciones al excederse
4. Auditoría incluye `organizationId`
5. Sin Stripe/cobros activos
6. Tests unitarios de aislamiento en verde
7. No merge a main / no prod

## 9. Fases

| Fase | Contenido | Auth needed |
|------|-----------|-------------|
| A | Proposal + schema + tenant libs + scope APIs + metering stub + tests | No |
| B (esta) | Invites + roles admin + org API keys + billing **test** + staging prep | No (test only) |
| C | Stripe live / cobros reales | **Sí expresa** |
| D | Staging deploy + drills | **Sí** |
| E | Production | **Sí expresa** |

Detalle Fase B: `docs/IRIS-PHASE-B.md`.
