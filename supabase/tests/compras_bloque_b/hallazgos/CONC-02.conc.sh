# CONC-02 · Dos órdenes de pago VIVAS de la MISMA contraseña (se crean a la vez y/o se pagan a la vez).
#
# CAUSA RAÍZ: el EXISTS de compras_tg_orden_contrasena ("ya tiene una orden viva") y la lectura del estado de la
# contraseña en compras_tg_orden_pago_controles corren SIN bloquear la contraseña; ordenes_pago no tenía índice
# único por contraseña. Dos sesiones simultáneas ven la contraseña «emitida» y sin orden, las dos pasan.
#
# ESPERADO: (A) de dos INSERT simultáneos de órdenes sobre la misma contraseña entra UNO y el otro recibe
# COMPRAS_CONTRASENA_YA_TIENE_ORDEN; (B) aunque hubiera dos órdenes vivas (dato histórico: aquí se simula SIN el
# índice único y SIN los triggers de usuario al sembrarlas), de dos pagos simultáneos se paga UNO y el segundo recibe
# COMPRAS_CONTRASENA_CERRADA: la factura queda con lo autorizado por la contraseña y hay UN solo asiento.
#
# Se "sourcea" desde conc_harness.sh (usa sesion_u, par_u, q, aplicar y las variables C C1 C2 UA UC UQ US BD SALIDAS).

ID=CONC-02
P1=e3000000-0000-0000-0000-000000000001
K=fa202   # prefijo de ids de este hallazgo: fa2 + HH(02)
IDX=uq_ordenes_pago_contrasena_viva
HAY_IDX=$(q "SELECT count(*) FROM pg_indexes WHERE schemaname = 'public' AND indexname = '$IDX'")   # ¿lo trae la corrección?
restaurar_indice() {   # deja la base como estaba: si el índice existía antes de la prueba, se vuelve a crear
  [ "$HAY_IDX" = "1" ] && psql -q -X -d "$BD" -c "CREATE UNIQUE INDEX IF NOT EXISTS $IDX ON public.ordenes_pago (contrasena_pago_id) WHERE contrasena_pago_id IS NOT NULL AND estado <> 'anulada'" >/dev/null 2>&1
  return 0
}

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
-- Factura de 1 000 y contraseña emitida con una partida de 400 (UA = administrador de C).
SELECT set_config('request.jwt.claim.sub', '$UA', false);
SET ROLE authenticated;
SELECT public.fa2_factura('${K}100-0000-0000-0000-000000000001', '${K}110-0000-0000-0000-000000000001', '${K}200-0000-0000-0000-000000000001',
                          '${K}300-0000-0000-0000-000000000001', 'FA2-C02-1', 1000);
INSERT INTO public.contrasenas_pago (id, company_id, project_id, proveedor_id, fecha_pago_programada)
VALUES ('${K}500-0000-0000-0000-000000000001', '$C', '$C1', '$P1', CURRENT_DATE);
INSERT INTO public.contrasena_pago_facturas (company_id, contrasena_id, factura_id, monto)
VALUES ('$C', '${K}500-0000-0000-0000-000000000001', '${K}300-0000-0000-0000-000000000001', 400);
INSERT INTO public.contrasenas_pago (id, company_id, project_id, proveedor_id, fecha_pago_programada)
VALUES ('${K}500-0000-0000-0000-000000000003', '$C', '$C1', '$P1', CURRENT_DATE);
INSERT INTO public.contrasena_pago_facturas (company_id, contrasena_id, factura_id, monto)
VALUES ('$C', '${K}500-0000-0000-0000-000000000003', '${K}300-0000-0000-0000-000000000001', 100);
RESET ROLE;
SQL

# ── A · Dos INSERT simultáneos de órdenes de la MISMA contraseña (doble clic) ──────────────────────────────
INS="INSERT INTO public.ordenes_pago (id, company_id, project_id, proveedor_id, contrasena_pago_id, monto) VALUES ('${K}400-0000-0000-0000-00000000000%N', '$C', '$C1', '$P1', '${K}500-0000-0000-0000-000000000001', 400);"
par_u CONC02A "$UC" "${INS//%N/1}" 1.5 "$UC" "${INS//%N/2}" 0
A_VIVAS=$(q "SELECT count(*) FROM public.ordenes_pago WHERE contrasena_pago_id = '${K}500-0000-0000-0000-000000000001' AND estado <> 'anulada'")
A_RECHAZO=$(cat "$SALIDAS/CONC02A1.txt" "$SALIDAS/CONC02A2.txt" | grep -c "COMPRAS_CONTRASENA_YA_TIENE_ORDEN")
if [ "$A_VIVAS" != "1" ] || [ "$A_RECHAZO" != "1" ]; then
  echo "❌ $ID · (A) dos INSERT simultáneos: órdenes vivas de la contraseña = $A_VIVAS (esperado 1); rechazos YA_TIENE_ORDEN = $A_RECHAZO (esperado 1)"
  echo "--- sesión 1"; cat "$SALIDAS/CONC02A1.txt"; echo "--- sesión 2"; cat "$SALIDAS/CONC02A2.txt"
  return 1
fi
echo "  ✓ $ID · (A) dos INSERT simultáneos de órdenes de la misma contraseña: entra una y la otra recibe YA_TIENE_ORDEN"


# ── A2 · Lo mismo SIN el índice único (despliegue con duplicados históricos): basta el trigger con bloqueo ─────────
psql -q -X -d "$BD" -c "DROP INDEX IF EXISTS public.$IDX" >/dev/null 2>&1
INS3="INSERT INTO public.ordenes_pago (id, company_id, project_id, proveedor_id, contrasena_pago_id, monto) VALUES ('${K}400-0000-0000-0000-00000000002%N', '$C', '$C1', '$P1', '${K}500-0000-0000-0000-000000000003', 100);"
par_u CONC02A2 "$UC" "${INS3//%N/1}" 1.5 "$UC" "${INS3//%N/2}" 0
A2_VIVAS=$(q "SELECT count(*) FROM public.ordenes_pago WHERE contrasena_pago_id = '${K}500-0000-0000-0000-000000000003' AND estado <> 'anulada'")
A2_RECHAZO=$(cat "$SALIDAS/CONC02A21.txt" "$SALIDAS/CONC02A22.txt" | grep -c "COMPRAS_CONTRASENA_YA_TIENE_ORDEN")
if [ "$A2_VIVAS" != "1" ] || [ "$A2_RECHAZO" != "1" ]; then
  echo "❌ $ID · (A2) sin índice único, dos INSERT simultáneos: órdenes vivas = $A2_VIVAS (esperado 1); rechazos YA_TIENE_ORDEN = $A2_RECHAZO (esperado 1)"
  echo "--- sesión 1"; cat "$SALIDAS/CONC02A21.txt"; echo "--- sesión 2"; cat "$SALIDAS/CONC02A22.txt"
  return 1
fi
echo "  ✓ $ID · (A2) sin el índice único, el trigger con bloqueo sola evita la segunda orden viva"

# ── B · Dos órdenes VIVAS ya existentes (dato histórico) que se pagan a la vez ────────────────────────────
# Se simula el dato histórico: sin el índice único (no pudo crearse con duplicados) y sembrando sin triggers de usuario.
psql -q -X -v ON_ERROR_STOP=1 -d "$BD" >/dev/null <<SQL || { echo "❌ $ID · no se pudo preparar (B)"; return 1; }
-- (el índice único ya se quitó en A2)
-- Contraseña nueva con una partida de 400 sobre OTRA factura (la anterior ya tiene orden).
SELECT set_config('request.jwt.claim.sub', '$UA', false);
SET ROLE authenticated;
SELECT public.fa2_factura('${K}100-0000-0000-0000-000000000002', '${K}110-0000-0000-0000-000000000002', '${K}200-0000-0000-0000-000000000002',
                          '${K}300-0000-0000-0000-000000000002', 'FA2-C02-2', 1000);
INSERT INTO public.contrasenas_pago (id, company_id, project_id, proveedor_id, fecha_pago_programada)
VALUES ('${K}500-0000-0000-0000-000000000002', '$C', '$C1', '$P1', CURRENT_DATE);
INSERT INTO public.contrasena_pago_facturas (company_id, contrasena_id, factura_id, monto)
VALUES ('$C', '${K}500-0000-0000-0000-000000000002', '${K}300-0000-0000-0000-000000000002', 400);
RESET ROLE;
SET session_replication_role = replica;
INSERT INTO public.ordenes_pago (id, company_id, project_id, proveedor_id, contrasena_pago_id, monto, estado, aprobada_por, aprobada_at, solicitada_por) VALUES
  ('${K}400-0000-0000-0000-00000000000a', '$C', '$C1', '$P1', '${K}500-0000-0000-0000-000000000002', 400, 'aprobada', '$UQ', now(), '$UC'),
  ('${K}400-0000-0000-0000-00000000000b', '$C', '$C1', '$P1', '${K}500-0000-0000-0000-000000000002', 400, 'aprobada', '$UQ', now(), '$UC');
RESET session_replication_role;
SQL
PAGAR="UPDATE public.ordenes_pago SET estado = 'pagada', fecha_pago = CURRENT_DATE WHERE id = '${K}400-0000-0000-0000-00000000000%N';"
par_u CONC02B "$US" "${PAGAR//%N/a}" 1.5 "$US" "${PAGAR//%N/b}" 0
B_PAGADAS=$(q "SELECT count(*) FROM public.ordenes_pago WHERE contrasena_pago_id = '${K}500-0000-0000-0000-000000000002' AND estado = 'pagada'")
B_FACT=$(q "SELECT monto_pagado FROM public.facturas_proveedor WHERE id = '${K}300-0000-0000-0000-000000000002'")
B_ASIENTOS=$(q "SELECT count(*) FROM public.conta_asientos WHERE origen_tabla = 'ordenes_pago' AND origen_evento = 'orden_pago_pagada' AND estado = 'publicado' AND origen_id IN ('${K}400-0000-0000-0000-00000000000a', '${K}400-0000-0000-0000-00000000000b')")
B_CERRADA=$(cat "$SALIDAS/CONC02B1.txt" "$SALIDAS/CONC02B2.txt" | grep -c "COMPRAS_CONTRASENA_CERRADA")
if [ "$B_PAGADAS" != "1" ] || [ "$B_FACT" != "400.00" ] || [ "$B_ASIENTOS" != "1" ] || [ "$B_CERRADA" != "1" ]; then
  echo "❌ $ID · (B) dos pagos simultáneos de la misma contraseña: órdenes pagadas = $B_PAGADAS (esperado 1); factura monto_pagado = $B_FACT (esperado 400.00); asientos = $B_ASIENTOS (esperado 1); rechazos CERRADA = $B_CERRADA (esperado 1)"
  echo "--- sesión 1"; cat "$SALIDAS/CONC02B1.txt"; echo "--- sesión 2"; cat "$SALIDAS/CONC02B2.txt"
  return 1
fi
echo "  ✓ $ID · (B) dos pagos simultáneos de la misma contraseña: se paga uno (400), el otro recibe CONTRASENA_CERRADA y hay un solo asiento"
# Se deja la base como estaba: la orden sobrante (aprobada) se anula y, si la corrección trae el índice único, se restaura.
q "UPDATE public.ordenes_pago SET estado = 'anulada' WHERE contrasena_pago_id = '${K}500-0000-0000-0000-000000000002' AND estado = 'aprobada'" >/dev/null
restaurar_indice

# ── C · Variante de carga acotada: 8 contraseñas, dos INSERT simultáneos cada una (sin pausas) ───────────────
C_MAL=0
for i in 1 2 3 4 5 6 7 8; do
  CP="${K}500-0000-0000-0000-00000000001$i"
  psql -q -X -d "$BD" >/dev/null <<SQL
SELECT set_config('request.jwt.claim.sub', '$UC', false);
SET ROLE authenticated;
INSERT INTO public.contrasenas_pago (id, company_id, project_id, proveedor_id, fecha_pago_programada) VALUES ('$CP', '$C', '$C1', '$P1', CURRENT_DATE);
INSERT INTO public.contrasena_pago_facturas (company_id, contrasena_id, factura_id, monto) VALUES ('$C', '$CP', '${K}300-0000-0000-0000-000000000001', 10);
SQL
  for n in 1 2; do
    sesion_u "$UC" 0 "INSERT INTO public.ordenes_pago (id, company_id, project_id, proveedor_id, contrasena_pago_id, monto) VALUES ('${K}400-0000-0000-0000-0000000001${i}${n}'::uuid, '$C', '$C1', '$P1', '$CP', 10);" 0.2 > "$SALIDAS/CONC02C_${i}_${n}.txt" 2>&1 &
  done
  wait
  v=$(q "SELECT count(*) FROM public.ordenes_pago WHERE contrasena_pago_id = '$CP' AND estado <> 'anulada'")
  [ "$v" = "1" ] || C_MAL=$((C_MAL+1))
done
if [ "$C_MAL" != "0" ]; then
  echo "❌ $ID · (C) carga acotada: $C_MAL de 8 contraseñas quedaron con 0 o 2 órdenes vivas (esperado exactamente 1 en todas)"
  return 1
fi
echo "  ✓ $ID · (C) 8 pares de INSERT simultáneos: cada contraseña quedó con exactamente 1 orden viva"
return 0
