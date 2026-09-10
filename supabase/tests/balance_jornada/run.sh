#!/usr/bin/env bash
# ════════════════════════════════════════════════════════════════════════════
# Verificación EJECUTABLE de 20260910000300: el balance del día (Fase 2).
#
# POR QUÉ EXISTE
# La invariante 1 vuelve a ser la que justifica el test entero: esta migración
# se anuncia como LECTURA, y comprueba que consultar el balance no mueva la fila
# de `calcular_horas_personal`. Lo demás es que la lectura sea CORRECTA, que es
# donde un error no se ve: un tramo mal clasificado o un exceso de descanso mal
# comparado no rompen nada, solo producen un juicio equivocado sobre una persona.
#
# Dos casos que sólo se ven ejecutando:
#   · el exceso de descanso se mide TIPO A TIPO. Comparar el total contra la
#     suma de cupos le regala a quien se toma 90 min de almuerzo la refacción
#     que no se tomó (invariante 6).
#   · la medianoche. Entrar a las 00:30 a un turno de las 22:00 son 150 minutos
#     tarde; una resta a pelo da −1290 (invariante 8), que es la familia de
#     error de #839.
#
# QUÉ COMPRUEBA (28 invariantes)
#   0-1    el escenario, y que consultar el balance no mueva el cómputo de horas
#   2-5    un día que cumple; los tres tramos de la demora; llegar antes no es
#          desvío; la salida temprana respeta su tolerancia
#   6-7    el exceso de descanso, tipo a tipo, y que un tipo sin cupo declarado
#          no invente exceso —no declarar no es declarar cero—
#   8      la medianoche
#   9-11   sin vara no se juzga, el día planificado sin cubrir aparece, y la
#          jornada abierta no sale como cumplida
#   12-13  la extra se SEÑALA sin reconocerse, y lo anulado no se juzga
#   14-15  la ACL —anon no, service_role tampoco— y el permiso del tab
#   16-17b el turno nocturno con fecha, el partido que suma sus bloques, y dos
#          varas distintas que no son una vara
#   18     `cumple` ⇔ sin hallazgos, comprobado sobre TODAS las filas
#   19-21  21:50 en un turno de las 22:00 es llegar temprano; el manual que no
#          se puede ubicar se dice ambiguo; con instante exacto no se deduce
#   22-22b varios marcajes el mismo día se agregan, y basta uno abierto
#   23-24  el ALCANCE POR PROYECTO: el mismo permiso en la misma empresa no abre
#          el condominio ajeno (42501), super_admin conserva lo previsto, y un
#          proyecto inexistente o NULL da 42704 en vez de colarse
#
# USO
#   supabase/tests/balance_jornada/run.sh
# Requiere binarios de PostgreSQL (initdb/pg_ctl/psql). No toca ningún proyecto
# remoto: levanta un cluster temporal, corre todo y lo destruye.
# ════════════════════════════════════════════════════════════════════════════
set -euo pipefail

AQUI="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RAIZ="$(cd "$AQUI/../../.." && pwd)"
MIGRACION_1="$RAIZ/supabase/migrations/20260908000000_presencia_marcaje_autoservicio.sql"
MIGRACION_2="$RAIZ/supabase/migrations/20260908000200_presencia_correccion_y_anulacion.sql"
MIGRACION_3="$RAIZ/supabase/migrations/20260908000300_presencia_pausas.sql"
MIGRACION_4="$RAIZ/supabase/migrations/20260910000200_politica_de_jornada.sql"
# El balance cruza toda la cadena, así que las cuatro anteriores van antes.
MIGRACION_5="$RAIZ/supabase/migrations/20260910000300_balance_de_jornada.sql"

# Los binarios no siempre están en PATH (en Debian/Ubuntu viven versionados).
for d in /usr/lib/postgresql/*/bin; do [ -d "$d" ] && PATH="$d:$PATH"; done
export PATH
for d in ${PGBIN:-} /usr/lib/postgresql/*/bin; do [ -d "$d" ] && PATH="$d:$PATH"; done
export PATH
command -v initdb >/dev/null || { echo "❌ falta initdb (instalá PostgreSQL)"; exit 1; }

# El socket unix tiene un tope de 107 bytes: se usa una ruta corta a propósito.
DATA=$(mktemp -d /tmp/baldata.XXXX)
SOCK=$(mktemp -d /tmp/balsock.XXXX)
PUERTO=${PGPORT_TEST:-55455}

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
psql -q -d postgres -c "CREATE DATABASE balance" >/dev/null
# anon/authenticated no existen en un Postgres pelado; la migración les revoca y
# otorga privilegios por nombre de rol, y las policies se ejercen como
# authenticated (que por eso necesita los grants de tabla).
psql -q -d balance -c "CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;" >/dev/null 2>&1 || true

aplicar() {
  PGOPTIONS="-c client_min_messages=warning" psql -q -v ON_ERROR_STOP=1 -d balance -f "$1" >/dev/null
}

echo "── 1/3 · fixture: esquema, cuentas y expedientes ───────────────────────"
aplicar "$AQUI/fixture.sql"
psql -q -d balance -c "
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
aplicar "$MIGRACION_4"
for _ in 1 2; do aplicar "$MIGRACION_5"; done
# Los grants de TABLA van aquí porque antes las tablas no existen. Las
# invariantes 11 y 12 comprueban que el CUPO lo gobierne la POLICY y no la falta
# de un grant: authenticated recibe los mismos privilegios que le da Supabase.
psql -q -d balance -c "
  GRANT SELECT, INSERT, UPDATE, DELETE ON public.plantilla_cupos_pausa TO authenticated;
  GRANT SELECT ON public.plantillas_horario, public.bloques_turno TO authenticated;
" >/dev/null
echo "  OK    re-aplicar la migración nueva no falla"

echo "── 3/3 · invariantes ───────────────────────────────────────────────────"
# `|| CODIGO=$?` en vez de dejar que `set -e` mate el script: si psql falla y no
# se captura, el harness muere ANTES de imprimir nada y el fallo se ve como una
# salida vacía.
CODIGO=0
SALIDA=$(psql -q -v ON_ERROR_STOP=1 -d balance -f "$AQUI/assert.sql" 2>&1) || CODIGO=$?
echo "$SALIDA" | sed -n 's/.*NOTICE:  /  /p'

if [ "$CODIGO" -ne 0 ]; then
  echo
  echo "❌ una invariante no se cumple:"
  echo "$SALIDA" | sed -n 's/.*ERROR:  /  /p'
  exit 1
fi

echo
echo "✅ balance_jornada: lo esperado y lo ocurrido, uno al lado del otro —demora por tramos, exceso de descanso tipo a tipo y la medianoche resuelta— sin mover ni un número de la planilla."
