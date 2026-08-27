-- ════════════════════════════════════════════════════════════════════════════
-- El estado REAL de producción tras 20260906000000
-- ════════════════════════════════════════════════════════════════════════════
-- Comprobado el 2026-08-27 contra la base real:
--
--   · `completada_en` existe (el renombre de 20260906000000 la dejó así)
--   · `completado_por` existe — la creó el bucle dinámico de 20260731000000,
--     que en producción SÍ encontró el hito `completado_en` que buscaba
--   · `trg_sellar_cierre` sigue instalado con los argumentos VIEJOS:
--       CREATE TRIGGER trg_sellar_cierre BEFORE UPDATE ON public.tareas_bloque
--       FOR EACH ROW EXECUTE FUNCTION sellar_cierre('completado_en', 'completado_por')
--
-- El renombre no toca los argumentos de un trigger, que son literales de texto.
-- Y `sellar_cierre` lee el hito con `to_jsonb(OLD)->>v_hito`: una clave que no
-- existe da NULL, no error. Por eso no revienta — deja de sellar en silencio.
--
-- Este escenario es el que de verdad importa: el otro (esquema declarado, sin
-- `completado_por`) prueba que el arreglo también vale en una base nueva.

ALTER TABLE public.tareas_bloque
  ADD COLUMN completado_por uuid REFERENCES auth.users(id) ON DELETE SET NULL;

CREATE TRIGGER trg_sellar_cierre
  BEFORE UPDATE ON public.tareas_bloque
  FOR EACH ROW EXECUTE FUNCTION public.sellar_cierre('completado_en', 'completado_por');
