-- El valor legacy SIN equivalencia documentada. Solo lo carga el escenario que
-- prueba que la migración ABORTA: mapear 'en_curso' a 'pendiente' o a
-- 'completada' es una decisión de producto que nadie tomó, y una migración que
-- la invente en silencio es peor que una que se detiene y lo dice.
INSERT INTO public.tareas_bloque (id, bloque_id, titulo, estado) VALUES
  ('a1000000-0000-0000-0000-00000000000e', 'b1000000-0000-0000-0000-000000000001',
   'Tarea a medio hacer', 'en_curso');
