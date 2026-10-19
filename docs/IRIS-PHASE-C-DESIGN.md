# Fase C — Diseño técnico: IRIS Creator empresarial multi-agente

**Estado:** diseño propuesto — **no implementado** hasta OK del owner.  
**Base:** Fase B cerrada en PR #23 (`cursor/phase-b-enterprise-validation-5440`).  
**Prohibido sin autorización:** deploy producción, cobros reales, auto-merge, auto-modificación del core.

---

## 1. Objetivo

Convertir IRIS Creator en la capa que permite a cada empresa **crear, configurar, probar, aprobar y operar** agentes especializados, coordinados por IRIS Core, con memoria aislada, auditoría, supervisión humana y límites de presupuesto.

---

## 2. Qué ya existe (no rehacer)

| Pieza | Ubicación | Capacidad actual |
|-------|-----------|------------------|
| Desk Creator por org | `orgDeskKey("creator", orgId)` + `/api/iris-creator` | Agentes en JSON por organización |
| Guardian | `lib/iris-creator.ts` | `requiresHumanApproval: true`, `BLOCKED_CAPABILITIES` |
| Sandbox de diseño | `runSandbox` | Checks antes de `awaiting_approval` |
| Propuestas | code/tests proposals | Nunca auto-apply a repo |
| Mission + ACL | `iris-mission`, `iris-tool-acl` | `appliedToRepo=false`, `selfModifiedCore=false` |
| Memoria org | desk `memory` por org | Append-only; promoción humana |
| Coordinador | `/api/iris-coordinator` | Route + `probe_providers` honesto |
| Uso / presupuesto | `iris-usage` + `PLAN_LIMITS` | `assertOrgWithinLimits` en create/run |
| Auditoría | `audit_events.organization_id` | Eventos org-scoped (Fase B) |

**Gap principal:** el “runtime” de agentes aprobados es `tickApprovedAgents` en el desk (ligero). Falta cola durable, tool ACL por agente, memoria por agente, y panel de gobernanza multi-agente por empresa.

---

## 3. Arquitectura propuesta

```
┌─────────────────────────────────────────────────────────────┐
│  Dashboard · Organización activa (cookie + membership)       │
│  Creator panel · Agent detail · Approvals · Usage            │
└───────────────────────────┬─────────────────────────────────┘
                            │ requireOrgContext + role gates
┌───────────────────────────▼─────────────────────────────────┐
│  IRIS Core coordinator                                       │
│  route(task) → local | openai | muse (edit) | elevenlabs     │
│  probe_providers (never fake live_ok)                        │
└───────┬─────────────┬──────────────┬────────────────────────┘
        │             │              │
   Creator desk   Mission queue   Memory store
   (org-scoped)   (org-scoped)    (org-scoped)
        │
   Agent runtime (NUEVO Fase C)
   D1 jobs + Guardian tool gate + usage meter
```

### Principios de aislamiento
1. Todo estado de agente lleva `organizationId` (desk hoy; tablas D1 en C).
2. Un job nunca lee desk/memory de otra org.
3. Un agente **no** puede llamar `update_role`, `create_api_key`, ni elevar sus `permissions`.
4. Tools sensibles (`spend_money`, `deploy`, `purchase`) → siempre `awaiting_human` + audit.

---

## 4. Modelo de datos (migración sugerida `0013_saas_phase_c_agents`)

Tablas nuevas (borrador):

| Tabla | Propósito |
|-------|-----------|
| `organization_agents` | id, org_id, name, status, blueprint JSON, permissions JSON, schedule, approved_by, revoked_at |
| `organization_agent_tools` | agent_id, tool_id, allowed, requires_human |
| `organization_agent_runs` | run_id, agent_id, org_id, job_id, outcome, tokens, cost_cents, created_at |
| `organization_agent_memory` | id, org_id, agent_id, kind, body, status (pending/promoted/rejected) |

Migración de desks JSON existentes → filas D1 en un job one-shot **por org**, sin cruzar tenants.

---

## 5. Capas de producto (incremental)

### C0 — Cierre de contratos (pequeño, seguro)
- Documentar API Creator org-scoped (ya existe).
- Tests de “agente A org1 no aparece en GET creator de org2”.
- Extender audit actions: `AGENT_CREATED`, `AGENT_APPROVED`, `AGENT_TOOL_DENIED`.

### C1 — Gobernanza de agentes por empresa
- UI: lista de agentes de la org activa + estado Guardian.
- Asignación de tools desde catálogo fijo (`business_context`, `draft_composer`, `proposal_queue`, …).
- Prohibir que el agente edite su propio `permissions` array (enforce en `decideAgentProposal` / runtime).

### C2 — Runtime durable
- Encolar ticks en `iris_jobs` (o tabla dedicada) con `organizationId` + `agentId`.
- Worker periódico: lease → ejecutar tool ACL → meter usage → audit.
- Tope por plan (`maxAgents`, budget) antes de enqueue.

### C3 — Memoria por agente + por empresa
- Partition key: `orgId` + opcional `agentId`.
- Lecciones siguen append-only; promoción humana (ya en memory API).
- Ningún retrieval cross-org.

### C4 — Coordinación multi-agente
- Coordinator recibe `teamPlan`: ordenar agentes (analyst → editor Muse → notifier).
- Solo tools preaprobadas; handoff escribe en desk/mission de **la misma** org.
- Human gate si el plan incluye deploy/compra/gasto.

### C5 — Costos de modelos
- `recordUsageEvent` con `provider: openai|muse|elevenlabs|local` y `estimatedCostCents`.
- Panel org: breakdown mensual (presencia; sin exponer keys).
- Soft-stop al 80% presupuesto; hard-stop en `BUDGET_EXCEEDED`.

---

## 6. Matriz de permisos (Creator Fase C)

| Acción | VIEWER | OPERATOR | ADMIN | OWNER |
|--------|--------|----------|-------|-------|
| Listar agentes | Sí | Sí | Sí | Sí |
| Diseñar / sandbox | No | Sí | Sí | Sí |
| Aprobar / rechazar agente | No | No | Sí | Sí |
| Asignar tools | No | No | Sí | Sí |
| Encolar run | No | Sí* | Sí | Sí |
| Export desk | No | No | Sí | Sí |

\* OPERATOR solo si el agente ya está `approved` y la tool no requiere humano.

---

## 7. Integraciones IA en Fase C

| Provider | Uso en Creator | Regla |
|----------|----------------|-------|
| Local IRIS | Diseño / análisis sin clave | Siempre disponible |
| OpenAI | Análisis / runs con key | Solo si `probe` → `live_ok`; si no, fallback local + mensaje honesto |
| Meta Muse | Edición de texto (`edita`/`reescribe`) vía endpoint oficial | Igual; nunca inventar sesión |
| ElevenLabs | Voz de notificaciones / Ask IRIS | 503 o browser TTS sin key |

Prohibido: marcar Muse/OpenAI/ElevenLabs como “live” solo porque la env var existe.

---

## 8. Seguridad (invariantes no negociables)

1. `chargeEnabled === false` hasta OK expresa de cobros.
2. Sin operaciones cross-org.
3. Sin exposición de secretos en responses/logs/exports.
4. Agentes no modifican permisos propios ni IRIS core.
5. Deploy / compras / cambios críticos → aprobación humana.
6. `selfModifiedCore` y `appliedToRepo` permanecen `false` en misiones automáticas.

---

## 9. Plan de pruebas Fase C (cuando se autorice implementar)

- Unit: tool ACL niega self-permission-edit; desk isolation.
- Integration: dos orgs, create agent en A, GET creator en B vacío.
- Usage: create agent tras `AGENT_LIMIT` → 400.
- Probe honesty: sin key → `skipped_no_key`, nunca `live_ok`.
- Security suite: sin `child_process` / `eval` en runtime path.

---

## 10. Estimación de alcance (técnica, no calendario)

| Entrega | Invasividad | Dependencias |
|---------|-------------|--------------|
| C0 contratos + tests | Baja | Solo tests/docs |
| C1 UI gobernanza + tool assign | Media | Creator panel + API |
| C2 runtime durable | Alta | D1 jobs + worker |
| C3 memoria por agente | Media | schema + memory API |
| C4 multi-agente coord | Media-alta | coordinator |
| C5 cost breakdown | Baja-media | usage events |

**Recomendación:** autorizar **C0 + C1** primero en un PR nuevo (`cursor/phase-c-creator-governance-…`), mantener #23 como cierre Fase B.

---

## 11. Preguntas para el owner antes de codificar

1. ¿Priorizar C1 (gobernanza UI) o C2 (runtime durable)?
2. ¿Email de invites (pendiente B) entra en el mismo tren que C0?
3. ¿Staging Cloudflare autorizado para probes live con claves reales?
4. ¿Algún catálogo de tools de negocio obligatorio en el primer piloto?

Sin respuestas → **no se implementan cambios mayores de Fase C**.
