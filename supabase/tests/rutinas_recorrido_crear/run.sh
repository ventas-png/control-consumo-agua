#!/usr/bin/env bash
# ════════════════════════════════════════════════════════════════════════════
# RUTINAS · CON CREAR SE GUARDA EL RECORRIDO DE LA RUTINA NUEVA · arnés contra
# un PostgreSQL REAL (20261225000000)
#
# POR QUÉ EXISTE
# Con crear y sin editar, el editor creaba la cabecera y el recorrido moría en
# P0002: guardar_recorrido_rutina bloquea la rutina con FOR UPDATE, y bajo RLS
# eso pide la policy UPDATE (editar). Se reprodujo sobre la cadena entera; esta
# suite lo deja como CONTROL NEGATIVO y prueba el arreglo sin aflojar editar.
#
# QUÉ HACE
#   1 · cadena    bootstrap + TODAS las migraciones anteriores a la versión
#   2 · padrón    el de rutinas_recorrido + quien crea, quien edita, quien ve
#   3 · antes     sin la migración: CRE crea la cabecera y el recorrido da P0002
#   4 · migra     DOS veces: la segunda no cambia la huella, y la primera cambia
#                 EXACTAMENTE la RPC y el helper nuevo (con sus grants)
#   5 · después   assert.sql (nueva, existente, ajena, grants)
#   6 · carrera   dos sesiones: quien edita guarda y retiene la rutina; quien
#                 sólo crea espera y, al ver lo que quedó, ya no la ve nueva
#   7 · mutantes  copias de la migración sin cada compuerta: la suite DEBE fallar
#
# USO:  supabase/tests/rutinas_recorrido_crear/run.sh   (PGPORT_TEST=<puerto>)
# Requiere initdb/pg_ctl/psql. No toca ningún proyecto remoto: cluster temporal.
# ════════════════════════════════════════════════════════════════════════════
set -Eeuo pipefail
trap 'rc=$?; echo "❌ run.sh terminó con rc=$rc en la línea $LINENO: $BASH_COMMAND" >&2' ERR

AQUI="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RAIZ="$(cd "$AQUI/../../.." && pwd)"
MIGS="$RAIZ/supabase/migrations"
MIGRACION=20261225000000_rutinas_recorrido_nueva_con_crear
VERSION=${MIGRACION%%_*}
NUESTRA="$MIGS/$MIGRACION.sql"
HUELLA="$RAIZ/scripts/schema-drift/fingerprint.sql"
PADRON="$RAIZ/supabase/tests/rutinas_recorrido/fixture.sql"
[ -f "$NUESTRA" ] || { echo "❌ no existe $NUESTRA"; exit 1; }

for d in ${PGBIN:-} /usr/lib/postgresql/*/bin; do [ -d "$d" ] && PATH="$d:$PATH"; done
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

# El socket unix tiene un tope de 107 bytes: rutas cortas a propósito.
DATA=$(mktemp -d /tmp/rncdata.XXXX)
SOCK=$(mktemp -d /tmp/rncsock.XXXX)
TRABAJO=$(mktemp -d /tmp/rnctrab.XXXX)
chmod 777 "$TRABAJO"
PUERTO=${PGPORT_TEST:-55703}

COMO=""
if [ "$(id -u)" = "0" ]; then
  id postgres >/dev/null 2>&1 || useradd -m postgres
  COMO="su postgres -c"
fi
correr() { if [ -n "$COMO" ]; then su postgres -c "PATH=$PATH $*"; else eval "$*"; fi; }

# El apagado se delega IGUAL que el arranque: con `pg_ctl` a secas, como root falla
# en silencio y el clúster queda vivo ocupando el puerto.
limpiar() {
  correr "pg_ctl -D $DATA stop -m immediate" >/dev/null 2>&1 || true
  rm -rf "$DATA" "$SOCK" "$TRABAJO"
}
trap limpiar EXIT
if [ -n "$COMO" ]; then chown -R postgres "$DATA" "$SOCK"; fi

correr "initdb -D $DATA -U postgres --auth=trust" >/dev/null
# fsync apagado: clúster DESECHABLE; no cambia ninguna semántica de las pruebas.
correr "pg_ctl -D $DATA -o '-p $PUERTO -k $SOCK -c fsync=off -c synchronous_commit=off -c full_page_writes=off' -l $DATA/pg.log start" >/dev/null
for _ in $(seq 1 200); do PGHOST="$SOCK" PGPORT="$PUERTO" psql -q -U postgres -d postgres -c 'SELECT 1' >/dev/null 2>&1 && break; sleep 0.1; done

export PGHOST="$SOCK" PGPORT="$PUERTO" PGUSER=postgres
BD=rnc_base
psql -q -d postgres -c "CREATE DATABASE $BD" >/dev/null

aplicar() { PGOPTIONS="-c client_min_messages=warning" psql -q -v ON_ERROR_STOP=1 -d "$1" -f "$2" >/dev/null; }
copia()   { PGOPTIONS="-c client_min_messages=warning" psql -q -d postgres -c "DROP DATABASE IF EXISTS $2" -c "CREATE DATABASE $2 TEMPLATE $1" >/dev/null; }
huella()  { psql -q -v ON_ERROR_STOP=1 -tA -d "$1" -f "$HUELLA" | LC_ALL=C sort; }
posteriores() {   # aplica, sobre $1, las migraciones de versión mayor que la nuestra
  for f in "$MIGS"/*.sql; do
    local base; base="$(basename "$f" .sql)"
    [[ "${base:0:14}" > "$VERSION" ]] || continue
    aplicar "$1" "$f"
  done
}

# fase BD antes|despues — corre assert.sql; con $3=silencio no imprime nada y
# sólo devuelve si pasó (para los mutantes).
fase() {
  local salida codigo=0
  salida=$(psql -q -v ON_ERROR_STOP=1 -v fase="$2" -d "$1" -f "$AQUI/assert.sql" 2>&1) || codigo=$?
  [ "${3:-}" = silencio ] && return "$codigo"
  echo "$salida" | sed -n 's/.*NOTICE:  /  /p'
  if [ "$codigo" -ne 0 ]; then
    echo; echo "❌ una invariante no se cumple ($2):"
    echo "$salida" | grep -E "ERROR|DETAIL|CONTEXT" | head -8
    exit 1
  fi
}

# carrera BD [silencio] — A (editar) guarda R_CAR y retiene el bloqueo; B (sólo
# crear) intenta su primer recorrido. Se suelta a A cuando B está esperando un
# lock (o ya terminó, si un mutante no lo hace esperar). Devuelve si B respondió
# «no existe» y el recorrido quedó el de A.
carrera() {
  local bd=$1 pa pb ca=0 cb=0 listo=""
  psql -q -v ON_ERROR_STOP=1 -d "$bd" >/dev/null <<'SQL'
CREATE TABLE rr.carrera_suelta (x int);
INSERT INTO rr.carrera_suelta VALUES (1);
SQL
  psql -q -v ON_ERROR_STOP=1 -d "$bd" -f "$AQUI/carrera_a.sql" > "$TRABAJO/a.log" 2>&1 & pa=$!
  for _ in $(seq 1 200); do
    [ "$(psql -q -tA -d "$bd" -c "SELECT count(*) FROM pg_stat_activity
           WHERE datname = current_database() AND pid <> pg_backend_pid()
             AND query LIKE '%carrera_suelta%' AND state = 'active'")" = 1 ] && { listo=a; break; }
    kill -0 "$pa" 2>/dev/null || break
    sleep 0.05
  done
  if [ "$listo" != a ]; then
    psql -q -d "$bd" -c "DELETE FROM rr.carrera_suelta" >/dev/null; wait "$pa" || true
    [ "${2:-}" = silencio ] || { echo "❌ la sesión A no llegó a retener la rutina:"; cat "$TRABAJO/a.log"; }
    return 1
  fi
  psql -q -v ON_ERROR_STOP=1 -d "$bd" -f "$AQUI/carrera_b.sql" > "$TRABAJO/b.log" 2>&1 & pb=$!
  local espero=""
  for _ in $(seq 1 200); do
    [ "$(psql -q -tA -d "$bd" -c "SELECT count(*) FROM pg_stat_activity
           WHERE datname = current_database() AND wait_event_type = 'Lock'")" -ge 1 ] && { espero=si; break; }
    kill -0 "$pb" 2>/dev/null || break
    sleep 0.05
  done
  psql -q -d "$bd" -c "DELETE FROM rr.carrera_suelta" >/dev/null
  wait "$pa" || ca=$?
  wait "$pb" || cb=$?
  if [ "${2:-}" != silencio ]; then
    sed -n 's/.*NOTICE:  /  /p' "$TRABAJO/b.log"
    if [ "$ca" -ne 0 ] || [ "$cb" -ne 0 ]; then
      echo "❌ la carrera no terminó como debía (A=$ca, B=$cb):"; grep -hE "ERROR|FALLA" "$TRABAJO/a.log" "$TRABAJO/b.log" | head -6
    elif [ -z "$espero" ]; then
      echo "❌ B terminó sin esperar el bloqueo de A: la carrera no probó nada"
    else
      echo "  OK    C0 · B esperó el bloqueo que retenía A (pg_stat_activity: wait_event_type = Lock)"
    fi
    [ -n "$espero" ] || return 1
  fi
  [ "$ca" -eq 0 ] && [ "$cb" -eq 0 ]
}

echo "── 1/7 · andamiaje de plataforma y cadena de migraciones ANTERIORES a $VERSION"
aplicar "$BD" "$RAIZ/scripts/schema-drift/bootstrap.sql" 2>/dev/null   # (su único WARNING es el wal_level de la publicación)
N=0
for f in "$MIGS"/*.sql; do
  base="$(basename "$f" .sql)"
  [[ "${base:0:14}" < "$VERSION" ]] || continue
  aplicar "$BD" "$f"
  N=$((N + 1))
done
echo "  OK    $N migraciones aplicadas sobre una base vacía"

echo "── 2/7 · padrón: el de rutinas_recorrido + quien crea, quien edita y quien sólo ve"
aplicar "$BD" "$PADRON"
aplicar "$BD" "$AQUI/fixture.sql"
echo "  OK    CRE y CRE2 crean sin editar · EDI edita sin crear · VER sólo ve · seis rutinas sembradas"

echo "── 3/7 · CONTROL NEGATIVO: sin la migración"
copia "$BD" rnc_post
fase rnc_post antes

echo "── 4/7 · la migración, DOS veces, y lo que cambia en la huella"
huella rnc_post > "$TRABAJO/h0"
aplicar rnc_post "$NUESTRA"
huella rnc_post > "$TRABAJO/h1"
aplicar rnc_post "$NUESTRA"
huella rnc_post > "$TRABAJO/h2"
cmp -s "$TRABAJO/h1" "$TRABAJO/h2" || { echo "❌ la segunda pasada cambió la huella"; diff "$TRABAJO/h1" "$TRABAJO/h2" | head; exit 1; }
echo "  OK    idempotente: la segunda pasada deja la misma huella"
CAMBIADOS=$( { diff <(cut -f1,2 "$TRABAJO/h0") <(cut -f1,2 "$TRABAJO/h1") || true; } | sed -n 's/^[<>] //p' | cut -f1 | LC_ALL=C sort -u | tr '\n' ' ')
ESPERADOS="funcion:guardar_recorrido_rutina(p_rutina_id uuid, p_recorrido jsonb) funcion:rutina_bloquear_si_nueva(p_rutina_id uuid) funcion:rutina_bloquear_si_nueva(p_rutina_id uuid)/grants "
[ "$CAMBIADOS" = "$ESPERADOS" ] || { echo "❌ la migración cambió otros grupos de la huella:"; echo "   cambiados: $CAMBIADOS"; echo "   esperados: $ESPERADOS"; exit 1; }
echo "  OK    la huella cambia EXACTAMENTE en 3 grupos: el cuerpo de la RPC (sin tocar sus grants) y el helper nuevo con los suyos; ninguna policy"
posteriores rnc_post

echo "── 5/7 · con la migración"
fase rnc_post despues

echo "── 6/7 · carrera: quien edita retiene la rutina, quien sólo crea espera"
carrera rnc_post || exit 1

echo "── 7/7 · mutantes: sin cada compuerta, la suite debe fallar"
mutante() {   # $1 = etiqueta · $2 = texto que se quita (puede abarcar varias líneas) · $3 = reemplazo
  python3 - "$NUESTRA" "$TRABAJO/mutante.sql" "$2" "$3" <<'PY' || { echo "❌ el mutante «$1» no encuentra su texto en la migración"; exit 1; }
import sys
src, dst, pat, rep = sys.argv[1:5]
s = open(src, encoding='utf-8').read()
if s.count(pat) != 1:
    sys.exit(1)
open(dst, 'w', encoding='utf-8').write(s.replace(pat, rep, 1))
PY
  chmod 644 "$TRABAJO/mutante.sql"
  copia "$BD" rnc_mut
  fase rnc_mut antes silencio || { echo "❌ el control negativo falló antes del mutante «$1»"; exit 1; }
  aplicar rnc_mut "$TRABAJO/mutante.sql"
  posteriores rnc_mut
  local donde=""
  fase rnc_mut despues silencio || donde="assert.sql"
  [ -n "$donde" ] || carrera rnc_mut silencio || donde="la carrera"
  [ -n "$donde" ] || { echo "❌ el mutante «$1» pasó la suite: la regla no está probada"; exit 1; }
  echo "  OK    sin [$1] la suite falla (en $donde)"
}
mutante "hace falta poder crear" \
  "  IF NOT public.condominios_puede_actuar('prog_limpieza', 'create') THEN" \
  "  IF false THEN"
mutante "la rutina es de quien la creó" \
  $'    AND r.creado_por = auth.uid()\n' \
  ""
mutante "la rutina es de su empresa" \
  $'    AND r.company_id = public.get_my_company_id()\n' \
  ""
mutante "con paradas ya tiene recorrido" \
  $'  IF EXISTS (SELECT 1 FROM public.rutina_areas WHERE rutina_id = p_rutina_id)\n     OR EXISTS' \
  "  IF EXISTS"
mutante "con pasos ya tiene recorrido" \
  $'\n     OR EXISTS (SELECT 1 FROM public.rutina_actividades WHERE rutina_id = p_rutina_id) THEN' \
  " THEN"
mutante "el helper bloquea la rutina" \
  $'    AND r.creado_por = auth.uid()\n  FOR UPDATE;' \
  $'    AND r.creado_por = auth.uid();'
mutante "«sin recorrido» se mira DESPUÉS de bloquear" \
  $'    AND r.creado_por = auth.uid()\n  FOR UPDATE;' \
  $'    AND r.creado_por = auth.uid()\n    AND NOT EXISTS (SELECT 1 FROM public.rutina_areas WHERE rutina_id = p_rutina_id)\n    AND NOT EXISTS (SELECT 1 FROM public.rutina_actividades WHERE rutina_id = p_rutina_id)\n  FOR UPDATE;\n  IF FOUND THEN RETURN true; END IF;'

echo
echo "✅ rutinas_recorrido_crear: con crear y sin editar se guarda el primer recorrido de la rutina propia; la existente, la ajena y la de otra empresa siguen pidiendo editar, y dos sesiones no se mezclan"
