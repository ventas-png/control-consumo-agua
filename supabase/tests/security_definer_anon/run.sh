#!/usr/bin/env bash
# ════════════════════════════════════════════════════════════════════════════
# Verificación EJECUTABLE de la migración 20260825010000 (P1 del security
# guard: 8 SECURITY DEFINER de public anon-ejecutables).
#
# QUÉ COMPRUEBA
#   1/4  el fixture reproduce el hallazgo: anon ejecuta las 8 (grant implícito
#        de PUBLIC), INCLUIDA conta_puede_escribir pese a su REVOKE FROM anon
#        de 20260818000000 (causa raíz: REVOKE FROM anon sin PUBLIC es no-op)
#   2/4  tras la migración: anon=false en las 8; authenticated=false en las 5
#        funciones trigger y =true en los 3 helpers de policy; la consulta (a)
#        del guard (verbatim de security-guard.mjs) pasa de 8 hallazgos a 0
#   3/4  IDEMPOTENCIA: re-aplicar la migración no falla y deja el mismo estado
#   4/4  un rol SIN EXECUTE sigue disparando el trigger (Postgres verifica el
#        EXECUTE en CREATE TRIGGER, no en cada disparo — como pr27 §4)
#
# Las funciones se stubbean con sus firmas REALES (verificadas contra sus
# migraciones de origen; ver fixture.sql) — aplicar las migraciones reales
# arrastraría 5 módulos sin relación (la cadena contable sola son 21, ver
# compras_flujo/run.sh) y lo que se prueba aquí es SOLO la ACL.
#
# USO
#   supabase/tests/security_definer_anon/run.sh
# Requiere binarios de PostgreSQL (initdb/pg_ctl/psql). No toca ningún proyecto
# remoto: levanta un cluster temporal, corre todo y lo destruye.
# ════════════════════════════════════════════════════════════════════════════
set -euo pipefail

AQUI="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RAIZ="$(cd "$AQUI/../../.." && pwd)"
MIGRACION="$RAIZ/supabase/migrations/20260825010000_revoke_execute_security_definer_anon.sql"

# Los binarios no siempre están en PATH (en Debian/Ubuntu viven versionados).
for d in /usr/lib/postgresql/*/bin; do [ -d "$d" ] && PATH="$d:$PATH"; done
export PATH
command -v initdb >/dev/null || { echo "❌ falta initdb (instalá PostgreSQL)"; exit 1; }

# El socket unix tiene un tope de 107 bytes: se usa una ruta corta a propósito.
DATA=$(mktemp -d /tmp/secdefdata.XXXX)
SOCK=$(mktemp -d /tmp/secdefsock.XXXX)
PUERTO=${PGPORT_TEST:-55438}

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
psql -q -d postgres -c "CREATE DATABASE secdef" >/dev/null
# anon/authenticated no existen en un Postgres pelado; se crean para poder
# comprobar las ACLs igual que en Supabase.
psql -q -d secdef -c "CREATE ROLE anon; CREATE ROLE authenticated;" >/dev/null 2>&1 || true

aplicar() {
  PGOPTIONS="-c client_min_messages=warning" psql -q -v ON_ERROR_STOP=1 -d secdef -f "$1" >/dev/null
}

echo "── 1/4 · fixture: firmas y ACLs como las dejaron sus migraciones ───────"
aplicar "$AQUI/fixture.sql"
psql -q -v ON_ERROR_STOP=1 -d secdef -f "$AQUI/assert_pre.sql" 2>&1 | sed -n 's/.*NOTICE:  /  /p'

echo "── 2/4 · migración 20260825010000 + estado final de ACLs ───────────────"
aplicar "$MIGRACION"
psql -q -v ON_ERROR_STOP=1 -d secdef -f "$AQUI/assert.sql" 2>&1 | sed -n 's/.*NOTICE:  /  /p'

echo "── 3/4 · idempotencia (re-aplicar la misma migración) ──────────────────"
aplicar "$MIGRACION"
psql -q -v ON_ERROR_STOP=1 -d secdef -f "$AQUI/assert.sql" >/dev/null 2>&1
echo "  OK    re-aplicar no falla y deja el mismo estado"

echo "── 4/4 · el trigger sigue disparando para un rol SIN EXECUTE ───────────"
psql -q -v ON_ERROR_STOP=1 -d secdef >/dev/null <<'SQL'
CREATE ROLE app_sin_execute LOGIN;
GRANT USAGE ON SCHEMA public TO app_sin_execute;
GRANT INSERT, SELECT ON public.tg_smoke TO app_sin_execute;
SET ROLE app_sin_execute;
INSERT INTO public.tg_smoke (id) VALUES (1);
RESET ROLE;
DO $$
DECLARE v boolean;
BEGIN
  SELECT marcado INTO v FROM public.tg_smoke WHERE id = 1;
  IF v IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'el trigger NO disparó para un rol sin EXECUTE (marcado=%)', v;
  END IF;
END $$;
SQL
echo "  OK    Postgres verifica EXECUTE en CREATE TRIGGER, no en cada disparo"

echo
echo "✅ security_definer_anon: las 8 ACLs cerradas, idempotente, triggers vivos."
