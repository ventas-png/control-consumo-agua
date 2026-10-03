\set ON_ERROR_STOP on
-- Preparación de la concurrencia de RESPALDOS (run.sh, escenarios O y P).
-- Recepción RO (borrador): dos sesiones registran EL MISMO archivo a la vez.
-- Recepción RP (borrador) con un respaldo: una sesión la REGISTRA mientras otra intenta RETIRAR ese respaldo.
\set C   '''cccccccc-cccc-cccc-cccc-cccccccccccc'''
\set C1  '''c1c1c1c1-0000-0000-0000-000000000001'''
\set UA  '''c0c0c0c0-0000-0000-0000-00000000000a'''
\set P1  '''e3000000-0000-0000-0000-000000000001'''

SELECT public.como(:UA::uuid);
SET ROLE authenticated;
INSERT INTO public.ordenes_compra (id, company_id, project_id, proveedor_id, proveedor_nombre, concepto) VALUES
  ('0cd00000-0000-0000-0000-000000000001', :C::uuid, :C1::uuid, :P1::uuid, 'Ferretería Bloque B', 'Respaldos concurrentes'),
  ('0cd00000-0000-0000-0000-000000000002', :C::uuid, :C1::uuid, :P1::uuid, 'Ferretería Bloque B', 'Retiro vs registro');
INSERT INTO public.orden_compra_lineas (id, company_id, orden_compra_id, linea, descripcion, destino_tipo, categoria, cantidad, unidad, precio_unitario, iva_monto) VALUES
  ('0cd10000-0000-0000-0000-000000000001', :C::uuid, '0cd00000-0000-0000-0000-000000000001', 1, 'Renglón', 'gasto', 'mantenimiento', 5, 'u', 10, 0),
  ('0cd10000-0000-0000-0000-000000000002', :C::uuid, '0cd00000-0000-0000-0000-000000000002', 1, 'Renglón', 'gasto', 'mantenimiento', 5, 'u', 10, 0);
UPDATE public.ordenes_compra SET estado = 'aprobada' WHERE id IN ('0cd00000-0000-0000-0000-000000000001', '0cd00000-0000-0000-0000-000000000002');
UPDATE public.ordenes_compra SET estado = 'emitida'  WHERE id IN ('0cd00000-0000-0000-0000-000000000001', '0cd00000-0000-0000-0000-000000000002');
INSERT INTO public.recepciones (id, company_id, project_id, orden_compra_id, tipo) VALUES
  ('0cd20000-0000-0000-0000-000000000001', :C::uuid, :C1::uuid, '0cd00000-0000-0000-0000-000000000001', 'bienes'),
  ('0cd20000-0000-0000-0000-000000000002', :C::uuid, :C1::uuid, '0cd00000-0000-0000-0000-000000000002', 'bienes');
INSERT INTO public.recepcion_lineas (company_id, recepcion_id, orden_compra_linea_id, cantidad) VALUES
  (:C::uuid, '0cd20000-0000-0000-0000-000000000001', '0cd10000-0000-0000-0000-000000000001', 1),
  (:C::uuid, '0cd20000-0000-0000-0000-000000000002', '0cd10000-0000-0000-0000-000000000002', 1);
RESET ROLE;

INSERT INTO storage.objects (bucket_id, name, metadata) VALUES
  ('recepciones-respaldo', 'cccccccc-cccc-cccc-cccc-cccccccccccc/c1c1c1c1-0000-0000-0000-000000000001/0cd20000-0000-0000-0000-000000000001/doble.pdf', '{"size": 1234, "mimetype": "application/pdf"}'::jsonb),
  ('recepciones-respaldo', 'cccccccc-cccc-cccc-cccc-cccccccccccc/c1c1c1c1-0000-0000-0000-000000000001/0cd20000-0000-0000-0000-000000000002/carrera.pdf', '{"size": 4321, "mimetype": "application/pdf"}'::jsonb);
SELECT public.como(:UA::uuid);
SET ROLE authenticated;
SELECT public.compras_recepcion_adjuntar('0cd20000-0000-0000-0000-000000000002',
  'cccccccc-cccc-cccc-cccc-cccccccccccc/c1c1c1c1-0000-0000-0000-000000000001/0cd20000-0000-0000-0000-000000000002/carrera.pdf',
  'Carrera.pdf', 'application/pdf', 4321, repeat('c', 64), 'entrega');
RESET ROLE;
