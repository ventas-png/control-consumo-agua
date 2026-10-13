\set ON_ERROR_STOP on

-- ============================================================================
-- INVARIANTES · SEGUIMIENTO COMPARTIDO PARA UNA PANTALLA FILTRABLE
-- (migración 20261022000300: pendientes, moneda efectiva y pagos enlazados)
--
-- Orden OG (C1, P1, GTQ): 10 × 100 + IVA 120 · recibida 6 + 4 · factura de 6 (672) pagada
--   300 directo + 372 por una contraseña · las 4 restantes recibidas y SIN facturar.
-- Orden OU (C1, P2, USD): 5 × 20 recibida y facturada (aprobada; cierra la orden), sin pagos.
-- Orden OH (C2, P1, GTQ): en borrador, en OTRO proyecto de la misma empresa.
-- ============================================================================
\set C   '''cccccccc-cccc-cccc-cccc-cccccccccccc'''
\set C1  '''c1c1c1c1-0000-0000-0000-000000000001'''
\set C2  '''c2c2c2c2-0000-0000-0000-000000000001'''
\set UA  '''c0c0c0c0-0000-0000-0000-00000000000a'''
\set UC  '''c0c0c0c0-0000-0000-0000-00000000000c'''
\set UO  '''c0c0c0c0-0000-0000-0000-00000000000d'''
\set UN  '''c0c0c0c0-0000-0000-0000-00000000000e'''
\set UD  '''d0d0d0d0-0000-0000-0000-00000000000d'''
\set P1  '''e3000000-0000-0000-0000-000000000001'''
\set P2  '''e3000000-0000-0000-0000-000000000002'''
\set OG  '''0c900000-0000-0000-0000-000000000001'''
\set LG  '''0c910000-0000-0000-0000-000000000001'''
\set OU  '''0c900000-0000-0000-0000-000000000002'''
\set LU  '''0c910000-0000-0000-0000-000000000002'''
\set OH  '''0c900000-0000-0000-0000-000000000003'''
\set LH  '''0c910000-0000-0000-0000-000000000003'''

-- ── Preparación por las vías normales ───────────────────────────────────────
SELECT public.como(:UO::uuid);
SET ROLE authenticated;
INSERT INTO public.ordenes_compra (id, company_id, project_id, proveedor_id, proveedor_nombre, concepto) VALUES
  (:OG::uuid, :C::uuid, :C1::uuid, :P1::uuid, 'Ferretería Bloque B', 'Orden GTQ de la pantalla'),
  (:OH::uuid, :C::uuid, :C2::uuid, :P1::uuid, 'Ferretería Bloque B', 'Orden de otro proyecto');
INSERT INTO public.ordenes_compra (id, company_id, project_id, proveedor_id, proveedor_nombre, concepto, moneda)
VALUES (:OU::uuid, :C::uuid, :C1::uuid, :P2::uuid, 'Servicios Bloque B', 'Orden USD de la pantalla', 'USD');
INSERT INTO public.orden_compra_lineas (id, company_id, orden_compra_id, linea, descripcion, destino_tipo, categoria, cantidad, unidad, precio_unitario, iva_monto) VALUES
  (:LG::uuid, :C::uuid, :OG::uuid, 1, 'Material', 'gasto', 'mantenimiento', 10, 'unidad', 100, 120),
  (:LU::uuid, :C::uuid, :OU::uuid, 1, 'Servicio en dólares', 'gasto', 'servicios', 5, 'unidad', 20, 12),
  (:LH::uuid, :C::uuid, :OH::uuid, 1, 'Material C2', 'gasto', 'mantenimiento', 1, 'unidad', 50, 0);
SELECT public.como(:UA::uuid);
UPDATE public.ordenes_compra SET estado = 'aprobada' WHERE id IN (:OG::uuid, :OU::uuid);
UPDATE public.ordenes_compra SET estado = 'emitida'  WHERE id IN (:OG::uuid, :OU::uuid);
INSERT INTO public.recepciones (id, company_id, project_id, orden_compra_id, tipo) VALUES
  ('0c920000-0000-0000-0000-000000000001', :C::uuid, :C1::uuid, :OG::uuid, 'bienes'),
  ('0c920000-0000-0000-0000-000000000002', :C::uuid, :C1::uuid, :OU::uuid, 'bienes');
INSERT INTO public.recepcion_lineas (company_id, recepcion_id, orden_compra_linea_id, cantidad, costo_unitario) VALUES
  (:C::uuid, '0c920000-0000-0000-0000-000000000001', :LG::uuid, 6, 100),
  (:C::uuid, '0c920000-0000-0000-0000-000000000002', :LU::uuid, 5, 20);
UPDATE public.recepciones SET estado = 'registrada' WHERE id IN ('0c920000-0000-0000-0000-000000000001', '0c920000-0000-0000-0000-000000000002');
-- las 4 restantes de OG: recibidas, SIN facturar
INSERT INTO public.recepciones (id, company_id, project_id, orden_compra_id, tipo) VALUES ('0c920000-0000-0000-0000-000000000003', :C::uuid, :C1::uuid, :OG::uuid, 'bienes');
INSERT INTO public.recepcion_lineas (company_id, recepcion_id, orden_compra_linea_id, cantidad, costo_unitario) VALUES (:C::uuid, '0c920000-0000-0000-0000-000000000003', :LG::uuid, 4, 100);
UPDATE public.recepciones SET estado = 'registrada' WHERE id = '0c920000-0000-0000-0000-000000000003';
RESET ROLE;

SELECT public.como(:UC::uuid);
SET ROLE authenticated;
CREATE TEMP TABLE res_sp (k text PRIMARY KEY, j jsonb);
GRANT ALL ON res_sp TO authenticated;
INSERT INTO res_sp SELECT 'fg', public.compras_factura_crear(:C::uuid, :C1::uuid,
  format('{"proveedor_id":"e3000000-0000-0000-0000-000000000001","orden_compra_id":"0c900000-0000-0000-0000-000000000001","numero_factura":"SP-G1","concepto":"Factura de 6","clave_idempotencia":"sp-clave-g1"}')::jsonb,
  '[{"orden_compra_linea_id":"0c910000-0000-0000-0000-000000000001","cantidad":6,"precio_unitario":100,"iva_monto":72}]'::jsonb);
INSERT INTO res_sp SELECT 'fu', public.compras_factura_crear(:C::uuid, :C1::uuid,
  format('{"proveedor_id":"e3000000-0000-0000-0000-000000000002","orden_compra_id":"0c900000-0000-0000-0000-000000000002","numero_factura":"SP-U1","concepto":"Factura en USD","clave_idempotencia":"sp-clave-u1"}')::jsonb,
  '[{"orden_compra_linea_id":"0c910000-0000-0000-0000-000000000002","cantidad":5,"precio_unitario":20,"iva_monto":12}]'::jsonb);
SELECT public.como(:UA::uuid);
UPDATE public.facturas_proveedor SET estado = 'aprobada' WHERE numero_factura IN ('SP-G1', 'SP-U1');
-- pago directo de 300 a la factura de OG
INSERT INTO public.ordenes_pago (id, company_id, project_id, proveedor_id, factura_id, monto, metodo_pago, referencia)
SELECT '0c930000-0000-0000-0000-000000000001', f.company_id, f.project_id, f.proveedor_id, f.id, 300, 'transferencia', 'TRF-300'
  FROM public.facturas_proveedor f WHERE f.numero_factura = 'SP-G1';
UPDATE public.ordenes_pago SET estado = 'aprobada' WHERE id = '0c930000-0000-0000-0000-000000000001';
UPDATE public.ordenes_pago SET estado = 'pagada', fecha_pago = CURRENT_DATE WHERE id = '0c930000-0000-0000-0000-000000000001';
-- el saldo (372) por una contraseña de pago
INSERT INTO public.contrasenas_pago (id, company_id, project_id, proveedor_id, fecha_pago_programada, moneda)
VALUES ('0c940000-0000-0000-0000-000000000001', :C::uuid, :C1::uuid, :P1::uuid, CURRENT_DATE, NULL);
INSERT INTO public.contrasena_pago_facturas (company_id, contrasena_id, factura_id, monto)
SELECT :C::uuid, '0c940000-0000-0000-0000-000000000001', f.id, 372 FROM public.facturas_proveedor f WHERE f.numero_factura = 'SP-G1';
INSERT INTO public.ordenes_pago (id, company_id, project_id, proveedor_id, contrasena_pago_id, monto, metodo_pago, referencia)
VALUES ('0c930000-0000-0000-0000-000000000002', :C::uuid, :C1::uuid, :P1::uuid, '0c940000-0000-0000-0000-000000000001', 372, 'transferencia', 'TRF-372');
UPDATE public.ordenes_pago SET estado = 'aprobada' WHERE id = '0c930000-0000-0000-0000-000000000002';
UPDATE public.ordenes_pago SET estado = 'pagada', fecha_pago = CURRENT_DATE WHERE id = '0c930000-0000-0000-0000-000000000002';
RESET ROLE;
SELECT public.chk_txt((SELECT estado FROM public.facturas_proveedor WHERE numero_factura = 'SP-G1'), 'pagada', '0 · la factura de OG quedó pagada (300 directo + 372 por contraseña)');
SELECT public.chk_txt((SELECT estado FROM public.ordenes_compra WHERE id = :OU::uuid), 'cerrada', '0 · la orden USD quedó cerrada');
SELECT public.chk_txt((SELECT estado FROM public.ordenes_compra WHERE id = :OG::uuid), 'recibida', '0 · la orden GTQ está recibida (le faltan 4 por facturar)');

-- ── 1. Quien ve Contabilidad: cada indicador por separado, cada fila en su moneda ──
SELECT public.como(:UC::uuid);
SET ROLE authenticated;
CREATE TEMP TABLE lista_c AS SELECT * FROM public.compras_seguimiento_lista();
GRANT ALL ON lista_c TO authenticated;
RESET ROLE;
SELECT public.chk((SELECT count(*) FROM lista_c WHERE orden_id IN (:OG::uuid, :OU::uuid, :OH::uuid)), 3, '1 · las tres órdenes de la empresa, sin duplicar filas');
SELECT public.chk_txt((SELECT moneda FROM lista_c WHERE orden_id = :OG::uuid), 'GTQ', '1 · una orden sin moneda propia se muestra en la moneda BASE (nunca NULL)');
SELECT public.chk_txt((SELECT moneda FROM lista_c WHERE orden_id = :OU::uuid), 'USD', '1 · la orden en dólares se muestra en USD');
SELECT public.chk_num((SELECT comprometido FROM lista_c WHERE orden_id = :OG::uuid), 1120, '1 · OG comprometido (con IVA) = 1120');
SELECT public.chk_num((SELECT comprometido_neto FROM lista_c WHERE orden_id = :OG::uuid), 1000, '1 · OG comprometido neto = 1000');
SELECT public.chk_num((SELECT recibido FROM lista_c WHERE orden_id = :OG::uuid), 1000, '1 · OG recibido = 1000 (6 + 4 aceptados a precio de orden)');
SELECT public.chk_num((SELECT facturado FROM lista_c WHERE orden_id = :OG::uuid), 672, '1 · OG facturado = 672 (solo lo aprobado)');
SELECT public.chk_num((SELECT facturado_neto FROM lista_c WHERE orden_id = :OG::uuid), 600, '1 · OG facturado neto = 600');
SELECT public.chk_num((SELECT pagado FROM lista_c WHERE orden_id = :OG::uuid), 672, '1 · OG pagado = 672 (300 directo + 372 por contraseña)');
SELECT public.chk_num((SELECT pendiente_por_recibir FROM lista_c WHERE orden_id = :OG::uuid), 0, '1 · OG pendiente por recibir = 0');
SELECT public.chk_num((SELECT pendiente_por_facturar FROM lista_c WHERE orden_id = :OG::uuid), 400, '1 · OG pendiente por facturar = 400 (recibido 1000 − facturado neto 600)');
SELECT public.chk_num((SELECT pendiente_por_pagar FROM lista_c WHERE orden_id = :OG::uuid), 0, '1 · OG pendiente por pagar = 0');
SELECT public.chk((SELECT n_recepciones FROM lista_c WHERE orden_id = :OG::uuid), 2, '1 · OG tiene 2 recepciones registradas');
SELECT public.chk((SELECT n_facturas FROM lista_c WHERE orden_id = :OG::uuid), 1, '1 · y 1 factura');
SELECT public.chk_num((SELECT comprometido_neto FROM lista_c WHERE orden_id = :OU::uuid), 100, '1 · OU: 100 USD (5 × 20), SIN convertir ni sumar a los GTQ');
SELECT public.chk_num((SELECT facturado FROM lista_c WHERE orden_id = :OU::uuid), 112, '1 · OU facturado = 112 USD');
SELECT public.chk_num((SELECT pendiente_por_pagar FROM lista_c WHERE orden_id = :OU::uuid), 112, '1 · OU pendiente por pagar = 112 (no se pagó nada)');
SELECT public.chk_txt((SELECT string_agg(DISTINCT moneda, ',' ORDER BY moneda) FROM lista_c WHERE orden_id IN (:OG::uuid, :OU::uuid, :OH::uuid)), 'GTQ,USD', '1 · dos monedas distintas, cada fila en la suya');

-- ── 2. Operaciones: cantidades sí; importes de facturación y pagos NO (ni por la API) ─
SELECT public.como(:UO::uuid);
SET ROLE authenticated;
CREATE TEMP TABLE lista_o AS SELECT * FROM public.compras_seguimiento_lista();
GRANT ALL ON lista_o TO authenticated;
RESET ROLE;
SELECT public.chk((SELECT count(*) FROM lista_o WHERE orden_id IN (:OG::uuid, :OU::uuid, :OH::uuid)), 3, '2 · el operador ve las mismas órdenes');
SELECT public.chk_num((SELECT recibido FROM lista_o WHERE orden_id = :OG::uuid), 1000, '2 · y lo recibido');
SELECT public.chk_num((SELECT pendiente_por_recibir FROM lista_o WHERE orden_id = :OG::uuid), 0, '2 · y lo pendiente por recibir');
SELECT public.chk_bool((SELECT facturado IS NULL AND facturado_neto IS NULL AND pagado IS NULL AND pendiente_por_facturar IS NULL
                               AND pendiente_por_pagar IS NULL AND n_facturas IS NULL FROM lista_o WHERE orden_id = :OG::uuid), true,
  '2 · pero NINGÚN importe de facturación ni de pagos (NULL en facturado, pagado y pendientes financieros)');
SELECT public.chk_bool((SELECT bool_and(facturado IS NULL AND pagado IS NULL AND pendiente_por_facturar IS NULL AND pendiente_por_pagar IS NULL) FROM lista_o), true,
  '2 · en ninguna fila de la lista');
SELECT public.como(:UO::uuid);
SET ROLE authenticated;
CREATE TEMP TABLE det_o AS SELECT public.compras_seguimiento_orden(:OG::uuid) AS j;
GRANT ALL ON det_o TO authenticated;
RESET ROLE;
SELECT public.chk_bool((SELECT NOT (j ? 'facturas') AND NOT (j ? 'pagos') AND (j->>'contabilidad_visible')::boolean = false FROM det_o), true,
  '2 · el detalle de la orden tampoco trae facturas ni pagos para el operador');
SELECT public.chk_bool((SELECT j->'indicadores'->'facturado' = 'null'::jsonb AND j->'indicadores'->'pagado' = 'null'::jsonb FROM det_o), true,
  '2 · ni indicadores de facturado ni de pagado');

-- ── 3. Filtros ──────────────────────────────────────────────────────────────
SELECT public.como(:UC::uuid);
SET ROLE authenticated;
CREATE TEMP TABLE f_prov AS SELECT * FROM public.compras_seguimiento_lista(NULL, :P2::uuid);
CREATE TEMP TABLE f_est  AS SELECT * FROM public.compras_seguimiento_lista(NULL, NULL, 'recibida');
CREATE TEMP TABLE f_proy AS SELECT * FROM public.compras_seguimiento_lista(:C2::uuid);
CREATE TEMP TABLE f_fut  AS SELECT * FROM public.compras_seguimiento_lista(NULL, NULL, NULL, CURRENT_DATE + 1);
CREATE TEMP TABLE f_pas  AS SELECT * FROM public.compras_seguimiento_lista(NULL, NULL, NULL, NULL, CURRENT_DATE - 1);
CREATE TEMP TABLE f_hoy  AS SELECT * FROM public.compras_seguimiento_lista(NULL, NULL, NULL, CURRENT_DATE, CURRENT_DATE);
CREATE TEMP TABLE f_emp  AS SELECT * FROM public.compras_seguimiento_lista(NULL, NULL, NULL, NULL, NULL, true);
GRANT ALL ON f_prov, f_est, f_proy, f_fut, f_pas, f_hoy, f_emp TO authenticated;
RESET ROLE;
SELECT public.chk_txt((SELECT string_agg(orden_id::text, ',') FROM f_prov WHERE orden_id IN (:OG::uuid, :OU::uuid, :OH::uuid)), :OU, '3 · filtrar por proveedor deja solo su orden');
SELECT public.chk_txt((SELECT string_agg(orden_id::text, ',') FROM f_est WHERE orden_id IN (:OG::uuid, :OU::uuid, :OH::uuid)), :OG, '3 · filtrar por estado «recibida» deja solo OG (OU está cerrada)');
SELECT public.chk_txt((SELECT string_agg(orden_id::text, ',') FROM f_proy WHERE orden_id IN (:OG::uuid, :OU::uuid, :OH::uuid)), :OH, '3 · filtrar por proyecto deja solo la orden de ese proyecto');
SELECT public.chk((SELECT count(*) FROM f_fut WHERE orden_id IN (:OG::uuid, :OU::uuid, :OH::uuid)), 0, '3 · «desde mañana» no trae nada');
SELECT public.chk((SELECT count(*) FROM f_pas WHERE orden_id IN (:OG::uuid, :OU::uuid, :OH::uuid)), 0, '3 · «hasta ayer» no trae nada');
SELECT public.chk((SELECT count(*) FROM f_hoy WHERE orden_id IN (:OG::uuid, :OU::uuid, :OH::uuid)), 3, '3 · el rango de hoy trae las tres');
SELECT public.chk((SELECT count(*) FROM f_emp WHERE orden_id IN (:OG::uuid, :OU::uuid, :OH::uuid)), 0, '3 · «solo contabilidad de la empresa» no trae órdenes de proyecto');

-- ── 4. Aislamiento ──────────────────────────────────────────────────────────
SELECT public.como(:UD::uuid);
SET ROLE authenticated;
SELECT public.chk((SELECT count(*) FROM public.compras_seguimiento_lista()), 0, '4 · otra empresa no ve ninguna orden');
SELECT public.chk_falla($$ SELECT * FROM public.compras_seguimiento_lista('c1c1c1c1-0000-0000-0000-000000000001') $$,
  'no pertenece', '4 · ni puede pedir el proyecto de otra empresa');
RESET ROLE;

-- ── 5. Enlaces: orden → recepciones → facturas → pagos, sin duplicar registros ─
SELECT public.como(:UC::uuid);
SET ROLE authenticated;
CREATE TEMP TABLE det_c AS SELECT public.compras_seguimiento_orden(:OG::uuid) AS j;
GRANT ALL ON det_c TO authenticated;
RESET ROLE;
SELECT public.chk((SELECT jsonb_array_length(j->'recepciones') FROM det_c), 2, '5 · las dos recepciones registradas de la orden');
SELECT public.chk((SELECT jsonb_array_length(j->'facturas') FROM det_c), 1, '5 · la factura ligada');
SELECT public.chk((SELECT jsonb_array_length(j->'pagos') FROM det_c), 2, '5 · los DOS pagos (directo y por contraseña): una fila por pago, sin duplicados');
SELECT public.chk_num((SELECT sum((p->>'monto_aplicado')::numeric) FROM det_c, jsonb_array_elements(j->'pagos') p), 672, '5 · lo aplicado a la factura de ESTA orden suma 672');
SELECT public.chk_num((SELECT (p->>'monto_aplicado')::numeric FROM det_c, jsonb_array_elements(j->'pagos') p WHERE p->>'contrasena' IS NOT NULL), 372, '5 · el pago por contraseña muestra lo que cubre de esta factura (372)');
SELECT public.chk_bool((SELECT bool_and(p->>'numero_factura' = 'SP-G1') FROM det_c, jsonb_array_elements(j->'pagos') p), true, '5 · cada pago enlaza a su factura');
SELECT public.chk_num((SELECT (j->'indicadores'->>'pagado')::numeric FROM det_c), 672, '5 · y el indicador «pagado» coincide con los pagos enlazados');
SELECT public.chk_bool((SELECT NOT EXISTS (SELECT 1 FROM det_c, jsonb_array_elements(j->'recepciones') r WHERE (r->>'rechazado')::numeric < 0)), true, '5 · aceptado/rechazado de cada recepción presentes');

-- una orden de pago ANULADA deja de contar y de enlazarse
SELECT public.como(:UA::uuid);
SET ROLE authenticated;
UPDATE public.ordenes_pago SET estado = 'anulada' WHERE id = '0c930000-0000-0000-0000-000000000001';
RESET ROLE;
SELECT public.como(:UC::uuid);
SET ROLE authenticated;
CREATE TEMP TABLE det_c2 AS SELECT public.compras_seguimiento_orden(:OG::uuid) AS j;
CREATE TEMP TABLE lista_c2 AS SELECT * FROM public.compras_seguimiento_lista();
GRANT ALL ON det_c2, lista_c2 TO authenticated;
RESET ROLE;
SELECT public.chk((SELECT jsonb_array_length(j->'pagos') FROM det_c2), 1, '5 · al anular un pago, deja de listarse');
SELECT public.chk_num((SELECT pagado FROM lista_c2 WHERE orden_id = :OG::uuid), 372, '5 · y el pagado de la lista baja a 372');
SELECT public.chk_num((SELECT pendiente_por_pagar FROM lista_c2 WHERE orden_id = :OG::uuid), 300, '5 · y reaparece el pendiente por pagar (300)');
