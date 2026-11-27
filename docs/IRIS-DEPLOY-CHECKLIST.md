# Lista de comprobación para desplegar IRIS

Desplegar sigue siendo una decisión del propietario: nada de esto se hace
de forma automática.

## 1. Antes de desplegar

- [ ] Fusionados los PR de seguridad pendientes (Guardian, inscripción,
      auditoría, cabeceras de identidad, IRIS Chain).
- [ ] `npm ci && npm run lint` → 0 errores.
- [ ] `npm run build` y `npm test` en verde.
- [ ] `node --experimental-strip-types --test tests/*.mjs` en verde.
- [ ] En local, el dashboard inicia sesión y Ask IRIS responde por escrito
      a una pregunta.

## 2. Variables de entorno en producción (ChatGPT Sites)

- [ ] `IRIS_OWNER_EMAIL` = tu correo de ChatGPT. **Debe estar antes del
      primer acceso**: ese usuario se crea como ADMIN. Sin ella, nadie es
      administrador.
- [ ] `IRIS_DEV_SKIP_STEPUP` **sin definir** y `IRIS_DEV_EMAIL` sin definir.
- [ ] `NODE_ENV=production`.
- [ ] `IRIS_TRUSTED_HOSTS` solo si usas un dominio distinto de
      `iris-secure-access.taylor-667.chatgpt.site` (lista separada por comas).
- [ ] Claves de proveedores (`OPENAI_API_KEY`, `MODEL_API_KEY`,
      `ELEVENLABS_API_KEY`) solo si vas a usar esas integraciones.
- [ ] `IRIS_BILLING_LIVE` sin definir o `0`.

## 3. Comprobaciones después de desplegar

- [ ] `GET /dev/sign-in` devuelve **404**.
- [ ] Una petición a la URL directa del Worker (p. ej. `*.workers.dev`) con
      la cabecera `oai-authenticated-user-email` falsa devuelve **401**
      en `/api/security-state`. Mejor aún: desactiva la ruta
      `workers.dev` del Worker si Sites no la necesita.
- [ ] Tu usuario aparece como ADMIN en `/admin/users`.
- [ ] Con una passkey o contraseña inscrita, en una ventana nueva (sin la
      cookie `iris_biometric_session`) `GET /api/security-state` devuelve
      **403** con `code: "step_up_required"`, y tras verificar devuelve 200.
- [ ] `GET /api/iris-providers/status?probe=1` muestra `liveVerified` para
      cada proveedor que anuncies. Una clave configurada no es una
      integración probada.
- [ ] IRIS Chain: enviar una transacción y sellar un bloque funciona.
- [ ] Inscribir un Mac de prueba con un código nuevo y ver que pasa a
      ONLINE.

## 4. Dinero real (Base mainnet)

- [ ] Probar antes en una testnet el escritorio de compras y el registro
      del contrato del token.
- [ ] Ningún flujo de pago real activo sin autorización expresa.
