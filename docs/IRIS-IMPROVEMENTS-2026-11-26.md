# IRIS — Mejoras del 2026-11-26 (step-up en el servidor)

Rama: `iris/step-up-servidor-2026-11-26`, sobre `main` en `c2828d6` (#44).

## Hallazgo principal (P0)

La verificación con passkey o contraseña de IRIS solo bloqueaba la
**página** del dashboard. Las rutas `/api/*` aceptaban cualquier petición
con la identidad de ChatGPT, así que quien tuviera esa sesión (un
navegador desbloqueado, una cookie robada) podía leer el SOC, aprobar
compras, sellar bloques de IRIS Chain o usar Ask IRIS sin pasar por la
passkey. Además:

- **Inscripción de factores sin verificar el existente**: con una passkey
  ya inscrita, `/api/passkeys/register/*` dejaba inscribir otra (la del
  atacante) y emitía una sesión verificada. Con passkey y sin contraseña,
  `/api/password/setup` hacía lo mismo.
- **Administración**: `/admin/users` y su acción de cambiar roles no
  pedían la verificación.
- **Usuarios suspendidos** podían seguir verificando contraseña/passkey.

## Qué cambia

- `lib/iris-step-up-core.ts` (puro, con tests) define la regla:
  sin factor inscrito no hay step-up; con factor, hace falta una sesión
  verificada; `IRIS_DEV_SKIP_STEPUP=1` solo fuera de producción.
- `lib/iris-step-up.ts`: `requireStepUp(email)` devuelve 403 con
  `code: "step_up_required"`; `requireFactorEnrollment(email)` exige
  verificar el factor existente antes de añadir otro.
- Las 19 rutas `/api/*` que usan la identidad de ChatGPT llaman a
  `requireStepUp` justo después del control de estado (33 handlers).
  Las rutas de factores y `agent/check-in` (token del Mac) quedan fuera.
- Dashboard, `/admin/users` y la acción de cambiar roles usan la misma
  regla.
- `agent-orchestration/status`: `findIrisUser(...) ?? provisionIrisUser`
  sin `await` nunca creaba al usuario (la promesa nunca es `null`).

## Pruebas

- `tests/iris-step-up.test.mjs`: la regla, el bloqueo de inscripción y un
  test que recorre `app/api` y falla si una ruta nueva con identidad de
  ChatGPT no exige step-up.
- Suite completa: 203 pass / 0 fail.
- **No ejecutado aquí**: `npm ci`, `npm run lint`, `npm run build` ni el
  arranque local (este entorno no tiene red para instalar dependencias).
  Deben pasar en CI y en local antes de fusionar.

## Comportamiento esperado

- Local (`npm run dev:local`): sin cambios, el step-up sigue omitido.
- Producción: tras 12 h la sesión verificada caduca; las llamadas a la API
  devuelven 403 `step_up_required` y al recargar aparece la pantalla de
  verificación.

---

# Estabilidad del núcleo y la memoria (segunda tanda)

## Hallazgos

- **CAS que pisaba escrituras (P0)**: `saveOrgDeskValue` reintentaba un
  conflicto releyendo solo `updatedAt` y escribiendo el mismo valor antiguo.
  Dos escrituras a la vez sobre la memoria, Creator o Misiones hacían que la
  segunda borrara la primera. Ejemplo real: aprobar una lección mientras una
  misión guarda su resultado → la aprobación humana se perdía. Igual con el
  latido de Creator (`GET`) frente a una aprobación de agente.
- **El tope de 200 registros borraba lecciones aprobadas**: la memoria es
  append-only, pero al llegar a 200 se descartaban los más antiguos sin
  mirar si eran lecciones activas.
- **Se podía añadir una lección ya aprobada**: `appendMemory` aceptaba
  `promotion: "approved"`, saltándose la aprobación humana.
- **Memoria corrupta**: un registro guardado con `tags` que no es lista
  rompía `searchMemory` (y con ello Ask IRIS); ids duplicados se aprobaban
  a la vez.
- **ABA en el sello CAS**: dos escrituras en el mismo milisegundo
  compartían `updatedAt`.

## Qué cambia

- `lib/iris-cas-core.ts` (puro, con tests): `runCasMutation` vuelve a leer
  y a aplicar la mutación en cada reintento; `nextCasTimestamp` garantiza
  un sello estrictamente posterior.
- `saveOrgDeskValue` ya no reintenta: ante un conflicto lanza
  `concurrent_update`. Nuevo `mutateOrgDeskValue` para escrituras que se
  pueden volver a aplicar.
- Memoria: evaluaciones, aprobar/rechazar lecciones y resultados de misión
  usan `mutateOrgDeskValue`.
- Creator `GET`: si el latido choca con otra escritura, no la pisa;
  devuelve el estado guardado y lo vuelve a intentar en la próxima apertura.
- Creator, Misiones y Evals devuelven **409** con mensaje en español ante
  un conflicto, en vez de 400 o de pisar.
- `lib/iris-memory.ts`: el tope nunca borra lecciones aprobadas (y protege
  las 50 pendientes más recientes); nada entra ya aprobado; ids duplicados
  rechazados; al leer se normalizan `tags`, se quitan duplicados y una
  lección "aprobada" sin humano vuelve a pendiente.
- Núcleo: sin cambios de comportamiento. `memoryAllowsSelfModify()` sigue
  en `false`, y al leer misiones `appliedToRepo`/`selfModifiedCore` se
  siguen forzando a `false`.

## Pruebas

- `tests/iris-memory-stability.test.mjs` (14 tests), incluido un caso que
  simula la aprobación humana concurrente y comprueba que sobrevive.
- Suite completa: 217 pass / 0 fail.
