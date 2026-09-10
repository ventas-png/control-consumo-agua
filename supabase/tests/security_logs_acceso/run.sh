#!/usr/bin/env bash
# ════════════════════════════════════════════════════════════════════════════
# Verificación EJECUTABLE de 20260910000000 — quién puede tocar `security_logs`
#
# POR QUÉ EXISTE
# El auditor de drift declara `tabla:security_logs/policies` como SEGURIDAD ·
# ALTA desde el 2026-09-01: producción tiene tres policies que el repositorio no
# declara —`security_logs_insert_anon`, `security_logs_insert_authenticated` y
# `security_logs_select_by_role`—. La primera deja escribir en el log de
# auditoría a un visitante SIN SESIÓN; la tercera deja que el admin de un tenant
# lea los eventos de seguridad de TODOS, porque la tabla es global y no tiene
# company_id.
#
# Un guard estático que leyera el .sql no valdría: lo que hay que demostrar no
# es que la migración diga las palabras correctas, sino que después de aplicarla
# cada actor pueda —o no pueda— hacer lo que le toca. Así que acá se INTENTA la
# operación con el rol puesto y se mira si sale.
#
# QUÉ COMPRUEBA
#   1/4  ANTES: el fixture reproduce el hallazgo — anon inserta, cualquier
#        authenticated inserta, y un admin de tenant lee los logs globales.
#        Si esto no falla como falla producción, el resto no prueba nada.
#   2/4  DESPUÉS: anon no escribe ni lee (se lo deniega el GRANT, no la RLS);
#        authenticated normal no escribe ni lee; admin y company_owner de un
#        tenant no leen; super_admin sí lee y no escribe; service_role escribe.
#        Y el catálogo: RLS habilitada, UNA policy, los grants exactos.
#   3/4  IDEMPOTENCIA: re-aplicar la migración no falla y deja el mismo estado.
#   4/4  RECONSTRUCCIÓN: sobre una base LIMPIA —sin las tres policies, que es lo
#        que ve el repositorio— la migración aplica igual y deja la misma
#        postura. Es el caso que corre CI en cada reconstrucción.
#
# USO
#   supabase/tests/security_logs_acceso/run.sh
# Requiere binarios de PostgreSQL (initdb/pg_ctl/psql). No toca ningún proyecto
# remoto: levanta un clúster temporal, corre todo y lo destruye.
# ════════════════════════════════════════════════════════════════════════════
set -euo pipefail

AQUI="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RAIZ="$(cd "$AQUI/../../.." && pwd)"
MIGRACION="$RAIZ/supabase/migrations/20260910000000_security_logs_cerrar_drift_policies_y_grants.sql"

for d in ${PGBIN:-} /usr/lib/postgresql/*/bin; do [ -d "$d" ] && PATH="$d:$PATH"; done
export PATH
command -v initdb >/dev/null || { echo "❌ falta initdb (instalá PostgreSQL)"; exit 1; }
[ -f "$MIGRACION" ] || { echo "❌ no está la migración: $MIGRACION"; exit 1; }

# El socket unix tiene un tope de 107 bytes: rutas cortas a propósito.
DATA=$(mktemp -d /tmp/seclogdata.XXXX)
SOCK=$(mktemp -d /tmp/seclogsock.XXXX)
PUERTO=${PGPORT_TEST:-55494}

limpiar() {
  pg_ctl -D "$DATA" stop -m immediate >/dev/null 2>&1 || true
  rm -rf "$DATA" "$SOCK"
}
trap limpiar EXIT

# Postgres se niega a correr como root; si lo somos, se delega en `postgres`.
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
psql -q -d postgres -c "CREATE DATABASE seclog" >/dev/null

aplicar() {
  PGOPTIONS="-c client_min_messages=warning" psql -q -v ON_ERROR_STOP=1 -d "$2" -f "$1" >/dev/null
}
afirmar() {
  set +e
  psql -q -v ON_ERROR_STOP=1 -d "$2" -f "$1" 2>&1 | sed -n -e "s/.*NOTICE:  /  /p" -e "s/.*ERROR:/  ERROR:/p"
  local st=${PIPESTATUS[0]}; set -e; return $st
}

echo "── 1/4 · fixture con la forma REAL de producción (4 policies) ──────────"
aplicar "$AQUI/fixture.sql" seclog
afirmar "$AQUI/assert_pre.sql" seclog

echo "── 2/4 · migración 20260910000000 · quién puede hacer qué ──────────────"
aplicar "$MIGRACION" seclog
afirmar "$AQUI/assert.sql" seclog

echo "── 3/4 · idempotencia (re-aplicar la misma migración) ──────────────────"
aplicar "$MIGRACION" seclog
psql -q -v ON_ERROR_STOP=1 -d seclog -f "$AQUI/assert.sql" >/dev/null 2>&1
echo "  OK    re-aplicar no falla y deja el mismo estado"

echo "── 4/4 · sobre una base LIMPIA (lo que ve la reconstrucción) ───────────"
# Sin las tres policies de producción: los DROP son no-ops y la postura final
# tiene que ser la MISMA. Es lo que corre CI al reconstruir desde cero.
psql -q -d postgres -c "CREATE DATABASE seclog_limpia" >/dev/null
aplicar "$AQUI/fixture.sql" seclog_limpia
psql -q -v ON_ERROR_STOP=1 -d seclog_limpia >/dev/null <<'SQL'
DROP POLICY IF EXISTS "security_logs_insert_anon" ON public.security_logs;
DROP POLICY IF EXISTS "security_logs_insert_authenticated" ON public.security_logs;
DROP POLICY IF EXISTS "security_logs_select_by_role" ON public.security_logs;
SQL
aplicar "$MIGRACION" seclog_limpia
afirmar "$AQUI/assert.sql" seclog_limpia

echo
echo "✅ security_logs_acceso: las tres policies retiradas, los grants cerrados,"
echo "   super_admin conserva la lectura y service_role la escritura."
