# EV-09 · orden de bloqueo: compras_tg_orden_pago_controles hacía SELECT … FOR UPDATE sobre la
# factura que le indicaran ANTES de comprobar que fuera de la empresa de la orden. Un usuario de C
# con el UUID de una factura de D (a) esperaba —como canal lateral— a que D soltara su fila y
# (b) escribía en la fila de D (marca de bloqueo) con un privilegio que no es suyo.
#
# Se "sourcea" desde conc_harness.sh (usa sesion_u, q, SALIDAS, BD, C C1 UA). Determinista:
#   · la sesión 1 (administrador de D) BLOQUEA la factura de D con FOR UPDATE durante 6 s;
#   · 1 s después la sesión 2 (administrador de C) intenta una orden de pago contra ESA factura;
#   · correcto: la sesión 2 recibe «COMPRAS_PAGO_FACTURA_AJENA» de inmediato (< 3 s), sin esperar
#     el bloqueo de D; incorrecto: espera ~5 s a que D termine.
#   Además se comprueba que la serialización LEGÍTIMA no se perdió: dos órdenes de C sobre la
#   MISMA factura de C se serializan (la segunda espera a la primera y ve su reserva).
UD=d0d0d0d0-0000-0000-0000-00000000000d
D=dddddddd-dddd-dddd-dddd-dddddddddddd; D1=d1d1d1d1-0000-0000-0000-000000000001
PD=e3000000-0000-0000-0000-0000000000d1; P1=e3000000-0000-0000-0000-000000000001
FD=fa709500-0000-0000-0000-0000000000c1     # factura de D (aprobada, 100)
FC=fa709500-0000-0000-0000-0000000000c2     # factura de C (aprobada, 100)

psql -q -X -v ON_ERROR_STOP=1 -d "$BD" <<SQL
SET session_replication_role = replica;
INSERT INTO public.facturas_proveedor (id,company_id,project_id,proveedor_id,numero_factura,concepto,monto_total,monto_pagado,estado) VALUES
  ('$FD', '$D', '$D1', '$PD', 'EV09C-D-1', 'factura de D', 100, 0, 'aprobada'),
  ('$FC', '$C', '$C1', '$P1', 'EV09C-C-1', 'factura de C', 100, 0, 'aprobada')
ON CONFLICT DO NOTHING;
SQL

ms() { echo $(( $(date +%s%N) / 1000000 )); }

# ── 1 · ajena: la sesión de C no espera ni bloquea la fila de D ──────────────
sesion_u "$UD" 0 "SELECT id FROM public.facturas_proveedor WHERE id = '$FD' FOR UPDATE;" 6 > "$SALIDAS/ev09_d.txt" 2>&1 &
P_D=$!
sleep 1
T0=$(ms)
sesion_u "$UA" 0 "INSERT INTO public.ordenes_pago (company_id,project_id,proveedor_id,factura_id,monto)
                  VALUES ('$C','$C1','$P1','$FD',10);" 0 > "$SALIDAS/ev09_c.txt" 2>&1
T1=$(ms)
wait $P_D || true
ESPERA=$(( T1 - T0 ))
if grep -q 'COMPRAS_PAGO_FACTURA_AJENA' "$SALIDAS/ev09_c.txt" && [ "$ESPERA" -lt 3000 ]; then
  echo "  ✓ EV-09 · la orden de C contra la factura de D se rechaza como «ajena» en ${ESPERA} ms, sin esperar el bloqueo de D (6 s)"
else
  echo "❌ EV-09 · la sesión de C esperó ${ESPERA} ms (debía ser < 3000) o no recibió COMPRAS_PAGO_FACTURA_AJENA: tomó el bloqueo de una fila de OTRA empresa antes de comprobar la empresa"
  echo "--- sesión de C ---"; cat "$SALIDAS/ev09_c.txt"
  echo "--- sesión de D ---"; cat "$SALIDAS/ev09_d.txt"
  return 1
fi

# ── 2 · legítima: dos órdenes de C sobre la misma factura de C se serializan ─────
sesion_u "$UA" 0 "INSERT INTO public.ordenes_pago (company_id,project_id,proveedor_id,factura_id,monto)
                  VALUES ('$C','$C1','$P1','$FC',70);" 4 > "$SALIDAS/ev09_1.txt" 2>&1 &
P1_=$!
sleep 1
T0=$(ms)
sesion_u "$UA" 0 "INSERT INTO public.ordenes_pago (company_id,project_id,proveedor_id,factura_id,monto)
                  VALUES ('$C','$C1','$P1','$FC',70);" 0 > "$SALIDAS/ev09_2.txt" 2>&1
T1=$(ms)
wait $P1_ || true
ESPERA=$(( T1 - T0 ))
N=$(q "SELECT count(*) FROM public.ordenes_pago WHERE factura_id = '$FC' AND estado IN ('borrador','aprobada')")
if [ "$N" = "1" ] && grep -q 'COMPRAS_PAGO_EXCEDE_SALDO' "$SALIDAS/ev09_2.txt" && [ "$ESPERA" -ge 2000 ]; then
  echo "  ✓ EV-09 · LEGÍTIMO: dos órdenes de C sobre la misma factura de C siguen serializadas (la segunda esperó ${ESPERA} ms y vio la reserva de la primera)"
else
  echo "❌ EV-09 · la serialización legítima de la misma empresa se perdió (órdenes vivas=$N, espera=${ESPERA} ms)"
  echo "--- primera ---"; cat "$SALIDAS/ev09_1.txt"; echo "--- segunda ---"; cat "$SALIDAS/ev09_2.txt"
  return 1
fi
return 0
