#!/usr/bin/env bash
# ════════════════════════════════════════════════════════════════════════════
# Verificación EJECUTABLE de 20261127000000_modulos_por_proyecto.
#
# QUÉ HACE
#   1 · fixture   el mismo padrón de rentas_plan (13 cuentas, 2 empresas, 3 proyectos,
#                 RBAC real, unidades, Rentas y cobro) con 20261126000000 ya aplicada
#   2 · datos     fixture_modulos.sql: dueña, residente con dos unidades, módulos contratados
#   3 · migra     aplica la migración DOS veces → idempotente, la huella no cambia
#   4 · invariantes  assert.sql (A–E), como cada persona
#   5 · mutantes  copias de la migración, cada una sin una compuerta: la suite DEBE fallar
#
# USO:  supabase/tests/modulos_por_proyecto/run.sh
# Requiere initdb/pg_ctl/psql. No toca ningún proyecto remoto: cluster temporal.
# ════════════════════════════════════════════════════════════════════════════
set -euo pipefail

AQUI="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RAIZ="$(cd "$AQUI/../../.." && pwd)"
EVID="$RAIZ/supabase/tests/housekeeping_evidencias"
RESP="$RAIZ/supabase/tests/housekeeping_responsable"
STRI="$RAIZ/supabase/tests/str_importacion"
MIGS="$RAIZ/supabase/migrations"
PLAN="$RAIZ/supabase/tests/rentas_plan"
NUESTRA="$MIGS/20261127000000_modulos_por_proyecto.sql"

for d in /usr/lib/postgresql/*/bin; do [ -d "$d" ] && PATH="$d:$PATH"; done
export PATH
command -v initdb >/dev/null || { echo "❌ falta initdb (instalá PostgreSQL)"; exit 1; }

DATA=$(mktemp -d /tmp/modproydata.XXXX)
SOCK=$(mktemp -d /tmp/modproysock.XXXX)
MUT=$(mktemp /tmp/modproymut.XXXX.sql)
PUERTO=${PGPORT_TEST:-55467}

COMO=""
if [ "$(id -u)" = "0" ]; then
  id postgres >/dev/null 2>&1 || useradd -m postgres
  COMO="su postgres -c"
  chmod 755 "$AQUI" "$EVID" "$RESP" "$STRI" "$PLAN" "$RAIZ/supabase/tests/rentas_modulo" 2>/dev/null || true
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
for db in modp modpm1 modpm2 modpm3 modpm4; do psql -q -d postgres -c "CREATE DATABASE $db" >/dev/null; done

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
base() {   # padrón + Rentas + cobro (20261125000000, 20261126000000) + lo propio de esta suite
  fixture "$1"
  datos "$1"
  aplicar "$1" "$MIGS/20261125000000_rentas_modulo.sql"
  PGOPTIONS="-c client_min_messages=warning" psql -q -v ON_ERROR_STOP=1 -d "$1" <<'SQL' >/dev/null
\i ../housekeeping_evidencias/lib.sql
\i ../rentas_plan/fixture_plan.sql
SQL
  aplicar "$1" "$MIGS/20261126000000_rentas_tercer_modulo_del_plan.sql"
  PGOPTIONS="-c client_min_messages=warning" psql -q -v ON_ERROR_STOP=1 -d "$1" <<'SQL' >/dev/null
\i ../housekeeping_evidencias/lib.sql
\i fixture_modulos.sql
SQL
}
preparar() {   # $1 = base · $2 = archivo de migración
  base "$1"
  aplicar "$1" "$2"
}

echo "── 1/5 · fixture + padrón + Rentas y cobro (20261125000000, 20261126000000) ──"
echo "── 2/5 · A contrata los tres módulos, B sólo Agua; residente con unidad en PA1 y PA2 ──"
base modp
echo "  OK    3 proyectos, todos sin interruptores todavía"

echo "── 3/5 · la migración, DOS veces ───────────────────────────────────────"
aplicar modp "$NUESTRA"
H1=$(huella modp)
aplicar modp "$NUESTRA"
H2=$(huella modp)
[ "$H1" = "$H2" ] || { echo "❌ re-aplicar la migración cambió el catálogo ($H1 ≠ $H2)"; exit 1; }
echo "  OK    idempotente: la huella del catálogo no cambia al re-aplicar"

echo "── 4/5 · invariantes ───────────────────────────────────────────────────"
CODIGO=0
SALIDA=$(psql -q -v ON_ERROR_STOP=1 -d modp -f "$AQUI/assert.sql" 2>&1) || CODIGO=$?
echo "$SALIDA" | sed -n 's/.*NOTICE:  /  /p'
if [ "$CODIGO" -ne 0 ]; then
  echo; echo "❌ una invariante no se cumple:"
  echo "$SALIDA" | grep -E "ERROR|DETAIL|CONTEXT|LINE" | head -12
  exit 1
fi
TOTAL=$(echo "$SALIDA" | grep -c "NOTICE:  OK")
echo "  OK    $TOTAL comprobaciones"

echo "── 5/5 · mutantes: sin cada compuerta, la suite debe fallar ────────────"
mutante() {   # $1 = base · $2 = etiqueta · $3 = patrón que se quita · $4 = reemplazo
  grep -qF -- "$3" "$NUESTRA" || { echo "❌ el mutante «$2» no encuentra su línea en la migración: $3"; exit 1; }
  python3 - "$NUESTRA" "$MUT" "$3" "$4" <<'PY'
import sys
src, dst, pat, rep = sys.argv[1:5]
s = open(src, encoding='utf-8').read()
assert s.count(pat) >= 1
open(dst, 'w', encoding='utf-8').write(s.replace(pat, rep, 1))
PY
  preparar "$1" "$MUT"
  if psql -q -v ON_ERROR_STOP=1 -d "$1" -f "$AQUI/assert.sql" >/dev/null 2>&1; then
    echo "❌ el mutante «$2» pasó la suite: la regla no está probada"; exit 1
  fi
  echo "  OK    sin [$2] la suite falla"
}
mutante modpm1 "sólo el principal"                "IF (SELECT auth.role()) = 'authenticated'"                              "IF false"
mutante modpm2 "al menos un módulo CONTRATADO"    "OR (v_condominios AND NEW.modulo_condominios)"                          "OR (NEW.modulo_condominios)"
mutante modpm3 "portal ∩ módulo del proyecto"     "COALESCE(c.servicio_condominios AND p.modulo_condominios, false)"       "COALESCE(c.servicio_condominios, false)"
mutante modpm4 "Rentas apagado no se enlaza"      "AND (TG_OP = 'INSERT' OR NEW.project_id IS DISTINCT FROM OLD.project_id)" "AND false"
echo
echo "✅ modulos_por_proyecto: cada proyecto elige sus módulos entre los contratados, sólo el principal los mueve, y el portal y Rentas los respetan"
