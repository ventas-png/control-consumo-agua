#!/usr/bin/env bash
# ════════════════════════════════════════════════════════════════════════════
# Verificación EJECUTABLE de 20261031000300 (catálogos RRHH: cargos y tipos de turno).
#
# QUÉ HACE
#   1 · fixture   esquema mínimo de Supabase (housekeeping_evidencias) + RBAC REAL
#                 (housekeeping_responsable/fixture_rbac.sql) + áreas, recursos y catálogo de
#                 actividades (plantillas_importacion/fixture_plantillas.sql) + permissions,
#                 personal_condominio, programacion_limpieza y ejecuciones_limpieza CON los tres
#                 CHECK literales (fixture_rrhh.sql)
#   2 · datos     padrón (14 cuentas) + roles + filas LEGADAS (empleado Polivalente/mixto,
#                 actividad «Conserje») insertadas ANTES de la migración
#   3 · migra     aplica 20261031000200 (carga masiva) y la migración bajo prueba DOS veces
#                 → idempotente, la huella del catálogo no cambia
#   4 · invariantes  assert.sql (A–H): backfill y RBAC, proyecto nuevo, CRUD y RLS, desactivar
#                 vs borrar en uso, validación en las cuatro tablas, históricos editables,
#                 carga masiva contra el catálogo, re-sembrar
#   5 · mutantes  copias de la migración, cada una sin una compuerta: la suite DEBE fallar
#
# USO:  supabase/tests/rrhh_catalogos/run.sh
# Requiere initdb/pg_ctl/psql. No toca ningún proyecto remoto: cluster temporal.
# ════════════════════════════════════════════════════════════════════════════
set -euo pipefail

AQUI="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RAIZ="$(cd "$AQUI/../../.." && pwd)"
EVID="$RAIZ/supabase/tests/housekeeping_evidencias"
RESP="$RAIZ/supabase/tests/housekeeping_responsable"
PLAI="$RAIZ/supabase/tests/plantillas_importacion"
MIGS="$RAIZ/supabase/migrations"
PREVIA="$MIGS/20261031000200_plantillas_actividades_importar_y_recursos_bloque.sql"
NUESTRA="$MIGS/20261031000300_rrhh_catalogos_cargos_y_turnos.sql"

for d in /usr/lib/postgresql/*/bin; do [ -d "$d" ] && PATH="$d:$PATH"; done
export PATH
command -v initdb >/dev/null || { echo "❌ falta initdb (instalá PostgreSQL)"; exit 1; }

DATA=$(mktemp -d /tmp/rrhhdata.XXXX)
SOCK=$(mktemp -d /tmp/rrhhsock.XXXX)
MUT=$(mktemp /tmp/rrhhmut.XXXX.sql)
PUERTO=${PGPORT_TEST:-55466}

COMO=""
if [ "$(id -u)" = "0" ]; then
  id postgres >/dev/null 2>&1 || useradd -m postgres
  COMO="su postgres -c"
  chmod 755 "$AQUI" "$EVID" "$RESP" "$PLAI" 2>/dev/null || true
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
for db in rrhh rrhhm1 rrhhm2 rrhhm3 rrhhm4 rrhhm5 rrhhm6; do psql -q -d postgres -c "CREATE DATABASE $db" >/dev/null; done

aplicar() { PGOPTIONS="-c client_min_messages=warning" psql -q -v ON_ERROR_STOP=1 -d "$1" -f "$2" >/dev/null; }
huella() { psql -q -At -d "$1" -f "$AQUI/huella.sql"; }
cd "$AQUI"

datos() {
  psql -q -v ON_ERROR_STOP=1 -d "$1" <<'SQL' >/dev/null
\i ../housekeeping_evidencias/lib.sql
\i ../housekeeping_responsable/datos.sql
\i ../plantillas_importacion/datos.sql
\i datos.sql
SQL
}

preparar() {   # $1 = base · $2 = archivo de migración
  aplicar "$1" "$EVID/fixture.sql"
  aplicar "$1" "$RESP/fixture_rbac.sql"
  aplicar "$1" "$PLAI/fixture_plantillas.sql"
  aplicar "$1" "$AQUI/fixture_rrhh.sql"
  datos "$1"
  aplicar "$1" "$PREVIA"
  aplicar "$1" "$2"
}

echo "── 1/5 · fixture (esquema mínimo + RBAC real + catálogo + personal/limpieza con sus CHECK) ──"
aplicar rrhh "$EVID/fixture.sql"
aplicar rrhh "$RESP/fixture_rbac.sql"
aplicar rrhh "$PLAI/fixture_plantillas.sql"
aplicar rrhh "$AQUI/fixture_rrhh.sql"
echo "  OK    user_has_permission vigente; personal, actividades, programación y ejecuciones con RLS y CHECK literales"

echo "── 2/5 · datos ─────────────────────────────────────────────────────────"
datos rrhh
echo "  OK    14 cuentas, roles, empleado legado Polivalente/mixto, actividad «Conserje», programación y ejecución"

echo "── 3/5 · 20261031000200 y la migración, DOS veces ──────────────────────"
aplicar rrhh "$PREVIA"
aplicar rrhh "$NUESTRA"
H1=$(huella rrhh)
aplicar rrhh "$NUESTRA"
H2=$(huella rrhh)
[ "$H1" = "$H2" ] || { echo "❌ re-aplicar la migración cambió el catálogo ($H1 ≠ $H2)"; exit 1; }
echo "  OK    idempotente: la huella del catálogo (esquema, RBAC y siembra) no cambia al re-aplicar"

echo "── 4/5 · invariantes ───────────────────────────────────────────────────"
CODIGO=0
SALIDA=$(psql -q -v ON_ERROR_STOP=1 -d rrhh -f "$AQUI/assert.sql" 2>&1) || CODIGO=$?
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
mutante rrhhm1 "activo ignorado en el validador"  "       AND (c.activo OR NOT p_solo_activos))"                                                                      ")"
mutante rrhhm2 "IS DISTINCT FROM (históricos)"    "  IF TG_OP = 'INSERT' OR NEW.cargo IS DISTINCT FROM OLD.cargo OR NEW.project_id IS DISTINCT FROM OLD.project_id THEN"  "  IF true THEN"
mutante rrhhm3 "guarda de borrado en uso"         "  IF u.personal + u.actividades + u.programaciones > 0 THEN"                                                       "  IF false THEN"
mutante rrhhm4 "acceso al proyecto en SELECT"     "         OR (company_id = (SELECT public.get_my_company_id()) AND public.can_access_project(project_id)));"       "         OR company_id = (SELECT public.get_my_company_id()));"
mutante rrhhm5 "cargos desde el catálogo"         "  SELECT COALESCE(array_agg(c.codigo ORDER BY c.orden, c.nombre), ARRAY[]::text[]) INTO v_cargos"               "  SELECT ARRAY['conserje', 'guardia', 'jardinero', 'mantenimiento', 'administrador', 'otro'] INTO v_cargos"
mutante rrhhm6 "siembra al crear el proyecto"     "  FOR EACH ROW EXECUTE FUNCTION public.rrhh_sembrar_on_project();"                                                "  FOR EACH ROW WHEN (false) EXECUTE FUNCTION public.rrhh_sembrar_on_project();"

echo
echo "✅ rrhh_catalogos: catálogos por condominio sembrados, validados en las cuatro tablas, inmutables en su código, borrables sólo sin uso, bajo la RLS del llamador"
