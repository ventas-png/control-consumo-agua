#!/usr/bin/env bash
# ════════════════════════════════════════════════════════════════════════════
# Verificación EJECUTABLE del envoltorio (SELECT …) en las políticas de
# suministros (20260906000000).
#
# POR QUÉ EXISTE
# La migración promete algo que el SQL no puede demostrar solo: que re-escribir
# ocho políticas RLS no abrió ni cerró NADA. Un permiso mal tecleado, un DROP
# sin su CREATE o un predicado de más son SQL perfectamente válido — el error
# aparece recién cuando alguien ve lo que no debía, o deja de ver lo que sí.
#
# Por eso el sandbox mide los MISMOS seis accesos ANTES y DESPUÉS de aplicar la
# migración, contra las políticas de producción de verdad: el fixture instala
# `rbac_install_company_policies` copiada literal de 20260518000010 y la aplica
# a las dos tablas, así que la tanda "antes" es lo que hay hoy en prod.
#
# QUÉ COMPRUEBA
#   A · ACCESOS   los seis dan idéntico antes y después (Bruno con permiso ve y
#                 registra; Bruno operador NO borra; Ana sin permiso no ve ni
#                 registra; Dana con permiso pero de otra empresa no cruza), y
#                 cada resultado es el correcto — no seis ceros empatados.
#   B · CATÁLOGO  el subselect quedó en `pg_policies`, siguen las ocho, el
#                 DELETE sigue mirando el rol, y la PLANTILLA del generador
#                 emite el envoltorio para las tablas que vengan.
#
# USO
#   supabase/tests/rls_initplan_suministros/run.sh
# Requiere binarios de PostgreSQL (initdb/pg_ctl/psql). No toca ningún proyecto
# remoto: levanta un cluster temporal, corre todo y lo destruye.
# ════════════════════════════════════════════════════════════════════════════
set -euo pipefail

AQUI="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RAIZ="$(cd "$AQUI/../../.." && pwd)"
MIG="$RAIZ/supabase/migrations/20260906000000_rls_initplan_suministros.sql"

for d in /usr/lib/postgresql/*/bin; do [ -d "$d" ] && PATH="$d:$PATH"; done
export PATH
command -v initdb >/dev/null || { echo "❌ falta initdb (instalá PostgreSQL)"; exit 1; }

# El socket unix tiene un tope de 107 bytes: ruta corta a propósito.
DATA=$(mktemp -d /tmp/inipdata.XXXX)
SOCK=$(mktemp -d /tmp/inipsock.XXXX)
PUERTO=${PGPORT_TEST:-55462}

# Postgres se niega a correr como root; si lo somos, se delega en `postgres`.
COMO=""
if [ "$(id -u)" = "0" ]; then
  id postgres >/dev/null 2>&1 || useradd -m postgres
  COMO="su postgres -c"
fi
correr() { if [ -n "$COMO" ]; then su postgres -c "PATH=$PATH $*"; else eval "$*"; fi; }

# El apagado se delega IGUAL que el arranque: con `pg_ctl` a secas, como root
# falla en silencio y el cluster queda ocupando el puerto — la corrida siguiente
# muere con "could not start server" y parece un fallo del harness.
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
psql -q -d postgres -c "CREATE DATABASE initplan" >/dev/null
# anon/authenticated no existen en un Postgres pelado.
psql -q -d initplan -c "CREATE ROLE anon; CREATE ROLE authenticated;" >/dev/null 2>&1 || true

aplicar() {
  PGOPTIONS="-c client_min_messages=warning" psql -q -v ON_ERROR_STOP=1 -d initplan -f "$1" >/dev/null
}

echo "── 1/5 · fixture (tablas, padrón y políticas de HOY) ───────────────────"
aplicar "$AQUI/fixture.sql"
echo "  OK    fixture cargado (generador viejo, llamada desnuda)"

echo "── 2/5 · medir los accesos ANTES ──────────────────────────────────────"
PGOPTIONS="-c client_min_messages=warning" \
  psql -q -v ON_ERROR_STOP=1 -v etapa=antes -d initplan -f "$AQUI/medir.sql" >/dev/null
echo "  OK    seis accesos medidos"

echo "── 3/5 · aplicar 20260906000000 (dos veces: idempotencia) ─────────────"
aplicar "$MIG"
# Segunda pasada: si no fuera idempotente, aquí revienta. Las migraciones se
# re-aplican de verdad en reconciliaciones y en preview branches.
aplicar "$MIG"
echo "  OK    migración aplicada dos veces"

echo "── 4/5 · medir los MISMOS accesos DESPUÉS ─────────────────────────────"
PGOPTIONS="-c client_min_messages=warning" \
  psql -q -v ON_ERROR_STOP=1 -v etapa=despues -d initplan -f "$AQUI/medir.sql" >/dev/null
echo "  OK    seis accesos medidos"

echo "── 5/5 · invariantes ──────────────────────────────────────────────────"
# `|| CODIGO=$?` en vez de dejar que `set -e` mate el script: si psql falla sin
# capturarse, el harness muere ANTES de imprimir nada y el fallo se ve como una
# salida vacía — que es exactamente lo inútil que un test no debe ser.
CODIGO=0
SALIDA=$(psql -q -v ON_ERROR_STOP=1 -d initplan -f "$AQUI/assert.sql" 2>&1) || CODIGO=$?
echo "$SALIDA" | sed -n 's/.*NOTICE:  /  /p'

if [ "$CODIGO" -ne 0 ]; then
  echo
  echo "❌ una invariante no se cumple:"
  echo "$SALIDA" | sed -n 's/.*WARNING:  /  /p'
  echo "$SALIDA" | sed -n 's/.*ERROR:  /  /p'
  exit 1
fi

echo
echo "✅ rls_initplan_suministros: los seis accesos no cambiaron y el envoltorio"
echo "   quedó en el catálogo, también en la plantilla del generador."
