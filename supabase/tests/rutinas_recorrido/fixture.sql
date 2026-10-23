-- ============================================================================
-- PADRÓN DE LA SUITE «rutinas_recorrido» (20261102000000)
--
-- Se carga sobre la cadena REAL de migraciones (no sobre un esquema copiado a
-- mano): lo que se prueba es la migración contra las tablas, triggers y
-- policies que de verdad tiene el repositorio.
--
-- Dos empresas: D (la del recorrido) y C (la vecina, con el MISMO permiso).
-- Dos proyectos en D (D1, D2) para el cruce entre proyectos de la misma
-- empresa, que es el que una RLS por empresa no ve.
--
-- Personas:
--   OPL   operador de D con el rol «Limpieza» (condominios.tab.prog_limpieza: ver,
--         crear, editar y eliminar; desde 20261104000700 escribir pide la acción)
--   SINP  operador de D SIN ese permiso
--   OPC   operador de C con el rol «Limpieza» de C
--
-- Catálogo de D1:
--   áreas      A1 «Apartamento 1AB», A2 «Apartamento 1C», A3 «Gradas»,
--              A4 «Bodega» (INACTIVA)
--   actividades BARRER (5 min, sin área) y VIDRIOS (2 min, área A3)
--   jornada    H1 (07:00–15:00), con un bloque abierto B1 y uno cerrado B2
-- Y un área AX en D2, un área AC en C1 y una actividad PX en D2: lo que NO se
-- puede colar en un recorrido de D1.
--
-- Todo lo de la prueba vive en el esquema «rr»: no toca el catálogo de public.
-- ============================================================================
\set ON_ERROR_STOP on

CREATE SCHEMA rr;
GRANT USAGE ON SCHEMA rr TO PUBLIC;

CREATE TABLE rr.ids (alias text PRIMARY KEY, id uuid NOT NULL UNIQUE);
GRANT SELECT ON rr.ids TO PUBLIC;

CREATE FUNCTION rr.id(p_alias text) RETURNS uuid LANGUAGE sql STABLE AS
$$ SELECT id FROM rr.ids WHERE alias = p_alias $$;
GRANT EXECUTE ON FUNCTION rr.id(text) TO PUBLIC;

INSERT INTO rr.ids (alias, id) VALUES
  ('C',       'c0000000-0000-0000-0000-00000000000c'),
  ('D',       'c0000000-0000-0000-0000-00000000000d'),
  ('C1',      'c1000000-0000-0000-0000-0000000000c1'),
  ('D1',      'c1000000-0000-0000-0000-0000000000d1'),
  ('D2',      'c1000000-0000-0000-0000-0000000000d2'),
  ('OPL',     'c2000000-0000-0000-0000-000000000001'),
  ('SINP',    'c2000000-0000-0000-0000-000000000002'),
  ('OPC',     'c2000000-0000-0000-0000-000000000003'),
  ('ROL_D',   'c3000000-0000-0000-0000-00000000000d'),
  ('ROL_C',   'c3000000-0000-0000-0000-00000000000c'),
  ('A1',      'c4000000-0000-0000-0000-000000000001'),
  ('A2',      'c4000000-0000-0000-0000-000000000002'),
  ('A3',      'c4000000-0000-0000-0000-000000000003'),
  ('A4',      'c4000000-0000-0000-0000-000000000004'),
  ('AX',      'c4000000-0000-0000-0000-0000000000d2'),
  ('AC',      'c4000000-0000-0000-0000-0000000000c1'),
  ('BARRER',  'c5000000-0000-0000-0000-000000000001'),
  ('VIDRIOS', 'c5000000-0000-0000-0000-000000000002'),
  ('PX',      'c5000000-0000-0000-0000-0000000000d2'),
  ('H1',      'c6000000-0000-0000-0000-000000000001'),
  ('P1',      'c7000000-0000-0000-0000-000000000001'),
  ('B1',      'c8000000-0000-0000-0000-000000000001'),
  ('B2',      'c8000000-0000-0000-0000-000000000002');

-- ── empresas y proyectos (los triggers de alta siembran sus catálogos) ──────
INSERT INTO public.companies (id, nombre, max_projects) VALUES
  (rr.id('C'), 'Empresa C (vecina)', 5),
  (rr.id('D'), 'Empresa D', 5);

INSERT INTO public.projects (id, company_id, nombre, tipo) VALUES
  (rr.id('C1'), rr.id('C'), 'C1', 'condominio'),
  (rr.id('D1'), rr.id('D'), 'D1', 'condominio'),
  (rr.id('D2'), rr.id('D'), 'D2', 'condominio');

-- ── personas y RBAC ──────────────────────────────────────────────────────────
INSERT INTO auth.users (id, email) VALUES
  (rr.id('OPL'),  'opl@rr.test'),
  (rr.id('SINP'), 'sinp@rr.test'),
  (rr.id('OPC'),  'opc@rr.test');

INSERT INTO public.app_users (id, full_name, role, company_id) VALUES
  (rr.id('OPL'),  'Operador limpieza D', 'operator', rr.id('D')),
  (rr.id('SINP'), 'Operador sin permiso D', 'operator', rr.id('D')),
  (rr.id('OPC'),  'Operador limpieza C', 'operator', rr.id('C'));

INSERT INTO public.permissions (key, category, label)
VALUES ('condominios.tab.prog_limpieza', 'recursos_humanos', 'Programación de limpieza')
ON CONFLICT (key) DO NOTHING;

INSERT INTO public.roles (id, company_id, name) VALUES
  (rr.id('ROL_D'), rr.id('D'), 'Limpieza D'),
  (rr.id('ROL_C'), rr.id('C'), 'Limpieza C');
INSERT INTO public.permissions (key, category, label)
SELECT 'condominios.tab.prog_limpieza.' || a, 'recursos_humanos', 'Programación de limpieza · ' || a
FROM unnest(ARRAY['create', 'edit', 'delete']) AS a
ON CONFLICT (key) DO NOTHING;
INSERT INTO public.role_permissions (role_id, permission_key, effect)
SELECT r, k, 'allow'
FROM unnest(ARRAY[rr.id('ROL_D'), rr.id('ROL_C')]) AS r
CROSS JOIN unnest(ARRAY['condominios.tab.prog_limpieza', 'condominios.tab.prog_limpieza.create',
                        'condominios.tab.prog_limpieza.edit', 'condominios.tab.prog_limpieza.delete']) AS k;
INSERT INTO public.user_roles (user_id, role_id) VALUES
  (rr.id('OPL'), rr.id('ROL_D')),
  (rr.id('OPC'), rr.id('ROL_C'));

-- ── catálogo ─────────────────────────────────────────────────────────────────
INSERT INTO public.areas_condominio (id, company_id, project_id, nombre, icono, orden, activo) VALUES
  (rr.id('A1'), rr.id('D'), rr.id('D1'), 'Apartamento 1AB', '🚪', 0, true),
  (rr.id('A2'), rr.id('D'), rr.id('D1'), 'Apartamento 1C',  '🚪', 1, true),
  (rr.id('A3'), rr.id('D'), rr.id('D1'), 'Gradas',          '🪜', 2, true),
  (rr.id('A4'), rr.id('D'), rr.id('D1'), 'Bodega',          '📦', 3, false),
  (rr.id('AX'), rr.id('D'), rr.id('D2'), 'Lobby D2',        '🏢', 0, true),
  (rr.id('AC'), rr.id('C'), rr.id('C1'), 'Lobby C1',        '🏢', 0, true);

INSERT INTO public.plantillas_tarea_cargo
  (id, company_id, project_id, cargo, titulo, servicio, area_id, duracion_estimada_min, activo) VALUES
  (rr.id('BARRER'),  rr.id('D'), rr.id('D1'), 'conserje', 'Barrido de piso',     'limpieza', NULL,         5, true),
  (rr.id('VIDRIOS'), rr.id('D'), rr.id('D1'), 'conserje', 'Limpieza de vidrios', 'limpieza', rr.id('A3'),  2, true),
  (rr.id('PX'),      rr.id('D'), rr.id('D2'), 'conserje', 'Actividad de D2',     'limpieza', NULL,         3, true);

-- ── motor de turnos: una jornada, un empleado, un bloque abierto y uno cerrado ──
INSERT INTO public.plantillas_horario (id, company_id, project_id, nombre, hora_inicio, hora_fin) VALUES
  (rr.id('H1'), rr.id('D'), rr.id('D1'), 'Mañana', '07:00', '15:00');

INSERT INTO public.personal_condominio (id, company_id, project_id, nombre) VALUES
  (rr.id('P1'), rr.id('D'), rr.id('D1'), 'Conserje 1');

INSERT INTO public.bloques_turno (id, company_id, project_id, personal_id, turno, fecha, plantilla_horario_id) VALUES
  (rr.id('B1'), rr.id('D'), rr.id('D1'), rr.id('P1'), 'manana', DATE '2026-11-10', rr.id('H1')),
  (rr.id('B2'), rr.id('D'), rr.id('D1'), rr.id('P1'), 'manana', DATE '2026-11-11', rr.id('H1'));
UPDATE public.bloques_turno SET estado = 'completado', cerrado_en = now() WHERE id = rr.id('B2');

-- ── utilidades de la suite ───────────────────────────────────────────────────
-- chk: igualdad con mensaje; un fallo aborta la corrida (ON_ERROR_STOP).
CREATE FUNCTION rr.chk(p_real anyelement, p_esperado anyelement, p_etiqueta text)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF p_real IS DISTINCT FROM p_esperado THEN
    RAISE EXCEPTION 'FALLA %: se obtuvo «%», se esperaba «%»', p_etiqueta, p_real, p_esperado;
  END IF;
  RAISE NOTICE 'OK    %', p_etiqueta;
END;
$$;
GRANT EXECUTE ON FUNCTION rr.chk(anyelement, anyelement, text) TO PUBLIC;

-- error: ejecuta p_sql en una subtransacción y exige ESE sqlstate. Si no falla,
-- o falla con otro código, la suite aborta: un rechazo por el motivo equivocado
-- no prueba la regla.
-- Con p_contiene, además el mensaje debe nombrarlo (p. ej. la constraint que
-- tiene que ser la que rechaza, y no otra que pasaba por ahí).
CREATE FUNCTION rr.error(p_sql text, p_sqlstate text, p_etiqueta text, p_contiene text DEFAULT NULL)
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
GRANT EXECUTE ON FUNCTION rr.error(text, text, text, text) TO PUBLIC;

-- Sesión de API de una persona: lo que PostgREST fija antes de cada petición.
CREATE FUNCTION rr.como(p_alias text) RETURNS void LANGUAGE sql AS $$
  SELECT set_config('request.jwt.claim.sub', rr.id(p_alias)::text, false),
         set_config('request.jwt.claims',
                    json_build_object('sub', rr.id(p_alias), 'role', 'authenticated')::text, false);
$$;
GRANT EXECUTE ON FUNCTION rr.como(text) TO PUBLIC;

-- Sin JWT: migraciones, SQL Editor, pg_cron. Es la sesión desde la que corre la purga.
CREATE FUNCTION rr.sistema() RETURNS void LANGUAGE sql AS $$
  SELECT set_config('request.jwt.claim.sub', '', false),
         set_config('request.jwt.claims', '{}', false);
$$;

-- Foto legible del recorrido de una rutina: «área:actividad,actividad|…».
CREATE FUNCTION rr.foto(p_rutina uuid) RETURNS text LANGUAGE sql STABLE AS $$
  SELECT COALESCE(string_agg(parada, ' | ' ORDER BY o1 NULLS FIRST), '')
  FROM (
    SELECT rz.orden AS o1,
           COALESCE(a.nombre, '(sin área)') || ': ' ||
           COALESCE(string_agg(p.titulo || CASE WHEN ra.obligatoria THEN '' ELSE '?' END,
                               ', ' ORDER BY ra.orden), '') AS parada
    FROM (SELECT id, area_id, orden FROM public.rutina_areas WHERE rutina_id = p_rutina
          UNION ALL SELECT NULL, NULL, NULL
          WHERE EXISTS (SELECT 1 FROM public.rutina_actividades
                        WHERE rutina_id = p_rutina AND rutina_area_id IS NULL)) rz
    LEFT JOIN public.areas_condominio a ON a.id = rz.area_id
    LEFT JOIN public.rutina_actividades ra
      ON ra.rutina_id = p_rutina AND ra.rutina_area_id IS NOT DISTINCT FROM rz.id
    LEFT JOIN public.plantillas_tarea_cargo p ON p.id = ra.plantilla_tarea_id
    GROUP BY rz.id, rz.orden, a.nombre
  ) x
$$;
GRANT EXECUTE ON FUNCTION rr.foto(uuid) TO PUBLIC;

-- Recorrido en JSON a partir de alias: rr.rec('A1:BARRER,VIDRIOS', 'A2:BARRER', 'A3:').
-- `-:` es el grupo legado (area_id null); `?` marca la actividad como opcional.
CREATE FUNCTION rr.rec(VARIADIC p_paradas text[]) RETURNS jsonb LANGUAGE sql STABLE AS $$
  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'area_id', CASE WHEN split_part(par, ':', 1) = '-' THEN NULL ELSE rr.id(split_part(par, ':', 1)) END,
      'actividades', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
                 'plantilla_tarea_id', rr.id(rtrim(act, '?')),
                 'obligatoria', right(act, 1) <> '?') ORDER BY k)
        FROM unnest(string_to_array(NULLIF(split_part(par, ':', 2), ''), ',')) WITH ORDINALITY AS u(act, k)
      ), '[]'::jsonb))
    ORDER BY n), '[]'::jsonb)
  FROM unnest(p_paradas) WITH ORDINALITY AS t(par, n)
$$;
GRANT EXECUTE ON FUNCTION rr.rec(text[]) TO PUBLIC;
