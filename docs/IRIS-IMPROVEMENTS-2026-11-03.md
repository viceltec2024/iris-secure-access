# IRIS — Mejoras aplicadas el 2026-11-03

Rama: `iris/improvements-2026-11-03`, sobre `main` en `b5a3f7df`.
Ningún cambio toca la regla de que Memory nunca autoriza
auto-modificación del core (`memoryAllowsSelfModify()` sigue siendo
siempre `false`), ni quita ningún bloqueo de Guardian.

## Seguridad (P0)

- **Guardian contra paráfrasis** (`lib/iris-guardian.ts`): el texto se
  normaliza antes del regex (NFKC, minúsculas, sin diacríticos, sin
  caracteres de ancho cero, leetspeak habitual, letras sueltas unidas)
  y se comprueba también una versión sin espacios. La muestra original
  se sigue comprobando para no perder patrones con puntuación
  (`rm -rf`, `/bin/sh`). Tests en `tests/iris-improvements.test.mjs`.
- **Fixture de claves** (`tests/iris-phase-b.test.mjs`): el antiguo
  fixture armaba una forma de clave partiendo strings para esquivar el
  escaneo de CI. Se sustituyó por un placeholder obviamente falso
  (`OPENAI_API_KEY=FAKE-PLACEHOLDER-NOT-A-REAL-KEY`), detectable por
  el patrón de asignación, no por forma de clave. El CI
  (`.github/workflows/ci.yml`) ahora rechaza además fixtures que usen
  el patrón de string partido. Verificación: no se encontró ninguna
  clave real en el repo en esta revisión; el escaneo completo de
  secretos lo debe confirmar el CI del PR.
- **Aprobación simulada separada** (`lib/iris-tool-acl.ts`,
  `lib/iris-sandbox-runner.ts`): el sandbox ya no pasa
  `humanApproved: true`. Pasa `simulatedApproval: true`, que devuelve
  `reason: "allowed_simulated_only"` y `requiresHumanApproval: true`,
  y el resultado marca `approvalSimulation: true`. Una aprobación
  simulada nunca se persiste ni se reutiliza como aprobación real.

## Claridad (P0)

- **Coordinador** (`lib/iris-coordinator.ts`): se eliminó el ternario
  `route.kind === "edit" ? false : false`. Ahora
  `humanGateRequired` es explícito: `true` para `mission` y `creator`,
  `false` para `ask`, `edit`, `voice` y `probe` (que solo redactan,
  proponen o consultan; la activación y aplicación posterior sí
  exigen aprobación).
- **README**: reescrito con la arquitectura real, rutas, variables de
  `.env.example` y cómo probar en local. Ya no es la plantilla de
  vinext-starter.

## Funcionalidad (P1)

- **Creator personalizado** (`lib/iris-creator.ts`): `deriveCreatorGoals`
  deriva metas y enfoque del prompt validado (tienda, clientes, ventas,
  inventario, redes, citas). Los permisos no cambian con el prompt.
- **Tick / cron**: no hay cron de Sites todavía, y no se inventó uno.
  Se documenta en `docs/IRIS-TICK-CRON-NOTE.md` y en el texto de
  Creator: el tick es un latido que se drena al abrir el panel o al
  llamar a `process_ticks`; no ejecuta tareas en segundo plano por sí
  solo y no se debe prometer un "agente 24/7 activo".
- **Concurrencia CAS**: Memory (`appendMemory`,
  `requestLessonPromotion`, `decideLessonPromotion`), Creator
  (`withAgents` incrementa `revision`, aprobaciones y decisiones con
  `expectedRevision` opcional) y Mission (`revision` en el desk,
  `bumpMissionDesk`, aprobaciones con `expectedRevision` opcional)
  rechazan escrituras con revisión desactualizada
  (`revision_conflict`) en vez de pisarlas. No se migró a D1: habría
  sido un cambio de almacenamiento mayor, sin verificación local
  posible en esta revisión; el CAS es el paso seguro y reversible.

## Calidad (P1)

- **Tests nuevos** (`tests/iris-improvements.test.mjs`): Guardian
  adversarial, CAS de revisión, aprobación simulada separada,
  aprobación con actor humano verificado (email con `@`, si no
  `verified_human_actor_required`), puerta humana del coordinador,
  personalización de Creator, probe sin claves que nunca declara live,
  y distinción configurado/probado en la ruta de estado.
- **Probe live** (`app/api/iris-providers/status/route.ts`): con
  `?probe=1` la respuesta incluye `probeSummary` con `liveVerified`
  (HTTP real OK), `configuredOnly` y `notConfigured`, además de
  `probes` por proveedor. Sin `probe=1` no se declara nada live.

## Notas de honestidad (P2)

- **Evals**: un "100% pass" de la suite de `lib/iris-evals.ts` es
  local, no es una puntuación de producción ni un benchmark oficial
  (SWE-bench, GAIA u otros). Los casos son análogos locales, como ya
  indica el propio archivo.
- **Voz por defecto**: la voz por defecto de ElevenLabs en IRIS es
  Sarah (`EXAVITQu4vr4xnSDxMaL` en `.env.example` y en
  `/api/iris-voice`), la misma voz del avatar Muse/Reblow. Eso es una
  coincidencia de configuración, no una prueba de que la integración
  esté live: solo `probe=1` con clave real puede probarla.
