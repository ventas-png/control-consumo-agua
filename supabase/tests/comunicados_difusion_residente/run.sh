#!/usr/bin/env bash
# ════════════════════════════════════════════════════════════════════════════
# Verificación EJECUTABLE de 20260801000300 (comunicados / difusión · residente).
#
# POR QUÉ EXISTE
# El bug que arregla la migración no se ve en la UI del administrador: RLS no
# lanza error, devuelve 0 filas, y la pantalla del residente cae en su estado
# vacío ("Sin anuncios" / "Sin comunicados"). Una revisión a ojo del SQL no
# distingue "la policy no alcanza al residente" de "no hay nada publicado", así
# que la única prueba que vale es ejecutar las policies contra un Postgres real
# con un residente y un miembro del staff sentados en la misma empresa.
#
# QUÉ COMPRUEBA
#   Paso 1 · PRE-FIX  → reproduce el bug con las policies actuales de prod:
#                       el residente ve 0 anuncios y 0 comunicados, y un
#                       residente legacy ve los acuses de toda la empresa.
#   Paso 2 · fix      → aplica la migración.
#   Paso 3 · POST-FIX → 13 invariantes: el residente ve lo suyo y sólo lo suyo,
#                       el staff conserva su CRUD y el aislamiento por empresa
#                       sigue en pie.
#   Paso 4 · idempotencia → re-aplicar la migración no falla ni cambia el
#                       resultado (se re-corren las 13 invariantes).
#
# USO
#   supabase/tests/comunicados_difusion_residente/run.sh
# Requiere binarios de PostgreSQL (initdb/pg_ctl/psql). No toca ningún proyecto
# remoto: levanta un cluster temporal, corre todo y lo destruye.
# ════════════════════════════════════════════════════════════════════════════
set -euo pipefail

AQUI="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RAIZ="$(cd "$AQUI/../../.." && pwd)"
MIGRACION="$RAIZ/supabase/migrations/20260801000300_rls_comunicados_difusion_residente.sql"
INVARIANTE="$RAIZ/supabase/migrations/20260801000400_app_users_cliente_sin_company_id.sql"

for d in /usr/lib/postgresql/*/bin; do [ -d "$d" ] && PATH="$d:$PATH"; done
export PATH
command -v initdb >/dev/null || { echo "❌ falta initdb (instalá PostgreSQL)"; exit 1; }

# El socket unix tiene un tope de 107 bytes: ruta corta a propósito.
DATA=$(mktemp -d /tmp/comdata.XXXX)
SOCK=$(mktemp -d /tmp/comsock.XXXX)
PUERTO=${PGPORT_TEST:-55433}

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
psql -q -d postgres -c "CREATE DATABASE comdif" >/dev/null
# anon/authenticated no existen en un Postgres pelado; las policies son TO authenticated.
psql -q -d comdif -c "CREATE ROLE anon; CREATE ROLE authenticated;" >/dev/null 2>&1 || true

echo "── 1/4 · fixture + reproducción del bug (policies actuales) ────────────"
PGOPTIONS="-c client_min_messages=warning" psql -q -v ON_ERROR_STOP=1 -d comdif -f "$AQUI/fixture.sql" >/dev/null
psql -q -v ON_ERROR_STOP=1 -d comdif -f "$AQUI/assert_pre.sql" 2>&1 | sed -n 's/.*NOTICE:  /  /p'

echo "── 2/4 · aplicar 20260801000300 ────────────────────────────────────────"
PGOPTIONS="-c client_min_messages=warning" psql -q -v ON_ERROR_STOP=1 -d comdif -f "$MIGRACION" >/dev/null
echo "  OK    migración aplicada"

echo "── 3/4 · invariantes post-fix ──────────────────────────────────────────"
psql -q -v ON_ERROR_STOP=1 -d comdif -f "$AQUI/assert_post.sql" 2>&1 | sed -n 's/.*NOTICE:  /  /p'

echo "── 4/6 · idempotencia (re-aplicar la migración) ────────────────────────"
PGOPTIONS="-c client_min_messages=warning" psql -q -v ON_ERROR_STOP=1 -d comdif -f "$MIGRACION" >/dev/null
# El paso 3 dejó un read_at marcado; se limpia para que las 13 vuelvan a valer.
psql -q -d comdif -c "UPDATE public.broadcast_recipients SET read_at = NULL" >/dev/null
psql -q -v ON_ERROR_STOP=1 -d comdif -f "$AQUI/assert_post.sql" 2>&1 | sed -n 's/.*NOTICE:  /  /p'

echo "── 5/6 · invariante cliente ⇒ company_id NULL (20260801000400) ─────────"
# El WARNING de normalización es señal, no ruido: se muestra.
PGOPTIONS="-c client_min_messages=warning" psql -q -v ON_ERROR_STOP=1 -d comdif -f "$INVARIANTE" 2>&1 \
  | sed -n 's/.*WARNING:  /  ⚠ /p'
psql -q -v ON_ERROR_STOP=1 -d comdif -f "$AQUI/assert_invariante.sql" 2>&1 | sed -n 's/.*NOTICE:  /  /p'

echo "── 6/6 · idempotencia de 20260801000400 ────────────────────────────────"
PGOPTIONS="-c client_min_messages=warning" psql -q -v ON_ERROR_STOP=1 -d comdif -f "$INVARIANTE" >/dev/null
psql -q -d comdif -c "DELETE FROM public.app_users WHERE id = '50000000-0000-0000-0000-000000000009'" >/dev/null
psql -q -v ON_ERROR_STOP=1 -d comdif -f "$AQUI/assert_invariante.sql" 2>&1 | sed -n 's/.*NOTICE:  /  /p'

echo
echo "✅ 20260801000300 + 20260801000400: bugs reproducidos, corregidos y"
echo "   verificados (18 invariantes), ambas migraciones idempotentes."
