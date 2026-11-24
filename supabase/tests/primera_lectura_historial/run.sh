#!/usr/bin/env bash
# ════════════════════════════════════════════════════════════════════════════
# Verificación EJECUTABLE de 20261215000000_agua_primera_lectura_fecha_del_historial.
#
# QUÉ HACE
#   1 · base       fixture de registrar_lectura + la RPC autoritativa
#                  (20260910000200) + fixture-extra (historial importado)
#   2 · migra      aplica la migración DOS veces → idempotente
#   3 · invariantes  assert.sql (9)
#   4 · mutantes   copias de la migración, cada una sin una condición: la suite DEBE fallar
#
# USO:  supabase/tests/primera_lectura_historial/run.sh
# Requiere initdb/pg_ctl/psql. No toca ningún proyecto remoto: cluster temporal.
# ════════════════════════════════════════════════════════════════════════════
set -euo pipefail

AQUI="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RAIZ="$(cd "$AQUI/../../.." && pwd)"
LECT="$RAIZ/supabase/tests/registrar_lectura"
MIG_RPC="$RAIZ/supabase/migrations/20260910000200_registrar_lectura_autoritativa.sql"
NUESTRA="$RAIZ/supabase/migrations/20261215000000_agua_primera_lectura_fecha_del_historial.sql"

for d in /usr/lib/postgresql/*/bin; do [ -d "$d" ] && PATH="$d:$PATH"; done
export PATH
command -v initdb >/dev/null || { echo "❌ falta initdb (instalá PostgreSQL)"; exit 1; }

DATA=$(mktemp -d /tmp/plhdata.XXXX)
SOCK=$(mktemp -d /tmp/plhsock.XXXX)
MUT=$(mktemp /tmp/plhmut.XXXX.sql)
PUERTO=${PGPORT_TEST:-55600}

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
N_MUT=5
psql -q -d postgres -c "CREATE DATABASE plh" >/dev/null
for i in $(seq 1 $N_MUT); do psql -q -d postgres -c "CREATE DATABASE plhm$i" >/dev/null; done

aplicar() { PGOPTIONS="-c client_min_messages=warning" psql -q -v ON_ERROR_STOP=1 -d "$1" -f "$2" >/dev/null; }
huella() { psql -q -At -d "$1" -c "SELECT md5(pg_get_functiondef('public.agua_lectura_contexto(uuid)'::regprocedure) || coalesce((SELECT proacl::text FROM pg_proc WHERE oid = 'public.agua_lectura_contexto(uuid)'::regprocedure), ''))"; }
cd "$AQUI"

base() {
  aplicar "$1" "$LECT/fixture.sql"
  aplicar "$1" "$MIG_RPC"
  aplicar "$1" "$AQUI/fixture-extra.sql"
}

echo "── 1/4 · fixture: padrón de agua, la RPC autoritativa y el historial importado ─"
base plh
echo "  OK    5 contadores con historial: heredó · no heredó · anterior a la instalación · de la vecina"

echo "── 2/4 · la migración, DOS veces ───────────────────────────────────────"
aplicar plh "$NUESTRA"
H1=$(huella plh)
aplicar plh "$NUESTRA"
H2=$(huella plh)
[ "$H1" = "$H2" ] || { echo "❌ re-aplicar la migración cambió la función ($H1 ≠ $H2)"; exit 1; }
echo "  OK    idempotente: la función y su ACL no cambian al re-aplicar"

echo "── 3/4 · invariantes ───────────────────────────────────────────────────"
CODIGO=0
SALIDA=$(psql -q -v ON_ERROR_STOP=1 -d plh -f "$AQUI/assert.sql" 2>&1) || CODIGO=$?
echo "$SALIDA" | sed -n 's/.*NOTICE:  /  /p'
if [ "$CODIGO" -ne 0 ]; then
  echo; echo "❌ una invariante no se cumple:"
  echo "$SALIDA" | grep -E "ERROR|DETAIL|CONTEXT|LINE" | head -12
  exit 1
fi
TOTAL=$(echo "$SALIDA" | grep -c "NOTICE:  OK")
echo "  OK    $TOTAL comprobaciones"

echo "── 4/4 · mutantes: sin cada condición, la suite debe fallar ────────────"
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
  base "plhm$M"; aplicar "plhm$M" "$MUT"
  if psql -q -v ON_ERROR_STOP=1 -d "plhm$M" -f "$AQUI/assert.sql" >/dev/null 2>&1; then
    echo "❌ el mutante «$1» pasó la suite: la regla no está probada"; exit 1
  fi
  echo "  OK    sin [$1] la suite falla"
}
mutante "la fecha sale del historial"            "           THEN (his.fecha + time '12:00') AT TIME ZONE v_tz" "           THEN NULL::timestamptz"
mutante "sólo si la inicial ES esa lectura"      "      CASE WHEN his.lectura = COALESCE(v_contador.lectura_inicial, 0)
                AND (" "      CASE WHEN his.lectura IS NOT NULL
                AND ("
mutante "no si es anterior a la instalación"     "                AND (v_contador.fecha_instalacion IS NULL OR his.fecha >= v_contador.fecha_instalacion)
" ""
mutante "sólo filas con lectura"                 "       AND h.lectura IS NOT NULL
" ""
mutante "el historial es el del contador"        "     WHERE h.contador_id = p_contador_id
       AND h.lectura IS NOT NULL" "     WHERE h.lectura IS NOT NULL"
[ "$M" -eq "$N_MUT" ] || { echo "❌ se esperaban $N_MUT mutantes y corrieron $M"; exit 1; }

echo
echo "✅ primera_lectura_historial: la primera lectura de un contador con historial importado toma como anterior la fecha de ese historial, y sólo cuando su base es esa lectura"
