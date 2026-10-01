#!/usr/bin/env bash
# ============================================================================
# TIPO DE CAMBIO MENSUAL · arnés contra un PostgreSQL REAL
#
# Prueba 20261008000000 sobre la cadena ENTERA de migraciones y el padrón de
# conta_auxiliares_tipo_cargo: permisos y validación de la configuración
# (dirección, moneda base, mes, unicidad), auditoría, cambio de mes, moneda
# base, documento retroactivo sin tasa (sin usar la de otro mes ni la diaria
# heredada, publicación bloqueada con instrucción y convertida con la tasa de
# SU mes al configurarla), cambio de configuración sin recalcular lo
# publicado y redondeo uniforme.
# ============================================================================
set -euo pipefail

AQUI="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RAIZ="$(cd "$AQUI/../../.." && pwd)"
MIGS="$RAIZ/supabase/migrations"
BAJO_PRUEBA=20261008000000_conta_tipo_cambio_mensual
PADRON="$RAIZ/supabase/tests/conta_auxiliares_tipo_cargo/fixture.sql"
for d in /usr/lib/postgresql/*/bin; do [ -d "$d" ] && PATH="$d:$PATH"; done
export PATH
command -v initdb >/dev/null || { echo "❌ falta initdb (instalá PostgreSQL)"; exit 1; }

# Shims de pg_net/pg_cron: fuera de Supabase no existen y varias migraciones
# hacen CREATE EXTENSION. Mismo mecanismo que conta_pendientes_reproceso y
# scripts/schema-drift/reconstruir.mjs: un control file vacío; los objetos que
# las migraciones usan los define bootstrap.sql.
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

DATA=$(mktemp -d /tmp/tcdata.XXXX)
SOCK=$(mktemp -d /tmp/tcsock.XXXX)
PUERTO=${PGPORT_TEST:-55483}

COMO=""
if [ "$(id -u)" = "0" ]; then
  id postgres >/dev/null 2>&1 || useradd -m postgres
  COMO="su postgres -c"
fi
correr() { if [ -n "$COMO" ]; then su postgres -c "PATH=$PATH $*"; else eval "$*"; fi; }

limpiar() {
  correr "pg_ctl -D $DATA stop -m immediate" >/dev/null 2>&1 || true
  rm -rf "$DATA" "$SOCK" "${SALIDAS:-}"
}
trap limpiar EXIT

if [ -n "$COMO" ]; then chown -R postgres "$DATA" "$SOCK"; fi

correr "initdb -D $DATA -U postgres --auth=trust" >/dev/null
correr "pg_ctl -D $DATA -o '-p $PUERTO -k $SOCK' -l $DATA/pg.log start" >/dev/null
sleep 2

export PGHOST="$SOCK" PGPORT="$PUERTO" PGUSER=postgres
psql -q -d postgres -c "CREATE DATABASE tipo_cambio" >/dev/null

aplicar() {
  PGOPTIONS="-c client_min_messages=warning" \
    psql -q -v ON_ERROR_STOP=1 -d tipo_cambio -f "$1" >/dev/null
}

SALIDAS=$(mktemp -d /tmp/tcout.XXXX)
chmod 777 "$SALIDAS"

echo "── 1/5 · andamiaje de plataforma (roles, auth, extensiones)"
aplicar "$RAIZ/scripts/schema-drift/bootstrap.sql"

echo "── 2/5 · cadena de migraciones ANTERIORES a la que se prueba, en orden"
N=0
for f in "$MIGS"/*.sql; do
  base="$(basename "$f" .sql)"
  [[ "$base" < "$BAJO_PRUEBA" ]] || continue
  aplicar "$f"
  N=$((N + 1))
done
echo "   $N migraciones aplicadas sobre una base vacía"

echo "── 3/5 · migración bajo prueba (dos veces: la segunda sólo puede fallar por «already exists») y posteriores"
aplicar "$MIGS/$BAJO_PRUEBA.sql"
SALIDA=$(PGOPTIONS="-c client_min_messages=warning" psql -v ON_ERROR_STOP=1 \
  -d tipo_cambio -f "$MIGS/$BAJO_PRUEBA.sql" 2>&1 || true)
echo "$SALIDA" | grep -q 'already exists' \
  || { echo "❌ la segunda pasada no falló por «already exists»:"; echo "$SALIDA" | tail -3; exit 1; }
echo "   ✓ segunda pasada rechazada por «already exists», como corresponde"
for f in "$MIGS"/*.sql; do
  base="$(basename "$f" .sql)"
  [[ "$base" > "$BAJO_PRUEBA" ]] && aplicar "$f"
done

echo "── 4/5 · padrón + fixture de tipo de cambio, e invariantes"
aplicar "$PADRON"
aplicar "$AQUI/fixture.sql"
# El `|| true` es para poder IMPRIMIR el fallo: sin él, `set -e` aborta con la
# salida todavía dentro de la variable y el error se pierde.
SALIDA=$(psql -q -v ON_ERROR_STOP=1 -d tipo_cambio -f "$AQUI/assert.sql" 2>&1) || {
  echo "$SALIDA" | sed -n 's/.*NOTICE:  /  /p'
  echo "❌ invariante incumplida:"
  echo "$SALIDA" | grep -E 'ERROR|FATAL' | head -5
  exit 1
}
echo "$SALIDA" | sed -n 's/.*NOTICE:  /  /p'

echo "✅ tipo de cambio mensual: una tasa por mes, guardada en cada asiento, sin tasa no se contabiliza y lo publicado no cambia"
