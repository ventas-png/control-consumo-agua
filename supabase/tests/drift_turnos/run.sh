#!/usr/bin/env bash
# ════════════════════════════════════════════════════════════════════════════
# Verificación EJECUTABLE de 20260906000000 contra la forma REAL de producción
#
# POR QUÉ EXISTE
# La guarda de #796 corrió por primera vez contra producción y encontró que
# `bloques_turno` y `tareas_bloque` existen allí con OTROS NOMBRES para el mismo
# concepto —`finalizado_en`, `completado_en`, `foto_url`— y que ninguno de esos
# nombres aparece en migración alguna. Consecuencia: cerrar un bloque de turno y
# completar una tarea fallan EN SILENCIO en producción (el código no mira el
# error del update), agregar una tarea da 400, y crear un bloqueo de amenidad da
# 400 visible.
#
# Un sandbox construido desde supabase/migrations NO puede probar esto: allí los
# nombres correctos ya existen y la migración es un no-op. Éste monta las tres
# tablas con la forma real y prueba contra ella.
#
# QUÉ COMPRUEBA
#   NEGATIVA      sobre esa forma, los CUATRO gestos fallan con 42703. Si dejaran
#                 de fallar, el escenario no reproduce nada y el resto no prueba.
#   REPARACIÓN    tras la migración: los renombres quedaron sin perder datos, la
#                 foto pasó de text a jsonb dentro de un array (y la vacía a []),
#                 el respaldo `foto_url` sigue ahí, y los cuatro gestos pasan.
#   AMBIGÜEDAD    con las DOS columnas presentes (finalizado_en Y cerrado_en) la
#                 migración ABORTA en vez de elegir: habría datos en ambas.
#   IDEMPOTENCIA  re-aplicar no revierte ni duplica.
#
# USO
#   supabase/tests/drift_turnos/run.sh
# Requiere binarios de PostgreSQL. No toca ningún proyecto remoto.
# ════════════════════════════════════════════════════════════════════════════
set -euo pipefail

AQUI="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RAIZ="$(cd "$AQUI/../../.." && pwd)"
FIXTURE="$RAIZ/supabase/tests/limpieza_catalogos/fixture.sql"
MIG="$RAIZ/supabase/migrations/20260906000000_reparar_esquema_turnos_y_amenidades.sql"

for d in /usr/lib/postgresql/*/bin; do [ -d "$d" ] && PATH="$d:$PATH"; done
export PATH
command -v initdb >/dev/null || { echo "❌ falta initdb (instalá PostgreSQL)"; exit 1; }

DATA=$(mktemp -d /tmp/turnosdata.XXXX)
SOCK=$(mktemp -d /tmp/turnossock.XXXX)
PUERTO=${PGPORT_TEST:-55441}

limpiar() {
  pg_ctl -D "$DATA" stop -m immediate >/dev/null 2>&1 || true
  rm -rf "$DATA" "$SOCK"
}
trap limpiar EXIT

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
psql -q -d postgres -c "CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;" >/dev/null 2>&1 || true

silencio() { PGOPTIONS="-c client_min_messages=warning" psql -q -v ON_ERROR_STOP=1 "$@"; }

escenario() {
  psql -q -d postgres -c "CREATE DATABASE $1" >/dev/null
  silencio -d "$1" -f "$FIXTURE" >/dev/null
  silencio -d "$1" -f "$AQUI/pre_produccion.sql" >/dev/null
}

echo "── 1/5 · reproducir la forma real de producción ────────────────────────"
for db in turnos turnosneg turnosamb; do escenario "$db"; done
# Escenario opuesto: el esquema tal como lo declara el repositorio.
psql -q -d postgres -c "CREATE DATABASE turnoslimpio" >/dev/null
silencio -d turnoslimpio -f "$FIXTURE" >/dev/null
silencio -d turnoslimpio -f "$AQUI/esquema_declarado.sql" >/dev/null
echo "  OK    bloques_turno con \`finalizado_en\`, tareas_bloque con \`completado_en\` y \`foto_url\`"
echo "  OK    amenidades_bloqueos sin \`notas\` ni \`created_by\`"

echo
echo "── 2/5 · NEGATIVA: los cuatro gestos fallan sobre esa forma ────────────"
gesto_falla() {
  local etiqueta="$1" sql="$2"
  local salida
  salida=$(psql -v ON_ERROR_STOP=1 -v VERBOSITY=verbose -d turnosneg -c "$sql" 2>&1) && {
    echo "❌ «$etiqueta» NO falló — el escenario no reproduce producción."
    exit 1
  }
  grep -q '42703' <<<"$salida" || {
    echo "❌ «$etiqueta» falló por otra causa (se esperaba 42703):"
    sed -n 's/.*ERROR:  /  /p' <<<"$salida"; exit 1
  }
  echo "  OK    $etiqueta → $(sed -n 's/.*ERROR:  //p' <<<"$salida" | head -1 | cut -c1-58)…"
}
gesto_falla "cerrar bloque" \
  "UPDATE public.bloques_turno SET cerrado_en = now(), puntaje_completitud = 80"
gesto_falla "agregar tarea" \
  "INSERT INTO public.tareas_bloque (bloque_id, titulo, plantilla_id, requiere_foto) VALUES ('e2000000-0000-0000-0000-000000000001', 'x', NULL, false)"
gesto_falla "completar tarea" \
  "UPDATE public.tareas_bloque SET completada_en = now(), notas_operativo = 'x'"
gesto_falla "bloquear amenidad" \
  "INSERT INTO public.amenidades_bloqueos (company_id, project_id, amenidad_id, fecha_inicio, fecha_fin, notas) VALUES ('aaaaaaaa-0000-0000-0000-000000000001', '11111111-0000-0000-0000-000000000001', 'e1000000-0000-0000-0000-000000000001', DATE '2026-09-01', DATE '2026-09-02', 'x')"

echo
echo "── 3/5 · aplicar la reparación ─────────────────────────────────────────"
silencio -d turnos -f "$MIG" >/dev/null
echo "  OK    20260906000000_reparar_esquema_turnos_y_amenidades.sql"

echo
echo "── 4/5 · invariantes ───────────────────────────────────────────────────"
SALIDA=$(psql -q -v ON_ERROR_STOP=1 -d turnos -f "$AQUI/assert.sql" 2>&1) || {
  sed -n 's/.*NOTICE:  /  /p' <<<"$SALIDA"
  echo; echo "❌ invariante incumplida:"
  sed -n 's/.*ERROR:  /  /p' <<<"$SALIDA"
  exit 1
}
sed -n 's/.*NOTICE:  /  /p' <<<"$SALIDA"
if grep -q 'WARNING:' <<<"$SALIDA"; then
  echo; echo "❌ algo se tragó un error:"
  sed -n 's/.*WARNING:  /  ⚠ /p' <<<"$SALIDA"; exit 1
fi

echo
echo "── 5/5 · ambigüedad + idempotencia ─────────────────────────────────────"
# Las dos columnas a la vez: renombrar descartaría los datos de una de ellas.
silencio -d turnosamb -c "ALTER TABLE public.bloques_turno ADD COLUMN cerrado_en timestamptz" >/dev/null
SALIDA=$(psql --single-transaction -v ON_ERROR_STOP=1 -d turnosamb -f "$MIG" 2>&1) && {
  echo "❌ con finalizado_en Y cerrado_en presentes, la migración eligió sola."
  exit 1
}
grep -q 'ESQUEMA_TURNOS' <<<"$SALIDA" || {
  echo "❌ abortó por otra causa:"; sed -n 's/.*ERROR:  /  /p' <<<"$SALIDA"; exit 1; }
grep -q 'existen LAS DOS' <<<"$SALIDA" || {
  echo "❌ el error no explica la ambigüedad:"; sed -n 's/.*ERROR:  /  /p' <<<"$SALIDA"; exit 1; }
echo "  OK    con las dos columnas presentes aborta y dice por qué"

silencio -d turnos -f "$MIG" >/dev/null
SALIDA=$(psql -tAq -v ON_ERROR_STOP=1 -d turnos -c "
  SELECT CASE
    WHEN (SELECT foto_urls FROM public.tareas_bloque WHERE id = 'e3000000-0000-0000-0000-000000000001')
         <> '[\"p1/turnos/foto1.jpg\"]'::jsonb THEN 'foto duplicada o perdida al re-aplicar'
    WHEN (SELECT count(*) FROM public.tareas_bloque WHERE bloque_id = 'e2000000-0000-0000-0000-000000000001') <> 3
      THEN 'las tareas cambiaron de número al re-aplicar'
    WHEN (SELECT puntaje_completitud FROM public.bloques_turno WHERE id = 'e2000000-0000-0000-0000-000000000001') <> 80
      THEN 're-aplicar borró el puntaje'
    ELSE 'ok' END" 2>&1)
if [ "$(tr -d '[:space:]' <<<"$SALIDA")" != "ok" ]; then
  echo "❌ la re-aplicación cambió algo: $SALIDA"; exit 1
fi
echo "  OK    re-aplicar no revierte ni duplica"

# NO-OP sobre esquema limpio. Es la afirmación más frágil de la cabecera de la
# migración: si ahí hiciera algo, rompería justo los entornos que están sanos
# —el sandbox de los E2E, el Preview, un restore—.
silencio -d turnoslimpio -f "$MIG" >/dev/null
SALIDA=$(psql -tAq -v ON_ERROR_STOP=1 -d turnoslimpio -c "
  SELECT CASE
    WHEN (SELECT foto_urls FROM public.tareas_bloque WHERE id = 'e3000000-0000-0000-0000-000000000001')
         <> '[\"a.jpg\",\"b.jpg\"]'::jsonb THEN 'pisó una lista de dos fotos'
    WHEN (SELECT completada_en FROM public.tareas_bloque WHERE id = 'e3000000-0000-0000-0000-000000000001')
         IS DISTINCT FROM TIMESTAMPTZ '2026-08-01 10:00Z' THEN 'alteró completada_en'
    WHEN (SELECT puntaje_completitud FROM public.bloques_turno WHERE id = 'e2000000-0000-0000-0000-000000000001') <> 75
      THEN 'alteró el puntaje'
    WHEN EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = 'public.tareas_bloque'::regclass
                  AND attname = 'foto_url' AND NOT attisdropped) THEN 'creó foto_url donde no existía'
    ELSE 'ok' END" 2>&1)
if [ "$(tr -d '[:space:]' <<<"$SALIDA")" != "ok" ]; then
  echo "❌ NO es no-op sobre esquema limpio: $SALIDA"; exit 1
fi
echo "  OK    sobre el esquema declarado es un no-op (no toca datos ni crea columnas)"

echo
echo "✅ drift_turnos: los cuatro gestos rotos reproducidos y cerrados —"
echo "   renombres sin pérdida, evidencia migrada a jsonb con respaldo,"
echo "   ambigüedad que aborta, y serie idempotente."
