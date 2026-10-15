-- ════════════════════════════════════════════════════════════════════════════
-- Datos de prueba «ZZ PLA» para la prueba de NAVEGADOR en el SANDBOX (jwpmivhvlstslncrtokb)
-- ════════════════════════════════════════════════════════════════════════════
-- Solo para el sandbox. Ids fijos con prefijo 5b5b5000 (ZZ HKF usó 5b5b4000).
-- Las contraseñas llegan por set_config('pla.pwN', …): este archivo NO las contiene.
-- Retirada: sandbox_limpieza_pla.sql (ensayo → aplicar; borra también lo que creó la prueba:
-- actividades, puentes y lotes de la empresa).
--
-- Empresa A «ZZ PLA Empresa» (…000c): proyectos P1 (…00a1) y P2 (…00a2).
--   g1 Dueña (company_owner)                                   → todo sin permisos explícitos
--   g2 Operadora P1 (operator, P1, rol «ZZ PLA Plantillas»)     → carga masiva y recursos en bloque
--   g3 Operadora P1 solo lectura (operator, P1, «ZZ PLA Solo ver») → ni casillas ni carga masiva
-- Empresa B «ZZ PLA Otra empresa» (…000d): proyecto PB (…00a3).
--   g4 Admin B (admin)                                         → nada de A
-- P1: área «ZZ PLA Pasillos» (…00b1); insumos «ZZ PLA Escoba» (…00c1), «ZZ PLA Bolsa» (…00c2),
--   «ZZ PLA Cloro» INACTIVO (…00c3); inventario «ZZ PLA Trapeador» herramienta (…00d1),
--   «ZZ PLA Carretilla» herramienta (…00d2), «ZZ PLA Hidrolavadora» equipo (…00d3);
--   actividad existente «ZZ PLA Barrido» conserje / limpieza (…00e1).
-- P2: actividad «ZZ PLA Otra» (…00e2) (alcance del bloque).
-- Roles: «ZZ PLA Plantillas» (…00e8): tab.plantillas_cargo + .create + .edit + tab.suministros;
--        «ZZ PLA Solo ver» (…00e9): tab.plantillas_cargo.
-- ════════════════════════════════════════════════════════════════════════════
DO $pla$
DECLARE
  ca  constant uuid := '5b5b5000-0000-0000-0000-00000000000c';
  cb  constant uuid := '5b5b5000-0000-0000-0000-00000000000d';
  p1  constant uuid := '5b5b5000-0000-0000-0000-0000000000a1';
  p2  constant uuid := '5b5b5000-0000-0000-0000-0000000000a2';
  pb  constant uuid := '5b5b5000-0000-0000-0000-0000000000a3';
  rpl constant uuid := '5b5b5000-0000-0000-0000-0000000000e8';
  rsv constant uuid := '5b5b5000-0000-0000-0000-0000000000e9';
  u uuid; n int;
  cuentas constant jsonb := jsonb_build_array(
    jsonb_build_object('n', 1, 'nombre', 'ZZ PLA Dueña',               'rol', 'company_owner', 'empresa', ca, 'proyecto', NULL, 'rbac', NULL),
    jsonb_build_object('n', 2, 'nombre', 'ZZ PLA Operadora P1',        'rol', 'operator',      'empresa', ca, 'proyecto', p1,   'rbac', rpl),
    jsonb_build_object('n', 3, 'nombre', 'ZZ PLA Solo lectura P1',     'rol', 'operator',      'empresa', ca, 'proyecto', p1,   'rbac', rsv),
    jsonb_build_object('n', 4, 'nombre', 'ZZ PLA Admin B',             'rol', 'admin',         'empresa', cb, 'proyecto', NULL, 'rbac', NULL)
  );
  c jsonb;
BEGIN
  IF EXISTS (SELECT 1 FROM public.companies WHERE id IN (ca, cb)) THEN
    RAISE EXCEPTION 'ABORTA: los datos ZZ PLA ya existen';
  END IF;
  INSERT INTO public.companies (id, nombre, timezone) VALUES (ca, 'ZZ PLA Empresa', 'America/Guatemala'), (cb, 'ZZ PLA Otra empresa', 'America/Guatemala');
  INSERT INTO public.projects (id, company_id, nombre) VALUES
    (p1, ca, 'ZZ PLA Proyecto 1'), (p2, ca, 'ZZ PLA Proyecto 2'), (pb, cb, 'ZZ PLA Proyecto B');
  INSERT INTO public.roles (id, company_id, name, description, is_system) VALUES
    (rpl, ca, 'ZZ PLA Plantillas', 'Prueba: catálogo de actividades con carga masiva y recursos', false),
    (rsv, ca, 'ZZ PLA Solo ver', 'Prueba: catálogo de actividades en consulta', false);
  INSERT INTO public.role_permissions (role_id, permission_key, effect) VALUES
    (rpl, 'condominios.tab.plantillas_cargo', 'allow'),
    (rpl, 'condominios.tab.plantillas_cargo.create', 'allow'),
    (rpl, 'condominios.tab.plantillas_cargo.edit', 'allow'),
    (rpl, 'condominios.tab.suministros', 'allow'),
    (rsv, 'condominios.tab.plantillas_cargo', 'allow');

  FOR c IN SELECT * FROM jsonb_array_elements(cuentas) LOOP
    n := (c->>'n')::int;
    u := ('5b5b5000-0000-0000-0000-0000000000f' || n)::uuid;
    INSERT INTO auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
                            raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
                            confirmation_token, recovery_token, email_change, email_change_token_new,
                            email_change_token_current, phone_change, phone_change_token, reauthentication_token)
    VALUES ('00000000-0000-0000-0000-000000000000', u, 'authenticated', 'authenticated',
            'zz-pla-' || n || '@example.invalid',
            crypt(current_setting('pla.pw' || n, false), gen_salt('bf')), now(),
            '{"provider":"email","providers":["email"]}'::jsonb, jsonb_build_object('full_name', c->>'nombre'),
            now(), now(), '', '', '', '', '', '', '', '');
    INSERT INTO auth.identities (id, user_id, provider_id, provider, identity_data, last_sign_in_at, created_at, updated_at)
    VALUES (gen_random_uuid(), u, u::text, 'email',
            jsonb_build_object('sub', u::text, 'email', 'zz-pla-' || n || '@example.invalid', 'email_verified', true),
            now(), now(), now());
    INSERT INTO public.app_users (id, full_name, role, company_id, project_id, activo)
    VALUES (u, c->>'nombre', c->>'rol', (c->>'empresa')::uuid, (c->>'proyecto')::uuid, true);
    IF c->>'rbac' IS NOT NULL THEN
      INSERT INTO public.user_roles (user_id, role_id) VALUES (u, (c->>'rbac')::uuid);
    END IF;
    IF c->>'proyecto' IS NOT NULL THEN
      INSERT INTO public.user_project_assignments (user_id, project_id, permission_type) VALUES (u, (c->>'proyecto')::uuid, 'total');
    END IF;
  END LOOP;

  INSERT INTO public.areas_condominio (id, company_id, project_id, nombre, icono, orden, activo) VALUES
    ('5b5b5000-0000-0000-0000-0000000000b1', ca, p1, 'ZZ PLA Pasillos', '🚪', 1, true);
  INSERT INTO public.suministros_condominio (id, company_id, project_id, nombre, categoria, unidad_medida, activo) VALUES
    ('5b5b5000-0000-0000-0000-0000000000c1', ca, p1, 'ZZ PLA Escoba', 'limpieza', 'unidad', true),
    ('5b5b5000-0000-0000-0000-0000000000c2', ca, p1, 'ZZ PLA Bolsa',  'limpieza', 'unidad', true),
    ('5b5b5000-0000-0000-0000-0000000000c3', ca, p1, 'ZZ PLA Cloro',  'limpieza', 'litro',  false);
  INSERT INTO public.inventario_condominio (id, company_id, project_id, nombre, categoria, estado, cantidad) VALUES
    ('5b5b5000-0000-0000-0000-0000000000d1', ca, p1, 'ZZ PLA Trapeador',    'herramienta', 'disponible', 2),
    ('5b5b5000-0000-0000-0000-0000000000d2', ca, p1, 'ZZ PLA Carretilla',   'herramienta', 'disponible', 1),
    ('5b5b5000-0000-0000-0000-0000000000d3', ca, p1, 'ZZ PLA Hidrolavadora','equipo',      'disponible', 1);
  INSERT INTO public.plantillas_tarea_cargo (id, company_id, project_id, cargo, titulo, servicio, duracion_estimada_min, icono, orden) VALUES
    ('5b5b5000-0000-0000-0000-0000000000e1', ca, p1, 'conserje', 'ZZ PLA Barrido', 'limpieza', 20, '🧹', 1),
    ('5b5b5000-0000-0000-0000-0000000000e2', ca, p2, 'conserje', 'ZZ PLA Otra',    'otro',     NULL, '✅', 1);
  RAISE NOTICE 'ZZ PLA creado: 2 empresas, 3 proyectos, 4 cuentas, 2 roles, 1 área, 3 insumos, 3 artículos, 2 actividades';
END $pla$;
