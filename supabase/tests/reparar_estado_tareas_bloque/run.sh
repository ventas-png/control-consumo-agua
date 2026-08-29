#!/usr/bin/env bash
# ════════════════════════════════════════════════════════════════════════════
# Verificación EJECUTABLE de 20260907000700 contra el constraint REAL homónimo
#
# POR QUÉ EXISTE
# 20260907000100 protege su CHECK de estado con un guard por conname: si un
# constraint LLAMADO tareas_bloque_estado_check ya existe, no instala nada. En
# producción ese nombre existía con el vocabulario legacy en masculino
# ('pendiente','en_curso','completado','omitido'), así que el canónico nunca se
# instaló y completar una tarea revienta con 23514. Un sandbox construido desde
# supabase/migrations NO puede probar la reparación: allí el conname coincide
# con la definición correcta y la migración es un no-op (la misma lección de
# drift_turnos). Éste monta el homónimo incompatible BAJO EL MISMO NOMBRE y
# prueba contra él.
#
# QUÉ COMPRUEBA (tres escenarios, una base cada uno)
#   PRODUCCIÓN  la NEGATIVA primero (con el homónimo vivo, los tres cierres
#               canónicos fallan — si dejara de fallar, el escenario no
#               reproduce nada); tras la migración: definición canónica y
#               convalidated=true, completado→completada y omitido→omitida con
#               el hito intacto, los cuatro valores canónicos entran y los
#               legacy quedan rechazados. Re-aplicación incluida (idempotencia)
#               y postdeploy.sql como eco final de sólo lectura.
#   EN_CURSO    con una fila 'en_curso' (sin decisión de producto documentada)
#               la migración ABORTA nombrando el valor, y el rollback no deja
#               rastro: ni constraint dropeado ni conversiones a medias.
#   DECLARADO   sobre el esquema del repo (CHECK canónico pero NOT VALID, con
#               una fila legacy anterior al constraint) no dropea nada: solo
#               convierte y VALIDA.
#
# USO
#   supabase/tests/reparar_estado_tareas_bloque/run.sh
# Requiere binarios de PostgreSQL (initdb/pg_ctl/psql). No toca ningún proyecto
# remoto: levanta un cluster temporal, corre todo y lo destruye.
# ════════════════════════════════════════════════════════════════════════════
set -euo pipefail

AQUI="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RAIZ="$(cd "$AQUI/../../.." && pwd)"
MIG="$RAIZ/supabase/migrations/20260907000700_reparar_estado_tareas_bloque.sql"

for d in /usr/lib/postgresql/*/bin; do [ -d "$d" ] && PATH="$d:$PATH"; done
export PATH
command -v initdb >/dev/null || { echo "❌ falta initdb (instalá PostgreSQL)"; exit 1; }

# El socket unix tiene un tope de 107 bytes: ruta corta a propósito.
DATA=$(mktemp -d /tmp/repedata.XXXX)
SOCK=$(mktemp -d /tmp/repesock.XXXX)
PUERTO=${PGPORT_TEST:-55489}

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

silencio() { PGOPTIONS="-c client_min_messages=warning" psql -q -v ON_ERROR_STOP=1 "$@"; }

mostrar_notices() { sed -n 's/.*NOTICE:  /  /p' <<<"$1"; }

asertar() { # asertar <db> <archivo.sql>
  local SALIDA
  SALIDA=$(psql -q -v ON_ERROR_STOP=1 -d "$1" -f "$2" 2>&1) || {
    mostrar_notices "$SALIDA"
    echo
    echo "❌ invariante incumplida:"
    sed -n 's/.*ERROR:  /  /p' <<<"$SALIDA"
    exit 1
  }
  mostrar_notices "$SALIDA"
}

echo "── 1/3 · PRODUCCIÓN: homónimo legacy bajo el mismo nombre ──────────────"
psql -q -d postgres -c "CREATE DATABASE repprod" >/dev/null
silencio -d repprod -f "$AQUI/fixture.sql" >/dev/null
asertar repprod "$AQUI/pre_assert.sql"
SALIDA=$(psql -q -v ON_ERROR_STOP=1 -d repprod -f "$MIG" 2>&1) || {
  echo "❌ la migración falló sobre el escenario de producción:"
  sed -n 's/.*ERROR:  /  /p' <<<"$SALIDA"
  exit 1
}
mostrar_notices "$SALIDA"
asertar repprod "$AQUI/assert.sql"
echo "  ── idempotencia: re-aplicar ──"
PGOPTIONS="-c client_min_messages=warning" psql -q -v ON_ERROR_STOP=1 -d repprod -f "$MIG" >/dev/null
asertar repprod "$AQUI/reassert.sql"
echo "  ── postdeploy (sólo lectura): convalidated y definición final ──"
SALIDA=$(psql -v ON_ERROR_STOP=1 -d repprod -f "$AQUI/postdeploy.sql" 2>&1) || {
  echo "❌ la verificación postdeploy falló:"
  sed -n 's/.*ERROR:  /  /p' <<<"$SALIDA"
  exit 1
}
grep -E 'tareas_bloque_estado_check|postdeploy OK' <<<"$SALIDA" | sed 's/^/  /'

# El drift guard compara producción contra un LITERAL (CONSTRAINTS_CRITICOS.
# definicion) — la migración calcula el suyo en el servidor precisamente para
# no acoplarse a una versión de Postgres. Este cotejo cierra el hueco: el
# literal del guard tiene que coincidir, byte a byte, con lo que imprime un
# servidor real sobre el estado final. Si un upgrade de Postgres cambiara el
# formato, esto se pone rojo ANTES de que el guard le dé un rojo falso a prod.
echo "  ── el literal del drift guard coincide con pg_get_constraintdef real ──"
DEF_GUARD=$(node --input-type=module -e "
  const m = await import('file://$RAIZ/scripts/migraciones-vs-produccion.mjs');
  const e = m.CONSTRAINTS_CRITICOS.find(c => c.constraint === 'tareas_bloque_estado_check');
  if (!e) { console.error('CONSTRAINTS_CRITICOS ya no declara tareas_bloque_estado_check'); process.exit(1); }
  process.stdout.write(e.definicion);
")
DEF_REAL=$(psql -At -d repprod -c "SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conrelid='public.tareas_bloque'::regclass AND conname='tareas_bloque_estado_check'")
if [ "$DEF_GUARD" != "$DEF_REAL" ]; then
  echo "❌ el literal de CONSTRAINTS_CRITICOS no coincide con el servidor:"
  echo "   guard:    $DEF_GUARD"
  echo "   servidor: $DEF_REAL"
  exit 1
fi
echo "  OK    la definición que exige el guard es la que el servidor imprime"

echo
echo "── 2/3 · EN_CURSO: sin decisión documentada, la migración ABORTA ───────"
psql -q -d postgres -c "CREATE DATABASE repcurso" >/dev/null
silencio -d repcurso -f "$AQUI/fixture.sql" >/dev/null
silencio -d repcurso -f "$AQUI/seed_en_curso.sql" >/dev/null
if SALIDA=$(psql -q -v ON_ERROR_STOP=1 -d repcurso -f "$MIG" 2>&1); then
  echo "❌ la migración debía ABORTAR con una fila en_curso y pasó en verde"
  exit 1
fi
if ! grep -q "fuera del dominio canónico" <<<"$SALIDA" || ! grep -q "en_curso" <<<"$SALIDA"; then
  echo "❌ abortó, pero sin el mensaje claro que nombra el valor sin decisión:"
  sed -n 's/.*ERROR:  /  /p' <<<"$SALIDA"
  exit 1
fi
echo "  OK    abortó nombrando en_curso y la falta de decisión de producto"
asertar repcurso "$AQUI/assert_abort.sql"

echo
echo "── 3/3 · DECLARADO: canónico NOT VALID — solo convertir y validar ──────"
psql -q -d postgres -c "CREATE DATABASE replimpio" >/dev/null
silencio -d replimpio -f "$AQUI/fixture_limpio.sql" >/dev/null
PGOPTIONS="-c client_min_messages=warning" psql -q -v ON_ERROR_STOP=1 -d replimpio -f "$MIG" >/dev/null
asertar replimpio "$AQUI/assert_limpio.sql"

echo
echo "✅ reparar_estado_tareas_bloque: el homónimo incompatible se reemplaza y"
echo "   valida, los legacy se convierten o abortan con mensaje, y el dominio"
echo "   canónico queda operativo (idempotente, con postdeploy de sólo lectura)."
