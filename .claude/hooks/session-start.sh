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
# La comprobación es una HUELLA SHA-256 del lockfile, no su fecha. Comparar
# marcas de tiempo (`package-lock.json -nt …`) da por bueno un árbol viejo en
# cuanto el reloj no coopera, y no es un caso rebuscado: `git clone` y
# `git checkout` escriben los archivos con la hora del checkout, no la del
# commit, así que un lockfile con contenido DISTINTO puede quedar con mtime
# ANTERIOR o IGUAL al del árbol instalado. Con una huella del contenido, la
# fecha deja de importar: si el lockfile cambió, se reinstala.
HUELLA="node_modules/.session-start-lock-sha256"

huella_actual () {
  sha256sum package-lock.json 2>/dev/null | cut -d" " -f1
}

if [ -d node_modules ] && [ -n "$(ls -A node_modules 2>/dev/null)" ] \
   && [ -f "$HUELLA" ] && [ "$(cat "$HUELLA" 2>/dev/null)" = "$(huella_actual)" ]; then
  echo "session-start: node_modules coincide con el lockfile (sha256), se omite la instalación."
  exit 0
fi

# `npm ci` (no `npm install`): instala EXACTAMENTE el lockfile y no lo reescribe,
# que es lo que hace CI. Si el árbol quedó a medias, se parte de cero.
echo "session-start: instalando dependencias npm (npm ci)..."
npm ci --no-audit --no-fund

# La huella se escribe DESPUÉS de que npm ci haya terminado bien: si la
# instalación falla, `set -e` corta aquí y no queda huella, así que la próxima
# sesión vuelve a intentarlo en vez de dar por bueno un árbol a medio instalar.
# El `mkdir -p` no sobra: sin él, un npm ci que por lo que sea no dejara el
# directorio haría fallar la redirección y, con `set -e`, abortaría el hook
# entero por no poder escribir un archivo accesorio.
mkdir -p node_modules
huella_actual > "$HUELLA"
echo "session-start: dependencias instaladas."
