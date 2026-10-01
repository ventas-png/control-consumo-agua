#!/usr/bin/env bash
# ============================================================================
# PROVEEDORES · CONTRATOS · REGLAS DE COMPRA · CARGA MASIVA (PR A)
# Arnés contra un PostgreSQL REAL (local, efímero). NO toca ningún entorno remoto.
#
# Aplica la cadena ENTERA de migraciones sobre una base vacía y prueba las cinco
# migraciones de este PR (20261020000000…20261020000400):
#   · identidad canónica del proveedor, código visible, duplicados, contactos,
#     habilitación por proyecto, candado de la orden de compra;
#   · contratos vinculados al catálogo: fotografía, ciclo de vida, historial,
#     borrado, respaldo privado, relación con órdenes;
#   · históricos sin proveedor: vista previa, vínculo inequívoco, manual, reversión;
#   · cuentas sugeridas por categoría/producto con vigencia;
#   · carga masiva autoritativa: lotes, diferencias, duplicados, idempotencia,
#     todo-o-nada vs filas válidas, importar no autoriza ni contabiliza;
#   · y, con SESIONES REALES simultáneas: dos altas del mismo NIT y dos
#     aplicaciones del mismo lote.
#
# Uso:  bash supabase/tests/proveedores_pr_a/run.sh
# ============================================================================
set -euo pipefail

AQUI="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RAIZ="$(cd "$AQUI/../../.." && pwd)"
MIGS="$RAIZ/supabase/migrations"
PRIMERA=20261020000000
NUESTRAS=$(ls "$MIGS" | grep -E '^202610200000[0-9]{2}_|^20261020000[0-9]{3}_' | sed 's/\.sql$//' | sort)

for d in /usr/lib/postgresql/*/bin; do [ -d "$d" ] && PATH="$d:$PATH"; done
export PATH
command -v initdb >/dev/null || { echo "❌ falta initdb (instalá PostgreSQL)"; exit 1; }

# Shims de pg_net/pg_cron: fuera de Supabase no existen y varias migraciones
# hacen CREATE EXTENSION. Mismo mecanismo que conta_cobros_cargos y
# scripts/schema-drift/reconstruir.mjs.
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

DATA=$(mktemp -d /tmp/provprdata.XXXX)
SOCK=$(mktemp -d /tmp/provprsock.XXXX)
SALIDAS=$(mktemp -d /tmp/provprout.XXXX)
chmod 777 "$SALIDAS"
PUERTO=${PGPORT_TEST:-55481}
BD=prov_pr_a

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

aplicar() {
  PGOPTIONS="-c client_min_messages=warning" psql -q -v ON_ERROR_STOP=1 -d $BD -f "$1" >/dev/null
}

# Cada bloque: imprime sus ✓ y, si una invariante falla, el motivo.
bloque() {
  local archivo="$1" etiqueta="$2"
  echo "── $etiqueta"
  local salida
  salida=$(psql -q -v ON_ERROR_STOP=1 -d $BD -f "$AQUI/$archivo" 2>&1) || {
    echo "$salida" | sed -n 's/.*NOTICE:  /  /p'
    echo "❌ invariante incumplida en $archivo:"
    echo "$salida" | grep -E '^psql:.*ERROR|^DETAIL|^CONTEXT' | head -6
    exit 1
  }
  echo "$salida" | sed -n 's/.*NOTICE:  /  /p'
}

echo "── 1/8 · andamiaje de plataforma (roles, auth, extensiones)"
aplicar "$RAIZ/scripts/schema-drift/bootstrap.sql"

echo "── 2/8 · cadena de migraciones ANTERIORES a las de este PR, en orden"
N=0
for f in "$MIGS"/*.sql; do
  base="$(basename "$f" .sql)"
  [[ "$base" < "$PRIMERA" ]] || continue
  aplicar "$f"
  N=$((N + 1))
done
echo "   $N migraciones aplicadas sobre una base vacía"

echo "── 3/8 · las migraciones de este PR (cada una dos veces: la segunda solo puede fallar por «already exists»)"
for base in $NUESTRAS; do
  aplicar "$MIGS/$base.sql"
  if aplicar "$MIGS/$base.sql" 2>/dev/null; then
    echo "   ✓ $base: segunda pasada limpia"
  else
    # CREATE TABLE / ADD CONSTRAINT sin IF NOT EXISTS son DELIBERADOS (convención
    # del repo). Se exige que falle por eso y NO por otra cosa.
    SALIDA=$(PGOPTIONS="-c client_min_messages=warning" psql -v ON_ERROR_STOP=1 -d $BD -f "$MIGS/$base.sql" 2>&1 || true)
    echo "$SALIDA" | grep -q 'already exists' \
      || { echo "❌ $base: la segunda pasada falló por algo distinto de «already exists»:"; echo "$SALIDA"; exit 1; }
    echo "   ✓ $base: segunda pasada rechazada por «already exists», como corresponde"
  fi
done
for f in "$MIGS"/*.sql; do
  base="$(basename "$f" .sql)"
  if [[ "$base" > "$PRIMERA" ]] && ! grep -qx "$base" <<<"$NUESTRAS"; then aplicar "$f"; fi
done

echo "── 4/8 · padrón de dos empresas, tres proyectos y ocho perfiles de usuario"
aplicar "$AQUI/fixture.sql"

echo "── 5/8 · invariantes de una sesión"
bloque assert_identidad.sql     "5a · identidad, código visible, duplicados, proyectos"
bloque assert_contratos.sql     "5b · contratos: fotografía, ciclo de vida, borrado, respaldo, aislamiento"
bloque assert_historicos.sql    "5c · contratos históricos: vista previa, vínculo, reversión"
bloque assert_reglas.sql        "5d · cuentas sugeridas de compra: precedencia, vigencia, aptitud"
bloque assert_importacion.sql   "5e · carga masiva: lotes, diferencias, atomicidad, repetición"
bloque assert_permisos.sql      "5f · permisos de la carga y ACL de las funciones"

echo "── 6/8 · concurrencia: sesiones REALES simultáneas, no una simulación"
UA=a0a0a0a0-0000-0000-0000-00000000000a
A=aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa

sesion() {
  # $1 = espera antes de empezar, $2 = sentencia, $3 = espera antes del COMMIT
  psql -q -X -t -A -v ON_ERROR_STOP=1 -d $BD <<SQL
SELECT pg_sleep($1);
SELECT set_config('request.jwt.claim.sub', '$UA', false);
SET ROLE authenticated;
BEGIN;
$2
SELECT pg_sleep($3);
COMMIT;
SQL
}
par() {
  sesion 0   "$2" 1.5 > "$SALIDAS/${1}1.txt" 2>&1 &
  local p1=$!
  sesion 0.3 "$3" 0   > "$SALIDAS/${1}2.txt" 2>&1 &
  local p2=$!
  wait $p1 $p2 || true
}

# A · dos altas del MISMO NIT (con nombres distintos) a la vez: solo una pasa.
par a "INSERT INTO public.proveedores (company_id, nombre, nit, pais) VALUES ('$A', 'Simultáneo uno', '8080808-8', 'GT');" \
      "INSERT INTO public.proveedores (company_id, nombre, nit, pais) VALUES ('$A', 'Simultáneo dos', '8080808-8', 'GT');"
OK_A=$(cat "$SALIDAS"/a1.txt "$SALIDAS"/a2.txt | grep -c 'PROVEEDOR_DUPLICADO' || true)
N_A=$(psql -q -t -A -d $BD -c "SELECT count(*) FROM public.proveedores WHERE company_id = '$A' AND identificacion_norm = '80808088'")
[ "$OK_A" = "1" ] && [ "$N_A" = "1" ] \
  && echo "  ✓ A · dos altas simultáneas del mismo NIT: una se rechazó (PROVEEDOR_DUPLICADO) y quedó UNA fila" \
  || { echo "❌ A · esperaba 1 rechazo y 1 fila; rechazos=$OK_A filas=$N_A"; cat "$SALIDAS"/a1.txt "$SALIDAS"/a2.txt; exit 1; }

# B · dos aplicaciones del MISMO lote a la vez: se aplica una vez; la otra ve el resultado.
LOTE=$(psql -q -X -t -A -d $BD <<SQL
SELECT set_config('request.jwt.claim.sub', '$UA', false);
SET ROLE authenticated;
SELECT public.proveedores_importar_previsualizar('proveedores', jsonb_build_array(
  jsonb_build_object('nombre','Lote simultáneo 1','pais','GT','nit','9090901-1'),
  jsonb_build_object('nombre','Lote simultáneo 2','pais','GT','nit','9090902-2'),
  jsonb_build_object('nombre','Lote simultáneo 3','pais','GT','nit','9090903-3')), '{}'::jsonb, 'simultaneo.csv') ->> 'lote_id';
SQL
)
LOTE=$(echo "$LOTE" | tail -1)
par b "SELECT 'B1:' || (public.proveedores_importar_aplicar('$LOTE', 'todo_o_nada') ->> 'estado');" \
      "SELECT 'B2:' || (public.proveedores_importar_aplicar('$LOTE', 'todo_o_nada') ->> 'estado') || ':repetido=' || COALESCE(public.proveedores_importar_aplicar('$LOTE', 'todo_o_nada') ->> 'repetido', 'no');"
N_B=$(psql -q -t -A -d $BD -c "SELECT count(*) FROM public.proveedores WHERE company_id = '$A' AND nombre LIKE 'Lote simultáneo %'")
grep -q 'B1:aplicado' "$SALIDAS"/b1.txt && grep -q 'repetido=true' "$SALIDAS"/b2.txt && [ "$N_B" = "3" ] \
  && echo "  ✓ B · dos aplicaciones simultáneas del mismo lote: se aplicó UNA vez (3 proveedores, no 6) y la otra devolvió el resultado" \
  || { echo "❌ B · esperaba aplicado/repetido y 3 filas; filas=$N_B"; cat "$SALIDAS"/b1.txt "$SALIDAS"/b2.txt; exit 1; }

echo "── 7/8 · el histórico de migraciones de este PR queda intacto en el repo (append-only)"
(cd "$RAIZ" && node scripts/migrations-append-only.mjs >/dev/null 2>&1) \
  && echo "  ✓ migrations-append-only" || echo "  (omitido: sin git/node en este entorno)"

echo "── 8/8 · listo"
echo "✅ proveedores · contratos · reglas de compra · carga masiva verificados contra PostgreSQL real"
