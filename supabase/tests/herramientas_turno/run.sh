#!/usr/bin/env bash
# ════════════════════════════════════════════════════════════════════════════
# Verificación EJECUTABLE de 20261230000500 (herramientas de un turno con su
# nombre, para quien lo ejecuta: RPC herramientas_del_turno).
#
# POR QUÉ EXISTE
# «Antes de iniciar el turno» listaba «Herramienta · Obligatoria» sin nombre a
# quien sólo tiene Limpieza: la RLS de equipos_comunes e inventario_condominio
# exige su propio tab y el embed llegaba en NULL (se reproduce aquí, A1). La RPC
# es SECURITY DEFINER y se salta esa RLS: que compile no dice que traiga sólo
# lo del turno, sólo nombre y estado, ni que la frenen el tab, el condominio y
# la empresa. Cada una de esas reglas tiene aquí una prueba, y un mutante que
# la quita y DEBE romperla.
#
# QUÉ HACE
#   1 · cadena   bootstrap + TODAS las migraciones anteriores a la versión, en
#                una base vacía (el esquema real, no uno copiado a mano)
#   2 · migra    la migración DOS veces: la segunda no cambia la huella del
#                auditor de drift, y la primera cambia EXACTAMENTE la función
#                nueva y sus grants (ni una tabla, policy o grant de tabla de más)
#   3 · invariantes  fixture.sql + assert.sql (A–D: el reporte, alcance, quién
#                lee, exposición)
#   4 · mutantes copias de la migración, cada una sin una regla: la suite DEBE
#                fallar con cada una. El mutante se aplica también a la versión
#                viva: si una migración posterior repite el texto (porque
#                redefine la función), se muta ahí también.
#
# USO:  supabase/tests/herramientas_turno/run.sh   (PGPORT_TEST=<puerto> para elegirlo)
# Requiere initdb/pg_ctl/psql. No toca ningún proyecto remoto: cluster temporal.
# ════════════════════════════════════════════════════════════════════════════
set -Eeuo pipefail
trap 'rc=$?; echo "❌ run.sh terminó con rc=$rc en la línea $LINENO: $BASH_COMMAND" >&2' ERR

AQUI="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RAIZ="$(cd "$AQUI/../../.." && pwd)"
MIGS="$RAIZ/supabase/migrations"
MIGRACION=20261230000500_herramientas_del_turno
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
DATA=$(mktemp -d /tmp/htdata.XXXX)
SOCK=$(mktemp -d /tmp/htsock.XXXX)
TRABAJO=$(mktemp -d /tmp/httrab.XXXX)
chmod 777 "$TRABAJO"
PUERTO=${PGPORT_TEST:-55705}

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
BD=ht_base
psql -q -d postgres -c "CREATE DATABASE $BD" >/dev/null

aplicar() { PGOPTIONS="-c client_min_messages=warning" psql -q -v ON_ERROR_STOP=1 -d "$1" -f "$2" >/dev/null; }
copia()   { PGOPTIONS="-c client_min_messages=warning" psql -q -d postgres -c "DROP DATABASE IF EXISTS $2" -c "CREATE DATABASE $2 TEMPLATE $1" >/dev/null; }
huella()  { psql -q -v ON_ERROR_STOP=1 -tA -d "$1" -f "$HUELLA" | LC_ALL=C sort; }

# Sustituye $3 por $4 en el archivo $1 y deja el resultado en $2. Sale 1 si el
# texto no está; con $5 = «una», exige que esté exactamente una vez.
sustituir() {
  python3 - "$@" <<'PY'
import sys
src, dst, pat, rep = sys.argv[1:5]
una = len(sys.argv) > 5 and sys.argv[5] == 'una'
s = open(src, encoding='utf-8').read()
n = s.count(pat)
if n == 0 or (una and n != 1):
    sys.exit(1)
open(dst, 'w', encoding='utf-8').write(s.replace(pat, rep))
PY
}

posteriores() {   # aplica, sobre $1, las migraciones de versión mayor que la nuestra
  local pat="${2-}" rep="${3-}"
  for f in "$MIGS"/*.sql; do
    local base; base="$(basename "$f" .sql)"
    [[ "${base:0:14}" > "$VERSION" ]] || continue
    # Con un mutante en curso, la versión VIVA también lo lleva: si una
    # migración posterior repite el texto (porque redefine la función), se muta
    # ahí también. Si lo redefinió con otro texto, el mutante pasa y la suite lo
    # dice: alguien tiene que mirar si la regla sigue en pie.
    if [ -n "$pat" ] && sustituir "$f" "$TRABAJO/posterior.sql" "$pat" "$rep"; then
      chmod 644 "$TRABAJO/posterior.sql"
      aplicar "$1" "$TRABAJO/posterior.sql"
    else
      aplicar "$1" "$f"
    fi
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
copia "$BD" ht_post
huella ht_post > "$TRABAJO/h0"
aplicar ht_post "$NUESTRA"
huella ht_post > "$TRABAJO/h1"
aplicar ht_post "$NUESTRA"
huella ht_post > "$TRABAJO/h2"
cmp -s "$TRABAJO/h1" "$TRABAJO/h2" || { echo "❌ la segunda pasada cambió la huella"; diff "$TRABAJO/h1" "$TRABAJO/h2" | head; exit 1; }
echo "  OK    idempotente: la segunda pasada deja la misma huella"
CAMBIADOS=$( { diff <(cut -f1,2 "$TRABAJO/h0") <(cut -f1,2 "$TRABAJO/h1") || true; } | sed -n 's/^[<>] //p' | cut -f1 | LC_ALL=C sort -u | tr '\n' ' ')
ESPERADOS="funcion:herramientas_del_turno(p_bloque_id uuid) funcion:herramientas_del_turno(p_bloque_id uuid)/grants "
[ "$CAMBIADOS" = "$ESPERADOS" ] || { echo "❌ la migración cambió otros grupos de la huella:"; echo "   cambiados: $CAMBIADOS"; echo "   esperados: $ESPERADOS"; exit 1; }
echo "  OK    la huella cambia EXACTAMENTE en 2 grupos: la función nueva y sus grants (ninguna tabla, policy ni función existente)"
posteriores ht_post

echo "── 3/4 · invariantes"
copia ht_post ht_inv
aplicar ht_inv "$AQUI/fixture.sql"
suite ht_inv "$AQUI/assert.sql"

echo "── 4/4 · mutantes: sin cada regla, la suite debe fallar"
mutante() {   # $1 = etiqueta · $2 = texto que se quita (puede abarcar varias líneas) · $3 = reemplazo
  sustituir "$NUESTRA" "$TRABAJO/mutante.sql" "$2" "$3" una \
    || { echo "❌ el mutante «$1» no encuentra su texto (una sola vez) en la migración"; exit 1; }
  chmod 644 "$TRABAJO/mutante.sql"
  copia "$BD" ht_mut
  aplicar ht_mut "$TRABAJO/mutante.sql"
  posteriores ht_mut "$2" "$3"
  aplicar ht_mut "$AQUI/fixture.sql"
  if psql -q -v ON_ERROR_STOP=1 -d ht_mut -f "$AQUI/assert.sql" >/dev/null 2>&1; then
    echo "❌ el mutante «$1» pasó la suite: la regla no está probada"; exit 1
  fi
  echo "  OK    sin [$1] la suite falla"
}
mutante "Limpieza sola basta (el caso del reporte)" \
  $'            OR public.user_has_permission(\'condominios.tab.prog_limpieza\')) THEN' \
  $'            ) THEN'
mutante "«Mis tareas» basta" \
  "    IF NOT (public.user_has_permission('condominios.tab.tareas_personal')" \
  "    IF NOT (false"
mutante "«Asignación turnos» basta" \
  $'            OR public.user_has_permission(\'condominios.tab.turnos\')\n' \
  ""
mutante "«Revisión de tareas» basta" \
  $'            OR public.user_has_permission(\'condominios.tab.revision_tareas\')\n' \
  ""
mutante "leer exige un tab que trabaje el turno" \
  "    IF NOT (public.user_has_permission('condominios.tab.tareas_personal')" \
  "    IF false AND (public.user_has_permission('condominios.tab.tareas_personal')"
mutante "leer exige acceso al condominio del turno" \
  "    IF NOT public.can_access_project(v_project) THEN" \
  "    IF false THEN"
mutante "leer exige la empresa" \
  "  PERFORM public.assert_company_scope(v_company);" \
  ""
mutante "el turno inexistente se dice" \
  "  IF v_company IS NULL THEN" \
  "  IF false THEN"
mutante "sólo las tareas de ESE turno" \
  "      WHERE t.bloque_id = p_bloque_id AND t.plantilla_id IS NOT NULL" \
  "      WHERE t.plantilla_id IS NOT NULL"
mutante "sólo la puente del condominio del turno" \
  "    AND h.project_id = v_project" \
  ""
mutante "el legado trae el nombre de Inventario" \
  $'         COALESCE(e.nombre, i.nombre),\n         COALESCE(e.estado, i.estado)' \
  $'         e.nombre,\n         COALESCE(e.estado, i.estado)'
mutante "el legado trae el estado de Inventario" \
  $'         COALESCE(e.nombre, i.nombre),\n         COALESCE(e.estado, i.estado)' \
  $'         COALESCE(e.nombre, i.nombre),\n         e.estado'
mutante "anon no la invoca" \
  "REVOKE EXECUTE ON FUNCTION public.herramientas_del_turno(uuid) FROM PUBLIC, anon;" \
  ""

echo
echo "✅ herramientas_turno: quien sólo tiene Limpieza (o Mis tareas, Turnos, Revisión) lee nombre y estado de las herramientas de SU turno —equipo o artículo legado de Inventario— sin que se abran los catálogos; sólo lo del turno y de su condominio, con empresa, tab y acceso al condominio; anon no la invoca"
