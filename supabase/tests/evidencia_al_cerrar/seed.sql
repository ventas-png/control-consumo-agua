-- Semilla posterior a las migraciones: estas tareas usan columnas que crea
-- 20260905000300 (`requiere_comentario`, `requiere_checklist`, `checklist`).
--
-- Una tarea por exigencia, para que cada invariante falle por SU motivo y no
-- por arrastre de otra.

INSERT INTO public.tareas_bloque (id, bloque_id, titulo, requiere_foto) VALUES
  ('80000000-0000-0000-0000-0000000000f0', '70000000-0000-0000-0000-000000000001',
   'Exige foto', true);

INSERT INTO public.tareas_bloque (id, bloque_id, titulo, requiere_comentario) VALUES
  ('80000000-0000-0000-0000-0000000000c0', '70000000-0000-0000-0000-000000000001',
   'Exige comentario', true);

INSERT INTO public.tareas_bloque (id, bloque_id, titulo, requiere_checklist, checklist) VALUES
  ('80000000-0000-0000-0000-0000000000d0', '70000000-0000-0000-0000-000000000001',
   'Exige checklist', true, '["Uno", "Dos", "Tres"]'::jsonb);

-- Exige LAS TRES: sirve para comprobar que el trigger reporta la primera que
-- falta y no una cualquiera.
INSERT INTO public.tareas_bloque
  (id, bloque_id, titulo, requiere_foto, requiere_comentario, requiere_checklist, checklist) VALUES
  ('80000000-0000-0000-0000-0000000000e0', '70000000-0000-0000-0000-000000000001',
   'Exige todo', true, true, true, '["Uno"]'::jsonb);

-- Sin exigencias: el control positivo.
INSERT INTO public.tareas_bloque (id, bloque_id, titulo) VALUES
  ('80000000-0000-0000-0000-0000000000aa', '70000000-0000-0000-0000-000000000001',
   'Sin exigencias');

-- Para la salida declarada.
INSERT INTO public.tareas_bloque (id, bloque_id, titulo, requiere_foto) VALUES
  ('80000000-0000-0000-0000-0000000000b0', '70000000-0000-0000-0000-000000000001',
   'Exige foto, se cerrará con motivo', true);

-- Para 'con_observacion' y 'omitida'.
INSERT INTO public.tareas_bloque (id, bloque_id, titulo, requiere_foto) VALUES
  ('80000000-0000-0000-0000-00000000000b', '70000000-0000-0000-0000-000000000001',
   'Exige foto, se reportará con observación', true),
  ('80000000-0000-0000-0000-00000000000c', '70000000-0000-0000-0000-000000000001',
   'Exige foto, se omitirá', true);

-- HISTÓRICA: ya cerrada sin evidencia, como las que hay hoy en producción. El
-- trigger no debe re-validarla nunca — se inserta YA completada, así que jamás
-- hace la transición que el trigger gatea.
INSERT INTO public.tareas_bloque
  (id, bloque_id, titulo, requiere_foto, estado, completada_en) VALUES
  ('80000000-0000-0000-0000-0000000000ff', '70000000-0000-0000-0000-000000000001',
   'Cerrada hace meses sin foto', true, 'completada', now() - interval '90 days');
