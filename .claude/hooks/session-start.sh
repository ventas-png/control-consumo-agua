#!/bin/bash
# SessionStart hook: instala las dependencias npm al arrancar una sesión de
# Claude Code en la web, para que type-check, lint y tests funcionen desde el
# primer momento (un contenedor recién clonado no trae node_modules y tsc
# reporta miles de errores falsos sin las definiciones de tipos).
set -euo pipefail

# Solo aplica a sesiones remotas (Claude Code on the web); no toca entornos locales.
if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

cd "$CLAUDE_PROJECT_DIR"

# Idempotente: si el contenedor cacheado ya tiene node_modules poblado, no reinstalar.
if [ -d node_modules ] && [ -n "$(ls -A node_modules 2>/dev/null)" ]; then
  echo "session-start: node_modules ya presente, se omite la instalación."
  exit 0
fi

echo "session-start: instalando dependencias npm..."
npm install --no-audit --no-fund
echo "session-start: dependencias instaladas."
