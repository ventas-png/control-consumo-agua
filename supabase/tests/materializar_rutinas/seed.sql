-- Semilla que corre DESPUÉS de las migraciones: `rutinas_limpieza` y
-- `rutina_actividades` las crea 20260905000200, así que no pueden vivir en el
-- fixture. También se completa aquí lo que 20260904000100 le agregó al catálogo
-- (duración, checklist, instrucciones), que es justo lo que la materialización
-- tiene que copiar.

-- El catálogo, con lo que la tarea debe heredar.
UPDATE public.plantillas_tarea_cargo SET
  duracion_estimada_min   = 20,
  checklist               = '["Quitar hojas", "Enjuagar"]'::jsonb,
  instrucciones_seguridad = 'Usar guantes',
  requiere_comentario     = true,
  requiere_checklist      = true,
  requiere_foto           = true
WHERE id = 'd0000000-0000-0000-0000-000000000001';

UPDATE public.plantillas_tarea_cargo SET duracion_estimada_min = 15
WHERE id = 'd0000000-0000-0000-0000-000000000002';

-- La tercera se da de BAJA: sigue en la rutina, pero no debe generar trabajo.
UPDATE public.plantillas_tarea_cargo SET activo = false
WHERE id = 'd0000000-0000-0000-0000-000000000003';

-- ── Rutinas ────────────────────────────────────────────────────────────────
-- Con jornada matutina: la que sí se materializa. Sin área propia, para que el
-- área de la rutina sea la que herede el paso que no declara ninguna.
INSERT INTO public.rutinas_limpieza
  (id, company_id, project_id, nombre, area_id, plantilla_horario_id, orden) VALUES
  ('4a000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000001',
   '11111111-0000-0000-0000-000000000001', 'Matutina de piscina',
   'e0000000-0000-0000-0000-000000000001', 'f0000000-0000-0000-0000-000000000001', 0);

-- SIN jornada: no puede materializarse sola, y la RPC lo reporta.
INSERT INTO public.rutinas_limpieza
  (id, company_id, project_id, nombre, plantilla_horario_id, orden) VALUES
  ('4a000000-0000-0000-0000-000000000002', 'c0000000-0000-0000-0000-000000000001',
   '11111111-0000-0000-0000-000000000001', 'Rutina sin jornada', NULL, 1);

-- INACTIVA aunque tenga jornada: tampoco genera nada.
INSERT INTO public.rutinas_limpieza
  (id, company_id, project_id, nombre, plantilla_horario_id, activa, orden) VALUES
  ('4a000000-0000-0000-0000-000000000003', 'c0000000-0000-0000-0000-000000000001',
   '11111111-0000-0000-0000-000000000001', 'Rutina retirada',
   'f0000000-0000-0000-0000-000000000001', false, 2);

-- ── Pasos de la rutina matutina ────────────────────────────────────────────
-- El `orden` tiene un HUECO a propósito (0 y 5): la RPC debe producir posiciones
-- densas y consecutivas, no copiar el hueco.
INSERT INTO public.rutina_actividades
  (company_id, project_id, rutina_id, plantilla_tarea_id, orden) VALUES
  ('c0000000-0000-0000-0000-000000000001', '11111111-0000-0000-0000-000000000001',
   '4a000000-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-000000000001', 0),
  ('c0000000-0000-0000-0000-000000000001', '11111111-0000-0000-0000-000000000001',
   '4a000000-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-000000000002', 5),
  -- La actividad dada de baja: está en la receta y NO debe generar tarea.
  ('c0000000-0000-0000-0000-000000000001', '11111111-0000-0000-0000-000000000001',
   '4a000000-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-000000000003', 9);

-- La rutina retirada también tiene un paso, para que su omisión sea por estar
-- inactiva y no por estar vacía.
INSERT INTO public.rutina_actividades
  (company_id, project_id, rutina_id, plantilla_tarea_id, orden) VALUES
  ('c0000000-0000-0000-0000-000000000001', '11111111-0000-0000-0000-000000000001',
   '4a000000-0000-0000-0000-000000000003', 'd0000000-0000-0000-0000-000000000002', 0);
