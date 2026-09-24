#!/usr/bin/env bash
# ============================================================================
# AUXILIARES Y CONFIGURACIÓN POR TIPO DE CARGO · arnés contra un PostgreSQL REAL
#
# Por qué la cadena ENTERA y no un fixture a mano: lo que se prueba aquí son
# FKs, triggers, RLS y unicidad sobre `conta_cuentas`, `clientes`,
# `company_clientes`, `unidades`, `unidad_residentes`, `cuotas_condominio` y
# `conta_asiento_lineas` tal como existen de verdad —con los triggers
# contables que ya disparan sobre cuotas—. Un fixture reducido probaría un
# esquema parecido al de producción, que es justo lo que no sirve.
#
# Las pruebas de permisos corren con `SET ROLE authenticated` y el usuario de
# la aplicación en `request.jwt.claim.sub`: un admin, un contador con permiso
# RBAC, un operador sin permiso contable y el admin de OTRA empresa. Nunca
# como superusuario.
#
# La migración bajo prueba se aplica DOS VECES: si no es idempotente, la
# segunda pasada rompe acá y no en producción.
# ============================================================================
set -euo pipefail

AQUI="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RAIZ="$(cd "$AQUI/../../.." && pwd)"
MIGS="$RAIZ/supabase/migrations"
BAJO_PRUEBA=20261001000000_conta_auxiliares_y_config_tipo_cargo

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

DATA=$(mktemp -d /tmp/auxtipodata.XXXX)
SOCK=$(mktemp -d /tmp/auxtiposock.XXXX)
PUERTO=${PGPORT_TEST:-55471}

COMO=""
if [ "$(id -u)" = "0" ]; then
  id postgres >/dev/null 2>&1 || useradd -m postgres
  COMO="su postgres -c"
fi
correr() { if [ -n "$COMO" ]; then su postgres -c "PATH=$PATH $*"; else eval "$*"; fi; }

limpiar() {
  correr "pg_ctl -D $DATA stop -m immediate" >/dev/null 2>&1 || true
  rm -rf "$DATA" "$SOCK"
}
trap limpiar EXIT

if [ -n "$COMO" ]; then chown -R postgres "$DATA" "$SOCK"; fi

correr "initdb -D $DATA -U postgres --auth=trust" >/dev/null
correr "pg_ctl -D $DATA -o '-p $PUERTO -k $SOCK' -l $DATA/pg.log start" >/dev/null
sleep 2

export PGHOST="$SOCK" PGPORT="$PUERTO" PGUSER=postgres
psql -q -d postgres -c "CREATE DATABASE auxiliares_tipo_cargo" >/dev/null

aplicar() {
  PGOPTIONS="-c client_min_messages=warning" \
    psql -q -v ON_ERROR_STOP=1 -d auxiliares_tipo_cargo -f "$1" >/dev/null
}

echo "── 1/5 · andamiaje de plataforma (roles, auth, extensiones)"
aplicar "$RAIZ/scripts/schema-drift/bootstrap.sql"

echo "── 2/5 · cadena de migraciones ANTERIORES a la que se prueba, en orden"
# Sólo las anteriores: las posteriores (p. ej. 20261001000100, que depende de
# ésta) se aplican después de la bajo prueba, como en producción.
N=0
for f in "$MIGS"/*.sql; do
  base="$(basename "$f" .sql)"
  [[ "$base" < "$BAJO_PRUEBA" ]] || continue
  aplicar "$f"
  N=$((N + 1))
done
echo "   $N migraciones aplicadas sobre una base vacía"

echo "── 3/5 · migración bajo prueba (dos veces, para exigir idempotencia)"
aplicar "$MIGS/$BAJO_PRUEBA.sql"
if aplicar "$MIGS/$BAJO_PRUEBA.sql" 2>/dev/null; then
  echo "   ✓ segunda pasada limpia"
else
  # CREATE TABLE sin IF NOT EXISTS es DELIBERADO para tablas nuevas (convención
  # del repo: el error tiene que ser explícito si se corre dos veces). Lo que
  # se exige acá es que falle por eso y NO por otra cosa.
  SALIDA=$(PGOPTIONS="-c client_min_messages=warning" psql -v ON_ERROR_STOP=1 \
    -d auxiliares_tipo_cargo -f "$MIGS/$BAJO_PRUEBA.sql" 2>&1 || true)
  echo "$SALIDA" | grep -q 'already exists' \
    || { echo "❌ la segunda pasada falló por algo distinto de «already exists»:"; echo "$SALIDA"; exit 1; }
  echo "   ✓ segunda pasada rechazada por «already exists», como corresponde a una tabla nueva"
fi

for f in "$MIGS"/*.sql; do
  base="$(basename "$f" .sql)"
  [[ "$base" > "$BAJO_PRUEBA" ]] && aplicar "$f"
done

echo "── 4/5 · padrón de dos empresas y dos ledgers"
aplicar "$AQUI/fixture.sql"

echo "── 5/5 · invariantes"
# El `|| true` es para poder IMPRIMIR el fallo: sin él, `set -e` aborta con la
# salida todavía dentro de la variable y el error se pierde.
SALIDA=$(psql -q -v ON_ERROR_STOP=1 -d auxiliares_tipo_cargo -f "$AQUI/assert.sql" 2>&1) || {
  echo "$SALIDA" | sed -n 's/.*NOTICE:  /  /p'
  echo "❌ invariante incumplida:"
  echo "$SALIDA" | grep -E 'ERROR|FATAL' | head -5
  exit 1
}
echo "$SALIDA" | sed -n 's/.*NOTICE:  /  /p'

echo "✅ auxiliares, responsables y configuración por tipo de cargo verificados"
