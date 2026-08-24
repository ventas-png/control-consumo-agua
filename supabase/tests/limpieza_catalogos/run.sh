#!/usr/bin/env bash
# ════════════════════════════════════════════════════════════════════════════
# Verificación EJECUTABLE de los catálogos operativos de limpieza
# (20260904000000 · 000100 · 000200 · 20260905000000).
#
# POR QUÉ EXISTE
# La serie migra DATOS además de esquema: el backfill decide a qué área del
# catálogo se ata cada programación histórica, y equivocarse ahí corrompe en
# silencio (atar la limpieza de la piscina al lobby no truena nada — solo miente
# para siempre). También cambia una FK de CASCADE a RESTRICT: si eso no queda
# bien, borrar una programación sigue arrastrando fotos y reportes históricos.
# Nada de esto se valida leyendo el SQL.
#
# QUÉ COMPRUEBA (37 invariantes)
#   A · BACKFILL    coincidencia única (con espacios, mayúsculas y acentos),
#                   área inexistente creada UNA sola vez, ambigua que se queda
#                   pendiente, texto en blanco que no ensucia, y que cada
#                   empresa vincula contra su propio catálogo.
#   B · HISTORIAL   la FK quedó RESTRICT: la programación con ejecuciones no se
#                   borra, la sin historial sí, y el área en uso tampoco. El
#                   DELETE fila a fila queda fuera del alcance del condominio
#                   (ni el admin); corregir es ANULAR con motivo, sellado por
#                   la BD y restaurable.
#   C · ACTIVIDADES el servicio se clasifica solo donde el cargo es inequívoco
#                   (cargo nunca se reescribe); los CHECK de servicio/duración/
#                   checklist rechazan lo inválido; el cargo nuevo va
#                   controlado (el legado sigue operable) y requiere_checklist
#                   exige pasos con texto real.
#   D · PUENTES     company/project/creado_por los sella la BD; recurso de otra
#                   empresa U otro proyecto aborta; sin duplicados; cantidad
#                   positiva; el recurso vinculado no se borra y la receta muere
#                   con su plantilla. Las FKs COMPUESTAS congelan el tenant:
#                   una plantilla/suministro/herramienta relacionados no se
#                   mueven de empresa ni de proyecto.
#   E · RLS         el permiso del tab abre los puentes, la vecina no los ve ni
#                   los escribe, administrar áreas exige autorización
#                   específica (checklist_areas o areas.manage; borrar,
#                   owner/admin), prog_limpieza lee el catálogo de actividades
#                   sin permisos de Seguridad, y las policies legacy
#                   company_rw_* ya no existen.
#   F · FUSIÓN      (20260905000000) las áreas duplicadas de un proyecto se
#                   fusionan en una sola eligiendo por activa > más referenciada
#                   > más antigua; las CUATRO FKs entrantes quedan re-apuntadas
#                   sin huérfanas; el homónimo de OTRO proyecto no se toca; la
#                   programación que quedó ambigua en el backfill se cierra; y
#                   el UNIQUE por nombre normalizado bloquea nuevos duplicados.
#   + IDEMPOTENCIA  re-aplicar la serie no duplica ni resucita áreas, no
#                   resuelve ambiguos por su cuenta y no revive policies.
#
# USO
#   supabase/tests/limpieza_catalogos/run.sh
# Requiere binarios de PostgreSQL (initdb/pg_ctl/psql). No toca ningún proyecto
# remoto: levanta un cluster temporal, corre todo y lo destruye.
# ════════════════════════════════════════════════════════════════════════════
set -euo pipefail

AQUI="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RAIZ="$(cd "$AQUI/../../.." && pwd)"
MIG_AREAS="$RAIZ/supabase/migrations/20260904000000_limpieza_area_catalogo_e_historial.sql"
MIG_PLANT="$RAIZ/supabase/migrations/20260904000100_plantillas_catalogo_actividades.sql"
MIG_PUENTES="$RAIZ/supabase/migrations/20260904000200_plantilla_tarea_recursos.sql"
MIG_DEDUPE="$RAIZ/supabase/migrations/20260905000000_areas_dedupe_y_unicidad.sql"

for d in /usr/lib/postgresql/*/bin; do [ -d "$d" ] && PATH="$d:$PATH"; done
export PATH
command -v initdb >/dev/null || { echo "❌ falta initdb (instalá PostgreSQL)"; exit 1; }

# El socket unix tiene un tope de 107 bytes: ruta corta a propósito.
DATA=$(mktemp -d /tmp/limpcatdata.XXXX)
SOCK=$(mktemp -d /tmp/limpcatsock.XXXX)
PUERTO=${PGPORT_TEST:-55437}

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
psql -q -d postgres -c "CREATE DATABASE limpcat" >/dev/null
# anon/authenticated no existen en un Postgres pelado; las migraciones les
# revocan/conceden permisos por nombre de rol.
psql -q -d limpcat -c "CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;" >/dev/null 2>&1 || true

echo "── 1/5 · fixture (estado previo: legacy vivas, FK CASCADE, area texto libre) ─"
PGOPTIONS="-c client_min_messages=warning" psql -q -v ON_ERROR_STOP=1 -d limpcat -f "$AQUI/fixture.sql" >/dev/null
echo "  OK    fixture cargado"

echo "── 2/5 · aplicar la serie de catálogos ─────────────────────────────────"
for m in "$MIG_AREAS" "$MIG_PLANT" "$MIG_PUENTES"; do
  PGOPTIONS="-c client_min_messages=warning" psql -q -v ON_ERROR_STOP=1 -d limpcat -f "$m" >/dev/null
  echo "  OK    $(basename "$m")"
done

echo "── 3/5 · invariantes de la serie de catálogos ──────────────────────────"
# Sin este `|| { … }`, `set -e` aborta con la salida de psql dentro de la
# sustitución y la consola no muestra NADA (ver supabase/tests/turnos/run.sh).
SALIDA=$(psql -q -v ON_ERROR_STOP=1 -d limpcat -f "$AQUI/assert.sql" 2>&1) || {
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
echo "── 4/5 · dedupe de áreas y unicidad ────────────────────────────────────"
PGOPTIONS="-c client_min_messages=warning" psql -q -v ON_ERROR_STOP=1 -d limpcat -f "$MIG_DEDUPE" >/dev/null
echo "  OK    $(basename "$MIG_DEDUPE")"
SALIDA=$(psql -q -v ON_ERROR_STOP=1 -d limpcat -f "$AQUI/dedupe.sql" 2>&1) || {
  echo "$SALIDA" | sed -n 's/.*NOTICE:  /  /p'
  echo
  echo "❌ invariante de dedupe incumplida:"
  echo "$SALIDA" | sed -n 's/.*ERROR:  /  /p'
  exit 1
}
echo "$SALIDA" | sed -n 's/.*NOTICE:  /  /p'

echo
echo "── 5/5 · idempotencia (re-aplicar la serie completa y re-verificar) ────"
for m in "$MIG_AREAS" "$MIG_PLANT" "$MIG_PUENTES" "$MIG_DEDUPE"; do
  PGOPTIONS="-c client_min_messages=warning" psql -q -v ON_ERROR_STOP=1 -d limpcat -f "$m" >/dev/null
done
SALIDA=$(psql -q -v ON_ERROR_STOP=1 -d limpcat -f "$AQUI/reassert.sql" 2>&1) || {
  echo "❌ la re-aplicación cambió datos:"
  echo "$SALIDA" | sed -n 's/.*ERROR:  /  /p'
  exit 1
}
echo "$SALIDA" | sed -n 's/.*NOTICE:  /  /p'

echo
echo "✅ limpieza_catalogos: 37 invariantes (backfill, historial inmutable con"
echo "   anulación lógica, actividades controladas, puentes con tenant"
echo "   congelado, RLS y fusión de áreas duplicadas), serie idempotente."
