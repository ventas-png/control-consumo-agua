-- ============================================================================
-- PADRÓN DE LA SUITE «rutinas_recorrido_crear» (20261225000000)
--
-- Va ENCIMA del padrón de rutinas_recorrido (supabase/tests/rutinas_recorrido/
-- fixture.sql: empresas C y D, proyectos D1/D2/C1, áreas A1–A4/AX/AC,
-- actividades BARRER/VIDRIOS/PX y las utilidades rr.chk / rr.error / rr.como /
-- rr.foto / rr.rec). Agrega las personas que separan CREAR de EDITAR:
--
--   CRE   operador de D: ver + CREAR en Programación de limpieza (sin editar)
--   CRE2  otro operador de D con el MISMO rol
--   EDI   operador de D: ver + EDITAR (sin crear)
--   VER   operador de D: sólo ver el tab
--
-- y rutinas sembradas desde el sistema (sin JWT, así creado_por queda el que
-- se escribe), para los casos que la pantalla no fabrica:
--
--   R_CRE2  de CRE2, sin recorrido
--   R_OPL   de OPL (todo el permiso), sin recorrido
--   R_VER   de VER —la creó cuando podía crear—, sin recorrido
--   R_C     de CRE, pero en la empresa C (la creó cuando era de C)
--   R_LEG   de CRE, con un paso legado (sin parada) y ninguna parada
--   R_CAR   de CRE, sin recorrido: la de la carrera entre dos sesiones
-- ============================================================================
\set ON_ERROR_STOP on

INSERT INTO rr.ids (alias, id) VALUES
  ('CRE',      'ca200000-0000-0000-0000-000000000001'),
  ('CRE2',     'ca200000-0000-0000-0000-000000000002'),
  ('EDI',      'ca200000-0000-0000-0000-000000000003'),
  ('VER',      'ca200000-0000-0000-0000-000000000004'),
  ('ROL_CRE',  'ca300000-0000-0000-0000-000000000001'),
  ('ROL_EDI',  'ca300000-0000-0000-0000-000000000002'),
  ('ROL_VER',  'ca300000-0000-0000-0000-000000000003'),
  ('R_ANTES',  'ca900000-0000-0000-0000-000000000001'),
  ('R_NUEVA',  'ca900000-0000-0000-0000-000000000002'),
  ('R_PAR',    'ca900000-0000-0000-0000-000000000003'),
  ('R_FALLA',  'ca900000-0000-0000-0000-000000000004'),
  ('R_CRE2',   'ca900000-0000-0000-0000-000000000011'),
  ('R_OPL',    'ca900000-0000-0000-0000-000000000012'),
  ('R_VER',    'ca900000-0000-0000-0000-000000000013'),
  ('R_C',      'ca900000-0000-0000-0000-000000000014'),
  ('R_LEG',    'ca900000-0000-0000-0000-000000000015'),
  ('R_CAR',    'ca900000-0000-0000-0000-000000000016');

INSERT INTO auth.users (id, email) VALUES
  (rr.id('CRE'),  'cre@rr.test'),
  (rr.id('CRE2'), 'cre2@rr.test'),
  (rr.id('EDI'),  'edi@rr.test'),
  (rr.id('VER'),  'ver@rr.test');
INSERT INTO public.app_users (id, full_name, role, company_id) VALUES
  (rr.id('CRE'),  'Crea sin editar D',  'operator', rr.id('D')),
  (rr.id('CRE2'), 'Crea sin editar D2', 'operator', rr.id('D')),
  (rr.id('EDI'),  'Edita sin crear D',  'operator', rr.id('D')),
  (rr.id('VER'),  'Sólo ve D',          'operator', rr.id('D'));

INSERT INTO public.roles (id, company_id, name) VALUES
  (rr.id('ROL_CRE'), rr.id('D'), 'Limpieza: crear'),
  (rr.id('ROL_EDI'), rr.id('D'), 'Limpieza: editar'),
  (rr.id('ROL_VER'), rr.id('D'), 'Limpieza: ver');
INSERT INTO public.role_permissions (role_id, permission_key, effect) VALUES
  (rr.id('ROL_CRE'), 'condominios.tab.prog_limpieza',        'allow'),
  (rr.id('ROL_CRE'), 'condominios.tab.prog_limpieza.create', 'allow'),
  (rr.id('ROL_EDI'), 'condominios.tab.prog_limpieza',        'allow'),
  (rr.id('ROL_EDI'), 'condominios.tab.prog_limpieza.edit',   'allow'),
  (rr.id('ROL_VER'), 'condominios.tab.prog_limpieza',        'allow');
INSERT INTO public.user_roles (user_id, role_id) VALUES
  (rr.id('CRE'),  rr.id('ROL_CRE')),
  (rr.id('CRE2'), rr.id('ROL_CRE')),
  (rr.id('EDI'),  rr.id('ROL_EDI')),
  (rr.id('VER'),  rr.id('ROL_VER'));

-- Desde el sistema: sin JWT, trg_sellar_creado_por respeta el creado_por escrito.
INSERT INTO public.rutinas_limpieza (id, company_id, project_id, nombre, servicio, creado_por) VALUES
  (rr.id('R_CRE2'), rr.id('D'), rr.id('D1'), 'De CRE2',            'limpieza', rr.id('CRE2')),
  (rr.id('R_OPL'),  rr.id('D'), rr.id('D1'), 'De OPL',             'limpieza', rr.id('OPL')),
  (rr.id('R_VER'),  rr.id('D'), rr.id('D1'), 'De VER',             'limpieza', rr.id('VER')),
  (rr.id('R_C'),    rr.id('C'), rr.id('C1'), 'De CRE, en C',       'limpieza', rr.id('CRE')),
  (rr.id('R_LEG'),  rr.id('D'), rr.id('D1'), 'De CRE, legada',     'limpieza', rr.id('CRE')),
  (rr.id('R_CAR'),  rr.id('D'), rr.id('D1'), 'De CRE, la carrera', 'limpieza', rr.id('CRE'));
INSERT INTO public.rutina_actividades (company_id, project_id, rutina_id, plantilla_tarea_id, orden) VALUES
  (rr.id('D'), rr.id('D1'), rr.id('R_LEG'), rr.id('BARRER'), 0);
