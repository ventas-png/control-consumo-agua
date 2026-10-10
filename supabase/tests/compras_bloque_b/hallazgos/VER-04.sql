\set ON_ERROR_STOP on
-- ============================================================================
-- VER-04 · Una factura aprobada y contabilizada se desvincula de su orden y cambia de proyecto /
--          moneda / número con solo 'edit', dejando el libro desfasado.
--
-- CAUSA RAÍZ
--   Una vez fuera de «registrada» solo monto_total, iva_monto y proveedor_id están protegidos
--   (trg_cxp_proteger_factura → CXP_INMUTABLE). orden_compra_id, project_id, moneda, numero_factura y las
--   fechas se reescriben con la política UPDATE (`edit`). UC (ver/crear/editar/eliminar):
--     UPDATE facturas_proveedor SET aprobada_por = …, orden_compra_id = NULL, project_id = <C2>,
--                                   numero_factura = 'REESCRITA', moneda = 'usd' WHERE id = <aprobada>;  → UPDATE 1
--   El seguimiento de la orden baja a «0 facturas / facturado 0» mientras cantidad_facturada sigue en 10 y el
--   asiento sigue publicado en el proyecto C1 y en la moneda original. Igual en la recepción registrada.
--
-- COMPORTAMIENTO ESPERADO (sesiones de usuario, incluido el administrador)
--   · Fuera de «registrada», la factura no cambia de empresa, proyecto, orden, proveedor, número, fechas,
--     moneda ni monto; fuera de «borrador», la recepción no cambia de empresa, proyecto, orden, tipo, fecha ni
--     número. Mientras la factura está «registrada» y la recepción en «borrador», todo se captura y corrige.
--   · Notas, concepto, guía de remisión y respaldos siguen editables; los pagos (trigger de sistema) siguen
--     moviendo estado y monto pagado; el ON DELETE SET NULL del motor (proyecto u orden que se eliminan) pasa.
--   · Adicional (VER-04-X1): al aprobar una factura con renglones, el total de la cabecera es el de sus renglones.
--
-- Prefijo de ids de este grupo: fa3HHKKK-… (HH = hallazgo, KKK = clase).
-- ============================================================================
\set C   '''cccccccc-cccc-cccc-cccc-cccccccccccc'''
\set C1  '''c1c1c1c1-0000-0000-0000-000000000001'''
\set C2  '''c2c2c2c2-0000-0000-0000-000000000001'''
\set UA  '''c0c0c0c0-0000-0000-0000-00000000000a'''
\set UC  '''c0c0c0c0-0000-0000-0000-00000000000c'''
\set UQ  '''c0c0c0c0-0000-0000-0000-00000000001a'''
\set US  '''c0c0c0c0-0000-0000-0000-00000000001b'''
\set P1  '''e3000000-0000-0000-0000-000000000001'''

-- ═══ Preparación con los actores REALES: UA orden y factura · US recibe · UQ aprueba ═══
SELECT public.como(:UA::uuid);
SET ROLE authenticated;
SELECT public.ce_oc('fa304100-0000-0000-0000-000000000001', 'fa304110-0000-0000-0000-000000000001', :P1::uuid, 'servicio', 10, 100, 0);
SELECT public.ce_recepcion('fa304200-0000-0000-0000-000000000001', 'fa304100-0000-0000-0000-000000000001', 'fa304110-0000-0000-0000-000000000001', 10, 'servicio');
SELECT public.como(:US::uuid);
UPDATE public.recepciones SET estado = 'registrada' WHERE id = 'fa304200-0000-0000-0000-000000000001';
SELECT public.como(:UA::uuid);
SELECT public.ce_factura('fa304300-0000-0000-0000-000000000001', 'fa304100-0000-0000-0000-000000000001', 'fa304110-0000-0000-0000-000000000001', :P1::uuid, 'FA3-VER04-1', 10, 100, 0);
SELECT public.como(:UQ::uuid);
UPDATE public.facturas_proveedor SET estado = 'aprobada' WHERE id = 'fa304300-0000-0000-0000-000000000001';
SELECT public.como(:UA::uuid);
CREATE TEMP TABLE fa3_seg AS
  SELECT (public.compras_seguimiento_orden('fa304100-0000-0000-0000-000000000001')->'indicadores'->>'facturado')::numeric AS facturado,
         jsonb_array_length(public.compras_seguimiento_orden('fa304100-0000-0000-0000-000000000001')->'facturas') AS n_facturas;
GRANT SELECT ON fa3_seg TO authenticated;
RESET ROLE;
SELECT public.chk_num((SELECT facturado FROM fa3_seg), 1000, '[VER-04a] preparación: el seguimiento de la orden dice facturado 1 000');
SELECT public.chk((SELECT n_facturas FROM fa3_seg), 1, '[VER-04a] preparación: y una factura');
SELECT public.chk((SELECT count(*) FROM public.conta_asientos WHERE origen_id = 'fa304300-0000-0000-0000-000000000001' AND estado = 'publicado' AND project_id = 'c1c1c1c1-0000-0000-0000-000000000001'), 1,
  '[VER-04a] preparación: el asiento de la factura está publicado en C1');

-- ═══ (a) La sentencia del revisor, tal cual, como UC; y cada columna por separado ═══
SELECT public.como(:UC::uuid);
SET ROLE authenticated;
SELECT public.chk_falla($$ UPDATE public.facturas_proveedor
       SET aprobada_por = 'c0c0c0c0-0000-0000-0000-00000000001b', orden_compra_id = NULL, project_id = 'c2c2c2c2-0000-0000-0000-000000000001',
           numero_factura = 'REESCRITA', moneda = 'usd'
     WHERE id = 'fa304300-0000-0000-0000-000000000001' $$,
  'COMPRAS_FACTURA_IDENTIDAD|COMPRAS_SELLO_FIJO', '[VER-04a] la sentencia del revisor (desvincular, cambiar de proyecto, moneda y número) se rechaza');
SELECT public.chk_falla($$ UPDATE public.facturas_proveedor SET orden_compra_id = NULL WHERE id = 'fa304300-0000-0000-0000-000000000001' $$,
  'COMPRAS_FACTURA_IDENTIDAD', '[VER-04a] la factura aprobada no se desvincula de su orden');
SELECT public.chk_falla($$ UPDATE public.facturas_proveedor SET project_id = 'c2c2c2c2-0000-0000-0000-000000000001' WHERE id = 'fa304300-0000-0000-0000-000000000001' $$,
  'COMPRAS_FACTURA_IDENTIDAD|COMPRAS_FACTURA_ORDEN_AJENA', '[VER-04a] ni cambia de proyecto (el asiento seguiría en C1; mientras sigue ligada a su orden ya lo frenaba COMPRAS_FACTURA_ORDEN_AJENA)');
SELECT public.chk_falla($$ UPDATE public.facturas_proveedor SET moneda = 'usd' WHERE id = 'fa304300-0000-0000-0000-000000000001' $$,
  'COMPRAS_FACTURA_IDENTIDAD', '[VER-04a] ni de moneda');
SELECT public.chk_falla($$ UPDATE public.facturas_proveedor SET numero_factura = 'REESCRITA' WHERE id = 'fa304300-0000-0000-0000-000000000001' $$,
  'COMPRAS_FACTURA_IDENTIDAD', '[VER-04a] ni de número');
SELECT public.chk_falla($$ UPDATE public.facturas_proveedor SET fecha_emision = '2000-01-01' WHERE id = 'fa304300-0000-0000-0000-000000000001' $$,
  'COMPRAS_FACTURA_IDENTIDAD', '[VER-04a] ni de fecha de emisión');
SELECT public.chk_falla($$ UPDATE public.facturas_proveedor SET fecha_vencimiento = '2030-01-01' WHERE id = 'fa304300-0000-0000-0000-000000000001' $$,
  'COMPRAS_FACTURA_IDENTIDAD', '[VER-04a] ni de fecha de vencimiento');
SELECT public.como(:UQ::uuid);
SELECT public.chk_falla($$ UPDATE public.facturas_proveedor SET orden_compra_id = NULL WHERE id = 'fa304300-0000-0000-0000-000000000001' $$,
  'COMPRAS_FACTURA_IDENTIDAD', '[VER-04a] quien autoriza tampoco la desvincula');
SELECT public.como(:UA::uuid);
SELECT public.chk_falla($$ UPDATE public.facturas_proveedor SET orden_compra_id = NULL, project_id = 'c2c2c2c2-0000-0000-0000-000000000001' WHERE id = 'fa304300-0000-0000-0000-000000000001' $$,
  'COMPRAS_FACTURA_IDENTIDAD', '[VER-04a] ni el ADMINISTRADOR');
RESET ROLE;

-- ═══ (b) Nada se desalineó ══════════════════════════════════════════════════════
SELECT public.chk((SELECT count(*) FROM public.facturas_proveedor
                    WHERE id = 'fa304300-0000-0000-0000-000000000001' AND estado = 'aprobada'
                      AND orden_compra_id = 'fa304100-0000-0000-0000-000000000001' AND project_id = 'c1c1c1c1-0000-0000-0000-000000000001'
                      AND moneda IS NULL AND numero_factura = 'FA3-VER04-1'), 1,
  '[VER-04b] la factura sigue aprobada, con su orden, su proyecto, su moneda y su número');
SELECT public.como(:UA::uuid);
SET ROLE authenticated;
SELECT public.chk_num((public.compras_seguimiento_orden('fa304100-0000-0000-0000-000000000001')->'indicadores'->>'facturado')::numeric, 1000,
  '[VER-04b] y el seguimiento de la orden sigue diciendo facturado 1 000');
SELECT public.chk((jsonb_array_length(public.compras_seguimiento_orden('fa304100-0000-0000-0000-000000000001')->'facturas')), 1,
  '[VER-04b] con su factura');
RESET ROLE;
SELECT public.chk_num((SELECT cantidad_facturada FROM public.orden_compra_lineas WHERE id = 'fa304110-0000-0000-0000-000000000001'), 10,
  '[VER-04b] y lo facturado de la línea sigue en 10');

-- ═══ (c) Con pagos: la identidad sigue fija y el pago (trigger de sistema) sigue funcionando ═══
SELECT public.como(:UA::uuid);
SET ROLE authenticated;
SELECT public.ce_oc('fa304100-0000-0000-0000-000000000002', 'fa304110-0000-0000-0000-000000000002', :P1::uuid, 'servicio', 1, 600, 0);
SELECT public.ce_recepcion('fa304200-0000-0000-0000-000000000002', 'fa304100-0000-0000-0000-000000000002', 'fa304110-0000-0000-0000-000000000002', 1, 'servicio');
UPDATE public.recepciones SET estado = 'registrada' WHERE id = 'fa304200-0000-0000-0000-000000000002';
SELECT public.ce_factura('fa304300-0000-0000-0000-000000000002', 'fa304100-0000-0000-0000-000000000002', 'fa304110-0000-0000-0000-000000000002', :P1::uuid, 'FA3-VER04-2', 1, 600, 0);
UPDATE public.facturas_proveedor SET estado = 'aprobada' WHERE id = 'fa304300-0000-0000-0000-000000000002';
INSERT INTO public.ordenes_pago (id, company_id, project_id, proveedor_id, factura_id, monto)
VALUES ('fa304400-0000-0000-0000-000000000002', :C::uuid, :C1::uuid, :P1::uuid, 'fa304300-0000-0000-0000-000000000002', 250);
SELECT public.como(:UQ::uuid);
UPDATE public.ordenes_pago SET estado = 'aprobada' WHERE id = 'fa304400-0000-0000-0000-000000000002';
SELECT public.como(:US::uuid);
UPDATE public.ordenes_pago SET estado = 'pagada', fecha_pago = CURRENT_DATE WHERE id = 'fa304400-0000-0000-0000-000000000002';
RESET ROLE;
SELECT public.chk_txt((SELECT estado FROM public.facturas_proveedor WHERE id = 'fa304300-0000-0000-0000-000000000002'), 'pagada_parcial',
  '[VER-04c] preparación: la factura queda «pagada parcial»');
SELECT public.como(:UC::uuid);
SET ROLE authenticated;
SELECT public.chk_falla($$ UPDATE public.facturas_proveedor SET numero_factura = 'FA3-VER04-2-B' WHERE id = 'fa304300-0000-0000-0000-000000000002' $$,
  'COMPRAS_FACTURA_IDENTIDAD', '[VER-04c] con un pago aplicado, el número tampoco cambia');
SELECT public.chk_falla($$ UPDATE public.facturas_proveedor SET orden_compra_id = NULL WHERE id = 'fa304300-0000-0000-0000-000000000002' $$,
  'COMPRAS_FACTURA_IDENTIDAD', '[VER-04c] ni se desvincula de la orden');
SELECT public.chk_falla($$ UPDATE public.facturas_proveedor SET moneda = 'usd' WHERE id = 'fa304300-0000-0000-0000-000000000002' $$,
  'COMPRAS_FACTURA_IDENTIDAD', '[VER-04c] ni cambia de moneda');
-- El resto del pago sigue su curso: lo mueve el trigger de sistema, sin pasar por esta guarda.
SELECT public.como(:UA::uuid);
INSERT INTO public.ordenes_pago (id, company_id, project_id, proveedor_id, factura_id, monto)
VALUES ('fa304400-0000-0000-0000-000000000003', :C::uuid, :C1::uuid, :P1::uuid, 'fa304300-0000-0000-0000-000000000002', 350);
SELECT public.como(:UQ::uuid);
UPDATE public.ordenes_pago SET estado = 'aprobada' WHERE id = 'fa304400-0000-0000-0000-000000000003';
SELECT public.como(:US::uuid);
UPDATE public.ordenes_pago SET estado = 'pagada', fecha_pago = CURRENT_DATE WHERE id = 'fa304400-0000-0000-0000-000000000003';
RESET ROLE;
SELECT public.chk_txt((SELECT estado FROM public.facturas_proveedor WHERE id = 'fa304300-0000-0000-0000-000000000002'), 'pagada',
  '[VER-04c] LEGÍTIMO: el segundo pago la deja «pagada» (el trigger de pago actualiza estado y monto pagado)');
SELECT public.chk_num((SELECT monto_pagado FROM public.facturas_proveedor WHERE id = 'fa304300-0000-0000-0000-000000000002'), 600,
  '[VER-04c] LEGÍTIMO: y pagado 600');
SELECT public.como(:UA::uuid);
SET ROLE authenticated;
SELECT public.chk_falla($$ UPDATE public.facturas_proveedor SET project_id = 'c2c2c2c2-0000-0000-0000-000000000001' WHERE id = 'fa304300-0000-0000-0000-000000000002' $$,
  'COMPRAS_FACTURA_IDENTIDAD|COMPRAS_FACTURA_ORDEN_AJENA', '[VER-04c] una factura pagada tampoco cambia de proyecto (ni el administrador)');
RESET ROLE;

-- ═══ (d) Mientras es «registrada» la identidad se captura y corrige; el asiento sigue lo APROBADO ═══
--   Gasto directo (sin orden): se corrige número, fechas y proyecto antes de aprobar; después, fijos.
SELECT public.como(:UA::uuid);
SET ROLE authenticated;
INSERT INTO public.facturas_proveedor (id, company_id, project_id, proveedor_id, numero_factura, concepto, monto_total)
VALUES ('fa304300-0000-0000-0000-000000000003', :C::uuid, :C1::uuid, :P1::uuid, 'FA3-VER04-3', 'Gasto directo', 500);
SELECT public.como(:UC::uuid);
UPDATE public.facturas_proveedor
   SET numero_factura = 'FA3-VER04-3B', fecha_emision = '2026-01-15', fecha_vencimiento = '2026-02-15', project_id = :C2::uuid, concepto = 'Gasto directo corregido'
 WHERE id = 'fa304300-0000-0000-0000-000000000003';
SELECT public.como(:UQ::uuid);
UPDATE public.facturas_proveedor SET estado = 'aprobada' WHERE id = 'fa304300-0000-0000-0000-000000000003';
RESET ROLE;
SELECT public.chk((SELECT count(*) FROM public.facturas_proveedor
                    WHERE id = 'fa304300-0000-0000-0000-000000000003' AND estado = 'aprobada' AND numero_factura = 'FA3-VER04-3B'
                      AND project_id = 'c2c2c2c2-0000-0000-0000-000000000001' AND fecha_vencimiento = '2026-02-15'), 1,
  '[VER-04d] LEGÍTIMO: mientras era «registrada» se corrigieron número, fechas y proyecto, y se aprobó');
SELECT public.chk((SELECT count(*) FROM public.conta_asientos WHERE origen_id = 'fa304300-0000-0000-0000-000000000003' AND estado = 'publicado' AND project_id = 'c2c2c2c2-0000-0000-0000-000000000001'), 1,
  '[VER-04d] LEGÍTIMO: y el asiento se publicó en el proyecto con el que se aprobó (C2)');
SELECT public.como(:UC::uuid);
SET ROLE authenticated;
SELECT public.chk_falla($$ UPDATE public.facturas_proveedor SET project_id = 'c1c1c1c1-0000-0000-0000-000000000001' WHERE id = 'fa304300-0000-0000-0000-000000000003' $$,
  'COMPRAS_FACTURA_IDENTIDAD', '[VER-04d] ya aprobada, ya no se mueve de proyecto');
SELECT public.chk_falla($$ UPDATE public.facturas_proveedor SET numero_factura = 'OTRO' WHERE id = 'fa304300-0000-0000-0000-000000000003' $$,
  'COMPRAS_FACTURA_IDENTIDAD', '[VER-04d] ni de número');
UPDATE public.facturas_proveedor SET concepto = 'Concepto ajustado después', notas = 'seguimiento' WHERE id = 'fa304300-0000-0000-0000-000000000003';
RESET ROLE;
SELECT public.chk_txt((SELECT concepto FROM public.facturas_proveedor WHERE id = 'fa304300-0000-0000-0000-000000000003'), 'Concepto ajustado después',
  '[VER-04d] LEGÍTIMO: concepto y notas de una factura aprobada siguen siendo editables (no son identidad)');

-- ═══ (e) RECEPCIÓN registrada: no se reasigna a otra orden ni cambia fecha, número ni tipo ═══
SELECT public.como(:UA::uuid);
SET ROLE authenticated;
SELECT public.ce_oc('fa304100-0000-0000-0000-000000000004', 'fa304110-0000-0000-0000-000000000004', :P1::uuid, 'servicio', 10, 100, 0);
SELECT public.ce_oc('fa304100-0000-0000-0000-000000000005', 'fa304110-0000-0000-0000-000000000005', :P1::uuid, 'servicio', 10, 100, 0);
SELECT public.ce_recepcion('fa304200-0000-0000-0000-000000000004', 'fa304100-0000-0000-0000-000000000004', 'fa304110-0000-0000-0000-000000000004', 4, 'servicio');
SELECT public.como(:US::uuid);
UPDATE public.recepciones SET estado = 'registrada' WHERE id = 'fa304200-0000-0000-0000-000000000004';
SELECT public.como(:UC::uuid);
SELECT public.chk_falla($$ UPDATE public.recepciones SET orden_compra_id = 'fa304100-0000-0000-0000-000000000005' WHERE id = 'fa304200-0000-0000-0000-000000000004' $$,
  'COMPRAS_RECEPCION_IDENTIDAD', '[VER-04e] una recepción registrada no se reasigna a otra orden (lo recibido quedaría en la orden equivocada)');
SELECT public.chk_falla($$ UPDATE public.recepciones SET fecha = '2000-01-01' WHERE id = 'fa304200-0000-0000-0000-000000000004' $$,
  'COMPRAS_RECEPCION_IDENTIDAD', '[VER-04e] ni cambia de fecha (el asiento ya tiene la suya)');
SELECT public.chk_falla($$ UPDATE public.recepciones SET numero = 'REC-999999' WHERE id = 'fa304200-0000-0000-0000-000000000004' $$,
  'COMPRAS_RECEPCION_IDENTIDAD', '[VER-04e] ni de número');
SELECT public.chk_falla($$ UPDATE public.recepciones SET tipo = 'bienes' WHERE id = 'fa304200-0000-0000-0000-000000000004' $$,
  'COMPRAS_RECEPCION_IDENTIDAD', '[VER-04e] ni de tipo (servicio → bienes)');
SELECT public.chk_falla($$ UPDATE public.recepciones SET project_id = 'c2c2c2c2-0000-0000-0000-000000000001' WHERE id = 'fa304200-0000-0000-0000-000000000004' $$,
  'COMPRAS_RECEPCION_IDENTIDAD|COMPRAS_RECEPCION_ORDEN_AJENA', '[VER-04e] ni de proyecto');
SELECT public.como(:UA::uuid);
SELECT public.chk_falla($$ UPDATE public.recepciones SET orden_compra_id = 'fa304100-0000-0000-0000-000000000005' WHERE id = 'fa304200-0000-0000-0000-000000000004' $$,
  'COMPRAS_RECEPCION_IDENTIDAD', '[VER-04e] ni el ADMINISTRADOR');
RESET ROLE;
SELECT public.chk_num((SELECT cantidad_recibida FROM public.orden_compra_lineas WHERE id = 'fa304110-0000-0000-0000-000000000004'), 4,
  '[VER-04e] lo recibido sigue en la orden original (4)');
SELECT public.chk_num((SELECT cantidad_recibida FROM public.orden_compra_lineas WHERE id = 'fa304110-0000-0000-0000-000000000005'), 0,
  '[VER-04e] y la otra orden sigue sin recibir nada');
-- Lo legítimo: notas y guía de la registrada; la fecha de un BORRADOR; registrar y anular siguen igual.
SELECT public.como(:UC::uuid);
SET ROLE authenticated;
UPDATE public.recepciones SET notas = 'recibido en bodega 2', documento_referencia = 'GUÍA-88' WHERE id = 'fa304200-0000-0000-0000-000000000004';
SELECT public.como(:UA::uuid);
SELECT public.ce_recepcion('fa304200-0000-0000-0000-000000000005', 'fa304100-0000-0000-0000-000000000004', 'fa304110-0000-0000-0000-000000000004', 2, 'servicio');
UPDATE public.recepciones SET fecha = '2026-03-01' WHERE id = 'fa304200-0000-0000-0000-000000000005';
SELECT public.como(:US::uuid);
UPDATE public.recepciones SET estado = 'registrada' WHERE id = 'fa304200-0000-0000-0000-000000000005';
UPDATE public.recepciones SET estado = 'anulada', motivo_anulacion = 'prueba' WHERE id = 'fa304200-0000-0000-0000-000000000005';
RESET ROLE;
SELECT public.chk_txt((SELECT documento_referencia FROM public.recepciones WHERE id = 'fa304200-0000-0000-0000-000000000004'), 'GUÍA-88',
  '[VER-04e] LEGÍTIMO: la guía de una recepción registrada sigue siendo editable');
SELECT public.chk_txt((SELECT fecha::text FROM public.recepciones WHERE id = 'fa304200-0000-0000-0000-000000000005'), '2026-03-01',
  '[VER-04e] LEGÍTIMO: la fecha de un borrador se corrige antes de registrar');
SELECT public.chk_txt((SELECT estado FROM public.recepciones WHERE id = 'fa304200-0000-0000-0000-000000000005'), 'anulada',
  '[VER-04e] LEGÍTIMO: registrar y anular siguen funcionando');
SELECT public.chk_num((SELECT cantidad_recibida FROM public.orden_compra_lineas WHERE id = 'fa304110-0000-0000-0000-000000000004'), 4,
  '[VER-04e] LEGÍTIMO: la anulación de esa segunda recepción devolvió lo suyo (queda 4)');

-- ═══ (f) El ON DELETE SET NULL del motor no se bloquea (proyecto y orden que se eliminan) ═══
--   Una factura aprobada sin asiento (contabilización pendiente) ligada a un proyecto efímero y a una orden en
--   borrador. Una sesión con usuario (UA) elimina el proyecto y la orden; las referencias quedan en NULL.
SELECT set_config('request.jwt.claim.sub', '', false);
INSERT INTO public.companies (id, nombre, default_currency) VALUES ('fa304900-0000-0000-0000-000000000001', 'Empresa FA3-04 efímera', 'gtq');
INSERT INTO public.projects (id, company_id, nombre) VALUES ('fa304910-0000-0000-0000-000000000001', 'fa304900-0000-0000-0000-000000000001', 'Proyecto FA3-04 efímero');
INSERT INTO public.proveedores (id, company_id, nombre, nit, pais, alcance) VALUES
  ('fa304920-0000-0000-0000-000000000001', 'fa304900-0000-0000-0000-000000000001', 'Proveedor efímero 04', '8304001-1', 'GT', 'empresa');
INSERT INTO public.facturas_proveedor (id, company_id, project_id, proveedor_id, numero_factura, concepto, monto_total, estado, aprobada_at)
VALUES ('fa304300-0000-0000-0000-000000000009', 'fa304900-0000-0000-0000-000000000001', 'fa304910-0000-0000-0000-000000000001', 'fa304920-0000-0000-0000-000000000001',
        'FA3-04-EFIMERA', 'aprobada con contabilización pendiente', 100, 'aprobada', now());
SELECT public.como(:UA::uuid);
DELETE FROM public.projects WHERE id = 'fa304910-0000-0000-0000-000000000001';
SELECT public.chk((SELECT count(*) FROM public.facturas_proveedor WHERE id = 'fa304300-0000-0000-0000-000000000009' AND project_id IS NULL AND estado = 'aprobada'), 1,
  '[VER-04f] LEGÍTIMO: eliminar un proyecto deja project_id en NULL en la factura aprobada (el motor, no una persona)');
-- Orden en borrador (jamás aprobada: se puede eliminar) con una factura aprobada ligada.
SELECT set_config('request.jwt.claim.sub', '', false);
INSERT INTO public.ordenes_compra (id, company_id, project_id, proveedor_id, proveedor_nombre, concepto)
VALUES ('fa304100-0000-0000-0000-000000000009', :C::uuid, :C1::uuid, :P1::uuid, 'Proveedor', 'Borrador con factura ligada');
INSERT INTO public.facturas_proveedor (id, company_id, project_id, proveedor_id, orden_compra_id, numero_factura, concepto, monto_total, estado, aprobada_at)
VALUES ('fa304300-0000-0000-0000-000000000008', :C::uuid, :C1::uuid, :P1::uuid, 'fa304100-0000-0000-0000-000000000009',
        'FA3-04-LIGADA', 'aprobada ligada a un borrador', 100, 'aprobada', now());
SELECT public.como(:UA::uuid);
DELETE FROM public.ordenes_compra WHERE id = 'fa304100-0000-0000-0000-000000000009';
SELECT public.chk((SELECT count(*) FROM public.facturas_proveedor WHERE id = 'fa304300-0000-0000-0000-000000000008' AND orden_compra_id IS NULL AND estado = 'aprobada'), 1,
  '[VER-04f] LEGÍTIMO: eliminar la orden en borrador deja orden_compra_id en NULL en la factura ligada (el motor, no una persona)');
SELECT set_config('request.jwt.claim.sub', '', false);
DELETE FROM public.companies WHERE id = 'fa304900-0000-0000-0000-000000000001';

-- ═══ (g) VER-04-X1 · al aprobar, el total de la cabecera es el de los renglones ═══════════
--   UC deja monto_total = 1 en una factura de 400 (registrada: se puede editar); quien aprueba la aprueba sin saberlo.
SELECT public.como(:UA::uuid);
SET ROLE authenticated;
SELECT public.ce_oc('fa304100-0000-0000-0000-000000000006', 'fa304110-0000-0000-0000-000000000006', :P1::uuid, 'servicio', 4, 100, 0);
SELECT public.ce_recepcion('fa304200-0000-0000-0000-000000000006', 'fa304100-0000-0000-0000-000000000006', 'fa304110-0000-0000-0000-000000000006', 4, 'servicio');
UPDATE public.recepciones SET estado = 'registrada' WHERE id = 'fa304200-0000-0000-0000-000000000006';
SELECT public.ce_factura('fa304300-0000-0000-0000-000000000006', 'fa304100-0000-0000-0000-000000000006', 'fa304110-0000-0000-0000-000000000006', :P1::uuid, 'FA3-VER04-6', 4, 100, 0);
SELECT public.como(:UC::uuid);
UPDATE public.facturas_proveedor SET monto_total = 1 WHERE id = 'fa304300-0000-0000-0000-000000000006';
SELECT public.como(:UQ::uuid);
SELECT public.chk_falla($$ UPDATE public.facturas_proveedor SET estado = 'aprobada' WHERE id = 'fa304300-0000-0000-0000-000000000006' $$,
  'COMPRAS_FACTURA_TOTAL_DESCUADRADO', '[VER-04g] no se aprueba una factura cuya cabecera (1) no es la suma de sus renglones (400)');
SELECT public.chk_falla($$ UPDATE public.facturas_proveedor SET estado = 'aprobada', monto_total = 1 WHERE id = 'fa304300-0000-0000-0000-000000000006' $$,
  'COMPRAS_FACTURA_TOTAL_DESCUADRADO', '[VER-04g] ni cuando el total se manipula en la misma sentencia que la aprueba');
RESET ROLE;
SELECT public.chk_txt((SELECT estado FROM public.facturas_proveedor WHERE id = 'fa304300-0000-0000-0000-000000000006'), 'registrada',
  '[VER-04g] la factura sigue registrada (nada se contabilizó)');
SELECT public.chk((SELECT count(*) FROM public.conta_asientos WHERE origen_id = 'fa304300-0000-0000-0000-000000000006'), 0,
  '[VER-04g] y no hay asiento');
SELECT public.como(:UC::uuid);
SET ROLE authenticated;
UPDATE public.facturas_proveedor SET monto_total = 400 WHERE id = 'fa304300-0000-0000-0000-000000000006';
SELECT public.como(:UQ::uuid);
UPDATE public.facturas_proveedor SET estado = 'aprobada' WHERE id = 'fa304300-0000-0000-0000-000000000006';
RESET ROLE;
SELECT public.chk_num((SELECT monto_total FROM public.facturas_proveedor WHERE id = 'fa304300-0000-0000-0000-000000000006'), 400,
  '[VER-04g] LEGÍTIMO: corregido el total, la factura se aprueba por 400');
SELECT public.chk_num((SELECT total_debe FROM public.conta_asientos WHERE origen_id = 'fa304300-0000-0000-0000-000000000006' AND origen_evento = 'factura_prov_aprobada'), 400,
  '[VER-04g] LEGÍTIMO: y el asiento es por 400, igual que la cuenta por pagar');

-- ═══ (h) VER-04-X2 · la CATEGORÍA decide la cuenta de gasto del devengo: con asiento publicado no se reclasifica ═══
--   fa304300-…-01 está aprobada y con su asiento publicado (preparación). Reclasificar su categoría con `edit`
--   dejaría la factura en una categoría y el libro en otra cuenta. Una aprobada SIN asiento (contabilización
--   pendiente) sigue pudiéndose reclasificar: el reproceso relee la categoría.
SELECT public.como(:UC::uuid);
SET ROLE authenticated;
SELECT public.chk_falla($$ UPDATE public.facturas_proveedor SET categoria = 'mantenimiento' WHERE id = 'fa304300-0000-0000-0000-000000000001' $$,
  'COMPRAS_FACTURA_IDENTIDAD', '[VER-04h] la categoría de una factura con asiento publicado no se reclasifica (el libro quedaría en otra cuenta)');
SELECT public.como(:UA::uuid);
SELECT public.chk_falla($$ UPDATE public.facturas_proveedor SET categoria = 'mantenimiento' WHERE id = 'fa304300-0000-0000-0000-000000000001' $$,
  'COMPRAS_FACTURA_IDENTIDAD', '[VER-04h] ni el ADMINISTRADOR');
RESET ROLE;
SELECT public.chk_txt((SELECT categoria FROM public.facturas_proveedor WHERE id = 'fa304300-0000-0000-0000-000000000001'), 'otros',
  '[VER-04h] la categoría sigue siendo «otros», la del asiento');
-- Aprobada sin asiento (se inserta por el camino de sistema, como un dato anterior): sigue reclasificable.
SELECT set_config('request.jwt.claim.sub', '', false);
INSERT INTO public.facturas_proveedor (id, company_id, project_id, proveedor_id, numero_factura, concepto, monto_total, estado, aprobada_at)
VALUES ('fa304300-0000-0000-0000-00000000000a', :C::uuid, :C1::uuid, :P1::uuid, 'FA3-04-PENDIENTE', 'aprobada sin asiento (contabilización pendiente)', 100, 'aprobada', now());
SELECT public.chk((SELECT count(*) FROM public.conta_asientos WHERE origen_id = 'fa304300-0000-0000-0000-00000000000a'), 0,
  '[VER-04h] preparación: la aprobada pendiente no tiene asiento');
SELECT public.como(:UC::uuid);
SET ROLE authenticated;
UPDATE public.facturas_proveedor SET categoria = 'servicios' WHERE id = 'fa304300-0000-0000-0000-00000000000a';
RESET ROLE;
SELECT public.chk_txt((SELECT categoria FROM public.facturas_proveedor WHERE id = 'fa304300-0000-0000-0000-00000000000a'), 'servicios',
  '[VER-04h] LEGÍTIMO: sin asiento publicado, la categoría de una aprobada pendiente se corrige (el reproceso la relee)');
-- Un proceso sin sesión de usuario (reclasificación de mantenimiento) conserva su camino.
SELECT set_config('request.jwt.claim.sub', '', false);
UPDATE public.facturas_proveedor SET categoria = 'obras' WHERE id = 'fa304300-0000-0000-0000-000000000003';
SELECT public.chk_txt((SELECT categoria FROM public.facturas_proveedor WHERE id = 'fa304300-0000-0000-0000-000000000003'), 'obras',
  '[VER-04h] LEGÍTIMO: un proceso sin sesión de usuario (servicio / mantenimiento) conserva el camino de sistema');
