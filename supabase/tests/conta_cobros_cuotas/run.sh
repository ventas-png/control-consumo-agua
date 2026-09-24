#!/usr/bin/env bash
# ============================================================================
# COBROS DE CUOTAS POR TIPO · arnés contra un PostgreSQL REAL
#
# Prueba 20261002000100 sobre la cadena ENTERA de migraciones, el padrón de
# conta_auxiliares_tipo_cargo y el fixture de conta_contabilizacion_cargos:
# cobro antes del reproceso, devengo en borrador, principal y mora con CxC
# distintas y compartidas, abonos parciales, excedente, mora posterior al
# cobro, cuota de mes cerrado con mora de mes abierto (y al revés), reprocesos
# repetidos, permisos y aislamiento. La concurrencia se prueba con sesiones
# REALES simultáneas: dos reprocesos de la misma cuota, reproceso de la cuota
# contra el de su cobro, y dos cobros de la misma cuota a la vez.
# ============================================================================
set -euo pipefail

AQUI="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RAIZ="$(cd "$AQUI/../../.." && pwd)"
MIGS="$RAIZ/supabase/migrations"
BAJO_PRUEBA=20261002000100_conta_cobros_cuotas_por_tipo
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

DATA=$(mktemp -d /tmp/cobrosdata.XXXX)
SOCK=$(mktemp -d /tmp/cobrossock.XXXX)
PUERTO=${PGPORT_TEST:-55474}

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
psql -q -d postgres -c "CREATE DATABASE cobros_cuotas" >/dev/null

aplicar() {
  PGOPTIONS="-c client_min_messages=warning" \
    psql -q -v ON_ERROR_STOP=1 -d cobros_cuotas -f "$1" >/dev/null
}

SALIDAS=$(mktemp -d /tmp/cobrosout.XXXX)
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

echo "── 3/6 · migración bajo prueba (dos veces: la segunda sólo puede fallar por «already exists»)"
aplicar "$MIGS/$BAJO_PRUEBA.sql"
if aplicar "$MIGS/$BAJO_PRUEBA.sql" 2>/dev/null; then
  echo "   ✓ segunda pasada limpia"
else
  # ADD COLUMN y CREATE TRIGGER sin IF NOT EXISTS son DELIBERADOS (convención
  # del repo: correrla dos veces tiene que fallar de forma explícita). Se exige
  # que falle por eso y NO por otra cosa.
  SALIDA=$(PGOPTIONS="-c client_min_messages=warning" psql -v ON_ERROR_STOP=1 \
    -d cobros_cuotas -f "$MIGS/$BAJO_PRUEBA.sql" 2>&1 || true)
  echo "$SALIDA" | grep -q 'already exists' \
    || { echo "❌ la segunda pasada falló por algo distinto de «already exists»:"; echo "$SALIDA"; exit 1; }
  echo "   ✓ segunda pasada rechazada por «already exists», como corresponde"
fi
for f in "$MIGS"/*.sql; do
  base="$(basename "$f" .sql)"
  [[ "$base" > "$BAJO_PRUEBA" ]] && aplicar "$f"
done

echo "── 4/6 · padrón de dos empresas + fixture de cargos + el de cobros"
aplicar "$PADRON"
aplicar "$CARGOS"
aplicar "$AQUI/fixture.sql"

echo "── 5/6 · invariantes de una sesión"
# El `|| true` es para poder IMPRIMIR el fallo: sin él, `set -e` aborta con la
# salida todavía dentro de la variable y el error se pierde.
SALIDA=$(psql -q -v ON_ERROR_STOP=1 -d cobros_cuotas -f "$AQUI/assert.sql" 2>&1) || {
  echo "$SALIDA" | sed -n 's/.*NOTICE:  /  /p'
  echo "❌ invariante incumplida:"
  echo "$SALIDA" | grep -E 'ERROR|FATAL' | head -5
  exit 1
}
echo "$SALIDA" | sed -n 's/.*NOTICE:  /  /p'

echo "── 6/6 · concurrencia: sesiones REALES simultáneas, no una simulación"
# Se configura el tipo de K1 y K3 y se lanzan sesiones desde conexiones
# distintas. La primera de cada par retiene su transacción 1,5 s: la otra llega
# mientras el asiento todavía no está confirmado.
psql -q -X -v ON_ERROR_STOP=1 -d cobros_cuotas >/dev/null <<SQL
INSERT INTO public.conta_config_tipo_cargo (company_id, project_id, tipo_cargo, cuenta_cxc_id, cuenta_ingreso_id) VALUES
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'a1a1a1a1-0000-0000-0000-000000000001', 'cuota_extraordinaria',
   '11000000-0000-0000-0000-00000000a101', '11000000-0000-0000-0000-00000000a103');
SQL
sesion() {
  # $1 = espera antes de empezar, $2 = sentencia, $3 = espera antes del COMMIT
  psql -q -X -t -A -v ON_ERROR_STOP=1 -d cobros_cuotas <<SQL
SELECT pg_sleep($1);
SELECT set_config('request.jwt.claim.sub', 'a0a0a0a0-0000-0000-0000-00000000000a', false);
SET ROLE authenticated;
BEGIN;
$2
SELECT pg_sleep($3);
COMMIT;
SQL
}
K1=c2000000-0000-0000-0000-0000000000c1
K2=c2000000-0000-0000-0000-0000000000c2
K3=c2000000-0000-0000-0000-0000000000c3
PK3=9b000000-0000-0000-0000-000000000011
PAGO="INSERT INTO public.pagos (id, cliente_id, project_id, cuota_id, monto, metodo, estado, verified_at) VALUES"
CLI="'e0000000-0000-0000-0000-00000000a001', 'a1a1a1a1-0000-0000-0000-000000000001'"

# A · dos reprocesos de la misma cuota, que tiene un cobro esperando.
sesion 0   "SELECT 'A1:' || string_agg(resultado, '+') FROM public.conta_reprocesar_cargo('cuotas_condominio', '$K1');" 1.5 > "$SALIDAS/a1.txt" 2>&1 &
PA1=$!
sesion 0.3 "SELECT 'A2:' || string_agg(resultado, '+') FROM public.conta_reprocesar_cargo('cuotas_condominio', '$K1');" 0 > "$SALIDAS/a2.txt" 2>&1 &
PA2=$!
wait $PA1 $PA2

# B · reproceso de la cuota contra reproceso de SU cobro.
sesion 0   "SELECT 'B1:' || string_agg(resultado, '+') FROM public.conta_reprocesar_cargo('cuotas_condominio', '$K3');" 1.5 > "$SALIDAS/b1.txt" 2>&1 &
PB1=$!
sesion 0.3 "SELECT 'B2:' || string_agg(resultado, '+') FROM public.conta_reprocesar_cargo('pagos', '$PK3');" 0 > "$SALIDAS/b2.txt" 2>&1 &
PB2=$!
wait $PB1 $PB2

# C · dos cobros de 10 de la misma cuota (mora 10) a la vez: mora primero,
# sin que los dos se lleven la misma mora.
sesion 0   "$PAGO ('9b000000-0000-0000-0000-000000000020', $CLI, '$K2', 10, 'efectivo', 'verificado', now()); SELECT 'C1:insertado';" 1.5 > "$SALIDAS/c1.txt" 2>&1 &
PC1=$!
sesion 0.3 "$PAGO ('9b000000-0000-0000-0000-000000000021', $CLI, '$K2', 10, 'efectivo', 'verificado', now()); SELECT 'C2:insertado';" 0 > "$SALIDAS/c2.txt" 2>&1 &
PC2=$!
wait $PC1 $PC2
cat "$SALIDAS"/[abc][12].txt | grep -E '^[ABC][12]:' | sort | sed 's/^/   /'

for f in a1 a2 b1 b2 c1 c2; do
  if grep -qE 'ERROR|FATAL' "$SALIDAS/$f.txt"; then
    echo "❌ la sesión $f falló:"; cat "$SALIDAS/$f.txt"; exit 1
  fi
done

SALIDA=$(psql -q -v ON_ERROR_STOP=1 -d cobros_cuotas -f "$AQUI/concurrencia.sql" 2>&1) || {
  cat "$SALIDAS"/*.txt
  echo "$SALIDA" | sed -n 's/.*NOTICE:  /  /p'
  echo "❌ invariante de concurrencia incumplida:"
  echo "$SALIDA" | grep -E 'ERROR|FATAL' | head -5
  exit 1
}
echo "$SALIDA" | sed -n 's/.*NOTICE:  /  /p'

echo "✅ cobros de cuotas por tipo: sin caída al mapeo, repartidos, idempotentes y serializados"
