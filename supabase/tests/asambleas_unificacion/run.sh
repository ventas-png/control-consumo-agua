#!/usr/bin/env bash
# ════════════════════════════════════════════════════════════════════════════
# Verificación EJECUTABLE de 20261106000300: la asamblea digital se funde en
# asambleas, el acta formal se liga a su asamblea y se levanta desde ella, y
# las votaciones pasan a ser consultas con reglas.
#
# POR QUÉ EXISTE
# Una fusión que pierde filas no falla: la tabla se borra igual. Una hora
# guardada en UTC se ve un día antes. Un acta levantada con los permisos de
# quien la pide sale sin los que votaron. Y una consulta sin reglas acepta el
# voto de otra empresa. Nada de eso se ve aplicando la migración.
#
# QUÉ HACE
#   1 · cadena      bootstrap + TODAS las migraciones anteriores, en una base
#                   vacía (el esquema real, no uno copiado a mano)
#   2 · antes       sobre ese estado, un padrón REPRODUCE los huecos (dos
#                   tablas de asambleas, acta sin asamblea, votos de una opción
#                   que no existe, de otra empresa o con la votación cerrada)
#   3 · migra       la migración DOS veces: la segunda no cambia la huella del
#                   auditor de drift, y cambian EXACTAMENTE los grupos
#                   esperados. Encima del padrón de antes: la fusión
#   4 · invariantes fixture.sql + assert.sql
#   5 · guardas     un dato fuera de regla hace ABORTAR la migración
#                   nombrándolo, sin tocar ni una fila ni borrar la tabla
#   6 · mutantes    copias de la migración (sin guarda), cada una con una regla
#                   rota: la suite (o la de la fusión) DEBE fallar con cada
#                   una, por una invariante
#
# USO:  supabase/tests/asambleas_unificacion/run.sh   (PGPORT_TEST=<puerto> para elegirlo)
# Requiere initdb/pg_ctl/psql. No toca ningún proyecto remoto: cluster temporal.
# ════════════════════════════════════════════════════════════════════════════
set -Eeuo pipefail
trap 'rc=$?; echo "❌ run.sh terminó con rc=$rc en la línea $LINENO: $BASH_COMMAND" >&2' ERR

AQUI="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RAIZ="$(cd "$AQUI/../../.." && pwd)"
MIGS="$RAIZ/supabase/migrations"
NUESTRA="$MIGS/20261106000300_asambleas_unificacion.sql"
VERSION=20261106000300
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
DATA=$(mktemp -d /tmp/audata.XXXX)
SOCK=$(mktemp -d /tmp/ausock.XXXX)
TRABAJO=$(mktemp -d /tmp/autrab.XXXX)
chmod 777 "$TRABAJO"
PUERTO=${PGPORT_TEST:-55589}

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
BD=au_base
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
copia "$BD" au_antes
aplicar au_antes "$AQUI/helpers.sql"
aplicar au_antes "$AQUI/fixture_antes.sql"
suite au_antes "$AQUI/antes.sql"

echo "── 3/6 · la migración, DOS veces, lo que cambia en la huella y la fusión"
copia "$BD" au_post
huella au_post > "$TRABAJO/h0"
aplicar au_post "$NUESTRA"
huella au_post > "$TRABAJO/h1"
aplicar au_post "$NUESTRA"
huella au_post > "$TRABAJO/h2"
cmp -s "$TRABAJO/h1" "$TRABAJO/h2" || { echo "❌ la segunda pasada cambió la huella"; diff "$TRABAJO/h1" "$TRABAJO/h2" | head; exit 1; }
echo "  OK    idempotente: la segunda pasada deja la misma huella"
CAMBIADOS=$( { diff <(cut -f1,2 "$TRABAJO/h0") <(cut -f1,2 "$TRABAJO/h1") || true; } | sed -n 's/^[<>] //p' | cut -f1 | LC_ALL=C sort -u | tr '\n' ' ')
ESPERADOS="funcion:asamblea_generar_acta(p_asamblea_id uuid) funcion:asamblea_generar_acta(p_asamblea_id uuid)/grants funcion:asambleas_tg_acta_asamblea() funcion:asambleas_tg_acta_asamblea()/grants funcion:votaciones_opciones_validas(p_opciones jsonb) funcion:votaciones_opciones_validas(p_opciones jsonb)/grants funcion:votaciones_tg_integridad() funcion:votaciones_tg_integridad()/grants funcion:votaciones_tg_votos() funcion:votaciones_tg_votos()/grants tabla:actas_reunion/columnas tabla:actas_reunion/constraints tabla:actas_reunion/indices tabla:actas_reunion/triggers tabla:asambleas/columnas tabla:asambleas/constraints tabla:asambleas_digital/columnas tabla:asambleas_digital/constraints tabla:asambleas_digital/grants tabla:asambleas_digital/indices tabla:asambleas_digital/policies tabla:asambleas_digital/rls tabla:asambleas_digital/triggers tabla:votaciones/columnas tabla:votaciones/constraints tabla:votaciones/indices tabla:votaciones/triggers tabla:votos/triggers "
[ "$CAMBIADOS" = "$ESPERADOS" ] || { echo "❌ la migración cambió otros grupos de la huella:"; echo "   cambiados: $CAMBIADOS"; echo "   esperados: $ESPERADOS"; exit 1; }
echo "  OK    la huella cambia EXACTAMENTE en asambleas (columnas y CHECK), asambleas_digital (se va), actas_reunion (columna, UNIQUE y trigger), votaciones y votos (columnas, CHECK y triggers) y las funciones nuevas"
posteriores au_post
aplicar au_antes "$NUESTRA"
aplicar au_antes "$NUESTRA"
suite au_antes "$AQUI/backfill.sql"

echo "── 4/6 · invariantes"
copia au_post au_inv
aplicar au_inv "$AQUI/helpers.sql"
aplicar au_inv "$AQUI/fixture.sql"
suite au_inv "$AQUI/assert.sql"

echo "── 5/6 · guardas: un dato fuera de regla aborta la migración sin tocar nada"
# Supabase aplica cada migración en una transacción: --single-transaction lo
# reproduce.
FILAS="SELECT md5((SELECT string_agg(to_jsonb(a)::text, '|' ORDER BY id) FROM public.asambleas a) || (SELECT string_agg(to_jsonb(v)::text, '|' ORDER BY id) FROM public.votaciones v))"
guarda() {        # guarda ETIQUETA SQL_QUE_ROMPE MENSAJE_ESPERADO
  copia "$BD" au_guarda
  aplicar au_guarda "$AQUI/helpers.sql"
  aplicar au_guarda "$AQUI/fixture_antes.sql"
  psql -q -v ON_ERROR_STOP=1 -d au_guarda -c "$2" >/dev/null
  local antes despues salida
  antes=$(psql -q -tA -d au_guarda -c "$FILAS")
  if salida=$(PGOPTIONS="-c client_min_messages=warning" psql -q --single-transaction -v ON_ERROR_STOP=1 -d au_guarda -f "$NUESTRA" 2>&1); then
    echo "❌ [$1] la migración pasó en verde: la regla se habría saltado"; exit 1
  fi
  echo "$salida" | grep -qF "$3" \
    || { echo "❌ [$1] la migración falló, pero NO por su guarda:"; echo "$salida" | sed -n 's/.*ERROR:  /  /p'; exit 1; }
  despues=$(psql -q -tA -d au_guarda -c "$FILAS")
  [ "$antes" = "$despues" ] || { echo "❌ [$1] la migración abortada dejó filas cambiadas"; exit 1; }
  [ -n "$(psql -q -tA -d au_guarda -c "SELECT to_regclass('public.asambleas_digital')")" ] \
    || { echo "❌ [$1] la migración abortada borró asambleas_digital"; exit 1; }
  echo "  OK    [$1] aborta: $(echo "$salida" | sed -n 's/.*ERROR:  //p' | head -1)"
}
guarda "asamblea digital con quórum fuera de 0–100" \
  "UPDATE public.asambleas_digital SET quorum_requerido = 150 WHERE id = au.id('D_PROG')" \
  "asambleas digitales con quórum fuera de 0–100 (Digital programada (quórum 150))"
guarda "votación con una sola opción" \
  "UPDATE public.votaciones SET opciones = '[{\"id\": \"1\", \"texto\": \"Sí\"}]' WHERE id = au.id('V_CERRADA')" \
  "datos fuera de regla (1 votación(es) con opciones inválidas)"
guarda "voto de una opción que no existe" \
  "INSERT INTO public.votos (company_id, votacion_id, unidad_id, opcion_id) VALUES (au.id('A'), au.id('V_ABIERTA'), au.id('P2'), '9')" \
  "datos fuera de regla (1 voto(s) con una opción que no existe o de otra unidad o empresa)"
guarda "voto de una unidad de otra empresa" \
  "INSERT INTO public.votos (company_id, votacion_id, unidad_id, opcion_id) VALUES (au.id('A'), au.id('V_ABIERTA'), au.id('UB'), '1')" \
  "datos fuera de regla (1 voto(s) con una opción que no existe o de otra unidad o empresa)"

echo "── 6/6 · mutantes: con cada regla rota, la suite debe fallar"
# A la copia se le quita la guarda de postcondición: lo que se prueba aquí es
# que la SUITE detecta la regla rota, no que la guarda lo haga por ella.
#   mutar TEXTO REEMPLAZO          reemplaza TODAS las apariciones (al menos una)
#   mutar @paso ''                 vacía el bloque -- [paso:paso] … -- [/paso:paso]
mutar() {
  python3 - "$NUESTRA" "$TRABAJO/mut.sql" "$1" "$2" <<'PY'
import re, sys
src, dst, pat, rep = sys.argv[1:5]
s = open(src, encoding='utf-8').read()
s = s[:s.index('-- ── 6 · Guarda de postcondición')]
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
}
# Sólo cuenta si cae una INVARIANTE (au.chk): cualquier otro error sería un
# falso verde del mutante.
detectado() {     # detectado ETIQUETA SALIDA
  echo "$2" | grep -q 'ERROR:  .* — esperado ' \
    || { echo "❌ el mutante «$1» rompió la suite por otra causa:"; echo "$2" | grep -E 'ERROR' | head -3; exit 1; }
  echo "  OK    con [$1] la suite falla"
  echo "$2" | sed -n 's/.*ERROR:  \(.*\) — esperado .*/          → \1/p' | head -1
}
mutante() {       # mutante ETIQUETA TEXTO REEMPLAZO   (fixture.sql + assert.sql)
  mutar "$2" "$3" || { echo "❌ el mutante «$1» no encuentra su texto en la migración"; exit 1; }
  copia "$BD" au_mut
  aplicar au_mut "$TRABAJO/mut.sql"
  posteriores au_mut
  aplicar au_mut "$AQUI/helpers.sql"
  local salida
  if salida=$( { psql -q -v ON_ERROR_STOP=1 -d au_mut -f "$AQUI/fixture.sql" && psql -q -v ON_ERROR_STOP=1 -d au_mut -f "$AQUI/assert.sql"; } 2>&1); then
    echo "❌ el mutante «$1» pasó la suite: la regla no está probada"; exit 1
  fi
  detectado "$1" "$salida"
}
mutante_fusion() { # mutante_fusion ETIQUETA TEXTO REEMPLAZO   (fixture_antes.sql + backfill.sql)
  mutar "$2" "$3" || { echo "❌ el mutante «$1» no encuentra su texto en la migración"; exit 1; }
  copia "$BD" au_mut
  aplicar au_mut "$AQUI/helpers.sql"
  aplicar au_mut "$AQUI/fixture_antes.sql"
  aplicar au_mut "$TRABAJO/mut.sql"
  local salida
  if salida=$(psql -q -v ON_ERROR_STOP=1 -d au_mut -f "$AQUI/backfill.sql" 2>&1); then
    echo "❌ el mutante «$1» pasó la suite de la fusión: la regla no está probada"; exit 1
  fi
  detectado "$1" "$salida"
}

# Fusión
mutante_fusion "la tabla se borra sin fusionar sus filas" "@fusion" ""
mutante_fusion "la hora queda en UTC" "WHERE tz.name = c.timezone)" "WHERE tz.name = 'UTC')"
mutante_fusion "un link de dominio no recibe https://" \
  "WHEN d.link ~* '^(www\.)?[a-z0-9-]+(\.[a-z0-9-]+)+(/[^[:space:]]*)?\$' THEN 'https://' || d.link" ""
mutante_fusion "un link que no es una dirección se pierde" \
  "THEN 'Enlace de reunión registrado (no es una dirección web): ' || n.link END" "THEN NULL END"
mutante_fusion "el acta digital se pierde" "n.quorum_requerido, nullif(btrim(n.acta_url), '')," "n.quorum_requerido, NULL,"
# Asamblea
mutante "modalidad libre" "CHECK (modalidad IN ('presencial', 'virtual', 'hibrida'))" "CHECK (true)"
mutante "link sin regla" "CHECK (link_reunion ~* '^https?://[^[:space:]]+\$')" "CHECK (true)"
# Acta
mutante "acta ligada a otro condominio" "@acta_condominio" ""
mutante "acta ligada a una asamblea abierta" "@acta_finalizada" ""
mutante "dos actas por asamblea" \
  "ALTER TABLE public.actas_reunion ADD CONSTRAINT actas_reunion_asamblea_key UNIQUE (asamblea_id);" "-- (mutante: sin UNIQUE)"
mutante "borrar la asamblea borra su acta" \
  "REFERENCES public.asambleas(id) ON DELETE SET NULL;" "REFERENCES public.asambleas(id) ON DELETE CASCADE;"
mutante "levantar el acta sin ver la asamblea" \
  $'\n     AND (public.is_super_admin()\n          OR (a.company_id = public.get_my_company_id() AND public.user_has_permission(\'condominios.tab.asambleas\')));' ";"
mutante "levantar el acta sin poder crear actas" "@acta_permiso" ""
mutante "el acta con los permisos de quien la pide" \
  "RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER" "RETURNS uuid LANGUAGE plpgsql SECURITY INVOKER"
mutante "el acta cuenta a los ausentes" "@acta_presentes" ""
mutante "los acuerdos incluyen los rechazados" "   WHERE e ->> 'decision' = 'aprobado';" "   ;"
# Votaciones
mutante "una votación nace cerrada o con resultado" "@nace_abierta" ""
mutante "una votación cerrada se reabre o se edita" "@votacion_cerrada" ""
mutante "el resultado se escribe a mano" "@votacion_calculado" ""
mutante "con votos, las opciones cambian" "@opciones_fijas" ""
mutante "sin mínimo de votos" "@quorum_consulta" ""
mutante "el empate tiene ganador" "WHEN v_ganan > 1 THEN 'Empate'" "WHEN false THEN 'Empate'"
mutante "opciones libres" "CHECK (public.votaciones_opciones_validas(opciones))" "CHECK (true)"
# Votos
mutante "voto: no cae con su unidad" "@cascada_voto_consulta" ""
mutante "voto: se borra con la votación cerrada" "@voto_consulta_viejo" ""
mutante "voto: se registra con la votación cerrada" "@voto_consulta_nuevo" ""
mutante "voto: una opción que no existe" "@voto_opcion" ""
mutante "voto: de otro condominio o empresa" "@voto_condominio" ""
echo
echo "✅ asambleas_unificacion: el padrón reproduce los huecos de antes; después,"
echo "   las asambleas digitales están en asambleas (hora de su huso, acta, link"
echo "   útil o conservado), el acta formal se liga a UNA asamblea finalizada de"
echo "   su condominio y se levanta desde ella con quien asistió o votó y lo que"
echo "   se decidió, la votación es una consulta con reglas y resultado de la"
echo "   base, las guardas abortan de verdad y veintiocho mutantes rompen la suite."
