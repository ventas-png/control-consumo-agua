#!/usr/bin/env bash
# ════════════════════════════════════════════════════════════════════════════
# Verificación EJECUTABLE de 20261225000000 (convergencia de las columnas de
# tareas_bloque a la forma de producción).
#
# QUÉ COMPRUEBA
#   0 · ESCENARIO   la forma de producción montada a mano (forma_produccion.sql)
#                   da EXACTAMENTE la huella que producción tiene para
#                   `tabla:tareas_bloque/columnas` (META abajo). Sin esto, lo
#                   demás no prueba nada.
#   1 · CONVERGE    sobre la cadena del repositorio, la migración deja el grupo
#                   con esa misma huella y NINGÚN otro grupo del catálogo se
#                   mueve; una segunda pasada no cambia nada.
#   2 · NO-OP       sobre la forma de producción no escribe nada (el catálogo
#                   ENTERO queda con la misma huella) y el log dice los cuatro
#                   no-op.
#   3 · NO ADIVINA  una `foto_url` con otro tipo aborta la migración entera.
#   4 · DEFAULT     un `icono` sin el default de producción lo recibe.
#
# USO:  supabase/tests/tareas_bloque_columnas/run.sh   (PGPORT_TEST=<puerto>)
# Requiere initdb/pg_ctl/psql. No toca ningún proyecto remoto.
# ════════════════════════════════════════════════════════════════════════════
set -Eeuo pipefail
trap 'rc=$?; echo "❌ run.sh terminó con rc=$rc en la línea $LINENO: $BASH_COMMAND" >&2' ERR

AQUI="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RAIZ="$(cd "$AQUI/../../.." && pwd)"
MIGS="$RAIZ/supabase/migrations"
MIGRACION=20261225000000_tareas_bloque_columnas_convergencia
VERSION=${MIGRACION%%_*}
NUESTRA="$MIGS/$MIGRACION.sql"
HUELLA="$RAIZ/scripts/schema-drift/fingerprint.sql"
GRUPO='tabla:tareas_bloque/columnas'

[ -f "$NUESTRA" ] || { echo "❌ no existe $NUESTRA"; exit 1; }
# La huella de producción del grupo, medida el 2026-11-25 y registrada en
# huella-produccion.json. Va fija y no se lee del archivo: la columna
# `obligatoria` (la migración siguiente) vuelve a cambiar el grupo, y cuando se
# recapture la huella tras desplegarla ya no describirá el punto de la cadena que
# esta suite prueba.
META=8e8203055e2efc5ecda3933bca710951a6f14b5f5471984b42a24c20afd9c8eb
META_N=32

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

DATA=$(mktemp -d /tmp/tbcdata.XXXX)
SOCK=$(mktemp -d /tmp/tbcsock.XXXX)
TRABAJO=$(mktemp -d /tmp/tbctrab.XXXX)
chmod 777 "$TRABAJO"
PUERTO=${PGPORT_TEST:-55703}

COMO=""
if [ "$(id -u)" = "0" ]; then
  id postgres >/dev/null 2>&1 || useradd -m postgres
  COMO="su postgres -c"
fi
correr() { if [ -n "$COMO" ]; then su postgres -c "PATH=$PATH $*"; else eval "$*"; fi; }
limpiar() {
  correr "pg_ctl -D $DATA stop -m immediate" >/dev/null 2>&1 || true
  rm -rf "$DATA" "$SOCK" "$TRABAJO"
}
trap limpiar EXIT
if [ -n "$COMO" ]; then chown -R postgres "$DATA" "$SOCK"; fi

correr "initdb -D $DATA -U postgres --auth=trust" >/dev/null
correr "pg_ctl -D $DATA -o '-p $PUERTO -k $SOCK -c fsync=off -c synchronous_commit=off -c full_page_writes=off' -l $DATA/pg.log start" >/dev/null
for _ in $(seq 1 200); do PGHOST="$SOCK" PGPORT="$PUERTO" psql -q -U postgres -d postgres -c 'SELECT 1' >/dev/null 2>&1 && break; sleep 0.1; done

export PGHOST="$SOCK" PGPORT="$PUERTO" PGUSER=postgres
BD=tbc_base
psql -q -d postgres -c "CREATE DATABASE $BD" >/dev/null

aplicar() { PGOPTIONS="-c client_min_messages=warning" psql -q -v ON_ERROR_STOP=1 -d "$1" -f "$2" >/dev/null; }
migrar()  { PGOPTIONS="-c client_min_messages=notice" psql -q -1 -v ON_ERROR_STOP=1 -d "$1" -f "$NUESTRA" 2>&1; }
copia()   { PGOPTIONS="-c client_min_messages=warning" psql -q -d postgres -c "DROP DATABASE IF EXISTS $2" -c "CREATE DATABASE $2 TEMPLATE $1" >/dev/null; }
huella()  { psql -q -v ON_ERROR_STOP=1 -tA -d "$1" -f "$HUELLA" | LC_ALL=C sort; }
grupo()   { huella "$1" | awk -F'\t' -v g="$GRUPO" '$1 == g { print $2 ":" $3 }'; }

echo "── cadena de migraciones ANTERIORES a $VERSION"
aplicar "$BD" "$RAIZ/scripts/schema-drift/bootstrap.sql" 2>/dev/null   # (su único WARNING es el wal_level de la publicación)
N=0
for f in "$MIGS"/*.sql; do
  base="$(basename "$f" .sql)"
  [[ "${base:0:14}" < "$VERSION" ]] || continue
  aplicar "$BD" "$f"; N=$((N + 1))
done
echo "  OK    $N migraciones sobre una base vacía"

echo "── 0 · el escenario es producción"
copia "$BD" tbc_prod
aplicar tbc_prod "$AQUI/forma_produccion.sql"
[ "$(grupo tbc_prod)" = "$META:$META_N" ] || { echo "❌ forma_produccion.sql no da la huella de producción ($(grupo tbc_prod) ≠ $META:$META_N)"; exit 1; }
echo "  OK    forma_produccion.sql reproduce la huella registrada ($META, $META_N columnas)"

echo "── 1 · sobre el repositorio, converge (y sólo en este grupo)"
copia "$BD" tbc_repo
[ "$(grupo tbc_repo)" != "$META:$META_N" ] || { echo "❌ el repositorio ya coincidía: no hay drift que probar"; exit 1; }
huella tbc_repo > "$TRABAJO/h0"
SALIDA=$(migrar tbc_repo)
for frase in 'agregada foto_url' 'agregada icono' 'created_at pasa a NOT NULL' 'orden deja de ser NOT NULL'; do
  echo "$SALIDA" | grep -q "CONVERGENCIA: $frase" || { echo "❌ el log no dice «$frase»:"; echo "$SALIDA"; exit 1; }
done
[ "$(grupo tbc_repo)" = "$META:$META_N" ] || { echo "❌ tras la migración el grupo no coincide con producción ($(grupo tbc_repo))"; exit 1; }
huella tbc_repo > "$TRABAJO/h1"
CAMBIADOS=$( { diff <(cut -f1,2 "$TRABAJO/h0") <(cut -f1,2 "$TRABAJO/h1") || true; } | sed -n 's/^[<>] //p' | cut -f1 | LC_ALL=C sort -u | tr '\n' ' ')
[ "$CAMBIADOS" = "$GRUPO " ] || { echo "❌ la migración movió otros grupos: $CAMBIADOS"; exit 1; }
migrar tbc_repo >/dev/null
huella tbc_repo > "$TRABAJO/h2"
cmp -s "$TRABAJO/h1" "$TRABAJO/h2" || { echo "❌ la segunda pasada cambió el catálogo"; exit 1; }
echo "  OK    el grupo queda con la huella de producción, ningún otro se mueve y la segunda pasada no cambia nada"

echo "── 2 · sobre producción, no-op"
huella tbc_prod > "$TRABAJO/p0"; SALIDA=$(migrar tbc_prod); huella tbc_prod > "$TRABAJO/p1"
cmp -s "$TRABAJO/p0" "$TRABAJO/p1" || { echo "❌ sobre la forma de producción la migración escribió algo"; diff "$TRABAJO/p0" "$TRABAJO/p1" | head; exit 1; }
[ "$(echo "$SALIDA" | grep -c 'CONVERGENCIA: .* ya ')" = "4" ] || { echo "❌ el log no dice los cuatro no-op:"; echo "$SALIDA"; exit 1; }
echo "  OK    el catálogo entero queda idéntico y el log dice los cuatro no-op"

echo "── 3 · una foto_url con otra forma no se adivina"
copia "$BD" tbc_tipo
psql -q -v ON_ERROR_STOP=1 -d tbc_tipo -c "ALTER TABLE public.tareas_bloque ADD COLUMN foto_url jsonb" >/dev/null
huella tbc_tipo > "$TRABAJO/t0"
if SALIDA=$(migrar tbc_tipo); then echo "❌ con foto_url jsonb la migración pasó"; exit 1; fi
echo "$SALIDA" | grep -q 'foto_url existe con otra forma' || { echo "❌ abortó por otro motivo:"; echo "$SALIDA"; exit 1; }
huella tbc_tipo > "$TRABAJO/t1"
cmp -s "$TRABAJO/t0" "$TRABAJO/t1" || { echo "❌ abortó a medias: el catálogo cambió"; exit 1; }
echo "  OK    aborta entera (55000) y no deja nada a medias"

echo "── 4 · un icono sin el default de producción lo recibe"
copia "$BD" tbc_icono
psql -q -v ON_ERROR_STOP=1 -d tbc_icono -c "ALTER TABLE public.tareas_bloque ADD COLUMN icono text" >/dev/null
SALIDA=$(migrar tbc_icono)
echo "$SALIDA" | grep -q 'icono con el default de producción' || { echo "❌ no le puso el default:"; echo "$SALIDA"; exit 1; }
[ "$(grupo tbc_icono)" = "$META:$META_N" ] || { echo "❌ con el icono sin default no converge"; exit 1; }
echo "  OK    le pone el default y converge igual"

echo
echo "✅ tareas_bloque_columnas: el repositorio describe las columnas que producción tiene; sobre producción no escribe nada"
