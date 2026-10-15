\set ON_ERROR_STOP on
-- Preparación de la concurrencia (run.sh, escenarios M y N), como la persona 3 (operadora
-- de PA1 con permiso de crear). L1: un lote para aplicarlo dos veces a la vez. L2A/L2B: dos
-- lotes con el MISMO contenido para aplicarlos a la vez.
\i ../housekeeping_evidencias/lib.sql
SELECT hkt.como(hkt.uid(3));
CREATE TEMP TABLE lotes_str (k text PRIMARY KEY, id uuid);
GRANT ALL ON lotes_str TO authenticated;
INSERT INTO lotes_str SELECT 'l1', ((public.str_reservas_importar_previsualizar(hkt.pa1(),
  '[{"unidad":"Apto 2B","huesped_nombre":"Uno","fecha_entrada":"2027-01-01","fecha_salida":"2027-01-03","codigo_confirmacion":"CC-1"},
    {"unidad":"Apto 2B","huesped_nombre":"Dos","fecha_entrada":"2027-01-05","fecha_salida":"2027-01-07","codigo_confirmacion":"CC-2"},
    {"unidad":"Apto 2B","huesped_nombre":"Tres","fecha_entrada":"2027-01-09","fecha_salida":"2027-01-11","codigo_confirmacion":"CC-3"}]'::jsonb, 'l1.csv'))->>'lote_id')::uuid;
INSERT INTO lotes_str SELECT 'l2a', ((public.str_reservas_importar_previsualizar(hkt.pa1(),
  '[{"unidad":"Apto 1A","huesped_nombre":"Cuatro","fecha_entrada":"2027-02-01","fecha_salida":"2027-02-03","codigo_confirmacion":"CC-4"},
    {"unidad":"Apto 1A","huesped_nombre":"Cinco","fecha_entrada":"2027-02-05","fecha_salida":"2027-02-07","codigo_confirmacion":"CC-5"}]'::jsonb, 'l2a.csv'))->>'lote_id')::uuid;
INSERT INTO lotes_str SELECT 'l2b', ((public.str_reservas_importar_previsualizar(hkt.pa1(),
  '[{"unidad":"Apto 1A","huesped_nombre":"Cuatro","fecha_entrada":"2027-02-01","fecha_salida":"2027-02-03","codigo_confirmacion":"CC-4"},
    {"unidad":"Apto 1A","huesped_nombre":"Cinco","fecha_entrada":"2027-02-05","fecha_salida":"2027-02-07","codigo_confirmacion":"CC-5"}]'::jsonb, 'l2b.csv'))->>'lote_id')::uuid;
SELECT hkt.root();
-- Los ids se guardan en una tabla normal para que las sesiones concurrentes los lean.
CREATE TABLE public.zz_lotes_str AS SELECT * FROM lotes_str;
