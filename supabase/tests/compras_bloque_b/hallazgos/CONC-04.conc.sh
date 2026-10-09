# CONC-04 · un fallo de bloqueo dentro del bloque contable NO puede ocultarse dejando el pago «pagada» sin asiento
# ni la anulación «anulada» con el asiento original vivo.
# Fragmento que se "sourcea" desde conc_harness.sh (usa sesion_u, q, BD, SALIDAS, C, C1, UA).
#
# Escena DETERMINISTA: la sesión X retiene el folio contable de C/C1 (lo que retiene cualquier póliza en curso).
# Otra sesión, con lock_timeout = 800 ms (el equivalente de un interbloqueo 40P01 o de una espera que se acaba),
#   · PAGA una orden aprobada      → el asiento no puede tomar el folio.
#   · ANULA una orden pagada       → el reverso no puede tomar el folio.
# Correcto: la operación FALLA entera (COMPRAS_PAGO_SIN_ASIENTO / COMPRAS_PAGO_REVERSO_FALLIDO), nada queda a medias,
# y reintentada cuando el folio está libre termina bien.
_c04() {
  local n F O1 O2 A1 ok=1 det="" pX pP pA
  n=$(printf '%05d' $(( (RANDOM % 40000) + 50000 )))
  F="fa1${n}-0000-0000-0000-000000000001"; O1="fa1${n}-0000-0000-0000-0000000000a1"; O2="fa1${n}-0000-0000-0000-0000000000a2"
  psql -q -X -v ON_ERROR_STOP=1 -d "$BD" >/dev/null <<SQL || { echo "❌ CONC-04 · fallo el montaje"; return 1; }
SELECT set_config('request.jwt.claim.sub', '$UA', false);
SET ROLE authenticated;
INSERT INTO public.facturas_proveedor (id, company_id, project_id, proveedor_id, numero_factura, concepto, monto_total)
VALUES ('$F', '$C', '$C1', 'e3000000-0000-0000-0000-000000000001', 'FA1-C04-$n', 'CONC-04', 1000);
UPDATE public.facturas_proveedor SET estado = 'aprobada' WHERE id = '$F';
INSERT INTO public.ordenes_pago (id, company_id, project_id, proveedor_id, factura_id, monto)
VALUES ('$O1', '$C', '$C1', 'e3000000-0000-0000-0000-000000000001', '$F', 600),
       ('$O2', '$C', '$C1', 'e3000000-0000-0000-0000-000000000001', '$F', 400);
UPDATE public.ordenes_pago SET estado = 'aprobada' WHERE id IN ('$O1', '$O2');
UPDATE public.ordenes_pago SET estado = 'pagada', fecha_pago = CURRENT_DATE WHERE id = '$O1';
SQL
  A1=$(q "SELECT id FROM public.conta_asientos WHERE origen_tabla='ordenes_pago' AND origen_id='$O1' AND origen_evento='orden_pago_pagada' AND estado='publicado'")
  [ -n "$A1" ] || { echo "❌ CONC-04 · el montaje no dejó el asiento del pago 1"; return 1; }
  local FOLIO="SELECT 1 FROM public.conta_folios WHERE company_id = '$C' AND project_id = '$C1' FOR UPDATE;"

  # ── 1 · PAGAR con el folio retenido ───────────────────────────────────────
  sesion_u - 0 "$FOLIO" 2.5 > "$SALIDAS/c04_X1.txt" 2>&1 & pX=$!
  sesion_u "$UA" 0.4 "SET lock_timeout = '800ms'; UPDATE public.ordenes_pago SET estado = 'pagada', fecha_pago = CURRENT_DATE WHERE id = '$O2';" 0 > "$SALIDAS/c04_P.txt" 2>&1 & pP=$!
  wait $pX; wait $pP
  local sP e2 nA2 fact
  sP=$(cat "$SALIDAS/c04_P.txt")
  e2=$(q "SELECT estado FROM public.ordenes_pago WHERE id='$O2'")
  nA2=$(q "SELECT count(*) FROM public.conta_asientos WHERE origen_tabla='ordenes_pago' AND origen_id='$O2' AND origen_evento='orden_pago_pagada' AND estado<>'anulado'")
  fact=$(q "SELECT estado || '/' || monto_pagado FROM public.facturas_proveedor WHERE id='$F'")
  if [ "$e2" = "pagada" ] && [ "$nA2" = "0" ]; then ok=0; det="$det PAGAR: la orden quedó 'pagada' SIN asiento (factura $fact) y el único aviso fue un WARNING;"; fi
  echo "$sP" | grep -q 'COMPRAS_PAGO_SIN_ASIENTO' || { ok=0; det="$det PAGAR: no hubo error COMPRAS_PAGO_SIN_ASIENTO;"; }
  [ "$e2" = "aprobada" ] || { ok=0; det="$det PAGAR: la orden quedó '$e2' (debía seguir aprobada);"; }
  [ "$nA2" = "0" ] || { ok=0; det="$det PAGAR: hay $nA2 asientos vivos del pago fallido;"; }
  [ "$fact" = "pagada_parcial/600.00" ] || { ok=0; det="$det PAGAR: la factura quedó '$fact' (debía seguir pagada_parcial/600.00);"; }

  # ── 2 · ANULAR con el folio retenido ──────────────────────────────────────
  sesion_u - 0 "$FOLIO" 2.5 > "$SALIDAS/c04_X2.txt" 2>&1 & pX=$!
  sesion_u "$UA" 0.4 "SET lock_timeout = '800ms'; UPDATE public.ordenes_pago SET estado = 'anulada' WHERE id = '$O1';" 0 > "$SALIDAS/c04_A.txt" 2>&1 & pA=$!
  wait $pX; wait $pA
  local sA e1 nRev vivo
  sA=$(cat "$SALIDAS/c04_A.txt")
  e1=$(q "SELECT estado FROM public.ordenes_pago WHERE id='$O1'")
  vivo=$(q "SELECT (estado='publicado' AND anulado_por_id IS NULL) FROM public.conta_asientos WHERE id='$A1'")
  fact=$(q "SELECT estado || '/' || monto_pagado FROM public.facturas_proveedor WHERE id='$F'")
  if [ "$e1" = "anulada" ] && [ "$vivo" = "t" ]; then ok=0; det="$det ANULAR: la orden quedó 'anulada' con el asiento original VIVO y sin reverso (factura $fact);"; fi
  echo "$sA" | grep -q 'COMPRAS_PAGO_REVERSO_FALLIDO' || { ok=0; det="$det ANULAR: no hubo error COMPRAS_PAGO_REVERSO_FALLIDO;"; }
  [ "$e1" = "pagada" ] || { ok=0; det="$det ANULAR: la orden quedó '$e1' (debía seguir pagada);"; }
  [ "$vivo" = "t" ] || { ok=0; det="$det ANULAR: el asiento original ya no está vivo;"; }
  [ "$fact" = "pagada_parcial/600.00" ] || { ok=0; det="$det ANULAR: la factura quedó '$fact' (debía seguir pagada_parcial/600.00);"; }

  # ── 3 · Con el folio libre, el reintento sí termina bien ──────────────────
  psql -q -X -v ON_ERROR_STOP=1 -d "$BD" >"$SALIDAS/c04_R.txt" 2>&1 <<SQL
SELECT set_config('request.jwt.claim.sub', '$UA', false);
SET ROLE authenticated;
UPDATE public.ordenes_pago SET estado = 'pagada', fecha_pago = CURRENT_DATE WHERE id = '$O2';
UPDATE public.ordenes_pago SET estado = 'anulada' WHERE id = '$O1';
SQL
  local rcR=$?
  nA2=$(q "SELECT count(*) FROM public.conta_asientos WHERE origen_tabla='ordenes_pago' AND origen_id='$O2' AND origen_evento='orden_pago_pagada' AND estado='publicado' AND anulado_por_id IS NULL")
  nRev=$(q "SELECT count(*) FROM public.conta_asientos WHERE origen_tabla='ordenes_pago' AND origen_id='$O1' AND origen_evento='orden_pago_pagada_revertido' AND estado='publicado'")
  fact=$(q "SELECT estado || '/' || monto_pagado FROM public.facturas_proveedor WHERE id='$F'")
  [ "$rcR" = 0 ] || { ok=0; det="$det REINTENTO: falló con el folio libre ($(tr '\n' ' ' < "$SALIDAS/c04_R.txt"));"; }
  [ "$nA2" = "1" ] || { ok=0; det="$det REINTENTO: el pago 2 tiene $nA2 asientos publicados (debía ser 1);"; }
  [ "$nRev" = "1" ] || { ok=0; det="$det REINTENTO: el pago 1 tiene $nRev reversos (debía ser 1);"; }
  [ "$fact" = "pagada_parcial/400.00" ] || { ok=0; det="$det REINTENTO: la factura quedó '$fact' (debía ser pagada_parcial/400.00);"; }

  if [ "$ok" = 1 ]; then
    echo "  ✓ CONC-04 · una espera de bloqueo fallida en el asiento/reverso hace FALLAR el pago y la anulación (nada a medias); el reintento con el folio libre termina bien"
    return 0
  fi
  echo "❌ CONC-04 · $det"
  echo "--- PAGAR (lock_timeout 800ms, folio retenido):"; echo "$sP"
  echo "--- ANULAR (lock_timeout 800ms, folio retenido):"; echo "$sA"
  return 1
}
_c04
