-- La forma MEDIDA en producción de los índices de tareas_bloque (pg_indexes,
-- 2026-10-19), montada sobre la cadena del repositorio ANTERIOR a
-- 20261101000000. run.sh exige que esta forma dé exactamente la huella que
-- producción tenía para el grupo antes de 20261102000000 (META en run.sh): si no
-- la diera, el escenario no describiría producción y la prueba de no-op no diría
-- nada.
\set ON_ERROR_STOP on
ALTER INDEX public.idx_tareas_bloque_bloque RENAME TO tareas_bloque_bloque_id_orden_idx;
DROP INDEX public.idx_tareas_bloque_completado_por;
CREATE INDEX idx_tareas_bloque_completado_por
  ON public.tareas_bloque (completado_por, completada_en DESC)
  WHERE completado_por IS NOT NULL;
DROP INDEX public.idx_tareas_bloque_plantilla_id;
