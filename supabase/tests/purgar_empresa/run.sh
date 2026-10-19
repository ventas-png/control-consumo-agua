#!/usr/bin/env bash
# ============================================================================
# PURGA DE EMPRESA — `purgar_empresa` (edge delete-company) y su política de
# retención, contra un PostgreSQL REAL (local, efímero). NO toca ningún entorno
# remoto.
#
# Aplica la cadena ENTERA de migraciones sobre una base vacía y prueba la
# ÚLTIMA definición de la purga, 20261030000000_purga_empresa_retencion_y_huerfanas
# (que sigue a 20261029000100_purgar_empresa_atomica):
#   1. andamiaje + migraciones anteriores (plantilla «antes»), y la misma base
#      deformada hasta la forma de llaves MEDIDA en producción
#      (forma_produccion.sql, 2026-10-12): «antes_prod»;
#   2. lo que la limpieza previa de la migración tiene que arreglar
#      (pre_migracion.sql) y la migración, dos veces (idempotencia), sobre las
#      DOS formas: en producción se aplica sobre la forma medida, no sobre la
#      del repositorio;
#   3. FORMA DEL REPOSITORIO: el área con tareas, que en esta forma no se
#      puede purgar y tiene que fallar ENTERA (assert_areas.sql); la política
#      —llaves, retención por categoría, cliente, purga sin restos—
#      (assert_politica.sql); compuertas, todo-o-nada con fallos inyectados,
#      ensayo y purga completa (assert.sql);
#   4. FORMA DE PRODUCCIÓN: la misma suite, y el área con tareas, que aquí SÍ
#      se purga;
#      en las dos formas, además, el catálogo RRHH en uso (assert_rrhh.sql,
#      20261031000700): empleados, actividades, programaciones y ejecuciones
#      con el orden de cascada adverso forzado;
#   5. CONTROL NEGATIVO POR MUTANTES: quita de la migración, uno por uno, cada
#      bloque marcado `[compuerta:…]` / `[paso:…]` y exige que la suite FALLE
#      (o que la migración no aplique). Si alguno pasara, la suite no estaría
#      probando ese bloque;
#   6. lo mismo con cada bloque `[paso:…]` de 20261031000700: sin él, el caso
#      del catálogo RRHH tiene que fallar.
#
# Uso:  bash supabase/tests/purgar_empresa/run.sh
# ============================================================================
set -euo pipefail

AQUI="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RAIZ="$(cd "$AQUI/../../.." && pwd)"
MIGS="$RAIZ/supabase/migrations"
NUESTRA=20261030000000_purga_empresa_retencion_y_huerfanas
MIG="$MIGS/$NUESTRA.sql"
MIG_RRHH="$MIGS/20261031000700_rrhh_catalogos_caen_con_su_condominio.sql"

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
posteriores() {  # las migraciones posteriores a la nuestra, si las hay
  for f in "$MIGS"/*.sql; do
    base="$(basename "$f" .sql)"
    [[ "$base" > "$NUESTRA" ]] && aplicar "$f" "$1"
  done
  return 0
}
fixtures() { aplicar "$AQUI/fixture.sql" "$1"; aplicar "$AQUI/fixture_politica.sql" "$1"; }

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

echo "── 1/6 · andamiaje de plataforma y migraciones ANTERIORES, en orden"
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
nueva_bd antes_prod antes
aplicar "$AQUI/forma_produccion.sql" antes_prod
echo "   y la forma de llaves medida en producción (forma_produccion.sql)"
for b in antes antes_prod; do aplicar "$AQUI/pre_migracion.sql" "$b"; done

echo "── 2/6 · la migración, dos veces, sobre las dos formas (la segunda debe ser limpia)"
nueva_bd plantilla antes
aplicar "$MIG" plantilla
aplicar "$MIG" plantilla && echo "   ✓ repositorio: segunda pasada limpia"
posteriores plantilla
nueva_bd plantilla_prod antes_prod
aplicar "$MIG" plantilla_prod
aplicar "$MIG" plantilla_prod && echo "   ✓ producción: segunda pasada limpia"
posteriores plantilla_prod

echo "── 3/6 · forma de llaves del REPOSITORIO"
nueva_bd repo plantilla
fixtures repo
nueva_bd repo_areas repo
bloque repo_areas assert_areas.sql "3a · área con tareas: falla ENTERA (drift #826)" -v forma=repositorio
bloque repo assert_politica.sql "3b · política: llaves, retención por categoría, cliente y purga sin restos"
bloque repo assert.sql "3c · compuertas, todo o nada, ensayo y purga completa"
nueva_bd repo_rrhh plantilla
fixtures repo_rrhh
bloque repo_rrhh assert_rrhh.sql "3d · catálogo RRHH en uso, con el orden de cascada adverso: se purga; el borrado a mano sigue rechazado"

echo "── 4/6 · forma de llaves de PRODUCCIÓN"
nueva_bd prod plantilla_prod
fixtures prod
nueva_bd prod_areas prod
bloque prod_areas assert_areas.sql "4a · área con tareas: se purga" -v forma=produccion
bloque prod assert_politica.sql "4b · política: llaves, retención por categoría, cliente y purga sin restos"
bloque prod assert.sql "4c · compuertas, todo o nada, ensayo y purga completa"
nueva_bd prod_rrhh plantilla_prod
fixtures prod_rrhh
bloque prod_rrhh assert_rrhh.sql "4d · catálogo RRHH en uso, con el orden de cascada adverso: se purga; el borrado a mano sigue rechazado"

# Copia ORIGEN en DESTINO sin el bloque «-- [MARCA]» … «-- [/MARCA]» (ambos incluidos).
sin_bloque() {  # sin_bloque MARCA ORIGEN DESTINO
  awk -v ini="-- [$1]" -v fin="-- [/$1]" '
    index($0, ini) { dentro = 1 }
    !dentro { print }
    index($0, fin) { dentro = 0 }' "$2" > "$3"
  if cmp -s "$3" "$2"; then echo "❌ $1: el mutante es idéntico a $(basename "$2")"; exit 1; fi
}

echo "── 5/6 · CONTROL NEGATIVO: sin cada bloque de la migración, la suite DEBE fallar"
MARCAS=$(grep -oE '\-\- \[(compuerta|paso):[a-z_]+\]' "$MIG" | sed -E 's/^-- \[(.*)\]$/\1/')
[ -n "$MARCAS" ] || { echo "❌ la migración no tiene bloques marcados"; exit 1; }
for marca in $MARCAS; do
  mutante="$MUT/${marca/:/_}.sql"
  sin_bloque "$marca" "$MIG" "$mutante"
  nueva_bd mutante antes
  if ! salida=$(PGOPTIONS="-c client_min_messages=warning" psql -q -v ON_ERROR_STOP=1 -d mutante -f "$mutante" 2>&1 >/dev/null); then
    echo "  ✓ sin [$marca] la migración no aplica: $(echo "$salida" | grep -E 'ERROR' | head -1 | sed 's/.*ERROR:  //' | cut -c1-100)"
    continue
  fi
  posteriores mutante
  fixtures mutante
  if salida=$(suite mutante assert_politica.sql) && salida=$(suite mutante assert.sql); then
    echo "❌ $marca: la suite PASÓ sin ese bloque, así que no lo prueba."; exit 1
  fi
  echo "  ✓ sin [$marca] la suite falla: $(echo "$salida" | grep -E 'ERROR' | head -1 | sed 's/.*ERROR:  //' | cut -c1-100)"
done

echo "── 6/6 · CONTROL NEGATIVO de $(basename "$MIG_RRHH" .sql): sin cada bloque, el caso RRHH (4d) DEBE fallar"
MARCAS=$(grep -oE '\-\- \[paso:[a-z_]+\]' "$MIG_RRHH" | sed -E 's/^-- \[(.*)\]$/\1/')
[ -n "$MARCAS" ] || { echo "❌ $(basename "$MIG_RRHH") no tiene bloques marcados"; exit 1; }
for marca in $MARCAS; do
  mutante="$MUT/rrhh_${marca/:/_}.sql"
  sin_bloque "$marca" "$MIG_RRHH" "$mutante"
  # plantilla_prod ya tiene la migración: el mutante la sobrescribe (CREATE OR REPLACE).
  nueva_bd mutante plantilla_prod
  aplicar "$mutante" mutante
  fixtures mutante
  if salida=$(suite mutante assert_rrhh.sql); then
    echo "❌ $marca: el caso RRHH PASÓ sin ese bloque, así que no lo prueba."; exit 1
  fi
  echo "  ✓ sin [$marca] el caso RRHH falla: $(echo "$salida" | grep -E 'ERROR' | head -1 | sed 's/.*ERROR:  //' | cut -c1-140)"
done

echo "✅ purgar_empresa: todo o nada, política de retención sin huérfanos, en las dos formas de llaves, con el catálogo RRHH en uso, y cada bloque probado"
