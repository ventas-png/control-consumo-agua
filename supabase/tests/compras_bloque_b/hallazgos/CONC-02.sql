\set ON_ERROR_STOP on
-- ============================================================================
-- CONC-02 · Una contraseña de pago tiene a lo más UNA orden de pago viva (parte secuencial/lógica;
--           el entrelazado simultáneo real está en CONC-02.conc.sh).
--
-- CAUSA RAÍZ
--   La exclusividad «una orden viva por contraseña» solo la comprobaba compras_tg_orden_contrasena al INSERTAR
--   (EXISTS sin bloqueo); un UPDATE que RE-APUNTA un borrador a una contraseña que ya tiene su orden la dejaba
--   pasar, y ordenes_pago no tenía unicidad por contraseña. El estado de la contraseña al pagar se leía sin bloqueo.
--
-- COMPORTAMIENTO ESPERADO
--   · Una segunda orden viva sobre la misma contraseña se rechaza (COMPRAS_CONTRASENA_YA_TIENE_ORDEN), al
--     insertar y también al re-apuntar un borrador; ni saltándose los triggers de usuario caben dos vivas.
--   · Lo legítimo sigue: anulada la orden se emite otra; pagada y anulada la orden, la contraseña vuelve a
--     «emitida» y se vuelve a pagar una sola vez; dos contraseñas parciales de una misma factura (400 + 600).
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

-- ── Preparación: tres facturas aprobadas de 1 000 y cuatro contraseñas con partida de 400 ─────────
SELECT public.como(:UA::uuid);
SET ROLE authenticated;
SELECT public.fa2_factura('fa202100-0000-0000-0000-000000000101', 'fa202110-0000-0000-0000-000000000101', 'fa202200-0000-0000-0000-000000000101',
                          'fa202300-0000-0000-0000-000000000101', 'FA2-C02S-1', 1000);
SELECT public.fa2_factura('fa202100-0000-0000-0000-000000000102', 'fa202110-0000-0000-0000-000000000102', 'fa202200-0000-0000-0000-000000000102',
                          'fa202300-0000-0000-0000-000000000102', 'FA2-C02S-2', 1000);
SELECT public.fa2_factura('fa202100-0000-0000-0000-000000000103', 'fa202110-0000-0000-0000-000000000103', 'fa202200-0000-0000-0000-000000000103',
                          'fa202300-0000-0000-0000-000000000103', 'FA2-C02S-3', 1000);
INSERT INTO public.contrasenas_pago (id, company_id, project_id, proveedor_id, fecha_pago_programada) VALUES
  ('fa202500-0000-0000-0000-000000000101', :C::uuid, :C1::uuid, :P1::uuid, CURRENT_DATE),
  ('fa202500-0000-0000-0000-000000000102', :C::uuid, :C1::uuid, :P1::uuid, CURRENT_DATE),
  ('fa202500-0000-0000-0000-000000000103', :C::uuid, :C1::uuid, :P1::uuid, CURRENT_DATE),
  ('fa202500-0000-0000-0000-000000000104', :C::uuid, :C1::uuid, :P1::uuid, CURRENT_DATE);
INSERT INTO public.contrasena_pago_facturas (company_id, contrasena_id, factura_id, monto) VALUES
  (:C::uuid, 'fa202500-0000-0000-0000-000000000101', 'fa202300-0000-0000-0000-000000000101', 400),
  (:C::uuid, 'fa202500-0000-0000-0000-000000000102', 'fa202300-0000-0000-0000-000000000102', 400),
  (:C::uuid, 'fa202500-0000-0000-0000-000000000103', 'fa202300-0000-0000-0000-000000000103', 400),
  (:C::uuid, 'fa202500-0000-0000-0000-000000000104', 'fa202300-0000-0000-0000-000000000101', 600);
RESET ROLE;
SELECT public.chk_num((SELECT count(*) FROM public.contrasenas_pago WHERE id::text LIKE 'fa202500-%' AND estado = 'emitida'), 4,
  '[CONC-02a] preparación: cuatro contraseñas emitidas');

-- ═══ (a) Una segunda orden viva sobre la misma contraseña se rechaza al INSERTAR (control vigente) ═══
SELECT public.como(:UC::uuid);
SET ROLE authenticated;
INSERT INTO public.ordenes_pago (id, company_id, project_id, proveedor_id, contrasena_pago_id, monto)
VALUES ('fa202400-0000-0000-0000-000000000101', :C::uuid, :C1::uuid, :P1::uuid, 'fa202500-0000-0000-0000-000000000101', 400);
SELECT public.chk_falla($$ INSERT INTO public.ordenes_pago (company_id, project_id, proveedor_id, contrasena_pago_id, monto)
                           VALUES ('cccccccc-cccc-cccc-cccc-cccccccccccc', 'c1c1c1c1-0000-0000-0000-000000000001', 'e3000000-0000-0000-0000-000000000001',
                                   'fa202500-0000-0000-0000-000000000101', 400) $$,
  'COMPRAS_CONTRASENA_YA_TIENE_ORDEN', '[CONC-02a] la segunda orden viva de la misma contraseña se rechaza al insertar');
RESET ROLE;

-- ═══ (b) ...y al RE-APUNTAR un borrador a una contraseña que ya tiene su orden (antes: pasaba) ═══
SELECT public.como(:UC::uuid);
SET ROLE authenticated;
INSERT INTO public.ordenes_pago (id, company_id, project_id, proveedor_id, contrasena_pago_id, monto)
VALUES ('fa202400-0000-0000-0000-000000000102', :C::uuid, :C1::uuid, :P1::uuid, 'fa202500-0000-0000-0000-000000000102', 400),
       ('fa202400-0000-0000-0000-000000000103', :C::uuid, :C1::uuid, :P1::uuid, 'fa202500-0000-0000-0000-000000000103', 400);
SELECT public.chk_falla($$ UPDATE public.ordenes_pago SET contrasena_pago_id = 'fa202500-0000-0000-0000-000000000102'
                           WHERE id = 'fa202400-0000-0000-0000-000000000103' $$,
  'COMPRAS_CONTRASENA_YA_TIENE_ORDEN', '[CONC-02b] re-apuntar un borrador a una contraseña que ya tiene orden viva se rechaza');
RESET ROLE;
SELECT public.chk_num((SELECT count(*) FROM public.ordenes_pago WHERE contrasena_pago_id = 'fa202500-0000-0000-0000-000000000102' AND estado <> 'anulada'), 1,
  '[CONC-02b] la contraseña destino sigue con UNA sola orden viva');
SELECT public.chk_txt((SELECT contrasena_pago_id::text FROM public.ordenes_pago WHERE id = 'fa202400-0000-0000-0000-000000000103'),
  'fa202500-0000-0000-0000-000000000103', '[CONC-02b] y el borrador sigue atado a su contraseña');

-- ═══ (c) Ni saltándose los triggers de usuario caben dos órdenes vivas de la misma contraseña ═══
SELECT public.chk_falla($$ SET LOCAL session_replication_role = replica;
                           INSERT INTO public.ordenes_pago (id, company_id, project_id, proveedor_id, contrasena_pago_id, monto, estado)
                           VALUES ('fa202400-0000-0000-0000-000000000109', 'cccccccc-cccc-cccc-cccc-cccccccccccc', 'c1c1c1c1-0000-0000-0000-000000000001',
                                   'e3000000-0000-0000-0000-000000000001', 'fa202500-0000-0000-0000-000000000101', 400, 'aprobada') $$,
  'uq_ordenes_pago_contrasena_viva|duplicate key', '[CONC-02c] dos órdenes vivas de la misma contraseña no caben ni sin los triggers de usuario (índice único parcial)');

-- ═══ (d) Lo legítimo: anulada la orden se emite otra; pagada, anulada y re-pagada una sola vez; parciales 400 + 600 ═══
SELECT public.como(:US::uuid);
SET ROLE authenticated;
UPDATE public.ordenes_pago SET estado = 'anulada' WHERE id = 'fa202400-0000-0000-0000-000000000101';
RESET ROLE;
SELECT public.como(:UC::uuid);
SET ROLE authenticated;
INSERT INTO public.ordenes_pago (id, company_id, project_id, proveedor_id, contrasena_pago_id, monto)
VALUES ('fa202400-0000-0000-0000-000000000111', :C::uuid, :C1::uuid, :P1::uuid, 'fa202500-0000-0000-0000-000000000101', 400);
RESET ROLE;
SELECT public.chk_num((SELECT count(*) FROM public.ordenes_pago WHERE contrasena_pago_id = 'fa202500-0000-0000-0000-000000000101' AND estado <> 'anulada'), 1,
  '[CONC-02d] anulada la orden, la contraseña admite otra (una sola viva)');
-- Parciales: 400 (contraseña 101) y 600 (contraseña 104) sobre la factura de 1 000.
SELECT public.como(:UC::uuid);
SET ROLE authenticated;
INSERT INTO public.ordenes_pago (id, company_id, project_id, proveedor_id, contrasena_pago_id, monto)
VALUES ('fa202400-0000-0000-0000-000000000114', :C::uuid, :C1::uuid, :P1::uuid, 'fa202500-0000-0000-0000-000000000104', 600);
RESET ROLE;
SELECT public.como(:UQ::uuid);
SET ROLE authenticated;
UPDATE public.ordenes_pago SET estado = 'aprobada' WHERE id IN ('fa202400-0000-0000-0000-000000000111', 'fa202400-0000-0000-0000-000000000114');
RESET ROLE;
SELECT public.como(:US::uuid);
SET ROLE authenticated;
UPDATE public.ordenes_pago SET estado = 'pagada', fecha_pago = CURRENT_DATE WHERE id = 'fa202400-0000-0000-0000-000000000111';
UPDATE public.ordenes_pago SET estado = 'pagada', fecha_pago = CURRENT_DATE WHERE id = 'fa202400-0000-0000-0000-000000000114';
RESET ROLE;
SELECT public.chk_txt((SELECT estado || '/' || monto_pagado FROM public.facturas_proveedor WHERE id = 'fa202300-0000-0000-0000-000000000101'),
  'pagada/1000.00', '[CONC-02d] parciales 400 + 600: la factura de 1 000 queda pagada, una vez cada contraseña');
SELECT public.chk_num((SELECT count(*) FROM public.conta_asientos WHERE origen_tabla = 'ordenes_pago' AND origen_evento = 'orden_pago_pagada' AND estado = 'publicado'
                          AND origen_id IN ('fa202400-0000-0000-0000-000000000111', 'fa202400-0000-0000-0000-000000000114')), 2,
  '[CONC-02d] dos pagos, dos asientos');
-- Reintento de pago (doble clic en serie) de la misma orden: no aplica dos veces.
SELECT public.como(:US::uuid);
SET ROLE authenticated;
UPDATE public.ordenes_pago SET estado = 'pagada', fecha_pago = CURRENT_DATE WHERE id = 'fa202400-0000-0000-0000-000000000111';
RESET ROLE;
SELECT public.chk_txt((SELECT estado || '/' || monto_pagado FROM public.facturas_proveedor WHERE id = 'fa202300-0000-0000-0000-000000000101'),
  'pagada/1000.00', '[CONC-02d] el reintento del pago de la misma orden no vuelve a aplicarlo');
-- Una contraseña ya pagada no admite otra orden; anulada la que la pagó, vuelve a «emitida» y admite otra.
SELECT public.como(:UC::uuid);
SET ROLE authenticated;
SELECT public.chk_falla($$ INSERT INTO public.ordenes_pago (company_id, project_id, proveedor_id, contrasena_pago_id, monto)
                           VALUES ('cccccccc-cccc-cccc-cccc-cccccccccccc', 'c1c1c1c1-0000-0000-0000-000000000001', 'e3000000-0000-0000-0000-000000000001',
                                   'fa202500-0000-0000-0000-000000000101', 400) $$,
  'COMPRAS_CONTRASENA_CERRADA', '[CONC-02d] una contraseña ya pagada no admite otra orden');
RESET ROLE;
SELECT public.como(:US::uuid);
SET ROLE authenticated;
UPDATE public.ordenes_pago SET estado = 'anulada' WHERE id = 'fa202400-0000-0000-0000-000000000111';
RESET ROLE;
SELECT public.chk_txt((SELECT estado FROM public.contrasenas_pago WHERE id = 'fa202500-0000-0000-0000-000000000101'), 'emitida',
  '[CONC-02d] anulada la orden pagada, la contraseña vuelve a «emitida»');
SELECT public.como(:UC::uuid);
SET ROLE authenticated;
INSERT INTO public.ordenes_pago (id, company_id, project_id, proveedor_id, contrasena_pago_id, monto)
VALUES ('fa202400-0000-0000-0000-000000000115', :C::uuid, :C1::uuid, :P1::uuid, 'fa202500-0000-0000-0000-000000000101', 400);
RESET ROLE;
SELECT public.chk_num((SELECT count(*) FROM public.ordenes_pago WHERE contrasena_pago_id = 'fa202500-0000-0000-0000-000000000101' AND estado <> 'anulada'), 1,
  '[CONC-02d] y admite una nueva orden (una sola viva)');
