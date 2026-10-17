# IRIS AI 1.0 — Enterprise Readiness

**Rama:** `cursor/iris-enterprise-readiness-91b7`  
**Base:** `main` (incluye PR #18 fusionado)  
**Producción / staging deploy / cobros reales / merge:** no autorizados

## Hallazgos de auditoría (post-merge #18)

1. **Modelo OpenAI incorrecto:** Ask IRIS / agent usaban `gpt-5.6-sol` (no es un model id oficial de OpenAI). Corregido a `gpt-4o` documentado, overridable con `OPENAI_MODEL`.
2. **Invites:** expiración solo al aceptar; ahora también `expireStaleInvites` al listar + policy pura.
3. **Probes:** sin timeout duro; ahora `fetchWithTimeout` (8s probe / 30s request).
4. **configured ≠ live_ok:** reforzado en router (`operationalClaim`) y catálogo oficial.
5. **Guardian:** añadido bloqueo `UNAUTHORIZED_DEPLOY`.

## Catálogo oficial (evidencia documental)

| Provider | Endpoint | Modelo default | Docs |
|----------|----------|----------------|------|
| OpenAI | `https://api.openai.com/v1/responses` | `gpt-4o` | developers.openai.com |
| Meta Muse | `https://api.meta.ai/v1` | `muse-spark-1.3` | dev.meta.ai |
| ElevenLabs | `https://api.elevenlabs.io/v1/text-to-speech/{voice_id}` | `eleven_multilingual_v2` | elevenlabs.io/docs |

## GO/NO-GO

- **Staging deploy:** NO-GO sin autorización expresa (checklist en `IRIS-1.0-STAGING.md`).
- **Producción:** NO-GO.
- **Cobros reales:** NO-GO (`chargeEnabled: false`).
