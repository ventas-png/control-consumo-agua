#!/usr/bin/env bash
# ════════════════════════════════════════════════════════════════════════════
# Verificación EJECUTABLE de 20261030000100_housekeeping_responsable_usuario.
#
# QUÉ HACE
#   1 · fixture   esquema mínimo de Supabase (el de housekeeping_evidencias) + RBAC REAL
#                 (user_has_permission y usuario_acceso_a_proyecto vigentes, copiados)
#   2 · antes     aplica 20261028000000 y 20261028000100 y siembra servicios HEREDADOS con
#                 el responsable como texto (el full_name exacto de personas reales)
#   3 · migra     aplica la migración DOS veces → idempotente, la huella del catálogo no cambia
#   4 · invariantes  assert.sql (A–I): equivalencia con las reglas vigentes, catálogo,
#                 crear/reasignar/rechazar, manipulación directa, autoría intacta,
#                 revocación, texto heredado, service_role, inventario
#   5 · mutantes  cuatro copias de la migración, cada una sin una compuerta o sello: la
#                 suite DEBE fallar con cada una (si no, no prueba esa regla)
#
# USO:  supabase/tests/housekeeping_responsable/run.sh
# Requiere initdb/pg_ctl/psql. No toca ningún proyecto remoto: cluster temporal.
# ════════════════════════════════════════════════════════════════════════════
set -euo pipefail

AQUI="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RAIZ="$(cd "$AQUI/../../.." && pwd)"
EVID="$RAIZ/supabase/tests/housekeeping_evidencias"
MIGS="$RAIZ/supabase/migrations"
M0="$MIGS/20261028000000_housekeeping_evidencias.sql"
M1="$MIGS/20261028000100_housekeeping_servicios_por_proyecto.sql"
NUESTRA="$MIGS/20261030000100_housekeeping_responsable_usuario.sql"

for d in /usr/lib/postgresql/*/bin; do [ -d "$d" ] && PATH="$d:$PATH"; done
export PATH
command -v initdb >/dev/null || { echo "❌ falta initdb (instalá PostgreSQL)"; exit 1; }

DATA=$(mktemp -d /tmp/hkrdata.XXXX)
SOCK=$(mktemp -d /tmp/hkrsock.XXXX)
MUT=$(mktemp /tmp/hkrmut.XXXX.sql)
PUERTO=${PGPORT_TEST:-55462}

COMO=""
if [ "$(id -u)" = "0" ]; then
  id postgres >/dev/null 2>&1 || useradd -m postgres
  COMO="su postgres -c"
  chmod 755 "$AQUI" "$EVID" 2>/dev/null || true
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
for db in hkr hkm1 hkm2 hkm3 hkm4; do psql -q -d postgres -c "CREATE DATABASE $db" >/dev/null; done

aplicar() { PGOPTIONS="-c client_min_messages=warning" psql -q -v ON_ERROR_STOP=1 -d "$1" -f "$2" >/dev/null; }
huella() { psql -q -At -d "$1" -f "$AQUI/huella.sql"; }
cd "$AQUI"

# Servicios HEREDADOS: responsable como texto, con el full_name EXACTO de personas que
# existen (3, 6 y 1). Si la migración vinculara por nombre, G2 lo vería.
heredados() {
  psql -q -v ON_ERROR_STOP=1 -d "$1" <<'SQL' >/dev/null
\i ../housekeeping_evidencias/lib.sql
\i datos.sql
INSERT INTO public.servicios_housekeeping (id, company_id, project_id, fecha, responsable, estado) VALUES
  (hkt.sv(101), hkt.ca(), hkt.pa1(), '2026-09-01', 'Operador PA1',     'completado'),
  (hkt.sv(102), hkt.ca(), hkt.pa1(), '2026-09-02', 'Operador PA1 bis', 'pendiente'),
  (hkt.sv(103), hkt.ca(), hkt.pa2(), '2026-09-03', 'Owner A',          'pendiente');
SQL
}

preparar() {   # $1 = base · $2 = archivo de migración del responsable
  aplicar "$1" "$EVID/fixture.sql"
  aplicar "$1" "$AQUI/fixture_rbac.sql"
  aplicar "$1" "$M0"; aplicar "$1" "$M1"
  heredados "$1"
  aplicar "$1" "$2"
}

echo "── 1/5 · fixture (esquema mínimo + RBAC real) ──────────────────────────"
aplicar hkr "$EVID/fixture.sql"
aplicar hkr "$AQUI/fixture_rbac.sql"
echo "  OK    user_has_permission y usuario_acceso_a_proyecto vigentes"

echo "── 2/5 · migraciones de #927 y servicios heredados (responsable como texto) ─"
aplicar hkr "$M0"; aplicar hkr "$M1"
heredados hkr
echo "  OK    3 servicios heredados con el nombre exacto de personas reales"

echo "── 3/5 · la migración, DOS veces ───────────────────────────────────────"
aplicar hkr "$NUESTRA"
H1=$(huella hkr)
aplicar hkr "$NUESTRA"
H2=$(huella hkr)
[ "$H1" = "$H2" ] || { echo "❌ re-aplicar la migración cambió el catálogo ($H1 ≠ $H2)"; exit 1; }
echo "  OK    idempotente: la huella del catálogo no cambia al re-aplicar"

echo "── 4/5 · invariantes ───────────────────────────────────────────────────"
CODIGO=0
SALIDA=$(psql -q -v ON_ERROR_STOP=1 -d hkr -f "$AQUI/assert.sql" 2>&1) || CODIGO=$?
echo "$SALIDA" | sed -n 's/.*NOTICE:  /  /p'
if [ "$CODIGO" -ne 0 ]; then
  echo; echo "❌ una invariante no se cumple:"
  echo "$SALIDA" | grep -E "ERROR|DETAIL|CONTEXT|LINE" | head -12
  exit 1
fi
TOTAL=$(echo "$SALIDA" | grep -c "NOTICE:  OK")
echo "  OK    $TOTAL comprobaciones"

echo "── 5/5 · mutantes: sin cada compuerta o sello, la suite debe fallar ────"
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
mutante hkm1 "acceso al proyecto" "AND public.usuario_acceso_a_proyecto(u.id, p_project)" "AND true"
mutante hkm2 "misma empresa"      "AND u.company_id = p_company"                          "AND true"
mutante hkm3 "cuenta habilitada"  "SELECT u.activo"                                       "SELECT true"
mutante hkm4 "sello de asignación" "NEW.responsable_asignado_por := v_uid;"               "NEW.responsable_asignado_por := NEW.responsable_asignado_por;"

echo
echo "✅ housekeeping_responsable: elegibilidad con las reglas vigentes, validada en la base, autoría intacta, texto heredado sin vincular"
