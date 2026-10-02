\set ON_ERROR_STOP on
-- Preparación de las pruebas con sesiones REALES simultáneas (run.sh).
-- Orden K (C1, P1): una línea de gasto 100 × 10, emitida. Dos recepciones en
-- borrador de 70 (no caben juntas) y, tras recibir 100, dos facturas en borrador
-- por las mismas 100 unidades (solo una puede aprobarse).
\set C   '''cccccccc-cccc-cccc-cccc-cccccccccccc'''
\set C1  '''c1c1c1c1-0000-0000-0000-000000000001'''
\set UA  '''c0c0c0c0-0000-0000-0000-00000000000a'''
\set P1  '''e3000000-0000-0000-0000-000000000001'''

SELECT public.como(:UA::uuid);
SET ROLE authenticated;
INSERT INTO public.ordenes_compra (id, company_id, project_id, proveedor_id, proveedor_nombre, concepto)
VALUES ('0c100000-0000-0000-0000-000000000001', :C::uuid, :C1::uuid, :P1::uuid, 'Ferretería Bloque B', 'Concurrencia');
INSERT INTO public.orden_compra_lineas (id, company_id, orden_compra_id, linea, descripcion, destino_tipo, categoria, cantidad, precio_unitario)
VALUES ('0c110000-0000-0000-0000-000000000001', :C::uuid, '0c100000-0000-0000-0000-000000000001', 1, 'Material', 'gasto', 'mantenimiento', 100, 10);
UPDATE public.ordenes_compra SET estado = 'aprobada' WHERE id = '0c100000-0000-0000-0000-000000000001';
UPDATE public.ordenes_compra SET estado = 'emitida'  WHERE id = '0c100000-0000-0000-0000-000000000001';
INSERT INTO public.recepciones (id, company_id, project_id, orden_compra_id, tipo) VALUES
  ('0c200000-0000-0000-0000-000000000001', :C::uuid, :C1::uuid, '0c100000-0000-0000-0000-000000000001', 'bienes'),
  ('0c200000-0000-0000-0000-000000000002', :C::uuid, :C1::uuid, '0c100000-0000-0000-0000-000000000001', 'bienes');
INSERT INTO public.recepcion_lineas (company_id, recepcion_id, orden_compra_linea_id, cantidad) VALUES
  (:C::uuid, '0c200000-0000-0000-0000-000000000001', '0c110000-0000-0000-0000-000000000001', 70),
  (:C::uuid, '0c200000-0000-0000-0000-000000000002', '0c110000-0000-0000-0000-000000000001', 70);
RESET ROLE;

-- Segunda orden M: ya recibida completa, con dos facturas en borrador por lo mismo.
SELECT public.como(:UA::uuid);
SET ROLE authenticated;
INSERT INTO public.ordenes_compra (id, company_id, project_id, proveedor_id, proveedor_nombre, concepto)
VALUES ('0c100000-0000-0000-0000-000000000002', :C::uuid, :C1::uuid, :P1::uuid, 'Ferretería Bloque B', 'Concurrencia facturas');
INSERT INTO public.orden_compra_lineas (id, company_id, orden_compra_id, linea, descripcion, destino_tipo, categoria, cantidad, precio_unitario)
VALUES ('0c110000-0000-0000-0000-000000000002', :C::uuid, '0c100000-0000-0000-0000-000000000002', 1, 'Material', 'gasto', 'mantenimiento', 10, 10);
UPDATE public.ordenes_compra SET estado = 'aprobada' WHERE id = '0c100000-0000-0000-0000-000000000002';
UPDATE public.ordenes_compra SET estado = 'emitida'  WHERE id = '0c100000-0000-0000-0000-000000000002';
INSERT INTO public.recepciones (id, company_id, project_id, orden_compra_id, tipo) VALUES ('0c200000-0000-0000-0000-000000000003', :C::uuid, :C1::uuid, '0c100000-0000-0000-0000-000000000002', 'bienes');
INSERT INTO public.recepcion_lineas (company_id, recepcion_id, orden_compra_linea_id, cantidad) VALUES (:C::uuid, '0c200000-0000-0000-0000-000000000003', '0c110000-0000-0000-0000-000000000002', 10);
UPDATE public.recepciones SET estado = 'registrada' WHERE id = '0c200000-0000-0000-0000-000000000003';
INSERT INTO public.facturas_proveedor (id, company_id, project_id, proveedor_id, orden_compra_id, numero_factura, concepto, categoria, monto_total) VALUES
  ('0c300000-0000-0000-0000-000000000001', :C::uuid, :C1::uuid, :P1::uuid, '0c100000-0000-0000-0000-000000000002', 'K-0001', 'Factura A', 'mantenimiento', 1),
  ('0c300000-0000-0000-0000-000000000002', :C::uuid, :C1::uuid, :P1::uuid, '0c100000-0000-0000-0000-000000000002', 'K-0002', 'Factura B', 'mantenimiento', 1);
INSERT INTO public.factura_proveedor_lineas (company_id, factura_id, orden_compra_linea_id, linea, descripcion, cantidad, precio_unitario) VALUES
  (:C::uuid, '0c300000-0000-0000-0000-000000000001', '0c110000-0000-0000-0000-000000000002', 1, 'Material', 10, 10),
  (:C::uuid, '0c300000-0000-0000-0000-000000000002', '0c110000-0000-0000-0000-000000000002', 1, 'Material', 10, 10);
RESET ROLE;

-- Tercera orden Q: recibida completa (10 × 10), para facturar por compras_factura_crear
-- con sesiones simultáneas, interrumpidas y reintentadas.
SELECT public.como(:UA::uuid);
SET ROLE authenticated;
INSERT INTO public.ordenes_compra (id, company_id, project_id, proveedor_id, proveedor_nombre, concepto)
VALUES ('0c100000-0000-0000-0000-000000000003', :C::uuid, :C1::uuid, :P1::uuid, 'Ferretería Bloque B', 'Concurrencia RPC de factura');
INSERT INTO public.orden_compra_lineas (id, company_id, orden_compra_id, linea, descripcion, destino_tipo, categoria, cantidad, precio_unitario)
VALUES ('0c110000-0000-0000-0000-000000000003', :C::uuid, '0c100000-0000-0000-0000-000000000003', 1, 'Material', 'gasto', 'mantenimiento', 10, 10);
UPDATE public.ordenes_compra SET estado = 'aprobada' WHERE id = '0c100000-0000-0000-0000-000000000003';
UPDATE public.ordenes_compra SET estado = 'emitida'  WHERE id = '0c100000-0000-0000-0000-000000000003';
INSERT INTO public.recepciones (id, company_id, project_id, orden_compra_id, tipo) VALUES ('0c200000-0000-0000-0000-000000000004', :C::uuid, :C1::uuid, '0c100000-0000-0000-0000-000000000003', 'bienes');
INSERT INTO public.recepcion_lineas (company_id, recepcion_id, orden_compra_linea_id, cantidad) VALUES (:C::uuid, '0c200000-0000-0000-0000-000000000004', '0c110000-0000-0000-0000-000000000003', 10);
UPDATE public.recepciones SET estado = 'registrada' WHERE id = '0c200000-0000-0000-0000-000000000004';
RESET ROLE;
