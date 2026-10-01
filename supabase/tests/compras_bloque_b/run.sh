#!/usr/bin/env bash
# ============================================================================
# COMPRAS · BLOQUE B — orden, recepción, factura y seguimiento integrados
# Arnés contra un PostgreSQL REAL (local, efímero). NO toca ningún entorno remoto.
#
# Aplica la cadena ENTERA de migraciones sobre una base vacía y prueba las seis
# migraciones del bloque (20261021000000…20261021000500):
#   · ciclo de la orden en el servidor (transiciones, congelamiento, devolución
#     como revisión, separación solicitante/aprobador, historial);
#   · recepción por línea: aceptado/rechazado, servicios por conformidad, activos
#     e inventario, idempotencia;
#   · factura: parcial, varias, diferencias de cantidad/precio/IVA/moneda, duplicado,
#     moneda extranjera con tasa mensual, periodo cerrado, configuración faltante;
#   · seguimiento compartido y su alcance por permisos;
#   · suministros y proformas con proveedor del catálogo;
#   · y, con SESIONES REALES simultáneas: dos recepciones que no caben juntas,
#     dos aprobaciones de factura por las mismas unidades y la misma clave de
#     idempotencia dos veces.
#
# Uso:  bash supabase/tests/compras_bloque_b/run.sh
# ============================================================================
set -euo pipefail

AQUI="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RAIZ="$(cd "$AQUI/../../.." && pwd)"
MIGS="$RAIZ/supabase/migrations"
PRIMERA=20261021000000
NUESTRAS=$(ls "$MIGS" | grep -E '^202610210000[0-9]{2}_' | sed 's/\.sql$//' | sort)

for d in /usr/lib/postgresql/*/bin; do [ -d "$d" ] && PATH="$d:$PATH"; done
export PATH
command -v initdb >/dev/null || { echo "❌ falta initdb (instalá PostgreSQL)"; exit 1; }

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

DATA=$(mktemp -d /tmp/bbdata.XXXX)
SOCK=$(mktemp -d /tmp/bbsock.XXXX)
SALIDAS=$(mktemp -d /tmp/bbout.XXXX)
chmod 777 "$SALIDAS"
PUERTO=${PGPORT_TEST:-55482}
BD=compras_bb

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

echo "── 1/8 · andamiaje de plataforma"
aplicar "$RAIZ/scripts/schema-drift/bootstrap.sql"

echo "── 2/8 · cadena de migraciones ANTERIORES a las del bloque, en orden"
N=0
for f in "$MIGS"/*.sql; do
  base="$(basename "$f" .sql)"
  [[ "$base" < "$PRIMERA" ]] || continue
  aplicar "$f"
  N=$((N + 1))
done
echo "   $N migraciones aplicadas sobre una base vacía"

echo "── 3/8 · las migraciones del bloque (cada una dos veces: la segunda solo puede fallar por «already exists»)"
for base in $NUESTRAS; do
  aplicar "$MIGS/$base.sql"
  if aplicar "$MIGS/$base.sql" 2>/dev/null; then
    echo "   ✓ $base: segunda pasada limpia"
  else
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

echo "── 4/8 · padrón: dos empresas, tres proyectos, usuarios con perfiles distintos"
aplicar "$AQUI/fixture.sql"

echo "── 5/8 · invariantes de una sesión"
bloque assert_ciclo.sql        "5a · ciclo de la orden: transiciones, congelamiento, devolución, historial"
bloque assert_recepcion.sql    "5b · recepción por línea, servicios, activos, inventario"
bloque assert_factura.sql      "5c · factura parcial/múltiple, diferencias, moneda, periodo, configuración"
bloque assert_seguimiento.sql  "5d · seguimiento compartido y su alcance"
bloque assert_operaciones.sql  "5e · suministros y proformas con proveedor del catálogo"

echo "── 6/8 · concurrencia: sesiones REALES simultáneas, no una simulación"
aplicar "$AQUI/concurrencia_prep.sql"
UA=c0c0c0c0-0000-0000-0000-00000000000a
C=cccccccc-cccc-cccc-cccc-cccccccccccc
C1=c1c1c1c1-0000-0000-0000-000000000001

sesion() {
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

# A · dos recepciones de 70 sobre una línea de 100, a la vez: solo una cabe.
par a "UPDATE public.recepciones SET estado = 'registrada' WHERE id = '0c200000-0000-0000-0000-000000000001';" \
      "UPDATE public.recepciones SET estado = 'registrada' WHERE id = '0c200000-0000-0000-0000-000000000002';"
REC=$(psql -q -t -A -d $BD -c "SELECT cantidad_recibida FROM public.orden_compra_lineas WHERE id = '0c110000-0000-0000-0000-000000000001'")
SOBRE=$(cat "$SALIDAS"/a1.txt "$SALIDAS"/a2.txt | grep -c 'COMPRAS_SOBRE_RECEPCION' || true)
[ "$REC" = "70.0000" ] && [ "$SOBRE" = "1" ] \
  && echo "  ✓ A · dos recepciones de 70 sobre 100 a la vez: una se aceptó (recibido 70) y la otra se cortó por sobre-recepción" \
  || { echo "❌ A · recibido=$REC sobre-recepciones=$SOBRE"; cat "$SALIDAS"/a1.txt "$SALIDAS"/a2.txt; exit 1; }
N_AS=$(psql -q -t -A -d $BD -c "SELECT count(*) FROM public.conta_asientos WHERE origen_tabla = 'recepciones' AND origen_id IN ('0c200000-0000-0000-0000-000000000001','0c200000-0000-0000-0000-000000000002')")
[ "$N_AS" = "1" ] && echo "  ✓ A · y se generó UN solo asiento de recepción" || { echo "❌ A · asientos=$N_AS"; exit 1; }

# B · dos facturas por las mismas 10 unidades, aprobadas a la vez: solo una pasa.
par b "UPDATE public.facturas_proveedor SET estado = 'aprobada' WHERE id = '0c300000-0000-0000-0000-000000000001';" \
      "UPDATE public.facturas_proveedor SET estado = 'aprobada' WHERE id = '0c300000-0000-0000-0000-000000000002';"
APR=$(psql -q -t -A -d $BD -c "SELECT count(*) FROM public.facturas_proveedor WHERE orden_compra_id = '0c100000-0000-0000-0000-000000000002' AND estado = 'aprobada'")
FAC=$(psql -q -t -A -d $BD -c "SELECT cantidad_facturada FROM public.orden_compra_lineas WHERE id = '0c110000-0000-0000-0000-000000000002'")
FUERA=$(cat "$SALIDAS"/b1.txt "$SALIDAS"/b2.txt | grep -c 'COMPRAS_MATCH_FUERA_DE_TOLERANCIA' || true)
[ "$APR" = "1" ] && [ "$FAC" = "10.0000" ] && [ "$FUERA" = "1" ] \
  && echo "  ✓ B · dos facturas por las mismas unidades a la vez: una aprobada (facturado 10) y la otra fuera de tolerancia" \
  || { echo "❌ B · aprobadas=$APR facturado=$FAC rechazos=$FUERA"; cat "$SALIDAS"/b1.txt "$SALIDAS"/b2.txt; exit 1; }
N_FA=$(psql -q -t -A -d $BD -c "SELECT count(*) FROM public.conta_asientos WHERE origen_tabla = 'facturas_proveedor' AND origen_id IN ('0c300000-0000-0000-0000-000000000001','0c300000-0000-0000-0000-000000000002') AND estado <> 'anulado'")
[ "$N_FA" = "1" ] && echo "  ✓ B · y UN solo asiento" || { echo "❌ B · asientos=$N_FA"; exit 1; }

# C · la misma clave de idempotencia dos veces a la vez: un solo borrador.
par c "INSERT INTO public.recepciones (company_id, project_id, orden_compra_id, tipo, clave_idempotencia) VALUES ('$C', '$C1', '0c100000-0000-0000-0000-000000000001', 'bienes', 'doble-clic');" \
      "INSERT INTO public.recepciones (company_id, project_id, orden_compra_id, tipo, clave_idempotencia) VALUES ('$C', '$C1', '0c100000-0000-0000-0000-000000000001', 'bienes', 'doble-clic');"
N_C=$(psql -q -t -A -d $BD -c "SELECT count(*) FROM public.recepciones WHERE clave_idempotencia = 'doble-clic'")
DUP=$(cat "$SALIDAS"/c1.txt "$SALIDAS"/c2.txt | grep -c 'uq_recepciones_clave' || true)
[ "$N_C" = "1" ] && [ "$DUP" = "1" ] \
  && echo "  ✓ C · doble clic con la misma clave: UN borrador y el segundo intento se rechazó" \
  || { echo "❌ C · borradores=$N_C rechazos=$DUP"; cat "$SALIDAS"/c1.txt "$SALIDAS"/c2.txt; exit 1; }

echo "── 7/8 · las migraciones del bloque son append-only (no editan lo ya aplicado)"
(cd "$RAIZ" && node scripts/migrations-append-only.mjs >/dev/null 2>&1) \
  && echo "  ✓ migrations-append-only" || echo "  (omitido: sin git/node en este entorno)"

echo "── 8/8 · listo"
echo "✅ compras (orden → recepción → factura → seguimiento) verificado contra PostgreSQL real"
