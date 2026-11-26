---
name: iris-ship-check
description: Checklist antes de abrir un PR en IRIS — tests, lint, invariantes, secretos, copy en español y revisión de seguridad. Úsalo cuando un cambio esté listo para revisión.
---
# Checklist antes del PR

1. **Rama**: no estás en `main`. Si lo estás, crea una rama (`git switch -c <tipo>/<tema>`).
2. **Tests y lint**: delega en `test-runner`. Todo en verde y lint con 0 errores.
3. **Invariantes**: si el diff toca coordinador, Creator, Memory, Guardian, misiones, sandbox o runtime de agentes, ejecuta `/iris-invariants`.
4. **Seguridad**: si el diff toca auth, tenants, `app/api/**`, wallet o token, delega en `guardian-auditor`. Sin hallazgos Críticos ni Altos.
5. **Secretos**: el mismo escaneo que CI:
   ```bash
   git grep -nE 'sk-[a-zA-Z0-9]{20,}|sk_[a-zA-Z0-9]{20,}|OPENAI_API_KEY\s*=\s*["'\''][^"'\'']+|ELEVENLABS_API_KEY\s*=\s*["'\''][^"'\'']+|MODEL_API_KEY\s*=\s*["'\''][^"'\'']+' -- ':!.env.example' ':!package-lock.json'
   ```
   No debe devolver nada.
6. **Producto**: el texto visible para el usuario está en español; Ask IRIS sigue respondiendo por escrito; no se afirma que un proveedor está "live" sin prueba.
7. **PR**: título corto, y en la descripción: qué cambió, por qué, cómo se probó y qué invariantes se revisaron. Nunca hagas merge ni despliegues: eso lo decide el dueño.
