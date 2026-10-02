\set ON_ERROR_STOP on
-- Preparación de la prueba de concurrencia del INVENTARIO (run.sh, escenario L).
-- Insumo SC (litro, C1) y orden W emitida con un renglón de inventario 50 L × 10;
-- una recepción en borrador con 25 aceptados.
\set C   '''cccccccc-cccc-cccc-cccc-cccccccccccc'''
\set C1  '''c1c1c1c1-0000-0000-0000-000000000001'''
\set UA  '''c0c0c0c0-0000-0000-0000-00000000000a'''
\set P1  '''e3000000-0000-0000-0000-000000000001'''

INSERT INTO public.suministros_condominio (id, company_id, project_id, nombre, unidad_medida)
VALUES ('0c5c0000-0000-0000-0000-000000000001', :C::uuid, :C1::uuid, 'Insumo concurrente', 'litro');

SELECT public.como(:UA::uuid);
SET ROLE authenticated;
INSERT INTO public.ordenes_compra (id, company_id, project_id, proveedor_id, proveedor_nombre, concepto)
VALUES ('0c100000-0000-0000-0000-000000000004', :C::uuid, :C1::uuid, :P1::uuid, 'Ferretería Bloque B', 'Concurrencia de inventario');
INSERT INTO public.orden_compra_lineas (id, company_id, orden_compra_id, linea, descripcion, destino_tipo, suministro_id, categoria, cantidad, unidad, precio_unitario)
VALUES ('0c110000-0000-0000-0000-000000000004', :C::uuid, '0c100000-0000-0000-0000-000000000004', 1, 'Insumo concurrente', 'inventario', '0c5c0000-0000-0000-0000-000000000001', 'limpieza', 50, 'litro', 10);
UPDATE public.ordenes_compra SET estado = 'aprobada' WHERE id = '0c100000-0000-0000-0000-000000000004';
UPDATE public.ordenes_compra SET estado = 'emitida'  WHERE id = '0c100000-0000-0000-0000-000000000004';
INSERT INTO public.recepciones (id, company_id, project_id, orden_compra_id, tipo)
VALUES ('0c200000-0000-0000-0000-000000000005', :C::uuid, :C1::uuid, '0c100000-0000-0000-0000-000000000004', 'bienes');
INSERT INTO public.recepcion_lineas (company_id, recepcion_id, orden_compra_linea_id, cantidad, costo_unitario)
VALUES (:C::uuid, '0c200000-0000-0000-0000-000000000005', '0c110000-0000-0000-0000-000000000004', 25, 10);
RESET ROLE;
