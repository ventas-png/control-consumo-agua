#!/usr/bin/env bash
# ════════════════════════════════════════════════════════════════════════════
# Verificación EJECUTABLE de 20261103000000 (calendario de limpieza: cada rutina
# se le asigna a una persona en un día de su turno).
#
# POR QUÉ EXISTE
# Tres RPC SECURITY DEFINER escriben y leen saltándose la RLS: que compilen no
# dice que «ver» el tab no alcance para asignar, que un día pasado o un turno
# cerrado se rechacen, que lo trabajado no se pueda borrar, ni que las tareas
# salgan en el orden del recorrido y con el área de su parada. Cada una de esas
# compuertas tiene aquí una prueba, y un mutante que la quita y DEBE romperla.
#
# QUÉ HACE
#   1 · cadena   bootstrap + TODAS las migraciones anteriores a la versión, en
#                una base vacía (el esquema real, no uno copiado a mano)
#   2 · migra    la migración DOS veces: la segunda no cambia la huella del
#                auditor de drift, y la primera cambia EXACTAMENTE las cinco
#                funciones nuevas y sus grants (ni una tabla, policy o grant de
#                tabla de más)
#   3 · invariantes  fixture.sql + assert.sql (A–D: leer, asignar, quitar,
#                exposición)
#   4 · mutantes copias de la migración, cada una sin una compuerta: la suite
#                DEBE fallar con cada una
#
# USO:  supabase/tests/limpieza_calendario/run.sh   (PGPORT_TEST=<puerto> para elegirlo)
# Requiere initdb/pg_ctl/psql. No toca ningún proyecto remoto: cluster temporal.
# ════════════════════════════════════════════════════════════════════════════
set -Eeuo pipefail
trap 'rc=$?; echo "❌ run.sh terminó con rc=$rc en la línea $LINENO: $BASH_COMMAND" >&2' ERR

AQUI="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RAIZ="$(cd "$AQUI/../../.." && pwd)"
MIGS="$RAIZ/supabase/migrations"
MIGRACION=20261103000000_limpieza_calendario_rutinas
VERSION=${MIGRACION%%_*}
NUESTRA="$MIGS/$MIGRACION.sql"
HUELLA="$RAIZ/scripts/schema-drift/fingerprint.sql"

[ -f "$NUESTRA" ] || { echo "❌ no existe $NUESTRA"; exit 1; }

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

# El socket unix tiene un tope de 107 bytes: rutas cortas a propósito.
DATA=$(mktemp -d /tmp/lccdata.XXXX)
SOCK=$(mktemp -d /tmp/lccsock.XXXX)
TRABAJO=$(mktemp -d /tmp/lcctrab.XXXX)
chmod 777 "$TRABAJO"
PUERTO=${PGPORT_TEST:-55573}

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
BD=lcc_base
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

# Corre una suite y exige que TERMINE bien; muestra sus OK.
suite() {         # suite BD ARCHIVO
  local salida codigo=0
  salida=$(psql -q -v ON_ERROR_STOP=1 -d "$1" -f "$2" 2>&1) || codigo=$?
  echo "$salida" | sed -n 's/.*NOTICE:  /  /p'
  if [ "$codigo" -ne 0 ]; then
    echo; echo "❌ una invariante no se cumple ($(basename "$2")):"
    echo "$salida" | grep -E "ERROR|DETAIL|CONTEXT|LINE" | head -12
    exit 1
  fi
}

echo "── 1/4 · andamiaje de plataforma y cadena de migraciones ANTERIORES a $VERSION"
aplicar "$BD" "$RAIZ/scripts/schema-drift/bootstrap.sql" 2>/dev/null   # (su único WARNING es el wal_level de la publicación)
N=0
for f in "$MIGS"/*.sql; do
  base="$(basename "$f" .sql)"
  [[ "${base:0:14}" < "$VERSION" ]] || continue
  aplicar "$BD" "$f"
  N=$((N + 1))
done
echo "  OK    $N migraciones aplicadas sobre una base vacía"

echo "── 2/4 · la migración, DOS veces, y lo que cambia en la huella"
copia "$BD" lcc_post
huella lcc_post > "$TRABAJO/h0"
aplicar lcc_post "$NUESTRA"
huella lcc_post > "$TRABAJO/h1"
aplicar lcc_post "$NUESTRA"
huella lcc_post > "$TRABAJO/h2"
cmp -s "$TRABAJO/h1" "$TRABAJO/h2" || { echo "❌ la segunda pasada cambió la huella"; diff "$TRABAJO/h1" "$TRABAJO/h2" | head; exit 1; }
echo "  OK    idempotente: la segunda pasada deja la misma huella"
CAMBIADOS=$( { diff <(cut -f1,2 "$TRABAJO/h0") <(cut -f1,2 "$TRABAJO/h1") || true; } | sed -n 's/^[<>] //p' | cut -f1 | LC_ALL=C sort -u | tr '\n' ' ')
ESPERADOS="funcion:limpieza_asegurar_turno_programable(p_bloque bloques_turno) funcion:limpieza_asegurar_turno_programable(p_bloque bloques_turno)/grants funcion:limpieza_asignar_rutinas(p_bloque_id uuid, p_rutina_ids uuid[]) funcion:limpieza_asignar_rutinas(p_bloque_id uuid, p_rutina_ids uuid[])/grants funcion:limpieza_calendario(p_project_id uuid, p_desde date, p_hasta date) funcion:limpieza_calendario(p_project_id uuid, p_desde date, p_hasta date)/grants funcion:limpieza_quitar_rutina(p_bloque_id uuid, p_rutina_id uuid) funcion:limpieza_quitar_rutina(p_bloque_id uuid, p_rutina_id uuid)/grants funcion:limpieza_tarea_trabajada(t tareas_bloque) funcion:limpieza_tarea_trabajada(t tareas_bloque)/grants "
[ "$CAMBIADOS" = "$ESPERADOS" ] || { echo "❌ la migración cambió otros grupos de la huella:"; echo "   cambiados: $CAMBIADOS"; echo "   esperados: $ESPERADOS"; exit 1; }
echo "  OK    la huella cambia EXACTAMENTE en 10 grupos: las cinco funciones nuevas y sus grants (ninguna tabla, policy ni función existente)"
posteriores lcc_post

echo "── 3/4 · invariantes"
copia lcc_post lcc_inv
aplicar lcc_inv "$AQUI/fixture.sql"
suite lcc_inv "$AQUI/assert.sql"

echo "── 4/4 · mutantes: sin cada compuerta, la suite debe fallar"
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
  copia "$BD" lcc_mut
  aplicar lcc_mut "$TRABAJO/mutante.sql"
  posteriores lcc_mut
  aplicar lcc_mut "$AQUI/fixture.sql"
  if psql -q -v ON_ERROR_STOP=1 -d lcc_mut -f "$AQUI/assert.sql" >/dev/null 2>&1; then
    echo "❌ el mutante «$1» pasó la suite: la regla no está probada"; exit 1
  fi
  echo "  OK    sin [$1] la suite falla"
}
mutante "asignar exige EDITAR, no sólo ver" \
  "    IF NOT public.condominios_puede_actuar('prog_limpieza', 'edit') THEN" \
  "    IF NOT public.user_has_permission('condominios.tab.prog_limpieza') THEN"
mutante "programar exige acceso al condominio" \
  "    IF NOT public.can_access_project(p_bloque.project_id) THEN" \
  "    IF false THEN"
mutante "el turno cerrado no se programa" \
  "  IF p_bloque.cerrado_en IS NOT NULL OR p_bloque.estado IN ('completado', 'cancelado') THEN" \
  "  IF false THEN"
mutante "el día pasado no se programa" \
  "  IF p_bloque.fecha < v_hoy THEN" \
  "  IF false THEN"
mutante "leer exige el tab de Limpieza" \
  "    IF NOT public.user_has_permission('condominios.tab.prog_limpieza') THEN" \
  "    IF false THEN"
mutante "leer exige acceso al condominio" \
  "    IF NOT public.can_access_project(p_project_id) THEN" \
  "    IF false THEN"
mutante "lo trabajado no se quita" \
  $'      AND public.limpieza_tarea_trabajada(t)\n  ) THEN' \
  $'      AND false\n  ) THEN'
mutante "una foto es trabajo" \
  "      OR COALESCE(t.foto_urls, '[]'::jsonb) NOT IN ('[]'::jsonb, 'null'::jsonb)" \
  ""
mutante "una revisión es trabajo" \
  "      OR EXISTS (SELECT 1 FROM public.revisiones_tarea r WHERE r.tarea_id = t.id)" \
  ""
mutante "las tareas siguen el orden PEDIDO" \
  "             ORDER BY c.k, c.orden_parada NULLS FIRST" \
  "             ORDER BY c.orden_parada NULLS FIRST"
mutante "dentro de la rutina, parada → paso" \
  "             ORDER BY c.k, c.orden_parada NULLS FIRST, c.parada_id NULLS FIRST," \
  "             ORDER BY c.k,"
mutante "«ya está» compara el área" \
  "          AND tb.area_id IS NOT DISTINCT FROM COALESCE(rz.area_id, p.area_id, r.area_id)" \
  ""
mutante "el área inactiva no genera" \
  $'      AND (rz.id IS NULL OR za.activo)\n  ),' \
  $'  ),'
mutante "la rutina vacía se dice" \
  "  IF v_vacia IS NOT NULL THEN" \
  "  IF false THEN"

echo
echo "✅ limpieza_calendario: el mes se lee con lo mínimo de cada persona y sólo con el tab; asignar crea el recorrido en el turno, en orden y sin duplicar, sólo con edición, en días de hoy en adelante y turnos abiertos; lo trabajado no se quita"
