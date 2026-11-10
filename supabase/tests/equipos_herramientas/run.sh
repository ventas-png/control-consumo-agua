#!/usr/bin/env bash
# ════════════════════════════════════════════════════════════════════════════
# Verificación EJECUTABLE de 20261122000000 (Equipos junto a Suministros; las herramientas y el
# equipo de las actividades salen de equipos_comunes, no de Inventario).
#
# QUÉ HACE
#   1 · fixture   esquema mínimo de Supabase (housekeeping_evidencias) + RBAC REAL
#                 (housekeeping_responsable/fixture_rbac.sql) + áreas, suministros, inventario,
#                 catálogo de actividades y puentes (plantillas_importacion) + permissions y
#                 catálogos RRHH (rrhh_catalogos) + equipos_comunes TAL COMO ERA (fixture_equipos.sql)
#   2 · datos     padrón (14 cuentas), roles con y sin condominios.tab.equipos, equipos (de baja,
#                 ambiguo, otro proyecto, otra empresa) y una puente LEGADA a Inventario
#   3 · migra     aplica 20261031000200 y 20261031000300 (las RPC que esta migración reemplaza) y
#                 luego la migración DOS veces → idempotente, la huella no cambia
#   4 · invariantes  assert.sql (A–F): esquema, puente a mano, vista previa por nombre contra
#                 Equipos, aplicar, recursos en bloque con p_equipos, ACL
#   5 · mutantes  copias de la migración, cada una sin una compuerta: la suite DEBE fallar
#
# USO:  supabase/tests/equipos_herramientas/run.sh
# Requiere initdb/pg_ctl/psql. No toca ningún proyecto remoto: cluster temporal.
# ════════════════════════════════════════════════════════════════════════════
set -euo pipefail

AQUI="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RAIZ="$(cd "$AQUI/../../.." && pwd)"
EVID="$RAIZ/supabase/tests/housekeeping_evidencias"
RESP="$RAIZ/supabase/tests/housekeeping_responsable"
PLAI="$RAIZ/supabase/tests/plantillas_importacion"
RRHH="$RAIZ/supabase/tests/rrhh_catalogos"
MIGS="$RAIZ/supabase/migrations"
PREVIA1="$MIGS/20261031000200_plantillas_actividades_importar_y_recursos_bloque.sql"
PREVIA2="$MIGS/20261031000300_rrhh_catalogos_cargos_y_turnos.sql"
NUESTRA="$MIGS/20261122000000_equipos_operativos_y_herramientas_desde_equipos.sql"

for d in /usr/lib/postgresql/*/bin; do [ -d "$d" ] && PATH="$d:$PATH"; done
export PATH
command -v initdb >/dev/null || { echo "❌ falta initdb (instalá PostgreSQL)"; exit 1; }

DATA=$(mktemp -d /tmp/eqhdata.XXXX)
SOCK=$(mktemp -d /tmp/eqhsock.XXXX)
MUT=$(mktemp /tmp/eqhmut.XXXX.sql)
PUERTO=${PGPORT_TEST:-55467}

COMO=""
if [ "$(id -u)" = "0" ]; then
  id postgres >/dev/null 2>&1 || useradd -m postgres
  COMO="su postgres -c"
  chmod 755 "$AQUI" "$EVID" "$RESP" "$PLAI" "$RRHH" 2>/dev/null || true
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
for db in eqh eqhm1 eqhm2 eqhm3 eqhm4 eqhm5; do psql -q -d postgres -c "CREATE DATABASE $db" >/dev/null; done

aplicar() { PGOPTIONS="-c client_min_messages=warning" psql -q -v ON_ERROR_STOP=1 -d "$1" -f "$2" >/dev/null; }
huella() { psql -q -At -d "$1" -f "$AQUI/huella.sql"; }
cd "$AQUI"

datos() {
  psql -q -v ON_ERROR_STOP=1 -d "$1" <<'SQL' >/dev/null
\i ../housekeeping_evidencias/lib.sql
\i ../housekeeping_responsable/datos.sql
\i ../plantillas_importacion/datos.sql
\i ../rrhh_catalogos/datos.sql
\i datos.sql
SQL
}

preparar() {   # $1 = base · $2 = archivo de migración
  aplicar "$1" "$EVID/fixture.sql"
  aplicar "$1" "$RESP/fixture_rbac.sql"
  aplicar "$1" "$PLAI/fixture_plantillas.sql"
  aplicar "$1" "$RRHH/fixture_rrhh.sql"
  aplicar "$1" "$AQUI/fixture_equipos.sql"
  datos "$1"
  aplicar "$1" "$PREVIA1"
  aplicar "$1" "$PREVIA2"
  aplicar "$1" "$2"
}

echo "── 1/5 · fixture (esquema mínimo + RBAC real + catálogo, puentes, RRHH y equipos como era) ──"
aplicar eqh "$EVID/fixture.sql"
aplicar eqh "$RESP/fixture_rbac.sql"
aplicar eqh "$PLAI/fixture_plantillas.sql"
aplicar eqh "$RRHH/fixture_rrhh.sql"
aplicar eqh "$AQUI/fixture_equipos.sql"
echo "  OK    user_has_permission vigente; equipos_comunes sin cantidad/foto ni ancla; la puente aún exige inventario_id"

echo "── 2/5 · datos ─────────────────────────────────────────────────────────"
datos eqh
echo "  OK    14 cuentas, roles con y sin Equipos, 8 equipos, puente legada a Inventario"

echo "── 3/5 · 20261031000200, 20261031000300 y la migración, DOS veces ──────"
aplicar eqh "$PREVIA1"
aplicar eqh "$PREVIA2"
aplicar eqh "$NUESTRA"
H1=$(huella eqh)
aplicar eqh "$NUESTRA"
H2=$(huella eqh)
[ "$H1" = "$H2" ] || { echo "❌ re-aplicar la migración cambió el catálogo ($H1 ≠ $H2)"; exit 1; }
echo "  OK    idempotente: la huella (esquema, funciones, ACL, permisos y la puente legada) no cambia al re-aplicar"

echo "── 4/5 · invariantes ───────────────────────────────────────────────────"
CODIGO=0
SALIDA=$(psql -q -v ON_ERROR_STOP=1 -d eqh -f "$AQUI/assert.sql" 2>&1) || CODIGO=$?
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
mutante eqhm1 "exactamente uno de equipo_id / inventario_id" "ADD CONSTRAINT pt_herramienta_recurso_check CHECK ((inventario_id IS NULL) <> (equipo_id IS NULL));" "ADD CONSTRAINT pt_herramienta_recurso_check CHECK (true);"
mutante eqhm2 "trigger: el equipo es de otro proyecto"    "     OR v_rec_project IS DISTINCT FROM v_plantilla.project_id THEN"                                           "     THEN"
mutante eqhm3 "vista previa: equipo de baja"              "       WHERE e.company_id = p_company AND e.project_id = p_project AND e.estado <> 'baja'"                   "       WHERE e.company_id = p_company AND e.project_id = p_project"
mutante eqhm4 "bloque: permiso de ver Equipos"            "  IF jsonb_array_length(v_eq) > 0 AND NOT COALESCE(public.user_has_permission('condominios.tab.equipos'), false) THEN" "  IF false THEN"
mutante eqhm5 "bloque: sin tocar pares (índice parcial)"  "    ON CONFLICT (plantilla_tarea_id, equipo_id) WHERE equipo_id IS NOT NULL DO NOTHING;"                   "    ;"

echo
echo "✅ equipos_herramientas: equipos con cantidad y foto; las herramientas de las actividades salen de Equipos (por nombre, a mano y en bloque), el legado de Inventario sigue vigente y la ACL queda cerrada"
