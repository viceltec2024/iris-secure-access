# IRIS Secure Access

IRIS es una consola de seguridad supervisada, no un agente autónomo.
Coordina agentes propuestos por el usuario, los prueba en un sandbox de
políticas, y solo los activa o acepta sus informes con aprobación humana.
Nunca auto-aplica código, nunca despliega solo, nunca gasta dinero y
nunca auto-modifica su propio núcleo.

## Arquitectura real

El núcleo no es un archivo `iris-core.ts`: es el coordinador.

- **Coordinador — `lib/iris-coordinator.ts`**
  Clasifica tareas (`ask | edit | voice | mission | creator | probe`),
  enruta al proveedor adecuado y construye snapshots de agentes, misiones
  y cola. Puerta humana explícita: `mission` y `creator` la exigen;
  `ask`, `edit`, `voice` y `probe` solo redactan, proponen o consultan
  estado, y cualquier aplicación posterior vuelve a exigir aprobación.
- **Creator — `lib/iris-creator.ts`**
  Diseña agentes supervisados a partir de un prompt validado, con metas
  derivadas del prompt (sin ampliar permisos), sandbox y estado
  `awaiting_approval`. Genera una plantilla de texto, no ejecuta código
  arbitrario. El `tick` es un latido, no una ejecución en segundo plano.
- **Memory — `lib/iris-memory.ts`**
  Append-only, máximo 200 registros, búsqueda TF-IDF local (sin
  embeddings ni base vectorial). Las lecciones pasan de `pending` a
  `approved` solo con un actor humano verificado.
  `memoryAllowsSelfModify()` siempre devuelve `false`: Memory nunca
  autoriza auto-modificación del core de IRIS.
- **Guardian — `lib/iris-guardian.ts` + `lib/iris-tool-acl.ts`**
  Detección de inyección por regex sobre texto normalizado (NFKC,
  minúsculas, sin diacríticos, leetspeak habitual y letras sueltas
  unidas) para resistir paráfrasis. Allowlist de 9 herramientas.
  Bloqueadas siempre: `exec_shell`, `filesystem_write`, `git_push`,
  `deploy_production`, `spend_money`, `self_modify_core`,
  `exfiltrate_secrets`, `network_unrestricted`,
  `deploy_without_approval`.
- **Misiones y evals — `lib/iris-mission.ts`, `lib/iris-evals.ts`**
  Flujo supervisado: plan → cola → sandbox → verificación por
  evidencia → aceptación humana. `appliedToRepo` y `selfModifiedCore`
  siempre son `false`. Los evals son análogos locales, no puntuaciones
  oficiales de benchmarks ni de producción.
- **Sandbox — `lib/iris-sandbox-runner.ts`**
  Aislamiento honesto: isolate de Worker + sandbox de políticas, no
  contenedor ni VM, no shell. La aprobación que usa es de simulación
  (`simulatedApproval`): nunca se persiste ni se reutiliza como
  aprobación humana real.

## Rutas principales

- `GET/POST /api/ask-iris` — Ask IRIS, conversación escrita.
- `POST /api/agent/run` — análisis SOC con herramientas.
- `GET/POST /api/iris-creator` — diseñar, aprobar, pausar y drenar
  ticks de agentes (`process_ticks` drena la cola solo en esa petición).
- `GET/POST /api/iris-mission` — planificar y ejecutar misiones en
  sandbox, con aceptación humana.
- `GET/POST /api/iris-evals` — suite local de evaluación y lecciones.
- `GET /api/iris-providers/status` — estado de proveedores.
  `?probe=1` ejecuta sondas HTTP reales y devuelve `probeSummary`
  con `liveVerified` (HTTP real OK), `configuredOnly` (hay clave pero
  sin prueba live) y `notConfigured`. Una clave configurada no es una
  integración live probada.
- `GET /api/iris-voice` — voz neural o fallback del navegador.

## Proveedores e integraciones

El enrutado está en `lib/iris-model-router.ts` y las sondas en
`lib/iris-provider-probe.ts`. Cada integración solo se activa con su
clave en el entorno; sin clave hay fallback local.

- **OpenAI** — solo preguntas SOC, modelo `gpt-5.6-sol`
  (`OPENAI_API_KEY`).
- **Muse (Meta)** — solo edición/reescritura, modelo
  `muse-spark-1.3` (`MODEL_API_KEY`, alias `MUSE_API_KEY`).
- **ElevenLabs** — voz neural, modelo `eleven_multilingual_v2`
  (`ELEVENLABS_API_KEY`, voz por defecto Sarah, la misma voz del
  avatar). Sin clave, `speechSynthesis` del navegador.
- **Local** — mente IRIS local, Wikipedia y analista sin LLM.

## Variables de entorno

Ver `.env.example` (solo nombres, nunca valores reales). Copiar a
`.env.local` (ignorado por git) para desarrollo local:

- `OPENAI_API_KEY`, `MODEL_API_KEY`, `ELEVENLABS_API_KEY`
  (opcionales; sin ellas, fallback local).
- `ELEVENLABS_VOICE_ID`, `ELEVENLABS_MODEL_ID` (opcionales).
- `IRIS_OWNER_EMAIL`, `IRIS_DEV_EMAIL`, `IRIS_DEV_SKIP_STEPUP`
  (solo desarrollo local).
- Facturación en modo prueba: `IRIS_BILLING_TEST=1` nunca cobra;
  `IRIS_BILLING_LIVE` debe quedar sin activar salvo autorización
  expresa del propietario.

Nunca se deben commitear claves reales. El CI escanea secretos y
rechaza también fixtures que armen formas de clave partiendo strings.

## Probar en local

```bash
npm ci
cp -n .env.example .env.local
npm run dev:local
```

Abrir `http://127.0.0.1:5173/dashboard` (identidad local
`owner@iris.local`, ADMIN). Ver la base completa en `AGENTS.md`.

```bash
npm run lint
node --experimental-strip-types --test tests/*.mjs
```

Omitir `tests/rendered-html.test.mjs` hasta después de `npm run build`,
como indica `AGENTS.md`.

## Límites honestos (no prometer más)

- No hay cron de Sites todavía: el tick se drena al abrir el panel de
  Creator o al llamar a `process_ticks`. Un agente "always_on" no
  ejecuta tareas en segundo plano por sí solo. Ver
  `docs/IRIS-TICK-CRON-NOTE.md`.
- No hay agentes autónomos, ni auto-mejora del core, ni aislamiento
  de contenedor/VM, ni memoria vectorial.
- Un "100% pass" de evals es local, no de producción. Ver
  `docs/IRIS-IMPROVEMENTS-2026-11-03.md`.
- Concurrencia: Memory, Creator y Mission usan revisión monótona
  (CAS). Pasar una `expectedRevision` desactualizada rechaza la
  escritura con `revision_conflict` en vez de pisarla.
