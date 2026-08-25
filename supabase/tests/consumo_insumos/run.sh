#!/usr/bin/env bash
# ════════════════════════════════════════════════════════════════════════════
# Verificación EJECUTABLE del consumo de insumos (20260905000500).
#
# POR QUÉ EXISTE
# Nada de lo que importa aquí se comprueba leyendo el SQL. Que el stock BAJE,
# que baje UNA sola vez por más que se reintente el cierre, que un conserje sin
# permiso de almacén pueda descontar por la RPC y NO a mano, y que el piso en 0
# lo ponga el motor de 20260821000200 y no una cuenta nueva: todo eso son
# hechos de Postgres, y sólo se ven ejecutándolos.
#
# QUÉ COMPRUEBA (11 invariantes)
#   A · LA COPIA         la receta se copia a la tarea con nombre y unidad
#                        congelados, y renombrar el catálogo después NO reescribe
#                        la orden de aquel día; el insumo dado de baja no se
#                        arrastra; sin receta no hay copia y el alta no falla;
#                        y la ruta de materialización (20260905000300) también
#                        copia — es por donde entran casi todas las tareas.
#   B · EL CONSUMO       descuenta y deja la salida trazada a `tareas_bloque`;
#                        volver a llamarla no descuenta dos veces; manda la
#                        cantidad DECLARADA sobre la planificada y `0` significa
#                        «no lo necesité»; sin stock se registra igual, se avisa
#                        y el piso es 0; lo no declarado no se toca.
#   C · LA AUTORIZACIÓN  el de almacén NO consume por una tarea; el conserje SÍ
#                        consume por la RPC y NO puede insertar el movimiento a
#                        mano. Ése es el motivo entero de que la RPC exista.
#   + IDEMPOTENCIA       re-aplicar no duplica el trigger, no reabre lo consumido
#                        y no afloja la autorización.
#
# USO
#   supabase/tests/consumo_insumos/run.sh
# Requiere binarios de PostgreSQL (initdb/pg_ctl/psql). No toca ningún proyecto
# remoto: levanta un cluster temporal, corre todo y lo destruye.
# ════════════════════════════════════════════════════════════════════════════
set -euo pipefail

AQUI="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RAIZ="$(cd "$AQUI/../../.." && pwd)"
MIGS=(
  "$RAIZ/supabase/migrations/20260904000000_limpieza_area_catalogo_e_historial.sql"
  "$RAIZ/supabase/migrations/20260904000100_plantillas_catalogo_actividades.sql"
  "$RAIZ/supabase/migrations/20260904000200_plantilla_tarea_recursos.sql"
  "$RAIZ/supabase/migrations/20260905000200_rutinas_limpieza.sql"
  "$RAIZ/supabase/migrations/20260905000300_materializar_rutinas.sql"
  "$RAIZ/supabase/migrations/20260905000500_consumo_insumos.sql"
)
MIG_CONSUMO="${MIGS[5]}"

for d in /usr/lib/postgresql/*/bin; do [ -d "$d" ] && PATH="$d:$PATH"; done
export PATH
command -v initdb >/dev/null || { echo "❌ falta initdb (instalá PostgreSQL)"; exit 1; }

# El socket unix tiene un tope de 107 bytes: ruta corta a propósito.
DATA=$(mktemp -d /tmp/insudata.XXXX)
SOCK=$(mktemp -d /tmp/insusock.XXXX)
PUERTO=${PGPORT_TEST:-55458}

limpiar() {
  pg_ctl -D "$DATA" stop -m immediate >/dev/null 2>&1 || true
  rm -rf "$DATA" "$SOCK"
}
trap limpiar EXIT

# Postgres se niega a correr como root; si lo somos, se delega en `postgres`.
COMO=""
if [ "$(id -u)" = "0" ]; then
  id postgres >/dev/null 2>&1 || useradd -m postgres
  chown -R postgres "$DATA" "$SOCK"
  COMO="su postgres -c"
fi
correr() { if [ -n "$COMO" ]; then su postgres -c "PATH=$PATH $*"; else eval "$*"; fi; }

correr "initdb -D $DATA -U postgres --auth=trust" >/dev/null
correr "pg_ctl -D $DATA -o '-p $PUERTO -k $SOCK' -l $DATA/pg.log start" >/dev/null
sleep 2

export PGHOST="$SOCK" PGPORT="$PUERTO" PGUSER=postgres
psql -q -d postgres -c "CREATE DATABASE insumos" >/dev/null
psql -q -d insumos -c "CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;" >/dev/null 2>&1 || true

echo "── 1/5 · fixture (esquema y padrón) ───────────────────────────────────"
PGOPTIONS="-c client_min_messages=warning" psql -q -v ON_ERROR_STOP=1 -d insumos -f "$AQUI/fixture.sql" >/dev/null
echo "  OK    fixture cargado"

echo "── 2/5 · aplicar las migraciones ──────────────────────────────────────"
for m in "${MIGS[@]}"; do
  PGOPTIONS="-c client_min_messages=warning" psql -q -v ON_ERROR_STOP=1 -d insumos -f "$m" >/dev/null
  echo "  OK    $(basename "$m")"
done

echo "── 3/5 · sembrar recetas y tareas ─────────────────────────────────────"
PGOPTIONS="-c client_min_messages=warning" psql -q -v ON_ERROR_STOP=1 -d insumos -f "$AQUI/seed.sql" >/dev/null
echo "  OK    semilla cargada"

echo "── 4/5 · invariantes ──────────────────────────────────────────────────"
# Sin este `|| { … }`, `set -e` aborta con la salida de psql dentro de la
# sustitución y la consola no muestra NADA (ver supabase/tests/turnos/run.sh).
SALIDA=$(psql -q -v ON_ERROR_STOP=1 -d insumos -f "$AQUI/assert.sql" 2>&1) || {
  echo "$SALIDA" | sed -n 's/.*NOTICE:  /  /p'
  echo
  echo "❌ invariante incumplida:"
  echo "$SALIDA" | sed -n 's/.*ERROR:  /  /p'
  exit 1
}
echo "$SALIDA" | sed -n 's/.*NOTICE:  /  /p'
if echo "$SALIDA" | grep -q 'WARNING:'; then
  echo
  echo "❌ algo se tragó un error:"
  echo "$SALIDA" | sed -n 's/.*WARNING:  /  ⚠ /p'
  exit 1
fi

echo
echo "── 5/5 · idempotencia (re-aplicar y re-verificar) ─────────────────────"
PGOPTIONS="-c client_min_messages=warning" psql -q -v ON_ERROR_STOP=1 -d insumos -f "$MIG_CONSUMO" >/dev/null
SALIDA=$(psql -q -v ON_ERROR_STOP=1 -d insumos -f "$AQUI/reassert.sql" 2>&1) || {
  echo "❌ la re-aplicación cambió el estado:"
  echo "$SALIDA" | sed -n 's/.*ERROR:  /  /p'
  exit 1
}
echo "$SALIDA" | sed -n 's/.*NOTICE:  /  /p'

echo
echo "✅ consumo_insumos: 11 invariantes (la copia del plan, el consumo y la"
echo "   autorización), migración idempotente."
