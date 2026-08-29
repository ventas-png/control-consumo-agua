-- Los dos triggers de sellado que 20260907000100 ya dejó sobre tareas_bloque,
-- copiados literalmente (mismo criterio que evidencia_al_cerrar/fixture.sql).
--
-- Sin ellos, el cierre dentro de `cerrar_tarea_y_consumir_insumos` correría con
-- MENOS triggers que en producción, y dos invariantes quedarían sin probar:
-- que `completado_por` lo sella la BD con el actor real (no el payload), y que
-- los tres BEFORE UPDATE (evidencia → sellar_cierre → anulación, en orden
-- alfabético) conviven con el UPDATE que dispara la RPC.
--
-- El fixture de consumo_insumos declara las FUNCIONES (`sellar_cierre`) pero no
-- estos triggers, porque aquel sandbox nunca cerraba tareas por UPDATE.
DROP TRIGGER IF EXISTS trg_sellar_cierre ON public.tareas_bloque;
CREATE TRIGGER trg_sellar_cierre
  BEFORE UPDATE ON public.tareas_bloque
  FOR EACH ROW EXECUTE FUNCTION public.sellar_cierre('completada_en', 'completado_por');

DROP TRIGGER IF EXISTS trg_tareas_bloque_anulacion ON public.tareas_bloque;
CREATE TRIGGER trg_tareas_bloque_anulacion
  BEFORE UPDATE ON public.tareas_bloque
  FOR EACH ROW EXECUTE FUNCTION public.sellar_cierre('anulada_en', 'anulada_por');
