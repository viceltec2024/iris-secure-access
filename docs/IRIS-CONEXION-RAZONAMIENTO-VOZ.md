# IRIS — Razonamiento conectado a Ask IRIS y voz ElevenLabs

Sin merge a main, sin despliegue. Rama: `iris/conexion-razonamiento-voz-2026-11-03`
(base: PR #34, commit `7e74cf9`).

## 1. Razonamiento conectado (Ask IRIS)

- Nuevo `lib/iris-ask-reasoning.ts`: para preguntas generales/mundo,
  consulta realmente Wikipedia con `irisWorldAnswerWithCitations`
  (Etapa 2) y pasa el resultado por `buildReasonedAnswer`:
  descomposición en pasos, verificación por paso contra la fuente
  realmente consultada, detección de contradicciones y formato
  respuesta directa → pasos → fuentes → confianza.
- `app/api/ask-iris/route.ts`: si `resolved.source === "world"`,
  devuelve `source: "reasoned_world"` con `answer`, `directAnswer`,
  `reasoning`, `confidence`, `sources`, `steps`, `contradictions` y
  `unknownSteps`. Guardian sigue antes (bloquea primero) y la vía de
  edición con Muse no se toca.
- Honestidad del alcance, por diseño:
  - Un paso sin fuente verificada se marca "No sé", nunca se inventa.
  - Si Wikipedia no devuelve nada, no se fabrica respuesta razonada:
    la ruta sigue su fallback local existente.
  - Las respuestas SOC / de contexto local NO pasan por razonamiento
    con citas: su evidencia es telemetría interna, incidentes y
    lecciones aprobadas, no hosts web permitidos. Forzarlas por
    `validateSources` las convertiría todas en un falso "No sé" o
    exigiría inventar citas. Tampoco se presentan como verificadas
    con citas. Conectar esa evidencia interna al razonamiento es un
    paso posterior, con su propio diseño.
  - Una sola fuente (Wikipedia) es `parcial`, nunca `verificado`.

## 2. Voz ElevenLabs — ya conectada, verificada (sin cambio de clave)

La ruta `app/api/iris-voice/route.ts` ya estaba correctamente
conectada; esta entrega la verifica con pruebas y la documenta, no
cambia su manejo de claves:

- Clave solo del entorno: `ELEVENLABS_API_KEY` (nunca en código,
  tests, logs ni respuestas; el GET solo devuelve `tts: true/false`).
- Voz por defecto Sarah: `EXAVITQu4vr4xnSDxMaL`,
  modelo `eleven_multilingual_v2`; anulable con `ELEVENLABS_VOICE_ID`
  y `ELEVENLABS_MODEL_ID`.
- Sesión obligatoria, límite 30/min por usuario (luego 429), texto
  máximo 3600 caracteres, y 503 si no está configurada.
- Sin clave, el panel cae a la voz del navegador
  (`speechSynthesis`), como indica AGENTS.md.
- La clave del conector personal del usuario para Muse/Reblow NO se
  usa, copia ni extrae para este repo: es otra conexión.

### Qué falta para que la voz live funcione en producción

En el entorno de despliegue (Cloudflare Sites / worker) debe existir
la variable `ELEVENLABS_API_KEY` con una clave de ElevenLabs creada
para IRIS. Sin ella, `GET /api/iris-voice` devuelve `tts: false` y
el panel usa la voz del navegador. Ningún valor de clave se escribe
en este documento ni en el código.

## 3. Pruebas

`tests/iris-conexion-razonamiento-voz.test.mjs`: respuesta razonada
con fuente realmente consultada (stub de Wikipedia), sin fuente no
se fabrica respuesta, cableado de la ruta después de Guardian y
antes de OpenAI, y controles de la ruta de voz.
