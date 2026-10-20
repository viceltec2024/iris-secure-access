# Validación técnica Fase B empresarial — 2026-10-19

**Repo:** `viceltec2024/iris-secure-access`  
**Alcance:** validación + endurecimiento Fase B (SaaS multi-empresa).  
**No autorizado:** deploy a producción, cobros reales (`chargeEnabled` permanece `false`), merge irreversible sin OK del owner.

---

## 1. Funciones empresariales que ya operan

| Función | Estado | Evidencia |
|---------|--------|-----------|
| Crear / cambiar organización | OK | `POST /api/iris-orgs` `create` / `switch` + panel |
| Invitaciones de empleados | OK | tokens `iris_inv_*`, hash SHA-256, TTL 7 días, aceptar/revocar |
| Roles OWNER / ADMIN / OPERATOR / VIEWER | OK | `iris-tenant-core` + gates admin/mutate |
| Claves API org (generar / listar / revocar) | OK | `iris_ak_*`, secreto una vez, solo hash en D1 |
| Aislamiento entre organizaciones | OK | desk keys `iris_*:org:{id}` + membership server-side |
| Facturación modo prueba | OK | `IRIS_BILLING_TEST=1`; live/`sk_live_` bloqueados |
| Límites de consumo por plan | OK | `evaluatePlanLimits` + presupuesto mensual |
| Auditoría por organización | OK | `listOrgAuditEvents` en vista admin |
| Prevención de auto-elevación de privilegios | OK | `assertRoleChangeAllowed` |
| Higiene de secretos (respuestas / export) | OK | `assertNoSecretsInPayload` + patrones `iris_ak_` / `iris_inv_` |

---

## 2. Pruebas ejecutadas y resultados

| Suite | Resultado |
|-------|-----------|
| `tests/iris-phase-b.test.mjs` (6) | pass |
| `tests/iris-phase-b-integration.test.mjs` (7) | pass |
| Unitarios `tests/*.mjs` (sin `rendered-html`) | pass (154+) |
| `npm run lint` | 0 errors (1 warning preexistente `no-img-element`) |
| Migraciones locales D1 | schema up to date (13 migraciones) |
| `npm run build` + `rendered-html` | ejecutar en CI/PR validation |

---

## 3. Vulnerabilidades y errores encontrados

1. **Auto-elevación de rol** — `updateOrgMemberRole` no bloqueaba explícitamente que un ADMIN se promocione a OWNER (ya fallaba por regla OWNER-only, pero faltaba gate genérico de self-elevation / rank).
2. **Secretos org en heurística de higiene** — `containsPossibleSecret` no detectaba tokens `iris_ak_*` / `iris_inv_*` completos.
3. **Formas públicas** — list/export no afirmaban estructuralmente la ausencia de `keyHash` / `tokenHash`.
4. **Auditoría org en UI** — eventos existían en D1 pero el panel admin no los listaba por organización.

Ningún cobro real ni fuga de `OPENAI_API_KEY` / `MODEL_API_KEY` / `ELEVENLABS_API_KEY` en código de rutas Phase B.

---

## 4. Correcciones implementadas

- `assertRoleChangeAllowed` + uso en `updateOrgMemberRole` / `addOrgMember`
- Validación estricta de formato de invitaciones / API keys
- Redacción de tokens org en secret hygiene
- `assertPublicOrgSecretShape` en listados públicos
- `listOrgAuditEvents` + sección de auditoría en `iris-org-panel`
- Suite de integración Phase B (`tests/iris-phase-b-integration.test.mjs`)

---

## 5. Funciones que todavía faltan (fases posteriores)

| Ítem | Fase sugerida |
|------|----------------|
| Email delivery de invitaciones (hoy: token en UI) | C |
| Stripe live / cobros reales (requiere OK expresa) | Comercial |
| Runtime durable de agentes por tenant (cola + worker) | C |
| R2 / almacenamiento de archivos por empresa | C |
| Observabilidad externa (Sentry, etc.) | C |
| SSO / SAML empresarial | D |
| Panel de costos por proveedor de modelo (breakdown OpenAI/Muse/ElevenLabs) | C |
| Restore drill D1 en staging Cloudflare | Staging |
| Deploy staging/prod | Solo con autorización del owner |

Ya cubierto en Fase B (no re-implementar): Guardian + aprobación humana de misiones/creator, coordinador multi-modelo, límites de plan, billing test.

---

## 6. Estado de las integraciones de IA

| Proveedor | Código | Clave en este entorno | Live proof |
|-----------|--------|------------------------|------------|
| IRIS local mind | Live | N/A | Sí |
| OpenAI | Listo | No forzar / no exponer | Requiere `OPENAI_API_KEY` + `probe_providers` |
| Meta Muse | Listo | No forzar / no exponer | Requiere `MODEL_API_KEY` |
| ElevenLabs TTS | Listo | No forzar / no exponer | Requiere `ELEVENLABS_API_KEY` |

Regla: **clave configurada ≠ integración live**. Usar `POST /api/iris-coordinator` `{ "action": "probe_providers" }`.

---

## 7. Nivel de preparación para clientes empresariales

**Score estimado: ~70% plataforma SaaS / ~60% producto AI end-to-end.**

- **Listo para demos / early design partners** en modo test billing, con aislamiento org, roles, invites, API keys hasheadas y límites.
- **No listo para cobro productivo** ni para deploy público multi-tenant sin staging, email de invites, y probes live de proveedores.
- Controles de seguridad Phase B: **conservados y reforzados** (sin debilitar Guardian ni cobros).

---

## 8. Próximos pasos recomendados

1. Revisar y aprobar este PR (sin merge a producción automática).
2. Cargar claves solo en `.env.local` / secrets de staging; ejecutar `probe_providers`.
3. Fase C: email de invitaciones + breakdown de costos por modelo + worker durable por org.
4. Staging CF + restore drill D1 antes de cualquier promote.
5. Cobros reales solo con autorización expresa del owner (`IRIS_BILLING_LIVE` permanece bloqueado).
