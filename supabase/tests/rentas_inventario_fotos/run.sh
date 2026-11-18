#!/usr/bin/env bash
# ════════════════════════════════════════════════════════════════════════════
# Verificación EJECUTABLE de 20261202000000_rentas_inventario_fotos.
#
# QUÉ HACE
#   1 · fixture   el de rentas_modulo (esquema mínimo de Supabase con Storage,
#                 RBAC real, unidades, catálogo de permisos)
#   2 · datos     padrón de rentas_modulo + la cuenta de plataforma y ayudas
#   3 · migra     20261125000000 (rentas) y la nuestra DOS veces → idempotente
#   4 · invariantes  assert.sql (A, C, S, D, G), como cada persona
#   5 · mutantes  copias de la migración, cada una sin una compuerta: la suite DEBE fallar
#
# USO:  supabase/tests/rentas_inventario_fotos/run.sh
# Requiere initdb/pg_ctl/psql. No toca ningún proyecto remoto: cluster temporal.
# ════════════════════════════════════════════════════════════════════════════
set -euo pipefail

AQUI="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RAIZ="$(cd "$AQUI/../../.." && pwd)"
RENT="$RAIZ/supabase/tests/rentas_modulo"
EVID="$RAIZ/supabase/tests/housekeeping_evidencias"
RESP="$RAIZ/supabase/tests/housekeeping_responsable"
STRI="$RAIZ/supabase/tests/str_importacion"
MIGS="$RAIZ/supabase/migrations"
RENTAS="$MIGS/20261125000000_rentas_modulo.sql"
NUESTRA="$MIGS/20261202000000_rentas_inventario_fotos.sql"

for d in /usr/lib/postgresql/*/bin; do [ -d "$d" ] && PATH="$d:$PATH"; done
export PATH
command -v initdb >/dev/null || { echo "❌ falta initdb (instalá PostgreSQL)"; exit 1; }

DATA=$(mktemp -d /tmp/rifdata.XXXX)
SOCK=$(mktemp -d /tmp/rifsock.XXXX)
MUT=$(mktemp /tmp/rifmut.XXXX.sql)
PUERTO=${PGPORT_TEST:-55466}

COMO=""
if [ "$(id -u)" = "0" ]; then
  id postgres >/dev/null 2>&1 || useradd -m postgres
  COMO="su postgres -c"
  chmod 755 "$AQUI" "$RENT" "$EVID" "$RESP" "$STRI" 2>/dev/null || true
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
BASES=(rif rifm1 rifm2 rifm3 rifm4 rifm5 rifm6 rifm7)
for db in "${BASES[@]}"; do psql -q -d postgres -c "CREATE DATABASE $db" >/dev/null; done

aplicar() { PGOPTIONS="-c client_min_messages=warning" psql -q -v ON_ERROR_STOP=1 -d "$1" -f "$2" >/dev/null; }
huella() { psql -q -At -d "$1" -f "$AQUI/huella.sql"; }
cd "$AQUI"

fixture() {
  aplicar "$1" "$EVID/fixture.sql"
  aplicar "$1" "$RESP/fixture_rbac.sql"
  aplicar "$1" "$STRI/fixture_str.sql"
  aplicar "$1" "$RENT/fixture_rentas.sql"
}
datos() {
  psql -q -v ON_ERROR_STOP=1 -d "$1" <<'SQL' >/dev/null
\i ../housekeeping_evidencias/lib.sql
\i ../housekeeping_responsable/datos.sql
\i ../str_importacion/datos.sql
\i ../rentas_modulo/datos.sql
\i datos.sql
SQL
}
preparar() {   # $1 = base · $2 = archivo de migración
  fixture "$1"
  datos "$1"
  aplicar "$1" "$RENTAS"
  aplicar "$1" "$2"
}

echo "── 1/5 · fixture (rentas_modulo: Storage mínimo + RBAC real + unidades) ──"
fixture rif
echo "  OK    storage.objects con RLS, storage.foldername, user_has_permission vigente"

echo "── 2/5 · datos ─────────────────────────────────────────────────────────"
datos rif
echo "  OK    padrón de rentas_modulo + cuenta de plataforma"

echo "── 3/5 · rentas_modulo y la migración, DOS veces ───────────────────────"
aplicar rif "$RENTAS"
aplicar rif "$NUESTRA"
H1=$(huella rif)
aplicar rif "$NUESTRA"
H2=$(huella rif)
[ "$H1" = "$H2" ] || { echo "❌ re-aplicar la migración cambió el catálogo ($H1 ≠ $H2)"; exit 1; }
echo "  OK    idempotente: la huella del catálogo no cambia al re-aplicar"

echo "── 4/5 · invariantes ───────────────────────────────────────────────────"
CODIGO=0
SALIDA=$(psql -q -v ON_ERROR_STOP=1 -d rif -f "$AQUI/assert.sql" 2>&1) || CODIGO=$?
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
assert s.count(pat) == 1, f'el patrón aparece {s.count(pat)} veces'
open(dst, 'w', encoding='utf-8').write(s.replace(pat, rep, 1))
PY
  preparar "$1" "$MUT"
  if psql -q -v ON_ERROR_STOP=1 -d "$1" -f "$AQUI/assert.sql" >/dev/null 2>&1; then
    echo "❌ el mutante «$2» pasó la suite: la regla no está probada"; exit 1
  fi
  echo "  OK    sin [$2] la suite falla"
}
mutante rifm1 "fotos en la carpeta de su propiedad" "AND public.rentas_fotos_en_carpeta(fotos, company_id, propiedad_id)" ""
mutante rifm2 "servicio contratado"                 "AND (SELECT public.rentas_servicio_activo())"                       ""
mutante rifm3 "empresa propia"                      "AND p.company_id = (SELECT public.get_my_company_id())"             ""
mutante rifm4 "alcance por proyecto"                "AND public.can_access_project(p.project_id))"                       ")"
mutante rifm5 "permiso de escribir para subir"      "WHEN 'subir' THEN"                                                  "WHEN 'subir' THEN true OR"
mutante rifm6 "foto nombrada por una fila"          "AND p_ruta = ANY (i.fotos))"                                        "AND false)"
mutante rifm7 "ruta de tres niveles exactos"        "SELECT p_ruta ~ '^[^/]+/[^/]+/[^/]+\$'"                             "SELECT true"

echo
echo "✅ rentas_inventario_fotos: fotos en la carpeta de su propiedad, bucket privado por empresa/proyecto/permiso y sin borrar lo que una fila nombra"
