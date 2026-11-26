#!/usr/bin/env bash
# ============================================================================
# CONTABILIDAD · CONCILIACIÓN BANCARIA EN GRUPO Y SALDO INICIAL · arnés contra un
# PostgreSQL REAL
#
# Prueba 20261231000400 (conciliación en grupo, elección manual y saldo inicial del banco) sobre la cadena ENTERA de
# migraciones, con el padrón de fail_open_sin_perfil:
#   · un depósito se concilia contra varios cobros (y un retiro contra varias
#     órdenes de pago) sólo si la suma es su importe; cada documento queda en
#     una sola conciliación;
#   · lo conciliado en grupo deja de sugerirse y de ofrecerse; desconciliar el
#     movimiento libera todos sus documentos; la conciliación uno-a-uno no
#     puede tomar un documento ya usado en grupo;
#   · los candidatos son de la misma contabilidad y del signo del movimiento;
#   · el saldo inicial del banco entra al «saldo según banco» y lo anterior a
#     su fecha no se suma dos veces;
#   · permisos, otra empresa, RLS y ACL.
# ============================================================================
set -Eeuo pipefail
trap 'rc=$?; echo "❌ run.sh terminó con rc=$rc en la línea $LINENO: $BASH_COMMAND" >&2' ERR

AQUI="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RAIZ="$(cd "$AQUI/../../.." && pwd)"
MIGS="$RAIZ/supabase/migrations"
MIGRACION=20261231000400_banco_conciliacion_varios
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

DATA=$(mktemp -d /tmp/bvdata.XXXX)
SOCK=$(mktemp -d /tmp/bvsock.XXXX)
PUERTO=${PGPORT_TEST:-55787}
BD=bv

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

afirmar() {
  local salida
  salida=$(psql -q -v ON_ERROR_STOP=1 -d "$BD" -f "$AQUI/assert.sql" 2>&1) || {
    echo "$salida" | sed -n 's/.*NOTICE:  /  /p'
    echo "❌ invariante incumplida:"; echo "$salida" | grep -E 'ERROR' | head -4; exit 1; }
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
-- Rol auxiliar vacío del mismo usuario: assert.sql le pone «deny» para probar cada permiso por separado.
INSERT INTO public.roles (id, company_id, name) VALUES ('f0520000-0000-0000-0000-000000000001', fos.id('D'), 'Restricción de prueba');
INSERT INTO public.user_roles (user_id, role_id) VALUES (fos.id('OPE_D'), 'f0520000-0000-0000-0000-000000000001');
SQL

echo "── 3/4 · la migración (aplicada dos veces)"
aplicar "$MIGS/$MIGRACION.sql"
aplicar "$MIGS/$MIGRACION.sql"

echo "── 4/4 · invariantes"
afirmar

echo "✅ conciliación bancaria: un movimiento contra varios documentos, elección manual y saldo inicial del banco"
