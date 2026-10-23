#!/usr/bin/env bash
# ════════════════════════════════════════════════════════════════════════════
# Verificación EJECUTABLE de 20261104000650: el candado de plan de
# puntos_asamblea y votos_asamblea resuelve la empresa por `asambleas`.
#
# POR QUÉ EXISTE
# El candado de 20260602000010 se leía bien y rechazaba TODO: buscaba la
# empresa en asambleas_digital por una columna que esa tabla no tiene, Postgres
# la ligó a la fila de afuera y la subconsulta nunca encontró nada. Al ser
# RESTRICTIVO, ningún admin pudo volver a agregar un punto ni registrar un voto.
# Nada de eso se ve leyendo el SQL: hay que insertar como cada persona.
#
# QUÉ HACE
#   1 · cadena     bootstrap + TODAS las migraciones anteriores, en una base
#                  vacía (el esquema real, no uno copiado a mano)
#   2 · antes      sobre ese estado, el padrón REPRODUCE el fallo (el admin de
#                  una empresa con la feature no agrega puntos ni vota) y
#                  prueba que la causa es el candado. Si no, la suite no
#                  probaría nada.
#   3 · migra      la migración DOS veces: la segunda no cambia la huella del
#                  auditor de drift, y cambian EXACTAMENTE las policies de las
#                  dos tablas
#   4 · invariantes fixture.sql + assert.sql (con y sin la feature, trial,
#                  cancelada, el plan de la empresa de la asamblea y no el de
#                  quien inserta, las permisivas intactas)
#   5 · guarda     con un candado viejo de más (otro nombre, todavía por
#                  asambleas_digital), la migración ABORTA
#   6 · mutantes   copias de la migración (sin guarda), cada una con una regla
#                  rota: la suite DEBE fallar con cada una
#
# USO:  supabase/tests/candado_plan_asambleas/run.sh   (PGPORT_TEST=<puerto> para elegirlo)
# Requiere initdb/pg_ctl/psql. No toca ningún proyecto remoto: cluster temporal.
# ════════════════════════════════════════════════════════════════════════════
set -Eeuo pipefail
trap 'rc=$?; echo "❌ run.sh terminó con rc=$rc en la línea $LINENO: $BASH_COMMAND" >&2' ERR

AQUI="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RAIZ="$(cd "$AQUI/../../.." && pwd)"
MIGS="$RAIZ/supabase/migrations"
NUESTRA="$MIGS/20261104000650_asambleas_candado_plan_por_asambleas.sql"
VERSION=20261104000650
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
DATA=$(mktemp -d /tmp/cpdata.XXXX)
SOCK=$(mktemp -d /tmp/cpsock.XXXX)
TRABAJO=$(mktemp -d /tmp/cptrab.XXXX)
chmod 777 "$TRABAJO"
PUERTO=${PGPORT_TEST:-55574}

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
BD=cp_base
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

echo "── 2/6 · control previo: el padrón reproduce el fallo de ANTES"
copia "$BD" cp_antes
aplicar cp_antes "$AQUI/fixture.sql"
suite cp_antes "$AQUI/antes.sql"

echo "── 3/6 · la migración, DOS veces, y lo que cambia en la huella"
copia "$BD" cp_post
huella cp_post > "$TRABAJO/h0"
aplicar cp_post "$NUESTRA"
huella cp_post > "$TRABAJO/h1"
aplicar cp_post "$NUESTRA"
huella cp_post > "$TRABAJO/h2"
cmp -s "$TRABAJO/h1" "$TRABAJO/h2" || { echo "❌ la segunda pasada cambió la huella"; diff "$TRABAJO/h1" "$TRABAJO/h2" | head; exit 1; }
echo "  OK    idempotente: la segunda pasada deja la misma huella"
CAMBIADOS=$( { diff <(cut -f1,2 "$TRABAJO/h0") <(cut -f1,2 "$TRABAJO/h1") || true; } | sed -n 's/^[<>] //p' | cut -f1 | LC_ALL=C sort -u | tr '\n' ' ')
ESPERADOS="tabla:puntos_asamblea/policies tabla:votos_asamblea/policies "
[ "$CAMBIADOS" = "$ESPERADOS" ] || { echo "❌ la migración cambió otros grupos de la huella:"; echo "   cambiados: $CAMBIADOS"; echo "   esperados: $ESPERADOS"; exit 1; }
echo "  OK    la huella cambia EXACTAMENTE en las policies de puntos_asamblea y votos_asamblea (ninguna función, grant ni columna)"
posteriores cp_post

echo "── 4/6 · invariantes"
copia cp_post cp_inv
aplicar cp_inv "$AQUI/fixture.sql"
suite cp_inv "$AQUI/assert.sql"

echo "── 5/6 · guarda: con un candado viejo de más, la migración aborta"
# Un RESTRICTIVO se combina con AND: uno de más que todavía busque la empresa en
# asambleas_digital seguiría rechazando todo aunque los dos nuestros estén bien.
copia "$BD" cp_guarda
psql -q -v ON_ERROR_STOP=1 -d cp_guarda >/dev/null <<'SQL'
CREATE POLICY puntos_asamblea_plan_heredado ON public.puntos_asamblea
  AS RESTRICTIVE FOR INSERT TO authenticated
  WITH CHECK (public.company_has_feature(
    (SELECT company_id FROM public.asambleas_digital WHERE id = asamblea_id), 'asambleas_digitales'));
SQL
if SALIDA=$(PGOPTIONS="-c client_min_messages=warning" psql -q -v ON_ERROR_STOP=1 -d cp_guarda -f "$NUESTRA" 2>&1); then
  echo "❌ la migración pasó en verde con un candado viejo de más: la guarda es decorativa"; exit 1
fi
echo "$SALIDA" | grep -q 'siguen resolviendo la empresa por asambleas_digital: puntos_asamblea.puntos_asamblea_plan_heredado' \
  || { echo "❌ la migración falló, pero NO por la guarda esperada:"; echo "$SALIDA" | sed -n 's/.*ERROR:  /  /p'; exit 1; }
echo "  OK    aborta: $(echo "$SALIDA" | sed -n 's/.*ERROR:  //p' | head -1)"

echo "── 6/6 · mutantes: con cada regla rota, la suite debe fallar"
# A la copia se le quita la guarda de postcondición: lo que se prueba aquí es
# que la SUITE detecta la regla rota, no que la guarda lo haga por ella. El
# texto se reemplaza en TODAS sus apariciones; que aparezca al menos una vez es
# obligatorio.
mutante() {   # $1 = etiqueta · $2 = texto que se quita · $3 = reemplazo
  python3 - "$NUESTRA" "$TRABAJO/mut.sql" "$2" "$3" <<'PY' || { echo "❌ el mutante «$1» no encuentra su texto en la migración"; exit 1; }
import sys
src, dst, pat, rep = sys.argv[1:5]
s = open(src, encoding='utf-8').read()
s = s[:s.index('-- ── 3 · Guarda de postcondición')]
if s.count(pat) == 0:
    sys.exit(1)
open(dst, 'w', encoding='utf-8').write(s.replace(pat, rep))
PY
  chmod 644 "$TRABAJO/mut.sql"
  copia "$BD" cp_mut
  aplicar cp_mut "$TRABAJO/mut.sql"
  posteriores cp_mut
  aplicar cp_mut "$AQUI/fixture.sql"
  local salida
  if salida=$(psql -q -v ON_ERROR_STOP=1 -d cp_mut -f "$AQUI/assert.sql" 2>&1); then
    echo "❌ el mutante «$1» pasó la suite: la regla no está probada"; exit 1
  fi
  # Sólo cuenta si cae una INVARIANTE (cp.chk): cualquier otro error sería un
  # falso verde del mutante.
  echo "$salida" | grep -q 'ERROR:  .* — esperado ' \
    || { echo "❌ el mutante «$1» rompió la suite por otra causa:"; echo "$salida" | grep -E 'ERROR' | head -3; exit 1; }
  echo "  OK    con [$1] la suite falla"
  echo "$salida" | sed -n 's/.*ERROR:  \(.*\) — esperado .*/          → \1/p' | head -1
}

mutante "puntos: la empresa por asambleas_digital (el fallo original)" \
  $'FROM public.asambleas a\n        WHERE a.id = puntos_asamblea.asamblea_id' \
  $'FROM public.asambleas_digital a\n        WHERE a.id = puntos_asamblea.asamblea_id'
mutante "votos: la empresa por asambleas_digital (el fallo original)" \
  'JOIN public.asambleas a ON a.id = p.asamblea_id' \
  'JOIN public.asambleas_digital a ON a.id = p.asamblea_id'
mutante "puntos: sin candado" \
  $'CREATE POLICY puntos_asamblea_feature_gate ON public.puntos_asamblea\n  AS RESTRICTIVE\n  FOR INSERT\n  TO authenticated\n  WITH CHECK (\n' \
  $'CREATE POLICY puntos_asamblea_feature_gate ON public.puntos_asamblea\n  AS RESTRICTIVE\n  FOR INSERT\n  TO authenticated\n  WITH CHECK (true OR\n'
mutante "votos: sin candado" \
  $'CREATE POLICY votos_asamblea_feature_gate ON public.votos_asamblea\n  AS RESTRICTIVE\n  FOR INSERT\n  TO authenticated\n  WITH CHECK (\n' \
  $'CREATE POLICY votos_asamblea_feature_gate ON public.votos_asamblea\n  AS RESTRICTIVE\n  FOR INSERT\n  TO authenticated\n  WITH CHECK (true OR\n'
mutante "puntos: el candado es PERMISIVO" \
  $'CREATE POLICY puntos_asamblea_feature_gate ON public.puntos_asamblea\n  AS RESTRICTIVE\n' \
  $'CREATE POLICY puntos_asamblea_feature_gate ON public.puntos_asamblea\n'
mutante "votos: el candado es PERMISIVO" \
  $'CREATE POLICY votos_asamblea_feature_gate ON public.votos_asamblea\n  AS RESTRICTIVE\n' \
  $'CREATE POLICY votos_asamblea_feature_gate ON public.votos_asamblea\n'
mutante "puntos: otra feature (cobranza_judicial, que agua_only sí tiene)" \
  $'WHERE a.id = puntos_asamblea.asamblea_id),\n      \'asambleas_digitales\'' \
  $'WHERE a.id = puntos_asamblea.asamblea_id),\n      \'cobranza_judicial\''
mutante "votos: otra feature (cobranza_judicial, que agua_only sí tiene)" \
  $'WHERE p.id = votos_asamblea.punto_id),\n      \'asambleas_digitales\'' \
  $'WHERE p.id = votos_asamblea.punto_id),\n      \'cobranza_judicial\''
mutante "puntos: el plan de quien inserta, no el de la asamblea" \
  $'(SELECT a.company_id\n         FROM public.asambleas a\n        WHERE a.id = puntos_asamblea.asamblea_id)' \
  '(SELECT public.get_my_company_id())'
mutante "votos: el plan de quien inserta, no el de la asamblea" \
  $'(SELECT a.company_id\n         FROM public.puntos_asamblea p\n         JOIN public.asambleas a ON a.id = p.asamblea_id\n        WHERE p.id = votos_asamblea.punto_id)' \
  '(SELECT public.get_my_company_id())'
echo
echo "✅ candado_plan_asambleas: antes, ni el admin de una empresa con la feature"
echo "   agregaba puntos ni votaba; después, el candado mira el plan de la empresa"
echo "   de la asamblea (con la feature sí, sin ella o cancelada no), las permisivas"
echo "   siguen decidiendo quién, la guarda aborta de verdad y diez mutantes rompen"
echo "   la suite."
