#!/usr/bin/env bash
# ════════════════════════════════════════════════════════════════════════════
# Verificación EJECUTABLE de 20261031000100_str_reservas_importar.
#
# QUÉ HACE
#   1 · fixture   esquema mínimo de Supabase (housekeeping_evidencias) + RBAC REAL
#                 (housekeeping_responsable/fixture_rbac.sql) + unidades, reservas_str con sus
#                 policies vigentes y su sello creado_por
#   2 · datos     padrón (13 cuentas) + roles de STR + unidades (con nombre repetido e inactiva)
#                 + reservas previas (confirmada, cancelada, otra empresa)
#   3 · migra     aplica la migración DOS veces → idempotente, la huella del catálogo no cambia
#   4 · invariantes  assert.sql (A–I): vista previa con errores por campo, aplicar con error no
#                 escribe, aplicar OK sella creado_por, reutilizada, duplicado por contenido,
#                 re-evaluación al aplicar, descartar, permisos y alcance, candado por RPC,
#                 inventario
#   5 · concurrencia  con SESIONES REALES: el mismo lote aplicado dos veces a la vez y dos
#                 lotes con el mismo contenido a la vez
#   6 · mutantes  copias de la migración, cada una sin una compuerta: la suite DEBE fallar
#
# USO:  supabase/tests/str_importacion/run.sh
# Requiere initdb/pg_ctl/psql. No toca ningún proyecto remoto: cluster temporal.
# ════════════════════════════════════════════════════════════════════════════
set -euo pipefail

AQUI="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RAIZ="$(cd "$AQUI/../../.." && pwd)"
EVID="$RAIZ/supabase/tests/housekeeping_evidencias"
RESP="$RAIZ/supabase/tests/housekeeping_responsable"
MIGS="$RAIZ/supabase/migrations"
NUESTRA="$MIGS/20261031000100_str_reservas_importar.sql"

for d in /usr/lib/postgresql/*/bin; do [ -d "$d" ] && PATH="$d:$PATH"; done
export PATH
command -v initdb >/dev/null || { echo "❌ falta initdb (instalá PostgreSQL)"; exit 1; }

DATA=$(mktemp -d /tmp/stridata.XXXX)
SOCK=$(mktemp -d /tmp/strisock.XXXX)
SALIDAS=$(mktemp -d /tmp/striout.XXXX)
MUT=$(mktemp /tmp/strimut.XXXX.sql)
chmod 777 "$SALIDAS"
PUERTO=${PGPORT_TEST:-55464}

COMO=""
if [ "$(id -u)" = "0" ]; then
  id postgres >/dev/null 2>&1 || useradd -m postgres
  COMO="su postgres -c"
  chmod 755 "$AQUI" "$EVID" "$RESP" 2>/dev/null || true
fi
correr() { if [ -n "$COMO" ]; then su postgres -c "PATH=$PATH $*"; else eval "$*"; fi; }

limpiar() {
  correr "pg_ctl -D $DATA stop -m immediate" >/dev/null 2>&1 || true
  rm -rf "$DATA" "$SOCK" "$SALIDAS" "$MUT"
}
trap limpiar EXIT
if [ -n "$COMO" ]; then chown -R postgres "$DATA" "$SOCK"; chmod 644 "$MUT"; fi

correr "initdb -D $DATA -U postgres --auth=trust" >/dev/null
correr "pg_ctl -D $DATA -o '-p $PUERTO -k $SOCK' -l $DATA/pg.log start" >/dev/null
sleep 2

export PGHOST="$SOCK" PGPORT="$PUERTO" PGUSER=postgres
psql -q -d postgres -c "CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN; CREATE ROLE service_role NOLOGIN BYPASSRLS;" >/dev/null
for db in stri strm1 strm2 strm3 strm4 strm5; do psql -q -d postgres -c "CREATE DATABASE $db" >/dev/null; done

aplicar() { PGOPTIONS="-c client_min_messages=warning" psql -q -v ON_ERROR_STOP=1 -d "$1" -f "$2" >/dev/null; }
huella() { psql -q -At -d "$1" -f "$AQUI/huella.sql"; }
cd "$AQUI"

datos() {
  psql -q -v ON_ERROR_STOP=1 -d "$1" <<'SQL' >/dev/null
\i ../housekeeping_evidencias/lib.sql
\i ../housekeeping_responsable/datos.sql
\i datos.sql
SQL
}

preparar() {   # $1 = base · $2 = archivo de migración
  aplicar "$1" "$EVID/fixture.sql"
  aplicar "$1" "$RESP/fixture_rbac.sql"
  aplicar "$1" "$AQUI/fixture_str.sql"
  datos "$1"
  aplicar "$1" "$2"
}

echo "── 1/6 · fixture (esquema mínimo + RBAC real + reservas_str con sus policies) ──"
aplicar stri "$EVID/fixture.sql"
aplicar stri "$RESP/fixture_rbac.sql"
aplicar stri "$AQUI/fixture_str.sql"
echo "  OK    user_has_permission vigente, reservas_str con RLS y sello creado_por"

echo "── 2/6 · datos ─────────────────────────────────────────────────────────"
datos stri
echo "  OK    13 cuentas, roles de STR, 7 unidades, 3 reservas previas"

echo "── 3/6 · la migración, DOS veces ───────────────────────────────────────"
aplicar stri "$NUESTRA"
H1=$(huella stri)
aplicar stri "$NUESTRA"
H2=$(huella stri)
[ "$H1" = "$H2" ] || { echo "❌ re-aplicar la migración cambió el catálogo ($H1 ≠ $H2)"; exit 1; }
echo "  OK    idempotente: la huella del catálogo no cambia al re-aplicar"

echo "── 4/6 · invariantes ───────────────────────────────────────────────────"
CODIGO=0
SALIDA=$(psql -q -v ON_ERROR_STOP=1 -d stri -f "$AQUI/assert.sql" 2>&1) || CODIGO=$?
echo "$SALIDA" | sed -n 's/.*NOTICE:  /  /p'
if [ "$CODIGO" -ne 0 ]; then
  echo; echo "❌ una invariante no se cumple:"
  echo "$SALIDA" | grep -E "ERROR|DETAIL|CONTEXT|LINE" | head -12
  exit 1
fi
TOTAL=$(echo "$SALIDA" | grep -c "NOTICE:  OK")
echo "  OK    $TOTAL comprobaciones"

echo "── 5/6 · concurrencia con sesiones reales ──────────────────────────────"
U3=c0000000-0000-0000-0000-000000000003
sesion() {   # sesion <espera_inicial> <sql> <espera_antes_de_commit>
  psql -q -X -t -A -v ON_ERROR_STOP=1 -d stri <<SQL
SELECT pg_sleep($1);
SELECT set_config('app.uid', '$U3', false);
SET ROLE authenticated;
BEGIN;
$2
SELECT pg_sleep($3);
COMMIT;
SQL
}
par() {
  sesion 0   "$2" 1.5 > "$SALIDAS/${1}1.txt" 2>&1 &
  local p1=$!
  sesion 0.3 "$3" 0   > "$SALIDAS/${1}2.txt" 2>&1 &
  local p2=$!
  wait $p1 $p2 || true
}
psql -q -v ON_ERROR_STOP=1 -d stri -f "$AQUI/concurrencia_prep.sql" >/dev/null
L1=$(psql -q -t -A -d stri -c "SELECT id FROM public.zz_lotes_str WHERE k = 'l1'")
L2A=$(psql -q -t -A -d stri -c "SELECT id FROM public.zz_lotes_str WHERE k = 'l2a'")
L2B=$(psql -q -t -A -d stri -c "SELECT id FROM public.zz_lotes_str WHERE k = 'l2b'")
ANTES=$(psql -q -t -A -d stri -c "SELECT count(*) FROM public.reservas_str WHERE codigo_confirmacion LIKE 'CC-%'")
par m "SELECT public.str_reservas_importar_aplicar('$L1')->>'reutilizada';" \
      "SELECT public.str_reservas_importar_aplicar('$L1')->>'reutilizada';"
N_M=$(psql -q -t -A -d stri -c "SELECT count(*) FROM public.reservas_str WHERE codigo_confirmacion IN ('CC-1','CC-2','CC-3')")
R_M=$(cat "$SALIDAS"/m1.txt "$SALIDAS"/m2.txt | grep -c '^true$' || true)
F_M=$(cat "$SALIDAS"/m1.txt "$SALIDAS"/m2.txt | grep -c '^false$' || true)
[ "$ANTES" = "0" ] && [ "$N_M" = "3" ] && [ "$R_M" = "1" ] && [ "$F_M" = "1" ] \
  && echo "  OK    M · el mismo lote aplicado a la vez: UNA creación (3 reservas) y la otra sesión recibió el resultado ya aplicado" \
  || { echo "❌ M · antes=$ANTES reservas=$N_M reutilizadas=$R_M creadas=$F_M"; cat "$SALIDAS"/m1.txt "$SALIDAS"/m2.txt; exit 1; }
par n "SELECT public.str_reservas_importar_aplicar('$L2A')->>'reservas_creadas';" \
      "SELECT public.str_reservas_importar_aplicar('$L2B')->>'reservas_creadas';"
N_N=$(psql -q -t -A -d stri -c "SELECT count(*) FROM public.reservas_str WHERE codigo_confirmacion IN ('CC-4','CC-5')")
D_N=$(cat "$SALIDAS"/n1.txt "$SALIDAS"/n2.txt | grep -c 'STR_IMPORT_DUPLICADO\|STR_IMPORT_CON_ERRORES' || true)
[ "$N_N" = "2" ] && [ "$D_N" = "1" ] \
  && echo "  OK    N · dos lotes con el mismo contenido a la vez: uno se aplicó (2 reservas) y el otro se rechazó" \
  || { echo "❌ N · reservas=$N_N rechazos=$D_N"; cat "$SALIDAS"/n1.txt "$SALIDAS"/n2.txt; exit 1; }

echo "── 6/6 · mutantes: sin cada compuerta, la suite debe fallar ────────────"
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
mutante strm1 "código repetido = error"     "WHERE r.company_id = p_company AND r.project_id = p_project AND r.estado <> 'cancelada'" "WHERE false"
mutante strm2 "permiso de crear"            "IF NOT public.str_import_puede_crear() THEN"                                             "IF false THEN"
mutante strm3 "acceso al proyecto"          "OR NOT COALESCE(public.can_access_project(p_project_id), false) THEN"                    "OR false THEN"
mutante strm4 "re-evaluación al aplicar"    "IF v_errs > 0 OR v_dup > 0 THEN"                                                         "IF false THEN"
mutante strm5 "unidad del proyecto"         "WHERE u.company_id = p_company AND u.project_id = p_project AND u.activo"                 "WHERE u.company_id = p_company AND u.activo"

echo
echo "✅ str_importacion: vista previa validada en el servidor, todo o nada, idempotente, bajo la RLS y el sello del llamador"
