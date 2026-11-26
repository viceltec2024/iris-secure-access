---
name: iris-invariants
description: Verifica que las garantías de seguridad de IRIS siguen intactas (sin auto-modificación, sin auto-aplicar, aprobación humana, herramientas bloqueadas). Úsalo tras cambios en coordinador, Creator, Memory, Guardian, misiones, sandbox o runtime de agentes.
---
# Invariantes de IRIS

Comprueba cada punto con `grep` y lectura de código. Si alguno falla, **para** y avisa al usuario antes de seguir.

1. **Sin auto-modificación**
   - `memoryAllowsSelfModify()` en `lib/iris-memory.ts` devuelve `false` literal, sin condiciones.
   - Todas las apariciones de `appliedToRepo` y `selfModifiedCore` (`grep -rn "appliedToRepo\|selfModifiedCore" lib app`) son `false` literal o tipos `false`.
2. **Aprobación humana**
   - En `lib/iris-coordinator.ts`, `mission` y `creator` siguen exigiendo puerta humana.
   - Las lecciones de Memory pasan de `pending` a `approved` solo con un actor humano verificado.
   - `simulatedApproval` en `lib/iris-sandbox-runner.ts` nunca se guarda ni se usa como aprobación real.
3. **Herramientas bloqueadas** en `lib/iris-tool-acl.ts`: `exec_shell`, `filesystem_write`, `git_push`, `deploy_production`, `spend_money`, `self_modify_core`, `exfiltrate_secrets`, `network_unrestricted`, `deploy_without_approval`. La allowlist sigue en 9 herramientas, o el cambio está justificado y revisado.
4. **Honestidad de estado**
   - Los proveedores solo son `liveVerified` tras una sonda HTTP real.
   - Un Mac con `lastSeenAt` de más de 5 min es OFFLINE.
   - No reaparecen los incidentes demo `IR-1039` / `IR-1042`.
5. **Tests que lo cubren**: corre
   ```bash
   node --experimental-strip-types --test tests/iris-security-suite.test.mjs tests/iris-evals.test.mjs tests/iris-memory.test.mjs tests/iris-mission.test.mjs tests/iris-creator.test.mjs tests/iris-coordinator.test.mjs tests/iris-agent-runtime.test.mjs
   ```

## Informe
Una tabla con cada invariante (OK / ROTA) y archivo:línea como evidencia. Si alguna está ROTA, propón la corrección pero no la apliques sin confirmación.
