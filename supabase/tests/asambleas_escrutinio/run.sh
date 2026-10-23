#!/usr/bin/env bash
# ════════════════════════════════════════════════════════════════════════════
# Verificación EJECUTABLE de 20261106000200: padrón al abrir, asistencia con
# poderes, mayoría por punto y escrutinio que calcula la base al finalizar.
#
# POR QUÉ EXISTE
# Un escrutinio se equivoca en silencio: un voto fuera del padrón que suma,
# una alícuota que se lee mal, un «≥» que es «>», un quórum que no mira la
# asistencia. Nada de eso falla al aplicar la migración; sólo se ve con
# asambleas de verdad, contadas en sus bordes.
#
# QUÉ HACE
#   1 · cadena      bootstrap + TODAS las migraciones anteriores, en una base
#                   vacía (el esquema real, no uno copiado a mano)
#   2 · antes       sobre ese estado, un padrón REPRODUCE los huecos (finalizar
#                   no calcula nada, el quórum se escribe a mano, vota una
#                   unidad dada de baja, no hay padrón ni asistencia)
#   3 · migra       la migración DOS veces: la segunda no cambia la huella del
#                   auditor de drift, y cambian EXACTAMENTE los grupos
#                   esperados. Encima del padrón de antes: la asamblea en curso
#                   toma base y padrón, la finalizada queda como estaba
#   4 · invariantes fixture.sql + assert.sql
#   5 · guardas     un valor de base o un quórum fuera de rango hacen ABORTAR
#                   la migración nombrándolos, sin tocar ni una fila
#   6 · mutantes    copias de la migración (sin guarda), cada una con una regla
#                   rota: la suite DEBE fallar con cada una, por una invariante
#
# USO:  supabase/tests/asambleas_escrutinio/run.sh   (PGPORT_TEST=<puerto> para elegirlo)
# Requiere initdb/pg_ctl/psql. No toca ningún proyecto remoto: cluster temporal.
# ════════════════════════════════════════════════════════════════════════════
set -Eeuo pipefail
trap 'rc=$?; echo "❌ run.sh terminó con rc=$rc en la línea $LINENO: $BASH_COMMAND" >&2' ERR

AQUI="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RAIZ="$(cd "$AQUI/../../.." && pwd)"
MIGS="$RAIZ/supabase/migrations"
NUESTRA="$MIGS/20261106000200_asambleas_quorum_y_escrutinio.sql"
VERSION=20261106000200
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
DATA=$(mktemp -d /tmp/aedata.XXXX)
SOCK=$(mktemp -d /tmp/aesock.XXXX)
TRABAJO=$(mktemp -d /tmp/aetrab.XXXX)
chmod 777 "$TRABAJO"
PUERTO=${PGPORT_TEST:-55588}

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
BD=ae_base
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
copia "$BD" ae_antes
aplicar ae_antes "$AQUI/helpers.sql"
aplicar ae_antes "$AQUI/fixture_antes.sql"
suite ae_antes "$AQUI/antes.sql"

echo "── 3/6 · la migración, DOS veces, lo que cambia en la huella y las asambleas que ya existían"
copia "$BD" ae_post
huella ae_post > "$TRABAJO/h0"
aplicar ae_post "$NUESTRA"
huella ae_post > "$TRABAJO/h1"
aplicar ae_post "$NUESTRA"
huella ae_post > "$TRABAJO/h2"
cmp -s "$TRABAJO/h1" "$TRABAJO/h2" || { echo "❌ la segunda pasada cambió la huella"; diff "$TRABAJO/h1" "$TRABAJO/h2" | head; exit 1; }
echo "  OK    idempotente: la segunda pasada deja la misma huella"
CAMBIADOS=$( { diff <(cut -f1,2 "$TRABAJO/h0") <(cut -f1,2 "$TRABAJO/h1") || true; } | sed -n 's/^[<>] //p' | cut -f1 | LC_ALL=C sort -u | tr '\n' ' ')
ESPERADOS="funcion:asamblea_escrutinio(p_asamblea_id uuid) funcion:asamblea_escrutinio(p_asamblea_id uuid)/grants funcion:asambleas_calcular_escrutinio(p_asamblea_id uuid) funcion:asambleas_calcular_escrutinio(p_asamblea_id uuid)/grants funcion:asambleas_tg_asistencia() funcion:asambleas_tg_asistencia()/grants funcion:asambleas_tg_escrutinio() funcion:asambleas_tg_escrutinio()/grants funcion:asambleas_tg_padron() funcion:asambleas_tg_padron()/grants funcion:asambleas_tg_puntos_mayoria() funcion:asambleas_tg_puntos_mayoria()/grants funcion:asambleas_tg_votos_padron() funcion:asambleas_tg_votos_padron()/grants funcion:asambleas_tomar_padron(p_asamblea_id uuid) funcion:asambleas_tomar_padron(p_asamblea_id uuid)/grants tabla:asambleas/columnas tabla:asambleas/constraints tabla:asambleas/triggers tabla:asistencia_asamblea/columnas tabla:asistencia_asamblea/constraints tabla:asistencia_asamblea/grants tabla:asistencia_asamblea/indices tabla:asistencia_asamblea/policies tabla:asistencia_asamblea/rls tabla:asistencia_asamblea/triggers tabla:configuracion_condominio/constraints tabla:padron_asamblea/columnas tabla:padron_asamblea/constraints tabla:padron_asamblea/grants tabla:padron_asamblea/indices tabla:padron_asamblea/policies tabla:padron_asamblea/rls tabla:padron_asamblea/triggers tabla:puntos_asamblea/columnas tabla:puntos_asamblea/constraints tabla:puntos_asamblea/triggers tabla:votos_asamblea/triggers "
[ "$CAMBIADOS" = "$ESPERADOS" ] || { echo "❌ la migración cambió otros grupos de la huella:"; echo "   cambiados: $CAMBIADOS"; echo "   esperados: $ESPERADOS"; exit 1; }
echo "  OK    la huella cambia EXACTAMENTE en las dos tablas nuevas, las columnas, CHECK y triggers de asambleas y puntos_asamblea, los triggers de votos_asamblea, el CHECK de configuracion_condominio y las ocho funciones (ninguna policy ni grant de las tablas que ya existían)"
posteriores ae_post
aplicar ae_antes "$NUESTRA"
aplicar ae_antes "$NUESTRA"
suite ae_antes "$AQUI/backfill.sql"

echo "── 4/6 · invariantes"
copia ae_post ae_inv
aplicar ae_inv "$AQUI/helpers.sql"
aplicar ae_inv "$AQUI/fixture.sql"
suite ae_inv "$AQUI/assert.sql"

echo "── 5/6 · guardas: un dato fuera de rango aborta la migración sin tocar nada"
# Supabase aplica cada migración en una transacción: --single-transaction lo
# reproduce.
guarda() {        # guarda ETIQUETA SQL_QUE_ROMPE MENSAJE_ESPERADO
  copia "$BD" ae_guarda
  aplicar ae_guarda "$AQUI/helpers.sql"
  aplicar ae_guarda "$AQUI/fixture_antes.sql"
  psql -q -v ON_ERROR_STOP=1 -d ae_guarda -c "$2" >/dev/null
  local antes despues salida
  antes=$(psql -q -tA -d ae_guarda -c "SELECT md5(string_agg(to_jsonb(a)::text, '|' ORDER BY id)) FROM public.asambleas a")
  if salida=$(PGOPTIONS="-c client_min_messages=warning" psql -q --single-transaction -v ON_ERROR_STOP=1 -d ae_guarda -f "$NUESTRA" 2>&1); then
    echo "❌ [$1] la migración pasó en verde: el CHECK se habría saltado"; exit 1
  fi
  echo "$salida" | grep -qF "$3" \
    || { echo "❌ [$1] la migración falló, pero NO por su guarda:"; echo "$salida" | sed -n 's/.*ERROR:  /  /p'; exit 1; }
  despues=$(psql -q -tA -d ae_guarda -c "SELECT md5(string_agg(to_jsonb(a)::text, '|' ORDER BY id)) FROM public.asambleas a")
  [ "$antes" = "$despues" ] || { echo "❌ [$1] la migración abortada dejó filas cambiadas"; exit 1; }
  [ -z "$(psql -q -tA -d ae_guarda -c "SELECT to_regclass('public.padron_asamblea')")" ] \
    || { echo "❌ [$1] la migración abortada dejó el padrón creado"; exit 1; }
  echo "  OK    [$1] aborta: $(echo "$salida" | sed -n 's/.*ERROR:  //p' | head -1)"
}
guarda "base fuera del vocabulario" \
  "INSERT INTO public.configuracion_condominio (company_id, project_id, clave, valor, tipo) VALUES (ae.id('A'), ae.id('PU'), 'asambleas_base_votacion', 'por coeficiente', 'texto')" \
  "base de votación fuera del vocabulario ('por coeficiente')"
guarda "quórum fuera de 0–100" \
  "UPDATE public.asambleas SET quorum_requerido = 500 WHERE id = ae.id('X_CUR')" \
  "quórum fuera de 0–100 en En curso desde antes (requerido 500, alcanzado —)"

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
s = s[:s.index('-- ── 8 · Guarda de postcondición')]
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
  copia "$BD" ae_mut
  aplicar ae_mut "$TRABAJO/mut.sql"
  posteriores ae_mut
  aplicar ae_mut "$AQUI/helpers.sql"
  local salida
  # El padrón también puede caer con el mutante (se carga con los triggers
  # de verdad): cuenta como detectado sólo si cae por una invariante.
  if salida=$( { psql -q -v ON_ERROR_STOP=1 -d ae_mut -f "$AQUI/fixture.sql" && psql -q -v ON_ERROR_STOP=1 -d ae_mut -f "$AQUI/assert.sql"; } 2>&1); then
    echo "❌ el mutante «$1» pasó la suite: la regla no está probada"; exit 1
  fi
  # Sólo cuenta si cae una INVARIANTE (ae.chk): cualquier otro error sería un
  # falso verde del mutante.
  echo "$salida" | grep -q 'ERROR:  .* — esperado ' \
    || { echo "❌ el mutante «$1» rompió la suite por otra causa:"; echo "$salida" | grep -E 'ERROR' | head -3; exit 1; }
  echo "  OK    con [$1] la suite falla"
  echo "$salida" | sed -n 's/.*ERROR:  \(.*\) — esperado .*/          → \1/p' | head -1
}

# Padrón
mutante "la base del condominio no se lee al abrir" "@base_condominio" ""
mutante "por alícuota, todas valen 1" \
  "THEN coalesce(u.alicuota_pct, coalesce(u.area_m2, 0) / nullif(t.m2, 0) * 100, 0)" "THEN 1"
mutante "sin alícuota, la unidad no toma su parte de los m²" \
  "coalesce(u.alicuota_pct, coalesce(u.area_m2, 0) / nullif(t.m2, 0) * 100, 0)" "coalesce(u.alicuota_pct, 0)"
mutante "las unidades dadas de baja entran al padrón" \
  "WHERE u.project_id = v_proyecto AND u.company_id = v_empresa AND u.activo;" "WHERE u.project_id = v_proyecto AND u.company_id = v_empresa;"
mutante "por alícuota se abre aunque nadie pese" "@padron_sin_peso" ""
mutante "el padrón se escribe desde la API" \
  "REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.padron_asamblea FROM anon, authenticated;" \
  "CREATE POLICY padron_mutante ON public.padron_asamblea FOR ALL TO authenticated USING (true) WITH CHECK (true);"
# Lo calculado
mutante "base, quórum alcanzado y escrutinio se escriben a mano" "@calculado" ""
mutante "el quórum requerido cambia con la asamblea en curso" "@quorum_fijo" ""
mutante "al finalizar no se escribe el resultado de los puntos" "@resultado_puntos" ""
# Escrutinio
mutante "votos fuera del padrón cuentan" \
  $'SELECT v.punto_id, v.unidad_id, v.voto, pd.peso\n      FROM public.votos_asamblea v\n      JOIN public.puntos_asamblea p ON p.id = v.punto_id AND p.asamblea_id = p_asamblea_id\n      JOIN padron pd ON pd.unidad_id = v.unidad_id' \
  $'SELECT v.punto_id, v.unidad_id, v.voto, coalesce(pd.peso, 1) AS peso\n      FROM public.votos_asamblea v\n      JOIN public.puntos_asamblea p ON p.id = v.punto_id AND p.asamblea_id = p_asamblea_id\n      LEFT JOIN padron pd ON pd.unidad_id = v.unidad_id'
mutante "la asistencia no cuenta para el quórum" \
  $'WHERE EXISTS (SELECT 1 FROM public.asistencia_asamblea s\n                    WHERE s.asamblea_id = p_asamblea_id AND s.unidad_id = pd.unidad_id)\n        OR EXISTS' \
  'WHERE EXISTS'
mutante "votar no cuenta como presente" \
  $'\n        OR EXISTS (SELECT 1 FROM votos v WHERE v.unidad_id = pd.unidad_id)' ''
mutante "el quórum exige superar el requerido (> en vez de ≥)" \
  "t.p_presentes * 100 >= t.quorum_requerido * t.p_padron" "t.p_presentes * 100 > t.quorum_requerido * t.p_padron"
mutante "sin quórum se decide igual" "WHEN NOT q.hay_quorum " "WHEN false "
mutante "simple: el empate aprueba" "pts.p_favor > pts.p_contra" "pts.p_favor >= pts.p_contra"
mutante "absoluta: se decide como simple" "pts.p_favor * 2 > q.p_presentes" "pts.p_favor > pts.p_contra"
mutante "calificada: sobre lo presente y no sobre el padrón" \
  "pts.mayoria_pct * q.p_padron" "pts.mayoria_pct * q.p_presentes"
mutante "calificada: exige superar el porcentaje (> en vez de ≥)" \
  "pts.p_favor * 100 >= pts.mayoria_pct" "pts.p_favor * 100 > pts.mayoria_pct"
mutante "el escrutinio pesa por cabeza" \
  "coalesce(sum(v.peso) FILTER (WHERE v.voto = 'a_favor'), 0)" "count(v.unidad_id) FILTER (WHERE v.voto = 'a_favor')"
# Votos, puntos, asistencia
mutante "vota una unidad fuera del padrón" "@voto_padron" ""
mutante "con votos, la mayoría del punto cambia" "@mayoria_fija" ""
mutante "asistencia: se cambia o quita con la asamblea cerrada" "@asistencia_vieja" ""
mutante "asistencia: se registra con la asamblea cerrada o sin abrir" "@asistencia_nueva" ""
mutante "asistencia: una unidad fuera del padrón" "@asistencia_padron" ""
mutante "asistencia: el poder en el espacio de otro condominio" "@poder_del_condominio" ""
mutante "asistencia: no cae con su unidad" "@cascada_asistencia" ""
mutante "asistencia: borrar el usuario que la registró falla" "@usuario_borrado_asistencia" ""
mutante "asistencia: la registra quien sólo ve" \
  "( SELECT public.condominios_puede_actuar('asambleas', 'edit') )" "true"
mutante "asistencia sin candado de plan" \
  "AS RESTRICTIVE FOR INSERT TO authenticated
  WITH CHECK (public.company_has_feature((SELECT a.company_id FROM public.asambleas a WHERE a.id = asistencia_asamblea.asamblea_id), 'asambleas_digitales'));" \
  "AS RESTRICTIVE FOR INSERT TO authenticated WITH CHECK (true);"
# Panel
mutante "el panel lee el escrutinio de cualquier empresa" \
  "OR (a.company_id = public.get_my_company_id() AND public.user_has_permission('condominios.tab.asambleas'))" "OR true"
echo
echo "✅ asambleas_escrutinio: el padrón reproduce los huecos de antes; después,"
echo "   cada asamblea toma al abrir la base de su condominio y su padrón (por"
echo "   unidad o por alícuota, con los m² de respaldo), la asistencia y los"
echo "   poderes van sólo con la asamblea en curso y para el padrón, vota sólo el"
echo "   padrón, y al finalizar la base escribe quórum, escrutinio y resultado"
echo "   según la mayoría de cada punto; las guardas abortan de verdad y treinta"
echo "   mutantes rompen la suite."
