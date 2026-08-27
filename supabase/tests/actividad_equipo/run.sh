#!/usr/bin/env bash
# ════════════════════════════════════════════════════════════════════════════
# Verificación EJECUTABLE de 20260906000200: el sellado y la RPC de actividad
#
# POR QUÉ EXISTE
# 20260906000000 renombró `tareas_bloque.completado_en` → `completada_en`, y el
# renombre fue correcto: PostgreSQL arrastra solos los índices, las policies,
# las constraints y las vistas. Pero NO arrastra los cuerpos plpgsql —son
# texto— ni los argumentos de un trigger —son literales—. Quedaron dos cosas
# rotas en producción:
#
#   · `actividad_equipo` lee `tb.completado_en` y revienta con 42703
#   · `trg_sellar_cierre` sella por `completado_en`, clave que ya no existe;
#     `sellar_cierre` la lee con `to_jsonb(OLD)->>` así que devuelve NULL y
#     deja de sellar EN SILENCIO
#
# Ninguna guarda de esquema podía verlo: comprueban que lo declarado exista,
# no que los cuerpos sigan resolviendo. La única forma de comprobarlo es
# EJECUTAR la RPC y COMPLETAR una tarea, que es lo que hace este sandbox.
#
# LOS DOS MUNDOS, porque el arreglo tiene que valer en ambos:
#   producción       `completado_por` existe (el bucle de 20260731000000 sí
#                    encontró su hito) y el trigger quedó con el nombre viejo
#   esquema declarado `completado_por` NO existe: allí la columna se llama
#                    `completada_en`, el bucle hace CONTINUE y nunca la crea.
#                    Sin arreglar eso, la RPC tampoco puede correr en una base
#                    nueva — el sandbox de los E2E, el Preview, un restore.
#
# USO
#   supabase/tests/actividad_equipo/run.sh
# Requiere binarios de PostgreSQL. No toca ningún proyecto remoto.
# ════════════════════════════════════════════════════════════════════════════
set -euo pipefail

AQUI="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RAIZ="$(cd "$AQUI/../../.." && pwd)"
BASE="$RAIZ/supabase/tests/limpieza_catalogos/fixture.sql"
DECLARADO="$RAIZ/supabase/tests/drift_turnos/esquema_declarado.sql"
MIG="$RAIZ/supabase/migrations/20260906000200_reparar_sellado_y_actividad_tareas_bloque.sql"
ORIGEN="$RAIZ/supabase/migrations/20260829000600_recepcion_motor_unico.sql"

for d in /usr/lib/postgresql/*/bin; do [ -d "$d" ] && PATH="$d:$PATH"; done
export PATH
command -v initdb >/dev/null || { echo "❌ falta initdb (instalá PostgreSQL)"; exit 1; }

DATA=$(mktemp -d /tmp/actividaddata.XXXX)
SOCK=$(mktemp -d /tmp/actividadsock.XXXX)
VIEJA=$(mktemp /tmp/actividadvieja.XXXX.sql)
PUERTO=${PGPORT_TEST:-55443}

limpiar() {
  pg_ctl -D "$DATA" stop -m immediate >/dev/null 2>&1 || true
  rm -rf "$DATA" "$SOCK" "$VIEJA"
}
trap limpiar EXIT

# La versión VIEJA de la RPC se extrae del archivo real, no se copia aquí: si
# alguien la re-declara en otra migración, este sandbox seguiría probando
# contra la que nombra su cabecera y la mentira sería visible.
awk '/^CREATE OR REPLACE FUNCTION public\.actividad_equipo\(/{d=1} d{print} d&&/^\$\$;$/{exit}' \
  "$ORIGEN" > "$VIEJA"
grep -q 'tb\.completado_en' "$VIEJA" || {
  echo "❌ la definición extraída de 20260829000600 ya no lee tb.completado_en;"
  echo "   si se arregló allí, este sandbox sobra o hay que reapuntarlo."
  exit 1
}

COMO=""
if [ "$(id -u)" = "0" ]; then
  id postgres >/dev/null 2>&1 || useradd -m postgres
  chown -R postgres "$DATA" "$SOCK" "$VIEJA"
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
  silencio -d "$1" -f "$BASE"      >/dev/null
  silencio -d "$1" -f "$DECLARADO" >/dev/null
  silencio -d "$1" -f "$AQUI/fixture.sql" >/dev/null
}

echo "── 1/5 · montar los dos mundos ─────────────────────────────────────────"
for db in actividad actividadneg; do escenario "$db"; done
escenario actividadprod
silencio -d actividadprod -f "$AQUI/pre_produccion.sql" >/dev/null
echo "  OK    esquema declarado: completada_en, SIN completado_por"
echo "  OK    forma de producción: completado_por + trigger con el hito viejo"

echo
echo "── 2/5 · NEGATIVA: la RPC de hoy no puede ejecutarse ───────────────────"
silencio -d actividadneg -f "$VIEJA" >/dev/null
SALIDA=$(psql -v ON_ERROR_STOP=1 -v VERBOSITY=verbose -d actividadneg -c "
  SELECT set_config('app.uid', 'e0000000-0000-0000-0000-00000000000a', false);
  SELECT count(*) FROM public.actividad_equipo('11111111-0000-0000-0000-000000000001',
                                               DATE '2026-08-01', DATE '2026-08-31');" 2>&1) && {
  echo "❌ la RPC vieja NO falló — el escenario no reproduce el fallo."
  exit 1
}
grep -q '42703' <<<"$SALIDA" || {
  echo "❌ falló por otra causa (se esperaba 42703):"
  sed -n 's/.*ERROR:  /  /p' <<<"$SALIDA"; exit 1
}
# El mensaje, no el volcado: con VERBOSITY=verbose psql imprime también la
# consulta entera en el CONTEXT, y ahí `completado_por` aparece siempre —
# buscarlo en toda la salida daría por bueno un 42703 de cualquier otra tabla.
MENSAJE=$(sed -n 's/.*ERROR:  //p' <<<"$SALIDA" | head -1)
grep -qE 'completado_(en|por)' <<<"$MENSAJE" || {
  echo "❌ el 42703 no es por las columnas del cierre, sino: $MENSAJE"
  exit 1
}
echo "  OK    $(cut -c1-62 <<<"$MENSAJE")…"

echo
echo "── 3/5 · aplicar la reparación (dos veces: idempotencia) ───────────────"
for db in actividad actividadprod; do
  silencio -d "$db" -f "$MIG" >/dev/null
  silencio -d "$db" -f "$MIG" >/dev/null
done
echo "  OK    20260906000200 aplicada dos veces en los dos mundos"

echo
echo "── 4/5 · invariantes sobre la forma de PRODUCCIÓN ──────────────────────"
invariantes() {
  local db="$1"
  local salida
  salida=$(psql -q -v ON_ERROR_STOP=1 -d "$db" -f "$AQUI/assert.sql" 2>&1) || {
    sed -n 's/.*NOTICE:  /  /p' <<<"$salida"
    echo; echo "❌ invariante incumplida en $db:"
    sed -n 's/.*ERROR:  /  /p' <<<"$salida"
    exit 1
  }
  sed -n 's/.*NOTICE:  /  /p' <<<"$salida"
  if grep -q 'WARNING:' <<<"$salida"; then
    echo; echo "❌ algo se tragó un error:"
    sed -n 's/.*WARNING:  /  ⚠ /p' <<<"$salida"; exit 1
  fi
}
invariantes actividadprod

echo
echo "── 5/5 · las mismas invariantes sobre el ESQUEMA DECLARADO ─────────────"
# Aquí `completado_por` ni siquiera existía: si la migración no la creara, la
# RPC seguiría sin poder ejecutarse en una base nueva y la 4 caería.
invariantes actividad

echo
echo "✅ actividad_equipo: el sellado vuelve a ocurrir y la RPC vuelve a"
echo "   ejecutarse, en la base que venía de producción y en una nueva."
