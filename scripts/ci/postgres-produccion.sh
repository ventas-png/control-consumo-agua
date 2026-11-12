#!/usr/bin/env bash
# ════════════════════════════════════════════════════════════════════════════
# Deja al runner de CI con UNA sola versión mayor de PostgreSQL: la de producción.
# ════════════════════════════════════════════════════════════════════════════
#
# POR QUÉ
# Los sandboxes (supabase/tests/*/run.sh, scripts/rls-*-sandbox.sh) y el
# reconstructor del auditor de drift (scripts/schema-drift/reconstruir.mjs)
# eligen «el Postgres más nuevo instalado»: recorren /usr/lib/postgresql/*/bin
# o preguntan a pg_config, que apunta a la versión más alta. Eso hacía que la
# versión bajo prueba fuera la que trajera la imagen del runner ese día: cuando
# ubuntu-latest pasó a PostgreSQL 18, un FK ON DELETE RESTRICT empezó a
# reportar 23001 en vez de 23503 y los NOT NULL a guardarse en pg_constraint, y
# CI se puso en rojo sin que cambiara nada del repositorio. Producción
# (Supabase) corre 17.x y hoy sólo ofrece 17.11 como actualización.
#
# QUÉ HACE
#   1. Instala postgresql-<mayor> si no está (del repositorio oficial PGDG, el
#      mismo del que salen los paquetes de la imagen del runner; si la imagen no
#      lo trae configurado, lo agrega).
#   2. Retira CUALQUIER otra versión mayor instalada (paquetes, configuración
#      de clúster y directorio de binarios),
#      para que ninguna heurística de «la más nueva» elija otra cosa.
#   3. Imprime la ruta de binarios y, bajo GitHub Actions, la publica como
#      salida `bin` del paso (los jobs la pasan como PGBIN a los sandboxes).
#
# USO:  scripts/ci/postgres-produccion.sh [mayor]     # defecto: $PG_MAJOR o 17
# Pensado para el runner (instala y desinstala paquetes del sistema con sudo);
# en una máquina de desarrollo úsese a sabiendas.
# ════════════════════════════════════════════════════════════════════════════
set -euo pipefail

MAYOR="${1:-${PG_MAJOR:-17}}"
case "$MAYOR" in
  ''|*[!0-9]*) echo "✗ versión mayor inválida: '$MAYOR' (se espera un entero, p. ej. 17)" >&2; exit 2 ;;
esac

SUDO=""
[ "$(id -u)" = "0" ] || SUDO="sudo"
export DEBIAN_FRONTEND=noninteractive

actualizar_indices() {
  # Un repositorio ajeno caído no debe tumbar el paso: la señal real es el install.
  $SUDO apt-get update -qq || echo "· apt-get update terminó con avisos; se intenta instalar igual"
}

instalar() {
  actualizar_indices
  if ! $SUDO apt-get install -y -qq "postgresql-$MAYOR" >/dev/null; then
    echo "· postgresql-$MAYOR no está en los repositorios configurados: se agrega PGDG"
    $SUDO install -d /usr/share/postgresql-common/pgdg
    $SUDO curl -fsSL -o /usr/share/postgresql-common/pgdg/apt.postgresql.org.asc \
      https://www.postgresql.org/media/keys/ACCC4CF8.asc
    CODENAME="$(. /etc/os-release && echo "${VERSION_CODENAME:-}")"
    echo "deb [signed-by=/usr/share/postgresql-common/pgdg/apt.postgresql.org.asc] https://apt.postgresql.org/pub/repos/apt ${CODENAME}-pgdg main" \
      | $SUDO tee /etc/apt/sources.list.d/pgdg.list >/dev/null
    actualizar_indices
    $SUDO apt-get install -y -qq "postgresql-$MAYOR" >/dev/null
  fi
}

BIN="/usr/lib/postgresql/$MAYOR/bin"
if [ -x "$BIN/initdb" ]; then
  echo "· PostgreSQL $MAYOR ya está instalado"
else
  echo "· instalando PostgreSQL $MAYOR"
  instalar
fi
[ -x "$BIN/initdb" ] || { echo "✗ no quedó initdb en $BIN" >&2; exit 1; }

# Otras versiones mayores: fuera. Los sandboxes hacen
#   for d in /usr/lib/postgresql/*/bin; do PATH="$d:$PATH"; done
# (gana la última del glob, es decir la más alta) y pg_config elige la más alta.
for d in /usr/lib/postgresql/*/; do
  v="$(basename "$d")"
  [ "$v" = "$MAYOR" ] && continue
  echo "· retirando PostgreSQL $v para que no compita con $MAYOR"
  $SUDO apt-get purge -y -qq "postgresql-$v" "postgresql-client-$v" >/dev/null 2>&1 || true
  $SUDO rm -rf "/usr/lib/postgresql/$v"
done

"$BIN/initdb" --version
if [ -n "${GITHUB_OUTPUT:-}" ]; then
  echo "bin=$BIN" >> "$GITHUB_OUTPUT"
fi
echo "$BIN"
