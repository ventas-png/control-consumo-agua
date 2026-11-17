#!/usr/bin/env bash
# ════════════════════════════════════════════════════════════════════════════
# Verificación EJECUTABLE de 20261130000000_agua_historial_lecturas.
#
# QUÉ HACE
#   1 · base       fixture de registrar_lectura (tenancy, padrón de agua, RLS
#                  real de registros) + fixture-extra (RLS de contadores, sello,
#                  número de serie repetido, contador con lecturas)
#   2 · migra      aplica la migración DOS veces → idempotente, la huella no cambia
#   3 · invariantes  assert.sql (A–D), COMO cada persona
#   4 · mutantes   copias de la migración, cada una sin una compuerta: la suite DEBE fallar
#
# USO:  supabase/tests/historial_lecturas/run.sh
# Requiere initdb/pg_ctl/psql. No toca ningún proyecto remoto: cluster temporal.
# ════════════════════════════════════════════════════════════════════════════
set -euo pipefail

AQUI="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RAIZ="$(cd "$AQUI/../../.." && pwd)"
LECT="$RAIZ/supabase/tests/registrar_lectura"
NUESTRA="$RAIZ/supabase/migrations/20261130000000_agua_historial_lecturas.sql"

for d in /usr/lib/postgresql/*/bin; do [ -d "$d" ] && PATH="$d:$PATH"; done
export PATH
command -v initdb >/dev/null || { echo "❌ falta initdb (instalá PostgreSQL)"; exit 1; }

DATA=$(mktemp -d /tmp/histdata.XXXX)
SOCK=$(mktemp -d /tmp/histsock.XXXX)
MUT=$(mktemp /tmp/histmut.XXXX.sql)
PUERTO=${PGPORT_TEST:-55594}

COMO=""
if [ "$(id -u)" = "0" ]; then
  id postgres >/dev/null 2>&1 || useradd -m postgres
  COMO="su postgres -c"
  chmod 755 "$AQUI" "$LECT" 2>/dev/null || true
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
psql -q -d postgres -c "CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN;" >/dev/null
for db in hist histm1 histm2 histm3 histm4 histm5 histm6 histm7; do psql -q -d postgres -c "CREATE DATABASE $db" >/dev/null; done

aplicar() { PGOPTIONS="-c client_min_messages=warning" psql -q -v ON_ERROR_STOP=1 -d "$1" -f "$2" >/dev/null; }
huella() { psql -q -At -d "$1" -f "$AQUI/huella.sql"; }
cd "$AQUI"

base() {
  aplicar "$1" "$LECT/fixture.sql"
  aplicar "$1" "$AQUI/fixture-extra.sql"
  psql -q -d "$1" -c "
    GRANT USAGE ON SCHEMA public, auth TO authenticated, anon;
    GRANT SELECT, UPDATE ON public.contadores TO authenticated;
    GRANT SELECT ON public.registros, public.tarifas, public.unidades, public.clientes,
                    public.projects, public.companies, public.app_users,
                    public.user_project_assignments, public.test_permisos TO authenticated;
  " >/dev/null
}
preparar() { base "$1"; aplicar "$1" "$2"; }

echo "── 1/4 · fixture: tenancy, padrón de agua, RLS de registros y contadores ─"
base hist
echo "  OK    2 empresas · 3 proyectos · 5 cuentas · 9 contadores · 1 lectura del sistema"

echo "── 2/4 · la migración, DOS veces ───────────────────────────────────────"
aplicar hist "$NUESTRA"
H1=$(huella hist)
aplicar hist "$NUESTRA"
H2=$(huella hist)
[ "$H1" = "$H2" ] || { echo "❌ re-aplicar la migración cambió el catálogo ($H1 ≠ $H2)"; exit 1; }
echo "  OK    idempotente: la huella del catálogo no cambia al re-aplicar"

echo "── 3/4 · invariantes ───────────────────────────────────────────────────"
CODIGO=0
SALIDA=$(psql -q -v ON_ERROR_STOP=1 -d hist -f "$AQUI/assert.sql" 2>&1) || CODIGO=$?
echo "$SALIDA" | sed -n 's/.*NOTICE:  /  /p'
if [ "$CODIGO" -ne 0 ]; then
  echo; echo "❌ una invariante no se cumple:"
  echo "$SALIDA" | grep -E "ERROR|DETAIL|CONTEXT|LINE" | head -12
  exit 1
fi
TOTAL=$(echo "$SALIDA" | grep -c "NOTICE:  OK")
echo "  OK    $TOTAL comprobaciones"

echo "── 4/4 · mutantes: sin cada compuerta, la suite debe fallar ────────────"
mutante() {   # $1 = base · $2 = etiqueta · $3 = patrón que se quita · $4 = reemplazo · $5 = «todas» (opcional)
  grep -qF -- "$3" "$NUESTRA" || { echo "❌ el mutante «$2» no encuentra su línea en la migración: $3"; exit 1; }
  python3 - "$NUESTRA" "$MUT" "$3" "$4" "${5:-}" <<'PY2'
import sys
src, dst, pat, rep, todas = sys.argv[1:6]
s = open(src, encoding='utf-8').read()
assert s.count(pat) >= 1
open(dst, 'w', encoding='utf-8').write(s.replace(pat, rep) if todas else s.replace(pat, rep, 1))
PY2
  preparar "$1" "$MUT"
  if psql -q -v ON_ERROR_STOP=1 -d "$1" -f "$AQUI/assert.sql" >/dev/null 2>&1; then
    echo "❌ el mutante «$2» pasó la suite: la regla no está probada"; exit 1
  fi
  echo "  OK    sin [$2] la suite falla"
}
mutante histm1 "alcance por proyecto"            "      AND public.can_access_project(project_id)
" "" todas
mutante histm2 "empresa de quien escribe"        "      company_id = (SELECT public.get_my_company_id())
      AND public.can_access_project(project_id)" "      public.can_access_project(project_id)" todas
mutante histm3 "el proyecto sale del contador"   "  NEW.project_id := v_project;" ""
mutante histm4 "no pisa contadores con lecturas" "       AND NOT b.tiene_lecturas
" ""
mutante histm5 "la base sólo sube"               "       AND b.lectura > b.inicial
    RETURNING c.id" "    RETURNING c.id"
mutante histm6 "no hereda de antes de instalar"  "       AND (b.instalacion IS NULL OR b.fecha >= b.instalacion)
       AND b.lectura > b.inicial" "       AND b.lectura > b.inicial"
mutante histm7 "todo o nada"                     "  IF v_errores IS NOT NULL THEN" "  IF false THEN"

echo
echo "✅ historial_lecturas: importa por número de serie en el proyecto, todo o nada, sin cobrar, y la lectura inicial sólo cuando corresponde"
