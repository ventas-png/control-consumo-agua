#!/usr/bin/env bash
# ============================================================================
# PURGA DE EMPRESA ATÓMICA — `purgar_empresa` (edge delete-company) contra un
# PostgreSQL REAL (local, efímero). NO toca ningún entorno remoto.
#
# Aplica la cadena ENTERA de migraciones sobre una base vacía y prueba
# 20261027000000_purgar_empresa_atomica:
#   1. andamiaje + migraciones anteriores (plantilla «antes»);
#   2. la migración, dos veces (idempotencia);
#   3. FORMA DEL REPOSITORIO: compuertas, todo-o-nada con fallos inyectados en
#      cada punto (DELETE final, después de la empresa, auditoría, UPDATE del
#      superadministrador), un bloqueo real (bitácora inmutable), el ensayo y
#      la purga completa (assert.sql); y el área con tareas, que en esta forma
#      no se puede purgar y tiene que fallar ENTERA (assert_areas.sql);
#   4. FORMA DE PRODUCCIÓN (forma_produccion.sql, medida el 2026-10-12): la
#      misma suite, y el área con tareas, que aquí SÍ se purga;
#   5. CONTROL NEGATIVO POR MUTANTES: quita de la migración, uno por uno, cada
#      bloque marcado `[compuerta:…]` / `[paso:…]` y exige que la suite FALLE.
#      Si alguno pasara, la suite no estaría probando ese bloque.
#
# Uso:  bash supabase/tests/purgar_empresa/run.sh
# ============================================================================
set -euo pipefail

AQUI="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RAIZ="$(cd "$AQUI/../../.." && pwd)"
MIGS="$RAIZ/supabase/migrations"
NUESTRA=20261027000000_purgar_empresa_atomica
MIG="$MIGS/$NUESTRA.sql"

for d in /usr/lib/postgresql/*/bin; do [ -d "$d" ] && PATH="$d:$PATH"; done
export PATH
command -v initdb >/dev/null || { echo "❌ falta initdb (instalá PostgreSQL)"; exit 1; }

# Shims de pg_net/pg_cron: fuera de Supabase no existen y varias migraciones hacen CREATE EXTENSION.
EXT="$(pg_config --sharedir 2>/dev/null || echo /usr/share/postgresql/$(basename "$(dirname "$(command -v initdb)")"))/extension"
for ext in pg_net pg_cron; do
  [ -f "$EXT/$ext.control" ] && continue
  CTL="comment = 'shim vacío del arnés'"$'\n'"default_version = '1.0'"$'\n'"relocatable = true"
  if [ -w "$EXT" ]; then
    printf '%s\n' "$CTL" > "$EXT/$ext.control"; echo 'SELECT 1;' > "$EXT/$ext--1.0.sql"
  else
    printf '%s\n' "$CTL" | sudo -n tee "$EXT/$ext.control" >/dev/null
    echo 'SELECT 1;' | sudo -n tee "$EXT/$ext--1.0.sql" >/dev/null
  fi
done

DATA=$(mktemp -d /tmp/purgadata.XXXX)
SOCK=$(mktemp -d /tmp/purgasock.XXXX)
MUT=$(mktemp -d /tmp/purgamut.XXXX)
chmod 755 "$MUT"
PUERTO=${PGPORT_TEST:-55561}

COMO=""
if [ "$(id -u)" = "0" ]; then
  id postgres >/dev/null 2>&1 || useradd -m postgres
  COMO="su postgres -c"
fi
correr() { if [ -n "$COMO" ]; then su postgres -c "PATH=$PATH $*"; else eval "$*"; fi; }

limpiar() {
  correr "pg_ctl -D $DATA stop -m immediate" >/dev/null 2>&1 || true
  rm -rf "$DATA" "$SOCK" "$MUT"
}
trap limpiar EXIT
if [ -n "$COMO" ]; then chown -R postgres "$DATA" "$SOCK"; fi

correr "initdb -D $DATA -U postgres --auth=trust" >/dev/null
correr "pg_ctl -D $DATA -o '-p $PUERTO -k $SOCK' -l $DATA/pg.log start" >/dev/null
sleep 2

export PGHOST="$SOCK" PGPORT="$PUERTO" PGUSER=postgres

aplicar() {
  PGOPTIONS="-c client_min_messages=warning" psql -q -v ON_ERROR_STOP=1 -d "$2" -f "$1" >/dev/null
}
nueva_bd() { PGOPTIONS="-c client_min_messages=warning" psql -q -d postgres -c "DROP DATABASE IF EXISTS $1" -c "CREATE DATABASE $1 TEMPLATE $2" >/dev/null; }

# Corre los helpers + una suite en UNA sesión (los helpers viven en pg_temp).
suite() {   # suite BD ARCHIVO [psql args…]
  local bd="$1" archivo="$2"; shift 2
  cat "$AQUI/helpers.sql" "$AQUI/$archivo" | psql -q -v ON_ERROR_STOP=1 "$@" -d "$bd" 2>&1
}
bloque() {  # bloque BD ARCHIVO ETIQUETA [psql args…]
  local bd="$1" archivo="$2" etiqueta="$3" salida; shift 3
  echo "── $etiqueta"
  salida=$(suite "$bd" "$archivo" "$@") || {
    echo "$salida" | sed -n 's/.*NOTICE:  /  /p' | tail -5
    echo "❌ invariante incumplida en $archivo:"
    echo "$salida" | grep -E 'ERROR|DETAIL|CONTEXT' | head -6
    exit 1
  }
  echo "  $(echo "$salida" | grep -c '✓') comprobaciones ✓"
}

echo "── 1/5 · andamiaje de plataforma y migraciones ANTERIORES, en orden"
psql -q -d postgres -c "CREATE DATABASE antes" >/dev/null
aplicar "$RAIZ/scripts/schema-drift/bootstrap.sql" antes
N=0
for f in "$MIGS"/*.sql; do
  base="$(basename "$f" .sql)"
  [[ "$base" < "$NUESTRA" ]] || continue
  aplicar "$f" antes
  N=$((N + 1))
done
echo "   $N migraciones aplicadas sobre una base vacía"

echo "── 2/5 · la migración, dos veces (la segunda debe ser limpia)"
nueva_bd plantilla antes
aplicar "$MIG" plantilla
aplicar "$MIG" plantilla && echo "   ✓ segunda pasada limpia"
for f in "$MIGS"/*.sql; do   # y las posteriores, si las hay
  base="$(basename "$f" .sql)"
  [[ "$base" > "$NUESTRA" ]] && aplicar "$f" plantilla
done

echo "── 3/5 · forma de llaves del REPOSITORIO"
nueva_bd repo plantilla
aplicar "$AQUI/fixture.sql" repo
nueva_bd repo_areas repo
bloque repo_areas assert_areas.sql "3a · área con tareas: falla ENTERA (drift #826)" -v forma=repositorio
bloque repo assert.sql "3b · compuertas, todo o nada, ensayo y purga completa"

echo "── 4/5 · forma de llaves de PRODUCCIÓN"
nueva_bd prod plantilla
aplicar "$AQUI/forma_produccion.sql" prod
aplicar "$AQUI/fixture.sql" prod
nueva_bd prod_areas prod
bloque prod_areas assert_areas.sql "4a · área con tareas: se purga" -v forma=produccion
bloque prod assert.sql "4b · compuertas, todo o nada, ensayo y purga completa"

echo "── 5/5 · CONTROL NEGATIVO: sin cada bloque de la migración, la suite DEBE fallar"
MARCAS=$(grep -oE '\-\- \[(compuerta|paso):[a-z_]+\]' "$MIG" | sed -E 's/^-- \[(.*)\]$/\1/')
[ -n "$MARCAS" ] || { echo "❌ la migración no tiene bloques marcados"; exit 1; }
for marca in $MARCAS; do
  mutante="$MUT/${marca/:/_}.sql"
  # Borra desde «-- [marca]» hasta «-- [/marca]», ambos incluidos.
  awk -v ini="-- [$marca]" -v fin="-- [/$marca]" '
    index($0, ini) { dentro = 1 }
    !dentro { print }
    index($0, fin) { dentro = 0 }' "$MIG" > "$mutante"
  if cmp -s "$mutante" "$MIG"; then echo "❌ $marca: el mutante es idéntico a la migración"; exit 1; fi
  nueva_bd mutante antes
  aplicar "$mutante" mutante
  aplicar "$AQUI/fixture.sql" mutante
  if salida=$(suite mutante assert.sql); then
    echo "❌ $marca: la suite PASÓ sin ese bloque, así que no lo prueba."; exit 1
  fi
  echo "  ✓ sin [$marca] la suite falla: $(echo "$salida" | grep -E 'ERROR' | head -1 | sed 's/.*ERROR:  //' | cut -c1-100)"
done

echo "✅ purgar_empresa: todo o nada, en las dos formas de llaves, y cada bloque probado"
