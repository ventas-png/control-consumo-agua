#!/usr/bin/env bash
# ════════════════════════════════════════════════════════════════════════════
# Verificación EJECUTABLE de 20261213000000_padron_rls_una_vez_por_consulta.
#
# QUÉ HACE
#   1 · base       fixture de registrar_lectura + fixture-extra: las policies
#                  ANTERIORES (forma de producción) y la foto de lo que ve cada
#                  persona con ellas
#   2 · migra      aplica la migración DOS veces → idempotente
#   3 · invariantes  assert.sql (A–C): cada persona ve lo mismo que antes
#   4 · mutantes   copias de la migración, cada una sin una compuerta: la suite DEBE fallar
#
# USO:  supabase/tests/padron_rls_por_consulta/run.sh
# Requiere initdb/pg_ctl/psql. No toca ningún proyecto remoto: cluster temporal.
# ════════════════════════════════════════════════════════════════════════════
set -euo pipefail

AQUI="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RAIZ="$(cd "$AQUI/../../.." && pwd)"
LECT="$RAIZ/supabase/tests/registrar_lectura"
NUESTRA="$RAIZ/supabase/migrations/20261213000000_padron_rls_una_vez_por_consulta.sql"

for d in /usr/lib/postgresql/*/bin; do [ -d "$d" ] && PATH="$d:$PATH"; done
export PATH
command -v initdb >/dev/null || { echo "❌ falta initdb (instalá PostgreSQL)"; exit 1; }

DATA=$(mktemp -d /tmp/pdrdata.XXXX)
SOCK=$(mktemp -d /tmp/pdrsock.XXXX)
MUT=$(mktemp /tmp/pdrmut.XXXX.sql)
PUERTO=${PGPORT_TEST:-55599}

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
psql -q -d postgres -c "CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN; CREATE ROLE service_role NOLOGIN;" >/dev/null
N_MUT=18
psql -q -d postgres -c "CREATE DATABASE pdr" >/dev/null
for i in $(seq 1 $N_MUT); do psql -q -d postgres -c "CREATE DATABASE pdrm$i" >/dev/null; done

aplicar() { PGOPTIONS="-c client_min_messages=warning" psql -q -v ON_ERROR_STOP=1 -d "$1" -f "$2" >/dev/null; }
huella() { psql -q -At -d "$1" -f "$AQUI/huella.sql"; }
cd "$AQUI"

# Los permisos van ANTES del fixture-extra: su última sentencia toma la foto de
# lo que ve cada persona como `authenticated`.
base() {
  aplicar "$1" "$LECT/fixture.sql"
  psql -q -d "$1" -c "
    GRANT USAGE ON SCHEMA public, auth TO authenticated, anon;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO authenticated;
    GRANT SELECT ON ALL TABLES IN SCHEMA public TO authenticated;
  " >/dev/null
  aplicar "$1" "$AQUI/fixture-extra.sql"
}

echo "── 1/4 · fixture: policies anteriores y la foto de lo que ve cada persona ─"
base pdr
echo "  OK    2 empresas · 3 proyectos · 16 personas · 9 contadores · 6 unidades"

echo "── 2/4 · la migración, DOS veces ───────────────────────────────────────"
aplicar pdr "$NUESTRA"
H1=$(huella pdr)
aplicar pdr "$NUESTRA"
H2=$(huella pdr)
[ "$H1" = "$H2" ] || { echo "❌ re-aplicar la migración cambió el catálogo ($H1 ≠ $H2)"; exit 1; }
echo "  OK    idempotente: la huella de las policies no cambia al re-aplicar"

echo "── 3/4 · invariantes ───────────────────────────────────────────────────"
CODIGO=0
SALIDA=$(psql -q -v ON_ERROR_STOP=1 -d pdr -f "$AQUI/assert.sql" 2>&1) || CODIGO=$?
echo "$SALIDA" | sed -n 's/.*NOTICE:  /  /p'
if [ "$CODIGO" -ne 0 ]; then
  echo; echo "❌ una invariante no se cumple:"
  echo "$SALIDA" | grep -E "ERROR|DETAIL|CONTEXT|LINE" | head -12
  exit 1
fi
TOTAL=$(echo "$SALIDA" | grep -c "NOTICE:  OK")
echo "  OK    $TOTAL comprobaciones"

echo "── 4/4 · mutantes: sin cada compuerta, la suite debe fallar ────────────"
M=0
mutante() {   # $1 = etiqueta · $2 = patrón que se quita · $3 = reemplazo · $4 = cuál aparición (1 si es única)
  M=$((M + 1))
  python3 - "$NUESTRA" "$MUT" "$2" "$3" "${4:-0}" <<'PY2' || { echo "❌ el mutante «$1» no encuentra su línea (o no aparece las veces esperadas): $2"; exit 1; }
import sys
src, dst, pat, rep, cual = sys.argv[1:6]
cual = int(cual)
s = open(src, encoding='utf-8').read()
partes = s.split(pat)
if cual == 0:
    if len(partes) != 2: sys.exit(1)
    cual = 1
elif len(partes) != 3:
    sys.exit(1)
s = pat.join(partes[:cual]) + rep + pat.join(partes[cual:])
open(dst, 'w', encoding='utf-8').write(s)
PY2
  chmod 644 "$MUT"
  base "pdrm$M"; aplicar "pdrm$M" "$MUT"
  if psql -q -v ON_ERROR_STOP=1 -d "pdrm$M" -f "$AQUI/assert.sql" >/dev/null 2>&1; then
    echo "❌ el mutante «$1» pasó la suite: la regla no está probada"; exit 1
  fi
  echo "  OK    sin [$1] la suite falla"
}
# contadores (1.ª aparición) y unidades (2.ª) comparten casi todas las líneas.
for T in 1 2; do
  [ "$T" = 1 ] && TABLA=contadores || TABLA=unidades
  mutante "$TABLA · la dueña sólo ve SU empresa"        "          AND $TABLA.company_id = (SELECT public.get_my_company_id())
        )" "        )"
  mutante "$TABLA · el rol decide sobre cada proyecto"  "
           WHERE public.has_admin_project_access(m.x)
              OR public.has_operator_project_access(m.x)
              OR public.has_viewer_project_access(m.x)" "" "$T"
  mutante "$TABLA · el permiso es de SU empresa"        "          $TABLA.company_id = (SELECT public.get_my_company_id())
          AND (SELECT" "          (SELECT"
  mutante "$TABLA · alcance por proyecto"               "        $TABLA.project_id IS NULL
        OR" "        true
        OR"
  mutante "$TABLA · super admin"                        "    (SELECT public.has_super_admin_access())" "    true" "$T"
done
mutante "contadores · con el permiso"                  "(SELECT public.user_has_permission('agua.contadores.view'))" "true"
mutante "unidades · con el permiso"                    "(SELECT public.user_has_permission('platform.unidades.view'))" "true"
mutante "contadores · la rama del residente es sólo del residente" "      (SELECT public.current_user_role()) = 'cliente'
      AND contadores.activo = true" "      contadores.activo = true"
mutante "unidades · la rama del residente es sólo del residente" "      (SELECT public.current_user_role()) = 'cliente'
      AND unidades.id IN" "      unidades.id IN"
mutante "contadores · el residente no ve el dado de baja" "      AND contadores.activo = true
" ""
mutante "contadores · el residente sólo ve los de SUS unidades" "         WHERE u.cliente_id = (SELECT public.get_my_cliente_id())" "         WHERE true"
mutante "los proyectos asignados son los de quien llama" "   WHERE upa.user_id = (SELECT auth.uid())" "   WHERE true"
mutante "el proyecto del perfil es el de quien llama"  "   WHERE au.id = (SELECT auth.uid())" "   WHERE true"
[ "$M" -eq "$N_MUT" ] || { echo "❌ se esperaban $N_MUT mutantes y corrieron $M"; exit 1; }

echo
echo "✅ padron_rls_por_consulta: la RLS de contadores y unidades se calcula una vez por consulta y cada persona ve lo mismo que antes"
