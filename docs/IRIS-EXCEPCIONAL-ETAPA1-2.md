# IRIS excepcional — Etapas 1 y 2

Rama: `iris/excepcional-etapa1-2-2026-11-03` (borrador, sin merge a main,
sin despliegue). Base: `iris/improvements-2026-11-03` en `b3a5502`
(auditoría de seguridad) + `9906f9d` (corrección Guardian).

## Etapa 1 — Cimientos medibles

- Dataset fijo y versionado: `lib/iris-quality-dataset.ts`,
  versión `2026-11-03`, 20 casos (5 SOC, 5 generales, 5 edición,
  5 seguridad). Correrlo dos veces da el mismo informe.
- Métricas por respuesta: `lib/iris-answer-metrics.ts` — proveedor,
  latencia, tokens (solo si el proveedor los reporta), herramientas
  usadas y `live` (true solo tras comprobación real). "Configurado"
  y "live" nunca se mezclan: sin comprobación real, `live=false`.
- Evaluador: `lib/iris-quality-eval.ts` — pass/fail, passRate,
  por categoría, p50/p95 de latencia, tokens totales y costo.
  El costo es `null` cuando nadie lo mide; nunca se inventa de
  una tabla de precios.
- Umbrales PROPUESTOS (no son cifras actuales): bloqueo de seguridad
  100%, respuestas generales con cita válida ≥90%. Lo observado
  en local es: 20/20, bloqueo 100%, citas generales 100%.

Alcance honesto del dataset offline: los casos Guardian y de rutas
corren contra código real sin red ni claves. Los casos de citas
usan FIXTURES para probar el contrato (formato, validación,
confianza); una fixture no es una consulta live y nunca se
reporta como tal. La consulta live se prueba aparte en el
módulo de mundo (Wikipedia), fuera del dataset offline.

## Etapa 2 — Razonamiento y fuentes confiables

- `lib/iris-cited-answer.ts` — plan en pasos, en código:
  pregunta → fuentes consultadas → validación → respuesta.
  No obtiene fuentes por sí mismo: solo formatea y valida las
  fuentes que quien llama consultó de verdad en esa ejecución.
- Confianza derivada, no declarada: 2+ hosts permitidos distintos
  → `verificado`; 1 host → `parcial`; 0 fuentes válidas →
  `no_verificado`, con primera línea "No sé" / "I don't know"
  y sin presentar el cuerpo sin verificar como hecho.
- Hosts permitidos hoy: ediciones de Wikipedia y MDN
  (`developer.mozilla.org`). MDN está allowlistado para fuentes
  realmente consultadas por quien llama; este módulo NO obtiene
  MDN, así que un fetcher MDN live sigue pendiente y no debe
  afirmarse. La ruta live de mundo (`irisWorldAnswerWithCitations`)
  consulta solo Wikipedia, por eso una respuesta de mundo con
  una sola fuente es `parcial`, nunca `verificado`.
- Citas con título, URL y fecha de consulta. URLs no permitidas,
  sin título o sin fecha válida se descartan y bajan la confianza;
  nunca aparecen en la respuesta.

## Qué NO cambió

- Guardian intacto, sin debilitar. `memoryAllowsSelfModify()`
  sigue en false. Puerta humana para mission/creator intacta.
  Sin auto-aprobación, sin secretos en código/tests/logs,
  sin shell, deploy, gasto ni push desde el código nuevo.
- Las rutas existentes no se tocaron: este cambio añade
  módulos y tests nuevos, no cambia el comportamiento de
  ask-iris, Creator, Mission ni Voice.

## Cómo verificar

```sh
node --experimental-strip-types --test tests/iris-excepcional-etapa1-2.test.mjs
node --experimental-strip-types --test tests/iris-excepcional-etapa1-2.test.mjs \
  tests/iris-security-suite.test.mjs tests/iris-improvements.test.mjs \
  tests/iris-creator.test.mjs tests/iris-agent.test.mjs \
  tests/iris-coordinator.test.mjs tests/iris-evals.test.mjs \
  tests/iris-mind.test.mjs tests/iris-model-router.test.mjs
```

## Pendiente / riesgos

- CI del nuevo PR debe confirmar antes de cualquier merge.
- Lint y build completos no se verificaron en este entorno
  (sin `node_modules` instalado para este checkout; solo se
  corrieron los tests con `node --test`, que no necesitan
  dependencias).
- Live sin clave no está probado: sin claves reales, el
  proveedor live nunca se afirma; el estado es
  `configuredOnly` / `notConfigured` según la sonda existente.
- Fetcher MDN live pendiente; segunda fuente live hoy es
  solo Wikipedia (una fuente → parcial).
- Etapas 3–5 de la hoja de ruta (memoria con permiso,
  herramientas con evidencia, evaluación continua) no están
  en esta entrega.
