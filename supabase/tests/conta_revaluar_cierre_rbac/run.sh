#!/usr/bin/env bash
# ============================================================================
# CONTABILIDAD · REVALUAR FX Y CIERRE ANUAL POR PERMISO · arnés contra un
# PostgreSQL REAL
#
# Prueba 20261220000000 sobre la cadena ENTERA de migraciones anteriores (el
# defecto nace del ORDEN entre 20260818000000 y 20260918121413: una cadena
# parcial no lo reproduce), con el padrón de fail_open_sin_perfil:
#   · control negativo: antes, el contador con todas las claves es rechazado;
#   · después, pasa la guarda; quien no tiene la clave sigue fuera;
#   · cada RPC exige SU clave; aplicar dos veces no anida el guard; ACL intacta.
# ============================================================================
set -Eeuo pipefail
trap 'rc=$?; echo "❌ run.sh terminó con rc=$rc en la línea $LINENO: $BASH_COMMAND" >&2' ERR

AQUI="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RAIZ="$(cd "$AQUI/../../.." && pwd)"
MIGS="$RAIZ/supabase/migrations"
MIGRACION=20261220000000_conta_revaluar_cierre_rbac
VERSION=${MIGRACION%%_*}
PADRON="$RAIZ/supabase/tests/fail_open_sin_perfil/fixture.sql"

for d in /usr/lib/postgresql/*/bin; do [ -d "$d" ] && PATH="$d:$PATH"; done
export PATH
command -v initdb >/dev/null || { echo "❌ falta initdb (instalá PostgreSQL)"; exit 1; }

# Shims de pg_net/pg_cron (mismo mecanismo que fail_open_sin_perfil).
EXT="$(pg_config --sharedir 2>/dev/null || echo /usr/share/postgresql/$(basename "$(dirname "$(command -v initdb)")"))/extension"
for ext in pg_net pg_cron; do
  [ -f "$EXT/$ext.control" ] && continue
  CTL="comment = 'shim vacío del arnés'"$'\n'"default_version = '1.0'"$'\n'"relocatable = true"
  if [ -w "$EXT" ]; then
    printf '%s\n' "$CTL" > "$EXT/$ext.control"; echo 'SELECT 1;' > "$EXT/$ext--1.0.sql"
  else
    printf '%s\n' "$CTL" | sudo -n tee "$EXT/$ext.control" >/dev/null
    echo 'SELECT 1;' | sudo -n tee "$EXT/$ext--1.0.sql" >/dev/null
  fi
done

DATA=$(mktemp -d /tmp/rcrdata.XXXX)
SOCK=$(mktemp -d /tmp/rcrsock.XXXX)
PUERTO=${PGPORT_TEST:-55701}
BD=rcr

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
correr "pg_ctl -D $DATA -o '-p $PUERTO -k $SOCK -c fsync=off -c synchronous_commit=off -c full_page_writes=off' -l $DATA/pg.log start" >/dev/null
for _ in $(seq 1 200); do PGHOST="$SOCK" PGPORT="$PUERTO" psql -q -U postgres -d postgres -c 'SELECT 1' >/dev/null 2>&1 && break; sleep 0.1; done

export PGHOST="$SOCK" PGPORT="$PUERTO" PGUSER=postgres
psql -q -d postgres -c "CREATE DATABASE $BD" >/dev/null
aplicar() { PGOPTIONS="-c client_min_messages=warning" psql -q -v ON_ERROR_STOP=1 -d "$BD" -f "$1" >/dev/null; }

fase() {   # fase antes|despues
  local salida
  salida=$(PGOPTIONS="-c rbac.fase=$1" psql -q -v ON_ERROR_STOP=1 -d "$BD" -f "$AQUI/assert.sql" 2>&1) || {
    echo "$salida" | sed -n 's/.*NOTICE:  /  /p'
    echo "❌ invariante incumplida ($1):"; echo "$salida" | grep -E 'ERROR' | head -4; exit 1; }
  echo "$salida" | sed -n 's/.*NOTICE:  /  /p'
}

echo "── 1/4 · cadena de migraciones ANTERIORES a $VERSION"
aplicar "$RAIZ/scripts/schema-drift/bootstrap.sql" 2>/dev/null
N=0
for f in "$MIGS"/*.sql; do
  base="$(basename "$f" .sql)"
  [[ "${base:0:14}" < "$VERSION" ]] || continue
  aplicar "$f"; N=$((N + 1))
done
echo "   $N migraciones aplicadas sobre una base vacía"

echo "── 2/4 · padrón + rol «Finanzas / Contador» para el operador de D"
aplicar "$PADRON"
psql -q -v ON_ERROR_STOP=1 -d "$BD" >/dev/null <<SQL
INSERT INTO public.user_roles (user_id, role_id) VALUES (fos.id('OPE_D'), '00000000-0000-0000-0000-000000000003');
-- Rol auxiliar vacío del mismo usuario: assert.sql le pone un «deny» para probar cada clave por separado.
INSERT INTO public.roles (id, company_id, name) VALUES ('f0520000-0000-0000-0000-000000000001', fos.id('D'), 'Restricción de prueba');
INSERT INTO public.user_roles (user_id, role_id) VALUES (fos.id('OPE_D'), 'f0520000-0000-0000-0000-000000000001');
SQL
[ "$(psql -tA -d "$BD" -c "SELECT count(*) FROM public.role_permissions WHERE role_id='00000000-0000-0000-0000-000000000003' AND permission_key IN ('platform.contabilidad.create','platform.contabilidad.change_status')")" = "2" ] \
  || { echo "❌ el rol plantilla «Finanzas / Contador» no trae create y change_status"; exit 1; }
echo "   OPE_D lleva platform.contabilidad.create y .change_status"

echo "── 3/4 · CONTROL NEGATIVO: sin la migración"
fase antes

echo "── 4/4 · con la migración (aplicada dos veces)"
aplicar "$MIGS/$MIGRACION.sql"
aplicar "$MIGS/$MIGRACION.sql"
fase despues

echo "✅ revaluar FX y cierre anual aceptan el permiso del rol, cada uno con su clave, sin abrir nada más"
