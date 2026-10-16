-- Datos propios de rrhh_catalogos, sobre el padrón de housekeeping_responsable/datos.sql
-- (dos empresas A/B, proyectos PA1/PA2/PB1, trece cuentas con RBAC real) y los roles/áreas/
-- actividades de plantillas_importacion/datos.sql (3 = «Plantillas completo» en PA1).
--
-- Roles de esta suite (empresa A):
--   «RRHH config» (rrhh_config + 5 acciones)                → 6  (PA1)   : administra el catálogo
--   «Solo personal» (personal + personal.create/edit)       → 11 (PA1)   : hereda rrhh_config + create/edit
--   «Config denegado» (deny rrhh_config)                    → 10 (PA1)   : ni lee
--   «Config solo ver» (rrhh_config)                         → 14 (PA1)   : lee, no escribe
--   «Limpieza» (prog_limpieza)                              → 3, 6, 11   : programaciones y ejecuciones
--   1 dueña (exenta), 2 admin PA1, 12 admin exento · 4 operador PA2 · 5 sin permiso · 7 admin de B
--
-- Filas LEGADAS insertadas ANTES de la migración (sin validación): un empleado con cargo
-- «Polivalente» y turno «mixto», y una actividad con cargo «Conserje» (mayúscula, válida
-- para el trigger literal).
INSERT INTO public.roles (id, company_id, name) VALUES
  ('e0000000-0000-0000-0000-0000000000a1'::uuid, hkt.ca(), 'RRHH config'),
  ('e0000000-0000-0000-0000-0000000000a2'::uuid, hkt.ca(), 'Solo personal'),
  ('e0000000-0000-0000-0000-0000000000a3'::uuid, hkt.ca(), 'Config denegado'),
  ('e0000000-0000-0000-0000-0000000000a4'::uuid, hkt.ca(), 'Config solo ver'),
  ('e0000000-0000-0000-0000-0000000000a5'::uuid, hkt.ca(), 'Limpieza');
-- «RRHH config» recibe sus claves en assert.sql (nacen con la migración). «Solo personal»
-- se siembra AHORA para probar la herencia.
INSERT INTO public.role_permissions (role_id, permission_key, effect) VALUES
  ('e0000000-0000-0000-0000-0000000000a2', 'condominios.tab.personal', 'allow'),
  ('e0000000-0000-0000-0000-0000000000a2', 'condominios.tab.personal.create', 'allow'),
  ('e0000000-0000-0000-0000-0000000000a2', 'condominios.tab.personal.edit', 'allow'),
  ('e0000000-0000-0000-0000-0000000000a3', 'condominios.tab.personal', 'deny'),
  ('e0000000-0000-0000-0000-0000000000a5', 'condominios.tab.prog_limpieza', 'allow');
INSERT INTO auth.users (id, email) VALUES (hkt.uid(14), 'u14@test')
  ON CONFLICT (id) DO NOTHING;
INSERT INTO public.app_users (id, full_name, role, company_id, project_id, activo) VALUES
  (hkt.uid(14), 'Operadora config solo ver', 'operator', hkt.ca(), hkt.pa1(), true)
  ON CONFLICT (id) DO NOTHING;
INSERT INTO public.user_roles (user_id, role_id, expires_at) VALUES
  (hkt.uid(6),  'e0000000-0000-0000-0000-0000000000a1', NULL),
  (hkt.uid(11), 'e0000000-0000-0000-0000-0000000000a2', NULL),
  (hkt.uid(10), 'e0000000-0000-0000-0000-0000000000a3', NULL),
  (hkt.uid(14), 'e0000000-0000-0000-0000-0000000000a4', NULL),
  (hkt.uid(3),  'e0000000-0000-0000-0000-0000000000a5', NULL),
  (hkt.uid(6),  'e0000000-0000-0000-0000-0000000000a5', NULL),
  (hkt.uid(11), 'e0000000-0000-0000-0000-0000000000a5', NULL);

CREATE OR REPLACE FUNCTION hkt.pe(n int) RETURNS uuid LANGUAGE sql IMMUTABLE AS
  $$ SELECT ('af000000-0000-0000-0000-' || lpad(n::text, 12, '0'))::uuid $$;
CREATE OR REPLACE FUNCTION hkt.pg(n int) RETURNS uuid LANGUAGE sql IMMUTABLE AS
  $$ SELECT ('b2000000-0000-0000-0000-' || lpad(n::text, 12, '0'))::uuid $$;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA hkt TO anon, authenticated, service_role;

INSERT INTO public.personal_condominio (id, company_id, project_id, nombre, cargo, turno) VALUES
  (hkt.pe(1), hkt.ca(), hkt.pa1(), 'Ana Conserje',     'conserje',    'diurno'),
  (hkt.pe(2), hkt.ca(), hkt.pa1(), 'Beto Jardinero',   'jardinero',   'nocturno'),
  (hkt.pe(3), hkt.ca(), hkt.pa1(), 'Carla Polivalente','Polivalente', 'mixto'),
  (hkt.pe(4), hkt.ca(), hkt.pa2(), 'Dora PA2',         'guardia',     'rotativo'),
  (hkt.pe(9), hkt.cb(), hkt.pb1(), 'Eva B',            'conserje',    'diurno');
INSERT INTO public.plantillas_tarea_cargo (id, company_id, project_id, cargo, titulo, servicio, duracion_estimada_min, activo) VALUES
  (hkt.pl(4), hkt.ca(), hkt.pa1(), 'Conserje', 'Legada en mayúscula', 'otro', NULL, true);
INSERT INTO public.programacion_limpieza (id, company_id, project_id, area, area_id, cargo, turno) VALUES
  (hkt.pg(1), hkt.ca(), hkt.pa1(), 'Pasillo', hkt.ar(1), 'jardinero', 'nocturno'),
  (hkt.pg(2), hkt.ca(), hkt.pa1(), 'Gradas',  hkt.ar(2), NULL,        NULL);
INSERT INTO public.ejecuciones_limpieza (company_id, project_id, programacion_id, fecha, turno) VALUES
  (hkt.ca(), hkt.pa1(), hkt.pg(1), current_date, 'nocturno');
