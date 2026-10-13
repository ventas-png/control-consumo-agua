\set ON_ERROR_STOP on
-- ============================================================================
-- EV-02 · El total de la contraseña lo calcula el SERVIDOR; la orden de pago se ata a
--         las PARTIDAS (suma de partidas = total = monto de la orden), y las partidas no se
--         tocan mientras exista una orden de pago no anulada sobre la contraseña.
--
-- CAUSA RAÍZ
--   contrasenas_pago.total es una columna editable (UPDATE directo, o INSERT con total).
--   compras_tg_orden_contrasena ata la orden a ESE total y no a SUM(partidas); al pagar,
--   cxp_tg_orden_saldo aplica a las facturas las PARTIDAS (1 000) mientras el asiento sale
--   por el monto de la orden (1,00). Además, las partidas se pueden insertar / actualizar /
--   mover con una orden viva (compras_tg_contrasena_factura solo recalcula el destino).
--
-- COMPORTAMIENTO ESPERADO
--   · Ninguna sesión de usuario cambia contrasenas_pago.total (ni lo fija al insertar);
--     el total sale de las partidas (el trigger de partidas lo sigue recalculando).
--   · La orden de una contraseña solo se crea / aprueba / paga si SUM(partidas) = monto =
--     total (COMPRAS_PAGO_PARTIDAS_DISTINTAS), también cuando el dato llega alterado por un
--     camino de sistema.
--   · Con orden viva (borrador, aprobada o pagada) las partidas no se insertan, actualizan
--     ni mueven (COMPRAS_CONTRASENA_CON_ORDEN); anulada la orden vuelven a ser editables.
--   · Lo legítimo sigue: parciales 400 + 600, varias facturas, anular orden / contraseña.
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

-- ── Preparación: facturas aprobadas F1..F3 y F5 de 1 000 y F4 de 700 ────────────────────────
SELECT public.como(:UA::uuid);
SET ROLE authenticated;
SELECT public.fa2_factura('fa212100-0000-0000-0000-000000000001', 'fa212110-0000-0000-0000-000000000001', 'fa212200-0000-0000-0000-000000000001',
                          'fa212300-0000-0000-0000-000000000001', 'FA2-EV02-1', 1000);
SELECT public.fa2_factura('fa212100-0000-0000-0000-000000000002', 'fa212110-0000-0000-0000-000000000002', 'fa212200-0000-0000-0000-000000000002',
                          'fa212300-0000-0000-0000-000000000002', 'FA2-EV02-2', 1000);
SELECT public.fa2_factura('fa212100-0000-0000-0000-000000000003', 'fa212110-0000-0000-0000-000000000003', 'fa212200-0000-0000-0000-000000000003',
                          'fa212300-0000-0000-0000-000000000003', 'FA2-EV02-3', 1000);
SELECT public.fa2_factura('fa212100-0000-0000-0000-000000000004', 'fa212110-0000-0000-0000-000000000004', 'fa212200-0000-0000-0000-000000000004',
                          'fa212300-0000-0000-0000-000000000004', 'FA2-EV02-4', 700);
SELECT public.fa2_factura('fa212100-0000-0000-0000-000000000005', 'fa212110-0000-0000-0000-000000000005', 'fa212200-0000-0000-0000-000000000005',
                          'fa212300-0000-0000-0000-000000000005', 'FA2-EV02-5', 1000);
RESET ROLE;
SELECT public.chk_num((SELECT count(*) FROM public.facturas_proveedor WHERE id::text LIKE 'fa212300-%' AND estado = 'aprobada'), 5,
  '[EV-02a] preparación: cinco facturas aprobadas');

-- ═══ (a) El total NO se edita a mano (el caso exacto del hallazgo) ═══
SELECT public.como(:UC::uuid);
SET ROLE authenticated;
INSERT INTO public.contrasenas_pago (id, company_id, project_id, proveedor_id, fecha_pago_programada)
VALUES ('fa212500-0000-0000-0000-000000000001', :C::uuid, :C1::uuid, :P1::uuid, CURRENT_DATE);
INSERT INTO public.contrasena_pago_facturas (company_id, contrasena_id, factura_id, monto)
VALUES (:C::uuid, 'fa212500-0000-0000-0000-000000000001', 'fa212300-0000-0000-0000-000000000001', 1000);
SELECT public.chk_falla($$ UPDATE public.contrasenas_pago SET total = 1 WHERE id = 'fa212500-0000-0000-0000-000000000001' $$,
  'COMPRAS_CONTRASENA_TOTAL_DERIVADO', '[EV-02a] el total de la contraseña no se edita a mano (antes: UPDATE 1)');
INSERT INTO public.contrasenas_pago (id, company_id, project_id, proveedor_id, fecha_pago_programada, total)
VALUES ('fa212500-0000-0000-0000-00000000000a', :C::uuid, :C1::uuid, :P1::uuid, CURRENT_DATE, 500);
-- Legítimo: reescribir el MISMO valor no cambia nada; y el total sigue saliendo de las partidas.
UPDATE public.contrasenas_pago SET total = 1000, observaciones = 'mismo total' WHERE id = 'fa212500-0000-0000-0000-000000000001';
RESET ROLE;
SELECT public.chk_num((SELECT total FROM public.contrasenas_pago WHERE id = 'fa212500-0000-0000-0000-00000000000a'), 0,
  '[EV-02a] un total capturado al insertar (500) se ignora: la contraseña nace en 0 hasta que tenga partidas');
SELECT public.chk_num((SELECT total FROM public.contrasenas_pago WHERE id = 'fa212500-0000-0000-0000-000000000001'), 1000,
  '[EV-02a] el total de la contraseña sigue siendo el de sus partidas (1 000)');
-- La contraseña con partidas legítimas se crea por la vía normal y su total lo pone el servidor.
SELECT public.chk_num((SELECT count(*) FROM public.contrasenas_pago WHERE id = 'fa212500-0000-0000-0000-000000000001' AND total = 1000), 1,
  '[EV-02a] el total lo derivó el servidor al insertar la partida');

-- ═══ (b) Dato alterado por un camino de sistema: la orden se ata a las PARTIDAS, no al total ═══
SET session_replication_role = replica;   -- simula el UPDATE del hallazgo / un proceso sin los triggers de usuario
UPDATE public.contrasenas_pago SET total = 1 WHERE id = 'fa212500-0000-0000-0000-000000000001';
RESET session_replication_role;
SELECT public.como(:UC::uuid);
SET ROLE authenticated;
SELECT public.chk_falla($$ INSERT INTO public.ordenes_pago (id, company_id, project_id, proveedor_id, contrasena_pago_id, monto)
                           VALUES ('fa212400-0000-0000-0000-000000000001', 'cccccccc-cccc-cccc-cccc-cccccccccccc', 'c1c1c1c1-0000-0000-0000-000000000001',
                                   'e3000000-0000-0000-0000-000000000001', 'fa212500-0000-0000-0000-000000000001', 1) $$,
  'COMPRAS_PAGO_PARTIDAS_DISTINTAS', '[EV-02b] una orden de 1 (= total alterado) sobre partidas por 1 000 se rechaza');
SELECT public.chk_falla($$ INSERT INTO public.ordenes_pago (id, company_id, project_id, proveedor_id, contrasena_pago_id, monto)
                           VALUES ('fa212400-0000-0000-0000-000000000001', 'cccccccc-cccc-cccc-cccc-cccccccccccc', 'c1c1c1c1-0000-0000-0000-000000000001',
                                   'e3000000-0000-0000-0000-000000000001', 'fa212500-0000-0000-0000-000000000001', 1000) $$,
  'COMPRAS_ORDEN_MONTO_DISTINTO', '[EV-02b] y una orden de 1 000 contra el total alterado (1) sigue rechazada (control vigente)');
RESET ROLE;
SELECT public.chk_num((SELECT count(*) FROM public.ordenes_pago WHERE contrasena_pago_id = 'fa212500-0000-0000-0000-000000000001'), 0,
  '[EV-02b] no quedó ninguna orden de pago sobre la contraseña alterada');
-- Contraseña SIN partidas pero con un total inventado: tampoco se paga (pago sin factura).
SET session_replication_role = replica;
INSERT INTO public.contrasenas_pago (id, company_id, project_id, proveedor_id, fecha_pago_programada, total, numero, moneda)
VALUES ('fa212500-0000-0000-0000-000000000009', :C::uuid, :C1::uuid, :P1::uuid, CURRENT_DATE, 500, 'CP-FA2-EV02-9', 'GTQ');
RESET session_replication_role;
SELECT public.como(:UC::uuid);
SET ROLE authenticated;
SELECT public.chk_falla($$ INSERT INTO public.ordenes_pago (id, company_id, project_id, proveedor_id, contrasena_pago_id, monto)
                           VALUES ('fa212400-0000-0000-0000-000000000009', 'cccccccc-cccc-cccc-cccc-cccccccccccc', 'c1c1c1c1-0000-0000-0000-000000000001',
                                   'e3000000-0000-0000-0000-000000000001', 'fa212500-0000-0000-0000-000000000009', 500) $$,
  'COMPRAS_PAGO_PARTIDAS_DISTINTAS', '[EV-02b] una contraseña sin partidas con total 500 no admite orden de pago (no liquida ninguna factura)');
RESET ROLE;

-- ═══ (c) Con orden viva, las partidas no se insertan / actualizan / mueven ═══
SELECT public.como(:UC::uuid);
SET ROLE authenticated;
INSERT INTO public.contrasenas_pago (id, company_id, project_id, proveedor_id, fecha_pago_programada)
VALUES ('fa212500-0000-0000-0000-000000000002', :C::uuid, :C1::uuid, :P1::uuid, CURRENT_DATE);
INSERT INTO public.contrasena_pago_facturas (company_id, contrasena_id, factura_id, monto)
VALUES (:C::uuid, 'fa212500-0000-0000-0000-000000000002', 'fa212300-0000-0000-0000-000000000002', 400);
INSERT INTO public.ordenes_pago (id, company_id, project_id, proveedor_id, contrasena_pago_id, monto)
VALUES ('fa212400-0000-0000-0000-000000000002', :C::uuid, :C1::uuid, :P1::uuid, 'fa212500-0000-0000-0000-000000000002', 400);
SELECT public.chk_falla($$ UPDATE public.contrasena_pago_facturas SET monto = 900 WHERE contrasena_id = 'fa212500-0000-0000-0000-000000000002' $$,
  'COMPRAS_CONTRASENA_CON_ORDEN', '[EV-02c] la partida de una contraseña con orden (borrador) no cambia de monto');
SELECT public.chk_falla($$ INSERT INTO public.contrasena_pago_facturas (company_id, contrasena_id, factura_id, monto)
                           VALUES ('cccccccc-cccc-cccc-cccc-cccccccccccc', 'fa212500-0000-0000-0000-000000000002', 'fa212300-0000-0000-0000-000000000003', 100) $$,
  'COMPRAS_CONTRASENA_CON_ORDEN', '[EV-02c] ni se le agrega una partida');
SELECT public.chk_falla($$ UPDATE public.contrasena_pago_facturas SET contrasena_id = 'fa212500-0000-0000-0000-000000000001'
                           WHERE contrasena_id = 'fa212500-0000-0000-0000-000000000002' $$,
  'COMPRAS_CONTRASENA_PARTIDA_FIJA', '[EV-02c] ni se mueve a otra contraseña (el origen quedaría con total viejo)');
SELECT public.chk_falla($$ UPDATE public.contrasena_pago_facturas SET factura_id = 'fa212300-0000-0000-0000-000000000003'
                           WHERE contrasena_id = 'fa212500-0000-0000-0000-000000000002' $$,
  'COMPRAS_CONTRASENA_CON_ORDEN', '[EV-02c] ni se re-apunta a otra factura');
SELECT public.chk_falla($$ DELETE FROM public.contrasena_pago_facturas WHERE contrasena_id = 'fa212500-0000-0000-0000-000000000002' $$,
  'COMPRAS_DOCUMENTO_NO_SE_BORRA', '[EV-02c] ni se borra (control vigente, mismo código)');
RESET ROLE;
SELECT public.chk_txt((SELECT monto::text FROM public.contrasena_pago_facturas WHERE contrasena_id = 'fa212500-0000-0000-0000-000000000002'), '400.00',
  '[EV-02c] la partida sigue en 400');
SELECT public.chk_num((SELECT total FROM public.contrasenas_pago WHERE id = 'fa212500-0000-0000-0000-000000000002'), 400, '[EV-02c] y el total de la contraseña en 400');
-- Anulada la orden (borrador → anulada), las partidas vuelven a ser editables y se emite otra orden por el total NUEVO.
SELECT public.como(:US::uuid);
SET ROLE authenticated;
UPDATE public.ordenes_pago SET estado = 'anulada' WHERE id = 'fa212400-0000-0000-0000-000000000002';
RESET ROLE;
SELECT public.como(:UC::uuid);
SET ROLE authenticated;
UPDATE public.contrasena_pago_facturas SET monto = 450 WHERE contrasena_id = 'fa212500-0000-0000-0000-000000000002';
INSERT INTO public.contrasena_pago_facturas (company_id, contrasena_id, factura_id, monto)
VALUES (:C::uuid, 'fa212500-0000-0000-0000-000000000002', 'fa212300-0000-0000-0000-000000000003', 50);
INSERT INTO public.ordenes_pago (id, company_id, project_id, proveedor_id, contrasena_pago_id, monto)
VALUES ('fa212400-0000-0000-0000-000000000012', :C::uuid, :C1::uuid, :P1::uuid, 'fa212500-0000-0000-0000-000000000002', 500);
RESET ROLE;
SELECT public.chk_num((SELECT total FROM public.contrasenas_pago WHERE id = 'fa212500-0000-0000-0000-000000000002'), 500,
  '[EV-02c] anulada la orden, la contraseña se corrigió (450 + 50) y se emitió otra orden por 500');

-- ═══ (d) Una partida no cambia de contraseña (aun sin orden): se borra y se agrega, y los DOS totales cuadran ═══
SELECT public.como(:UC::uuid);
SET ROLE authenticated;
INSERT INTO public.contrasenas_pago (id, company_id, project_id, proveedor_id, fecha_pago_programada)
VALUES ('fa212500-0000-0000-0000-000000000005', :C::uuid, :C1::uuid, :P1::uuid, CURRENT_DATE),
       ('fa212500-0000-0000-0000-000000000006', :C::uuid, :C1::uuid, :P1::uuid, CURRENT_DATE);
INSERT INTO public.contrasena_pago_facturas (company_id, contrasena_id, factura_id, monto)
VALUES (:C::uuid, 'fa212500-0000-0000-0000-000000000005', 'fa212300-0000-0000-0000-000000000004', 300);
SELECT public.chk_falla($$ UPDATE public.contrasena_pago_facturas SET contrasena_id = 'fa212500-0000-0000-0000-000000000006'
                           WHERE contrasena_id = 'fa212500-0000-0000-0000-000000000005' $$,
  'COMPRAS_CONTRASENA_PARTIDA_FIJA', '[EV-02d] mover la partida a otra contraseña se rechaza (antes: dejaba el total de la de origen en 300 y calculaba mal el del destino)');
DELETE FROM public.contrasena_pago_facturas WHERE contrasena_id = 'fa212500-0000-0000-0000-000000000005';
INSERT INTO public.contrasena_pago_facturas (company_id, contrasena_id, factura_id, monto)
VALUES (:C::uuid, 'fa212500-0000-0000-0000-000000000006', 'fa212300-0000-0000-0000-000000000004', 300);
RESET ROLE;
SELECT public.chk_num((SELECT total FROM public.contrasenas_pago WHERE id = 'fa212500-0000-0000-0000-000000000005'), 0,
  '[EV-02d] borrar la partida deja la contraseña de origen en total 0');
SELECT public.chk_num((SELECT total FROM public.contrasenas_pago WHERE id = 'fa212500-0000-0000-0000-000000000006'), 300,
  '[EV-02d] y agregarla en la otra la deja en 300');

-- ═══ (e) Al PAGAR se vuelve a ligar la orden a las partidas (dato alterado por un camino de sistema) ═══
SELECT public.como(:UA::uuid);
SET ROLE authenticated;
INSERT INTO public.contrasenas_pago (id, company_id, project_id, proveedor_id, fecha_pago_programada)
VALUES ('fa212500-0000-0000-0000-000000000003', :C::uuid, :C1::uuid, :P1::uuid, CURRENT_DATE);
INSERT INTO public.contrasena_pago_facturas (company_id, contrasena_id, factura_id, monto)
VALUES (:C::uuid, 'fa212500-0000-0000-0000-000000000003', 'fa212300-0000-0000-0000-000000000003', 100);
INSERT INTO public.ordenes_pago (id, company_id, project_id, proveedor_id, contrasena_pago_id, monto)
VALUES ('fa212400-0000-0000-0000-000000000003', :C::uuid, :C1::uuid, :P1::uuid, 'fa212500-0000-0000-0000-000000000003', 100);
UPDATE public.ordenes_pago SET estado = 'aprobada' WHERE id = 'fa212400-0000-0000-0000-000000000003';
RESET ROLE;
SET session_replication_role = replica;   -- la partida cambia sin pasar por los triggers de usuario (proceso / dato histórico)
UPDATE public.contrasena_pago_facturas SET monto = 900 WHERE contrasena_id = 'fa212500-0000-0000-0000-000000000003';
RESET session_replication_role;
SELECT public.como(:US::uuid);
SET ROLE authenticated;
SELECT public.chk_falla($$ UPDATE public.ordenes_pago SET estado = 'pagada', fecha_pago = CURRENT_DATE WHERE id = 'fa212400-0000-0000-0000-000000000003' $$,
  'COMPRAS_PAGO_PARTIDAS_DISTINTAS', '[EV-02e] no se paga: las partidas suman 900 y la orden está aprobada por 100');
RESET ROLE;
SELECT public.chk_txt((SELECT estado || '/' || monto_pagado FROM public.facturas_proveedor WHERE id = 'fa212300-0000-0000-0000-000000000003'),
  'aprobada/0.00', '[EV-02e] la factura de la contraseña no se movió');
SELECT public.chk_num((SELECT count(*) FROM public.conta_asientos WHERE origen_tabla = 'ordenes_pago' AND origen_id = 'fa212400-0000-0000-0000-000000000003'), 0,
  '[EV-02e] ni hay asiento');
-- Restituido el dato, el pago legítimo pasa y lo aplicado a la factura coincide con el asiento.
SET session_replication_role = replica;
UPDATE public.contrasena_pago_facturas SET monto = 100 WHERE contrasena_id = 'fa212500-0000-0000-0000-000000000003';
RESET session_replication_role;
SELECT public.como(:US::uuid);
SET ROLE authenticated;
UPDATE public.ordenes_pago SET estado = 'pagada', fecha_pago = CURRENT_DATE WHERE id = 'fa212400-0000-0000-0000-000000000003';
RESET ROLE;
SELECT public.chk_txt((SELECT estado || '/' || monto_pagado FROM public.facturas_proveedor WHERE id = 'fa212300-0000-0000-0000-000000000003'),
  'pagada_parcial/100.00', '[EV-02e] restituido el dato, se paga 100 de la factura de 1 000');
SELECT public.chk_num((SELECT sum(l.debe) FROM public.conta_asientos a JOIN public.conta_asiento_lineas l ON l.asiento_id = a.id
                        WHERE a.origen_tabla = 'ordenes_pago' AND a.origen_id = 'fa212400-0000-0000-0000-000000000003' AND a.origen_evento = 'orden_pago_pagada'), 100,
  '[EV-02e] y el asiento del pago (100) coincide con lo aplicado a la factura');

-- ═══ (f) Camino legítimo: parciales 400 + 600 sobre una factura de 1 000, y anulaciones ═══
SELECT public.como(:UA::uuid);
SET ROLE authenticated;
INSERT INTO public.contrasenas_pago (id, company_id, project_id, proveedor_id, fecha_pago_programada)
VALUES ('fa212500-0000-0000-0000-000000000007', :C::uuid, :C1::uuid, :P1::uuid, CURRENT_DATE),
       ('fa212500-0000-0000-0000-000000000008', :C::uuid, :C1::uuid, :P1::uuid, CURRENT_DATE);
INSERT INTO public.contrasena_pago_facturas (company_id, contrasena_id, factura_id, monto) VALUES
  (:C::uuid, 'fa212500-0000-0000-0000-000000000007', 'fa212300-0000-0000-0000-000000000005', 400),
  (:C::uuid, 'fa212500-0000-0000-0000-000000000008', 'fa212300-0000-0000-0000-000000000005', 600);
INSERT INTO public.ordenes_pago (id, company_id, project_id, proveedor_id, contrasena_pago_id, monto) VALUES
  ('fa212400-0000-0000-0000-000000000007', :C::uuid, :C1::uuid, :P1::uuid, 'fa212500-0000-0000-0000-000000000007', 400),
  ('fa212400-0000-0000-0000-000000000008', :C::uuid, :C1::uuid, :P1::uuid, 'fa212500-0000-0000-0000-000000000008', 600);
UPDATE public.ordenes_pago SET estado = 'aprobada' WHERE id IN ('fa212400-0000-0000-0000-000000000007', 'fa212400-0000-0000-0000-000000000008');
UPDATE public.ordenes_pago SET estado = 'pagada', fecha_pago = CURRENT_DATE WHERE id = 'fa212400-0000-0000-0000-000000000007';
UPDATE public.ordenes_pago SET estado = 'pagada', fecha_pago = CURRENT_DATE WHERE id = 'fa212400-0000-0000-0000-000000000008';
RESET ROLE;
SELECT public.chk_txt((SELECT estado || '/' || monto_pagado FROM public.facturas_proveedor WHERE id = 'fa212300-0000-0000-0000-000000000005'),
  'pagada/1000.00', '[EV-02f] parciales 400 + 600: la factura de 1 000 queda pagada');
SELECT public.chk_num((SELECT sum(l.debe) FROM public.conta_asientos a JOIN public.conta_asiento_lineas l ON l.asiento_id = a.id
                        WHERE a.origen_tabla = 'ordenes_pago' AND a.origen_evento = 'orden_pago_pagada'
                          AND a.origen_id IN ('fa212400-0000-0000-0000-000000000007', 'fa212400-0000-0000-0000-000000000008')), 1000,
  '[EV-02f] y los asientos suman 1 000');
-- Una contraseña con orden APROBADA se puede anular (la orden queda sin efecto y se anula después).
SELECT public.como(:UA::uuid);
SET ROLE authenticated;
INSERT INTO public.contrasenas_pago (id, company_id, project_id, proveedor_id, fecha_pago_programada)
VALUES ('fa212500-0000-0000-0000-000000000004', :C::uuid, :C1::uuid, :P1::uuid, CURRENT_DATE);
INSERT INTO public.contrasena_pago_facturas (company_id, contrasena_id, factura_id, monto)
VALUES (:C::uuid, 'fa212500-0000-0000-0000-000000000004', 'fa212300-0000-0000-0000-000000000002', 250);
INSERT INTO public.ordenes_pago (id, company_id, project_id, proveedor_id, contrasena_pago_id, monto)
VALUES ('fa212400-0000-0000-0000-000000000004', :C::uuid, :C1::uuid, :P1::uuid, 'fa212500-0000-0000-0000-000000000004', 250);
UPDATE public.ordenes_pago SET estado = 'aprobada' WHERE id = 'fa212400-0000-0000-0000-000000000004';
UPDATE public.contrasenas_pago SET estado = 'anulada', motivo_anulacion = 'prueba EV-02' WHERE id = 'fa212500-0000-0000-0000-000000000004';
UPDATE public.ordenes_pago SET estado = 'anulada' WHERE id = 'fa212400-0000-0000-0000-000000000004';
RESET ROLE;
SELECT public.chk_txt((SELECT c.estado || '/' || o.estado FROM public.contrasenas_pago c, public.ordenes_pago o
                        WHERE c.id = 'fa212500-0000-0000-0000-000000000004' AND o.id = 'fa212400-0000-0000-0000-000000000004'),
  'anulada/anulada', '[EV-02f] contraseña y orden aprobada se anulan (camino legítimo vigente)');
