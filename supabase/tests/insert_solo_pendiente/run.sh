#!/usr/bin/env bash
# ════════════════════════════════════════════════════════════════════════════
# Verificación EJECUTABLE de 20260907000900: la tarea NACE pendiente
#
# POR QUÉ EXISTE
# El gate de evidencia (20260907000400) gatea LA TRANSICIÓN a 'completada' en
# UPDATE — «se gatea la transición, no la fila». Una fila INSERTADA ya cerrada
# nunca hace esa transición: un cliente autenticado con permiso de alta podía
# crear la tarea pre-cerrada, con la fecha inventada, el cierre atribuido a
# otra persona (sellar_cierre solo sella en UPDATE) y motivo_sin_evidencia
# pre-cargado para armar el bypass. La policy de INSERT de 20260907000100 solo
# miraba empresa y permiso, no el CONTENIDO de la fila.
#
# QUÉ COMPRUEBA
#   NEGATIVA    con la policy de #803 a solas, el alta pre-cerrada FUNCIONA.
#               Si dejara de reproducirse, el escenario no prueba nada.
#   NEGATIVA 2  con 20260907000900 aplicada, el contrato rige a todos MENOS al
#               super_admin: Silvia sigue insertando la tarea pre-cerrada.
#               20260907001100 viene a cerrar exactamente eso.
#   FAMILIAS    para CADA familia de permisos que acepta la policy
#               (tareas_personal, turnos, prog_limpieza): INSERT directo en
#               completada / con_observacion / omitida rechazado con 42501 y
#               SIN fila; el pendiente limpio de esa misma familia entra.
#   SELLOS      fecha, actor, anulación y motivo_sin_evidencia pre-cargados se
#               rechazan aunque el estado sea 'pendiente'. Ni el rol admin NI
#               el super_admin son bypass; sin permiso y desde la empresa
#               vecina sigue cerrado — y el pendiente limpio del super_admin
#               entra por su propia rama.
#   CIERRE      el UPDATE de cierre sigue tal como lo dejó 20260907000400:
#               exige evidencia o la excepción DECLARADA, sella al actor, y la
#               fila histórica no se re-valida en ediciones no relacionadas.
#   EXPRESIÓN   el literal que POLICIES_CRITICAS exige en el drift guard
#               coincide con el pg_get_expr de un servidor real.
#   + IDEMPOTENCIA (re-aplicar 000900 → 001100, como un replay del apply) y
#     postdeploy de solo lectura (expresión real de la policy y definición
#     real del trigger, no sus nombres).
#
# El fixture es el de tareas_bloque_paridad (padrón con permisos disjuntos y
# el estado previo real) + 20260907000100 (las policies RBAC reales de #803).
# pre.sql puentea las columnas que en producción puso 20260907000300 — la
# materialización entera no se aplica: tiene su harness propio, y la RPC es
# SECURITY DEFINER (la RLS no la alcanza; escribe 'pendiente' literal, cosa
# que snapshot_del_scope ya verifica ejecutándola).
#
# USO
#   supabase/tests/insert_solo_pendiente/run.sh
# Requiere binarios de PostgreSQL. No toca ningún proyecto remoto.
# ════════════════════════════════════════════════════════════════════════════
set -euo pipefail

AQUI="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RAIZ="$(cd "$AQUI/../../.." && pwd)"
FIXTURE="$RAIZ/supabase/tests/tareas_bloque_paridad/fixture.sql"
MIGS=(
  "$RAIZ/supabase/migrations/20260907000100_tareas_bloque_paridad.sql"
  "$AQUI/pre.sql"
  "$RAIZ/supabase/migrations/20260907000400_evidencia_al_cerrar.sql"
  "$RAIZ/supabase/migrations/20260907000700_reparar_estado_tareas_bloque.sql"
)
MIG_INSERT="$RAIZ/supabase/migrations/20260907000900_insert_solo_pendiente.sql"
MIG_CONTRATO="$RAIZ/supabase/migrations/20260907001100_endurecer_alta_y_consumo_tareas.sql"

for d in /usr/lib/postgresql/*/bin; do [ -d "$d" ] && PATH="$d:$PATH"; done
export PATH
command -v initdb >/dev/null || { echo "❌ falta initdb (instalá PostgreSQL)"; exit 1; }

# El socket unix tiene un tope de 107 bytes: ruta corta a propósito.
DATA=$(mktemp -d /tmp/inspdata.XXXX)
SOCK=$(mktemp -d /tmp/inspsock.XXXX)
PUERTO=${PGPORT_TEST:-55491}

limpiar() {
  pg_ctl -D "$DATA" stop -m immediate >/dev/null 2>&1 || true
  rm -rf "$DATA" "$SOCK"
}
trap limpiar EXIT

# Postgres se niega a correr como root; si lo somos, se delega en `postgres`.
COMO=""
if [ "$(id -u)" = "0" ]; then
  id postgres >/dev/null 2>&1 || useradd -m postgres
  chown -R postgres "$DATA" "$SOCK"
  COMO="su postgres -c"
fi
correr() { if [ -n "$COMO" ]; then su postgres -c "PATH=$PATH $*"; else eval "$*"; fi; }

correr "initdb -D $DATA -U postgres --auth=trust" >/dev/null
correr "pg_ctl -D $DATA -o '-p $PUERTO -k $SOCK' -l $DATA/pg.log start" >/dev/null
sleep 2

export PGHOST="$SOCK" PGPORT="$PUERTO" PGUSER=postgres
psql -q -d postgres -c "CREATE DATABASE inspdb" >/dev/null
psql -q -d inspdb -c "CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;" >/dev/null 2>&1 || true

silencio() { PGOPTIONS="-c client_min_messages=warning" psql -q -v ON_ERROR_STOP=1 -d inspdb "$@"; }

asertar() { # asertar <archivo.sql>
  local SALIDA
  SALIDA=$(psql -q -v ON_ERROR_STOP=1 -d inspdb -f "$1" 2>&1) || {
    sed -n 's/.*NOTICE:  /  /p' <<<"$SALIDA"
    echo
    echo "❌ invariante incumplida:"
    sed -n 's/.*ERROR:  /  /p' <<<"$SALIDA"
    exit 1
  }
  sed -n 's/.*NOTICE:  /  /p' <<<"$SALIDA"
  if grep -q 'WARNING:' <<<"$SALIDA"; then
    echo
    echo "❌ algo se tragó un error:"
    sed -n 's/.*WARNING:  /  ⚠ /p' <<<"$SALIDA"
    exit 1
  fi
}

echo "── 1/9 · fixture (paridad) y la pila real hasta 20260907000700 ─────────"
silencio -f "$FIXTURE" >/dev/null
for m in "${MIGS[@]}"; do
  silencio -f "$m" >/dev/null
done
echo "  OK    fixture + 000100 + pre + 000400 + 000700"

echo "── 2/9 · sembrar la familia turnos y a la super_admin ──────────────────"
silencio -f "$AQUI/seed.sql" >/dev/null
echo "  OK    Tomás (turnos) completa las familias; Silvia (super_admin) sin empresa"

echo "── 3/9 · NEGATIVA: sin la reparación, el alta pre-cerrada funciona ─────"
asertar "$AQUI/pre_assert.sql"

echo "── 4/9 · aplicar 20260907000900 ────────────────────────────────────────"
silencio -f "$MIG_INSERT" >/dev/null
echo "  OK    $(basename "$MIG_INSERT")"

echo "── 5/9 · NEGATIVA 2: con 000900, el super_admin sigue exento ───────────"
asertar "$AQUI/pre_assert_superadmin.sql"

echo "── 6/9 · aplicar 20260907001100 (el contrato rige a todos) ─────────────"
silencio -f "$MIG_CONTRATO" >/dev/null
echo "  OK    $(basename "$MIG_CONTRATO")"

echo "── 7/9 · invariantes ───────────────────────────────────────────────────"
asertar "$AQUI/assert.sql"

# El drift guard exige un LITERAL (POLICIES_CRITICAS.withCheck): tiene que
# coincidir con lo que imprime un servidor real, o el guard le daría a
# producción un rojo falso — o peor, un verde falso a otra expresión.
echo "  ── el literal del drift guard coincide con pg_get_expr real ──"
norm() { tr '\n' ' ' | tr -s ' ' | sed 's/^ //; s/ $//'; }
WC_GUARD=$(node --input-type=module -e "
  const m = await import('file://$RAIZ/scripts/migraciones-vs-produccion.mjs');
  const e = m.POLICIES_CRITICAS.find(p => p.policy === 'tareas_bloque_insert');
  if (!e) { console.error('POLICIES_CRITICAS ya no declara tareas_bloque_insert'); process.exit(1); }
  process.stdout.write(e.withCheck);
" | norm)
WC_REAL=$(psql -At -d inspdb -c "SELECT pg_get_expr(pol.polwithcheck, pol.polrelid) FROM pg_policy pol JOIN pg_class c ON c.oid = pol.polrelid WHERE c.relname='tareas_bloque' AND pol.polname='tareas_bloque_insert'" | norm)
if [ "$WC_GUARD" != "$WC_REAL" ]; then
  echo "❌ el literal de POLICIES_CRITICAS no coincide con el servidor:"
  echo "   guard:    $WC_GUARD"
  echo "   servidor: $WC_REAL"
  exit 1
fi
echo "  OK    la expresión que exige el guard es la que el servidor imprime"

echo
echo "── 8/9 · idempotencia (re-aplicar 000900 → 001100, como un replay) ─────"
# El orden importa: re-aplicar 000900 restaura la forma vieja de la policy y
# 001100 la endurece de nuevo — igual que un replay del apply de producción.
silencio -f "$MIG_INSERT" >/dev/null
silencio -f "$MIG_CONTRATO" >/dev/null
asertar "$AQUI/reassert.sql"

echo
echo "── 9/9 · postdeploy (sólo lectura): expresión de la policy y del trigger ─"
SALIDA=$(psql -v ON_ERROR_STOP=1 -d inspdb -f "$AQUI/postdeploy.sql" 2>&1) || {
  echo "❌ la verificación postdeploy falló:"
  sed -n 's/.*ERROR:  /  /p' <<<"$SALIDA"
  exit 1
}
grep -E 'tareas_bloque_insert|postdeploy OK' <<<"$SALIDA" | head -2 | sed 's/^/  /'

echo
echo "✅ insert_solo_pendiente: ningún cliente autenticado crea una tarea"
echo "   pre-cerrada o pre-sellada por INSERT directo — en ninguna de las tres"
echo "   familias, ni como admin, NI COMO SUPER_ADMIN (20260907001100) — y el"
echo "   cierre legítimo sigue exigiendo evidencia."
