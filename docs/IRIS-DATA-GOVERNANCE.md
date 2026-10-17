# IRIS AI — Gobernanza de datos (SaaS multiempresa)

## Retención

| Dato | Retención por defecto | Notas |
|------|----------------------|-------|
| Audit events | 24 meses | Hash-chained; no borrar selectivamente |
| Usage events | 24 meses | Agregados mensuales 36 meses |
| Mission/Creator/Memory desks | Mientras la org esté ACTIVE | Export antes de delete |
| Devices/alerts | 12 meses tras OFFLINE | SOC |

## Eliminación (derecho al olvido org)

1. OWNER solicita `ORG_DELETE` (API futura / soporte)
2. Export ZIP de desks + audit filtrado por `organization_id`
3. Soft-suspend 30 días
4. Hard-delete desks `*:org:{id}`, members, usage; anonymize audit actor emails opcionales

**No implementado el hard-delete automático en esta fase** — documentado para staging/prod.

## Exportación

- Formato: JSON por recurso (`organization`, `members`, `creator`, `missions`, `memory`, `usage`)
- Endpoint: `POST /api/iris-orgs { action: "export" }` (OWNER/ADMIN)
- UI: panel Organización del dashboard (miembros / plan / consumo); export vía API

## Aislamiento

- Claves `iris_*:org:{organizationId}`
- Membership check en cada request mutante
- Tests: `tests/iris-tenant.test.mjs`
