#!/usr/bin/env bash
# ════════════════════════════════════════════════════════════════════════════
# Verificación EJECUTABLE de 20261212000000_lecturas_rls_una_vez_por_consulta.
#
# QUÉ HACE
#   1 · base       fixture de registrar_lectura + fixture-extra: las policies
#                  ANTERIORES (forma de producción) y la foto de lo que ve cada
#                  persona con ellas
#   2 · migra      aplica la migración DOS veces → idempotente
#   3 · invariantes  assert.sql (A–D): cada persona ve lo mismo que antes
#   4 · mutantes   copias de la migración, cada una sin una compuerta: la suite DEBE fallar
#
# USO:  supabase/tests/lecturas_rls_por_consulta/run.sh
# Requiere initdb/pg_ctl/psql. No toca ningún proyecto remoto: cluster temporal.
# ════════════════════════════════════════════════════════════════════════════
set -euo pipefail

AQUI="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RAIZ="$(cd "$AQUI/../../.." && pwd)"
LECT="$RAIZ/supabase/tests/registrar_lectura"
NUESTRA="$RAIZ/supabase/migrations/20261212000000_lecturas_rls_una_vez_por_consulta.sql"

for d in /usr/lib/postgresql/*/bin; do [ -d "$d" ] && PATH="$d:$PATH"; done
export PATH
command -v initdb >/dev/null || { echo "❌ falta initdb (instalá PostgreSQL)"; exit 1; }

DATA=$(mktemp -d /tmp/rlsdata.XXXX)
SOCK=$(mktemp -d /tmp/rlssock.XXXX)
MUT=$(mktemp /tmp/rlsmut.XXXX.sql)
PUERTO=${PGPORT_TEST:-55598}

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
N_MUT=12
psql -q -d postgres -c "CREATE DATABASE rls" >/dev/null
for i in $(seq 1 $N_MUT); do psql -q -d postgres -c "CREATE DATABASE rlsm$i" >/dev/null; done

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
    GRANT INSERT ON public.registros TO authenticated;
  " >/dev/null
  aplicar "$1" "$AQUI/fixture-extra.sql"
}

echo "── 1/4 · fixture: policies anteriores y la foto de lo que ve cada persona ─"
base rls
echo "  OK    2 empresas · 3 proyectos · 10 personas · 7 lecturas · 2 acciones de bitácora"

echo "── 2/4 · la migración, DOS veces ───────────────────────────────────────"
aplicar rls "$NUESTRA"
H1=$(huella rls)
aplicar rls "$NUESTRA"
H2=$(huella rls)
[ "$H1" = "$H2" ] || { echo "❌ re-aplicar la migración cambió el catálogo ($H1 ≠ $H2)"; exit 1; }
echo "  OK    idempotente: la huella de las policies no cambia al re-aplicar"

echo "── 3/4 · invariantes ───────────────────────────────────────────────────"
CODIGO=0
SALIDA=$(psql -q -v ON_ERROR_STOP=1 -d rls -f "$AQUI/assert.sql" 2>&1) || CODIGO=$?
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
mutante() {   # $1 = etiqueta · $2 = patrón que se quita · $3 = reemplazo
  M=$((M + 1))
  python3 - "$NUESTRA" "$MUT" "$2" "$3" <<'PY2' || { echo "❌ el mutante «$1» no encuentra su línea (o no es única): $2"; exit 1; }
import sys
src, dst, pat, rep = sys.argv[1:5]
s = open(src, encoding='utf-8').read()
if s.count(pat) != 1: sys.exit(1)
open(dst, 'w', encoding='utf-8').write(s.replace(pat, rep))
PY2
  chmod 644 "$MUT"
  base "rlsm$M"; aplicar "rlsm$M" "$MUT"
  if psql -q -v ON_ERROR_STOP=1 -d "rlsm$M" -f "$AQUI/assert.sql" >/dev/null 2>&1; then
    echo "❌ el mutante «$1» pasó la suite: la regla no está probada"; exit 1
  fi
  echo "  OK    sin [$1] la suite falla"
}
mutante "alcance por proyecto"                 "
            AND public.can_access_project(p.id)" ""
mutante "sólo los proyectos de su empresa"     "          WHERE p.company_id = (SELECT public.get_my_company_id())
            AND public.can_access_project(p.id)" "          WHERE public.can_access_project(p.id)"
mutante "permiso de lectura"                   "(SELECT public.user_has_permission('agua.mapa.view'))" "true"
mutante "lo sin proyecto, sólo de sus clientes" "          WHERE cc.company_id = (SELECT public.get_my_company_id())" "          WHERE true"
mutante "el residente sólo ve SUS cobros"      "      AND registros.cliente_id = (SELECT public.get_my_cliente_id())" "      AND registros.cliente_id IS NOT NULL"
mutante "la rama del residente es sólo del residente" "      (SELECT public.current_user_role()) = 'cliente'
      AND registros.cliente_id" "      registros.cliente_id"
mutante "el residente sólo ve SUS contadores"  "        WHERE u.cliente_id = (SELECT public.get_my_cliente_id())" "        WHERE true"
mutante "no ve el de un contador dado de baja" "          AND c.activo = true
" ""
mutante "MFA al leer"                          "  USING ((SELECT public.mfa_requirement_met()))" "  USING (true)"
mutante "MFA al escribir"                      "  WITH CHECK ((SELECT public.mfa_requirement_met()))" "  WITH CHECK (true)"
mutante "bitácora: sólo su empresa"            "      bitacora_acciones.company_id = (SELECT public.get_my_company_id())
      AND " "      "
mutante "bitácora: con el permiso"             "      AND (SELECT public.user_has_permission('condominios.tab.bitacora_acciones'))" ""
[ "$M" -eq "$N_MUT" ] || { echo "❌ se esperaban $N_MUT mutantes y corrieron $M"; exit 1; }

echo
echo "✅ lecturas_rls_por_consulta: la RLS de lecturas y bitácora se calcula una vez por consulta y cada persona ve lo mismo que antes"
