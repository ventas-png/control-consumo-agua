#!/usr/bin/env bash
# ════════════════════════════════════════════════════════════════════════════
# Verificación EJECUTABLE de 20261105000100: vocabulario cerrado, transiciones
# de estado, agenda y votos congelados al cerrar la asamblea, e historial de
# votos.
#
# POR QUÉ EXISTE
# Un trigger que congela puede congelar de más: la purga de una empresa, el
# borrado de una unidad o de un usuario arrastran votos en cascada, y tienen
# que pasar. Y puede congelar de menos: borrar el PUNTO se llevaría los votos
# de una asamblea cerrada por la puerta de atrás. Nada de eso se ve leyendo
# el SQL.
#
# QUÉ HACE
#   1 · cadena      bootstrap + TODAS las migraciones anteriores, en una base
#                   vacía (el esquema real, no uno copiado a mano)
#   2 · antes       sobre ese estado, el padrón REPRODUCE los huecos (votos y
#                   agenda editables con la asamblea cerrada, estado que
#                   retrocede, texto libre, sin historial)
#   3 · migra       la migración DOS veces: la segunda no cambia la huella del
#                   auditor de drift, y cambian EXACTAMENTE los grupos de las
#                   tres tablas y las cuatro funciones
#   4 · invariantes fixture.sql + assert.sql
#   5 · vocabulario 'En Curso', ' ORDINARIA ' se normalizan; un valor
#                   desconocido hace ABORTAR la migración nombrándolo, sin
#                   tocar ni una fila
#   6 · mutantes    copias de la migración (sin guarda), cada una con una regla
#                   rota: la suite DEBE fallar con cada una, por una invariante
#
# USO:  supabase/tests/asambleas_integridad/run.sh   (PGPORT_TEST=<puerto> para elegirlo)
# Requiere initdb/pg_ctl/psql. No toca ningún proyecto remoto: cluster temporal.
# ════════════════════════════════════════════════════════════════════════════
set -Eeuo pipefail
trap 'rc=$?; echo "❌ run.sh terminó con rc=$rc en la línea $LINENO: $BASH_COMMAND" >&2' ERR

AQUI="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RAIZ="$(cd "$AQUI/../../.." && pwd)"
MIGS="$RAIZ/supabase/migrations"
NUESTRA="$MIGS/20261105000100_asambleas_integridad_estado_y_votos.sql"
VERSION=20261105000100
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
DATA=$(mktemp -d /tmp/aidata.XXXX)
SOCK=$(mktemp -d /tmp/aisock.XXXX)
TRABAJO=$(mktemp -d /tmp/aitrab.XXXX)
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
BD=ai_base
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

echo "── 1/6 · andamiaje de plataforma y cadena de migraciones ANTERIORES a $VERSION"
aplicar "$BD" "$RAIZ/scripts/schema-drift/bootstrap.sql" 2>/dev/null   # (su único WARNING es el wal_level de la publicación)
N=0
for f in "$MIGS"/*.sql; do
  base="$(basename "$f" .sql)"
  [[ "${base:0:14}" < "$VERSION" ]] || continue
  aplicar "$BD" "$f"
  N=$((N + 1))
done
echo "  OK    $N migraciones aplicadas sobre una base vacía"

echo "── 2/6 · control previo: el padrón reproduce los huecos de ANTES"
copia "$BD" ai_antes
aplicar ai_antes "$AQUI/fixture.sql"
suite ai_antes "$AQUI/antes.sql"

echo "── 3/6 · la migración, DOS veces, y lo que cambia en la huella"
copia "$BD" ai_post
huella ai_post > "$TRABAJO/h0"
aplicar ai_post "$NUESTRA"
huella ai_post > "$TRABAJO/h1"
aplicar ai_post "$NUESTRA"
huella ai_post > "$TRABAJO/h2"
cmp -s "$TRABAJO/h1" "$TRABAJO/h2" || { echo "❌ la segunda pasada cambió la huella"; diff "$TRABAJO/h1" "$TRABAJO/h2" | head; exit 1; }
echo "  OK    idempotente: la segunda pasada deja la misma huella"
CAMBIADOS=$( { diff <(cut -f1,2 "$TRABAJO/h0") <(cut -f1,2 "$TRABAJO/h1") || true; } | sed -n 's/^[<>] //p' | cut -f1 | LC_ALL=C sort -u | tr '\n' ' ')
ESPERADOS="funcion:asambleas_tg_puntos_congelados() funcion:asambleas_tg_puntos_congelados()/grants funcion:asambleas_tg_transicion_estado() funcion:asambleas_tg_transicion_estado()/grants funcion:asambleas_tg_votos_congelados() funcion:asambleas_tg_votos_congelados()/grants funcion:asambleas_tg_votos_historial() funcion:asambleas_tg_votos_historial()/grants tabla:asambleas/constraints tabla:asambleas/triggers tabla:puntos_asamblea/constraints tabla:puntos_asamblea/triggers tabla:votos_asamblea/triggers "
[ "$CAMBIADOS" = "$ESPERADOS" ] || { echo "❌ la migración cambió otros grupos de la huella:"; echo "   cambiados: $CAMBIADOS"; echo "   esperados: $ESPERADOS"; exit 1; }
echo "  OK    la huella cambia EXACTAMENTE en los CHECK y triggers de asambleas, puntos_asamblea y votos_asamblea y en las cuatro funciones (ninguna policy, grant de tabla ni columna)"
posteriores ai_post

echo "── 4/6 · invariantes"
copia ai_post ai_inv
aplicar ai_inv "$AQUI/fixture.sql"
suite ai_inv "$AQUI/assert.sql"

echo "── 5/6 · vocabulario: se normaliza lo reconocible y se aborta con lo demás"
copia "$BD" ai_norm
aplicar ai_norm "$AQUI/fixture.sql"
psql -q -v ON_ERROR_STOP=1 -d ai_norm >/dev/null <<'SQL'
UPDATE public.asambleas SET estado = 'En Curso', tipo = ' ORDINARIA ' WHERE id = ai.id('CUR');
UPDATE public.puntos_asamblea SET tipo = 'Informativo' WHERE id = ai.id('PUN_PROG');
SQL
aplicar ai_norm "$NUESTRA"
NORM=$(psql -q -tA -v ON_ERROR_STOP=1 -d ai_norm -c "SELECT (SELECT estado || '/' || tipo FROM public.asambleas WHERE id = ai.id('CUR')) || ' ' || (SELECT tipo FROM public.puntos_asamblea WHERE id = ai.id('PUN_PROG'))")
[ "$NORM" = "en_curso/ordinaria informativo" ] || { echo "❌ la normalización dejó: $NORM"; exit 1; }
echo "  OK    'En Curso' → 'en_curso', ' ORDINARIA ' → 'ordinaria', 'Informativo' → 'informativo'"

# Supabase aplica cada migración en una transacción: --single-transaction lo
# reproduce. Con un valor desconocido la migración aborta nombrándolo y deja la
# base EXACTAMENTE como estaba.
copia "$BD" ai_guarda
aplicar ai_guarda "$AQUI/fixture.sql"
psql -q -v ON_ERROR_STOP=1 -d ai_guarda >/dev/null <<'SQL'
UPDATE public.asambleas SET tipo = 'asamblea anual', estado = 'En curso' WHERE id = ai.id('CUR');
UPDATE public.puntos_asamblea SET tipo = 'eleccion' WHERE id = ai.id('PUN_PROG');
SQL
ANTES=$(psql -q -tA -d ai_guarda -c "SELECT md5(string_agg(to_jsonb(a)::text, '|' ORDER BY id)) FROM public.asambleas a")
if SALIDA=$(PGOPTIONS="-c client_min_messages=warning" psql -q --single-transaction -v ON_ERROR_STOP=1 -d ai_guarda -f "$NUESTRA" 2>&1); then
  echo "❌ la migración pasó en verde con valores fuera del vocabulario: el CHECK se habría saltado"; exit 1
fi
echo "$SALIDA" | grep -q "valores fuera del vocabulario (asambleas.tipo 'asamblea anual'; puntos_asamblea.tipo 'eleccion')" \
  || { echo "❌ la migración falló, pero NO por la guarda de vocabulario:"; echo "$SALIDA" | sed -n 's/.*ERROR:  /  /p'; exit 1; }
DESPUES=$(psql -q -tA -d ai_guarda -c "SELECT md5(string_agg(to_jsonb(a)::text, '|' ORDER BY id)) FROM public.asambleas a")
[ "$ANTES" = "$DESPUES" ] || { echo "❌ la migración abortada dejó filas cambiadas (la normalización de 'En curso' no se deshizo)"; exit 1; }
[ "$(psql -q -tA -d ai_guarda -c "SELECT count(*) FROM pg_trigger WHERE tgname = 'votos_asamblea_congelados'")" = "0" ] \
  || { echo "❌ la migración abortada dejó triggers creados"; exit 1; }
echo "  OK    aborta: $(echo "$SALIDA" | sed -n 's/.*ERROR:  //p' | head -1)"
echo "  OK    y la base queda como estaba: ni la normalización ni los triggers sobreviven al aborto"

echo "── 6/6 · mutantes: con cada regla rota, la suite debe fallar"
# A la copia se le quita la guarda de postcondición: lo que se prueba aquí es
# que la SUITE detecta la regla rota, no que la guarda lo haga por ella.
#   mutante ETIQUETA TEXTO REEMPLAZO   reemplaza TODAS las apariciones (al menos una)
#   mutante ETIQUETA @paso ''          vacía el bloque -- [paso:paso] … -- [/paso:paso]
mutante() {
  python3 - "$NUESTRA" "$TRABAJO/mut.sql" "$2" "$3" <<'PY' || { echo "❌ el mutante «$1» no encuentra su texto en la migración"; exit 1; }
import re, sys
src, dst, pat, rep = sys.argv[1:5]
s = open(src, encoding='utf-8').read()
s = s[:s.index('-- ── 5 · Guarda de postcondición')]
if pat.startswith('@'):
    paso = re.escape(pat[1:])
    s, n = re.subn(r'-- \[paso:' + paso + r'\].*?-- \[/paso:' + paso + r'\]', '-- (mutante: sin ' + pat[1:] + ')', s, flags=re.S)
    if n == 0:
        sys.exit(1)
else:
    if s.count(pat) == 0:
        sys.exit(1)
    s = s.replace(pat, rep)
open(dst, 'w', encoding='utf-8').write(s)
PY
  chmod 644 "$TRABAJO/mut.sql"
  copia "$BD" ai_mut
  aplicar ai_mut "$TRABAJO/mut.sql"
  posteriores ai_mut
  aplicar ai_mut "$AQUI/fixture.sql"
  local salida
  if salida=$(psql -q -v ON_ERROR_STOP=1 -d ai_mut -f "$AQUI/assert.sql" 2>&1); then
    echo "❌ el mutante «$1» pasó la suite: la regla no está probada"; exit 1
  fi
  # Sólo cuenta si cae una INVARIANTE (ai.chk): cualquier otro error sería un
  # falso verde del mutante.
  echo "$salida" | grep -q 'ERROR:  .* — esperado ' \
    || { echo "❌ el mutante «$1» rompió la suite por otra causa:"; echo "$salida" | grep -E 'ERROR' | head -3; exit 1; }
  echo "  OK    con [$1] la suite falla"
  echo "$salida" | sed -n 's/.*ERROR:  \(.*\) — esperado .*/          → \1/p' | head -1
}

mutante "tipo de asamblea libre" \
  "CHECK (tipo IN ('ordinaria', 'extraordinaria'));" "CHECK (true);"
mutante "estado libre" \
  "CHECK (estado IN ('programada', 'en_curso', 'finalizada', 'cancelada'));" "CHECK (true);"
mutante "tipo de punto libre" \
  "CHECK (tipo IN ('informativo', 'votacion', 'debate'));" "CHECK (true);"
mutante "una asamblea finalizada se reabre" \
  "('en_curso', 'finalizada'), ('en_curso', 'cancelada')) THEN" "('en_curso', 'finalizada'), ('en_curso', 'cancelada'), ('finalizada', 'en_curso')) THEN"
mutante "se finaliza sin pasar por en curso" \
  "('en_curso', 'finalizada'), ('en_curso', 'cancelada')) THEN" "('en_curso', 'finalizada'), ('en_curso', 'cancelada'), ('programada', 'finalizada')) THEN"
mutante "sólo «finalizada» congela (cancelada no)" \
  "IN ('finalizada', 'cancelada')" "IN ('finalizada')"
mutante "punto: se edita o borra con la asamblea cerrada" "@punto_viejo" ""
mutante "punto: se agrega con la asamblea cerrada" "@punto_nuevo" ""
mutante "punto: la cascada de su asamblea cuenta como cerrada" \
  "SELECT a.estado INTO v_estado FROM public.asambleas a WHERE a.id = OLD.asamblea_id;" \
  "SELECT coalesce((SELECT a.estado FROM public.asambleas a WHERE a.id = OLD.asamblea_id), 'finalizada') INTO v_estado;"
mutante "voto: se cambia o borra con la asamblea cerrada" "@voto_viejo" ""
mutante "voto: se registra con la asamblea cerrada" "@voto_nuevo" ""
mutante "voto: no cae con su unidad" "@cascada_voto" ""
mutante "voto: la cascada de su punto o su asamblea cuenta como cerrada" \
  $'     WHERE p.id = OLD.punto_id;' \
  $'     WHERE p.id = OLD.punto_id;\n    v_estado := coalesce(v_estado, \'finalizada\');'
mutante "voto: borrar el usuario que lo registró falla" "@usuario_borrado" ""
mutante "historial sin empresa (sólo lo ve super_admin)" "@empresa_historial" ""
mutante "sin historial de votos" \
  $'CREATE TRIGGER votos_asamblea_historial\n  AFTER INSERT OR UPDATE OR DELETE ON public.votos_asamblea\n  FOR EACH ROW EXECUTE FUNCTION public.asambleas_tg_votos_historial();' \
  '-- (mutante: sin trigger de historial)'
echo
echo "✅ asambleas_integridad: el padrón reproduce los huecos de antes; después,"
echo "   tipo y estado tienen vocabulario cerrado, el estado sólo avanza, una"
echo "   asamblea cerrada congela su agenda y sus votos (aun para service_role)"
echo "   sin trabar las cascadas, cada voto deja historial para el admin de su"
echo "   empresa, y dieciséis mutantes rompen la suite."
