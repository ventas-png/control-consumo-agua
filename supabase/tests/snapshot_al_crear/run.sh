#!/usr/bin/env bash
# ════════════════════════════════════════════════════════════════════════════
# Verificación EJECUTABLE del snapshot al crear la tarea (20260905000600).
#
# POR QUÉ EXISTE
# Lo que importa aquí sólo se ve ejecutando los INSERT: que la tarea cargada a
# mano llegue ARMADA, que el trigger no pueda AFLOJAR una exigencia que alguien
# puso a propósito, que no le cambie el resultado a la materialización, y —el
# que cierra el círculo— que después de la copia el gate de evidencia de
# 20260905000400 SÍ rechace un cierre que hoy pasa sin nada.
#
# QUÉ COMPRUEBA (7 invariantes)
#   A · LA COPIA          la tarea manual desde plantilla llega con checklist,
#                         instrucciones de seguridad, duración y exigencias; lo
#                         que el llamador YA trajo no se pisa, pero lo que faltaba
#                         igual se completa; y la tarea ad-hoc se crea sin recibir
#                         snapshot de ningún lado.
#   B · SÓLO APRIETA      las banderas suben con OR y NUNCA bajan: una tarea que
#                         exige foto y comentario los conserva aunque su plantilla
#                         no pida nada. Es toda la seguridad del diseño, porque
#                         `boolean NOT NULL DEFAULT false` no distingue «dijo
#                         false» de «no dijo nada».
#   C · NO CAMBIA LO QUE  la materialización (20260905000300) da EXACTAMENTE el
#       YA ANDABA         mismo resultado: ya escribe el snapshot, así que los
#                         COALESCE son no-ops y los OR operan sobre iguales.
#   D · EL CÍRCULO        tras la copia, `trg_exigir_evidencia` rechaza cerrar la
#                         tarea manual con el checklist sin marcar. Y la copia
#                         funciona aunque quien inserta tenga `turnos` y NO pueda
#                         leer el catálogo — que es el motivo del SECURITY DEFINER.
#   + IDEMPOTENCIA        re-aplicar no duplica el trigger, conserva lo copiado y
#                         sigue apretando.
#
# USO
#   supabase/tests/snapshot_al_crear/run.sh
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
  # El gate de evidencia entra a propósito: el invariante 6 comprueba que, una
  # vez copiado el checklist, ESE trigger muerde donde hoy no muerde.
  "$RAIZ/supabase/migrations/20260905000400_evidencia_al_cerrar.sql"
  "$RAIZ/supabase/migrations/20260905000600_snapshot_al_crear_tarea.sql"
)
MIG_SNAPSHOT="${MIGS[6]}"

for d in /usr/lib/postgresql/*/bin; do [ -d "$d" ] && PATH="$d:$PATH"; done
export PATH
command -v initdb >/dev/null || { echo "❌ falta initdb (instalá PostgreSQL)"; exit 1; }

# El socket unix tiene un tope de 107 bytes: ruta corta a propósito.
DATA=$(mktemp -d /tmp/snapdata.XXXX)
SOCK=$(mktemp -d /tmp/snapsock.XXXX)
PUERTO=${PGPORT_TEST:-55459}

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
psql -q -d postgres -c "CREATE DATABASE snapshot" >/dev/null
psql -q -d snapshot -c "CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;" >/dev/null 2>&1 || true

echo "── 1/5 · fixture (esquema y padrón) ───────────────────────────────────"
PGOPTIONS="-c client_min_messages=warning" psql -q -v ON_ERROR_STOP=1 -d snapshot -f "$AQUI/fixture.sql" >/dev/null
echo "  OK    fixture cargado"

echo "── 2/5 · aplicar las migraciones ──────────────────────────────────────"
for m in "${MIGS[@]}"; do
  PGOPTIONS="-c client_min_messages=warning" psql -q -v ON_ERROR_STOP=1 -d snapshot -f "$m" >/dev/null
  echo "  OK    $(basename "$m")"
done

echo "── 3/5 · sembrar plantillas y tareas ──────────────────────────────────"
PGOPTIONS="-c client_min_messages=warning" psql -q -v ON_ERROR_STOP=1 -d snapshot -f "$AQUI/seed.sql" >/dev/null
echo "  OK    semilla cargada"

echo "── 4/5 · invariantes ──────────────────────────────────────────────────"
# Sin este `|| { … }`, `set -e` aborta con la salida de psql dentro de la
# sustitución y la consola no muestra NADA (ver supabase/tests/turnos/run.sh).
SALIDA=$(psql -q -v ON_ERROR_STOP=1 -d snapshot -f "$AQUI/assert.sql" 2>&1) || {
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
PGOPTIONS="-c client_min_messages=warning" psql -q -v ON_ERROR_STOP=1 -d snapshot -f "$MIG_SNAPSHOT" >/dev/null
SALIDA=$(psql -q -v ON_ERROR_STOP=1 -d snapshot -f "$AQUI/reassert.sql" 2>&1) || {
  echo "❌ la re-aplicación cambió el estado:"
  echo "$SALIDA" | sed -n 's/.*ERROR:  /  /p'
  exit 1
}
echo "$SALIDA" | sed -n 's/.*NOTICE:  /  /p'

echo
echo "✅ snapshot_al_crear: 7 invariantes (la copia, que sólo apriete, que no le"
echo "   cambie nada a la materialización y que el gate de evidencia muerda),"
echo "   migración idempotente."
