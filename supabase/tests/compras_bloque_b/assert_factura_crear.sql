\set ON_ERROR_STOP on

-- ============================================================================
-- INVARIANTES · FACTURA CREADA POR UNA OPERACIÓN DE SERVIDOR
-- (migración 20261021000800: compras_factura_crear) y APROBACIÓN ENDURECIDA
-- (migración 20261021000700: compras_tg_factura_match).
--
-- Orden OX (C1, P1), emitida y recibida completa: X1 material 10 × 10 (IVA 12)
-- y X2 insumo 5 × 20 (IVA 12) → 224.00 con 24.00 de IVA.
-- ============================================================================
\set C   '''cccccccc-cccc-cccc-cccc-cccccccccccc'''
\set C1  '''c1c1c1c1-0000-0000-0000-000000000001'''
\set C2  '''c2c2c2c2-0000-0000-0000-000000000001'''
\set D1  '''d1d1d1d1-0000-0000-0000-000000000001'''
\set UA  '''c0c0c0c0-0000-0000-0000-00000000000a'''
\set UB  '''c0c0c0c0-0000-0000-0000-00000000000b'''
\set UK  '''c0c0c0c0-0000-0000-0000-00000000000c'''
\set UO  '''c0c0c0c0-0000-0000-0000-00000000000d'''
\set UN  '''c0c0c0c0-0000-0000-0000-00000000000e'''
\set UD  '''d0d0d0d0-0000-0000-0000-00000000000d'''
\set P1  '''e3000000-0000-0000-0000-000000000001'''
\set P2  '''e3000000-0000-0000-0000-000000000002'''
\set OX  '''0f400000-0000-0000-0000-000000000001'''
\set X1  '''0f410000-0000-0000-0000-000000000001'''
\set X2  '''0f410000-0000-0000-0000-000000000002'''
\set OY  '''0f400000-0000-0000-0000-000000000002'''
\set Y1  '''0f410000-0000-0000-0000-000000000003'''
\set OZ  '''0f400000-0000-0000-0000-000000000003'''
\set Z1  '''0f410000-0000-0000-0000-000000000004'''
\set OB  '''0f400000-0000-0000-0000-000000000004'''
\set OU  '''0f400000-0000-0000-0000-000000000005'''
\set U1  '''0f410000-0000-0000-0000-000000000005'''

CREATE TEMP TABLE res_fc (k text PRIMARY KEY, j jsonb);
GRANT ALL ON res_fc TO authenticated;

-- ── Preparación: órdenes por las vías normales ──────────────────────────────
SELECT public.como(:UA::uuid);
SET ROLE authenticated;
INSERT INTO public.ordenes_compra (id, company_id, project_id, proveedor_id, proveedor_nombre, concepto) VALUES
  (:OX::uuid, :C::uuid, :C1::uuid, :P1::uuid, 'Ferretería Bloque B', 'Factura transaccional'),
  (:OY::uuid, :C::uuid, :C2::uuid, :P1::uuid, 'Ferretería Bloque B', 'Otra contabilidad'),
  (:OZ::uuid, :C::uuid, :C1::uuid, :P2::uuid, 'Servicios Bloque B',  'Otro proveedor'),
  (:OB::uuid, :C::uuid, :C1::uuid, :P1::uuid, 'Ferretería Bloque B', 'En borrador'),
  (:OU::uuid, :C::uuid, :C1::uuid, :P1::uuid, 'Ferretería Bloque B', 'Con precio distinto');
INSERT INTO public.orden_compra_lineas (id, company_id, orden_compra_id, linea, descripcion, destino_tipo, categoria, cantidad, unidad, precio_unitario, iva_monto) VALUES
  (:X1::uuid, :C::uuid, :OX::uuid, 1, 'Material', 'gasto', 'mantenimiento', 10, 'u', 10, 12),
  (:X2::uuid, :C::uuid, :OX::uuid, 2, 'Insumo',   'gasto', 'mantenimiento',  5, 'u', 20, 12),
  (:Y1::uuid, :C::uuid, :OY::uuid, 1, 'Material', 'gasto', 'mantenimiento', 10, 'u', 10, 12),
  (:Z1::uuid, :C::uuid, :OZ::uuid, 1, 'Material', 'gasto', 'mantenimiento', 10, 'u', 10, 12),
  (:U1::uuid, :C::uuid, :OU::uuid, 1, 'Material', 'gasto', 'mantenimiento', 10, 'u', 10, 12);
UPDATE public.ordenes_compra SET estado = 'aprobada' WHERE id IN (:OX::uuid, :OY::uuid, :OZ::uuid, :OU::uuid);
UPDATE public.ordenes_compra SET estado = 'emitida'  WHERE id IN (:OX::uuid, :OY::uuid, :OZ::uuid, :OU::uuid);
-- OX y OU se reciben completas (como lo haría el flujo)
INSERT INTO public.recepciones (id, company_id, project_id, orden_compra_id, tipo) VALUES
  ('0f420000-0000-0000-0000-000000000001', :C::uuid, :C1::uuid, :OX::uuid, 'bienes'),
  ('0f420000-0000-0000-0000-000000000002', :C::uuid, :C1::uuid, :OU::uuid, 'bienes');
INSERT INTO public.recepcion_lineas (company_id, recepcion_id, orden_compra_linea_id, cantidad) VALUES
  (:C::uuid, '0f420000-0000-0000-0000-000000000001', :X1::uuid, 10),
  (:C::uuid, '0f420000-0000-0000-0000-000000000001', :X2::uuid, 5),
  (:C::uuid, '0f420000-0000-0000-0000-000000000002', :U1::uuid, 10);
UPDATE public.recepciones SET estado = 'registrada' WHERE id IN ('0f420000-0000-0000-0000-000000000001', '0f420000-0000-0000-0000-000000000002');
RESET ROLE;
SELECT public.chk_txt((SELECT estado FROM public.ordenes_compra WHERE id = :OX::uuid), 'recibida', '0 · orden OX recibida completa');

-- ── 1. Cabecera y renglones juntos; el total sale de los renglones, no del cliente ─
SELECT public.como(:UK::uuid);                       -- el contador captura
SET ROLE authenticated;
INSERT INTO res_fc SELECT 'a', public.compras_factura_crear(:C::uuid, :C1::uuid,
  '{"proveedor_id":"e3000000-0000-0000-0000-000000000001","orden_compra_id":"0f400000-0000-0000-0000-000000000001","numero_factura":"FC-0001","fecha_emision":"2026-10-02","concepto":"Factura de OX","monto_total":1,"iva_monto":0,"moneda":"GTQ","clave_idempotencia":"clave-fc-0001"}'::jsonb,
  '[{"orden_compra_linea_id":"0f410000-0000-0000-0000-000000000001","cantidad":10,"precio_unitario":10,"iva_monto":12},
    {"orden_compra_linea_id":"0f410000-0000-0000-0000-000000000002","cantidad":5,"precio_unitario":20,"iva_monto":12}]'::jsonb);
RESET ROLE;
SELECT public.chk_bool((SELECT (j->>'reutilizada')::boolean FROM res_fc WHERE k = 'a'), false, '1 · creación nueva (no reutilizada)');
SELECT public.chk_txt((SELECT j->'factura'->>'estado' FROM res_fc WHERE k = 'a'), 'registrada', '1 · nace registrada');
SELECT public.chk((SELECT jsonb_array_length(j->'lineas') FROM res_fc WHERE k = 'a'), 2, '1 · con sus dos renglones');
SELECT public.chk_num((SELECT monto_total FROM public.facturas_proveedor WHERE clave_idempotencia = 'clave-fc-0001'), 224, '1 · el total sale de los renglones (224.00), no del 1 que mandó el cliente');
SELECT public.chk_num((SELECT iva_monto FROM public.facturas_proveedor WHERE clave_idempotencia = 'clave-fc-0001'), 24, '1 · el IVA sale de los renglones (24.00)');
SELECT public.chk_uuid((SELECT created_by FROM public.facturas_proveedor WHERE clave_idempotencia = 'clave-fc-0001'), :UK::uuid, '1 · quién la capturó lo pone el servidor');
SELECT public.chk_txt((SELECT orden_compra_id::text FROM public.facturas_proveedor WHERE clave_idempotencia = 'clave-fc-0001'), '0f400000-0000-0000-0000-000000000001', '1 · queda ligada a la orden');
SELECT public.chk_txt((SELECT string_agg(linea::text || ':' || descripcion, ',' ORDER BY linea) FROM public.factura_proveedor_lineas WHERE factura_id = (SELECT id FROM public.facturas_proveedor WHERE clave_idempotencia = 'clave-fc-0001')),
  '1:Material,2:Insumo', '1 · renglones numerados con la descripción del renglón de la orden');

-- ── 2. Reintento y doble clic: la MISMA factura, nada duplicado ──────────────
SELECT public.como(:UK::uuid);
SET ROLE authenticated;
INSERT INTO res_fc SELECT 'a2', public.compras_factura_crear(:C::uuid, :C1::uuid,
  '{"proveedor_id":"e3000000-0000-0000-0000-000000000001","orden_compra_id":"0f400000-0000-0000-0000-000000000001","numero_factura":"FC-0001","fecha_emision":"2026-10-02","concepto":"Factura de OX","monto_total":999,"clave_idempotencia":"clave-fc-0001"}'::jsonb,
  '[{"orden_compra_linea_id":"0f410000-0000-0000-0000-000000000002","cantidad":5.0,"precio_unitario":20.00,"iva_monto":12},
    {"orden_compra_linea_id":"0f410000-0000-0000-0000-000000000001","cantidad":10,"precio_unitario":10,"iva_monto":12.0}]'::jsonb);
RESET ROLE;
SELECT public.chk_bool((SELECT (j->>'reutilizada')::boolean FROM res_fc WHERE k = 'a2'), true, '2 · el reintento (cifras escritas distinto, renglones en otro orden) se reconoce como el mismo');
SELECT public.chk_txt((SELECT j->'factura'->>'id' FROM res_fc WHERE k = 'a2'), (SELECT j->'factura'->>'id' FROM res_fc WHERE k = 'a'), '2 · devuelve la MISMA factura');
SELECT public.chk((SELECT count(*) FROM public.facturas_proveedor WHERE clave_idempotencia = 'clave-fc-0001'), 1, '2 · una sola factura');
SELECT public.chk((SELECT count(*) FROM public.factura_proveedor_lineas WHERE factura_id = (SELECT id FROM public.facturas_proveedor WHERE clave_idempotencia = 'clave-fc-0001')), 2, '2 · y dos renglones, no cuatro');

-- ── 3. Misma clave con OTROS datos: rechazo explícito ───────────────────────
SELECT public.como(:UK::uuid);
SET ROLE authenticated;
SELECT public.chk_falla($$ SELECT public.compras_factura_crear('cccccccc-cccc-cccc-cccc-cccccccccccc', 'c1c1c1c1-0000-0000-0000-000000000001',
  '{"proveedor_id":"e3000000-0000-0000-0000-000000000001","orden_compra_id":"0f400000-0000-0000-0000-000000000001","numero_factura":"FC-0001","fecha_emision":"2026-10-02","concepto":"Factura de OX","clave_idempotencia":"clave-fc-0001"}'::jsonb,
  '[{"orden_compra_linea_id":"0f410000-0000-0000-0000-000000000001","cantidad":9,"precio_unitario":10,"iva_monto":12},
    {"orden_compra_linea_id":"0f410000-0000-0000-0000-000000000002","cantidad":5,"precio_unitario":20,"iva_monto":12}]'::jsonb) $$,
  'COMPRAS_FACTURA_CLAVE_CONFLICTO', '3 · misma clave con OTRA cantidad');
SELECT public.chk_falla($$ SELECT public.compras_factura_crear('cccccccc-cccc-cccc-cccc-cccccccccccc', 'c1c1c1c1-0000-0000-0000-000000000001',
  '{"proveedor_id":"e3000000-0000-0000-0000-000000000001","orden_compra_id":"0f400000-0000-0000-0000-000000000001","numero_factura":"FC-0001","fecha_emision":"2026-10-02","concepto":"OTRO concepto","clave_idempotencia":"clave-fc-0001"}'::jsonb,
  '[{"orden_compra_linea_id":"0f410000-0000-0000-0000-000000000001","cantidad":10,"precio_unitario":10,"iva_monto":12},
    {"orden_compra_linea_id":"0f410000-0000-0000-0000-000000000002","cantidad":5,"precio_unitario":20,"iva_monto":12}]'::jsonb) $$,
  'COMPRAS_FACTURA_CLAVE_CONFLICTO', '3 · misma clave con OTRO concepto en la cabecera');
RESET ROLE;
SELECT public.chk((SELECT count(*) FROM public.facturas_proveedor WHERE clave_idempotencia = 'clave-fc-0001'), 1, '3 · el rechazo no crea nada');

-- ── 4. Fallo en UN renglón: se revierte TAMBIÉN la cabecera; el reintento corregido funciona ─
SELECT public.como(:UK::uuid);
SET ROLE authenticated;
SELECT public.chk_falla($$ SELECT public.compras_factura_crear('cccccccc-cccc-cccc-cccc-cccccccccccc', 'c1c1c1c1-0000-0000-0000-000000000001',
  '{"proveedor_id":"e3000000-0000-0000-0000-000000000001","orden_compra_id":"0f400000-0000-0000-0000-000000000001","numero_factura":"FC-0002","concepto":"Con un renglón ajeno","clave_idempotencia":"clave-fc-0002"}'::jsonb,
  '[{"orden_compra_linea_id":"0f410000-0000-0000-0000-000000000001","cantidad":1,"precio_unitario":10,"iva_monto":1.2},
    {"orden_compra_linea_id":"0f410000-0000-0000-0000-000000000004","cantidad":1,"precio_unitario":10,"iva_monto":1.2}]'::jsonb) $$,
  'COMPRAS_FACTURA_LINEA_AJENA', '4 · un renglón de OTRA orden: la operación entera falla');
SELECT public.chk_falla($$ SELECT public.compras_factura_crear('cccccccc-cccc-cccc-cccc-cccccccccccc', 'c1c1c1c1-0000-0000-0000-000000000001',
  '{"proveedor_id":"e3000000-0000-0000-0000-000000000001","orden_compra_id":"0f400000-0000-0000-0000-000000000001","numero_factura":"FC-0002","concepto":"Con cantidad inválida","clave_idempotencia":"clave-fc-0002"}'::jsonb,
  '[{"orden_compra_linea_id":"0f410000-0000-0000-0000-000000000001","cantidad":1,"precio_unitario":10,"iva_monto":1.2},
    {"orden_compra_linea_id":"0f410000-0000-0000-0000-000000000002","cantidad":0,"precio_unitario":20,"iva_monto":0}]'::jsonb) $$,
  'COMPRAS_FACTURA_LINEA_INVALIDA', '4 · un renglón con cantidad 0: la operación entera falla');
RESET ROLE;
SELECT public.chk((SELECT count(*) FROM public.facturas_proveedor WHERE clave_idempotencia = 'clave-fc-0002' OR numero_factura = 'FC-0002'), 0, '4 · NO queda cabecera huérfana tras el fallo');
SELECT public.chk((SELECT count(*) FROM public.factura_proveedor_lineas WHERE descripcion = 'Material' AND factura_id NOT IN (SELECT id FROM public.facturas_proveedor)), 0, '4 · ni renglones sueltos');
-- Interrupción y reintento: lo que falló no dejó rastro, así que la misma clave con el contenido corregido SÍ crea.
SELECT public.como(:UK::uuid);
SET ROLE authenticated;
INSERT INTO res_fc SELECT 'b', public.compras_factura_crear(:C::uuid, :C1::uuid,
  '{"proveedor_id":"e3000000-0000-0000-0000-000000000001","orden_compra_id":"0f400000-0000-0000-0000-000000000001","numero_factura":"FC-0002","concepto":"Corregida","clave_idempotencia":"clave-fc-0002"}'::jsonb,
  '[{"orden_compra_linea_id":"0f410000-0000-0000-0000-000000000001","cantidad":1,"precio_unitario":10,"iva_monto":1.2}]'::jsonb);
RESET ROLE;
SELECT public.chk_bool((SELECT (j->>'reutilizada')::boolean FROM res_fc WHERE k = 'b'), false, '4 · tras el fallo, la misma clave con el contenido corregido crea la factura (no quedó nada bloqueado)');

-- ── 5. Validación de servidor: empresa, proyecto, proveedor, orden y renglones ─
SELECT public.como(:UA::uuid);
SET ROLE authenticated;
SELECT public.chk_falla($$ SELECT public.compras_factura_crear('cccccccc-cccc-cccc-cccc-cccccccccccc', 'd1d1d1d1-0000-0000-0000-000000000001',
  '{"proveedor_id":"e3000000-0000-0000-0000-000000000001","concepto":"Proyecto ajeno","monto_total":10,"clave_idempotencia":"clave-v-proy1"}'::jsonb, NULL) $$,
  'COMPRAS_FACTURA_PROYECTO', '5 · un proyecto de OTRA empresa');
SELECT public.chk_falla($$ SELECT public.compras_factura_crear('cccccccc-cccc-cccc-cccc-cccccccccccc', 'c1c1c1c1-0000-0000-0000-000000000001',
  '{"proveedor_id":"e3000000-0000-0000-0000-0000000000d1","concepto":"Proveedor ajeno","monto_total":10,"clave_idempotencia":"clave-v-prov1"}'::jsonb, NULL) $$,
  'COMPRAS_FACTURA_PROVEEDOR', '5 · un proveedor de OTRA empresa');
SELECT public.chk_falla($$ SELECT public.compras_factura_crear('cccccccc-cccc-cccc-cccc-cccccccccccc', 'c1c1c1c1-0000-0000-0000-000000000001',
  '{"proveedor_id":"e3000000-0000-0000-0000-000000000001","orden_compra_id":"0f400000-0000-0000-0000-0000000000ff","concepto":"Orden inexistente","clave_idempotencia":"clave-v-ord0"}'::jsonb,
  '[{"orden_compra_linea_id":"0f410000-0000-0000-0000-000000000001","cantidad":1,"precio_unitario":10}]'::jsonb) $$,
  'COMPRAS_FACTURA_ORDEN:', '5 · una orden que no existe');
SELECT public.chk_falla($$ SELECT public.compras_factura_crear('cccccccc-cccc-cccc-cccc-cccccccccccc', 'c1c1c1c1-0000-0000-0000-000000000001',
  '{"proveedor_id":"e3000000-0000-0000-0000-000000000002","orden_compra_id":"0f400000-0000-0000-0000-000000000001","concepto":"Proveedor distinto al de la orden","clave_idempotencia":"clave-v-ord1"}'::jsonb,
  '[{"orden_compra_linea_id":"0f410000-0000-0000-0000-000000000001","cantidad":1,"precio_unitario":10}]'::jsonb) $$,
  'COMPRAS_FACTURA_ORDEN_PROVEEDOR', '5 · el proveedor de la factura no es el de la orden');
SELECT public.chk_falla($$ SELECT public.compras_factura_crear('cccccccc-cccc-cccc-cccc-cccccccccccc', 'c1c1c1c1-0000-0000-0000-000000000001',
  '{"proveedor_id":"e3000000-0000-0000-0000-000000000001","orden_compra_id":"0f400000-0000-0000-0000-000000000002","concepto":"Orden de otra contabilidad","clave_idempotencia":"clave-v-ord2"}'::jsonb,
  '[{"orden_compra_linea_id":"0f410000-0000-0000-0000-000000000003","cantidad":1,"precio_unitario":10}]'::jsonb) $$,
  'COMPRAS_FACTURA_ORDEN_PROYECTO', '5 · la orden es de otro proyecto de la misma empresa');
SELECT public.chk_falla($$ SELECT public.compras_factura_crear('cccccccc-cccc-cccc-cccc-cccccccccccc', 'c1c1c1c1-0000-0000-0000-000000000001',
  '{"proveedor_id":"e3000000-0000-0000-0000-000000000001","orden_compra_id":"0f400000-0000-0000-0000-000000000004","concepto":"Orden en borrador","clave_idempotencia":"clave-v-ord3"}'::jsonb,
  '[{"orden_compra_linea_id":"0f410000-0000-0000-0000-000000000001","cantidad":1,"precio_unitario":10}]'::jsonb) $$,
  'COMPRAS_FACTURA_ORDEN_ESTADO', '5 · la orden está en borrador: no admite facturas');
SELECT public.chk_falla($$ SELECT public.compras_factura_crear('cccccccc-cccc-cccc-cccc-cccccccccccc', 'c1c1c1c1-0000-0000-0000-000000000001',
  '{"proveedor_id":"e3000000-0000-0000-0000-000000000001","orden_compra_id":"0f400000-0000-0000-0000-000000000001","concepto":"Moneda distinta","moneda":"USD","clave_idempotencia":"clave-v-mon1"}'::jsonb,
  '[{"orden_compra_linea_id":"0f410000-0000-0000-0000-000000000001","cantidad":1,"precio_unitario":10}]'::jsonb) $$,
  'COMPRAS_FACTURA_MONEDA_ORDEN', '5 · la factura de una orden no va en otra moneda que la de la orden');
SELECT public.chk_falla($$ SELECT public.compras_factura_crear('cccccccc-cccc-cccc-cccc-cccccccccccc', 'c1c1c1c1-0000-0000-0000-000000000001',
  '{"proveedor_id":"e3000000-0000-0000-0000-000000000001","orden_compra_id":"0f400000-0000-0000-0000-000000000001","concepto":"Renglón repetido","clave_idempotencia":"clave-v-rep1"}'::jsonb,
  '[{"orden_compra_linea_id":"0f410000-0000-0000-0000-000000000001","cantidad":1,"precio_unitario":10},
    {"orden_compra_linea_id":"0f410000-0000-0000-0000-000000000001","cantidad":1,"precio_unitario":10}]'::jsonb) $$,
  'COMPRAS_FACTURA_LINEA_REPETIDA', '5 · el mismo renglón de la orden dos veces');
SELECT public.chk_falla($$ SELECT public.compras_factura_crear('cccccccc-cccc-cccc-cccc-cccccccccccc', 'c1c1c1c1-0000-0000-0000-000000000001',
  '{"proveedor_id":"e3000000-0000-0000-0000-000000000001","orden_compra_id":"0f400000-0000-0000-0000-000000000001","concepto":"Sin renglones","clave_idempotencia":"clave-v-sin1"}'::jsonb, '[]'::jsonb) $$,
  'COMPRAS_FACTURA_SIN_RENGLONES', '5 · con orden y sin renglones no se crea');
SELECT public.chk_falla($$ SELECT public.compras_factura_crear('cccccccc-cccc-cccc-cccc-cccccccccccc', 'c1c1c1c1-0000-0000-0000-000000000001',
  '{"proveedor_id":"e3000000-0000-0000-0000-000000000001","concepto":"Gasto con renglones","monto_total":10,"clave_idempotencia":"clave-v-sin2"}'::jsonb,
  '[{"orden_compra_linea_id":"0f410000-0000-0000-0000-000000000001","cantidad":1,"precio_unitario":10}]'::jsonb) $$,
  'COMPRAS_FACTURA_RENGLONES_SIN_ORDEN', '5 · sin orden no admite renglones');
SELECT public.chk_falla($$ SELECT public.compras_factura_crear('cccccccc-cccc-cccc-cccc-cccccccccccc', 'c1c1c1c1-0000-0000-0000-000000000001',
  '{"proveedor_id":"e3000000-0000-0000-0000-000000000001","concepto":"Sin clave","monto_total":10}'::jsonb, NULL) $$,
  'COMPRAS_FACTURA_CLAVE_REQUERIDA', '5 · sin clave de idempotencia no se crea');
RESET ROLE;
SELECT public.chk((SELECT count(*) FROM public.facturas_proveedor WHERE clave_idempotencia LIKE 'clave-v-%'), 0, '5 · ninguna validación fallida dejó una factura');

-- Otra empresa: ni siquiera con permisos de admin en la suya
SELECT public.como(:UD::uuid);
SET ROLE authenticated;
SELECT public.chk_falla($$ SELECT public.compras_factura_crear('cccccccc-cccc-cccc-cccc-cccccccccccc', 'c1c1c1c1-0000-0000-0000-000000000001',
  '{"proveedor_id":"e3000000-0000-0000-0000-000000000001","concepto":"Desde otra empresa","monto_total":10,"clave_idempotencia":"clave-v-emp1"}'::jsonb, NULL) $$,
  'COMPRAS_FACTURA_EMPRESA', '5 · el admin de OTRA empresa no registra facturas en esta');
RESET ROLE;

-- ── 6. Permisos y RLS: la función no amplía nada ────────────────────────────
SELECT public.como(:UN::uuid);                       -- operador sin permisos de contabilidad ni de compras
SET ROLE authenticated;
-- Un 'operator' puede insertar facturas (policy de INSERT); lo que no puede es aprobar. Se comprueba que la FUNCIÓN no le da más que el INSERT directo:
INSERT INTO res_fc SELECT 'n', public.compras_factura_crear(:C::uuid, :C1::uuid,
  '{"proveedor_id":"e3000000-0000-0000-0000-000000000001","concepto":"Gasto del operador","monto_total":50,"iva_monto":6,"clave_idempotencia":"clave-op-0001"}'::jsonb, NULL);
UPDATE public.facturas_proveedor SET estado = 'aprobada' WHERE clave_idempotencia = 'clave-op-0001';   -- la policy de UPDATE no le deja ver la fila: 0 filas
RESET ROLE;
SELECT public.chk_txt((SELECT estado FROM public.facturas_proveedor WHERE clave_idempotencia = 'clave-op-0001'), 'registrada', '6 · el operador captura pero NO aprueba: sigue registrada (la policy de UPDATE rige igual)');

-- ── 7. Gasto directo (sin orden) por la misma función ───────────────────────
SELECT public.como(:UK::uuid);
SET ROLE authenticated;
INSERT INTO res_fc SELECT 'd1', public.compras_factura_crear(:C::uuid, :C1::uuid,
  '{"proveedor_id":"e3000000-0000-0000-0000-000000000001","numero_factura":"GD-0001","concepto":"Papelería","monto_total":100,"iva_monto":12,"clave_idempotencia":"clave-gd-0001"}'::jsonb, NULL);
INSERT INTO res_fc SELECT 'd2', public.compras_factura_crear(:C::uuid, :C1::uuid,
  '{"proveedor_id":"e3000000-0000-0000-0000-000000000001","numero_factura":"GD-0001","concepto":"Papelería","monto_total":100,"iva_monto":12,"clave_idempotencia":"clave-gd-0001"}'::jsonb, '[]'::jsonb);
RESET ROLE;
SELECT public.chk_bool((SELECT (j->>'reutilizada')::boolean FROM res_fc WHERE k = 'd2'), true, '7 · gasto directo: el doble clic devuelve la misma factura');
SELECT public.chk((SELECT count(*) FROM public.facturas_proveedor WHERE numero_factura = 'GD-0001'), 1, '7 · y es una sola');
SELECT public.chk_num((SELECT monto_total FROM public.facturas_proveedor WHERE numero_factura = 'GD-0001'), 100, '7 · el monto del gasto directo es el que se capturó');

-- ── 8. Número de factura repetido con otra clave: código propio, nada a medias ─
SELECT public.como(:UK::uuid);
SET ROLE authenticated;
SELECT public.chk_falla($$ SELECT public.compras_factura_crear('cccccccc-cccc-cccc-cccc-cccccccccccc', 'c1c1c1c1-0000-0000-0000-000000000001',
  '{"proveedor_id":"e3000000-0000-0000-0000-000000000001","numero_factura":"FC-0001","concepto":"Mismo número, otra captura","monto_total":10,"clave_idempotencia":"clave-fc-dup-1"}'::jsonb, NULL) $$,
  'COMPRAS_FACTURA_NUMERO_DUPLICADO', '8 · el mismo número del mismo proveedor con otra clave');
RESET ROLE;
SELECT public.chk((SELECT count(*) FROM public.facturas_proveedor WHERE clave_idempotencia = 'clave-fc-dup-1'), 0, '8 · no deja rastro');

-- ── 9. La clave y la huella no se editan después ────────────────────────────
SELECT public.como(:UA::uuid);
SET ROLE authenticated;
SELECT public.chk_falla($$ UPDATE public.facturas_proveedor SET clave_idempotencia = 'otra-clave-distinta' WHERE clave_idempotencia = 'clave-fc-0001' $$,
  'COMPRAS_FACTURA_CLAVE_INMUTABLE', '9 · la clave de idempotencia es inmutable');
SELECT public.chk_falla($$ UPDATE public.facturas_proveedor SET hash_contenido = 'x' WHERE clave_idempotencia = 'clave-fc-0001' $$,
  'COMPRAS_FACTURA_CLAVE_INMUTABLE', '9 · la huella del contenido es inmutable');
RESET ROLE;

-- ── 10. Aprobación de la factura creada por la función: cuadra y liquida ─────
SELECT public.como(:UA::uuid);
SET ROLE authenticated;
UPDATE public.facturas_proveedor SET estado = 'aprobada' WHERE clave_idempotencia = 'clave-fc-0001';
RESET ROLE;
SELECT public.chk_txt((SELECT estado FROM public.facturas_proveedor WHERE clave_idempotencia = 'clave-fc-0001'), 'aprobada', '10 · la factura creada por la función cuadra y se aprueba');
SELECT public.chk_uuid((SELECT aprobada_por FROM public.facturas_proveedor WHERE clave_idempotencia = 'clave-fc-0001'), :UA::uuid, '10 · aprobada_por lo sella el servidor');
SELECT public.chk_num((SELECT cantidad_facturada FROM public.orden_compra_lineas WHERE id = :X1::uuid), 10, '10 · lo facturado de X1 sube a 10');
SELECT public.chk_num((SELECT cantidad_facturada FROM public.orden_compra_lineas WHERE id = :X2::uuid), 5, '10 · lo facturado de X2 sube a 5');
