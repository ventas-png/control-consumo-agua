-- ============================================================================
-- PADRÓN DE LA SUITE «herramientas_turno» (20261230000500)
--
-- Se carga sobre la cadena REAL de migraciones: lo que se prueba es la RPC
-- contra las tablas, triggers y policies que de verdad tiene el repositorio
-- (en particular, las SELECT de equipos_comunes e inventario_condominio, que
-- exigen su propio tab y son la causa del «Herramienta» sin nombre).
--
-- Dos empresas: D (la del turno) y C (la vecina, con los MISMOS permisos).
-- Dos condominios en D (D1, D2): el cruce entre condominios de la misma
-- empresa es el que la empresa sola no ve.
--
-- Personas (todas «operator», ninguna exenta de proyecto), asignadas a D1
-- salvo que se diga otra cosa:
--   LIMP    SÓLO Limpieza (prog_limpieza + .edit): el caso del reporte
--   EJEC    sólo «Mis tareas» (tareas_personal)
--   TURN    sólo «Asignación turnos» (turnos)
--   REV     sólo «Revisión de tareas» (revision_tareas)
--   DESEMP  sólo «Desempeño» (desempeno_personal): lee el turno, no lo ejecuta
--   EQUIP   sólo Equipos (equipos): el catálogo, pero no el turno
--   SINP    ningún tab
--   LIMPD2  sólo Limpieza, asignado SÓLO a D2
--   LIMPC   sólo Limpieza en la empresa C (asignado a C1)
--
-- Catálogo de D1:
--   equipos     ESCOBA «Escoba» · TRAPEADOR «Trapeador» · PULIDORA «Pulidora»
--               (DE BAJA) · ASPIRADORA «Aspiradora»
--   inventario  JALADOR «Jalador» (vínculo LEGADO, anterior a 20261122000000)
--   actividades BARRER  → Escoba ×1 (obligatoria), Trapeador ×2
--               VIDRIOS → Jalador ×1 (legado), Pulidora ×1
--               PULIR   → Aspiradora ×1            (en OTRO turno de D1)
-- Catálogo de D2: HIDRO «Hidrolavadora D2» · actividad PX → Hidrolavadora D2
--
-- Turnos:
--   B1   D1 · BARRER en dos áreas, VIDRIOS, una tarea suelta y una tarea cuya
--        actividad es de D2 (PX), anterior al guard de referencias
--        (20260907000800): la FK de tareas_bloque.plantilla_id es simple
--   B2   D1 · sin tareas
--   B3   D1 · PULIR
--   BD2  D2 · PX
--
-- Todo lo de la prueba vive en el esquema «ht»: no toca el catálogo de public.
-- ============================================================================
\set ON_ERROR_STOP on

CREATE SCHEMA ht;
GRANT USAGE ON SCHEMA ht TO PUBLIC;

CREATE TABLE ht.ids (alias text PRIMARY KEY, id uuid NOT NULL UNIQUE);
GRANT SELECT ON ht.ids TO PUBLIC;

CREATE FUNCTION ht.id(p_alias text) RETURNS uuid LANGUAGE sql STABLE AS
$$ SELECT id FROM ht.ids WHERE alias = p_alias $$;
GRANT EXECUTE ON FUNCTION ht.id(text) TO PUBLIC;

INSERT INTO ht.ids (alias, id) VALUES
  ('C',          'f0000000-0000-0000-0000-00000000000c'),
  ('D',          'f0000000-0000-0000-0000-00000000000d'),
  ('C1',         'f1000000-0000-0000-0000-0000000000c1'),
  ('D1',         'f1000000-0000-0000-0000-0000000000d1'),
  ('D2',         'f1000000-0000-0000-0000-0000000000d2'),
  ('LIMP',       'f2000000-0000-0000-0000-000000000001'),
  ('EJEC',       'f2000000-0000-0000-0000-000000000002'),
  ('TURN',       'f2000000-0000-0000-0000-000000000003'),
  ('REV',        'f2000000-0000-0000-0000-000000000004'),
  ('DESEMP',     'f2000000-0000-0000-0000-000000000005'),
  ('EQUIP',      'f2000000-0000-0000-0000-000000000006'),
  ('SINP',       'f2000000-0000-0000-0000-000000000007'),
  ('LIMPD2',     'f2000000-0000-0000-0000-000000000008'),
  ('LIMPC',      'f2000000-0000-0000-0000-000000000009'),
  ('ROL_LIMP',   'f3000000-0000-0000-0000-000000000001'),
  ('ROL_EJEC',   'f3000000-0000-0000-0000-000000000002'),
  ('ROL_TURN',   'f3000000-0000-0000-0000-000000000003'),
  ('ROL_REV',    'f3000000-0000-0000-0000-000000000004'),
  ('ROL_DESEMP', 'f3000000-0000-0000-0000-000000000005'),
  ('ROL_EQUIP',  'f3000000-0000-0000-0000-000000000006'),
  ('ROL_LIMPC',  'f3000000-0000-0000-0000-00000000000c'),
  ('A1',         'f4000000-0000-0000-0000-000000000001'),
  ('A2',         'f4000000-0000-0000-0000-000000000002'),
  ('ESCOBA',     'f5000000-0000-0000-0000-000000000001'),
  ('TRAPEADOR',  'f5000000-0000-0000-0000-000000000002'),
  ('PULIDORA',   'f5000000-0000-0000-0000-000000000003'),
  ('ASPIRADORA', 'f5000000-0000-0000-0000-000000000004'),
  ('HIDRO',      'f5000000-0000-0000-0000-0000000000d2'),
  ('JALADOR',    'f6000000-0000-0000-0000-000000000001'),
  ('BARRER',     'f7000000-0000-0000-0000-000000000001'),
  ('VIDRIOS',    'f7000000-0000-0000-0000-000000000002'),
  ('PULIR',      'f7000000-0000-0000-0000-000000000003'),
  ('PX',         'f7000000-0000-0000-0000-0000000000d2'),
  ('P1',         'f8000000-0000-0000-0000-000000000001'),
  ('P2',         'f8000000-0000-0000-0000-0000000000d2'),
  ('B1',         'f9000000-0000-0000-0000-000000000001'),
  ('B2',         'f9000000-0000-0000-0000-000000000002'),
  ('B3',         'f9000000-0000-0000-0000-000000000003'),
  ('BD2',        'f9000000-0000-0000-0000-0000000000d2');

-- ── empresas y condominios (los triggers de alta siembran sus catálogos) ────
INSERT INTO public.companies (id, nombre, max_projects) VALUES
  (ht.id('C'), 'Empresa C (vecina)', 5),
  (ht.id('D'), 'Empresa D', 5);

INSERT INTO public.projects (id, company_id, nombre, tipo) VALUES
  (ht.id('C1'), ht.id('C'), 'C1', 'condominio'),
  (ht.id('D1'), ht.id('D'), 'D1', 'condominio'),
  (ht.id('D2'), ht.id('D'), 'D2', 'condominio');

-- ── personas y RBAC ──────────────────────────────────────────────────────────
INSERT INTO auth.users (id, email)
SELECT ht.id(a), lower(a) || '@ht.test'
FROM unnest(ARRAY['LIMP', 'EJEC', 'TURN', 'REV', 'DESEMP', 'EQUIP', 'SINP', 'LIMPD2', 'LIMPC']) a;

INSERT INTO public.app_users (id, full_name, role, company_id)
SELECT ht.id(a), 'Persona ' || a, 'operator', ht.id(CASE a WHEN 'LIMPC' THEN 'C' ELSE 'D' END)
FROM unnest(ARRAY['LIMP', 'EJEC', 'TURN', 'REV', 'DESEMP', 'EQUIP', 'SINP', 'LIMPD2', 'LIMPC']) a;

INSERT INTO public.user_project_assignments (user_id, project_id, permission_type)
SELECT ht.id(a), ht.id(CASE a WHEN 'LIMPD2' THEN 'D2' WHEN 'LIMPC' THEN 'C1' ELSE 'D1' END), 'total'
FROM unnest(ARRAY['LIMP', 'EJEC', 'TURN', 'REV', 'DESEMP', 'EQUIP', 'SINP', 'LIMPD2', 'LIMPC']) a;

INSERT INTO public.permissions (key, category, label) VALUES
  ('condominios.tab.prog_limpieza',      'recursos_humanos', 'Programación de limpieza'),
  ('condominios.tab.prog_limpieza.edit', 'recursos_humanos', 'Programación de limpieza · editar'),
  ('condominios.tab.tareas_personal',    'recursos_humanos', 'Mis tareas'),
  ('condominios.tab.turnos',             'recursos_humanos', 'Asignación turnos'),
  ('condominios.tab.revision_tareas',    'recursos_humanos', 'Revisión de tareas'),
  ('condominios.tab.desempeno_personal', 'recursos_humanos', 'Desempeño'),
  ('condominios.tab.equipos',            'operaciones',      'Equipos'),
  ('condominios.tab.inventario',         'operaciones',      'Inventario')
ON CONFLICT (key) DO NOTHING;

INSERT INTO public.roles (id, company_id, name) VALUES
  (ht.id('ROL_LIMP'),   ht.id('D'), 'Sólo Limpieza D'),
  (ht.id('ROL_EJEC'),   ht.id('D'), 'Sólo Mis tareas D'),
  (ht.id('ROL_TURN'),   ht.id('D'), 'Sólo Turnos D'),
  (ht.id('ROL_REV'),    ht.id('D'), 'Sólo Revisión D'),
  (ht.id('ROL_DESEMP'), ht.id('D'), 'Sólo Desempeño D'),
  (ht.id('ROL_EQUIP'),  ht.id('D'), 'Sólo Equipos D'),
  (ht.id('ROL_LIMPC'),  ht.id('C'), 'Sólo Limpieza C');
INSERT INTO public.role_permissions (role_id, permission_key, effect) VALUES
  (ht.id('ROL_LIMP'),   'condominios.tab.prog_limpieza',      'allow'),
  (ht.id('ROL_LIMP'),   'condominios.tab.prog_limpieza.edit', 'allow'),
  (ht.id('ROL_EJEC'),   'condominios.tab.tareas_personal',    'allow'),
  (ht.id('ROL_TURN'),   'condominios.tab.turnos',             'allow'),
  (ht.id('ROL_REV'),    'condominios.tab.revision_tareas',    'allow'),
  (ht.id('ROL_DESEMP'), 'condominios.tab.desempeno_personal', 'allow'),
  (ht.id('ROL_EQUIP'),  'condominios.tab.equipos',            'allow'),
  (ht.id('ROL_LIMPC'),  'condominios.tab.prog_limpieza',      'allow'),
  (ht.id('ROL_LIMPC'),  'condominios.tab.prog_limpieza.edit', 'allow');
INSERT INTO public.user_roles (user_id, role_id) VALUES
  (ht.id('LIMP'),   ht.id('ROL_LIMP')),
  (ht.id('LIMPD2'), ht.id('ROL_LIMP')),
  (ht.id('EJEC'),   ht.id('ROL_EJEC')),
  (ht.id('TURN'),   ht.id('ROL_TURN')),
  (ht.id('REV'),    ht.id('ROL_REV')),
  (ht.id('DESEMP'), ht.id('ROL_DESEMP')),
  (ht.id('EQUIP'),  ht.id('ROL_EQUIP')),
  (ht.id('LIMPC'),  ht.id('ROL_LIMPC'));

-- ── catálogo ─────────────────────────────────────────────────────────────────
INSERT INTO public.areas_condominio (id, company_id, project_id, nombre, icono, orden, activo) VALUES
  (ht.id('A1'), ht.id('D'), ht.id('D1'), 'Lobby',   '🚪', 0, true),
  (ht.id('A2'), ht.id('D'), ht.id('D1'), 'Pasillo', '🚪', 1, true);

-- Con lo que NO debe salir de la RPC: serie, valor de compra, ubicación, notas.
INSERT INTO public.equipos_comunes
  (id, company_id, project_id, nombre, categoria, estado, serial, valor_compra, ubicacion, notas) VALUES
  (ht.id('ESCOBA'),     ht.id('D'), ht.id('D1'), 'Escoba',           'herramienta', 'operativo', 'S-1', 120, 'Bodega 1', 'nota'),
  (ht.id('TRAPEADOR'),  ht.id('D'), ht.id('D1'), 'Trapeador',        'herramienta', 'operativo', 'S-2', 90,  'Bodega 1', NULL),
  (ht.id('PULIDORA'),   ht.id('D'), ht.id('D1'), 'Pulidora',         'limpieza',    'baja',      'S-3', 900, 'Bodega 2', NULL),
  (ht.id('ASPIRADORA'), ht.id('D'), ht.id('D1'), 'Aspiradora',       'limpieza',    'operativo', 'S-4', 700, 'Bodega 2', NULL),
  (ht.id('HIDRO'),      ht.id('D'), ht.id('D2'), 'Hidrolavadora D2', 'herramienta', 'operativo', 'S-5', 999, 'D2',       NULL);

INSERT INTO public.inventario_condominio (id, company_id, project_id, nombre, categoria, estado, costo_unitario, proveedor) VALUES
  (ht.id('JALADOR'), ht.id('D'), ht.id('D1'), 'Jalador', 'herramienta', 'disponible', 55, 'Ferretería');

INSERT INTO public.plantillas_tarea_cargo
  (id, company_id, project_id, cargo, titulo, servicio, area_id, duracion_estimada_min, activo) VALUES
  (ht.id('BARRER'),  ht.id('D'), ht.id('D1'), 'conserje', 'Barrido de piso',     'limpieza', NULL, 5, true),
  (ht.id('VIDRIOS'), ht.id('D'), ht.id('D1'), 'conserje', 'Limpieza de vidrios', 'limpieza', NULL, 2, true),
  (ht.id('PULIR'),   ht.id('D'), ht.id('D1'), 'conserje', 'Pulido de piso',      'limpieza', NULL, 9, true),
  (ht.id('PX'),      ht.id('D'), ht.id('D2'), 'conserje', 'Actividad de D2',     'limpieza', NULL, 3, true);

-- El trigger de coherencia (plantilla_herramienta_coherente) sella el tenant
-- desde la actividad y valida el recurso en su catálogo.
INSERT INTO public.plantilla_tarea_herramientas
  (company_id, project_id, plantilla_tarea_id, equipo_id, inventario_id, cantidad, obligatoria) VALUES
  (ht.id('D'), ht.id('D1'), ht.id('BARRER'),  ht.id('ESCOBA'),     NULL,            1, true),
  (ht.id('D'), ht.id('D1'), ht.id('BARRER'),  ht.id('TRAPEADOR'),  NULL,            2, false),
  (ht.id('D'), ht.id('D1'), ht.id('VIDRIOS'), NULL,                ht.id('JALADOR'), 1, false),
  (ht.id('D'), ht.id('D1'), ht.id('VIDRIOS'), ht.id('PULIDORA'),   NULL,            1, false),
  (ht.id('D'), ht.id('D1'), ht.id('PULIR'),   ht.id('ASPIRADORA'), NULL,            1, false),
  (ht.id('D'), ht.id('D2'), ht.id('PX'),      ht.id('HIDRO'),      NULL,            1, true);

-- ── turnos ───────────────────────────────────────────────────────────────────
INSERT INTO public.personal_condominio (id, company_id, project_id, nombre, cargo) VALUES
  (ht.id('P1'), ht.id('D'), ht.id('D1'), 'Ana Pérez',     'conserje'),
  (ht.id('P2'), ht.id('D'), ht.id('D2'), 'Persona de D2', 'conserje');

INSERT INTO public.bloques_turno (id, company_id, project_id, personal_id, turno, fecha) VALUES
  (ht.id('B1'),  ht.id('D'), ht.id('D1'), ht.id('P1'), 'manana', CURRENT_DATE),
  (ht.id('B2'),  ht.id('D'), ht.id('D1'), ht.id('P1'), 'tarde',  CURRENT_DATE),
  (ht.id('B3'),  ht.id('D'), ht.id('D1'), ht.id('P1'), 'manana', CURRENT_DATE + 1),
  (ht.id('BD2'), ht.id('D'), ht.id('D2'), ht.id('P2'), 'manana', CURRENT_DATE);

INSERT INTO public.tareas_bloque (bloque_id, plantilla_id, area_id, titulo, orden) VALUES
  (ht.id('B1'),  ht.id('BARRER'),  ht.id('A1'), 'Barrido de piso',     0),
  (ht.id('B1'),  ht.id('BARRER'),  ht.id('A2'), 'Barrido de piso',     1),
  (ht.id('B1'),  ht.id('VIDRIOS'), ht.id('A1'), 'Limpieza de vidrios', 2),
  (ht.id('B1'),  NULL,             NULL,        'Tarea suelta',        3),
  (ht.id('B3'),  ht.id('PULIR'),   ht.id('A1'), 'Pulido de piso',      0),
  (ht.id('BD2'), ht.id('PX'),      NULL,        'Actividad de D2',     0);

-- Una tarea de B1 (D1) cuya actividad es de D2. Hoy la base no la deja nacer
-- (trg_referencias_del_scope, 20260907000800), pero ese guard no revisó las
-- filas que ya existían y la FK de plantilla_id es simple: una fila anterior
-- puede seguir ahí. Se inserta como entonces, sin triggers.
SET session_replication_role = replica;
INSERT INTO public.tareas_bloque (bloque_id, plantilla_id, area_id, titulo, orden) VALUES
  (ht.id('B1'), ht.id('PX'), NULL, 'Actividad de D2 (anterior al guard)', 4);
SET session_replication_role = DEFAULT;

-- ── utilidades de la suite ───────────────────────────────────────────────────
-- chk: igualdad con mensaje; un fallo aborta la corrida (ON_ERROR_STOP).
CREATE FUNCTION ht.chk(p_real anyelement, p_esperado anyelement, p_etiqueta text)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF p_real IS DISTINCT FROM p_esperado THEN
    RAISE EXCEPTION 'FALLA %: se obtuvo «%», se esperaba «%»', p_etiqueta, p_real, p_esperado;
  END IF;
  RAISE NOTICE 'OK    %', p_etiqueta;
END;
$$;
GRANT EXECUTE ON FUNCTION ht.chk(anyelement, anyelement, text) TO PUBLIC;

-- error: ejecuta p_sql en una subtransacción y exige ESE sqlstate (y, con
-- p_contiene, que el mensaje lo nombre). Un rechazo por el motivo equivocado no
-- prueba la regla.
CREATE FUNCTION ht.error(p_sql text, p_sqlstate text, p_etiqueta text, p_contiene text DEFAULT NULL)
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
GRANT EXECUTE ON FUNCTION ht.error(text, text, text, text) TO PUBLIC;

-- Sesión de API de una persona: lo que PostgREST fija antes de cada petición.
CREATE FUNCTION ht.como(p_alias text) RETURNS void LANGUAGE sql AS $$
  SELECT set_config('request.jwt.claim.sub', ht.id(p_alias)::text, false),
         set_config('request.jwt.claims',
                    json_build_object('sub', ht.id(p_alias), 'role', 'authenticated')::text, false);
$$;
GRANT EXECUTE ON FUNCTION ht.como(text) TO PUBLIC;

-- Lo que devuelve la RPC para un turno, legible y en orden estable:
-- «nombre×cantidad[!obligatoria]/estado», ordenado por nombre.
CREATE FUNCTION ht.lista(p_bloque text) RETURNS text LANGUAGE sql AS $$
  SELECT COALESCE(string_agg(
           COALESCE(h.nombre, '?') || '×' || h.cantidad || CASE WHEN h.obligatoria THEN '!' ELSE '' END
           || '/' || COALESCE(h.estado, '?'),
           ', ' ORDER BY h.nombre COLLATE "C"), '')
  FROM public.herramientas_del_turno(ht.id(p_bloque)) h
$$;
GRANT EXECUTE ON FUNCTION ht.lista(text) TO PUBLIC;
