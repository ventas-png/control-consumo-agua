#!/usr/bin/env bash
# ════════════════════════════════════════════════════════════════════════════
# Verificación EJECUTABLE de 20261101000000 (convergencia de los índices de
# tareas_bloque a la forma de producción).
#
# QUÉ COMPRUEBA
#   0 · ESCENARIO   la forma de producción montada a mano (forma_produccion.sql)
#                   da EXACTAMENTE la huella que producción tenía para
#                   `tabla:tareas_bloque/indices` antes de 20261102000000 (ver
#                   META abajo). Sin esto, lo demás no prueba nada.
#   1 · CONVERGE    sobre la cadena del repositorio, la migración deja el grupo
#                   con esa misma huella; una segunda pasada no cambia nada.
#   2 · NO-OP       sobre la forma de producción no escribe nada (el catálogo
#                   ENTERO queda con la misma huella) y lo dice en el log.
#   3 · DUPLICADO   con el índice viejo y el de producción a la vez, retira el
#                   viejo en vez de dejar dos índices iguales.
#
# USO:  supabase/tests/tareas_bloque_indices/run.sh   (PGPORT_TEST=<puerto>)
# Requiere initdb/pg_ctl/psql. No toca ningún proyecto remoto.
# ════════════════════════════════════════════════════════════════════════════
set -Eeuo pipefail
trap 'rc=$?; echo "❌ run.sh terminó con rc=$rc en la línea $LINENO: $BASH_COMMAND" >&2' ERR

AQUI="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RAIZ="$(cd "$AQUI/../../.." && pwd)"
MIGS="$RAIZ/supabase/migrations"
MIGRACION=20261101000000_tareas_bloque_indices_convergencia
VERSION=${MIGRACION%%_*}
NUESTRA="$MIGS/$MIGRACION.sql"
HUELLA="$RAIZ/scripts/schema-drift/fingerprint.sql"
GRUPO='tabla:tareas_bloque/indices'

[ -f "$NUESTRA" ] || { echo "❌ no existe $NUESTRA"; exit 1; }
# La huella de producción del grupo ANTES de 20261102000000: la forma a la que
# converge esta migración, medida el 2026-10-19 y registrada en
# huella-produccion.json hasta su recaptura tras #951. Va fija y no se lee del
# archivo: 20261102000000 vuelve a cambiar el grupo (6 → 7 índices), así que la
# huella vigente ya no describe el punto de la cadena que esta suite prueba.
META=d23b0e8d0f2caf45df822b42479f8387411d3678fe21bca73bad5243a0a50f54

for d in /usr/lib/postgresql/*/bin; do [ -d "$d" ] && PATH="$d:$PATH"; done
export PATH
command -v initdb >/dev/null || { echo "❌ falta initdb (instalá PostgreSQL)"; exit 1; }

# Shims de pg_net/pg_cron: fuera de Supabase no existen y varias migraciones hacen CREATE EXTENSION.
EXT="$(pg_config --sharedir 2>/dev/null || echo /usr/share/postgresql/$(basename "$(dirname "$(command -v initdb)")"))/extension"
for ext in pg_net pg_cron; do
  [ -f "$EXT/$ext.control" ] && continue
  CTL="comment = 'shim vacío del arnés'"$'\n'"default_version = '1.0'"$'\n'"relocatable = true"
  if [ -w "$EXT" ]; then
    printf '%s\n' "$CTL" > "$EXT/$ext.control"; echo 'SELECT 1;' > "$EXT/$ext--1.0.sql"
  else
    printf '%s\n' "$CTL" | sudo -n tee "$EXT/$ext.control" >/dev/null
    echo 'SELECT 1;' | sudo -n tee "$EXT/$ext--1.0.sql" >/dev/null
  fi
done

DATA=$(mktemp -d /tmp/tbidata.XXXX)
SOCK=$(mktemp -d /tmp/tbisock.XXXX)
PUERTO=${PGPORT_TEST:-55548}

COMO=""
if [ "$(id -u)" = "0" ]; then
  id postgres >/dev/null 2>&1 || useradd -m postgres
  COMO="su postgres -c"
fi
correr() { if [ -n "$COMO" ]; then su postgres -c "PATH=$PATH $*"; else eval "$*"; fi; }
limpiar() {
  correr "pg_ctl -D $DATA stop -m immediate" >/dev/null 2>&1 || true
  rm -rf "$DATA" "$SOCK"
}
trap limpiar EXIT
if [ -n "$COMO" ]; then chown -R postgres "$DATA" "$SOCK"; fi

correr "initdb -D $DATA -U postgres --auth=trust" >/dev/null
correr "pg_ctl -D $DATA -o '-p $PUERTO -k $SOCK -c fsync=off -c synchronous_commit=off -c full_page_writes=off' -l $DATA/pg.log start" >/dev/null
for _ in $(seq 1 200); do PGHOST="$SOCK" PGPORT="$PUERTO" psql -q -U postgres -d postgres -c 'SELECT 1' >/dev/null 2>&1 && break; sleep 0.1; done

export PGHOST="$SOCK" PGPORT="$PUERTO" PGUSER=postgres
BD=tbi_base
psql -q -d postgres -c "CREATE DATABASE $BD" >/dev/null

aplicar() { PGOPTIONS="-c client_min_messages=warning" psql -q -v ON_ERROR_STOP=1 -d "$1" -f "$2" >/dev/null; }
migrar()  { PGOPTIONS="-c client_min_messages=notice" psql -q -1 -v ON_ERROR_STOP=1 -d "$1" -f "$NUESTRA" 2>&1; }
copia()   { PGOPTIONS="-c client_min_messages=warning" psql -q -d postgres -c "DROP DATABASE IF EXISTS $2" -c "CREATE DATABASE $2 TEMPLATE $1" >/dev/null; }
grupo()   { psql -q -v ON_ERROR_STOP=1 -tA -d "$1" -f "$HUELLA" | awk -F'\t' -v g="$GRUPO" '$1 == g { print $2 }'; }
todo()    { psql -q -v ON_ERROR_STOP=1 -tA -d "$1" -f "$HUELLA" | LC_ALL=C sort | sha256sum; }

echo "── cadena de migraciones ANTERIORES a $VERSION"
aplicar "$BD" "$RAIZ/scripts/schema-drift/bootstrap.sql" 2>/dev/null
N=0
for f in "$MIGS"/*.sql; do
  base="$(basename "$f" .sql)"
  [[ "${base:0:14}" < "$VERSION" ]] || continue
  aplicar "$BD" "$f"; N=$((N + 1))
done
echo "  OK    $N migraciones sobre una base vacía"

echo "── 0 · el escenario es producción"
copia "$BD" tbi_prod
aplicar tbi_prod "$AQUI/forma_produccion.sql"
[ "$(grupo tbi_prod)" = "$META" ] || { echo "❌ forma_produccion.sql no da la huella de producción ($(grupo tbi_prod) ≠ $META)"; exit 1; }
echo "  OK    forma_produccion.sql reproduce la huella registrada ($META)"

echo "── 1 · sobre el repositorio, converge"
copia "$BD" tbi_repo
[ "$(grupo tbi_repo)" != "$META" ] || { echo "❌ el repositorio ya coincidía: no hay drift que probar"; exit 1; }
SALIDA=$(migrar tbi_repo)
echo "$SALIDA" | grep -q 'idx_tareas_bloque_bloque → tareas_bloque_bloque_id_orden_idx' || { echo "❌ no renombró"; echo "$SALIDA"; exit 1; }
[ "$(grupo tbi_repo)" = "$META" ] || { echo "❌ tras la migración el grupo no coincide con producción"; exit 1; }
H1=$(todo tbi_repo); migrar tbi_repo >/dev/null; H2=$(todo tbi_repo)
[ "$H1" = "$H2" ] || { echo "❌ la segunda pasada cambió el catálogo"; exit 1; }
echo "  OK    el grupo queda con la huella de producción; la segunda pasada no cambia nada"

echo "── 2 · sobre producción, no-op"
H1=$(todo tbi_prod); SALIDA=$(migrar tbi_prod); H2=$(todo tbi_prod)
[ "$H1" = "$H2" ] || { echo "❌ sobre la forma de producción la migración escribió algo"; exit 1; }
[ "$(echo "$SALIDA" | grep -c 'ya estaba\|ya tenía\|ya no estaba')" = "3" ] || { echo "❌ el log no dice los tres no-op:"; echo "$SALIDA"; exit 1; }
echo "  OK    el catálogo entero queda idéntico y el log dice los tres no-op"

echo "── 3 · el índice viejo y el de producción a la vez"
copia "$BD" tbi_dup
psql -q -v ON_ERROR_STOP=1 -d tbi_dup -c "CREATE INDEX tareas_bloque_bloque_id_orden_idx ON public.tareas_bloque (bloque_id, orden)" >/dev/null
SALIDA=$(migrar tbi_dup)
echo "$SALIDA" | grep -q 'retirado idx_tareas_bloque_bloque' || { echo "❌ no retiró el duplicado"; echo "$SALIDA"; exit 1; }
[ "$(grupo tbi_dup)" = "$META" ] || { echo "❌ con el duplicado no converge"; exit 1; }
echo "  OK    retira el viejo y converge igual"

echo
echo "✅ tareas_bloque_indices: el repositorio describe los índices que producción tiene; sobre producción no escribe nada"
