@AGENTS.md

# Claude Code en IRIS

Las reglas de `AGENTS.md` (arriba) mandan. Esto añade cómo trabaja Claude Code aquí.

## Equipo de agentes (`.claude/agents/`)
- **iris-explorer**: lee y explica el código (coordinador, Guardian, Memory, misiones). Úsalo antes de cambios grandes para no llenar la sesión principal.
- **guardian-auditor**: revisión de seguridad. Obligatorio tras tocar `lib/authz.ts`, `lib/iris-guardian.ts`, `lib/iris-tool-acl.ts`, `lib/iris-secret-hygiene.ts`, `lib/passkeys.ts`, `lib/passwords.ts`, `lib/rate-limit.ts`, `lib/iris-org-keys.ts`, `lib/iris-tenant*.ts`, `app/api/**` o cualquier cosa de wallet/token.
- **test-runner**: corre la suite y lint, y diagnostica fallos.
- **docs-researcher**: documentación oficial (Cloudflare Workers/D1, Next/vinext, Drizzle, SimpleWebAuthn, OpenZeppelin, MetaMask).

## Skills (`.claude/skills/`)
- `/iris-invariants`: verifica que las garantías de seguridad de IRIS siguen intactas.
- `/iris-ship-check`: checklist antes de abrir un PR (tests, lint, invariantes, secretos, copy en español).

## Flujo
plan → explorar (iris-explorer) → trabajar → test-runner → guardian-auditor si aplica → `/iris-ship-check` → PR.
Trabaja siempre en una rama; nunca hagas push a `main` ni despliegues (los hooks lo bloquean).

## Asesor
Con Opus como modelo principal, `/advisor fable` añade a Fable como asesor en los momentos de decisión.
