#!/usr/bin/env bash
# ════════════════════════════════════════════════════════════════════════════
# Verificación EJECUTABLE de 20261204000000_unidad_proyecto_arrastra_contadores.
#
# QUÉ HACE
#   1 · base       fixture de registrar_lectura + el de historial_lecturas, las
#                  migraciones 20260522000001 (contador ← unidad) y 20261130000000
#                  (historial), y fixture-extra: una unidad movida de proyecto
#                  ANTES del arrastre, con su contador y su historial atrás
#   2 · migra      aplica la migración DOS veces → idempotente, la huella no cambia
#   3 · invariantes  assert.sql (A–F), COMO cada persona
#   4 · mutantes   copias de la migración, cada una sin una pieza: la suite DEBE fallar
#
# USO:  supabase/tests/unidad_arrastra_contadores/run.sh
# Requiere initdb/pg_ctl/psql. No toca ningún proyecto remoto: cluster temporal.
# ════════════════════════════════════════════════════════════════════════════
set -euo pipefail

AQUI="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RAIZ="$(cd "$AQUI/../../.." && pwd)"
LECT="$RAIZ/supabase/tests/registrar_lectura"
HIST="$RAIZ/supabase/tests/historial_lecturas"
SYNC="$RAIZ/supabase/migrations/20260522000001_sync_contador_project_from_unidad.sql"
HISTMIG="$RAIZ/supabase/migrations/20261130000000_agua_historial_lecturas.sql"
PADRON="$RAIZ/supabase/migrations/20261205000000_agua_historial_importar_padron_unico.sql"
NUESTRA="$RAIZ/supabase/migrations/20261204000000_unidad_proyecto_arrastra_contadores.sql"

for d in /usr/lib/postgresql/*/bin; do [ -d "$d" ] && PATH="$d:$PATH"; done
export PATH
command -v initdb >/dev/null || { echo "❌ falta initdb (instalá PostgreSQL)"; exit 1; }

DATA=$(mktemp -d /tmp/uacdata.XXXX)
SOCK=$(mktemp -d /tmp/uacsock.XXXX)
MUT=$(mktemp /tmp/uacmut.XXXX.sql)
PUERTO=${PGPORT_TEST:-55596}

COMO=""
if [ "$(id -u)" = "0" ]; then
  id postgres >/dev/null 2>&1 || useradd -m postgres
  COMO="su postgres -c"
  chmod 755 "$AQUI" "$LECT" "$HIST" 2>/dev/null || true
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
for db in uac uacm1 uacm2 uacm3 uacm4 uacm5; do psql -q -d postgres -c "CREATE DATABASE $db" >/dev/null; done

aplicar() { PGOPTIONS="-c client_min_messages=warning" psql -q -v ON_ERROR_STOP=1 -d "$1" -f "$2" >/dev/null; }
huella() { psql -q -At -d "$1" -f "$AQUI/huella.sql"; }
cd "$AQUI"

base() {
  aplicar "$1" "$LECT/fixture.sql"
  aplicar "$1" "$HIST/fixture-extra.sql"
  aplicar "$1" "$SYNC"
  aplicar "$1" "$HISTMIG"
  aplicar "$1" "$PADRON"
  aplicar "$1" "$AQUI/fixture-extra.sql"
  psql -q -d "$1" -c "
    GRANT USAGE ON SCHEMA public, auth TO authenticated, anon;
    GRANT SELECT, UPDATE ON public.contadores, public.unidades TO authenticated;
    GRANT SELECT ON public.registros, public.tarifas, public.clientes,
                    public.projects, public.companies, public.app_users,
                    public.user_project_assignments, public.test_permisos TO authenticated;
  " >/dev/null
}
preparar() { base "$1"; aplicar "$1" "$2"; }

echo "── 1/4 · fixture: padrón de agua, historial y una unidad ya movida de proyecto ─"
base uac
DESF=$(psql -q -At -d uac -c "SELECT count(*) FROM public.contadores c JOIN public.unidades u ON u.id = c.unidad_id WHERE c.project_id IS DISTINCT FROM u.project_id")
[ "$DESF" = "1" ] || { echo "❌ el fixture debía dejar 1 contador desfasado y dejó $DESF"; exit 1; }
echo "  OK    3 proyectos · 3 unidades · 1 contador en un proyecto distinto al de su unidad"

echo "── 2/4 · la migración, DOS veces ───────────────────────────────────────"
aplicar uac "$NUESTRA"
H1=$(huella uac)
aplicar uac "$NUESTRA"
H2=$(huella uac)
[ "$H1" = "$H2" ] || { echo "❌ re-aplicar la migración cambió el catálogo o los datos ($H1 ≠ $H2)"; exit 1; }
echo "  OK    idempotente: ni el catálogo ni los datos cambian al re-aplicar"

echo "── 3/4 · invariantes ───────────────────────────────────────────────────"
CODIGO=0
SALIDA=$(psql -q -v ON_ERROR_STOP=1 -d uac -f "$AQUI/assert.sql" 2>&1) || CODIGO=$?
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
mutante uacm1 "la unidad arrastra sus contadores"      "   WHERE c.unidad_id = NEW.id" "   WHERE false AND c.unidad_id = NEW.id"
mutante uacm2 "arrastra aunque no pueda editarlos"   "SECURITY DEFINER
SET search_path = ''
AS \$\$
BEGIN
  UPDATE public.contadores c" "SECURITY INVOKER
SET search_path = ''
AS \$\$
BEGIN
  UPDATE public.contadores c"
mutante uacm3 "el contador arrastra su historial"    "   WHERE h.contador_id = NEW.id" "   WHERE false AND h.contador_id = NEW.id"
mutante uacm4 "dispara aunque no se nombre project_id" "  AFTER UPDATE ON public.contadores" "  AFTER UPDATE OF project_id, company_id ON public.contadores"
mutante uacm5 "corrige lo ya desfasado"              " WHERE u.id = c.unidad_id
   AND u.project_id IS NOT NULL" " WHERE false AND u.id = c.unidad_id"

echo
echo "✅ unidad_arrastra_contadores: mover una unidad de proyecto mueve sus contadores y su historial, sin tocar registros"
