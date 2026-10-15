-- ════════════════════════════════════════════════════════════════════════════
-- Datos de prueba «ZZ HKF» para la prueba de NAVEGADOR en el SANDBOX (jwpmivhvlstslncrtokb)
-- ════════════════════════════════════════════════════════════════════════════
-- Solo para el sandbox. Ids fijos con prefijo 5b5b4000 (ZZ HKR usó 5b5b3000).
-- Las contraseñas llegan por set_config('hkf.pwN', …): este archivo NO las contiene.
-- Retirada: sandbox_limpieza_hkf.sql (ensayo → autorización → aplicar).
--
-- Empresa A «ZZ HKF Empresa» (…000c), zona America/Guatemala: proyectos P1 (…00a1) y P2 (…00a2).
--   g1 Dueña (company_owner)                          → recibe el informe
--   g2 Operadora P1 con módulo de housekeeping (operator, P1) → crea, inicia y finaliza
--   g3 Admin P1 (admin, asignado a P1)                → recibe el informe; puede saltar/reabrir
--   g4 Admin P2 (admin, asignado SOLO a P2)           → NO recibe el informe de P1
--   g5 Operadora STR P1 (operator, P1, rol STR crear) → carga masiva de reservas
-- Empresa B «ZZ HKF Otra empresa» (…000d): proyecto PB (…00a3).
--   g6 Admin B (admin)                                → nada de A
-- Unidades P1: «ZZ HKF Apto 1A» (…00d1), «ZZ HKF Apto 2B» (…00d2). P2: «ZZ HKF Casa 3» (…00d3).
-- Reservas P1: HKF-EN-CURSO (Apto 1A, en_curso), HKF-FUTURA (Apto 2B, confirmada),
--   HKF-CANCELADA (Apto 1A, cancelada: no debe aparecer en el selector).
-- Roles: «ZZ HKF Housekeeping» (…00e8): tab+create+edit+change_status; «ZZ HKF STR» (…00e9): tab.str + create.
-- ════════════════════════════════════════════════════════════════════════════
DO $hkf$
DECLARE
  ca  constant uuid := '5b5b4000-0000-0000-0000-00000000000c';
  cb  constant uuid := '5b5b4000-0000-0000-0000-00000000000d';
  p1  constant uuid := '5b5b4000-0000-0000-0000-0000000000a1';
  p2  constant uuid := '5b5b4000-0000-0000-0000-0000000000a2';
  pb  constant uuid := '5b5b4000-0000-0000-0000-0000000000a3';
  rhk constant uuid := '5b5b4000-0000-0000-0000-0000000000e8';
  rst constant uuid := '5b5b4000-0000-0000-0000-0000000000e9';
  u uuid; n int;
  cuentas constant jsonb := jsonb_build_array(
    jsonb_build_object('n', 1, 'nombre', 'ZZ HKF Dueña',         'rol', 'company_owner', 'empresa', ca, 'proyecto', NULL, 'rbac', NULL),
    jsonb_build_object('n', 2, 'nombre', 'ZZ HKF Operadora P1',  'rol', 'operator',      'empresa', ca, 'proyecto', p1,   'rbac', rhk),
    jsonb_build_object('n', 3, 'nombre', 'ZZ HKF Admin P1',      'rol', 'admin',         'empresa', ca, 'proyecto', p1,   'rbac', NULL),
    jsonb_build_object('n', 4, 'nombre', 'ZZ HKF Admin P2',      'rol', 'admin',         'empresa', ca, 'proyecto', p2,   'rbac', NULL),
    jsonb_build_object('n', 5, 'nombre', 'ZZ HKF Operadora STR', 'rol', 'operator',      'empresa', ca, 'proyecto', p1,   'rbac', rst),
    jsonb_build_object('n', 6, 'nombre', 'ZZ HKF Admin B',       'rol', 'admin',         'empresa', cb, 'proyecto', NULL, 'rbac', NULL)
  );
  c jsonb;
BEGIN
  IF EXISTS (SELECT 1 FROM public.companies WHERE id IN (ca, cb)) THEN
    RAISE EXCEPTION 'ABORTA: los datos ZZ HKF ya existen';
  END IF;
  INSERT INTO public.companies (id, nombre, timezone) VALUES (ca, 'ZZ HKF Empresa', 'America/Guatemala'), (cb, 'ZZ HKF Otra empresa', 'America/Guatemala');
  INSERT INTO public.projects (id, company_id, nombre) VALUES
    (p1, ca, 'ZZ HKF Proyecto 1'), (p2, ca, 'ZZ HKF Proyecto 2'), (pb, cb, 'ZZ HKF Proyecto B');
  INSERT INTO public.roles (id, company_id, name, description, is_system) VALUES
    (rhk, ca, 'ZZ HKF Housekeeping', 'Prueba: módulo de housekeeping', false),
    (rst, ca, 'ZZ HKF STR', 'Prueba: reservas STR con creación', false);
  INSERT INTO public.role_permissions (role_id, permission_key, effect) VALUES
    (rhk, 'condominios.tab.housekeeping', 'allow'),
    (rhk, 'condominios.tab.housekeeping.create', 'allow'),
    (rhk, 'condominios.tab.housekeeping.edit', 'allow'),
    (rhk, 'condominios.tab.housekeeping.change_status', 'allow'),
    (rst, 'condominios.tab.str', 'allow'),
    (rst, 'condominios.tab.str.create', 'allow');

  FOR c IN SELECT * FROM jsonb_array_elements(cuentas) LOOP
    n := (c->>'n')::int;
    u := ('5b5b4000-0000-0000-0000-0000000000f' || n)::uuid;
    INSERT INTO auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
                            raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
                            confirmation_token, recovery_token, email_change, email_change_token_new,
                            email_change_token_current, phone_change, phone_change_token, reauthentication_token)
    VALUES ('00000000-0000-0000-0000-000000000000', u, 'authenticated', 'authenticated',
            'zz-hkf-' || n || '@example.invalid',
            crypt(current_setting('hkf.pw' || n, false), gen_salt('bf')), now(),
            '{"provider":"email","providers":["email"]}'::jsonb, jsonb_build_object('full_name', c->>'nombre'),
            now(), now(), '', '', '', '', '', '', '', '');
    INSERT INTO auth.identities (id, user_id, provider_id, provider, identity_data, last_sign_in_at, created_at, updated_at)
    VALUES (gen_random_uuid(), u, u::text, 'email',
            jsonb_build_object('sub', u::text, 'email', 'zz-hkf-' || n || '@example.invalid', 'email_verified', true),
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

  INSERT INTO public.unidades (id, project_id, company_id, nombre, tipo) VALUES
    ('5b5b4000-0000-0000-0000-0000000000d1', p1, ca, 'ZZ HKF Apto 1A', 'apartamento'),
    ('5b5b4000-0000-0000-0000-0000000000d2', p1, ca, 'ZZ HKF Apto 2B', 'apartamento'),
    ('5b5b4000-0000-0000-0000-0000000000d3', p2, ca, 'ZZ HKF Casa 3', 'casa');
  INSERT INTO public.reservas_str (id, company_id, project_id, unidad_id, huesped_nombre, huesped_telefono, huesped_email, fecha_entrada, fecha_salida, hora_llegada_estimada, plataforma, estado, codigo_confirmacion) VALUES
    ('5b5b4000-0000-0000-0000-0000000000b1', ca, p1, '5b5b4000-0000-0000-0000-0000000000d1', 'ZZ HKF Huésped En Curso', '+502 5555 0001', 'huesped1@example.invalid', current_date - 1, current_date + 2, '15:00', 'airbnb', 'en_curso', 'HKF-EN-CURSO'),
    ('5b5b4000-0000-0000-0000-0000000000b2', ca, p1, '5b5b4000-0000-0000-0000-0000000000d2', 'ZZ HKF Huésped Futuro', NULL, NULL, current_date + 10, current_date + 14, '14:00', 'booking', 'confirmada', 'HKF-FUTURA'),
    ('5b5b4000-0000-0000-0000-0000000000b3', ca, p1, '5b5b4000-0000-0000-0000-0000000000d1', 'ZZ HKF Cancelado', NULL, NULL, current_date + 20, current_date + 22, NULL, 'directo', 'cancelada', 'HKF-CANCELADA');
  RAISE NOTICE 'ZZ HKF creado: 2 empresas, 3 proyectos, 6 cuentas, 2 roles, 3 unidades, 3 reservas';
END $hkf$;
