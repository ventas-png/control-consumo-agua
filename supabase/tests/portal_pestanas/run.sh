#!/usr/bin/env bash
# ════════════════════════════════════════════════════════════════════════════
# Verificación EJECUTABLE de 20261106000000: la empresa decide qué pestañas ve
# el residente en el portal de cada condominio (projects.portal_tabs_ocultos).
#
# POR QUÉ EXISTE
# La migración no trae policy propia: la escritura descansa en projects_update
# y la lectura del residente en projects_select. Lo único que lo demuestra es
# entrar como cada persona.
#
# QUÉ HACE
#   1 · cadena     bootstrap + TODAS las migraciones anteriores
#   2 · migra      el padrón se carga ANTES (proyectos que ya existían) y la
#                  migración corre DOS veces: idempotente, y la huella del
#                  auditor cambia EXACTAMENTE en columnas y constraints de projects
#   3 · invariantes assert.sql: quién escribe, quién lee, el CHECK
#   4 · mutantes   copias de la migración, cada una con una regla rota: la suite
#                  DEBE fallar con cada una
#
# USO:  supabase/tests/portal_pestanas/run.sh   (PGPORT_TEST=<puerto> para elegirlo)
# Requiere initdb/pg_ctl/psql. No toca ningún proyecto remoto: cluster temporal.
# ════════════════════════════════════════════════════════════════════════════
set -Eeuo pipefail
trap 'rc=$?; echo "❌ run.sh terminó con rc=$rc en la línea $LINENO: $BASH_COMMAND" >&2' ERR

AQUI="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RAIZ="$(cd "$AQUI/../../.." && pwd)"
MIGS="$RAIZ/supabase/migrations"
NUESTRA="$MIGS/20261106000000_portal_pestanas_por_condominio.sql"
VERSION=20261106000000
HUELLA="$RAIZ/scripts/schema-drift/fingerprint.sql"
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
DATA=$(mktemp -d /tmp/ppdata.XXXX)
SOCK=$(mktemp -d /tmp/ppsock.XXXX)
TRABAJO=$(mktemp -d /tmp/pptrab.XXXX)
chmod 777 "$TRABAJO"
PUERTO=${PGPORT_TEST:-55586}

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
BD=pp_base
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
# El padrón entra ANTES de la migración: sus proyectos son «los de siempre».
aplicar "$BD" "$AQUI/fixture.sql"
SIN_COL=$(psql -q -tA -d "$BD" -c "SELECT count(*) FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'projects' AND column_name = 'portal_tabs_ocultos'")
[ "$SIN_COL" = "0" ] || { echo "❌ projects.portal_tabs_ocultos ya existía antes de la migración"; exit 1; }
echo "  OK    padrón cargado; projects todavía no tiene portal_tabs_ocultos"

echo "── 2/4 · la migración, DOS veces, y lo que cambia en la huella"
copia "$BD" pp_post
huella pp_post > "$TRABAJO/h0"
aplicar pp_post "$NUESTRA"
huella pp_post > "$TRABAJO/h1"
aplicar pp_post "$NUESTRA"
huella pp_post > "$TRABAJO/h2"
cmp -s "$TRABAJO/h1" "$TRABAJO/h2" || { echo "❌ la segunda pasada cambió la huella"; diff "$TRABAJO/h1" "$TRABAJO/h2" | head; exit 1; }
echo "  OK    idempotente: la segunda pasada deja la misma huella"
CAMBIADOS=$( { diff <(cut -f1,2 "$TRABAJO/h0") <(cut -f1,2 "$TRABAJO/h1") || true; } | sed -n 's/^[<>] //p' | cut -f1 | LC_ALL=C sort -u | tr '\n' ' ')
ESPERADOS="tabla:projects/columnas tabla:projects/constraints "
[ "$CAMBIADOS" = "$ESPERADOS" ] || { echo "❌ la migración cambió otros grupos de la huella:"; echo "   cambiados: $CAMBIADOS"; echo "   esperados: $ESPERADOS"; exit 1; }
echo "  OK    la huella cambia EXACTAMENTE en columnas y constraints de projects (ninguna policy ni grant)"
posteriores pp_post

echo "── 3/4 · invariantes"
copia pp_post pp_inv
suite pp_inv "$AQUI/assert.sql"

echo "── 4/4 · mutantes: con cada regla rota, la suite debe fallar"
mutante() {   # $1 = etiqueta · $2 = texto que se quita · $3 = reemplazo
  python3 - "$NUESTRA" "$TRABAJO/mut.sql" "$2" "$3" <<'PY' || { echo "❌ el mutante «$1» no encuentra su texto en la migración"; exit 1; }
import sys
src, dst, pat, rep = sys.argv[1:5]
s = open(src, encoding='utf-8').read()
if s.count(pat) == 0:
    sys.exit(1)
open(dst, 'w', encoding='utf-8').write(s.replace(pat, rep))
PY
  chmod 644 "$TRABAJO/mut.sql"
  copia "$BD" pp_mut
  aplicar pp_mut "$TRABAJO/mut.sql"
  posteriores pp_mut
  local salida
  if salida=$(psql -q -v ON_ERROR_STOP=1 -d pp_mut -f "$AQUI/assert.sql" 2>&1); then
    echo "❌ el mutante «$1» pasó la suite: la regla no está probada"; exit 1
  fi
  # Sólo cuenta si cae una INVARIANTE (pp.chk): cualquier otro error sería un
  # falso verde del mutante.
  echo "$salida" | grep -q 'ERROR:  .* — esperado ' \
    || { echo "❌ el mutante «$1» rompió la suite por otra causa:"; echo "$salida" | grep -E 'ERROR' | head -3; exit 1; }
  echo "  OK    con [$1] la suite falla"
  echo "$salida" | sed -n 's/.*ERROR:  \(.*\) — esperado .*/          → \1/p' | head -1
}

mutante "el CHECK admite apagar Mi Unidad" \
  "      'reservas', 'cuenta'," \
  "      'mi_unidad', 'reservas', 'cuenta',"
mutante "sin CHECK: cualquier texto entra" \
  'portal_tabs_ocultos <@ ARRAY[' \
  'true OR portal_tabs_ocultos <@ ARRAY['
mutante "la columna admite NULL" \
  "text[] NOT NULL DEFAULT '{}'::text[];" \
  "text[] DEFAULT '{}'::text[];"
mutante "sin DEFAULT: los condominios de siempre quedan en NULL" \
  "text[] NOT NULL DEFAULT '{}'::text[];" \
  "text[];"
echo
echo "✅ portal_pestanas: los condominios de siempre quedan con nada apagado; el"
echo "   propietario y el administrador de la empresa apagan pestañas en SUS"
echo "   condominios y nadie más; el residente lee la configuración de su"
echo "   condominio y no la de otros; Mi Unidad no se apaga, y cuatro mutantes"
echo "   rompen la suite."
