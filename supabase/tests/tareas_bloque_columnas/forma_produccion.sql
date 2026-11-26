-- La forma MEDIDA en producción de las columnas de tareas_bloque (pg_attribute,
-- 2026-11-26, sólo SELECT), montada sobre la cadena del repositorio ANTERIOR a
-- 20261226000000. run.sh exige que esta forma dé exactamente la huella que
-- huella-produccion.json registra para el grupo: si no la diera, el escenario no
-- describiría producción y la prueba de no-op no diría nada.
--
-- Se escribe a mano y NO con la migración: si las dos coincidieran por
-- construcción, la prueba de no-op sería una tautología.
\set ON_ERROR_STOP on
ALTER TABLE public.tareas_bloque ADD COLUMN foto_url text;
ALTER TABLE public.tareas_bloque ADD COLUMN icono text DEFAULT '📋';
ALTER TABLE public.tareas_bloque ALTER COLUMN created_at SET NOT NULL;
ALTER TABLE public.tareas_bloque ALTER COLUMN orden DROP NOT NULL;
