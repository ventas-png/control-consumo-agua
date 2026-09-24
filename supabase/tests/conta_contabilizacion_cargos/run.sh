#!/usr/bin/env bash
# ============================================================================
# CONTABILIZACIÓN DE CARGOS · arnés contra un PostgreSQL REAL
#
# Prueba 20261002000000 sobre la cadena ENTERA de migraciones y el padrón de
# conta_auxiliares_tipo_cargo: histórico intacto, pendientes visibles por
# configuración/cuenta/responsable, reproceso idempotente, períodos cerrados,
# mora, cobros contra la misma CxC y auxiliar, nada retroactivo, permisos y
# aislamiento entre empresas y proyectos. La concurrencia se prueba con
# sesiones REALES simultáneas: dos reprocesos del mismo documento, y reproceso
# contra anulación. Todo como usuarios de la aplicación.
# ============================================================================
set -euo pipefail

AQUI="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RAIZ="$(cd "$AQUI/../../.." && pwd)"
MIGS="$RAIZ/supabase/migrations"
BAJO_PRUEBA=20261002000000_conta_contabilizacion_cargos
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

DATA=$(mktemp -d /tmp/cargosdata.XXXX)
SOCK=$(mktemp -d /tmp/cargossock.XXXX)
PUERTO=${PGPORT_TEST:-55473}

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
psql -q -d postgres -c "CREATE DATABASE contabilizacion_cargos" >/dev/null

aplicar() {
  PGOPTIONS="-c client_min_messages=warning" \
    psql -q -v ON_ERROR_STOP=1 -d contabilizacion_cargos -f "$1" >/dev/null
}

SALIDAS=$(mktemp -d /tmp/cargosout.XXXX)
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
    -d contabilizacion_cargos -f "$MIGS/$BAJO_PRUEBA.sql" 2>&1 || true)
  echo "$SALIDA" | grep -q 'already exists' \
    || { echo "❌ la segunda pasada falló por algo distinto de «already exists»:"; echo "$SALIDA"; exit 1; }
  echo "   ✓ segunda pasada rechazada por «already exists», como corresponde"
fi
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
SALIDA=$(psql -q -v ON_ERROR_STOP=1 -d contabilizacion_cargos -f "$AQUI/assert.sql" 2>&1) || {
  echo "$SALIDA" | sed -n 's/.*NOTICE:  /  /p'
  echo "❌ invariante incumplida:"
  echo "$SALIDA" | grep -E 'ERROR|FATAL' | head -5
  exit 1
}
echo "$SALIDA" | sed -n 's/.*NOTICE:  /  /p'

echo "── 6/6 · concurrencia: sesiones REALES simultáneas, no una simulación"
# Se configuran los tipos de los dos cargos pendientes y se reprocesan desde
# conexiones distintas. La primera sesión retiene su transacción 1,5 s después
# de reprocesar: la otra llega mientras el asiento todavía no está confirmado.
psql -q -X -v ON_ERROR_STOP=1 -d contabilizacion_cargos >/dev/null <<SQL
INSERT INTO public.conta_config_tipo_cargo (company_id, project_id, tipo_cargo, cuenta_cxc_id, cuenta_ingreso_id) VALUES
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'a1a1a1a1-0000-0000-0000-000000000001', 'adicional_dano',
   '11000000-0000-0000-0000-00000000a101', '11000000-0000-0000-0000-00000000a102'),
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'a1a1a1a1-0000-0000-0000-000000000001', 'adicional_exceso_consumo',
   '11000000-0000-0000-0000-00000000a101', '11000000-0000-0000-0000-00000000a102');
SQL
sesion() {
  # $1 = espera antes de empezar, $2 = sentencia, $3 = espera antes del COMMIT
  psql -q -X -t -A -v ON_ERROR_STOP=1 -d contabilizacion_cargos <<SQL
SELECT pg_sleep($1);
SELECT set_config('request.jwt.claim.sub', 'a0a0a0a0-0000-0000-0000-00000000000a', false);
SET ROLE authenticated;
BEGIN;
$2
SELECT pg_sleep($3);
COMMIT;
SQL
}
C7=ca100000-0000-0000-0000-000000000007
C8=ca100000-0000-0000-0000-000000000008

# A · dos reprocesos del mismo cargo.
sesion 0   "SELECT 'A1:' || resultado FROM public.conta_reprocesar_cargo('cargos_adicionales_unidad', '$C7');" 1.5 > "$SALIDAS/a1.txt" 2>&1 &
PA1=$!
sesion 0.3 "SELECT 'A2:' || resultado FROM public.conta_reprocesar_cargo('cargos_adicionales_unidad', '$C7');" 0 > "$SALIDAS/a2.txt" 2>&1 &
PA2=$!
wait $PA1 $PA2
cat "$SALIDAS/a1.txt" "$SALIDAS/a2.txt" | grep -E '^A[12]:' | sort | sed 's/^/   /'

# B · reproceso contra anulación del mismo cargo.
sesion 0   "SELECT 'B1:' || resultado FROM public.conta_reprocesar_cargo('cargos_adicionales_unidad', '$C8');" 1.5 > "$SALIDAS/b1.txt" 2>&1 &
PB1=$!
sesion 0.3 "UPDATE public.cargos_adicionales_unidad SET estado = 'anulado' WHERE id = '$C8'; SELECT 'B2:anulado';" 0 > "$SALIDAS/b2.txt" 2>&1 &
PB2=$!
wait $PB1 $PB2
cat "$SALIDAS/b1.txt" "$SALIDAS/b2.txt" | grep -E '^B[12]:' | sed 's/^/   /'

for f in a1 a2 b1 b2; do
  if grep -qE 'ERROR|FATAL' "$SALIDAS/$f.txt"; then
    echo "❌ la sesión $f falló:"; cat "$SALIDAS/$f.txt"; exit 1
  fi
done

SALIDA=$(psql -q -v ON_ERROR_STOP=1 -d contabilizacion_cargos -f "$AQUI/concurrencia.sql" 2>&1) || {
  cat "$SALIDAS"/*.txt
  echo "$SALIDA" | sed -n 's/.*NOTICE:  /  /p'
  echo "❌ invariante de concurrencia incumplida:"
  echo "$SALIDA" | grep -E 'ERROR|FATAL' | head -5
  exit 1
}
echo "$SALIDA" | sed -n 's/.*NOTICE:  /  /p'

echo "✅ contabilización de cargos: idempotente, visible, aislada y serializada"
