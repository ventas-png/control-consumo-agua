\set ON_ERROR_STOP on

-- ============================================================================
-- INVARIANTES · FACTURA INTEGRADA A ORDEN Y RECEPCIONES
-- (migraciones 20261021000200 y 20261021000500) sobre el motor de Fase 6.
-- Orden OF (C1, P1): F1 inventario 100 × 10 (IVA 120) · F2 activo fijo 2 × 500
-- (IVA 120) · F3 servicio 1 × 300 (IVA 36).
-- ============================================================================
\set C   '''cccccccc-cccc-cccc-cccc-cccccccccccc'''
\set C1  '''c1c1c1c1-0000-0000-0000-000000000001'''
\set UA  '''c0c0c0c0-0000-0000-0000-00000000000a'''
\set UO  '''c0c0c0c0-0000-0000-0000-00000000000d'''
\set UN  '''c0c0c0c0-0000-0000-0000-00000000000e'''
\set UD  '''d0d0d0d0-0000-0000-0000-00000000000d'''
\set P1  '''e3000000-0000-0000-0000-000000000001'''
\set P2  '''e3000000-0000-0000-0000-000000000002'''
\set S1  '''50000000-0000-0000-0000-0000000000c1'''
\set OF  '''0f100000-0000-0000-0000-000000000001'''
\set F1  '''0f110000-0000-0000-0000-000000000001'''
\set F2  '''0f110000-0000-0000-0000-000000000002'''
\set F3  '''0f110000-0000-0000-0000-000000000003'''

-- ── Preparación: orden emitida y recibida por tramos (como lo haría el flujo) ─
SELECT public.como(:UO::uuid);
SET ROLE authenticated;
INSERT INTO public.ordenes_compra (id, company_id, project_id, proveedor_id, proveedor_nombre, concepto)
VALUES (:OF::uuid, :C::uuid, :C1::uuid, :P1::uuid, 'Ferretería Bloque B', 'Cloro, bomba y mantenimiento');
INSERT INTO public.orden_compra_lineas (id, company_id, orden_compra_id, linea, descripcion, destino_tipo, suministro_id, categoria, cantidad, unidad, precio_unitario, iva_monto) VALUES
  (:F1::uuid, :C::uuid, :OF::uuid, 1, 'Cloro industrial', 'inventario',  :S1::uuid, 'limpieza',      100, 'litro',  10,  120),
  (:F2::uuid, :C::uuid, :OF::uuid, 2, 'Bomba de agua',    'activo_fijo', NULL,      'mantenimiento',   2, 'unidad', 500, 120),
  (:F3::uuid, :C::uuid, :OF::uuid, 3, 'Mantenimiento mensual', 'servicio', NULL,    'mantenimiento',   1, 'servicio', 300, 36);
SELECT public.como(:UA::uuid);
UPDATE public.ordenes_compra SET estado = 'aprobada' WHERE id = :OF::uuid;
UPDATE public.ordenes_compra SET estado = 'emitida'  WHERE id = :OF::uuid;
-- Recepción 1: 40 de cloro + 1 bomba
INSERT INTO public.recepciones (id, company_id, project_id, orden_compra_id, tipo) VALUES ('0f200000-0000-0000-0000-000000000001', :C::uuid, :C1::uuid, :OF::uuid, 'bienes');
INSERT INTO public.recepcion_lineas (company_id, recepcion_id, orden_compra_linea_id, cantidad) VALUES
  (:C::uuid, '0f200000-0000-0000-0000-000000000001', :F1::uuid, 40), (:C::uuid, '0f200000-0000-0000-0000-000000000001', :F2::uuid, 1);
UPDATE public.recepciones SET estado = 'registrada' WHERE id = '0f200000-0000-0000-0000-000000000001';
RESET ROLE;
SELECT public.chk_txt((SELECT estado FROM public.ordenes_compra WHERE id = :OF::uuid), 'recibida_parcial', '0 · orden recibida parcialmente (40 de 100, 1 de 2)');

-- ── 1. Factura sin recepción previa de lo facturado: la diferencia se VE y bloquea ─
SELECT public.como(:UA::uuid);
SET ROLE authenticated;
INSERT INTO public.facturas_proveedor (id, company_id, project_id, proveedor_id, orden_compra_id, numero_factura, concepto, categoria, monto_total)
VALUES ('0f300000-0000-0000-0000-000000000001', :C::uuid, :C1::uuid, :P1::uuid, :OF::uuid, 'F-0001', 'Facturación parcial', 'limpieza', 1);
INSERT INTO public.factura_proveedor_lineas (company_id, factura_id, orden_compra_linea_id, linea, descripcion, cantidad, precio_unitario, iva_monto) VALUES
  (:C::uuid, '0f300000-0000-0000-0000-000000000001', :F1::uuid, 1, 'Cloro industrial', 70, 10, 84);
RESET ROLE;
SELECT public.chk_bool((SELECT NOT dentro_tolerancia AND motivo ILIKE '%recib%' FROM public.compras_validar_match('0f300000-0000-0000-0000-000000000001') LIMIT 1), true,
  '1 · facturar 70 cuando solo se recibieron 40 aparece como diferencia visible (recibido)');
SELECT public.como(:UA::uuid);
SET ROLE authenticated;
SELECT public.chk_falla($$ UPDATE public.facturas_proveedor SET estado = 'aprobada' WHERE id = '0f300000-0000-0000-0000-000000000001' $$,
  'COMPRAS_MATCH_FUERA_DE_TOLERANCIA', '1 · la diferencia NO se aprueba en silencio');
-- Se corrige a lo recibido: factura parcial de la línea 1 (40) y de la bomba (1).
UPDATE public.factura_proveedor_lineas SET cantidad = 40, iva_monto = 48 WHERE factura_id = '0f300000-0000-0000-0000-000000000001';
INSERT INTO public.factura_proveedor_lineas (company_id, factura_id, orden_compra_linea_id, linea, descripcion, cantidad, precio_unitario, iva_monto)
VALUES (:C::uuid, '0f300000-0000-0000-0000-000000000001', :F2::uuid, 2, 'Bomba de agua', 1, 500, 60);
RESET ROLE;
SELECT public.chk_num((SELECT monto_total FROM public.facturas_proveedor WHERE id = '0f300000-0000-0000-0000-000000000001'), 1008,
  '1 · el total sale de los renglones: 400 + 48 + 500 + 60');
SELECT public.chk((SELECT count(*) FROM public.compras_validar_match('0f300000-0000-0000-0000-000000000001') WHERE NOT dentro_tolerancia), 0,
  '1 · con lo recibido el cuadre pasa');

-- Usuario sin permisos NO aprueba.
SELECT public.como(:UN::uuid);
SET ROLE authenticated;
UPDATE public.facturas_proveedor SET estado = 'aprobada' WHERE id = '0f300000-0000-0000-0000-000000000001';
RESET ROLE;
SELECT public.chk_txt((SELECT estado FROM public.facturas_proveedor WHERE id = '0f300000-0000-0000-0000-000000000001'), 'registrada',
  '1 · un usuario sin permisos NO aprueba la factura');
SELECT public.chk((SELECT count(*) FROM public.conta_asientos WHERE origen_tabla = 'facturas_proveedor'), 0, '1 · ni se contabilizó');

-- ── 2. Aprobación: reconoce lo facturado sin re-reconocer lo ya devengado ───
SELECT public.como(:UA::uuid);
SET ROLE authenticated;
UPDATE public.facturas_proveedor SET estado = 'aprobada' WHERE id = '0f300000-0000-0000-0000-000000000001';
RESET ROLE;
SELECT public.chk_txt((SELECT estado FROM public.facturas_proveedor WHERE id = '0f300000-0000-0000-0000-000000000001'), 'aprobada', '2 · factura parcial aprobada');
SELECT public.chk_bool((SELECT total_debe = total_haber FROM public.conta_asientos WHERE origen_tabla = 'facturas_proveedor' AND origen_id = '0f300000-0000-0000-0000-000000000001'), true,
  '2 · asiento cuadrado');
SELECT public.chk((SELECT count(*) FROM public.conta_asientos WHERE origen_tabla = 'facturas_proveedor' AND origen_id = '0f300000-0000-0000-0000-000000000001'), 1,
  '2 · un único asiento');
SELECT public.chk_num((SELECT l.debe FROM public.conta_asientos a JOIN public.conta_asiento_lineas l ON l.asiento_id = a.id JOIN public.conta_cuentas c ON c.id = l.cuenta_id
                          WHERE a.origen_tabla = 'facturas_proveedor' AND a.origen_id = '0f300000-0000-0000-0000-000000000001' AND c.codigo = '2105'), 900,
  '2 · se liquida «por facturar» solo por lo recibido y facturado (400 + 500)');
SELECT public.chk_txt((SELECT estado FROM public.ordenes_compra WHERE id = :OF::uuid), 'recibida_parcial', '2 · la orden sigue abierta');

-- Reintento de aprobación: no duplica.
SELECT public.como(:UA::uuid);
SET ROLE authenticated;
UPDATE public.facturas_proveedor SET estado = 'aprobada' WHERE id = '0f300000-0000-0000-0000-000000000001';
RESET ROLE;
SELECT public.chk((SELECT count(*) FROM public.conta_asientos WHERE origen_tabla = 'facturas_proveedor' AND origen_id = '0f300000-0000-0000-0000-000000000001'), 1,
  '2 · reintentar la aprobación no duplica el asiento');

-- ── 3. Duplicado: mismo proveedor y número ──────────────────────────────────
SELECT public.como(:UA::uuid);
SET ROLE authenticated;
SELECT public.chk_falla($$ INSERT INTO public.facturas_proveedor (company_id, project_id, proveedor_id, orden_compra_id, numero_factura, concepto, categoria, monto_total)
                           VALUES ('cccccccc-cccc-cccc-cccc-cccccccccccc','c1c1c1c1-0000-0000-0000-000000000001','e3000000-0000-0000-0000-000000000001','0f100000-0000-0000-0000-000000000001','F-0001','dup','limpieza',1) $$,
  'uq_facturas_prov_numero', '3 · factura duplicada (mismo proveedor y número) rechazada');
RESET ROLE;

-- ── 4. Referencias cruzadas ────────────────────────────────────────────────
SELECT public.como(:UA::uuid);
SET ROLE authenticated;
-- otro proveedor sobre la misma orden
SELECT public.chk_falla($$ INSERT INTO public.facturas_proveedor (company_id, project_id, proveedor_id, orden_compra_id, numero_factura, concepto, categoria, monto_total)
                           VALUES ('cccccccc-cccc-cccc-cccc-cccccccccccc','c1c1c1c1-0000-0000-0000-000000000001','e3000000-0000-0000-0000-000000000002','0f100000-0000-0000-0000-000000000001','F-X1','x','limpieza',1) $$,
  'COMPRAS_FACTURA_ORDEN_AJENA', '4 · una factura de OTRO proveedor no se ata a la orden');
RESET ROLE;

-- ── 5. Segunda factura: cubre varias recepciones y cierra la orden ──────────
SELECT public.como(:UA::uuid);
SET ROLE authenticated;
INSERT INTO public.recepciones (id, company_id, project_id, orden_compra_id, tipo) VALUES ('0f200000-0000-0000-0000-000000000002', :C::uuid, :C1::uuid, :OF::uuid, 'bienes');
INSERT INTO public.recepcion_lineas (company_id, recepcion_id, orden_compra_linea_id, cantidad) VALUES
  (:C::uuid, '0f200000-0000-0000-0000-000000000002', :F1::uuid, 60), (:C::uuid, '0f200000-0000-0000-0000-000000000002', :F2::uuid, 1);
UPDATE public.recepciones SET estado = 'registrada' WHERE id = '0f200000-0000-0000-0000-000000000002';
INSERT INTO public.recepciones (id, company_id, project_id, orden_compra_id, tipo, recibido_por) VALUES ('0f200000-0000-0000-0000-000000000003', :C::uuid, :C1::uuid, :OF::uuid, 'servicio', :UO::uuid);
INSERT INTO public.recepcion_lineas (company_id, recepcion_id, orden_compra_linea_id, cantidad) VALUES (:C::uuid, '0f200000-0000-0000-0000-000000000003', :F3::uuid, 1);
UPDATE public.recepciones SET estado = 'registrada' WHERE id = '0f200000-0000-0000-0000-000000000003';
INSERT INTO public.facturas_proveedor (id, company_id, project_id, proveedor_id, orden_compra_id, numero_factura, concepto, categoria, monto_total)
VALUES ('0f300000-0000-0000-0000-000000000002', :C::uuid, :C1::uuid, :P1::uuid, :OF::uuid, 'F-0002', 'Saldo', 'limpieza', 1);
INSERT INTO public.factura_proveedor_lineas (company_id, factura_id, orden_compra_linea_id, linea, descripcion, cantidad, precio_unitario, iva_monto) VALUES
  (:C::uuid, '0f300000-0000-0000-0000-000000000002', :F1::uuid, 1, 'Cloro industrial', 60, 10, 72),
  (:C::uuid, '0f300000-0000-0000-0000-000000000002', :F2::uuid, 2, 'Bomba de agua', 1, 500, 60),
  (:C::uuid, '0f300000-0000-0000-0000-000000000002', :F3::uuid, 3, 'Mantenimiento mensual', 1, 300, 36);
RESET ROLE;
SELECT public.chk_num((SELECT monto_total FROM public.facturas_proveedor WHERE id = '0f300000-0000-0000-0000-000000000002'), 1568, '5 · total de la segunda factura');

SELECT public.como(:UA::uuid);
SET ROLE authenticated;
UPDATE public.facturas_proveedor SET estado = 'aprobada' WHERE id = '0f300000-0000-0000-0000-000000000002';
-- Con todo ya facturado, una factura adicional por lo mismo se detecta.
INSERT INTO public.facturas_proveedor (id, company_id, project_id, proveedor_id, orden_compra_id, numero_factura, concepto, categoria, monto_total)
VALUES ('0f300000-0000-0000-0000-000000000003', :C::uuid, :C1::uuid, :P1::uuid, :OF::uuid, 'F-0003', 'Exceso', 'limpieza', 1);
INSERT INTO public.factura_proveedor_lineas (company_id, factura_id, orden_compra_linea_id, linea, descripcion, cantidad, precio_unitario, iva_monto)
VALUES (:C::uuid, '0f300000-0000-0000-0000-000000000003', :F1::uuid, 1, 'Cloro industrial', 10, 10, 12);
SELECT public.chk_falla($$ UPDATE public.facturas_proveedor SET estado = 'aprobada' WHERE id = '0f300000-0000-0000-0000-000000000003' $$,
  'COMPRAS_MATCH_FUERA_DE_TOLERANCIA', '5 · facturar lo que ya se facturó en otra factura queda fuera de tolerancia');
DELETE FROM public.facturas_proveedor WHERE id = '0f300000-0000-0000-0000-000000000003';
RESET ROLE;
SELECT public.chk_txt((SELECT estado FROM public.ordenes_compra WHERE id = :OF::uuid), 'cerrada', '5 · recibida y facturada del todo, la orden se cierra');
SELECT public.chk_num((SELECT sum(l.debe - l.haber) FROM public.conta_asientos a JOIN public.conta_asiento_lineas l ON l.asiento_id = a.id JOIN public.conta_cuentas c ON c.id = l.cuenta_id
                         WHERE c.codigo = '2105' AND a.estado <> 'anulado' AND a.origen_id IN (SELECT id FROM public.recepciones WHERE orden_compra_id = :OF::uuid UNION SELECT id FROM public.facturas_proveedor WHERE orden_compra_id = :OF::uuid)), 0,
  '5 · la cuenta puente «por facturar» queda en cero (nada reconocido dos veces)');
SELECT public.chk_num((SELECT sum(l.haber - l.debe) FROM public.conta_asientos a JOIN public.conta_asiento_lineas l ON l.asiento_id = a.id JOIN public.conta_cuentas c ON c.id = l.cuenta_id
                         WHERE c.codigo = '2104' AND a.estado <> 'anulado' AND a.origen_id IN (SELECT id FROM public.facturas_proveedor WHERE orden_compra_id = :OF::uuid)), 2576,
  '5 · Proveedores por pagar = 1008 + 1568');

-- ── 6. Diferencias de precio, IVA y moneda ──────────────────────────────────
SELECT public.como(:UO::uuid);
SET ROLE authenticated;
INSERT INTO public.ordenes_compra (id, company_id, project_id, proveedor_id, proveedor_nombre, concepto)
VALUES ('0f100000-0000-0000-0000-000000000002', :C::uuid, :C1::uuid, :P2::uuid, 'Servicios Bloque B', 'Diferencias');
INSERT INTO public.orden_compra_lineas (id, company_id, orden_compra_id, linea, descripcion, destino_tipo, categoria, cantidad, precio_unitario, iva_monto)
VALUES ('0f110000-0000-0000-0000-000000000010', :C::uuid, '0f100000-0000-0000-0000-000000000002', 1, 'Tubería', 'gasto', 'mantenimiento', 10, 100, 120);
SELECT public.como(:UA::uuid);
UPDATE public.ordenes_compra SET estado = 'aprobada' WHERE id = '0f100000-0000-0000-0000-000000000002';
UPDATE public.ordenes_compra SET estado = 'emitida'  WHERE id = '0f100000-0000-0000-0000-000000000002';
INSERT INTO public.recepciones (id, company_id, project_id, orden_compra_id, tipo) VALUES ('0f200000-0000-0000-0000-000000000010', :C::uuid, :C1::uuid, '0f100000-0000-0000-0000-000000000002', 'bienes');
INSERT INTO public.recepcion_lineas (company_id, recepcion_id, orden_compra_linea_id, cantidad) VALUES (:C::uuid, '0f200000-0000-0000-0000-000000000010', '0f110000-0000-0000-0000-000000000010', 10);
UPDATE public.recepciones SET estado = 'registrada' WHERE id = '0f200000-0000-0000-0000-000000000010';
-- precio +20 %
INSERT INTO public.facturas_proveedor (id, company_id, project_id, proveedor_id, orden_compra_id, numero_factura, concepto, categoria, monto_total)
VALUES ('0f300000-0000-0000-0000-000000000010', :C::uuid, :C1::uuid, :P2::uuid, '0f100000-0000-0000-0000-000000000002', 'G-0001', 'Precio alto', 'mantenimiento', 1);
INSERT INTO public.factura_proveedor_lineas (company_id, factura_id, orden_compra_linea_id, linea, descripcion, cantidad, precio_unitario, iva_monto)
VALUES (:C::uuid, '0f300000-0000-0000-0000-000000000010', '0f110000-0000-0000-0000-000000000010', 1, 'Tubería', 10, 120, 120);
RESET ROLE;
SELECT public.chk_bool((SELECT NOT dentro_tolerancia AND diferencia_precio IS NOT NULL FROM public.compras_validar_match('0f300000-0000-0000-0000-000000000010') LIMIT 1), true,
  '6 · precio +20 %: diferencia visible');
-- IVA distinto al pedido
SELECT public.como(:UA::uuid);
SET ROLE authenticated;
UPDATE public.factura_proveedor_lineas SET precio_unitario = 100, iva_monto = 0 WHERE factura_id = '0f300000-0000-0000-0000-000000000010';
RESET ROLE;
SELECT public.chk_bool((SELECT NOT dentro_tolerancia AND iva_orden = 120 AND iva_factura = 0 FROM public.compras_validar_match('0f300000-0000-0000-0000-000000000010') LIMIT 1), true,
  '6 · IVA 0 contra 120 pedido: diferencia de impuestos visible, nunca corregida en silencio');
SELECT public.como(:UA::uuid);
SET ROLE authenticated;
SELECT public.chk_falla($$ UPDATE public.facturas_proveedor SET estado = 'aprobada' WHERE id = '0f300000-0000-0000-0000-000000000010' $$,
  'COMPRAS_MATCH_FUERA_DE_TOLERANCIA', '6 · diferencia de IVA no se aprueba en silencio');
-- moneda distinta
UPDATE public.factura_proveedor_lineas SET iva_monto = 120 WHERE factura_id = '0f300000-0000-0000-0000-000000000010';
UPDATE public.facturas_proveedor SET moneda = 'USD' WHERE id = '0f300000-0000-0000-0000-000000000010';
RESET ROLE;
SELECT public.chk_bool((SELECT NOT dentro_tolerancia AND moneda_orden <> moneda_factura FROM public.compras_validar_match('0f300000-0000-0000-0000-000000000010') LIMIT 1), true,
  '6 · factura en USD contra orden en GTQ: diferencia de moneda visible');
SELECT public.como(:UA::uuid);
SET ROLE authenticated;
SELECT public.chk_falla($$ UPDATE public.facturas_proveedor SET estado = 'aprobada' WHERE id = '0f300000-0000-0000-0000-000000000010' $$,
  'COMPRAS_MATCH_FUERA_DE_TOLERANCIA', '6 · diferencia de moneda no se aprueba en silencio');
-- Aprobación forzada con justificación (queda trazada)
UPDATE public.facturas_proveedor SET moneda = 'GTQ' WHERE id = '0f300000-0000-0000-0000-000000000010';
UPDATE public.factura_proveedor_lineas SET precio_unitario = 120 WHERE factura_id = '0f300000-0000-0000-0000-000000000010';
UPDATE public.facturas_proveedor SET estado = 'aprobada', match_forzado_por = :UA::uuid, match_justificacion = 'Alza pactada por escrito.' WHERE id = '0f300000-0000-0000-0000-000000000010';
RESET ROLE;
SELECT public.chk_txt((SELECT estado FROM public.facturas_proveedor WHERE id = '0f300000-0000-0000-0000-000000000010'), 'aprobada', '6 · con justificación se aprueba');
SELECT public.chk_uuid((SELECT match_forzado_por FROM public.facturas_proveedor WHERE id = '0f300000-0000-0000-0000-000000000010'), :UA::uuid, '6 · y queda quién la forzó');

-- ── 7. Aislamiento entre empresas ───────────────────────────────────────────
SELECT public.como(:UD::uuid);
SET ROLE authenticated;
SELECT public.chk_falla($$ INSERT INTO public.facturas_proveedor (company_id, project_id, proveedor_id, orden_compra_id, numero_factura, concepto, categoria, monto_total)
                           VALUES ('dddddddd-dddd-dddd-dddd-dddddddddddd','d1d1d1d1-0000-0000-0000-000000000001','e3000000-0000-0000-0000-0000000000d1','0f100000-0000-0000-0000-000000000001','D-1','x','limpieza',1) $$,
  'COMPRAS_FACTURA_ORDEN_AJENA', '7 · una empresa no factura contra la orden de otra');
RESET ROLE;
SELECT public.chk((SELECT count(*) FROM public.facturas_proveedor f WHERE company_id = :C::uuid AND EXISTS (SELECT 1 FROM public.ordenes_compra o WHERE o.id = f.orden_compra_id AND o.company_id <> f.company_id)), 0,
  '7 · ninguna factura apunta a una orden de otra empresa');

-- ── 8. Moneda extranjera: tipo de cambio MENSUAL (#904), original + base ────
SELECT public.como(:UO::uuid);
SET ROLE authenticated;
INSERT INTO public.ordenes_compra (id, company_id, project_id, proveedor_id, proveedor_nombre, concepto, moneda)
VALUES ('0f100000-0000-0000-0000-000000000003', :C::uuid, :C1::uuid, :P2::uuid, 'Servicios Bloque B', 'Compra en USD', 'USD');
INSERT INTO public.orden_compra_lineas (id, company_id, orden_compra_id, linea, descripcion, destino_tipo, categoria, cantidad, precio_unitario)
VALUES ('0f110000-0000-0000-0000-000000000020', :C::uuid, '0f100000-0000-0000-0000-000000000003', 1, 'Licencia', 'servicio', 'servicios', 10, 100);
SELECT public.como(:UA::uuid);
UPDATE public.ordenes_compra SET estado = 'aprobada' WHERE id = '0f100000-0000-0000-0000-000000000003';
UPDATE public.ordenes_compra SET estado = 'emitida'  WHERE id = '0f100000-0000-0000-0000-000000000003';
INSERT INTO public.recepciones (id, company_id, project_id, orden_compra_id, tipo, recibido_por) VALUES ('0f200000-0000-0000-0000-000000000020', :C::uuid, :C1::uuid, '0f100000-0000-0000-0000-000000000003', 'servicio', :UO::uuid);
INSERT INTO public.recepcion_lineas (company_id, recepcion_id, orden_compra_linea_id, cantidad) VALUES (:C::uuid, '0f200000-0000-0000-0000-000000000020', '0f110000-0000-0000-0000-000000000020', 10);
UPDATE public.recepciones SET estado = 'registrada' WHERE id = '0f200000-0000-0000-0000-000000000020';
INSERT INTO public.facturas_proveedor (id, company_id, project_id, proveedor_id, orden_compra_id, numero_factura, concepto, categoria, monto_total, moneda)
VALUES ('0f300000-0000-0000-0000-000000000020', :C::uuid, :C1::uuid, :P2::uuid, '0f100000-0000-0000-0000-000000000003', 'U-0001', 'Licencias', 'servicios', 1, 'USD');
INSERT INTO public.factura_proveedor_lineas (company_id, factura_id, orden_compra_linea_id, linea, descripcion, cantidad, precio_unitario)
VALUES (:C::uuid, '0f300000-0000-0000-0000-000000000020', '0f110000-0000-0000-0000-000000000020', 1, 'Licencia', 10, 100);
UPDATE public.facturas_proveedor SET estado = 'aprobada' WHERE id = '0f300000-0000-0000-0000-000000000020';
RESET ROLE;
SELECT public.chk_txt((SELECT estado FROM public.facturas_proveedor WHERE id = '0f300000-0000-0000-0000-000000000020'), 'aprobada', '8 · factura en USD aprobada');
SELECT public.chk_bool((SELECT tipo_cambio_tasa = 7.75 AND NOT tipo_cambio_pendiente AND total_debe = 1000 * 7.75
                          FROM public.conta_asientos WHERE origen_tabla = 'facturas_proveedor' AND origen_id = '0f300000-0000-0000-0000-000000000020' AND estado <> 'anulado'), true,
  '8 · el asiento usa la tasa mensual 7.75: 1000 USD = 7750 base, con la moneda original conservada');
SELECT public.chk_bool((SELECT bool_and(l.moneda_origen = 'USD' AND l.tipo_cambio = 7.75)
                          FROM public.conta_asiento_lineas l JOIN public.conta_asientos a ON a.id = l.asiento_id
                         WHERE a.origen_id = '0f300000-0000-0000-0000-000000000020' AND a.origen_tabla = 'facturas_proveedor' AND l.moneda_origen IS NOT NULL), true,
  '8 · cada línea guarda moneda y tasa original');

-- Un cambio posterior de la tasa NO reexpresa el documento ya contabilizado.
SELECT public.como(:UA::uuid);
UPDATE public.conta_tipos_cambio_mensual SET tasa = 8.50 WHERE company_id = :C::uuid AND moneda = 'USD';
SELECT public.chk_bool((SELECT total_debe = 7750 FROM public.conta_asientos WHERE origen_tabla = 'facturas_proveedor' AND origen_id = '0f300000-0000-0000-0000-000000000020' AND estado <> 'anulado'), true,
  '8 · cambiar la tasa después NO recalcula el asiento ya contabilizado');
UPDATE public.conta_tipos_cambio_mensual SET tasa = 7.75 WHERE company_id = :C::uuid AND moneda = 'USD';

-- ── 9. Sin tasa mensual de la moneda: queda visible y NO se publica ─────────
SELECT public.como(:UO::uuid);
SET ROLE authenticated;
INSERT INTO public.ordenes_compra (id, company_id, project_id, proveedor_id, proveedor_nombre, concepto, moneda)
VALUES ('0f100000-0000-0000-0000-000000000004', :C::uuid, :C1::uuid, :P2::uuid, 'Servicios Bloque B', 'Compra en EUR', 'EUR');
INSERT INTO public.orden_compra_lineas (id, company_id, orden_compra_id, linea, descripcion, destino_tipo, categoria, cantidad, precio_unitario)
VALUES ('0f110000-0000-0000-0000-000000000030', :C::uuid, '0f100000-0000-0000-0000-000000000004', 1, 'Asesoría', 'servicio', 'servicios', 1, 200);
SELECT public.como(:UA::uuid);
UPDATE public.ordenes_compra SET estado = 'aprobada' WHERE id = '0f100000-0000-0000-0000-000000000004';
UPDATE public.ordenes_compra SET estado = 'emitida'  WHERE id = '0f100000-0000-0000-0000-000000000004';
INSERT INTO public.recepciones (id, company_id, project_id, orden_compra_id, tipo, recibido_por) VALUES ('0f200000-0000-0000-0000-000000000030', :C::uuid, :C1::uuid, '0f100000-0000-0000-0000-000000000004', 'servicio', :UO::uuid);
INSERT INTO public.recepcion_lineas (company_id, recepcion_id, orden_compra_linea_id, cantidad) VALUES (:C::uuid, '0f200000-0000-0000-0000-000000000030', '0f110000-0000-0000-0000-000000000030', 1);
UPDATE public.recepciones SET estado = 'registrada' WHERE id = '0f200000-0000-0000-0000-000000000030';
INSERT INTO public.facturas_proveedor (id, company_id, project_id, proveedor_id, orden_compra_id, numero_factura, concepto, categoria, monto_total, moneda)
VALUES ('0f300000-0000-0000-0000-000000000030', :C::uuid, :C1::uuid, :P2::uuid, '0f100000-0000-0000-0000-000000000004', 'E-0001', 'Asesoría', 'servicios', 1, 'EUR');
INSERT INTO public.factura_proveedor_lineas (company_id, factura_id, orden_compra_linea_id, linea, descripcion, cantidad, precio_unitario)
VALUES (:C::uuid, '0f300000-0000-0000-0000-000000000030', '0f110000-0000-0000-0000-000000000030', 1, 'Asesoría', 1, 200);
UPDATE public.facturas_proveedor SET estado = 'aprobada' WHERE id = '0f300000-0000-0000-0000-000000000030';
RESET ROLE;
SELECT public.chk_bool((SELECT tipo_cambio_pendiente AND estado = 'borrador'
                          FROM public.conta_asientos WHERE origen_tabla = 'facturas_proveedor' AND origen_id = '0f300000-0000-0000-0000-000000000030' AND estado <> 'anulado'), true,
  '9 · sin tasa mensual de EUR el asiento queda en borrador con «tipo de cambio pendiente»');
SELECT public.como(:UA::uuid);
SET ROLE authenticated;
SELECT public.chk_falla($$ UPDATE public.conta_asientos SET estado = 'publicado' WHERE origen_tabla = 'facturas_proveedor' AND origen_id = '0f300000-0000-0000-0000-000000000030' $$,
  '.', '9 · y no se puede publicar mientras falte la tasa');
RESET ROLE;

-- ── 10. Periodo cerrado: la factura de un mes cerrado no reescribe ese mes ──
-- Regla vigente de contabilidad: el asiento se fecha hoy (periodo abierto) y el
-- mes cerrado no se toca.
SELECT public.como(:UA::uuid);
SET ROLE authenticated;
INSERT INTO public.ordenes_compra (id, company_id, project_id, proveedor_id, proveedor_nombre, concepto)
VALUES ('0f100000-0000-0000-0000-000000000005', :C::uuid, :C1::uuid, :P2::uuid, 'Servicios Bloque B', 'Periodo cerrado');
INSERT INTO public.orden_compra_lineas (id, company_id, orden_compra_id, linea, descripcion, destino_tipo, categoria, cantidad, precio_unitario)
VALUES ('0f110000-0000-0000-0000-000000000040', :C::uuid, '0f100000-0000-0000-0000-000000000005', 1, 'Reparación', 'servicio', 'mantenimiento', 1, 400);
UPDATE public.ordenes_compra SET estado = 'aprobada' WHERE id = '0f100000-0000-0000-0000-000000000005';
UPDATE public.ordenes_compra SET estado = 'emitida'  WHERE id = '0f100000-0000-0000-0000-000000000005';
INSERT INTO public.facturas_proveedor (id, company_id, project_id, proveedor_id, orden_compra_id, numero_factura, concepto, categoria, monto_total, fecha_emision)
VALUES ('0f300000-0000-0000-0000-000000000040', :C::uuid, :C1::uuid, :P2::uuid, '0f100000-0000-0000-0000-000000000005', 'P-0001', 'Reparación', 'mantenimiento', 1,
        (date_trunc('month', CURRENT_DATE) - interval '1 month')::date + 9);
INSERT INTO public.factura_proveedor_lineas (company_id, factura_id, orden_compra_linea_id, linea, descripcion, cantidad, precio_unitario)
VALUES (:C::uuid, '0f300000-0000-0000-0000-000000000040', '0f110000-0000-0000-0000-000000000040', 1, 'Reparación', 1, 400);
RESET ROLE;
INSERT INTO public.cierres_mensuales (company_id, project_id, periodo, estado)
VALUES (:C::uuid, :C1::uuid, to_char(CURRENT_DATE - interval '1 month', 'YYYY-MM'), 'cerrado');
SELECT public.como(:UA::uuid);
SET ROLE authenticated;
-- Sin recepción previa el cuadre bloquea; se fuerza con justificación para llegar al posteo.
UPDATE public.facturas_proveedor SET estado = 'aprobada', match_forzado_por = :UA::uuid, match_justificacion = 'Prueba de periodo cerrado.' WHERE id = '0f300000-0000-0000-0000-000000000040';
RESET ROLE;
SELECT public.chk_bool((SELECT periodo = to_char(CURRENT_DATE, 'YYYY-MM') FROM public.conta_asientos WHERE origen_tabla = 'facturas_proveedor' AND origen_id = '0f300000-0000-0000-0000-000000000040' AND estado <> 'anulado'), true,
  '10 · la factura de un mes cerrado se contabiliza en el periodo ABIERTO, sin tocar el cerrado');
SELECT public.chk((SELECT count(*) FROM public.conta_asientos WHERE periodo = to_char(CURRENT_DATE - interval '1 month', 'YYYY-MM') AND origen_tabla = 'facturas_proveedor' AND origen_id = '0f300000-0000-0000-0000-000000000040'), 0,
  '10 · nada se escribe en el mes cerrado');

-- ── 11. Configuración contable faltante: visible, bloquea SOLO el posteo ────
\set C2  '''c2c2c2c2-0000-0000-0000-000000000001'''
SELECT public.como(:UA::uuid);
SET ROLE authenticated;
INSERT INTO public.ordenes_compra (id, company_id, project_id, proveedor_id, proveedor_nombre, concepto)
VALUES ('0f100000-0000-0000-0000-000000000006', :C::uuid, :C2::uuid, :P2::uuid, 'Servicios Bloque B', 'Sin mapeo de CxP');
INSERT INTO public.orden_compra_lineas (id, company_id, orden_compra_id, linea, descripcion, destino_tipo, categoria, cantidad, precio_unitario)
VALUES ('0f110000-0000-0000-0000-000000000050', :C::uuid, '0f100000-0000-0000-0000-000000000006', 1, 'Pintura', 'gasto', 'mantenimiento', 1, 250);
UPDATE public.ordenes_compra SET estado = 'aprobada' WHERE id = '0f100000-0000-0000-0000-000000000006';
UPDATE public.ordenes_compra SET estado = 'emitida'  WHERE id = '0f100000-0000-0000-0000-000000000006';
RESET ROLE;
DELETE FROM public.conta_mapeo_cuentas WHERE company_id = :C::uuid AND project_id = :C2::uuid AND evento = 'cxp_proveedores';
SELECT public.como(:UA::uuid);
SET ROLE authenticated;
INSERT INTO public.facturas_proveedor (id, company_id, project_id, proveedor_id, orden_compra_id, numero_factura, concepto, categoria, monto_total)
VALUES ('0f300000-0000-0000-0000-000000000050', :C::uuid, :C2::uuid, :P2::uuid, '0f100000-0000-0000-0000-000000000006', 'M-0001', 'Pintura', 'mantenimiento', 1);
INSERT INTO public.factura_proveedor_lineas (company_id, factura_id, orden_compra_linea_id, linea, descripcion, cantidad, precio_unitario)
VALUES (:C::uuid, '0f300000-0000-0000-0000-000000000050', '0f110000-0000-0000-0000-000000000050', 1, 'Pintura', 1, 250);
UPDATE public.facturas_proveedor SET estado = 'aprobada', match_forzado_por = :UA::uuid, match_justificacion = 'Servicio facturado antes de la conformidad.' WHERE id = '0f300000-0000-0000-0000-000000000050';
RESET ROLE;
SELECT public.chk_txt((SELECT estado FROM public.facturas_proveedor WHERE id = '0f300000-0000-0000-0000-000000000050'), 'aprobada',
  '11 · la factura se aprueba (el documento no se pierde)');
SELECT public.chk((SELECT count(*) FROM public.conta_asientos WHERE origen_tabla = 'facturas_proveedor' AND origen_id = '0f300000-0000-0000-0000-000000000050'), 0,
  '11 · pero SIN el mapeo de Proveedores por pagar NO se contabiliza');
SELECT public.chk_txt((SELECT codigo FROM public.conta_intentos_contabilizacion WHERE origen_id = '0f300000-0000-0000-0000-000000000050' ORDER BY created_at DESC LIMIT 1), 'configuracion_incompleta',
  '11 · el pendiente queda registrado con su motivo (configuración incompleta)');
-- Se configura y se reprocesa: se contabiliza UNA vez, aunque se reintente.
INSERT INTO public.conta_mapeo_cuentas (company_id, project_id, evento, cuenta_id)
SELECT :C::uuid, :C2::uuid, 'cxp_proveedores', c.id FROM public.conta_cuentas c WHERE c.company_id = :C::uuid AND c.project_id = :C2::uuid AND c.codigo = '2104';
SELECT public.como(:UA::uuid);
SET ROLE authenticated;
SELECT * FROM public.conta_reprocesar_factura_proveedor('0f300000-0000-0000-0000-000000000050');
SELECT * FROM public.conta_reprocesar_factura_proveedor('0f300000-0000-0000-0000-000000000050');
RESET ROLE;
SELECT public.chk((SELECT count(*) FROM public.conta_asientos WHERE origen_tabla = 'facturas_proveedor' AND origen_id = '0f300000-0000-0000-0000-000000000050' AND estado <> 'anulado'), 1,
  '11 · al corregir la configuración y reprocesar se contabiliza UNA sola vez (reintentos idempotentes)');

-- ── 12. Cuenta explícita incompatible con el destino: rechazada con explicación ─
SELECT public.como(:UA::uuid);
SET ROLE authenticated;
INSERT INTO public.ordenes_compra (id, company_id, project_id, proveedor_id, proveedor_nombre, concepto)
VALUES ('0f100000-0000-0000-0000-000000000007', :C::uuid, :C1::uuid, :P2::uuid, 'Servicios Bloque B', 'Cuenta incompatible');
SELECT public.chk_falla($$ INSERT INTO public.orden_compra_lineas (company_id, orden_compra_id, linea, descripcion, destino_tipo, categoria, cantidad, precio_unitario, cuenta_id)
   SELECT 'cccccccc-cccc-cccc-cccc-cccccccccccc', '0f100000-0000-0000-0000-000000000007', 9, 'Equipo', 'activo_fijo', 'mantenimiento', 1, 10, c.id
     FROM public.conta_cuentas c WHERE c.company_id = 'cccccccc-cccc-cccc-cccc-cccccccccccc' AND c.project_id = 'c1c1c1c1-0000-0000-0000-000000000001' AND c.codigo LIKE '5101%' LIMIT 1 $$,
  'COMPRAS_LINEA_CUENTA_INVALIDA', '12 · una cuenta de gasto NO se acepta para un activo fijo: se rechaza explicando');
RESET ROLE;
