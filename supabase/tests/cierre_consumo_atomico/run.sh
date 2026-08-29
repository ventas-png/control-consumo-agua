#!/usr/bin/env bash
# ════════════════════════════════════════════════════════════════════════════
# Verificación EJECUTABLE de 20260907001000: cierre y consumo, UNA transacción
#
# POR QUÉ EXISTE
# #809 dejó cuatro agujeros que ninguna lectura de SQL puede refutar: el cierre
# y el consumo eran DOS requests (el segundo podía perderse sin reintento), la
# idempotencia del consumo era sólo secuencial (dos sesiones CONCURRENTES leían
# el mismo plan como pendiente y descontaban doble), una tarea PENDIENTE podía
# consumir inventario, y el «no lo necesité» no era terminal. Todo eso son
# hechos de Postgres —locks, transacciones, triggers— y sólo se ven
# ejecutándolos. La carrera, además, exige DOS conexiones de verdad
# sincronizadas con una barrera: ni el mejor unit test la simula.
#
# QUÉ COMPRUEBA
#   NEGATIVA     con 20260907000500 a solas: una tarea PENDIENTE consume, el 0
#                no es terminal, "NaN" envenena el stock y el cierre en dos
#                pasos queda descuadrado si el segundo se pierde. Si dejara de
#                reproducirse, el escenario no prueba nada.
#   NEGATIVA 2   con 20260907001000 a solas: lo OMITIDO consume, 0.001 se
#                vuelve un movimiento de 0.00 que reclama sin descontar, y el
#                mismo uuid en dos representaciones esquiva el chequeo de
#                duplicados. 20260907001100 cierra exactamente eso.
#   ATOMICIDAD   una llamada cierra+consume; el fallo (evidencia, JSON, scope)
#                revierte TODO: tarea pendiente y stock intacto.
#   REINTENTO    respuesta perdida y reintento: 0 consumidos, ni un movimiento
#                de más; el «no usado» queda sellado y NO se consume después.
#   CARRERA      dos sesiones reales arrancan A LA VEZ (barrera con advisory
#                locks) contra la misma tarea: exactamente UN cierre, UN
#                movimiento y UN descuento por fila del plan.
#   AUTORIZACIÓN misma familia de permisos que cerrar la tarea; la empresa
#                vecina con el MISMO permiso no pasa el scope; una tarea
#                pendiente nunca consume (RPC vieja endurecida).
#   + IDEMPOTENCIA de la migración y postdeploy de solo lectura (definiciones
#     vivas y ACLs, no nombres).
#
# El fixture es el de consumo_insumos (motor de stock y padrón reales) + los
# triggers de sellado de 20260907000100 (pre.sql) + la pila 20260904*–000700.
#
# USO
#   supabase/tests/cierre_consumo_atomico/run.sh
# Requiere binarios de PostgreSQL. No toca ningún proyecto remoto.
# ════════════════════════════════════════════════════════════════════════════
set -euo pipefail

AQUI="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RAIZ="$(cd "$AQUI/../../.." && pwd)"
FIXTURE="$RAIZ/supabase/tests/consumo_insumos/fixture.sql"
SEED_BASE="$RAIZ/supabase/tests/consumo_insumos/seed.sql"
MIGS=(
  "$RAIZ/supabase/migrations/20260904000100_limpieza_area_catalogo_e_historial.sql"
  "$RAIZ/supabase/migrations/20260904000200_plantillas_catalogo_actividades.sql"
  "$RAIZ/supabase/migrations/20260904000300_plantilla_tarea_recursos.sql"
  "$RAIZ/supabase/migrations/20260907000200_rutinas_limpieza.sql"
  "$RAIZ/supabase/migrations/20260907000300_materializar_rutinas.sql"
  "$RAIZ/supabase/migrations/20260907000400_evidencia_al_cerrar.sql"
  "$RAIZ/supabase/migrations/20260907000500_consumo_insumos.sql"
  "$RAIZ/supabase/migrations/20260907000700_reparar_estado_tareas_bloque.sql"
)
MIG_CIERRE="$RAIZ/supabase/migrations/20260907001000_cerrar_tarea_y_consumir_insumos.sql"
MIG_ENDURECER="$RAIZ/supabase/migrations/20260907001100_endurecer_alta_y_consumo_tareas.sql"

for d in /usr/lib/postgresql/*/bin; do [ -d "$d" ] && PATH="$d:$PATH"; done
export PATH
command -v initdb >/dev/null || { echo "❌ falta initdb (instalá PostgreSQL)"; exit 1; }

# El socket unix tiene un tope de 107 bytes: ruta corta a propósito.
DATA=$(mktemp -d /tmp/ccadata.XXXX)
SOCK=$(mktemp -d /tmp/ccasock.XXXX)
SALIDAS=$(mktemp -d /tmp/ccaout.XXXX)
PUERTO=${PGPORT_TEST:-55492}

limpiar() {
  # Vía `correr`: como root, un pg_ctl directo se niega y dejaría el puerto
  # tomado para la corrida siguiente.
  correr "pg_ctl -D $DATA stop -m immediate" >/dev/null 2>&1 || true
  rm -rf "$DATA" "$SOCK" "$SALIDAS"
}
trap limpiar EXIT

# Postgres se niega a correr como root; si lo somos, se delega en `postgres`.
COMO=""
if [ "$(id -u)" = "0" ]; then
  id postgres >/dev/null 2>&1 || useradd -m postgres
  chown -R postgres "$DATA" "$SOCK" "$SALIDAS"
  COMO="su postgres -c"
fi
correr() { if [ -n "$COMO" ]; then su postgres -c "PATH=$PATH $*"; else eval "$*"; fi; }

correr "initdb -D $DATA -U postgres --auth=trust" >/dev/null
correr "pg_ctl -D $DATA -o '-p $PUERTO -k $SOCK' -l $DATA/pg.log start" >/dev/null
sleep 2

export PGHOST="$SOCK" PGPORT="$PUERTO" PGUSER=postgres
psql -q -d postgres -c "CREATE DATABASE ccadb" >/dev/null
psql -q -d ccadb -c "CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;" >/dev/null 2>&1 || true

silencio() { PGOPTIONS="-c client_min_messages=warning" psql -q -v ON_ERROR_STOP=1 -d ccadb "$@"; }

asertar() { # asertar <archivo.sql>
  local SALIDA
  SALIDA=$(psql -q -v ON_ERROR_STOP=1 -d ccadb -f "$1" 2>&1) || {
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

echo "── 1/10 · fixture (consumo_insumos) y la pila real hasta 20260907000700 ─"
silencio -f "$FIXTURE" >/dev/null
for m in "${MIGS[@]}"; do
  silencio -f "$m" >/dev/null
done
silencio -f "$AQUI/pre.sql" >/dev/null
echo "  OK    fixture + 20260904* + 000200..000700 + triggers de sellado"

echo "── 2/10 · sembrar receta, tareas y la empresa vecina ────────────────────"
silencio -f "$SEED_BASE" >/dev/null
silencio -f "$AQUI/seed.sql" >/dev/null
echo "  OK    semilla de consumo_insumos + T5, T6 y Diego (empresa 2)"

echo "── 3/10 · NEGATIVA: con 20260907000500 a solas, #809 se reproduce ───────"
asertar "$AQUI/pre_assert.sql"

echo "── 4/10 · aplicar 20260907001000 ────────────────────────────────────────"
silencio -f "$MIG_CIERRE" >/dev/null
echo "  OK    $(basename "$MIG_CIERRE")"

echo "── 5/10 · NEGATIVA 2: con 001000, lo omitido consume y 0.001 se cuela ───"
asertar "$AQUI/pre_assert_endurecer.sql"

echo "── 6/10 · aplicar 20260907001100 (el endurecimiento) ────────────────────"
silencio -f "$MIG_ENDURECER" >/dev/null
echo "  OK    $(basename "$MIG_ENDURECER")"

echo "── 7/10 · invariantes (sesión única) ────────────────────────────────────"
asertar "$AQUI/assert.sql"

echo
echo "── 8/10 · la carrera: dos sesiones reales, barrera con advisory locks ───"
# La coreografía:
#   1. Un HOLDER toma pg_advisory_lock(4242) EXCLUSIVO y se queda dormido.
#   2. Dos WORKERS abren transacción y piden el lock COMPARTIDO: quedan
#      bloqueados detrás del holder — la barrera.
#   3. Cuando pg_locks muestra a los DOS esperando, se termina el backend del
#      holder: ambos adquieren el shared A LA VEZ y corren la MISMA RPC sobre
#      la MISMA tarea. Los shared no se excluyen entre sí: la serialización
#      que se observe después es TODA del FOR UPDATE de la RPC.
BARRERA=4242
T6=a1000000-0000-0000-0000-000000000006

psql -q -d ccadb -c "SELECT pg_advisory_lock($BARRERA); SELECT pg_sleep(60);" \
  >/dev/null 2>&1 &
HOLDER_SH=$!

espera_locks() { # espera_locks <granted:t|f> <cuantos> <mensaje>
  for _ in $(seq 1 100); do
    local n
    n=$(psql -At -d ccadb -c "SELECT count(*) FROM pg_locks
         WHERE locktype='advisory' AND objid=$BARRERA AND granted='$1'")
    [ "$n" -ge "$2" ] && return 0
    sleep 0.1
  done
  echo "❌ la barrera no se armó: $3"
  exit 1
}

espera_locks t 1 "el holder nunca tomó el lock"

WORKER_SQL="
SELECT set_config('app.uid', 'a0000000-0000-0000-0000-00000000000a', false);
BEGIN;
SELECT pg_advisory_xact_lock_shared($BARRERA);
SELECT consumidos, no_usados FROM public.cerrar_tarea_y_consumir_insumos(
  '$T6', 'completada');
COMMIT;
"
psql -At -v ON_ERROR_STOP=1 -d ccadb -c "$WORKER_SQL" >"$SALIDAS/w1.out" 2>&1 &
W1=$!
psql -At -v ON_ERROR_STOP=1 -d ccadb -c "$WORKER_SQL" >"$SALIDAS/w2.out" 2>&1 &
W2=$!

espera_locks f 2 "los dos workers no llegaron a esperar juntos"
echo "  OK    barrera armada: los DOS workers esperan el mismo lock"

# Soltar la barrera: matar al holder libera su lock de sesión.
psql -q -d ccadb -c "SELECT pg_terminate_backend(pid) FROM pg_locks
  WHERE locktype='advisory' AND objid=$BARRERA AND granted" >/dev/null
wait "$HOLDER_SH" 2>/dev/null || true

FALLO_W=0
wait "$W1" || FALLO_W=1
wait "$W2" || FALLO_W=1
if [ "$FALLO_W" -ne 0 ]; then
  echo "❌ un worker de la carrera falló:"
  sed 's/^/  w1: /' "$SALIDAS/w1.out"
  sed 's/^/  w2: /' "$SALIDAS/w2.out"
  exit 1
fi

# Uno consumió las 2 filas; el otro llegó tarde y encontró 0. El orden no
# importa — el multiconjunto {2,0} sí.
RESULTADOS=$(grep -h '|' "$SALIDAS/w1.out" "$SALIDAS/w2.out" | cut -d'|' -f1 | sort | tr '\n' ',')
if [ "$RESULTADOS" != "0,2," ]; then
  echo "❌ la carrera repartió mal los reclamos (consumidos por sesión: $RESULTADOS esperado 0,2,)"
  sed 's/^/  w1: /' "$SALIDAS/w1.out"
  sed 's/^/  w2: /' "$SALIDAS/w2.out"
  exit 1
fi
echo "  OK    una sesión consumió 2, la otra 0 — nunca 2 y 2"
asertar "$AQUI/assert_concurrencia.sql"

echo
echo "── 9/10 · idempotencia (re-aplicar 001000 → 001100, como un replay) ─────"
# El orden importa: re-aplicar 001000 restaura las funciones permisivas y
# 001100 las endurece de nuevo — igual que un replay del apply de producción.
silencio -f "$MIG_CIERRE" >/dev/null
silencio -f "$MIG_ENDURECER" >/dev/null
asertar "$AQUI/reassert.sql"

echo
echo "── 10/10 · postdeploy (sólo lectura): definiciones vivas y ACLs ─────────"
SALIDA=$(psql -v ON_ERROR_STOP=1 -d ccadb -f "$AQUI/postdeploy.sql" 2>&1) || {
  echo "❌ la verificación postdeploy falló:"
  sed -n 's/.*ERROR:  /  /p' <<<"$SALIDA"
  exit 1
}
grep -E 'postdeploy OK' <<<"$SALIDA" | sed 's/^/  /'

echo
echo "✅ cierre_consumo_atomico: cierre y stock se confirman o revierten JUNTOS;"
echo "   dos sesiones concurrentes producen como máximo un movimiento y un"
echo "   descuento por fila; una tarea pendiente u OMITIDA nunca consume"
echo "   inventario; y las cantidades viajan exactas a dos decimales."
