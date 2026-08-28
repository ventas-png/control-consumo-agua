-- Semilla POSTERIOR a las migraciones (las columnas del snapshot las crea
-- 20260904000200 y rutinas_limpieza la crea 20260907000200). Corre como
-- superusuario: la RLS no aplica aquí.
--
-- DOS COMPAÑÍAS Y DOS PROYECTOS, que es el tablero entero de esta prueba:
--
--   Compañía A (c…01)             Compañía B (c…02)
--     Proyecto A1 (1…01)  ← aquí vive el bloque de Ana
--     Proyecto A2 (1…02)  ← misma compañía, OTRO proyecto
--                                   Proyecto B1 (1…03)
--
-- Cada scope ajeno tiene su plantilla con un snapshot MARCADO (checklist e
-- instrucciones con la palabra SECRETO): si una sola de esas columnas aparece
-- en una tarea de A1 —o en un mensaje de error—, la fuga es visible por grep.

-- ── Los otros dos scopes ────────────────────────────────────────────────────
INSERT INTO public.companies (id) VALUES ('c0000000-0000-0000-0000-000000000002');
INSERT INTO public.projects (id, company_id) VALUES
  -- A2: misma compañía que el bloque, otro proyecto.
  ('11111111-0000-0000-0000-000000000002', 'c0000000-0000-0000-0000-000000000001'),
  -- B1: otra compañía.
  ('11111111-0000-0000-0000-000000000003', 'c0000000-0000-0000-0000-000000000002');

INSERT INTO public.areas_condominio (id, company_id, project_id, nombre) VALUES
  ('60000000-0000-0000-0000-000000000012', 'c0000000-0000-0000-0000-000000000001',
   '11111111-0000-0000-0000-000000000002', 'Gimnasio A2'),
  ('60000000-0000-0000-0000-000000000013', 'c0000000-0000-0000-0000-000000000002',
   '11111111-0000-0000-0000-000000000003', 'Lobby B');

-- ── Plantillas: la del scope con receta completa, las ajenas con el marcador ─
UPDATE public.plantillas_tarea_cargo SET
  duracion_estimada_min   = 25,
  checklist               = '["Quitar hojas", "Medir cloro", "Enjuagar"]'::jsonb,
  instrucciones_seguridad = 'Usar guantes y gafas; no mezclar productos',
  requiere_foto           = true,
  requiere_comentario     = true,
  requiere_checklist      = true
WHERE id = '80000000-0000-0000-0000-000000000001';  -- A1, la legítima

INSERT INTO public.plantillas_tarea_cargo
  (id, company_id, project_id, cargo, titulo, duracion_estimada_min, checklist,
   instrucciones_seguridad, requiere_foto, requiere_comentario, requiere_checklist) VALUES
  ('80000000-0000-0000-0000-000000000012', 'c0000000-0000-0000-0000-000000000001',
   '11111111-0000-0000-0000-000000000002', 'conserje', 'SECRETO-A2 titulo', 99,
   '["SECRETO-A2 paso"]'::jsonb, 'SECRETO-A2 instrucciones', true, true, true),
  ('80000000-0000-0000-0000-000000000013', 'c0000000-0000-0000-0000-000000000002',
   '11111111-0000-0000-0000-000000000003', 'conserje', 'SECRETO-B titulo', 77,
   '["SECRETO-B paso"]'::jsonb, 'SECRETO-B instrucciones', true, true, true);

-- ── Rutinas: una por scope (nombre + tenant bastan; área y jornada, NULL) ───
INSERT INTO public.rutinas_limpieza (id, company_id, project_id, nombre) VALUES
  ('30000000-0000-0000-0000-000000000021', 'c0000000-0000-0000-0000-000000000001',
   '11111111-0000-0000-0000-000000000001', 'Rutina propia A1'),
  ('30000000-0000-0000-0000-000000000022', 'c0000000-0000-0000-0000-000000000001',
   '11111111-0000-0000-0000-000000000002', 'Rutina ajena A2'),
  ('30000000-0000-0000-0000-000000000023', 'c0000000-0000-0000-0000-000000000002',
   '11111111-0000-0000-0000-000000000003', 'Rutina ajena B');

-- ── El tablero de la materialización (la TERCERA ruta de escritura) ─────────
-- La rutina propia se cuelga de una jornada y una actividad, y hay un bloque
-- pendiente de esa jornada: el invariante 10 ejecuta la RPC real
-- (materializar_rutinas_turno) con el guard ya instalado — si el guard
-- estorbara la ruta por la que entran casi todas las tareas, se ve aquí.
INSERT INTO public.plantillas_horario
  (id, company_id, project_id, nombre, turno, hora_inicio, hora_fin) VALUES
  ('40000000-0000-0000-0000-000000000031', 'c0000000-0000-0000-0000-000000000001',
   '11111111-0000-0000-0000-000000000001', 'Matutino scope', 'manana', '06:00', '14:00');

UPDATE public.rutinas_limpieza
   SET plantilla_horario_id = '40000000-0000-0000-0000-000000000031'
 WHERE id = '30000000-0000-0000-0000-000000000021';

INSERT INTO public.rutina_actividades
  (company_id, project_id, rutina_id, plantilla_tarea_id, orden) VALUES
  ('c0000000-0000-0000-0000-000000000001', '11111111-0000-0000-0000-000000000001',
   '30000000-0000-0000-0000-000000000021', '80000000-0000-0000-0000-000000000001', 0);

INSERT INTO public.bloques_turno
  (id, company_id, project_id, personal_id, plantilla_horario_id, fecha, estado) VALUES
  ('70000000-0000-0000-0000-000000000031', 'c0000000-0000-0000-0000-000000000001',
   '11111111-0000-0000-0000-000000000001', '90000000-0000-0000-0000-000000000001',
   '40000000-0000-0000-0000-000000000031', '2026-09-21', 'pendiente');
