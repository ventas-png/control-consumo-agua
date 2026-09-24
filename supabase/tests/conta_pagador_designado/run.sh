#!/usr/bin/env bash
# ============================================================================
# PAGADOR DESIGNADO · RPC transaccional · arnés contra un PostgreSQL REAL
#
# Prueba 20261001000100 (unidad_designar_pagador) sobre la cadena ENTERA de
# migraciones y el padrón de conta_auxiliares_tipo_cargo:
#   · validaciones previas (otra unidad, inactivo, otra empresa, sin sesión);
#   · fallo INTERMEDIO: el segundo paso revienta y el pagador anterior queda;
#   · escrituras filtradas por RLS: la RPC aborta en vez de «éxito con 0 filas»;
#   · concurrencia con sesiones REALES simultáneas: dos cambios sobre la misma
#     unidad se serializan, y una cuota emitida durante el cambio no ve el
#     estado intermedio.
# Todas las llamadas corren como usuarios de la aplicación, nunca como
# superusuario.
# ============================================================================
set -euo pipefail

AQUI="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RAIZ="$(cd "$AQUI/../../.." && pwd)"
MIGS="$RAIZ/supabase/migrations"
BAJO_PRUEBA=20261001000100_unidad_designar_pagador_rpc
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

DATA=$(mktemp -d /tmp/pagadordata.XXXX)
SOCK=$(mktemp -d /tmp/pagadorsock.XXXX)
PUERTO=${PGPORT_TEST:-55472}

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
psql -q -d postgres -c "CREATE DATABASE pagador_designado" >/dev/null

aplicar() {
  PGOPTIONS="-c client_min_messages=warning" \
    psql -q -v ON_ERROR_STOP=1 -d pagador_designado -f "$1" >/dev/null
}

SALIDAS=$(mktemp -d /tmp/pagadorout.XXXX)
chmod 777 "$SALIDAS"

echo "── 1/6 · andamiaje de plataforma (roles, auth, extensiones)"
aplicar "$RAIZ/scripts/schema-drift/bootstrap.sql"

echo "── 2/6 · cadena de migraciones ANTERIORES a la que se prueba, en orden"
N=0
for f in "$MIGS"/*.sql; do
  base="$(basename "$f" .sql)"
  [[ "$base" < "$BAJO_PRUEBA" ]] || continue
  aplicar "$f"
  N=$((N + 1))
done
echo "   $N migraciones aplicadas sobre una base vacía"

echo "── 3/6 · migración bajo prueba (dos veces: CREATE OR REPLACE debe ser idempotente)"
aplicar "$MIGS/$BAJO_PRUEBA.sql"
aplicar "$MIGS/$BAJO_PRUEBA.sql"
echo "   ✓ segunda pasada limpia"
for f in "$MIGS"/*.sql; do
  base="$(basename "$f" .sql)"
  [[ "$base" > "$BAJO_PRUEBA" ]] && aplicar "$f"
done

echo "── 4/6 · padrón de dos empresas + residentes de prueba"
aplicar "$PADRON"
aplicar "$AQUI/fixture.sql"

echo "── 5/6 · invariantes de una sesión"
# El `|| true` es para poder IMPRIMIR el fallo: sin él, `set -e` aborta con la
# salida todavía dentro de la variable y el error se pierde.
SALIDA=$(psql -q -v ON_ERROR_STOP=1 -d pagador_designado -f "$AQUI/assert.sql" 2>&1) || {
  echo "$SALIDA" | sed -n 's/.*NOTICE:  /  /p'
  echo "❌ invariante incumplida:"
  echo "$SALIDA" | grep -E 'ERROR|FATAL' | head -5
  exit 1
}
echo "$SALIDA" | sed -n 's/.*NOTICE:  /  /p'

echo "── 6/6 · concurrencia: sesiones REALES simultáneas, no una simulación"
# Cada sesión es una conexión distinta, como usuario de la aplicación. La que
# cambia el pagador retiene su transacción abierta 1,5 s DESPUÉS de llamar a
# la RPC: es la ventana en la que, con dos peticiones sueltas, el resto del
# sistema veía la unidad sin pagador.
sesion() {
  # $1 = espera antes de empezar, $2 = sentencia, $3 = espera antes del COMMIT
  psql -q -X -t -A -v ON_ERROR_STOP=1 -d pagador_designado <<SQL
SELECT pg_sleep($1);
SELECT set_config('request.jwt.claim.sub', 'a0a0a0a0-0000-0000-0000-00000000000a', false);
SET ROLE authenticated;
BEGIN;
$2
SELECT pg_sleep($3);
COMMIT;
SQL
}
U1=f0000000-0000-0000-0000-00000000a001
R1=d0000000-0000-0000-0000-000000000001
R2=d0000000-0000-0000-0000-000000000002
CUOTA="INSERT INTO public.cuotas_condominio (company_id, project_id, unidad_id, concepto, monto, periodo, estado, tipo_cargo)
  VALUES ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'a1a1a1a1-0000-0000-0000-000000000001', '$U1'"

# A · cambio R1→R2 abierto 1,5 s; a los 0,3 s otra sesión emite una cuota.
sesion 0   "SELECT 'A1:' || public.unidad_designar_pagador('$U1', '$R2');" 1.5 > "$SALIDAS/a1.txt" 2>&1 &
PA1=$!
sesion 0.3 "$CUOTA, 'SINT-AUX conc durante', 10, '2026-12', 'pendiente', 'mantenimiento'); SELECT 'A2:ok';" 0 > "$SALIDAS/a2.txt" 2>&1 &
PA2=$!
wait $PA1 $PA2
sesion 0   "$CUOTA, 'SINT-AUX conc después', 10, '2026-12', 'pendiente', 'mantenimiento'); SELECT 'A3:ok';" 0 > "$SALIDAS/a3.txt" 2>&1
cat "$SALIDAS/a1.txt" "$SALIDAS/a2.txt" "$SALIDAS/a3.txt" | grep -E '^A[123]:' | sed 's/^/   /'

# B · dos cambios simultáneos sobre la MISMA unidad: R2→R1 (abierto 1,5 s) y,
# a los 0,3 s, →R2. Sin serializar, el segundo leería una foto vieja y chocaría
# con el índice único; con el candado espera, relee y termina bien.
sesion 0   "SELECT 'B1:' || public.unidad_designar_pagador('$U1', '$R1');" 1.5 > "$SALIDAS/b1.txt" 2>&1 &
PB1=$!
sesion 0.3 "SELECT 'B2:' || public.unidad_designar_pagador('$U1', '$R2');" 0 > "$SALIDAS/b2.txt" 2>&1 &
PB2=$!
wait $PB1 $PB2
cat "$SALIDAS/b1.txt" "$SALIDAS/b2.txt" | grep -E '^B[12]:' | sed 's/^/   /'

for f in a1 a2 a3 b1 b2; do
  if grep -qE 'ERROR|FATAL' "$SALIDAS/$f.txt"; then
    echo "❌ la sesión $f falló:"; cat "$SALIDAS/$f.txt"; exit 1
  fi
done

SALIDA=$(psql -q -v ON_ERROR_STOP=1 -d pagador_designado -f "$AQUI/concurrencia.sql" 2>&1) || {
  cat "$SALIDAS"/*.txt
  echo "$SALIDA" | sed -n 's/.*NOTICE:  /  /p'
  echo "❌ invariante de concurrencia incumplida:"
  echo "$SALIDA" | grep -E 'ERROR|FATAL' | head -5
  exit 1
}
echo "$SALIDA" | sed -n 's/.*NOTICE:  /  /p'

echo "✅ pagador designado: cambio atómico, validado y serializado por unidad"
