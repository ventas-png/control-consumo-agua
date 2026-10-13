#!/usr/bin/env bash
# ============================================================================
# MEDICIONES DE CARGA del candado de bajas en cascada de user_project_assignments (V3-01, R2-5, D-15). NO forma parte de la suite ni de CI: son cifras de referencia (dependen de la
# máquina; la relación entre variantes es lo que importa), pero se pueden REPETIR con un solo comando desde run.sh:
#
#     ASG_CARGA=1 PGPORT_TEST=55799 bash supabase/tests/asignaciones_proyecto/run.sh          (todos los escenarios, tres variantes del candado)
#     ASG_CARGA=1 ASG_CARGA_ESCENARIOS="dos-empresas" ASG_CARGA_SEGUNDOS=20 bash …/run.sh      (uno solo, 20 s)
#
# run.sh monta el clúster desechable (cadena de migraciones + fixture + la migración), hace una copia por variante —«empresa» (la migración), «global» (la versión b9b630b1: una sola clave
# para toda la base) y «sin» (sin candado)— y llama a este script por cada una. También se puede llamar a mano sobre cualquier base DESECHABLE con la forma de la suite:
#
#     PGDATABASE=mi_base bash carga/medir.sh ESCENARIO...        (PGHOST/PGPORT/PGUSER como siempre)
#
# Escenarios:
#   dos-empresas   el propietario de la empresa D borra en bucle un proyecto con una cascada pesada (2 clientes) y mide a la VÍCTIMA DE OTRA EMPRESA (C): sola frente a bajo ataque (V3-01)
#   misma-empresa  el mismo ataque medido contra otro propietario de la MISMA empresa D: espera el candado y, si pasa de 2 s, falla con lock timeout (55P03) en vez de esperar al statement_timeout
#   costo          coste del candado: 8 clientes en una empresa y 4 + 4 en dos empresas, sólo bajas de proyectos pequeños (D-15)
#   interbloqueos  carga mixta de UNA sentencia por transacción (como PostgREST) y de VARIAS (sólo SQL directo): interbloqueos contados por pgbench (R2-5, D-15)
#
# Variables: ASG_CARGA_SEGUNDOS (por defecto 12), ASG_CARGA_FILAS (filas de la cascada pesada, por defecto 400000), ASG_CARGA_REPS (repeticiones de «costo», por defecto 3).
# SEGURIDAD: se niega a correr si la base no es una base de la suite (esquema asgt): estas mediciones BORRAN y recrean proyectos con el prefijo b3f00000-.
# ============================================================================
set -Eeuo pipefail
AQUI="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BD="${PGDATABASE:?falta PGDATABASE (la base desechable de la suite)}"
T="${ASG_CARGA_SEGUNDOS:-12}"
FILAS="${ASG_CARGA_FILAS:-400000}"
REPS="${ASG_CARGA_REPS:-3}"
ETIQ="${ASG_CARGA_ETIQUETA:-$BD}"
[ "$(psql -X -q -tA -d "$BD" -c "SELECT count(*) FROM pg_namespace WHERE nspname = 'asgt'")" = "1" ] \
  || { echo "❌ $BD no es una base de la suite (falta el esquema asgt): estas mediciones borran y recrean proyectos"; exit 1; }
command -v pgbench >/dev/null || { echo "❌ falta pgbench"; exit 1; }

preparar() { psql -X -q -v ON_ERROR_STOP=1 -v n="$FILAS" -d "$BD" -f "$AQUI/preparar.sql" >/dev/null; }
# pgbench termina con rc 2 si algún cliente aborta por un error de SQL que no es un fallo reintentable (p. ej. «canceling statement due to lock timeout», 55P03): no es un fallo de la medición.
bench()    { pgbench -n -f "$AQUI/$1" -c "$2" -j "$(( $2 < 4 ? $2 : 4 ))" -T "$3" --max-tries=1 --failures-detailed "$BD" 2>&1 || true; }
abortos()  { grep -c 'aborted in command' <<<"$1" || true; }
tps()      { sed -n 's/^tps = \([0-9.]*\).*/\1/p' <<<"$1"; }
lat()      { sed -n 's/^latency average = \([0-9.]*\) ms.*/\1/p' <<<"$1"; }
ntx()      { sed -n 's/^number of transactions actually processed: \([0-9]*\).*/\1/p' <<<"$1"; }
resumen()  { echo "$(ntx "$1") tx · $(tps "$1") tx/s · latencia media $(lat "$1") ms"; }

escenario_dos_empresas() {
  preparar
  local sola ataque_v ataque_a
  sola=$(bench victima_c.pgb 4 "$T")
  bench atacante_d.pgb 2 "$T" > "$SALIDA_CARGA/atacante.txt" & local pa=$!
  sleep 1
  ataque_v=$(bench victima_c.pgb 4 "$((T - 2))")
  wait "$pa" || true
  echo "  [$ETIQ] dos-empresas · víctima de OTRA empresa (C), 4 clientes: sola → $(resumen "$sola")"
  echo "  [$ETIQ] dos-empresas · …con el atacante de D (2 clientes, baja de $FILAS filas en bucle) → $(resumen "$ataque_v")"
  echo "  [$ETIQ] dos-empresas · …(el atacante) → $(resumen "$(cat "$SALIDA_CARGA/atacante.txt")")"
}

escenario_misma_empresa() {
  preparar
  local out="$SALIDA_CARGA/misma.txt" fin w
  : > "$out"
  bench atacante_d.pgb 2 "$T" > "$SALIDA_CARGA/atacante.txt" & local pa=$!
  sleep 1
  fin=$(( $(date +%s) + T - 2 ))
  for w in 1 2; do
    ( while [ "$(date +%s)" -lt "$fin" ]; do
        local t0 t1 salida res
        t0=$(date +%s%N)
        salida=$(psql -X -q -d "$BD" 2>&1 <<SQL || true
BEGIN;
SET LOCAL ROLE authenticated;
SET LOCAL statement_timeout = '8s';
SELECT set_config('request.jwt.claim.sub', 'a5e00000-0000-0000-0000-0000000000e2', true);
DELETE FROM public.projects WHERE id = 'b3f00000-0000-0000-0000-0000000000d$((1 + RANDOM % 2))';
ROLLBACK;
SQL
)
        t1=$(date +%s%N)
        res=ok
        case "$salida" in *"lock timeout"*) res=lock_timeout;; *"statement timeout"*) res=statement_timeout;; *ERROR*) res=otro;; esac
        echo "$res $(( (t1 - t0) / 1000000 ))" >> "$out"
      done ) &
  done
  wait "$pa" || true; wait
  awk -v e="$ETIQ" '{ n[$1]++; s[$1] += $2; if ($2 > m[$1]) m[$1] = $2 }
    END { printf "  [%s] misma-empresa · víctima = otro propietario de D (2 clientes en bucle de peticiones sueltas):", e;
          for (k in n) printf "  %s=%d (media %.0f ms, máx %d ms)", k, n[k], s[k] / n[k], m[k]; printf "\n" }' "$out"
}

escenario_costo() {
  preparar
  local r a c d
  for r in $(seq 1 "$REPS"); do
    a=$(bench costo_c.pgb 8 15)
    echo "  [$ETIQ] costo · una empresa (8 clientes en C), repetición $r → $(tps "$a") tx/s"
  done
  for r in $(seq 1 "$REPS"); do
    bench costo_c.pgb 4 15 > "$SALIDA_CARGA/costo_c.txt" & local p1=$!
    bench costo_d.pgb 4 15 > "$SALIDA_CARGA/costo_d.txt" & local p2=$!
    wait "$p1" "$p2" || true
    c=$(tps "$(cat "$SALIDA_CARGA/costo_c.txt")"); d=$(tps "$(cat "$SALIDA_CARGA/costo_d.txt")")
    echo "  [$ETIQ] costo · dos empresas (4 en C + 4 en D), repetición $r → C=$c D=$d suma=$(awk -v c="$c" -v d="$d" 'BEGIN { printf "%.1f", c + d }') tx/s"
  done
}

escenario_interbloqueos() {
  preparar
  local una multi
  una=$(bench mixto_una.pgb 12 15)
  echo "  [$ETIQ] interbloqueos · UNA sentencia por transacción (12 clientes, 15 s) → $(ntx "$una") tx · $(tps "$una") tx/s · $(grep -E 'number of deadlock failures' <<<"$una" | sed 's/.*: //') interbloqueos · $(abortos "$una") clientes abortados"
  for r in 1 2 3; do
    multi=$(bench mixto_multi.pgb 8 15)
    echo "  [$ETIQ] interbloqueos · VARIAS sentencias por transacción (8 clientes, 15 s), repetición $r → $(ntx "$multi") tx · $(tps "$multi") tx/s · $(grep -E 'number of deadlock failures' <<<"$multi" | sed 's/.*: //') interbloqueos · $(abortos "$multi") clientes abortados por un error de SQL ($(grep -c 'lock timeout' <<<"$multi" || true) con lock timeout)"
  done
}

SALIDA_CARGA="$(mktemp -d /tmp/asgcarga.XXXX)"
trap 'rm -rf "$SALIDA_CARGA"' EXIT
for e in "$@"; do
  case "$e" in
    dos-empresas)   escenario_dos_empresas ;;
    misma-empresa)  escenario_misma_empresa ;;
    costo)          escenario_costo ;;
    interbloqueos)  escenario_interbloqueos ;;
    *) echo "❌ escenario desconocido «$e» (dos-empresas | misma-empresa | costo | interbloqueos)"; exit 1 ;;
  esac
done
