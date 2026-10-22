#!/usr/bin/env bash
# ════════════════════════════════════════════════════════════════════════════
# Verificación EJECUTABLE de 20261104000060: el residente ve las asambleas de
# su condominio y el PROPIETARIO vota desde el portal, una vez por unidad.
#
# POR QUÉ EXISTE
# El voto del portal pasa por cinco puertas que no se ven leyendo el SQL: el
# SELECT de asambleas y de puntos (que además usa el candado de plan para
# resolver la empresa con la RLS de quien inserta), el INSERT de votos con la
# rama del propietario, el UNIQUE (punto, unidad) y la ausencia de rama en
# UPDATE/DELETE (append-only). Si una pide de menos, vota un inquilino, se vota
# dos veces o en una asamblea cerrada; si pide de más, el voto se rechaza y el
# portal sólo muestra un error. Hay que leer y escribir como cada persona.
#
# QUÉ HACE
#   1 · cadena     bootstrap + TODAS las migraciones anteriores, en una base
#                  vacía (el esquema real, no uno copiado a mano)
#   2 · antes      sobre ese estado, el padrón REPRODUCE el fallo (el residente
#                  no ve nada y su voto se rechaza; 'favor' entra sin CHECK)
#   3 · migra      la migración DOS veces: la segunda no cambia la huella del
#                  auditor de drift, y cambian EXACTAMENTE los grupos esperados.
#                  Después se aplican las migraciones POSTERIORES: si una
#                  reescribe estas policies sin la rama del residente, las
#                  invariantes caen.
#   4 · invariantes fixture.sql + assert.sql (quién ve qué, quién vota dónde,
#                  append-only, el candado de plan, el staff intacto, el CHECK
#                  y los totales del portal)
#   5 · guardas    con una policy de más, o un voto fuera del catálogo, la
#                  migración ABORTA; los alias del portal viejo se normalizan
#   6 · mutantes   copias de la migración (sin guarda), cada una con una regla
#                  rota y sin las posteriores: la suite DEBE fallar con cada una
#
# USO:  supabase/tests/voto_residente_asambleas/run.sh   (PGPORT_TEST=<puerto> para elegirlo)
# Requiere initdb/pg_ctl/psql. No toca ningún proyecto remoto: cluster temporal.
# ════════════════════════════════════════════════════════════════════════════
set -Eeuo pipefail
trap 'rc=$?; echo "❌ run.sh terminó con rc=$rc en la línea $LINENO: $BASH_COMMAND" >&2' ERR

AQUI="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RAIZ="$(cd "$AQUI/../../.." && pwd)"
MIGS="$RAIZ/supabase/migrations"
NUESTRA="$MIGS/20261104000060_asambleas_voto_residente.sql"
VERSION=20261104000060
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
DATA=$(mktemp -d /tmp/vrdata.XXXX)
SOCK=$(mktemp -d /tmp/vrsock.XXXX)
TRABAJO=$(mktemp -d /tmp/vrtrab.XXXX)
chmod 777 "$TRABAJO"
PUERTO=${PGPORT_TEST:-55576}

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
BD=vr_base
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
copia "$BD" vr_antes
aplicar vr_antes "$AQUI/fixture.sql"
suite vr_antes "$AQUI/antes.sql"

echo "── 3/6 · la migración, DOS veces, y lo que cambia en la huella"
copia "$BD" vr_post
huella vr_post > "$TRABAJO/h0"
aplicar vr_post "$NUESTRA"
huella vr_post > "$TRABAJO/h1"
aplicar vr_post "$NUESTRA"
huella vr_post > "$TRABAJO/h2"
cmp -s "$TRABAJO/h1" "$TRABAJO/h2" || { echo "❌ la segunda pasada cambió la huella"; diff "$TRABAJO/h1" "$TRABAJO/h2" | head; exit 1; }
echo "  OK    idempotente: la segunda pasada deja la misma huella"
CAMBIADOS=$( { diff <(cut -f1,2 "$TRABAJO/h0") <(cut -f1,2 "$TRABAJO/h1") || true; } | sed -n 's/^[<>] //p' | cut -f1 | LC_ALL=C sort -u | tr '\n' ' ')
ESPERADOS="funcion:portal_conteo_votos_asambleas(p_asamblea_ids uuid[]) funcion:portal_conteo_votos_asambleas(p_asamblea_ids uuid[])/grants funcion:residente_puede_votar(p_punto_id uuid, p_unidad_id uuid) funcion:residente_puede_votar(p_punto_id uuid, p_unidad_id uuid)/grants tabla:asambleas/policies tabla:puntos_asamblea/policies tabla:votos_asamblea/constraints tabla:votos_asamblea/policies "
[ "$CAMBIADOS" = "$ESPERADOS" ] || { echo "❌ la migración cambió otros grupos de la huella:"; echo "   cambiados: $CAMBIADOS"; echo "   esperados: $ESPERADOS"; exit 1; }
echo "  OK    la huella cambia EXACTAMENTE en las dos funciones nuevas (y sus grants), las policies de las tres tablas y el CHECK de votos"
posteriores vr_post

echo "── 4/6 · invariantes"
copia vr_post vr_inv
aplicar vr_inv "$AQUI/fixture.sql"
suite vr_inv "$AQUI/assert.sql"

echo "── 5/6 · guardas: con una policy de más o un voto fuera del catálogo, la migración aborta"
guarda() {   # $1 = sentencia previa · $2 = motivo esperado en el error
  copia "$BD" vr_guarda
  aplicar vr_guarda "$AQUI/fixture.sql"
  psql -q -v ON_ERROR_STOP=1 -d vr_guarda -c "$1" >/dev/null
  local salida
  if salida=$(PGOPTIONS="-c client_min_messages=warning" psql -q -v ON_ERROR_STOP=1 -d vr_guarda -f "$NUESTRA" 2>&1); then
    echo "❌ la migración pasó en verde con [$1]: la guarda es decorativa"; exit 1
  fi
  echo "$salida" | grep -q "$2" \
    || { echo "❌ la migración falló, pero NO por la guarda esperada:"; echo "$salida" | sed -n 's/.*ERROR:  /  /p'; exit 1; }
  echo "  OK    aborta: $(echo "$salida" | sed -n 's/.*ERROR:  //p' | head -1)"
}
guarda "CREATE POLICY voto_heredado ON public.votos_asamblea FOR INSERT TO authenticated WITH CHECK (true)" \
  'votos_asamblea tiene 2 policies permisivas de INSERT'
guarda "CREATE POLICY lectura_heredada ON public.asambleas FOR SELECT TO authenticated USING (true)" \
  'asambleas tiene 2 policies permisivas de SELECT'
guarda "CREATE POLICY correccion_residente ON public.votos_asamblea FOR UPDATE TO authenticated USING (unidad_id IN (SELECT public.mis_unidades_ids()))" \
  'correccion_residente deja al residente cambiar o borrar votos'
guarda "INSERT INTO public.votos_asamblea (punto_id, unidad_id, voto) VALUES (vr.id('PUN_PV'), vr.id('U2'), 'si')" \
  "valores de voto fuera del catálogo: 'si'"
# Los alias del portal viejo no abortan: se normalizan a los del panel.
copia "$BD" vr_alias
aplicar vr_alias "$AQUI/fixture.sql"
psql -q -v ON_ERROR_STOP=1 -d vr_alias >/dev/null <<'SQL'
INSERT INTO public.votos_asamblea (punto_id, unidad_id, voto) VALUES
  (vr.id('PUN_PV'), vr.id('U2'), 'favor'), (vr.id('PUN_PV'), vr.id('U4'), 'contra');
SQL
aplicar vr_alias "$NUESTRA"
ALIAS=$(psql -q -tA -d vr_alias -c "SELECT string_agg(voto, ',' ORDER BY voto) FROM public.votos_asamblea WHERE punto_id = vr.id('PUN_PV')")
[ "$ALIAS" = "a_favor,en_contra" ] || { echo "❌ los alias del portal viejo no se normalizaron: $ALIAS"; exit 1; }
echo "  OK    'favor' y 'contra' del portal viejo pasan a 'a_favor' y 'en_contra'"

echo "── 6/6 · mutantes: con cada regla rota, la suite debe fallar"
# A la copia se le quita la guarda de postcondición: lo que se prueba aquí es
# que la SUITE detecta la regla rota, no que la guarda lo haga por ella. El
# texto se reemplaza en TODAS sus apariciones; que aparezca al menos una vez es
# obligatorio.
# Los mutantes NO aplican las migraciones posteriores (las invariantes sí): una
# posterior que reescriba estas policies (la sección «comunidad» de
# rls-acciones) taparía el mutante, y una con guarda que cuente policies
# abortaría por el mutante en vez de dejar que caiga la suite.
mutante() {   # $1 = etiqueta · $2 = texto que se quita · $3 = reemplazo
  python3 - "$NUESTRA" "$TRABAJO/mut.sql" "$2" "$3" <<'PY' || { echo "❌ el mutante «$1» no encuentra su texto en la migración"; exit 1; }
import sys
src, dst, pat, rep = sys.argv[1:5]
s = open(src, encoding='utf-8').read()
s = s[:s.index('-- ── 6 · Guarda de postcondición')]
if s.count(pat) == 0:
    sys.exit(1)
open(dst, 'w', encoding='utf-8').write(s.replace(pat, rep))
PY
  chmod 644 "$TRABAJO/mut.sql"
  copia "$BD" vr_mut
  aplicar vr_mut "$TRABAJO/mut.sql"
  aplicar vr_mut "$AQUI/fixture.sql"
  local salida
  if salida=$(psql -q -v ON_ERROR_STOP=1 -d vr_mut -f "$AQUI/assert.sql" 2>&1); then
    echo "❌ el mutante «$1» pasó la suite: la regla no está probada"; exit 1
  fi
  # Sólo cuenta si cae una INVARIANTE (vr.chk): cualquier otro error sería un
  # falso verde del mutante.
  echo "$salida" | grep -q 'ERROR:  .* — esperado ' \
    || { echo "❌ el mutante «$1» rompió la suite por otra causa:"; echo "$salida" | grep -E 'ERROR' | head -3; exit 1; }
  echo "  OK    con [$1] la suite falla"
  echo "$salida" | sed -n 's/.*ERROR:  \(.*\) — esperado .*/          → \1/p' | head -1
}

mutante "INSERT: sin la rama del propietario" \
  $'\n    OR (registrado_por = (SELECT auth.uid())\n        AND public.residente_puede_votar(votos_asamblea.punto_id, votos_asamblea.unidad_id))' \
  ''
mutante "INSERT: el voto no se firma" \
  $'OR (registrado_por = (SELECT auth.uid())\n        AND public.residente_puede_votar' \
  $'OR (true\n        AND public.residente_puede_votar'
mutante "vota cualquier residente de la unidad, no sólo el propietario" \
  'AND p_unidad_id IN (SELECT public.mis_unidades_propietario_ids())' \
  'AND p_unidad_id IN (SELECT public.mis_unidades_ids())'
mutante "también en puntos informativos" \
  $'      AND p.tipo = \'votacion\'\n      AND a.estado = \'en_curso\'\n' \
  $'      AND a.estado = \'en_curso\'\n'
mutante "también en asambleas que no están en curso" \
  $'      AND a.estado = \'en_curso\'\n' \
  ''
mutante "con una unidad de otro condominio" \
  $'      AND u.project_id = a.project_id\n' \
  ''
mutante "SELECT de asambleas: sin la rama del residente" \
  $'\n    OR (project_id IN (SELECT public.mis_proyectos_ids()))' \
  ''
mutante "SELECT de asambleas: toda la empresa del residente" \
  'OR (project_id IN (SELECT public.mis_proyectos_ids()))' \
  'OR (company_id = get_my_company_id())'
mutante "SELECT de puntos: sin la rama del residente" \
  $'\n    OR EXISTS (\n      SELECT 1 FROM public.asambleas ar\n      WHERE ar.id = puntos_asamblea.asamblea_id\n        AND ar.project_id IN (SELECT public.mis_proyectos_ids())\n    )' \
  ''
mutante "SELECT de votos: todos los de los puntos que ve" \
  'OR (unidad_id IN (SELECT public.mis_unidades_ids()))' \
  'OR (punto_id IN (SELECT pv.id FROM public.puntos_asamblea pv))'
mutante "el residente corrige su voto (UPDATE)" \
  '-- ── 5 · Resultados para el portal' \
  $'CREATE POLICY votos_residente_update ON public.votos_asamblea FOR UPDATE TO authenticated\n  USING (unidad_id IN (SELECT public.mis_unidades_ids())) WITH CHECK (unidad_id IN (SELECT public.mis_unidades_ids()));\n-- ── 5 · Resultados para el portal'
mutante "el residente borra su voto (DELETE)" \
  '-- ── 5 · Resultados para el portal' \
  $'CREATE POLICY votos_residente_delete ON public.votos_asamblea FOR DELETE TO authenticated\n  USING (unidad_id IN (SELECT public.mis_unidades_ids()));\n-- ── 5 · Resultados para el portal'
mutante "sin CHECK de valores de voto" \
  "  CHECK (voto IN ('a_favor', 'en_contra', 'abstencion'));" \
  '  CHECK (voto IS NOT NULL);'
mutante "totales de asambleas sin finalizar" \
  $'    AND a.estado = \'finalizada\'\n' \
  ''
mutante "totales de cualquier condominio" \
  $'    AND a.project_id IN (SELECT public.mis_proyectos_ids())\n  GROUP BY' \
  '  GROUP BY'
mutante "totales también de puntos informativos" \
  $'    AND p.tipo = \'votacion\'\n    AND a.project_id' \
  '    AND a.project_id'
echo
echo "✅ voto_residente_asambleas: antes, el residente no veía asambleas ni votaba;"
echo "   después, ve las de su condominio y sólo el voto de sus unidades, vota el"
echo "   propietario (firmado, una vez, en puntos de votación de una asamblea en"
echo "   curso de su condominio, sin cambiarlo ni borrarlo), el candado de plan y"
echo "   el staff siguen igual, el CHECK cierra los valores, los totales llegan sin"
echo "   el voto de cada unidad, las guardas abortan de verdad y dieciséis mutantes"
echo "   rompen la suite."
