\set ON_ERROR_STOP on
-- Preparación de la concurrencia (run.sh, escenarios M y N), como la persona 3 (operadora
-- de PA1 con permiso de crear). L1: un lote para aplicarlo dos veces a la vez. L2A/L2B: dos
-- lotes con el MISMO contenido para aplicarlos a la vez.
\i ../housekeeping_evidencias/lib.sql
SELECT hkt.como(hkt.uid(3));
CREATE TEMP TABLE lotes_pl (k text PRIMARY KEY, id uuid);
GRANT ALL ON lotes_pl TO authenticated;
INSERT INTO lotes_pl SELECT 'l1', ((public.plantillas_importar_previsualizar(hkt.pa1(),
  '[{"titulo":"CC-1","cargo":"conserje","servicio":"otro","insumos":"Escoba"},
    {"titulo":"CC-2","cargo":"conserje","servicio":"otro","herramientas":"Trapeador"},
    {"titulo":"CC-3","cargo":"guardia","servicio":"seguridad"}]'::jsonb, 'l1.csv'))->>'lote_id')::uuid;
INSERT INTO lotes_pl SELECT 'l2a', ((public.plantillas_importar_previsualizar(hkt.pa1(),
  '[{"titulo":"CC-4","cargo":"conserje","servicio":"otro"},
    {"titulo":"CC-5","cargo":"jardinero","servicio":"jardineria","equipo":"Pulidora"}]'::jsonb, 'l2a.csv'))->>'lote_id')::uuid;
INSERT INTO lotes_pl SELECT 'l2b', ((public.plantillas_importar_previsualizar(hkt.pa1(),
  '[{"titulo":"CC-4","cargo":"conserje","servicio":"otro"},
    {"titulo":"CC-5","cargo":"jardinero","servicio":"jardineria","equipo":"Pulidora"}]'::jsonb, 'l2b.csv'))->>'lote_id')::uuid;
SELECT hkt.root();
-- Los ids se guardan en una tabla normal para que las sesiones concurrentes los lean.
CREATE TABLE public.zz_lotes_pl AS SELECT * FROM lotes_pl;
