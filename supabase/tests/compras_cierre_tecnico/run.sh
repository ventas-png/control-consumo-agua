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
# Auditoría de roles (no es de la serie): se aplica SOLO en el paso 7b, después de su control negativo. El bucle del paso 4
# que instala «las migraciones posteriores a la serie» la excluye a propósito: si la instalara antes, el control negativo
# correría contra la corrección ya aplicada y «pasaría» sin probar nada (fallo real de la corrida 37369174666 de CI).
AUDIT_BASE=20261026000500_auditoria_borrado_roles

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
  if [[ "${base:0:14}" > "$PRIMERA" ]] && ! grep -qx "$base" <<<"$NUESTRAS" && [[ "$base" != "$AUDIT_BASE" ]]; then aplicar "$f"; fi
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

# ── 7b · Auditoría de roles (20261026000500_auditoria_borrado_roles) ────────────────────────────────────────────────────
# Qué se prueba y por qué así:
#   · CONTROL NEGATIVO contra una COPIA de la base que NO tiene la corrección. Que no la tiene se demuestra por catálogo
#     (no se supone: la corrida 37369174666 falló porque el paso 4 la había instalado antes). Solo vale si falla EXACTAMENTE
#     como falló en producción: SQLSTATE 23503 por permission_audit_log_target_role_id_fkey, al insertar desde
#     audit_roles_changes() el evento de un rol que ya no existe. Cualquier otro error no es prueba.
#   · la migración dos veces: la segunda no cambia NADA (huella de funciones + auditoría), y ni RLS, ni políticas, ni
#     privilegios, ni ACL de las funciones, ni triggers, ni constraints cambian respecto de antes de aplicarla.
#   · la regresión (assert.sql) sin dejar residuos, y MUTACIONES: con la migración aplicada, deshacer UNA corrección a la vez
#     (la función original completa, o solo la FK del rol, o solo la FK del usuario) debe romper la regresión por la causa
#     esperada; así consta que cada corrección hace falta. Si un patrón de sed dejara de coincidir, el arnés aborta (no pasa en falso).
echo "── 7b/8 · auditoría de roles: control negativo, migración dos veces, regresión y mutaciones"
AUDIT_MIG="$MIGS/$AUDIT_BASE.sql"
AUDIT_DIR="$RAIZ/supabase/tests/auditoria_roles"
BD_AUDIT=compras_cct_audit
FUNCS_AUDIT="'audit_roles_changes','audit_role_permissions_changes','audit_user_roles_changes'"
ORIGINALES="$MIGS/20260518000008_rbac_helpers_and_sync.sql"

# Las tres funciones corregidas guardan la identidad del rol en details.role_id; las originales nunca mencionan esa clave.
con_correccion() {
  psql -q -t -A -d "$1" -c "SELECT count(*) FROM pg_proc WHERE pronamespace = 'public'::regnamespace AND proname IN ($FUNCS_AUDIT) AND prosrc LIKE '%''role_id''%'"
}
# Superficie de seguridad que la migración NO debe tocar: RLS, políticas, privilegios de tabla y triggers de roles, role_permissions,
# user_roles y permission_audit_log; constraints de permission_audit_log; ACL, SECURITY DEFINER y search_path de las tres funciones.
superficie() {
  psql -q -t -A -v ON_ERROR_STOP=1 -d "$1" <<SQL
SELECT md5(string_agg(x, E'\n' ORDER BY x)) FROM (
  SELECT 'rls|' || c.relname || '|' || c.relrowsecurity || '|' || c.relforcerowsecurity AS x
    FROM pg_class c WHERE c.oid IN ('public.roles'::regclass, 'public.role_permissions'::regclass, 'public.user_roles'::regclass, 'public.permission_audit_log'::regclass)
  UNION ALL SELECT 'pol|' || tablename || '|' || policyname || '|' || cmd || '|' || roles::text || '|' || coalesce(qual, '') || '|' || coalesce(with_check, '')
    FROM pg_policies WHERE schemaname = 'public' AND tablename IN ('roles', 'role_permissions', 'user_roles', 'permission_audit_log')
  UNION ALL SELECT 'grant|' || table_name || '|' || grantee || '|' || privilege_type
    FROM information_schema.role_table_grants WHERE table_schema = 'public' AND table_name IN ('roles', 'role_permissions', 'user_roles', 'permission_audit_log')
  UNION ALL SELECT 'fn|' || proname || '|' || coalesce(proacl::text, 'NULL') || '|' || prosecdef || '|' || coalesce(array_to_string(proconfig, ','), '')
    FROM pg_proc WHERE pronamespace = 'public'::regnamespace AND proname IN ($FUNCS_AUDIT)
  UNION ALL SELECT 'trg|' || tgenabled::text || '|' || pg_get_triggerdef(oid)
    FROM pg_trigger WHERE NOT tgisinternal AND tgrelid IN ('public.roles'::regclass, 'public.role_permissions'::regclass, 'public.user_roles'::regclass, 'public.permission_audit_log'::regclass)
  UNION ALL SELECT 'con|' || conname || '|' || pg_get_constraintdef(oid)
    FROM pg_constraint WHERE conrelid = 'public.permission_audit_log'::regclass
) s;
SQL
}
# Huella de lo que la migración puede escribir: definición de las tres funciones + TODAS las filas de la auditoría.
huella_audit() {
  psql -q -t -A -v ON_ERROR_STOP=1 -d "$1" <<SQL
SELECT md5(coalesce((SELECT string_agg(pg_get_functiondef(p.oid), E'\n' ORDER BY p.proname) FROM pg_proc p
                      WHERE p.pronamespace = 'public'::regnamespace AND p.proname IN ($FUNCS_AUDIT)), '')
        || coalesce((SELECT string_agg(l::text, E'\n' ORDER BY l.id) FROM public.permission_audit_log l), ''))
       || '|' || (SELECT count(*) FROM public.permission_audit_log);
SQL
}
estado_roles() {
  psql -q -t -A -v ON_ERROR_STOP=1 -d "$BD" -c "SELECT (SELECT count(*) FROM public.roles) || '/' || (SELECT count(*) FROM public.role_permissions) || '/' || (SELECT count(*) FROM public.user_roles) || '/' || (SELECT count(*) FROM public.permission_audit_log) || '/' || (SELECT count(*) FROM public.roles WHERE name LIKE 'Audit %')"
}
sin_role_id() {
  psql -q -t -A -d "$BD" -c "SELECT count(*) FROM public.permission_audit_log WHERE target_role_id IS NOT NULL AND NOT (COALESCE(details, '{}'::jsonb) ? 'role_id')"
}
# Corre un script contra $1 (con mensajes en inglés y SQLSTATE) y exige que FALLE, y que el error contenga TODOS los textos pedidos.
debe_fallar_por() {
  local bd="$1" archivo="$2" etiqueta="$3" salida e; shift 3
  if salida=$(PGOPTIONS="-c lc_messages=C" psql -q -X -v ON_ERROR_STOP=1 -v VERBOSITY=verbose -d "$bd" -f "$archivo" 2>&1); then
    echo "❌ auditoría RBAC · $etiqueta: PASÓ y debía fallar (no prueba nada)"; exit 1
  fi
  for e in "$@"; do
    grep -qF -- "$e" <<<"$salida" || { echo "❌ auditoría RBAC · $etiqueta: falló, pero NO por la causa esperada («$e» ausente):"; echo "$salida" | head -8; exit 1; }
  done
}

# 1 · la corrección NO está aplicada (por catálogo), y el backfill tiene qué hacer.
[ "$(con_correccion "$BD")" = "0" ] \
  || { echo "❌ auditoría RBAC: la corrección ya estaba aplicada antes del control negativo (¿algún paso anterior instaló $AUDIT_BASE?)"; exit 1; }
PEND=$(sin_role_id)
[ "$PEND" -gt 0 ] || { echo "❌ auditoría RBAC: no hay eventos previos sin role_id; el backfill no se ejercita"; exit 1; }
SUP0=$(superficie "$BD"); HUE0=$(huella_audit "$BD")
[[ "$SUP0" =~ ^[0-9a-f]{32}$ ]] && [[ "$HUE0" =~ ^[0-9a-f]{32}\|[0-9]+$ ]] \
  || { echo "❌ auditoría RBAC: las huellas previas no son válidas (superficie='$SUP0', auditoría='$HUE0'); una comparación vacía no prueba nada"; exit 1; }

# 2 · control negativo en una copia sin la corrección.
psql -q -d postgres -c "CREATE DATABASE $BD_AUDIT TEMPLATE $BD" >/dev/null
[ "$(con_correccion "$BD_AUDIT")" = "0" ] || { echo "❌ auditoría RBAC: la copia del control negativo ya trae la corrección"; exit 1; }
debe_fallar_por "$BD_AUDIT" "$AUDIT_DIR/negative.sql" "control negativo" \
  'ERROR:  23503:' 'violates foreign key constraint "permission_audit_log_target_role_id_fkey"' \
  'is not present in table "roles"' 'PL/pgSQL function audit_roles_changes()'
echo "  ✓ control negativo: sin la corrección, borrar un rol falla por 23503 en permission_audit_log_target_role_id_fkey, desde audit_roles_changes() (como en producción)"
psql -q -d postgres -c "DROP DATABASE $BD_AUDIT" >/dev/null

# 3 · la migración, dos veces: la segunda no cambia nada, y no toca RLS, políticas, privilegios, ACL ni triggers.
aplicar "$AUDIT_MIG"
[ "$(con_correccion "$BD")" = "3" ] || { echo "❌ auditoría RBAC: tras la migración las tres funciones deben llevar la corrección"; exit 1; }
[ "$(sin_role_id)" = "0" ] || { echo "❌ auditoría RBAC: el backfill dejó $(sin_role_id) eventos con rol vivo sin role_id"; exit 1; }
HUE1=$(huella_audit "$BD")
aplicar "$AUDIT_MIG"
HUE2=$(huella_audit "$BD")
[[ "$HUE1" =~ ^[0-9a-f]{32}\|[0-9]+$ ]] && [[ "$HUE2" =~ ^[0-9a-f]{32}\|[0-9]+$ ]] \
  || { echo "❌ auditoría RBAC: huellas posteriores no válidas ('$HUE1' / '$HUE2')"; exit 1; }
[ "$HUE0" != "$HUE1" ] || { echo "❌ auditoría RBAC: la migración no cambió nada (¿ya estaba aplicada?)"; exit 1; }
[ "$HUE1" = "$HUE2" ] || { echo "❌ auditoría RBAC: la segunda aplicación cambió funciones o filas de auditoría (no es idempotente)"; exit 1; }
SUP1=$(superficie "$BD")
[[ "$SUP1" =~ ^[0-9a-f]{32}$ ]] && [ "$SUP1" = "$SUP0" ] \
  || { echo "❌ auditoría RBAC: la migración cambió RLS, políticas, privilegios o triggers de las 4 tablas, constraints de la auditoría, o ACL/definer/search_path de las 3 funciones"; exit 1; }
echo "  ✓ migración aplicada dos veces: la segunda no cambia nada ($PEND eventos previos recibieron role_id); sin cambios en RLS, políticas, privilegios y triggers de las 4 tablas, constraints de la auditoría ni ACL/definer/search_path de las 3 funciones"

# 4 · la regresión completa, sin residuos.
ANTES_R=$(estado_roles)
[[ "$ANTES_R" =~ ^[0-9]+(/[0-9]+){4}$ ]] || { echo "❌ auditoría RBAC: el estado previo de roles no es válido ('$ANTES_R')"; exit 1; }
SAL_AUDIT=$(psql -q -X -v ON_ERROR_STOP=1 -d "$BD" -f "$AUDIT_DIR/assert.sql" 2>&1) || {
  echo "❌ auditoría RBAC: la regresión (assert.sql) falló:"; echo "$SAL_AUDIT" | grep -E 'ERROR|DETAIL|CONTEXT' | head -6; exit 1; }
grep -q 'AUDIT_ROLES_OK_REVERTIDO' <<<"$SAL_AUDIT" || { echo "❌ auditoría RBAC: assert.sql no llegó a su veredicto"; echo "$SAL_AUDIT" | tail -5; exit 1; }
[ "$(estado_roles)" = "$ANTES_R" ] || { echo "❌ auditoría RBAC: assert.sql dejó residuos (roles/permisos/asignaciones/auditoría: antes $ANTES_R, después $(estado_roles))"; exit 1; }
echo "  ✓ regresión: borrado simple y en cascada, eventos, actor e identidades históricas, FK viva o NULL, ACL de las funciones y aislamiento entre empresas; todo revertido, sin residuos"

# 5 · mutaciones: con la migración aplicada, cada una de las tres funciones debe HACER FALTA. Por función, dos regresiones:
#     (a) la definición ORIGINAL completa (20260518000008) y (b) «solo FK»: la corregida, pero apuntando otra vez con la FK
#     viva a un rol que en una eliminación ya no existe. Ambas deben romper la regresión, y por la causa esperada.
extraer() {   # extraer ARCHIVO FUNCIÓN → la definición CREATE OR REPLACE FUNCTION completa
  awk -v f="$2" '$0 ~ ("^CREATE OR REPLACE FUNCTION public\\." f "\\(\\)") { on = 1 } on { print } on && $0 == "$$;" { exit }' "$1"
}
mutar() {     # mutar ETIQUETA ARCHIVO_SQL PATRÓN…  (aplica el archivo en una copia y exige que assert.sql falle por los patrones)
  local etiqueta="$1" archivo="$2"; shift 2
  psql -q -d postgres -c "CREATE DATABASE $BD_AUDIT TEMPLATE $BD" >/dev/null
  aplicar "$archivo" "$BD_AUDIT"
  debe_fallar_por "$BD_AUDIT" "$AUDIT_DIR/assert.sql" "mutación ($etiqueta)" "$@"
  echo "  ✓ mutación ($etiqueta): la regresión falla por la causa esperada"
  psql -q -d postgres -c "DROP DATABASE $BD_AUDIT" >/dev/null
}
FK_ROL='violates foreign key constraint "permission_audit_log_target_role_id_fkey"'
for f in audit_roles_changes audit_role_permissions_changes audit_user_roles_changes; do
  extraer "$ORIGINALES" "$f" > "$SALIDAS/original-$f.sql"
  extraer "$AUDIT_MIG" "$f" > "$SALIDAS/fijo-$f.sql"
  cp "$SALIDAS/fijo-$f.sql" "$SALIDAS/solofk-$f.sql"
  [ -s "$SALIDAS/original-$f.sql" ] && [ -s "$SALIDAS/fijo-$f.sql" ] && ! grep -qF "'role_id'" "$SALIDAS/original-$f.sql" \
    || { echo "❌ auditoría RBAC: no se pudo extraer la definición original/corregida de $f"; exit 1; }
done
sed -i "s/VALUES (auth.uid(), NULL, 'delete_role'/VALUES (auth.uid(), OLD.id, 'delete_role'/" "$SALIDAS/solofk-audit_roles_changes.sql"
sed -i "s/(SELECT r.id FROM public.roles r WHERE r.id = OLD.role_id)/OLD.role_id/" \
  "$SALIDAS/solofk-audit_role_permissions_changes.sql" "$SALIDAS/solofk-audit_user_roles_changes.sql"
# Segunda corrección de la migración: al borrar un USUARIO con asignaciones, target_user_id debe ser NULL (el usuario ya no existe).
cp "$SALIDAS/fijo-audit_user_roles_changes.sql" "$SALIDAS/solofk-usuario-audit_user_roles_changes.sql"
sed -i "s/(SELECT u.id FROM public.app_users u WHERE u.id = OLD.user_id)/OLD.user_id/" "$SALIDAS/solofk-usuario-audit_user_roles_changes.sql"
for f in audit_roles_changes audit_role_permissions_changes audit_user_roles_changes; do
  ! cmp -s "$SALIDAS/solofk-$f.sql" "$SALIDAS/fijo-$f.sql" \
    || { echo "❌ auditoría RBAC: la mutación «solo FK» de $f no cambió nada (el patrón ya no coincide con la migración)"; exit 1; }
done
! cmp -s "$SALIDAS/solofk-usuario-audit_user_roles_changes.sql" "$SALIDAS/fijo-audit_user_roles_changes.sql" \
  || { echo "❌ auditoría RBAC: la mutación «solo FK usuario» no cambió nada (el patrón ya no coincide con la migración)"; exit 1; }
mutar "audit_roles_changes ORIGINAL"            "$SALIDAS/original-audit_roles_changes.sql"            'AUDIT_CREATE_FAILED'
mutar "audit_role_permissions_changes ORIGINAL" "$SALIDAS/original-audit_role_permissions_changes.sql" 'AUDIT_GRANT_EVENT_FAILED'
mutar "audit_user_roles_changes ORIGINAL"       "$SALIDAS/original-audit_user_roles_changes.sql"       'AUDIT_ASSIGN_EVENT_FAILED'
mutar "audit_roles_changes solo FK"             "$SALIDAS/solofk-audit_roles_changes.sql"              'ERROR:  23503:' "$FK_ROL" 'PL/pgSQL function audit_roles_changes()'
mutar "audit_role_permissions_changes solo FK"  "$SALIDAS/solofk-audit_role_permissions_changes.sql"  'ERROR:  23503:' "$FK_ROL" 'PL/pgSQL function audit_role_permissions_changes()'
mutar "audit_user_roles_changes solo FK"        "$SALIDAS/solofk-audit_user_roles_changes.sql"        'ERROR:  23503:' "$FK_ROL" 'PL/pgSQL function audit_user_roles_changes()'
mutar "audit_user_roles_changes solo FK usuario" "$SALIDAS/solofk-usuario-audit_user_roles_changes.sql" 'ERROR:  23503:' \
  'violates foreign key constraint "permission_audit_log_target_user_id_fkey"' 'PL/pgSQL function audit_user_roles_changes()'

echo "── 8/8 · listo"
echo "✅ compras (lectura financiera, creación atómica de órdenes y acumulación de facturas) y auditoría de borrado de roles verificados contra PostgreSQL real"
