#!/usr/bin/env bash
# ════════════════════════════════════════════════════════════════════════════
# Verificación EJECUTABLE de la migración 20260906000400: el selector «Asignar
# Operador» de Rutas solo ofrece cuentas con acceso al proyecto de la ruta.
#
# POR QUÉ EXISTE
# El daño de este selector no se ve al guardar: la ruta queda con un operador
# válido a los ojos de la BD (`asignado_a` es un uuid de app_users y nada más),
# y solo aparece cuando esa persona abre la app y no encuentra los contadores
# —`rutas_select` le muestra la ruta por ser el asignado, `can_access_project`
# le niega los items—. La regla que lo evita es un filtro dentro de un RPC
# SECURITY DEFINER, y quién queda dentro o fuera depende de tres caminos de
# acceso distintos (rol exento, project_id legacy, asignación explícita) que no
# se pueden comprobar leyendo el SQL.
#
# QUÉ COMPRUEBA (19 invariantes)
#    1-5   usuario_acceso_a_proyecto: el espejo de can_access_project para una
#          cuenta cualquiera; nunca NULL, ni para una cuenta inexistente
#    6-11  a quién lista el catálogo y a quién no: acceso al proyecto, cuentas
#          inactivas, residentes, otra empresa, y el nombre de quien no lo tiene
#   12-16  a quién le contesta: permiso agua.rutas.view, empresa del proyecto,
#          alcance del llamador y proyecto inexistente
#   17-18  la ACL: anon no ejecuta el catálogo; el helper no lo ejecuta nadie
#      19  el catálogo del tab Personal sobrevive al helper compartido
#
# USO
#   supabase/tests/rutas_operadores/run.sh
# Requiere binarios de PostgreSQL (initdb/pg_ctl/psql). No toca ningún proyecto
# remoto: levanta un cluster temporal, corre todo y lo destruye.
# ════════════════════════════════════════════════════════════════════════════
set -euo pipefail

AQUI="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RAIZ="$(cd "$AQUI/../../.." && pwd)"
# Las tres, en orden: la 1ª crea el vínculo empleado ↔ cuenta (de donde sale el
# esquema que el fixture reproduce), la 2ª acota el catálogo del tab Personal y
# la 3ª —la que este harness verifica— extrae el helper de acceso y agrega el
# catálogo de operadores de rutas.
MIGRACION="$RAIZ/supabase/migrations/20260826000000_personal_usuario_de_ingreso.sql"
MIGRACION_2="$RAIZ/supabase/migrations/20260906000300_personal_usuarios_asignables_solo_del_proyecto.sql"
MIGRACION_3="$RAIZ/supabase/migrations/20260906000400_rutas_operadores_del_proyecto.sql"

# Los binarios no siempre están en PATH (en Debian/Ubuntu viven versionados).
for d in /usr/lib/postgresql/*/bin; do [ -d "$d" ] && PATH="$d:$PATH"; done
export PATH
command -v initdb >/dev/null || { echo "❌ falta initdb (instalá PostgreSQL)"; exit 1; }

# El socket unix tiene un tope de 107 bytes: se usa una ruta corta a propósito.
DATA=$(mktemp -d /tmp/rutdata.XXXX)
SOCK=$(mktemp -d /tmp/rutsock.XXXX)
PUERTO=${PGPORT_TEST:-55441}

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
psql -q -d postgres -c "CREATE DATABASE rutas_ops" >/dev/null
# anon/authenticated no existen en un Postgres pelado; la migración les revoca y
# otorga privilegios por nombre de rol.
psql -q -d rutas_ops -c "CREATE ROLE anon; CREATE ROLE authenticated;" >/dev/null 2>&1 || true

aplicar() {
  PGOPTIONS="-c client_min_messages=warning" psql -q -v ON_ERROR_STOP=1 -d rutas_ops -f "$1" >/dev/null
}

echo "── 1/3 · fixture: esquema, cuentas y accesos por proyecto ──────────────"
aplicar "$AQUI/fixture.sql"
echo "  OK    stubs + 9 cuentas (exentas, asignadas, legacy, inactiva, ajena)"

echo "── 2/3 · las tres migraciones, aplicadas DOS veces (idempotentes) ──────"
for _ in 1 2; do
  aplicar "$MIGRACION"
  aplicar "$MIGRACION_2"
  aplicar "$MIGRACION_3"
done
echo "  OK    re-aplicar no falla"

echo "── 3/3 · invariantes ───────────────────────────────────────────────────"
# `|| CODIGO=$?` en vez de dejar que `set -e` mate el script: si psql falla y no
# se captura, el harness muere ANTES de imprimir nada y el fallo se ve como una
# salida vacía.
CODIGO=0
SALIDA=$(psql -q -v ON_ERROR_STOP=1 -d rutas_ops -f "$AQUI/assert.sql" 2>&1) || CODIGO=$?
echo "$SALIDA" | sed -n 's/.*NOTICE:  /  /p'

if [ "$CODIGO" -ne 0 ]; then
  echo
  echo "❌ una invariante no se cumple:"
  echo "$SALIDA" | sed -n 's/.*ERROR:  /  /p'
  exit 1
fi

echo
echo "✅ rutas_operadores: el selector de operador solo ofrece cuentas activas con acceso al proyecto de la ruta, y solo se lo entrega a quien ve ese proyecto."
