-- Semilla POSTERIOR a las migraciones: las columnas del snapshot en
-- `plantillas_tarea_cargo` las crea 20260904000200, y el trigger que se prueba
-- lo crea 20260907000600 — insertar las tareas ES lo que lo dispara.
--
-- Corre como superusuario, así que la RLS no aplica aquí.

-- ── Las plantillas ──────────────────────────────────────────────────────────
-- P1 declara TODO: es la que debe llegar entera a la tarea.
UPDATE public.plantillas_tarea_cargo SET
  duracion_estimada_min   = 25,
  checklist               = '["Quitar hojas", "Medir cloro", "Enjuagar"]'::jsonb,
  instrucciones_seguridad = 'Usar guantes y gafas; no mezclar productos',
  requiere_foto           = true,
  requiere_comentario     = true,
  requiere_checklist      = true
WHERE id = '80000000-0000-0000-0000-000000000001';

-- P2 no declara nada: sirve para comprobar que el trigger no inventa
-- exigencias donde la plantilla no las pide.
UPDATE public.plantillas_tarea_cargo SET
  duracion_estimada_min   = NULL,
  checklist               = '[]'::jsonb,
  instrucciones_seguridad = NULL,
  requiere_foto           = false,
  requiere_comentario     = false,
  requiere_checklist      = false
WHERE id = '80000000-0000-0000-0000-000000000002';

-- ── Las tareas ──────────────────────────────────────────────────────────────
-- T1 · La ruta manual tal como la escribe hoy TareasPersonalTab: sólo cuatro
-- campos. Es el caso que este PR viene a arreglar.
INSERT INTO public.tareas_bloque
  (id, bloque_id, plantilla_id, titulo, descripcion, area_id, requiere_foto, orden)
VALUES
  ('b1000000-0000-0000-0000-000000000001', '70000000-0000-0000-0000-000000000001',
   '80000000-0000-0000-0000-000000000001', 'Limpiar la piscina', NULL,
   '60000000-0000-0000-0000-000000000001', false, 0);

-- T2 · Igual, pero el llamador YA trae su propio checklist. No debe pisarse:
-- lo que alguien mandó a propósito manda sobre la receta.
--
-- Va en OTRO bloque porque `uq_tareas_bloque_plantilla` (20260907000100) impide
-- la misma plantilla dos veces en el mismo turno — que es justo lo que ese
-- índice viene a evitar, así que se respeta en vez de esquivarlo.
INSERT INTO public.bloques_turno
  (id, company_id, project_id, personal_id, fecha, estado) VALUES
  ('70000000-0000-0000-0000-000000000002', 'c0000000-0000-0000-0000-000000000001',
   '11111111-0000-0000-0000-000000000001', '90000000-0000-0000-0000-000000000001',
   '2026-09-11', 'en_curso');

INSERT INTO public.tareas_bloque
  (id, bloque_id, plantilla_id, titulo, checklist, requiere_checklist, orden)
VALUES
  ('b1000000-0000-0000-0000-000000000002', '70000000-0000-0000-0000-000000000002',
   '80000000-0000-0000-0000-000000000001', 'Limpiar la piscina (con pasos propios)',
   '["Sólo revisar el filtro"]'::jsonb, true, 0);

-- T3 · Ad-hoc: sin plantilla no hay receta, y crear la tarea no debe fallar.
INSERT INTO public.tareas_bloque (id, bloque_id, plantilla_id, titulo, orden)
VALUES
  ('b1000000-0000-0000-0000-000000000003', '70000000-0000-0000-0000-000000000001',
   NULL, 'Revisar una fuga que vi de paso', 2);

-- T4 · El caso que prueba que el trigger no AFLOJA: la tarea exige comentario y
-- foto, la plantilla P2 no exige nada. Tienen que quedar en true.
INSERT INTO public.tareas_bloque
  (id, bloque_id, plantilla_id, titulo, requiere_foto, requiere_comentario, orden)
VALUES
  ('b1000000-0000-0000-0000-000000000004', '70000000-0000-0000-0000-000000000001',
   '80000000-0000-0000-0000-000000000002', 'Barrer el pasillo', true, true, 3);

-- Un bloque libre para el invariante 7, que inserta COMO un usuario con sólo
-- `turnos`: necesita una plantilla que declare cosas (P1) y un turno donde P1
-- todavía no esté.
INSERT INTO public.bloques_turno
  (id, company_id, project_id, personal_id, fecha, estado) VALUES
  ('70000000-0000-0000-0000-000000000004', 'c0000000-0000-0000-0000-000000000001',
   '11111111-0000-0000-0000-000000000001', '90000000-0000-0000-0000-000000000001',
   '2026-09-12', 'en_curso');

-- ── La ruta de materialización (20260907000300) ─────────────────────────────
-- Se arma completa para comprobar que el trigger NO le cambia el resultado: esa
-- RPC ya escribe el snapshot, así que los COALESCE no deben hacer nada y los OR
-- deben operar sobre valores iguales.
INSERT INTO public.plantillas_horario
  (id, company_id, project_id, nombre, turno, hora_inicio, hora_fin) VALUES
  ('40000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000001',
   '11111111-0000-0000-0000-000000000001', 'Matutino', 'manana', '06:00', '14:00');

INSERT INTO public.rutinas_limpieza
  (id, company_id, project_id, nombre, plantilla_horario_id, activa) VALUES
  ('30000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000001',
   '11111111-0000-0000-0000-000000000001', 'Matutina de piscina',
   '40000000-0000-0000-0000-000000000001', true);

INSERT INTO public.rutina_actividades
  (company_id, project_id, rutina_id, plantilla_tarea_id, orden) VALUES
  ('c0000000-0000-0000-0000-000000000001', '11111111-0000-0000-0000-000000000001',
   '30000000-0000-0000-0000-000000000001', '80000000-0000-0000-0000-000000000001', 0);

INSERT INTO public.bloques_turno
  (id, company_id, project_id, personal_id, plantilla_horario_id, fecha, estado) VALUES
  ('70000000-0000-0000-0000-000000000003', 'c0000000-0000-0000-0000-000000000001',
   '11111111-0000-0000-0000-000000000001', '90000000-0000-0000-0000-000000000001',
   '40000000-0000-0000-0000-000000000001', '2026-09-20', 'pendiente');
