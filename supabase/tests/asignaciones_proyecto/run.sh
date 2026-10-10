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
#      una autoasignación mientras otro administrador asigna; y la migración contra una transacción larga (lock_timeout);
#   9. scripts/diagnostico-asignaciones-proyecto.sql corre en una transacción de SOLO LECTURA y dice lo que debe.
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
  correr "pg_ctl -D $DATA stop -m immediate" >/dev/null 2>&1 || true
  rm -rf "$DATA" "$SOCK" "$SALIDAS"
}
trap limpiar EXIT
if [ -n "$COMO" ]; then chown -R postgres "$DATA" "$SOCK"; fi

correr "initdb -D $DATA -U postgres --auth=trust" >/dev/null
correr "pg_ctl -D $DATA -o '-p $PUERTO -k $SOCK' -l $DATA/pg.log start" >/dev/null
sleep 2

export PGHOST="$SOCK" PGPORT="$PUERTO" PGUSER=postgres
psql -q -d postgres -c "CREATE DATABASE $BD" >/dev/null

aplicar() {          # aplicar ARCHIVO [BD]   — en silencio, exige que termine bien
  PGOPTIONS="-c client_min_messages=warning" psql -q -v ON_ERROR_STOP=1 -d "${2:-$BD}" -f "$1" >/dev/null
}
copia()  { psql -q -d postgres -c "DROP DATABASE IF EXISTS $2" -c "CREATE DATABASE $2 TEMPLATE $1" >/dev/null; }
baja()   { psql -q -d postgres -c "DROP DATABASE IF EXISTS $1" >/dev/null; }
huella() { psql -q -v ON_ERROR_STOP=1 -tA -d "$1" -f "$HUELLA"; }          # huella normalizada del esquema public (la del auditor de drift)
q()      { psql -q -t -A -d "${2:-$BD}" -c "$1"; }

# Corre una suite y exige que TERMINE bien; muestra sus ✓.
bloque() {           # bloque ARCHIVO ETIQUETA [BD]
  local archivo="$1" etiqueta="$2" bd="${3:-$BD}" salida n
  echo "── $etiqueta"
  salida=$(psql -q -v ON_ERROR_STOP=1 -d "$bd" -f "$AQUI/$archivo" 2>&1) || {
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

echo "── 5/10 · DATOS COMO PRODUCCIÓN: las 43 filas y el alcance de cada persona, antes y después"
psql -q -v ON_ERROR_STOP=1 -v tag=despues -d "$BD" -f "$AQUI/snapshot.sql" >/dev/null
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

echo "── 7/10 · compatibilidad con las migraciones POSTERIORES a la serie (${POSTERIORES:+$(echo "$POSTERIORES" | wc -l) encontradas}${POSTERIORES:-ninguna en este árbol})"
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
mutacion() {         # mutacion ETIQUETA "SQL" "archivos que DEBEN ponerse rojos"
  local etq="$1" sql="$2" esperados="$3" bd=asg_mut rojas="" f
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

echo "── 10/10 · concurrencia: sesiones REALES simultáneas y la migración contra una transacción larga"
sesion() {           # sesion BASE ACTOR RETRASO RETENER ; el SQL llega por stdin
  local bd="$1" actor="$2" retraso="$3" retener="$4" sql
  sql=$(cat)
  psql -q -X -t -A -d "$bd" <<SQL
SELECT pg_sleep($retraso);
BEGIN;
SELECT asgt.poner_actor('$actor');
$sql
SELECT pg_sleep($retener);
COMMIT;
SQL
}
par() {              # par BASE NOMBRE ACTOR1 SQL1 ACTOR2 SQL2   — dos sesiones; la 2ª arranca 0,4 s después y la 1ª retiene 1,5 s
  local bd="$1" n="$2"
  sesion "$bd" "$3" 0   1.5 <<<"$4" > "$SALIDAS/${n}1.txt" 2>&1 &
  local p1=$!
  sesion "$bd" "$5" 0.4 0   <<<"$6" > "$SALIDAS/${n}2.txt" 2>&1 &
  local p2=$!
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
sin_deadlock a && ! grep -qi 'error' "$SALIDAS/a1.txt" "$SALIDAS/a2.txt" && [ "$R" = "P4,P5,P6,P7" ] \
  && echo "  ✓ A1 · dos administradores sobre la misma persona (borrar todas + insertar, proyectos distintos): sin deadlock ni error; queda la unión {$R} sin duplicados" \
  || { echo "❌ A1 · R=$R"; cat "$SALIDAS/a1.txt" "$SALIDAS/a2.txt"; exit 1; }
# A2 · con proyectos que SE SOLAPAN: uno gana, el otro recibe una violación de llave única limpia (nunca un deadlock ni filas dobles)
copia "$BD_POST" asg_conc
par asg_conc b AX "DELETE FROM public.user_project_assignments WHERE user_id = '$(UID_ 21)'; $(INS "$(v 21 4), $(v 21 5)")" \
                  AX2 "DELETE FROM public.user_project_assignments WHERE user_id = '$(UID_ 21)'; $(INS "$(v 21 4), $(v 21 6)")"
R=$(filas 21 asg_conc); DUP=$(q "SELECT count(*) FROM (SELECT user_id, project_id FROM public.user_project_assignments GROUP BY 1, 2 HAVING count(*) > 1) d" asg_conc)
sin_deadlock b && grep -q 'duplicate key' "$SALIDAS/b2.txt" && ! grep -qi 'error' "$SALIDAS/b1.txt" && [ "$R" = "P4,P5" ] && [ "$DUP" = "0" ] \
  && echo "  ✓ A2 · solapados: gana la primera ({$R}); la segunda recibe «duplicate key» (23505) y su transacción no deja nada; 0 duplicados" \
  || { echo "❌ A2 · R=$R DUP=$DUP"; cat "$SALIDAS/b1.txt" "$SALIDAS/b2.txt"; exit 1; }
# A3 · por DIFERENCIAS (insertar las que faltan con ON CONFLICT DO NOTHING): ambos terminan sin error y las filas que no cambian se conservan
copia "$BD_POST" asg_conc
ID_P1=$(q "SELECT id FROM public.user_project_assignments WHERE user_id = '$(UID_ 21)' AND project_id = '$(PID_ 1)'" asg_conc)
par asg_conc c AX "INSERT INTO public.user_project_assignments (user_id, project_id, permission_type) VALUES $(v 21 4) ON CONFLICT (user_id, project_id) DO NOTHING;" \
                  AX2 "INSERT INTO public.user_project_assignments (user_id, project_id, permission_type) VALUES $(v 21 4), $(v 21 5) ON CONFLICT (user_id, project_id) DO NOTHING;"
R=$(filas 21 asg_conc); ID_P1_DESPUES=$(q "SELECT id FROM public.user_project_assignments WHERE user_id = '$(UID_ 21)' AND project_id = '$(PID_ 1)'" asg_conc)
sin_deadlock c && ! grep -qi 'error' "$SALIDAS/c1.txt" "$SALIDAS/c2.txt" && [ "$R" = "P1,P2,P4,P5" ] && [ "$ID_P1" = "$ID_P1_DESPUES" ] \
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
baja asg_conc

# C · la migración contra una transacción larga sobre la tabla: lock_timeout (5 s) → falla limpio y no deja nada; reintentada después, aplica
copia "$BD_ANTES" asg_lock
( psql -q -X -d asg_lock <<SQL >/dev/null 2>&1
BEGIN;
LOCK TABLE public.user_project_assignments IN ROW EXCLUSIVE MODE;
SELECT pg_sleep(9);
COMMIT;
SQL
) &
P_LARGA=$!
sleep 1.5
INI=$(date +%s)
SALIDA_LOCK=$(psql -q -v ON_ERROR_STOP=1 -d asg_lock -f "$MIGS/$MIGRACION.sql" 2>&1) && { echo "❌ C · la migración no debía poder aplicarse con la tabla bloqueada"; exit 1; }
FIN=$(date +%s)
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
echo "══ TOTAL: $TOTAL comprobaciones ✓ en bloques de una sesión + los controles negativos, la reversión, $(grep -c 'mutacion "' "$0") mutaciones, la concurrencia y el diagnóstico ══"
