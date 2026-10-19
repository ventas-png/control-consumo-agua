-- ============================================================================
-- PADRÓN DE LA SUITE «limpieza_calendario» (20261103000000)
--
-- Se carga sobre la cadena REAL de migraciones: lo que se prueba son las RPC
-- contra las tablas, triggers y policies que de verdad tiene el repositorio.
--
-- Dos empresas: D (la del calendario) y C (la vecina, con los MISMOS permisos).
-- Dos proyectos en D (D1, D2): el cruce entre condominios de la misma empresa
-- es el que la empresa sola no ve.
--
-- Personas (todas «operator», ninguna exenta de proyecto):
--   EDI   Limpieza con EDICIÓN, asignado a D1
--   VER   Limpieza SOLO VER, asignado a D1
--   SINP  sin el tab de Limpieza, asignado a D1
--   EDD2  Limpieza con edición, asignado SÓLO a D2
--   EDC   Limpieza con edición en la empresa C (asignado a C1)
--
-- Catálogo de D1:
--   áreas       A1 «Apartamento 1AB», A2 «Apartamento 1C», A3 «Bodega» (INACTIVA)
--   actividades BARRER (5 min, sin área), VIDRIOS (2 min), TRAPEAR (INACTIVA)
--   rutinas     R1 «Niveles»   A1: BARRER, VIDRIOS · A2: BARRER · A3: BARRER
--               R2 «Sótanos»   A2: VIDRIOS
--               R3 «Repaso»    A1: BARRER                (choca con R1)
--               RVACIA         A1: TRAPEAR               (nada activo)
--               RINACT         A1: BARRER, rutina INACTIVA
--   y RD2 en D2.
--   personal    P1 «Ana Pérez» (conserje, activa) y P3 en D2
--   jornada     H1 «Mañana» (07:00–15:00, código MA)
--   turnos      BF  hoy+5 · BF2 hoy+6 · BP hoy-3 (pasado) · BC hoy+7 (cerrado)
--               BF3 hoy+8
--               BD2 hoy+5 en D2
-- Las fechas van RELATIVAS a hoy: la suite tiene que seguir valiendo dentro de
-- un año, y el margen de días cubre la diferencia entre UTC y la zona de la
-- empresa.
--
-- Todo lo de la prueba vive en el esquema «lc»: no toca el catálogo de public.
-- ============================================================================
\set ON_ERROR_STOP on

CREATE SCHEMA lc;
GRANT USAGE ON SCHEMA lc TO PUBLIC;

CREATE TABLE lc.ids (alias text PRIMARY KEY, id uuid NOT NULL UNIQUE);
GRANT SELECT ON lc.ids TO PUBLIC;

CREATE FUNCTION lc.id(p_alias text) RETURNS uuid LANGUAGE sql STABLE AS
$$ SELECT id FROM lc.ids WHERE alias = p_alias $$;
GRANT EXECUTE ON FUNCTION lc.id(text) TO PUBLIC;

INSERT INTO lc.ids (alias, id) VALUES
  ('C',       'e0000000-0000-0000-0000-00000000000c'),
  ('D',       'e0000000-0000-0000-0000-00000000000d'),
  ('C1',      'e1000000-0000-0000-0000-0000000000c1'),
  ('D1',      'e1000000-0000-0000-0000-0000000000d1'),
  ('D2',      'e1000000-0000-0000-0000-0000000000d2'),
  ('EDI',     'e2000000-0000-0000-0000-000000000001'),
  ('VER',     'e2000000-0000-0000-0000-000000000002'),
  ('SINP',    'e2000000-0000-0000-0000-000000000003'),
  ('EDD2',    'e2000000-0000-0000-0000-000000000004'),
  ('EDC',     'e2000000-0000-0000-0000-000000000005'),
  ('ROL_ED',  'e3000000-0000-0000-0000-000000000001'),
  ('ROL_VER', 'e3000000-0000-0000-0000-000000000002'),
  ('ROL_C',   'e3000000-0000-0000-0000-00000000000c'),
  ('A1',      'e4000000-0000-0000-0000-000000000001'),
  ('A2',      'e4000000-0000-0000-0000-000000000002'),
  ('A3',      'e4000000-0000-0000-0000-000000000003'),
  ('BARRER',  'e5000000-0000-0000-0000-000000000001'),
  ('VIDRIOS', 'e5000000-0000-0000-0000-000000000002'),
  ('TRAPEAR', 'e5000000-0000-0000-0000-000000000003'),
  ('PX',      'e5000000-0000-0000-0000-0000000000d2'),
  ('R1',      'e6000000-0000-0000-0000-000000000001'),
  ('R2',      'e6000000-0000-0000-0000-000000000002'),
  ('R3',      'e6000000-0000-0000-0000-000000000003'),
  ('RVACIA',  'e6000000-0000-0000-0000-000000000004'),
  ('RINACT',  'e6000000-0000-0000-0000-000000000005'),
  ('RD2',     'e6000000-0000-0000-0000-0000000000d2'),
  ('H1',      'e7000000-0000-0000-0000-000000000001'),
  ('P1',      'e8000000-0000-0000-0000-000000000001'),
  ('P3',      'e8000000-0000-0000-0000-0000000000d2'),
  ('BF',      'e9000000-0000-0000-0000-000000000001'),
  ('BF2',     'e9000000-0000-0000-0000-000000000002'),
  ('BP',      'e9000000-0000-0000-0000-000000000003'),
  ('BC',      'e9000000-0000-0000-0000-000000000004'),
  ('BF3',     'e9000000-0000-0000-0000-000000000005'),
  ('BD2',     'e9000000-0000-0000-0000-0000000000d2');

-- ── empresas y proyectos (los triggers de alta siembran sus catálogos) ──────
INSERT INTO public.companies (id, nombre, max_projects) VALUES
  (lc.id('C'), 'Empresa C (vecina)', 5),
  (lc.id('D'), 'Empresa D', 5);

INSERT INTO public.projects (id, company_id, nombre, tipo) VALUES
  (lc.id('C1'), lc.id('C'), 'C1', 'condominio'),
  (lc.id('D1'), lc.id('D'), 'D1', 'condominio'),
  (lc.id('D2'), lc.id('D'), 'D2', 'condominio');

-- ── personas y RBAC ──────────────────────────────────────────────────────────
INSERT INTO auth.users (id, email) VALUES
  (lc.id('EDI'),  'edi@lc.test'),
  (lc.id('VER'),  'ver@lc.test'),
  (lc.id('SINP'), 'sinp@lc.test'),
  (lc.id('EDD2'), 'edd2@lc.test'),
  (lc.id('EDC'),  'edc@lc.test');

INSERT INTO public.app_users (id, full_name, role, company_id) VALUES
  (lc.id('EDI'),  'Edita limpieza D', 'operator', lc.id('D')),
  (lc.id('VER'),  'Ve limpieza D',    'operator', lc.id('D')),
  (lc.id('SINP'), 'Sin limpieza D',   'operator', lc.id('D')),
  (lc.id('EDD2'), 'Edita sólo D2',    'operator', lc.id('D')),
  (lc.id('EDC'),  'Edita limpieza C', 'operator', lc.id('C'));

INSERT INTO public.user_project_assignments (user_id, project_id, permission_type) VALUES
  (lc.id('EDI'),  lc.id('D1'), 'total'),
  (lc.id('VER'),  lc.id('D1'), 'total'),
  (lc.id('SINP'), lc.id('D1'), 'total'),
  (lc.id('EDD2'), lc.id('D2'), 'total'),
  (lc.id('EDC'),  lc.id('C1'), 'total');

INSERT INTO public.permissions (key, category, label) VALUES
  ('condominios.tab.prog_limpieza',      'recursos_humanos', 'Programación de limpieza'),
  ('condominios.tab.prog_limpieza.edit', 'recursos_humanos', 'Programación de limpieza · editar')
ON CONFLICT (key) DO NOTHING;

INSERT INTO public.roles (id, company_id, name) VALUES
  (lc.id('ROL_ED'),  lc.id('D'), 'Limpieza edita D'),
  (lc.id('ROL_VER'), lc.id('D'), 'Limpieza ve D'),
  (lc.id('ROL_C'),   lc.id('C'), 'Limpieza edita C');
INSERT INTO public.role_permissions (role_id, permission_key, effect) VALUES
  (lc.id('ROL_ED'),  'condominios.tab.prog_limpieza',      'allow'),
  (lc.id('ROL_ED'),  'condominios.tab.prog_limpieza.edit', 'allow'),
  (lc.id('ROL_VER'), 'condominios.tab.prog_limpieza',      'allow'),
  (lc.id('ROL_C'),   'condominios.tab.prog_limpieza',      'allow'),
  (lc.id('ROL_C'),   'condominios.tab.prog_limpieza.edit', 'allow');
INSERT INTO public.user_roles (user_id, role_id) VALUES
  (lc.id('EDI'),  lc.id('ROL_ED')),
  (lc.id('EDD2'), lc.id('ROL_ED')),
  (lc.id('VER'),  lc.id('ROL_VER')),
  (lc.id('EDC'),  lc.id('ROL_C'));

-- ── catálogo ─────────────────────────────────────────────────────────────────
INSERT INTO public.areas_condominio (id, company_id, project_id, nombre, icono, orden, activo) VALUES
  (lc.id('A1'), lc.id('D'), lc.id('D1'), 'Apartamento 1AB', '🚪', 0, true),
  (lc.id('A2'), lc.id('D'), lc.id('D1'), 'Apartamento 1C',  '🚪', 1, true),
  (lc.id('A3'), lc.id('D'), lc.id('D1'), 'Bodega',          '📦', 2, false);

INSERT INTO public.plantillas_tarea_cargo
  (id, company_id, project_id, cargo, titulo, servicio, area_id, duracion_estimada_min, activo) VALUES
  (lc.id('BARRER'),  lc.id('D'), lc.id('D1'), 'conserje', 'Barrido de piso',     'limpieza', NULL, 5, true),
  (lc.id('VIDRIOS'), lc.id('D'), lc.id('D1'), 'conserje', 'Limpieza de vidrios', 'limpieza', NULL, 2, true),
  (lc.id('TRAPEAR'), lc.id('D'), lc.id('D1'), 'conserje', 'Trapeado',            'limpieza', NULL, 8, false),
  (lc.id('PX'),      lc.id('D'), lc.id('D2'), 'conserje', 'Actividad de D2',     'limpieza', NULL, 3, true);

INSERT INTO public.rutinas_limpieza (id, company_id, project_id, nombre, servicio, activa, orden) VALUES
  (lc.id('R1'),     lc.id('D'), lc.id('D1'), 'Niveles',  'limpieza', true,  0),
  (lc.id('R2'),     lc.id('D'), lc.id('D1'), 'Sótanos',  'limpieza', true,  1),
  (lc.id('R3'),     lc.id('D'), lc.id('D1'), 'Repaso',   'limpieza', true,  2),
  (lc.id('RVACIA'), lc.id('D'), lc.id('D1'), 'Vacía',    'limpieza', true,  3),
  (lc.id('RINACT'), lc.id('D'), lc.id('D1'), 'Inactiva', 'limpieza', false, 4),
  (lc.id('RD2'),    lc.id('D'), lc.id('D2'), 'De D2',    'limpieza', true,  0);

-- Recorridos: (rutina, área, orden de la parada) y sus pasos. El trigger
-- rutina_area_coherente sella el tenant de cada parada desde su rutina.
CREATE FUNCTION lc.parada(p_rutina text, p_area text, p_orden int, VARIADIC p_pasos text[])
RETURNS void LANGUAGE plpgsql AS $$
DECLARE
  v_parada uuid := gen_random_uuid();
  v_r      public.rutinas_limpieza%ROWTYPE;
  k        int := 0;
  paso     text;
BEGIN
  SELECT * INTO v_r FROM public.rutinas_limpieza WHERE id = lc.id(p_rutina);
  INSERT INTO public.rutina_areas (id, company_id, project_id, rutina_id, area_id, orden)
  VALUES (v_parada, v_r.company_id, v_r.project_id, v_r.id, lc.id(p_area), p_orden);
  FOREACH paso IN ARRAY p_pasos LOOP
    INSERT INTO public.rutina_actividades
      (company_id, project_id, rutina_id, rutina_area_id, plantilla_tarea_id, orden, obligatoria)
    VALUES (v_r.company_id, v_r.project_id, v_r.id, v_parada, lc.id(paso), k, true);
    k := k + 1;
  END LOOP;
END;
$$;

SELECT lc.parada('R1', 'A1', 0, 'BARRER', 'VIDRIOS');
SELECT lc.parada('R1', 'A2', 1, 'BARRER');
SELECT lc.parada('R1', 'A3', 2, 'BARRER');          -- área inactiva: no genera
SELECT lc.parada('R2', 'A2', 5, 'VIDRIOS');          -- orden alto a propósito: sólo el orden PEDIDO la pone primero
SELECT lc.parada('R3', 'A1', 0, 'BARRER');
SELECT lc.parada('RVACIA', 'A1', 0, 'TRAPEAR');
SELECT lc.parada('RINACT', 'A1', 0, 'BARRER');

-- ── turnos: una jornada, una persona, seis días ──────────────────────────────
INSERT INTO public.plantillas_horario (id, company_id, project_id, nombre, codigo, hora_inicio, hora_fin) VALUES
  (lc.id('H1'), lc.id('D'), lc.id('D1'), 'Mañana', 'MA', '07:00', '15:00');

INSERT INTO public.personal_condominio (id, company_id, project_id, nombre, cargo, salario) VALUES
  (lc.id('P1'), lc.id('D'), lc.id('D1'), 'Ana Pérez', 'conserje', 4321),
  (lc.id('P3'), lc.id('D'), lc.id('D2'), 'Persona de D2', 'conserje', NULL);

INSERT INTO public.bloques_turno (id, company_id, project_id, personal_id, turno, fecha, plantilla_horario_id) VALUES
  (lc.id('BF'),  lc.id('D'), lc.id('D1'), lc.id('P1'), 'manana', CURRENT_DATE + 5, lc.id('H1')),
  (lc.id('BF2'), lc.id('D'), lc.id('D1'), lc.id('P1'), 'manana', CURRENT_DATE + 6, lc.id('H1')),
  (lc.id('BP'),  lc.id('D'), lc.id('D1'), lc.id('P1'), 'manana', CURRENT_DATE - 3, lc.id('H1')),
  (lc.id('BC'),  lc.id('D'), lc.id('D1'), lc.id('P1'), 'manana', CURRENT_DATE + 7, lc.id('H1')),
  (lc.id('BF3'), lc.id('D'), lc.id('D1'), lc.id('P1'), 'manana', CURRENT_DATE + 8, lc.id('H1')),
  (lc.id('BD2'), lc.id('D'), lc.id('D2'), lc.id('P3'), 'manana', CURRENT_DATE + 5, NULL);
UPDATE public.bloques_turno SET estado = 'completado', cerrado_en = now() WHERE id = lc.id('BC');

-- ── utilidades de la suite ───────────────────────────────────────────────────
-- chk: igualdad con mensaje; un fallo aborta la corrida (ON_ERROR_STOP).
CREATE FUNCTION lc.chk(p_real anyelement, p_esperado anyelement, p_etiqueta text)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF p_real IS DISTINCT FROM p_esperado THEN
    RAISE EXCEPTION 'FALLA %: se obtuvo «%», se esperaba «%»', p_etiqueta, p_real, p_esperado;
  END IF;
  RAISE NOTICE 'OK    %', p_etiqueta;
END;
$$;
GRANT EXECUTE ON FUNCTION lc.chk(anyelement, anyelement, text) TO PUBLIC;

-- error: ejecuta p_sql en una subtransacción y exige ESE sqlstate (y, con
-- p_contiene, que el mensaje lo nombre). Un rechazo por el motivo equivocado no
-- prueba la regla.
CREATE FUNCTION lc.error(p_sql text, p_sqlstate text, p_etiqueta text, p_contiene text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  BEGIN
    EXECUTE p_sql;
  EXCEPTION WHEN OTHERS THEN
    IF SQLSTATE = p_sqlstate AND (p_contiene IS NULL OR strpos(SQLERRM, p_contiene) > 0) THEN
      RAISE NOTICE 'OK    % (% · %)', p_etiqueta, SQLSTATE, left(SQLERRM, 90);
      RETURN;
    END IF;
    RAISE EXCEPTION 'FALLA %: se esperaba % y llegó % (%)', p_etiqueta, p_sqlstate, SQLSTATE, SQLERRM;
  END;
  RAISE EXCEPTION 'FALLA %: se esperaba el error % y la sentencia pasó', p_etiqueta, p_sqlstate;
END;
$$;
GRANT EXECUTE ON FUNCTION lc.error(text, text, text, text) TO PUBLIC;

-- Sesión de API de una persona: lo que PostgREST fija antes de cada petición.
CREATE FUNCTION lc.como(p_alias text) RETURNS void LANGUAGE sql AS $$
  SELECT set_config('request.jwt.claim.sub', lc.id(p_alias)::text, false),
         set_config('request.jwt.claims',
                    json_build_object('sub', lc.id(p_alias), 'role', 'authenticated')::text, false);
$$;
GRANT EXECUTE ON FUNCTION lc.como(text) TO PUBLIC;

-- Las tareas de un turno, legibles: «rutina:actividad@área» en su orden.
CREATE FUNCTION lc.tareas(p_bloque text) RETURNS text LANGUAGE sql STABLE AS $$
  SELECT COALESCE(string_agg(
           COALESCE(r.nombre, '-') || ':' || t.titulo || '@' || COALESCE(a.nombre, '-'),
           ', ' ORDER BY t.orden), '')
  FROM public.tareas_bloque t
  LEFT JOIN public.rutinas_limpieza r ON r.id = t.rutina_id
  LEFT JOIN public.areas_condominio a ON a.id = t.area_id
  WHERE t.bloque_id = lc.id(p_bloque)
$$;
GRANT EXECUTE ON FUNCTION lc.tareas(text) TO PUBLIC;
