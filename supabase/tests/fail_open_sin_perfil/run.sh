#!/usr/bin/env bash
# ============================================================================
# SESIÓN SIN PERFIL · FAIL-CLOSED — 20261029000000_sesion_sin_perfil_fail_closed.sql
# Arnés contra un PostgreSQL REAL (local, efímero). NO toca ningún entorno remoto.
#
# Aplica la cadena ENTERA de migraciones anteriores sobre una base vacía, monta el
# padrón (fixture.sql: dos empresas, D en su tope, una persona de cada perfil, un
# cliente, una sesión `authenticated` sin app_users, anon, service_role y el
# sistema) y corre la MATRIZ (matriz.sql): cada función SECURITY DEFINER de public
# ejecutable por `authenticated` —la lista sale de pg_proc, ~205— × 12 sesiones,
# con argumentos de la empresa D y un objeto real de cada tipo.
#
#   1. CONTROL NEGATIVO, sin la migración: las 39 fugas de assert_cierre.sql están
#      TODAS abiertas (31 funciones; la sesión sin perfil o el cliente reciben algo
#      distinto y más que un operador de OTRA empresa), el tope de plan responde
#      con el límite y el conteo de otra empresa (assert_tope.sql: 11 intentos de
#      SINAPP, CLI y ANON) y la matriz encuentra sesiones sin perfil que pasan
#      guardas que al forastero le cierran;
#   2. la migración dos veces (idempotente: la segunda es un no-op con la misma
#      huella) y la huella del auditor de drift cambia EXACTAMENTE en los grupos
#      esperados (ni un grant existente, ni una política, ni una tabla);
#   3. CON la migración: cada fuga cerrada con la MISMA respuesta que el forastero;
#      la matriz antes/después IDÉNTICA, función por función, para propietario,
#      administrador, operador y visor de D, superadministrador, propietario y
#      operador de C, service_role y el sistema; el tope no es un oráculo; los
#      helpers dan false a anon y NULL (como antes) a servicio y sistema;
#   4. el sistema en una sesión NUEVA (sin el GUC del JWT definido, como pg_cron):
#      insertar proyectos responde igual antes y después;
#   5. guardas de la migración: un cuerpo inesperado o un rol que no es el
#      propietario la abortan sin dejar nada;
#   6. MUTACIONES: cada pieza revertida (o la variante ingenua) pone algo en ROJO.
#
# Uso:  bash supabase/tests/fail_open_sin_perfil/run.sh   (PGPORT_TEST=<puerto> para elegir el puerto)
# ============================================================================
set -Eeuo pipefail
trap 'rc=$?; echo "❌ run.sh terminó con rc=$rc en la línea $LINENO: $BASH_COMMAND" >&2' ERR

AQUI="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RAIZ="$(cd "$AQUI/../../.." && pwd)"
MIGS="$RAIZ/supabase/migrations"
MIGRACION=20261029000000_sesion_sin_perfil_fail_closed
VERSION=${MIGRACION%%_*}
HUELLA="$RAIZ/scripts/schema-drift/fingerprint.sql"
ACTORES="ARRAY['OP_C','SINAPP','CLI','ANON','OWN_D','ADM_D','OPE_D','VIS_D','SA','SERVICIO','SISTEMA','OWN_C']"

[ -f "$MIGS/$MIGRACION.sql" ] || { echo "❌ no existe $MIGS/$MIGRACION.sql"; exit 1; }

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

DATA=$(mktemp -d /tmp/fosdata.XXXX)
SOCK=$(mktemp -d /tmp/fossock.XXXX)
TRABAJO=$(mktemp -d /tmp/fostrab.XXXX)
chmod 777 "$TRABAJO"
PUERTO=${PGPORT_TEST:-55541}
BD=fos_base            # cadena anterior, SIN la migración ni el padrón (plantilla de todo)
BD_ANTES=fos_antes     # + padrón + matriz: el estado de producción
BD_POST=fos_post       # + migración + padrón + matriz

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
psql -q -d postgres -c "CREATE DATABASE $BD" >/dev/null

aplicar() { PGOPTIONS="-c client_min_messages=warning" psql -q -v ON_ERROR_STOP=1 -d "${2:-$BD}" -f "$1" >/dev/null; }
copia()   { PGOPTIONS="-c client_min_messages=warning" psql -q -d postgres -c "DROP DATABASE IF EXISTS $2" -c "CREATE DATABASE $2 TEMPLATE $1" >/dev/null; }
q()       { psql -q -t -A -d "${2:-$BD}" -c "$1"; }
huella()  { psql -q -v ON_ERROR_STOP=1 -tA -d "$1" -f "$HUELLA" | LC_ALL=C sort; }

# Corre una suite y exige que TERMINE bien; muestra sus ✓.
bloque() {           # bloque ARCHIVO ETIQUETA BD
  local salida
  salida=$(psql -q -v ON_ERROR_STOP=1 -d "$3" -f "$AQUI/$1" 2>&1) || {
    echo "$salida" | sed -n 's/.*NOTICE:  /  /p' | tail -5
    echo "❌ invariante incumplida en $1 ($2):"
    echo "$salida" | grep -E '^psql:.*ERROR|^DETAIL|^CONTEXT' | head -6
    exit 1
  }
  echo "  ✓ $2 — $(echo "$salida" | grep -c '✓') comprobaciones"
  echo "$salida" | sed -n 's/.*NOTICE:  ✓ /      /p' | grep -E 'funciones responden|celdas|evaluaciones|intentos|matriz cubre' || true
}

# Corre una suite en modo «continuar» y devuelve cuántos veredictos fallaron (en fos.fallos).
rojos() {            # rojos ARCHIVO BD → imprime el número
  q "TRUNCATE fos.fallos" "$2" >/dev/null
  PGOPTIONS="-c fos.continuar=on -c client_min_messages=warning" psql -q -v ON_ERROR_STOP=1 -d "$2" -f "$AQUI/$1" >/dev/null 2>&1 || {
    echo "❌ $1 abortó en $2 en vez de anotar los fallos" >&2; exit 1; }
  q "SELECT count(*) FROM fos.fallos" "$2"
}

# La matriz de una base: padrón, corrida y, si se pide, los resultados de la base «antes».
matriz() {           # matriz BD
  aplicar "$AQUI/fixture.sql" "$1"
  aplicar "$AQUI/matriz.sql" "$1"
  q "SET lock_timeout = '2s'; SELECT fos.correr($ACTORES)" "$1" >/dev/null
}
cargar_antes() {     # cargar_antes BD — copia los resultados de $BD_ANTES como fos.antes
  q "COPY (SELECT * FROM fos.resultados) TO STDOUT" "$BD_ANTES" > "$TRABAJO/antes.tsv"
  PGOPTIONS="-c client_min_messages=warning" psql -q -d "$1" -c "DROP TABLE IF EXISTS fos.antes" -c "CREATE TABLE fos.antes (LIKE fos.resultados)" \
       -c "\\copy fos.antes FROM '$TRABAJO/antes.tsv'" >/dev/null
}

echo "── 1/8 · andamiaje de plataforma y cadena de migraciones ANTERIORES a $VERSION"
aplicar "$RAIZ/scripts/schema-drift/bootstrap.sql" 2>/dev/null   # (su único WARNING es el wal_level de la publicación: irrelevante aquí)
N=0
for f in "$MIGS"/*.sql; do
  base="$(basename "$f" .sql)"
  [[ "${base:0:14}" < "$VERSION" ]] || continue
  aplicar "$f"
  N=$((N + 1))
done
echo "   $N migraciones aplicadas sobre una base vacía"

echo "── 2/8 · CONTROL NEGATIVO: sin la migración, las fugas están abiertas"
copia "$BD" "$BD_ANTES"
matriz "$BD_ANTES"
echo "   matriz: $(q "SELECT count(DISTINCT firma) FROM fos.resultados" "$BD_ANTES") funciones × 12 sesiones"
# Fugas abiertas SIN esta migración. En el orden real de fusión (#928 → #926 → #927 → ESTA),
# 20261027000800 (#926) ya cierra UNA: proveedor_habilitado_en para SINAPP, porque la guarda
# nueva de proveedor_habilitado (hallazgo A4 de esa migración) devuelve false sin empresa y
# proveedor_habilitado_en la llama. Si esa migración está en la cadena, esa fuga se exige
# cerrada (y sólo esa); si no está, las 39 siguen abiertas.
ESPERADAS=39
if ls "$MIGS"/20261027000800_*.sql >/dev/null 2>&1; then ESPERADAS=38; fi
R=$(rojos assert_cierre.sql "$BD_ANTES")
[ "$R" = "$ESPERADAS" ] || { echo "❌ sin la migración se esperaban las $ESPERADAS fugas abiertas y hay $R"; q "SELECT msg FROM fos.fallos" "$BD_ANTES" | head; exit 1; }
if [ "$ESPERADAS" = "38" ]; then
  [ "$(q "SELECT count(*) FROM fos.fallos WHERE msg ~ 'proveedor_habilitado_en'" "$BD_ANTES")" = "0" ] \
    || { echo "❌ con 20261027000800 en la cadena, la fuga de proveedor_habilitado_en debía estar ya cerrada"; exit 1; }
  echo "  ✓ 20261027000800 (#926) ya cierra proveedor_habilitado_en para SINAPP; quedan 38 abiertas"
fi
echo "  ✓ las $R fugas de assert_cierre.sql están ABIERTAS sin la migración, cada una medida:"
q "SELECT '      ' || left(msg, 150) FROM fos.fallos ORDER BY n LIMIT 6" "$BD_ANTES"
echo "      … ($R en total)"
R=$(rojos assert_tope.sql "$BD_ANTES")
OTROS=$(q "SELECT count(*) FROM fos.fallos WHERE msg !~ '^TOPE (SINAPP|CLI|ANON) '" "$BD_ANTES")
[ "$R" = "11" ] && [ "$OTROS" = "0" ] || { echo "❌ tope sin la migración: se esperaban 11 rojos, todos de SINAPP/CLI/ANON; hay $R ($OTROS de otros)"; q "SELECT msg FROM fos.fallos" "$BD_ANTES"; exit 1; }
echo "  ✓ el tope es un ORÁCULO sin la migración (11 intentos de SINAPP, CLI y ANON):"
q "SELECT '      ' || left(msg, 160) FROM fos.fallos WHERE msg ~ 'de D:' AND msg ~ 'projects' ORDER BY n" "$BD_ANTES"
# La matriz contra sí misma: lo que dice de los legítimos pasa, lo de las sesiones sin perfil no.
psql -q -d "$BD_ANTES" -c "CREATE TABLE fos.antes AS SELECT * FROM fos.resultados" >/dev/null
R=$(rojos assert_matriz.sql "$BD_ANTES")
[ "$R" -ge 30 ] || { echo "❌ la matriz sin la migración debía encontrar ≥ 30 sesiones sin perfil que pasan; encontró $R"; exit 1; }
echo "  ✓ la matriz encuentra $R celdas en las que una sesión sin perfil pasa (o recibe más) donde el forastero no"

echo "── 3/8 · la migración, dos veces, y lo que cambia en la huella"
copia "$BD" "$BD_POST"
huella "$BD_POST" > "$TRABAJO/h0"
aplicar "$MIGS/$MIGRACION.sql" "$BD_POST"
huella "$BD_POST" > "$TRABAJO/h1"
SALIDA=$(psql -q -v ON_ERROR_STOP=1 -d "$BD_POST" -f "$MIGS/$MIGRACION.sql" 2>&1) || { echo "❌ la segunda pasada falló:"; echo "$SALIDA" | tail -4; exit 1; }
echo "$SALIDA" | grep -q 'pre-vuelo): 0 funciones en su estado original, 20 ya migradas' || { echo "❌ la segunda pasada no se reconoció como ya migrada"; echo "$SALIDA" | tail -4; exit 1; }
huella "$BD_POST" > "$TRABAJO/h2"
cmp -s "$TRABAJO/h1" "$TRABAJO/h2" || { echo "❌ la segunda pasada cambió la huella"; diff "$TRABAJO/h1" "$TRABAJO/h2" | head; exit 1; }
echo "  ✓ segunda pasada: pre-vuelo «20 ya migradas», misma huella (idempotente)"
CAMBIADOS=$( { diff <(cut -f1,2 "$TRABAJO/h0") <(cut -f1,2 "$TRABAJO/h1") || true; } | sed -n 's/^[<>] //p' | cut -f1 | sed 's/(.*)\(\/grants\)\{0,1\}$/(…)\1/' | LC_ALL=C sort -u | tr '\n' ' ')
ESPERADOS="funcion:assert_company_scope(…) funcion:banco_ajuste_conciliacion(…) funcion:banco_conciliar_movimiento(…) funcion:banco_desconciliar_movimiento(…) funcion:calculate_monthly_total_cents(…) funcion:can_access_conversation_project(…) funcion:can_access_project(…) funcion:compras_seguimiento_orden(…) funcion:compras_validar_match(…) funcion:conta_anular_asiento(…) funcion:conta_publicar_asiento(…) funcion:conta_puede_escribir(…) funcion:get_company_usage(…) funcion:has_admin_or_owner_access_in_company(…) funcion:has_super_admin_access(…) funcion:is_company_owner(…) funcion:is_super_admin(…) funcion:is_user_cliente_with_id(…) funcion:prov_puede_ver_papeleria(…) funcion:sesion_api_sin_empresa(…) funcion:sesion_api_sin_empresa(…)/grants funcion:sesion_de_api(…) funcion:sesion_de_api(…)/grants funcion:tope_plan_exigir_alcance(…) funcion:tope_plan_exigir_alcance(…)/grants funcion:user_is_project_exempt(…) tabla:projects/triggers tabla:unidades/triggers "
[ "$CAMBIADOS" = "$ESPERADOS" ] || { echo "❌ la migración cambió otros grupos de la huella:"; echo "   cambiados: $CAMBIADOS"; echo "   esperados: $ESPERADOS"; exit 1; }
echo "  ✓ la huella cambia EXACTAMENTE en 28 grupos: 20 cuerpos de función (sin tocar sus grants), 3 funciones nuevas con sus grants y los triggers de projects y unidades"
# Migraciones POSTERIORES a la serie (si las hay): la nueva no debe romperlas.
for f in "$MIGS"/*.sql; do
  base="$(basename "$f" .sql)"
  [[ "${base:0:14}" > "$VERSION" ]] || continue
  aplicar "$f" "$BD_POST"
  echo "   + posterior aplicada: $base"
done

echo "── 4/8 · CON la migración: cierre, matriz, tope y helpers"
matriz "$BD_POST"
cargar_antes "$BD_POST"
bloque assert_cierre.sql  "las 39 fugas, cerradas con la misma respuesta que el forastero" "$BD_POST"
bloque assert_matriz.sql  "matriz antes/después"                                       "$BD_POST"
bloque assert_tope.sql    "el tope de plan no es un oráculo"                           "$BD_POST"
bloque assert_helpers.sql "helpers y predicados por actor"                             "$BD_POST"

echo "── 5/8 · el sistema en una sesión NUEVA (sin el GUC del JWT definido, como pg_cron)"
for bd in "$BD_ANTES" "$BD_POST"; do
  C=$(psql -q -tA -d "$bd" -c "BEGIN" -c "INSERT INTO public.projects (company_id, nombre) VALUES (fos.id('C'), 'sistema') RETURNING 'insertado'" -c "ROLLBACK" 2>&1 | grep -x 'insertado' || true)
  D=$(psql -q -tA -d "$bd" -c "BEGIN" -c "INSERT INTO public.projects (company_id, nombre) VALUES (fos.id('D'), 'sistema')" -c "ROLLBACK" 2>&1 | grep -o 'plan_limit_reached: max_projects = 2 (actual: 2)' || true)
  [ "$C" = "insertado" ] && [ -n "$D" ] || { echo "❌ $bd · el sistema en sesión nueva: C «$C», D «$D»"; exit 1; }
done
echo "  ✓ antes y después: inserta en C (con hueco) y recibe el tope de D, igual que siempre"

echo "── 6/8 · guardas de la migración"
# (a) Un cuerpo que no es el esperado (p. ej. producción con otro texto): aborta y no deja nada.
copia "$BD" fos_g1
psql -q -d fos_g1 -c "$(q "SELECT replace(pg_get_functiondef('public.compras_validar_match(uuid)'::regprocedure), 'IF v_company IS NULL THEN RETURN; END IF;', 'IF v_company IS NULL THEN RETURN; END IF; -- otro texto')" fos_g1)" >/dev/null
huella fos_g1 > "$TRABAJO/g1a"
SALIDA=$(psql -q -v ON_ERROR_STOP=1 -d fos_g1 -f "$MIGS/$MIGRACION.sql" 2>&1) && { echo "❌ la migración aplicó sobre un cuerpo inesperado"; exit 1; }
echo "$SALIDA" | grep -q 'pre-vuelo): el cuerpo de .*compras_validar_match(uuid) no es el esperado' || { echo "❌ abortó, pero por otra cosa:"; echo "$SALIDA" | grep ERROR | head -2; exit 1; }
huella fos_g1 > "$TRABAJO/g1b"
cmp -s "$TRABAJO/g1a" "$TRABAJO/g1b" || { echo "❌ el aborto del pre-vuelo dejó cambios"; exit 1; }
echo "  ✓ cuerpo inesperado → aborta en el pre-vuelo y la huella queda idéntica"
# (b) Quien corre no es el propietario: aborta con su mensaje.
q "CREATE ROLE fos_migrador LOGIN NOSUPERUSER" fos_g1 >/dev/null
q "SELECT pg_get_functiondef('public.compras_validar_match(uuid)'::regprocedure)" "$BD" > "$TRABAJO/orig.sql"
psql -q -d fos_g1 -f "$TRABAJO/orig.sql" >/dev/null
SALIDA=$(psql -q -v ON_ERROR_STOP=1 -U fos_migrador -d fos_g1 -f "$MIGS/$MIGRACION.sql" 2>&1) && { echo "❌ la migración aplicó con un rol que no es el propietario"; exit 1; }
echo "$SALIDA" | grep -q 'no es propietario de' || { echo "❌ abortó, pero por otra cosa:"; echo "$SALIDA" | grep ERROR | head -2; exit 1; }
echo "  ✓ un rol que no es el propietario → aborta en el pre-vuelo con su mensaje"

echo "── 7/8 · MUTACIONES: cada pieza, quitada, pone algo en ROJO"
MUT=0
mutante() {          # mutante NOMBRE 'SQL que deshace una pieza sobre la base migrada' ARCHIVO PATRON_ESPERADO
  MUT=$((MUT + 1))
  local bd="fos_mut$MUT" r
  copia "$BD" "$bd"
  aplicar "$MIGS/$MIGRACION.sql" "$bd"
  psql -q -v ON_ERROR_STOP=1 -d "$bd" -c "$2" >/dev/null
  matriz "$bd"
  cargar_antes "$bd"
  if [ "$3" = "assert_cierre.sql" ] || [ "$3" = "assert_matriz.sql" ]; then aplicar "$AQUI/assert_cierre.sql" "$bd" 2>/dev/null || true; fi
  r=$(rojos "$3" "$bd")
  if [ "$r" -eq 0 ]; then echo "❌ mutación «$1»: $3 siguió en VERDE — no detecta esa pieza"; exit 1; fi
  q "SELECT count(*) FROM fos.fallos WHERE msg ~ '$4'" "$bd" | grep -qv '^0$' || {
    echo "❌ mutación «$1»: $3 en rojo, pero no por lo esperado:"; q "SELECT msg FROM fos.fallos LIMIT 3" "$bd"; exit 1; }
  echo "  ✓ «$1» → $r veredicto(s) en rojo en $3 (p. ej. $(q "SELECT left(msg, 110) FROM fos.fallos WHERE msg ~ '$4' ORDER BY n LIMIT 1" "$bd"))"
  psql -q -d postgres -c "DROP DATABASE $bd" >/dev/null
}

# M1 · la variante INGENUA: COALESCE(…, false) también para servicio y sistema.
mutante "COALESCE(…, false) a secas (sin distinguir la API)" \
  "CREATE OR REPLACE FUNCTION public.is_super_admin() RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS \$f\$ SELECT COALESCE(current_user_role() IN ('super_admin', 'superadmin'), false) \$f\$" \
  assert_matriz.sql '^(SERVICIO|SISTEMA) · '
# M2 · los helpers sin el COALESCE (como estaban).
mutante "is_super_admin() vuelve a dar NULL" \
  "CREATE OR REPLACE FUNCTION public.is_super_admin() RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS \$f\$ SELECT current_user_role() IN ('super_admin', 'superadmin') \$f\$" \
  assert_cierre.sql 'get_superadmin_plataforma_kpis'
# M3 · una guarda parcheada, devuelta a su texto original.
mutante "conta_publicar_asiento sin «sesion_api_sin_empresa() OR»" \
  "DO \$d\$ BEGIN EXECUTE replace(pg_get_functiondef('public.conta_publicar_asiento(uuid)'::regprocedure), 'IF public.sesion_api_sin_empresa() OR NOT (', 'IF NOT ('); END \$d\$" \
  assert_cierre.sql 'conta_publicar_asiento'
# M4 · assert_company_scope sin la cláusula (el tope del repositorio vuelve a filtrar).
mutante "assert_company_scope sin «sesion_api_sin_empresa() OR»" \
  "DO \$d\$ BEGIN EXECUTE replace(pg_get_functiondef('public.assert_company_scope(uuid)'::regprocedure), 'IF public.sesion_api_sin_empresa() OR NOT (', 'IF NOT ('); END \$d\$" \
  assert_cierre.sql 'assert_company_scope'
# M5 · sesion_de_api() sólo por auth.uid(): anon deja de ser «de la API».
mutante "sesion_de_api() sin mirar el rol de la sesión" \
  "CREATE OR REPLACE FUNCTION public.sesion_de_api() RETURNS boolean LANGUAGE sql STABLE SET search_path TO '' AS \$f\$ SELECT auth.uid() IS NOT NULL \$f\$" \
  assert_tope.sql '^TOPE ANON '
# M6 · el trigger de alcance: con un tope que NO pasa por get_company_effective_limits (como el
#      cuerpo de producción, que difiere del repositorio), sólo el trigger impide el oráculo.
TOPE_DIRECTO="CREATE OR REPLACE FUNCTION public.enforce_max_projects() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS \$f\$ DECLARE v_limit int; v_count int; BEGIN IF is_super_admin() THEN RETURN NEW; END IF; SELECT c.max_projects INTO v_limit FROM public.companies c WHERE c.id = NEW.company_id; SELECT count(*) INTO v_count FROM public.projects WHERE company_id = NEW.company_id; IF v_count >= v_limit THEN RAISE EXCEPTION 'plan_limit_reached: max_projects = % (actual: %).', v_limit, v_count USING ERRCODE = 'check_violation'; END IF; RETURN NEW; END \$f\$"
copia "$BD" fos_tope
aplicar "$MIGS/$MIGRACION.sql" fos_tope
psql -q -v ON_ERROR_STOP=1 -d fos_tope -c "$TOPE_DIRECTO" >/dev/null
aplicar "$AQUI/fixture.sql" fos_tope
R=$(rojos assert_tope.sql fos_tope)
[ "$R" = "0" ] || { echo "❌ con un tope que lee companies directamente, el trigger de alcance no bastó: $R rojos"; q "SELECT msg FROM fos.fallos" fos_tope; exit 1; }
echo "  ✓ con un tope que lee companies directamente (no vía get_company_effective_limits), el trigger de alcance mantiene el cierre"
mutante "sin el trigger de alcance, con ese tope directo" \
  "$TOPE_DIRECTO; DROP TRIGGER alcance_tope_plan_before_insert ON public.projects" \
  assert_tope.sql '^TOPE (SINAPP|CLI|ANON) · INSERT en projects de D'

echo "── 8/8 · resumen"
echo "✅ fail_open_sin_perfil: 39 fugas medidas y cerradas con la misma respuesta que el forastero; matriz de $(q "SELECT count(DISTINCT firma) FROM fos.resultados" "$BD_POST") funciones idéntica para las 9 sesiones legítimas y de backend; el tope no es un oráculo; idempotente; guardas y $MUT mutaciones en rojo."
