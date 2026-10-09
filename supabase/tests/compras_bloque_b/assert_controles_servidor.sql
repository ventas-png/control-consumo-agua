\set ON_ERROR_STOP on

-- ============================================================================
-- INVARIANTES · CONTROLES DE SERVIDOR DEL CIRCUITO DE COMPRAS (20261027000000…0700)
-- (el cierre de la revisión adversarial, 20261027000800, tiene sus pruebas en hallazgos/, una por hallazgo)
--
--   1. Aislamiento: ninguna referencia del circuito (proveedor, proyecto, cabecera, cuenta, factura)
--      cruza empresas ni contabilidades, ni siquiera para un administrador. (Activos fijos, gastos y la
--      obra de la orden —EV-10— y los mensajes de error previos a la RLS —EV-09— los cubre 0800.)
--   2. Pagos: solo se paga una factura aprobada, del mismo proveedor y contabilidad,
--      hasta su saldo; máquina de estados; sellos del servidor; reintentos.
--   3. Sin borrado: lo que tuvo efecto se anula, no se borra; la purga en cascada de una
--      empresa o proyecto sigue funcionando.
--   4. Permisos por acción: aprobar, emitir, recibir (registrar), contabilizar y pagar
--      exigen su permiso; nacer en el estado inicial; los estados derivados son del sistema.
--   5. Duplicados: el proveedor reescrito y la factura con otro formato de número.
--   6. Trazabilidad de los cambios a una orden después de aprobarla.
--   7. Inventario: ni aprobar la orden ni cargar la factura mueven existencias.
--
-- Cada control se prueba EN ROJO (sin la migración el caso pasaría) y EN VERDE (el caso
-- legítimo sigue funcionando). Un rechazo por el motivo equivocado es un falso verde: cada
-- chk_falla exige el código esperado.
-- ============================================================================
\set C   '''cccccccc-cccc-cccc-cccc-cccccccccccc'''
\set C1  '''c1c1c1c1-0000-0000-0000-000000000001'''
\set C2  '''c2c2c2c2-0000-0000-0000-000000000001'''
\set D   '''dddddddd-dddd-dddd-dddd-dddddddddddd'''
\set D1  '''d1d1d1d1-0000-0000-0000-000000000001'''
\set UA  '''c0c0c0c0-0000-0000-0000-00000000000a'''
\set UC  '''c0c0c0c0-0000-0000-0000-00000000000c'''
\set UO  '''c0c0c0c0-0000-0000-0000-00000000000d'''
\set UD  '''d0d0d0d0-0000-0000-0000-00000000000d'''
\set UQ  '''c0c0c0c0-0000-0000-0000-00000000001a'''
\set US  '''c0c0c0c0-0000-0000-0000-00000000001b'''
\set P1  '''e3000000-0000-0000-0000-000000000001'''
\set P2  '''e3000000-0000-0000-0000-000000000002'''
\set PD  '''e3000000-0000-0000-0000-0000000000d1'''
\set S1  '''50000000-0000-0000-0000-0000000000c1'''

-- ── Ayudas (se ejecutan con la sesión que las llama: SECURITY INVOKER) ──────
-- Orden de servicio: una línea de `p_cant` × `p_precio` (+ IVA), aprobada y emitida.
CREATE OR REPLACE FUNCTION public.ce_oc(p_oc uuid, p_linea uuid, p_prov uuid, p_destino text, p_cant numeric,
                                        p_precio numeric, p_iva numeric DEFAULT 0, p_sum uuid DEFAULT NULL,
                                        p_emitir boolean DEFAULT true)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO public.ordenes_compra (id, company_id, project_id, proveedor_id, proveedor_nombre, concepto)
  VALUES (p_oc, 'cccccccc-cccc-cccc-cccc-cccccccccccc', 'c1c1c1c1-0000-0000-0000-000000000001', p_prov, 'Proveedor CE', 'CE ' || p_oc);
  INSERT INTO public.orden_compra_lineas (id, company_id, orden_compra_id, linea, descripcion, destino_tipo, suministro_id,
                                          categoria, cantidad, unidad, precio_unitario, iva_monto)
  VALUES (p_linea, 'cccccccc-cccc-cccc-cccc-cccccccccccc', p_oc, 1, 'Renglón CE', p_destino, p_sum,
          CASE p_destino WHEN 'servicio' THEN 'servicios' ELSE 'limpieza' END, p_cant,
          CASE p_destino WHEN 'servicio' THEN 'servicio' ELSE 'litro' END, p_precio, p_iva);
  UPDATE public.ordenes_compra SET estado = 'aprobada' WHERE id = p_oc;
  IF p_emitir THEN
    UPDATE public.ordenes_compra SET estado = 'emitida' WHERE id = p_oc;
  END IF;
END;
$$;

-- Recepción (borrador + línea). Se registra aparte: capturar y registrar son pasos distintos.
CREATE OR REPLACE FUNCTION public.ce_recepcion(p_rec uuid, p_oc uuid, p_linea uuid, p_cant numeric, p_tipo text)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO public.recepciones (id, company_id, project_id, orden_compra_id, tipo, recibido_por)
  VALUES (p_rec, 'cccccccc-cccc-cccc-cccc-cccccccccccc', 'c1c1c1c1-0000-0000-0000-000000000001', p_oc, p_tipo, auth.uid());
  INSERT INTO public.recepcion_lineas (company_id, recepcion_id, orden_compra_linea_id, cantidad)
  VALUES ('cccccccc-cccc-cccc-cccc-cccccccccccc', p_rec, p_linea, p_cant);
END;
$$;

-- Factura (registrada + renglón contra el de la orden).
CREATE OR REPLACE FUNCTION public.ce_factura(p_fac uuid, p_oc uuid, p_linea uuid, p_prov uuid, p_numero text,
                                             p_cant numeric, p_precio numeric, p_iva numeric DEFAULT 0)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO public.facturas_proveedor (id, company_id, project_id, proveedor_id, orden_compra_id, numero_factura, concepto, monto_total)
  VALUES (p_fac, 'cccccccc-cccc-cccc-cccc-cccccccccccc', 'c1c1c1c1-0000-0000-0000-000000000001', p_prov, p_oc, p_numero, 'Factura CE', 1);
  INSERT INTO public.factura_proveedor_lineas (company_id, factura_id, orden_compra_linea_id, linea, descripcion, cantidad, precio_unitario, iva_monto)
  VALUES ('cccccccc-cccc-cccc-cccc-cccccccccccc', p_fac, p_linea, 1, 'Renglón CE', p_cant, p_precio, p_iva);
END;
$$;

-- ── Padrón: dos perfiles con UN solo permiso de acción cada uno ─────────────
INSERT INTO auth.users (id) VALUES
  ('c0c0c0c0-0000-0000-0000-00000000001a'), ('c0c0c0c0-0000-0000-0000-00000000001b');
INSERT INTO public.app_users (id, company_id, full_name, role) VALUES
  ('c0c0c0c0-0000-0000-0000-00000000001a', 'cccccccc-cccc-cccc-cccc-cccccccccccc', 'CE Autoriza (approve)',        'operator'),
  ('c0c0c0c0-0000-0000-0000-00000000001b', 'cccccccc-cccc-cccc-cccc-cccccccccccc', 'CE Cambia estado (change_status)', 'operator');
INSERT INTO public.user_project_assignments (user_id, project_id, permission_type)
SELECT u, p, 'total'
  FROM unnest(ARRAY['c0c0c0c0-0000-0000-0000-00000000001a', 'c0c0c0c0-0000-0000-0000-00000000001b']::uuid[]) u,
       unnest(ARRAY['c1c1c1c1-0000-0000-0000-000000000001', 'c2c2c2c2-0000-0000-0000-000000000001']::uuid[]) p;
INSERT INTO public.roles (id, company_id, name) VALUES
  ('9b000000-0000-0000-0000-00000000001a', 'cccccccc-cccc-cccc-cccc-cccccccccccc', 'CE Autoriza'),
  ('9b000000-0000-0000-0000-00000000001b', 'cccccccc-cccc-cccc-cccc-cccccccccccc', 'CE Cambia estado');
INSERT INTO public.role_permissions (role_id, permission_key, effect) VALUES
  ('9b000000-0000-0000-0000-00000000001a', 'platform.contabilidad.view',    'allow'),
  ('9b000000-0000-0000-0000-00000000001a', 'platform.contabilidad.create',  'allow'),
  ('9b000000-0000-0000-0000-00000000001a', 'platform.contabilidad.edit',    'allow'),
  ('9b000000-0000-0000-0000-00000000001a', 'platform.contabilidad.approve', 'allow'),
  ('9b000000-0000-0000-0000-00000000001b', 'platform.contabilidad.view',          'allow'),
  ('9b000000-0000-0000-0000-00000000001b', 'platform.contabilidad.create',        'allow'),
  ('9b000000-0000-0000-0000-00000000001b', 'platform.contabilidad.edit',          'allow'),
  ('9b000000-0000-0000-0000-00000000001b', 'platform.contabilidad.change_status', 'allow');
INSERT INTO public.user_roles (user_id, role_id) VALUES
  ('c0c0c0c0-0000-0000-0000-00000000001a', '9b000000-0000-0000-0000-00000000001a'),
  ('c0c0c0c0-0000-0000-0000-00000000001b', '9b000000-0000-0000-0000-00000000001b');

-- ═══════════════════════════════════════════════════════════════════════════
-- 1 · AISLAMIENTO ENTRE EMPRESAS Y CONTABILIDADES
-- La empresa D tiene su proveedor (PD), su proyecto (D1), una orden en borrador y una
-- factura registrada. El administrador de C intenta tocarlas o referenciarlas.
-- ═══════════════════════════════════════════════════════════════════════════
SELECT public.como(:UD::uuid);
SET ROLE authenticated;
INSERT INTO public.ordenes_compra (id, company_id, project_id, proveedor_id, proveedor_nombre, concepto)
VALUES ('ce100000-0000-0000-0000-0000000000d1', :D::uuid, :D1::uuid, :PD::uuid, 'Proveedor de D', 'OC de D');
INSERT INTO public.orden_compra_lineas (id, company_id, orden_compra_id, linea, descripcion, destino_tipo, categoria, cantidad, unidad, precio_unitario)
VALUES ('ce110000-0000-0000-0000-0000000000d1', :D::uuid, 'ce100000-0000-0000-0000-0000000000d1', 1, 'Renglón de D', 'gasto', 'otros', 1, 'unidad', 50);
INSERT INTO public.facturas_proveedor (id, company_id, project_id, proveedor_id, numero_factura, concepto, monto_total)
VALUES ('ce300000-0000-0000-0000-0000000000d1', :D::uuid, :D1::uuid, :PD::uuid, 'FD-1', 'Factura de D', 100);
UPDATE public.facturas_proveedor SET estado = 'aprobada' WHERE id = 'ce300000-0000-0000-0000-0000000000d1';
INSERT INTO public.facturas_proveedor (id, company_id, project_id, proveedor_id, numero_factura, concepto, monto_total)
VALUES ('ce300000-0000-0000-0000-0000000000d2', :D::uuid, :D1::uuid, :PD::uuid, 'FD-2', 'Factura registrada de D', 70);
RESET ROLE;
SELECT public.chk_num((SELECT total FROM public.ordenes_compra WHERE id = 'ce100000-0000-0000-0000-0000000000d1'), 50, '1 · preparación: la orden de D vale 50');
SELECT public.chk_num((SELECT monto_total FROM public.facturas_proveedor WHERE id = 'ce300000-0000-0000-0000-0000000000d1'), 100, '1 · preparación: la factura de D vale 100');

SELECT public.como(:UA::uuid);
SET ROLE authenticated;
SELECT public.chk_falla($$ INSERT INTO public.ordenes_compra (company_id, project_id, proveedor_id, proveedor_nombre, concepto)
                           VALUES ('cccccccc-cccc-cccc-cccc-cccccccccccc','c1c1c1c1-0000-0000-0000-000000000001','e3000000-0000-0000-0000-0000000000d1','x','x') $$,
  'COMPRAS_ALCANCE_PROVEEDOR', '1a · una orden de C no lleva el proveedor de D');
SELECT public.chk_falla($$ INSERT INTO public.ordenes_compra (company_id, project_id, proveedor_id, proveedor_nombre, concepto)
                           VALUES ('cccccccc-cccc-cccc-cccc-cccccccccccc','d1d1d1d1-0000-0000-0000-000000000001','e3000000-0000-0000-0000-000000000001','x','x') $$,
  'COMPRAS_ALCANCE_PROYECTO', '1b · una orden de C no cuelga del proyecto de D');
SELECT public.chk_falla($$ INSERT INTO public.facturas_proveedor (company_id, project_id, proveedor_id, numero_factura, concepto, monto_total)
                           VALUES ('cccccccc-cccc-cccc-cccc-cccccccccccc','c1c1c1c1-0000-0000-0000-000000000001','e3000000-0000-0000-0000-0000000000d1','X-1','x',10) $$,
  'COMPRAS_ALCANCE_PROVEEDOR', '1c · una factura de C no lleva el proveedor de D');
SELECT public.chk_falla($$ INSERT INTO public.facturas_proveedor (company_id, project_id, proveedor_id, numero_factura, concepto, monto_total)
                           VALUES ('cccccccc-cccc-cccc-cccc-cccccccccccc','d1d1d1d1-0000-0000-0000-000000000001','e3000000-0000-0000-0000-000000000001','X-2','x',10) $$,
  'COMPRAS_ALCANCE_PROYECTO', '1c · ni el proyecto de D');
SELECT public.chk_falla($$ INSERT INTO public.contrasenas_pago (company_id, project_id, proveedor_id, fecha_pago_programada)
                           VALUES ('cccccccc-cccc-cccc-cccc-cccccccccccc','c1c1c1c1-0000-0000-0000-000000000001','e3000000-0000-0000-0000-0000000000d1', CURRENT_DATE) $$,
  'COMPRAS_ALCANCE_PROVEEDOR', '1d · una contraseña de C no lleva el proveedor de D');
SELECT public.chk_falla($$ INSERT INTO public.ordenes_pago (company_id, project_id, proveedor_id, factura_id, monto)
                           VALUES ('cccccccc-cccc-cccc-cccc-cccccccccccc','c1c1c1c1-0000-0000-0000-000000000001','e3000000-0000-0000-0000-0000000000d1','ce300000-0000-0000-0000-0000000000d1',100) $$,
  'COMPRAS_ALCANCE_PROVEEDOR', '1e · una orden de pago de C contra la factura de D (con el proveedor de D) se rechaza');
SELECT public.chk_falla($$ INSERT INTO public.ordenes_pago (company_id, project_id, proveedor_id, factura_id, monto)
                           VALUES ('cccccccc-cccc-cccc-cccc-cccccccccccc','c1c1c1c1-0000-0000-0000-000000000001','e3000000-0000-0000-0000-000000000001','ce300000-0000-0000-0000-0000000000d1',100) $$,
  'COMPRAS_PAGO_FACTURA_AJENA', '1e · y con un proveedor de C tampoco: la factura es de otra empresa');
-- Renglones sobre cabeceras AJENAS: antes se insertaban y recalculaban el total del documento de D.
SELECT public.chk_falla($$ INSERT INTO public.orden_compra_lineas (company_id, orden_compra_id, linea, descripcion, destino_tipo, categoria, cantidad, unidad, precio_unitario)
                           VALUES ('cccccccc-cccc-cccc-cccc-cccccccccccc','ce100000-0000-0000-0000-0000000000d1',2,'intrusa','gasto','otros',1,'unidad',1) $$,
  'COMPRAS_ALCANCE_RENGLON', '1f · un renglón de C no entra en la orden de D');
SELECT public.chk_falla($$ INSERT INTO public.factura_proveedor_lineas (company_id, factura_id, linea, descripcion, cantidad, precio_unitario)
                           VALUES ('cccccccc-cccc-cccc-cccc-cccccccccccc','ce300000-0000-0000-0000-0000000000d2',1,'intrusa',1,1) $$,
  'COMPRAS_ALCANCE_RENGLON', '1g · un renglón de C no entra en la factura (registrada) de D');
RESET ROLE;
SELECT public.chk_num((SELECT total FROM public.ordenes_compra WHERE id = 'ce100000-0000-0000-0000-0000000000d1'), 50, '1f · el total de la orden de D NO cambió');
SELECT public.chk_num((SELECT monto_total FROM public.facturas_proveedor WHERE id = 'ce300000-0000-0000-0000-0000000000d2'), 70, '1g · el monto de la factura de D NO cambió (antes: el renglón ajeno lo reescribía)');
SELECT public.chk_txt((SELECT estado || '/' || monto_pagado FROM public.facturas_proveedor WHERE id = 'ce300000-0000-0000-0000-0000000000d1'),
  'aprobada/0.00', '1e · la factura de D sigue aprobada y sin pagos');

-- Cuenta del renglón de factura: de la contabilidad de la factura, de detalle y activa.
CREATE TEMP TABLE ce_cta AS
SELECT (SELECT id FROM public.conta_cuentas WHERE company_id = 'cccccccc-cccc-cccc-cccc-cccccccccccc' AND project_id = 'c1c1c1c1-0000-0000-0000-000000000001' AND tipo = 'gasto' AND es_detalle AND activa ORDER BY codigo LIMIT 1) AS propia,
       (SELECT id FROM public.conta_cuentas WHERE company_id = 'cccccccc-cccc-cccc-cccc-cccccccccccc' AND project_id = 'c2c2c2c2-0000-0000-0000-000000000001' AND tipo = 'gasto' AND es_detalle AND activa ORDER BY codigo LIMIT 1) AS otro_proyecto,
       (SELECT id FROM public.conta_cuentas WHERE company_id = 'dddddddd-dddd-dddd-dddd-dddddddddddd' AND tipo = 'gasto' AND es_detalle AND activa ORDER BY codigo LIMIT 1) AS otra_empresa,
       (SELECT id FROM public.conta_cuentas WHERE company_id = 'cccccccc-cccc-cccc-cccc-cccccccccccc' AND project_id = 'c1c1c1c1-0000-0000-0000-000000000001' AND NOT es_detalle ORDER BY codigo LIMIT 1) AS agrupadora;
GRANT SELECT ON ce_cta TO authenticated;
SELECT public.chk_bool((SELECT propia IS NOT NULL AND otro_proyecto IS NOT NULL AND otra_empresa IS NOT NULL AND agrupadora IS NOT NULL FROM ce_cta), true,
  '1h · preparación: hay cuenta propia, de otro proyecto, de otra empresa y agrupadora');

SELECT public.como(:UA::uuid);
SET ROLE authenticated;
INSERT INTO public.facturas_proveedor (id, company_id, project_id, proveedor_id, numero_factura, concepto, monto_total)
VALUES ('ce300000-0000-0000-0000-0000000000a1', :C::uuid, :C1::uuid, :P1::uuid, 'CE-CTA-1', 'Cuentas del renglón', 1);
SELECT public.chk_falla(format($q$ INSERT INTO public.factura_proveedor_lineas (company_id, factura_id, linea, descripcion, cantidad, precio_unitario, cuenta_id)
                                   VALUES ('cccccccc-cccc-cccc-cccc-cccccccccccc','ce300000-0000-0000-0000-0000000000a1',1,'x',1,10,%L) $q$, (SELECT otra_empresa FROM ce_cta)),
  'COMPRAS_LINEA_CUENTA_LEDGER', '1h · la cuenta de OTRA EMPRESA se rechaza');
SELECT public.chk_falla(format($q$ INSERT INTO public.factura_proveedor_lineas (company_id, factura_id, linea, descripcion, cantidad, precio_unitario, cuenta_id)
                                   VALUES ('cccccccc-cccc-cccc-cccc-cccccccccccc','ce300000-0000-0000-0000-0000000000a1',1,'x',1,10,%L) $q$, (SELECT otro_proyecto FROM ce_cta)),
  'COMPRAS_LINEA_CUENTA_LEDGER', '1h · la cuenta de OTRA CONTABILIDAD de la misma empresa también');
SELECT public.chk_falla(format($q$ INSERT INTO public.factura_proveedor_lineas (company_id, factura_id, linea, descripcion, cantidad, precio_unitario, cuenta_id)
                                   VALUES ('cccccccc-cccc-cccc-cccc-cccccccccccc','ce300000-0000-0000-0000-0000000000a1',1,'x',1,10,%L) $q$, (SELECT agrupadora FROM ce_cta)),
  'COMPRAS_LINEA_CUENTA_AGRUPADORA', '1h · una cuenta agrupadora no recibe movimientos');
INSERT INTO public.factura_proveedor_lineas (company_id, factura_id, linea, descripcion, cantidad, precio_unitario, cuenta_id)
SELECT 'cccccccc-cccc-cccc-cccc-cccccccccccc', 'ce300000-0000-0000-0000-0000000000a1', 1, 'x', 1, 10, propia FROM ce_cta;
RESET ROLE;
SELECT public.chk((SELECT count(*) FROM public.factura_proveedor_lineas WHERE factura_id = 'ce300000-0000-0000-0000-0000000000a1'), 1,
  '1h · la cuenta de la contabilidad de la factura SÍ se acepta (control en verde)');

-- ═══════════════════════════════════════════════════════════════════════════
-- 2 · PAGOS A PROVEEDOR
-- Orden OP de servicio 10 × 100 + IVA 120 = 1 120, conformada y facturada.
-- ═══════════════════════════════════════════════════════════════════════════
SELECT public.como(:UA::uuid);
SET ROLE authenticated;
SELECT public.ce_oc('ce100000-0000-0000-0000-0000000000b1', 'ce110000-0000-0000-0000-0000000000b1', :P1::uuid, 'servicio', 10, 100, 120);
SELECT public.ce_recepcion('ce200000-0000-0000-0000-0000000000b1', 'ce100000-0000-0000-0000-0000000000b1', 'ce110000-0000-0000-0000-0000000000b1', 10, 'servicio');
UPDATE public.recepciones SET estado = 'registrada' WHERE id = 'ce200000-0000-0000-0000-0000000000b1';
SELECT public.ce_factura('ce300000-0000-0000-0000-0000000000b1', 'ce100000-0000-0000-0000-0000000000b1', 'ce110000-0000-0000-0000-0000000000b1', :P1::uuid, 'CE-PAGO-1', 10, 100, 120);

-- 2a · una factura SIN APROBAR no se paga (antes: pasaba de «registrada» a «pagada» sin cuadre ni devengo).
SELECT public.chk_falla($$ INSERT INTO public.ordenes_pago (company_id, project_id, proveedor_id, factura_id, monto)
                           VALUES ('cccccccc-cccc-cccc-cccc-cccccccccccc','c1c1c1c1-0000-0000-0000-000000000001','e3000000-0000-0000-0000-000000000001','ce300000-0000-0000-0000-0000000000b1',100) $$,
  'COMPRAS_FACTURA_NO_PAGABLE', '2a · no se crea una orden de pago contra una factura sin aprobar');
UPDATE public.facturas_proveedor SET estado = 'aprobada' WHERE id = 'ce300000-0000-0000-0000-0000000000b1';
RESET ROLE;
SELECT public.chk_num((SELECT monto_total FROM public.facturas_proveedor WHERE id = 'ce300000-0000-0000-0000-0000000000b1'), 1120, '2 · la factura es de 1 120');

SELECT public.como(:UA::uuid);
SET ROLE authenticated;
-- 2b · nace en borrador; el navegador no firma por otro.
SELECT public.chk_falla($$ INSERT INTO public.ordenes_pago (company_id, project_id, proveedor_id, factura_id, monto, estado)
                           VALUES ('cccccccc-cccc-cccc-cccc-cccccccccccc','c1c1c1c1-0000-0000-0000-000000000001','e3000000-0000-0000-0000-000000000001','ce300000-0000-0000-0000-0000000000b1',100,'pagada') $$,
  'COMPRAS_PAGO_ESTADO_INICIAL', '2b · una orden de pago no nace «pagada»');
-- 2c · proveedor o contabilidad distintos a los de la factura.
SELECT public.chk_falla($$ INSERT INTO public.ordenes_pago (company_id, project_id, proveedor_id, factura_id, monto)
                           VALUES ('cccccccc-cccc-cccc-cccc-cccccccccccc','c1c1c1c1-0000-0000-0000-000000000001','e3000000-0000-0000-0000-000000000002','ce300000-0000-0000-0000-0000000000b1',100) $$,
  'COMPRAS_PAGO_FACTURA_AJENA', '2c · otro proveedor que el de la factura');
SELECT public.chk_falla($$ INSERT INTO public.ordenes_pago (company_id, project_id, proveedor_id, factura_id, monto)
                           VALUES ('cccccccc-cccc-cccc-cccc-cccccccccccc','c2c2c2c2-0000-0000-0000-000000000001','e3000000-0000-0000-0000-000000000001','ce300000-0000-0000-0000-0000000000b1',100) $$,
  'COMPRAS_PAGO_FACTURA_AJENA', '2c · otra contabilidad que la de la factura');
-- 2d · no se paga más de lo que se debe, ni dos veces lo mismo.
INSERT INTO public.ordenes_pago (id, company_id, project_id, proveedor_id, factura_id, monto, solicitada_por)
VALUES ('ce400000-0000-0000-0000-0000000000b1', :C::uuid, :C1::uuid, :P1::uuid, 'ce300000-0000-0000-0000-0000000000b1', 600, :UC::uuid);
SELECT public.chk_falla($$ INSERT INTO public.ordenes_pago (company_id, project_id, proveedor_id, factura_id, monto)
                           VALUES ('cccccccc-cccc-cccc-cccc-cccccccccccc','c1c1c1c1-0000-0000-0000-000000000001','e3000000-0000-0000-0000-000000000001','ce300000-0000-0000-0000-0000000000b1',5000) $$,
  'COMPRAS_PAGO_EXCEDE_SALDO', '2d · un monto mayor al saldo (5 000 sobre 1 120) se rechaza');
SELECT public.chk_falla($$ INSERT INTO public.ordenes_pago (company_id, project_id, proveedor_id, factura_id, monto)
                           VALUES ('cccccccc-cccc-cccc-cccc-cccccccccccc','c1c1c1c1-0000-0000-0000-000000000001','e3000000-0000-0000-0000-000000000001','ce300000-0000-0000-0000-0000000000b1',600) $$,
  'COMPRAS_PAGO_EXCEDE_SALDO', '2d · 600 + 600 sobre 1 120: lo que ya reserva la primera orden cuenta');
INSERT INTO public.ordenes_pago (id, company_id, project_id, proveedor_id, factura_id, monto)
VALUES ('ce400000-0000-0000-0000-0000000000b2', :C::uuid, :C1::uuid, :P1::uuid, 'ce300000-0000-0000-0000-0000000000b1', 520);
RESET ROLE;
SELECT public.chk_uuid((SELECT solicitada_por FROM public.ordenes_pago WHERE id = 'ce400000-0000-0000-0000-0000000000b1'), :UA::uuid,
  '2b · «solicitada_por» lo sella el servidor: el navegador dijo UC y quedó UA');

SELECT public.como(:UA::uuid);
SET ROLE authenticated;
-- 2e · máquina de estados.
SELECT public.chk_falla($$ UPDATE public.ordenes_pago SET estado = 'pagada' WHERE id = 'ce400000-0000-0000-0000-0000000000b1' $$,
  'COMPRAS_PAGO_TRANSICION_INVALIDA', '2e · de borrador no se salta a «pagada» (sin aprobar)');
UPDATE public.ordenes_pago SET estado = 'aprobada', aprobada_por = :UC::uuid, aprobada_at = '2000-01-01' WHERE id = 'ce400000-0000-0000-0000-0000000000b1';
RESET ROLE;
SELECT public.chk_uuid((SELECT aprobada_por FROM public.ordenes_pago WHERE id = 'ce400000-0000-0000-0000-0000000000b1'), :UA::uuid,
  '2e · «aprobada_por» lo sella el servidor (el navegador dijo UC)');
SELECT public.chk_bool((SELECT aprobada_at > now() - interval '1 minute' FROM public.ordenes_pago WHERE id = 'ce400000-0000-0000-0000-0000000000b1'), true,
  '2e · y «aprobada_at» es la hora del servidor, no la del navegador');
SELECT public.como(:UA::uuid);
SET ROLE authenticated;
SELECT public.chk_falla($$ UPDATE public.ordenes_pago SET estado = 'borrador' WHERE id = 'ce400000-0000-0000-0000-0000000000b1' $$,
  'COMPRAS_PAGO_TRANSICION_INVALIDA', '2e · una orden aprobada no vuelve a borrador');
SELECT public.chk_falla($$ UPDATE public.ordenes_pago SET monto = 1 WHERE id = 'ce400000-0000-0000-0000-0000000000b1' $$,
  'COMPRAS_PAGO_INMUTABLE', '2e · una orden aprobada no cambia de monto');
SELECT public.chk_falla($$ UPDATE public.ordenes_pago SET proveedor_id = 'e3000000-0000-0000-0000-000000000002' WHERE id = 'ce400000-0000-0000-0000-0000000000b1' $$,
  'COMPRAS_PAGO_INMUTABLE', '2e · ni de proveedor');

-- 2f · se paga: la factura queda pagada parcial y luego pagada; el servidor sella la hora.
UPDATE public.ordenes_pago SET estado = 'pagada', fecha_pago = CURRENT_DATE, pagada_at = '2000-01-01' WHERE id = 'ce400000-0000-0000-0000-0000000000b1';
RESET ROLE;
SELECT public.chk_txt((SELECT estado || '/' || monto_pagado FROM public.facturas_proveedor WHERE id = 'ce300000-0000-0000-0000-0000000000b1'),
  'pagada_parcial/600.00', '2f · pagados 600 de 1 120: la factura queda pagada parcial');
SELECT public.chk_bool((SELECT pagada_at > now() - interval '1 minute' FROM public.ordenes_pago WHERE id = 'ce400000-0000-0000-0000-0000000000b1'), true,
  '2f · «pagada_at» es la hora del servidor');
SELECT public.como(:UA::uuid);
SET ROLE authenticated;
UPDATE public.ordenes_pago SET estado = 'aprobada' WHERE id = 'ce400000-0000-0000-0000-0000000000b2';
UPDATE public.ordenes_pago SET estado = 'pagada', fecha_pago = CURRENT_DATE WHERE id = 'ce400000-0000-0000-0000-0000000000b2';
-- Reintento (doble clic): no genera otro asiento ni otro movimiento de saldo.
UPDATE public.ordenes_pago SET estado = 'pagada', fecha_pago = CURRENT_DATE WHERE id = 'ce400000-0000-0000-0000-0000000000b2';
RESET ROLE;
SELECT public.chk_txt((SELECT estado || '/' || monto_pagado FROM public.facturas_proveedor WHERE id = 'ce300000-0000-0000-0000-0000000000b1'),
  'pagada/1120.00', '2f · pagados 600 + 520: la factura queda pagada por 1 120');
SELECT public.chk((SELECT count(*) FROM public.conta_asientos WHERE origen_tabla = 'ordenes_pago' AND estado = 'publicado'
                    AND origen_id IN ('ce400000-0000-0000-0000-0000000000b1', 'ce400000-0000-0000-0000-0000000000b2') AND origen_evento = 'orden_pago_pagada'), 2,
  '2f · dos pagos, dos asientos (el reintento no duplicó)');
SELECT public.chk_num((SELECT sum(l.debe) FROM public.conta_asientos a JOIN public.conta_asiento_lineas l ON l.asiento_id = a.id
                        WHERE a.origen_tabla = 'ordenes_pago' AND a.origen_evento = 'orden_pago_pagada'
                          AND a.origen_id IN ('ce400000-0000-0000-0000-0000000000b1', 'ce400000-0000-0000-0000-0000000000b2')), 1120,
  '2f · y lo contabilizado como pagado coincide con la factura (1 120)');

SELECT public.como(:UA::uuid);
SET ROLE authenticated;
SELECT public.chk_falla($$ INSERT INTO public.ordenes_pago (company_id, project_id, proveedor_id, factura_id, monto)
                           VALUES ('cccccccc-cccc-cccc-cccc-cccccccccccc','c1c1c1c1-0000-0000-0000-000000000001','e3000000-0000-0000-0000-000000000001','ce300000-0000-0000-0000-0000000000b1',1) $$,
  'COMPRAS_FACTURA_NO_PAGABLE', '2g · una factura ya pagada no admite otra orden de pago');
-- 2h · anular un pago devuelve el saldo y permite pagarlo de nuevo, una sola vez.
UPDATE public.ordenes_pago SET estado = 'anulada' WHERE id = 'ce400000-0000-0000-0000-0000000000b2';
RESET ROLE;
SELECT public.chk_txt((SELECT estado || '/' || monto_pagado FROM public.facturas_proveedor WHERE id = 'ce300000-0000-0000-0000-0000000000b1'),
  'pagada_parcial/600.00', '2h · anular el pago de 520 devuelve la factura a pagada parcial (600)');
SELECT public.chk((SELECT count(*) FROM public.conta_asientos WHERE origen_tabla = 'ordenes_pago' AND estado = 'publicado'
                    AND origen_id = 'ce400000-0000-0000-0000-0000000000b2' AND origen_evento = 'orden_pago_pagada_revertido'), 1,
  '2h · y el asiento del pago quedó revertido por un asiento propio (trazable)');

-- 2i · contraseña de pago: una contraseña anulada no se paga.
SELECT public.como(:UA::uuid);
SET ROLE authenticated;
SELECT public.ce_oc('ce100000-0000-0000-0000-0000000000b3', 'ce110000-0000-0000-0000-0000000000b3', :P1::uuid, 'servicio', 10, 100, 0);
SELECT public.ce_recepcion('ce200000-0000-0000-0000-0000000000b3', 'ce100000-0000-0000-0000-0000000000b3', 'ce110000-0000-0000-0000-0000000000b3', 10, 'servicio');
UPDATE public.recepciones SET estado = 'registrada' WHERE id = 'ce200000-0000-0000-0000-0000000000b3';
SELECT public.ce_factura('ce300000-0000-0000-0000-0000000000b3', 'ce100000-0000-0000-0000-0000000000b3', 'ce110000-0000-0000-0000-0000000000b3', :P1::uuid, 'CE-PAGO-3', 10, 100, 0);
UPDATE public.facturas_proveedor SET estado = 'aprobada' WHERE id = 'ce300000-0000-0000-0000-0000000000b3';
INSERT INTO public.contrasenas_pago (id, company_id, project_id, proveedor_id, fecha_pago_programada)
VALUES ('ce500000-0000-0000-0000-0000000000b3', :C::uuid, :C1::uuid, :P1::uuid, CURRENT_DATE);
INSERT INTO public.contrasena_pago_facturas (company_id, contrasena_id, factura_id, monto)
VALUES (:C::uuid, 'ce500000-0000-0000-0000-0000000000b3', 'ce300000-0000-0000-0000-0000000000b3', 1000);
INSERT INTO public.ordenes_pago (id, company_id, project_id, proveedor_id, contrasena_pago_id, monto)
VALUES ('ce400000-0000-0000-0000-0000000000b3', :C::uuid, :C1::uuid, :P1::uuid, 'ce500000-0000-0000-0000-0000000000b3', 1000);
UPDATE public.ordenes_pago SET estado = 'aprobada' WHERE id = 'ce400000-0000-0000-0000-0000000000b3';
UPDATE public.contrasenas_pago SET estado = 'anulada', motivo_anulacion = 'prueba' WHERE id = 'ce500000-0000-0000-0000-0000000000b3';
SELECT public.chk_falla($$ UPDATE public.ordenes_pago SET estado = 'pagada', fecha_pago = CURRENT_DATE WHERE id = 'ce400000-0000-0000-0000-0000000000b3' $$,
  'COMPRAS_CONTRASENA_CERRADA', '2i · la contraseña anulada ya no se paga');
RESET ROLE;
SELECT public.chk_txt((SELECT estado || '/' || monto_pagado FROM public.facturas_proveedor WHERE id = 'ce300000-0000-0000-0000-0000000000b3'),
  'aprobada/0.00', '2i · y la factura de la contraseña no se movió');

-- ═══════════════════════════════════════════════════════════════════════════
-- 3 · LO QUE TUVO EFECTO SE ANULA, NO SE BORRA
-- Se usan los documentos de la sección 2: OC b1 (emitida/cerrada), recepción b1
-- (registrada), factura b1 (aprobada, pagada parcial), orden de pago b1 (pagada),
-- contraseña b3 (anulada).
-- ═══════════════════════════════════════════════════════════════════════════
SELECT public.como(:UA::uuid);
SET ROLE authenticated;
SELECT public.chk_falla($$ DELETE FROM public.recepciones WHERE id = 'ce200000-0000-0000-0000-0000000000b1' $$,
  'COMPRAS_DOCUMENTO_NO_SE_BORRA', '3a · una recepción REGISTRADA no se borra (antes: desaparecía con lo recibido ya sumado)');
SELECT public.ce_oc('ce100000-0000-0000-0000-0000000000c4', 'ce110000-0000-0000-0000-0000000000c4', :P1::uuid, 'servicio', 1, 10, 0);
SELECT public.chk_falla($$ DELETE FROM public.ordenes_compra WHERE id = 'ce100000-0000-0000-0000-0000000000c4' $$,
  'COMPRAS_DOCUMENTO_NO_SE_BORRA', '3b · una orden EMITIDA, aunque aún no tenga recepciones, no se borra (antes: se llevaba su historial de estados)');
SELECT public.ce_oc('ce100000-0000-0000-0000-0000000000c5', 'ce110000-0000-0000-0000-0000000000c5', :P1::uuid, 'servicio', 4, 10, 0);
SELECT public.ce_recepcion('ce200000-0000-0000-0000-0000000000c5', 'ce100000-0000-0000-0000-0000000000c5', 'ce110000-0000-0000-0000-0000000000c5', 4, 'servicio');
UPDATE public.recepciones SET estado = 'registrada' WHERE id = 'ce200000-0000-0000-0000-0000000000c5';
SELECT public.ce_factura('ce300000-0000-0000-0000-0000000000c5', 'ce100000-0000-0000-0000-0000000000c5', 'ce110000-0000-0000-0000-0000000000c5', :P1::uuid, 'CE-APROB-5', 4, 10, 0);
UPDATE public.facturas_proveedor SET estado = 'aprobada' WHERE id = 'ce300000-0000-0000-0000-0000000000c5';
SELECT public.chk_falla($$ DELETE FROM public.facturas_proveedor WHERE id = 'ce300000-0000-0000-0000-0000000000c5' $$,
  'COMPRAS_DOCUMENTO_NO_SE_BORRA', '3c · una factura APROBADA sin pagos no se borra (antes: quedaba lo facturado en la orden)');
INSERT INTO public.contrasenas_pago (id, company_id, project_id, proveedor_id, fecha_pago_programada)
VALUES ('ce500000-0000-0000-0000-0000000000c6', :C::uuid, :C1::uuid, :P1::uuid, CURRENT_DATE);
SELECT public.chk_falla($$ DELETE FROM public.ordenes_pago WHERE id = 'ce400000-0000-0000-0000-0000000000b1' $$,
  'COMPRAS_DOCUMENTO_NO_SE_BORRA', '3d · una orden de pago PAGADA no se borra (antes: la factura seguía pagada)');
SELECT public.chk_falla($$ DELETE FROM public.contrasenas_pago WHERE id = 'ce500000-0000-0000-0000-0000000000c6' $$,
  'COMPRAS_DOCUMENTO_NO_SE_BORRA', '3e · una contraseña de pago emitida no se borra (se anula)');
SELECT public.chk_falla($$ DELETE FROM public.contrasena_pago_facturas WHERE contrasena_id = 'ce500000-0000-0000-0000-0000000000b3' $$,
  'COMPRAS_DOCUMENTO_NO_SE_BORRA', '3f · ni se le quitan partidas a una contraseña que ya no está emitida');
RESET ROLE;
SELECT public.chk((SELECT count(*) FROM public.recepciones WHERE id = 'ce200000-0000-0000-0000-0000000000b1'), 1, '3a · la recepción sigue ahí');
SELECT public.chk_num((SELECT cantidad_recibida FROM public.orden_compra_lineas WHERE id = 'ce110000-0000-0000-0000-0000000000b1'), 10, '3a · y lo recibido de la línea sigue en 10');
SELECT public.chk_num((SELECT cantidad_facturada FROM public.orden_compra_lineas WHERE id = 'ce110000-0000-0000-0000-0000000000b1'), 10, '3c · lo facturado de la línea sigue en 10');
SELECT public.chk_num((SELECT cantidad_facturada FROM public.orden_compra_lineas WHERE id = 'ce110000-0000-0000-0000-0000000000c5'), 4, '3c · y lo de la factura aprobada sin pagos, en 4');
SELECT public.chk((SELECT count(*) FROM public.ordenes_compra WHERE id = 'ce100000-0000-0000-0000-0000000000c4'), 1, '3b · la orden emitida sigue ahí');
SELECT public.chk((SELECT count(*) FROM public.contrasenas_pago WHERE id = 'ce500000-0000-0000-0000-0000000000c6'), 1, '3e · la contraseña sigue ahí');
SELECT public.chk_num((SELECT monto_pagado FROM public.facturas_proveedor WHERE id = 'ce300000-0000-0000-0000-0000000000b1'), 600, '3d · el pago de 600 sigue en la factura');
SELECT public.chk((SELECT count(*) FROM public.orden_compra_eventos WHERE orden_compra_id = 'ce100000-0000-0000-0000-0000000000c4'), 3,
  '3b · el historial de la orden emitida sigue completo tras el intento de borrarla (alta, aprobada, emitida)');

-- Lo que nunca tuvo efecto sí se borra (borradores).
SELECT public.como(:UA::uuid);
SET ROLE authenticated;
INSERT INTO public.ordenes_compra (id, company_id, project_id, proveedor_id, proveedor_nombre, concepto)
VALUES ('ce100000-0000-0000-0000-0000000000c1', :C::uuid, :C1::uuid, :P1::uuid, 'x', 'borrador sin aprobar');
DELETE FROM public.ordenes_compra WHERE id = 'ce100000-0000-0000-0000-0000000000c1';
-- Una orden devuelta a borrador SÍ tuvo efecto (fue aprobada, tiene número e historial): se cancela.
SELECT public.ce_oc('ce100000-0000-0000-0000-0000000000c2', 'ce110000-0000-0000-0000-0000000000c2', :P1::uuid, 'servicio', 1, 10, 0, NULL, false);
UPDATE public.ordenes_compra SET estado = 'borrador', motivo_devolucion = 'corregir precio' WHERE id = 'ce100000-0000-0000-0000-0000000000c2';
SELECT public.chk_falla($$ DELETE FROM public.ordenes_compra WHERE id = 'ce100000-0000-0000-0000-0000000000c2' $$,
  'COMPRAS_DOCUMENTO_NO_SE_BORRA', '3g · una orden devuelta a borrador (ya fue aprobada) no se borra: se cancela');
-- Recepción en borrador, factura registrada sin aprobar y orden de pago en borrador.
SELECT public.ce_oc('ce100000-0000-0000-0000-0000000000c3', 'ce110000-0000-0000-0000-0000000000c3', :P1::uuid, 'servicio', 10, 100, 0);
SELECT public.ce_recepcion('ce200000-0000-0000-0000-0000000000c3', 'ce100000-0000-0000-0000-0000000000c3', 'ce110000-0000-0000-0000-0000000000c3', 5, 'servicio');
DELETE FROM public.recepciones WHERE id = 'ce200000-0000-0000-0000-0000000000c3';
SELECT public.ce_factura('ce300000-0000-0000-0000-0000000000c3', 'ce100000-0000-0000-0000-0000000000c3', 'ce110000-0000-0000-0000-0000000000c3', :P1::uuid, 'CE-BORRAR-1', 1, 100, 0);
DELETE FROM public.facturas_proveedor WHERE id = 'ce300000-0000-0000-0000-0000000000c3';
RESET ROLE;
SELECT public.chk((SELECT count(*) FROM public.ordenes_compra WHERE id = 'ce100000-0000-0000-0000-0000000000c1'), 0, '3h · el borrador de orden sin aprobar sí se borró');
SELECT public.chk((SELECT count(*) FROM public.ordenes_compra WHERE id = 'ce100000-0000-0000-0000-0000000000c2'), 1, '3g · la orden devuelta a borrador sigue ahí');
SELECT public.chk((SELECT count(*) FROM public.recepciones WHERE id = 'ce200000-0000-0000-0000-0000000000c3'), 0, '3h · la recepción en borrador sí se borró');
SELECT public.chk((SELECT count(*) FROM public.facturas_proveedor WHERE id = 'ce300000-0000-0000-0000-0000000000c3'), 0, '3h · la factura registrada y jamás aprobada sí se borró');
SELECT public.chk((SELECT count(*) FROM public.factura_proveedor_lineas WHERE factura_id = 'ce300000-0000-0000-0000-0000000000c3'), 0, '3h · y su renglón con ella');
SELECT public.chk_num((SELECT cantidad_facturada FROM public.orden_compra_lineas WHERE id = 'ce110000-0000-0000-0000-0000000000c3'), 0, '3h · borrarla no dejó nada acumulado');

-- La cancelación sí queda en el historial (el camino correcto).
SELECT public.como(:UA::uuid);
SET ROLE authenticated;
UPDATE public.ordenes_compra SET estado = 'cancelada', motivo_anulacion = 'ya no se necesita' WHERE id = 'ce100000-0000-0000-0000-0000000000c2';
RESET ROLE;
SELECT public.chk((SELECT count(*) FROM public.orden_compra_eventos WHERE orden_compra_id = 'ce100000-0000-0000-0000-0000000000c2' AND estado_nuevo = 'cancelada'), 1,
  '3g · cancelar deja el evento en el historial de la orden');

-- La purga en CASCADA de un proyecto y de una empresa no se bloquea (no es un borrado de usuario).
SELECT set_config('request.jwt.claim.sub', '', false);
INSERT INTO public.companies (id, nombre, default_currency) VALUES ('ce900000-0000-0000-0000-000000000001', 'Empresa CE efímera', 'gtq');
INSERT INTO public.projects (id, company_id, nombre) VALUES ('ce910000-0000-0000-0000-000000000001', 'ce900000-0000-0000-0000-000000000001', 'Proyecto CE efímero');
INSERT INTO public.ordenes_compra (id, company_id, project_id, proveedor_nombre, concepto, revision, numero)
VALUES ('ce100000-0000-0000-0000-0000000000e1', 'ce900000-0000-0000-0000-000000000001', 'ce910000-0000-0000-0000-000000000001', 'x', 'orden con historia (project)', 1, 'OC-CE-1'),
       ('ce100000-0000-0000-0000-0000000000e2', 'ce900000-0000-0000-0000-000000000001', NULL,                                   'x', 'orden con historia (empresa)', 1, 'OC-CE-2');
DELETE FROM public.projects WHERE id = 'ce910000-0000-0000-0000-000000000001';
SELECT public.chk((SELECT count(*) FROM public.ordenes_compra WHERE id = 'ce100000-0000-0000-0000-0000000000e1'), 0,
  '3i · al eliminar un proyecto, su orden con historia se va en cascada (no se bloquea)');
DELETE FROM public.companies WHERE id = 'ce900000-0000-0000-0000-000000000001';
SELECT public.chk((SELECT count(*) FROM public.ordenes_compra WHERE id = 'ce100000-0000-0000-0000-0000000000e2'), 0,
  '3i · al eliminar una empresa, su orden con historia se va en cascada (no se bloquea)');

-- ═══════════════════════════════════════════════════════════════════════════
-- 4 · PERMISOS POR ACCIÓN (solicitar · aprobar · recibir · contabilizar · pagar)
--   UC  contador: ver/crear/editar/eliminar            (sin «Autorizar» ni «Cambiar estado»)
--   UQ  autoriza: ver/crear/editar + approve
--   US  cambia estado: ver/crear/editar + change_status
--   UA  administrador: todo (rol)
-- ═══════════════════════════════════════════════════════════════════════════
-- 4a · Orden de compra: solicitar (create) · aprobar (approve) · emitir y cancelar (change_status)
SELECT public.como(:UC::uuid);
SET ROLE authenticated;
INSERT INTO public.ordenes_compra (id, company_id, project_id, proveedor_id, proveedor_nombre, concepto)
VALUES ('ce100000-0000-0000-0000-0000000000f1', :C::uuid, :C1::uuid, :P1::uuid, 'Proveedor CE', 'Permisos por acción');
INSERT INTO public.orden_compra_lineas (id, company_id, orden_compra_id, linea, descripcion, destino_tipo, categoria, cantidad, unidad, precio_unitario, iva_monto)
VALUES ('ce110000-0000-0000-0000-0000000000f1', :C::uuid, 'ce100000-0000-0000-0000-0000000000f1', 1, 'Servicio', 'servicio', 'servicios', 10, 'servicio', 100, 120);
SELECT public.chk_falla($$ UPDATE public.ordenes_compra SET estado = 'aprobada' WHERE id = 'ce100000-0000-0000-0000-0000000000f1' $$,
  'COMPRAS_PERMISO_ACCION', '4a · el contador (solo editar) NO aprueba la orden que él mismo solicitó');
SELECT public.como(:US::uuid);
SELECT public.chk_falla($$ UPDATE public.ordenes_compra SET estado = 'aprobada' WHERE id = 'ce100000-0000-0000-0000-0000000000f1' $$,
  'COMPRAS_PERMISO_ACCION', '4a · quien solo cambia estado tampoco aprueba');
SELECT public.como(:UQ::uuid);
UPDATE public.ordenes_compra SET estado = 'aprobada', aprobada_por = :UC::uuid WHERE id = 'ce100000-0000-0000-0000-0000000000f1';
RESET ROLE;
SELECT public.chk_txt((SELECT estado FROM public.ordenes_compra WHERE id = 'ce100000-0000-0000-0000-0000000000f1'), 'aprobada', '4a · quien tiene «Autorizar / Denegar» aprueba');
SELECT public.chk_uuid((SELECT aprobada_por FROM public.ordenes_compra WHERE id = 'ce100000-0000-0000-0000-0000000000f1'), :UQ::uuid,
  '4a · y el aprobador lo sella el servidor (el navegador dijo UC)');
SELECT public.como(:UQ::uuid);
SET ROLE authenticated;
SELECT public.chk_falla($$ UPDATE public.ordenes_compra SET estado = 'emitida' WHERE id = 'ce100000-0000-0000-0000-0000000000f1' $$,
  'COMPRAS_PERMISO_ACCION', '4a · quien solo autoriza NO emite la orden');
SELECT public.chk_falla($$ UPDATE public.ordenes_compra SET estado = 'cancelada' WHERE id = 'ce100000-0000-0000-0000-0000000000f1' $$,
  'COMPRAS_PERMISO_ACCION', '4a · ni la cancela');
SELECT public.como(:UC::uuid);
SELECT public.chk_falla($$ UPDATE public.ordenes_compra SET estado = 'emitida' WHERE id = 'ce100000-0000-0000-0000-0000000000f1' $$,
  'COMPRAS_PERMISO_ACCION', '4a · el contador (solo editar) tampoco emite');
SELECT public.como(:US::uuid);
UPDATE public.ordenes_compra SET estado = 'emitida' WHERE id = 'ce100000-0000-0000-0000-0000000000f1';
RESET ROLE;
SELECT public.chk_txt((SELECT estado FROM public.ordenes_compra WHERE id = 'ce100000-0000-0000-0000-0000000000f1'), 'emitida', '4a · quien tiene «Cambiar estado» emite');
-- Devolver a borrador es de quien autoriza.
SELECT public.como(:UA::uuid);
SET ROLE authenticated;
SELECT public.ce_oc('ce100000-0000-0000-0000-0000000000f2', 'ce110000-0000-0000-0000-0000000000f2', :P1::uuid, 'servicio', 1, 10, 0, NULL, false);
SELECT public.como(:US::uuid);
SELECT public.chk_falla($$ UPDATE public.ordenes_compra SET estado = 'borrador', motivo_devolucion = 'x' WHERE id = 'ce100000-0000-0000-0000-0000000000f2' $$,
  'COMPRAS_PERMISO_ACCION', '4a · devolver a borrador una orden aprobada lo hace quien autoriza, no quien cambia estado');
UPDATE public.ordenes_compra SET estado = 'cancelada', motivo_anulacion = 'prueba' WHERE id = 'ce100000-0000-0000-0000-0000000000f2';
RESET ROLE;
SELECT public.chk_txt((SELECT estado FROM public.ordenes_compra WHERE id = 'ce100000-0000-0000-0000-0000000000f2'), 'cancelada', '4a · quien cambia estado cancela');

-- 4b · Recepción: capturar (create) ≠ registrar y anular (change_status)
SELECT public.como(:UC::uuid);
SET ROLE authenticated;
SELECT public.ce_recepcion('ce200000-0000-0000-0000-0000000000f1', 'ce100000-0000-0000-0000-0000000000f1', 'ce110000-0000-0000-0000-0000000000f1', 6, 'servicio');
SELECT public.chk_falla($$ UPDATE public.recepciones SET estado = 'registrada' WHERE id = 'ce200000-0000-0000-0000-0000000000f1' $$,
  'COMPRAS_PERMISO_ACCION', '4b · quien captura la recepción NO la registra (no mueve existencias ni contabiliza)');
SELECT public.como(:UQ::uuid);
SELECT public.chk_falla($$ UPDATE public.recepciones SET estado = 'registrada' WHERE id = 'ce200000-0000-0000-0000-0000000000f1' $$,
  'COMPRAS_PERMISO_ACCION', '4b · autorizar tampoco es registrar la recepción');
SELECT public.como(:US::uuid);
UPDATE public.recepciones SET estado = 'registrada' WHERE id = 'ce200000-0000-0000-0000-0000000000f1';
SELECT public.como(:UQ::uuid);
SELECT public.chk_falla($$ UPDATE public.recepciones SET estado = 'anulada', motivo_anulacion = 'x' WHERE id = 'ce200000-0000-0000-0000-0000000000f1' $$,
  'COMPRAS_PERMISO_ACCION', '4b · anular la recepción exige «Cambiar estado»');
RESET ROLE;
SELECT public.chk_txt((SELECT estado FROM public.recepciones WHERE id = 'ce200000-0000-0000-0000-0000000000f1'), 'registrada', '4b · quien cambia estado la registró');
SELECT public.chk_num((SELECT cantidad_recibida FROM public.orden_compra_lineas WHERE id = 'ce110000-0000-0000-0000-0000000000f1'), 6, '4b · y lo recibido de la línea es 6');

-- 4c · Factura: capturar (create) · aprobar/contabilizar (approve) · anular (change_status)
SELECT public.como(:UC::uuid);
SET ROLE authenticated;
SELECT public.ce_factura('ce300000-0000-0000-0000-0000000000f1', 'ce100000-0000-0000-0000-0000000000f1', 'ce110000-0000-0000-0000-0000000000f1', :P1::uuid, 'CE-PERM-1', 6, 100, 72);
SELECT public.chk_falla($$ UPDATE public.facturas_proveedor SET estado = 'aprobada' WHERE id = 'ce300000-0000-0000-0000-0000000000f1' $$,
  'COMPRAS_PERMISO_ACCION', '4c · quien captura la factura NO la aprueba ni la contabiliza');
SELECT public.como(:US::uuid);
SELECT public.chk_falla($$ UPDATE public.facturas_proveedor SET estado = 'aprobada' WHERE id = 'ce300000-0000-0000-0000-0000000000f1' $$,
  'COMPRAS_PERMISO_ACCION', '4c · cambiar estado tampoco es contabilizar');
SELECT public.como(:UQ::uuid);
UPDATE public.facturas_proveedor SET estado = 'aprobada' WHERE id = 'ce300000-0000-0000-0000-0000000000f1';
RESET ROLE;
SELECT public.chk_txt((SELECT estado FROM public.facturas_proveedor WHERE id = 'ce300000-0000-0000-0000-0000000000f1'), 'aprobada', '4c · quien autoriza aprueba (y el cuadre contra la orden y la recepción corre igual)');
SELECT public.chk_uuid((SELECT aprobada_por FROM public.facturas_proveedor WHERE id = 'ce300000-0000-0000-0000-0000000000f1'), :UQ::uuid, '4c · aprobada por quien ejecutó');
SELECT public.chk((SELECT count(*) FROM public.conta_asientos WHERE origen_tabla = 'facturas_proveedor' AND origen_id = 'ce300000-0000-0000-0000-0000000000f1' AND origen_evento = 'factura_prov_aprobada'), 1,
  '4c · y se contabilizó UNA vez');
SELECT public.como(:UQ::uuid);
SET ROLE authenticated;
SELECT public.chk_falla($$ UPDATE public.facturas_proveedor SET estado = 'anulada' WHERE id = 'ce300000-0000-0000-0000-0000000000f1' $$,
  'COMPRAS_PERMISO_ACCION', '4c · anular la factura exige «Cambiar estado»');
RESET ROLE;

-- 4d · Orden de pago: crear (create) · aprobar (approve) · pagar y anular (change_status)
SELECT public.como(:UC::uuid);
SET ROLE authenticated;
INSERT INTO public.ordenes_pago (id, company_id, project_id, proveedor_id, factura_id, monto)
VALUES ('ce400000-0000-0000-0000-0000000000f1', :C::uuid, :C1::uuid, :P1::uuid, 'ce300000-0000-0000-0000-0000000000f1', 672);
SELECT public.chk_falla($$ UPDATE public.ordenes_pago SET estado = 'aprobada' WHERE id = 'ce400000-0000-0000-0000-0000000000f1' $$,
  'COMPRAS_PERMISO_ACCION', '4d · quien solicita el pago NO lo aprueba');
SELECT public.como(:US::uuid);
SELECT public.chk_falla($$ UPDATE public.ordenes_pago SET estado = 'aprobada' WHERE id = 'ce400000-0000-0000-0000-0000000000f1' $$,
  'COMPRAS_PERMISO_ACCION', '4d · cambiar estado tampoco aprueba el pago');
SELECT public.como(:UQ::uuid);
UPDATE public.ordenes_pago SET estado = 'aprobada' WHERE id = 'ce400000-0000-0000-0000-0000000000f1';
SELECT public.chk_falla($$ UPDATE public.ordenes_pago SET estado = 'pagada', fecha_pago = CURRENT_DATE WHERE id = 'ce400000-0000-0000-0000-0000000000f1' $$,
  'COMPRAS_PERMISO_ACCION', '4d · quien aprueba el pago NO lo ejecuta (marcarlo pagado contabiliza el egreso)');
SELECT public.como(:UC::uuid);
SELECT public.chk_falla($$ UPDATE public.ordenes_pago SET estado = 'pagada', fecha_pago = CURRENT_DATE WHERE id = 'ce400000-0000-0000-0000-0000000000f1' $$,
  'COMPRAS_PERMISO_ACCION', '4d · el contador (solo editar) tampoco paga');
SELECT public.como(:US::uuid);
UPDATE public.ordenes_pago SET estado = 'pagada', fecha_pago = CURRENT_DATE WHERE id = 'ce400000-0000-0000-0000-0000000000f1';
RESET ROLE;
SELECT public.chk_txt((SELECT estado FROM public.facturas_proveedor WHERE id = 'ce300000-0000-0000-0000-0000000000f1'), 'pagada', '4d · quien cambia estado pagó y la factura quedó pagada (los triggers de sistema no piden permiso)');
SELECT public.chk_txt((SELECT estado FROM public.ordenes_compra WHERE id = 'ce100000-0000-0000-0000-0000000000f1'), 'recibida_parcial', '4d · la orden sigue «recibida parcial» (se recibieron y facturaron 6 de 10): los triggers de sistema movieron su estado sin pedir permiso');
SELECT public.como(:UQ::uuid);
SET ROLE authenticated;
SELECT public.chk_falla($$ UPDATE public.ordenes_pago SET estado = 'anulada' WHERE id = 'ce400000-0000-0000-0000-0000000000f1' $$,
  'COMPRAS_PERMISO_ACCION', '4d · anular un pago ya hecho exige «Cambiar estado»');
RESET ROLE;

-- 4e · Se nace en el estado inicial; lo derivado lo escribe el sistema (antes: factura «aprobada»
-- sin cuadre ni devengo y luego «pagada»; orden «emitida» con número; recepción «registrada» sin efectos).
SELECT public.como(:UA::uuid);
SET ROLE authenticated;
-- Una orden puede nacer aprobada o emitida (camino que la batería de PR A usa para validar al proveedor), pero
-- solo con el permiso del paso; no hay forma de que quien solo crea se apruebe a sí mismo con un INSERT.
SELECT public.como(:UC::uuid);
SELECT public.chk_falla($$ INSERT INTO public.ordenes_compra (company_id, project_id, proveedor_id, proveedor_nombre, concepto, estado)
                           VALUES ('cccccccc-cccc-cccc-cccc-cccccccccccc','c1c1c1c1-0000-0000-0000-000000000001','e3000000-0000-0000-0000-000000000001','x','directa aprobada','aprobada') $$,
  'COMPRAS_PERMISO_ACCION', '4e · quien solo crea NO inserta una orden ya «aprobada» (se saltaría «Autorizar / Denegar»)');
SELECT public.como(:US::uuid);
SELECT public.chk_falla($$ INSERT INTO public.ordenes_compra (company_id, project_id, proveedor_id, proveedor_nombre, concepto, estado)
                           VALUES ('cccccccc-cccc-cccc-cccc-cccccccccccc','c1c1c1c1-0000-0000-0000-000000000001','e3000000-0000-0000-0000-000000000001','x','directa emitida','emitida') $$,
  'COMPRAS_PERMISO_ACCION', '4e · ni «emitida» quien solo cambia estado (le falta aprobar)');
SELECT public.como(:UA::uuid);
INSERT INTO public.ordenes_compra (id, company_id, project_id, proveedor_id, proveedor_nombre, concepto, estado, aprobada_por)
VALUES ('ce100000-0000-0000-0000-0000000000f4', :C::uuid, :C1::uuid, :P1::uuid, 'x', 'directa aprobada por el administrador', 'aprobada', :UC::uuid);
SELECT public.chk_falla($$ INSERT INTO public.ordenes_compra (company_id, project_id, proveedor_id, proveedor_nombre, concepto, estado)
                           VALUES ('cccccccc-cccc-cccc-cccc-cccccccccccc','c1c1c1c1-0000-0000-0000-000000000001','e3000000-0000-0000-0000-000000000001','x','nace recibida','recibida') $$,
  'COMPRAS_ESTADO_INICIAL', '4e · y una orden no nace «recibida» ni «cerrada» ni «cancelada» (ni el administrador)');
SELECT public.chk_falla($$ INSERT INTO public.facturas_proveedor (company_id, project_id, proveedor_id, numero_factura, concepto, monto_total, estado)
                           VALUES ('cccccccc-cccc-cccc-cccc-cccccccccccc','c1c1c1c1-0000-0000-0000-000000000001','e3000000-0000-0000-0000-000000000001','CE-DIR-1','x',500,'aprobada') $$,
  'COMPRAS_ESTADO_INICIAL', '4e · una factura no se crea ya «aprobada»');
SELECT public.chk_falla($$ INSERT INTO public.facturas_proveedor (company_id, project_id, proveedor_id, numero_factura, concepto, monto_total, monto_pagado)
                           VALUES ('cccccccc-cccc-cccc-cccc-cccccccccccc','c1c1c1c1-0000-0000-0000-000000000001','e3000000-0000-0000-0000-000000000001','CE-DIR-2','x',500,500) $$,
  'COMPRAS_ESTADO_INICIAL', '4e · ni con pagos puestos a mano');
SELECT public.chk_falla($$ INSERT INTO public.recepciones (company_id, project_id, orden_compra_id, tipo, estado)
                           VALUES ('cccccccc-cccc-cccc-cccc-cccccccccccc','c1c1c1c1-0000-0000-0000-000000000001','ce100000-0000-0000-0000-0000000000b3','servicio','registrada') $$,
  'COMPRAS_ESTADO_INICIAL', '4e · una recepción no se crea ya «registrada»');
SELECT public.chk_falla($$ INSERT INTO public.contrasenas_pago (company_id, project_id, proveedor_id, fecha_pago_programada, estado)
                           VALUES ('cccccccc-cccc-cccc-cccc-cccccccccccc','c1c1c1c1-0000-0000-0000-000000000001','e3000000-0000-0000-0000-000000000001', CURRENT_DATE, 'pagada') $$,
  'COMPRAS_ESTADO_INICIAL', '4e · una contraseña no se crea ya «pagada»');
INSERT INTO public.facturas_proveedor (id, company_id, project_id, proveedor_id, numero_factura, concepto, monto_total)
VALUES ('ce300000-0000-0000-0000-0000000000f9', :C::uuid, :C1::uuid, :P1::uuid, 'CE-SIS-1', 'Estado de sistema', 500);
SELECT public.chk_falla($$ UPDATE public.facturas_proveedor SET estado = 'pagada', monto_pagado = 500 WHERE id = 'ce300000-0000-0000-0000-0000000000f9' $$,
  'COMPRAS_ESTADO_SOLO_SISTEMA', '4e · una factura no se marca «pagada» a mano');
SELECT public.chk_falla($$ UPDATE public.facturas_proveedor SET monto_pagado = 100 WHERE id = 'ce300000-0000-0000-0000-0000000000f9' $$,
  'COMPRAS_ESTADO_SOLO_SISTEMA', '4e · ni se le escribe lo pagado');
INSERT INTO public.contrasenas_pago (id, company_id, project_id, proveedor_id, fecha_pago_programada)
VALUES ('ce500000-0000-0000-0000-0000000000f9', :C::uuid, :C1::uuid, :P1::uuid, CURRENT_DATE);
SELECT public.chk_falla($$ UPDATE public.contrasenas_pago SET estado = 'pagada' WHERE id = 'ce500000-0000-0000-0000-0000000000f9' $$,
  'COMPRAS_ESTADO_SOLO_SISTEMA', '4e · una contraseña no se marca «pagada» a mano');
RESET ROLE;

RESET ROLE;
SELECT public.chk_uuid((SELECT aprobada_por FROM public.ordenes_compra WHERE id = 'ce100000-0000-0000-0000-0000000000f4'), :UA::uuid,
  '4e · la orden insertada ya aprobada por el administrador lleva SU firma (el navegador dijo UC)');
SELECT public.chk_txt((SELECT estado FROM public.ordenes_compra WHERE id = 'ce100000-0000-0000-0000-0000000000f4'), 'aprobada', '4e · y quedó aprobada');
SELECT public.chk_bool((SELECT numero IS NOT NULL FROM public.ordenes_compra WHERE id = 'ce100000-0000-0000-0000-0000000000f4'), true, '4e · y numerada');

-- 4f · El administrador (rol) recorre todo el circuito sin permisos individuales: el resto del
-- bloque (sección 2) ya lo hace. Y sin usuario (servicio / mantenimiento) no se aplican estos controles.
SELECT set_config('request.jwt.claim.sub', '', false);
INSERT INTO public.ordenes_compra (id, company_id, project_id, proveedor_id, proveedor_nombre, concepto)
VALUES ('ce100000-0000-0000-0000-0000000000f3', 'cccccccc-cccc-cccc-cccc-cccccccccccc', 'c1c1c1c1-0000-0000-0000-000000000001', 'e3000000-0000-0000-0000-000000000001', 'x', 'proceso de mantenimiento');
INSERT INTO public.orden_compra_lineas (id, company_id, orden_compra_id, linea, descripcion, destino_tipo, categoria, cantidad, unidad, precio_unitario)
VALUES ('ce110000-0000-0000-0000-0000000000f3', 'cccccccc-cccc-cccc-cccc-cccccccccccc', 'ce100000-0000-0000-0000-0000000000f3', 1, 'x', 'servicio', 'servicios', 1, 'servicio', 10);
UPDATE public.ordenes_compra SET estado = 'aprobada' WHERE id = 'ce100000-0000-0000-0000-0000000000f3';
SELECT public.chk_txt((SELECT estado FROM public.ordenes_compra WHERE id = 'ce100000-0000-0000-0000-0000000000f3'), 'aprobada',
  '4f · un proceso sin usuario (mantenimiento) no pasa por los permisos de persona');

-- ═══════════════════════════════════════════════════════════════════════════
-- 5 · DUPLICADOS (proveedor: decisión vigente; factura: número equivalente)
-- ═══════════════════════════════════════════════════════════════════════════
SELECT public.como(:UA::uuid);
SET ROLE authenticated;
-- 5a · el proveedor con nombre equivalente. DECISIÓN VIGENTE (PR A, proveedores_pr_a/assert_identidad §4):
-- «los nombres parecidos conviven; no se rechazan por parecerse» y los duplicados se LISTAN, no se
-- bloquean. 20261027000400 intentó rechazarlos y 20261027000600 lo deshizo al chocar con esa decisión.
-- Esta aserción fija el comportamiento ACTUAL: si el negocio decide lo contrario (pregunta 8 de
-- docs/COMPRAS_CONTROLES_SERVIDOR.md) este caso debe cambiar con esa decisión, no por accidente.
INSERT INTO public.proveedores (id, company_id, nombre) VALUES ('ce600000-0000-0000-0000-000000000001', :C::uuid, 'Distribuidora CE Norte');
INSERT INTO public.proveedores (id, company_id, nombre) VALUES ('ce600000-0000-0000-0000-000000000002', :C::uuid, 'DISTRIBUIDORA  ce norte.');
RESET ROLE;
SELECT public.chk((SELECT count(*) FROM public.proveedores WHERE company_id = 'cccccccc-cccc-cccc-cccc-cccccccccccc' AND public.proveedor_normalizar_nombre(nombre) = 'distribuidora ce norte'), 2,
  '5a · (decisión vigente) dos nombres equivalentes sin identificación fiscal conviven: se listan, no se bloquean');
SELECT public.como(:UA::uuid);
SET ROLE authenticated;
INSERT INTO public.proveedores (id, company_id, nombre, nit, pais) VALUES ('ce600000-0000-0000-0000-000000000003', :C::uuid, 'Proveedor CE con NIT', '7777777-7', 'GT');
SELECT public.chk_falla($$ INSERT INTO public.proveedores (company_id, nombre, nit, pais) VALUES ('cccccccc-cccc-cccc-cccc-cccccccccccc', 'Otro nombre, mismo NIT', '7777777-7', 'GT') $$,
  'PROVEEDOR_DUPLICADO', '5a · lo que SÍ une es la identificación fiscal: el mismo NIT en el mismo país se rechaza');
RESET ROLE;

-- 5b · la factura con otro formato de número
SELECT public.como(:UA::uuid);
SET ROLE authenticated;
INSERT INTO public.facturas_proveedor (id, company_id, project_id, proveedor_id, numero_factura, concepto, monto_total)
VALUES ('ce300000-0000-0000-0000-0000000000a2', :C::uuid, :C1::uuid, :P1::uuid, 'CE-FAC-100', 'primera', 100);
SELECT public.chk_falla($$ INSERT INTO public.facturas_proveedor (company_id, project_id, proveedor_id, numero_factura, concepto, monto_total)
                           VALUES ('cccccccc-cccc-cccc-cccc-cccccccccccc','c1c1c1c1-0000-0000-0000-000000000001','e3000000-0000-0000-0000-000000000001',' ce fac 100 ','misma',100) $$,
  'COMPRAS_FACTURA_NUMERO_DUPLICADO', '5b · «CE-FAC-100» y « ce fac 100 » son la misma factura');
SELECT public.chk_falla($$ INSERT INTO public.facturas_proveedor (company_id, project_id, proveedor_id, numero_factura, concepto, monto_total)
                           VALUES ('cccccccc-cccc-cccc-cccc-cccccccccccc','c1c1c1c1-0000-0000-0000-000000000001','e3000000-0000-0000-0000-000000000001','CE-FAC-100','misma',100) $$,
  'uq_facturas_prov_numero', '5b · el número idéntico lo sigue rechazando el índice único de siempre');
INSERT INTO public.facturas_proveedor (id, company_id, project_id, proveedor_id, numero_factura, concepto, monto_total)
VALUES ('ce300000-0000-0000-0000-0000000000a3', :C::uuid, :C1::uuid, :P1::uuid, 'CE-FAC-1000', 'otro número', 100);
INSERT INTO public.facturas_proveedor (id, company_id, project_id, proveedor_id, numero_factura, concepto, monto_total)
VALUES ('ce300000-0000-0000-0000-0000000000a4', :C::uuid, :C1::uuid, :P2::uuid, 'ce-fac-100', 'otro proveedor', 100);
SELECT public.chk_falla($$ UPDATE public.facturas_proveedor SET numero_factura = 'CEFAC100' WHERE id = 'ce300000-0000-0000-0000-0000000000a3' $$,
  'COMPRAS_FACTURA_NUMERO_DUPLICADO', '5b · cambiar el número de otra factura a uno equivalente también se rechaza');
-- Por la RPC transaccional el mensaje es el mismo que ya conoce la pantalla.
SELECT public.chk_falla($$ SELECT public.compras_factura_crear('cccccccc-cccc-cccc-cccc-cccccccccccc', 'c1c1c1c1-0000-0000-0000-000000000001',
    '{"proveedor_id":"e3000000-0000-0000-0000-000000000001","numero_factura":"ce.fac.100","concepto":"por la RPC","monto_total":100,"clave_idempotencia":"ce-clave-dup-001"}'::jsonb, '[]'::jsonb) $$,
  'COMPRAS_FACTURA_NUMERO_DUPLICADO', '5b · y por compras_factura_crear el error es el mismo que ya muestra la pantalla');
-- Anulada la primera, el número se puede reutilizar (igual que con el índice único).
UPDATE public.facturas_proveedor SET estado = 'anulada' WHERE id = 'ce300000-0000-0000-0000-0000000000a2';
INSERT INTO public.facturas_proveedor (id, company_id, project_id, proveedor_id, numero_factura, concepto, monto_total)
VALUES ('ce300000-0000-0000-0000-0000000000a5', :C::uuid, :C1::uuid, :P1::uuid, 'ce fac 100', 'reemplazo de la anulada', 100);
RESET ROLE;
SELECT public.chk((SELECT count(*) FROM public.facturas_proveedor WHERE id = 'ce300000-0000-0000-0000-0000000000a5'), 1,
  '5b · con la primera anulada, el número equivalente se puede volver a usar');
-- Duplicado histórico: aprobarlo (cambio de estado) no se bloquea.
SET session_replication_role = replica;
INSERT INTO public.facturas_proveedor (id, company_id, project_id, proveedor_id, numero_factura, concepto, monto_total)
VALUES ('ce300000-0000-0000-0000-0000000000a6', 'cccccccc-cccc-cccc-cccc-cccccccccccc', 'c1c1c1c1-0000-0000-0000-000000000001', 'e3000000-0000-0000-0000-000000000001', 'CE.FAC.100', 'duplicado histórico', 100);
SET session_replication_role = origin;
SELECT public.como(:UQ::uuid);
SET ROLE authenticated;
UPDATE public.facturas_proveedor SET estado = 'aprobada' WHERE id = 'ce300000-0000-0000-0000-0000000000a6';
RESET ROLE;
SELECT public.chk_txt((SELECT estado FROM public.facturas_proveedor WHERE id = 'ce300000-0000-0000-0000-0000000000a6'), 'aprobada',
  '5b · un duplicado histórico conserva sus cambios de estado (el control es al nacer o al cambiar el número)');

-- ═══════════════════════════════════════════════════════════════════════════
-- 6 · CAMBIOS A UNA ORDEN DESPUÉS DE APROBARLA
-- ═══════════════════════════════════════════════════════════════════════════
SELECT public.como(:UA::uuid);
SET ROLE authenticated;
SELECT public.ce_oc('ce100000-0000-0000-0000-0000000000a1', 'ce110000-0000-0000-0000-0000000000a1', :P1::uuid, 'servicio', 10, 100, 0);
UPDATE public.ordenes_compra SET notas = 'Entregar en portería', concepto = 'Servicio ajustado' WHERE id = 'ce100000-0000-0000-0000-0000000000a1';
UPDATE public.ordenes_compra SET notas = 'Entregar en portería' WHERE id = 'ce100000-0000-0000-0000-0000000000a1';   -- sin cambio: no deja evento
RESET ROLE;
SELECT public.chk((SELECT count(*) FROM public.orden_compra_eventos WHERE orden_compra_id = 'ce100000-0000-0000-0000-0000000000a1' AND tipo = 'modificacion'), 1,
  '6a · cambiar notas y concepto de una orden emitida deja UN evento «modificacion» (guardar lo mismo no deja otro)');
SELECT public.chk_bool((SELECT motivo ~ 'notas' AND motivo ~ 'concepto' AND motivo ~ 'Entregar en portería' FROM public.orden_compra_eventos
                         WHERE orden_compra_id = 'ce100000-0000-0000-0000-0000000000a1' AND tipo = 'modificacion'), true,
  '6a · el evento dice qué campos cambiaron y su valor nuevo');
SELECT public.chk_uuid((SELECT actor_id FROM public.orden_compra_eventos WHERE orden_compra_id = 'ce100000-0000-0000-0000-0000000000a1' AND tipo = 'modificacion'), :UA::uuid,
  '6a · y quién lo hizo');
SELECT public.como(:UA::uuid);
SET ROLE authenticated;
SELECT public.chk_falla($$ UPDATE public.ordenes_compra SET numero = 'OC-999999' WHERE id = 'ce100000-0000-0000-0000-0000000000a1' $$,
  'COMPRAS_OC_NUMERO_INMUTABLE', '6b · el número de la orden es su identidad y no cambia');
SELECT public.chk_falla($$ UPDATE public.ordenes_compra SET proveedor_nombre = 'Otro proveedor impreso' WHERE id = 'ce100000-0000-0000-0000-0000000000a1' $$,
  'COMPRAS_OC_APROBADA_CAMBIO', '6b · el nombre impreso del proveedor de una orden emitida no se reescribe');
INSERT INTO public.ordenes_compra (id, company_id, project_id, proveedor_id, proveedor_nombre, concepto)
VALUES ('ce100000-0000-0000-0000-0000000000a2', :C::uuid, :C1::uuid, :P1::uuid, 'Nombre', 'Borrador');
UPDATE public.ordenes_compra SET notas = 'x', proveedor_nombre = 'Nombre corregido' WHERE id = 'ce100000-0000-0000-0000-0000000000a2';
RESET ROLE;
SELECT public.chk((SELECT count(*) FROM public.orden_compra_eventos WHERE orden_compra_id = 'ce100000-0000-0000-0000-0000000000a2' AND tipo = 'modificacion'), 0,
  '6c · mientras es borrador se edita libremente y no deja evento de modificación');

-- ═══════════════════════════════════════════════════════════════════════════
-- 7 · NI APROBAR LA ORDEN NI CARGAR LA FACTURA MUEVEN EXISTENCIAS
-- ═══════════════════════════════════════════════════════════════════════════
CREATE TEMP TABLE ce_stock AS SELECT stock_actual AS antes FROM public.suministros_condominio WHERE id = 'cccccccc-0000-0000-0000-000000000000' OR id = '50000000-0000-0000-0000-0000000000c1';
GRANT SELECT ON ce_stock TO authenticated;
SELECT public.como(:UA::uuid);
SET ROLE authenticated;
SELECT public.ce_oc('ce100000-0000-0000-0000-0000000000a3', 'ce110000-0000-0000-0000-0000000000a3', :P1::uuid, 'inventario', 10, 10, 0, :S1::uuid);
SELECT public.ce_factura('ce300000-0000-0000-0000-0000000000a7', 'ce100000-0000-0000-0000-0000000000a3', 'ce110000-0000-0000-0000-0000000000a3', :P1::uuid, 'CE-INV-1', 10, 10, 0);
SELECT public.chk_falla($$ UPDATE public.facturas_proveedor SET estado = 'aprobada' WHERE id = 'ce300000-0000-0000-0000-0000000000a7' $$,
  'COMPRAS_MATCH_NO_FORZABLE', '7a · facturar lo que no se ha recibido no se aprueba, ni con justificación');
RESET ROLE;
SELECT public.chk_num((SELECT stock_actual FROM public.suministros_condominio WHERE id = :S1::uuid), (SELECT antes FROM ce_stock),
  '7a · aprobar la orden y cargar la factura NO mueven el stock');
SELECT public.como(:UC::uuid);
SET ROLE authenticated;
SELECT public.ce_recepcion('ce200000-0000-0000-0000-0000000000a3', 'ce100000-0000-0000-0000-0000000000a3', 'ce110000-0000-0000-0000-0000000000a3', 10, 'bienes');
RESET ROLE;
SELECT public.chk_num((SELECT stock_actual FROM public.suministros_condominio WHERE id = :S1::uuid), (SELECT antes FROM ce_stock),
  '7b · capturar la recepción en borrador tampoco mueve el stock');
SELECT public.como(:US::uuid);
SET ROLE authenticated;
UPDATE public.recepciones SET estado = 'registrada' WHERE id = 'ce200000-0000-0000-0000-0000000000a3';
RESET ROLE;
SELECT public.chk_num((SELECT stock_actual FROM public.suministros_condominio WHERE id = :S1::uuid), (SELECT antes FROM ce_stock) + 10,
  '7c · registrar la recepción aceptada SÍ lo sube (+10)');
SELECT public.como(:UQ::uuid);
SET ROLE authenticated;
UPDATE public.facturas_proveedor SET estado = 'aprobada' WHERE id = 'ce300000-0000-0000-0000-0000000000a7';
RESET ROLE;
SELECT public.chk_num((SELECT stock_actual FROM public.suministros_condominio WHERE id = :S1::uuid), (SELECT antes FROM ce_stock) + 10,
  '7d · aprobar la factura de lo recibido no lo sube otra vez');
SELECT public.como(:US::uuid);
SET ROLE authenticated;
UPDATE public.facturas_proveedor SET estado = 'anulada' WHERE id = 'ce300000-0000-0000-0000-0000000000a7';
RESET ROLE;
SELECT public.chk_num((SELECT stock_actual FROM public.suministros_condominio WHERE id = :S1::uuid), (SELECT antes FROM ce_stock) + 10,
  '7e · anular la factura no toca las existencias (la recepción es lo que las movió)');
SELECT public.chk((SELECT count(*) FROM public.movimientos_suministro WHERE origen_tabla = 'recepcion_lineas'
                    AND origen_id IN (SELECT id FROM public.recepcion_lineas WHERE recepcion_id = 'ce200000-0000-0000-0000-0000000000a3')), 1,
  '7e · una sola entrada al kardex, de la recepción');
