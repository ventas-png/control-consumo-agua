#!/usr/bin/env bash
# ════════════════════════════════════════════════════════════════════════════
# Verificación EJECUTABLE de la paridad de tareas_bloque (20260905000100).
#
# POR QUÉ EXISTE
# Esta migración cierra dos problemas que llevaban meses vivos y que NO se ven
# leyendo el SQL:
#
#   · El par de cierre de `tareas_bloque` se declaró en 20260731000000 contra
#     `completado_en`, pero la columna real es `completada_en`. Efecto en
#     cadena: `completado_por` nunca se creó, el trigger de sellado tampoco, y
#     las dos versiones de la RPC `actividad_equipo` referencian columnas
#     inexistentes — PL/pgSQL no valida nombres al crear, así que la función se
#     creó bien y REVIENTA EN RUNTIME. Solo ejecutando la consulta se ve.
#
#   · Las policies legadas `company_rw_tareas_bloque` y
#     `company_rw_revisiones_tarea` (FOR ALL, solo empresa) nunca se dropearon
#     y anulaban por OR el gate RBAC. Pero el gate nominal era `panel_turno`,
#     que NINGÚN consumidor real trae: dropear la legada sin re-gatear habría
#     dejado sin acceso a los cuatro tabs que de verdad usan la tabla. Que el
#     re-gateo esté bien solo se comprueba con usuarios de distinto permiso.
#
# QUÉ COMPRUEBA (10 invariantes)
#   A · CIERRE      completado_por existe, lo sella la BD y es inmutable; la
#                   consulta de actividad del equipo ya no revienta.
#   B · DOMINIO     estado y prioridad controlados; el triaje de novedades
#                   (novedad/prioridad/requiere_mantenimiento) existe.
#   C · ANULACIÓN   anular exige motivo, sella al autor y es restaurable.
#   D · UNICIDAD    cargar el checklist dos veces no lo duplica; las tareas
#                   ad-hoc (sin plantilla) siguen pudiendo repetirse.
#   E · RLS         los consumidores reales conservan acceso tras retirar la
#                   legada, prog_limpieza entra sin permisos de Seguridad,
#                   sin permiso no hay tareas, la vecina no ve nada, la tarea
#                   ya ejecutada no se borra ni siendo admin (se anula), y
#                   revisiones_tarea estrena sus cuatro policies RBAC.
#   + IDEMPOTENCIA  re-aplicar la migración no cambia nada.
#
# USO
#   supabase/tests/tareas_bloque_paridad/run.sh
# Requiere binarios de PostgreSQL (initdb/pg_ctl/psql). No toca ningún proyecto
# remoto: levanta un cluster temporal, corre todo y lo destruye.
# ════════════════════════════════════════════════════════════════════════════
set -euo pipefail

AQUI="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RAIZ="$(cd "$AQUI/../../.." && pwd)"
MIG="$RAIZ/supabase/migrations/20260905000100_tareas_bloque_paridad.sql"

for d in /usr/lib/postgresql/*/bin; do [ -d "$d" ] && PATH="$d:$PATH"; done
export PATH
command -v initdb >/dev/null || { echo "❌ falta initdb (instalá PostgreSQL)"; exit 1; }

# El socket unix tiene un tope de 107 bytes: ruta corta a propósito.
DATA=$(mktemp -d /tmp/paridata.XXXX)
SOCK=$(mktemp -d /tmp/parisock.XXXX)
PUERTO=${PGPORT_TEST:-55443}

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
psql -q -d postgres -c "CREATE DATABASE parid" >/dev/null
psql -q -d parid -c "CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;" >/dev/null 2>&1 || true

echo "── 1/4 · fixture (estado previo: legadas vivas, gate panel_turno, sin completado_por) ─"
PGOPTIONS="-c client_min_messages=warning" psql -q -v ON_ERROR_STOP=1 -d parid -f "$AQUI/fixture.sql" >/dev/null
echo "  OK    fixture cargado"

echo "── 2/4 · aplicar la migración ──────────────────────────────────────────"
PGOPTIONS="-c client_min_messages=warning" psql -q -v ON_ERROR_STOP=1 -d parid -f "$MIG" >/dev/null
echo "  OK    $(basename "$MIG")"

echo "── 3/4 · invariantes ───────────────────────────────────────────────────"
SALIDA=$(psql -q -v ON_ERROR_STOP=1 -d parid -f "$AQUI/assert.sql" 2>&1) || {
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
echo "── 4/4 · idempotencia (re-aplicar la migración) ────────────────────────"
PGOPTIONS="-c client_min_messages=warning" psql -q -v ON_ERROR_STOP=1 -d parid -f "$MIG" >/dev/null
SALIDA=$(psql -q -v ON_ERROR_STOP=1 -d parid -f "$AQUI/reassert.sql" 2>&1) || {
  echo "❌ la re-aplicación cambió el estado:"
  echo "$SALIDA" | sed -n 's/.*ERROR:  /  /p'
  exit 1
}
echo "$SALIDA" | sed -n 's/.*NOTICE:  /  /p'

echo
echo "✅ tareas_bloque_paridad: 10 invariantes (cierre sellado, dominio,"
echo "   anulación, unicidad y RLS re-gateada), migración idempotente."
