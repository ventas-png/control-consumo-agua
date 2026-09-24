#!/usr/bin/env bash
# ============================================================================
# COBROS · BLOQUEO Y REVALIDACIÓN DEL PAGO · arnés contra un PostgreSQL REAL
#
# Prueba 20261002000200: ningún camino contabiliza el cobro de un pago
# rechazado o eliminado. La concurrencia se prueba con DOS conexiones reales y
# una COMPUERTA (un advisory lock que retiene una tercera conexión de control):
#   1. la sesión S1 hace su parte y se detiene en la compuerta, con sus
#      bloqueos tomados;
#   2. recién entonces arranca S2, y el control espera a verla BLOQUEADA por
#      S1 en pg_stat_activity (o terminada, si no hubiera conflicto);
#   3. se abre la compuerta: S1 confirma y S2 continúa.
# El orden de los hechos no depende de tiempos: lo fija la compuerta.
#
# Escenarios (en ambos órdenes): reproceso de la cuota contra rechazo, borrado
# suave y borrado duro de su cobro pendiente; y un escenario de ORDEN DE
# BLOQUEOS (reproceso de cobro contra reproceso de su cuota) que con un orden
# inconsistente termina en deadlock.
# ============================================================================
set -euo pipefail

AQUI="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RAIZ="$(cd "$AQUI/../../.." && pwd)"
MIGS="$RAIZ/supabase/migrations"
BAJO_PRUEBA=20261002000200_conta_cobros_bloqueo_pago
PADRON="$RAIZ/supabase/tests/conta_auxiliares_tipo_cargo/fixture.sql"
CARGOS="$RAIZ/supabase/tests/conta_contabilizacion_cargos/fixture.sql"
COBROS="$RAIZ/supabase/tests/conta_cobros_cuotas/fixture.sql"

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

DATA=$(mktemp -d /tmp/bloqdata.XXXX)
SOCK=$(mktemp -d /tmp/bloqsock.XXXX)
PUERTO=${PGPORT_TEST:-55475}

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
psql -q -d postgres -c "CREATE DATABASE cobros_bloqueos" >/dev/null

aplicar() {
  PGOPTIONS="-c client_min_messages=warning" \
    psql -q -v ON_ERROR_STOP=1 -d cobros_bloqueos -f "$1" >/dev/null
}

SALIDAS=$(mktemp -d /tmp/bloqout.XXXX)
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
    -d cobros_bloqueos -f "$MIGS/$BAJO_PRUEBA.sql" 2>&1 || true)
  echo "$SALIDA" | grep -q 'already exists' \
    || { echo "❌ la segunda pasada falló por algo distinto de «already exists»:"; echo "$SALIDA"; exit 1; }
  echo "   ✓ segunda pasada rechazada por «already exists», como corresponde"
fi
for f in "$MIGS"/*.sql; do
  base="$(basename "$f" .sql)"
  [[ "$base" > "$BAJO_PRUEBA" ]] && aplicar "$f"
done

echo "── 4/6 · padrón de dos empresas + fixtures de cargos y de cobros"
aplicar "$PADRON"
aplicar "$CARGOS"
aplicar "$COBROS"

echo "── 5/6 · invariantes de una sesión"
# El `|| true` es para poder IMPRIMIR el fallo: sin él, `set -e` aborta con la
# salida todavía dentro de la variable y el error se pierde.
SALIDA=$(psql -q -v ON_ERROR_STOP=1 -d cobros_bloqueos -f "$AQUI/assert.sql" 2>&1) || {
  echo "$SALIDA" | sed -n 's/.*NOTICE:  /  /p'
  echo "❌ invariante incumplida:"
  echo "$SALIDA" | grep -E 'ERROR|FATAL' | head -5
  exit 1
}
echo "$SALIDA" | sed -n 's/.*NOTICE:  /  /p'

echo "── 6/6 · concurrencia determinista: dos conexiones y una compuerta"
psql -q -X -v ON_ERROR_STOP=1 -d cobros_bloqueos >/dev/null <<SQL
INSERT INTO public.conta_config_tipo_cargo (company_id, project_id, tipo_cargo, cuenta_cxc_id, cuenta_ingreso_id) VALUES
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'a1a1a1a1-0000-0000-0000-000000000001', 'cuota_extraordinaria',
   '11000000-0000-0000-0000-00000000a101', '11000000-0000-0000-0000-00000000a103');
SQL

COMPUERTA=424242
APP="SELECT set_config('request.jwt.claim.sub', 'a0a0a0a0-0000-0000-0000-00000000000a', false); SET ROLE authenticated;"
q() { psql -X -At -q -d cobros_bloqueos -c "$1"; }

# Espera (máx. 60 s) a que la consulta devuelva un número > 0.
esperar() {
  local i
  for i in $(seq 1 1200); do
    [ "$(q "$1")" -gt 0 ] 2>/dev/null && return 0
    [ -n "${2:-}" ] && [ -f "$2" ] && return 0
    sleep 0.05
  done
  echo "❌ tiempo agotado esperando: $1"; exit 1
}

# escenario NOMBRE ROL_S1 SQL_S1 ROL_S2 SQL_S2
#   ROL = app (usuario de la aplicación) | su (superusuario, para el DELETE duro)
escenario() {
  local n=$1 r1=$2 s1=$3 r2=$4 s2=$5 p1 p2 pc pre1 pre2
  rm -f "$SALIDAS/liberar" "$SALIDAS/tomada" "$SALIDAS/$n.s2.fin"
  pre1=""; [ "$r1" = app ] && pre1="$APP"
  pre2=""; [ "$r2" = app ] && pre2="$APP"
  # S1 se detiene en la compuerta donde diga __COMPUERTA__, o al final.
  local alto="SELECT pg_advisory_xact_lock_shared($COMPUERTA);"
  if [[ "$s1" == *__COMPUERTA__* ]]; then s1="${s1//__COMPUERTA__/$alto}"; else s1="$s1
$alto"; fi

  # Control: toma la compuerta y la retiene hasta que exista «liberar».
  psql -X -q -d cobros_bloqueos >/dev/null 2>"$SALIDAS/$n.ctl.err" <<SQL &
SELECT pg_advisory_lock($COMPUERTA);
\! touch "$SALIDAS/tomada"; until [ -f "$SALIDAS/liberar" ]; do sleep 0.05; done
SELECT pg_advisory_unlock($COMPUERTA);
SQL
  pc=$!
  until [ -f "$SALIDAS/tomada" ]; do sleep 0.05; done

  # S1: su parte, y se detiene en la compuerta con sus bloqueos tomados.
  PGAPPNAME="$n-s1" psql -X -At -q -v ON_ERROR_STOP=1 -d cobros_bloqueos >"$SALIDAS/$n.s1" 2>&1 <<SQL &
$pre1
BEGIN;
$s1
COMMIT;
SQL
  p1=$!
  esperar "SELECT count(*) FROM pg_locks WHERE locktype = 'advisory' AND objid = $COMPUERTA AND objsubid = 1 AND NOT granted"

  # S2: arranca con S1 retenida; el control espera a verla bloqueada por S1.
  (PGAPPNAME="$n-s2" psql -X -At -q -v ON_ERROR_STOP=1 -d cobros_bloqueos >"$SALIDAS/$n.s2" 2>&1 <<SQL
$pre2
BEGIN;
$s2
COMMIT;
SQL
   touch "$SALIDAS/$n.s2.fin") &
  p2=$!
  esperar "SELECT count(*) FROM pg_stat_activity WHERE application_name = '$n-s2' AND wait_event_type = 'Lock'" "$SALIDAS/$n.s2.fin"
  if [ -f "$SALIDAS/$n.s2.fin" ]; then
    echo "   $n: S2 NO esperó a S1 (terminó antes de abrir la compuerta)" | tee -a "$SALIDAS/avisos"
  else
    echo "   $n: S2 bloqueada por S1 ✓"
  fi

  touch "$SALIDAS/liberar"
  wait $p1 || true; wait $p2 || true; wait $pc || true
  for f in s1 s2; do
    if grep -qE 'ERROR|FATAL' "$SALIDAS/$n.$f"; then
      echo "❌ $n: la sesión $f falló:"; cat "$SALIDAS/$n.$f"; exit 1
    fi
  done
  sed "s/^/      $n.s1 → /" "$SALIDAS/$n.s1" | grep -v '^\s*$' || true
  sed "s/^/      $n.s2 → /" "$SALIDAS/$n.s2" | grep -v '^\s*$' || true
}

RQ() { echo "SELECT 'reproceso:' || COALESCE(string_agg(evento || '=' || resultado, ','), '-') FROM public.conta_reprocesar_cargo('cuotas_condominio', 'c3000000-0000-0000-0000-0000000000c$1');"; }
P() { echo "9c000000-0000-0000-0000-0000000000c$1"; }

# Reproceso de la cuota PRIMERO (contabiliza y retiene), luego rechazo/borrado.
escenario k1 app "$(RQ 1)" app "UPDATE public.pagos SET estado = 'rechazado' WHERE id = '$(P 1)';"
escenario k2 app "$(RQ 2)" app "UPDATE public.pagos SET deleted_at = now() WHERE id = '$(P 2)';"
escenario k3 app "$(RQ 3)" su  "DELETE FROM public.pagos WHERE id = '$(P 3)';"
# Rechazo/borrado PRIMERO (retiene la fila del pago), luego reproceso.
escenario k4 app "UPDATE public.pagos SET estado = 'rechazado' WHERE id = '$(P 4)';" app "$(RQ 4)"
escenario k5 app "UPDATE public.pagos SET deleted_at = now() WHERE id = '$(P 5)';"   app "$(RQ 5)"
escenario k6 su  "DELETE FROM public.pagos WHERE id = '$(P 6)';"                     app "$(RQ 6)"
# Orden de bloqueos: S1 retiene la fila de un cobro de K7 y luego lo reprocesa;
# S2 reprocesa la cuota K7, que tiene ese cobro y otro. Con un orden
# inconsistente (candado de cobros antes que las filas) sería un deadlock.
escenario k7 app "SELECT 'fila:' || id FROM public.pagos WHERE id = '9c000000-0000-0000-0000-0000000000d7' FOR UPDATE;
__COMPUERTA__
SELECT 'cobro:' || string_agg(resultado || '/' || COALESCE(codigo, '-'), ',') FROM public.conta_reprocesar_cargo('pagos', '9c000000-0000-0000-0000-0000000000d7');" \
             app "$(RQ 7)"

[ -f "$SALIDAS/avisos" ] && { echo "❌ alguna sesión S2 no quedó bloqueada: el orden no está garantizado"; exit 1; }

SALIDA=$(psql -q -v ON_ERROR_STOP=1 -d cobros_bloqueos -f "$AQUI/concurrencia.sql" 2>&1) || {
  cat "$SALIDAS"/*.s? 2>/dev/null
  echo "$SALIDA" | sed -n 's/.*NOTICE:  /  /p'
  echo "❌ invariante de concurrencia incumplida:"
  echo "$SALIDA" | grep -E 'ERROR|FATAL' | head -5
  exit 1
}
echo "$SALIDA" | sed -n 's/.*NOTICE:  /  /p'

echo "✅ cobros: todo camino bloquea y revalida el pago; sin asientos vivos de pagos rechazados o eliminados"
