\set ON_ERROR_STOP on
-- Preparación de la concurrencia de CONTRATOS (run.sh, escenarios Q, R y S).
--   Q · dos órdenes de 600 sobre un contrato con máximo de 1000, aprobadas a la vez: solo cabe una.
--   R · la MISMA renovación pedida por dos sesiones a la vez: un solo contrato.
--   S · la MISMA ampliación (misma clave) pedida por dos sesiones a la vez: una sola ampliación.
\set C   '''cccccccc-cccc-cccc-cccc-cccccccccccc'''
\set C1  '''c1c1c1c1-0000-0000-0000-000000000001'''
\set UA  '''c0c0c0c0-0000-0000-0000-00000000000a'''
\set P1  '''e3000000-0000-0000-0000-000000000001'''

SELECT public.como(:UA::uuid);
SET ROLE authenticated;
INSERT INTO public.contratos_proveedores
  (id, company_id, project_id, proveedor_id, proveedor_nombre, referencia, fecha_inicio, fecha_fin, modalidad, periodicidad, moneda, importe_periodico, monto_maximo, responsable_id) VALUES
  ('cf100000-0000-0000-0000-000000000001', :C::uuid, :C1::uuid, :P1::uuid, 'x', 'CF-Q', CURRENT_DATE - 10, CURRENT_DATE + 200, 'por_demanda', NULL,      'GTQ', NULL, 1000, :UA::uuid),
  ('cf100000-0000-0000-0000-000000000002', :C::uuid, :C1::uuid, :P1::uuid, 'x', 'CF-R', CURRENT_DATE - 10, NULL,               'recurrente',  'mensual', 'GTQ', 250,  NULL, :UA::uuid);
UPDATE public.contratos_proveedores SET estado = 'activo'
 WHERE id IN ('cf100000-0000-0000-0000-000000000001', 'cf100000-0000-0000-0000-000000000002');
INSERT INTO public.ordenes_compra (id, company_id, project_id, proveedor_id, proveedor_nombre, concepto, contrato_id) VALUES
  ('0cf00000-0000-0000-0000-000000000001', :C::uuid, :C1::uuid, :P1::uuid, 'Ferretería Bloque B', 'Q1: 600 sobre un máximo de 1000', 'cf100000-0000-0000-0000-000000000001'),
  ('0cf00000-0000-0000-0000-000000000002', :C::uuid, :C1::uuid, :P1::uuid, 'Ferretería Bloque B', 'Q2: 600 sobre un máximo de 1000', 'cf100000-0000-0000-0000-000000000001');
INSERT INTO public.orden_compra_lineas (company_id, orden_compra_id, linea, descripcion, destino_tipo, categoria, cantidad, unidad, precio_unitario) VALUES
  (:C::uuid, '0cf00000-0000-0000-0000-000000000001', 1, 'Material', 'gasto', 'mantenimiento', 1, 'unidad', 600),
  (:C::uuid, '0cf00000-0000-0000-0000-000000000002', 1, 'Material', 'gasto', 'mantenimiento', 1, 'unidad', 600);
RESET ROLE;
