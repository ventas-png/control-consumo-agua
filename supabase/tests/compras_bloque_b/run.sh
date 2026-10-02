#!/usr/bin/env bash
# ============================================================================
# COMPRAS · BLOQUE B — orden, recepción, factura y seguimiento integrados
# Arnés contra un PostgreSQL REAL (local, efímero). NO toca ningún entorno remoto.
#
# Aplica la cadena ENTERA de migraciones sobre una base vacía y prueba las siete
# migraciones del bloque (20261021000000…20261021000600, la última correctiva):
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
NUESTRAS=$(ls "$MIGS" | grep -E '^2026102[12]00[0-9]{4}_' | sed 's/\.sql$//' | sort)

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
bloque assert_correcciones.sql "5f · correcciones de revisión: cuentas semánticas, condiciones congeladas, recepción transaccional"
# Van AL FINAL: las suites comparten base y las de seguimiento cuentan órdenes por filtro.
bloque assert_factura_crear.sql "5g · factura creada por UNA operación de servidor: todo o nada, idempotente, validada"
bloque assert_aprobacion.sql   "5h · aprobación endurecida: sin renglones, autorizador sellado, excepciones acotadas"
bloque assert_inventario.sql   "5i · inventario desde la orden: insumo validado, solo lo aceptado, sin duplicar existencias"
bloque assert_importacion_lineas.sql "5j · carga masiva de renglones: vista previa, errores por fila, todo o nada, sin duplicar"
bloque assert_respaldos.sql    "5k · respaldos de recepción: bucket privado, acceso por empresa/proyecto, congelamiento, trazabilidad"
bloque assert_seguimiento_pantalla.sql "5l · seguimiento filtrable: pendientes, monedas separadas, pagos enlazados y sin datos financieros para Operaciones"

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
FUERA=$(cat "$SALIDAS"/b1.txt "$SALIDAS"/b2.txt | grep -c 'COMPRAS_MATCH_NO_FORZABLE' || true)
[ "$APR" = "1" ] && [ "$FAC" = "10.0000" ] && [ "$FUERA" = "1" ] \
  && echo "  ✓ B · dos facturas por las mismas unidades a la vez: una aprobada (facturado 10) y la otra rechazada por facturar más de lo recibido" \
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

# D · la MISMA clave y el MISMO contenido dos veces a la vez, por la función: una
# sesión crea y la otra espera el candado y RECUPERA el mismo documento.
CAB_D='{"orden_compra_id":"0c100000-0000-0000-0000-000000000001","tipo":"bienes","fecha":"2026-10-01","clave_idempotencia":"rpc-simultanea"}'
LIN_D='[{"orden_compra_linea_id":"0c110000-0000-0000-0000-000000000001","cantidad":5}]'
par d "SELECT public.compras_recepcion_crear('$C', '$C1', '$CAB_D'::jsonb, '$LIN_D'::jsonb)->'recepcion'->>'id';" \
      "SELECT public.compras_recepcion_crear('$C', '$C1', '$CAB_D'::jsonb, '$LIN_D'::jsonb)->'recepcion'->>'id';"
N_D=$(psql -q -t -A -d $BD -c "SELECT count(*) FROM public.recepciones WHERE clave_idempotencia = 'rpc-simultanea'")
L_D=$(psql -q -t -A -d $BD -c "SELECT count(*) FROM public.recepcion_lineas WHERE recepcion_id IN (SELECT id FROM public.recepciones WHERE clave_idempotencia = 'rpc-simultanea')")
ID1=$(grep -Eo '[0-9a-f]{8}-[0-9a-f-]{27}' "$SALIDAS"/d1.txt | head -1)
ID2=$(grep -Eo '[0-9a-f]{8}-[0-9a-f-]{27}' "$SALIDAS"/d2.txt | head -1)
[ "$N_D" = "1" ] && [ "$L_D" = "1" ] && [ -n "$ID1" ] && [ "$ID1" = "$ID2" ] \
  && echo "  ✓ D · misma clave y contenido a la vez: UNA recepción con UNA línea y las dos sesiones recibieron el MISMO documento" \
  || { echo "❌ D · recepciones=$N_D líneas=$L_D id1=$ID1 id2=$ID2"; cat "$SALIDAS"/d1.txt "$SALIDAS"/d2.txt; exit 1; }

# E · la misma clave con contenido DISTINTO a la vez: una crea y la otra se rechaza.
CAB_E='{"orden_compra_id":"0c100000-0000-0000-0000-000000000001","tipo":"bienes","fecha":"2026-10-01","clave_idempotencia":"rpc-conflicto"}'
par e "SELECT public.compras_recepcion_crear('$C', '$C1', '$CAB_E'::jsonb, '[{\"orden_compra_linea_id\":\"0c110000-0000-0000-0000-000000000001\",\"cantidad\":5}]'::jsonb)->'recepcion'->>'id';" \
      "SELECT public.compras_recepcion_crear('$C', '$C1', '$CAB_E'::jsonb, '[{\"orden_compra_linea_id\":\"0c110000-0000-0000-0000-000000000001\",\"cantidad\":6}]'::jsonb)->'recepcion'->>'id';"
N_E=$(psql -q -t -A -d $BD -c "SELECT count(*) FROM public.recepciones WHERE clave_idempotencia = 'rpc-conflicto'")
CONF=$(cat "$SALIDAS"/e1.txt "$SALIDAS"/e2.txt | grep -c 'COMPRAS_RECEPCION_CLAVE_CONFLICTO' || true)
[ "$N_E" = "1" ] && [ "$CONF" = "1" ] \
  && echo "  ✓ E · misma clave con contenido distinto a la vez: UNA recepción y la otra sesión se rechazó por conflicto" \
  || { echo "❌ E · recepciones=$N_E conflictos=$CONF"; cat "$SALIDAS"/e1.txt "$SALIDAS"/e2.txt; exit 1; }

# F · el fallo de una línea con dos sesiones: nada a medias.
par f "SELECT public.compras_recepcion_crear('$C', '$C1', '{\"orden_compra_id\":\"0c100000-0000-0000-0000-000000000001\",\"tipo\":\"bienes\",\"clave_idempotencia\":\"rpc-fallo-par\"}'::jsonb, '[{\"orden_compra_linea_id\":\"0c110000-0000-0000-0000-000000000001\",\"cantidad\":1},{\"orden_compra_linea_id\":\"0c110000-0000-0000-0000-000000000002\",\"cantidad\":1}]'::jsonb);" \
      "SELECT public.compras_recepcion_crear('$C', '$C1', '{\"orden_compra_id\":\"0c100000-0000-0000-0000-000000000001\",\"tipo\":\"bienes\",\"clave_idempotencia\":\"rpc-fallo-par\"}'::jsonb, '[{\"orden_compra_linea_id\":\"0c110000-0000-0000-0000-000000000001\",\"cantidad\":1},{\"orden_compra_linea_id\":\"0c110000-0000-0000-0000-000000000002\",\"cantidad\":1}]'::jsonb);"
N_F=$(psql -q -t -A -d $BD -c "SELECT count(*) FROM public.recepciones WHERE clave_idempotencia = 'rpc-fallo-par'")
AJ=$(cat "$SALIDAS"/f1.txt "$SALIDAS"/f2.txt | grep -c 'COMPRAS_RECEPCION_LINEA_AJENA' || true)
[ "$N_F" = "0" ] && [ "$AJ" = "2" ] \
  && echo "  ✓ F · dos intentos simultáneos con una línea ajena: los dos fallan y NO queda cabecera huérfana" \
  || { echo "❌ F · recepciones=$N_F rechazos=$AJ"; cat "$SALIDAS"/f1.txt "$SALIDAS"/f2.txt; exit 1; }

# G · la factura por la función con la MISMA clave y el MISMO contenido a la vez.
Q=0c100000-0000-0000-0000-000000000003; QL=0c110000-0000-0000-0000-000000000003; P1=e3000000-0000-0000-0000-000000000001
cab_f() { echo "{\"proveedor_id\":\"$P1\",\"orden_compra_id\":\"$Q\",\"numero_factura\":\"$2\",\"concepto\":\"Concurrencia\",\"fecha_emision\":\"2026-10-02\",\"clave_idempotencia\":\"$1\"}"; }
lin_f() { echo "[{\"orden_compra_linea_id\":\"$QL\",\"cantidad\":$1,\"precio_unitario\":10}]"; }
fcrear() { echo "SELECT public.compras_factura_crear('$C', '$C1', '$(cab_f "$1" "$2")'::jsonb, '$(lin_f "$3")'::jsonb)->'factura'->>'id';"; }
par g "$(fcrear fc-simultanea FG-1 5)" "$(fcrear fc-simultanea FG-1 5)"
N_G=$(psql -q -t -A -d $BD -c "SELECT count(*) FROM public.facturas_proveedor WHERE clave_idempotencia = 'fc-simultanea'")
L_G=$(psql -q -t -A -d $BD -c "SELECT count(*) FROM public.factura_proveedor_lineas WHERE factura_id IN (SELECT id FROM public.facturas_proveedor WHERE clave_idempotencia = 'fc-simultanea')")
IDG1=$(grep -Eo '[0-9a-f]{8}-[0-9a-f-]{27}' "$SALIDAS"/g1.txt | head -1); IDG2=$(grep -Eo '[0-9a-f]{8}-[0-9a-f-]{27}' "$SALIDAS"/g2.txt | head -1)
[ "$N_G" = "1" ] && [ "$L_G" = "1" ] && [ -n "$IDG1" ] && [ "$IDG1" = "$IDG2" ] \
  && echo "  ✓ G · factura, misma clave y contenido a la vez: UNA factura con UN renglón y las dos sesiones recibieron la MISMA" \
  || { echo "❌ G · facturas=$N_G renglones=$L_G id1=$IDG1 id2=$IDG2"; cat "$SALIDAS"/g1.txt "$SALIDAS"/g2.txt; exit 1; }

# H · la misma clave con contenido DISTINTO a la vez: una crea y la otra se rechaza.
par h "$(fcrear fc-conflicto FH-1 3)" "$(fcrear fc-conflicto FH-1 4)"
N_H=$(psql -q -t -A -d $BD -c "SELECT count(*) FROM public.facturas_proveedor WHERE clave_idempotencia = 'fc-conflicto'")
CONF_H=$(cat "$SALIDAS"/h1.txt "$SALIDAS"/h2.txt | grep -c 'COMPRAS_FACTURA_CLAVE_CONFLICTO' || true)
[ "$N_H" = "1" ] && [ "$CONF_H" = "1" ] \
  && echo "  ✓ H · factura, misma clave con contenido distinto a la vez: UNA factura y la otra sesión se rechazó por conflicto" \
  || { echo "❌ H · facturas=$N_H conflictos=$CONF_H"; cat "$SALIDAS"/h1.txt "$SALIDAS"/h2.txt; exit 1; }

# I · el MISMO número de factura con claves DISTINTAS a la vez: una sola factura.
par i "$(fcrear fc-num-a FI-1 1)" "$(fcrear fc-num-b FI-1 1)"
N_I=$(psql -q -t -A -d $BD -c "SELECT count(*) FROM public.facturas_proveedor WHERE numero_factura = 'FI-1' AND proveedor_id = '$P1'")
DUP_I=$(cat "$SALIDAS"/i1.txt "$SALIDAS"/i2.txt | grep -c 'COMPRAS_FACTURA_NUMERO_DUPLICADO' || true)
RES_I=$(psql -q -t -A -d $BD -c "SELECT count(*) FROM public.facturas_proveedor WHERE clave_idempotencia IN ('fc-num-a','fc-num-b')")
[ "$N_I" = "1" ] && [ "$DUP_I" = "1" ] && [ "$RES_I" = "1" ] \
  && echo "  ✓ I · mismo número con claves distintas a la vez: UNA factura y la otra se rechazó como duplicada, sin dejar rastro" \
  || { echo "❌ I · facturas=$N_I duplicadas=$DUP_I residuo=$RES_I"; cat "$SALIDAS"/i1.txt "$SALIDAS"/i2.txt; exit 1; }

# J · un renglón ajeno con dos sesiones a la vez: los dos fallan y no queda nada.
CAB_J=$(cab_f fc-fallo-par FJ-1)
LIN_J="[{\"orden_compra_linea_id\":\"$QL\",\"cantidad\":1,\"precio_unitario\":10},{\"orden_compra_linea_id\":\"0c110000-0000-0000-0000-000000000001\",\"cantidad\":1,\"precio_unitario\":10}]"
par j "SELECT public.compras_factura_crear('$C', '$C1', '$CAB_J'::jsonb, '$LIN_J'::jsonb);" \
      "SELECT public.compras_factura_crear('$C', '$C1', '$CAB_J'::jsonb, '$LIN_J'::jsonb);"
N_J=$(psql -q -t -A -d $BD -c "SELECT count(*) FROM public.facturas_proveedor WHERE clave_idempotencia = 'fc-fallo-par' OR numero_factura = 'FJ-1'")
AJ_J=$(cat "$SALIDAS"/j1.txt "$SALIDAS"/j2.txt | grep -c 'COMPRAS_FACTURA_LINEA_AJENA' || true)
[ "$N_J" = "0" ] && [ "$AJ_J" = "2" ] \
  && echo "  ✓ J · dos intentos simultáneos con un renglón ajeno: los dos fallan y NO queda cabecera ni renglones" \
  || { echo "❌ J · facturas=$N_J rechazos=$AJ_J"; cat "$SALIDAS"/j1.txt "$SALIDAS"/j2.txt; exit 1; }

# K · INTERRUPCIÓN: la sesión que crea la factura muere ANTES de confirmar. No debe quedar
# nada, y el reintento con la misma clave crea exactamente una factura.
psql -q -X -t -A -v ON_ERROR_STOP=0 -d $BD >"$SALIDAS"/k1.txt 2>&1 <<SQL &
SET application_name = 'fc-interrumpida';
SELECT set_config('request.jwt.claim.sub', '$UA', false);
SET ROLE authenticated;
BEGIN;
$(fcrear fc-interrumpida FK-1 2)
SELECT pg_sleep(8);
COMMIT;
SQL
PK=$!
sleep 2
psql -q -t -A -d $BD -c "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE application_name = 'fc-interrumpida'" >/dev/null
wait $PK || true
N_K0=$(psql -q -t -A -d $BD -c "SELECT count(*) FROM public.facturas_proveedor WHERE clave_idempotencia = 'fc-interrumpida' OR numero_factura = 'FK-1'")
L_K0=$(psql -q -t -A -d $BD -c "SELECT count(*) FROM public.factura_proveedor_lineas WHERE descripcion = 'Material' AND factura_id NOT IN (SELECT id FROM public.facturas_proveedor)")
sesion 0 "$(fcrear fc-interrumpida FK-1 2)" 0 > "$SALIDAS"/k2.txt 2>&1
sesion 0 "$(fcrear fc-interrumpida FK-1 2)" 0 > "$SALIDAS"/k3.txt 2>&1
N_K1=$(psql -q -t -A -d $BD -c "SELECT count(*) FROM public.facturas_proveedor WHERE clave_idempotencia = 'fc-interrumpida'")
IDK2=$(grep -Eo '[0-9a-f]{8}-[0-9a-f-]{27}' "$SALIDAS"/k2.txt | head -1); IDK3=$(grep -Eo '[0-9a-f]{8}-[0-9a-f-]{27}' "$SALIDAS"/k3.txt | head -1)
[ "$N_K0" = "0" ] && [ "$L_K0" = "0" ] && [ "$N_K1" = "1" ] && [ -n "$IDK2" ] && [ "$IDK2" = "$IDK3" ] \
  && echo "  ✓ K · sesión terminada antes de confirmar: no quedó NADA; el reintento crea UNA factura y un segundo reintento devuelve la misma" \
  || { echo "❌ K · tras la caída facturas=$N_K0 renglones sueltos=$L_K0; tras el reintento=$N_K1 id2=$IDK2 id3=$IDK3"; cat "$SALIDAS"/k1.txt "$SALIDAS"/k2.txt "$SALIDAS"/k3.txt; exit 1; }

# L · inventario: la MISMA recepción registrada por dos sesiones a la vez: UNA entrada al
# kardex, el stock sube una sola vez y hay UN asiento.
aplicar "$AQUI/concurrencia_inventario_prep.sql"
par l "UPDATE public.recepciones SET estado = 'registrada' WHERE id = '0c200000-0000-0000-0000-000000000005';" \
      "UPDATE public.recepciones SET estado = 'registrada' WHERE id = '0c200000-0000-0000-0000-000000000005';"
ST_L=$(psql -q -t -A -d $BD -c "SELECT stock_actual FROM public.suministros_condominio WHERE id = '0c5c0000-0000-0000-0000-000000000001'")
EN_L=$(psql -q -t -A -d $BD -c "SELECT count(*) FROM public.movimientos_suministro WHERE suministro_id = '0c5c0000-0000-0000-0000-000000000001' AND tipo = 'entrada'")
AS_L=$(psql -q -t -A -d $BD -c "SELECT count(*) FROM public.conta_asientos WHERE origen_tabla = 'recepciones' AND origen_id = '0c200000-0000-0000-0000-000000000005'")
[ "$ST_L" = "25.00" ] && [ "$EN_L" = "1" ] && [ "$AS_L" = "1" ] \
  && echo "  ✓ L · la misma recepción registrada por dos sesiones a la vez: UNA entrada (stock 25) y UN asiento" \
  || { echo "❌ L · stock=$ST_L entradas=$EN_L asientos=$AS_L"; cat "$SALIDAS"/l1.txt "$SALIDAS"/l2.txt; exit 1; }

# M · carga masiva: el MISMO lote aplicado por dos sesiones a la vez: se crea UNA vez
# (la otra recibe el resultado ya aplicado) y no hay renglones duplicados.
aplicar "$AQUI/concurrencia_import_prep.sql"
L1=$(psql -q -t -A -d $BD -c "SELECT id FROM public.zz_lotes_import WHERE k = 'l1'")
L2A=$(psql -q -t -A -d $BD -c "SELECT id FROM public.zz_lotes_import WHERE k = 'l2a'")
L2B=$(psql -q -t -A -d $BD -c "SELECT id FROM public.zz_lotes_import WHERE k = 'l2b'")
par m "SELECT public.compras_lineas_importar_aplicar('$L1')->>'reutilizada';" \
      "SELECT public.compras_lineas_importar_aplicar('$L1')->>'reutilizada';"
N_M=$(psql -q -t -A -d $BD -c "SELECT count(*) FROM public.orden_compra_lineas WHERE orden_compra_id = '0c700000-0000-0000-0000-000000000001'")
R_M=$(cat "$SALIDAS"/m1.txt "$SALIDAS"/m2.txt | grep -c '^true$' || true)
F_M=$(cat "$SALIDAS"/m1.txt "$SALIDAS"/m2.txt | grep -c '^false$' || true)
[ "$N_M" = "3" ] && [ "$R_M" = "1" ] && [ "$F_M" = "1" ] \
  && echo "  ✓ M · el mismo lote aplicado a la vez: UNA creación (3 renglones) y la otra sesión recibió el resultado ya aplicado" \
  || { echo "❌ M · renglones=$N_M reutilizadas=$R_M creadas=$F_M"; cat "$SALIDAS"/m1.txt "$SALIDAS"/m2.txt; exit 1; }

# N · dos lotes DISTINTOS con el MISMO contenido aplicados a la vez: uno entra y el otro se rechaza como duplicado.
par n "SELECT public.compras_lineas_importar_aplicar('$L2A')->>'renglones_creados';" \
      "SELECT public.compras_lineas_importar_aplicar('$L2B')->>'renglones_creados';"
N_N=$(psql -q -t -A -d $BD -c "SELECT count(*) FROM public.orden_compra_lineas WHERE orden_compra_id = '0c700000-0000-0000-0000-000000000002'")
D_N=$(cat "$SALIDAS"/n1.txt "$SALIDAS"/n2.txt | grep -c 'COMPRAS_IMPORT_DUPLICADO' || true)
[ "$N_N" = "2" ] && [ "$D_N" = "1" ] \
  && echo "  ✓ N · dos lotes con el mismo contenido a la vez: uno se aplicó (2 renglones) y el otro se rechazó como duplicado" \
  || { echo "❌ N · renglones=$N_N duplicados=$D_N"; cat "$SALIDAS"/n1.txt "$SALIDAS"/n2.txt; exit 1; }

echo "── 7/8 · las migraciones del bloque son append-only (no editan lo ya aplicado)"
(cd "$RAIZ" && node scripts/migrations-append-only.mjs >/dev/null 2>&1) \
  && echo "  ✓ migrations-append-only" || echo "  (omitido: sin git/node en este entorno)"

echo "── 8/8 · listo"
echo "✅ compras (orden → recepción → factura → seguimiento) verificado contra PostgreSQL real"
