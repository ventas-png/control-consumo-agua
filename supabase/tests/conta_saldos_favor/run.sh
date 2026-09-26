#!/usr/bin/env bash
# ============================================================================
# SALDOS A FAVOR, ANTICIPOS Y SU APLICACIÓN · arnés contra un PostgreSQL REAL
#
# Prueba 20261007000000 sobre la cadena ENTERA de migraciones, el padrón de
# conta_auxiliares_tipo_cargo y el fixture de conta_contabilizacion_cargos:
# cobro exacto, parcial y con excedente (cargos y cuotas), anticipo sin deuda,
# cuenta de anticipos faltante o inválida (el cobro no se pierde), pagador que
# no es el responsable, cobro sin verificar, aplicaciones parciales con mora
# primero, idempotencia, titular y moneda distintos, fallo intermedio,
# permisos y aislamiento, estado de cuenta y conciliación, rechazo bloqueado
# con saldo aplicado, reversión con evidencia; y, con SESIONES REALES
# simultáneas, dos aplicaciones del mismo saldo, doble envío con la misma
# clave, aplicación contra rechazo (en los dos órdenes) y dos saldos contra el
# mismo documento.
# ============================================================================
set -euo pipefail

AQUI="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RAIZ="$(cd "$AQUI/../../.." && pwd)"
MIGS="$RAIZ/supabase/migrations"
BAJO_PRUEBA=20261007000000_conta_saldos_a_favor
PADRON="$RAIZ/supabase/tests/conta_auxiliares_tipo_cargo/fixture.sql"
CARGOS="$RAIZ/supabase/tests/conta_contabilizacion_cargos/fixture.sql"
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

DATA=$(mktemp -d /tmp/sfdata.XXXX)
SOCK=$(mktemp -d /tmp/sfsock.XXXX)
PUERTO=${PGPORT_TEST:-55482}

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
psql -q -d postgres -c "CREATE DATABASE saldos_favor" >/dev/null

aplicar() {
  PGOPTIONS="-c client_min_messages=warning" \
    psql -q -v ON_ERROR_STOP=1 -d saldos_favor -f "$1" >/dev/null
}

SALIDAS=$(mktemp -d /tmp/sfout.XXXX)
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
  -d saldos_favor -f "$MIGS/$BAJO_PRUEBA.sql" 2>&1 || true)
echo "$SALIDA" | grep -q 'already exists' \
  || { echo "❌ la segunda pasada no falló por «already exists»:"; echo "$SALIDA" | tail -3; exit 1; }
echo "   ✓ segunda pasada rechazada por «already exists», como corresponde"
for f in "$MIGS"/*.sql; do
  base="$(basename "$f" .sql)"
  [[ "$base" > "$BAJO_PRUEBA" ]] && aplicar "$f"
done

echo "── 4/5 · padrón + fixture de cargos + el de saldos a favor, e invariantes de una sesión"
aplicar "$PADRON"
aplicar "$CARGOS"
aplicar "$AQUI/fixture.sql"
# El `|| true` es para poder IMPRIMIR el fallo: sin él, `set -e` aborta con la
# salida todavía dentro de la variable y el error se pierde.
SALIDA=$(psql -q -v ON_ERROR_STOP=1 -d saldos_favor -f "$AQUI/assert.sql" 2>&1) || {
  echo "$SALIDA" | sed -n 's/.*NOTICE:  /  /p'
  echo "❌ invariante incumplida:"
  echo "$SALIDA" | grep -E 'ERROR|FATAL' | head -5
  exit 1
}
echo "$SALIDA" | sed -n 's/.*NOTICE:  /  /p'

echo "── 5/5 · concurrencia: sesiones REALES simultáneas, no una simulación"
ADM=a0a0a0a0-0000-0000-0000-00000000000a
U1=f0000000-0000-0000-0000-00000000a001
UNO=e0000000-0000-0000-0000-00000000a001
AN1=9f5f0000-0000-0000-0000-0000000000a1
PQ1=9f5f0000-0000-0000-0000-000000000011
AN3=9f5f0000-0000-0000-0000-0000000000a3
AN4=9f5f0000-0000-0000-0000-0000000000a4
AN5=9f5f0000-0000-0000-0000-0000000000a5
SE=ca5f0000-0000-0000-0000-000000000005
SF=ca5f0000-0000-0000-0000-000000000006
SG=ca5f0000-0000-0000-0000-000000000007
SH=ca5f0000-0000-0000-0000-000000000008

# Preparación: tres anticipos nuevos de Uno en U1 (40, 30 y 40).
psql -q -X -v ON_ERROR_STOP=1 -d saldos_favor >/dev/null <<SQL
SELECT set_config('request.jwt.claim.sub', '$ADM', false);
SET ROLE authenticated;
SELECT public.sf_anticipo('$U1', '$UNO', 40, '$AN3');
SELECT public.sf_anticipo('$U1', '$UNO', 30, '$AN4');
SELECT public.sf_anticipo('$U1', '$UNO', 40, '$AN5');
SQL
o() { psql -q -X -t -A -d saldos_favor -c "SELECT public.sf_origen_id('$1')"; }
OAN1=$(o $AN1); OPQ1=$(o $PQ1); OAN3=$(o $AN3); OAN4=$(o $AN4); OAN5=$(o $AN5)

sesion() {
  # $1 = espera antes de empezar, $2 = sentencia, $3 = espera antes del COMMIT
  psql -q -X -t -A -v ON_ERROR_STOP=1 -d saldos_favor <<SQL
SELECT pg_sleep($1);
SELECT set_config('request.jwt.claim.sub', '$ADM', false);
SET ROLE authenticated;
BEGIN;
$2
SELECT pg_sleep($3);
COMMIT;
SQL
}
# La primera sesión de cada par retiene su transacción 1,5 s; la segunda llega
# 0,3 s después, mientras la primera todavía no confirmó.
par() {
  sesion 0   "$2" 1.5 > "$SALIDAS/${1}1.txt" 2>&1 &
  local p1=$!
  sesion 0.3 "$3" 0   > "$SALIDAS/${1}2.txt" 2>&1 &
  local p2=$!
  wait $p1 $p2 || true
}

# H · el MISMO saldo (35 del anticipo AN1) a dos cargos distintos, 25 y 25.
par h "SELECT 'H1:' || public.sf_aplicar('$OAN1', 'cargos_adicionales_unidad', '$SE', 25, '5a000000-0000-0000-0000-0000000000b1');" \
      "SELECT 'H2:' || public.sf_aplicar('$OAN1', 'cargos_adicionales_unidad', '$SF', 25, '5a000000-0000-0000-0000-0000000000b2');"
# I · doble envío: la MISMA clave y los mismos datos, a la vez.
par i "SELECT 'I1:' || public.sf_aplicar('$OPQ1', 'cargos_adicionales_unidad', '$SG', 5, '5a000000-0000-0000-0000-0000000000c1');" \
      "SELECT 'I2:' || public.sf_aplicar('$OPQ1', 'cargos_adicionales_unidad', '$SG', 5, '5a000000-0000-0000-0000-0000000000c1');"
# J · aplicación del anticipo AN3 y, mientras, su anulación.
par j "SELECT 'J1:' || public.sf_aplicar('$OAN3', 'cargos_adicionales_unidad', '$SG', 10, '5a000000-0000-0000-0000-0000000000d1');" \
      "SELECT 'J2:' || resultado FROM public.conta_anular_anticipo('$AN3', 'SINT-AUX anulación concurrente');"
# J' · al revés: la anulación de AN4 primero y, mientras, su aplicación.
par k "SELECT 'K1:' || resultado FROM public.conta_anular_anticipo('$AN4', 'SINT-AUX anulación concurrente');" \
      "SELECT 'K2:' || public.sf_aplicar('$OAN4', 'cargos_adicionales_unidad', '$SG', 10, '5a000000-0000-0000-0000-0000000000e1');"
# L · dos saldos distintos contra el MISMO cargo SH (debe 20): 15 y 15.
par l "SELECT 'L1:' || public.sf_aplicar('$OAN5', 'cargos_adicionales_unidad', '$SH', 15, '5a000000-0000-0000-0000-0000000000f1');" \
      "SELECT 'L2:' || public.sf_aplicar('$OPQ1', 'cargos_adicionales_unidad', '$SH', 15, '5a000000-0000-0000-0000-0000000000f2');"

cat "$SALIDAS"/[h-l][12].txt | grep -E '^[H-L][12]:' | sort | sed 's/^/   /'

# Las que DEBEN fallar, por lo que se espera; el resto, sin errores.
grep -q 'SALDO_FAVOR_INSUFICIENTE' "$SALIDAS/h2.txt" \
  || { echo "❌ H2 debía fallar por SALDO_FAVOR_INSUFICIENTE:"; cat "$SALIDAS/h2.txt"; exit 1; }
echo "   H2: $(grep -o 'SALDO_FAVOR_INSUFICIENTE[^;]*' "$SALIDAS/h2.txt" | head -1)"
grep -q '^I2:.*/repetido$' "$SALIDAS/i2.txt" \
  || { echo "❌ I2 debía devolver la misma aplicación como repetida:"; cat "$SALIDAS/i2.txt"; exit 1; }
grep -q 'COBRO_SALDO_FAVOR_APLICADO' "$SALIDAS/j2.txt" \
  || { echo "❌ J2 debía fallar por COBRO_SALDO_FAVOR_APLICADO:"; cat "$SALIDAS/j2.txt"; exit 1; }
echo "   J2: $(grep -o 'COBRO_SALDO_FAVOR_APLICADO[^.]*' "$SALIDAS/j2.txt" | head -1)"
grep -q 'SALDO_FAVOR_NO_DISPONIBLE' "$SALIDAS/k2.txt" \
  || { echo "❌ K2 debía fallar por SALDO_FAVOR_NO_DISPONIBLE:"; cat "$SALIDAS/k2.txt"; exit 1; }
echo "   K2: $(grep -o 'SALDO_FAVOR_NO_DISPONIBLE[^.]*' "$SALIDAS/k2.txt" | head -1)"
grep -q 'SALDO_FAVOR_EXCEDE_DOCUMENTO' "$SALIDAS/l2.txt" \
  || { echo "❌ L2 debía fallar por SALDO_FAVOR_EXCEDE_DOCUMENTO:"; cat "$SALIDAS/l2.txt"; exit 1; }
echo "   L2: $(grep -o 'SALDO_FAVOR_EXCEDE_DOCUMENTO[^;]*' "$SALIDAS/l2.txt" | head -1)"
for f in h1 i1 i2 j1 k1 l1; do
  if grep -qE 'ERROR|FATAL' "$SALIDAS/$f.txt"; then
    echo "❌ la sesión $f falló:"; cat "$SALIDAS/$f.txt"; exit 1
  fi
done

SALIDA=$(psql -q -v ON_ERROR_STOP=1 -d saldos_favor -f "$AQUI/concurrencia.sql" 2>&1) || {
  cat "$SALIDAS"/*.txt
  echo "$SALIDA" | sed -n 's/.*NOTICE:  /  /p'
  echo "❌ invariante de concurrencia incumplida:"
  echo "$SALIDA" | grep -E 'ERROR|FATAL' | head -5
  exit 1
}
echo "$SALIDA" | sed -n 's/.*NOTICE:  /  /p'

echo "✅ saldos a favor: registrados sin perder cobros, aplicados de forma explícita, sin doble uso, trazables y reversibles"
