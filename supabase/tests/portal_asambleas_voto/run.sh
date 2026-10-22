#!/usr/bin/env bash
# ════════════════════════════════════════════════════════════════════════════
# Verificación EJECUTABLE de 20261105000000: el propietario ve las asambleas de
# su condominio y vota desde el portal, una vez por unidad, con la asamblea en
# curso.
#
# POR QUÉ EXISTE
# El tab «Asambleas» del portal fallaba por cuatro causas a la vez (modelo,
# payload, vocabulario y RLS) y ninguna se veía en la UI: los puntos salían
# vacíos y el voto daba un error genérico. Hay que entrar como cada persona.
#
# QUÉ HACE
#   1 · cadena     bootstrap + TODAS las migraciones anteriores (incluido el
#                  candado de plan corregido de 20261104000550)
#   2 · antes      sobre ese estado, el padrón REPRODUCE cada causa
#   3 · migra      la migración DOS veces: idempotente, y la huella del auditor
#                  cambia EXACTAMENTE en el CHECK de votos_asamblea y los dos
#                  RPC (ninguna policy)
#   4 · normaliza  los votos 'favor'/'contra' que hubiera pasan a 'a_favor'/'en_contra'
#   5 · invariantes fixture.sql + assert.sql
#   6 · guarda     con un voto fuera del vocabulario, la migración ABORTA
#   7 · mutantes   copias de la migración (sin guarda), cada una con una regla
#                  rota: la suite DEBE fallar con cada una
#
# USO:  supabase/tests/portal_asambleas_voto/run.sh   (PGPORT_TEST=<puerto> para elegirlo)
# Requiere initdb/pg_ctl/psql. No toca ningún proyecto remoto: cluster temporal.
# ════════════════════════════════════════════════════════════════════════════
set -Eeuo pipefail
trap 'rc=$?; echo "❌ run.sh terminó con rc=$rc en la línea $LINENO: $BASH_COMMAND" >&2' ERR

AQUI="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RAIZ="$(cd "$AQUI/../../.." && pwd)"
MIGS="$RAIZ/supabase/migrations"
NUESTRA="$MIGS/20261105000000_portal_asambleas_voto_propietario.sql"
VERSION=20261105000000
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
DATA=$(mktemp -d /tmp/pvdata.XXXX)
SOCK=$(mktemp -d /tmp/pvsock.XXXX)
TRABAJO=$(mktemp -d /tmp/pvtrab.XXXX)
chmod 777 "$TRABAJO"
PUERTO=${PGPORT_TEST:-55585}

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
BD=pv_base
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

echo "── 2/7 · control previo: el padrón reproduce el fallo de ANTES"
copia "$BD" pv_antes
aplicar pv_antes "$AQUI/fixture.sql"
suite pv_antes "$AQUI/antes.sql"

echo "── 3/7 · la migración, DOS veces, y lo que cambia en la huella"
copia "$BD" pv_post
huella pv_post > "$TRABAJO/h0"
aplicar pv_post "$NUESTRA"
huella pv_post > "$TRABAJO/h1"
aplicar pv_post "$NUESTRA"
huella pv_post > "$TRABAJO/h2"
cmp -s "$TRABAJO/h1" "$TRABAJO/h2" || { echo "❌ la segunda pasada cambió la huella"; diff "$TRABAJO/h1" "$TRABAJO/h2" | head; exit 1; }
echo "  OK    idempotente: la segunda pasada deja la misma huella"
CAMBIADOS=$( { diff <(cut -f1,2 "$TRABAJO/h0") <(cut -f1,2 "$TRABAJO/h1") || true; } | sed -n 's/^[<>] //p' | cut -f1 | LC_ALL=C sort -u | tr '\n' ' ')
ESPERADOS="funcion:portal_asambleas_unidad(p_unidad_id uuid) funcion:portal_asambleas_unidad(p_unidad_id uuid)/grants funcion:portal_votar_punto(p_punto_id uuid, p_unidad_id uuid, p_voto text) funcion:portal_votar_punto(p_punto_id uuid, p_unidad_id uuid, p_voto text)/grants tabla:votos_asamblea/constraints "
[ "$CAMBIADOS" = "$ESPERADOS" ] || { echo "❌ la migración cambió otros grupos de la huella:"; echo "   cambiados: $CAMBIADOS"; echo "   esperados: $ESPERADOS"; exit 1; }
echo "  OK    la huella cambia EXACTAMENTE en el CHECK de votos_asamblea y los dos RPC con sus grants (ninguna policy)"
posteriores pv_post

echo "── 4/7 · los votos con el vocabulario viejo se normalizan"
copia "$BD" pv_norm
aplicar pv_norm "$AQUI/fixture.sql"
psql -q -v ON_ERROR_STOP=1 -d pv_norm >/dev/null <<'SQL'
INSERT INTO public.votos_asamblea (punto_id, unidad_id, voto) VALUES
  (pv.id('PUN_V'),    pv.id('U_P'),  'favor'),
  (pv.id('PUN_PROG'), pv.id('U_P'),  'contra'),
  (pv.id('PUN_PROG'), pv.id('U_P2'), 'abstencion');
SQL
aplicar pv_norm "$NUESTRA"
NORM=$(psql -q -tA -v ON_ERROR_STOP=1 -d pv_norm -c "SELECT string_agg(voto, ',' ORDER BY voto) FROM public.votos_asamblea WHERE unidad_id IN (pv.id('U_P'), pv.id('U_P2')) AND punto_id IN (pv.id('PUN_V'), pv.id('PUN_PROG'))")
[ "$NORM" = "a_favor,abstencion,en_contra" ] || { echo "❌ la normalización dejó: $NORM"; exit 1; }
echo "  OK    'favor' → 'a_favor' y 'contra' → 'en_contra'; 'abstencion' queda igual"

echo "── 5/7 · invariantes"
copia pv_post pv_inv
aplicar pv_inv "$AQUI/fixture.sql"
suite pv_inv "$AQUI/assert.sql"

echo "── 6/7 · guarda: con un voto fuera del vocabulario, la migración aborta"
copia "$BD" pv_guarda
aplicar pv_guarda "$AQUI/fixture.sql"
psql -q -v ON_ERROR_STOP=1 -d pv_guarda -c "INSERT INTO public.votos_asamblea (punto_id, unidad_id, voto) VALUES (pv.id('PUN_V'), pv.id('U_P'), 'si')" >/dev/null
if SALIDA=$(PGOPTIONS="-c client_min_messages=warning" psql -q -v ON_ERROR_STOP=1 -d pv_guarda -f "$NUESTRA" 2>&1); then
  echo "❌ la migración pasó en verde con un voto 'si': el CHECK se habría saltado"; exit 1
fi
echo "$SALIDA" | grep -q "votos_asamblea tiene votos fuera del vocabulario ('si')" \
  || { echo "❌ la migración falló, pero NO por la guarda esperada:"; echo "$SALIDA" | sed -n 's/.*ERROR:  /  /p'; exit 1; }
echo "  OK    aborta: $(echo "$SALIDA" | sed -n 's/.*ERROR:  //p' | head -1)"

echo "── 7/7 · mutantes: con cada regla rota, la suite debe fallar"
# A la copia se le quita la guarda de postcondición: lo que se prueba aquí es
# que la SUITE detecta la regla rota, no que la guarda lo haga por ella. El
# texto se reemplaza en TODAS sus apariciones; que aparezca al menos una vez es
# obligatorio.
mutante() {   # $1 = etiqueta · $2 = texto que se quita · $3 = reemplazo
  python3 - "$NUESTRA" "$TRABAJO/mut.sql" "$2" "$3" <<'PY' || { echo "❌ el mutante «$1» no encuentra su texto en la migración"; exit 1; }
import sys
src, dst, pat, rep = sys.argv[1:5]
s = open(src, encoding='utf-8').read()
s = s[:s.index('-- ── 4 · Guarda de postcondición')]
if s.count(pat) == 0:
    sys.exit(1)
open(dst, 'w', encoding='utf-8').write(s.replace(pat, rep))
PY
  chmod 644 "$TRABAJO/mut.sql"
  copia "$BD" pv_mut
  aplicar pv_mut "$TRABAJO/mut.sql"
  posteriores pv_mut
  aplicar pv_mut "$AQUI/fixture.sql"
  local salida
  if salida=$(psql -q -v ON_ERROR_STOP=1 -d pv_mut -f "$AQUI/assert.sql" 2>&1); then
    echo "❌ el mutante «$1» pasó la suite: la regla no está probada"; exit 1
  fi
  # Sólo cuenta si cae una INVARIANTE (pv.chk): cualquier otro error sería un
  # falso verde del mutante.
  echo "$salida" | grep -q 'ERROR:  .* — esperado ' \
    || { echo "❌ el mutante «$1» rompió la suite por otra causa:"; echo "$salida" | grep -E 'ERROR' | head -3; exit 1; }
  echo "  OK    con [$1] la suite falla"
  echo "$salida" | sed -n 's/.*ERROR:  \(.*\) — esperado .*/          → \1/p' | head -1
}

mutante "lectura: cualquier residente (mis_unidades_ids), no sólo el propietario" \
  'AND u.id IN (SELECT public.mis_unidades_propietario_ids())' \
  'AND u.id IN (SELECT public.mis_unidades_ids())'
mutante "voto: cualquier residente (mis_unidades_ids), no sólo el propietario" \
  'FROM public.mis_unidades_propietario_ids() x WHERE x = p_unidad_id' \
  'FROM public.mis_unidades_ids() x WHERE x = p_unidad_id'
mutante "voto: un punto de otro condominio de la misma empresa" \
  $'     AND a.project_id = u.project_id\n' \
  ''
mutante "voto: sin el candado de plan" \
  "  IF NOT public.company_has_feature(v_empresa, 'asambleas_digitales') THEN" \
  "  IF false THEN"
mutante "lectura: sin el candado de plan" \
  "    AND public.company_has_feature(a.company_id, 'asambleas_digitales')" \
  ''
mutante "voto: también fuera de en_curso" \
  "  IF v_estado <> 'en_curso' THEN" \
  "  IF v_estado = 'cancelada' THEN"
mutante "voto: también en puntos informativos" \
  "  IF v_tipo <> 'votacion' THEN" \
  "  IF false THEN"
mutante "voto: el vocabulario viejo" \
  "  IF p_voto IS NULL OR p_voto NOT IN ('a_favor', 'en_contra', 'abstencion') THEN" \
  "  IF p_voto IS NULL THEN"
mutante "voto: el re-voto pisa el anterior" \
  'ON CONFLICT (punto_id, unidad_id) DO NOTHING;' \
  'ON CONFLICT (punto_id, unidad_id) DO UPDATE SET voto = EXCLUDED.voto;'
mutante "lectura: el conteo parcial con la asamblea en curso" \
  "CASE WHEN a.estado = 'finalizada' AND p.tipo = 'votacion' THEN (" \
  "CASE WHEN p.tipo = 'votacion' THEN ("
mutante "lectura: el acta en borrador" \
  "CASE WHEN a.estado = 'finalizada' THEN a.acta END" \
  'a.acta'
mutante "lectura: mi_voto de cualquier unidad" \
  'WHERE v.punto_id = p.id AND v.unidad_id = p_unidad_id),' \
  'WHERE v.punto_id = p.id LIMIT 1),'
mutante "sin el CHECK del vocabulario" \
  "  ADD CONSTRAINT votos_asamblea_voto_check CHECK (voto IN ('a_favor', 'en_contra', 'abstencion'));" \
  "  ADD CONSTRAINT votos_asamblea_voto_check CHECK (voto IS NOT NULL);"
mutante "anon ejecuta el voto" \
  'REVOKE ALL ON FUNCTION public.portal_votar_punto(uuid, uuid, text) FROM PUBLIC, anon;' \
  'GRANT EXECUTE ON FUNCTION public.portal_votar_punto(uuid, uuid, text) TO anon;'
echo
echo "✅ portal_asambleas_voto: antes, el portal no veía puntos, mandaba una columna"
echo "   que no existe, el RLS no lo dejaba y el vocabulario se mezclaba; después,"
echo "   el propietario ve las asambleas de su condominio y vota una vez por unidad"
echo "   con la asamblea en curso, nadie más vota por ese camino, la guarda aborta"
echo "   de verdad y catorce mutantes rompen la suite."
