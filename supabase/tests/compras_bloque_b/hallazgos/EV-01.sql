\set ON_ERROR_STOP on
-- ============================================================================
-- EV-01 · Orden de pago por CONTRASEÑA: proveedor y contabilidad (proyecto) de la
--         orden = los de la contraseña y los de TODAS sus facturas.
--
-- CAUSA RAÍZ
--   La rama «Orden que liquida una CONTRASEÑA» de compras_tg_orden_pago_controles solo
--   compara la EMPRESA. compras_tg_orden_contrasena corrige proveedor/proyecto solo en
--   INSERT (no en UPDATE de un borrador), nadie impide cambiar project_id/proveedor_id de
--   la contraseña cuando ya tiene partidas u orden viva, y al pagar no se mira que las
--   facturas sean del mismo proveedor/contabilidad. El asiento del pago se publica con el
--   project_id de la ORDEN: CxP del proyecto de la factura nunca se descarga.
--
-- COMPORTAMIENTO ESPERADO
--   · Una orden de contraseña no diverge de la contraseña (proveedor y proyecto) en
--     ningún INSERT/UPDATE (borrador) ni al aprobar ni al pagar.
--   · La contraseña con partidas o con orden viva no cambia de proveedor/proyecto/empresa.
--   · Al pagar, cada factura de las partidas es del mismo proveedor y proyecto que la orden.
--   · Lo legítimo sigue igual: contraseña de varias facturas, pago, asiento en la
--     contabilidad correcta, anulación y re-pago; la purga en cascada de un proyecto.
--
-- Prefijo de ids de este grupo: fa2HHKKK-… (HH = hallazgo, KKK = clase).
-- ============================================================================
\set C   '''cccccccc-cccc-cccc-cccc-cccccccccccc'''
\set C1  '''c1c1c1c1-0000-0000-0000-000000000001'''
\set C2  '''c2c2c2c2-0000-0000-0000-000000000001'''
\set UA  '''c0c0c0c0-0000-0000-0000-00000000000a'''
\set UC  '''c0c0c0c0-0000-0000-0000-00000000000c'''
\set UQ  '''c0c0c0c0-0000-0000-0000-00000000001a'''
\set US  '''c0c0c0c0-0000-0000-0000-00000000001b'''
\set P1  '''e3000000-0000-0000-0000-000000000001'''
\set P2  '''e3000000-0000-0000-0000-000000000002'''

-- Ayuda del grupo (idéntica en los cuatro archivos): factura APROBADA de `p_monto` sin pagos.
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

-- ── Preparación: dos facturas aprobadas de C1/P1 (600 y 400) y una de 1 000 ─────
SELECT public.como(:UA::uuid);
SET ROLE authenticated;
SELECT public.fa2_factura('fa211100-0000-0000-0000-000000000001', 'fa211110-0000-0000-0000-000000000001', 'fa211200-0000-0000-0000-000000000001',
                          'fa211300-0000-0000-0000-000000000001', 'FA2-EV01-1', 600);
SELECT public.fa2_factura('fa211100-0000-0000-0000-000000000002', 'fa211110-0000-0000-0000-000000000002', 'fa211200-0000-0000-0000-000000000002',
                          'fa211300-0000-0000-0000-000000000002', 'FA2-EV01-2', 400);
SELECT public.fa2_factura('fa211100-0000-0000-0000-000000000003', 'fa211110-0000-0000-0000-000000000003', 'fa211200-0000-0000-0000-000000000003',
                          'fa211300-0000-0000-0000-000000000003', 'FA2-EV01-3', 1000);
RESET ROLE;
SELECT public.chk_num((SELECT count(*) FROM public.facturas_proveedor WHERE id::text LIKE 'fa211300-%' AND estado = 'aprobada'), 3,
  '[EV-01a] preparación: tres facturas aprobadas de C1/P1');

-- ═══ (a) La orden BORRADOR de una contraseña no se re-apunta a otro proveedor / contabilidad ═══
SELECT public.como(:UC::uuid);
SET ROLE authenticated;
INSERT INTO public.contrasenas_pago (id, company_id, project_id, proveedor_id, fecha_pago_programada)
VALUES ('fa211500-0000-0000-0000-000000000003', :C::uuid, :C1::uuid, :P1::uuid, CURRENT_DATE);
INSERT INTO public.contrasena_pago_facturas (company_id, contrasena_id, factura_id, monto)
VALUES (:C::uuid, 'fa211500-0000-0000-0000-000000000003', 'fa211300-0000-0000-0000-000000000003', 1000);
-- El cliente manda otro proveedor y proyecto: el INSERT los hereda de la contraseña (comportamiento vigente).
INSERT INTO public.ordenes_pago (id, company_id, project_id, proveedor_id, contrasena_pago_id, monto)
VALUES ('fa211400-0000-0000-0000-000000000003', :C::uuid, :C2::uuid, :P2::uuid, 'fa211500-0000-0000-0000-000000000003', 1000);
RESET ROLE;
SELECT public.chk_txt((SELECT project_id::text || '/' || proveedor_id::text FROM public.ordenes_pago WHERE id = 'fa211400-0000-0000-0000-000000000003'),
  'c1c1c1c1-0000-0000-0000-000000000001/e3000000-0000-0000-0000-000000000001',
  '[EV-01a] el INSERT de la orden hereda proveedor y contabilidad de la contraseña (control vigente, sigue en verde)');

SELECT public.como(:UC::uuid);
SET ROLE authenticated;
SELECT public.chk_falla($$ UPDATE public.ordenes_pago SET project_id = 'c2c2c2c2-0000-0000-0000-000000000001', proveedor_id = 'e3000000-0000-0000-0000-000000000002'
                           WHERE id = 'fa211400-0000-0000-0000-000000000003' $$,
  'COMPRAS_PAGO_CONTRASENA_AJENA', '[EV-01a] el borrador no cambia a OTRO proveedor Y otra contabilidad que la contraseña');
SELECT public.chk_falla($$ UPDATE public.ordenes_pago SET proveedor_id = 'e3000000-0000-0000-0000-000000000002'
                           WHERE id = 'fa211400-0000-0000-0000-000000000003' $$,
  'COMPRAS_PAGO_CONTRASENA_AJENA.*proveedor', '[EV-01b] ni solo el proveedor');
SELECT public.chk_falla($$ UPDATE public.ordenes_pago SET project_id = 'c2c2c2c2-0000-0000-0000-000000000001'
                           WHERE id = 'fa211400-0000-0000-0000-000000000003' $$,
  'COMPRAS_PAGO_CONTRASENA_AJENA.*contabilidad', '[EV-01b] ni solo la contabilidad (proyecto)');
RESET ROLE;
SELECT public.chk_txt((SELECT project_id::text || '/' || proveedor_id::text FROM public.ordenes_pago WHERE id = 'fa211400-0000-0000-0000-000000000003'),
  'c1c1c1c1-0000-0000-0000-000000000001/e3000000-0000-0000-0000-000000000001',
  '[EV-01b] la orden sigue en C1/P1 tras los intentos');

-- ═══ (c) La contraseña con partidas u orden viva no cambia de proveedor / contabilidad ═══
SELECT public.como(:UC::uuid);
SET ROLE authenticated;
SELECT public.chk_falla($$ UPDATE public.contrasenas_pago SET project_id = 'c2c2c2c2-0000-0000-0000-000000000001', proveedor_id = 'e3000000-0000-0000-0000-000000000002'
                           WHERE id = 'fa211500-0000-0000-0000-000000000003' $$,
  'COMPRAS_CONTRASENA_CABECERA_FIJA', '[EV-01c] la contraseña con partida y orden viva no cambia de proveedor ni de contabilidad');
SELECT public.chk_falla($$ UPDATE public.contrasenas_pago SET project_id = 'c2c2c2c2-0000-0000-0000-000000000001'
                           WHERE id = 'fa211500-0000-0000-0000-000000000003' $$,
  'COMPRAS_CONTRASENA_CABECERA_FIJA', '[EV-01c] ni solo la contabilidad');
-- La moneda de la cabecera también la toma el asiento del pago: cambiarla a USD publicaría 1 000 USD = 7 750 GTQ.
SELECT public.chk_falla($$ UPDATE public.contrasenas_pago SET moneda = 'USD' WHERE id = 'fa211500-0000-0000-0000-000000000003' $$,
  'COMPRAS_CONTRASENA_CABECERA_FIJA', '[EV-01c] ni la moneda de la contraseña (el asiento del pago la toma de la cabecera)');
-- Variante: contraseña con partida pero SIN orden todavía (el INSERT de la orden heredaría la cabecera nueva).
INSERT INTO public.contrasenas_pago (id, company_id, project_id, proveedor_id, fecha_pago_programada)
VALUES ('fa211500-0000-0000-0000-000000000004', :C::uuid, :C1::uuid, :P1::uuid, CURRENT_DATE);
INSERT INTO public.contrasena_pago_facturas (company_id, contrasena_id, factura_id, monto)
VALUES (:C::uuid, 'fa211500-0000-0000-0000-000000000004', 'fa211300-0000-0000-0000-000000000001', 600);
SELECT public.chk_falla($$ UPDATE public.contrasenas_pago SET project_id = 'c2c2c2c2-0000-0000-0000-000000000001', proveedor_id = 'e3000000-0000-0000-0000-000000000002'
                           WHERE id = 'fa211500-0000-0000-0000-000000000004' $$,
  'COMPRAS_CONTRASENA_CABECERA_FIJA', '[EV-01c] la contraseña con partidas (sin orden aún) tampoco cambia de cabecera');
-- Legítimo: una contraseña VACÍA (recién emitida, sin partidas ni orden) sí puede corregirse.
INSERT INTO public.contrasenas_pago (id, company_id, project_id, proveedor_id, fecha_pago_programada)
VALUES ('fa211500-0000-0000-0000-000000000005', :C::uuid, :C1::uuid, :P1::uuid, CURRENT_DATE);
UPDATE public.contrasenas_pago SET proveedor_id = :P2::uuid WHERE id = 'fa211500-0000-0000-0000-000000000005';
-- Legítimo: ediciones que no tocan la cabecera de alcance (fecha, observaciones) con orden viva.
UPDATE public.contrasenas_pago SET observaciones = 'nota', fecha_pago_programada = CURRENT_DATE + 3 WHERE id = 'fa211500-0000-0000-0000-000000000003';
RESET ROLE;
SELECT public.chk_txt((SELECT proveedor_id::text FROM public.contrasenas_pago WHERE id = 'fa211500-0000-0000-0000-000000000005'),
  'e3000000-0000-0000-0000-000000000002', '[EV-01c] la contraseña vacía sí cambió de proveedor (no se prohíbe todo)');
SELECT public.chk_txt((SELECT project_id::text || '/' || proveedor_id::text FROM public.contrasenas_pago WHERE id = 'fa211500-0000-0000-0000-000000000003'),
  'c1c1c1c1-0000-0000-0000-000000000001/e3000000-0000-0000-0000-000000000001', '[EV-01c] la contraseña con orden sigue en C1/P1');

-- ═══ (d) El pago sale de la contabilidad de la contraseña y de sus facturas (camino completo, tres perfiles) ═══
SELECT public.como(:UQ::uuid);
SET ROLE authenticated;
UPDATE public.ordenes_pago SET estado = 'aprobada' WHERE id = 'fa211400-0000-0000-0000-000000000003';
RESET ROLE;
SELECT public.como(:US::uuid);
SET ROLE authenticated;
UPDATE public.ordenes_pago SET estado = 'pagada', fecha_pago = CURRENT_DATE WHERE id = 'fa211400-0000-0000-0000-000000000003';
RESET ROLE;
SELECT public.chk_txt((SELECT estado || '/' || monto_pagado FROM public.facturas_proveedor WHERE id = 'fa211300-0000-0000-0000-000000000003'),
  'pagada/1000.00', '[EV-01d] la factura de la contraseña quedó pagada por 1 000');
SELECT public.chk_txt((SELECT string_agg(DISTINCT project_id::text, ',') FROM public.conta_asientos
                        WHERE origen_tabla = 'ordenes_pago' AND origen_id = 'fa211400-0000-0000-0000-000000000003' AND estado = 'publicado'),
  'c1c1c1c1-0000-0000-0000-000000000001', '[EV-01d] el asiento del pago se publicó en la contabilidad C1 (la de la factura)');

-- ═══ (e) Una factura de la contraseña que ya NO es de la misma contabilidad / proveedor bloquea el pago ═══
SELECT public.como(:UC::uuid);
SET ROLE authenticated;
-- Contraseña de la factura 2 (400): orden creada y aprobada con todo en orden…
INSERT INTO public.contrasenas_pago (id, company_id, project_id, proveedor_id, fecha_pago_programada)
VALUES ('fa211500-0000-0000-0000-000000000006', :C::uuid, :C1::uuid, :P1::uuid, CURRENT_DATE);
INSERT INTO public.contrasena_pago_facturas (company_id, contrasena_id, factura_id, monto)
VALUES (:C::uuid, 'fa211500-0000-0000-0000-000000000006', 'fa211300-0000-0000-0000-000000000002', 400);
INSERT INTO public.ordenes_pago (id, company_id, project_id, proveedor_id, contrasena_pago_id, monto)
VALUES ('fa211400-0000-0000-0000-000000000006', :C::uuid, :C1::uuid, :P1::uuid, 'fa211500-0000-0000-0000-000000000006', 400);
RESET ROLE;
SELECT public.como(:UQ::uuid);
SET ROLE authenticated;
UPDATE public.ordenes_pago SET estado = 'aprobada' WHERE id = 'fa211400-0000-0000-0000-000000000006';
RESET ROLE;
-- …y la factura se reubica por un camino de sistema (sin triggers de usuario) en otra contabilidad.
SET session_replication_role = replica;
UPDATE public.facturas_proveedor SET project_id = 'c2c2c2c2-0000-0000-0000-000000000001' WHERE id = 'fa211300-0000-0000-0000-000000000002';
RESET session_replication_role;
SELECT public.como(:US::uuid);
SET ROLE authenticated;
SELECT public.chk_falla($$ UPDATE public.ordenes_pago SET estado = 'pagada', fecha_pago = CURRENT_DATE WHERE id = 'fa211400-0000-0000-0000-000000000006' $$,
  'COMPRAS_PAGO_CONTRASENA_AJENA.*(factura|contabilidad)', '[EV-01e] no se paga si una factura de la contraseña es de otra contabilidad');
RESET ROLE;
SELECT public.chk_txt((SELECT estado || '/' || monto_pagado FROM public.facturas_proveedor WHERE id = 'fa211300-0000-0000-0000-000000000002'),
  'aprobada/0.00', '[EV-01e] y la factura no se movió');
SELECT public.chk_num((SELECT count(*) FROM public.conta_asientos WHERE origen_tabla = 'ordenes_pago' AND origen_id = 'fa211400-0000-0000-0000-000000000006'), 0,
  '[EV-01e] ni hay asiento del pago');
-- Se corrige el dato (la factura vuelve a su contabilidad) y el pago legítimo pasa.
SET session_replication_role = replica;
UPDATE public.facturas_proveedor SET project_id = 'c1c1c1c1-0000-0000-0000-000000000001' WHERE id = 'fa211300-0000-0000-0000-000000000002';
RESET session_replication_role;
SELECT public.como(:US::uuid);
SET ROLE authenticated;
UPDATE public.ordenes_pago SET estado = 'pagada', fecha_pago = CURRENT_DATE WHERE id = 'fa211400-0000-0000-0000-000000000006';
RESET ROLE;
SELECT public.chk_txt((SELECT estado || '/' || monto_pagado FROM public.facturas_proveedor WHERE id = 'fa211300-0000-0000-0000-000000000002'),
  'pagada/400.00', '[EV-01e] corregido el dato, el pago legítimo pasa');

-- ═══ (f) Camino legítimo: contraseña de VARIAS facturas, pago, anulación y re-pago ═══
SELECT public.como(:UA::uuid);
SET ROLE authenticated;
SELECT public.fa2_factura('fa211100-0000-0000-0000-000000000007', 'fa211110-0000-0000-0000-000000000007', 'fa211200-0000-0000-0000-000000000007',
                          'fa211300-0000-0000-0000-000000000007', 'FA2-EV01-7', 300);
SELECT public.fa2_factura('fa211100-0000-0000-0000-000000000008', 'fa211110-0000-0000-0000-000000000008', 'fa211200-0000-0000-0000-000000000008',
                          'fa211300-0000-0000-0000-000000000008', 'FA2-EV01-8', 200);
INSERT INTO public.contrasenas_pago (id, company_id, project_id, proveedor_id, fecha_pago_programada)
VALUES ('fa211500-0000-0000-0000-000000000007', :C::uuid, :C1::uuid, :P1::uuid, CURRENT_DATE);
INSERT INTO public.contrasena_pago_facturas (company_id, contrasena_id, factura_id, monto) VALUES
  (:C::uuid, 'fa211500-0000-0000-0000-000000000007', 'fa211300-0000-0000-0000-000000000007', 300),
  (:C::uuid, 'fa211500-0000-0000-0000-000000000007', 'fa211300-0000-0000-0000-000000000008', 200);
INSERT INTO public.ordenes_pago (id, company_id, project_id, proveedor_id, contrasena_pago_id, monto)
VALUES ('fa211400-0000-0000-0000-000000000007', :C::uuid, :C1::uuid, :P1::uuid, 'fa211500-0000-0000-0000-000000000007', 500);
UPDATE public.ordenes_pago SET estado = 'aprobada' WHERE id = 'fa211400-0000-0000-0000-000000000007';
UPDATE public.ordenes_pago SET estado = 'pagada', fecha_pago = CURRENT_DATE WHERE id = 'fa211400-0000-0000-0000-000000000007';
RESET ROLE;
SELECT public.chk_num((SELECT count(*) FROM public.facturas_proveedor WHERE id::text IN ('fa211300-0000-0000-0000-000000000007', 'fa211300-0000-0000-0000-000000000008') AND estado = 'pagada'), 2,
  '[EV-01f] una orden paga las DOS facturas de la contraseña');
SELECT public.chk_num((SELECT sum(l.debe) FROM public.conta_asientos a JOIN public.conta_asiento_lineas l ON l.asiento_id = a.id
                        WHERE a.origen_tabla = 'ordenes_pago' AND a.origen_id = 'fa211400-0000-0000-0000-000000000007' AND a.origen_evento = 'orden_pago_pagada'), 500,
  '[EV-01f] y el asiento es por 500 (lo aplicado a las facturas)');
SELECT public.como(:UA::uuid);
SET ROLE authenticated;
UPDATE public.ordenes_pago SET estado = 'anulada' WHERE id = 'fa211400-0000-0000-0000-000000000007';
RESET ROLE;
SELECT public.chk_txt((SELECT estado FROM public.contrasenas_pago WHERE id = 'fa211500-0000-0000-0000-000000000007'),
  'emitida', '[EV-01f] anular la orden pagada devuelve la contraseña a «emitida»');
SELECT public.como(:UA::uuid);
SET ROLE authenticated;
INSERT INTO public.ordenes_pago (id, company_id, project_id, proveedor_id, contrasena_pago_id, monto)
VALUES ('fa211400-0000-0000-0000-000000000008', :C::uuid, :C1::uuid, :P1::uuid, 'fa211500-0000-0000-0000-000000000007', 500);
UPDATE public.ordenes_pago SET estado = 'aprobada' WHERE id = 'fa211400-0000-0000-0000-000000000008';
UPDATE public.ordenes_pago SET estado = 'pagada', fecha_pago = CURRENT_DATE WHERE id = 'fa211400-0000-0000-0000-000000000008';
RESET ROLE;
SELECT public.chk_num((SELECT count(*) FROM public.facturas_proveedor WHERE id::text IN ('fa211300-0000-0000-0000-000000000007', 'fa211300-0000-0000-0000-000000000008') AND estado = 'pagada'), 2,
  '[EV-01f] la contraseña se re-paga con una orden nueva tras anular la primera');

-- ═══ (g) Sin sesión de usuario (service_role / proceso): los mismos invariantes y el camino de pago intacto ═══
SELECT set_config('request.jwt.claim.sub', '', false);
INSERT INTO public.ordenes_pago (id, company_id, project_id, proveedor_id, contrasena_pago_id, monto)
VALUES ('fa211400-0000-0000-0000-000000000004', :C::uuid, :C1::uuid, :P1::uuid, 'fa211500-0000-0000-0000-000000000004', 600);
SELECT public.chk_falla($$ UPDATE public.ordenes_pago SET project_id = 'c2c2c2c2-0000-0000-0000-000000000001'
                           WHERE id = 'fa211400-0000-0000-0000-000000000004' $$,
  'COMPRAS_PAGO_CONTRASENA_AJENA', '[EV-01g] sin sesión de usuario tampoco se re-apunta el borrador a otra contabilidad');
UPDATE public.ordenes_pago SET estado = 'aprobada' WHERE id = 'fa211400-0000-0000-0000-000000000004';
UPDATE public.ordenes_pago SET estado = 'pagada', fecha_pago = CURRENT_DATE WHERE id = 'fa211400-0000-0000-0000-000000000004';
SELECT public.chk_txt((SELECT estado || '/' || monto_pagado FROM public.facturas_proveedor WHERE id = 'fa211300-0000-0000-0000-000000000001'),
  'pagada/600.00', '[EV-01g] el proceso sin usuario sí paga la contraseña por la vía legítima');

-- ═══ (h) El borrado en cascada de un proyecto (ON DELETE SET NULL de la contraseña) NO se bloquea,
--         aunque la contraseña tenga partidas ═══
INSERT INTO public.projects (id, company_id, nombre) VALUES ('fa211900-0000-0000-0000-000000000001', :C::uuid, 'Proyecto efímero EV-01');
INSERT INTO public.contrasenas_pago (id, company_id, project_id, proveedor_id, fecha_pago_programada, numero)
VALUES ('fa211500-0000-0000-0000-000000000009', :C::uuid, 'fa211900-0000-0000-0000-000000000001', :P1::uuid, CURRENT_DATE, 'CP-FA2-EV01-H');
SET session_replication_role = replica;   -- dato de purga: partida colgada de una contraseña de un proyecto que se elimina
INSERT INTO public.contrasena_pago_facturas (company_id, contrasena_id, factura_id, monto)
VALUES (:C::uuid, 'fa211500-0000-0000-0000-000000000009', 'fa211300-0000-0000-0000-000000000008', 1);
RESET session_replication_role;
DELETE FROM public.projects WHERE id = 'fa211900-0000-0000-0000-000000000001';
SELECT public.chk_txt((SELECT COALESCE(project_id::text, 'NULL') FROM public.contrasenas_pago WHERE id = 'fa211500-0000-0000-0000-000000000009'),
  'NULL', '[EV-01h] al eliminar un proyecto, su contraseña con partidas queda sin proyecto (cascada, sin bloqueo)');

-- ═══ (i) Contabilidad de la EMPRESA (sin proyecto): el mismo invariante con project_id NULL ═══
SELECT public.como(:UA::uuid);
SET ROLE authenticated;
INSERT INTO public.facturas_proveedor (id, company_id, project_id, proveedor_id, numero_factura, concepto, monto_total)
VALUES ('fa211300-0000-0000-0000-000000000011', :C::uuid, NULL, :P1::uuid, 'FA2-EV01-11', 'factura de la contabilidad de la empresa', 250);
UPDATE public.facturas_proveedor SET estado = 'aprobada' WHERE id = 'fa211300-0000-0000-0000-000000000011';
INSERT INTO public.contrasenas_pago (id, company_id, project_id, proveedor_id, fecha_pago_programada)
VALUES ('fa211500-0000-0000-0000-000000000011', :C::uuid, NULL, :P1::uuid, CURRENT_DATE);
INSERT INTO public.contrasena_pago_facturas (company_id, contrasena_id, factura_id, monto)
VALUES (:C::uuid, 'fa211500-0000-0000-0000-000000000011', 'fa211300-0000-0000-0000-000000000011', 250);
INSERT INTO public.ordenes_pago (id, company_id, project_id, proveedor_id, contrasena_pago_id, monto)
VALUES ('fa211400-0000-0000-0000-000000000011', :C::uuid, :C1::uuid, :P1::uuid, 'fa211500-0000-0000-0000-000000000011', 250);
RESET ROLE;
SELECT public.chk_txt((SELECT COALESCE(project_id::text, 'NULL') FROM public.ordenes_pago WHERE id = 'fa211400-0000-0000-0000-000000000011'), 'NULL',
  '[EV-01i] la orden de una contraseña de la contabilidad de la empresa hereda «sin proyecto»');
SELECT public.como(:UC::uuid);
SET ROLE authenticated;
SELECT public.chk_falla($$ UPDATE public.ordenes_pago SET project_id = 'c1c1c1c1-0000-0000-0000-000000000001' WHERE id = 'fa211400-0000-0000-0000-000000000011' $$,
  'COMPRAS_PAGO_CONTRASENA_AJENA.*contabilidad', '[EV-01i] y no se pasa a un proyecto distinto del de la contraseña');
RESET ROLE;
SELECT public.como(:UA::uuid);
SET ROLE authenticated;
UPDATE public.ordenes_pago SET estado = 'aprobada' WHERE id = 'fa211400-0000-0000-0000-000000000011';
UPDATE public.ordenes_pago SET estado = 'pagada', fecha_pago = CURRENT_DATE WHERE id = 'fa211400-0000-0000-0000-000000000011';
RESET ROLE;
SELECT public.chk_txt((SELECT estado || '/' || monto_pagado FROM public.facturas_proveedor WHERE id = 'fa211300-0000-0000-0000-000000000011'),
  'pagada/250.00', '[EV-01i] la contraseña de la contabilidad de la empresa se paga por la vía legítima');
SELECT public.chk_num((SELECT count(*) FROM public.conta_asientos WHERE origen_tabla = 'ordenes_pago' AND origen_id = 'fa211400-0000-0000-0000-000000000011'
                          AND estado = 'publicado' AND project_id IS NULL), 1, '[EV-01i] y el asiento sale en la contabilidad de la empresa (sin proyecto)');

-- ═══ (j) Re-apuntar el borrador a OTRA contraseña (de otro proveedor / contabilidad) tampoco ═══
SELECT public.como(:UC::uuid);
SET ROLE authenticated;
INSERT INTO public.contrasenas_pago (id, company_id, project_id, proveedor_id, fecha_pago_programada)
VALUES ('fa211500-0000-0000-0000-000000000012', :C::uuid, :C1::uuid, :P2::uuid, CURRENT_DATE);
-- Una factura aprobada del proveedor P2 para que la contraseña tenga el mismo monto que la del borrador (250).
RESET ROLE;
SELECT public.como(:UA::uuid);
SET ROLE authenticated;
SELECT public.fa2_factura('fa211100-0000-0000-0000-000000000012', 'fa211110-0000-0000-0000-000000000012', 'fa211200-0000-0000-0000-000000000012',
                          'fa211300-0000-0000-0000-000000000012', 'FA2-EV01-12', 250, 'e3000000-0000-0000-0000-000000000002');
INSERT INTO public.contrasena_pago_facturas (company_id, contrasena_id, factura_id, monto)
VALUES (:C::uuid, 'fa211500-0000-0000-0000-000000000012', 'fa211300-0000-0000-0000-000000000012', 250);
INSERT INTO public.contrasenas_pago (id, company_id, project_id, proveedor_id, fecha_pago_programada)
VALUES ('fa211500-0000-0000-0000-000000000013', :C::uuid, :C1::uuid, :P1::uuid, CURRENT_DATE);
INSERT INTO public.facturas_proveedor (id, company_id, project_id, proveedor_id, numero_factura, concepto, monto_total)
VALUES ('fa211300-0000-0000-0000-000000000013', :C::uuid, :C1::uuid, :P1::uuid, 'FA2-EV01-13', 'factura P1 para el borrador', 250);
UPDATE public.facturas_proveedor SET estado = 'aprobada' WHERE id = 'fa211300-0000-0000-0000-000000000013';
INSERT INTO public.contrasena_pago_facturas (company_id, contrasena_id, factura_id, monto)
VALUES (:C::uuid, 'fa211500-0000-0000-0000-000000000013', 'fa211300-0000-0000-0000-000000000013', 250);
INSERT INTO public.ordenes_pago (id, company_id, project_id, proveedor_id, contrasena_pago_id, monto)
VALUES ('fa211400-0000-0000-0000-000000000013', :C::uuid, :C1::uuid, :P1::uuid, 'fa211500-0000-0000-0000-000000000013', 250);
SELECT public.chk_falla($$ UPDATE public.ordenes_pago SET contrasena_pago_id = 'fa211500-0000-0000-0000-000000000012'
                           WHERE id = 'fa211400-0000-0000-0000-000000000013' $$,
  'COMPRAS_PAGO_CONTRASENA_AJENA.*proveedor', '[EV-01j] un borrador de P1 no se re-apunta a la contraseña de P2 aunque el monto coincida');
RESET ROLE;
SELECT public.chk_txt((SELECT contrasena_pago_id::text FROM public.ordenes_pago WHERE id = 'fa211400-0000-0000-0000-000000000013'),
  'fa211500-0000-0000-0000-000000000013', '[EV-01j] la orden sigue atada a su contraseña');
