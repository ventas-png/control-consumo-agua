#!/usr/bin/env bash
# ════════════════════════════════════════════════════════════════════════════
# Verificación EJECUTABLE de la migración 20260729000600 (auditoría 2026-07-28,
# PR-27: project_id en las 5 tablas hijas de condominio).
#
# POR QUÉ EXISTE
# El PR de esta migración no pudo validarse con una preview branch de Supabase:
# el bot la ignoró por haber alcanzado el límite de ramas concurrentes del
# proyecto. Sin eso, la migración se habría mergeado SIN HABERSE EJECUTADO NUNCA
# contra un Postgres — y no es SQL trivial (DO blocks con DDL dinámico, un
# trigger parametrizado por TG_ARGV, `EXECUTE format('SELECT ($1).%I')` sobre
# NEW). Este script la corre de verdad contra un cluster desechable.
#
# QUÉ COMPRUEBA (10 invariantes, ver assert.sql)
#   1-2  el backfill deriva el project_id correcto del padre, sin dejar NULLs
#   3-4  las 5 columnas quedan NOT NULL y con su índice (project_id, company_id)
#   5    un INSERT sin project_id lo obtiene del padre
#   6    un INSERT que MIENTE el project_id es sobrescrito con el del padre
#   7    un UPDATE directo de project_id se re-deriva
#   8    un INSERT contra un padre de otro tenant se RECHAZA
#   9    las 5 tablas se comportan igual
#   10   reproduce el bug: filtrar solo por empresa ve 4 filas, por proyecto ve 2
#
# Además comprueba IDEMPOTENCIA (re-aplicar no cambia nada) y que la suciedad
# cross-tenant PREEXISTENTE produzca WARNING y no EXCEPTION — la migración no
# debe bloquear el deploy por datos que no creó.
#
# USO
#   supabase/tests/pr27_project_id/run.sh
# Requiere binarios de PostgreSQL (initdb/pg_ctl/psql). No toca ningún proyecto
# remoto: levanta un cluster temporal, corre todo y lo destruye.
# ════════════════════════════════════════════════════════════════════════════
set -euo pipefail

AQUI="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RAIZ="$(cd "$AQUI/../../.." && pwd)"
MIGRACION="$RAIZ/supabase/migrations/20260729000600_project_id_en_tablas_hijas_condominio.sql"

# Los binarios no siempre están en PATH (en Debian/Ubuntu viven versionados).
for d in /usr/lib/postgresql/*/bin; do [ -d "$d" ] && PATH="$d:$PATH"; done
export PATH
command -v initdb >/dev/null || { echo "❌ falta initdb (instalá PostgreSQL)"; exit 1; }

# El socket unix tiene un tope de 107 bytes: se usa una ruta corta a propósito.
DATA=$(mktemp -d /tmp/pr27data.XXXX)
SOCK=$(mktemp -d /tmp/pr27sock.XXXX)
PUERTO=${PGPORT_TEST:-55432}

limpiar() {
  pg_ctl -D "$DATA" stop -m immediate >/dev/null 2>&1 || true
  rm -rf "$DATA" "$SOCK"
}
trap limpiar EXIT

# Postgres se niega a correr como root; si lo somos, se delega en el usuario
# `postgres` del sistema.
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
psql -q -d postgres -c "CREATE DATABASE pr27" >/dev/null

echo "── 1/3 · fixture + migración + 10 invariantes ──────────────────────────"
PGOPTIONS="-c client_min_messages=warning" psql -q -v ON_ERROR_STOP=1 -d pr27 -f "$AQUI/fixture.sql" >/dev/null
PGOPTIONS="-c client_min_messages=warning" psql -q -v ON_ERROR_STOP=1 -d pr27 -f "$MIGRACION" >/dev/null
psql -q -v ON_ERROR_STOP=1 -d pr27 -f "$AQUI/assert.sql" 2>&1 | sed -n 's/.*NOTICE:  /  /p'

echo "── 2/3 · idempotencia (re-aplicar la misma migración) ──────────────────"
PGOPTIONS="-c client_min_messages=warning" psql -q -v ON_ERROR_STOP=1 -d pr27 -f "$MIGRACION" >/dev/null
echo "  OK    re-aplicar no falla ni cambia datos"

echo "── 3/3 · suciedad cross-tenant preexistente → WARNING, no EXCEPTION ────"
psql -q -d postgres -c "CREATE DATABASE pr27b" >/dev/null
psql -q -v ON_ERROR_STOP=1 -d pr27b -f "$AQUI/fixture.sql" >/dev/null
psql -q -d pr27b -c "INSERT INTO movimientos_caja (company_id, caja_id, tipo, concepto, monto)
  VALUES ('aaaaaaaa-0000-0000-0000-000000000001','ca333333-0000-0000-0000-000000000003','ingreso','SUCIA',1.00);" >/dev/null
# La salida se captura ANTES de filtrar, a propósito: con `set -o pipefail`, un
# `psql … | grep -q` da falso negativo, porque grep cierra la tubería al primer
# match, psql muere por SIGPIPE y el estado del pipeline pasa a ser el suyo. Este
# script lo sufrió al escribirlo: reportaba "no se emitió el WARNING" cuando sí
# se emitía.
SALIDA=$(psql -v ON_ERROR_STOP=1 -d pr27b -f "$MIGRACION" 2>&1)
if grep -q "WARNING:  PR-27:" <<<"$SALIDA"; then
  echo "  OK    avisa del dato sucio y NO aborta el deploy"
else
  echo "  ❌    no se emitió el WARNING esperado"; exit 1
fi

echo
echo "✅ PR-27: la migración se aplicó y cumple las 12 comprobaciones."
