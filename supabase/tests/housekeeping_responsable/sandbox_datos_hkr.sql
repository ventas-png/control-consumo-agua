-- ════════════════════════════════════════════════════════════════════════════
-- Datos de prueba «ZZ HKR» para la prueba de NAVEGADOR en el SANDBOX (jwpmivhvlstslncrtokb)
-- ════════════════════════════════════════════════════════════════════════════
-- Solo para el sandbox. Ids fijos con prefijo 5b5b3000 (los demás ZZ usan 5b5b1000/5b5b2000).
-- Las contraseñas llegan por psql -v / sustitución: este archivo NO las contiene.
-- Retirada: sandbox_limpieza_hkr.sql (ensayo → autorización → aplicar).
--
-- Empresa A «ZZ HKR Empresa» (…000c): proyectos P1 (…00a1) y P2 (…00a2).
--   f1 Dueña (company_owner)                      → elegible en P1 y P2 (exenta)
--   f2 Operadora P1 con módulo (operator, P1)     → elegible en P1 (crea; se autoasigna)
--   f3 Operador P1 bis con módulo (operator, P1)  → elegible en P1 (otro autorizado)
--   f4 Operador P2 con módulo (operator, P2)      → NO elegible en P1 (otro proyecto)
--   f5 Operador P1 SIN módulo (operator, P1, rol de cuotas) → NO elegible (sin módulo)
--   f6 Operador P1 deshabilitado (operator, P1, activo=false) → NO elegible
-- Empresa B «ZZ HKR Otra empresa» (…000d): proyecto PB (…00a3).
--   f7 Admin B (admin)                            → NO elegible en A (otra empresa)
-- Rol «ZZ HKR Housekeeping» (…00e8): tab + create + edit + change_status.
-- Rol «ZZ HKR Cuotas» (…00e9): condominios.tab.cuotas (sin housekeeping).
-- ════════════════════════════════════════════════════════════════════════════
DO $hkr$
DECLARE
  ca  constant uuid := '5b5b3000-0000-0000-0000-00000000000c';
  cb  constant uuid := '5b5b3000-0000-0000-0000-00000000000d';
  p1  constant uuid := '5b5b3000-0000-0000-0000-0000000000a1';
  p2  constant uuid := '5b5b3000-0000-0000-0000-0000000000a2';
  pb  constant uuid := '5b5b3000-0000-0000-0000-0000000000a3';
  rhk constant uuid := '5b5b3000-0000-0000-0000-0000000000e8';
  rcu constant uuid := '5b5b3000-0000-0000-0000-0000000000e9';
  u uuid; n int;
  cuentas constant jsonb := jsonb_build_array(
    jsonb_build_object('n', 1, 'nombre', 'ZZ HKR Dueña',        'rol', 'company_owner', 'empresa', ca, 'proyecto', NULL, 'activo', true,  'rbac', NULL),
    jsonb_build_object('n', 2, 'nombre', 'ZZ HKR Operadora P1', 'rol', 'operator',      'empresa', ca, 'proyecto', p1,   'activo', true,  'rbac', rhk),
    jsonb_build_object('n', 3, 'nombre', 'ZZ HKR Operador P1 bis', 'rol', 'operator',   'empresa', ca, 'proyecto', p1,   'activo', true,  'rbac', rhk),
    jsonb_build_object('n', 4, 'nombre', 'ZZ HKR Operador P2',  'rol', 'operator',      'empresa', ca, 'proyecto', p2,   'activo', true,  'rbac', rhk),
    jsonb_build_object('n', 5, 'nombre', 'ZZ HKR Sin modulo',   'rol', 'operator',      'empresa', ca, 'proyecto', p1,   'activo', true,  'rbac', rcu),
    jsonb_build_object('n', 6, 'nombre', 'ZZ HKR Deshabilitado','rol', 'operator',      'empresa', ca, 'proyecto', p1,   'activo', false, 'rbac', rhk),
    jsonb_build_object('n', 7, 'nombre', 'ZZ HKR Admin B',      'rol', 'admin',         'empresa', cb, 'proyecto', NULL, 'activo', true,  'rbac', NULL)
  );
  c jsonb;
BEGIN
  IF EXISTS (SELECT 1 FROM public.companies WHERE id IN (ca, cb)) THEN
    RAISE EXCEPTION 'ABORTA: los datos ZZ HKR ya existen';
  END IF;
  INSERT INTO public.companies (id, nombre) VALUES (ca, 'ZZ HKR Empresa'), (cb, 'ZZ HKR Otra empresa');
  INSERT INTO public.projects (id, company_id, nombre) VALUES
    (p1, ca, 'ZZ HKR Proyecto 1'), (p2, ca, 'ZZ HKR Proyecto 2'), (pb, cb, 'ZZ HKR Proyecto B');
  INSERT INTO public.roles (id, company_id, name, description, is_system) VALUES
    (rhk, ca, 'ZZ HKR Housekeeping', 'Prueba: módulo de housekeeping', false),
    (rcu, ca, 'ZZ HKR Cuotas', 'Prueba: sin housekeeping', false);
  INSERT INTO public.role_permissions (role_id, permission_key, effect) VALUES
    (rhk, 'condominios.tab.housekeeping', 'allow'),
    (rhk, 'condominios.tab.housekeeping.create', 'allow'),
    (rhk, 'condominios.tab.housekeeping.edit', 'allow'),
    (rhk, 'condominios.tab.housekeeping.change_status', 'allow'),
    (rcu, 'condominios.tab.cuotas', 'allow');

  FOR c IN SELECT * FROM jsonb_array_elements(cuentas) LOOP
    n := (c->>'n')::int;
    u := ('5b5b3000-0000-0000-0000-0000000000f' || n)::uuid;
    INSERT INTO auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
                            raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
                            confirmation_token, recovery_token, email_change, email_change_token_new,
                            email_change_token_current, phone_change, phone_change_token, reauthentication_token)
    VALUES ('00000000-0000-0000-0000-000000000000', u, 'authenticated', 'authenticated',
            'zz-hkr-' || n || '@example.invalid',
            crypt(current_setting('hkr.pw' || n, false), gen_salt('bf')), now(),
            '{"provider":"email","providers":["email"]}'::jsonb, jsonb_build_object('full_name', c->>'nombre'),
            now(), now(), '', '', '', '', '', '', '', '');
    INSERT INTO auth.identities (id, user_id, provider_id, provider, identity_data, last_sign_in_at, created_at, updated_at)
    VALUES (gen_random_uuid(), u, u::text, 'email',
            jsonb_build_object('sub', u::text, 'email', 'zz-hkr-' || n || '@example.invalid', 'email_verified', true),
            now(), now(), now());
    INSERT INTO public.app_users (id, full_name, role, company_id, project_id, activo)
    VALUES (u, c->>'nombre', c->>'rol', (c->>'empresa')::uuid, (c->>'proyecto')::uuid, (c->>'activo')::boolean);
    IF c->>'rbac' IS NOT NULL THEN
      INSERT INTO public.user_roles (user_id, role_id) VALUES (u, (c->>'rbac')::uuid);
    END IF;
    -- El acceso al proyecto de un operador es la asignación (user_project_assignments), no app_users.project_id.
    IF c->>'proyecto' IS NOT NULL THEN
      INSERT INTO public.user_project_assignments (user_id, project_id, permission_type) VALUES (u, (c->>'proyecto')::uuid, 'total');
    END IF;
  END LOOP;
  -- Un servicio HEREDADO (responsable como texto) en P1, sin usuario vinculado.
  INSERT INTO public.servicios_housekeeping (id, company_id, project_id, tipo, fecha, responsable, estado, notas)
  VALUES ('5b5b3000-0000-0000-0000-0000000000b1', ca, p1, 'limpieza_estandar', '2026-09-20', 'Limpiador Antiguo', 'completado', 'ZZ HKR heredado');
  RAISE NOTICE 'ZZ HKR creado: 2 empresas, 3 proyectos, 7 cuentas, 5 asignaciones de proyecto, 2 roles, 1 servicio heredado';
END $hkr$;
