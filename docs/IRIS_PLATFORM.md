# IRIS AI Platform — arquitectura y plan

## Estado del repositorio (inspección)

| Capa | Tecnología actual | Notas |
|---|---|---|
| Consola SOC | Next.js / vinext / React / TypeScript | Código funcional: dashboard, Mac agent, Ask IRIS, wallet, compras |
| Persistencia SOC | Cloudflare D1 + Drizzle | `appSettings`, dispositivos, auditoría SOC |
| Creator MVP (TS) | `lib/iris-creator.ts` + `/api/iris-creator` + panel dashboard | Diseño → sandbox → aprobación → pause; ya en UI |
| Backend plataforma (objetivo) | FastAPI + PostgreSQL + Redis/Celery | Fase 1: scaffold local; sin Docker en este entorno |
| Memoria semántica | — | Pendiente (pgvector) |
| Orquestador | — | Pendiente (Celery workers reales) |

**Regla:** se conserva todo el código SOC funcional. Creator de plataforma se añade en `platform/` y se amplía el panel existente sin romper Operaciones / Ask IRIS / agente Mac.

## Visión modular

```
platform/
  iris-api/          # IRIS Core + Creator + Guardian API (FastAPI)
  worker/            # Celery (stub Fase 1; real en Fase 3)
  sandbox/           # Ejecución aislada de pruebas (subprocess sin red)
docker-compose.yml   # postgres + redis + api + worker (cuando haya Docker)
app/dashboard/       # UI Next.js (sección IRIS Creator ampliada)
```

| Módulo | Fase 1 | Posterior |
|---|---|---|
| IRIS Core | Interpretar prompt → spec estructurada | Prioridades, multi-objetivo |
| IRIS Creator | Spec, código, tests, aprobación humana | Plantillas versionadas, diffs |
| IRIS Guardian | Validación estática + sandbox sin privilegios + kill/pause | Límites de gasto, políticas finas |
| IRIS Memory | Persistencia SQL de agentes/tareas/auditoría | pgvector / memoria semántica |
| IRIS Learning | Stub: métricas básicas | Evaluación A/B, propuestas |
| IRIS Orchestrator | Heartbeat / activate / pause en API | Redis + Celery + anti-duplicados |

## Fases

### Fase 1 — MVP local (esta entrega)

1. Cuenta admin bootstrap (API plataforma).
2. Panel visual IRIS Creator (dashboard existente).
3. Instrucción → especificación estructurada.
4. Revisar/editar herramientas autorizadas.
5. Generar código + tests (plantilla segura).
6. Ejecutar pruebas aisladas (subprocess / simuladas).
7. Mostrar resultados.
8. Aprobar o rechazar.
9. Activar / pausar / eliminar agentes aprobados.
10. Auditoría: quién creó, aprobó, ejecutó.

Stack Fase 1: FastAPI + SQLAlchemy; SQLite por defecto; PostgreSQL si `DATABASE_URL` apunta a Postgres. Redis/Celery definidos en compose pero no obligatorios para el MVP local.

### Fase 2 — Memoria e integración

- PostgreSQL + pgvector.
- Memoria contextual por agente.
- Bridge autenticado dashboard ↔ FastAPI (sin claves en frontend).

### Fase 3 — Orchestrator + Learning

- Celery workers, colas, reintentos, anti-duplicados.
- Evaluaciones verificables y propuestas de mejora con aprobación.

### Fuera de alcance sin aprobación explícita

- Despliegues públicos.
- Automatizaciones financieras.
- Cambios autónomos de infraestructura.
- Agentes que modifiquen políticas Guardian o creen agentes sin límite.

## Seguridad (obligatoria)

- Código generado **nunca** corre en el proceso principal de la API.
- Sin acceso automático a secretos / `OPENAI_API_KEY` en frontend.
- Capacidades peligrosas bloqueadas (`exec_shell`, `spend_money`, `deploy_without_approval`, …).
- Aprobación humana antes de activar.
- Kill switch: pause / deactivate / delete.

## Qué funciona ahora (probado)

| Pieza | Prueba | Estado |
|---|---|---|
| Dashboard Creator (vinext) | `tests/iris-creator.test.mjs` + lint | Funciona: design, edit tools, sandbox checks, approve/reject, pause/stop/delete |
| Ask IRIS → Creator | `tests/iris-mind.test.mjs` | Funciona |
| FastAPI platform API | `platform/iris-api` pytest (3 cases) | Funciona en SQLite local: bootstrap, design, tools, sandbox subprocess, approve, pause, emergency-stop, delete, guardian block |
| Docker Compose Postgres/Redis | — | Archivo presente; **no ejecutado** en este entorno (sin Docker) |
| Bridge dashboard ↔ FastAPI JWT | — | **Pendiente** Fase 2 |
| pgvector Memory | — | **Pendiente** |
| Celery Orchestrator real | — | **Pendiente** |
| Learning / A-B | — | **Pendiente** (stub no implementado) |

## Arranque rápido

```bash
# Consola SOC + Creator UI
npm ci && cp -n .env.example .env.local && npm run dev:local
# → http://127.0.0.1:5173/dashboard#creator

# API plataforma (opcional, paralelo)
cd platform/iris-api
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8088
```
