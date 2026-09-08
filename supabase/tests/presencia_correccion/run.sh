#!/usr/bin/env bash
# ════════════════════════════════════════════════════════════════════════════
# Verificación EJECUTABLE de 20260908000200: corregir un marcaje con nombre y
# motivo, y anular en vez de borrar.
#
# POR QUÉ EXISTE
# Corregir asistencia es tocar la planilla, y las tres garantías que lo hacen
# aceptable no se ven leyendo el SQL:
#
#   · Que el MOTIVO sea de verdad obligatorio. Es lo único que separa una
#     corrección legítima de una manipulación, y un CHECK no lo cubre: hay que
#     intentar corregir sin él y ver que se rechaza.
#   · Que corregir NO toque la evidencia. La foto y el GPS son del marcaje
#     original; si una corrección los arrastrara, la prueba dejaría de probar.
#   · Que ANULAR signifique algo. Sin el filtro en `calcular_horas_personal`,
#     una fila anulada seguiría sumando horas y la anulación sería un adorno.
#     La invariante 13 mide las horas ANTES y DESPUÉS de anular.
#
# Y que corregir y anular sean permisos DISTINTOS: el fixture le da a un
# supervisor `.edit` sin `.delete` justo para comprobar que no puede invalidar
# una jornada entera.
#
# QUÉ COMPRUEBA (19 invariantes)
#   1-4    corregir exige permiso, motivo (y no un «.»), hora de entrada y un
#          estado del vocabulario
#   5-7    aplica las horas, sella quién/cuándo/por qué, y deja intactos la
#          foto, el GPS, el origen, el empleado y la fecha
#   8      mandar NULL en la salida reabre una jornada cerrada por error
#   9-12   anular exige `.delete` y motivo, sella, y NO borra la fila
#   13     el cómputo de horas cuenta la jornada corregida y deja de contarla
#          en cuanto se anula
#   14-15  no se anula dos veces ni se corrige lo anulado
#   16     tras anular, la persona puede volver a marcar ese día
#   17-19  la ACL: anon nada; authenticated las dos RPC; las guardas internas no
#
# USO
#   supabase/tests/presencia_correccion/run.sh
# Requiere binarios de PostgreSQL (initdb/pg_ctl/psql). No toca ningún proyecto
# remoto: levanta un cluster temporal, corre todo y lo destruye.
# ════════════════════════════════════════════════════════════════════════════
set -euo pipefail

AQUI="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RAIZ="$(cd "$AQUI/../../.." && pwd)"
MIGRACION_1="$RAIZ/supabase/migrations/20260908000000_presencia_marcaje_autoservicio.sql"
# La de corrección redeclara presencia_mi_ficha, que llama a dos helpers de la
# primera: van en orden, como en producción.
MIGRACION_2="$RAIZ/supabase/migrations/20260908000200_presencia_correccion_y_anulacion.sql"

# Los binarios no siempre están en PATH (en Debian/Ubuntu viven versionados).
for d in /usr/lib/postgresql/*/bin; do [ -d "$d" ] && PATH="$d:$PATH"; done
export PATH
command -v initdb >/dev/null || { echo "❌ falta initdb (instalá PostgreSQL)"; exit 1; }

# El socket unix tiene un tope de 107 bytes: se usa una ruta corta a propósito.
DATA=$(mktemp -d /tmp/corrdata.XXXX)
SOCK=$(mktemp -d /tmp/corrsock.XXXX)
PUERTO=${PGPORT_TEST:-55443}

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
psql -q -d postgres -c "CREATE DATABASE correccion" >/dev/null
# anon/authenticated no existen en un Postgres pelado; la migración les revoca y
# otorga privilegios por nombre de rol, y las policies se ejercen como
# authenticated (que por eso necesita los grants de tabla).
psql -q -d correccion -c "CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;" >/dev/null 2>&1 || true

aplicar() {
  PGOPTIONS="-c client_min_messages=warning" psql -q -v ON_ERROR_STOP=1 -d correccion -f "$1" >/dev/null
}

echo "── 1/3 · fixture: esquema, cuentas y expedientes ───────────────────────"
aplicar "$AQUI/fixture.sql"
psql -q -d correccion -c "
  GRANT USAGE ON SCHEMA public, auth, storage TO authenticated, anon;
  GRANT SELECT, INSERT, UPDATE, DELETE ON storage.objects TO authenticated;
  GRANT SELECT ON storage.buckets, public.app_users, public.projects,
                  public.personal_condominio, public.presencia_personal TO authenticated;
" >/dev/null
echo "  OK    stubs + 6 cuentas + 2 condominios + 5 expedientes"

echo "── 2/3 · las migraciones (la nueva, DOS veces: idempotente) ───────────"
# La primera se aplica UNA vez, como en producción: ya está desplegada y su
# `CREATE OR REPLACE` de presencia_mi_ficha declara 15 columnas OUT, así que
# re-aplicarla DESPUÉS de la segunda (que la deja en 18) fallaría — y ese fallo
# sería del harness, no del cambio. La que tiene que ser idempotente es la NUEVA.
aplicar "$MIGRACION_1"
for _ in 1 2; do aplicar "$MIGRACION_2"; done
echo "  OK    re-aplicar la migración nueva no falla"

echo "── 3/3 · invariantes ───────────────────────────────────────────────────"
# `|| CODIGO=$?` en vez de dejar que `set -e` mate el script: si psql falla y no
# se captura, el harness muere ANTES de imprimir nada y el fallo se ve como una
# salida vacía.
CODIGO=0
SALIDA=$(psql -q -v ON_ERROR_STOP=1 -d correccion -f "$AQUI/assert.sql" 2>&1) || CODIGO=$?
echo "$SALIDA" | sed -n 's/.*NOTICE:  /  /p'

if [ "$CODIGO" -ne 0 ]; then
  echo
  echo "❌ una invariante no se cumple:"
  echo "$SALIDA" | sed -n 's/.*ERROR:  /  /p'
  exit 1
fi

echo
echo "✅ presencia_correccion: corregir deja huella y no toca la evidencia, anular no borra y —lo que le da sentido— saca las horas de la planilla."
