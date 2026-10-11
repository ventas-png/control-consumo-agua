#!/usr/bin/env bash
# ============================================================================
# ASIGNACIONES DE PROYECTO · SEGURIDAD — nadie se asigna ni se quita proyectos a sí mismo.
# Arnés contra un PostgreSQL REAL (local, efímero). NO toca ningún entorno remoto.
#
# Aplica la cadena ENTERA de migraciones anteriores sobre una base vacía, monta datos con la FORMA de producción (43 filas, 10 huérfanas de
# 6 usuarios, un administrador acotado con 3 proyectos, 7 operadores y 13 visores con filas, todo «total»; fixture.sql) y prueba la
# migración 20261026000600_seguridad_asignaciones_proyecto.sql:
#
#   1. CONTROL NEGATIVO: sin la migración, la matriz, los flujos, el alcance y el catálogo DEBEN ponerse en ROJO (y se cuenta cuántos
#      casos; los flujos legítimos dan el mismo resultado antes y después, sólo cambia la autoedición);
#   2. la migración dos veces (idempotente: la huella del catálogo es idéntica), con sus guardas: pre-vuelo (falta una función → aborta y
#      no deja nada), post-vuelo (si tocara una fila → aborta y no deja nada) y lock_timeout (una transacción larga sobre la tabla → falla limpio);
#   3. DATOS COMO PRODUCCIÓN: las 43 filas son idénticas (huella md5 y fila a fila) y can_access_project / user_is_project_exempt /
#      lo que cada persona lee devuelven LO MISMO para las 39 personas antes y después;
#   4. invariantes de una sesión: catálogo y privilegios, matriz rol × operación × objetivo, flujos legítimos de administración,
#      efecto sobre el alcance (290 intentos de autoasignación, 84 de borrar/cambiar lo propio), cada capa por separado
#      (políticas solas / triggers solos);
#   5. compatibilidad con las migraciones POSTERIORES a la serie (si las hay);
#   6. REVERSIÓN exacta: scripts/reversion-asignaciones-proyecto.sql devuelve el catálogo de public a como estaba (0 diferencias de huella);
#   7. MUTACIONES: se revierte a mano cada pieza (cada política, la regla, la visibilidad, cada trigger, los privilegios) y alguna aserción
#      se pone ROJA;
#   8. CONCURRENCIA con sesiones reales: dos administradores a la vez sobre la misma persona (disjuntos, solapados, por diferencias);
#      una autoasignación mientras otro administrador asigna; la baja en cascada de los dos únicos proyectos de un administrador desde dos
#      sesiones (F1: sin el candado por persona lo deja con CERO filas y exento); una escritura legítima que llega mientras la migración está
#      parada tras su pre-vuelo (F4: ya no produce un falso «las filas CAMBIARON»); y la migración contra una transacción larga (lock_timeout).
#      NINGUNA espera es un tiempo fijo: las sesiones se sincronizan con un candado «puerta» y se observa pg_stat_activity (wait_event_type = Lock);
#   9. scripts/diagnostico-asignaciones-proyecto.sql corre en una transacción de SOLO LECTURA y dice lo que debe;
#  10. PRIVILEGIOS RELATIVOS (P0): la migración se aplica con la ACL de Supabase Preview (authenticated SIN DML; una base construida sólo con
#      migraciones) y con la de producción (authenticated CON DML), siempre COMO UN PROPIETARIO NO SUPERUSUARIO con BYPASSRLS (como el postgres
#      de Supabase): no concede ni quita el DML, quita lo que debe y la reversión también es relativa.
#
# Uso:  bash supabase/tests/asignaciones_proyecto/run.sh      (PGPORT_TEST=<puerto> para elegir el puerto del clúster desechable)
# ============================================================================
set -euo pipefail

AQUI="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RAIZ="$(cd "$AQUI/../../.." && pwd)"
MIGS="$RAIZ/supabase/migrations"
MIGRACION=20261026000600_seguridad_asignaciones_proyecto
VERSION=${MIGRACION%%_*}
REVERSION="$RAIZ/scripts/reversion-asignaciones-proyecto.sql"
DIAGNOSTICO="$RAIZ/scripts/diagnostico-asignaciones-proyecto.sql"
HUELLA="$RAIZ/scripts/schema-drift/fingerprint.sql"

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

DATA=$(mktemp -d /tmp/asgdata.XXXX)
SOCK=$(mktemp -d /tmp/asgsock.XXXX)
SALIDAS=$(mktemp -d /tmp/asgout.XXXX)
chmod 777 "$SALIDAS"
PUERTO=${PGPORT_TEST:-55532}
BD=asg_base              # cadena anterior + fixture, SIN la migración (plantilla de todo lo demás)
BD_ANTES=asg_antes       # copia de BD: el «estado de producción» sobre el que se prueba el rojo
BD_POST=asg_post         # copia de BD con la migración aplicada (plantilla de las pruebas con migración)
TOTAL=0

COMO=""
if [ "$(id -u)" = "0" ]; then
  id postgres >/dev/null 2>&1 || useradd -m postgres
  COMO="su postgres -c"
fi
correr() { if [ -n "$COMO" ]; then su postgres -c "PATH=$PATH $*"; else eval "$*"; fi; }

limpiar() {
  jobs -p | xargs -r kill 2>/dev/null || true          # sesiones de control o de prueba que hubieran quedado esperando
  correr "pg_ctl -D $DATA stop -m immediate" >/dev/null 2>&1 || true
  rm -rf "$DATA" "$SOCK" "$SALIDAS"
}
trap limpiar EXIT
if [ -n "$COMO" ]; then chown -R postgres "$DATA" "$SOCK"; fi

correr "initdb -D $DATA -U postgres --auth=trust" >/dev/null
correr "pg_ctl -D $DATA -o '-p $PUERTO -k $SOCK' -l $DATA/pg.log start" >/dev/null
for _ in $(seq 1 200); do PGHOST="$SOCK" PGPORT="$PUERTO" psql -q -U postgres -d postgres -c 'SELECT 1' >/dev/null 2>&1 && break; sleep 0.1; done      # listo cuando acepta conexiones (no un plazo fijo)

export PGHOST="$SOCK" PGPORT="$PUERTO" PGUSER=postgres
psql -q -d postgres -c "CREATE DATABASE $BD" >/dev/null

aplicar() {          # aplicar ARCHIVO [BD]   — en silencio, exige que termine bien
  PGOPTIONS="-c client_min_messages=warning" psql -q -v ON_ERROR_STOP=1 -d "${2:-$BD}" -f "$1" >/dev/null
}
copia()  { psql -q -d postgres -c "DROP DATABASE IF EXISTS $2" -c "CREATE DATABASE $2 TEMPLATE $1" >/dev/null; }
baja()   { psql -q -d postgres -c "DROP DATABASE IF EXISTS $1" >/dev/null; }
huella() { psql -q -v ON_ERROR_STOP=1 -tA -d "$1" -f "$HUELLA"; }          # huella normalizada del esquema public (la del auditor de drift)
q()      { psql -q -t -A -d "${2:-$BD}" -c "$1"; }

# Extrae de la migración el CREATE OR REPLACE FUNCTION de una función de public (hasta su cierre «$$;»): sirve para MUTARLA sin copiar su cuerpo aquí.
funcion_mig() {      # funcion_mig NOMBRE
  awk -v n="CREATE OR REPLACE FUNCTION public.$1(" 'index($0, n) == 1 { on = 1 } on { print } on && $0 == "$$;" { exit }' "$MIGS/$MIGRACION.sql"
}
# Devuelve la función con una sustitución de perl (-0: el archivo entero) y EXIGE que la mutación cambie algo.
mutar_funcion() {    # mutar_funcion NOMBRE 'expresión perl s///'
  local orig mut
  orig=$(funcion_mig "$1"); mut=$(printf '%s\n' "$orig" | perl -0pe "$2")
  [ -n "$orig" ] || { echo "❌ mutar_funcion: no se encontró $1 en la migración" >&2; exit 1; }
  [ "$orig" != "$mut" ] || { echo "❌ mutar_funcion: la sustitución no cambió $1 (¿cambió su texto?)" >&2; exit 1; }
  printf '%s\n' "$mut"
}

# Corre una suite y exige que TERMINE bien; muestra sus ✓.
bloque() {           # bloque ARCHIVO ETIQUETA [BD]
  local archivo="$1" etiqueta="$2" bd="${3:-$BD}" salida n
  echo "── $etiqueta"
  # shellcheck disable=SC2086
  salida=$(psql -q -v ON_ERROR_STOP=1 ${BLOQUE_ARGS:-} -d "$bd" -f "$AQUI/$archivo" 2>&1) || {
    echo "$salida" | sed -n 's/.*NOTICE:  /  /p' | tail -5
    echo "❌ invariante incumplida en $archivo:"
    echo "$salida" | grep -E '^psql:.*ERROR|^DETAIL|^CONTEXT' | head -6
    exit 1
  }
  n=$(echo "$salida" | grep -c '✓' || true)
  TOTAL=$((TOTAL + n))
  echo "  $n comprobaciones ✓"
}

# Corre una suite contra una base SIN la migración y exige que FALLE por lo esperado.
debe_fallar() {      # debe_fallar BD ARCHIVO PATRON ETIQUETA
  local bd="$1" archivo="$2" patron="$3" etiqueta="$4" salida
  salida=$(psql -q -v ON_ERROR_STOP=1 -d "$bd" -f "$AQUI/$archivo" 2>&1) && {
    echo "❌ $etiqueta: la suite PASÓ sin la migración, así que no prueba nada."; exit 1; }
  echo "$salida" | grep -E 'ERROR' | grep -qE "$patron" || {
    echo "❌ $etiqueta: falló, pero por otra cosa:"; echo "$salida" | grep -E 'ERROR' | head -3; exit 1; }
  echo "  ✓ $etiqueta — falla sin la migración, como debe: $(echo "$salida" | grep -E 'ERROR' | head -1 | sed 's/.*ERROR:  //' | cut -c1-120)"
}

UID_() { printf 'a5e00000-0000-0000-0000-%012d' "$1"; }       # persona n   (ver fixture.sql)
PID_() { printf 'a5d00000-0000-0000-0000-%012d' "$1"; }       # proyecto n

echo "── 1/10 · andamiaje de plataforma y cadena de migraciones ANTERIORES a la serie"
aplicar "$RAIZ/scripts/schema-drift/bootstrap.sql"
N=0
for f in "$MIGS"/*.sql; do
  base="$(basename "$f" .sql)"
  [[ "${base:0:14}" < "$VERSION" ]] || continue
  aplicar "$f"
  N=$((N + 1))
done
echo "   $N migraciones aplicadas sobre una base vacía (todas las anteriores a $VERSION)"
POSTERIORES=$(ls "$MIGS" | grep -E '^[0-9]{14}_.*\.sql$' | sed 's/\.sql$//' | awk -v v="$VERSION" 'substr($0,1,14) > v' | sort)

echo "── 2/10 · datos con la forma de producción y estado «antes»"
aplicar "$AQUI/fixture.sql"
FILAS_FIX=$(q "SELECT count(*) || ' filas · ' || count(DISTINCT user_id) || ' usuarios · ' || (SELECT count(*) FROM public.user_project_assignments u WHERE NOT EXISTS (SELECT 1 FROM public.app_users a WHERE a.id = u.user_id)) || ' huérfanas'
              FROM public.user_project_assignments")
echo "   $FILAS_FIX"
[ "$FILAS_FIX" = "43 filas · 27 usuarios · 10 huérfanas" ] || { echo "❌ el padrón no tiene la forma de producción"; exit 1; }
psql -q -v ON_ERROR_STOP=1 -v tag=antes -d "$BD" -f "$AQUI/snapshot.sql" >/dev/null
huella "$BD" > "$SALIDAS/huella_antes.txt"
echo "   huella del catálogo de public: $(wc -l < "$SALIDAS/huella_antes.txt") grupos"
copia "$BD" "$BD_ANTES"

echo "── 3/10 · CONTROL NEGATIVO: SIN la migración las suites DEBEN ponerse en rojo"
debe_fallar "$BD_ANTES" assert_matriz.sql 'tenía que fallar' "matriz: un operador se asigna proyectos y borra lo suyo"
debe_fallar "$BD_ANTES" assert_alcance.sql 'ERROR' "alcance: las personas amplían su propio alcance"
debe_fallar "$BD_ANTES" assert_catalogo.sql 'esperado' "catálogo: sin la regla, sin triggers y con privilegios de sobra"
debe_fallar "$BD_ANTES" assert_defensa.sql 'ERROR' "defensa en profundidad: sin los triggers una política permisiva reabre el hueco"
debe_fallar "$BD_ANTES" assert_capas.sql 'ERROR' "capas: las políticas anteriores no cierran el hueco solas"
SALIDA_ROJO=$(PGOPTIONS="-c asgt.continuar=on" psql -q -d "$BD_ANTES" -f "$AQUI/assert_matriz.sql" 2>&1 || true)
ROJOS=$(echo "$SALIDA_ROJO" | grep -c '✗' || true)
VERDES=$(echo "$SALIDA_ROJO" | grep -c '✓' || true)
[ "$ROJOS" -gt 0 ] || { echo "❌ la matriz no se puso roja sin la migración"; exit 1; }
echo "  matriz sin la migración: $ROJOS casos ROJOS y $VERDES verdes de $((ROJOS + VERDES)) (los verdes son lo legítimo y lo que ya estaba cerrado)"
# los flujos legítimos de administración dan el MISMO resultado antes y después; sólo cambia la autoedición
PGOPTIONS="-c asgt.mostrar=on" psql -q -d "$BD_ANTES" -f "$AQUI/assert_flujos.sql" 2>&1 | sed -n 's/.*NOTICE:  MUESTRA|//p' > "$SALIDAS/flujos_antes.txt"
echo "  flujos de la pantalla sin la migración: $(wc -l < "$SALIDAS/flujos_antes.txt") resultados anotados"

echo "── 4/10 · la migración, dos veces (la segunda debe ser limpia) y sus guardas"
SALIDA_MIG=$(psql -q -v ON_ERROR_STOP=1 -d "$BD" -f "$MIGS/$MIGRACION.sql" 2>&1)
echo "$SALIDA_MIG" | sed -n 's/.*NOTICE:  asignaciones_proyecto/   asignaciones_proyecto/p'
huella "$BD" > "$SALIDAS/huella_post1.txt"
if aplicar "$MIGS/$MIGRACION.sql"; then
  echo "   ✓ $MIGRACION: segunda pasada limpia"
else
  echo "❌ la segunda pasada falló (la migración no es idempotente):"; psql -v ON_ERROR_STOP=1 -d "$BD" -f "$MIGS/$MIGRACION.sql" 2>&1 | tail -4; exit 1
fi
huella "$BD" > "$SALIDAS/huella_post2.txt"
diff -q "$SALIDAS/huella_post1.txt" "$SALIDAS/huella_post2.txt" >/dev/null || { echo "❌ la segunda pasada cambió el catálogo"; diff "$SALIDAS/huella_post1.txt" "$SALIDAS/huella_post2.txt" | head; exit 1; }
echo "   ✓ idempotente: la huella del catálogo tras la 2ª pasada es IDÉNTICA a la de la 1ª ($(wc -l < "$SALIDAS/huella_post2.txt") grupos, 0 diferencias)"
echo "   ✓ cambios de catálogo que produce la migración (grupos distintos de la huella): $(diff "$SALIDAS/huella_antes.txt" "$SALIDAS/huella_post2.txt" | grep -c '^>' || true)"

# 4a · pre-vuelo: si falta algo que la migración da por existente, aborta y NO deja nada a medias
copia "$BD_ANTES" asg_pre
psql -q -d asg_pre -c "ALTER FUNCTION public.can_access_project(uuid) RENAME TO can_access_project_renombrada" >/dev/null
SALIDA_PRE=$(psql -q -v ON_ERROR_STOP=1 -d asg_pre -f "$MIGS/$MIGRACION.sql" 2>&1) && { echo "❌ el pre-vuelo no abortó con una función faltante"; exit 1; }
echo "$SALIDA_PRE" | grep -q 'faltan can_access_project(uuid)' || { echo "❌ el pre-vuelo abortó por otra cosa:"; echo "$SALIDA_PRE" | grep -E 'ERROR' | head -3; exit 1; }
[ "$(q "SELECT count(*) FROM pg_proc WHERE proname LIKE 'asignacion\\_%'" asg_pre)" = "0" ] \
  && [ "$(q "SELECT count(*) FROM pg_policy WHERE polrelid = 'public.user_project_assignments'::regclass AND pg_get_expr(COALESCE(polqual, polwithcheck), polrelid) ~ 'asignacion_puede_administrar'" asg_pre)" = "0" ] \
  || { echo "❌ el pre-vuelo abortó pero dejó piezas a medias"; exit 1; }
echo "   ✓ pre-vuelo: con can_access_project(uuid) ausente la migración ABORTA («faltan can_access_project(uuid)») y no deja ninguna pieza"
baja asg_pre

# 4b · post-vuelo: si la migración tocara una fila, aborta y NO deja nada
copia "$BD_ANTES" asg_post_vuelo
sed "s|^-- ── Post-vuelo: las filas son IDÉNTICAS|UPDATE public.user_project_assignments SET permission_type = 'lectura' WHERE id = (SELECT id FROM public.user_project_assignments ORDER BY id LIMIT 1);\n-- ── Post-vuelo: las filas son IDÉNTICAS|" \
  "$MIGS/$MIGRACION.sql" > "$SALIDAS/migracion_que_toca_filas.sql"
grep -q "SET permission_type = 'lectura'" "$SALIDAS/migracion_que_toca_filas.sql" || { echo "❌ no se pudo preparar la migración manipulada"; exit 1; }
SALIDA_POST=$(psql -q -v ON_ERROR_STOP=1 -d asg_post_vuelo -f "$SALIDAS/migracion_que_toca_filas.sql" 2>&1) && { echo "❌ el post-vuelo no abortó cuando una fila cambió"; exit 1; }
echo "$SALIDA_POST" | grep -q 'las filas de user_project_assignments CAMBIARON' || { echo "❌ el post-vuelo abortó por otra cosa:"; echo "$SALIDA_POST" | grep -E 'ERROR' | head -3; exit 1; }
[ "$(q "SELECT count(*) FROM pg_proc WHERE proname LIKE 'asignacion\\_%'" asg_post_vuelo)" = "0" ] \
  && [ "$(q "SELECT count(*) FROM public.user_project_assignments WHERE permission_type <> 'total'" asg_post_vuelo)" = "0" ] \
  || { echo "❌ el post-vuelo abortó pero la transacción dejó cambios"; exit 1; }
echo "   ✓ post-vuelo: si la migración cambiara UNA fila ABORTA («las filas … CAMBIARON») y la transacción no deja ni la fila cambiada ni una pieza"
baja asg_post_vuelo

# 4c · PRIVILEGIOS RELATIVOS (P0). La primera versión exigía como un ABSOLUTO que authenticated TUVIERA SELECT/INSERT/UPDATE/DELETE sobre la tabla: producción los
#      tiene (arwdDxtm) pero una base construida sólo con migraciones —Supabase Preview— tiene authenticated=Dxtm y la migración abortó ahí («privilegios de la
#      tabla mal repartidos»). Aquí se monta esa ACL EXACTA y la de producción, y la migración se aplica en ambas COMO UN PROPIETARIO NO SUPERUSUARIO con BYPASSRLS
#      (el postgres de Supabase), sin ayuda de la ACL por defecto de funciones de este arnés (las funciones nacen con PUBLIC=EXECUTE, como en Supabase).
SB="$AQUI/propietario_supabase.sql"
acl_tabla() {        # ACL de la tabla ORDENADA (el orden de las entradas cambia al revocar y volver a conceder) y SIN MAINTAIN (PG17): una entrada que sólo tuviera «m» desaparece
  q "SELECT '{' || COALESCE((SELECT string_agg(e, ',' ORDER BY e COLLATE \"C\")
                               FROM (SELECT regexp_replace(a, '(=[A-Za-z*]*)m/', '\1/') AS e FROM unnest(c.relacl::text[]) a) t
                              WHERE e !~ '^[^=]*=/'), '') || '}'
       FROM pg_class c WHERE c.oid = 'public.user_project_assignments'::regclass" "$1"
}
privs()     { q "SELECT string_agg(r || '=' || (SELECT COALESCE(string_agg(p, ',' ORDER BY p), '-') FROM unnest(ARRAY['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']) p
                                                 WHERE has_table_privilege(r, 'public.user_project_assignments', p)), ' ' ORDER BY r)
              FROM unnest(ARRAY['anon','authenticated','service_role']) r" "$1"; }
como_sb()   { PGOPTIONS="-c client_min_messages=warning" psql -q -v ON_ERROR_STOP=1 -U sb_postgres -d "$2" -f "$1" >/dev/null; }          # como_sb ARCHIVO BD
base_sb() {          # base_sb BD preview|produccion — copia de BD_ANTES con propietario sb_postgres y la ACL pedida
  copia "$BD_ANTES" "$1"
  psql -q -v ON_ERROR_STOP=1 -d "$1" -f "$SB" -c "TRUNCATE asgt.fallos" >/dev/null          # los «fallos» anotados por el control negativo sobre BD_ANTES no son de esta base
  if [ "$2" = preview ]; then
    psql -q -v ON_ERROR_STOP=1 -U sb_postgres -d "$1" -c "REVOKE SELECT, INSERT, UPDATE, DELETE ON public.user_project_assignments FROM anon, authenticated, service_role" >/dev/null
  fi
}
# La variante que EXIGE el DML como un absoluto (lo que hacía la primera versión): el control negativo de este punto.
sed "s/IS DISTINCT FROM current_setting('app.asg_pre_dml', true)/IS DISTINCT FROM 'SELECT,INSERT,UPDATE,DELETE'/" "$MIGS/$MIGRACION.sql" > "$SALIDAS/migracion_dml_absoluto.sql"
grep -q "IS DISTINCT FROM 'SELECT,INSERT,UPDATE,DELETE'" "$SALIDAS/migracion_dml_absoluto.sql" || { echo "❌ no se pudo preparar la variante de DML absoluto"; exit 1; }

N_MUT_ACL=0          # mutaciones de privilegios (el post-vuelo con el DML como ABSOLUTO)
# (a) ACL de Supabase Preview
base_sb asg_acl_prev preview
[ "$(acl_tabla asg_acl_prev)" = "{anon=Dxt/sb_postgres,authenticated=Dxt/sb_postgres,sb_postgres=arwdDxt/sb_postgres,service_role=Dxt/sb_postgres}" ] \
  || { echo "❌ 4c · la ACL montada no es la de la preview: $(acl_tabla asg_acl_prev)"; exit 1; }
[ "$(q "SELECT rolsuper::text || rolbypassrls::text FROM pg_roles WHERE rolname = 'sb_postgres'")" = "falsetrue" ] || { echo "❌ 4c · sb_postgres debe ser NO superusuario con BYPASSRLS"; exit 1; }
echo "   montaje (a): ACL de la tabla = la de Supabase Preview (anon y authenticated SIN DML: sólo TRUNCATE/TRIGGER/REFERENCES) y propietario sb_postgres (NO superusuario, BYPASSRLS)"
SALIDA_ABS=$(psql -q -v ON_ERROR_STOP=1 -U sb_postgres -d asg_acl_prev -f "$SALIDAS/migracion_dml_absoluto.sql" 2>&1) && { echo "❌ 4c · el post-vuelo ABSOLUTO debía abortar con la ACL de la preview"; exit 1; }
echo "$SALIDA_ABS" | grep -q 'el DML de authenticated CAMBIÓ' || { echo "❌ 4c · el post-vuelo absoluto abortó por otra cosa:"; echo "$SALIDA_ABS" | grep -E 'ERROR' | head -3; exit 1; }
[ "$(q "SELECT count(*) FROM pg_proc WHERE proname LIKE 'asignacion\\_%'" asg_acl_prev)" = "0" ] || { echo "❌ 4c · el aborto dejó funciones a medias"; exit 1; }
N_MUT_ACL=$((N_MUT_ACL + 1))
echo "   ✓ control negativo (a): con el post-vuelo ABSOLUTO (authenticated debe TENER el DML) la migración ABORTA con la ACL de la preview («el DML de authenticated CAMBIÓ») y no deja ninguna pieza"
SVC_ANTES=$(privs asg_acl_prev | grep -o 'service_role=[^ ]*')
como_sb "$MIGS/$MIGRACION.sql" asg_acl_prev
BLOQUE_ARGS="-v dml_antes=" bloque assert_acl.sql "4c(a) · migración real con la ACL de la preview: no concede ni quita el DML; anon sin nada; authenticated sin TRUNCATE/TRIGGER/REFERENCES" asg_acl_prev
[ "$(acl_tabla asg_acl_prev)" = "{sb_postgres=arwdDxt/sb_postgres,service_role=Dxt/sb_postgres}" ] || { echo "❌ 4c(a) · ACL final inesperada: $(acl_tabla asg_acl_prev)"; exit 1; }
[ "$(privs asg_acl_prev | grep -o 'service_role=[^ ]*')" = "$SVC_ANTES" ] || { echo "❌ 4c(a) · service_role cambió"; exit 1; }
como_sb "$MIGS/$MIGRACION.sql" asg_acl_prev
[ "$(acl_tabla asg_acl_prev)" = "{sb_postgres=arwdDxt/sb_postgres,service_role=Dxt/sb_postgres}" ] || { echo "❌ 4c(a) · la 2ª pasada cambió la ACL"; exit 1; }
echo "   ✓ (a) ACL final {propietario, service_role=Dxt}: authenticated SIGUE sin DML (no se le concede), anon sin nada, service_role intacto; la 2ª pasada no cambia nada"
como_sb "$REVERSION" asg_acl_prev
[ "$(privs asg_acl_prev)" = "anon=DELETE,INSERT,REFERENCES,SELECT,TRIGGER,TRUNCATE,UPDATE authenticated=REFERENCES,TRIGGER,TRUNCATE service_role=REFERENCES,TRIGGER,TRUNCATE" ] \
  || { echo "❌ 4c(a) · la reversión dejó otros privilegios: $(privs asg_acl_prev)"; exit 1; }
echo "   ✓ (a) la reversión también es relativa: devuelve a authenticated sólo TRUNCATE/TRIGGER/REFERENCES (no le inventa DML) y a anon lo de producción"
baja asg_acl_prev

# (b) ACL de producción, mismo propietario no superusuario
base_sb asg_acl_prod produccion
[ "$(acl_tabla asg_acl_prod)" = "{anon=arwdDxt/sb_postgres,authenticated=arwdDxt/sb_postgres,sb_postgres=arwdDxt/sb_postgres,service_role=arwdDxt/sb_postgres}" ] \
  || { echo "❌ 4c · la ACL de producción montada es otra: $(acl_tabla asg_acl_prod)"; exit 1; }
huella asg_acl_prod > "$SALIDAS/huella_acl_antes.txt"
copia asg_acl_prod asg_acl_prod_abs
psql -q -v ON_ERROR_STOP=1 -d postgres -c "ALTER DATABASE asg_acl_prod_abs OWNER TO sb_postgres" >/dev/null       # CREATE DATABASE … TEMPLATE deja de dueño a quien copia
como_sb "$SALIDAS/migracion_dml_absoluto.sql" asg_acl_prod_abs
echo "   ✓ control (b): el post-vuelo ABSOLUTO SÍ pasa con la ACL de producción (por eso nadie lo vio hasta que corrió en una base construida sólo con migraciones)"
baja asg_acl_prod_abs
SVC_ANTES=$(privs asg_acl_prod | grep -o 'service_role=[^ ]*')
como_sb "$MIGS/$MIGRACION.sql" asg_acl_prod
BLOQUE_ARGS="-v dml_antes=DELETE,INSERT,SELECT,UPDATE" bloque assert_acl.sql "4c(b) · migración real con la ACL de producción: authenticated CONSERVA su DML; anon sin nada; sin TRUNCATE/TRIGGER/REFERENCES" asg_acl_prod
[ "$(acl_tabla asg_acl_prod)" = "{authenticated=arwd/sb_postgres,sb_postgres=arwdDxt/sb_postgres,service_role=arwdDxt/sb_postgres}" ] || { echo "❌ 4c(b) · ACL final inesperada: $(acl_tabla asg_acl_prod)"; exit 1; }
[ "$(privs asg_acl_prod | grep -o 'service_role=[^ ]*')" = "$SVC_ANTES" ] || { echo "❌ 4c(b) · service_role cambió"; exit 1; }
echo "   ✓ (b) ACL final {propietario, authenticated=arwd, service_role=arwdDxt}: authenticated CONSERVA el DML y pierde sólo D/x/t; anon sin nada; service_role intacto"
# toda la batería de invariantes contra ESA base (funciones cuyo dueño NO es superusuario; ACL por defecto de las funciones distinta de la del arnés)
bloque assert_catalogo.sql "4c(b) · catálogo y privilegios con propietario no superusuario" asg_acl_prod
bloque assert_matriz.sql   "4c(b) · matriz rol × operación × objetivo con propietario no superusuario" asg_acl_prod
bloque assert_flujos.sql   "4c(b) · flujos legítimos con propietario no superusuario" asg_acl_prod
bloque assert_alcance.sql  "4c(b) · efecto sobre el alcance con propietario no superusuario" asg_acl_prod
bloque assert_capas.sql    "4c(b) · las políticas solas con propietario no superusuario" asg_acl_prod
bloque assert_defensa.sql  "4c(b) · los triggers solos con propietario no superusuario" asg_acl_prod
huella asg_acl_prod > "$SALIDAS/huella_acl_post.txt"
como_sb "$REVERSION" asg_acl_prod
huella asg_acl_prod > "$SALIDAS/huella_acl_rev.txt"
diff -q "$SALIDAS/huella_acl_antes.txt" "$SALIDAS/huella_acl_rev.txt" >/dev/null || { echo "❌ 4c(b) · la reversión no deja el catálogo como estaba (propietario no superusuario):"; diff "$SALIDAS/huella_acl_antes.txt" "$SALIDAS/huella_acl_rev.txt" | head; exit 1; }
[ "$(acl_tabla asg_acl_prod)" = "{anon=arwdDxt/sb_postgres,authenticated=arwdDxt/sb_postgres,sb_postgres=arwdDxt/sb_postgres,service_role=arwdDxt/sb_postgres}" ] || { echo "❌ 4c(b) · la reversión no restauró la ACL"; exit 1; }
como_sb "$MIGS/$MIGRACION.sql" asg_acl_prod
huella asg_acl_prod > "$SALIDAS/huella_acl_post2.txt"
diff -q "$SALIDAS/huella_acl_post.txt" "$SALIDAS/huella_acl_post2.txt" >/dev/null || { echo "❌ 4c(b) · migración → reversión → migración no cierra el ciclo"; exit 1; }
echo "   ✓ (b) la reversión deja el catálogo EXACTO ($(wc -l < "$SALIDAS/huella_acl_antes.txt") grupos, 0 diferencias, ACL incluida) con propietario no superusuario, y migración → reversión → migración cierra el ciclo"
baja asg_acl_prod

echo "── 5/10 · DATOS COMO PRODUCCIÓN: las 43 filas y el alcance de cada persona, antes y después"
PGOPTIONS="-c client_min_messages=warning" psql -q -v ON_ERROR_STOP=1 -v tag=despues -d "$BD" -f "$AQUI/snapshot.sql" >/dev/null
bloque assert_datos_produccion.sql "5 · huella md5, fila a fila, can_access_project, user_is_project_exempt y lectura de las 39 personas"
copia "$BD" "$BD_POST"
# los flujos de la pantalla, con la migración: lo legítimo es IDÉNTICO, sólo cambia la autoedición
PGOPTIONS="-c asgt.mostrar=on" psql -q -d "$BD_POST" -f "$AQUI/assert_flujos.sql" 2>&1 | sed -n 's/.*NOTICE:  MUESTRA|//p' > "$SALIDAS/flujos_despues.txt"
DISTINTOS=$(diff "$SALIDAS/flujos_antes.txt" "$SALIDAS/flujos_despues.txt" | grep -c '^<' || true)
LEGITIMOS_DISTINTOS=$(diff "$SALIDAS/flujos_antes.txt" "$SALIDAS/flujos_despues.txt" | grep '^<' | grep -vc '\[flujo 7\]' || true)
TOTAL_FLUJOS=$(wc -l < "$SALIDAS/flujos_despues.txt")
[ "$TOTAL_FLUJOS" -eq 28 ] || { echo "❌ se esperaban 28 flujos, hay $TOTAL_FLUJOS"; exit 1; }
[ "$LEGITIMOS_DISTINTOS" -eq 0 ] || { echo "❌ un flujo LEGÍTIMO cambió con la migración:"; diff "$SALIDAS/flujos_antes.txt" "$SALIDAS/flujos_despues.txt" | grep '^<' | grep -v '\[flujo 7\]'; exit 1; }
[ "$DISTINTOS" -eq 5 ] || { echo "❌ debían cambiar exactamente los 5 flujos de autoedición ([flujo 7]) y cambiaron $DISTINTOS"; exit 1; }
echo "   ✓ de $TOTAL_FLUJOS flujos de la pantalla, $((TOTAL_FLUJOS - DISTINTOS)) dan EXACTAMENTE el mismo resultado antes y después; cambian sólo los $DISTINTOS de autoedición ([flujo 7])"

echo "── 6/10 · invariantes de una sesión"
bloque assert_catalogo.sql   "6a · catálogo y privilegios: 4 políticas, 2 triggers, 3 funciones, anon sin nada, authenticated sin TRUNCATE/TRIGGER/REFERENCES" "$BD_POST"
bloque assert_matriz.sql     "6b · matriz rol × operación × objetivo (INSERT, UPDATE, DELETE, UPSERT, INSERT … SELECT) con código de error y control" "$BD_POST"
bloque assert_flujos.sql     "6c · flujos legítimos de la pantalla (borrar todas + insertar, y por diferencias) por rol; lectura de las propias" "$BD_POST"
bloque assert_alcance.sql    "6d · efecto sobre el alcance: 290 intentos de autoasignación, 84 de borrar/cambiar lo propio, nadie se vuelve exento" "$BD_POST"
bloque assert_capas.sql      "6e · las políticas SOLAS (sin triggers) ya cierran el hueco" "$BD_POST"
bloque assert_defensa.sql    "6f · los triggers SOLOS (con una política «true») lo siguen cerrando" "$BD_POST"
[ "$(q "SELECT asgt.huella_total()" "$BD_POST")" = "$(q "SELECT huella_total FROM asgt.snap_tabla WHERE tag = 'antes'" "$BD_POST")" ] \
  || { echo "❌ las suites dejaron la tabla cambiada"; exit 1; }
echo "   ✓ tras todas las suites la tabla es IDÉNTICA a la inicial (ninguna prueba dejó residuos)"

N_POST=0; [ -z "$POSTERIORES" ] || N_POST=$(echo "$POSTERIORES" | wc -l)
echo "── 7/10 · compatibilidad con las migraciones POSTERIORES a la serie ($N_POST en este árbol)"
if [ -n "$POSTERIORES" ]; then
  copia "$BD_POST" asg_posteriores
  for base in $POSTERIORES; do aplicar "$MIGS/$base.sql" asg_posteriores; done
  bloque assert_matriz.sql "7 · la matriz sigue verde con las migraciones posteriores aplicadas encima" asg_posteriores
  bloque assert_flujos.sql "7 · y los flujos legítimos" asg_posteriores
  baja asg_posteriores
else
  echo "   (nada que aplicar: la serie es la última del árbol)"
fi

echo "── 8/10 · REVERSIÓN exacta (scripts/reversion-asignaciones-proyecto.sql)"
copia "$BD_POST" asg_rev
aplicar "$REVERSION" asg_rev
aplicar "$REVERSION" asg_rev          # idempotente
huella asg_rev > "$SALIDAS/huella_rev.txt"
if diff -q "$SALIDAS/huella_antes.txt" "$SALIDAS/huella_rev.txt" >/dev/null; then
  echo "   ✓ tras revertir (dos veces) la huella del catálogo de public es IDÉNTICA a la de antes de la migración (0 diferencias en $(wc -l < "$SALIDAS/huella_rev.txt") grupos)"
else
  echo "❌ la reversión NO deja el catálogo como estaba:"; diff "$SALIDAS/huella_antes.txt" "$SALIDAS/huella_rev.txt" | head -10; exit 1
fi
[ "$(q "SELECT asgt.huella_total()" asg_rev)" = "$(q "SELECT huella_total FROM asgt.snap_tabla WHERE tag = 'antes'" asg_rev)" ] \
  || { echo "❌ la reversión tocó filas"; exit 1; }
echo "   ✓ y las 43 filas siguen idénticas"
POLITICAS_REV=$(q "SELECT string_agg(polname || '=' || md5(COALESCE(pg_get_expr(polqual, polrelid), '') || '|' || COALESCE(pg_get_expr(polwithcheck, polrelid), '')), ',' ORDER BY polname) FROM pg_policy WHERE polrelid = 'public.user_project_assignments'::regclass" asg_rev)
POLITICAS_ANTES=$(q "SELECT string_agg(polname || '=' || md5(COALESCE(pg_get_expr(polqual, polrelid), '') || '|' || COALESCE(pg_get_expr(polwithcheck, polrelid), '')), ',' ORDER BY polname) FROM pg_policy WHERE polrelid = 'public.user_project_assignments'::regclass" "$BD_ANTES")
[ "$POLITICAS_REV" = "$POLITICAS_ANTES" ] || { echo "❌ el texto de pg_get_expr de las políticas revertidas no coincide con el original"; exit 1; }
echo "   ✓ el texto de pg_get_expr de las 4 políticas revertidas es idéntico al original (md5 por política)"
SALIDA_REV=$(PGOPTIONS="-c asgt.continuar=on" psql -q -d asg_rev -f "$AQUI/assert_matriz.sql" 2>&1 || true)
ROJOS_REV=$(echo "$SALIDA_REV" | grep -c '✗' || true)
[ "$ROJOS_REV" -eq "$ROJOS" ] || { echo "❌ revertida, la matriz debía tener los mismos $ROJOS rojos que sin la migración y tiene $ROJOS_REV"; exit 1; }
echo "   ✓ revertida, la matriz vuelve a tener los mismos $ROJOS casos ROJOS (la reversión reabre exactamente el hueco original)"
aplicar "$MIGS/$MIGRACION.sql" asg_rev
huella asg_rev > "$SALIDAS/huella_rev_reaplicada.txt"
diff -q "$SALIDAS/huella_post2.txt" "$SALIDAS/huella_rev_reaplicada.txt" >/dev/null || { echo "❌ reaplicar tras revertir no deja el catálogo de la migración"; exit 1; }
echo "   ✓ y volver a aplicar la migración tras revertir deja el catálogo IDÉNTICO al de la migración (ciclo completo)"
baja asg_rev

echo "── 9/10 · MUTACIONES: se revierte a mano cada pieza y alguna aserción se pone ROJA"
ARCHIVOS_MUT="assert_catalogo assert_matriz assert_flujos assert_alcance assert_capas assert_defensa"
POL_ORIGINAL='is_super_admin() OR (current_user_role() = ANY(ARRAY['"'"'company_owner'"'"','"'"'admin'"'"']) AND project_id IN (SELECT id FROM projects WHERE company_id = get_my_company_id())) OR user_id = (SELECT auth.uid())'
N_MUT=0              # mutaciones de catálogo ejecutadas (se cuentan al correrlas: no se cuentan líneas del archivo)
mutacion() {         # mutacion ETIQUETA "SQL" "archivos que DEBEN ponerse rojos"
  local etq="$1" sql="$2" esperados="$3" bd=asg_mut rojas="" f
  N_MUT=$((N_MUT + 1))
  copia "$BD_POST" "$bd"
  psql -q -v ON_ERROR_STOP=1 -d "$bd" -c "$sql" >/dev/null
  for f in $ARCHIVOS_MUT; do
    psql -q -v ON_ERROR_STOP=1 -d "$bd" -f "$AQUI/$f.sql" >/dev/null 2>&1 || rojas="$rojas $f"
  done
  for f in $esperados; do
    [[ " $rojas " == *" $f "* ]] || { echo "❌ mutación «$etq»: $f debía ponerse ROJA y pasó (rojas:${rojas:- ninguna})"; exit 1; }
  done
  echo "  ✓ mutación «$etq» → rojas:${rojas// / }"
  baja "$bd"
}
mutacion "política INSERT vuelve a la original (OR user_id = auth.uid())" \
  "DROP POLICY user_project_assignments_insert ON public.user_project_assignments; CREATE POLICY user_project_assignments_insert ON public.user_project_assignments FOR INSERT TO authenticated WITH CHECK ($POL_ORIGINAL)" \
  "assert_catalogo assert_capas"
mutacion "política UPDATE vuelve a la original" \
  "DROP POLICY user_project_assignments_update ON public.user_project_assignments; CREATE POLICY user_project_assignments_update ON public.user_project_assignments FOR UPDATE TO authenticated USING ($POL_ORIGINAL) WITH CHECK ($POL_ORIGINAL)" \
  "assert_catalogo assert_capas"
mutacion "política DELETE vuelve a la original" \
  "DROP POLICY user_project_assignments_delete ON public.user_project_assignments; CREATE POLICY user_project_assignments_delete ON public.user_project_assignments FOR DELETE TO authenticated USING ($POL_ORIGINAL)" \
  "assert_catalogo assert_capas"
mutacion "la regla concede todo (SELECT true)" \
  "CREATE OR REPLACE FUNCTION public.asignacion_puede_administrar(p_user_id uuid, p_project_id uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS \$\$ SELECT true \$\$" \
  "assert_catalogo assert_matriz assert_capas"
mutacion "la regla ya no excluye al administrador sobre sí mismo" \
  "CREATE OR REPLACE FUNCTION public.asignacion_puede_administrar(p_user_id uuid, p_project_id uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS \$\$ SELECT COALESCE(public.is_super_admin() OR (public.current_user_role() = ANY (ARRAY['company_owner','admin']) AND EXISTS (SELECT 1 FROM public.app_users u WHERE u.id = p_user_id AND u.company_id = public.get_my_company_id()) AND EXISTS (SELECT 1 FROM public.projects pr WHERE pr.id = p_project_id AND pr.company_id = public.get_my_company_id()) AND (public.user_is_project_exempt() OR public.user_has_project_access(p_project_id))), false) \$\$" \
  "assert_capas"
mutacion "la regla compara sólo la empresa (sin «proyectos que él ve»): el administrador acotado borraría lo que no ve" \
  "CREATE OR REPLACE FUNCTION public.asignacion_puede_administrar(p_user_id uuid, p_project_id uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS \$\$ SELECT COALESCE(public.is_super_admin() OR (public.current_user_role() = ANY (ARRAY['company_owner','admin']) AND (public.current_user_role() = 'company_owner' OR p_user_id IS DISTINCT FROM (SELECT auth.uid())) AND EXISTS (SELECT 1 FROM public.app_users u WHERE u.id = p_user_id AND u.company_id = public.get_my_company_id()) AND EXISTS (SELECT 1 FROM public.projects pr WHERE pr.id = p_project_id AND pr.company_id = public.get_my_company_id())), false) \$\$" \
  "assert_matriz assert_flujos assert_capas"
mutacion "la regla no exige que la persona sea de la empresa" \
  "CREATE OR REPLACE FUNCTION public.asignacion_puede_administrar(p_user_id uuid, p_project_id uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS \$\$ SELECT COALESCE(public.is_super_admin() OR (public.current_user_role() = ANY (ARRAY['company_owner','admin']) AND (public.current_user_role() = 'company_owner' OR p_user_id IS DISTINCT FROM (SELECT auth.uid())) AND EXISTS (SELECT 1 FROM public.projects pr WHERE pr.id = p_project_id AND pr.company_id = public.get_my_company_id()) AND (public.user_is_project_exempt() OR public.user_has_project_access(p_project_id))), false) \$\$" \
  "assert_matriz assert_capas"
mutacion "se quita el trigger de INTEGRIDAD de empresa" \
  "DROP TRIGGER trg_asignacion_empresa ON public.user_project_assignments" \
  "assert_catalogo assert_matriz assert_defensa"
mutacion "se quita el trigger de AUTOASIGNACIÓN" \
  "DROP TRIGGER trg_asignacion_propia ON public.user_project_assignments" \
  "assert_catalogo assert_matriz assert_defensa"
mutacion "el trigger de autoasignación queda deshabilitado" \
  "ALTER TABLE public.user_project_assignments DISABLE TRIGGER trg_asignacion_propia" \
  "assert_catalogo assert_matriz assert_defensa"
mutacion "se devuelven los privilegios a anon y TRUNCATE/TRIGGER/REFERENCES a authenticated" \
  "GRANT ALL ON TABLE public.user_project_assignments TO anon; GRANT TRUNCATE, TRIGGER, REFERENCES ON TABLE public.user_project_assignments TO authenticated" \
  "assert_catalogo assert_matriz"
mutacion "la política SELECT pierde la lectura de las propias" \
  "DROP POLICY user_project_assignments_select ON public.user_project_assignments; CREATE POLICY user_project_assignments_select ON public.user_project_assignments FOR SELECT TO authenticated USING (is_super_admin())" \
  "assert_catalogo assert_flujos"
mutacion "se revierte TODO (las políticas originales y sin triggers: lo que haría un revert completo)" \
  "DROP TRIGGER trg_asignacion_empresa ON public.user_project_assignments; DROP TRIGGER trg_asignacion_propia ON public.user_project_assignments; DROP POLICY user_project_assignments_insert ON public.user_project_assignments; DROP POLICY user_project_assignments_update ON public.user_project_assignments; DROP POLICY user_project_assignments_delete ON public.user_project_assignments; CREATE POLICY user_project_assignments_insert ON public.user_project_assignments FOR INSERT TO authenticated WITH CHECK ($POL_ORIGINAL); CREATE POLICY user_project_assignments_update ON public.user_project_assignments FOR UPDATE TO authenticated USING ($POL_ORIGINAL) WITH CHECK ($POL_ORIGINAL); CREATE POLICY user_project_assignments_delete ON public.user_project_assignments FOR DELETE TO authenticated USING ($POL_ORIGINAL)" \
  "assert_catalogo assert_matriz assert_flujos assert_alcance assert_capas assert_defensa"
# Mutaciones de la ronda de correcciones: cada una se obtiene MUTANDO la función de la propia migración (no una copia de su cuerpo).
mutacion "F-08 · la baja en cascada se permite SIN comprobar que el proyecto ya no existe: borrar UNA fila propia pasa mientras quede otra" \
  "$(mutar_funcion asignacion_bloquear_propia 's/\n\s*AND NOT EXISTS \(SELECT 1 FROM public\.projects p WHERE p\.id = OLD\.project_id\)//')" \
  "assert_defensa"
mutacion "F3 · el trigger de autoasignación sin COALESCE: para una sesión sin app_users (rol NULL) el IF da NULL y falla ABIERTO" \
  "$(mutar_funcion asignacion_bloquear_propia 's/COALESCE\(public\.is_super_admin\(\), false\) OR COALESCE\(public\.current_user_role\(\) = \x27company_owner\x27, false\)/public.is_super_admin() OR public.current_user_role() = \x27company_owner\x27/')" \
  "assert_defensa"
mutacion "F1 · se quita el candado por persona de la baja en cascada (la carrera de abajo, en la sección 10, lo detecta con sesiones reales; aquí lo ve el catálogo)" \
  "$(mutar_funcion asignacion_bloquear_propia 's/\n\s*IF TG_OP = \x27DELETE\x27 THEN\n\s*PERFORM pg_advisory_xact_lock\([^\n]*\n\s*END IF;//')" \
  "assert_catalogo"

echo "── 10/10 · concurrencia: sesiones REALES simultáneas y la migración contra una transacción larga"
N_MUT_CONC=0         # mutaciones probadas con sesiones reales (D0 sin FOR SHARE; F1 sin candado y con el candado dentro del AND; F4 sin LOCK TABLE)
# ── Sincronización DETERMINISTA de sesiones reales (sin pg_sleep ni plazos fijos) ───────────────────────────────────────────────────────
# Una «puerta» es un candado de aviso (clase, objeto) que toma una sesión de CONTROL y suelta cuando se le ordena por una tubería. Una sesión que
# pide la puerta se queda parada con todo lo suyo SIN confirmar; el orquestador observa pg_locks / pg_stat_activity (wait_event_type = 'Lock') en
# vez de dormir, y sólo entonces suelta la puerta. Así el entrelazado es siempre el mismo, con la máquina cargada o no.
PUERTA=9100
esperar() {          # esperar BD "SQL booleano" "qué se espera" — sondea cada 50 ms (no es un plazo: es un sondeo) y falla a los 60 s
  local bd="$1" cond="$2" que="$3" i
  for i in $(seq 1 1200); do
    [ "$(q "$cond" "$bd")" = "t" ] && return 0
    sleep 0.05
  done
  echo "❌ sincronización: no se llegó a «$que» en 60 s"; exit 1
}
en_puerta()  { echo "SELECT EXISTS (SELECT 1 FROM pg_locks WHERE locktype = 'advisory' AND classid = $PUERTA AND objid = $1 AND objsubid = 2 AND NOT granted)"; }   # alguien ESPERA la puerta $1
con_puerta() { echo "SELECT EXISTS (SELECT 1 FROM pg_locks WHERE locktype = 'advisory' AND classid = $PUERTA AND objid = $1 AND objsubid = 2 AND granted)"; }       # la puerta $1 está tomada
ctl_abrir() {        # ctl_abrir BD NOMBRE PUERTA — sesión de control que toma la puerta hasta ctl_soltar
  CTL_FIFO="$SALIDAS/$2.ctl"; rm -f "$CTL_FIFO"; mkfifo "$CTL_FIFO"
  psql -q -X -At -d "$1" < "$CTL_FIFO" > "$SALIDAS/$2.ctl.txt" 2>&1 &
  CTL_PID=$!
  exec {CTL_FD}> "$CTL_FIFO"
  echo "SELECT pg_advisory_lock($PUERTA, $3);" >&$CTL_FD
  esperar "$1" "$(con_puerta "$3")" "la puerta $3 tomada por el control"
}
ctl_soltar() {       # ctl_soltar PUERTA
  echo "SELECT pg_advisory_unlock($PUERTA, $1);" >&$CTL_FD
  exec {CTL_FD}>&-
  wait $CTL_PID || true
  rm -f "$CTL_FIFO"
}
esperar_o_fin() {    # esperar_o_fin BD "SQL booleano" FIN — hasta que se cumpla la condición o exista el archivo FIN (la sesión terminó)
  local bd="$1" cond="$2" fin="$3" i
  for i in $(seq 1 1200); do
    [ -e "$fin" ] && return 0
    [ "$(q "$cond" "$bd")" = "t" ] && return 0
    sleep 0.05
  done
  echo "❌ sincronización: la sesión ni terminó ni quedó esperando en 60 s"; exit 1
}
sesion() {           # sesion BASE ACTOR APP PUERTA|- ; el SQL llega por stdin. Con PUERTA, antes del COMMIT pide la puerta y se queda parada.
  local bd="$1" actor="$2" app="$3" puerta="$4" sql tras=""
  sql=$(cat)
  [ "$puerta" = "-" ] || tras="SELECT pg_advisory_xact_lock($PUERTA, $puerta);"
  PGAPPNAME="$app" psql -q -X -t -A -d "$bd" <<SQL
BEGIN;
SELECT asgt.poner_actor('$actor');
$sql
$tras
COMMIT;
SQL
}
par() {              # par BASE NOMBRE ACTOR1 SQL1 ACTOR2 SQL2 — la 1 hace lo suyo y se detiene SIN confirmar; la 2 arranca y se ESPERA a que termine o quede
                     # esperando un bloqueo; sólo entonces se suelta la puerta. Deja en ESTADO2 lo observado de la 2 antes de soltar: «terminó» | «esperando».
  local bd="$1" n="$2" fin1="$SALIDAS/$2.fin1" fin2="$SALIDAS/$2.fin2"
  rm -f "$fin1" "$fin2"
  ctl_abrir "$bd" "$n" 1
  ( sesion "$bd" "$3" "asg_${n}_1" 1 <<<"$4" > "$SALIDAS/${n}1.txt" 2>&1 || true; touch "$fin1" ) &
  local p1=$!
  esperar_o_fin "$bd" "$(en_puerta 1)" "$fin1"
  ( sesion "$bd" "$5" "asg_${n}_2" - <<<"$6" > "$SALIDAS/${n}2.txt" 2>&1 || true; touch "$fin2" ) &
  local p2=$!
  esperar_o_fin "$bd" "SELECT EXISTS (SELECT 1 FROM pg_stat_activity WHERE application_name = 'asg_${n}_2' AND wait_event_type = 'Lock')" "$fin2"
  if [ -e "$fin2" ]; then ESTADO2=terminó; else ESTADO2=esperando; fi
  ctl_soltar 1
  wait $p1 $p2 || true
}
sin_deadlock() { ! cat "$SALIDAS/${1}1.txt" "$SALIDAS/${1}2.txt" | grep -qi 'deadlock'; }
filas() { q "SELECT asgt.filas_de('$(UID_ "$1")')" "$2"; }          # proyectos de la persona n (alias ordenados)
INS() { echo "INSERT INTO public.user_project_assignments (user_id, project_id, permission_type) VALUES $1;"; }
v() { echo "('$(UID_ "$1")', '$(PID_ "$2")', 'total')"; }          # (persona n, proyecto n)

# A1 · dos administradores a la vez sobre la MISMA persona, con proyectos DISTINTOS (el guardado de hoy: borrar todas + insertar)
copia "$BD_POST" asg_conc
par asg_conc a AX "DELETE FROM public.user_project_assignments WHERE user_id = '$(UID_ 21)'; $(INS "$(v 21 4), $(v 21 5)")" \
                  AX2 "DELETE FROM public.user_project_assignments WHERE user_id = '$(UID_ 21)'; $(INS "$(v 21 6), $(v 21 7)")"
R=$(filas 21 asg_conc)
sin_deadlock a && [ "$ESTADO2" = "esperando" ] && ! grep -qi 'error' "$SALIDAS/a1.txt" "$SALIDAS/a2.txt" && [ "$R" = "P4,P5,P6,P7" ] \
  && echo "  ✓ A1 · dos administradores sobre la misma persona (borrar todas + insertar, proyectos distintos): sin deadlock ni error; queda la unión {$R} sin duplicados" \
  || { echo "❌ A1 · R=$R"; cat "$SALIDAS/a1.txt" "$SALIDAS/a2.txt"; exit 1; }
# A2 · con proyectos que SE SOLAPAN: uno gana, el otro recibe una violación de llave única limpia (nunca un deadlock ni filas dobles)
copia "$BD_POST" asg_conc
par asg_conc b AX "DELETE FROM public.user_project_assignments WHERE user_id = '$(UID_ 21)'; $(INS "$(v 21 4), $(v 21 5)")" \
                  AX2 "DELETE FROM public.user_project_assignments WHERE user_id = '$(UID_ 21)'; $(INS "$(v 21 4), $(v 21 6)")"
R=$(filas 21 asg_conc); DUP=$(q "SELECT count(*) FROM (SELECT user_id, project_id FROM public.user_project_assignments GROUP BY 1, 2 HAVING count(*) > 1) d" asg_conc)
sin_deadlock b && [ "$ESTADO2" = "esperando" ] && grep -q 'duplicate key' "$SALIDAS/b2.txt" && ! grep -qi 'error' "$SALIDAS/b1.txt" && [ "$R" = "P4,P5" ] && [ "$DUP" = "0" ] \
  && echo "  ✓ A2 · solapados: gana la primera ({$R}); la segunda recibe «duplicate key» (23505) y su transacción no deja nada; 0 duplicados" \
  || { echo "❌ A2 · R=$R DUP=$DUP"; cat "$SALIDAS/b1.txt" "$SALIDAS/b2.txt"; exit 1; }
# A3 · por DIFERENCIAS (insertar las que faltan con ON CONFLICT DO NOTHING): ambos terminan sin error y las filas que no cambian se conservan
copia "$BD_POST" asg_conc
ID_P1=$(q "SELECT id FROM public.user_project_assignments WHERE user_id = '$(UID_ 21)' AND project_id = '$(PID_ 1)'" asg_conc)
par asg_conc c AX "INSERT INTO public.user_project_assignments (user_id, project_id, permission_type) VALUES $(v 21 4) ON CONFLICT (user_id, project_id) DO NOTHING;" \
                  AX2 "INSERT INTO public.user_project_assignments (user_id, project_id, permission_type) VALUES $(v 21 4), $(v 21 5) ON CONFLICT (user_id, project_id) DO NOTHING;"
R=$(filas 21 asg_conc); ID_P1_DESPUES=$(q "SELECT id FROM public.user_project_assignments WHERE user_id = '$(UID_ 21)' AND project_id = '$(PID_ 1)'" asg_conc)
sin_deadlock c && [ "$ESTADO2" = "esperando" ] && ! grep -qi 'error' "$SALIDAS/c1.txt" "$SALIDAS/c2.txt" && [ "$R" = "P1,P2,P4,P5" ] && [ "$ID_P1" = "$ID_P1_DESPUES" ] \
  && echo "  ✓ A3 · por diferencias, mismo solapamiento: sin error, {$R}, y la fila P1 que no cambió conserva su id" \
  || { echo "❌ A3 · R=$R"; cat "$SALIDAS/c1.txt" "$SALIDAS/c2.txt"; exit 1; }
# B1 · un administrador intenta autoasignarse MIENTRAS otro administrador le asigna un proyecto
copia "$BD_POST" asg_conc
par asg_conc d AX "$(INS "$(v 13 1)")" AX2 "$(INS "$(v 13 2)")"
R=$(filas 13 asg_conc); EX=$(q "SELECT asgt.exento('$(UID_ 13)')" asg_conc)
sin_deadlock d && ! grep -qi 'error' "$SALIDAS/d1.txt" && grep -q 'ASIGNACION_PROPIA_NO_PERMITIDA' "$SALIDAS/d2.txt" && [ "$R" = "P1" ] && [ "$EX" = "f" ] \
  && echo "  ✓ B1 · AX2 se autoasigna P2 mientras AX le asigna P1: AX2 recibe ASIGNACION_PROPIA_NO_PERMITIDA, queda con {$R} y deja de ser exento sólo por obra de AX" \
  || { echo "❌ B1 · R=$R EX=$EX"; cat "$SALIDAS/d1.txt" "$SALIDAS/d2.txt"; exit 1; }
# B2 · quien ya quedó acotado intenta volver a ser exento (borrar las suyas) mientras otro administrador le amplía el alcance
par asg_conc e AX "$(INS "$(v 13 3)")" AX2 "DELETE FROM public.user_project_assignments WHERE user_id = '$(UID_ 13)';"
R=$(filas 13 asg_conc); EX=$(q "SELECT asgt.exento('$(UID_ 13)')" asg_conc)
sin_deadlock e && ! grep -qi 'error' "$SALIDAS/e1.txt" "$SALIDAS/e2.txt" && [ "$R" = "P1,P3" ] && [ "$EX" = "f" ] \
  && echo "  ✓ B2 · AX2 intenta borrar las suyas (0 filas, sin error) mientras AX le añade P3: queda con {$R} y SIGUE acotado" \
  || { echo "❌ B2 · R=$R EX=$EX"; cat "$SALIDAS/e1.txt" "$SALIDAS/e2.txt"; exit 1; }
# B3 · un administrador acotado intenta ampliarse y borrarse a la vez, con otro administrador escribiendo sobre OTRAS personas
copia "$BD_POST" asg_conc
par asg_conc f AP "DELETE FROM public.user_project_assignments WHERE user_id = '$(UID_ 6)'; $(INS "$(v 6 4)")" AX "$(INS "$(v 22 4)")"
R=$(filas 6 asg_conc); EX=$(q "SELECT asgt.exento('$(UID_ 6)')" asg_conc); R22=$(filas 22 asg_conc)
sin_deadlock f && grep -q 'ASIGNACION_PROPIA_NO_PERMITIDA' "$SALIDAS/f1.txt" && [ "$R" = "P1,P2,P3" ] && [ "$EX" = "f" ] && [ "$R22" = "P2,P3,P4" ] \
  && echo "  ✓ B3 · AP intenta ampliarse mientras AX escribe a OP2: AP queda con {$R} (sin cambios, no exento) y OP2 con {$R22} (lo de AX sí se aplicó)" \
  || { echo "❌ B3 · R=$R EX=$EX R22=$R22"; cat "$SALIDAS/f1.txt" "$SALIDAS/f2.txt"; exit 1; }

# D · el cambio de empresa de la persona (o del proyecto) CONCURRENTE con la asignación: el trigger de integridad espera (FOR SHARE) y ve la
#     empresa nueva; sin el candado se comparaba contra la empresa vieja y quedaba una fila cruzada (carrera reproducida antes de cerrarla).
cruces() { q "SELECT count(*) FROM public.user_project_assignments upa JOIN public.app_users u ON u.id = upa.user_id JOIN public.projects p ON p.id = upa.project_id WHERE u.company_id IS DISTINCT FROM p.company_id AND upa.user_id = '$(UID_ 8)'" "$1"; }   # filas cruzadas de la persona NUEVO (mover un proyecto con asignaciones ya hechas cruza las suyas por sí solo: eso no lo vigila este trigger, ver D-7)
EMPRESA_D=a5c00000-0000-0000-0000-000000000002
# D0 · control negativo: la misma migración SIN el candado FOR SHARE deja una fila cruzada (la carrera es real: la asignación NO espera, termina antes que el cambio de empresa)
copia "$BD_ANTES" asg_conc
sed 's/ FOR SHARE OF [up];/;/' "$MIGS/$MIGRACION.sql" > "$SALIDAS/migracion_sin_candado.sql"
! grep -q 'FOR SHARE OF' "$SALIDAS/migracion_sin_candado.sql" || { echo "❌ no se pudo quitar el candado"; exit 1; }
aplicar "$SALIDAS/migracion_sin_candado.sql" asg_conc
par asg_conc f0 SU "UPDATE public.app_users SET company_id = '$EMPRESA_D' WHERE id = '$(UID_ 8)';" AX "$(INS "$(v 8 1)")"
[ "$(cruces asg_conc)" = "1" ] && [ "$ESTADO2" = "terminó" ] \
  && echo "  ✓ D0 · control negativo: sin FOR SHARE la asignación pasa con la empresa vieja y queda 1 fila CRUZADA (la carrera es real)" \
  || { echo "❌ D0 · sin el candado debía quedar 1 fila cruzada y hay $(cruces asg_conc)"; cat "$SALIDAS/f01.txt" "$SALIDAS/f02.txt"; exit 1; }
N_MUT_CONC=$((N_MUT_CONC + 1))
copia "$BD_POST" asg_conc
par asg_conc g SU "UPDATE public.app_users SET company_id = '$EMPRESA_D' WHERE id = '$(UID_ 8)';" AX "$(INS "$(v 8 1)")"
sin_deadlock g && [ "$ESTADO2" = "esperando" ] && grep -q 'ASIGNACION_EMPRESA_DISTINTA' "$SALIDAS/g2.txt" && [ "$(cruces asg_conc)" = "0" ] && [ "$(filas 8 asg_conc)" = "" ] \
  && echo "  ✓ D1 · cambio de empresa de la PERSONA concurrente con su asignación: la asignación espera, ve la empresa nueva y recibe ASIGNACION_EMPRESA_DISTINTA; 0 filas cruzadas" \
  || { echo "❌ D1 · cruces=$(cruces asg_conc)"; cat "$SALIDAS/g1.txt" "$SALIDAS/g2.txt"; exit 1; }
copia "$BD_POST" asg_conc
par asg_conc h SU "UPDATE public.projects SET company_id = '$EMPRESA_D' WHERE id = '$(PID_ 1)';" AX "$(INS "$(v 8 1)")"
sin_deadlock h && [ "$ESTADO2" = "esperando" ] && grep -q 'ASIGNACION_EMPRESA_DISTINTA' "$SALIDAS/h2.txt" && [ "$(cruces asg_conc)" = "0" ] \
  && echo "  ✓ D2 · cambio de empresa del PROYECTO concurrente con una asignación: igual, 0 filas cruzadas" \
  || { echo "❌ D2 · cruces=$(cruces asg_conc)"; cat "$SALIDAS/h1.txt" "$SALIDAS/h2.txt"; exit 1; }
baja asg_conc

# F1 · BAJA EN CASCADA CONCURRENTE: dos sesiones, cada una borra UNO de los DOS únicos proyectos de un administrador acotado (AP queda con sólo P1 y P2).
#      Cada sesión, por separado, tiene permiso (le queda la otra fila); juntas lo dejarían con CERO filas y, siendo administrador, EXENTO (ve toda la empresa).
#      Con el candado por persona la 2ª ESPERA a la 1ª, ve lo que ésta confirmó y recibe ASIGNACION_PROPIA_NO_PERMITIDA.
carrera_f1() {       # carrera_f1 BD NOMBRE — deja en RES «filas de AP|exento|estado observado de la 2ª sesión antes de soltar la puerta»
  q "DELETE FROM public.user_project_assignments WHERE user_id = '$(UID_ 6)' AND project_id = '$(PID_ 3)'" "$1" >/dev/null
  par "$1" "$2" AP "DELETE FROM public.projects WHERE id = '$(PID_ 1)';" AP "DELETE FROM public.projects WHERE id = '$(PID_ 2)';"
  RES="$(q "SELECT count(*) FROM public.user_project_assignments WHERE user_id = '$(UID_ 6)'" "$1")|$(q "SELECT asgt.exento('$(UID_ 6)')" "$1")|$ESTADO2"
}
copia "$BD_POST" asg_conc
carrera_f1 asg_conc ca
sin_deadlock ca && [ "$RES" = "1|f|esperando" ] && ! grep -qi 'error' "$SALIDAS/ca1.txt" && grep -q 'ASIGNACION_PROPIA_NO_PERMITIDA' "$SALIDAS/ca2.txt" \
  && echo "  ✓ F1 · dos sesiones borran cada una uno de los 2 únicos proyectos de AP: la 2ª ESPERA (candado por persona), recibe ASIGNACION_PROPIA_NO_PERMITIDA, AP conserva 1 fila y NO es exento" \
  || { echo "❌ F1 · RES=$RES"; cat "$SALIDAS/ca1.txt" "$SALIDAS/ca2.txt"; exit 1; }
# control negativo: SIN el candado (la función de la migración mutada) la carrera es real: AP se queda con CERO filas y exento
copia "$BD_POST" asg_conc
psql -q -v ON_ERROR_STOP=1 -d asg_conc -c "$(mutar_funcion asignacion_bloquear_propia 's/\n\s*IF TG_OP = \x27DELETE\x27 THEN\n\s*PERFORM pg_advisory_xact_lock\([^\n]*\n\s*END IF;//')" >/dev/null
carrera_f1 asg_conc cb
[ "$RES" = "0|t|terminó" ] && ! grep -qi 'error' "$SALIDAS/cb1.txt" "$SALIDAS/cb2.txt" \
  && echo "  ✓ F1 · mutación «sin el candado»: las dos sesiones terminan sin error y AP se queda con 0 filas y EXENTO (la carrera es real y la prueba la ve)" \
  || { echo "❌ F1 · sin el candado debía quedar 0|t|terminó y hay $RES"; cat "$SALIDAS/cb1.txt" "$SALIDAS/cb2.txt"; exit 1; }
# control negativo 2: el candado DENTRO del AND de la condición (el primer parche que se probó) espera, pero compara con la instantánea vieja y tampoco sirve
copia "$BD_POST" asg_conc
psql -q -v ON_ERROR_STOP=1 -d asg_conc -c "$(mutar_funcion asignacion_bloquear_propia 's/\n\s*IF TG_OP = \x27DELETE\x27 THEN\n\s*PERFORM pg_advisory_xact_lock\([^\n]*\n\s*END IF;//; s/(AND NOT EXISTS \(SELECT 1 FROM public\.projects p WHERE p\.id = OLD\.project_id\))/AND (SELECT true FROM (SELECT pg_advisory_xact_lock(hashtextextended(\x27asg:\x27 || OLD.user_id::text, 0))) l)\n       $1/')" >/dev/null
carrera_f1 asg_conc cc
[ "$RES" = "0|t|esperando" ] \
  && echo "  ✓ F1 · mutación «candado dentro del AND»: la 2ª sí espera, pero decide con la instantánea de antes de esperar y AP termina con 0 filas y EXENTO: el candado tiene que ir en una sentencia ANTES" \
  || { echo "❌ F1 · con el candado dentro del AND debía quedar 0|t|esperando y hay $RES"; cat "$SALIDAS/cc1.txt" "$SALIDAS/cc2.txt"; exit 1; }
N_MUT_CONC=$((N_MUT_CONC + 2))
baja asg_conc

# F4 · UNA ESCRITURA LEGÍTIMA que llega mientras la migración está PARADA tras su pre-vuelo (se inyecta una puerta justo después de medir). Antes la medición
#      se hacía con ACCESS SHARE y el bloqueo llegaba después, con el primer DROP POLICY: la escritura se confirmaba en la ventana y el post-vuelo abortaba con un
#      falso «las filas CAMBIARON». Ahora el bloqueo va ANTES de medir: la escritura ESPERA, la migración pasa y la escritura se aplica después.
escritura_en_migracion() {   # escritura_en_migracion BD ARCHIVO NOMBRE — deja ESTADO2 (de la escritura), MIG_RC y MIG_TXT
  local bd="$1" arch="$2" n="$3" finm="$SALIDAS/$3.finm" finw="$SALIDAS/$3.finw"
  sed '/^-- ── 1\. Regla única/i SELECT pg_advisory_xact_lock(9100, 2);' "$arch" > "$SALIDAS/${n}_pausada.sql"
  grep -q 'pg_advisory_xact_lock(9100, 2)' "$SALIDAS/${n}_pausada.sql" || { echo "❌ F4 · no se pudo inyectar la pausa"; exit 1; }
  rm -f "$finm" "$finw"
  ctl_abrir "$bd" "$n" 2
  ( PGAPPNAME="asg_${n}_mig" psql -q -v ON_ERROR_STOP=1 -d "$bd" -f "$SALIDAS/${n}_pausada.sql" > "$SALIDAS/${n}_mig.txt" 2>&1 && echo 0 > "$SALIDAS/${n}.rc" || echo $? > "$SALIDAS/${n}.rc"; touch "$finm" ) &
  local pm=$!
  esperar_o_fin "$bd" "$(en_puerta 2)" "$finm"                    # la migración ya midió y está parada en la puerta
  ( sesion "$bd" AX "asg_${n}_esc" - <<<"$(INS "$(v 8 1)")" > "$SALIDAS/${n}_esc.txt" 2>&1 || true; touch "$finw" ) &
  local pw=$!
  esperar_o_fin "$bd" "SELECT EXISTS (SELECT 1 FROM pg_stat_activity WHERE application_name = 'asg_${n}_esc' AND wait_event_type = 'Lock')" "$finw"
  if [ -e "$finw" ]; then ESTADO2=terminó; else ESTADO2=esperando; fi
  ctl_soltar 2
  wait $pm $pw || true
  MIG_RC=$(cat "$SALIDAS/${n}.rc"); MIG_TXT="$SALIDAS/${n}_mig.txt"
}
copia "$BD_ANTES" asg_conc
escritura_en_migracion asg_conc "$MIGS/$MIGRACION.sql" f4a
[ "$ESTADO2" = "esperando" ] && [ "$MIG_RC" = "0" ] && ! grep -q 'CAMBIARON' "$MIG_TXT" && ! grep -qi 'error' "$SALIDAS/f4a_esc.txt" \
  && [ "$(q "SELECT count(*) FROM public.user_project_assignments" asg_conc)" = "44" ] && [ "$(q "SELECT asgt.filas_de('$(UID_ 8)')" asg_conc)" = "P1" ] \
  && [ "$(q "SELECT count(*) FROM pg_proc WHERE proname LIKE 'asignacion\\_%'" asg_conc)" = "3" ] \
  && echo "  ✓ F4 · una escritura legítima (AX asigna a NUEVO→P1) llega con la migración parada tras su pre-vuelo: ESPERA el bloqueo, la migración pasa (sin «CAMBIARON») y la escritura se aplica después (44 filas)" \
  || { echo "❌ F4 · ESTADO2=$ESTADO2 MIG_RC=$MIG_RC"; cat "$MIG_TXT" "$SALIDAS/f4a_esc.txt"; exit 1; }
# control negativo: SIN el LOCK TABLE inicial (la migración mutada) la escritura se confirma en la ventana y el post-vuelo aborta con el falso «CAMBIARON»
copia "$BD_ANTES" asg_conc
sed '/^  LOCK TABLE public\.user_project_assignments IN ACCESS EXCLUSIVE MODE;/d' "$MIGS/$MIGRACION.sql" > "$SALIDAS/migracion_sin_lock.sql"
! grep -q 'LOCK TABLE public.user_project_assignments' "$SALIDAS/migracion_sin_lock.sql" || { echo "❌ F4 · no se pudo quitar el LOCK TABLE"; exit 1; }
escritura_en_migracion asg_conc "$SALIDAS/migracion_sin_lock.sql" f4b
[ "$ESTADO2" = "terminó" ] && [ "$MIG_RC" != "0" ] && grep -q 'las filas de user_project_assignments CAMBIARON' "$MIG_TXT" \
  && [ "$(q "SELECT count(*) FROM pg_proc WHERE proname LIKE 'asignacion\\_%'" asg_conc)" = "0" ] \
  && echo "  ✓ F4 · mutación «sin el LOCK TABLE inicial»: la escritura se confirma durante la pausa y la migración ABORTA con el falso «las filas … CAMBIARON» (y no deja nada): la prueba ve el defecto" \
  || { echo "❌ F4 · sin el LOCK debía abortar con CAMBIARON: ESTADO2=$ESTADO2 MIG_RC=$MIG_RC"; cat "$MIG_TXT"; exit 1; }
N_MUT_CONC=$((N_MUT_CONC + 1))
baja asg_conc

# C · la migración contra una transacción larga sobre la tabla: lock_timeout (5 s) → falla limpio y no deja nada; reintentada después, aplica.
#     La transacción larga se detiene en una puerta (no en un pg_sleep) y se la suelta cuando la migración ya falló; lo único que dura es el lock_timeout de 5 s.
copia "$BD_ANTES" asg_lock
FIN_LARGA="$SALIDAS/c.finlarga"; rm -f "$FIN_LARGA"
ctl_abrir asg_lock c 3
( PGAPPNAME=asg_larga psql -q -X -d asg_lock >/dev/null 2>&1 <<SQL || true; touch "$FIN_LARGA" ) &
BEGIN;
LOCK TABLE public.user_project_assignments IN ROW EXCLUSIVE MODE;
SELECT pg_advisory_xact_lock($PUERTA, 3);
COMMIT;
SQL
P_LARGA=$!
esperar_o_fin asg_lock "$(en_puerta 3)" "$FIN_LARGA"               # la transacción larga ya tiene la tabla bloqueada y está parada
INI=$(date +%s)
SALIDA_LOCK=$(psql -q -v ON_ERROR_STOP=1 -d asg_lock -f "$MIGS/$MIGRACION.sql" 2>&1) && { ctl_soltar 3; echo "❌ C · la migración no debía poder aplicarse con la tabla bloqueada"; exit 1; }
FIN=$(date +%s)
ctl_soltar 3
wait $P_LARGA || true
echo "$SALIDA_LOCK" | grep -q 'lock timeout' || { echo "❌ C · falló, pero no por lock_timeout:"; echo "$SALIDA_LOCK" | grep -E 'ERROR' | head -3; exit 1; }
[ "$((FIN - INI))" -le 8 ] || { echo "❌ C · tardó $((FIN - INI)) s: el lock_timeout de 5 s no cortó"; exit 1; }
[ "$(q "SELECT count(*) FROM pg_proc WHERE proname LIKE 'asignacion\\_%'" asg_lock)" = "0" ] || { echo "❌ C · dejó funciones a medias"; exit 1; }
aplicar "$MIGS/$MIGRACION.sql" asg_lock
echo "  ✓ C · con una transacción larga sobre la tabla la migración FALLA en $((FIN - INI)) s por lock_timeout («canceling statement due to lock timeout»), no deja ninguna pieza y, reintentada, se aplica"
baja asg_lock

echo "── 11 · scripts/diagnostico-asignaciones-proyecto.sql: un SELECT, en una transacción de SOLO LECTURA"
SALIDA_DIAG_ANTES=$(PGOPTIONS="-c default_transaction_read_only=on" psql -q -v ON_ERROR_STOP=1 -At -F ' | ' -d "$BD_ANTES" -f "$DIAGNOSTICO")
SALIDA_DIAG_POST=$(PGOPTIONS="-c default_transaction_read_only=on" psql -q -v ON_ERROR_STOP=1 -At -F ' | ' -d "$BD_POST" -f "$DIAGNOSTICO")
SENTENCIAS=$(sed 's/--.*$//' "$DIAGNOSTICO" | tr '\n' ' ' | grep -o ';' | wc -l)
[ "$SENTENCIAS" -eq 1 ] || { echo "❌ el diagnóstico debe ser UNA sentencia y tiene $SENTENCIAS"; exit 1; }
echo "$SALIDA_DIAG_ANTES" | grep -q '2 huérfanas | filas con user_id sin app_users | 10' || { echo "❌ el diagnóstico no cuenta las 10 huérfanas"; exit 1; }
echo "$SALIDA_DIAG_ANTES" | grep -q 'user_project_assignments_insert (a) | conserva «OR user_id = auth.uid()» (EL HUECO)' || { echo "❌ el diagnóstico no señala el hueco antes de la migración"; exit 1; }
echo "$SALIDA_DIAG_POST" | grep -q 'user_project_assignments_insert (a) | usa asignacion_puede_administrar (corregida)' || { echo "❌ el diagnóstico no señala la corrección después de la migración"; exit 1; }
echo "$SALIDA_DIAG_POST" | grep -q 'privilegios de anon | (ninguno)' || { echo "❌ el diagnóstico no ve los privilegios mínimos"; exit 1; }
[ "$(echo "$SALIDA_DIAG_ANTES" | grep '^1 tabla')" = "$(echo "$SALIDA_DIAG_POST" | grep '^1 tabla')" ] || { echo "❌ la sección «tabla» del diagnóstico difiere antes/después"; exit 1; }
if PGOPTIONS="-c default_transaction_read_only=on" psql -q -v ON_ERROR_STOP=1 -d "$BD_POST" -c "DELETE FROM public.user_project_assignments" >/dev/null 2>&1; then
  echo "❌ control: la sesión de solo lectura permitió un DELETE"; exit 1
fi
echo "   ✓ una sentencia; corre con default_transaction_read_only=on (control: un DELETE ahí falla); antes: 10 huérfanas, EL HUECO señalado; después: «corregida», anon sin privilegios; la sección «tabla» es idéntica"

echo ""
echo "══ TOTAL: $TOTAL comprobaciones ✓ en bloques de una sesión + los controles negativos, la reversión, $((N_MUT + N_MUT_CONC + N_MUT_ACL)) mutaciones ($N_MUT de catálogo + $N_MUT_CONC de concurrencia + $N_MUT_ACL de privilegios), la concurrencia y el diagnóstico ══"
