#!/usr/bin/env bash
# ============================================================================
# ASIGNACIONES DE PROYECTO · SEGURIDAD — nadie se asigna ni se quita proyectos a sí mismo, y la autoridad es del PRINCIPAL de la empresa.
# Arnés contra un PostgreSQL REAL (local, efímero). NO toca ningún entorno remoto.
#
# Aplica la cadena ENTERA de migraciones anteriores sobre una base vacía, monta datos con la FORMA de producción (43 filas, 10 huérfanas de
# 6 usuarios, un administrador acotado con 3 proyectos, 7 operadores y 13 visores con filas, todo «total»; fixture.sql) y prueba las dos migraciones de la serie:
#   · 20261026000600_seguridad_asignaciones_proyecto.sql — nadie cambia sus propias asignaciones y SÓLO el principal (propietario de su empresa o superadministrador) escribe
#     user_project_assignments; un administrador, acotado o exento, no;
#   · 20261026000700_autoridad_principal_empresa.sql — sólo el principal crea y borra proyectos, escribe roles, llaves y asignaciones de roles de la empresa e invita
#     administradores, y valida app_users.project_id (13 políticas de projects, roles, role_permissions, user_roles y user_invitations y un trigger de app_users; el texto de producción de las 18 de esas tablas está en
#     politicas_produccion.md5, leído por SELECT el 2026-10-11).
#
#   1. CONTROL NEGATIVO: sin las migraciones, la matriz, los flujos, el alcance, el catálogo y el principal DEBEN ponerse en ROJO (y se cuenta cuántos
#      casos; con la 0600 sola, el principal sigue en rojo por lo que añade la 0700; los flujos del principal dan el mismo resultado antes y después, cambian los de actor
#      administrador y la autoedición);
#   2. cada migración dos veces (idempotente: la huella del catálogo es idéntica), con sus guardas: pre-vuelo (falta una función → aborta y
#      no deja nada; quien corre no es el propietario → aborta con su mensaje; la 0700 aborta ante una política que no tiene el texto de producción), post-vuelo (si tocara una
#      fila → aborta y no deja nada; independiente del search_path de la sesión: también con `auth` en él, y de la ACL) y lock_timeout (una transacción larga sobre la tabla → falla limpio);
#   3. DATOS COMO PRODUCCIÓN: las 43 filas son idénticas (huella md5 y fila a fila) y can_access_project / user_is_project_exempt /
#      lo que cada persona lee devuelven LO MISMO para las 39 personas antes y después;
#   4. invariantes de una sesión: catálogo y privilegios, matriz rol × operación × objetivo, flujos legítimos de administración,
#      efecto sobre el alcance (290 intentos de autoasignación, 84 de borrar/cambiar lo propio), cada capa por separado
#      (políticas solas / triggers solos);
#   5. compatibilidad con las migraciones POSTERIORES a la serie (si las hay);
#   6. REVERSIÓN: scripts/reversion-asignaciones-proyecto.sql devuelve el catálogo de public a como estaba (0 diferencias de huella) con la ACL de PRODUCCIÓN; con la de
#      Supabase Preview le devuelve a anon el DML que nunca tuvo (R2-4, documentado y fijado en 4c(a): sin exposición, la RLS no le da nada a anon);
#   7. MUTACIONES: se revierte a mano cada pieza (cada política, la regla, la visibilidad, cada trigger, los privilegios) y alguna aserción
#      se pone ROJA;
#   8. CONCURRENCIA con sesiones reales: dos administradores a la vez sobre la misma persona (disjuntos, solapados, por diferencias);
#      una autoasignación mientras otro administrador asigna; el cambio de empresa o la baja de un proyecto mientras se fija app_users.project_id (D3/D4); la baja en cascada de los dos únicos proyectos de un administrador desde dos
#      sesiones (F1) y la de dos administradores que COMPARTEN sus dos proyectos, o la de un propietario contra un administrador (R2-1): sin el
#      candado de bajas en cascada POR EMPRESA quedan con CERO filas y exentos; una escritura legítima que llega mientras la migración —o su
#      reversión— está parada tras su pre-vuelo (F4, R02: esperan el LOCK TABLE y ya no hay un falso «las filas CAMBIARON»); la migración
#      contra una transacción larga (lock_timeout); el coste conocido del candado (R2-5: un interbloqueo que PostgreSQL resuelve sin dejar datos a medias); y, de la cuarta
#      verificación independiente, que la clave del candado sale de la empresa de la PERSONA y no de la del actor (un superadministrador de OTRA empresa que borra un proyecto
#      se ordena con el administrador al que vacía la fila: H-05/M6), que las personas SIN empresa comparten la clave 'sin-empresa' (H-05/M7) y, como límite medido y no como deseo,
#      que con una fila cruzada heredada el propietario de D retiene la clave de C (H-03).
#      NINGUNA espera es un tiempo fijo: las sesiones se sincronizan con un candado «puerta» y se observa pg_stat_activity (wait_event_type = Lock);
#   9. scripts/diagnostico-asignaciones-proyecto.sql corre en una transacción de SOLO LECTURA y dice lo que debe;
#  10. PRIVILEGIOS RELATIVOS (P0): la migración se aplica con la ACL de Supabase Preview (authenticated SIN DML; una base construida sólo con
#      migraciones) y con la de producción (authenticated CON DML), siempre COMO UN PROPIETARIO NO SUPERUSUARIO con BYPASSRLS (como el postgres
#      de Supabase): no concede ni quita el DML, quita lo que debe y la reversión también es relativa.
#
#  11. el principal (assert_principal.sql): 10 actores × 35 escrituras sensibles, el proyecto de app_users, y los mutantes de cada política de la 0700 y de la regla de la 0600.
#
# Uso:  bash supabase/tests/asignaciones_proyecto/run.sh      (PGPORT_TEST=<puerto> para elegir el puerto del clúster desechable)
# ============================================================================
set -Eeuo pipefail
# Red de seguridad (F2-10): `set -e` termina el script en silencio cuando un paso que captura su salida (`X=$(psql … 2>&1)`) falla sin un `|| { … }`. Con esta
# trampa cualquier terminación inesperada dice SIEMPRE en qué línea y con qué comando, aunque no haya un mensaje propio. No se dispara en los fallos
# esperados (los que van en un `if`, un `&&`, un `||` o un `! cmd`), igual que `set -e`.
trap 'rc=$?; echo "❌ run.sh terminó con rc=$rc en la línea $LINENO: $BASH_COMMAND" >&2' ERR

AQUI="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RAIZ="$(cd "$AQUI/../../.." && pwd)"
MIGS="$RAIZ/supabase/migrations"
MIGRACION=20261026000600_seguridad_asignaciones_proyecto
VERSION=${MIGRACION%%_*}
MIGRACION2=20261026000700_autoridad_principal_empresa
VERSION2=${MIGRACION2%%_*}
REVERSION="$RAIZ/scripts/reversion-asignaciones-proyecto.sql"
REVERSION2="$RAIZ/scripts/reversion-principal-empresa.sql"
POL_PROD="$AQUI/politicas_produccion.md5"       # md5 de pg_get_expr de las 18 políticas de projects, roles, role_permissions, user_roles y user_invitations, LEÍDAS EN PRODUCCIÓN (SELECT, 2026-10-11)
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
BD_0600=asg_0600         # copia de BD con SÓLO la 0600 aplicada (plantilla de los controles de la 0700 y de la reversión de la 0600)
BD_POST=asg_post         # copia de BD con las DOS migraciones aplicadas (plantilla de las pruebas con migración)
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
# fsync apagado: es un clúster DESECHABLE (se borra al terminar); con fsync cada commit cuesta decenas de ms en una máquina cargada y las rondas de muchas sesiones simultáneas (R2-1 a escala)
# harían esperar a las últimas más de los 2 s del lock_timeout del candado sin que el código estuviera mal. No cambia ninguna semántica de las pruebas.
correr "pg_ctl -D $DATA -o '-p $PUERTO -k $SOCK -c fsync=off -c synchronous_commit=off -c full_page_writes=off' -l $DATA/pg.log start" >/dev/null
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

# Mutaciones de la ronda de correcciones: cada una se obtiene MUTANDO la función de la propia migración (no una copia de su cuerpo).
# Los mutadores NO dependen del texto de la guarda que decide cuándo se toma el candado (V3-03 c): sólo de tres anclas estructurales que cualquier versión
# de la función conserva —la sentencia `PERFORM pg_advisory_xact_lock(…);`, el `BEGIN` de la función con su primer `END IF;` (el retorno temprano de
# service_role) y la línea `IF v_toca AND NOT … THEN` (la rama de autoasignación)— y `mutar_funcion` exige que cada sustitución cambie algo, así que un refactor
# que las perdiera rompe la suite en voz alta en vez de dejar pasar una mutación que ya no muta.
# Quita el candado de las bajas en cascada (cualquiera que sea la guarda que lo rodee).
QUITAR_CANDADO='s/PERFORM\s+pg_advisory_xact_lock\([^;]*;//'
# El candado GLOBAL de la ronda anterior (b9b630b1): una sola clave para toda la base, sea cual sea la empresa (V3-01).
CANDADO_GLOBAL='s/(PERFORM\s+pg_advisory_xact_lock\()[^;]*(;)/$1hashtextextended(\x27asg-cascada\x27, 0));/'
# El candado POR PERSONA de la ronda de d1aeb94a, dentro de la rama de autoasignación: sólo ordena a las sesiones de la MISMA persona.
CANDADO_POR_PERSONA='s/(IF v_toca AND NOT [^\n]*THEN\n)/$1    IF TG_OP = \x27DELETE\x27 THEN PERFORM pg_advisory_xact_lock(hashtextextended(\x27asg:\x27 || OLD.user_id::text, 0)); END IF;\n/'
# El candado GLOBAL, pero tomado sólo DENTRO de la rama de autoasignación (cuando quien borra es dueño de la fila): una baja del propietario o del superadministrador no lo toma.
CANDADO_SOLO_SI_PROPIA='s/(IF v_toca AND NOT [^\n]*THEN\n)/$1    PERFORM pg_advisory_xact_lock(hashtextextended(\x27asg-cascada\x27, 0));\n/'
# El candado tomado en TODA baja de una asignación hecha con la API, también en un borrado DIRECTO (el proyecto sigue existiendo), justo tras el retorno temprano de service_role (V3-03 M-c).
CANDADO_EN_TODA_BAJA='s/(\nBEGIN\n.*?\bEND IF;\n)/$1  IF TG_OP = \x27DELETE\x27 THEN PERFORM pg_advisory_xact_lock(hashtextextended(\x27asg-cascada:\x27 || COALESCE((SELECT u.company_id::text FROM public.app_users u WHERE u.id = OLD.user_id), \x27sin-empresa\x27), 0)); END IF;\n/s'
# El candado dentro del AND de la comprobación «¿le queda otra fila?» (el primer parche que se probó): espera, pero compara con la instantánea de antes de esperar.
CANDADO_DENTRO_DEL_AND='s/(AND EXISTS \(SELECT 1 FROM public\.user_project_assignments)/AND (SELECT true FROM (SELECT pg_advisory_xact_lock(hashtextextended(\x27asg-cascada\x27, 0))) l)\n       $1/'
# Sin el lock_timeout propio de la función (el cláusula SET de la cabecera): la baja espera hasta el statement_timeout de la sesión en vez de fallar a los 2 s.
SIN_LOCK_TIMEOUT='s/\n\s*SET lock_timeout = \x272s\x27//'

# M6 de la verificación de la ronda 4 (H-05): la clave sale de la empresa del ACTOR (get_my_company_id()) y no de la de la PERSONA cuya fila se borra. Un superadministrador de OTRA empresa que borra un
# proyecto no serializaría con el administrador al que se le vacía la fila, y lo dejaría exento (defecto real si ocurriera).
CLAVE_DEL_ACTOR='s/COALESCE\(v_empresa::text, \x27sin-empresa\x27\)/COALESCE((SELECT public.get_my_company_id())::text, \x27sin-empresa\x27)/'
# M7: sin el COALESCE de «sin-empresa». Para una persona sin empresa la clave sería NULL y pg_advisory_xact_lock(NULL) no bloquea nada.
SIN_COALESCE_SIN_EMPRESA='s/COALESCE\(v_empresa::text, \x27sin-empresa\x27\)/v_empresa::text/'

# Sólo el PLAZO del lock_timeout (2 s → 60 s): con muchísimas sesiones a la vez las últimas de la cola pueden agotar los 2 s legítimamente; con el plazo largo la ronda debe ser EXACTA.
LOCK_TIMEOUT_LARGO='s/SET lock_timeout = \x272s\x27/SET lock_timeout = \x2760s\x27/'

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

# md5 de pg_get_expr (USING|WITH CHECK) de las 18 políticas de projects, roles, role_permissions, user_roles y user_invitations: el MISMO cálculo con que se leyó producción
pol_md5() {          # pol_md5 BD
  q "SELECT c.relname || '.' || p.polname || '=' || md5(COALESCE(pg_get_expr(p.polqual, p.polrelid), '') || '|' || COALESCE(pg_get_expr(p.polwithcheck, p.polrelid), ''))
       FROM pg_policy p JOIN pg_class c ON c.oid = p.polrelid
      WHERE c.relnamespace = 'public'::regnamespace AND c.relname IN ('projects', 'roles', 'role_permissions', 'user_roles', 'user_invitations')
      ORDER BY c.relname COLLATE \"C\", p.polname COLLATE \"C\"" "$1"
}
# el ALTER POLICY que devuelve UNA política de la 0700 a su texto de producción, sacado de la reversión (sirve para MUTAR sin copiar el texto aquí)
politica_original() {   # politica_original NOMBRE
  local t; t=$(perl -0ne 'print $& if /ALTER POLICY "\Q'"$1"'\E" ON .*?;\n/s' "$REVERSION2")
  [ -n "$t" ] || { echo "❌ politica_original: no se encontró $1 en la reversión" >&2; exit 1; }
  printf '%s\n' "$t"
}
# cuántas políticas de la lista de producción coinciden con las de la base
pol_iguales() { comm -12 <(pol_md5 "$1" | sort) <(sort "$POL_PROD") | wc -l; }

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
POSTERIORES=$(ls "$MIGS" | grep -E '^[0-9]{14}_.*\.sql$' | sed 's/\.sql$//' | awk -v v="$VERSION2" 'substr($0,1,14) > v' | sort)

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
[ "$(pol_md5 "$BD_ANTES")" = "$(cat "$POL_PROD")" ] || { echo "❌ las 18 políticas de la cadena NO tienen el texto de producción (politicas_produccion.md5):"; diff <(pol_md5 "$BD_ANTES") "$POL_PROD" | head; exit 1; }
echo "   ✓ las 18 políticas de projects, roles, role_permissions, user_roles y user_invitations que deja la cadena tienen el MISMO md5 de pg_get_expr que las leídas en producción el 2026-10-11 ($(wc -l < "$POL_PROD") de $(wc -l < "$POL_PROD"))"

echo "── 3/10 · CONTROL NEGATIVO: SIN las migraciones las suites DEBEN ponerse en rojo"
debe_fallar "$BD_ANTES" assert_matriz.sql 'tenía que fallar' "matriz: un operador se asigna proyectos y borra lo suyo"
debe_fallar "$BD_ANTES" assert_alcance.sql 'ERROR' "alcance: las personas amplían su propio alcance"
debe_fallar "$BD_ANTES" assert_catalogo.sql 'esperado' "catálogo: sin la regla, sin triggers y con privilegios de sobra"
debe_fallar "$BD_ANTES" assert_defensa.sql 'ERROR' "defensa en profundidad: sin los triggers una política permisiva reabre el hueco"
debe_fallar "$BD_ANTES" assert_capas.sql 'ERROR' "capas: las políticas anteriores no cierran el hueco solas"
debe_fallar "$BD_ANTES" assert_principal.sql 'ERROR' "principal: un administrador escribe asignaciones, proyectos, roles, llaves e invitaciones «admin»"
SALIDA_ROJO=$(PGOPTIONS="-c asgt.continuar=on" psql -q -d "$BD_ANTES" -f "$AQUI/assert_matriz.sql" 2>&1 || true)
ROJOS=$(echo "$SALIDA_ROJO" | grep -c '✗' || true)
VERDES=$(echo "$SALIDA_ROJO" | grep -c '✓' || true)
[ "$ROJOS" -gt 0 ] || { echo "❌ la matriz no se puso roja sin la migración"; exit 1; }
echo "  matriz sin las migraciones: $ROJOS casos ROJOS y $VERDES verdes de $((ROJOS + VERDES)) (los verdes son lo legítimo y lo que ya estaba cerrado)"
SALIDA_ROJO_PRIN=$(PGOPTIONS="-c asgt.continuar=on" psql -q -d "$BD_ANTES" -f "$AQUI/assert_principal.sql" 2>&1 || true)
ROJOS_PRIN=$(echo "$SALIDA_ROJO_PRIN" | grep -c '✗' || true)
VERDES_PRIN=$(echo "$SALIDA_ROJO_PRIN" | grep -c '✓' || true)
[ "$ROJOS_PRIN" -gt 0 ] || { echo "❌ el principal no se puso rojo sin las migraciones"; exit 1; }
echo "  principal sin las migraciones: $ROJOS_PRIN casos ROJOS y $VERDES_PRIN verdes de $((ROJOS_PRIN + VERDES_PRIN)) (un administrador escribe todo lo sensible)"
# los flujos legítimos de administración dan el MISMO resultado antes y después; sólo cambia la autoedición
PGOPTIONS="-c asgt.mostrar=on" psql -q -d "$BD_ANTES" -f "$AQUI/assert_flujos.sql" 2>&1 | sed -n 's/.*NOTICE:  MUESTRA|//p' > "$SALIDAS/flujos_antes.txt"
echo "  flujos de la pantalla sin la migración: $(wc -l < "$SALIDAS/flujos_antes.txt") resultados anotados"

echo "── 4/10 · las migraciones, cada una dos veces (la segunda debe ser limpia) y sus guardas"
SALIDA_MIG=$(psql -q -v ON_ERROR_STOP=1 -d "$BD" -f "$MIGS/$MIGRACION.sql" 2>&1) || {
  echo "❌ la migración falló al aplicarse por primera vez:"; echo "$SALIDA_MIG" | grep -E 'ERROR|DETAIL|CONTEXT' | head -8; exit 1; }
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
copia "$BD" "$BD_0600"
SALIDA_ROJO_0600=$(PGOPTIONS="-c asgt.continuar=on" psql -q -d "$BD_0600" -f "$AQUI/assert_principal.sql" 2>&1 || true)
ROJOS_PRIN_0600=$(echo "$SALIDA_ROJO_0600" | grep -c '✗' || true)
VERDES_PRIN_0600=$(echo "$SALIDA_ROJO_0600" | grep -c '✓' || true)
[ "$ROJOS_PRIN_0600" -gt 0 ] && [ "$ROJOS_PRIN_0600" -lt "$ROJOS_PRIN" ] || { echo "❌ con la 0600 sola el principal debía seguir en rojo (por lo que añade la 0700) y en menos casos que sin ninguna: $ROJOS_PRIN_0600 de $ROJOS_PRIN"; exit 1; }
echo "   ✓ control negativo (0700): con la 0600 SOLA el principal sigue en ROJO en $ROJOS_PRIN_0600 casos y verde en $VERDES_PRIN_0600 de $((ROJOS_PRIN_0600 + VERDES_PRIN_0600)) (las asignaciones ya son del principal; faltan proyectos, roles, llaves e invitaciones «admin»)"

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
como_sb "$MIGS/$MIGRACION2.sql" asg_acl_prev
como_sb "$MIGS/$MIGRACION2.sql" asg_acl_prev
[ "$(pol_iguales asg_acl_prev)" = "5" ] || { echo "❌ 4c(a) · con la ACL de la preview la 0700 no dejó 5 políticas de producción y 13 del principal"; exit 1; }
echo "   ✓ (a) la 0700 también se aplica con la ACL de la preview y como propietario NO superusuario (dos pasadas): 5 políticas con el texto de producción y 13 del principal"
como_sb "$REVERSION" asg_acl_prev
[ "$(privs asg_acl_prev)" = "anon=DELETE,INSERT,REFERENCES,SELECT,TRIGGER,TRUNCATE,UPDATE authenticated=REFERENCES,TRIGGER,TRUNCATE service_role=REFERENCES,TRIGGER,TRUNCATE" ] \
  || { echo "❌ 4c(a) · la reversión dejó otros privilegios: $(privs asg_acl_prev)"; exit 1; }
echo "   ✓ (a) la reversión es relativa para authenticated (sólo TRUNCATE/TRIGGER/REFERENCES; no le inventa DML) y le devuelve a anon los siete de PRODUCCIÓN; con la ACL de Preview eso es MÁS de lo que anon tenía (R2-4, documentado): aquí no es exacta, sólo lo es con la ACL de producción (4c(b))"
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
como_sb "$MIGS/$MIGRACION2.sql" asg_acl_prod
como_sb "$MIGS/$MIGRACION2.sql" asg_acl_prod
# toda la batería de invariantes contra ESA base (funciones cuyo dueño NO es superusuario; ACL por defecto de las funciones distinta de la del arnés)
bloque assert_catalogo.sql "4c(b) · catálogo y privilegios con propietario no superusuario (0600 + 0700)" asg_acl_prod
bloque assert_matriz.sql   "4c(b) · matriz rol × operación × objetivo con propietario no superusuario" asg_acl_prod
bloque assert_flujos.sql   "4c(b) · flujos legítimos con propietario no superusuario" asg_acl_prod
bloque assert_alcance.sql  "4c(b) · efecto sobre el alcance con propietario no superusuario" asg_acl_prod
bloque assert_capas.sql    "4c(b) · las políticas solas con propietario no superusuario" asg_acl_prod
bloque assert_defensa.sql  "4c(b) · los triggers solos con propietario no superusuario" asg_acl_prod
bloque assert_principal.sql "4c(b) · el principal con propietario no superusuario" asg_acl_prod
huella asg_acl_prod > "$SALIDAS/huella_acl_post.txt"
como_sb "$REVERSION2" asg_acl_prod
como_sb "$REVERSION" asg_acl_prod
huella asg_acl_prod > "$SALIDAS/huella_acl_rev.txt"
diff -q "$SALIDAS/huella_acl_antes.txt" "$SALIDAS/huella_acl_rev.txt" >/dev/null || { echo "❌ 4c(b) · la reversión no deja el catálogo como estaba (propietario no superusuario):"; diff "$SALIDAS/huella_acl_antes.txt" "$SALIDAS/huella_acl_rev.txt" | head; exit 1; }
[ "$(acl_tabla asg_acl_prod)" = "{anon=arwdDxt/sb_postgres,authenticated=arwdDxt/sb_postgres,sb_postgres=arwdDxt/sb_postgres,service_role=arwdDxt/sb_postgres}" ] || { echo "❌ 4c(b) · la reversión no restauró la ACL"; exit 1; }
como_sb "$MIGS/$MIGRACION.sql" asg_acl_prod
como_sb "$MIGS/$MIGRACION2.sql" asg_acl_prod
huella asg_acl_prod > "$SALIDAS/huella_acl_post2.txt"
diff -q "$SALIDAS/huella_acl_post.txt" "$SALIDAS/huella_acl_post2.txt" >/dev/null || { echo "❌ 4c(b) · migraciones → reversiones → migraciones no cierra el ciclo"; exit 1; }
echo "   ✓ (b) las DOS reversiones (0700 y 0600) dejan el catálogo EXACTO ($(wc -l < "$SALIDAS/huella_acl_antes.txt") grupos, 0 diferencias, ACL incluida) con propietario no superusuario, y migraciones → reversiones → migraciones cierra el ciclo"
baja asg_acl_prod

# 4d · INDEPENDENCIA DEL search_path (R2-3). pg_get_expr imprime «auth.uid()» CALIFICADO salvo que el esquema `auth` esté en el search_path de la sesión (entonces sale
#      «uid()»). El post-vuelo comparaba contra el texto «auth\.uid» y, ejecutado por un rol con `auth` en su search_path (supabase_admin, o PGOPTIONS='-c search_path=auth,public'),
#      abortaba con un mensaje engañoso («la política SELECT no existe o perdió la lectura de las propias») sin que nada estuviera mal. Ahora acepta las dos formas.
#      Aquí se aplica con auth en el search_path (y con uno vacío) y se MUTA el post-vuelo (la comprobación vieja) para ver que la prueba detecta el defecto.
N_MUT_GUARDA=0       # mutaciones de las guardas (pre-vuelo del propietario, post-vuelo y reversión frente al search_path, LOCK de la reversión)
aplicar_sp() {       # aplicar_sp ARCHIVO BD SEARCH_PATH — como aplicar, con otro search_path de sesión
  PGOPTIONS="-c client_min_messages=warning -c search_path=$3" psql -q -v ON_ERROR_STOP=1 -d "$2" -f "$1" >/dev/null
}
perl -pe 's/~ v_re_uid/~ \x27auth\\.uid\x27/g' "$MIGS/$MIGRACION.sql" > "$SALIDAS/migracion_regex_vieja.sql"
[ "$(grep -c "~ 'auth\\\\.uid'" "$SALIDAS/migracion_regex_vieja.sql")" -eq 2 ] || { echo "❌ 4d · no se pudo preparar la migración con la comprobación vieja"; exit 1; }
copia "$BD_ANTES" asg_sp
aplicar_sp "$MIGS/$MIGRACION.sql" asg_sp "auth,public" || { echo "❌ 4d · la migración abortó con auth en el search_path"; exit 1; }
huella asg_sp > "$SALIDAS/huella_sp.txt"
diff -q "$SALIDAS/huella_post2.txt" "$SALIDAS/huella_sp.txt" >/dev/null || { echo "❌ 4d · con auth en el search_path la migración dejó otro catálogo"; diff "$SALIDAS/huella_post2.txt" "$SALIDAS/huella_sp.txt" | head; exit 1; }
copia "$BD_ANTES" asg_sp
aplicar_sp "$MIGS/$MIGRACION.sql" asg_sp "" || { echo "❌ 4d · la migración abortó con un search_path vacío"; exit 1; }
copia "$BD_ANTES" asg_sp
SALIDA_SP=$(PGOPTIONS="-c search_path=auth,public" psql -q -v ON_ERROR_STOP=1 -d asg_sp -f "$SALIDAS/migracion_regex_vieja.sql" 2>&1) && { echo "❌ 4d · la comprobación vieja debía abortar con auth en el search_path"; exit 1; }
echo "$SALIDA_SP" | grep -q 'la política SELECT no existe o perdió la lectura de las propias' || { echo "❌ 4d · la comprobación vieja abortó por otra cosa:"; echo "$SALIDA_SP" | grep ERROR | head -3; exit 1; }
[ "$(q "SELECT count(*) FROM pg_proc WHERE proname LIKE 'asignacion\\_%'" asg_sp)" = "0" ] || { echo "❌ 4d · el aborto dejó funciones a medias"; exit 1; }
copia "$BD_ANTES" asg_sp
aplicar "$SALIDAS/migracion_regex_vieja.sql" asg_sp || { echo "❌ 4d · la comprobación vieja debía pasar con el search_path normal (si no, el defecto no es del search_path)"; exit 1; }
N_MUT_GUARDA=$((N_MUT_GUARDA + 1))
baja asg_sp
echo "   ✓ 4d · con auth en el search_path (y con uno vacío) la migración se aplica y deja el MISMO catálogo; la comprobación vieja ABORTA ahí («la política SELECT no existe…») y pasa con el search_path normal: el defecto era del search_path"

# 4e · PRE-VUELO DEL PROPIETARIO (S15). Quien corre la migración debe ser el propietario de la tabla (o miembro de su rol); si no, DROP POLICY / REVOKE fallarían o no harían nada.
#      Se corre como un rol que NO lo es (con USAGE sobre auth, para que la comprobación que falla sea ésa y no una anterior) y se espera el mensaje del pre-vuelo y 0 piezas.
copia "$BD_ANTES" asg_noprop
psql -q -v ON_ERROR_STOP=1 -d postgres -c "DO \$\$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'asg_intruso') THEN CREATE ROLE asg_intruso LOGIN NOSUPERUSER; END IF; END \$\$" >/dev/null
psql -q -v ON_ERROR_STOP=1 -d asg_noprop -c "GRANT USAGE ON SCHEMA auth TO asg_intruso" >/dev/null
SALIDA_NP=$(psql -q -v ON_ERROR_STOP=1 -U asg_intruso -d asg_noprop -f "$MIGS/$MIGRACION.sql" 2>&1) && { echo "❌ 4e · la migración no debía poder aplicarla un rol que no es el propietario"; exit 1; }
echo "$SALIDA_NP" | grep -q 'seguridad_asignaciones_proyecto (pre-vuelo): asg_intruso no es el propietario de user_project_assignments' || { echo "❌ 4e · abortó, pero no con el mensaje del pre-vuelo:"; echo "$SALIDA_NP" | grep ERROR | head -3; exit 1; }
[ "$(q "SELECT count(*) FROM pg_proc WHERE proname LIKE 'asignacion\\_%'" asg_noprop)" = "0" ] \
  && [ "$(q "SELECT count(*) FROM pg_policy WHERE polrelid = 'public.user_project_assignments'::regclass AND pg_get_expr(COALESCE(polqual, polwithcheck), polrelid) ~ 'asignacion_puede_administrar'" asg_noprop)" = "0" ] \
  || { echo "❌ 4e · el pre-vuelo abortó pero dejó piezas a medias"; exit 1; }
# mutación: sin la comprobación del propietario el aborto, si lo hay, ya NO es el del pre-vuelo (falla más tarde y con otro mensaje) → la prueba de arriba la detecta
perl -0pe 's/  IF NOT pg_has_role\(current_user.*?  END IF;\n//s' "$MIGS/$MIGRACION.sql" > "$SALIDAS/migracion_sin_propietario.sql"
! grep -q 'pg_has_role(current_user' "$SALIDAS/migracion_sin_propietario.sql" || { echo "❌ 4e · no se pudo quitar la comprobación del propietario"; exit 1; }
copia "$BD_ANTES" asg_noprop
SALIDA_NP=$(psql -q -v ON_ERROR_STOP=1 -U asg_intruso -d asg_noprop -f "$SALIDAS/migracion_sin_propietario.sql" 2>&1 || true)
! echo "$SALIDA_NP" | grep -q 'no es el propietario de user_project_assignments' || { echo "❌ 4e · la migración sin la comprobación seguía diciendo que no es el propietario"; exit 1; }
echo "$SALIDA_NP" | grep -q 'ERROR' || { echo "❌ 4e · la migración sin la comprobación debía fallar igualmente (privilegios), pero con OTRO mensaje"; exit 1; }
N_MUT_GUARDA=$((N_MUT_GUARDA + 1))
baja asg_noprop
echo "   ✓ 4e · un rol que NO es el propietario recibe «asg_intruso no es el propietario de user_project_assignments» y no deja ninguna pieza; mutación «sin la comprobación»: falla después con otro mensaje (la prueba la ve)"

# 4f · LA MIGRACIÓN 0700 (autoridad del principal): dos veces, sus guardas y su independencia del search_path y de la ACL. Cada guarda se prueba y se MUTA.
echo "   ── 4f · 20261026000700_autoridad_principal_empresa.sql"
SALIDA_MIG2=$(psql -q -v ON_ERROR_STOP=1 -d "$BD" -f "$MIGS/$MIGRACION2.sql" 2>&1) || {
  echo "❌ la migración 0700 falló al aplicarse por primera vez:"; echo "$SALIDA_MIG2" | grep -E 'ERROR|DETAIL|CONTEXT' | head -8; exit 1; }
echo "$SALIDA_MIG2" | sed -n 's/.*NOTICE:  autoridad_principal_empresa/   autoridad_principal_empresa/p'
huella "$BD" > "$SALIDAS/huella_fin1.txt"
aplicar "$MIGS/$MIGRACION2.sql" || { echo "❌ la 0700 no es idempotente: la segunda pasada falló"; psql -v ON_ERROR_STOP=1 -d "$BD" -f "$MIGS/$MIGRACION2.sql" 2>&1 | tail -4; exit 1; }
huella "$BD" > "$SALIDAS/huella_fin2.txt"
diff -q "$SALIDAS/huella_fin1.txt" "$SALIDAS/huella_fin2.txt" >/dev/null || { echo "❌ la segunda pasada de la 0700 cambió el catálogo"; diff "$SALIDAS/huella_fin1.txt" "$SALIDAS/huella_fin2.txt" | head; exit 1; }
GRUPOS_0700=$(diff "$SALIDAS/huella_post2.txt" "$SALIDAS/huella_fin2.txt" | grep -c '^>' || true)
GRUPOS_POLITICAS=$(diff "$SALIDAS/huella_post2.txt" "$SALIDAS/huella_fin2.txt" | grep '^>' | grep -cE 'polic' || true)
# la 0700 cambia 5 grupos de políticas (una por tabla) y, de app_users, el grupo de triggers y los dos de la función del trigger nuevo (cuerpo y privilegios): nada más
OTROS_0700=$(diff "$SALIDAS/huella_post2.txt" "$SALIDAS/huella_fin2.txt" | grep '^>' | grep -vcE 'polic|tabla:app_users/triggers|funcion:app_users_validar_proyecto\(\)' || true)
[ "$OTROS_0700" = "0" ] && [ "$GRUPOS_POLITICAS" = "5" ] && [ "$GRUPOS_0700" = "8" ] || { echo "❌ la 0700 debía cambiar 8 grupos del catálogo (5 de políticas, el trigger y la función de app_users) y cambió $GRUPOS_0700 ($GRUPOS_POLITICAS de políticas, $OTROS_0700 de otra cosa):"; diff "$SALIDAS/huella_post2.txt" "$SALIDAS/huella_fin2.txt" | grep '^>' | head -8; exit 1; }
[ "$(pol_iguales "$BD")" = "5" ] || { echo "❌ tras la 0700 deben quedar EXACTAMENTE 5 políticas con el texto de producción (las que no cambian) y hay $(pol_iguales "$BD")"; exit 1; }
echo "   ✓ 4f · segunda pasada limpia (huella idéntica, $(wc -l < "$SALIDAS/huella_fin2.txt") grupos); la 0700 cambia $GRUPOS_0700 grupos de la huella ($GRUPOS_POLITICAS de políticas, 1 trigger y 2 de la función de ese trigger); de las 18 políticas, 5 conservan el md5 de producción y 13 cambian"

# 4f(a) pre-vuelo: falta is_company_owner() → aborta, sin dejar nada
copia "$BD_0600" asg_pre
psql -q -d asg_pre -c "ALTER FUNCTION public.is_company_owner() RENAME TO is_company_owner_renombrada" >/dev/null
SALIDA_PRE=$(psql -q -v ON_ERROR_STOP=1 -d asg_pre -f "$MIGS/$MIGRACION2.sql" 2>&1) && { echo "❌ 4f · el pre-vuelo de la 0700 no abortó con una función faltante"; exit 1; }
echo "$SALIDA_PRE" | grep -q 'faltan is_company_owner()' || { echo "❌ 4f · el pre-vuelo abortó por otra cosa:"; echo "$SALIDA_PRE" | grep -E 'ERROR' | head -3; exit 1; }
[ "$(pol_md5 asg_pre)" = "$(pol_md5 "$BD_0600")" ] || { echo "❌ 4f · el pre-vuelo abortó pero dejó políticas cambiadas"; exit 1; }
echo "   ✓ 4f(a) · pre-vuelo: sin is_company_owner() la 0700 ABORTA («faltan is_company_owner()») y no cambia ninguna política"
baja asg_pre

# 4f(b) DERIVA: una política con un texto que no es el de producción NO se sobrescribe sin avisar
copia "$BD_0600" asg_deriva
psql -q -v ON_ERROR_STOP=1 -d asg_deriva -c "ALTER POLICY roles_insert ON public.roles WITH CHECK (true)" >/dev/null
SALIDA_DER=$(psql -q -v ON_ERROR_STOP=1 -d asg_deriva -f "$MIGS/$MIGRACION2.sql" 2>&1) && { echo "❌ 4f · la 0700 debía abortar ante una política con otro texto"; exit 1; }
echo "$SALIDA_DER" | grep -q 'DERIVA: roles.roles_insert no tiene el texto de producción ni el nuevo' || { echo "❌ 4f · abortó por otra cosa:"; echo "$SALIDA_DER" | grep -E 'ERROR' | head -3; exit 1; }
[ "$(q "SELECT pg_get_expr(polwithcheck, polrelid) FROM pg_policy WHERE polname = 'roles_insert'" asg_deriva)" = "true" ] || { echo "❌ 4f · el aborto por deriva dejó la política cambiada"; exit 1; }
# mutación: sin la guarda de deriva la 0700 SOBREESCRIBE en silencio un predicado que nadie leyó (lo que la guarda evita)
perl -0pe 's/  IF array_length\(v_deriva, 1\) IS NOT NULL THEN\n    RAISE EXCEPTION[^\n]*\n  END IF;\n//' "$MIGS/$MIGRACION2.sql" > "$SALIDAS/migracion0700_sin_deriva.sql"
! grep -q 'DERIVA: % no tiene el texto de producción' "$SALIDAS/migracion0700_sin_deriva.sql" || { echo "❌ 4f · no se pudo quitar la guarda de deriva"; exit 1; }
aplicar "$SALIDAS/migracion0700_sin_deriva.sql" asg_deriva || { echo "❌ 4f · sin la guarda de deriva la 0700 debía aplicarse (y sobrescribir)"; exit 1; }
N_MUT_GUARDA=$((N_MUT_GUARDA + 1))
echo "   ✓ 4f(b) · una política con otro texto (roles_insert = true) hace ABORTAR a la 0700 («DERIVA: roles.roles_insert…») sin cambiar nada; mutación «sin la guarda de deriva»: la sobrescribe en silencio (la prueba lo ve)"
baja asg_deriva

# 4f(c) post-vuelo: si la migración tocara una fila de las cinco tablas, aborta y no deja nada
copia "$BD_0600" asg_post_vuelo
sed "s|^-- ── Post-vuelo: las filas son IDÉNTICAS|UPDATE public.roles SET description = 'tocada' WHERE id = (SELECT id FROM public.roles ORDER BY id LIMIT 1);\n-- ── Post-vuelo: las filas son IDÉNTICAS|" "$MIGS/$MIGRACION2.sql" > "$SALIDAS/migracion0700_que_toca_filas.sql"
grep -q "SET description = 'tocada'" "$SALIDAS/migracion0700_que_toca_filas.sql" || { echo "❌ 4f · no se pudo preparar la 0700 manipulada"; exit 1; }
SALIDA_POST=$(psql -q -v ON_ERROR_STOP=1 -d asg_post_vuelo -f "$SALIDAS/migracion0700_que_toca_filas.sql" 2>&1) && { echo "❌ 4f · el post-vuelo de la 0700 no abortó cuando una fila cambió"; exit 1; }
echo "$SALIDA_POST" | grep -q 'las filas de roles CAMBIARON' || { echo "❌ 4f · el post-vuelo abortó por otra cosa:"; echo "$SALIDA_POST" | grep -E 'ERROR' | head -3; exit 1; }
[ "$(pol_md5 asg_post_vuelo)" = "$(pol_md5 "$BD_0600")" ] && [ "$(q "SELECT count(*) FROM public.roles WHERE description = 'tocada'" asg_post_vuelo)" = "0" ] || { echo "❌ 4f · el post-vuelo abortó pero la transacción dejó cambios"; exit 1; }
# mutación: sin la comprobación de filas el cambio pasa
perl -0pe 's/    IF \(v_n::text \|\| \x27:\x27 \|\| v_h\) IS DISTINCT FROM current_setting\(\x27app\.principal_pre_\x27 \|\| v_t, true\) THEN\n.*?\n    END IF;\n//s' "$SALIDAS/migracion0700_que_toca_filas.sql" > "$SALIDAS/migracion0700_sin_chequeo_filas.sql"
! grep -q 'las filas de % CAMBIARON' "$SALIDAS/migracion0700_sin_chequeo_filas.sql" || { echo "❌ 4f · no se pudo quitar la comprobación de filas"; exit 1; }
copia "$BD_0600" asg_post_vuelo
aplicar "$SALIDAS/migracion0700_sin_chequeo_filas.sql" asg_post_vuelo || { echo "❌ 4f · sin la comprobación de filas la 0700 manipulada debía aplicarse"; exit 1; }
[ "$(q "SELECT count(*) FROM public.roles WHERE description = 'tocada'" asg_post_vuelo)" = "1" ] || { echo "❌ 4f · la mutación no dejó la fila tocada"; exit 1; }
N_MUT_GUARDA=$((N_MUT_GUARDA + 1))
echo "   ✓ 4f(c) · post-vuelo: si la 0700 cambiara UNA fila de roles ABORTA («las filas de roles … CAMBIARON») y no deja nada; mutación «sin la comprobación de filas»: la fila tocada se confirma (la prueba lo ve)"
baja asg_post_vuelo

# 4f(c2) el post-vuelo mide también app_users (la sexta tabla, por el trigger de project_id): si la migración tocara una persona, aborta y no deja nada (ni el trigger)
copia "$BD_0600" asg_post_vuelo
sed "s|^-- ── Post-vuelo: las filas son IDÉNTICAS|UPDATE public.app_users SET full_name = 'tocada' WHERE id = (SELECT id FROM public.app_users ORDER BY id LIMIT 1);\n-- ── Post-vuelo: las filas son IDÉNTICAS|" "$MIGS/$MIGRACION2.sql" > "$SALIDAS/migracion0700_que_toca_personas.sql"
grep -q "SET full_name = 'tocada'" "$SALIDAS/migracion0700_que_toca_personas.sql" || { echo "❌ 4f · no se pudo preparar la 0700 que toca personas"; exit 1; }
SALIDA_POST=$(psql -q -v ON_ERROR_STOP=1 -d asg_post_vuelo -f "$SALIDAS/migracion0700_que_toca_personas.sql" 2>&1) && { echo "❌ 4f · el post-vuelo de la 0700 no abortó cuando una persona cambió"; exit 1; }
echo "$SALIDA_POST" | grep -q 'las filas de app_users CAMBIARON' || { echo "❌ 4f · el post-vuelo abortó por otra cosa:"; echo "$SALIDA_POST" | grep -E 'ERROR' | head -3; exit 1; }
[ "$(pol_md5 asg_post_vuelo)" = "$(pol_md5 "$BD_0600")" ] && [ "$(q "SELECT count(*) FROM pg_trigger WHERE tgname = 'trg_validar_proyecto_app_users'" asg_post_vuelo)" = "0" ] && [ "$(q "SELECT count(*) FROM public.app_users WHERE full_name = 'tocada'" asg_post_vuelo)" = "0" ] || { echo "❌ 4f · el post-vuelo abortó pero la transacción dejó cambios"; exit 1; }
perl -0pe 's/    IF \(v_n::text \|\| \x27:\x27 \|\| v_h\) IS DISTINCT FROM current_setting\(\x27app\.principal_pre_\x27 \|\| v_t, true\) THEN\n.*?\n    END IF;\n//s' "$SALIDAS/migracion0700_que_toca_personas.sql" > "$SALIDAS/migracion0700_sin_chequeo_personas.sql"
! grep -q 'las filas de % CAMBIARON' "$SALIDAS/migracion0700_sin_chequeo_personas.sql" || { echo "❌ 4f · no se pudo quitar la comprobación de filas"; exit 1; }
copia "$BD_0600" asg_post_vuelo
aplicar "$SALIDAS/migracion0700_sin_chequeo_personas.sql" asg_post_vuelo || { echo "❌ 4f · sin la comprobación de filas la 0700 manipulada debía aplicarse"; exit 1; }
[ "$(q "SELECT count(*) FROM public.app_users WHERE full_name = 'tocada'" asg_post_vuelo)" = "1" ] || { echo "❌ 4f · la mutación no dejó la persona tocada"; exit 1; }
N_MUT_GUARDA=$((N_MUT_GUARDA + 1))
baja asg_post_vuelo
echo "   ✓ 4f(c2) · post-vuelo: si la 0700 cambiara UNA persona de app_users ABORTA («las filas de app_users … CAMBIARON») y no deja nada ni el trigger; mutación «sin la comprobación de filas»: la persona tocada se confirma (la prueba lo ve)"

# 4f(d) quien corre debe ser el propietario de las cinco tablas
copia "$BD_0600" asg_noprop
psql -q -v ON_ERROR_STOP=1 -d asg_noprop -c "GRANT USAGE ON SCHEMA auth TO asg_intruso" >/dev/null
SALIDA_NP=$(psql -q -v ON_ERROR_STOP=1 -U asg_intruso -d asg_noprop -f "$MIGS/$MIGRACION2.sql" 2>&1) && { echo "❌ 4f · la 0700 no debía poder aplicarla un rol que no es el propietario"; exit 1; }
echo "$SALIDA_NP" | grep -q 'autoridad_principal_empresa (pre-vuelo): asg_intruso no es el propietario de app_users' || { echo "❌ 4f · abortó, pero no con el mensaje del pre-vuelo:"; echo "$SALIDA_NP" | grep ERROR | head -3; exit 1; }
[ "$(pol_md5 asg_noprop)" = "$(pol_md5 "$BD_0600")" ] || { echo "❌ 4f · el pre-vuelo del propietario abortó pero dejó políticas cambiadas"; exit 1; }
perl -0pe 's/  FOREACH v_t IN ARRAY v_tablas LOOP\n    IF NOT pg_has_role\(current_user.*?    END IF;\n  END LOOP;\n//s' "$MIGS/$MIGRACION2.sql" > "$SALIDAS/migracion0700_sin_propietario.sql"
! grep -q 'pg_has_role(current_user' "$SALIDAS/migracion0700_sin_propietario.sql" || { echo "❌ 4f · no se pudo quitar la comprobación del propietario"; exit 1; }
SALIDA_NP=$(psql -q -v ON_ERROR_STOP=1 -U asg_intruso -d asg_noprop -f "$SALIDAS/migracion0700_sin_propietario.sql" 2>&1 || true)
! echo "$SALIDA_NP" | grep -q 'no es el propietario de app_users' || { echo "❌ 4f · la 0700 sin la comprobación seguía diciendo que no es el propietario"; exit 1; }
echo "$SALIDA_NP" | grep -q 'ERROR' || { echo "❌ 4f · la 0700 sin la comprobación debía fallar igualmente (privilegios), pero con OTRO mensaje"; exit 1; }
N_MUT_GUARDA=$((N_MUT_GUARDA + 1))
echo "   ✓ 4f(d) · un rol que NO es el propietario recibe «asg_intruso no es el propietario de app_users» y no cambia ninguna política; mutación «sin la comprobación»: falla después con otro mensaje (la prueba la ve)"
baja asg_noprop

# 4f(e) independiente del search_path (los nombres van calificados public.*; el texto de pg_get_expr se normaliza sin «public.» ni «auth.»)
for SP in "" "auth,public" "public" "pg_catalog" '"$user",public'; do
  copia "$BD_0600" asg_sp
  aplicar_sp "$MIGS/$MIGRACION2.sql" asg_sp "$SP" || { echo "❌ 4f · la 0700 abortó con search_path='$SP'"; exit 1; }
  huella asg_sp > "$SALIDAS/huella_sp0700.txt"
  diff -q "$SALIDAS/huella_fin2.txt" "$SALIDAS/huella_sp0700.txt" >/dev/null || { echo "❌ 4f · con search_path='$SP' la 0700 dejó otro catálogo"; diff "$SALIDAS/huella_fin2.txt" "$SALIDAS/huella_sp0700.txt" | head -3; exit 1; }
done
perl -pe 's/\bpublic\.(is_super_admin|is_company_owner|get_my_company_id|current_user_role)\(/$1(/g unless /to_regprocedure/' "$MIGS/$MIGRACION2.sql" > "$SALIDAS/migracion0700_sin_calificar.sql"
[ "$(grep -c 'public\.is_company_owner()' "$SALIDAS/migracion0700_sin_calificar.sql")" -le 1 ] || { echo "❌ 4f · no se pudo preparar la 0700 sin calificar"; exit 1; }
copia "$BD_0600" asg_sp
SALIDA_SPQ=$(PGOPTIONS="-c search_path=" psql -q -v ON_ERROR_STOP=1 -d asg_sp -f "$SALIDAS/migracion0700_sin_calificar.sql" 2>&1) && { echo "❌ 4f · la 0700 sin calificar debía abortar con un search_path vacío"; exit 1; }
echo "$SALIDA_SPQ" | grep -qE 'function (is_super_admin|is_company_owner|get_my_company_id|current_user_role)\(\) does not exist' || { echo "❌ 4f · abortó por otra cosa:"; echo "$SALIDA_SPQ" | grep ERROR | head -3; exit 1; }
[ "$(pol_md5 asg_sp)" = "$(pol_md5 "$BD_0600")" ] || { echo "❌ 4f · el aborto dejó políticas cambiadas"; exit 1; }
N_MUT_GUARDA=$((N_MUT_GUARDA + 1))
baja asg_sp
echo "   ✓ 4f(e) · con search_path vacío, «auth,public», «public», «pg_catalog» y «\"\$user\", public» la 0700 se aplica y deja el MISMO catálogo; sin calificar los nombres ABORTA con un search_path vacío («function … does not exist»)"

# 4f(f) independiente de la ACL: ni las tablas ni las funciones necesitan privilegio alguno para authenticated/anon/service_role (lección del P0 de la 0600)
copia "$BD_0600" asg_acl0
psql -q -v ON_ERROR_STOP=1 -d asg_acl0 -c "REVOKE ALL ON public.app_users, public.projects, public.roles, public.role_permissions, public.user_roles, public.user_invitations FROM anon, authenticated, service_role, PUBLIC" -c "REVOKE ALL ON FUNCTION public.is_super_admin(), public.is_company_owner(), public.current_user_role(), public.get_my_company_id() FROM PUBLIC, anon, authenticated, service_role" >/dev/null
aplicar "$MIGS/$MIGRACION2.sql" asg_acl0 || { echo "❌ 4f · la 0700 abortó con las tablas y funciones SIN ningún privilegio: depende de la ACL"; exit 1; }
[ "$(pol_iguales asg_acl0)" = "5" ] || { echo "❌ 4f · sin privilegios la 0700 no dejó las 13 políticas cambiadas y 5 intactas"; exit 1; }
baja asg_acl0
echo "   ✓ 4f(f) · con CERO privilegios para anon, authenticated, service_role y PUBLIC sobre las seis tablas y las cuatro funciones auxiliares, la 0700 se aplica igual: no consulta ninguna ACL (el P0 de la 0600 no se repite)"

# 4f(g) la 0700 NO aplica SOLA: exige la regla del PRINCIPAL de la 0600 (H-04 de la quinta verificación)
#      REQUISITO: sin la 0600 (no existe asignacion_puede_administrar) aborta con un mensaje claro y no cambia ninguna política.
copia "$BD_ANTES" asg_solo0700
SALIDA_S7=$(psql -q -v ON_ERROR_STOP=1 -d asg_solo0700 -f "$MIGS/$MIGRACION2.sql" 2>&1) && { echo "❌ 4f(g) · la 0700 debía abortar sin la 0600 (REQUISITO)"; exit 1; }
echo "$SALIDA_S7" | grep -q 'REQUISITO: falta public.asignacion_puede_administrar' || { echo "❌ 4f(g) · abortó por otra cosa:"; echo "$SALIDA_S7" | grep -E 'ERROR' | head -3; exit 1; }
[ "$(pol_md5 asg_solo0700)" = "$(pol_md5 "$BD_ANTES")" ] && [ "$(q "SELECT count(*) FROM pg_trigger WHERE tgname = 'trg_validar_proyecto_app_users'" asg_solo0700)" = "0" ] || { echo "❌ 4f(g) · el aborto dejó piezas a medias"; exit 1; }
echo "   ✓ 4f(g) · REQUISITO: sobre la cadena SIN la 0600 la 0700 ABORTA («falta public.asignacion_puede_administrar»: van en el mismo push) y no deja ni una política cambiada ni el trigger"
# La línea base «sólo la 0700» de 8e (revertir sólo la 0600 con la 0700 puesta) se arma SIN esa comprobación: es la 0700 menos el bloque del REQUISITO/DERIVA, sobre la cadena sin la 0600.
perl -0pe 's/  -- REQUISITO \(H-04\).*?(?=  -- BLOQUEO ANTES DE MEDIR)//s' "$MIGS/$MIGRACION2.sql" > "$SALIDAS/migracion0700_sin_requisito.sql"
! grep -q 'REQUISITO: falta' "$SALIDAS/migracion0700_sin_requisito.sql" || { echo "❌ 4f(g) · no se pudo quitar la comprobación del REQUISITO"; exit 1; }
copia "$BD_ANTES" asg_solo0700
aplicar "$SALIDAS/migracion0700_sin_requisito.sql" asg_solo0700 || { echo "❌ 4f(g) · la 0700 sin la comprobación del REQUISITO debía aplicarse sobre la cadena sin la 0600"; exit 1; }
huella asg_solo0700 > "$SALIDAS/huella_solo0700.txt"
[ "$(pol_md5 asg_solo0700)" = "$(pol_md5 "$BD")" ] || { echo "❌ 4f(g) · la 0700 sin el REQUISITO deja otras políticas que con la 0600"; exit 1; }
N_MUT_GUARDA=$((N_MUT_GUARDA + 1))
baja asg_solo0700
echo "   ✓ 4f(g) · mutación «sin la comprobación del REQUISITO»: la 0700 se aplica sobre la cadena sin la 0600 y deja las mismas 18 políticas (la prueba ve el defecto; esa base es la línea base «sólo la 0700» de 8e)"

# 4f(h) H-04: una 0600 ANTERIOR ya registrada (Supabase Preview del #928 en 8d34392b: la versión está registrada y el archivo nuevo NO se reaplica) → la 0700 ABORTA en vez de pasar en silencio
#      Se aplica la 0600 de 8d34392b (copia exacta en migracion_0600_8d34392b.sql: regla que admite al administrador y user_is_project_exempt) y luego la 0700 vigente.
#      Los mensajes de la DERIVA (SQL-02 de la octava verificación: la comprobación es EXACTA —md5 del cuerpo de la regla y las tres políticas de escritura normalizadas—, no por palabras):
DERIVA_REGLA='DERIVA: public.asignacion_puede_administrar no codifica la regla del principal: su cuerpo (md5'
DERIVA_POLITICAS='DERIVA: las políticas de escritura de user_project_assignments (insert, update, delete) deben usar asignacion_puede_administrar exactamente como la 20261026000600 vigente'
copia "$BD_ANTES" asg_vieja
aplicar "$AQUI/migracion_0600_8d34392b.sql" asg_vieja
[ "$(q "SELECT (prosrc ~ 'user_is_project_exempt' AND prosrc ~ '''admin''' AND prosrc !~ 'is_company_owner')::text FROM pg_proc WHERE proname = 'asignacion_puede_administrar'" asg_vieja)" = "true" ] || { echo "❌ 4f(h) · la 0600 anterior no dejó la regla anterior"; exit 1; }
PMD5_VIEJA=$(pol_md5 asg_vieja)
SALIDA_V=$(psql -q -v ON_ERROR_STOP=1 -d asg_vieja -f "$MIGS/$MIGRACION2.sql" 2>&1) && { echo "❌ 4f(h) · la 0700 debía ABORTAR sobre una 0600 anterior ya registrada"; exit 1; }
echo "$SALIDA_V" | grep -qF "$DERIVA_REGLA" || { echo "❌ 4f(h) · abortó por otra cosa:"; echo "$SALIDA_V" | grep -E 'ERROR' | head -3; exit 1; }
[ "$(pol_md5 asg_vieja)" = "$PMD5_VIEJA" ] && [ "$(q "SELECT count(*) FROM pg_trigger WHERE tgname = 'trg_validar_proyecto_app_users'" asg_vieja)" = "0" ] || { echo "❌ 4f(h) · el aborto dejó piezas a medias"; exit 1; }
echo "   ✓ 4f(h) · H-04: sobre la 0600 de 8d34392b ya registrada la 0700 ABORTA («DERIVA: public.asignacion_puede_administrar no codifica la regla del principal») sin cambiar una política ni crear el trigger"
# con la 0600 vigente encima (lo que hace recrear la rama) la 0700 pasa y CONVERGE al catálogo de la cadena limpia
aplicar "$MIGS/$MIGRACION.sql" asg_vieja
aplicar "$MIGS/$MIGRACION2.sql" asg_vieja || { echo "❌ 4f(h) · con la 0600 vigente aplicada encima, la 0700 debía pasar"; exit 1; }
huella asg_vieja > "$SALIDAS/huella_vieja.txt"
diff -q "$SALIDAS/huella_fin2.txt" "$SALIDAS/huella_vieja.txt" >/dev/null || { echo "❌ 4f(h) · 0600 anterior + 0600 vigente + 0700 no converge al catálogo de la cadena limpia:"; diff "$SALIDAS/huella_fin2.txt" "$SALIDAS/huella_vieja.txt" | head -6; exit 1; }
echo "   ✓ 4f(h) · con la 0600 vigente aplicada encima la 0700 pasa y el catálogo CONVERGE al de la cadena limpia (0 diferencias en $(wc -l < "$SALIDAS/huella_vieja.txt") grupos)"
baja asg_vieja
# mutación: sin el bloque del REQUISITO/DERIVA la 0700 pasa en SILENCIO sobre la 0600 anterior (lo que ocurría) y el administrador sigue escribiendo asignaciones
copia "$BD_ANTES" asg_vieja
aplicar "$AQUI/migracion_0600_8d34392b.sql" asg_vieja
aplicar "$SALIDAS/migracion0700_sin_requisito.sql" asg_vieja || { echo "❌ 4f(h) · sin el REQUISITO la 0700 debía pasar en silencio sobre la 0600 anterior"; exit 1; }
[ "$(q "SELECT asgt.huella_total()" asg_vieja)" = "$(q "SELECT huella_total FROM asgt.snap_tabla WHERE tag = 'antes'" asg_vieja)" ] || { echo "❌ 4f(h) · la base de la mutación no está en el estado inicial"; exit 1; }
SALIDA_AX=$(PGOPTIONS="-c asgt.continuar=on" psql -q -d asg_vieja -f "$AQUI/assert_principal.sql" 2>&1 || true)
grep -q '✗.*\[A1\] AX' <<<"$SALIDA_AX" || { echo "❌ 4f(h) · sin el REQUISITO y con la 0600 anterior, assert_principal debía ver al administrador asignando proyectos (A1 de AX)"; exit 1; }
N_MUT_GUARDA=$((N_MUT_GUARDA + 1))
baja asg_vieja
echo "   ✓ 4f(h) · mutación «sin el REQUISITO»: la 0700 pasa SIN avisar sobre la 0600 anterior y el administrador (AX) sigue asignando proyectos: assert_principal se pone ROJA (la prueba ve el defecto)"
# DERIVA por cuerpo: cada forma de la regla que no es la vigente hace abortar a la 0700 (sobre la cadena con la 0600 vigente), sin cambiar una política ni crear el trigger.
#   · cuatro reglas escritas aquí (user_is_project_exempt, 'admin', current_user_role() sin is_company_owner(), sin is_super_admin());
#   · tres MUTADAS desde el cuerpo vigente de la 0600 (SQL-02 de la octava verificación). Medido con la 0700 de 898b25b7, cuya comprobación era por palabras: (a) la detectaba (nombra 'admin'),
#     pero (b) —una rama de administrador que no nombra 'admin' ni user_is_project_exempt()— y (c) —el mismo cuerpo con un comentario— pasaban EN SILENCIO. (c) no cambia el comportamiento:
#     demuestra que la comprobación es EXACTA (cualquier cambio del cuerpo aborta; si la 0600 cambia, el md5 de la 0700 cambia con ella).
deriva_aborta() {    # deriva_aborta ETIQUETA "SQL que monta la deriva" MENSAJE — sobre una copia de BD_0600, la 0700 debe ABORTAR con MENSAJE y no dejar ni una política cambiada ni el trigger
  copia "$BD_0600" asg_deriva
  psql -q -v ON_ERROR_STOP=1 -d asg_deriva -c "$2" >/dev/null
  local pmd5; pmd5=$(pol_md5 asg_deriva)
  SALIDA_D=$(psql -q -v ON_ERROR_STOP=1 -d asg_deriva -f "$MIGS/$MIGRACION2.sql" 2>&1) && { echo "❌ 4f(h) · la 0700 debía abortar con «$1»"; exit 1; }
  echo "$SALIDA_D" | grep -qF "$3" || { echo "❌ 4f(h) · abortó por otra cosa con «$1»:"; echo "$SALIDA_D" | grep ERROR | head -2; exit 1; }
  [ "$(pol_md5 asg_deriva)" = "$pmd5" ] && [ "$(pol_md5 asg_deriva)" = "$(pol_md5 "$BD_0600")" ] && [ "$(q "SELECT count(*) FROM pg_trigger WHERE tgname = 'trg_validar_proyecto_app_users'" asg_deriva)" = "0" ] \
    || { echo "❌ 4f(h) · el aborto con «$1» dejó políticas cambiadas o el trigger"; exit 1; }
  baja asg_deriva
}
REGLA_CAB0="CREATE OR REPLACE FUNCTION public.asignacion_puede_administrar(p_user_id uuid, p_project_id uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS \$\$"
for CUERPO in "SELECT COALESCE(public.is_super_admin() OR (public.user_is_project_exempt() AND public.is_company_owner()), false)" \
              "SELECT COALESCE(public.is_super_admin() OR public.current_user_role() = ANY (ARRAY['company_owner','admin']), false)" \
              "SELECT COALESCE(public.is_super_admin() OR (public.current_user_role() = 'company_owner'), false)" \
              "SELECT COALESCE(public.is_company_owner(), false)"; do
  deriva_aborta "regla $CUERPO" "$REGLA_CAB0 $CUERPO \$\$" "$DERIVA_REGLA"
done
# las mutaciones del cuerpo vigente (perl sobre el CREATE OR REPLACE FUNCTION de la 0600; mutar_funcion exige que cambien algo): una rama más dentro del COALESCE, o un comentario
REGLA_MAS_ADMIN='s/\),\n    false\n  \)/)\n    OR public.current_user_role() = \x27admin\x27,\n    false\n  )/'
REGLA_MAS_SIN_ADMIN='s/\),\n    false\n  \)/)\n    OR public.has_admin_project_access(p_project_id),\n    false\n  )/'
REGLA_MAS_COMENTARIO='s/(\n  SELECT COALESCE\()/\n  -- un comentario añadido: el comportamiento es idéntico, el cuerpo no$1/'
deriva_aborta "(a) el cuerpo vigente + OR current_user_role() = 'admin'" "$(mutar_funcion asignacion_puede_administrar "$REGLA_MAS_ADMIN")" "$DERIVA_REGLA"
deriva_aborta "(b) el cuerpo vigente + OR has_admin_project_access(p_project_id) (una rama de administrador que no nombra 'admin')" "$(mutar_funcion asignacion_puede_administrar "$REGLA_MAS_SIN_ADMIN")" "$DERIVA_REGLA"
deriva_aborta "(c) el cuerpo vigente con un comentario añadido" "$(mutar_funcion asignacion_puede_administrar "$REGLA_MAS_COMENTARIO")" "$DERIVA_REGLA"
echo "   ✓ 4f(h) · la 0700 ABORTA con DERIVA («su cuerpo (md5 …) no es el de la 20261026000600 vigente») ante cuatro reglas que no son la del principal y ante tres mutaciones del cuerpo vigente: (a) + OR current_user_role() = 'admin', (b) + OR has_admin_project_access() —sin nombrar 'admin'— y (c) un comentario añadido: la comprobación es EXACTA, cualquier cambio del cuerpo aborta; ninguna política cambia y el trigger no se crea"
# DERIVA por políticas: las de escritura de user_project_assignments (FOR ALL incluida) deben ser EXACTAMENTE las tres de la 0600. Medido con la 0700 de 898b25b7 (miraba sólo a/w/d y que la
# expresión CONTUVIERA el nombre): la primera abortaba y las otras cuatro pasaban EN SILENCIO —«regla OR true», una FOR ALL nueva, «true OR regla» en DELETE y una copia «_v2» de la regla con OR true—.
deriva_aborta "INSERT con WITH CHECK (user_id = auth.uid()): el hueco original reabierto a mano" \
  "ALTER POLICY user_project_assignments_insert ON public.user_project_assignments WITH CHECK (user_id = (SELECT auth.uid()))" "$DERIVA_POLITICAS"
deriva_aborta "INSERT con WITH CHECK (asignacion_puede_administrar(…) OR true)" \
  "ALTER POLICY user_project_assignments_insert ON public.user_project_assignments WITH CHECK (public.asignacion_puede_administrar(user_id, project_id) OR true)" "$DERIVA_POLITICAS"
deriva_aborta "una política nueva FOR ALL USING (true) WITH CHECK (true)" \
  "CREATE POLICY zz_asg_todo ON public.user_project_assignments FOR ALL TO authenticated USING (true) WITH CHECK (true)" "$DERIVA_POLITICAS"
deriva_aborta "DELETE con USING (true OR asignacion_puede_administrar(…))" \
  "ALTER POLICY user_project_assignments_delete ON public.user_project_assignments USING (true OR public.asignacion_puede_administrar(user_id, project_id))" "$DERIVA_POLITICAS"
REGLA_V2='s/public\.asignacion_puede_administrar\(/public.asignacion_puede_administrar_v2(/; s/\),\n    false\n  \)/)\n    OR true,\n    false\n  )/'
deriva_aborta "UPDATE con una copia asignacion_puede_administrar_v2 de la regla (+ OR true)" \
  "$(mutar_funcion asignacion_puede_administrar "$REGLA_V2"); ALTER POLICY user_project_assignments_update ON public.user_project_assignments USING (public.asignacion_puede_administrar_v2(user_id, project_id)) WITH CHECK (public.asignacion_puede_administrar_v2(user_id, project_id))" "$DERIVA_POLITICAS"
echo "   ✓ 4f(h) · la 0700 ABORTA con DERIVA («… exactamente como la 20261026000600 vigente, y no puede haber otras de escritura») ante cinco políticas de escritura de las asignaciones que no son las de la 0600: user_id = auth.uid(), «regla OR true», una FOR ALL USING (true), «true OR regla» en DELETE y una regla «_v2» con OR true en UPDATE; ninguna política cambia y el trigger no se crea"
# mutación 1: SIN la comprobación del md5 del cuerpo, la regla (a) —un administrador escribe asignaciones— pasa en silencio y assert_principal se pone ROJA (AX asigna proyectos: A1)
perl -0pe 's/  IF md5\(v_regla\) <> \x27[0-9a-f]{32}\x27 THEN\n.*?\n  END IF;\n//s' "$MIGS/$MIGRACION2.sql" > "$SALIDAS/migracion0700_sin_md5.sql"
! grep -q 'IF md5(v_regla)' "$SALIDAS/migracion0700_sin_md5.sql" && grep -q 'IF v_pol_asg IS DISTINCT FROM v_pol_asg_esp' "$SALIDAS/migracion0700_sin_md5.sql" || { echo "❌ 4f(h) · no se pudo quitar sólo la comprobación del md5 del cuerpo"; exit 1; }
copia "$BD_0600" asg_deriva
psql -q -v ON_ERROR_STOP=1 -d asg_deriva -c "$(mutar_funcion asignacion_puede_administrar "$REGLA_MAS_ADMIN")" >/dev/null
aplicar "$SALIDAS/migracion0700_sin_md5.sql" asg_deriva || { echo "❌ 4f(h) · sin la comprobación del md5 la 0700 debía pasar en silencio con la regla (a)"; exit 1; }
SALIDA_AX=$(PGOPTIONS="-c asgt.continuar=on" psql -q -d asg_deriva -f "$AQUI/assert_principal.sql" 2>&1 || true)
grep -q '✗.*\[A1\] AX' <<<"$SALIDA_AX" || { echo "❌ 4f(h) · sin la comprobación del md5 y con la regla (a), assert_principal debía ver al administrador asignando proyectos (A1 de AX)"; exit 1; }
N_MUT_GUARDA=$((N_MUT_GUARDA + 1))
baja asg_deriva
echo "   ✓ 4f(h) · mutación «sin la comprobación del md5 del cuerpo»: con la regla (a) la 0700 pasa SIN avisar y el administrador (AX) asigna proyectos: assert_principal se pone ROJA (la prueba ve el defecto)"
# mutación 2: la comprobación de políticas VIEJA (la de 898b25b7: sólo a/w/d y que la expresión contenga el nombre de la regla; se adapta sólo el tipo de v_pol_asg, text): con «regla OR true» en
# INSERT la 0700 pasa en silencio y assert_principal se pone ROJA (AX asigna proyectos: A1)
POL_VIEJA="  SELECT string_agg(p.polname::text, ', ' ORDER BY p.polname) INTO v_pol_asg
    FROM pg_policy p
   WHERE p.polrelid = to_regclass('public.user_project_assignments')
     AND p.polcmd IN ('a', 'w', 'd')
     AND COALESCE(pg_get_expr(p.polqual, p.polrelid), '') || ' ' || COALESCE(pg_get_expr(p.polwithcheck, p.polrelid), '') !~ 'asignacion_puede_administrar';
  IF v_pol_asg IS NOT NULL OR (SELECT count(*) FROM pg_policy p WHERE p.polrelid = to_regclass('public.user_project_assignments') AND p.polcmd IN ('a', 'w', 'd')) <> 3 THEN
    RAISE EXCEPTION 'autoridad_principal_empresa (pre-vuelo): DERIVA (comprobación vieja): %', COALESCE(v_pol_asg, 'no hay exactamente tres');
  END IF;
" perl -0pe 's/  SELECT string_agg\(p\.polname \|\| \x27:\x27.*?\n  END IF;\n/$ENV{POL_VIEJA}/s' "$MIGS/$MIGRACION2.sql" > "$SALIDAS/migracion0700_politicas_viejas.sql"
! grep -q 'v_pol_asg IS DISTINCT FROM v_pol_asg_esp' "$SALIDAS/migracion0700_politicas_viejas.sql" && grep -q "AND p.polcmd IN ('a', 'w', 'd')" "$SALIDAS/migracion0700_politicas_viejas.sql" && grep -q 'IF md5(v_regla)' "$SALIDAS/migracion0700_politicas_viejas.sql" \
  || { echo "❌ 4f(h) · no se pudo poner la comprobación de políticas vieja"; exit 1; }
copia "$BD_0600" asg_deriva
psql -q -v ON_ERROR_STOP=1 -d asg_deriva -c "ALTER POLICY user_project_assignments_insert ON public.user_project_assignments WITH CHECK (public.asignacion_puede_administrar(user_id, project_id) OR true)" >/dev/null
aplicar "$SALIDAS/migracion0700_politicas_viejas.sql" asg_deriva || { echo "❌ 4f(h) · con la comprobación de políticas vieja la 0700 debía pasar en silencio con «regla OR true»"; exit 1; }
SALIDA_AX=$(PGOPTIONS="-c asgt.continuar=on" psql -q -d asg_deriva -f "$AQUI/assert_principal.sql" 2>&1 || true)
grep -q '✗.*\[A1\] AX' <<<"$SALIDA_AX" || { echo "❌ 4f(h) · con la comprobación de políticas vieja y «regla OR true», assert_principal debía ver al administrador asignando proyectos (A1 de AX)"; exit 1; }
N_MUT_GUARDA=$((N_MUT_GUARDA + 1))
baja asg_deriva
echo "   ✓ 4f(h) · mutación «la comprobación de políticas vieja» (sólo a/w/d y que la expresión nombre la regla): con «regla OR true» en INSERT la 0700 pasa SIN avisar y el administrador (AX) asigna proyectos: assert_principal se pone ROJA (la prueba ve el defecto)"

echo "── 5/10 · DATOS COMO PRODUCCIÓN: las 43 filas y el alcance de cada persona, antes y después"
PGOPTIONS="-c client_min_messages=warning" psql -q -v ON_ERROR_STOP=1 -v tag=despues -d "$BD" -f "$AQUI/snapshot.sql" >/dev/null
bloque assert_datos_produccion.sql "5 · huella md5, fila a fila, can_access_project, user_is_project_exempt y lectura de las 39 personas"
copia "$BD" "$BD_POST"
if [ "${ASG_CARGA:-}" = "1" ]; then
  # Mediciones de carga (V3-01, D-15), NO la suite: tres variantes del candado sobre copias de la base con la migración —«empresa» (la migración), «global» (la versión b9b630b1) y «sin» (sin candado)—
  # y los escenarios de carga/medir.sh. Cifras de referencia que se pueden repetir con este mismo comando.
  echo "── MEDICIONES DE CARGA (ASG_CARGA=1; no forma parte de la suite)"
  for variante in empresa global sin; do
    copia "$BD_POST" "asg_carga_$variante"
    case "$variante" in
      global) psql -q -v ON_ERROR_STOP=1 -d asg_carga_global -c "$(mutar_funcion asignacion_bloquear_propia "$CANDADO_GLOBAL; $SIN_LOCK_TIMEOUT")" >/dev/null ;;     # como b9b630b1: una clave y sin lock_timeout propio
      sin)    psql -q -v ON_ERROR_STOP=1 -d asg_carga_sin    -c "$(mutar_funcion asignacion_bloquear_propia "$QUITAR_CANDADO")" >/dev/null ;;
    esac
    # shellcheck disable=SC2086
    PGDATABASE="asg_carga_$variante" ASG_CARGA_ETIQUETA="$variante" bash "$AQUI/carga/medir.sh" ${ASG_CARGA_ESCENARIOS:-dos-empresas misma-empresa costo interbloqueos}
  done
  exit 0
fi
# los flujos de la pantalla, con las migraciones: los del PRINCIPAL (3 propietario, 4 superadministrador, 6 propietario de otra empresa, 8 otra empresa) dan el MISMO resultado; cambian los de actor
# ADMINISTRADOR (1, 2, 5 y 9: el servidor ya no los deja escribir) y los 5 de autoedición ([flujo 7]). Decisión del dueño del negocio, 2026-10-11: sólo el principal asigna.
PGOPTIONS="-c asgt.mostrar=on" psql -q -d "$BD_POST" -f "$AQUI/assert_flujos.sql" 2>&1 | sed -n 's/.*NOTICE:  MUESTRA|//p' > "$SALIDAS/flujos_despues.txt"
DISTINTOS=$(diff "$SALIDAS/flujos_antes.txt" "$SALIDAS/flujos_despues.txt" | grep -c '^<' || true)
PRINCIPAL_DISTINTOS=$(diff "$SALIDAS/flujos_antes.txt" "$SALIDAS/flujos_despues.txt" | grep '^<' | grep -vc '\[flujo [12579]\]' || true)
ADMIN_DISTINTOS=$(diff "$SALIDAS/flujos_antes.txt" "$SALIDAS/flujos_despues.txt" | grep '^<' | grep -c '\[flujo [1259]\]' || true)
TOTAL_FLUJOS=$(wc -l < "$SALIDAS/flujos_despues.txt")
[ "$TOTAL_FLUJOS" -eq 28 ] || { echo "❌ se esperaban 28 flujos, hay $TOTAL_FLUJOS"; exit 1; }
[ "$PRINCIPAL_DISTINTOS" -eq 0 ] || { echo "❌ un flujo del PRINCIPAL (o de otra empresa) cambió con las migraciones:"; diff "$SALIDAS/flujos_antes.txt" "$SALIDAS/flujos_despues.txt" | grep '^<' | grep -v '\[flujo [12579]\]'; exit 1; }
[ "$ADMIN_DISTINTOS" -eq 13 ] || { echo "❌ debían cambiar exactamente los 13 flujos de actor administrador ([flujo 1], [flujo 2], [flujo 5], [flujo 9]) y cambiaron $ADMIN_DISTINTOS"; exit 1; }
[ "$DISTINTOS" -eq 18 ] || { echo "❌ debían cambiar exactamente 18 flujos (13 de actor administrador + 5 de autoedición) y cambiaron $DISTINTOS"; exit 1; }
echo "   ✓ de $TOTAL_FLUJOS flujos de la pantalla, $((TOTAL_FLUJOS - DISTINTOS)) dan EXACTAMENTE el mismo resultado antes y después (los del principal y de otra empresa); cambian $DISTINTOS: los $ADMIN_DISTINTOS de actor administrador (el servidor ya no los deja escribir) y los 5 de autoedición ([flujo 7])"

echo "── 6/10 · invariantes de una sesión"
bloque assert_catalogo.sql   "6a · catálogo y privilegios: 4 políticas, 2 triggers, 3 funciones, anon sin nada, authenticated sin TRUNCATE/TRIGGER/REFERENCES; las 18 políticas de la 0700" "$BD_POST"
bloque assert_matriz.sql     "6b · matriz rol × operación × objetivo (INSERT, UPDATE, DELETE, UPSERT, INSERT … SELECT) con código de error y control: sólo el principal escribe" "$BD_POST"
bloque assert_flujos.sql     "6c · flujos de la pantalla (borrar todas + insertar, y por diferencias) por rol; lectura de las propias" "$BD_POST"
bloque assert_alcance.sql    "6d · efecto sobre el alcance: 290 intentos de autoasignación, 84 de borrar/cambiar lo propio, nadie se vuelve exento" "$BD_POST"
bloque assert_capas.sql      "6e · las políticas SOLAS (sin triggers) ya cierran el hueco" "$BD_POST"
bloque assert_defensa.sql    "6f · los triggers SOLOS (con una política «true») lo siguen cerrando" "$BD_POST"
bloque assert_principal.sql  "6g · el principal: 10 actores × 35 escrituras sensibles (invitaciones «admin» —también su lectura—, app_users, proyectos, roles, llaves, asignaciones de roles y de proyecto), el proyecto de app_users, la otra empresa, sin app_users y el rol RBAC de administrador" "$BD_POST"
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

echo "── 8/10 · REVERSIONES (la de la 0600 y la de la 0700): exactas con la ACL de producción, juntas y por separado"
# 8a · la reversión de la 0600 SOLA, sobre la base con sólo la 0600 (scripts/reversion-asignaciones-proyecto.sql)
copia "$BD_0600" asg_rev
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

# 8b · la reversión también es independiente del search_path (R2-3): su post-vuelo contaba las políticas con «auth\.uid» y, con auth en el search_path, abortaba con
#      «las políticas no quedaron como las originales» sin que nada estuviera mal. Se revierte con auth en el search_path y se MUTA la comprobación (la vieja).
copia "$BD_0600" asg_rev_sp
aplicar_sp "$REVERSION" asg_rev_sp "auth,public" || { echo "❌ 8b · la reversión abortó con auth en el search_path"; exit 1; }
huella asg_rev_sp > "$SALIDAS/huella_rev_sp.txt"
diff -q "$SALIDAS/huella_antes.txt" "$SALIDAS/huella_rev_sp.txt" >/dev/null || { echo "❌ 8b · con auth en el search_path la reversión no deja el catálogo como estaba"; diff "$SALIDAS/huella_antes.txt" "$SALIDAS/huella_rev_sp.txt" | head; exit 1; }
perl -pe 's/~ v_re_uid\)/~ \x27auth\\.uid\x27)/' "$REVERSION" > "$SALIDAS/reversion_regex_vieja.sql"
[ "$(grep -c "~ 'auth\\\\.uid'" "$SALIDAS/reversion_regex_vieja.sql")" -eq 1 ] || { echo "❌ 8b · no se pudo preparar la reversión con la comprobación vieja"; exit 1; }
copia "$BD_0600" asg_rev_sp
SALIDA_RSP=$(PGOPTIONS="-c search_path=auth,public" psql -q -v ON_ERROR_STOP=1 -d asg_rev_sp -f "$SALIDAS/reversion_regex_vieja.sql" 2>&1) && { echo "❌ 8b · la reversión con la comprobación vieja debía abortar con auth en el search_path"; exit 1; }
echo "$SALIDA_RSP" | grep -q 'las políticas no quedaron como las originales' || { echo "❌ 8b · abortó por otra cosa:"; echo "$SALIDA_RSP" | grep ERROR | head -3; exit 1; }
[ "$(q "SELECT count(*) FROM pg_proc WHERE proname LIKE 'asignacion\\_%'" asg_rev_sp)" = "3" ] || { echo "❌ 8b · el aborto de la reversión no dejó el estado migrado intacto (3 funciones)"; exit 1; }
copia "$BD_0600" asg_rev_sp
aplicar "$SALIDAS/reversion_regex_vieja.sql" asg_rev_sp || { echo "❌ 8b · la reversión vieja debía pasar con el search_path normal"; exit 1; }
N_MUT_GUARDA=$((N_MUT_GUARDA + 1))
baja asg_rev_sp
echo "   ✓ 8b · con auth en el search_path la reversión se aplica y deja el MISMO catálogo que antes de la migración; la comprobación vieja ABORTA ahí («las políticas no quedaron como las originales») sin deshacer nada y pasa con el search_path normal"
# 8c · y con un search_path VACÍO o sin public (V3-04): CREATE POLICY resuelve los nombres al crearla, así que el texto original va CALIFICADO (public.is_super_admin()…). Se prueba con varios search_path
#      y se MUTA la reversión (los nombres sin calificar, como estaban): con un search_path vacío ABORTA con «function is_super_admin() does not exist» y con auth,public pasa.
for SP in "" "public" "pg_catalog" '"$user",public' "auth,public,extensions"; do
  copia "$BD_0600" asg_rev_sp
  aplicar_sp "$REVERSION" asg_rev_sp "$SP" || { echo "❌ 8c · la reversión abortó con search_path='$SP'"; exit 1; }
  huella asg_rev_sp > "$SALIDAS/huella_rev_sp2.txt"
  diff -q "$SALIDAS/huella_antes.txt" "$SALIDAS/huella_rev_sp2.txt" >/dev/null || { echo "❌ 8c · con search_path='$SP' la reversión no deja el catálogo como estaba"; diff "$SALIDAS/huella_antes.txt" "$SALIDAS/huella_rev_sp2.txt" | head; exit 1; }
  [ "$(q "SELECT string_agg(polname || '=' || md5(COALESCE(pg_get_expr(polqual, polrelid), '') || '|' || COALESCE(pg_get_expr(polwithcheck, polrelid), '')), ',' ORDER BY polname) FROM pg_policy WHERE polrelid = 'public.user_project_assignments'::regclass" asg_rev_sp)" = "$POLITICAS_ANTES" ] \
    || { echo "❌ 8c · con search_path='$SP' el árbol de las políticas revertidas no es el original"; exit 1; }
done
perl -pe 's/\bpublic\.(is_super_admin|current_user_role|get_my_company_id)\(/$1(/g; s/FROM public\.projects WHERE company_id/FROM projects WHERE company_id/' "$REVERSION" > "$SALIDAS/reversion_sin_calificar.sql"
[ "$(grep -c 'public\.is_super_admin()' "$SALIDAS/reversion_sin_calificar.sql")" -eq 0 ] && [ "$(grep -c 'FROM projects WHERE company_id' "$SALIDAS/reversion_sin_calificar.sql")" -eq 5 ] || { echo "❌ 8c · no se pudo preparar la reversión sin calificar"; exit 1; }
copia "$BD_0600" asg_rev_sp
SALIDA_RSQ=$(PGOPTIONS="-c search_path=" psql -q -v ON_ERROR_STOP=1 -d asg_rev_sp -f "$SALIDAS/reversion_sin_calificar.sql" 2>&1) && { echo "❌ 8c · la reversión sin calificar debía abortar con un search_path vacío"; exit 1; }
echo "$SALIDA_RSQ" | grep -q 'function is_super_admin() does not exist' || { echo "❌ 8c · abortó por otra cosa:"; echo "$SALIDA_RSQ" | grep ERROR | head -3; exit 1; }
[ "$(q "SELECT count(*) FROM pg_proc WHERE proname LIKE 'asignacion\\_%'" asg_rev_sp)" = "3" ] || { echo "❌ 8c · el aborto de la reversión sin calificar no dejó el estado migrado intacto (3 funciones)"; exit 1; }
copia "$BD_0600" asg_rev_sp
aplicar_sp "$SALIDAS/reversion_sin_calificar.sql" asg_rev_sp "auth,public" || { echo "❌ 8c · la reversión sin calificar debía pasar con auth,public (el defecto era del search_path vacío)"; exit 1; }
N_MUT_GUARDA=$((N_MUT_GUARDA + 1))
baja asg_rev_sp
echo "   ✓ 8c · la reversión se aplica con search_path vacío, «public», «pg_catalog», «\"\$user\", public» y «auth,public,extensions» y deja el MISMO catálogo (y el mismo árbol de políticas) que antes de la migración; sin calificar los nombres (V3-04) ABORTA con search_path vacío («function is_super_admin() does not exist») y pasa con auth,public"
baja asg_rev

# 8d · la reversión de la 0700 SOLA (scripts/reversion-principal-empresa.sql), sobre la base con las dos migraciones: deja el catálogo de «sólo la 0600» y las 18 políticas con el md5 de PRODUCCIÓN
copia "$BD_POST" asg_rev7
aplicar "$REVERSION2" asg_rev7
aplicar "$REVERSION2" asg_rev7          # idempotente
huella asg_rev7 > "$SALIDAS/huella_rev7.txt"
diff -q "$SALIDAS/huella_post2.txt" "$SALIDAS/huella_rev7.txt" >/dev/null || { echo "❌ 8d · la reversión de la 0700 no deja el catálogo como con la 0600 sola:"; diff "$SALIDAS/huella_post2.txt" "$SALIDAS/huella_rev7.txt" | head -6; exit 1; }
[ "$(pol_md5 asg_rev7)" = "$(cat "$POL_PROD")" ] || { echo "❌ 8d · las 18 políticas revertidas no tienen el md5 de producción:"; diff <(pol_md5 asg_rev7) "$POL_PROD" | head -6; exit 1; }
echo "   ✓ 8d · la reversión de la 0700 (dos veces) deja el catálogo IDÉNTICO al de «sólo la 0600» (0 diferencias en $(wc -l < "$SALIDAS/huella_rev7.txt") grupos) y las 18 políticas con el md5 EXACTO de producción (el SELECT del 2026-10-11)"
SALIDA_REV7=$(PGOPTIONS="-c asgt.continuar=on" psql -q -d asg_rev7 -f "$AQUI/assert_principal.sql" 2>&1 || true)
[ "$(echo "$SALIDA_REV7" | grep -c '✗' || true)" -eq "$ROJOS_PRIN_0600" ] || { echo "❌ 8d · revertida la 0700, el principal debía tener los mismos $ROJOS_PRIN_0600 casos ROJOS que con la 0600 sola y tiene $(echo "$SALIDA_REV7" | grep -c '✗' || true)"; exit 1; }
echo "   ✓ 8d · revertida la 0700 el principal vuelve a los mismos $ROJOS_PRIN_0600 casos ROJOS que con la 0600 sola (la reversión reabre exactamente los huecos de proyectos, roles, llaves e invitaciones)"
aplicar "$MIGS/$MIGRACION2.sql" asg_rev7
huella asg_rev7 > "$SALIDAS/huella_rev7_reaplicada.txt"
diff -q "$SALIDAS/huella_fin2.txt" "$SALIDAS/huella_rev7_reaplicada.txt" >/dev/null || { echo "❌ 8d · reaplicar la 0700 tras revertir no deja el catálogo de las dos migraciones"; exit 1; }
echo "   ✓ 8d · y volver a aplicar la 0700 tras revertir deja el catálogo IDÉNTICO al de las dos migraciones (ciclo completo)"
baja asg_rev7
# la reversión de la 0700 también es independiente del search_path (los nombres van calificados public.*) y se MUTA: sin calificar aborta con un search_path vacío
for SP in "" "public" "pg_catalog" '"$user",public' "auth,public,extensions"; do
  copia "$BD_POST" asg_rev_sp
  aplicar_sp "$REVERSION2" asg_rev_sp "$SP" || { echo "❌ 8d · la reversión de la 0700 abortó con search_path='$SP'"; exit 1; }
  [ "$(pol_md5 asg_rev_sp)" = "$(cat "$POL_PROD")" ] || { echo "❌ 8d · con search_path='$SP' la reversión de la 0700 no deja el texto de producción"; exit 1; }
done
perl -pe 's/\bpublic\.(is_super_admin|current_user_role|get_my_company_id)\(/$1(/g unless /to_regprocedure/' "$REVERSION2" > "$SALIDAS/reversion7_sin_calificar.sql"
[ "$(grep -v 'to_regprocedure' "$SALIDAS/reversion7_sin_calificar.sql" | grep -c 'public\.is_super_admin()')" -eq 0 ] || { echo "❌ 8d · no se pudo preparar la reversión de la 0700 sin calificar"; exit 1; }
copia "$BD_POST" asg_rev_sp
SALIDA_R7Q=$(PGOPTIONS="-c search_path=" psql -q -v ON_ERROR_STOP=1 -d asg_rev_sp -f "$SALIDAS/reversion7_sin_calificar.sql" 2>&1) && { echo "❌ 8d · la reversión de la 0700 sin calificar debía abortar con un search_path vacío"; exit 1; }
echo "$SALIDA_R7Q" | grep -q 'function is_super_admin() does not exist' || { echo "❌ 8d · abortó por otra cosa:"; echo "$SALIDA_R7Q" | grep ERROR | head -3; exit 1; }
[ "$(pol_md5 asg_rev_sp)" = "$(pol_md5 "$BD_POST")" ] || { echo "❌ 8d · el aborto de la reversión de la 0700 no dejó el estado migrado intacto"; exit 1; }
N_MUT_GUARDA=$((N_MUT_GUARDA + 1))
baja asg_rev_sp
echo "   ✓ 8d · la reversión de la 0700 se aplica con search_path vacío, «public», «pg_catalog», «\"\$user\", public» y «auth,public,extensions» y deja el texto de producción; sin calificar los nombres ABORTA con un search_path vacío y no deshace nada"

# 8e · JUNTAS y por separado, en los dos órdenes: las dos reversiones dejan el catálogo de ANTES de la serie; la 0600 sola, con la 0700 puesta, deja el catálogo de «sólo la 0700»
copia "$BD_POST" asg_rev
aplicar "$REVERSION2" asg_rev; aplicar "$REVERSION" asg_rev
huella asg_rev > "$SALIDAS/huella_juntas_a.txt"
diff -q "$SALIDAS/huella_antes.txt" "$SALIDAS/huella_juntas_a.txt" >/dev/null || { echo "❌ 8e · 0700 y luego 0600 no dejan el catálogo como estaba:"; diff "$SALIDAS/huella_antes.txt" "$SALIDAS/huella_juntas_a.txt" | head -6; exit 1; }
copia "$BD_POST" asg_rev
aplicar "$REVERSION" asg_rev; aplicar "$REVERSION2" asg_rev
huella asg_rev > "$SALIDAS/huella_juntas_b.txt"
diff -q "$SALIDAS/huella_antes.txt" "$SALIDAS/huella_juntas_b.txt" >/dev/null || { echo "❌ 8e · 0600 y luego 0700 no dejan el catálogo como estaba:"; diff "$SALIDAS/huella_antes.txt" "$SALIDAS/huella_juntas_b.txt" | head -6; exit 1; }
copia "$BD_POST" asg_rev
aplicar "$REVERSION" asg_rev
huella asg_rev > "$SALIDAS/huella_rev600_con700.txt"
diff -q "$SALIDAS/huella_solo0700.txt" "$SALIDAS/huella_rev600_con700.txt" >/dev/null || { echo "❌ 8e · revertir sólo la 0600 con la 0700 puesta no deja el catálogo de «sólo la 0700»:"; diff "$SALIDAS/huella_solo0700.txt" "$SALIDAS/huella_rev600_con700.txt" | head -6; exit 1; }
[ "$(q "SELECT asgt.huella_total()" asg_rev)" = "$(q "SELECT huella_total FROM asgt.snap_tabla WHERE tag = 'antes'" asg_rev)" ] || { echo "❌ 8e · las reversiones tocaron filas"; exit 1; }
baja asg_rev
echo "   ✓ 8e · JUNTAS (0700 → 0600 y 0600 → 0700) dejan el catálogo IDÉNTICO al de antes de la serie ($(wc -l < "$SALIDAS/huella_antes.txt") grupos, 0 diferencias); POR SEPARADO, revertir sólo la 0600 con la 0700 puesta deja el catálogo de «sólo la 0700»; las 43 filas intactas"

echo "── 9/10 · MUTACIONES: se revierte a mano cada pieza y alguna aserción se pone ROJA"
ARCHIVOS_MUT="assert_catalogo assert_matriz assert_flujos assert_alcance assert_capas assert_defensa assert_principal"
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
REGLA_CAB="CREATE OR REPLACE FUNCTION public.asignacion_puede_administrar(p_user_id uuid, p_project_id uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS \$\$"
PERSONA_DE_MI_EMPRESA="EXISTS (SELECT 1 FROM public.app_users u WHERE u.id = p_user_id AND u.company_id = public.get_my_company_id())"
PROYECTO_DE_MI_EMPRESA="EXISTS (SELECT 1 FROM public.projects pr WHERE pr.id = p_project_id AND pr.company_id = public.get_my_company_id())"
mutacion "la regla concede todo (SELECT true)" \
  "$REGLA_CAB SELECT true \$\$" \
  "assert_catalogo assert_matriz assert_capas assert_principal"
mutacion "M-a · la regla vuelve a admitir al ADMINISTRADOR (D-2 reabierto: la versión anterior, a otras personas y sólo en proyectos que él ve)" \
  "$REGLA_CAB SELECT COALESCE(public.is_super_admin() OR (public.current_user_role() = ANY (ARRAY['company_owner','admin']) AND (public.current_user_role() = 'company_owner' OR p_user_id IS DISTINCT FROM (SELECT auth.uid())) AND $PERSONA_DE_MI_EMPRESA AND $PROYECTO_DE_MI_EMPRESA AND (public.user_is_project_exempt() OR public.user_has_project_access(p_project_id))), false) \$\$" \
  "assert_catalogo assert_matriz assert_flujos assert_capas assert_principal"
mutacion "M-a2 · la regla admite al administrador sin la condición de «proyectos que él ve» (cualquier administrador de la empresa, D-2 y la colusión)" \
  "$REGLA_CAB SELECT COALESCE(public.is_super_admin() OR (public.current_user_role() = ANY (ARRAY['company_owner','admin']) AND $PERSONA_DE_MI_EMPRESA AND $PROYECTO_DE_MI_EMPRESA), false) \$\$" \
  "assert_catalogo assert_matriz assert_flujos assert_capas assert_principal"
mutacion "M-b · «principal» = user_is_project_exempt(): el administrador SIN FILAS (exento) contaría como principal, y ese estado se fabrica sin serlo" \
  "$REGLA_CAB SELECT COALESCE(public.is_super_admin() OR (public.user_is_project_exempt() AND $PERSONA_DE_MI_EMPRESA AND $PROYECTO_DE_MI_EMPRESA), false) \$\$" \
  "assert_catalogo assert_matriz assert_flujos assert_capas assert_principal"
mutacion "M-c · el propietario pierde la comprobación de empresa (is_company_owner() a secas): el de D administraría a las personas y proyectos de C" \
  "$REGLA_CAB SELECT COALESCE(public.is_super_admin() OR public.is_company_owner(), false) \$\$" \
  "assert_catalogo assert_matriz assert_capas assert_principal"
mutacion "la regla no exige que la persona sea de la empresa (el propietario borraría las filas huérfanas y las de otra empresa)" \
  "$REGLA_CAB SELECT COALESCE(public.is_super_admin() OR (public.is_company_owner() AND $PROYECTO_DE_MI_EMPRESA), false) \$\$" \
  "assert_matriz assert_capas"
mutacion "la regla no exige que el proyecto sea de la empresa (sólo lo frenaría el trigger de integridad)" \
  "$REGLA_CAB SELECT COALESCE(public.is_super_admin() OR (public.is_company_owner() AND $PERSONA_DE_MI_EMPRESA), false) \$\$" \
  "assert_capas"
mutacion "la regla sin COALESCE: devuelve NULL, no false, para una sesión sin app_users o sin sesión" \
  "$REGLA_CAB SELECT public.is_super_admin() OR (public.is_company_owner() AND $PERSONA_DE_MI_EMPRESA AND $PROYECTO_DE_MI_EMPRESA) \$\$" \
  "assert_catalogo assert_principal"
mutacion "la regla sólo admite al superadministrador (el propietario queda sin su propia empresa)" \
  "$REGLA_CAB SELECT COALESCE(public.is_super_admin(), false) \$\$" \
  "assert_catalogo assert_matriz assert_flujos assert_capas assert_principal"
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
mutacion "F-08 · la baja en cascada se permite SIN comprobar que el proyecto ya no existe: borrar UNA fila propia pasa mientras quede otra" \
  "$(mutar_funcion asignacion_bloquear_propia 's/\n\s*AND NOT EXISTS \(SELECT 1 FROM public\.projects p WHERE p\.id = OLD\.project_id\)//')" \
  "assert_defensa"
mutacion "F3 · el trigger de autoasignación sin COALESCE: para una sesión sin app_users (rol NULL) el IF da NULL y falla ABIERTO" \
  "$(mutar_funcion asignacion_bloquear_propia 's/COALESCE\(public\.is_super_admin\(\), false\) OR COALESCE\(public\.current_user_role\(\) = \x27company_owner\x27, false\)/public.is_super_admin() OR public.current_user_role() = \x27company_owner\x27/')" \
  "assert_defensa"
mutacion "F1/R2-1 · se quita el candado de la baja en cascada (las carreras de abajo, en la sección 10, lo detectan con sesiones reales; aquí lo ve el comportamiento: la baja ya no retiene ningún candado)" \
  "$(mutar_funcion asignacion_bloquear_propia "$QUITAR_CANDADO")" \
  "assert_catalogo"
mutacion "V3-01 · el candado vuelve a ser GLOBAL (una sola clave para todas las empresas: un propietario retiene las bajas de las demás; aquí lo ve la clave retenida, que ya no cambia de empresa a empresa)" \
  "$(mutar_funcion asignacion_bloquear_propia "$CANDADO_GLOBAL")" \
  "assert_catalogo"
mutacion "V3-03 M-c · el candado se toma también en un borrado DIRECTO de una asignación (el proyecto sigue existiendo): ninguna otra prueba lo notaba" \
  "$(mutar_funcion asignacion_bloquear_propia "$QUITAR_CANDADO; $CANDADO_EN_TODA_BAJA")" \
  "assert_catalogo"
mutacion "V3-01 · la función pierde su lock_timeout propio (la baja esperaría hasta el statement_timeout; la espera acotada de 2 s la prueba la sección 10 con una sesión real)" \
  "$(mutar_funcion asignacion_bloquear_propia "$SIN_LOCK_TIMEOUT")" \
  "assert_catalogo"
mutacion "H-05/M6 · la clave sale de la empresa del ACTOR (get_my_company_id()) y no de la de la persona: un superadministrador de otra empresa retendría OTRA clave (la de la sección 10 lo ve con sesiones reales)" \
  "$(mutar_funcion asignacion_bloquear_propia "$CLAVE_DEL_ACTOR")" \
  "assert_catalogo"
mutacion "H-05/M7 · sin el COALESCE de «sin-empresa»: la clave de una persona sin empresa es NULL y pg_advisory_xact_lock(NULL) no bloquea nada" \
  "$(mutar_funcion asignacion_bloquear_propia "$SIN_COALESCE_SIN_EMPRESA")" \
  "assert_catalogo"

# MUTANTES DE LA 0700: cada una de las 13 políticas vuelve, UNA a UNA, a su texto de producción (el de la reversión): admite otra vez al administrador, y assert_principal y assert_catalogo se ponen en ROJO
for POL in projects_insert projects_delete roles_insert roles_update roles_delete role_permissions_insert role_permissions_delete user_roles_insert user_roles_delete user_invitations_insert user_invitations_select user_invitations_update user_invitations_delete; do
  mutacion "0700 · $POL vuelve al texto de producción (admite al administrador)" "$(politica_original "$POL")" "assert_catalogo assert_principal"
done
mutacion "0700 · TODA la 0700 revertida (scripts/reversion-principal-empresa.sql: lo que haría un revert completo)" "$(cat "$REVERSION2")" "assert_catalogo assert_principal"
mutacion "0700 · user_invitations_insert pierde sólo la condición del rol admin (el administrador vuelve a invitar administradores; el resto de lo que había se conserva)" \
  "ALTER POLICY user_invitations_insert ON public.user_invitations WITH CHECK (public.is_super_admin() OR (company_id = public.get_my_company_id() AND public.current_user_role() = ANY (ARRAY['company_owner', 'admin'])))" \
  "assert_catalogo assert_principal"
mutacion "0700 · projects_update se vuelve del principal (rompería la configuración fiscal y de cobros de los administradores: no debe cambiar)" \
  "ALTER POLICY projects_update ON public.projects USING (public.is_super_admin() OR (company_id = public.get_my_company_id() AND public.is_company_owner())) WITH CHECK (public.is_super_admin() OR (company_id = public.get_my_company_id() AND public.is_company_owner()))" \
  "assert_catalogo assert_principal"
mutacion "0700 · un SELECT (roles_select) deja de admitir al administrador: la lectura no debe cambiar" \
  "ALTER POLICY roles_select ON public.roles USING (public.is_super_admin() OR public.is_company_owner())" \
  "assert_catalogo assert_principal"
mutacion "0700 · el principal es user_is_project_exempt() en projects_insert (el administrador sin filas volvería a crear proyectos)" \
  "ALTER POLICY projects_insert ON public.projects WITH CHECK (public.is_super_admin() OR (company_id = public.get_my_company_id() AND public.user_is_project_exempt()))" \
  "assert_catalogo assert_principal"
mutacion "0700 · roles_insert pierde la condición de la empresa (el propietario de D crearía roles en C)" \
  "ALTER POLICY roles_insert ON public.roles WITH CHECK (public.is_super_admin() OR (is_system = false AND public.is_company_owner()))" \
  "assert_catalogo assert_principal"
mutacion "0700 · user_invitations_update pierde la guarda en el USING (lo que quedó tras la primera 0700: el administrador reescribe la invitación 'admin' que ve)" \
  "ALTER POLICY user_invitations_update ON public.user_invitations USING (public.is_super_admin() OR (company_id = public.get_my_company_id() AND public.current_user_role() = ANY (ARRAY['company_owner', 'admin'])))" \
  "assert_catalogo assert_principal"
mutacion "0700 · user_invitations_select USING(true): cualquier autenticado lee los tokens de las invitaciones de TODAS las empresas" \
  "ALTER POLICY user_invitations_select ON public.user_invitations USING (true)" \
  "assert_catalogo assert_principal"
mutacion "0700 · user_invitations_delete USING(true): cualquier autenticado borra las invitaciones de TODAS las empresas" \
  "ALTER POLICY user_invitations_delete ON public.user_invitations USING (true)" \
  "assert_catalogo assert_principal"
mutacion "0700 · user_invitations_update WITH CHECK(true): el administrador sube una invitación de operador a 'admin' o la mueve de empresa" \
  "ALTER POLICY user_invitations_update ON public.user_invitations WITH CHECK (true)" \
  "assert_catalogo assert_principal"

# H-05 de la quinta verificación: cinco mutantes de las políticas de la 0700 que SÓLO los detectaba el pin de texto de assert_catalogo. Ahora caen también por COMPORTAMIENTO: assert_principal
# no compara ningún texto de política (la lista de «rojas» debe incluir assert_principal por sí sola). Dos precisiones medidas al escribir los casos: (1) los casos de UPDATE y DELETE de
# invitaciones y de roles NO llevan WHERE, porque un WHERE que lee columnas ejecuta también la política SELECT sobre la fila vieja y la nueva y ésta tapa el USING/WITH CHECK del comando
# (con WHERE, un USING(true) en update o delete seguía en verde); (2) un mutante de role_permissions_insert que sólo quita la empresa del rol NO es distinguible por comportamiento: el rol
# de OTRA empresa ni siquiera es visible para el propietario (roles_select exige empresa o rol de sistema), así que el EXISTS de la política ya da falso; esa capa la cubre el texto (assert_catalogo).
mutacion "H-05/m13 · user_roles_insert sin la comprobación de assigned_by: el propietario falsea quién asignó el rol (la bitácora)" \
  "ALTER POLICY user_roles_insert ON public.user_roles WITH CHECK (public.is_super_admin() OR (EXISTS (SELECT 1 FROM public.app_users u WHERE u.id = user_roles.user_id AND u.company_id = public.get_my_company_id() AND public.is_company_owner()) AND EXISTS (SELECT 1 FROM public.roles r WHERE r.id = user_roles.role_id AND (r.is_system = true OR r.company_id = public.get_my_company_id()))))" \
  "assert_principal"
mutacion "H-05/m15 · role_permissions_insert deja al propietario escribir llaves de roles de SISTEMA" \
  "ALTER POLICY role_permissions_insert ON public.role_permissions WITH CHECK (EXISTS (SELECT 1 FROM public.roles r WHERE r.id = role_permissions.role_id AND (public.is_super_admin() OR ((r.is_system = true OR r.company_id = public.get_my_company_id()) AND public.is_company_owner()))))" \
  "assert_principal"
mutacion "H-05/m16 · role_permissions_delete deja al propietario borrar llaves de roles de SISTEMA" \
  "ALTER POLICY role_permissions_delete ON public.role_permissions USING (EXISTS (SELECT 1 FROM public.roles r WHERE r.id = role_permissions.role_id AND (public.is_super_admin() OR ((r.is_system = true OR r.company_id = public.get_my_company_id()) AND public.is_company_owner()))))" \
  "assert_principal"
mutacion "H-05/m17 · roles_update WITH CHECK sin la empresa: el propietario TRASLADA un rol de su empresa a otra" \
  "ALTER POLICY roles_update ON public.roles WITH CHECK (public.is_super_admin() OR (is_system = false AND public.is_company_owner()))" \
  "assert_principal"
mutacion "H-05/m21 · user_invitations_update USING(true): el propietario toca las invitaciones de OTRA empresa (la fila nueva se rechaza por el WITH CHECK, así que el 0 filas esperado pasa a error)" \
  "ALTER POLICY user_invitations_update ON public.user_invitations USING (true)" \
  "assert_principal"


# app_users.project_id (H-01): el trigger de integridad de la 0700 (AFTER INSERT OR UPDATE OF project_id, company_id desde SQL-01). Cada mutante lo desarma por una vía distinta y
# assert_principal (§ 8 y 8b) se pone ROJA; los que cambian su definición, también assert_catalogo.
funcion_mig7() {     # funcion_mig7 NOMBRE — como funcion_mig, pero de la 0700
  awk -v n="CREATE OR REPLACE FUNCTION public.$1(" 'index($0, n) == 1 { on = 1 } on { print } on && $0 == "$$;" { exit }' "$MIGS/$MIGRACION2.sql"
}
mutar_funcion7() {   # mutar_funcion7 NOMBRE 'expresión perl s///' — exige que la sustitución cambie algo
  local orig mut
  orig=$(funcion_mig7 "$1"); mut=$(printf '%s\n' "$orig" | perl -0pe "$2")
  [ -n "$orig" ] || { echo "❌ mutar_funcion7: no se encontró $1 en la 0700" >&2; exit 1; }
  [ "$orig" != "$mut" ] || { echo "❌ mutar_funcion7: la sustitución no cambió $1 (¿cambió su texto?)" >&2; exit 1; }
  printf '%s\n' "$mut"
}
mutacion "H-01 · se quita el trigger de app_users.project_id: el propietario fija el proyecto de OTRA empresa" \
  "DROP TRIGGER trg_validar_proyecto_app_users ON public.app_users" \
  "assert_catalogo assert_principal"
mutacion "H-01 · el trigger de app_users.project_id queda deshabilitado" \
  "ALTER TABLE public.app_users DISABLE TRIGGER trg_validar_proyecto_app_users" \
  "assert_catalogo assert_principal"
mutacion "H-01 · el trigger no compara la empresa (sólo que el proyecto exista)" \
  "$(mutar_funcion7 app_users_validar_proyecto 's/ OR v_emp_proyecto <> NEW\.company_id//')" \
  "assert_principal"
mutacion "H-01 · el trigger exime al rol de servicio y al superusuario (sin auth.uid()): el rigor «para cualquier actor» se pierde" \
  "$(mutar_funcion7 app_users_validar_proyecto 's/(\nBEGIN\n)/$1  IF auth.uid() IS NULL THEN RETURN NEW; END IF;\n/')" \
  "assert_principal"
mutacion "H-01 · el trigger deja pasar a una persona sin empresa con proyecto" \
  "$(mutar_funcion7 app_users_validar_proyecto 's/ OR NEW\.company_id IS NULL//')" \
  "assert_principal"
mutacion "H-01 · el trigger sólo se dispara al escribir project_id (cambiar la EMPRESA de una persona con proyecto lo deja con el de la anterior)" \
  "CREATE OR REPLACE TRIGGER trg_validar_proyecto_app_users AFTER INSERT OR UPDATE OF project_id ON public.app_users FOR EACH ROW EXECUTE FUNCTION public.app_users_validar_proyecto()" \
  "assert_catalogo assert_principal"
mutacion "H-01 · el trigger se dispara en TODO UPDATE (sin la lista OF): un dato heredado que ya cruza empresa impediría editar otras columnas" \
  "CREATE OR REPLACE TRIGGER trg_validar_proyecto_app_users AFTER INSERT OR UPDATE ON public.app_users FOR EACH ROW EXECUTE FUNCTION public.app_users_validar_proyecto()" \
  "assert_catalogo assert_principal"
# SQL-01 (octava verificación): el trigger vuelve a ser BEFORE, como en 898b25b7. Se ejecuta antes del WITH CHECK de la RLS y, como lee projects sin RLS, a quien la RLS rechaza le contesta
# 23514 si el par (empresa, proyecto) no casa y 42501 si casa (el oráculo): assert_principal (§ 8b: anon, visor, cliente, sin app_users, operador y administrador reciben 23514 con el par
# cruzado) y assert_catalogo (definición y tgtype del trigger) se ponen rojas. CREATE OR REPLACE TRIGGER cambia el momento del trigger existente sin quitarlo.
mutacion "SQL-01 · el trigger de app_users.project_id vuelve a BEFORE (la versión de 898b25b7): quien no puede escribir app_users averigua de qué empresa es un proyecto" \
  "CREATE OR REPLACE TRIGGER trg_validar_proyecto_app_users BEFORE INSERT OR UPDATE OF project_id, company_id ON public.app_users FOR EACH ROW EXECUTE FUNCTION public.app_users_validar_proyecto()" \
  "assert_catalogo assert_principal"

echo "── 10/10 · concurrencia: sesiones REALES simultáneas y la migración contra una transacción larga"
N_MUT_CONC=0         # mutaciones probadas con sesiones reales (D0 sin FOR SHARE en la 0600; D3/D4 sin FOR SHARE en la 0700; F1 sin candado y con el candado dentro del AND; F4 sin LOCK TABLE)
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
                     # Opcionales (variables de entorno de UNA llamada): PAR_OBS_SQL = un SELECT que se evalúa con las dos sesiones en ese estado, ANTES de soltar la puerta
                     # (su resultado queda en PAR_OBS); PAR_PLAZO = N sondeos de 50 ms durante los cuales se deja la puerta CERRADA aunque la 2 ya esté esperando, para ver
                     # si la espera termina sola (lock_timeout): ESTADO2 pasa a «terminó» si acabó dentro del plazo y T2 guarda cuántos ms pasaron desde que arrancó la 2.
  local bd="$1" n="$2" fin1="$SALIDAS/$2.fin1" fin2="$SALIDAS/$2.fin2"
  rm -f "$fin1" "$fin2"
  ctl_abrir "$bd" "$n" 1
  ( sesion "$bd" "$3" "asg_${n}_1" 1 <<<"$4" > "$SALIDAS/${n}1.txt" 2>&1 || true; touch "$fin1" ) &
  local p1=$!
  esperar_o_fin "$bd" "$(en_puerta 1)" "$fin1"
  local t_ini=$(date +%s%N)
  ( sesion "$bd" "$5" "asg_${n}_2" - <<<"$6" > "$SALIDAS/${n}2.txt" 2>&1 || true; touch "$fin2" ) &
  local p2=$!
  esperar_o_fin "$bd" "SELECT EXISTS (SELECT 1 FROM pg_stat_activity WHERE application_name = 'asg_${n}_2' AND wait_event_type = 'Lock')" "$fin2"
  if [ -e "$fin2" ]; then ESTADO2=terminó; else ESTADO2=esperando; fi
  PAR_OBS=""; [ -z "${PAR_OBS_SQL:-}" ] || PAR_OBS=$(q "$PAR_OBS_SQL" "$bd")
  T2=""
  if [ "$ESTADO2" = esperando ] && [ -n "${PAR_PLAZO:-}" ]; then
    local i
    for i in $(seq 1 "$PAR_PLAZO"); do [ -e "$fin2" ] && break; sleep 0.05; done
    T2=$(( ($(date +%s%N) - t_ini) / 1000000 ))
    if [ -e "$fin2" ]; then ESTADO2=terminó; fi
  fi
  ctl_soltar 1
  wait $p1 $p2 || true
}
sin_deadlock() { ! cat "$SALIDAS/${1}1.txt" "$SALIDAS/${1}2.txt" | grep -qi 'deadlock'; }
filas() { q "SELECT asgt.filas_de('$(UID_ "$1")')" "$2"; }          # proyectos de la persona n (alias ordenados)
INS() { echo "INSERT INTO public.user_project_assignments (user_id, project_id, permission_type) VALUES $1;"; }
v() { echo "('$(UID_ "$1")', '$(PID_ "$2")', 'total')"; }          # (persona n, proyecto n)

# ACTORES DE LA CONCURRENCIA (decisión del dueño del negocio, 2026-10-11): las ESCRITURAS de asignaciones (A, B, D, F4) las hace el PRINCIPAL —dos pestañas del propietario (OW) o el propietario contra
# un administrador que intenta autoasignarse—; un administrador ya no escribe asignaciones por la API. Las BAJAS EN CASCADA de un NO principal (F1, R2-1, V3-06, la ronda a escala y R2-5) ya no
# existen por la API (projects_delete es del principal, 0700): se ejercitan con el rol de base de datos PROPIETARIO y la sesión del administrador («!ADM1»: salta la RLS, el trigger lee al actor
# de app_users), que es lo que el trigger y el candado siguen defendiendo (defensa en profundidad: una función SECURITY DEFINER futura, una conexión del dueño con un JWT, una política más permisiva).
# A1 · dos pestañas del PROPIETARIO a la vez sobre la MISMA persona, con proyectos DISTINTOS (el guardado de hoy: borrar todas + insertar)
copia "$BD_POST" asg_conc
par asg_conc a OW "DELETE FROM public.user_project_assignments WHERE user_id = '$(UID_ 21)'; $(INS "$(v 21 4), $(v 21 5)")" \
                  OW "DELETE FROM public.user_project_assignments WHERE user_id = '$(UID_ 21)'; $(INS "$(v 21 6), $(v 21 7)")"
R=$(filas 21 asg_conc)
sin_deadlock a && [ "$ESTADO2" = "esperando" ] && ! grep -qi 'error' "$SALIDAS/a1.txt" "$SALIDAS/a2.txt" && [ "$R" = "P4,P5,P6,P7" ] \
  && echo "  ✓ A1 · dos pestañas del propietario sobre la misma persona (borrar todas + insertar, proyectos distintos): sin deadlock ni error; queda la unión {$R} sin duplicados" \
  || { echo "❌ A1 · R=$R"; cat "$SALIDAS/a1.txt" "$SALIDAS/a2.txt"; exit 1; }
# A2 · con proyectos que SE SOLAPAN: uno gana, el otro recibe una violación de llave única limpia (nunca un deadlock ni filas dobles)
copia "$BD_POST" asg_conc
par asg_conc b OW "DELETE FROM public.user_project_assignments WHERE user_id = '$(UID_ 21)'; $(INS "$(v 21 4), $(v 21 5)")" \
                  OW "DELETE FROM public.user_project_assignments WHERE user_id = '$(UID_ 21)'; $(INS "$(v 21 4), $(v 21 6)")"
R=$(filas 21 asg_conc); DUP=$(q "SELECT count(*) FROM (SELECT user_id, project_id FROM public.user_project_assignments GROUP BY 1, 2 HAVING count(*) > 1) d" asg_conc)
sin_deadlock b && [ "$ESTADO2" = "esperando" ] && grep -q 'duplicate key' "$SALIDAS/b2.txt" && ! grep -qi 'error' "$SALIDAS/b1.txt" && [ "$R" = "P4,P5" ] && [ "$DUP" = "0" ] \
  && echo "  ✓ A2 · solapados: gana la primera ({$R}); la segunda recibe «duplicate key» (23505) y su transacción no deja nada; 0 duplicados" \
  || { echo "❌ A2 · R=$R DUP=$DUP"; cat "$SALIDAS/b1.txt" "$SALIDAS/b2.txt"; exit 1; }
# A3 · por DIFERENCIAS (insertar las que faltan con ON CONFLICT DO NOTHING): ambos terminan sin error y las filas que no cambian se conservan
copia "$BD_POST" asg_conc
ID_P1=$(q "SELECT id FROM public.user_project_assignments WHERE user_id = '$(UID_ 21)' AND project_id = '$(PID_ 1)'" asg_conc)
par asg_conc c OW "INSERT INTO public.user_project_assignments (user_id, project_id, permission_type) VALUES $(v 21 4) ON CONFLICT (user_id, project_id) DO NOTHING;" \
                  OW "INSERT INTO public.user_project_assignments (user_id, project_id, permission_type) VALUES $(v 21 4), $(v 21 5) ON CONFLICT (user_id, project_id) DO NOTHING;"
R=$(filas 21 asg_conc); ID_P1_DESPUES=$(q "SELECT id FROM public.user_project_assignments WHERE user_id = '$(UID_ 21)' AND project_id = '$(PID_ 1)'" asg_conc)
sin_deadlock c && [ "$ESTADO2" = "esperando" ] && ! grep -qi 'error' "$SALIDAS/c1.txt" "$SALIDAS/c2.txt" && [ "$R" = "P1,P2,P4,P5" ] && [ "$ID_P1" = "$ID_P1_DESPUES" ] \
  && echo "  ✓ A3 · por diferencias, mismo solapamiento: sin error, {$R}, y la fila P1 que no cambió conserva su id" \
  || { echo "❌ A3 · R=$R"; cat "$SALIDAS/c1.txt" "$SALIDAS/c2.txt"; exit 1; }
# B1 · un administrador intenta autoasignarse MIENTRAS el propietario le asigna un proyecto
copia "$BD_POST" asg_conc
par asg_conc d OW "$(INS "$(v 13 1)")" AX2 "$(INS "$(v 13 2)")"
R=$(filas 13 asg_conc); EX=$(q "SELECT asgt.exento('$(UID_ 13)')" asg_conc)
sin_deadlock d && ! grep -qi 'error' "$SALIDAS/d1.txt" && grep -q 'ASIGNACION_PROPIA_NO_PERMITIDA' "$SALIDAS/d2.txt" && [ "$R" = "P1" ] && [ "$EX" = "f" ] \
  && echo "  ✓ B1 · AX2 se autoasigna P2 mientras OW le asigna P1: AX2 recibe ASIGNACION_PROPIA_NO_PERMITIDA, queda con {$R} y deja de ser exento sólo por obra del propietario" \
  || { echo "❌ B1 · R=$R EX=$EX"; cat "$SALIDAS/d1.txt" "$SALIDAS/d2.txt"; exit 1; }
# B2 · quien ya quedó acotado intenta volver a ser exento (borrar las suyas) mientras el propietario le amplía el alcance
par asg_conc e OW "$(INS "$(v 13 3)")" AX2 "DELETE FROM public.user_project_assignments WHERE user_id = '$(UID_ 13)';"
R=$(filas 13 asg_conc); EX=$(q "SELECT asgt.exento('$(UID_ 13)')" asg_conc)
sin_deadlock e && ! grep -qi 'error' "$SALIDAS/e1.txt" "$SALIDAS/e2.txt" && [ "$R" = "P1,P3" ] && [ "$EX" = "f" ] \
  && echo "  ✓ B2 · AX2 intenta borrar las suyas (0 filas, sin error) mientras OW le añade P3: queda con {$R} y SIGUE acotado" \
  || { echo "❌ B2 · R=$R EX=$EX"; cat "$SALIDAS/e1.txt" "$SALIDAS/e2.txt"; exit 1; }
# B3 · un administrador acotado intenta ampliarse y borrarse a la vez, con el propietario escribiendo sobre OTRAS personas
copia "$BD_POST" asg_conc
par asg_conc f AP "DELETE FROM public.user_project_assignments WHERE user_id = '$(UID_ 6)'; $(INS "$(v 6 4)")" OW "$(INS "$(v 22 4)")"
R=$(filas 6 asg_conc); EX=$(q "SELECT asgt.exento('$(UID_ 6)')" asg_conc); R22=$(filas 22 asg_conc)
sin_deadlock f && grep -q 'ASIGNACION_PROPIA_NO_PERMITIDA' "$SALIDAS/f1.txt" && [ "$R" = "P1,P2,P3" ] && [ "$EX" = "f" ] && [ "$R22" = "P2,P3,P4" ] \
  && echo "  ✓ B3 · AP intenta ampliarse mientras OW escribe a OP2: AP queda con {$R} (sin cambios, no exento) y OP2 con {$R22} (lo de OW sí se aplicó)" \
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
par asg_conc f0 SU "UPDATE public.app_users SET company_id = '$EMPRESA_D' WHERE id = '$(UID_ 8)';" OW "$(INS "$(v 8 1)")"
[ "$(cruces asg_conc)" = "1" ] && [ "$ESTADO2" = "terminó" ] \
  && echo "  ✓ D0 · control negativo: sin FOR SHARE la asignación pasa con la empresa vieja y queda 1 fila CRUZADA (la carrera es real)" \
  || { echo "❌ D0 · sin el candado debía quedar 1 fila cruzada y hay $(cruces asg_conc)"; cat "$SALIDAS/f01.txt" "$SALIDAS/f02.txt"; exit 1; }
N_MUT_CONC=$((N_MUT_CONC + 1))
copia "$BD_POST" asg_conc
par asg_conc g SU "UPDATE public.app_users SET company_id = '$EMPRESA_D' WHERE id = '$(UID_ 8)';" OW "$(INS "$(v 8 1)")"
sin_deadlock g && [ "$ESTADO2" = "esperando" ] && grep -q 'ASIGNACION_EMPRESA_DISTINTA' "$SALIDAS/g2.txt" && [ "$(cruces asg_conc)" = "0" ] && [ "$(filas 8 asg_conc)" = "" ] \
  && echo "  ✓ D1 · cambio de empresa de la PERSONA concurrente con su asignación: la asignación espera, ve la empresa nueva y recibe ASIGNACION_EMPRESA_DISTINTA; 0 filas cruzadas" \
  || { echo "❌ D1 · cruces=$(cruces asg_conc)"; cat "$SALIDAS/g1.txt" "$SALIDAS/g2.txt"; exit 1; }
copia "$BD_POST" asg_conc
par asg_conc h SU "UPDATE public.projects SET company_id = '$EMPRESA_D' WHERE id = '$(PID_ 1)';" OW "$(INS "$(v 8 1)")"
sin_deadlock h && [ "$ESTADO2" = "esperando" ] && grep -q 'ASIGNACION_EMPRESA_DISTINTA' "$SALIDAS/h2.txt" && [ "$(cruces asg_conc)" = "0" ] \
  && echo "  ✓ D2 · cambio de empresa del PROYECTO concurrente con una asignación: igual, 0 filas cruzadas" \
  || { echo "❌ D2 · cruces=$(cruces asg_conc)"; cat "$SALIDAS/h1.txt" "$SALIDAS/h2.txt"; exit 1; }
baja asg_conc

# D3 · D4 · lo mismo para app_users.project_id (trigger de la 0700, AFTER): el superadministrador cambia la empresa de un proyecto de C (D3) o lo BORRA (D4) y se detiene SIN confirmar; el
#     propietario fija ese proyecto como el de una persona de C (NUEVO, que ya tenía P2). Con el FOR SHARE del trigger la escritura del propietario ESPERA (Lock), ve el estado nuevo y recibe
#     APP_USERS_PROYECTO_EMPRESA_DISTINTA: NUEVO conserva P2 y ninguna persona de C queda con un proyecto que no es de C. El proyecto es P9, de C y SIN asignaciones: su baja no arrastra
#     cascadas de user_project_assignments (ni el candado de bajas de la 0600), así que lo único que se ordena es el trigger de app_users.
#     Control negativo: la 0700 sin «FOR SHARE OF p» (sobre la cadena con la 0600): la escritura NO espera, se confirma con el proyecto todavía de C y, al confirmar el superadministrador, NUEVO
#     queda con un proyecto de D (D3) o con uno que ya no existe (D4).
EMPRESA_C=a5c00000-0000-0000-0000-000000000001
cruces_app_users() { q "SELECT count(*) FROM public.app_users u WHERE u.company_id = '$EMPRESA_C' AND u.project_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.projects p WHERE p.id = u.project_id AND p.company_id = u.company_id)" "$1"; }   # personas de C con un proyecto de otra empresa o inexistente
proyecto_de() { q "SELECT COALESCE((SELECT i.alias FROM asgt.ids i WHERE i.id = u.project_id), u.project_id::text, '') FROM public.app_users u WHERE u.id = '$(UID_ "$1")'" "$2"; }   # app_users.project_id de la persona n (alias, o el uuid si no tiene)
preparar_d34() {     # preparar_d34 BD — NUEVO con P2 como proyecto y P9: un proyecto de C sin asignaciones (sin el tope del plan: sólo para montar el caso)
  q "UPDATE public.app_users SET project_id = '$(PID_ 2)' WHERE id = '$(UID_ 8)';
     SET session_replication_role = replica;
     INSERT INTO public.projects (id, company_id, nombre) VALUES ('$(PID_ 9)', '$EMPRESA_C', 'ASG C9 sin asignaciones');" "$1" >/dev/null
}
FIJAR_P9="UPDATE public.app_users SET project_id = '$(PID_ 9)' WHERE id = '$(UID_ 8)';"
copia "$BD_POST" asg_conc; preparar_d34 asg_conc
par asg_conc pa SU "UPDATE public.projects SET company_id = '$EMPRESA_D' WHERE id = '$(PID_ 9)';" OW "$FIJAR_P9"
sin_deadlock pa && [ "$ESTADO2" = "esperando" ] && ! grep -qi 'error' "$SALIDAS/pa1.txt" && grep -q 'APP_USERS_PROYECTO_EMPRESA_DISTINTA' "$SALIDAS/pa2.txt" \
  && [ "$(proyecto_de 8 asg_conc)" = "P2" ] && [ "$(cruces_app_users asg_conc)" = "0" ] && [ "$(q "SELECT company_id FROM public.projects WHERE id = '$(PID_ 9)'" asg_conc)" = "$EMPRESA_D" ] \
  && echo "  ✓ D3 · el superadministrador mueve P9 de C a D (sin confirmar) y el propietario fija P9 como proyecto de NUEVO: la escritura ESPERA (FOR SHARE del trigger de app_users), ve la empresa nueva y recibe APP_USERS_PROYECTO_EMPRESA_DISTINTA; NUEVO conserva P2 y 0 personas de C con un proyecto que no es de C" \
  || { echo "❌ D3 · ESTADO2=$ESTADO2 proyecto de NUEVO=$(proyecto_de 8 asg_conc) cruces=$(cruces_app_users asg_conc)"; cat "$SALIDAS/pa1.txt" "$SALIDAS/pa2.txt"; exit 1; }
copia "$BD_POST" asg_conc; preparar_d34 asg_conc
par asg_conc pb SU "DELETE FROM public.projects WHERE id = '$(PID_ 9)';" OW "$FIJAR_P9"
sin_deadlock pb && [ "$ESTADO2" = "esperando" ] && ! grep -qi 'error' "$SALIDAS/pb1.txt" && grep -q 'APP_USERS_PROYECTO_EMPRESA_DISTINTA' "$SALIDAS/pb2.txt" \
  && [ "$(proyecto_de 8 asg_conc)" = "P2" ] && [ "$(cruces_app_users asg_conc)" = "0" ] && [ "$(q "SELECT count(*) FROM public.projects WHERE id = '$(PID_ 9)'" asg_conc)" = "0" ] \
  && echo "  ✓ D4 · el superadministrador BORRA P9 (sin confirmar) y el propietario fija P9 como proyecto de NUEVO: la escritura ESPERA, ve que el proyecto ya no existe y recibe APP_USERS_PROYECTO_EMPRESA_DISTINTA; NUEVO conserva P2 y 0 personas de C con un proyecto que no es de C" \
  || { echo "❌ D4 · ESTADO2=$ESTADO2 proyecto de NUEVO=$(proyecto_de 8 asg_conc) cruces=$(cruces_app_users asg_conc)"; cat "$SALIDAS/pb1.txt" "$SALIDAS/pb2.txt"; exit 1; }
# control negativo: la 0700 sin «FOR SHARE OF p» (el sed de D0 sólo toca la 0600: aquí se muta la 0700 y se aplica sobre la cadena con la 0600)
sed 's/ FOR SHARE OF p;/;/' "$MIGS/$MIGRACION2.sql" > "$SALIDAS/migracion0700_sin_candado.sql"
! grep -q 'FOR SHARE OF' "$SALIDAS/migracion0700_sin_candado.sql" || { echo "❌ D3/D4 · no se pudo quitar el FOR SHARE de la 0700"; exit 1; }
copia "$BD_0600" asg_conc; aplicar "$SALIDAS/migracion0700_sin_candado.sql" asg_conc; preparar_d34 asg_conc
par asg_conc pc SU "UPDATE public.projects SET company_id = '$EMPRESA_D' WHERE id = '$(PID_ 9)';" OW "$FIJAR_P9"
[ "$ESTADO2" = "terminó" ] && ! grep -qi 'error' "$SALIDAS/pc1.txt" "$SALIDAS/pc2.txt" && [ "$(proyecto_de 8 asg_conc)" = "$(PID_ 9)" ] && [ "$(cruces_app_users asg_conc)" = "1" ] \
  || { echo "❌ D3 · sin el FOR SHARE la escritura debía terminar sin esperar y dejar a NUEVO con el proyecto movido: ESTADO2=$ESTADO2 proyecto de NUEVO=$(proyecto_de 8 asg_conc) cruces=$(cruces_app_users asg_conc)"; cat "$SALIDAS/pc1.txt" "$SALIDAS/pc2.txt"; exit 1; }
copia "$BD_0600" asg_conc; aplicar "$SALIDAS/migracion0700_sin_candado.sql" asg_conc; preparar_d34 asg_conc
par asg_conc pd SU "DELETE FROM public.projects WHERE id = '$(PID_ 9)';" OW "$FIJAR_P9"
[ "$ESTADO2" = "terminó" ] && ! grep -qi 'error' "$SALIDAS/pd1.txt" "$SALIDAS/pd2.txt" && [ "$(proyecto_de 8 asg_conc)" = "$(PID_ 9)" ] && [ "$(cruces_app_users asg_conc)" = "1" ] \
  && [ "$(q "SELECT count(*) FROM public.projects WHERE id = '$(PID_ 9)'" asg_conc)" = "0" ] \
  && echo "  ✓ D3/D4 · mutación «la 0700 sin FOR SHARE OF p»: la escritura del propietario TERMINA sin esperar en los dos casos y NUEVO queda con un proyecto que ya es de D (D3) o que ya no existe (D4): 1 persona de C con un proyecto que no es de C (la carrera es real y la prueba la ve)" \
  || { echo "❌ D4 · sin el FOR SHARE la escritura debía terminar sin esperar y dejar a NUEVO con el proyecto borrado: ESTADO2=$ESTADO2 proyecto de NUEVO=$(proyecto_de 8 asg_conc) cruces=$(cruces_app_users asg_conc)"; cat "$SALIDAS/pd1.txt" "$SALIDAS/pd2.txt"; exit 1; }
N_MUT_CONC=$((N_MUT_CONC + 1))
baja asg_conc

# F1 · BAJA EN CASCADA CONCURRENTE (actor «!AP»: el rol propietario de la base con la sesión de AP; ver arriba): dos sesiones, cada una borra UNO de los DOS únicos proyectos de un administrador acotado (AP queda con sólo P1 y P2).
#      Cada sesión, por separado, tiene permiso (le queda la otra fila); juntas lo dejarían con CERO filas y, siendo administrador, EXENTO (ve toda la empresa).
#      Con el candado de bajas en cascada (por empresa) la 2ª ESPERA a la 1ª, ve lo que ésta confirmó y recibe ASIGNACION_PROPIA_NO_PERMITIDA.
carrera_f1() {       # carrera_f1 BD NOMBRE — deja en RES «filas de AP|exento|estado observado de la 2ª sesión antes de soltar la puerta»
  q "DELETE FROM public.user_project_assignments WHERE user_id = '$(UID_ 6)' AND project_id = '$(PID_ 3)'" "$1" >/dev/null
  par "$1" "$2" '!AP' "DELETE FROM public.projects WHERE id = '$(PID_ 1)';" '!AP' "DELETE FROM public.projects WHERE id = '$(PID_ 2)';"
  RES="$(q "SELECT count(*) FROM public.user_project_assignments WHERE user_id = '$(UID_ 6)'" "$1")|$(q "SELECT asgt.exento('$(UID_ 6)')" "$1")|$ESTADO2"
}
copia "$BD_POST" asg_conc
carrera_f1 asg_conc ca
sin_deadlock ca && [ "$RES" = "1|f|esperando" ] && ! grep -qi 'error' "$SALIDAS/ca1.txt" && grep -q 'ASIGNACION_PROPIA_NO_PERMITIDA' "$SALIDAS/ca2.txt" \
  && echo "  ✓ F1 · dos sesiones borran cada una uno de los 2 únicos proyectos de AP: la 2ª ESPERA (candado de la empresa), recibe ASIGNACION_PROPIA_NO_PERMITIDA, AP conserva 1 fila y NO es exento" \
  || { echo "❌ F1 · RES=$RES"; cat "$SALIDAS/ca1.txt" "$SALIDAS/ca2.txt"; exit 1; }
# control negativo: SIN el candado (la función de la migración mutada) la carrera es real: AP se queda con CERO filas y exento
copia "$BD_POST" asg_conc
psql -q -v ON_ERROR_STOP=1 -d asg_conc -c "$(mutar_funcion asignacion_bloquear_propia "$QUITAR_CANDADO")" >/dev/null
carrera_f1 asg_conc cb
[ "$RES" = "0|t|terminó" ] && ! grep -qi 'error' "$SALIDAS/cb1.txt" "$SALIDAS/cb2.txt" \
  && echo "  ✓ F1 · mutación «sin el candado»: las dos sesiones terminan sin error y AP se queda con 0 filas y EXENTO (la carrera es real y la prueba la ve)" \
  || { echo "❌ F1 · sin el candado debía quedar 0|t|terminó y hay $RES"; cat "$SALIDAS/cb1.txt" "$SALIDAS/cb2.txt"; exit 1; }
# control negativo 2: el candado DENTRO del AND de la condición (el primer parche que se probó) espera, pero compara con la instantánea vieja y tampoco sirve
copia "$BD_POST" asg_conc
psql -q -v ON_ERROR_STOP=1 -d asg_conc -c "$(mutar_funcion asignacion_bloquear_propia "$QUITAR_CANDADO; $CANDADO_DENTRO_DEL_AND")" >/dev/null
carrera_f1 asg_conc cc
[ "$RES" = "0|t|esperando" ] \
  && echo "  ✓ F1 · mutación «candado dentro del AND»: la 2ª sí espera, pero decide con la instantánea de antes de esperar y AP termina con 0 filas y EXENTO: el candado tiene que ir en una sentencia ANTES" \
  || { echo "❌ F1 · con el candado dentro del AND debía quedar 0|t|esperando y hay $RES"; cat "$SALIDAS/cc1.txt" "$SALIDAS/cc2.txt"; exit 1; }
N_MUT_CONC=$((N_MUT_CONC + 2))
baja asg_conc

# R2-1 · BAJA EN CASCADA CRUZADA. El candado «por persona» (la primera corrección de F1) sólo ordenaba a las sesiones de la MISMA persona. Dos administradores ADM1 y ADM2 que
#        COMPARTEN sus dos únicos proyectos {P1, P2}: ADM1 borra P1 y ADM2 borra P2. La cascada de cada sesión vacía TAMBIÉN la fila del otro —y la fila ajena no se comprueba—,
#        así que, con candados distintos, ninguna esperaba a la otra y ambos acababan con CERO filas y exentos (un resultado que no equivale a ningún orden en serie: en serie
#        la 2ª recibe ASIGNACION_PROPIA_NO_PERMITIDA y ambos conservan P2). Con una sola clave para todas las bajas en cascada la 2ª espera y rechaza.
admins_xp() {        # admins_xp BD — ADM1 y ADM2 (administradores de C) con EXACTAMENTE {P1, P2} cada uno
  q "INSERT INTO auth.users (id) VALUES ('$(UID_ 90)'), ('$(UID_ 91)');
     INSERT INTO public.app_users (id, company_id, full_name, role) VALUES ('$(UID_ 90)', 'a5c00000-0000-0000-0000-000000000001', 'ASG ADM1', 'admin'), ('$(UID_ 91)', 'a5c00000-0000-0000-0000-000000000001', 'ASG ADM2', 'admin');
     INSERT INTO asgt.ids VALUES ('ADM1', '$(UID_ 90)', 'persona'), ('ADM2', '$(UID_ 91)', 'persona');
     INSERT INTO public.user_project_assignments (user_id, project_id, permission_type) SELECT u, asgt.pid_de(p), 'total' FROM unnest(ARRAY['$(UID_ 90)', '$(UID_ 91)']::uuid[]) u, generate_series(1, 2) p;" "$1" >/dev/null
}
resumen_xp() { echo "$(q "SELECT asgt.filas_de('$(UID_ 90)')" "$1")|$(q "SELECT asgt.exento('$(UID_ 90)')" "$1")|$(q "SELECT asgt.filas_de('$(UID_ 91)')" "$1")|$(q "SELECT asgt.exento('$(UID_ 91)')" "$1")|$ESTADO2"; }
carrera_cruzada() {  # carrera_cruzada BD NOMBRE — ADM1 borra P1 (se detiene SIN confirmar); ADM2 borra P2
  admins_xp "$1"
  par "$1" "$2" '!ADM1' "DELETE FROM public.projects WHERE id = '$(PID_ 1)';" '!ADM2' "DELETE FROM public.projects WHERE id = '$(PID_ 2)';"
  RES="$(resumen_xp "$1")"
}
copia "$BD_POST" asg_conc
carrera_cruzada asg_conc xa
sin_deadlock xa && [ "$RES" = "P2|f|P2|f|esperando" ] && ! grep -qi 'error' "$SALIDAS/xa1.txt" && [ "$(grep -c 'ASIGNACION_PROPIA_NO_PERMITIDA' "$SALIDAS/xa2.txt")" -ge 1 ] \
  && echo "  ✓ R2-1 · ADM1 y ADM2 comparten {P1,P2}: ADM1 borra P1 y ADM2 borra P2 a la vez: la 2ª ESPERA, recibe ASIGNACION_PROPIA_NO_PERMITIDA y ambos conservan {P2}, ninguno exento (como en serie)" \
  || { echo "❌ R2-1 · RES=$RES (esperado P2|f|P2|f|esperando)"; cat "$SALIDAS/xa1.txt" "$SALIDAS/xa2.txt"; exit 1; }
# control negativo 1: el candado POR PERSONA de la ronda anterior (d1aeb94a): la 2ª sesión NO espera y ambos quedan con CERO filas y exentos
copia "$BD_POST" asg_conc
psql -q -v ON_ERROR_STOP=1 -d asg_conc -c "$(mutar_funcion asignacion_bloquear_propia "$QUITAR_CANDADO; $CANDADO_POR_PERSONA")" >/dev/null
carrera_cruzada asg_conc xb
[ "$RES" = "|t||t|terminó" ] && ! grep -qi 'error' "$SALIDAS/xb1.txt" "$SALIDAS/xb2.txt" \
  && echo "  ✓ R2-1 · mutación «candado por persona» (d1aeb94a): la 2ª sesión no espera, las dos terminan sin error y AMBOS administradores quedan con 0 filas y EXENTOS (la carrera es real y la prueba la ve)" \
  || { echo "❌ R2-1 · con el candado por persona debía quedar |t||t|terminó y hay $RES"; cat "$SALIDAS/xb1.txt" "$SALIDAS/xb2.txt"; exit 1; }
# propietario contra administrador: la baja en cascada del PROPIETARIO (su cascada vacía la fila de ADM1 en P1) tampoco se comprueba; ADM1 borra después P2 con la fila de P1 aún «viva»
copia "$BD_POST" asg_conc
admins_xp asg_conc
par asg_conc xc OW "DELETE FROM public.projects WHERE id = '$(PID_ 1)';" '!ADM1' "DELETE FROM public.projects WHERE id = '$(PID_ 2)';"
RES="$(q "SELECT asgt.filas_de('$(UID_ 90)')" asg_conc)|$(q "SELECT asgt.exento('$(UID_ 90)')" asg_conc)|$ESTADO2"
sin_deadlock xc && [ "$RES" = "P2|f|esperando" ] && ! grep -qi 'error' "$SALIDAS/xc1.txt" && grep -q 'ASIGNACION_PROPIA_NO_PERMITIDA' "$SALIDAS/xc2.txt" \
  && echo "  ✓ R2-1 · el PROPIETARIO borra P1 (sin confirmar) y ADM1 {P1,P2} borra P2: ADM1 ESPERA, ve que P1 ya no está y recibe ASIGNACION_PROPIA_NO_PERMITIDA; conserva {P2}, no exento" \
  || { echo "❌ R2-1 · propietario contra administrador: RES=$RES (esperado P2|f|esperando)"; cat "$SALIDAS/xc1.txt" "$SALIDAS/xc2.txt"; exit 1; }
# control negativo 2: el candado tomado sólo DENTRO de la rama de autoasignación (la baja del propietario no lo toma): ADM1 no espera y queda exento
copia "$BD_POST" asg_conc
psql -q -v ON_ERROR_STOP=1 -d asg_conc -c "$(mutar_funcion asignacion_bloquear_propia "$QUITAR_CANDADO; $CANDADO_SOLO_SI_PROPIA")" >/dev/null
admins_xp asg_conc
par asg_conc xd OW "DELETE FROM public.projects WHERE id = '$(PID_ 1)';" '!ADM1' "DELETE FROM public.projects WHERE id = '$(PID_ 2)';"
RES="$(q "SELECT asgt.filas_de('$(UID_ 90)')" asg_conc)|$(q "SELECT asgt.exento('$(UID_ 90)')" asg_conc)|$ESTADO2"
[ "$RES" = "|t|terminó" ] && ! grep -qi 'error' "$SALIDAS/xd1.txt" "$SALIDAS/xd2.txt" \
  && echo "  ✓ R2-1 · mutación «candado sólo en la rama de autoasignación»: la baja del propietario no lo toma, ADM1 no espera y queda con 0 filas y EXENTO (el candado tiene que ir ANTES de mirar quién borra)" \
  || { echo "❌ R2-1 · con el candado sólo en la rama propia debía quedar |t|terminó y hay $RES"; cat "$SALIDAS/xd1.txt" "$SALIDAS/xd2.txt"; exit 1; }
N_MUT_CONC=$((N_MUT_CONC + 2))
baja asg_conc

# V3-01 · EL CANDADO ES POR EMPRESA. La versión anterior (b9b630b1) usaba UNA clave para toda la base: el propietario de CUALQUIER empresa —signup-company es público— retenía con una baja pesada las
#         bajas de proyecto de todas las demás (medido con pgbench: la víctima de otra empresa pasaba de 220 a 0,5 transacciones/s). Ahora la clave sale de la empresa de la PERSONA cuya fila se
#         borra: las bajas de D no hacen esperar a las de C, las de la misma empresa sí se ordenan (R2-1) y, si la espera pasa de 2 s, fallan limpias (lock_timeout de la propia función).
#         Todo con sesiones reales y la puerta; ninguna espera es un tiempo fijo salvo el plazo de PAR_PLAZO, que sólo se agota cuando el código está mal.
OBS_ASG="SELECT 'esperan=' || (SELECT count(*) FROM pg_locks WHERE locktype = 'advisory' AND classid <> $PUERTA AND NOT granted)
            || ';retiene_1=' || (SELECT count(*) FROM pg_locks l JOIN pg_stat_activity a USING (pid) WHERE l.locktype = 'advisory' AND l.classid <> $PUERTA AND l.granted AND a.application_name LIKE '%\_1')"
dop_en_d() { q "INSERT INTO public.user_project_assignments (user_id, project_id, permission_type) VALUES ('$(UID_ 12)', '$(PID_ 11)', 'total'), ('$(UID_ 12)', '$(PID_ 12)', 'total')" "$1" >/dev/null; }   # DOP (operador de D) en D1 y D2: su baja en cascada ES una fila con candado
copia "$BD_POST" asg_conc; dop_en_d asg_conc
PAR_OBS_SQL="$OBS_ASG"; par asg_conc ea DOW "DELETE FROM public.projects WHERE id = '$(PID_ 11)';" OW "DELETE FROM public.projects WHERE id = '$(PID_ 3)';"; unset PAR_OBS_SQL
sin_deadlock ea && [ "$ESTADO2" = "terminó" ] && [ "$PAR_OBS" = "esperan=0;retiene_1=1" ] && ! grep -qi 'error' "$SALIDAS/ea1.txt" "$SALIDAS/ea2.txt" \
  && [ "$(q "SELECT count(*) FROM public.projects WHERE id IN ('$(PID_ 3)', '$(PID_ 11)')" asg_conc)" = "0" ] \
  && echo "  ✓ V3-01 · el propietario de D borra D1 (retiene SU candado, sin confirmar) y el de C borra P3: la baja de C TERMINA sin esperar y ninguna sesión espera ningún candado de aviso ($PAR_OBS)" \
  || { echo "❌ V3-01 · una baja de la empresa D hizo esperar a una de la empresa C: ESTADO2=$ESTADO2 obs=$PAR_OBS"; cat "$SALIDAS/ea1.txt" "$SALIDAS/ea2.txt"; exit 1; }
# la misma empresa SÍ se ordena (y un atacante de D sólo afecta a D): el propietario de D contra sí mismo en dos pestañas
copia "$BD_POST" asg_conc; dop_en_d asg_conc
PAR_OBS_SQL="$OBS_ASG"; par asg_conc eb DOW "DELETE FROM public.projects WHERE id = '$(PID_ 11)';" DOW "DELETE FROM public.projects WHERE id = '$(PID_ 12)';"; unset PAR_OBS_SQL
sin_deadlock eb && [ "$ESTADO2" = "esperando" ] && [ "$PAR_OBS" = "esperan=1;retiene_1=1" ] && ! grep -qi 'error' "$SALIDAS/eb1.txt" "$SALIDAS/eb2.txt" \
  && [ "$(q "SELECT count(*) FROM public.projects WHERE id IN ('$(PID_ 11)', '$(PID_ 12)')" asg_conc)" = "0" ] \
  && echo "  ✓ V3-01 · dos bajas de la MISMA empresa D sí se ordenan: la 2ª ESPERA el candado de D ($PAR_OBS), y al soltarse las dos terminan sin error (D1 y D2 borrados): quien retiene el candado sólo estorba a su propia empresa" \
  || { echo "❌ V3-01 · dos bajas de la misma empresa debían ordenarse: ESTADO2=$ESTADO2 obs=$PAR_OBS"; cat "$SALIDAS/eb1.txt" "$SALIDAS/eb2.txt"; exit 1; }
# la espera está ACOTADA: la puerta sigue cerrada y la 2ª falla sola a los 2 s con lock_not_available, sin dejar nada
copia "$BD_POST" asg_conc; dop_en_d asg_conc
PAR_PLAZO=120 par asg_conc ec DOW "DELETE FROM public.projects WHERE id = '$(PID_ 11)';" DOW "DELETE FROM public.projects WHERE id = '$(PID_ 12)';"; unset PAR_PLAZO
sin_deadlock ec && [ "$ESTADO2" = "terminó" ] && [ "${T2:-0}" -ge 1900 ] && grep -q 'canceling statement due to lock timeout' "$SALIDAS/ec2.txt" && ! grep -qi 'error' "$SALIDAS/ec1.txt" \
  && [ "$(q "SELECT count(*) FROM public.projects WHERE id = '$(PID_ 12)'" asg_conc)" = "1" ] && [ "$(q "SELECT count(*) FROM public.projects WHERE id = '$(PID_ 11)'" asg_conc)" = "0" ] \
  && echo "  ✓ V3-01 · con la puerta cerrada, la baja que espera el candado FALLA SOLA a los $T2 ms («canceling statement due to lock timeout», 55P03, lock_timeout de 2 s de la función); D2 sigue en pie y la 1ª confirma D1" \
  || { echo "❌ V3-01 · la espera del candado no se acotó a 2 s: ESTADO2=$ESTADO2 T2=${T2:-?} ms"; cat "$SALIDAS/ec1.txt" "$SALIDAS/ec2.txt"; exit 1; }
baja asg_conc

# controles negativos de V3-01: (1) el candado GLOBAL de la ronda anterior (la baja de C espera a la de D), (2) sin lock_timeout propio (la espera no termina sola)
copia "$BD_POST" asg_conc; dop_en_d asg_conc
psql -q -v ON_ERROR_STOP=1 -d asg_conc -c "$(mutar_funcion asignacion_bloquear_propia "$CANDADO_GLOBAL")" >/dev/null
PAR_OBS_SQL="$OBS_ASG"; par asg_conc ed DOW "DELETE FROM public.projects WHERE id = '$(PID_ 11)';" OW "DELETE FROM public.projects WHERE id = '$(PID_ 3)';"; unset PAR_OBS_SQL
[ "$ESTADO2" = "esperando" ] && [ "$PAR_OBS" = "esperan=1;retiene_1=1" ] \
  && echo "  ✓ V3-01 · mutación «candado GLOBAL» (b9b630b1): la baja de la empresa C ESPERA a la de D ($PAR_OBS): la prueba ve la denegación de servicio entre empresas" \
  || { echo "❌ V3-01 · con el candado global la baja de C debía esperar a la de D: ESTADO2=$ESTADO2 obs=$PAR_OBS"; cat "$SALIDAS/ed1.txt" "$SALIDAS/ed2.txt"; exit 1; }
copia "$BD_POST" asg_conc; dop_en_d asg_conc
psql -q -v ON_ERROR_STOP=1 -d asg_conc -c "$(mutar_funcion asignacion_bloquear_propia "$SIN_LOCK_TIMEOUT")" >/dev/null
PAR_PLAZO=80 par asg_conc ee DOW "DELETE FROM public.projects WHERE id = '$(PID_ 11)';" DOW "DELETE FROM public.projects WHERE id = '$(PID_ 12)';"; unset PAR_PLAZO
[ "$ESTADO2" = "esperando" ] \
  && echo "  ✓ V3-01 · mutación «sin lock_timeout propio»: tras ${T2:-4000} ms con la puerta cerrada la 2ª sigue esperando (sólo el statement_timeout la cortaría): la prueba ve la espera sin acotar" \
  || { echo "❌ V3-01 · sin lock_timeout la 2ª debía seguir esperando: ESTADO2=$ESTADO2 T2=${T2:-?}"; cat "$SALIDAS/ee1.txt" "$SALIDAS/ee2.txt"; exit 1; }
N_MUT_CONC=$((N_MUT_CONC + 2))
baja asg_conc

# H-05 (ronda 4) · DOS MUTANTES DEL CANDADO SOBREVIVÍAN a toda esta sección porque todos los actores eran de la MISMA empresa que las personas de la cascada y ninguna fila era de una persona sin empresa.
#   M6 · la clave sale de la empresa del ACTOR. Defecto REAL si ocurriera: SU2 (superadministrador de D) borra P1 de C; su cascada vacía la fila de ADM1 en P1. ADM1 {P1,P2} borra después P2. Con la clave de la
#        PERSONA (C) las dos bajas comparten candado, ADM1 espera, ve que P1 ya no está y recibe ASIGNACION_PROPIA_NO_PERMITIDA. Con la del ACTOR (SU2 → D; ADM1 → C) no se ordenan, ADM1 ve su fila de P1 viva y,
#        al confirmar las dos, queda con CERO filas y EXENTO.
#   M7 · sin el COALESCE de «sin-empresa». Una persona sin empresa (company_id NULL) con filas HEREDADAS (el trigger de integridad hoy no deja crearlas: se montan con los disparadores apagados) comparte la
#        clave 'sin-empresa' con TODAS las demás; con la clave NULL no se toma ningún candado.
#   Mismo recurso que V3-01: una puerta, ningún tiempo fijo, y se observa pg_locks / pg_stat_activity.
copia "$BD_POST" asg_conc; admins_xp asg_conc
PAR_OBS_SQL="$OBS_ASG"; par asg_conc xe SU2 "DELETE FROM public.projects WHERE id = '$(PID_ 1)';" '!ADM1' "DELETE FROM public.projects WHERE id = '$(PID_ 2)';"; unset PAR_OBS_SQL
RES="$(q "SELECT asgt.filas_de('$(UID_ 90)')" asg_conc)|$(q "SELECT asgt.exento('$(UID_ 90)')" asg_conc)|$ESTADO2"
sin_deadlock xe && [ "$RES" = "P2|f|esperando" ] && [ "$PAR_OBS" = "esperan=1;retiene_1=1" ] && ! grep -qi 'error' "$SALIDAS/xe1.txt" && grep -q 'ASIGNACION_PROPIA_NO_PERMITIDA' "$SALIDAS/xe2.txt" \
  && echo "  ✓ H-05/M6 · el superadministrador de OTRA empresa (SU2, de D) borra P1 de C sin confirmar y ADM1 {P1,P2} borra P2: ADM1 ESPERA ($PAR_OBS), ve que P1 ya no está y recibe ASIGNACION_PROPIA_NO_PERMITIDA; conserva {P2}, no exento (la clave es la de la PERSONA)" \
  || { echo "❌ H-05/M6 · SU2 contra ADM1: RES=$RES obs=$PAR_OBS (esperado P2|f|esperando y esperan=1;retiene_1=1)"; cat "$SALIDAS/xe1.txt" "$SALIDAS/xe2.txt"; exit 1; }
copia "$BD_POST" asg_conc; admins_xp asg_conc
psql -q -v ON_ERROR_STOP=1 -d asg_conc -c "$(mutar_funcion asignacion_bloquear_propia "$CLAVE_DEL_ACTOR")" >/dev/null
PAR_OBS_SQL="$OBS_ASG"; par asg_conc xf SU2 "DELETE FROM public.projects WHERE id = '$(PID_ 1)';" '!ADM1' "DELETE FROM public.projects WHERE id = '$(PID_ 2)';"; unset PAR_OBS_SQL
RES="$(q "SELECT asgt.filas_de('$(UID_ 90)')" asg_conc)|$(q "SELECT asgt.exento('$(UID_ 90)')" asg_conc)|$ESTADO2"
[ "$RES" = "|t|terminó" ] && [ "$PAR_OBS" = "esperan=0;retiene_1=1" ] && ! grep -qi 'error' "$SALIDAS/xf1.txt" "$SALIDAS/xf2.txt" \
  && echo "  ✓ H-05/M6 · mutación «clave de la empresa del ACTOR»: SU2 retiene la clave de D, ADM1 (de C) no espera ($PAR_OBS) y queda con 0 filas y EXENTO (el defecto es real y la prueba lo ve)" \
  || { echo "❌ H-05/M6 · con la clave del actor debía quedar |t|terminó y esperan=0;retiene_1=1 y hay RES=$RES obs=$PAR_OBS"; cat "$SALIDAS/xf1.txt" "$SALIDAS/xf2.txt"; exit 1; }
N_MUT_CONC=$((N_MUT_CONC + 1))
baja asg_conc

sin_empresa_heredadas() {   # sin_empresa_heredadas BD — SINEMP (operador SIN empresa) con una fila en P4 de C y CLI (cliente SIN empresa) con una en D1 de D: filas HEREDADAS, sólo montables con los disparadores apagados
  q "SET session_replication_role = replica;
     INSERT INTO public.user_project_assignments (user_id, project_id, permission_type) VALUES ('$(UID_ 11)', '$(PID_ 4)', 'total'), ('$(UID_ 9)', '$(PID_ 11)', 'total');" "$1" >/dev/null
}
copia "$BD_POST" asg_conc; sin_empresa_heredadas asg_conc
PAR_OBS_SQL="$OBS_ASG"; par asg_conc xg DOW "DELETE FROM public.projects WHERE id = '$(PID_ 11)';" OW "DELETE FROM public.projects WHERE id = '$(PID_ 4)';"; unset PAR_OBS_SQL
sin_deadlock xg && [ "$ESTADO2" = "esperando" ] && [ "$PAR_OBS" = "esperan=1;retiene_1=1" ] && ! grep -qi 'error' "$SALIDAS/xg1.txt" "$SALIDAS/xg2.txt" \
  && [ "$(q "SELECT count(*) FROM public.projects WHERE id IN ('$(PID_ 4)', '$(PID_ 11)')" asg_conc)" = "0" ] \
  && echo "  ✓ H-05/M7 · dos bajas cuya cascada vacía la fila de una persona SIN empresa (el propietario de D borra D1; el de C borra P4) comparten la clave 'sin-empresa': la 2ª ESPERA ($PAR_OBS) y al soltarse las dos terminan sin error. Es el límite documentado (H-03): esa clave la comparten todas las empresas" \
  || { echo "❌ H-05/M7 · las bajas de personas sin empresa debían ordenarse: ESTADO2=$ESTADO2 obs=$PAR_OBS"; cat "$SALIDAS/xg1.txt" "$SALIDAS/xg2.txt"; exit 1; }
copia "$BD_POST" asg_conc; sin_empresa_heredadas asg_conc
psql -q -v ON_ERROR_STOP=1 -d asg_conc -c "$(mutar_funcion asignacion_bloquear_propia "$SIN_COALESCE_SIN_EMPRESA")" >/dev/null
PAR_OBS_SQL="$OBS_ASG"; par asg_conc xh DOW "DELETE FROM public.projects WHERE id = '$(PID_ 11)';" OW "DELETE FROM public.projects WHERE id = '$(PID_ 4)';"; unset PAR_OBS_SQL
[ "$ESTADO2" = "terminó" ] && [ "$PAR_OBS" = "esperan=0;retiene_1=0" ] && ! grep -qi 'error' "$SALIDAS/xh1.txt" "$SALIDAS/xh2.txt" \
  && echo "  ✓ H-05/M7 · mutación «sin el COALESCE de sin-empresa»: la clave es NULL, ninguna baja toma candado ($PAR_OBS) y la 2ª no espera (la prueba ve que las personas sin empresa dejan de serializarse)" \
  || { echo "❌ H-05/M7 · con la clave NULL ninguna baja debía esperar: ESTADO2=$ESTADO2 obs=$PAR_OBS"; cat "$SALIDAS/xh1.txt" "$SALIDAS/xh2.txt"; exit 1; }
N_MUT_CONC=$((N_MUT_CONC + 1))
baja asg_conc

# H-03 (ronda 4) · LA CLAVE SALE DE LA EMPRESA DE LA PERSONA, también con una fila CRUZADA heredada (persona de C asignada a un proyecto de D; sólo montable con los disparadores apagados). «Un propietario sólo retiene el candado
#        de SU empresa» vale con datos sanos (V3-01); con esa fila, el propietario de D que borra su proyecto retiene la clave de C (la de la persona de la fila) y la baja del propietario de C ESPERA. Se fija como límite medido,
#        no como deseo: si algún día se limpian los datos cruzados o la clave cambia, este caso se invierte y hay que corregir el documento.
copia "$BD_POST" asg_conc
q "SET session_replication_role = replica; INSERT INTO public.user_project_assignments (user_id, project_id, permission_type) VALUES ('$(UID_ 21)', '$(PID_ 11)', 'total');" asg_conc >/dev/null     # OP1 (persona de C) en D1 (proyecto de D)
PAR_OBS_SQL="$OBS_ASG"; par asg_conc xi DOW "DELETE FROM public.projects WHERE id = '$(PID_ 11)';" OW "DELETE FROM public.projects WHERE id = '$(PID_ 3)';"; unset PAR_OBS_SQL
sin_deadlock xi && [ "$ESTADO2" = "esperando" ] && [ "$PAR_OBS" = "esperan=1;retiene_1=1" ] && ! grep -qi 'error' "$SALIDAS/xi1.txt" "$SALIDAS/xi2.txt" \
  && [ "$(q "SELECT count(*) FROM public.projects WHERE id IN ('$(PID_ 3)', '$(PID_ 11)')" asg_conc)" = "0" ] \
  && echo "  ✓ H-03 · (límite medido) con una fila CRUZADA heredada (OP1 de C en D1 de D) el propietario de D retiene la clave de C y la baja del propietario de C ESPERA ($PAR_OBS); al soltarse terminan sin error. Con datos sanos no pasa (V3-01 arriba)" \
  || { echo "❌ H-03 · con una fila cruzada la baja de C debía esperar a la de D: ESTADO2=$ESTADO2 obs=$PAR_OBS"; cat "$SALIDAS/xi1.txt" "$SALIDAS/xi2.txt"; exit 1; }
baja asg_conc

# R2-1 a ESCALA (2, 6 y 30 sesiones). K sesiones REALES a la vez (una puerta COMPARTIDA las suelta juntas): tres administradores (ADN1..3) comparten TODOS los K proyectos de la ronda y la
#        sesión i (actor ADN(1+i%3)) borra el proyecto i. El resultado debe equivaler a un orden en serie, sea cual sea el entrelazado: sobrevive EXACTAMENTE un proyecto, cada administrador
#        conserva 1 fila (ninguno exento), se rechaza UNA baja (la última, que lo dejaría sin filas) y no hay interbloqueos ni otros errores. Sin el candado quedan exentos casi siempre.
personas_n() {       # personas_n BD — ADN1..3: administradores de C sin filas
  q "INSERT INTO auth.users (id) VALUES ('$(UID_ 93)'), ('$(UID_ 94)'), ('$(UID_ 95)');
     INSERT INTO public.app_users (id, company_id, full_name, role) VALUES ('$(UID_ 93)', 'a5c00000-0000-0000-0000-000000000001', 'ASG ADN1', 'admin'), ('$(UID_ 94)', 'a5c00000-0000-0000-0000-000000000001', 'ASG ADN2', 'admin'), ('$(UID_ 95)', 'a5c00000-0000-0000-0000-000000000001', 'ASG ADN3', 'admin');
     INSERT INTO asgt.ids VALUES ('ADN1', '$(UID_ 93)', 'persona'), ('ADN2', '$(UID_ 94)', 'persona'), ('ADN3', '$(UID_ 95)', 'persona')" "$1" >/dev/null
}
PN="a5d00000-0000-0000-0001-"           # proyectos de la ronda: a5d00000-0000-0000-0001-<12 dígitos>
ronda_lista() {      # ronda_lista BD K — los K proyectos de la ronda, cada uno con los tres administradores; sin restos de la ronda anterior
  q "DELETE FROM public.user_project_assignments WHERE project_id::text LIKE '$PN%'; DELETE FROM public.projects WHERE id::text LIKE '$PN%';
     SET session_replication_role = replica;
     INSERT INTO public.projects (id, company_id, nombre) SELECT ('$PN' || lpad(g::text, 12, '0'))::uuid, 'a5c00000-0000-0000-0000-000000000001', 'ASG N' || g FROM generate_series(1, $2) g;
     SET session_replication_role = origin;
     INSERT INTO public.user_project_assignments (user_id, project_id, permission_type)
       SELECT u, ('$PN' || lpad(g::text, 12, '0'))::uuid, 'total' FROM unnest(ARRAY['$(UID_ 93)', '$(UID_ 94)', '$(UID_ 95)']::uuid[]) u, generate_series(1, $2) g" "$1" >/dev/null
}
ronda_n() {          # ronda_n BD K — las K sesiones a la vez
  local bd="$1" k="$2" i pids=()
  rm -f "$SALIDAS"/rn_*.txt
  ctl_abrir "$bd" rn 7
  for i in $(seq 1 "$k"); do
    ( PGAPPNAME="asg_rn_$i" psql -q -X -t -A -d "$bd" > "$SALIDAS/rn_$i.txt" 2>&1 <<SQL || true
SELECT pg_advisory_lock_shared($PUERTA, 7);
SELECT pg_advisory_unlock_shared($PUERTA, 7);
BEGIN;
SELECT asgt.poner_actor('!ADN$((1 + i % 3))');
DELETE FROM public.projects WHERE id = '$PN$(printf '%012d' "$i")';
COMMIT;
SQL
    ) &
    pids+=($!)
  done
  esperar "$bd" "SELECT count(*) = $k FROM pg_locks WHERE locktype = 'advisory' AND classid = $PUERTA AND objid = 7 AND objsubid = 2 AND NOT granted" "las $k sesiones esperando la salida"
  ctl_soltar 7
  wait "${pids[@]}" || true
}
resumen_n() {        # «administradores sin filas|proyectos que quedan|filas de cada administrador|bajas rechazadas|esperas agotadas (lock timeout)|otros errores»
  local bd="$1" rech lt err
  rech=$(cat "$SALIDAS"/rn_*.txt | grep -c 'ASIGNACION_PROPIA_NO_PERMITIDA' || true)
  lt=$(cat "$SALIDAS"/rn_*.txt | grep -c 'canceling statement due to lock timeout' || true)
  err=$(cat "$SALIDAS"/rn_*.txt | grep 'ERROR' | grep -v 'ASIGNACION_PROPIA_NO_PERMITIDA' | grep -vc 'canceling statement due to lock timeout' || true)
  echo "$(q "SELECT count(*) FROM public.app_users a WHERE a.id IN ('$(UID_ 93)', '$(UID_ 94)', '$(UID_ 95)') AND NOT EXISTS (SELECT 1 FROM public.user_project_assignments u WHERE u.user_id = a.id)" "$bd")|$(q "SELECT count(*) FROM public.projects WHERE id::text LIKE '$PN%'" "$bd")|$(q "SELECT string_agg(n::text, ',' ORDER BY id) FROM (SELECT a.id, (SELECT count(*) FROM public.user_project_assignments u WHERE u.user_id = a.id) n FROM public.app_users a WHERE a.id IN ('$(UID_ 93)', '$(UID_ 94)', '$(UID_ 95)')) x" "$bd")|$rech|$lt|$err"
}
# Una ronda es EXACTA si equivale a un orden en serie sin esperas agotadas: 0 exentos, 1 proyecto, 1 fila por administrador, 1 baja rechazada, 0 otros errores. Con MUCHAS sesiones a la vez las últimas de la cola pueden agotar
# legítimamente los 2 s del lock_timeout (fallan limpias con 55P03 y no cambian nada): esa ronda es SEGURA si, aun así, nadie quedó exento, todos conservan tantas filas como proyectos quedan (≥ 1),
# hubo a lo sumo una baja rechazada y no hay interbloqueos ni otros errores. Lo que importa para la seguridad es lo segundo; lo primero sólo falla si el código está mal o la máquina no da más.
rondas_n() {         # rondas_n BD K RONDAS — imprime «malas exentas exactas con_esperas_agotadas»
  local bd="$1" k="$2" r="$3" i res malas=0 exentas=0 exactas=0 conlt=0 ex pr fi re lt er n1
  for i in $(seq 1 "$r"); do
    ronda_lista "$bd" "$k"; ronda_n "$bd" "$k"; res=$(resumen_n "$bd")
    IFS='|' read -r ex pr fi re lt er <<<"$res"
    n1="$pr,$pr,$pr"
    if [ "$res" = "0|1|1,1,1|1|0|0" ]; then exactas=$((exactas + 1))
    elif [ "$ex" = "0" ] && [ "$pr" -ge 1 ] && [ "$fi" = "$n1" ] && [ "$re" -le 1 ] && [ "$er" = "0" ] && [ "$lt" -ge 1 ]; then conlt=$((conlt + 1))
    else malas=$((malas + 1)); [ "$ex" = "0" ] || exentas=$((exentas + 1)); echo "     ronda $i de $k sesiones: $res" >&2
    fi
  done
  echo "$malas $exentas $exactas $conlt"
}
copia "$BD_POST" asg_conc; personas_n asg_conc
for kr in "2 8" "6 5" "30 4"; do
  set -- $kr; K=$1; RN=$2
  R=$(rondas_n asg_conc "$K" "$RN"); set -- $R; MALAS=$1; EXENTAS=$2; EXACTAS=$3; CONLT=$4
  if [ "$K" -le 6 ]; then
    [ "$MALAS" = 0 ] && [ "$EXACTAS" = "$RN" ] \
      && echo "  ✓ R2-1 a escala · $K sesiones a la vez × $RN rondas (3 administradores comparten $K proyectos, cada sesión borra uno): TODAS terminan como un orden en serie —1 proyecto, 1 fila por administrador, 1 baja rechazada, 0 exentos, 0 interbloqueos, 0 otros errores—" \
      || { echo "❌ R2-1 a escala · $K sesiones × $RN rondas: (malas exentas exactas con_esperas_agotadas) = $R"; exit 1; }
  else
    [ "$MALAS" = 0 ] \
      && echo "  ✓ R2-1 a escala · $K sesiones a la vez × $RN rondas (3 administradores comparten $K proyectos): en TODAS nadie queda exento y cada administrador conserva tantas filas como proyectos quedan, a lo sumo 1 baja rechazada, 0 interbloqueos, 0 otros errores ($EXACTAS rondas exactas como un orden en serie; $CONLT con esperas agotadas del lock_timeout de 2 s, que fallan limpias y no cambian nada)" \
      || { echo "❌ R2-1 a escala · $K sesiones × $RN rondas: (malas exentas exactas con_esperas_agotadas) = $R"; exit 1; }
  fi
done
# con 30 sesiones a la vez la cola del candado dura más de 2 s (cada baja recorre todas las llaves foráneas del proyecto): las últimas agotan el lock_timeout y fallan limpias. Con SÓLO el plazo
# alargado (60 s) las 4 rondas deben ser EXACTAS: el único desvío respecto de un orden en serie eran esas esperas agotadas.
copia "$BD_POST" asg_conc; personas_n asg_conc
psql -q -v ON_ERROR_STOP=1 -d asg_conc -c "$(mutar_funcion asignacion_bloquear_propia "$LOCK_TIMEOUT_LARGO")" >/dev/null
R=$(rondas_n asg_conc 30 4); set -- $R
[ "$1" = 0 ] && [ "$3" = 4 ] \
  && echo "  ✓ R2-1 a escala · 30 sesiones a la vez × 4 rondas con el plazo del candado alargado a 60 s: las 4 rondas son EXACTAS como un orden en serie (1 proyecto, 1 fila por administrador, 1 baja rechazada, 0 exentos, 0 esperas agotadas): las esperas agotadas de arriba eran el único desvío" \
  || { echo "❌ R2-1 a escala · 30 sesiones con lock_timeout de 60 s: (malas exentas exactas con_esperas_agotadas) = $R"; exit 1; }
# control negativo: SIN el candado y con 6 sesiones a la vez la carrera es real (alguna ronda deja administradores exentos)
copia "$BD_POST" asg_conc; personas_n asg_conc
psql -q -v ON_ERROR_STOP=1 -d asg_conc -c "$(mutar_funcion asignacion_bloquear_propia "$QUITAR_CANDADO")" >/dev/null
R=$(rondas_n asg_conc 6 5 2>/dev/null); set -- $R
[ "$2" -ge 1 ] \
  && echo "  ✓ R2-1 a escala · mutación «sin el candado»: con 6 sesiones a la vez $2 de 5 rondas dejan administradores EXENTOS (la carrera es real y la prueba la ve)" \
  || { echo "❌ R2-1 a escala · sin el candado alguna de 5 rondas debía dejar administradores exentos y (malas exentas exactas con_esperas_agotadas) = $R"; exit 1; }
N_MUT_CONC=$((N_MUT_CONC + 1))
baja asg_conc

# V3-06 · CARRERA RESIDUAL, DOCUMENTADA Y NO CERRADA (decisión D-6/D-15): quien borra con service_role o como superusuario no pasa por el trigger ni toma el candado, así que NO ordena a una baja
#         hecha por la API. ADM1 {P1,P2}: el rol de servicio borra P1 (sin confirmar) y ADM1 borra P2 por la API; ADM1 ve su fila de P1 viva, no espera, y al confirmar las dos queda con CERO filas y exento.
#         Ninguna ruta de la aplicación borra proyectos con service_role salvo delete-company (que borra la empresa entera, y con ella al administrador). Si algún día el rol de servicio toma el candado,
#         este caso cambia a «esperando» y hay que invertirlo.
copia "$BD_POST" asg_conc; admins_xp asg_conc
par asg_conc sv SERVICIO "DELETE FROM public.projects WHERE id = '$(PID_ 1)';" '!ADM1' "DELETE FROM public.projects WHERE id = '$(PID_ 2)';"
RES="$(q "SELECT asgt.filas_de('$(UID_ 90)')" asg_conc)|$(q "SELECT asgt.exento('$(UID_ 90)')" asg_conc)|$ESTADO2"
sin_deadlock sv && [ "$RES" = "|t|terminó" ] && ! grep -qi 'error' "$SALIDAS/sv1.txt" "$SALIDAS/sv2.txt" \
  && echo "  ✓ V3-06 · (residual, documentado) el rol de servicio borra P1 sin confirmar y ADM1 {P1,P2} borra P2 por la API: ADM1 NO espera (el servicio no toma candado) y queda con 0 filas y EXENTO. No se cierra: ver D-6 y D-15" \
  || { echo "❌ V3-06 · el caso residual cambió (¿el rol de servicio ya toma el candado?): RES=$RES"; cat "$SALIDAS/sv1.txt" "$SALIDAS/sv2.txt"; exit 1; }
baja asg_conc

# R2-5 · COSTE CONOCIDO del candado, medido: en una transacción de VARIAS sentencias que combine «borrar un proyecto» con «asignar sobre un proyecto que otra transacción está
#        borrando» pueden cruzarse el candado de aviso y el FOR SHARE del trigger de integridad. PostgreSQL lo detecta (deadlock_timeout = 1 s) y aborta UNA de las dos; la otra termina y
#        nada queda a medias. Por PostgREST (una sentencia por transacción) no es alcanzable. Lo que se comprueba es que el desenlace es SEGURO sea cual sea la víctima.
#        s1 (OW): borra P1, espera la puerta y luego asigna NUEVO→P2; s2 (OW, otra pestaña): borra P2 (espera el candado con la fila de P2 ya tomada) → s1 espera a s2 y s2 a s1.
copia "$BD_POST" asg_conc
par asg_conc di OW "DELETE FROM public.projects WHERE id = '$(PID_ 1)'; SELECT pg_advisory_xact_lock($PUERTA, 1); $(INS "$(v 8 2)")" OW "DELETE FROM public.projects WHERE id = '$(PID_ 2)';"
INTERBLOQUEOS=$(cat "$SALIDAS/di1.txt" "$SALIDAS/di2.txt" | grep -ci 'deadlock detected' || true)
RESTAN=$(q "SELECT count(*) FROM public.projects WHERE id IN ('$(PID_ 1)', '$(PID_ 2)')" asg_conc)
[ "$ESTADO2" = "esperando" ] && [ "$INTERBLOQUEOS" = "1" ] && [ "$RESTAN" = "1" ] \
  && [ "$(q "SELECT asgt.exento('$(UID_ 6)')" asg_conc)" = "f" ] && [ "$(q "SELECT count(*) FROM public.user_project_assignments u WHERE NOT EXISTS (SELECT 1 FROM public.projects p WHERE p.id = u.project_id)" asg_conc)" = "0" ] \
  && echo "  ✓ R2-5 · transacción de varias sentencias que cruza el candado y el FOR SHARE: PostgreSQL detecta el interbloqueo y aborta UNA sola (1 «deadlock detected»); la otra termina; de P1/P2 se borra exactamente uno, AP sigue acotado y ninguna asignación queda huérfana" \
  || { echo "❌ R2-5 · ESTADO2=$ESTADO2 interbloqueos=$INTERBLOQUEOS restan=$RESTAN"; cat "$SALIDAS/di1.txt" "$SALIDAS/di2.txt"; exit 1; }
# contraste: SIN el candado la 2ª sesión confirma de inmediato y no hay interbloqueo (la 1ª recibe un error limpio al asignar sobre un proyecto ya borrado)
copia "$BD_POST" asg_conc
psql -q -v ON_ERROR_STOP=1 -d asg_conc -c "$(mutar_funcion asignacion_bloquear_propia "$QUITAR_CANDADO")" >/dev/null
par asg_conc dj OW "DELETE FROM public.projects WHERE id = '$(PID_ 1)'; SELECT pg_advisory_xact_lock($PUERTA, 1); $(INS "$(v 8 2)")" OW "DELETE FROM public.projects WHERE id = '$(PID_ 2)';"
[ "$ESTADO2" = "terminó" ] && sin_deadlock dj \
  && echo "  ✓ R2-5 · contraste: sin el candado esa misma transacción no se interbloquea (la 2ª sesión confirma sin esperar): el interbloqueo es el precio de serializar" \
  || { echo "❌ R2-5 · contraste: ESTADO2=$ESTADO2"; cat "$SALIDAS/dj1.txt" "$SALIDAS/dj2.txt"; exit 1; }
baja asg_conc

# F4 · UNA ESCRITURA LEGÍTIMA que llega mientras la migración está PARADA tras su pre-vuelo (se inyecta una puerta justo después de medir). Antes la medición
#      se hacía con ACCESS SHARE y el bloqueo llegaba después, con el primer DROP POLICY: la escritura se confirmaba en la ventana y el post-vuelo abortaba con un
#      falso «las filas CAMBIARON». Ahora el bloqueo va ANTES de medir: la escritura ESPERA, la migración pasa y la escritura se aplica después.
escritura_en_migracion() {   # escritura_en_migracion BD ARCHIVO NOMBRE [REGEX] [SQL] — deja ESTADO2 (de la escritura), MIG_RC y MIG_TXT. REGEX = la línea ANTES de la cual se inyecta la pausa
                             # (por omisión, el primer paso de la migración; para la reversión, el primero de las políticas). SQL = la escritura legítima del PROPIETARIO que llega
                             # durante la pausa (por omisión, asignarle P1 a NUEVO)
  local bd="$1" arch="$2" n="$3" marca="${4:-^-- ── 1\\. Regla única}" finm="$SALIDAS/$3.finm" finw="$SALIDAS/$3.finw" esc="${5:-$(INS "$(v 8 1)")}"
  sed "/$marca/i SELECT pg_advisory_xact_lock(9100, 2);" "$arch" > "$SALIDAS/${n}_pausada.sql"
  grep -q 'pg_advisory_xact_lock(9100, 2)' "$SALIDAS/${n}_pausada.sql" || { echo "❌ F4 · no se pudo inyectar la pausa"; exit 1; }
  rm -f "$finm" "$finw"
  ctl_abrir "$bd" "$n" 2
  ( PGAPPNAME="asg_${n}_mig" psql -q -v ON_ERROR_STOP=1 -d "$bd" -f "$SALIDAS/${n}_pausada.sql" > "$SALIDAS/${n}_mig.txt" 2>&1 && echo 0 > "$SALIDAS/${n}.rc" || echo $? > "$SALIDAS/${n}.rc"; touch "$finm" ) &
  local pm=$!
  esperar_o_fin "$bd" "$(en_puerta 2)" "$finm"                    # la migración ya midió y está parada en la puerta
  ( sesion "$bd" OW "asg_${n}_esc" - <<<"$esc" > "$SALIDAS/${n}_esc.txt" 2>&1 || true; touch "$finw" ) &
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
  && echo "  ✓ F4 · una escritura legítima (el propietario asigna a NUEVO→P1) llega con la migración parada tras su pre-vuelo: ESPERA el bloqueo, la migración pasa (sin «CAMBIARON») y la escritura se aplica después (44 filas)" \
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

# R02 · LA REVERSIÓN TAMBIÉN NECESITA SU LOCK TABLE. Es el mismo defecto de F4 en el otro script: si la reversión midiera sin bloquear, una escritura legítima confirmada entre su
#       medición y su post-vuelo la abortaría con un falso «las filas CAMBIARON». Se la pausa justo después de su pre-vuelo (antes de la primera política) y se hace llegar una escritura.
copia "$BD_POST" asg_conc
escritura_en_migracion asg_conc "$REVERSION" r02a '^-- ── 1 · las cuatro políticas'
[ "$ESTADO2" = "esperando" ] && [ "$MIG_RC" = "0" ] && ! grep -q 'CAMBIARON' "$MIG_TXT" && ! grep -qi 'error' "$SALIDAS/r02a_esc.txt" \
  && [ "$(q "SELECT count(*) FROM public.user_project_assignments" asg_conc)" = "44" ] && [ "$(q "SELECT asgt.filas_de('$(UID_ 8)')" asg_conc)" = "P1" ] \
  && [ "$(q "SELECT count(*) FROM pg_proc WHERE proname LIKE 'asignacion\\_%'" asg_conc)" = "0" ] \
  && echo "  ✓ R02 · una escritura legítima llega con la REVERSIÓN parada tras su pre-vuelo: ESPERA el bloqueo, la reversión pasa (sin «CAMBIARON»), deja 0 funciones y la escritura se aplica después (44 filas)" \
  || { echo "❌ R02 · ESTADO2=$ESTADO2 MIG_RC=$MIG_RC"; cat "$MIG_TXT" "$SALIDAS/r02a_esc.txt"; exit 1; }
# control negativo: SIN el LOCK TABLE de la reversión la escritura se confirma en la ventana y el post-vuelo aborta con el falso «CAMBIARON» (y la reversión no deshace nada)
copia "$BD_POST" asg_conc
sed '/^  LOCK TABLE public\.user_project_assignments IN ACCESS EXCLUSIVE MODE;/d' "$REVERSION" > "$SALIDAS/reversion_sin_lock.sql"
! grep -q 'LOCK TABLE public.user_project_assignments' "$SALIDAS/reversion_sin_lock.sql" || { echo "❌ R02 · no se pudo quitar el LOCK TABLE de la reversión"; exit 1; }
escritura_en_migracion asg_conc "$SALIDAS/reversion_sin_lock.sql" r02b '^-- ── 1 · las cuatro políticas'
[ "$ESTADO2" = "terminó" ] && [ "$MIG_RC" != "0" ] && grep -q 'reversion_asignaciones_proyecto: las filas CAMBIARON' "$MIG_TXT" \
  && [ "$(q "SELECT count(*) FROM pg_proc WHERE proname LIKE 'asignacion\\_%'" asg_conc)" = "3" ] \
  && echo "  ✓ R02 · mutación «reversión sin el LOCK TABLE»: la escritura se confirma durante la pausa y la reversión ABORTA con el falso «las filas … CAMBIARON» sin deshacer nada (siguen las 3 funciones): la prueba ve el defecto" \
  || { echo "❌ R02 · sin el LOCK la reversión debía abortar con CAMBIARON: ESTADO2=$ESTADO2 MIG_RC=$MIG_RC"; cat "$MIG_TXT"; exit 1; }
N_MUT_GUARDA=$((N_MUT_GUARDA + 1))
baja asg_conc

# F4 · 0700 · UNA ESCRITURA LEGÍTIMA (el propietario crea un rol) que llega mientras la 0700 está PARADA tras su pre-vuelo. La 0700 bloquea las cinco tablas ANTES de medir: la escritura
#        ESPERA, la migración pasa sin el falso «CAMBIARON» y la escritura se aplica después. Control negativo: sin ese LOCK TABLE se confirma durante la pausa y el post-vuelo aborta.
ESC7="INSERT INTO public.roles (company_id, name, is_system) VALUES ('a5c00000-0000-0000-0000-000000000001', 'ASG rol en vuelo', false);"
copia "$BD_0600" asg_conc
N_ROLES=$(q "SELECT count(*) FROM public.roles" asg_conc)
escritura_en_migracion asg_conc "$MIGS/$MIGRACION2.sql" f40700 '^-- ── 1\. Proyectos' "$ESC7"
[ "$ESTADO2" = "esperando" ] && [ "$MIG_RC" = "0" ] && ! grep -q 'CAMBIARON' "$MIG_TXT" && ! grep -qi 'error' "$SALIDAS/f40700_esc.txt" \
  && [ "$(q "SELECT count(*) FROM public.roles" asg_conc)" = "$((N_ROLES + 1))" ] && [ "$(pol_iguales asg_conc)" = "5" ] \
  && echo "  ✓ F4 · 0700 · una escritura legítima (el propietario crea un rol) llega con la 0700 parada tras su pre-vuelo: ESPERA el bloqueo, la migración pasa (sin «CAMBIARON»), deja las 13 políticas del principal y la escritura se aplica después ($((N_ROLES + 1)) roles)" \
  || { echo "❌ F4 · 0700 · ESTADO2=$ESTADO2 MIG_RC=$MIG_RC"; cat "$MIG_TXT" "$SALIDAS/f40700_esc.txt"; exit 1; }
copia "$BD_0600" asg_conc
sed '/^  LOCK TABLE public\.projects, public\.role_permissions, public\.roles/d' "$MIGS/$MIGRACION2.sql" > "$SALIDAS/migracion0700_sin_lock.sql"
! grep -q 'LOCK TABLE public.projects' "$SALIDAS/migracion0700_sin_lock.sql" || { echo "❌ F4 · 0700 · no se pudo quitar el LOCK TABLE"; exit 1; }
escritura_en_migracion asg_conc "$SALIDAS/migracion0700_sin_lock.sql" f40700b '^-- ── 1\. Proyectos' "$ESC7"
[ "$ESTADO2" = "terminó" ] && [ "$MIG_RC" != "0" ] && grep -q 'las filas de roles CAMBIARON' "$MIG_TXT" && [ "$(pol_iguales asg_conc)" = "18" ] \
  && echo "  ✓ F4 · 0700 · mutación «sin el LOCK TABLE inicial»: la escritura se confirma durante la pausa y la 0700 ABORTA con el falso «las filas de roles … CAMBIARON» sin cambiar ninguna política: la prueba ve el defecto" \
  || { echo "❌ F4 · 0700 · sin el LOCK debía abortar con CAMBIARON: ESTADO2=$ESTADO2 MIG_RC=$MIG_RC"; cat "$MIG_TXT"; exit 1; }
N_MUT_GUARDA=$((N_MUT_GUARDA + 1))
baja asg_conc

# R02 · 0700 · la reversión de la 0700 también bloquea antes de medir (mismo defecto, mismo control negativo)
copia "$BD_POST" asg_conc
N_ROLES=$(q "SELECT count(*) FROM public.roles" asg_conc)
escritura_en_migracion asg_conc "$REVERSION2" r020700 '^-- ── 1 · proyectos' "$ESC7"
[ "$ESTADO2" = "esperando" ] && [ "$MIG_RC" = "0" ] && ! grep -q 'CAMBIARON' "$MIG_TXT" && ! grep -qi 'error' "$SALIDAS/r020700_esc.txt" \
  && [ "$(q "SELECT count(*) FROM public.roles" asg_conc)" = "$((N_ROLES + 1))" ] && [ "$(pol_iguales asg_conc)" = "18" ] \
  && echo "  ✓ R02 · 0700 · una escritura legítima llega con la REVERSIÓN de la 0700 parada tras su pre-vuelo: ESPERA, la reversión pasa (sin «CAMBIARON»), deja las 18 políticas de producción y la escritura se aplica después" \
  || { echo "❌ R02 · 0700 · ESTADO2=$ESTADO2 MIG_RC=$MIG_RC"; cat "$MIG_TXT" "$SALIDAS/r020700_esc.txt"; exit 1; }
copia "$BD_POST" asg_conc
sed '/^  LOCK TABLE public\.app_users, public\.projects, public\.role_permissions, public\.roles/d' "$REVERSION2" > "$SALIDAS/reversion0700_sin_lock.sql"
! grep -q 'LOCK TABLE' "$SALIDAS/reversion0700_sin_lock.sql" || { echo "❌ R02 · 0700 · no se pudo quitar el LOCK TABLE de la reversión"; exit 1; }
escritura_en_migracion asg_conc "$SALIDAS/reversion0700_sin_lock.sql" r020700b '^-- ── 1 · proyectos' "$ESC7"
[ "$ESTADO2" = "terminó" ] && [ "$MIG_RC" != "0" ] && grep -q 'reversion_autoridad_principal_empresa: las filas de roles CAMBIARON' "$MIG_TXT" && [ "$(pol_iguales asg_conc)" = "5" ] \
  && echo "  ✓ R02 · 0700 · mutación «reversión sin el LOCK TABLE»: la escritura se confirma durante la pausa y la reversión ABORTA con el falso «las filas de roles … CAMBIARON» sin deshacer nada (siguen las 13 políticas del principal): la prueba ve el defecto" \
  || { echo "❌ R02 · 0700 · sin el LOCK la reversión debía abortar con CAMBIARON: ESTADO2=$ESTADO2 MIG_RC=$MIG_RC"; cat "$MIG_TXT"; exit 1; }
N_MUT_GUARDA=$((N_MUT_GUARDA + 1))
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

# C · 0700 · la 0700 contra una transacción larga sobre UNA de las cinco tablas (roles): lock_timeout (5 s) → falla limpio, no cambia ninguna política y, reintentada, aplica
copia "$BD_0600" asg_lock
FIN_LARGA="$SALIDAS/c7.finlarga"; rm -f "$FIN_LARGA"
ctl_abrir asg_lock c7 3
( PGAPPNAME=asg_larga psql -q -X -d asg_lock >/dev/null 2>&1 <<SQL || true; touch "$FIN_LARGA" ) &
BEGIN;
LOCK TABLE public.roles IN ROW EXCLUSIVE MODE;
SELECT pg_advisory_xact_lock($PUERTA, 3);
COMMIT;
SQL
P_LARGA=$!
esperar_o_fin asg_lock "$(en_puerta 3)" "$FIN_LARGA"
INI=$(date +%s)
SALIDA_LOCK=$(psql -q -v ON_ERROR_STOP=1 -d asg_lock -f "$MIGS/$MIGRACION2.sql" 2>&1) && { ctl_soltar 3; echo "❌ C · 0700 · la migración no debía poder aplicarse con roles bloqueada"; exit 1; }
FIN=$(date +%s)
ctl_soltar 3
wait $P_LARGA || true
echo "$SALIDA_LOCK" | grep -q 'lock timeout' || { echo "❌ C · 0700 · falló, pero no por lock_timeout:"; echo "$SALIDA_LOCK" | grep -E 'ERROR' | head -3; exit 1; }
[ "$((FIN - INI))" -le 8 ] || { echo "❌ C · 0700 · tardó $((FIN - INI)) s: el lock_timeout de 5 s no cortó"; exit 1; }
[ "$(pol_md5 asg_lock)" = "$(pol_md5 "$BD_0600")" ] || { echo "❌ C · 0700 · dejó políticas cambiadas"; exit 1; }
aplicar "$MIGS/$MIGRACION2.sql" asg_lock
[ "$(pol_iguales asg_lock)" = "5" ] || { echo "❌ C · 0700 · reintentada no dejó las 13 políticas del principal"; exit 1; }
echo "  ✓ C · 0700 · con una transacción larga sobre roles la 0700 FALLA en $((FIN - INI)) s por lock_timeout («canceling statement due to lock timeout»), no cambia ninguna política y, reintentada, se aplica"
baja asg_lock

# C · 0700 · app_users se sigue LEYENDO mientras la 0700 corre: la RLS de todo el sistema la consulta y la 0700 sólo le añade un trigger. Una transacción larga que LEE app_users (ACCESS SHARE) NO
#             hace esperar a la migración (CREATE OR REPLACE TRIGGER pide SHARE ROW EXCLUSIVE, que no choca con una lectura), ni en la primera pasada ni al REAPLICARla. Medido: DROP TRIGGER IF EXISTS sólo pide
#             ACCESS EXCLUSIVE cuando el trigger YA EXISTE (en la primera pasada, sin trigger, no espera): por eso la mutación (DROP TRIGGER IF EXISTS + CREATE TRIGGER) se prueba sobre la reaplicación.
copia "$BD_0600" asg_lock
FIN_LARGA="$SALIDAS/c7b.finlarga"; rm -f "$FIN_LARGA"
ctl_abrir asg_lock c7b 4
( PGAPPNAME=asg_larga psql -q -X -d asg_lock >/dev/null 2>&1 <<SQL || true; touch "$FIN_LARGA" ) &
BEGIN;
SELECT count(*) FROM public.app_users;
SELECT pg_advisory_xact_lock($PUERTA, 4);
COMMIT;
SQL
P_LARGA=$!
esperar_o_fin asg_lock "$(en_puerta 4)" "$FIN_LARGA"
INI=$(date +%s)
SALIDA_LECTOR=$(psql -q -v ON_ERROR_STOP=1 -d asg_lock -f "$MIGS/$MIGRACION2.sql" 2>&1) || { ctl_soltar 4; echo "❌ C · 0700 · con una transacción larga que LEE app_users la 0700 debía aplicarse:"; echo "$SALIDA_LECTOR" | grep -E 'ERROR' | head -3; exit 1; }
FIN=$(date +%s)
[ "$((FIN - INI))" -le 3 ] || { ctl_soltar 4; echo "❌ C · 0700 · esperó $((FIN - INI)) s a una transacción que sólo lee app_users"; exit 1; }
T_LECTOR=$((FIN - INI))
[ "$(q "SELECT count(*) FROM pg_trigger WHERE tgname = 'trg_validar_proyecto_app_users'" asg_lock)" = "1" ] || { ctl_soltar 4; echo "❌ C · 0700 · no dejó el trigger"; exit 1; }
ctl_soltar 4
wait $P_LARGA || true
baja asg_lock
# reaplicación (el trigger YA existe) con el mismo lector abierto: la 0700 vigente se aplica igual y no espera
copia "$BD_POST" asg_lock
FIN_LARGA="$SALIDAS/c7r.finlarga"; rm -f "$FIN_LARGA"
ctl_abrir asg_lock c7r 4
( PGAPPNAME=asg_larga psql -q -X -d asg_lock >/dev/null 2>&1 <<SQL || true; touch "$FIN_LARGA" ) &
BEGIN;
SELECT count(*) FROM public.app_users;
SELECT pg_advisory_xact_lock($PUERTA, 4);
COMMIT;
SQL
P_LARGA=$!
esperar_o_fin asg_lock "$(en_puerta 4)" "$FIN_LARGA"
INI=$(date +%s)
SALIDA_LECTOR=$(psql -q -v ON_ERROR_STOP=1 -d asg_lock -f "$MIGS/$MIGRACION2.sql" 2>&1) || { ctl_soltar 4; echo "❌ C · 0700 · reaplicada con una transacción larga que LEE app_users la 0700 debía aplicarse:"; echo "$SALIDA_LECTOR" | grep -E 'ERROR' | head -3; exit 1; }
FIN=$(date +%s)
[ "$((FIN - INI))" -le 3 ] || { ctl_soltar 4; echo "❌ C · 0700 · reaplicada esperó $((FIN - INI)) s a una transacción que sólo lee app_users"; exit 1; }
T_LECTOR2=$((FIN - INI))
ctl_soltar 4
wait $P_LARGA || true
baja asg_lock
# mutación: DROP TRIGGER IF EXISTS + CREATE TRIGGER pide ACCESS EXCLUSIVE sobre app_users en cuanto el trigger existe y, con el mismo lector, la 0700 reaplicada falla por lock_timeout
perl -0pe 's/CREATE OR REPLACE TRIGGER trg_validar_proyecto_app_users/DROP TRIGGER IF EXISTS trg_validar_proyecto_app_users ON public.app_users;\nCREATE TRIGGER trg_validar_proyecto_app_users/' "$MIGS/$MIGRACION2.sql" > "$SALIDAS/migracion0700_drop_trigger.sql"
grep -q 'DROP TRIGGER IF EXISTS trg_validar_proyecto_app_users' "$SALIDAS/migracion0700_drop_trigger.sql" || { echo "❌ C · 0700 · no se pudo preparar la variante con DROP TRIGGER"; exit 1; }
copia "$BD_POST" asg_lock
FIN_LARGA="$SALIDAS/c7c.finlarga"; rm -f "$FIN_LARGA"
ctl_abrir asg_lock c7c 4
( PGAPPNAME=asg_larga psql -q -X -d asg_lock >/dev/null 2>&1 <<SQL || true; touch "$FIN_LARGA" ) &
BEGIN;
SELECT count(*) FROM public.app_users;
SELECT pg_advisory_xact_lock($PUERTA, 4);
COMMIT;
SQL
P_LARGA=$!
esperar_o_fin asg_lock "$(en_puerta 4)" "$FIN_LARGA"
INI=$(date +%s)
SALIDA_LECTOR=$(psql -q -v ON_ERROR_STOP=1 -d asg_lock -f "$SALIDAS/migracion0700_drop_trigger.sql" 2>&1) && { ctl_soltar 4; echo "❌ C · 0700 · con DROP TRIGGER y un lector de app_users la migración debía fallar por lock_timeout"; exit 1; }
FIN=$(date +%s)
ctl_soltar 4
wait $P_LARGA || true
echo "$SALIDA_LECTOR" | grep -q 'lock timeout' || { echo "❌ C · 0700 · la variante con DROP TRIGGER falló, pero no por lock_timeout:"; echo "$SALIDA_LECTOR" | grep -E 'ERROR' | head -3; exit 1; }
[ "$(pol_md5 asg_lock)" = "$(pol_md5 "$BD_POST")" ] || { echo "❌ C · 0700 · la variante con DROP TRIGGER dejó políticas cambiadas"; exit 1; }
[ "$(q "SELECT count(*) FROM pg_trigger WHERE tgname = 'trg_validar_proyecto_app_users'" asg_lock)" = "1" ] || { echo "❌ C · 0700 · la variante con DROP TRIGGER, que falló, dejó el trigger quitado"; exit 1; }
N_MUT_GUARDA=$((N_MUT_GUARDA + 1))
baja asg_lock
echo "  ✓ C · 0700 · una transacción larga que sólo LEE app_users no hace esperar a la 0700 (se aplica en $T_LECTOR s y deja el trigger; reaplicada, en $T_LECTOR2 s); mutación «DROP TRIGGER IF EXISTS + CREATE TRIGGER» (ACCESS EXCLUSIVE en cuanto el trigger existe): con el mismo lector la 0700 reaplicada FALLA en $((FIN - INI)) s por lock_timeout, no cambia ninguna política y no quita el trigger (la prueba ve el defecto)"

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
for SALIDA in "$SALIDA_DIAG_ANTES" "$SALIDA_DIAG_POST"; do
  echo "$SALIDA" | grep -q '8 administrables | filas que el propietario de su empresa puede administrar (persona y proyecto de SU empresa, empresa con propietario) | 33' || { echo "❌ el diagnóstico no cuenta las 33 filas que el propietario administra"; exit 1; }
  echo "$SALIDA" | grep -q 'o de una empresa sin propietario) | 10' || { echo "❌ el diagnóstico no cuenta las 10 filas que sólo alcanzan el superadministrador y el servicio"; exit 1; }
done
[ "$(echo "$SALIDA_DIAG_ANTES" | grep -c '^9 0700 .*admite al administrador (producción)')" = "13" ] || { echo "❌ antes de las migraciones las 13 políticas de la 0700 deben decir «admite al administrador (producción)»"; exit 1; }
[ "$(echo "$SALIDA_DIAG_POST" | grep -cE '^9 0700 .*(sólo el principal|role admin sólo del principal)')" = "13" ] || { echo "❌ tras las migraciones las 13 políticas de la 0700 deben decir «sólo el principal»"; exit 1; }
echo "$SALIDA_DIAG_POST" | grep -q '6 estado | regla asignacion_puede_administrar | del principal (propietario o superadministrador)' || { echo "❌ el diagnóstico no ve la regla del principal"; exit 1; }
echo "$SALIDA_DIAG_POST" | grep -q '7 principales | empresas con personas y SIN propietario' || { echo "❌ el diagnóstico no cuenta las empresas sin propietario"; exit 1; }
if PGOPTIONS="-c default_transaction_read_only=on" psql -q -v ON_ERROR_STOP=1 -d "$BD_POST" -c "DELETE FROM public.user_project_assignments" >/dev/null 2>&1; then
  echo "❌ control: la sesión de solo lectura permitió un DELETE"; exit 1
fi
echo "   ✓ una sentencia; corre con default_transaction_read_only=on (control: un DELETE ahí falla); antes: 10 huérfanas, EL HUECO señalado, 13 políticas que admiten al administrador y sin el trigger de app_users; después: «corregida», regla, 13 políticas del principal y el trigger puesto, anon sin privilegios; la sección «tabla» es idéntica; el propietario alcanza 33 de las 43 filas y las otras 10 sólo el superadministrador y el servicio"

echo ""
echo "══ TOTAL: $TOTAL comprobaciones ✓ en bloques de una sesión + los controles negativos, la reversión, $((N_MUT + N_MUT_CONC + N_MUT_ACL + N_MUT_GUARDA)) mutaciones ($N_MUT de catálogo + $N_MUT_CONC de concurrencia + $N_MUT_ACL de privilegios + $N_MUT_GUARDA de guardas), la concurrencia y el diagnóstico ══"
