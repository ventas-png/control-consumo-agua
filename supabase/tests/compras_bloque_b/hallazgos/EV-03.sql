\set ON_ERROR_STOP on
-- ============================================================================
-- EV-03 · Los estados de factura, recepción y contraseña NO retroceden: lo que tuvo
--         efecto contable solo avanza o se ANULA (con permiso y reversión).
--
-- CAUSA RAÍZ
--   Los triggers de 20261027000300 solo controlan los DESTINOS «aprobada», «anulada»,
--   «registrada» y «pagada*»; ninguno mira el ORIGEN. Con solo 'edit' (o siendo administrador):
--     · factura   aprobada → registrada  (y pagada/pagada_parcial → aprobada | registrada)
--     · recepción registrada → borrador  (y luego otra vez → registrada: doble recibido)
--     · contraseña pagada → emitida      (sin reversar el pago)
--   El retroceso no revierte nada (ni el devengo, ni lo facturado/recibido acumulado en la orden,
--   ni el asiento GR/IR, ni el pago): el documento queda en un estado que NO corresponde a sus
--   efectos. Con él se evade el no-borrado de 20261027000200 (decide por columnas anulables), la
--   inmutabilidad de la factura aprobada y se duplica lo recibido.
--
-- COMPORTAMIENTO ESPERADO (máquina de estados en el SERVIDOR, para sesiones de usuario)
--   factura     registrada → aprobada | anulada ;  aprobada → anulada
--               (pagada_parcial / pagada y su regreso a aprobada: SOLO el sistema, al pagar o anular un pago)
--   recepción   borrador → registrada | anulada ;  registrada → anulada ;  anulada terminal
--   contraseña  emitida → anulada  (pagada y su regreso a emitida: SOLO el sistema)
--   Cualquier otro cambio de estado se rechaza, incluso al administrador. Los cambios que hacen los
--   triggers de sistema (conta.allow_system_write = 'on') o un proceso sin sesión de usuario pasan.
--
-- Prefijo de ids de este grupo: fa3HHKKK-… (HH = hallazgo, KKK = clase: 100 orden, 110 renglón,
-- 200 recepción, 300 factura, 400 orden de pago, 500 contraseña).
-- ============================================================================
\set C   '''cccccccc-cccc-cccc-cccc-cccccccccccc'''
\set C1  '''c1c1c1c1-0000-0000-0000-000000000001'''
\set C2  '''c2c2c2c2-0000-0000-0000-000000000001'''
\set UA  '''c0c0c0c0-0000-0000-0000-00000000000a'''
\set UC  '''c0c0c0c0-0000-0000-0000-00000000000c'''
\set UQ  '''c0c0c0c0-0000-0000-0000-00000000001a'''
\set US  '''c0c0c0c0-0000-0000-0000-00000000001b'''
\set P1  '''e3000000-0000-0000-0000-000000000001'''

-- Ayuda del grupo (idéntica en los tres archivos): factura APROBADA de `p_monto` con su recepción registrada.
-- Corre con la sesión que la llama (administrador).
CREATE OR REPLACE FUNCTION public.fa3_factura_aprobada(p_oc uuid, p_linea uuid, p_rec uuid, p_fac uuid, p_num text,
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

-- ═══ Preparación con los actores REALES del circuito ═══════════════════════════
--   UA (admin) crea la orden y la factura · US (cambiar estado) registra la recepción ·
--   UQ (autorizar) aprueba la factura.  Orden de 10 × 100 = 1 000 (servicio).
SELECT public.como(:UA::uuid);
SET ROLE authenticated;
SELECT public.ce_oc('fa303100-0000-0000-0000-000000000001', 'fa303110-0000-0000-0000-000000000001', :P1::uuid, 'servicio', 10, 100, 0);
SELECT public.ce_recepcion('fa303200-0000-0000-0000-000000000001', 'fa303100-0000-0000-0000-000000000001', 'fa303110-0000-0000-0000-000000000001', 10, 'servicio');
SELECT public.como(:US::uuid);
UPDATE public.recepciones SET estado = 'registrada' WHERE id = 'fa303200-0000-0000-0000-000000000001';
SELECT public.como(:UA::uuid);
SELECT public.ce_factura('fa303300-0000-0000-0000-000000000001', 'fa303100-0000-0000-0000-000000000001', 'fa303110-0000-0000-0000-000000000001', :P1::uuid, 'FA3-EV03-1', 10, 100, 0);
SELECT public.como(:UQ::uuid);
UPDATE public.facturas_proveedor SET estado = 'aprobada' WHERE id = 'fa303300-0000-0000-0000-000000000001';
RESET ROLE;
SELECT public.chk_txt((SELECT estado FROM public.facturas_proveedor WHERE id = 'fa303300-0000-0000-0000-000000000001'), 'aprobada',
  '[EV-03a] preparación: la factura está aprobada');
SELECT public.chk_num((SELECT cantidad_recibida FROM public.orden_compra_lineas WHERE id = 'fa303110-0000-0000-0000-000000000001'), 10,
  '[EV-03a] preparación: lo recibido de la línea es 10');
SELECT public.chk_num((SELECT cantidad_facturada FROM public.orden_compra_lineas WHERE id = 'fa303110-0000-0000-0000-000000000001'), 10,
  '[EV-03a] preparación: lo facturado de la línea es 10');
SELECT public.chk((SELECT count(*) FROM public.conta_asientos WHERE origen_id IN ('fa303300-0000-0000-0000-000000000001', 'fa303200-0000-0000-0000-000000000001') AND estado = 'publicado'), 2,
  '[EV-03a] preparación: el asiento de la recepción y el de la factura están publicados');

-- ═══ (a) FACTURA aprobada → registrada: nadie, ni el administrador ═══════════════
SELECT public.como(:UC::uuid);
SET ROLE authenticated;
SELECT public.chk_falla($$ UPDATE public.facturas_proveedor SET estado = 'registrada' WHERE id = 'fa303300-0000-0000-0000-000000000001' $$,
  'COMPRAS_FACTURA_TRANSICION', '[EV-03a] quien solo EDITA no devuelve a «registrada» una factura aprobada');
SELECT public.chk_falla($$ UPDATE public.facturas_proveedor SET estado = 'registrada', aprobada_at = NULL, aprobada_por = NULL WHERE id = 'fa303300-0000-0000-0000-000000000001' $$,
  'COMPRAS_FACTURA_TRANSICION|COMPRAS_SELLO_FIJO', '[EV-03a] ni limpiando a la vez los sellos de aprobación (la cadena del revisor)');
SELECT public.como(:UQ::uuid);
SELECT public.chk_falla($$ UPDATE public.facturas_proveedor SET estado = 'registrada' WHERE id = 'fa303300-0000-0000-0000-000000000001' $$,
  'COMPRAS_FACTURA_TRANSICION', '[EV-03a] quien AUTORIZA tampoco: autorizar es aprobar, no deshacer la aprobación');
SELECT public.como(:US::uuid);
SELECT public.chk_falla($$ UPDATE public.facturas_proveedor SET estado = 'registrada' WHERE id = 'fa303300-0000-0000-0000-000000000001' $$,
  'COMPRAS_FACTURA_TRANSICION', '[EV-03a] quien CAMBIA ESTADO tampoco: lo suyo es anular, con reversión');
SELECT public.como(:UA::uuid);
SELECT public.chk_falla($$ UPDATE public.facturas_proveedor SET estado = 'registrada' WHERE id = 'fa303300-0000-0000-0000-000000000001' $$,
  'COMPRAS_FACTURA_TRANSICION', '[EV-03a] ni el ADMINISTRADOR de la empresa');
RESET ROLE;
SELECT public.chk_txt((SELECT estado FROM public.facturas_proveedor WHERE id = 'fa303300-0000-0000-0000-000000000001'), 'aprobada',
  '[EV-03a] la factura sigue aprobada');
SELECT public.chk_uuid((SELECT aprobada_por FROM public.facturas_proveedor WHERE id = 'fa303300-0000-0000-0000-000000000001'), :UQ::uuid,
  '[EV-03a] y con su aprobador (UQ) intacto');
SELECT public.chk_num((SELECT cantidad_facturada FROM public.orden_compra_lineas WHERE id = 'fa303110-0000-0000-0000-000000000001'), 10,
  '[EV-03a] y lo facturado de la línea sigue en 10');

-- ═══ (b) La cadena de reescritura (B de la revisión): sin retroceso no hay reescritura ═══
SELECT public.como(:UA::uuid);
SET ROLE authenticated;
SELECT public.chk_falla($$ UPDATE public.facturas_proveedor SET monto_total = 1 WHERE id = 'fa303300-0000-0000-0000-000000000001' $$,
  'CXP_INMUTABLE', '[EV-03b] el monto de la aprobada sigue protegido (control vigente)');
SELECT public.chk_falla($$ UPDATE public.factura_proveedor_lineas SET precio_unitario = 1 WHERE factura_id = 'fa303300-0000-0000-0000-000000000001' $$,
  'COMPRAS_FACTURA_INMUTABLE', '[EV-03b] y sus renglones siguen congelados (control vigente)');
RESET ROLE;
SELECT public.chk_num((SELECT monto_total FROM public.facturas_proveedor WHERE id = 'fa303300-0000-0000-0000-000000000001'), 1000,
  '[EV-03b] la factura sigue valiendo 1 000, igual que su asiento publicado');
SELECT public.chk_num((SELECT total_debe FROM public.conta_asientos WHERE origen_id = 'fa303300-0000-0000-0000-000000000001' AND origen_evento = 'factura_prov_aprobada' AND estado = 'publicado'), 1000,
  '[EV-03b] el asiento de la factura sigue en 1 000');

-- ═══ (c) FACTURA con pagos: pagada_parcial / pagada → aprobada | registrada solo lo hace el sistema ═══
SELECT public.como(:UA::uuid);
SET ROLE authenticated;
SELECT public.fa3_factura_aprobada('fa303100-0000-0000-0000-000000000002', 'fa303110-0000-0000-0000-000000000002', 'fa303200-0000-0000-0000-000000000002',
                                   'fa303300-0000-0000-0000-000000000002', 'FA3-EV03-2', 600);
INSERT INTO public.ordenes_pago (id, company_id, project_id, proveedor_id, factura_id, monto)
VALUES ('fa303400-0000-0000-0000-000000000002', :C::uuid, :C1::uuid, :P1::uuid, 'fa303300-0000-0000-0000-000000000002', 250);
SELECT public.como(:UQ::uuid);
UPDATE public.ordenes_pago SET estado = 'aprobada' WHERE id = 'fa303400-0000-0000-0000-000000000002';
SELECT public.como(:US::uuid);
UPDATE public.ordenes_pago SET estado = 'pagada', fecha_pago = CURRENT_DATE WHERE id = 'fa303400-0000-0000-0000-000000000002';
RESET ROLE;
SELECT public.chk_txt((SELECT estado FROM public.facturas_proveedor WHERE id = 'fa303300-0000-0000-0000-000000000002'), 'pagada_parcial',
  '[EV-03c] preparación: pagar 250 de 600 deja la factura «pagada parcial» (la escribe el trigger de pago)');
SELECT public.como(:UA::uuid);
SET ROLE authenticated;
SELECT public.chk_falla($$ UPDATE public.facturas_proveedor SET estado = 'aprobada' WHERE id = 'fa303300-0000-0000-0000-000000000002' $$,
  'COMPRAS_FACTURA_TRANSICION', '[EV-03c] el administrador no devuelve a «aprobada» una factura con un pago aplicado');
SELECT public.chk_falla($$ UPDATE public.facturas_proveedor SET estado = 'registrada' WHERE id = 'fa303300-0000-0000-0000-000000000002' $$,
  'COMPRAS_FACTURA_TRANSICION', '[EV-03c] ni a «registrada»');
SELECT public.como(:UC::uuid);
SELECT public.chk_falla($$ UPDATE public.facturas_proveedor SET estado = 'aprobada', monto_pagado = 0 WHERE id = 'fa303300-0000-0000-0000-000000000002' $$,
  'COMPRAS_ESTADO_SOLO_SISTEMA|COMPRAS_FACTURA_TRANSICION', '[EV-03c] ni borrando a mano lo pagado');
RESET ROLE;
SELECT public.chk_num((SELECT monto_pagado FROM public.facturas_proveedor WHERE id = 'fa303300-0000-0000-0000-000000000002'), 250,
  '[EV-03c] lo pagado sigue en 250');
-- Flujo legítimo: ANULAR EL PAGO (US, cambiar estado) lo devuelve a «aprobada» por el trigger de sistema.
SELECT public.como(:US::uuid);
SET ROLE authenticated;
UPDATE public.ordenes_pago SET estado = 'anulada', notas = 'pago equivocado' WHERE id = 'fa303400-0000-0000-0000-000000000002';
RESET ROLE;
SELECT public.chk_txt((SELECT estado FROM public.facturas_proveedor WHERE id = 'fa303300-0000-0000-0000-000000000002'), 'aprobada',
  '[EV-03c] LEGÍTIMO: anular el pago devuelve la factura a «aprobada» (retroceso hecho por el trigger de sistema, que pasa)');
SELECT public.chk_num((SELECT monto_pagado FROM public.facturas_proveedor WHERE id = 'fa303300-0000-0000-0000-000000000002'), 0,
  '[EV-03c] LEGÍTIMO: y su monto pagado vuelve a 0');
-- Pago total (el anterior se anuló: el saldo vuelve a 600) → «pagada»; la factura pagada no se anula a mano ni retrocede.
SELECT public.como(:UA::uuid);
SET ROLE authenticated;
INSERT INTO public.ordenes_pago (id, company_id, project_id, proveedor_id, factura_id, monto)
VALUES ('fa303400-0000-0000-0000-000000000003', :C::uuid, :C1::uuid, :P1::uuid, 'fa303300-0000-0000-0000-000000000002', 600);   -- el pago anulado ya no reserva saldo
SELECT public.como(:UQ::uuid);
UPDATE public.ordenes_pago SET estado = 'aprobada' WHERE id = 'fa303400-0000-0000-0000-000000000003';
SELECT public.como(:US::uuid);
UPDATE public.ordenes_pago SET estado = 'pagada', fecha_pago = CURRENT_DATE WHERE id = 'fa303400-0000-0000-0000-000000000003';
RESET ROLE;
SELECT public.chk_txt((SELECT estado FROM public.facturas_proveedor WHERE id = 'fa303300-0000-0000-0000-000000000002'), 'pagada',
  '[EV-03c] preparación: pagar los 600 la deja «pagada»');
SELECT public.como(:UA::uuid);
SET ROLE authenticated;
SELECT public.chk_falla($$ UPDATE public.facturas_proveedor SET estado = 'aprobada' WHERE id = 'fa303300-0000-0000-0000-000000000002' $$,
  'COMPRAS_FACTURA_TRANSICION', '[EV-03c] una factura pagada no vuelve a «aprobada» a mano (ni el administrador)');
SELECT public.chk_falla($$ UPDATE public.facturas_proveedor SET estado = 'registrada' WHERE id = 'fa303300-0000-0000-0000-000000000002' $$,
  'COMPRAS_FACTURA_TRANSICION', '[EV-03c] ni a «registrada»');
SELECT public.chk_falla($$ UPDATE public.facturas_proveedor SET estado = 'anulada' WHERE id = 'fa303300-0000-0000-0000-000000000002' $$,
  'CXP_BLOQUEADO|COMPRAS_FACTURA_TRANSICION', '[EV-03c] ni se anula con el pago vivo (control vigente: se anula primero la orden de pago)');
RESET ROLE;

-- ═══ (d) FACTURA · lo legítimo sigue funcionando ═════════════════════════════════
--   registrada → aprobada (UQ) · registrada → anulada (UA) · aprobada → anulada (US) con reversión
SELECT public.como(:UA::uuid);
SET ROLE authenticated;
SELECT public.ce_oc('fa303100-0000-0000-0000-000000000005', 'fa303110-0000-0000-0000-000000000005', :P1::uuid, 'servicio', 4, 100, 0);
SELECT public.ce_recepcion('fa303200-0000-0000-0000-000000000005', 'fa303100-0000-0000-0000-000000000005', 'fa303110-0000-0000-0000-000000000005', 4, 'servicio');
UPDATE public.recepciones SET estado = 'registrada' WHERE id = 'fa303200-0000-0000-0000-000000000005';
SELECT public.ce_factura('fa303300-0000-0000-0000-000000000005', 'fa303100-0000-0000-0000-000000000005', 'fa303110-0000-0000-0000-000000000005', :P1::uuid, 'FA3-EV03-5', 4, 100, 0);
SELECT public.ce_factura('fa303300-0000-0000-0000-000000000006', 'fa303100-0000-0000-0000-000000000005', 'fa303110-0000-0000-0000-000000000005', :P1::uuid, 'FA3-EV03-6', 1, 100, 0);
-- una registrada se anula (nunca se aprobó)
UPDATE public.facturas_proveedor SET estado = 'anulada' WHERE id = 'fa303300-0000-0000-0000-000000000006';
SELECT public.como(:UQ::uuid);
UPDATE public.facturas_proveedor SET estado = 'aprobada' WHERE id = 'fa303300-0000-0000-0000-000000000005';
RESET ROLE;
SELECT public.chk_txt((SELECT estado FROM public.facturas_proveedor WHERE id = 'fa303300-0000-0000-0000-000000000005'), 'aprobada',
  '[EV-03d] LEGÍTIMO: registrada → aprobada (quien autoriza)');
SELECT public.chk_txt((SELECT estado FROM public.facturas_proveedor WHERE id = 'fa303300-0000-0000-0000-000000000006'), 'anulada',
  '[EV-03d] LEGÍTIMO: registrada → anulada');
SELECT public.chk_num((SELECT cantidad_facturada FROM public.orden_compra_lineas WHERE id = 'fa303110-0000-0000-0000-000000000005'), 4,
  '[EV-03d] preparación: la aprobada acumuló 4 facturadas');
SELECT public.como(:US::uuid);
SET ROLE authenticated;
UPDATE public.facturas_proveedor SET estado = 'anulada' WHERE id = 'fa303300-0000-0000-0000-000000000005';
RESET ROLE;
SELECT public.chk_txt((SELECT estado FROM public.facturas_proveedor WHERE id = 'fa303300-0000-0000-0000-000000000005'), 'anulada',
  '[EV-03d] LEGÍTIMO: aprobada → anulada (quien cambia estado)');
SELECT public.chk_num((SELECT cantidad_facturada FROM public.orden_compra_lineas WHERE id = 'fa303110-0000-0000-0000-000000000005'), 0,
  '[EV-03d] LEGÍTIMO: la anulación revierte lo facturado de la orden');
SELECT public.chk((SELECT count(*) FROM public.conta_asientos WHERE origen_id = 'fa303300-0000-0000-0000-000000000005' AND origen_evento = 'factura_prov_aprobada_revertido'), 1,
  '[EV-03d] LEGÍTIMO: y deja el asiento de reverso');
SELECT public.como(:UA::uuid);
SET ROLE authenticated;
SELECT public.chk_falla($$ UPDATE public.facturas_proveedor SET estado = 'registrada' WHERE id = 'fa303300-0000-0000-0000-000000000005' $$,
  'COMPRAS_FACTURA_TRANSICION|CXP_INMUTABLE', '[EV-03d] una factura anulada es terminal: no vuelve a «registrada»');
SELECT public.chk_falla($$ UPDATE public.facturas_proveedor SET estado = 'aprobada' WHERE id = 'fa303300-0000-0000-0000-000000000005' $$,
  'COMPRAS_FACTURA_TRANSICION|CXP_INMUTABLE', '[EV-03d] ni a «aprobada» (se reaprobaría sin devengo ni acumulado)');
RESET ROLE;

-- ═══ (e) RECEPCIÓN registrada → borrador: nadie, ni el administrador; no se duplica lo recibido ═══
--   Orden de servicio 10 × 100; se confirman 4.
SELECT public.como(:UA::uuid);
SET ROLE authenticated;
SELECT public.ce_oc('fa303100-0000-0000-0000-000000000007', 'fa303110-0000-0000-0000-000000000007', :P1::uuid, 'servicio', 10, 100, 0);
SELECT public.ce_recepcion('fa303200-0000-0000-0000-000000000007', 'fa303100-0000-0000-0000-000000000007', 'fa303110-0000-0000-0000-000000000007', 4, 'servicio');
SELECT public.como(:US::uuid);
UPDATE public.recepciones SET estado = 'registrada' WHERE id = 'fa303200-0000-0000-0000-000000000007';
RESET ROLE;
SELECT public.chk_num((SELECT cantidad_recibida FROM public.orden_compra_lineas WHERE id = 'fa303110-0000-0000-0000-000000000007'), 4,
  '[EV-03e] preparación: lo recibido de la línea es 4');
SELECT public.como(:UC::uuid);
SET ROLE authenticated;
SELECT public.chk_falla($$ UPDATE public.recepciones SET estado = 'borrador', registrada_at = NULL WHERE id = 'fa303200-0000-0000-0000-000000000007' $$,
  'COMPRAS_RECEPCION_TRANSICION|COMPRAS_SELLO_FIJO', '[EV-03e] quien solo EDITA no devuelve a borrador una recepción registrada (la cadena del revisor)');
SELECT public.chk_falla($$ UPDATE public.recepciones SET estado = 'borrador' WHERE id = 'fa303200-0000-0000-0000-000000000007' $$,
  'COMPRAS_RECEPCION_TRANSICION', '[EV-03e] ni sin tocar el sello');
SELECT public.como(:US::uuid);
SELECT public.chk_falla($$ UPDATE public.recepciones SET estado = 'borrador' WHERE id = 'fa303200-0000-0000-0000-000000000007' $$,
  'COMPRAS_RECEPCION_TRANSICION', '[EV-03e] quien cambia estado tampoco: lo suyo es anular, con reversión');
SELECT public.como(:UA::uuid);
SELECT public.chk_falla($$ UPDATE public.recepciones SET estado = 'borrador' WHERE id = 'fa303200-0000-0000-0000-000000000007' $$,
  'COMPRAS_RECEPCION_TRANSICION', '[EV-03e] ni el ADMINISTRADOR');
-- Registrar otra vez lo ya registrado no suma nada (reintento idempotente, control vigente).
SELECT public.como(:US::uuid);
UPDATE public.recepciones SET estado = 'registrada' WHERE id = 'fa303200-0000-0000-0000-000000000007';
RESET ROLE;
SELECT public.chk_txt((SELECT estado FROM public.recepciones WHERE id = 'fa303200-0000-0000-0000-000000000007'), 'registrada',
  '[EV-03e] la recepción sigue registrada');
SELECT public.chk_num((SELECT cantidad_recibida FROM public.orden_compra_lineas WHERE id = 'fa303110-0000-0000-0000-000000000007'), 4,
  '[EV-03e] y lo recibido sigue en 4 (no 8): una sola recepción física, una sola vez');
SELECT public.chk((SELECT count(*) FROM public.conta_asientos WHERE origen_id = 'fa303200-0000-0000-0000-000000000007' AND estado = 'publicado'), 1,
  '[EV-03e] y UN solo asiento de recepción');

-- ═══ (f) RECEPCIÓN · lo legítimo sigue funcionando ══════════════════════════════
--   borrador → registrada (US) · registrada → anulada (US, revierte) · borrador → anulada · anulada terminal
SELECT public.como(:US::uuid);
SET ROLE authenticated;
UPDATE public.recepciones SET estado = 'anulada', motivo_anulacion = 'entrega mal capturada' WHERE id = 'fa303200-0000-0000-0000-000000000007';
RESET ROLE;
SELECT public.chk_txt((SELECT estado FROM public.recepciones WHERE id = 'fa303200-0000-0000-0000-000000000007'), 'anulada',
  '[EV-03f] LEGÍTIMO: registrada → anulada (quien cambia estado)');
SELECT public.chk_num((SELECT cantidad_recibida FROM public.orden_compra_lineas WHERE id = 'fa303110-0000-0000-0000-000000000007'), 0,
  '[EV-03f] LEGÍTIMO: la anulación revierte lo recibido de la orden');
SELECT public.como(:UA::uuid);
SET ROLE authenticated;
SELECT public.chk_falla($$ UPDATE public.recepciones SET estado = 'borrador' WHERE id = 'fa303200-0000-0000-0000-000000000007' $$,
  'COMPRAS_RECEPCION_INMUTABLE|COMPRAS_RECEPCION_TRANSICION', '[EV-03f] una recepción anulada es terminal: no vuelve a borrador');
SELECT public.chk_falla($$ UPDATE public.recepciones SET estado = 'registrada' WHERE id = 'fa303200-0000-0000-0000-000000000007' $$,
  'COMPRAS_RECEPCION_INMUTABLE|COMPRAS_RECEPCION_TRANSICION', '[EV-03f] ni a registrada');
-- Un borrador se anula sin pasar por registrada.
SELECT public.ce_recepcion('fa303200-0000-0000-0000-000000000008', 'fa303100-0000-0000-0000-000000000007', 'fa303110-0000-0000-0000-000000000007', 2, 'servicio');
SELECT public.como(:US::uuid);
UPDATE public.recepciones SET estado = 'anulada', motivo_anulacion = 'captura duplicada' WHERE id = 'fa303200-0000-0000-0000-000000000008';
RESET ROLE;
SELECT public.chk_txt((SELECT estado FROM public.recepciones WHERE id = 'fa303200-0000-0000-0000-000000000008'), 'anulada',
  '[EV-03f] LEGÍTIMO: borrador → anulada');
-- Registrar sigue siendo borrador → registrada con su permiso (4b de la suite).
SELECT public.como(:UA::uuid);
SET ROLE authenticated;
SELECT public.ce_recepcion('fa303200-0000-0000-0000-000000000009', 'fa303100-0000-0000-0000-000000000007', 'fa303110-0000-0000-0000-000000000007', 3, 'servicio');
SELECT public.como(:US::uuid);
UPDATE public.recepciones SET estado = 'registrada' WHERE id = 'fa303200-0000-0000-0000-000000000009';
RESET ROLE;
SELECT public.chk_num((SELECT cantidad_recibida FROM public.orden_compra_lineas WHERE id = 'fa303110-0000-0000-0000-000000000007'), 3,
  '[EV-03f] LEGÍTIMO: borrador → registrada suma lo recibido (3)');

-- ═══ (g) CONTRASEÑA pagada → emitida: solo el sistema (al anular el pago) ═══════════
SELECT public.como(:UA::uuid);
SET ROLE authenticated;
SELECT public.fa3_factura_aprobada('fa303100-0000-0000-0000-000000000010', 'fa303110-0000-0000-0000-000000000010', 'fa303200-0000-0000-0000-000000000010',
                                   'fa303300-0000-0000-0000-000000000010', 'FA3-EV03-10', 1000);
INSERT INTO public.contrasenas_pago (id, company_id, project_id, proveedor_id, fecha_pago_programada)
VALUES ('fa303500-0000-0000-0000-000000000010', :C::uuid, :C1::uuid, :P1::uuid, CURRENT_DATE);
INSERT INTO public.contrasena_pago_facturas (company_id, contrasena_id, factura_id, monto)
VALUES (:C::uuid, 'fa303500-0000-0000-0000-000000000010', 'fa303300-0000-0000-0000-000000000010', 1000);
INSERT INTO public.ordenes_pago (id, company_id, project_id, proveedor_id, contrasena_pago_id, monto)
VALUES ('fa303400-0000-0000-0000-000000000010', :C::uuid, :C1::uuid, :P1::uuid, 'fa303500-0000-0000-0000-000000000010', 1000);
SELECT public.como(:UQ::uuid);
UPDATE public.ordenes_pago SET estado = 'aprobada' WHERE id = 'fa303400-0000-0000-0000-000000000010';
SELECT public.como(:US::uuid);
UPDATE public.ordenes_pago SET estado = 'pagada', fecha_pago = CURRENT_DATE WHERE id = 'fa303400-0000-0000-0000-000000000010';
RESET ROLE;
SELECT public.chk_txt((SELECT estado FROM public.contrasenas_pago WHERE id = 'fa303500-0000-0000-0000-000000000010'), 'pagada',
  '[EV-03g] preparación: la contraseña quedó «pagada» al pagar su orden');
SELECT public.como(:UC::uuid);
SET ROLE authenticated;
SELECT public.chk_falla($$ UPDATE public.contrasenas_pago SET estado = 'emitida' WHERE id = 'fa303500-0000-0000-0000-000000000010' $$,
  'COMPRAS_CONTRASENA_TRANSICION', '[EV-03g] quien solo EDITA no devuelve a «emitida» una contraseña pagada (el pago seguiría vivo)');
SELECT public.como(:UA::uuid);
SELECT public.chk_falla($$ UPDATE public.contrasenas_pago SET estado = 'emitida' WHERE id = 'fa303500-0000-0000-0000-000000000010' $$,
  'COMPRAS_CONTRASENA_TRANSICION', '[EV-03g] ni el ADMINISTRADOR');
RESET ROLE;
SELECT public.chk_txt((SELECT estado FROM public.contrasenas_pago WHERE id = 'fa303500-0000-0000-0000-000000000010'), 'pagada',
  '[EV-03g] la contraseña sigue «pagada»');
-- Flujo legítimo: anular el pago devuelve la contraseña a «emitida» (y la factura a «aprobada») por el sistema.
SELECT public.como(:US::uuid);
SET ROLE authenticated;
UPDATE public.ordenes_pago SET estado = 'anulada', notas = 'pago rechazado' WHERE id = 'fa303400-0000-0000-0000-000000000010';
RESET ROLE;
SELECT public.chk_txt((SELECT estado FROM public.contrasenas_pago WHERE id = 'fa303500-0000-0000-0000-000000000010'), 'emitida',
  '[EV-03g] LEGÍTIMO: anular el pago devuelve la contraseña a «emitida» (trigger de sistema)');
SELECT public.chk_txt((SELECT estado FROM public.facturas_proveedor WHERE id = 'fa303300-0000-0000-0000-000000000010'), 'aprobada',
  '[EV-03g] LEGÍTIMO: y la factura a «aprobada»');
-- emitida → anulada sigue siendo de quien cambia estado.
SELECT public.como(:US::uuid);
SET ROLE authenticated;
UPDATE public.contrasenas_pago SET estado = 'anulada', motivo_anulacion = 'ya no aplica' WHERE id = 'fa303500-0000-0000-0000-000000000010';
RESET ROLE;
SELECT public.chk_txt((SELECT estado FROM public.contrasenas_pago WHERE id = 'fa303500-0000-0000-0000-000000000010'), 'anulada',
  '[EV-03g] LEGÍTIMO: emitida → anulada (quien cambia estado)');
SELECT public.como(:UA::uuid);
SET ROLE authenticated;
SELECT public.chk_falla($$ UPDATE public.contrasenas_pago SET estado = 'emitida' WHERE id = 'fa303500-0000-0000-0000-000000000010' $$,
  'COMPRAS_CONTRASENA_INMUTABLE|COMPRAS_CONTRASENA_TRANSICION', '[EV-03g] una contraseña anulada es terminal (control vigente)');
RESET ROLE;

-- ═══ (h) Sin sesión de usuario (servicio / mantenimiento) el camino de sistema sigue abierto ═══
--   Comportamiento VIGENTE que esta corrección conserva: la máquina de estados es para personas
--   (auth.uid() NOT NULL y sin conta.allow_system_write). Se prueba dentro de una transacción que se revierte.
BEGIN;
SELECT set_config('request.jwt.claim.sub', '', false);
UPDATE public.recepciones SET estado = 'borrador' WHERE id = 'fa303200-0000-0000-0000-000000000009';
SELECT public.chk_txt((SELECT estado FROM public.recepciones WHERE id = 'fa303200-0000-0000-0000-000000000009'), 'borrador',
  '[EV-03h] un proceso sin sesión de usuario (servicio) conserva el camino de sistema: no pasa por la máquina de estados de personas');
ROLLBACK;
SELECT public.chk_txt((SELECT estado FROM public.recepciones WHERE id = 'fa303200-0000-0000-0000-000000000009'), 'registrada',
  '[EV-03h] (la prueba anterior se revirtió: la recepción sigue registrada)');

-- ═══ (i) ORDEN DE COMPRA: ya tenía su máquina de estados (control vigente, se fija aquí) ═══
SELECT public.como(:UA::uuid);
SET ROLE authenticated;
SELECT public.chk_falla($$ UPDATE public.ordenes_compra SET estado = 'emitida' WHERE id = 'fa303100-0000-0000-0000-000000000001' $$,
  'COMPRAS_OC_TRANSICION_INVALIDA', '[EV-03i] una orden cerrada no vuelve a «emitida» (ni el administrador)');
SELECT public.chk_falla($$ UPDATE public.ordenes_compra SET estado = 'borrador', motivo_devolucion = 'x' WHERE id = 'fa303100-0000-0000-0000-000000000001' $$,
  'COMPRAS_OC_TRANSICION_INVALIDA', '[EV-03i] ni a borrador');
RESET ROLE;
