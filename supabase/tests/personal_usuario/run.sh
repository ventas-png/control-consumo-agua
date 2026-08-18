#!/usr/bin/env bash
# ════════════════════════════════════════════════════════════════════════════
# Verificación EJECUTABLE de la migración 20260826000000: el vínculo entre el
# expediente del empleado (`personal_condominio`) y su cuenta de ingreso
# (`app_users`).
#
# POR QUÉ EXISTE
# El valor del vínculo es que sea CONFIABLE: sobre él se van a colgar la
# asignación de tareas y la lectura de "qué ejecutó cada quien". Un vínculo
# duplicado o cruzado entre empresas no se ve —la columna se llena igual— y
# firmaría los actos de una persona con el expediente de otra. Las tres reglas
# que lo sostienen viven en la BD (índice único parcial, trigger de empresa, FK
# ON DELETE SET NULL) y ninguna se puede comprobar leyendo el SQL: dependen de
# cómo se comportan al escribir.
#
# QUÉ COMPRUEBA (22 invariantes)
#   1-3    la columna es opcional, apunta a app_users y es ON DELETE SET NULL
#   4-7    una cuenta = un expediente POR CONDOMINIO; varios sin cuenta conviven;
#          borrar la cuenta deja el expediente vivo
#   8-9    el trigger corta el vínculo cross-tenant en INSERT y en UPDATE
#   10-18  el catálogo del selector: a quién lista (ni residentes ni otra
#          empresa), qué reporta (correo, empleado que ya la tomó, acceso al
#          proyecto por cada cuenta) y a quién le contesta (permiso del tab,
#          empresa del proyecto, proyecto inexistente)
#   19-22  la ACL: anon no ejecuta el catálogo, authenticated sí, la función
#          trigger no es invocable por nadie — y aun así el trigger dispara
#
# USO
#   supabase/tests/personal_usuario/run.sh
# Requiere binarios de PostgreSQL (initdb/pg_ctl/psql). No toca ningún proyecto
# remoto: levanta un cluster temporal, corre todo y lo destruye.
# ════════════════════════════════════════════════════════════════════════════
set -euo pipefail

AQUI="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RAIZ="$(cd "$AQUI/../../.." && pwd)"
MIGRACION="$RAIZ/supabase/migrations/20260826000000_personal_usuario_de_ingreso.sql"

# Los binarios no siempre están en PATH (en Debian/Ubuntu viven versionados).
for d in /usr/lib/postgresql/*/bin; do [ -d "$d" ] && PATH="$d:$PATH"; done
export PATH
command -v initdb >/dev/null || { echo "❌ falta initdb (instalá PostgreSQL)"; exit 1; }

# El socket unix tiene un tope de 107 bytes: se usa una ruta corta a propósito.
DATA=$(mktemp -d /tmp/perdata.XXXX)
SOCK=$(mktemp -d /tmp/persock.XXXX)
PUERTO=${PGPORT_TEST:-55439}

# Postgres se niega a correr como root; si lo somos, se delega en el usuario
# `postgres` del sistema. El apagado se delega IGUAL que el arranque: con
# `pg_ctl` a secas, como root falla en silencio y el cluster queda vivo ocupando
# el puerto, de modo que la corrida siguiente parece un fallo del harness.
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
psql -q -d postgres -c "CREATE DATABASE personal" >/dev/null
# anon/authenticated no existen en un Postgres pelado; la migración les revoca y
# otorga privilegios por nombre de rol.
psql -q -d personal -c "CREATE ROLE anon; CREATE ROLE authenticated;" >/dev/null 2>&1 || true

aplicar() {
  PGOPTIONS="-c client_min_messages=warning" psql -q -v ON_ERROR_STOP=1 -d personal -f "$1" >/dev/null
}

echo "── 1/3 · fixture: esquema y cuentas de la empresa ──────────────────────"
aplicar "$AQUI/fixture.sql"
echo "  OK    stubs + 8 cuentas + 2 condominios + 4 expedientes"

echo "── 2/3 · migración 20260826000000, aplicada DOS veces (idempotente) ────"
aplicar "$MIGRACION"
aplicar "$MIGRACION"
echo "  OK    re-aplicar no falla"

echo "── 3/3 · invariantes ───────────────────────────────────────────────────"
# `|| CODIGO=$?` en vez de dejar que `set -e` mate el script: si psql falla y no
# se captura, el harness muere ANTES de imprimir nada y el fallo se ve como una
# salida vacía.
CODIGO=0
SALIDA=$(psql -q -v ON_ERROR_STOP=1 -d personal -f "$AQUI/assert.sql" 2>&1) || CODIGO=$?
echo "$SALIDA" | sed -n 's/.*NOTICE:  /  /p'

if [ "$CODIGO" -ne 0 ]; then
  echo
  echo "❌ una invariante no se cumple:"
  echo "$SALIDA" | sed -n 's/.*ERROR:  /  /p'
  exit 1
fi

echo
echo "✅ personal_usuario: el vínculo es único por condominio, no cruza empresas y su catálogo solo lo ve quien tiene el permiso del tab."
