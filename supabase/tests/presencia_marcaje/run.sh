#!/usr/bin/env bash
# ════════════════════════════════════════════════════════════════════════════
# Verificación EJECUTABLE de la migración 20260908000000: el empleado marca su
# propio turno, con foto, ubicación y hora del servidor.
#
# POR QUÉ EXISTE
# Todo el valor del autoservicio está en cosas que no se ven leyendo el SQL:
#
#   · Que la hora sea del SERVIDOR. Se comprueba comparando la fila con
#     `now()` en la zona del tenant — un parámetro colado se vería al instante.
#   · Que marcar NO exija el permiso de administrar la presencia. Es el punto
#     entero: el conserje no administra a nadie. La prueba lo ejerce con una
#     cuenta a la que el fixture no le dio ni un permiso.
#   · Que la evidencia sea de quien dice ser. Una foto colgada del expediente
#     de otro, o un path que nunca se subió, tienen que rechazarse; y las
#     policies del bucket solo se pueden ejercer desde el rol que las sufre,
#     no desde un SECURITY DEFINER que ve todo.
#   · Que la salida cierre el turno que empezó AYER. Un guardia de noche entra
#     el día 5 y sale el 6; buscar "la fila de hoy" dejaría la de ayer abierta
#     para siempre y la planilla sin esas ocho horas.
#
# QUÉ COMPRUEBA (21 invariantes)
#   1-3    la vía existe sin el permiso del tab, y fecha/hora/expediente los
#          pone la base
#   4-6    la evidencia: la foto propia y subida queda ligada; la ajena y la
#          inventada se rechazan
#   7-8    la ubicación se normaliza a {lat,lng,exactitud_m} o no se guarda
#   9-11   el turno nocturno, la salida sin entrada abierta y el doble marcaje
#   12-14  quién no puede marcar: sin expediente, con el expediente de baja, y
#          con expediente pero sin acceso a ese condominio
#   15     la tardanza sale de la tolerancia de la plantilla de horario
#   16-19  el bucket privado y sus policies: cada quien ve su foto, nadie la
#          sustituye, quien fichó no la borra y nadie sube bajo otro expediente
#   20-21  la ACL: anon no ejecuta nada, authenticated sí
#
# USO
#   supabase/tests/presencia_marcaje/run.sh
# Requiere binarios de PostgreSQL (initdb/pg_ctl/psql). No toca ningún proyecto
# remoto: levanta un cluster temporal, corre todo y lo destruye.
# ════════════════════════════════════════════════════════════════════════════
set -euo pipefail

AQUI="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RAIZ="$(cd "$AQUI/../../.." && pwd)"
MIGRACION="$RAIZ/supabase/migrations/20260908000000_presencia_marcaje_autoservicio.sql"

# Los binarios no siempre están en PATH (en Debian/Ubuntu viven versionados).
for d in /usr/lib/postgresql/*/bin; do [ -d "$d" ] && PATH="$d:$PATH"; done
export PATH
command -v initdb >/dev/null || { echo "❌ falta initdb (instalá PostgreSQL)"; exit 1; }

# El socket unix tiene un tope de 107 bytes: se usa una ruta corta a propósito.
DATA=$(mktemp -d /tmp/presdata.XXXX)
SOCK=$(mktemp -d /tmp/pressock.XXXX)
PUERTO=${PGPORT_TEST:-55441}

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
psql -q -d postgres -c "CREATE DATABASE presencia" >/dev/null
# anon/authenticated no existen en un Postgres pelado; la migración les revoca y
# otorga privilegios por nombre de rol, y las policies se ejercen como
# authenticated (que por eso necesita los grants de tabla).
psql -q -d presencia -c "CREATE ROLE anon; CREATE ROLE authenticated;" >/dev/null 2>&1 || true

aplicar() {
  PGOPTIONS="-c client_min_messages=warning" psql -q -v ON_ERROR_STOP=1 -d presencia -f "$1" >/dev/null
}

echo "── 1/3 · fixture: esquema, cuentas y expedientes ───────────────────────"
aplicar "$AQUI/fixture.sql"
psql -q -d presencia -c "
  GRANT USAGE ON SCHEMA public, auth, storage TO authenticated, anon;
  GRANT SELECT, INSERT, UPDATE, DELETE ON storage.objects TO authenticated;
  GRANT SELECT ON storage.buckets, public.app_users, public.projects,
                  public.personal_condominio, public.presencia_personal TO authenticated;
" >/dev/null
echo "  OK    stubs + 5 cuentas + 2 condominios + 4 expedientes"

echo "── 2/3 · la migración, aplicada DOS veces (idempotente) ────────────────"
for _ in 1 2; do aplicar "$MIGRACION"; done
echo "  OK    re-aplicar no falla"

echo "── 3/3 · invariantes ───────────────────────────────────────────────────"
# `|| CODIGO=$?` en vez de dejar que `set -e` mate el script: si psql falla y no
# se captura, el harness muere ANTES de imprimir nada y el fallo se ve como una
# salida vacía.
CODIGO=0
SALIDA=$(psql -q -v ON_ERROR_STOP=1 -d presencia -f "$AQUI/assert.sql" 2>&1) || CODIGO=$?
echo "$SALIDA" | sed -n 's/.*NOTICE:  /  /p'

if [ "$CODIGO" -ne 0 ]; then
  echo
  echo "❌ una invariante no se cumple:"
  echo "$SALIDA" | sed -n 's/.*ERROR:  /  /p'
  exit 1
fi

echo
echo "✅ presencia_marcaje: la hora la pone el servidor, marcar no exige administrar, la evidencia es de quien dice ser y el turno nocturno se cierra donde empezó."
