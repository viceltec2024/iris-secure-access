# IRIS — Evaluación continua (Etapa 5)

Cómo se mide IRIS en cada PR, con qué umbrales, y qué está prohibido
hacer para mejorar la cifra. Sin red, sin claves, sin costo inventado:
la evaluación offline corre contra código real (Guardian, model router)
y fixtures de citas, y nunca se presenta como consulta en vivo.

## Qué se corre en cada PR

```bash
# 1. Puerta de calidad: dataset versionado + evals + umbrales (exit 1 si falla)
node --experimental-strip-types scripts/iris-quality-gate.mjs
#    o bien:
npm run quality-gate

# 2. Tests nuevos y afectados (sin build; ver AGENTS.md para rendered-html)
node --experimental-strip-types --test tests/iris-excepcional-etapa1-2.test.mjs \
  tests/iris-excepcional-etapa3-4.test.mjs tests/iris-excepcional-cierre.test.mjs \
  tests/iris-razonamiento.test.mjs tests/iris-security-audit-2026-11-03.test.mjs \
  tests/iris-security-suite.test.mjs tests/iris-creator.test.mjs tests/iris-agent.test.mjs \
  tests/iris-coordinator.test.mjs tests/iris-mind.test.mjs tests/iris-model-router.test.mjs
```

El script de la puerta corre `runQualityEval()` sobre el dataset
versionado `QUALITY_DATASET_VERSION` en `lib/iris-quality-dataset.ts`
(22 casos en la versión 2026-11-14: 5 SOC, 5 generales, 5 de edición,
5 de seguridad y 2 bilingües de flujo de tarea). Imprime el pass rate
global y por categoría, `securityBlockRate`, `generalCitationPassRate`,
completitud/errores del flujo de tareas y latencia p50/p95.

## Umbrales (la puerta falla si alguno no se cumple)

| Medida | Umbral | Por qué |
|---|---|---|
| `securityBlockRate` | `1.0` | Guardian debe bloquear los 5 casos de seguridad, sin excepción |
| `generalCitationPassRate` | `>= 0.9` | Las citas generales deben validar confianza y formato |
| `passRate` global | `>= 0.9` | Sin regresiones silenciosas en el dataset |
| `taskCompletionRate` offline | `1.0` | Los dos casos bilingües deben dividirse en los pasos esperados y conservar el contrato de uso/revisión de herramientas |
| `totalCostUsd` offline | `null` | La evaluación offline no mide costo; un número aquí sería inventado |
| Casos en el dataset | `>= 22` | Ver regla anti-trampa abajo |
| Ids de caso | únicos | Sin duplicados que inflen el total |

La latencia p50/p95 se reporta como informativa, sin umbral: un umbral
de latencia en un runner compartido daría falsos rojos.

## Regla anti-trampa: prohibido borrar casos que fallan

**Nunca se borra ni se edita un caso para que la cifra mejore.** Un caso
que falla se queda en el dataset y se arregla el producto. Las únicas
vías legítimas son:

1. Arreglar el código para que el caso pase (lo habitual).
2. Si el caso en sí estaba mal (expectativa incorrecta demostrada, no
   "no nos gusta el resultado"): documentar el motivo en el PR, mantener
   el caso en el historial del dataset con su id retirado marcado como
   `superseded` — no eliminado en silencio — y añadir un caso nuevo con
   un id nuevo. El conteo total nunca baja.
3. Añadir casos nuevos: nuevo id (`soc-06`, `sec-06`, …), bump de
   `QUALITY_DATASET_VERSION` y nota en el PR de qué comportamiento nuevo
   cubre. Añadir está siempre permitido; quitar, nunca sin el punto 2.

El script hace cumplir el punto mínimo de esta regla: si el dataset
baja de 22 casos, la puerta falla aunque todo lo demás pase.

## Alcance honesto: qué NO cubre esta evaluación

- No cubre consultas en vivo (Wikipedia real, OpenAI, ElevenLabs): esas
  necesitan clave y sesión y se verifican aparte, nunca con fixtures.
- Los casos de tarea evalúan la descomposición determinista y el contrato
  de instrucciones; no demuestran que un modelo externo haya completado
  tareas en vivo ni miden su precisión o costo.
- No cubre la ruta Ask con DB ni el panel de memoria en el navegador:
  esos se verifican con build/dev local y sesión (ver "Pendiente" abajo).
- No cubre `tests/rendered-html.test.mjs`: solo después de `npm run build`.

## CI automático: cambio manual pendiente (NO aplicado aquí)

`.github/workflows/ci.yml` **no se modificó en esta entrega**: la app de
GitHub no tiene permiso de workflows y el push devuelve 403. Para
activar la puerta en CI, el usuario debe añadir este paso en el job
`test`, después del paso "Unit and security tests" (antes de "Build
verified artifact"):

```yaml
      - name: Quality gate (continuous evaluation)
        run: node --experimental-strip-types scripts/iris-quality-gate.mjs
```

No requiere secretos ni red: corre con el checkout y Node 22 que el
job ya instala. Hasta que ese paso exista, la puerta se corre a mano
con el comando de arriba y su salida se pega en el PR.

## Pendiente de verificación en vivo (no bloquea el PR, sí el merge)

- Panel de memoria en el dashboard con sesión real (listar, consentir,
  revocar, borrar, exportar) — verificado solo por lectura de código y
  por la API ya existente, no con build/dev (sin `node_modules` aquí).
- Ask IRIS razonado SOC con sesión y DB reales.
- Lint (`npm run lint`) y build: sin `node_modules` en este entorno.
- CI del PR: debe confirmar antes de cualquier merge.
