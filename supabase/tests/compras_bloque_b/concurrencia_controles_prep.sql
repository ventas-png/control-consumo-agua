\set ON_ERROR_STOP on
-- Preparación de la concurrencia de los CONTROLES DE SERVIDOR (run.sh, escenarios T y U).
--   T · dos órdenes de pago de 700 sobre una factura de 1 000, creadas a la vez: solo cabe UNA.
--   U · el mismo número de factura escrito de dos formas, registrado a la vez: UNA factura.
\set C   '''cccccccc-cccc-cccc-cccc-cccccccccccc'''
\set C1  '''c1c1c1c1-0000-0000-0000-000000000001'''
\set UA  '''c0c0c0c0-0000-0000-0000-00000000000a'''
\set P1  '''e3000000-0000-0000-0000-000000000001'''

SELECT public.como(:UA::uuid);
SET ROLE authenticated;
INSERT INTO public.facturas_proveedor (id, company_id, project_id, proveedor_id, numero_factura, concepto, monto_total)
VALUES ('ce300000-0000-0000-0000-0000000000e1', :C::uuid, :C1::uuid, :P1::uuid, 'CE-CONC-T1', 'Factura de 1 000 para la carrera de pagos', 1000);
UPDATE public.facturas_proveedor SET estado = 'aprobada' WHERE id = 'ce300000-0000-0000-0000-0000000000e1';
RESET ROLE;
