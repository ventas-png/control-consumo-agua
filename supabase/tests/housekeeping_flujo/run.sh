#!/usr/bin/env bash
# ════════════════════════════════════════════════════════════════════════════
# Verificación EJECUTABLE de 20261031000000_housekeeping_flujo_reserva_y_avisos.
#
# QUÉ HACE
#   1 · fixture   esquema mínimo de Supabase (housekeeping_evidencias) + RBAC REAL
#                 (housekeeping_responsable/fixture_rbac.sql) + lo que esta migración toca:
#                 reservas_str con su RLS, unidades, outbox, plantillas, zona horaria, cron
#   2 · antes     aplica 20261028000000, 20261028000100 y 20261030000100 y siembra el padrón
#                 (13 cuentas), unidades y reservas STR (en curso, futura, cancelada, otra
#                 empresa, sin unidad)
#   3 · migra     aplica la migración DOS veces → idempotente, la huella del catálogo no cambia
#                 (incluye el job de cron: se programa UNA vez)
#   4 · invariantes  assert.sql (A–H): reserva vinculada y resumen sellado, fase
#                 «inconvenientes» y cupo, transiciones por rol, avisos al asignar,
#                 recordatorio previo en la zona del tenant, informe al cerrar, catálogo de
#                 reservas, inventario
#   5 · mutantes  copias de la migración, cada una sin una compuerta: la suite DEBE fallar con
#                 cada una (si no, no prueba esa regla)
#
# USO:  supabase/tests/housekeeping_flujo/run.sh
# Requiere initdb/pg_ctl/psql. No toca ningún proyecto remoto: cluster temporal.
# ════════════════════════════════════════════════════════════════════════════
set -euo pipefail

AQUI="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RAIZ="$(cd "$AQUI/../../.." && pwd)"
EVID="$RAIZ/supabase/tests/housekeeping_evidencias"
RESP="$RAIZ/supabase/tests/housekeeping_responsable"
MIGS="$RAIZ/supabase/migrations"
M0="$MIGS/20261028000000_housekeeping_evidencias.sql"
M1="$MIGS/20261028000100_housekeeping_servicios_por_proyecto.sql"
M2="$MIGS/20261030000100_housekeeping_responsable_usuario.sql"
NUESTRA="$MIGS/20261031000000_housekeeping_flujo_reserva_y_avisos.sql"

for d in /usr/lib/postgresql/*/bin; do [ -d "$d" ] && PATH="$d:$PATH"; done
export PATH
command -v initdb >/dev/null || { echo "❌ falta initdb (instalá PostgreSQL)"; exit 1; }

DATA=$(mktemp -d /tmp/hkfdata.XXXX)
SOCK=$(mktemp -d /tmp/hkfsock.XXXX)
MUT=$(mktemp /tmp/hkfmut.XXXX.sql)
PUERTO=${PGPORT_TEST:-55463}

COMO=""
if [ "$(id -u)" = "0" ]; then
  id postgres >/dev/null 2>&1 || useradd -m postgres
  COMO="su postgres -c"
  chmod 755 "$AQUI" "$EVID" "$RESP" 2>/dev/null || true
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
BASES="hkf hkm1 hkm2 hkm3 hkm4 hkm5 hkm6 hkm7"
for db in $BASES; do psql -q -d postgres -c "CREATE DATABASE $db" >/dev/null; done

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
  aplicar "$1" "$AQUI/fixture_notif.sql"
  aplicar "$1" "$M0"; aplicar "$1" "$M1"; aplicar "$1" "$M2"
  datos "$1"
  aplicar "$1" "$2"
}

echo "── 1/5 · fixture (esquema mínimo + RBAC real + STR/outbox/zona horaria) ──"
aplicar hkf "$EVID/fixture.sql"
aplicar hkf "$RESP/fixture_rbac.sql"
aplicar hkf "$AQUI/fixture_notif.sql"
echo "  OK    reservas_str con su RLS, outbox, plantillas, presencia_zona_horaria, cron"

echo "── 2/5 · migraciones previas (#927, #937) y datos ────────────────────────"
aplicar hkf "$M0"; aplicar hkf "$M1"; aplicar hkf "$M2"
datos hkf
echo "  OK    13 cuentas, 4 unidades, 7 reservas STR"

echo "── 3/5 · la migración, DOS veces ───────────────────────────────────────"
aplicar hkf "$NUESTRA"
H1=$(huella hkf)
aplicar hkf "$NUESTRA"
H2=$(huella hkf)
[ "$H1" = "$H2" ] || { echo "❌ re-aplicar la migración cambió el catálogo ($H1 ≠ $H2)"; exit 1; }
echo "  OK    idempotente: la huella del catálogo (triggers, funciones, plantillas, cron) no cambia"

echo "── 4/5 · invariantes ───────────────────────────────────────────────────"
CODIGO=0
SALIDA=$(psql -q -v ON_ERROR_STOP=1 -d hkf -f "$AQUI/assert.sql" 2>&1) || CODIGO=$?
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
mutante hkm1 "reserva del mismo proyecto"   "OR r.project_id IS DISTINCT FROM NEW.project_id"                          "OR false"
mutante hkm2 "aviso una sola vez por clave" "IF NOT v_insertado THEN"                                                  "IF false THEN"
mutante hkm3 "informe sólo a dueño/admin"   "WHERE au.role IN ('company_owner', 'admin') AND au.activo"                "WHERE au.activo"
mutante hkm4 "informe: admin con acceso"    "AND public.usuario_acceso_a_proyecto(au.id, s.project_id)"               "AND true"
mutante hkm5 "informe: sin perfil rechazado" "NOT COALESCE(public.hk_acceso(s.company_id, s.project_id), false) THEN" "NOT public.hk_acceso(s.company_id, s.project_id) THEN"
mutante hkm6 "salto pendiente→completado"   "AND NEW.estado = 'completado'                 THEN v_admin"               "AND NEW.estado = 'completado'                 THEN true"
mutante hkm7 "catálogo: sólo vigentes"      "AND r.estado IN ('confirmada', 'en_curso')"                               "AND true"

echo
echo "✅ housekeeping_flujo: reserva vinculada con resumen sellado, transiciones por rol, fase inconvenientes, avisos idempotentes en la zona del tenant e informe a dueño/admin"
