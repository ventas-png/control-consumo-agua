#!/usr/bin/env bash
# ════════════════════════════════════════════════════════════════════════════
# Verificación EJECUTABLE de las migraciones 20260828000000 y 20260828000200:
# la solicitud de autorización de renta que viaja con los datos del contrato y
# los documentos anexos, y el RPC que la aprueba creando el contrato.
#
# POR QUÉ EXISTE
# El valor de la feature es que la administración pueda aprobar y quedarse con
# el contrato YA creado, sin re-teclear. Eso solo sirve si la copia es fiel y si
# nadie más puede dispararla: el RPC es SECURITY DEFINER, así que corre con los
# privilegios del dueño y su único control de acceso es el gate que lleva
# adentro. Ninguna de las dos cosas —la fidelidad de la copia, ni el gate— se
# comprueba leyendo el SQL: dependen de cómo se comporta al escribir.
#
# QUÉ COMPRUEBA (17 invariantes)
#   1-5    las columnas nuevas, el array vacío por defecto y los tres CHECK
#          (tope de 8 adjuntos, día de pago 1-28, período no invertido)
#   6-7    la policy de insert del portal exige contrato_id IS NULL y conserva
#          el gate de estado pendiente
#   8-11   aprobar copia los datos 1:1 al contrato, lo enlaza, deja la
#          solicitud resuelta, y respeta p_crear_contrato = false
#   12-14  no crea contrato con STR ni con datos incompletos, y no re-resuelve
#   15-17  la ACL: ni el propietario ni otra empresa resuelven; anon no ejecuta
#
# USO
#   supabase/tests/solicitud_renta_contrato/run.sh
# Requiere binarios de PostgreSQL (initdb/pg_ctl/psql). No toca ningún proyecto
# remoto: levanta un cluster temporal, corre todo y lo destruye.
# ════════════════════════════════════════════════════════════════════════════
set -euo pipefail

AQUI="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RAIZ="$(cd "$AQUI/../../.." && pwd)"
MIG_COLS="$RAIZ/supabase/migrations/20260828000000_solicitud_renta_datos_contrato.sql"
MIG_RPC="$RAIZ/supabase/migrations/20260828000200_aprobar_solicitud_renta_rpc.sql"

# Los binarios no siempre están en PATH (en Debian/Ubuntu viven versionados).
for d in /usr/lib/postgresql/*/bin; do [ -d "$d" ] && PATH="$d:$PATH"; done
export PATH
command -v initdb >/dev/null || { echo "❌ falta initdb (instalá PostgreSQL)"; exit 1; }

# El socket unix tiene un tope de 107 bytes: se usa una ruta corta a propósito.
DATA=$(mktemp -d /tmp/rentadata.XXXX)
SOCK=$(mktemp -d /tmp/rentasock.XXXX)
PUERTO=${PGPORT_TEST:-55441}

# Postgres se niega a correr como root; si lo somos, se delega en el usuario
# `postgres` del sistema (el apagado se delega igual, o el cluster queda vivo
# ocupando el puerto y la corrida siguiente parece un fallo del harness).
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
psql -q -d postgres -c "CREATE DATABASE renta" >/dev/null
# anon/authenticated no existen en un Postgres pelado; el RPC les revoca y
# otorga privilegios por nombre de rol.
psql -q -d renta -c "CREATE ROLE anon; CREATE ROLE authenticated;" >/dev/null 2>&1 || true

aplicar() {
  PGOPTIONS="-c client_min_messages=warning" psql -q -v ON_ERROR_STOP=1 -d renta -f "$1" >/dev/null
}

echo "── 1/3 · fixture: esquema, unidades y cuentas ──────────────────────────"
aplicar "$AQUI/fixture.sql"
echo "  OK    stubs + 3 unidades + 3 cuentas + policy previa del portal"

echo "── 2/3 · migraciones 20260828000000/200, aplicadas DOS veces ───────────"
aplicar "$MIG_COLS"; aplicar "$MIG_RPC"
aplicar "$MIG_COLS"; aplicar "$MIG_RPC"
echo "  OK    re-aplicar no falla (idempotentes)"

echo "── 3/3 · invariantes ───────────────────────────────────────────────────"
# `|| CODIGO=$?` en vez de dejar que `set -e` mate el script: si psql falla y no
# se captura, el harness muere ANTES de imprimir nada y el fallo se ve como una
# salida vacía.
CODIGO=0
SALIDA=$(psql -q -v ON_ERROR_STOP=1 -d renta -f "$AQUI/assert.sql" 2>&1) || CODIGO=$?
echo "$SALIDA" | sed -n 's/.*NOTICE:  /  /p'

if [ "$CODIGO" -ne 0 ]; then
  echo
  echo "❌ una invariante no se cumple:"
  echo "$SALIDA" | sed -n 's/.*ERROR:  /  /p'
  exit 1
fi

echo
echo "✅ solicitud_renta_contrato: la solicitud viaja con datos y adjuntos, aprobar copia el contrato 1:1, y solo lo dispara quien tiene el permiso del tab en su propia empresa."
