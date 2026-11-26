#!/usr/bin/env bash
# Stop hook de IRIS: si hubo cambios en código, corre los tests (sin rendered-html)
# antes de dejar que Claude dé la tarea por terminada. Si fallan, sale con 2 para
# que Claude siga y los arregle. stop_hook_active evita bucles infinitos.

input="$(cat)"
if printf '%s' "$input" | grep -Eq '"stop_hook_active"[[:space:]]*:[[:space:]]*true'; then
  exit 0
fi

cd "${CLAUDE_PROJECT_DIR:-.}" || exit 0

# Solo si hay cambios en código o tests.
if ! git status --porcelain -- lib app worker tests scripts 2>/dev/null | grep -q .; then
  exit 0
fi

# Sin dependencias instaladas no se puede probar; no bloquear.
[ -d node_modules ] || exit 0

mapfile -t files < <(find tests -name '*.mjs' ! -name 'rendered-html.test.mjs' | sort)
if ! out="$(node --experimental-strip-types --test "${files[@]}" 2>&1)"; then
  {
    echo "Hay tests fallando; arréglalos (o explica por qué) antes de terminar:"
    printf '%s\n' "$out" | grep -E '^not ok|# (fail|pass)|Error|expected|actual' | head -40
  } >&2
  exit 2
fi
exit 0
