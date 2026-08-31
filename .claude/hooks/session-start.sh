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

# Idempotente, pero SOLO si lo instalado coincide con el lockfile.
#
# Antes bastaba con que node_modules existiera y no estuviera vacío. Un contenedor
# cacheado con árbol viejo pasaba ese filtro y la sesión corría con dependencias
# desactualizadas: el 2026-08-31 sirvió DOMPurify 3.4.12 —dentro del rango
# vulnerable de GHSA-55q2-fjhq-7xh7— mientras package.json y el lockfile pedían
# 3.4.14, y el guard de regresión de validation.test.ts dio rojo contra un `main`
# que estaba sano. Un hook que sirve dependencias vulnerables en silencio y hace
# mentir a los tests es peor que uno que reinstala de más.
#
# npm escribe node_modules/.package-lock.json al instalar: si difiere del
# package-lock.json del repo, el árbol no corresponde y hay que reinstalar.
ARBOL_LOCK="node_modules/.package-lock.json"
if [ -d node_modules ] && [ -n "$(ls -A node_modules 2>/dev/null)" ] \
   && [ -f "$ARBOL_LOCK" ] && [ ! package-lock.json -nt "$ARBOL_LOCK" ]; then
  echo "session-start: node_modules coincide con el lockfile, se omite la instalación."
  exit 0
fi

# `npm ci` (no `npm install`): instala EXACTAMENTE el lockfile y no lo reescribe,
# que es lo que hace CI. Si el árbol quedó a medias, se parte de cero.
echo "session-start: instalando dependencias npm (npm ci)..."
npm ci --no-audit --no-fund
echo "session-start: dependencias instaladas."
