# CONC-03 · Editar (o agregar) una partida de la contraseña MIENTRAS se paga su orden.
#
# CAUSA RAÍZ: compras_tg_contrasena_factura lee la contraseña SIN bloquearla y la ve «emitida» mientras la orden de
# pago espera (p. ej. el folio contable) antes de dejarla «pagada»; el trigger de pago (cxp_tg_orden_saldo) vuelve a
# leer las partidas SIN bloqueo y aplica a las facturas las partidas NUEVAS, no las que validó el control. Resultado:
# la factura queda con más pagado que la orden y que el asiento.
#
# ESPERADO: mientras se paga, la contraseña no admite cambios en sus partidas (la edición espera al pago y recibe
# COMPRAS_CONTRASENA_CERRADA); lo aplicado a la factura = orden = asiento.
#
# Se "sourcea" desde conc_harness.sh (usa sesion_u, q, aplicar y las variables C C1 UA UC US BD SALIDAS).

ID=CONC-03
P1=e3000000-0000-0000-0000-000000000001
K=fa203   # prefijo de ids de este hallazgo: fa2 + HH(03)

psql -q -X -v ON_ERROR_STOP=1 -d "$BD" >/dev/null <<SQL || { echo "❌ $ID · no se pudo preparar"; return 1; }
CREATE OR REPLACE FUNCTION public.fa2_factura(p_oc uuid, p_linea uuid, p_rec uuid, p_fac uuid, p_num text,
                                              p_monto numeric, p_prov uuid DEFAULT 'e3000000-0000-0000-0000-000000000001')
RETURNS void LANGUAGE plpgsql AS \$\$
BEGIN
  PERFORM public.ce_oc(p_oc, p_linea, p_prov, 'servicio', 1, p_monto, 0);
  PERFORM public.ce_recepcion(p_rec, p_oc, p_linea, 1, 'servicio');
  UPDATE public.recepciones SET estado = 'registrada' WHERE id = p_rec;
  PERFORM public.ce_factura(p_fac, p_oc, p_linea, p_prov, p_num, 1, p_monto, 0);
  UPDATE public.facturas_proveedor SET estado = 'aprobada' WHERE id = p_fac;
END;
\$\$;
SELECT set_config('request.jwt.claim.sub', '$UA', false);
SET ROLE authenticated;
-- Dos facturas de 1 000. Escenario A: contraseña con partida de 100 sobre F1 y su orden aprobada de 100.
SELECT public.fa2_factura('${K}100-0000-0000-0000-000000000001', '${K}110-0000-0000-0000-000000000001', '${K}200-0000-0000-0000-000000000001',
                          '${K}300-0000-0000-0000-000000000001', 'FA2-C03-1', 1000);
SELECT public.fa2_factura('${K}100-0000-0000-0000-000000000002', '${K}110-0000-0000-0000-000000000002', '${K}200-0000-0000-0000-000000000002',
                          '${K}300-0000-0000-0000-000000000002', 'FA2-C03-2', 1000);
SELECT public.fa2_factura('${K}100-0000-0000-0000-000000000003', '${K}110-0000-0000-0000-000000000003', '${K}200-0000-0000-0000-000000000003',
                          '${K}300-0000-0000-0000-000000000003', 'FA2-C03-3', 1000);
SELECT public.fa2_factura('${K}100-0000-0000-0000-000000000004', '${K}110-0000-0000-0000-000000000004', '${K}200-0000-0000-0000-000000000004',
                          '${K}300-0000-0000-0000-000000000004', 'FA2-C03-4', 1000);
SELECT public.fa2_factura('${K}100-0000-0000-0000-000000000005', '${K}110-0000-0000-0000-000000000005', '${K}200-0000-0000-0000-000000000005',
                          '${K}300-0000-0000-0000-000000000005', 'FA2-C03-5', 1000);
INSERT INTO public.contrasenas_pago (id, company_id, project_id, proveedor_id, fecha_pago_programada) VALUES
  ('${K}500-0000-0000-0000-000000000001', '$C', '$C1', '$P1', CURRENT_DATE),
  ('${K}500-0000-0000-0000-000000000002', '$C', '$C1', '$P1', CURRENT_DATE),
  ('${K}500-0000-0000-0000-000000000004', '$C', '$C1', '$P1', CURRENT_DATE),
  ('${K}500-0000-0000-0000-000000000005', '$C', '$C1', '$P1', CURRENT_DATE);
INSERT INTO public.contrasena_pago_facturas (company_id, contrasena_id, factura_id, monto) VALUES
  ('$C', '${K}500-0000-0000-0000-000000000001', '${K}300-0000-0000-0000-000000000001', 100),
  ('$C', '${K}500-0000-0000-0000-000000000002', '${K}300-0000-0000-0000-000000000003', 100),
  ('$C', '${K}500-0000-0000-0000-000000000004', '${K}300-0000-0000-0000-000000000004', 100),
  ('$C', '${K}500-0000-0000-0000-000000000005', '${K}300-0000-0000-0000-000000000005', 100);
INSERT INTO public.ordenes_pago (id, company_id, project_id, proveedor_id, contrasena_pago_id, monto) VALUES
  ('${K}400-0000-0000-0000-000000000001', '$C', '$C1', '$P1', '${K}500-0000-0000-0000-000000000001', 100),
  ('${K}400-0000-0000-0000-000000000002', '$C', '$C1', '$P1', '${K}500-0000-0000-0000-000000000002', 100);
UPDATE public.ordenes_pago SET estado = 'aprobada' WHERE id IN ('${K}400-0000-0000-0000-000000000001', '${K}400-0000-0000-0000-000000000002');
RESET ROLE;
SQL

FOLIO="SELECT 'folio retenido' FROM public.conta_folios WHERE company_id = '$C' AND project_id = '$C1' FOR UPDATE;"

# Corre X (retiene el folio 2.5 s: cualquier operación contable en curso), P (paga) y S (edita la contraseña 0.8 s después).
escenario() {   # <etiqueta> <orden> <sql de S>
  local et="$1" op="$2" sql_s="$3"
  sesion_u -    0   "$FOLIO" 2.5 > "$SALIDAS/${et}_X.txt" 2>&1 &
  local px=$!
  sesion_u "$US" 0.3 "UPDATE public.ordenes_pago SET estado = 'pagada', fecha_pago = CURRENT_DATE WHERE id = '$op';" 0 > "$SALIDAS/${et}_P.txt" 2>&1 &
  local pp=$!
  sesion_u "$UA" 0.8 "$sql_s" 0 > "$SALIDAS/${et}_S.txt" 2>&1 &
  local ps=$!
  wait $px $pp $ps || true
}

# ── A · S sube la partida de 100 a 900 mientras P espera el folio ────────────────────────────────────────
escenario CONC03A "${K}400-0000-0000-0000-000000000001" \
  "UPDATE public.contrasena_pago_facturas SET monto = 900 WHERE contrasena_id = '${K}500-0000-0000-0000-000000000001';"
A_FACT=$(q "SELECT monto_pagado FROM public.facturas_proveedor WHERE id = '${K}300-0000-0000-0000-000000000001'")
A_ASI=$(q "SELECT COALESCE(sum(l.debe), 0) FROM public.conta_asientos a JOIN public.conta_asiento_lineas l ON l.asiento_id = a.id WHERE a.origen_tabla = 'ordenes_pago' AND a.origen_evento = 'orden_pago_pagada' AND a.origen_id = '${K}400-0000-0000-0000-000000000001'")
A_OP=$(q "SELECT estado || '/' || monto FROM public.ordenes_pago WHERE id = '${K}400-0000-0000-0000-000000000001'")
A_CERR=$(grep -c "COMPRAS_CONTRASENA_CERRADA" "$SALIDAS/CONC03A_S.txt")
if [ "$A_FACT" != "100.00" ] || [ "$A_ASI" != "100.00" ] || [ "$A_OP" != "pagada/100.00" ] || [ "$A_CERR" != "1" ]; then
  echo "❌ $ID · (A) editar la partida (100→900) mientras se paga: factura monto_pagado = $A_FACT (esperado 100.00 = orden = asiento $A_ASI); orden = $A_OP; rechazos CERRADA de la edición = $A_CERR (esperado 1)"
  for x in X P S; do echo "--- $x"; cat "$SALIDAS/CONC03A_$x.txt"; done
  return 1
fi
echo "  ✓ $ID · (A) editar la partida mientras se paga espera al pago y recibe CERRADA: factura = orden = asiento = 100"

# ── B · S AGREGA una partida de otra factura (500) mientras P espera el folio ───────────────────────────────
escenario CONC03B "${K}400-0000-0000-0000-000000000002" \
  "INSERT INTO public.contrasena_pago_facturas (company_id, contrasena_id, factura_id, monto) VALUES ('$C', '${K}500-0000-0000-0000-000000000002', '${K}300-0000-0000-0000-000000000002', 500);"
B_F3=$(q "SELECT monto_pagado FROM public.facturas_proveedor WHERE id = '${K}300-0000-0000-0000-000000000003'")
B_F2=$(q "SELECT monto_pagado FROM public.facturas_proveedor WHERE id = '${K}300-0000-0000-0000-000000000002'")
B_ASI=$(q "SELECT COALESCE(sum(l.debe), 0) FROM public.conta_asientos a JOIN public.conta_asiento_lineas l ON l.asiento_id = a.id WHERE a.origen_tabla = 'ordenes_pago' AND a.origen_evento = 'orden_pago_pagada' AND a.origen_id = '${K}400-0000-0000-0000-000000000002'")
B_PART=$(q "SELECT count(*) FROM public.contrasena_pago_facturas WHERE contrasena_id = '${K}500-0000-0000-0000-000000000002'")
B_CERR=$(grep -c "COMPRAS_CONTRASENA_CERRADA" "$SALIDAS/CONC03B_S.txt")
if [ "$B_F3" != "100.00" ] || [ "$B_F2" != "0.00" ] || [ "$B_ASI" != "100.00" ] || [ "$B_PART" != "1" ] || [ "$B_CERR" != "1" ]; then
  echo "❌ $ID · (B) agregar una partida (500 sobre otra factura) mientras se paga: F3 pagado = $B_F3 (esperado 100.00); F2 pagado = $B_F2 (esperado 0.00: nada la respalda); asiento = $B_ASI (esperado 100.00); partidas de la contraseña = $B_PART (esperado 1); rechazos CERRADA = $B_CERR (esperado 1)"
  for x in X P S; do echo "--- $x"; cat "$SALIDAS/CONC03B_$x.txt"; done
  return 1
fi
echo "  ✓ $ID · (B) agregar una partida mientras se paga espera al pago y recibe CERRADA: la otra factura no se toca"

# ── D · La orden se CREA (por el total viejo, 100) mientras otra sesión sube la partida a 150 ───────────────
par_u CONC03D "$UC" "UPDATE public.contrasena_pago_facturas SET monto = 150 WHERE contrasena_id = '${K}500-0000-0000-0000-000000000004';" 1.5 \
                "$UC" "INSERT INTO public.ordenes_pago (id, company_id, project_id, proveedor_id, contrasena_pago_id, monto) VALUES ('${K}400-0000-0000-0000-000000000004', '$C', '$C1', '$P1', '${K}500-0000-0000-0000-000000000004', 100);" 0
D_ORD=$(q "SELECT count(*) FROM public.ordenes_pago WHERE contrasena_pago_id = '${K}500-0000-0000-0000-000000000004'")
D_PART=$(q "SELECT monto FROM public.contrasena_pago_facturas WHERE contrasena_id = '${K}500-0000-0000-0000-000000000004'")
D_MSG=$(grep -c "COMPRAS_ORDEN_MONTO_DISTINTO" "$SALIDAS/CONC03D2.txt")
if [ "$D_ORD" != "0" ] || [ "$D_PART" != "150.00" ] || [ "$D_MSG" != "1" ]; then
  echo "❌ $ID · (D) crear la orden (100) mientras la partida sube a 150: órdenes = $D_ORD (esperado 0: el total ya es 150); partida = $D_PART (esperado 150.00); rechazos MONTO_DISTINTO = $D_MSG (esperado 1)"
  echo "--- sesión 1"; cat "$SALIDAS/CONC03D1.txt"; echo "--- sesión 2"; cat "$SALIDAS/CONC03D2.txt"
  return 1
fi
echo "  ✓ $ID · (D) la orden creada a la vez que sube la partida espera, lee el total nuevo (150) y se rechaza por monto distinto"

# ── E · La partida se EDITA mientras otra sesión crea la orden por el total vigente (100) ─────────────────────
par_u CONC03E "$UC" "INSERT INTO public.ordenes_pago (id, company_id, project_id, proveedor_id, contrasena_pago_id, monto) VALUES ('${K}400-0000-0000-0000-000000000005', '$C', '$C1', '$P1', '${K}500-0000-0000-0000-000000000005', 100);" 1.5 \
                "$UC" "UPDATE public.contrasena_pago_facturas SET monto = 150 WHERE contrasena_id = '${K}500-0000-0000-0000-000000000005';" 0
E_ORD=$(q "SELECT count(*) FROM public.ordenes_pago WHERE contrasena_pago_id = '${K}500-0000-0000-0000-000000000005'")
E_PART=$(q "SELECT monto FROM public.contrasena_pago_facturas WHERE contrasena_id = '${K}500-0000-0000-0000-000000000005'")
E_MSG=$(grep -c "COMPRAS_CONTRASENA_CON_ORDEN" "$SALIDAS/CONC03E2.txt")
if [ "$E_ORD" != "1" ] || [ "$E_PART" != "100.00" ] || [ "$E_MSG" != "1" ]; then
  echo "❌ $ID · (E) editar la partida (→150) mientras se crea la orden (100): órdenes = $E_ORD (esperado 1); partida = $E_PART (esperado 100.00); rechazos CON_ORDEN = $E_MSG (esperado 1)"
  echo "--- sesión 1"; cat "$SALIDAS/CONC03E1.txt"; echo "--- sesión 2"; cat "$SALIDAS/CONC03E2.txt"
  return 1
fi
echo "  ✓ $ID · (E) la edición de la partida espera a la orden en curso y se rechaza (CON_ORDEN): partida = orden = 100"

# ── C · Sin contención: la edición de partida de una contraseña sin orden y un pago normal siguen funcionando ──
psql -q -X -v ON_ERROR_STOP=1 -d "$BD" >/dev/null <<SQL || { echo "❌ $ID · (C) falló un camino legítimo sin contención"; return 1; }
SELECT set_config('request.jwt.claim.sub', '$UA', false);
SET ROLE authenticated;
INSERT INTO public.contrasenas_pago (id, company_id, project_id, proveedor_id, fecha_pago_programada)
VALUES ('${K}500-0000-0000-0000-000000000003', '$C', '$C1', '$P1', CURRENT_DATE);
INSERT INTO public.contrasena_pago_facturas (company_id, contrasena_id, factura_id, monto)
VALUES ('$C', '${K}500-0000-0000-0000-000000000003', '${K}300-0000-0000-0000-000000000002', 200);
UPDATE public.contrasena_pago_facturas SET monto = 250 WHERE contrasena_id = '${K}500-0000-0000-0000-000000000003';
INSERT INTO public.ordenes_pago (id, company_id, project_id, proveedor_id, contrasena_pago_id, monto)
VALUES ('${K}400-0000-0000-0000-000000000003', '$C', '$C1', '$P1', '${K}500-0000-0000-0000-000000000003', 250);
UPDATE public.ordenes_pago SET estado = 'aprobada' WHERE id = '${K}400-0000-0000-0000-000000000003';
UPDATE public.ordenes_pago SET estado = 'pagada', fecha_pago = CURRENT_DATE WHERE id = '${K}400-0000-0000-0000-000000000003';
RESET ROLE;
SQL
C_FACT=$(q "SELECT monto_pagado FROM public.facturas_proveedor WHERE id = '${K}300-0000-0000-0000-000000000002'")
if [ "$C_FACT" != "250.00" ]; then
  echo "❌ $ID · (C) camino legítimo sin contención: la factura quedó con $C_FACT pagados (esperado 250.00)"
  return 1
fi
echo "  ✓ $ID · (C) sin contención: editar la partida antes de la orden y pagar sigue funcionando (250)"
return 0
