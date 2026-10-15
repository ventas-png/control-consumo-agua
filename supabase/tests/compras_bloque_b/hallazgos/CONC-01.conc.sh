# CONC-01 · inversión del orden de bloqueo: pagar toma factura→folio, anular una orden pagada tomaba folio→factura.
# Fragmento que se "sourcea" desde conc_harness.sh (usa sesion_u, q, BD, SALIDAS, C, C1, UA).
#
# Escena DETERMINISTA (sin suerte, sin miles de iteraciones):
#   factura F de 1 000 · pago 1 de 600 PAGADO (con su asiento) · pago 2 de 400 APROBADO.
#   X  (t=0)    retiene FOR UPDATE el asiento original del pago 1 (lo que hace Contabilidad al anular/publicar a mano)
#   A  (t=0.5)  anula el pago 1   → ANTES: toma el folio y se queda esperando el asiento retenido por X
#   P  (t=1.2)  paga el pago 2    → toma la factura F y espera el folio que tiene A
#   X  (t=3.6)  suelta → A sigue y pide la factura F, que tiene P: interbloqueo (40P01).
# Correcto (orden global contraseña → facturas → folio): A toma F ANTES que el folio, P espera a A en F,
# no hay ciclo, los DOS terminan bien y el pago 2 queda con su asiento.
_c01() {
  local n F O1 O2 A1 pX pA pP ok=1 det=""
  n=$(printf '%05d' $(( (RANDOM % 40000) + 50000 )))
  F="fa1${n}-0000-0000-0000-000000000001"; O1="fa1${n}-0000-0000-0000-0000000000a1"; O2="fa1${n}-0000-0000-0000-0000000000a2"
  psql -q -X -v ON_ERROR_STOP=1 -d "$BD" >/dev/null <<SQL || { echo "❌ CONC-01 · fallo el montaje"; return 1; }
SELECT set_config('request.jwt.claim.sub', '$UA', false);
SET ROLE authenticated;
INSERT INTO public.facturas_proveedor (id, company_id, project_id, proveedor_id, numero_factura, concepto, monto_total)
VALUES ('$F', '$C', '$C1', 'e3000000-0000-0000-0000-000000000001', 'FA1-C01-$n', 'CONC-01', 1000);
UPDATE public.facturas_proveedor SET estado = 'aprobada' WHERE id = '$F';
INSERT INTO public.ordenes_pago (id, company_id, project_id, proveedor_id, factura_id, monto)
VALUES ('$O1', '$C', '$C1', 'e3000000-0000-0000-0000-000000000001', '$F', 600),
       ('$O2', '$C', '$C1', 'e3000000-0000-0000-0000-000000000001', '$F', 400);
UPDATE public.ordenes_pago SET estado = 'aprobada' WHERE id IN ('$O1', '$O2');
UPDATE public.ordenes_pago SET estado = 'pagada', fecha_pago = CURRENT_DATE WHERE id = '$O1';
SQL
  A1=$(q "SELECT id FROM public.conta_asientos WHERE origen_tabla='ordenes_pago' AND origen_id='$O1' AND origen_evento='orden_pago_pagada' AND estado='publicado'")
  [ -n "$A1" ] || { echo "❌ CONC-01 · el montaje no dejó el asiento del pago 1"; return 1; }

  sesion_u -    0   "SELECT 1 FROM public.conta_asientos WHERE id = '$A1' FOR UPDATE;" 3.6 > "$SALIDAS/c01_X.txt" 2>&1 & pX=$!
  sesion_u "$UA" 0.5 "UPDATE public.ordenes_pago SET estado = 'anulada' WHERE id = '$O1';" 0 > "$SALIDAS/c01_A.txt" 2>&1 & pA=$!
  sesion_u "$UA" 1.2 "UPDATE public.ordenes_pago SET estado = 'pagada', fecha_pago = CURRENT_DATE WHERE id = '$O2';" 0 > "$SALIDAS/c01_P.txt" 2>&1 & pP=$!
  wait $pX $pA $pP
  local sA sP
  sA=$(cat "$SALIDAS/c01_A.txt"); sP=$(cat "$SALIDAS/c01_P.txt")

  local e1 e2 nA2 nRev fact
  e1=$(q "SELECT estado FROM public.ordenes_pago WHERE id='$O1'")
  e2=$(q "SELECT estado FROM public.ordenes_pago WHERE id='$O2'")
  nA2=$(q "SELECT count(*) FROM public.conta_asientos WHERE origen_tabla='ordenes_pago' AND origen_id='$O2' AND origen_evento='orden_pago_pagada' AND estado='publicado'")
  nRev=$(q "SELECT count(*) FROM public.conta_asientos r JOIN public.conta_asientos o ON o.anulado_por_id = r.id WHERE o.id='$A1' AND r.estado='publicado'")
  fact=$(q "SELECT estado || '/' || monto_pagado FROM public.facturas_proveedor WHERE id='$F'")

  if echo "$sA$sP" | grep -qiE 'deadlock|40P01'; then ok=0; det="$det interbloqueo detectado;"; fi
  if echo "$sA$sP" | grep -qi 'ERROR'; then ok=0; det="$det alguna sesión terminó con ERROR;"; fi
  [ "$e1" = "anulada" ] || { ok=0; det="$det la anulación del pago 1 quedó en '$e1';"; }
  [ "$e2" = "pagada" ]  || { ok=0; det="$det el pago 2 quedó en '$e2';"; }
  [ "$nA2" = "1" ]      || { ok=0; det="$det el pago 2 quedó con $nA2 asientos publicados (debía ser 1: pagado SIN asiento);"; }
  [ "$nRev" = "1" ]     || { ok=0; det="$det el pago 1 tiene $nRev reversos (debía ser 1);"; }
  [ "$fact" = "pagada_parcial/400.00" ] || { ok=0; det="$det la factura quedó '$fact' (debía ser pagada_parcial/400.00);"; }

  if [ "$ok" = 1 ]; then
    echo "  ✓ CONC-01 · anular un pago pagado y pagar otro de la MISMA factura a la vez: sin interbloqueo, los dos terminan y el pago tiene su asiento"
    return 0
  fi
  echo "❌ CONC-01 · $det"
  echo "--- sesión X (retiene el asiento):"; cat "$SALIDAS/c01_X.txt"
  echo "--- sesión A (anula el pago 1):";   echo "$sA"
  echo "--- sesión P (paga el pago 2):";    echo "$sP"
  echo "--- estado: pago1=$e1 pago2=$e2 asientos_pago2=$nA2 reversos_pago1=$nRev factura=$fact"
  return 1
}

# ── Variante de CARGA acotada (20 pares, < 30 s): 20 pagos hechos que se anulan mientras otros 20 se pagan, de la
#    MISMA factura, cada UPDATE en autocommit y las dos sesiones a la vez. Antes: interbloqueos 40P01 en las
#    anulaciones y pagos «pagada» SIN asiento (WARNING «deadlock detected»). Ahora: cero errores y cero pagos sin asiento.
_c01_carga() {
  local N=20 n F ok=1 det="" t0 i
  n=$(printf '%05d' $(( (RANDOM % 40000) + 50000 )))
  F="fa1${n}-0000-0000-0000-0000000000f1"
  psql -q -X -v ON_ERROR_STOP=1 -d "$BD" >/dev/null <<SQL || { echo "❌ CONC-01 (carga) · fallo el montaje"; return 1; }
SELECT set_config('request.jwt.claim.sub', '$UA', false);
SET ROLE authenticated;
INSERT INTO public.facturas_proveedor (id, company_id, project_id, proveedor_id, numero_factura, concepto, monto_total)
VALUES ('$F', '$C', '$C1', 'e3000000-0000-0000-0000-000000000001', 'FA1-C01C-$n', 'CONC-01 carga', 100000);
UPDATE public.facturas_proveedor SET estado = 'aprobada' WHERE id = '$F';
INSERT INTO public.ordenes_pago (id, company_id, project_id, proveedor_id, factura_id, monto)
SELECT ('fa1${n}-0000-0000-000' || s || '-' || lpad(i::text, 12, '0'))::uuid, '$C', '$C1', 'e3000000-0000-0000-0000-000000000001', '$F', 1
  FROM generate_series(1, $N) i, (VALUES ('1'), ('2')) AS t(s);
UPDATE public.ordenes_pago SET estado = 'aprobada' WHERE factura_id = '$F';
UPDATE public.ordenes_pago SET estado = 'pagada', fecha_pago = CURRENT_DATE
 WHERE factura_id = '$F' AND id::text LIKE 'fa1${n}-0000-0000-0001-%';
SQL
  { echo "SELECT set_config('request.jwt.claim.sub', '$UA', false); SET ROLE authenticated;"
    for i in $(seq 1 $N); do echo "UPDATE public.ordenes_pago SET estado = 'anulada' WHERE id = 'fa1${n}-0000-0000-0001-$(printf '%012d' $i)';"; done; } > "$SALIDAS/c01c_A.sql"
  { echo "SELECT set_config('request.jwt.claim.sub', '$UA', false); SET ROLE authenticated;"
    for i in $(seq 1 $N); do echo "UPDATE public.ordenes_pago SET estado = 'pagada', fecha_pago = CURRENT_DATE WHERE id = 'fa1${n}-0000-0000-0002-$(printf '%012d' $i)';"; done; } > "$SALIDAS/c01c_P.sql"
  t0=$(date +%s)
  psql -q -X -t -A -v ON_ERROR_STOP=0 -d "$BD" -f "$SALIDAS/c01c_A.sql" > "$SALIDAS/c01c_A.txt" 2>&1 & local pA=$!
  psql -q -X -t -A -v ON_ERROR_STOP=0 -d "$BD" -f "$SALIDAS/c01c_P.sql" > "$SALIDAS/c01c_P.txt" 2>&1 & local pP=$!
  wait $pA $pP
  local seg=$(( $(date +%s) - t0 ))
  local eA eP anul pag sinas vivos fact
  eA=$(grep -cE 'ERROR|deadlock' "$SALIDAS/c01c_A.txt"); eP=$(grep -cE 'ERROR|WARNING|deadlock' "$SALIDAS/c01c_P.txt")
  anul=$(q "SELECT count(*) FROM public.ordenes_pago WHERE factura_id='$F' AND estado='anulada'")
  pag=$(q "SELECT count(*) FROM public.ordenes_pago WHERE factura_id='$F' AND estado='pagada'")
  sinas=$(q "SELECT count(*) FROM public.ordenes_pago o WHERE o.factura_id='$F' AND o.estado='pagada' AND NOT EXISTS (SELECT 1 FROM public.conta_asientos a WHERE a.origen_tabla='ordenes_pago' AND a.origen_id=o.id AND a.origen_evento='orden_pago_pagada' AND a.estado='publicado')")
  vivos=$(q "SELECT count(*) FROM public.ordenes_pago o WHERE o.factura_id='$F' AND o.estado='anulada' AND EXISTS (SELECT 1 FROM public.conta_asientos a WHERE a.origen_tabla='ordenes_pago' AND a.origen_id=o.id AND a.origen_evento='orden_pago_pagada' AND a.estado='publicado' AND a.anulado_por_id IS NULL)")
  fact=$(q "SELECT estado || '/' || monto_pagado FROM public.facturas_proveedor WHERE id='$F'")
  [ "$eA" = 0 ] || { ok=0; det="$det $eA error(es)/interbloqueo(s) en las ANULACIONES;"; }
  [ "$eP" = 0 ] || { ok=0; det="$det $eP error(es)/aviso(s)/interbloqueo(s) en los PAGOS;"; }
  [ "$anul" = "$N" ] || { ok=0; det="$det anuladas=$anul (debían ser $N);"; }
  [ "$pag" = "$N" ]  || { ok=0; det="$det pagadas=$pag (debían ser $N);"; }
  [ "$sinas" = 0 ]   || { ok=0; det="$det $sinas pago(s) «pagada» SIN asiento;"; }
  [ "$vivos" = 0 ]   || { ok=0; det="$det $vivos anulación(es) con el asiento original vivo;"; }
  [ "$fact" = "pagada_parcial/$N.00" ] || { ok=0; det="$det la factura quedó '$fact' (debía ser pagada_parcial/$N.00);"; }
  if [ "$ok" = 1 ]; then
    echo "  ✓ CONC-01 (carga) · $N anulaciones y $N pagos simultáneos de la misma factura en ${seg}s: 0 errores, 0 interbloqueos, 0 pagos sin asiento, 0 anulaciones con el asiento vivo"
    return 0
  fi
  echo "❌ CONC-01 (carga) · $det (${seg}s)"
  echo "--- anulaciones:"; head -n 12 "$SALIDAS/c01c_A.txt"; echo "--- pagos:"; head -n 12 "$SALIDAS/c01c_P.txt"
  return 1
}
_rc01=0
_c01 || _rc01=1
_c01_carga || _rc01=1
return $_rc01
