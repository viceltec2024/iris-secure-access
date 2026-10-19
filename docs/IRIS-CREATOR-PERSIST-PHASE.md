# IRIS Creator — fase de ejecución persistente (borrador)

Estado: implementado en desarrollo / pendiente de tu aprobación. **No producción.**

## Objetivo

Agentes **aprobados** ejecutan ciclos supervisados persistentes con:

1. **Guardian obligatorio** en cada ciclo (`evaluatePersistentGuardian`)
2. **Registro de actividades** append-only por agente (`activityLog`, máx. 50)
3. **Controles de costo** vía `assertOrgWithinLimits` + `recordUsageEvent` (`chargeEnabled=false`)
4. Sin `appliedToRepo`, sin `selfModifiedCore`, sin gastos reales

## API

`POST /api/iris-creator` con:

```json
{ "action": "run_cycle", "language": "es" }
```

Respuesta incluye `cycle: { ran, blocked, skipped, estimatedCostCents, activity, appliedToRepo:false, limits }`.

`run_task` ahora también respeta presupuesto org (HTTP 402 si excede).

## Seguridad intacta

- Solo `status === "approved"`
- `autonomy === "supervised"` + `requiresHumanApproval === true` o el ciclo pausa/bloquea
- ACL + `runAuthorizedAgentTask` (heartbeat)
- `on_demand` no corre en ciclo automático
- Metering estimado (`PERSIST_HEARTBEAT_COST_CENTS=1`); no Stripe live

## Siguiente (requiere tu OK)

- Cron/queue Cloudflare para invocar `run_cycle` periódicamente
- UI de activity/cost en el dashboard Creator
- Alertas cuando `BUDGET_EXCEEDED`
