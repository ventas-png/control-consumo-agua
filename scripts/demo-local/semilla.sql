-- EMPRESA DEMO para pruebas y manuales (copia local). Datos inventados.
--   Empresa «Prestadora Demo» · condominio «Condominio Demo»
--   Usuarios: admin@demo.local (dueño de la empresa), supervisor@demo.local (Supervisor de limpieza:
--   ver/crear/editar/eliminar en Limpieza) y ana@demo.local (Personal de limpieza: ver/editar en Limpieza).
--   La contraseña llega por -v clave=… (no queda en este archivo).
\set ON_ERROR_STOP on
BEGIN;
CREATE TEMP TABLE ids (k text PRIMARY KEY, id uuid NOT NULL);
INSERT INTO ids VALUES
  ('E','d0000000-0000-4000-8000-00000000000e'), ('P','d1000000-0000-4000-8000-0000000000c1'),
  ('ADM','d2000000-0000-4000-8000-000000000001'), ('SUP','d2000000-0000-4000-8000-000000000002'),
  ('ANA_U','d2000000-0000-4000-8000-000000000003'),
  ('ROL_SUP','d3000000-0000-4000-8000-000000000001'), ('ROL_LIMP','d3000000-0000-4000-8000-000000000002');
CREATE FUNCTION pg_temp.i(k text) RETURNS uuid LANGUAGE sql AS $$ SELECT id FROM ids WHERE ids.k = $1 $$;

INSERT INTO public.companies (id, nombre, max_projects, servicio_agua, servicio_condominios, servicio_rentas)
VALUES (pg_temp.i('E'), 'Prestadora Demo', 5, false, true, false);
INSERT INTO public.projects (id, company_id, nombre, tipo, modulo_agua, modulo_condominios, modulo_rentas)
VALUES (pg_temp.i('P'), pg_temp.i('E'), 'Condominio Demo', 'condominio', false, true, false);

INSERT INTO auth.users (id, email, encrypted_password, email_confirmed_at, created_at, updated_at, aud, role, raw_app_meta_data, raw_user_meta_data)
SELECT pg_temp.i(k), email, extensions.crypt(:'clave', extensions.gen_salt('bf')), now(), now(), now(), 'authenticated', 'authenticated',
       '{"provider":"email","providers":["email"]}', jsonb_build_object('full_name', nombre)
FROM (VALUES ('ADM','admin@demo.local','Admin Demo'), ('SUP','supervisor@demo.local','Sofía Supervisora'),
             ('ANA_U','ana@demo.local','Ana Pérez')) v(k, email, nombre);
INSERT INTO public.app_users (id, full_name, role, company_id) VALUES
  (pg_temp.i('ADM'), 'Admin Empresa Demo', 'company_owner', pg_temp.i('E')),
  (pg_temp.i('SUP'), 'Sofía Supervisora', 'operator', pg_temp.i('E')),
  (pg_temp.i('ANA_U'), 'Ana Pérez', 'operator', pg_temp.i('E'));
INSERT INTO public.user_project_assignments (user_id, project_id, permission_type) VALUES
  (pg_temp.i('ADM'), pg_temp.i('P'), 'total'), (pg_temp.i('SUP'), pg_temp.i('P'), 'total'), (pg_temp.i('ANA_U'), pg_temp.i('P'), 'total');
INSERT INTO public.roles (id, company_id, name, description) VALUES
  (pg_temp.i('ROL_SUP'), pg_temp.i('E'), 'Supervisor de limpieza', 'Arma rutinas, asigna el calendario y atiende novedades'),
  (pg_temp.i('ROL_LIMP'), pg_temp.i('E'), 'Personal de limpieza', 'Ejecuta la ruta del día');
INSERT INTO public.role_permissions (role_id, permission_key, effect)
SELECT pg_temp.i('ROL_SUP'), k, 'allow' FROM unnest(ARRAY['condominios.tab.prog_limpieza', 'condominios.tab.prog_limpieza.create',
  'condominios.tab.prog_limpieza.edit', 'condominios.tab.prog_limpieza.delete']) k
UNION ALL
SELECT pg_temp.i('ROL_LIMP'), k, 'allow' FROM unnest(ARRAY['condominios.tab.prog_limpieza', 'condominios.tab.prog_limpieza.edit']) k;
INSERT INTO public.user_roles (user_id, role_id) VALUES (pg_temp.i('SUP'), pg_temp.i('ROL_SUP')), (pg_temp.i('ANA_U'), pg_temp.i('ROL_LIMP'));

-- ── Operaciones → Áreas ─────────────────────────────────────────────────────
INSERT INTO public.areas_condominio (company_id, project_id, nombre, icono, orden, descripcion)
SELECT pg_temp.i('E'), pg_temp.i('P'), n, ic, o, d FROM (VALUES
  ('Lobby', '🏢', 0, 'Entrada principal y recepción'), ('Pasillo nivel 1', '🚪', 1, NULL), ('Pasillo nivel 2', '🚪', 2, NULL),
  ('Pasillo nivel 3', '🚪', 3, NULL), ('Gradas', '🪜', 4, 'Del sótano al nivel 3'), ('Sótano 1', '🅿️', 5, 'Parqueo de residentes')) v(n, ic, o, d);
CREATE FUNCTION pg_temp.area(n text) RETURNS uuid LANGUAGE sql AS $$ SELECT id FROM public.areas_condominio WHERE nombre = $1 AND project_id = pg_temp.i('P') $$;

-- ── Operaciones → Suministros y Equipos ─────────────────────────────────────
INSERT INTO public.suministros_condominio (company_id, project_id, nombre, categoria, unidad_medida, stock_actual, stock_minimo)
SELECT pg_temp.i('E'), pg_temp.i('P'), n, 'limpieza', u, s, m FROM (VALUES
  ('Desinfectante de pisos', 'litro', 20, 5), ('Limpiavidrios', 'litro', 6, 2), ('Bolsas de basura', 'unidad', 200, 50)) v(n, u, s, m);
INSERT INTO public.equipos_comunes (company_id, project_id, nombre, categoria, estado, cantidad)
SELECT pg_temp.i('E'), pg_temp.i('P'), n, 'limpieza', 'operativo', c FROM (VALUES
  ('Escoba', 3), ('Trapeador', 3), ('Cubeta con escurridor', 2), ('Rótulo de piso mojado', 4), ('Aspiradora', 1)) v(n, c);

-- ── RRHH → Personal ─────────────────────────────────────────────────────────
INSERT INTO public.personal_condominio (company_id, project_id, nombre, cargo, turno, estado, user_id)
VALUES (pg_temp.i('E'), pg_temp.i('P'), 'Ana Pérez', 'conserje', 'diurno', 'activo', pg_temp.i('ANA_U')),
       (pg_temp.i('E'), pg_temp.i('P'), 'Luis Gómez', 'conserje', 'rotativo', 'activo', NULL),
       (pg_temp.i('E'), pg_temp.i('P'), 'Marta Ruiz', 'mantenimiento', 'diurno', 'activo', NULL);
CREATE FUNCTION pg_temp.per(n text) RETURNS uuid LANGUAGE sql AS $$ SELECT id FROM public.personal_condominio WHERE nombre = $1 AND project_id = pg_temp.i('P') $$;

-- ── RRHH → Plantillas: actividades ──────────────────────────────────────────
INSERT INTO public.plantillas_tarea_cargo (company_id, project_id, cargo, servicio, titulo, icono, orden, duracion_estimada_min,
  descripcion, requiere_foto, requiere_checklist, checklist, instrucciones_seguridad, area_id)
VALUES
  (pg_temp.i('E'), pg_temp.i('P'), 'conserje', 'limpieza', 'Barrido de piso', '🧹', 0, 8, 'Desde el punto más lejano hacia la salida.', false, false, '["Mover tapetes","Barrer hacia la salida","Recoger la basura"]', NULL, NULL),
  (pg_temp.i('E'), pg_temp.i('P'), 'conserje', 'limpieza', 'Trapeado de piso', '🪣', 1, 10, 'Trapear con desinfectante diluido, en franjas.', true, false, '[]', 'Colocar el rótulo de piso mojado antes de empezar', NULL),
  (pg_temp.i('E'), pg_temp.i('P'), 'conserje', 'limpieza', 'Limpieza de vidrios', '🪟', 2, 6, NULL, false, true, '["Vidrio interior","Vidrio exterior","Marcos"]', NULL, NULL),
  (pg_temp.i('E'), pg_temp.i('P'), 'conserje', 'limpieza', 'Limpieza de pasamanos', '✋', 3, 4, NULL, false, false, '[]', NULL, NULL),
  (pg_temp.i('E'), pg_temp.i('P'), 'conserje', 'limpieza', 'Vaciar basureros', '🗑️', 4, 3, NULL, false, false, '[]', NULL, NULL),
  (pg_temp.i('E'), pg_temp.i('P'), 'conserje', 'limpieza', 'Aspirado de alfombra', '🌀', 5, 7, NULL, false, false, '[]', NULL, pg_temp.area('Lobby'));
CREATE FUNCTION pg_temp.act(n text) RETURNS uuid LANGUAGE sql AS $$ SELECT id FROM public.plantillas_tarea_cargo WHERE titulo = $1 AND project_id = pg_temp.i('P') $$;
INSERT INTO public.plantilla_tarea_suministros (company_id, project_id, plantilla_tarea_id, suministro_id, cantidad)
SELECT pg_temp.i('E'), pg_temp.i('P'), pg_temp.act(a), s.id, c FROM (VALUES ('Trapeado de piso', 'Desinfectante de pisos', 0.25),
  ('Limpieza de vidrios', 'Limpiavidrios', 0.1), ('Vaciar basureros', 'Bolsas de basura', 2)) v(a, n, c)
JOIN public.suministros_condominio s ON s.nombre = v.n AND s.project_id = pg_temp.i('P');
INSERT INTO public.plantilla_tarea_herramientas (company_id, project_id, plantilla_tarea_id, equipo_id, cantidad, obligatoria)
SELECT pg_temp.i('E'), pg_temp.i('P'), pg_temp.act(a), e.id, 1, o FROM (VALUES ('Barrido de piso', 'Escoba', true),
  ('Trapeado de piso', 'Trapeador', true), ('Trapeado de piso', 'Cubeta con escurridor', true), ('Trapeado de piso', 'Rótulo de piso mojado', true),
  ('Aspirado de alfombra', 'Aspiradora', true)) v(a, n, o)
JOIN public.equipos_comunes e ON e.nombre = v.n AND e.project_id = pg_temp.i('P');

-- ── Asignación turnos → Jornadas (con descansos) y Reglas ──────────────────
INSERT INTO public.plantillas_horario (company_id, project_id, nombre, codigo, turno, hora_inicio, hora_fin, minutos_descanso, color)
VALUES (pg_temp.i('E'), pg_temp.i('P'), 'Diurna', 'D', 'manana', '07:00', '15:00', 60, '#B96A3F'),
       (pg_temp.i('E'), pg_temp.i('P'), 'Tarde', 'T', 'tarde', '14:00', '22:00', 60, '#1B3B36'),
       (pg_temp.i('E'), pg_temp.i('P'), 'Sábado medio día', 'S', 'manana', '07:00', '13:00', 0, '#577B69');
CREATE FUNCTION pg_temp.jor(n text) RETURNS uuid LANGUAGE sql AS $$ SELECT id FROM public.plantillas_horario WHERE nombre = $1 AND project_id = pg_temp.i('P') $$;
INSERT INTO public.plantilla_cupos_pausa (company_id, project_id, plantilla_horario_id, tipo, minutos)
SELECT pg_temp.i('E'), pg_temp.i('P'), pg_temp.jor(j), t, m FROM (VALUES ('Diurna', 'refaccion', 15), ('Diurna', 'almuerzo', 60),
  ('Tarde', 'refaccion', 15), ('Tarde', 'cena', 60), ('Sábado medio día', 'refaccion', 15)) v(j, t, m);
INSERT INTO public.asignaciones_turno (company_id, project_id, personal_id, plantilla_horario_id, frecuencia, dias_semana, fecha_inicio, activa)
VALUES (pg_temp.i('E'), pg_temp.i('P'), pg_temp.per('Ana Pérez'), pg_temp.jor('Diurna'), 'semanal', '[1,2,3,4,5]', '2026-11-01', true),
       (pg_temp.i('E'), pg_temp.i('P'), pg_temp.per('Ana Pérez'), pg_temp.jor('Sábado medio día'), 'semanal', '[6]', '2026-11-01', true),
       (pg_temp.i('E'), pg_temp.i('P'), pg_temp.per('Luis Gómez'), pg_temp.jor('Tarde'), 'semanal', '[1,2,3,4,5]', '2026-11-01', true),
       (pg_temp.i('E'), pg_temp.i('P'), pg_temp.per('Marta Ruiz'), pg_temp.jor('Diurna'), 'semanal', '[1,2,3,4,5]', '2026-11-01', true);

-- ── Limpieza → dos rutinas ya armadas (la tercera se arma por la pantalla) ───
INSERT INTO public.rutinas_limpieza (company_id, project_id, nombre, descripcion, servicio, plantilla_horario_id, orden)
VALUES (pg_temp.i('E'), pg_temp.i('P'), 'Limpieza de Lobby', 'Primera parada del día', 'limpieza', pg_temp.jor('Diurna'), 0),
       (pg_temp.i('E'), pg_temp.i('P'), 'Barrido de Pasillos y Gradas', NULL, 'limpieza', pg_temp.jor('Diurna'), 1);
CREATE FUNCTION pg_temp.parada(r text, a text, o int, VARIADIC acts text[]) RETURNS void LANGUAGE plpgsql AS $$
DECLARE v_r uuid := (SELECT id FROM public.rutinas_limpieza WHERE nombre = r AND project_id = pg_temp.i('P')); v_p uuid := gen_random_uuid(); k int := 0; x text;
BEGIN
  INSERT INTO public.rutina_areas (id, company_id, project_id, rutina_id, area_id, orden) VALUES (v_p, pg_temp.i('E'), pg_temp.i('P'), v_r, pg_temp.area(a), o);
  FOREACH x IN ARRAY acts LOOP
    INSERT INTO public.rutina_actividades (company_id, project_id, rutina_id, rutina_area_id, plantilla_tarea_id, orden, obligatoria)
    VALUES (pg_temp.i('E'), pg_temp.i('P'), v_r, v_p, pg_temp.act(x), k, true);
    k := k + 1;
  END LOOP;
END $$;
SELECT pg_temp.parada('Limpieza de Lobby', 'Lobby', 0, 'Aspirado de alfombra', 'Limpieza de vidrios', 'Vaciar basureros', 'Trapeado de piso');
SELECT pg_temp.parada('Barrido de Pasillos y Gradas', 'Pasillo nivel 1', 0, 'Barrido de piso', 'Vaciar basureros');
SELECT pg_temp.parada('Barrido de Pasillos y Gradas', 'Pasillo nivel 2', 1, 'Barrido de piso', 'Vaciar basureros');
SELECT pg_temp.parada('Barrido de Pasillos y Gradas', 'Pasillo nivel 3', 2, 'Barrido de piso', 'Vaciar basureros');
SELECT pg_temp.parada('Barrido de Pasillos y Gradas', 'Gradas', 3, 'Barrido de piso', 'Limpieza de pasamanos');
COMMIT;
SELECT 'semilla-ok' AS resultado, (SELECT count(*) FROM public.rrhh_cargos WHERE project_id = 'd1000000-0000-4000-8000-0000000000c1') AS cargos_sembrados;
