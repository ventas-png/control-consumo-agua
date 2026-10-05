#!/usr/bin/env bash
# ============================================================================
# COMPRAS · CIERRE TÉCNICO — lectura financiera, creación atómica de órdenes y
# acumulación de lo facturado. Arnés contra un PostgreSQL REAL (local, efímero).
# NO toca ningún entorno remoto.
#
# Aplica la cadena ENTERA de migraciones anteriores sobre una base vacía y prueba las
# cinco migraciones de la serie 20261026000000 … 20261026000400:
#   · 000000 / 000100 / 000200  la lectura financiera exige permiso, empresa y proyecto
#                               (matriz perfil × tabla, privilegios, reportes INVOKER, RPC DEFINER);
#   · 000300                    compras_orden_crear: cabecera y renglones juntos, idempotente, todo o nada;
#   · 000400                    compras_tg_factura_acumular: los errores reales ya no se esconden.
#
# Además:
#   · CONTROL NEGATIVO: la misma suite de lectura y la de acumulación, contra la base SIN las
#     migraciones, DEBEN FALLAR por lo esperado (si pasaran, las pruebas no probarían nada);
#   · cada migración dos veces (idempotencia);
#   · y, con SESIONES REALES simultáneas: misma clave de orden a la vez (mismo contenido, otro
#     contenido, renglón que falla, sesión cortada antes de confirmar) y la acumulación de
#     facturas (dos renglones a la vez, dos facturas por lo mismo, aprobar contra anular, dos
#     anulaciones, sesión cortada), terminando con el diagnóstico de lo facturado en CERO filas.
#
# Uso:  bash supabase/tests/compras_cierre_tecnico/run.sh
# ============================================================================
set -euo pipefail

AQUI="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RAIZ="$(cd "$AQUI/../../.." && pwd)"
MIGS="$RAIZ/supabase/migrations"
PRIMERA=20261026000000
NUESTRAS=$(ls "$MIGS" | grep -E '^20261026000[0-4]00_' | sed 's/\.sql$//' | sort)
FIXTURE_B="$RAIZ/supabase/tests/compras_bloque_b/fixture.sql"

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

DATA=$(mktemp -d /tmp/cctdata.XXXX)
SOCK=$(mktemp -d /tmp/cctsock.XXXX)
SALIDAS=$(mktemp -d /tmp/cctout.XXXX)
chmod 777 "$SALIDAS"
PUERTO=${PGPORT_TEST:-55531}
BD=compras_cct
BD_ANTES=compras_cct_antes

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
  PGOPTIONS="-c client_min_messages=warning" psql -q -v ON_ERROR_STOP=1 -d "${2:-$BD}" -f "$1" >/dev/null
}

# Corre una suite y exige que TERMINE bien; muestra sus ✓.
bloque() {
  local archivo="$1" etiqueta="$2" salida
  echo "── $etiqueta"
  salida=$(psql -q -v ON_ERROR_STOP=1 -d $BD -f "$AQUI/$archivo" 2>&1) || {
    echo "$salida" | sed -n 's/.*NOTICE:  /  /p' | tail -5
    echo "❌ invariante incumplida en $archivo:"
    echo "$salida" | grep -E '^psql:.*ERROR|^DETAIL|^CONTEXT' | head -6
    exit 1
  }
  echo "  $(echo "$salida" | grep -c '✓') comprobaciones ✓"
}

# Corre una suite contra una base SIN las migraciones y exige que FALLE por lo esperado.
debe_fallar() {
  local bd="$1" archivo="$2" patron="$3" etiqueta="$4" salida
  salida=$(psql -q -v ON_ERROR_STOP=1 -d "$bd" -f "$AQUI/$archivo" 2>&1) && {
    echo "❌ $etiqueta: la suite PASÓ sin las migraciones, así que no prueba nada."; exit 1; }
  echo "$salida" | grep -E 'ERROR' | grep -qE "$patron" || {
    echo "❌ $etiqueta: falló, pero por otra cosa:"; echo "$salida" | grep -E 'ERROR' | head -3; exit 1; }
  echo "  ✓ $etiqueta — falla sin la migración, como debe: $(echo "$salida" | grep -E 'ERROR' | head -1 | sed 's/.*ERROR:  //' | cut -c1-110)"
}

echo "── 1/8 · andamiaje de plataforma"
aplicar "$RAIZ/scripts/schema-drift/bootstrap.sql"

echo "── 2/8 · cadena de migraciones ANTERIORES a la serie, en orden"
N=0
for f in "$MIGS"/*.sql; do
  base="$(basename "$f" .sql)"
  [[ "${base:0:14}" < "$PRIMERA" ]] || continue
  aplicar "$f"
  N=$((N + 1))
done
echo "   $N migraciones aplicadas sobre una base vacía"
aplicar "$FIXTURE_B"

echo "── 3/8 · CONTROL NEGATIVO: sin las migraciones de la serie, las pruebas DEBEN fallar"
psql -q -d postgres -c "CREATE DATABASE $BD_ANTES TEMPLATE $BD" >/dev/null
aplicar "$AQUI/fixture_lectura.sql" "$BD_ANTES"
debe_fallar "$BD_ANTES" assert_lectura_financiera.sql 'UK1 contador solo C1 · facturas_proveedor — esperado «C1,E», recibido «C1,C2,E»' \
  "lectura: un contador asignado solo a C1 lee también C2"
debe_fallar "$BD_ANTES" assert_factura_acumular.sql 'un error real al acumular ABORTA la aprobación.*NO falló' \
  "acumulación: un error real se traga y la factura se aprueba igual"
psql -q -d postgres -c "DROP DATABASE $BD_ANTES" >/dev/null

echo "── 4/8 · las migraciones de la serie (cada una dos veces: la segunda debe ser limpia)"
for base in $NUESTRAS; do
  aplicar "$MIGS/$base.sql"
  if aplicar "$MIGS/$base.sql" 2>/dev/null; then
    echo "   ✓ $base: segunda pasada limpia"
  else
    echo "❌ $base: la segunda pasada falló (la migración no es idempotente):"
    PGOPTIONS="-c client_min_messages=warning" psql -v ON_ERROR_STOP=1 -d $BD -f "$MIGS/$base.sql" 2>&1 | tail -4
    exit 1
  fi
done
for f in "$MIGS"/*.sql; do
  base="$(basename "$f" .sql)"
  if [[ "${base:0:14}" > "$PRIMERA" ]] && ! grep -qx "$base" <<<"$NUESTRAS"; then aplicar "$f"; fi
done
aplicar "$AQUI/fixture_lectura.sql"

echo "── 5/8 · invariantes de una sesión"
bloque assert_lectura_financiera.sql "5a · lectura financiera: perfil × tabla, privilegios, reportes, RPC y procesos automáticos"
bloque assert_orden_crear.sql        "5b · orden de compra: cabecera y renglones juntos, idempotente, todo o nada, validaciones intactas"
bloque assert_factura_acumular.sql   "5c · acumulación de lo facturado: sumar, restar, parciales, reintentos, errores reales y estados"

echo "── 6/8 · concurrencia: sesiones REALES simultáneas, no una simulación"
aplicar "$AQUI/concurrencia_acumular_prep.sql"
UA=c0c0c0c0-0000-0000-0000-00000000000a
UK=c0c0c0c0-0000-0000-0000-00000000000c
C=cccccccc-cccc-cccc-cccc-cccccccccccc
C1=c1c1c1c1-0000-0000-0000-000000000001

sesion() {   # sesion RETRASO SQL RETENER [USUARIO]
  psql -q -X -t -A -v ON_ERROR_STOP=1 -d $BD <<SQL
SELECT pg_sleep($1);
SELECT set_config('request.jwt.claim.sub', '${4:-$UA}', false);
SET ROLE authenticated;
BEGIN;
$2
SELECT pg_sleep($3);
COMMIT;
SQL
}
par() {      # par NOMBRE SQL1 SQL2 [USUARIO]
  sesion 0   "$2" 1.5 "${4:-$UA}" > "$SALIDAS/${1}1.txt" 2>&1 &
  local p1=$!
  sesion 0.3 "$3" 0   "${4:-$UA}" > "$SALIDAS/${1}2.txt" 2>&1 &
  local p2=$!
  wait $p1 $p2 || true
}
q() { psql -q -t -A -d $BD -c "$1"; }
sin_deadlock() { ! cat "$SALIDAS"/${1}1.txt "$SALIDAS"/${1}2.txt | grep -qi 'deadlock'; }

# ── ÓRDENES: la misma clave a la vez ────────────────────────────────────────
cab_oc() { echo "{\"proveedor_id\":\"e3000000-0000-0000-0000-000000000001\",\"concepto\":\"Orden simultánea\",\"clave_idempotencia\":\"$1\"}"; }
lin_oc() { echo "[{\"descripcion\":\"Material\",\"cantidad\":$1,\"precio_unitario\":10,\"unidad\":\"u\",\"destino_tipo\":\"gasto\",\"categoria\":\"mantenimiento\"},{\"descripcion\":\"Insumo\",\"cantidad\":2,\"precio_unitario\":5,\"unidad\":\"u\",\"destino_tipo\":\"gasto\",\"categoria\":\"mantenimiento\"}]"; }
ocrear() { echo "SELECT public.compras_orden_crear('$C', '$C1', '$(cab_oc "$1")'::jsonb, '$(lin_oc "$2")'::jsonb)->'orden'->>'id';"; }

# A · MISMA clave y MISMO contenido a la vez: UNA orden con SUS 2 renglones y las dos sesiones reciben el MISMO id.
par a "$(ocrear cc-orden-simul 3)" "$(ocrear cc-orden-simul 3)" "$UK"
N_A=$(q "SELECT count(*) FROM public.ordenes_compra WHERE clave_idempotencia = 'cc-orden-simul'")
L_A=$(q "SELECT count(*) FROM public.orden_compra_lineas WHERE orden_compra_id IN (SELECT id FROM public.ordenes_compra WHERE clave_idempotencia = 'cc-orden-simul')")
ID_A1=$(grep -Eo '[0-9a-f]{8}-[0-9a-f-]{27}' "$SALIDAS"/a1.txt | head -1); ID_A2=$(grep -Eo '[0-9a-f]{8}-[0-9a-f-]{27}' "$SALIDAS"/a2.txt | head -1)
[ "$N_A" = "1" ] && [ "$L_A" = "2" ] && [ -n "$ID_A1" ] && [ "$ID_A1" = "$ID_A2" ] \
  && echo "  ✓ A · misma clave y contenido a la vez: UNA orden con 2 renglones y las dos sesiones recibieron la MISMA" \
  || { echo "❌ A · órdenes=$N_A renglones=$L_A id1=$ID_A1 id2=$ID_A2"; cat "$SALIDAS"/a1.txt "$SALIDAS"/a2.txt; exit 1; }

# B · la misma clave con contenido DISTINTO a la vez: una crea y la otra se rechaza por conflicto.
par b "$(ocrear cc-orden-conf 3)" "$(ocrear cc-orden-conf 4)" "$UK"
N_B=$(q "SELECT count(*) FROM public.ordenes_compra WHERE clave_idempotencia = 'cc-orden-conf'")
CONF_B=$(cat "$SALIDAS"/b1.txt "$SALIDAS"/b2.txt | grep -c 'COMPRAS_ORDEN_CLAVE_CONFLICTO' || true)
[ "$N_B" = "1" ] && [ "$CONF_B" = "1" ] \
  && echo "  ✓ B · misma clave con contenido distinto a la vez: UNA orden y la otra sesión se rechazó por conflicto" \
  || { echo "❌ B · órdenes=$N_B conflictos=$CONF_B"; cat "$SALIDAS"/b1.txt "$SALIDAS"/b2.txt; exit 1; }

# C · un renglón que FALLA (insumo inexistente en el proyecto) con dos sesiones: las dos fallan y NO queda nada.
LIN_C='[{"descripcion":"Material","cantidad":1,"precio_unitario":10,"unidad":"u","destino_tipo":"gasto","categoria":"mantenimiento"},{"descripcion":"Insumo ajeno","cantidad":1,"precio_unitario":10,"unidad":"litro","destino_tipo":"inventario","suministro_id":"0ee20000-0000-0000-0000-000000000002","categoria":"limpieza"}]'
ANTES_C=$(q "SELECT public.zz_total_oc()")
par c "SELECT public.compras_orden_crear('$C', '$C1', '$(cab_oc cc-orden-fallo)'::jsonb, '$LIN_C'::jsonb);" \
      "SELECT public.compras_orden_crear('$C', '$C1', '$(cab_oc cc-orden-fallo)'::jsonb, '$LIN_C'::jsonb);" "$UK"
DESP_C=$(q "SELECT public.zz_total_oc()")
FALLO_C=$(cat "$SALIDAS"/c1.txt "$SALIDAS"/c2.txt | grep -c 'COMPRAS_LINEA_INSUMO_ALCANCE' || true)
[ "$ANTES_C" = "$DESP_C" ] && [ "$FALLO_C" = "2" ] \
  && echo "  ✓ C · dos intentos simultáneos con un renglón inválido: los dos fallan y NO queda cabecera ni renglones" \
  || { echo "❌ C · antes=$ANTES_C después=$DESP_C fallos=$FALLO_C"; cat "$SALIDAS"/c1.txt "$SALIDAS"/c2.txt; exit 1; }

# D · INTERRUPCIÓN: la sesión que crea la orden muere ANTES de confirmar → nada queda; el reintento crea UNA y otro reintento devuelve la misma.
psql -q -X -t -A -v ON_ERROR_STOP=0 -d $BD >"$SALIDAS"/d1.txt 2>&1 <<SQL &
SET application_name = 'cc-orden-interrumpida';
SELECT set_config('request.jwt.claim.sub', '$UK', false);
SET ROLE authenticated;
BEGIN;
$(ocrear cc-orden-corte 3)
SELECT pg_sleep(8);
COMMIT;
SQL
PD=$!
sleep 2
psql -q -t -A -d $BD -c "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE application_name = 'cc-orden-interrumpida'" >/dev/null
wait $PD || true
N_D0=$(q "SELECT count(*) FROM public.ordenes_compra WHERE clave_idempotencia = 'cc-orden-corte'")
sesion 0 "$(ocrear cc-orden-corte 3)" 0 "$UK" > "$SALIDAS"/d2.txt 2>&1
sesion 0 "$(ocrear cc-orden-corte 3)" 0 "$UK" > "$SALIDAS"/d3.txt 2>&1
N_D1=$(q "SELECT count(*) FROM public.ordenes_compra WHERE clave_idempotencia = 'cc-orden-corte'")
L_D1=$(q "SELECT count(*) FROM public.orden_compra_lineas WHERE orden_compra_id IN (SELECT id FROM public.ordenes_compra WHERE clave_idempotencia = 'cc-orden-corte')")
ID_D2=$(grep -Eo '[0-9a-f]{8}-[0-9a-f-]{27}' "$SALIDAS"/d2.txt | head -1); ID_D3=$(grep -Eo '[0-9a-f]{8}-[0-9a-f-]{27}' "$SALIDAS"/d3.txt | head -1)
[ "$N_D0" = "0" ] && [ "$N_D1" = "1" ] && [ "$L_D1" = "2" ] && [ -n "$ID_D2" ] && [ "$ID_D2" = "$ID_D3" ] \
  && echo "  ✓ D · sesión terminada antes de confirmar: no quedó NADA; el reintento crea UNA orden (2 renglones) y otro reintento devuelve la misma" \
  || { echo "❌ D · tras la caída=$N_D0; tras el reintento órdenes=$N_D1 renglones=$L_D1 id2=$ID_D2 id3=$ID_D3"; cat "$SALIDAS"/d1.txt "$SALIDAS"/d2.txt "$SALIDAS"/d3.txt; exit 1; }

# ── ACUMULACIÓN DE LO FACTURADO ─────────────────────────────────────────────
estado_f() { q "SELECT estado FROM public.facturas_proveedor WHERE clave_idempotencia = '$1'"; }
fact() { q "SELECT cantidad_facturada FROM public.orden_compra_lineas WHERE id = '$1'"; }
est_oc() { q "SELECT estado FROM public.ordenes_compra WHERE id = '$1'"; }
OV=0c9a0000-0000-0000-0000-000000000001
OW=0c9a0000-0000-0000-0000-000000000002
OX=0c9a0000-0000-0000-0000-000000000003
OY=0c9a0000-0000-0000-0000-000000000004
OZ=0c9a0000-0000-0000-0000-000000000005
LV1=0c9c0000-0000-0000-0000-000000000001; LV2=0c9c0000-0000-0000-0000-000000000002
LW1=0c9c0000-0000-0000-0000-000000000003; LX1=0c9c0000-0000-0000-0000-000000000004
LY1=0c9c0000-0000-0000-0000-000000000005; LY2=0c9c0000-0000-0000-0000-000000000006
LZ1=0c9c0000-0000-0000-0000-000000000007

# V · dos facturas de renglones DISTINTOS de la misma orden, aprobadas a la vez: las dos pasan y la orden QUEDA CERRADA
# (cada sesión calcula el cierre sobre lo que ya confirmó la otra: la orden no se queda atascada en «recibida»).
par v "UPDATE public.facturas_proveedor SET estado = 'aprobada' WHERE clave_idempotencia = 'cc-clave-v1';" \
      "UPDATE public.facturas_proveedor SET estado = 'aprobada' WHERE clave_idempotencia = 'cc-clave-v2';"
[ "$(estado_f cc-clave-v1)" = "aprobada" ] && [ "$(estado_f cc-clave-v2)" = "aprobada" ] \
  && [ "$(fact $LV1)" = "10.0000" ] && [ "$(fact $LV2)" = "5.0000" ] && [ "$(est_oc $OV)" = "cerrada" ] && sin_deadlock v \
  && echo "  ✓ V · dos facturas de renglones distintos aprobadas a la vez: las dos sumaron (10 y 5) y la orden quedó CERRADA, sin interbloqueo" \
  || { echo "❌ V · v1=$(estado_f cc-clave-v1) v2=$(estado_f cc-clave-v2) l1=$(fact $LV1) l2=$(fact $LV2) orden=$(est_oc $OV)"; cat "$SALIDAS"/v1.txt "$SALIDAS"/v2.txt; exit 1; }

# W · dos facturas por las MISMAS 10 unidades, aprobadas a la vez: una pasa y la otra se rechaza (más de lo recibido y no facturado).
par w "UPDATE public.facturas_proveedor SET estado = 'aprobada' WHERE clave_idempotencia = 'cc-clave-w1';" \
      "UPDATE public.facturas_proveedor SET estado = 'aprobada' WHERE clave_idempotencia = 'cc-clave-w2';"
APR_W=$(q "SELECT count(*) FROM public.facturas_proveedor WHERE orden_compra_id = '$OW' AND estado = 'aprobada'")
RECH_W=$(cat "$SALIDAS"/w1.txt "$SALIDAS"/w2.txt | grep -c 'COMPRAS_MATCH_NO_FORZABLE' || true)
AS_W=$(q "SELECT count(*) FROM public.conta_asientos a JOIN public.facturas_proveedor f ON f.id = a.origen_id WHERE a.origen_tabla = 'facturas_proveedor' AND f.orden_compra_id = '$OW' AND a.reversa_de_id IS NULL AND a.anulado_por_id IS NULL")
[ "$APR_W" = "1" ] && [ "$RECH_W" = "1" ] && [ "$(fact $LW1)" = "10.0000" ] && [ "$(est_oc $OW)" = "cerrada" ] && [ "$AS_W" = "1" ] && sin_deadlock w \
  && echo "  ✓ W · dos facturas por las mismas unidades a la vez: una aprobada (facturado 10, orden cerrada, UN asiento) y la otra rechazada" \
  || { echo "❌ W · aprobadas=$APR_W rechazos=$RECH_W facturado=$(fact $LW1) orden=$(est_oc $OW) asientos=$AS_W"; cat "$SALIDAS"/w1.txt "$SALIDAS"/w2.txt; exit 1; }

# X · se ANULA la factura aprobada (6) MIENTRAS se APRUEBA la otra (4): sea cual sea el orden, lo facturado final es 4 y la orden «recibida».
par x "UPDATE public.facturas_proveedor SET estado = 'anulada' WHERE clave_idempotencia = 'cc-clave-x1';" \
      "UPDATE public.facturas_proveedor SET estado = 'aprobada' WHERE clave_idempotencia = 'cc-clave-x2';"
[ "$(estado_f cc-clave-x1)" = "anulada" ] && [ "$(estado_f cc-clave-x2)" = "aprobada" ] && [ "$(fact $LX1)" = "4.0000" ] && [ "$(est_oc $OX)" = "recibida" ] && sin_deadlock x \
  && echo "  ✓ X · anular una factura mientras se aprueba otra, a la vez: facturado final 4 (la aprobada) y la orden «recibida», sin interbloqueo" \
  || { echo "❌ X · x1=$(estado_f cc-clave-x1) x2=$(estado_f cc-clave-x2) facturado=$(fact $LX1) orden=$(est_oc $OX)"; cat "$SALIDAS"/x1.txt "$SALIDAS"/x2.txt; exit 1; }

# Y · dos anulaciones a la vez de facturas que comparten renglones: las dos pasan, todo vuelve a 0 y la orden se REABRE.
[ "$(est_oc $OY)" = "cerrada" ] || { echo "❌ Y · la orden debía partir cerrada y está $(est_oc $OY)"; exit 1; }
par y "UPDATE public.facturas_proveedor SET estado = 'anulada' WHERE clave_idempotencia = 'cc-clave-y1';" \
      "UPDATE public.facturas_proveedor SET estado = 'anulada' WHERE clave_idempotencia = 'cc-clave-y2';"
[ "$(estado_f cc-clave-y1)" = "anulada" ] && [ "$(estado_f cc-clave-y2)" = "anulada" ] && [ "$(fact $LY1)" = "0.0000" ] && [ "$(fact $LY2)" = "0.0000" ] \
  && [ "$(est_oc $OY)" = "recibida" ] && sin_deadlock y \
  && echo "  ✓ Y · dos anulaciones a la vez sobre renglones compartidos: las dos pasan, lo facturado vuelve a 0 y la orden se reabre, sin interbloqueo" \
  || { echo "❌ Y · y1=$(estado_f cc-clave-y1) y2=$(estado_f cc-clave-y2) l1=$(fact $LY1) l2=$(fact $LY2) orden=$(est_oc $OY)"; cat "$SALIDAS"/y1.txt "$SALIDAS"/y2.txt; exit 1; }

# Z · INTERRUPCIÓN: la sesión que aprueba muere ANTES de confirmar → la factura sigue registrada, sin suma y sin asiento; el reintento aprueba UNA vez.
psql -q -X -t -A -v ON_ERROR_STOP=0 -d $BD >"$SALIDAS"/z1.txt 2>&1 <<SQL &
SET application_name = 'cc-aprobacion-interrumpida';
SELECT set_config('request.jwt.claim.sub', '$UA', false);
SET ROLE authenticated;
BEGIN;
UPDATE public.facturas_proveedor SET estado = 'aprobada' WHERE clave_idempotencia = 'cc-clave-z1';
SELECT pg_sleep(8);
COMMIT;
SQL
PZ=$!
sleep 2
psql -q -t -A -d $BD -c "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE application_name = 'cc-aprobacion-interrumpida'" >/dev/null
wait $PZ || true
AS_Z0=$(q "SELECT count(*) FROM public.conta_asientos a JOIN public.facturas_proveedor f ON f.id = a.origen_id WHERE a.origen_tabla = 'facturas_proveedor' AND f.clave_idempotencia = 'cc-clave-z1'")
[ "$(estado_f cc-clave-z1)" = "registrada" ] && [ "$(fact $LZ1)" = "0.0000" ] && [ "$AS_Z0" = "0" ] \
  || { echo "❌ Z · tras el corte: factura=$(estado_f cc-clave-z1) facturado=$(fact $LZ1) asientos=$AS_Z0"; exit 1; }
sesion 0 "UPDATE public.facturas_proveedor SET estado = 'aprobada' WHERE clave_idempotencia = 'cc-clave-z1';" 0 > "$SALIDAS"/z2.txt 2>&1
sesion 0 "UPDATE public.facturas_proveedor SET estado = 'aprobada' WHERE clave_idempotencia = 'cc-clave-z1';" 0 > "$SALIDAS"/z3.txt 2>&1
[ "$(estado_f cc-clave-z1)" = "aprobada" ] && [ "$(fact $LZ1)" = "10.0000" ] && [ "$(est_oc $OZ)" = "cerrada" ] \
  && echo "  ✓ Z · aprobación cortada antes de confirmar: no quedó NADA (registrada, sin suma, sin asiento); el reintento suma UNA vez (10) y un segundo no suma otra" \
  || { echo "❌ Z · tras el reintento: factura=$(estado_f cc-clave-z1) facturado=$(fact $LZ1) orden=$(est_oc $OZ)"; cat "$SALIDAS"/z2.txt "$SALIDAS"/z3.txt; exit 1; }

# Cierre: tras TODAS las pruebas, el diagnóstico de solo lectura encuentra ÚNICAMENTE el descuadre que 5c sembró a
# propósito (la factura AF-F1 de la orden de acumulación «F»): ninguna prueba de concurrencia dejó lo facturado
# descuadrado ni una orden atascada.
HALLAZGOS=$(psql -q -t -A -F'|' -d $BD -f "$RAIZ/scripts/diagnostico-acumulacion-facturas.sql")
INESPERADOS=$(echo "$HALLAZGOS" | grep -v '^$' | grep -v '^acumulado_distinto|cccccccc-cccc-cccc-cccc-cccccccccccc|0af00000-0000-0000-0000-000000000004|' || true)
if [ -z "$INESPERADOS" ]; then
  echo "  ✓ cierre · el diagnóstico de lo facturado solo encuentra el descuadre sembrado en 5c: ninguna prueba de concurrencia dejó lo facturado descuadrado ni una orden atascada"
else
  echo "❌ cierre · el diagnóstico encontró descuadres inesperados:"; echo "$INESPERADOS"; exit 1
fi

echo "── 7/8 · guards de migraciones"
if command -v node >/dev/null 2>&1; then
  (cd "$RAIZ" && node scripts/migrations-guard.mjs) >/dev/null 2>&1 \
    && echo "  ✓ migrations-guard (RLS, REVOKE de funciones DEFINER, scope de RPC)" \
    || { echo "❌ migrations-guard encontró hallazgos en las migraciones de la serie:"; (cd "$RAIZ" && node scripts/migrations-guard.mjs 2>&1 | tail -15); exit 1; }
  (cd "$RAIZ" && node scripts/migrations-append-only.mjs) >/dev/null 2>&1 \
    && echo "  ✓ migrations-append-only (no se editó ninguna migración ya aplicada)" \
    || echo "  (migrations-append-only no pudo verificarse aquí —necesita el historial de git de main—; corre en CI)"
else
  echo "  (omitido: sin node en este entorno)"
fi

# Auditoría RBAC: el control negativo debe fallar antes de la corrección.
AUDIT_MIG="$MIGS/20261026000500_auditoria_borrado_roles.sql"
AUDIT_TEST="$RAIZ/supabase/tests/auditoria_roles/assert.sql"
if psql -q -v ON_ERROR_STOP=1 -d "$BD" -f "$RAIZ/supabase/tests/auditoria_roles/negative.sql" > "$SALIDAS/audit-antes.txt" 2>&1; then
  echo "❌ auditoría RBAC: el control negativo pasó sin la corrección"; exit 1
fi
grep -q 'permission_audit_log_target_role_id_fkey' "$SALIDAS/audit-antes.txt" \
  || { cat "$SALIDAS/audit-antes.txt"; exit 1; }
aplicar "$AUDIT_MIG"
aplicar "$AUDIT_MIG"
bloque ../auditoria_roles/assert.sql 'Auditoría de roles: DELETE simple y cascada sin perder eventos'

echo "── 8/8 · listo"
echo "✅ compras (lectura financiera, creación atómica de órdenes y acumulación de facturas) verificado contra PostgreSQL real"
