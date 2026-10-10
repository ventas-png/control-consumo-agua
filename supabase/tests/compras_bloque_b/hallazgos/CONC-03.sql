\set ON_ERROR_STOP on
-- ============================================================================
-- CONC-03 · Las partidas de una contraseña no cambian mientras exista su orden de pago, y no salen de una
--           contraseña pagada o anulada (parte secuencial/lógica; el entrelazado real con el pago en curso
--           está en CONC-03.conc.sh).
--
-- CAUSA RAÍZ
--   compras_tg_contrasena_factura lee la contraseña SIN bloquear y solo mira el estado de la contraseña
--   DESTINO de la partida; con una orden aprobada (o en pago) las partidas seguían siendo editables, y el trigger
--   de pago aplica a las facturas las partidas que haya AL MOMENTO de pagar, no las que validó el control.
--
-- COMPORTAMIENTO ESPERADO
--   · Con una orden de pago no anulada, las partidas no se editan ni se agregan; pagada la orden, tampoco
--     (COMPRAS_CONTRASENA_CERRADA). Una partida no sale de una contraseña pagada hacia otra.
--   · Lo legítimo: antes de la orden, o anulada la orden, las partidas se editan y el total se recalcula;
--     el pago aplica a las facturas EXACTAMENTE lo que valida y lo que contabiliza.
--
-- Prefijo de ids de este grupo: fa2HHKKK-… (HH = hallazgo, KKK = clase).
-- ============================================================================
\set C   '''cccccccc-cccc-cccc-cccc-cccccccccccc'''
\set C1  '''c1c1c1c1-0000-0000-0000-000000000001'''
\set UA  '''c0c0c0c0-0000-0000-0000-00000000000a'''
\set UC  '''c0c0c0c0-0000-0000-0000-00000000000c'''
\set UQ  '''c0c0c0c0-0000-0000-0000-00000000001a'''
\set US  '''c0c0c0c0-0000-0000-0000-00000000001b'''
\set P1  '''e3000000-0000-0000-0000-000000000001'''

CREATE OR REPLACE FUNCTION public.fa2_factura(p_oc uuid, p_linea uuid, p_rec uuid, p_fac uuid, p_num text,
                                              p_monto numeric, p_prov uuid DEFAULT 'e3000000-0000-0000-0000-000000000001')
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM public.ce_oc(p_oc, p_linea, p_prov, 'servicio', 1, p_monto, 0);
  PERFORM public.ce_recepcion(p_rec, p_oc, p_linea, 1, 'servicio');
  UPDATE public.recepciones SET estado = 'registrada' WHERE id = p_rec;
  PERFORM public.ce_factura(p_fac, p_oc, p_linea, p_prov, p_num, 1, p_monto, 0);
  UPDATE public.facturas_proveedor SET estado = 'aprobada' WHERE id = p_fac;
END;
$$;

-- ── Preparación: facturas F1, F2, F3 (1 000) y contraseñas con partida de 100 ──────────────────────
SELECT public.como(:UA::uuid);
SET ROLE authenticated;
SELECT public.fa2_factura('fa203100-0000-0000-0000-000000000101', 'fa203110-0000-0000-0000-000000000101', 'fa203200-0000-0000-0000-000000000101',
                          'fa203300-0000-0000-0000-000000000101', 'FA2-C03S-1', 1000);
SELECT public.fa2_factura('fa203100-0000-0000-0000-000000000102', 'fa203110-0000-0000-0000-000000000102', 'fa203200-0000-0000-0000-000000000102',
                          'fa203300-0000-0000-0000-000000000102', 'FA2-C03S-2', 1000);
SELECT public.fa2_factura('fa203100-0000-0000-0000-000000000103', 'fa203110-0000-0000-0000-000000000103', 'fa203200-0000-0000-0000-000000000103',
                          'fa203300-0000-0000-0000-000000000103', 'FA2-C03S-3', 1000);
INSERT INTO public.contrasenas_pago (id, company_id, project_id, proveedor_id, fecha_pago_programada) VALUES
  ('fa203500-0000-0000-0000-000000000101', :C::uuid, :C1::uuid, :P1::uuid, CURRENT_DATE),
  ('fa203500-0000-0000-0000-000000000102', :C::uuid, :C1::uuid, :P1::uuid, CURRENT_DATE),
  ('fa203500-0000-0000-0000-000000000103', :C::uuid, :C1::uuid, :P1::uuid, CURRENT_DATE);
INSERT INTO public.contrasena_pago_facturas (company_id, contrasena_id, factura_id, monto) VALUES
  (:C::uuid, 'fa203500-0000-0000-0000-000000000101', 'fa203300-0000-0000-0000-000000000101', 100),
  (:C::uuid, 'fa203500-0000-0000-0000-000000000102', 'fa203300-0000-0000-0000-000000000102', 100),
  (:C::uuid, 'fa203500-0000-0000-0000-000000000103', 'fa203300-0000-0000-0000-000000000103', 100);
-- Antes de la orden la partida se edita con libertad y el total se recalcula (camino legítimo).
UPDATE public.contrasena_pago_facturas SET monto = 120 WHERE contrasena_id = 'fa203500-0000-0000-0000-000000000101';
UPDATE public.contrasena_pago_facturas SET monto = 100 WHERE contrasena_id = 'fa203500-0000-0000-0000-000000000101';
RESET ROLE;
SELECT public.chk_num((SELECT total FROM public.contrasenas_pago WHERE id = 'fa203500-0000-0000-0000-000000000101'), 100,
  '[CONC-03a] antes de la orden, la partida se edita y el total sigue a las partidas (100)');

-- ═══ (a) Con la orden APROBADA (aún sin pagar) la partida ya no se edita ni se amplía ═══
SELECT public.como(:UA::uuid);
SET ROLE authenticated;
INSERT INTO public.ordenes_pago (id, company_id, project_id, proveedor_id, contrasena_pago_id, monto) VALUES
  ('fa203400-0000-0000-0000-000000000101', :C::uuid, :C1::uuid, :P1::uuid, 'fa203500-0000-0000-0000-000000000101', 100),
  ('fa203400-0000-0000-0000-000000000102', :C::uuid, :C1::uuid, :P1::uuid, 'fa203500-0000-0000-0000-000000000102', 100);
UPDATE public.ordenes_pago SET estado = 'aprobada' WHERE id IN ('fa203400-0000-0000-0000-000000000101', 'fa203400-0000-0000-0000-000000000102');
SELECT public.chk_falla($$ UPDATE public.contrasena_pago_facturas SET monto = 900 WHERE contrasena_id = 'fa203500-0000-0000-0000-000000000101' $$,
  'COMPRAS_CONTRASENA_(CON_ORDEN|CERRADA)', '[CONC-03a] con la orden aprobada, la partida no sube de 100 a 900');
SELECT public.chk_falla($$ INSERT INTO public.contrasena_pago_facturas (company_id, contrasena_id, factura_id, monto)
                           VALUES ('cccccccc-cccc-cccc-cccc-cccccccccccc', 'fa203500-0000-0000-0000-000000000101', 'fa203300-0000-0000-0000-000000000103', 500) $$,
  'COMPRAS_CONTRASENA_(CON_ORDEN|CERRADA)', '[CONC-03a] ni se le agrega una partida sobre otra factura');
RESET ROLE;
SELECT public.chk_num((SELECT total FROM public.contrasenas_pago WHERE id = 'fa203500-0000-0000-0000-000000000101'), 100,
  '[CONC-03a] el total de la contraseña sigue en 100');

-- ═══ (b) Se paga: lo aplicado a la factura = lo validado = el asiento (100) ═══
SELECT public.como(:US::uuid);
SET ROLE authenticated;
UPDATE public.ordenes_pago SET estado = 'pagada', fecha_pago = CURRENT_DATE WHERE id = 'fa203400-0000-0000-0000-000000000101';
RESET ROLE;
SELECT public.chk_txt((SELECT estado || '/' || monto_pagado FROM public.facturas_proveedor WHERE id = 'fa203300-0000-0000-0000-000000000101'),
  'pagada_parcial/100.00', '[CONC-03b] la factura queda con 100 pagados');
SELECT public.chk_num((SELECT sum(l.debe) FROM public.conta_asientos a JOIN public.conta_asiento_lineas l ON l.asiento_id = a.id
                        WHERE a.origen_tabla = 'ordenes_pago' AND a.origen_evento = 'orden_pago_pagada' AND a.origen_id = 'fa203400-0000-0000-0000-000000000101'), 100,
  '[CONC-03b] y el asiento del pago es por 100: coincide con la factura');

-- ═══ (c) Pagada la contraseña, sus partidas no cambian ni salen hacia otra contraseña ═══
SELECT public.como(:UA::uuid);
SET ROLE authenticated;
SELECT public.chk_falla($$ UPDATE public.contrasena_pago_facturas SET monto = 900 WHERE contrasena_id = 'fa203500-0000-0000-0000-000000000101' $$,
  'COMPRAS_CONTRASENA_CERRADA', '[CONC-03c] pagada la contraseña, la partida no se edita');
SELECT public.chk_falla($$ UPDATE public.contrasena_pago_facturas SET contrasena_id = 'fa203500-0000-0000-0000-000000000103'
                           WHERE contrasena_id = 'fa203500-0000-0000-0000-000000000101' $$,
  'COMPRAS_CONTRASENA_CERRADA', '[CONC-03c] ni sale hacia otra contraseña emitida (antes: solo se miraba el estado del DESTINO)');
RESET ROLE;
SELECT public.chk_num((SELECT count(*) FROM public.contrasena_pago_facturas WHERE contrasena_id = 'fa203500-0000-0000-0000-000000000101'), 1,
  '[CONC-03c] la partida sigue en la contraseña pagada');
SELECT public.chk_num((SELECT total FROM public.contrasenas_pago WHERE id = 'fa203500-0000-0000-0000-000000000103'), 100,
  '[CONC-03c] y la contraseña destino no ganó una partida ajena (100)');

-- ═══ (d) Anulada la orden, las partidas vuelven a ser editables y se paga lo NUEVO, una vez ═══
SELECT public.como(:US::uuid);
SET ROLE authenticated;
UPDATE public.ordenes_pago SET estado = 'anulada' WHERE id = 'fa203400-0000-0000-0000-000000000102';
RESET ROLE;
SELECT public.como(:UC::uuid);
SET ROLE authenticated;
UPDATE public.contrasena_pago_facturas SET monto = 250 WHERE contrasena_id = 'fa203500-0000-0000-0000-000000000102';
INSERT INTO public.ordenes_pago (id, company_id, project_id, proveedor_id, contrasena_pago_id, monto)
VALUES ('fa203400-0000-0000-0000-000000000112', :C::uuid, :C1::uuid, :P1::uuid, 'fa203500-0000-0000-0000-000000000102', 250);
RESET ROLE;
SELECT public.como(:UQ::uuid);
SET ROLE authenticated;
UPDATE public.ordenes_pago SET estado = 'aprobada' WHERE id = 'fa203400-0000-0000-0000-000000000112';
RESET ROLE;
SELECT public.como(:US::uuid);
SET ROLE authenticated;
UPDATE public.ordenes_pago SET estado = 'pagada', fecha_pago = CURRENT_DATE WHERE id = 'fa203400-0000-0000-0000-000000000112';
RESET ROLE;
SELECT public.chk_txt((SELECT estado || '/' || monto_pagado FROM public.facturas_proveedor WHERE id = 'fa203300-0000-0000-0000-000000000102'),
  'pagada_parcial/250.00', '[CONC-03d] anulada la orden y corregida la partida (250), se paga lo nuevo');
SELECT public.chk_num((SELECT sum(l.debe) FROM public.conta_asientos a JOIN public.conta_asiento_lineas l ON l.asiento_id = a.id
                        WHERE a.origen_tabla = 'ordenes_pago' AND a.origen_evento = 'orden_pago_pagada' AND a.origen_id = 'fa203400-0000-0000-0000-000000000112'), 250,
  '[CONC-03d] y el asiento es por 250');
