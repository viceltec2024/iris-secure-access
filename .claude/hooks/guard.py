#!/usr/bin/env python3
"""PreToolUse hook de IRIS.

Bloquea: leer/editar secretos, push a main, despliegues y `git add -A`.
Claude Code envía la llamada como JSON por stdin; salir con código 2 la bloquea
y el texto de stderr le llega a Claude como motivo.
"""
import json
import re
import sys

SECRET_PATH = re.compile(
    r"(^|/)(\.env(\.[\w-]+)?|\.dev\.vars(\.[\w-]+)?)$|\.pem$|\.key$|(^|/)\.wrangler/",
    re.I,
)
ALLOWED_PATH = re.compile(r"\.env\.example$", re.I)

BASH_RULES = [
    (re.compile(r"\bgit\s+push\b[^|;&]*\b(main|master)\b|\bgit\s+push\b[^|;&]*(-f|--force)\b"),
     "Bloqueado: nada de push a main ni push forzado. Trabaja en una rama y abre un PR."),
    (re.compile(r"\bwrangler\s+(deploy|publish|secret|d1\s+\S+.*--remote)\b"),
     "Bloqueado: desplegar o tocar recursos remotos de Cloudflare requiere al dueño."),
    (re.compile(r"\b(vercel|netlify)\b.*\b(deploy|--prod)\b"),
     "Bloqueado: no se despliega a producción desde Claude Code."),
    (re.compile(r"\bgit\s+add\s+(-A|--all|\.)(\s|$)"),
     "Usa `git add <archivos>` explícitos para no incluir secretos por error."),
    (re.compile(r"(cat|less|more|head|tail|grep|sed|awk|cp|mv|source|\.)\s+[^|;&]*(\.env(\.local|\.production)?|\.dev\.vars)(\s|$)"),
     "Bloqueado: no se leen ni copian archivos de secretos (.env*, .dev.vars)."),
    (re.compile(r"\b(printenv|env)\b\s*$|\becho\s+\$\{?(OPENAI_API_KEY|MODEL_API_KEY|ELEVENLABS_API_KEY)"),
     "Bloqueado: no se imprimen variables de entorno con claves."),
]


def block(msg: str) -> None:
    print(msg, file=sys.stderr)
    sys.exit(2)


def main() -> None:
    try:
        data = json.load(sys.stdin)
    except (json.JSONDecodeError, ValueError):
        sys.exit(0)

    tool = data.get("tool_name", "")
    inp = data.get("tool_input") or {}

    if tool == "Bash":
        cmd = inp.get("command", "")
        # Paso de arranque documentado en AGENTS.md: crea la plantilla sin leer secretos.
        if re.fullmatch(r"\s*cp -n \.env\.example \.env\.local\s*", cmd):
            sys.exit(0)
        for pattern, msg in BASH_RULES:
            if pattern.search(cmd) and not ALLOWED_PATH.search(cmd):
                block(msg)
        sys.exit(0)

    path = inp.get("file_path") or inp.get("path") or inp.get("notebook_path") or ""
    if path and SECRET_PATH.search(path) and not ALLOWED_PATH.search(path):
        block(f"Bloqueado: {path} es un archivo de secretos. Claude no lo lee ni lo edita.")
    sys.exit(0)


if __name__ == "__main__":
    main()
