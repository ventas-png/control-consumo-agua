#!/usr/bin/env bash
# ════════════════════════════════════════════════════════════════════════════
# Verificación EJECUTABLE de la materialización de rutinas (20260907000300).
#
# POR QUÉ EXISTE
# La RPC tiene cinco JOINs, una función de ventana y cuatro conteos por bucket.
# Nada de eso se valida leyéndolo: que el SQL compile no dice que empareje por
# la jornada correcta, que el orden entre detrás de lo manual, ni —lo más fácil
# de romper sin notarlo— que la segunda corrida no duplique ni resucite lo que
# alguien anuló. Un `NOT EXISTS` mirando sólo las tareas vigentes pasaría la
# revisión y repetiría cada anulación en cada corrida.
#
# QUÉ COMPRUEBA (10 invariantes)
#   A · MATERIALIZAR  la rutina cae en el bloque de SU jornada y sólo en ése
#                     (el bloque sin jornada, el de fuera de rango y la rutina
#                     inactiva no producen nada); la tarea COPIA duración,
#                     checklist, instrucciones y banderas —y editar el catálogo
#                     después NO reescribe lo ya generado—; el paso sin área
#                     hereda la de la rutina; el orden es denso pese al hueco de
#                     la receta y entra DETRÁS de lo puesto a mano, sin
#                     reordenarlo.
#   B · IDEMPOTENCIA  la segunda corrida no duplica; la tarea ANULADA no revive;
#                     al turno terminado no se le agrega trabajo después.
#   C · ARGUMENTOS    rango invertido, rango de más de 400 días y proyecto
#                     inexistente, rechazados con su ERRCODE.
#   D · AUTORIZACIÓN  prog_limpieza materializa sin permisos de Seguridad; sin
#                     permiso no; la empresa vecina —con el MISMO permiso—
#                     tampoco; anon ni puede invocarla; y la rutina que ya
#                     generó trabajo no se borra.
#   + IDEMPOTENCIA de la migración: re-aplicarla no duplica la RPC ni las
#                     tareas, conserva snapshot y anulación, y deja anon fuera.
#
# USO
#   supabase/tests/materializar_rutinas/run.sh
# Requiere binarios de PostgreSQL (initdb/pg_ctl/psql). No toca ningún proyecto
# remoto: levanta un cluster temporal, corre todo y lo destruye.
# ════════════════════════════════════════════════════════════════════════════
set -euo pipefail

AQUI="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RAIZ="$(cd "$AQUI/../../.." && pwd)"
MIG_AREAS="$RAIZ/supabase/migrations/20260904000100_limpieza_area_catalogo_e_historial.sql"
MIG_PLANT="$RAIZ/supabase/migrations/20260904000200_plantillas_catalogo_actividades.sql"
MIG_RUTINAS="$RAIZ/supabase/migrations/20260907000200_rutinas_limpieza.sql"
MIG_MAT="$RAIZ/supabase/migrations/20260907000300_materializar_rutinas.sql"

for d in /usr/lib/postgresql/*/bin; do [ -d "$d" ] && PATH="$d:$PATH"; done
export PATH
command -v initdb >/dev/null || { echo "❌ falta initdb (instalá PostgreSQL)"; exit 1; }

# El socket unix tiene un tope de 107 bytes: ruta corta a propósito.
DATA=$(mktemp -d /tmp/matrutdata.XXXX)
SOCK=$(mktemp -d /tmp/matrutsock.XXXX)
PUERTO=${PGPORT_TEST:-55453}

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
psql -q -d postgres -c "CREATE DATABASE matrut" >/dev/null
psql -q -d matrut -c "CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;" >/dev/null 2>&1 || true

echo "── 1/5 · fixture (estado previo + esquema de turnos) ───────────────────"
PGOPTIONS="-c client_min_messages=warning" psql -q -v ON_ERROR_STOP=1 -d matrut -f "$AQUI/fixture.sql" >/dev/null
echo "  OK    fixture cargado"

echo "── 2/5 · aplicar las migraciones ──────────────────────────────────────"
for m in "$MIG_AREAS" "$MIG_PLANT" "$MIG_RUTINAS" "$MIG_MAT"; do
  PGOPTIONS="-c client_min_messages=warning" psql -q -v ON_ERROR_STOP=1 -d matrut -f "$m" >/dev/null
  echo "  OK    $(basename "$m")"
done

echo "── 3/5 · sembrar catálogo y rutinas ───────────────────────────────────"
PGOPTIONS="-c client_min_messages=warning" psql -q -v ON_ERROR_STOP=1 -d matrut -f "$AQUI/seed.sql" >/dev/null
echo "  OK    semilla cargada"

echo "── 4/5 · invariantes ──────────────────────────────────────────────────"
# Sin este `|| { … }`, `set -e` aborta con la salida de psql dentro de la
# sustitución y la consola no muestra NADA (ver supabase/tests/turnos/run.sh).
SALIDA=$(psql -q -v ON_ERROR_STOP=1 -d matrut -f "$AQUI/assert.sql" 2>&1) || {
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
PGOPTIONS="-c client_min_messages=warning" psql -q -v ON_ERROR_STOP=1 -d matrut -f "$MIG_MAT" >/dev/null
SALIDA=$(psql -q -v ON_ERROR_STOP=1 -d matrut -f "$AQUI/reassert.sql" 2>&1) || {
  echo "❌ la re-aplicación cambió el estado:"
  echo "$SALIDA" | sed -n 's/.*ERROR:  /  /p'
  exit 1
}
echo "$SALIDA" | sed -n 's/.*NOTICE:  /  /p'

echo
echo "✅ materializar_rutinas: 10 invariantes (emparejamiento por jornada,"
echo "   snapshot, orden, idempotencia real y autorización), migración idempotente."
