-- Padrón de la prueba: dos empresas, tres proyectos, ocho personas y los servicios base.
INSERT INTO public.companies (id, nombre) VALUES (hkt.ca(), 'Empresa A'), (hkt.cb(), 'Empresa B');
INSERT INTO public.projects (id, company_id, nombre) VALUES
  (hkt.pa1(), hkt.ca(), 'A · Proyecto 1'), (hkt.pa2(), hkt.ca(), 'A · Proyecto 2'), (hkt.pb1(), hkt.cb(), 'B · Proyecto 1');

INSERT INTO auth.users (id, email) SELECT hkt.uid(n), 'u' || n || '@prueba.test' FROM generate_series(1, 8) n;
--  1 owner A (company_owner, sin asignaciones → exento de proyecto)   5 operador A sin permiso (PA1)
--  2 admin A asignado SOLO a PA1                                       6 operador A con permiso (PA1), otra persona
--  3 operador A con permiso (PA1)                                      7 admin de B
--  4 operador A con permiso (PA2)                                      8 residente (sin empresa) de la unidad U1
INSERT INTO public.app_users (id, full_name, role, company_id, project_id) VALUES
  (hkt.uid(1), 'Owner A',        'company_owner', hkt.ca(), NULL),
  (hkt.uid(2), 'Admin A (PA1)',  'admin',         hkt.ca(), NULL),
  (hkt.uid(3), 'Operador PA1',   'operator',      hkt.ca(), hkt.pa1()),
  (hkt.uid(4), 'Operador PA2',   'operator',      hkt.ca(), hkt.pa2()),
  (hkt.uid(5), 'Operador sin permiso', 'operator', hkt.ca(), hkt.pa1()),
  (hkt.uid(6), 'Operador PA1 bis', 'operator',    hkt.ca(), hkt.pa1()),
  (hkt.uid(7), 'Admin B',        'admin',         hkt.cb(), NULL),
  (hkt.uid(8), 'Residente',      'cliente',       NULL,     NULL);
INSERT INTO public.user_project_assignments (user_id, project_id) VALUES (hkt.uid(2), hkt.pa1());
INSERT INTO public.test_permisos (user_id, permiso) SELECT hkt.uid(n), 'condominios.tab.housekeeping' FROM unnest(ARRAY[3,4,6]) n;
INSERT INTO public.test_mis_unidades (user_id, unidad_id) VALUES (hkt.uid(8), hkt.u1());

-- Servicios base. 1: A/PA1 con unidad U1 · 2: A/PA2 · 3: B/PB1 · 4..9 y 11..: A/PA1 (los usa cada bloque)
INSERT INTO public.servicios_housekeeping (id, company_id, project_id, unidad_id, estado) VALUES
  (hkt.sv(1), hkt.ca(), hkt.pa1(), hkt.u1(), 'en_proceso'),
  (hkt.sv(2), hkt.ca(), hkt.pa2(), NULL, 'en_proceso'),
  (hkt.sv(3), hkt.cb(), hkt.pb1(), NULL, 'en_proceso');
INSERT INTO public.servicios_housekeeping (id, company_id, project_id, estado)
  SELECT hkt.sv(n), hkt.ca(), hkt.pa1(), 'en_proceso' FROM generate_series(4, 30) n;
