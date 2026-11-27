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
