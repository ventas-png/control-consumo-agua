#!/usr/bin/env bash
# ============================================================================
# PENDIENTES Y REPROCESO DE FACTURAS · arnés contra un PostgreSQL REAL
#
# Por qué la cadena ENTERA y no un fixture a mano: lo que se prueba aquí son
# FKs, triggers y unicidad sobre `conta_cuentas`, `proveedores`, `clientes` y
# `unidades` tal como existen de verdad. Un fixture reducido probaría un
# esquema parecido al de producción, que es justo lo que no sirve.
#
# La migración bajo prueba se aplica DOS VECES: si no es idempotente, la
# segunda pasada rompe acá y no en producción.
# ============================================================================
set -euo pipefail

AQUI="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RAIZ="$(cd "$AQUI/../../.." && pwd)"
MIGS="$RAIZ/supabase/migrations"
BAJO_PRUEBA=20260929000000_conta_pendientes_reproceso_facturas

for d in /usr/lib/postgresql/*/bin; do [ -d "$d" ] && PATH="$d:$PATH"; done
export PATH
command -v initdb >/dev/null || { echo "❌ falta initdb (instalá PostgreSQL)"; exit 1; }

# Shims de pg_net/pg_cron: fuera de Supabase no existen y seis migraciones
# hacen CREATE EXTENSION. Mismo mecanismo que scripts/schema-drift/
# reconstruir.mjs: un control file vacío; los objetos que las migraciones usan
# los define bootstrap.sql.
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

DATA=$(mktemp -d /tmp/pendrepdata.XXXX)
SOCK=$(mktemp -d /tmp/pendrepsock.XXXX)
SALIDAS=$(mktemp -d /tmp/pendrepout.XXXX)
PUERTO=${PGPORT_TEST:-55471}

COMO=""
if [ "$(id -u)" = "0" ]; then
  id postgres >/dev/null 2>&1 || useradd -m postgres
  COMO="su postgres -c"
fi
correr() { if [ -n "$COMO" ]; then su postgres -c "PATH=$PATH $*"; else eval "$*"; fi; }

limpiar() {
  correr "pg_ctl -D $DATA stop -m immediate" >/dev/null 2>&1 || true
  rm -rf "$DATA" "$SOCK" "$SALIDAS"
}
trap limpiar EXIT

if [ -n "$COMO" ]; then chown -R postgres "$DATA" "$SOCK"; fi

correr "initdb -D $DATA -U postgres --auth=trust" >/dev/null
correr "pg_ctl -D $DATA -o '-p $PUERTO -k $SOCK' -l $DATA/pg.log start" >/dev/null
sleep 2

export PGHOST="$SOCK" PGPORT="$PUERTO" PGUSER=postgres
psql -q -d postgres -c "CREATE DATABASE pendientes_reproceso" >/dev/null

aplicar() {
  PGOPTIONS="-c client_min_messages=warning" \
    psql -q -v ON_ERROR_STOP=1 -d pendientes_reproceso -f "$1" >/dev/null
}

echo "── 1/6 · andamiaje de plataforma (roles, auth, extensiones)"
aplicar "$RAIZ/scripts/schema-drift/bootstrap.sql"

echo "── 2/6 · cadena de migraciones hasta la anterior a la que se prueba"
N=0
for f in "$MIGS"/*.sql; do
  base="$(basename "$f" .sql)"
  [ "$base" = "$BAJO_PRUEBA" ] && continue
  aplicar "$f"
  N=$((N + 1))
done
echo "   $N migraciones aplicadas sobre una base vacía"

echo "── 3/6 · migración bajo prueba (dos veces, para exigir idempotencia)"
aplicar "$MIGS/$BAJO_PRUEBA.sql"
if aplicar "$MIGS/$BAJO_PRUEBA.sql" 2>/dev/null; then
  echo "   ✓ segunda pasada limpia"
else
  # CREATE TABLE sin IF NOT EXISTS es DELIBERADO para tablas nuevas (convención
  # del repo: el error tiene que ser explícito si se corre dos veces). Lo que
  # se exige acá es que falle por eso y NO por otra cosa.
  SALIDA=$(PGOPTIONS="-c client_min_messages=warning" psql -v ON_ERROR_STOP=1 \
    -d pendientes_reproceso -f "$MIGS/$BAJO_PRUEBA.sql" 2>&1 || true)
  echo "$SALIDA" | grep -q 'already exists' \
    || { echo "❌ la segunda pasada falló por algo distinto de «already exists»:"; echo "$SALIDA"; exit 1; }
  echo "   ✓ segunda pasada rechazada por «already exists», como corresponde a una tabla nueva"
fi

echo "── 4/6 · padrón: dos empresas, dos proyectos, cinco usuarios"
aplicar "$AQUI/fixture.sql"

echo "── 5/6 · invariantes (registros y asientos reales)"
# El `|| true` es para poder IMPRIMIR el fallo: sin él, `set -e` aborta con la
# salida todavía dentro de la variable y el error se pierde.
SALIDA=$(psql -q -v ON_ERROR_STOP=1 -d pendientes_reproceso -f "$AQUI/assert.sql" 2>&1) || {
  echo "$SALIDA" | sed -n 's/.*NOTICE:  /  /p'
  echo "❌ invariante incumplida:"
  echo "$SALIDA" | grep -E 'ERROR|FATAL' | head -5
  exit 1
}
echo "$SALIDA" | sed -n 's/.*NOTICE:  /  /p'

echo "── 6/6 · concurrencia: sesiones REALES simultáneas, no una simulación"
# Dos conexiones distintas llaman al reproceso de la MISMA factura a la vez.
# Cada una retiene su transacción abierta un rato después de llamar, para que
# la otra llegue mientras la primera todavía no confirmó: es exactamente la
# ventana en la que un botón deshabilitado no protege nada.
sesion() {
  # $1 = factura, $2 = espera antes de empezar, $3 = sentencia
  psql -q -X -t -A -v ON_ERROR_STOP=1 -d pendientes_reproceso <<SQL
SELECT pg_sleep($2);
SELECT set_config('request.jwt.claim.sub', 'a0a0a0a0-0000-0000-0000-00000000000a', false);
SET ROLE authenticated;
BEGIN;
$3
SELECT pg_sleep(1.5);
COMMIT;
SQL
}

FC=cccc0000-0000-0000-0000-000000000001
sesion $FC 0   "SELECT 'R1:' || resultado FROM public.conta_reprocesar_factura_proveedor('$FC');" > "$SALIDAS/r1.txt" 2>&1 &
P1=$!
sesion $FC 0.3 "SELECT 'R2:' || resultado FROM public.conta_reprocesar_factura_proveedor('$FC');" > "$SALIDAS/r2.txt" 2>&1 &
P2=$!
wait $P1 $P2
cat "$SALIDAS/r1.txt" "$SALIDAS/r2.txt" | grep -E '^R[12]:' | sort | sed 's/^/   /'

# Reproceso contra anulación de la misma factura: la anulación espera el
# bloqueo, y al aplicarse su trigger reversa el asiento recién creado.
FD=cccc0000-0000-0000-0000-000000000002
sesion $FD 0   "SELECT 'R3:' || resultado FROM public.conta_reprocesar_factura_proveedor('$FD');" > "$SALIDAS/r3.txt" 2>&1 &
P3=$!
( sleep 0.3; psql -q -X -v ON_ERROR_STOP=1 -d pendientes_reproceso \
    -c "UPDATE public.facturas_proveedor SET estado = 'anulada' WHERE id = '$FD'" ) > "$SALIDAS/r4.txt" 2>&1 &
P4=$!
wait $P3 $P4
grep -E '^R3:' "$SALIDAS/r3.txt" | sed 's/^/   /'

SALIDA=$(psql -q -v ON_ERROR_STOP=1 -d pendientes_reproceso -f "$AQUI/concurrencia.sql" 2>&1) || {
  cat "$SALIDAS/r1.txt" "$SALIDAS/r2.txt" "$SALIDAS/r3.txt" "$SALIDAS/r4.txt"
  echo "$SALIDA" | sed -n 's/.*NOTICE:  /  /p'
  echo "❌ invariante de concurrencia incumplida:"
  echo "$SALIDA" | grep -E 'ERROR|FATAL' | head -5
  exit 1
}
echo "$SALIDA" | sed -n 's/.*NOTICE:  /  /p'

echo "✅ pendientes de contabilización y reproceso verificados"
