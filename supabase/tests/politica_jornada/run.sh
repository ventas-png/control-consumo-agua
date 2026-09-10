#!/usr/bin/env bash
# ════════════════════════════════════════════════════════════════════════════
# Verificación EJECUTABLE de 20260909000100: la vara de la jornada (Fase 1).
#
# POR QUÉ EXISTE
# Esta migración es INERTE por diseño: declara qué se espera de cada jornada y
# nada más. La invariante 1 es la que justifica el test entero — comprueba que
# `calcular_horas_personal` devuelva EXACTAMENTE la misma fila antes y después
# de declarar la vara completa. Una migración que se anuncia sin efectos y mueve
# la planilla es el fallo que no se ve hasta que alguien cobra de menos.
#
# Lo otro que solo se puede comprobar ejecutando: que la vara se CONGELE en el
# bloque. Cambiar la jornada mañana no puede reescribir contra qué se midió un
# mes ya cerrado, y eso no se lee en el SQL — hay que cambiarla y mirar.
#
# QUÉ COMPRUEBA (14 invariantes)
#   1      declarar la vara no mueve ni un número del cómputo
#   2-4    el bloque congela los tres tramos, los cupos y la autorización; la
#          jornada cambia sin tocarlos, y el bloque nuevo sí toma la vigente
#   5-8    ni cerrar el turno refresca la foto, ni se rellena hacia atrás; un
#          bloque sin jornada dice NULL en vez de inventarse una vara
#   9-10   los tres tramos quedan expresables sin inventar un segundo umbral, y
#          la vara la escribe el servidor, no el cliente
#   11-14  la gobierna el permiso del tab de turnos, las funciones internas no
#          se le conceden a nadie, y el cupo deja rastro en la bitácora
#
# USO
#   supabase/tests/politica_jornada/run.sh
# Requiere binarios de PostgreSQL (initdb/pg_ctl/psql). No toca ningún proyecto
# remoto: levanta un cluster temporal, corre todo y lo destruye.
# ════════════════════════════════════════════════════════════════════════════
set -euo pipefail

AQUI="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RAIZ="$(cd "$AQUI/../../.." && pwd)"
MIGRACION_1="$RAIZ/supabase/migrations/20260908000000_presencia_marcaje_autoservicio.sql"
MIGRACION_2="$RAIZ/supabase/migrations/20260908000200_presencia_correccion_y_anulacion.sql"
MIGRACION_3="$RAIZ/supabase/migrations/20260908000300_presencia_pausas.sql"
# Las tres de presencia van antes porque la invariante 1 mide con
# `calcular_horas_personal` en su versión vigente, la que ya descuenta pausas.
MIGRACION_4="$RAIZ/supabase/migrations/20260909000100_politica_de_jornada.sql"

# Los binarios no siempre están en PATH (en Debian/Ubuntu viven versionados).
for d in /usr/lib/postgresql/*/bin; do [ -d "$d" ] && PATH="$d:$PATH"; done
export PATH
for d in ${PGBIN:-} /usr/lib/postgresql/*/bin; do [ -d "$d" ] && PATH="$d:$PATH"; done
export PATH
command -v initdb >/dev/null || { echo "❌ falta initdb (instalá PostgreSQL)"; exit 1; }

# El socket unix tiene un tope de 107 bytes: se usa una ruta corta a propósito.
DATA=$(mktemp -d /tmp/poldata.XXXX)
SOCK=$(mktemp -d /tmp/polsock.XXXX)
PUERTO=${PGPORT_TEST:-55451}

COMO=""
if [ "$(id -u)" = "0" ]; then
  id postgres >/dev/null 2>&1 || useradd -m postgres
  COMO="su postgres -c"
fi
correr() { if [ -n "$COMO" ]; then su postgres -c "PATH=$PATH $*"; else eval "$*"; fi; }

limpiar() {
  correr "pg_ctl -D $DATA stop -m immediate" >/dev/null 2>&1 || true
  rm -rf "$DATA" "$SOCK"
}
trap limpiar EXIT

if [ -n "$COMO" ]; then chown -R postgres "$DATA" "$SOCK"; fi

correr "initdb -D $DATA -U postgres --auth=trust" >/dev/null
correr "pg_ctl -D $DATA -o '-p $PUERTO -k $SOCK' -l $DATA/pg.log start" >/dev/null
sleep 2

export PGHOST="$SOCK" PGPORT="$PUERTO" PGUSER=postgres
psql -q -d postgres -c "CREATE DATABASE politica" >/dev/null
# anon/authenticated no existen en un Postgres pelado; la migración les revoca y
# otorga privilegios por nombre de rol, y las policies se ejercen como
# authenticated (que por eso necesita los grants de tabla).
psql -q -d politica -c "CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;" >/dev/null 2>&1 || true

aplicar() {
  PGOPTIONS="-c client_min_messages=warning" psql -q -v ON_ERROR_STOP=1 -d politica -f "$1" >/dev/null
}

echo "── 1/3 · fixture: esquema, cuentas y expedientes ───────────────────────"
aplicar "$AQUI/fixture.sql"
psql -q -d politica -c "
  GRANT USAGE ON SCHEMA public, auth, storage TO authenticated, anon;
  GRANT SELECT, INSERT, UPDATE, DELETE ON storage.objects TO authenticated;
  GRANT SELECT ON storage.buckets, public.app_users, public.projects,
                  public.personal_condominio, public.presencia_personal TO authenticated;
" >/dev/null
echo "  OK    stubs + 6 cuentas + 2 condominios + 5 expedientes"

echo "── 2/3 · las migraciones (la nueva, DOS veces: idempotente) ───────────"
# Las dos anteriores se aplican UNA vez, como en producción: ya están
# desplegadas, y sus `CREATE OR REPLACE` de presencia_mi_ficha declaran menos
# columnas OUT que la nueva — re-aplicarlas DESPUÉS fallaría, y ese fallo sería
# del harness, no del cambio. La que tiene que ser idempotente es la NUEVA.
aplicar "$MIGRACION_1"
aplicar "$MIGRACION_2"
aplicar "$MIGRACION_3"
for _ in 1 2; do aplicar "$MIGRACION_4"; done
# Los grants de TABLA van aquí porque antes las tablas no existen. Las
# invariantes 11 y 12 comprueban que el CUPO lo gobierne la POLICY y no la falta
# de un grant: authenticated recibe los mismos privilegios que le da Supabase.
psql -q -d politica -c "
  GRANT SELECT, INSERT, UPDATE, DELETE ON public.plantilla_cupos_pausa TO authenticated;
  GRANT SELECT ON public.plantillas_horario, public.bloques_turno TO authenticated;
" >/dev/null
echo "  OK    re-aplicar la migración nueva no falla"

echo "── 3/3 · invariantes ───────────────────────────────────────────────────"
# `|| CODIGO=$?` en vez de dejar que `set -e` mate el script: si psql falla y no
# se captura, el harness muere ANTES de imprimir nada y el fallo se ve como una
# salida vacía.
CODIGO=0
SALIDA=$(psql -q -v ON_ERROR_STOP=1 -d politica -f "$AQUI/assert.sql" 2>&1) || CODIGO=$?
echo "$SALIDA" | sed -n 's/.*NOTICE:  /  /p'

if [ "$CODIGO" -ne 0 ]; then
  echo
  echo "❌ una invariante no se cumple:"
  echo "$SALIDA" | sed -n 's/.*ERROR:  /  /p'
  exit 1
fi

echo
echo "✅ politica_jornada: la vara queda declarada y CONGELADA en cada bloque, sin mover ni un número del cómputo de horas."
