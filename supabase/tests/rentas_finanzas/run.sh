#!/usr/bin/env bash
# ════════════════════════════════════════════════════════════════════════════
# Verificación EJECUTABLE de 20261128000000_rentas_finanzas.
#
# QUÉ HACE
#   1 · base      fixtures compartidos + padrón + Rentas (20261125000000) + el rol
#                 «Rentas finanzas» (la migración siembra las claves; el rol se asigna después)
#   2 · migra     aplica la migración DOS veces → idempotente, la huella no cambia
#   3 · invariantes  assert.sql (A–F), como cada persona
#   4 · mutantes  copias de la migración, cada una sin una compuerta: la suite DEBE fallar
#
# USO:  supabase/tests/rentas_finanzas/run.sh
# Requiere initdb/pg_ctl/psql. No toca ningún proyecto remoto: cluster temporal.
# ════════════════════════════════════════════════════════════════════════════
set -euo pipefail

AQUI="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RAIZ="$(cd "$AQUI/../../.." && pwd)"
EVID="$RAIZ/supabase/tests/housekeeping_evidencias"
RESP="$RAIZ/supabase/tests/housekeeping_responsable"
STRI="$RAIZ/supabase/tests/str_importacion"
MIGS="$RAIZ/supabase/migrations"
NUESTRA="$MIGS/20261128000000_rentas_finanzas.sql"

for d in /usr/lib/postgresql/*/bin; do [ -d "$d" ] && PATH="$d:$PATH"; done
export PATH
command -v initdb >/dev/null || { echo "❌ falta initdb (instalá PostgreSQL)"; exit 1; }

DATA=$(mktemp -d /tmp/rfindata.XXXX)
SOCK=$(mktemp -d /tmp/rfinsock.XXXX)
MUT=$(mktemp /tmp/rfinmut.XXXX.sql)
PUERTO=${PGPORT_TEST:-55467}

COMO=""
if [ "$(id -u)" = "0" ]; then
  id postgres >/dev/null 2>&1 || useradd -m postgres
  COMO="su postgres -c"
  chmod 755 "$AQUI" "$EVID" "$RESP" "$STRI" 2>/dev/null || true
fi
correr() { if [ -n "$COMO" ]; then su postgres -c "PATH=$PATH $*"; else eval "$*"; fi; }

limpiar() {
  correr "pg_ctl -D $DATA stop -m immediate" >/dev/null 2>&1 || true
  rm -rf "$DATA" "$SOCK" "$MUT"
}
trap limpiar EXIT
if [ -n "$COMO" ]; then chown -R postgres "$DATA" "$SOCK"; chmod 644 "$MUT"; fi

correr "initdb -D $DATA -U postgres --auth=trust" >/dev/null
correr "pg_ctl -D $DATA -o '-p $PUERTO -k $SOCK' -l $DATA/pg.log start" >/dev/null
sleep 2

export PGHOST="$SOCK" PGPORT="$PUERTO" PGUSER=postgres
psql -q -d postgres -c "CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN; CREATE ROLE service_role NOLOGIN BYPASSRLS;" >/dev/null
for db in rent rentm1 rentm2 rentm3 rentm4 rentm5 rentm6; do psql -q -d postgres -c "CREATE DATABASE $db" >/dev/null; done

aplicar() { PGOPTIONS="-c client_min_messages=warning" psql -q -v ON_ERROR_STOP=1 -d "$1" -f "$2" >/dev/null; }
huella() { psql -q -At -d "$1" -f "$AQUI/huella.sql"; }
cd "$AQUI"

fixture() {
  aplicar "$1" "$EVID/fixture.sql"
  aplicar "$1" "$RESP/fixture_rbac.sql"
  aplicar "$1" "$STRI/fixture_str.sql"
  aplicar "$1" "$RAIZ/supabase/tests/rentas_modulo/fixture_rentas.sql"
}
datos() {
  psql -q -v ON_ERROR_STOP=1 -d "$1" <<'SQL' >/dev/null
\i ../housekeeping_evidencias/lib.sql
\i ../housekeeping_responsable/datos.sql
\i ../str_importacion/datos.sql
\i ../rentas_modulo/datos.sql
SQL
}
base() {   # padrón + Rentas (20261125000000)
  fixture "$1"
  datos "$1"
  aplicar "$1" "$MIGS/20261125000000_rentas_modulo.sql"
}
preparar() {   # $1 = base · $2 = archivo de migración
  base "$1"
  aplicar "$1" "$2"
}

echo "── 1/4 · fixture + padrón + Rentas (20261125000000) ─────────────────────"
base rent
echo "  OK    13 cuentas, roles de Rentas, 7 unidades, reservas_str con su RLS"

echo "── 2/4 · la migración, DOS veces ───────────────────────────────────────"
aplicar rent "$NUESTRA"
H1=$(huella rent)
aplicar rent "$NUESTRA"
H2=$(huella rent)
[ "$H1" = "$H2" ] || { echo "❌ re-aplicar la migración cambió el catálogo ($H1 ≠ $H2)"; exit 1; }
echo "  OK    idempotente: la huella del catálogo no cambia al re-aplicar"

echo "── 3/4 · invariantes ───────────────────────────────────────────────────"
CODIGO=0
SALIDA=$(psql -q -v ON_ERROR_STOP=1 -d rent -f "$AQUI/assert.sql" 2>&1) || CODIGO=$?
echo "$SALIDA" | sed -n 's/.*NOTICE:  /  /p'
if [ "$CODIGO" -ne 0 ]; then
  echo; echo "❌ una invariante no se cumple:"
  echo "$SALIDA" | grep -E "ERROR|DETAIL|CONTEXT|LINE" | head -12
  exit 1
fi
TOTAL=$(echo "$SALIDA" | grep -c "NOTICE:  OK")
echo "  OK    $TOTAL comprobaciones"

echo "── 4/4 · mutantes: sin cada compuerta, la suite debe fallar ────────────"
mutante() {   # $1 = base · $2 = etiqueta · $3 = patrón que se quita · $4 = reemplazo
  grep -qF -- "$3" "$NUESTRA" || { echo "❌ el mutante «$2» no encuentra su línea en la migración: $3"; exit 1; }
  python3 - "$NUESTRA" "$MUT" "$3" "$4" <<'PY2'
import sys
src, dst, pat, rep = sys.argv[1:5]
s = open(src, encoding='utf-8').read()
assert s.count(pat) >= 1
open(dst, 'w', encoding='utf-8').write(s.replace(pat, rep, 1))
PY2
  preparar "$1" "$MUT"
  if psql -q -v ON_ERROR_STOP=1 -d "$1" -f "$AQUI/assert.sql" >/dev/null 2>&1; then
    echo "❌ el mutante «$2» pasó la suite: la regla no está probada"; exit 1
  fi
  echo "  OK    sin [$2] la suite falla"
}
mutante rentm1 "montos no negativos"           "OR (v_valor #>> '{}')::numeric < 0"                                         "OR false"
mutante rentm2 "concepto de la empresa"        "WHERE c.id::text = v_clave AND c.company_id = NEW.company_id) THEN"         "WHERE c.id::text = v_clave) THEN"
mutante rentm3 "reserva de esa propiedad"      "WHERE r.id = NEW.reserva_id AND r.propiedad_id = NEW.propiedad_id) THEN"    "WHERE r.id = NEW.reserva_id) THEN"
mutante rentm4 "reserva STR de esa unidad"     "AND s.unidad_id = v_prop.unidad_id) THEN"                                   ") THEN"
mutante rentm5 "se siembra sólo con servicio"  "IF NEW.servicio_rentas THEN"                                                "IF true THEN"
mutante rentm6 "una liquidación por reserva"   "CONSTRAINT rentas_liquidaciones_reserva_uq UNIQUE (reserva_id),"            ""

echo
echo "✅ rentas_finanzas: conceptos por empresa, desglose por reserva de las dos fuentes, gastos y RBAC de Finanzas"
