-- Padrón de la prueba del responsable: dos empresas, tres proyectos y trece cuentas que
-- cubren cada rama de la elegibilidad (perfil exento, acotado, heredado, explícito, sin
-- permiso, deshabilitado, caducado, denegado, cliente, otra empresa).
INSERT INTO public.companies (id, nombre) VALUES (hkt.ca(), 'Empresa A'), (hkt.cb(), 'Empresa B');
INSERT INTO public.projects (id, company_id, nombre) VALUES
  (hkt.pa1(), hkt.ca(), 'A · Proyecto 1'), (hkt.pa2(), hkt.ca(), 'A · Proyecto 2'), (hkt.pb1(), hkt.cb(), 'B · Proyecto 1');

INSERT INTO auth.users (id, email) SELECT hkt.uid(n), 'u' || n || '@prueba.test' FROM generate_series(1, 13) n;
--  1 owner A (exento)                               8 cliente de A (residente)
--  2 admin A acotado a PA1 (asignación)             9 operador A con permiso, PA1, DESHABILITADO
--  3 operador A con permiso, PA1 (project_id)      10 operador A con permiso CADUCADO, PA1
--  4 operador A con permiso, PA2                   11 operador A con allow y DENY, PA1
--  5 operador A SIN permiso, PA1                   12 admin A sin asignaciones (exento)
--  6 operador A con permiso, PA1 (otra persona)    13 operador A con permiso, acceso por ASIGNACIÓN a PA1
--  7 admin de B
INSERT INTO public.app_users (id, full_name, role, company_id, project_id, activo) VALUES
  (hkt.uid(1),  'Owner A',                'company_owner', hkt.ca(), NULL,      true),
  (hkt.uid(2),  'Admin A (PA1)',          'admin',         hkt.ca(), NULL,      true),
  (hkt.uid(3),  'Operador PA1',           'operator',      hkt.ca(), hkt.pa1(), true),
  (hkt.uid(4),  'Operador PA2',           'operator',      hkt.ca(), hkt.pa2(), true),
  (hkt.uid(5),  'Operador sin permiso',   'operator',      hkt.ca(), hkt.pa1(), true),
  (hkt.uid(6),  'Operador PA1 bis',       'operator',      hkt.ca(), hkt.pa1(), true),
  (hkt.uid(7),  'Admin B',                'admin',         hkt.cb(), NULL,      true),
  (hkt.uid(8),  'Residente',              'cliente',       hkt.ca(), NULL,      true),
  (hkt.uid(9),  'Operador deshabilitado', 'operator',      hkt.ca(), hkt.pa1(), false),
  (hkt.uid(10), 'Operador caducado',      'operator',      hkt.ca(), hkt.pa1(), true),
  (hkt.uid(11), 'Operador denegado',      'operator',      hkt.ca(), hkt.pa1(), true),
  (hkt.uid(12), 'Admin A exento',         'admin',         hkt.ca(), NULL,      true),
  (hkt.uid(13), 'Operador asignado',      'operator',      hkt.ca(), NULL,      true);
INSERT INTO public.user_project_assignments (user_id, project_id) VALUES
  (hkt.uid(2), hkt.pa1()), (hkt.uid(13), hkt.pa1());

-- RBAC real: un rol de la empresa A con el permiso del módulo y otro que lo deniega.
INSERT INTO public.roles (id, company_id, name) VALUES
  ('e0000000-0000-0000-0000-00000000000e'::uuid, hkt.ca(), 'Housekeeping'),
  ('e0000000-0000-0000-0000-00000000000d'::uuid, hkt.ca(), 'Housekeeping denegado');
INSERT INTO public.role_permissions (role_id, permission_key, effect) VALUES
  ('e0000000-0000-0000-0000-00000000000e', 'condominios.tab.housekeeping', 'allow'),
  ('e0000000-0000-0000-0000-00000000000d', 'condominios.tab.housekeeping', 'deny');
INSERT INTO public.user_roles (user_id, role_id, expires_at)
  SELECT hkt.uid(n), 'e0000000-0000-0000-0000-00000000000e', NULL FROM unnest(ARRAY[3,4,6,9,11,13]) n;
INSERT INTO public.user_roles (user_id, role_id, expires_at) VALUES
  (hkt.uid(10), 'e0000000-0000-0000-0000-00000000000e', now() - interval '1 day'),
  (hkt.uid(11), 'e0000000-0000-0000-0000-00000000000d', NULL);
INSERT INTO public.test_mis_unidades (user_id, unidad_id) VALUES (hkt.uid(8), hkt.u1());
