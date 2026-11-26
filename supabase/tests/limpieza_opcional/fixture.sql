-- ============================================================================
-- PADRÓN DE LA SUITE «limpieza_opcional» (20261225000100)
--
-- Se carga sobre la cadena REAL de migraciones: lo que se prueba son las RPC
-- contra las tablas, triggers y policies que de verdad tiene el repositorio.
--
-- Una empresa (D), un condominio (D1), una persona que edita la Limpieza (EDI).
--
-- Catálogo de D1:
--   áreas       A1 «Apartamento 1AB», A2 «Apartamento 1C»
--   actividades BARRER, VIDRIOS, REPASO (activas, sin área propia)
--   rutinas (sin jornada; se asignan desde el calendario):
--     RO «Opcional»      A1: BARRER (oblig.), VIDRIOS (OPCIONAL) · A2: REPASO (OPCIONAL)
--     RX «Exige vidrios» A1: VIDRIOS (oblig.)        → choca con el VIDRIOS@A1 opcional de RO
--     RY «Vidrios a gusto» A1: VIDRIOS (OPCIONAL)    → choca y también es opcional
--     RL «Legado»        área A1 en la cabecera; paso legado VIDRIOS (OPCIONAL) y
--                        parada A1: VIDRIOS (oblig.) → los dos caen en la misma tarea
--     RZ «Vidrios en 1C» A2: VIDRIOS (oblig.)        → misma actividad que RO, OTRA área
--   rutinas con jornada H2 (las toma materializar_rutinas_turno):
--     RM  «Mañana A»     A1: BARRER (oblig.) · A2: VIDRIOS (OPCIONAL), REPASO (OPCIONAL)
--     RM2 «Mañana B»     A2: REPASO (oblig.)       → choca con el REPASO@A2 opcional de RM
--   personal    P1 «Ana Pérez»
--   jornadas    H1 «Mañana» (calendario) · H2 «Tarde» (materializar)
--   turnos      B1 hoy+5 · B2 hoy+6 · B3 hoy+7 · B4 hoy+8 · B5 hoy+10 · B6 hoy+11 (H1)
--               BM hoy+9 (H2) · BP hoy-2 (H1, pasado: sus tareas van a mano)
-- Las fechas van RELATIVAS a hoy, con margen para la diferencia entre UTC y la
-- zona de la empresa.
--
-- Todo lo de la prueba vive en el esquema «lo»: no toca el catálogo de public.
-- ============================================================================
\set ON_ERROR_STOP on

CREATE SCHEMA lo;
GRANT USAGE ON SCHEMA lo TO PUBLIC;

CREATE TABLE lo.ids (alias text PRIMARY KEY, id uuid NOT NULL UNIQUE);
GRANT SELECT ON lo.ids TO PUBLIC;

CREATE FUNCTION lo.id(p_alias text) RETURNS uuid LANGUAGE sql STABLE AS
$$ SELECT id FROM lo.ids WHERE alias = p_alias $$;
GRANT EXECUTE ON FUNCTION lo.id(text) TO PUBLIC;

INSERT INTO lo.ids (alias, id) VALUES
  ('D',       'f0000000-0000-0000-0000-00000000000d'),
  ('D1',      'f1000000-0000-0000-0000-0000000000d1'),
  ('EDI',     'f2000000-0000-0000-0000-000000000001'),
  ('ROL_ED',  'f3000000-0000-0000-0000-000000000001'),
  ('A1',      'f4000000-0000-0000-0000-000000000001'),
  ('A2',      'f4000000-0000-0000-0000-000000000002'),
  ('BARRER',  'f5000000-0000-0000-0000-000000000001'),
  ('VIDRIOS', 'f5000000-0000-0000-0000-000000000002'),
  ('REPASO',  'f5000000-0000-0000-0000-000000000003'),
  ('RO',      'f6000000-0000-0000-0000-000000000001'),
  ('RX',      'f6000000-0000-0000-0000-000000000002'),
  ('RY',      'f6000000-0000-0000-0000-000000000003'),
  ('RL',      'f6000000-0000-0000-0000-000000000004'),
  ('RZ',      'f6000000-0000-0000-0000-000000000007'),
  ('RM',      'f6000000-0000-0000-0000-000000000005'),
  ('RM2',     'f6000000-0000-0000-0000-000000000006'),
  ('H1',      'f7000000-0000-0000-0000-000000000001'),
  ('H2',      'f7000000-0000-0000-0000-000000000002'),
  ('P1',      'f8000000-0000-0000-0000-000000000001'),
  ('B1',      'f9000000-0000-0000-0000-000000000001'),
  ('B2',      'f9000000-0000-0000-0000-000000000002'),
  ('B3',      'f9000000-0000-0000-0000-000000000003'),
  ('B4',      'f9000000-0000-0000-0000-000000000004'),
  ('B5',      'f9000000-0000-0000-0000-000000000005'),
  ('B6',      'f9000000-0000-0000-0000-000000000006'),
  ('BM',      'f9000000-0000-0000-0000-000000000009'),
  ('BP',      'f9000000-0000-0000-0000-0000000000ff');

-- ── empresa, proyecto y la persona que programa ──────────────────────────────
INSERT INTO public.companies (id, nombre, max_projects) VALUES (lo.id('D'), 'Empresa D', 5);
INSERT INTO public.projects (id, company_id, nombre, tipo) VALUES (lo.id('D1'), lo.id('D'), 'D1', 'condominio');

INSERT INTO auth.users (id, email) VALUES (lo.id('EDI'), 'edi@lo.test');
INSERT INTO public.app_users (id, full_name, role, company_id) VALUES
  (lo.id('EDI'), 'Edita limpieza D', 'operator', lo.id('D'));
INSERT INTO public.user_project_assignments (user_id, project_id, permission_type) VALUES
  (lo.id('EDI'), lo.id('D1'), 'total');

INSERT INTO public.permissions (key, category, label) VALUES
  ('condominios.tab.prog_limpieza',      'recursos_humanos', 'Programación de limpieza'),
  ('condominios.tab.prog_limpieza.edit', 'recursos_humanos', 'Programación de limpieza · editar')
ON CONFLICT (key) DO NOTHING;
INSERT INTO public.roles (id, company_id, name) VALUES (lo.id('ROL_ED'), lo.id('D'), 'Limpieza edita D');
INSERT INTO public.role_permissions (role_id, permission_key, effect) VALUES
  (lo.id('ROL_ED'), 'condominios.tab.prog_limpieza',      'allow'),
  (lo.id('ROL_ED'), 'condominios.tab.prog_limpieza.edit', 'allow');
INSERT INTO public.user_roles (user_id, role_id) VALUES (lo.id('EDI'), lo.id('ROL_ED'));

-- ── catálogo ─────────────────────────────────────────────────────────────────
INSERT INTO public.areas_condominio (id, company_id, project_id, nombre, icono, orden, activo) VALUES
  (lo.id('A1'), lo.id('D'), lo.id('D1'), 'Apartamento 1AB', '🚪', 0, true),
  (lo.id('A2'), lo.id('D'), lo.id('D1'), 'Apartamento 1C',  '🚪', 1, true);

INSERT INTO public.plantillas_tarea_cargo
  (id, company_id, project_id, cargo, titulo, servicio, area_id, duracion_estimada_min, activo) VALUES
  (lo.id('BARRER'),  lo.id('D'), lo.id('D1'), 'conserje', 'Barrido de piso',     'limpieza', NULL, 5, true),
  (lo.id('VIDRIOS'), lo.id('D'), lo.id('D1'), 'conserje', 'Limpieza de vidrios', 'limpieza', NULL, 2, true),
  (lo.id('REPASO'),  lo.id('D'), lo.id('D1'), 'conserje', 'Repaso de manijas',   'limpieza', NULL, 3, true);

INSERT INTO public.plantillas_horario (id, company_id, project_id, nombre, codigo, hora_inicio, hora_fin) VALUES
  (lo.id('H1'), lo.id('D'), lo.id('D1'), 'Mañana', 'MA', '07:00', '15:00'),
  (lo.id('H2'), lo.id('D'), lo.id('D1'), 'Tarde',  'TA', '15:00', '22:00');

INSERT INTO public.rutinas_limpieza (id, company_id, project_id, nombre, servicio, area_id, plantilla_horario_id, activa, orden) VALUES
  (lo.id('RO'),  lo.id('D'), lo.id('D1'), 'Opcional',        'limpieza', NULL,         NULL,         true, 0),
  (lo.id('RX'),  lo.id('D'), lo.id('D1'), 'Exige vidrios',   'limpieza', NULL,         NULL,         true, 1),
  (lo.id('RY'),  lo.id('D'), lo.id('D1'), 'Vidrios a gusto', 'limpieza', NULL,         NULL,         true, 2),
  (lo.id('RL'),  lo.id('D'), lo.id('D1'), 'Legado',          'limpieza', lo.id('A1'),  NULL,         true, 3),
  (lo.id('RZ'),  lo.id('D'), lo.id('D1'), 'Vidrios en 1C',   'limpieza', NULL,         NULL,         true, 6),
  (lo.id('RM'),  lo.id('D'), lo.id('D1'), 'Mañana A',        'limpieza', NULL,         lo.id('H2'),  true, 4),
  (lo.id('RM2'), lo.id('D'), lo.id('D1'), 'Mañana B',        'limpieza', NULL,         lo.id('H2'),  true, 5);

-- Una parada (rutina, área, orden) con sus pasos «ACTIVIDAD» (obligatorio) o
-- «ACTIVIDAD?» (opcional). El trigger rutina_area_coherente sella el tenant.
CREATE FUNCTION lo.parada(p_rutina text, p_area text, p_orden int, VARIADIC p_pasos text[])
RETURNS void LANGUAGE plpgsql AS $$
DECLARE
  v_parada uuid := gen_random_uuid();
  v_r      public.rutinas_limpieza%ROWTYPE;
  k        int := 0;
  paso     text;
BEGIN
  SELECT * INTO v_r FROM public.rutinas_limpieza WHERE id = lo.id(p_rutina);
  INSERT INTO public.rutina_areas (id, company_id, project_id, rutina_id, area_id, orden)
  VALUES (v_parada, v_r.company_id, v_r.project_id, v_r.id, lo.id(p_area), p_orden);
  FOREACH paso IN ARRAY p_pasos LOOP
    INSERT INTO public.rutina_actividades
      (company_id, project_id, rutina_id, rutina_area_id, plantilla_tarea_id, orden, obligatoria)
    VALUES (v_r.company_id, v_r.project_id, v_r.id, v_parada, lo.id(rtrim(paso, '?')), k, right(paso, 1) <> '?');
    k := k + 1;
  END LOOP;
END;
$$;

SELECT lo.parada('RO',  'A1', 0, 'BARRER', 'VIDRIOS?');
SELECT lo.parada('RO',  'A2', 1, 'REPASO?');
SELECT lo.parada('RX',  'A1', 0, 'VIDRIOS');
SELECT lo.parada('RY',  'A1', 0, 'VIDRIOS?');
SELECT lo.parada('RL',  'A1', 0, 'VIDRIOS');
SELECT lo.parada('RZ',  'A2', 0, 'VIDRIOS');
SELECT lo.parada('RM',  'A1', 0, 'BARRER');
SELECT lo.parada('RM',  'A2', 1, 'VIDRIOS?', 'REPASO?');
SELECT lo.parada('RM2', 'A2', 0, 'REPASO');

-- El paso legado de RL (sin parada): su área es la de la cabecera (A1), así que
-- cae en la MISMA tarea que su parada A1. Opcional a propósito: es el que el
-- recorrido pone primero (pasos legados → paradas).
INSERT INTO public.rutina_actividades
  (company_id, project_id, rutina_id, rutina_area_id, plantilla_tarea_id, orden, obligatoria)
VALUES (lo.id('D'), lo.id('D1'), lo.id('RL'), NULL, lo.id('VIDRIOS'), 0, false);

-- ── turnos ───────────────────────────────────────────────────────────────────
INSERT INTO public.personal_condominio (id, company_id, project_id, nombre, cargo) VALUES
  (lo.id('P1'), lo.id('D'), lo.id('D1'), 'Ana Pérez', 'conserje');

INSERT INTO public.bloques_turno (id, company_id, project_id, personal_id, turno, fecha, plantilla_horario_id) VALUES
  (lo.id('B1'), lo.id('D'), lo.id('D1'), lo.id('P1'), 'manana', CURRENT_DATE + 5,  lo.id('H1')),
  (lo.id('B2'), lo.id('D'), lo.id('D1'), lo.id('P1'), 'manana', CURRENT_DATE + 6,  lo.id('H1')),
  (lo.id('B3'), lo.id('D'), lo.id('D1'), lo.id('P1'), 'manana', CURRENT_DATE + 7,  lo.id('H1')),
  (lo.id('B4'), lo.id('D'), lo.id('D1'), lo.id('P1'), 'manana', CURRENT_DATE + 8,  lo.id('H1')),
  (lo.id('B5'), lo.id('D'), lo.id('D1'), lo.id('P1'), 'manana', CURRENT_DATE + 10, lo.id('H1')),
  (lo.id('B6'), lo.id('D'), lo.id('D1'), lo.id('P1'), 'manana', CURRENT_DATE + 11, lo.id('H1')),
  (lo.id('BM'), lo.id('D'), lo.id('D1'), lo.id('P1'), 'tarde',  CURRENT_DATE + 9,  lo.id('H2')),
  (lo.id('BP'), lo.id('D'), lo.id('D1'), lo.id('P1'), 'manana', CURRENT_DATE - 2,  lo.id('H1'));

-- ── utilidades de la suite ───────────────────────────────────────────────────
CREATE FUNCTION lo.chk(p_real anyelement, p_esperado anyelement, p_etiqueta text)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF p_real IS DISTINCT FROM p_esperado THEN
    RAISE EXCEPTION 'FALLA %: se obtuvo «%», se esperaba «%»', p_etiqueta, p_real, p_esperado;
  END IF;
  RAISE NOTICE 'OK    %', p_etiqueta;
END;
$$;
GRANT EXECUTE ON FUNCTION lo.chk(anyelement, anyelement, text) TO PUBLIC;

CREATE FUNCTION lo.error(p_sql text, p_sqlstate text, p_etiqueta text)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  BEGIN
    EXECUTE p_sql;
  EXCEPTION WHEN OTHERS THEN
    IF SQLSTATE = p_sqlstate THEN
      RAISE NOTICE 'OK    % (% · %)', p_etiqueta, SQLSTATE, left(SQLERRM, 90);
      RETURN;
    END IF;
    RAISE EXCEPTION 'FALLA %: se esperaba % y llegó % (%)', p_etiqueta, p_sqlstate, SQLSTATE, SQLERRM;
  END;
  RAISE EXCEPTION 'FALLA %: se esperaba el error % y la sentencia pasó', p_etiqueta, p_sqlstate;
END;
$$;
GRANT EXECUTE ON FUNCTION lo.error(text, text, text) TO PUBLIC;

-- Sesión de API: lo que PostgREST fija antes de cada petición.
CREATE FUNCTION lo.como(p_alias text) RETURNS void LANGUAGE sql AS $$
  SELECT set_config('request.jwt.claim.sub', lo.id(p_alias)::text, false),
         set_config('request.jwt.claims',
                    json_build_object('sub', lo.id(p_alias), 'role', 'authenticated')::text, false);
$$;
GRANT EXECUTE ON FUNCTION lo.como(text) TO PUBLIC;

-- Las tareas de un turno, legibles: «actividad@área:o|x» (o = obligatoria,
-- x = opcional) en su orden.
CREATE FUNCTION lo.tareas(p_bloque text) RETURNS text LANGUAGE sql STABLE AS $$
  SELECT COALESCE(string_agg(
           t.titulo || '@' || COALESCE(a.nombre, '-') || ':' || CASE WHEN t.obligatoria THEN 'o' ELSE 'x' END,
           ', ' ORDER BY t.orden), '')
  FROM public.tareas_bloque t
  LEFT JOIN public.areas_condominio a ON a.id = t.area_id
  WHERE t.bloque_id = lo.id(p_bloque)
$$;
GRANT EXECUTE ON FUNCTION lo.tareas(text) TO PUBLIC;

-- Las cifras de UNA rutina en UN turno, tal como las lee el calendario.
CREATE FUNCTION lo.cifras(p_bloque text, p_rutina text) RETURNS text LANGUAGE sql STABLE AS $$
  SELECT format('tareas=%s pendientes=%s hechas=%s opcionales_sin_hacer=%s',
                r->>'tareas', r->>'pendientes', r->>'hechas', r->>'opcionales_sin_hacer')
  FROM public.limpieza_calendario(lo.id('D1'), CURRENT_DATE - 5, CURRENT_DATE + 15) c,
       jsonb_array_elements(c.rutinas) r
  WHERE c.bloque_id = lo.id(p_bloque) AND r->>'rutina_id' = lo.id(p_rutina)::text
$$;
GRANT EXECUTE ON FUNCTION lo.cifras(text, text) TO PUBLIC;
