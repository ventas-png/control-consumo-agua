#!/usr/bin/env bash
# ════════════════════════════════════════════════════════════════════════════
# Verificación EJECUTABLE de 20261126000000_rentas_tercer_modulo_del_plan (cobro).
#
# QUÉ HACE
#   1 · fixture   esquema mínimo de Supabase (housekeeping_evidencias) + RBAC REAL
#                 (housekeeping_responsable/fixture_rbac.sql) + unidades (str_importacion)
#                 + catálogo `permissions`, Administrador General y touch_updated_at
#   2 · datos     padrón (13 cuentas, 2 empresas, 3 proyectos) + roles de Rentas
#   3 · migra     aplica la migración DOS veces → idempotente, la huella no cambia
#   4 · invariantes  assert.sql (A–H), como cada persona
#   5 · mutantes  copias de la migración, cada una sin una compuerta: la suite DEBE fallar
#
# USO:  supabase/tests/rentas_modulo/run.sh
# Requiere initdb/pg_ctl/psql. No toca ningún proyecto remoto: cluster temporal.
# ════════════════════════════════════════════════════════════════════════════
set -euo pipefail

AQUI="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RAIZ="$(cd "$AQUI/../../.." && pwd)"
EVID="$RAIZ/supabase/tests/housekeeping_evidencias"
RESP="$RAIZ/supabase/tests/housekeeping_responsable"
STRI="$RAIZ/supabase/tests/str_importacion"
MIGS="$RAIZ/supabase/migrations"
NUESTRA="$MIGS/20261126000000_rentas_tercer_modulo_del_plan.sql"

for d in /usr/lib/postgresql/*/bin; do [ -d "$d" ] && PATH="$d:$PATH"; done
export PATH
command -v initdb >/dev/null || { echo "❌ falta initdb (instalá PostgreSQL)"; exit 1; }

DATA=$(mktemp -d /tmp/rplandata.XXXX)
SOCK=$(mktemp -d /tmp/rplansock.XXXX)
MUT=$(mktemp /tmp/rplanmut.XXXX.sql)
PUERTO=${PGPORT_TEST:-55466}

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
for db in rent rentm1 rentm2 rentm3 rentm4 rentm5 rentm6 rentm7; do psql -q -d postgres -c "CREATE DATABASE $db" >/dev/null; done

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
base() {   # padrón + Rentas (20261125000000) + cobro vigente
  fixture "$1"
  datos "$1"
  aplicar "$1" "$MIGS/20261125000000_rentas_modulo.sql"
  PGOPTIONS="-c client_min_messages=warning" psql -q -v ON_ERROR_STOP=1 -d "$1" <<'SQL' >/dev/null
\i ../housekeeping_evidencias/lib.sql
\i fixture_plan.sql
SQL
}
preparar() {   # $1 = base · $2 = archivo de migración
  base "$1"
  aplicar "$1" "$2"
}

echo "── 1/5 · fixture + padrón + Rentas (20261125000000) ─────────────────────"
echo "── 2/5 · cobro vigente: 3 planes, suscripciones, alta y candado de producción ──"
base rent
echo "  OK    A solo Agua (activa), B bundle (activa), plataforma"

echo "── 3/5 · la migración, DOS veces ───────────────────────────────────────"
aplicar rent "$NUESTRA"
H1=$(huella rent)
aplicar rent "$NUESTRA"
H2=$(huella rent)
[ "$H1" = "$H2" ] || { echo "❌ re-aplicar la migración cambió el catálogo ($H1 ≠ $H2)"; exit 1; }
echo "  OK    idempotente: la huella del catálogo no cambia al re-aplicar"

echo "── 4/5 · invariantes ───────────────────────────────────────────────────"
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
mutante rentm1 "Stripe no se repunta"             "IF v_sub.stripe_subscription_id IS NOT NULL THEN"                                   "IF false THEN"
mutante rentm2 "candado de módulos"               "NEW.servicio_rentas      := OLD.servicio_rentas;"                                   ""
mutante rentm3 "independientes en el total"       "v_extra_units := v_extra_units + public.rentas_propiedades_independientes(p_company_id);" ""
mutante rentm4 "tope de unidades"                 "IF v_uso >= v_limite THEN"                                                          "IF false THEN"
mutante rentm5 "sólo las que no son unidad"       "WHERE p.company_id = p_company_id AND p.unidad_id IS NULL)"                         "WHERE p.company_id = p_company_id)"
mutante rentm6 "módulos → plan"                   "WHEN COALESCE(p_rentas, false)      THEN 'rentas_only'"                             "WHEN COALESCE(p_rentas, false)      THEN 'bundle'"
mutante rentm7 "Rentas apagado no se cobra"       "JOIN public.companies rc ON rc.id = rp.company_id AND rc.servicio_rentas"           "JOIN public.companies rc ON rc.id = rp.company_id"
echo
echo "✅ rentas_plan: Rentas es el tercer módulo del plan, los interruptores mueven el plan y las propiedades independientes se cobran como unidades"
