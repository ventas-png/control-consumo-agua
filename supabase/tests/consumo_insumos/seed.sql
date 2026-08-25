-- Semilla POSTERIOR a las migraciones: usa `plantilla_tarea_suministros`
-- (20260904000200) y depende de que el trigger de copia (20260905000500) ya
-- exista, porque crear las tareas es justamente lo que lo dispara.
--
-- Corre como superusuario, así que la RLS no aplica aquí. El aislamiento por
-- permisos se prueba en assert.sql, declarando identidad con `app.uid`.

-- ── La receta ───────────────────────────────────────────────────────────────
-- «Limpiar la piscina» pide tres insumos, y uno de ellos está dado de baja.
INSERT INTO public.plantilla_tarea_suministros
  (company_id, project_id, plantilla_tarea_id, suministro_id, cantidad) VALUES
  ('c0000000-0000-0000-0000-000000000001', '11111111-0000-0000-0000-000000000001',
   '80000000-0000-0000-0000-000000000001', '50000000-0000-0000-0000-000000000001', 2),
  ('c0000000-0000-0000-0000-000000000001', '11111111-0000-0000-0000-000000000001',
   '80000000-0000-0000-0000-000000000001', '50000000-0000-0000-0000-000000000002', 3),
  ('c0000000-0000-0000-0000-000000000001', '11111111-0000-0000-0000-000000000001',
   '80000000-0000-0000-0000-000000000001', '50000000-0000-0000-0000-000000000003', 1);

-- ── Las tareas ──────────────────────────────────────────────────────────────
-- T1 y T2 son la misma receta en bloques distintos: T1 para el camino feliz y
-- la idempotencia, T2 para el «no lo necesité» y el faltante de stock.
INSERT INTO public.bloques_turno
  (id, company_id, project_id, personal_id, fecha, estado) VALUES
  ('70000000-0000-0000-0000-000000000002', 'c0000000-0000-0000-0000-000000000001',
   '11111111-0000-0000-0000-000000000001', '90000000-0000-0000-0000-000000000001',
   '2026-09-11', 'en_curso');

INSERT INTO public.tareas_bloque (id, bloque_id, plantilla_id, titulo, orden) VALUES
  ('a1000000-0000-0000-0000-000000000001', '70000000-0000-0000-0000-000000000001',
   '80000000-0000-0000-0000-000000000001', 'Limpiar la piscina', 0),
  ('a1000000-0000-0000-0000-000000000002', '70000000-0000-0000-0000-000000000002',
   '80000000-0000-0000-0000-000000000001', 'Limpiar la piscina', 0),
  -- Plantilla SIN insumos: cerrarla no debe consumir nada.
  ('a1000000-0000-0000-0000-000000000003', '70000000-0000-0000-0000-000000000001',
   '80000000-0000-0000-0000-000000000002', 'Barrer el pasillo', 1),
  -- Ad-hoc: sin plantilla no hay receta que copiar, y no es un error.
  ('a1000000-0000-0000-0000-000000000004', '70000000-0000-0000-0000-000000000001',
   NULL, 'Revisar una fuga que vi de paso', 2);

-- ── La ruta de materialización (20260905000300) ─────────────────────────────
-- La tercera ruta de alta. Se arma completa para comprobar que el trigger de
-- copia también corre en el INSERT masivo de la RPC, que es donde más filas
-- pasan de golpe.
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

-- Un bloque enganchado a esa jornada, en una fecha que ninguna otra prueba usa.
INSERT INTO public.bloques_turno
  (id, company_id, project_id, personal_id, plantilla_horario_id, fecha, estado) VALUES
  ('70000000-0000-0000-0000-000000000003', 'c0000000-0000-0000-0000-000000000001',
   '11111111-0000-0000-0000-000000000001', '90000000-0000-0000-0000-000000000001',
   '40000000-0000-0000-0000-000000000001', '2026-09-20', 'pendiente');
