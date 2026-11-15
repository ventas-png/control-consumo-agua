#!/usr/bin/env bash
# ════════════════════════════════════════════════════════════════════════════
# Verificación EJECUTABLE de 20261124000000_housekeeping_inconvenientes_por_item.
#
# QUÉ HACE
#   1 · fixture   esquema mínimo de Supabase (housekeeping_evidencias) + RBAC REAL
#                 (housekeeping_responsable/fixture_rbac.sql) + STR/outbox/zona horaria
#                 (housekeeping_flujo/fixture_notif.sql)
#   2 · antes     aplica 20261028000000, 20261028000100, 20261030000100 y 20261031000000,
#                 siembra el padrón y servicios ANTERIORES a la migración: texto único y
#                 bolsa de fotos (datos_legado.sql)
#   3 · migra     aplica la migración DOS veces → idempotente, la huella del catálogo no
#                 cambia y los datos migrados no se duplican
#   4 · invariantes  assert.sql (A–F): orden y sellos, texto derivado, foto ligada al ítem
#                 del MISMO servicio y sólo en su fase, tope compartido, RLS como cada
#                 persona, borrado por RPC con autorización y cola de limpieza, datos
#                 migrados, inventario
#   5 · mutantes  copias de la migración, cada una sin una compuerta: la suite DEBE fallar
#                 con cada una (si no, no prueba esa regla)
#
# USO:  supabase/tests/housekeeping_inconvenientes/run.sh
# Requiere initdb/pg_ctl/psql. No toca ningún proyecto remoto: cluster temporal.
# ════════════════════════════════════════════════════════════════════════════
set -euo pipefail

AQUI="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RAIZ="$(cd "$AQUI/../../.." && pwd)"
EVID="$RAIZ/supabase/tests/housekeeping_evidencias"
RESP="$RAIZ/supabase/tests/housekeeping_responsable"
FLUJO="$RAIZ/supabase/tests/housekeeping_flujo"
MIGS="$RAIZ/supabase/migrations"
M0="$MIGS/20261028000000_housekeeping_evidencias.sql"
M1="$MIGS/20261028000100_housekeeping_servicios_por_proyecto.sql"
M2="$MIGS/20261030000100_housekeeping_responsable_usuario.sql"
M3="$MIGS/20261031000000_housekeeping_flujo_reserva_y_avisos.sql"
NUESTRA="$MIGS/20261124000000_housekeeping_inconvenientes_por_item.sql"

for d in /usr/lib/postgresql/*/bin; do [ -d "$d" ] && PATH="$d:$PATH"; done
export PATH
command -v initdb >/dev/null || { echo "❌ falta initdb (instalá PostgreSQL)"; exit 1; }

DATA=$(mktemp -d /tmp/hkidata.XXXX)
SOCK=$(mktemp -d /tmp/hkisock.XXXX)
MUT=$(mktemp /tmp/hkimut.XXXX.sql)
PUERTO=${PGPORT_TEST:-55491}

COMO=""
if [ "$(id -u)" = "0" ]; then
  id postgres >/dev/null 2>&1 || useradd -m postgres
  COMO="su postgres -c"
  chmod 755 "$AQUI" "$EVID" "$RESP" "$FLUJO" 2>/dev/null || true
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
BASES="hki hkim1 hkim2 hkim3"
for db in $BASES; do psql -q -d postgres -c "CREATE DATABASE $db" >/dev/null; done

aplicar() { PGOPTIONS="-c client_min_messages=warning" psql -q -v ON_ERROR_STOP=1 -d "$1" -f "$2" >/dev/null; }
huella() { psql -q -At -d "$1" -f "$AQUI/huella.sql"; }
cd "$AQUI"

datos() {
  psql -q -v ON_ERROR_STOP=1 -d "$1" <<'SQL' >/dev/null
\i ../housekeeping_evidencias/lib.sql
\i ../housekeeping_responsable/datos.sql
\i ../housekeeping_flujo/datos.sql
SQL
}

preparar() {   # $1 = base · $2 = archivo de migración
  aplicar "$1" "$EVID/fixture.sql"
  aplicar "$1" "$RESP/fixture_rbac.sql"
  aplicar "$1" "$FLUJO/fixture_notif.sql"
  aplicar "$1" "$M0"; aplicar "$1" "$M1"; aplicar "$1" "$M2"; aplicar "$1" "$M3"
  datos "$1"
  aplicar "$1" "$AQUI/datos_legado.sql"
  aplicar "$1" "$2"
}

echo "── 1/5 · fixture (esquema mínimo + RBAC real + STR/outbox/zona horaria) ──"
aplicar hki "$EVID/fixture.sql"
aplicar hki "$RESP/fixture_rbac.sql"
aplicar hki "$FLUJO/fixture_notif.sql"
echo "  OK    fixture cargado"

echo "── 2/5 · migraciones previas (#927, #937, #1040) y datos anteriores ─────"
aplicar hki "$M0"; aplicar hki "$M1"; aplicar hki "$M2"; aplicar hki "$M3"
datos hki
aplicar hki "$AQUI/datos_legado.sql"
echo "  OK    13 cuentas, 4 servicios con texto único y bolsa de fotos"

echo "── 3/5 · la migración, DOS veces ───────────────────────────────────────"
aplicar hki "$NUESTRA"
H1=$(huella hki)
aplicar hki "$NUESTRA"
H2=$(huella hki)
[ "$H1" = "$H2" ] || { echo "❌ re-aplicar la migración cambió el catálogo ($H1 ≠ $H2)"; exit 1; }
echo "  OK    idempotente: la huella del catálogo (tabla, triggers, funciones, policies, constraints) no cambia"

echo "── 4/5 · invariantes ───────────────────────────────────────────────────"
CODIGO=0
SALIDA=$(psql -q -v ON_ERROR_STOP=1 -d hki -f "$AQUI/assert.sql" 2>&1) || CODIGO=$?
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
mutante hkim1 "foto del MISMO servicio"      "WHERE i.id = NEW.inconveniente_id AND i.servicio_id = NEW.servicio_id) THEN" "WHERE i.id = NEW.inconveniente_id) THEN"
mutante hkim2 "borrar exige autorización"    "OR (i.creado_por = v_uid AND v_est IS DISTINCT FROM 'completado')"            "OR true"
mutante hkim3 "texto derivado del servicio"  "WHERE id = v_sv AND inconvenientes IS DISTINCT FROM v_txt;"                   "WHERE false;"

echo
echo "✅ housekeeping_inconvenientes: ítems con orden y sellos, foto ligada a su inconveniente, texto del servicio derivado, borrado autorizado por RPC y datos anteriores migrados"
