\set ON_ERROR_STOP on
-- Preparación de la concurrencia de la CARGA MASIVA de renglones (run.sh, escenarios M y N).
-- Orden Z1: un lote L1 (para aplicarlo dos veces a la vez).
-- Orden Z2: dos lotes con el MISMO contenido (para aplicarlos a la vez).
\set C   '''cccccccc-cccc-cccc-cccc-cccccccccccc'''
\set C1  '''c1c1c1c1-0000-0000-0000-000000000001'''
\set UA  '''c0c0c0c0-0000-0000-0000-00000000000a'''
\set P1  '''e3000000-0000-0000-0000-000000000001'''

SELECT public.como(:UA::uuid);
SET ROLE authenticated;
INSERT INTO public.ordenes_compra (id, company_id, project_id, proveedor_id, proveedor_nombre, concepto) VALUES
  ('0c700000-0000-0000-0000-000000000001', :C::uuid, :C1::uuid, :P1::uuid, 'Ferretería Bloque B', 'Importación concurrente 1'),
  ('0c700000-0000-0000-0000-000000000002', :C::uuid, :C1::uuid, :P1::uuid, 'Ferretería Bloque B', 'Importación concurrente 2');
CREATE TEMP TABLE lotes_imp (k text PRIMARY KEY, id uuid);
GRANT ALL ON lotes_imp TO authenticated;
INSERT INTO lotes_imp SELECT 'l1', ((public.compras_lineas_importar_previsualizar('0c700000-0000-0000-0000-000000000001',
  '[{"descripcion":"Uno","destino":"gasto","cantidad":"1","precio_unitario":"10"},{"descripcion":"Dos","destino":"servicio","cantidad":"2","precio_unitario":"20"},{"descripcion":"Tres","destino":"gasto","cantidad":"3","precio_unitario":"30"}]'::jsonb, 'l1.csv'))->>'lote_id')::uuid;
INSERT INTO lotes_imp SELECT 'l2a', ((public.compras_lineas_importar_previsualizar('0c700000-0000-0000-0000-000000000002',
  '[{"descripcion":"Uno","destino":"gasto","cantidad":"1","precio_unitario":"10"},{"descripcion":"Dos","destino":"servicio","cantidad":"2","precio_unitario":"20"}]'::jsonb, 'l2a.csv'))->>'lote_id')::uuid;
INSERT INTO lotes_imp SELECT 'l2b', ((public.compras_lineas_importar_previsualizar('0c700000-0000-0000-0000-000000000002',
  '[{"descripcion":"Uno","destino":"gasto","cantidad":"1","precio_unitario":"10"},{"descripcion":"Dos","destino":"servicio","cantidad":"2","precio_unitario":"20"}]'::jsonb, 'l2b.csv'))->>'lote_id')::uuid;
RESET ROLE;
-- Los ids se guardan en una tabla normal para que las sesiones concurrentes los lean.
CREATE TABLE public.zz_lotes_import AS SELECT * FROM lotes_imp;
