-- ════════════════════════════════════════════════════════════════════════════
-- Datos de prueba «ZZ RRH» para la prueba de NAVEGADOR en el SANDBOX (jwpmivhvlstslncrtokb)
-- ════════════════════════════════════════════════════════════════════════════
-- Solo para el sandbox. Ids fijos con prefijo 5b5b6000 (ZZ PLA usó 5b5b5000).
-- Las contraseñas llegan por set_config('rrh.pwN', …): este archivo NO las contiene.
-- Se corre DESPUÉS de 20261031000300: los proyectos nacen con sus 6 cargos y 3 turnos
-- (trigger) y el personal se valida contra ellos.
-- Retirada: sandbox_limpieza_rrh.sql (ensayo → aplicar; borra también lo que creó la prueba).
--
-- Empresa A «ZZ RRH Empresa» (…000c): proyectos P1 (…00a1) y P2 (…00a2).
--   h1 Dueña (company_owner)                                        → todo
--   h2 Operadora P1 (operator, P1, rol «ZZ RRH Config»)             → configura el catálogo y el personal
--   h3 Operadora P1 solo personal (operator, P1, «ZZ RRH Solo personal») → lee el catálogo, no lo cambia
-- Empresa B «ZZ RRH Otra empresa» (…000d): proyecto PB (…00a3).
--   h4 Admin B (admin)                                              → nada de A
-- P1: cargo propio «ZZ RRH Temporal» (zz_temporal, …00c1) que se DESACTIVA tras asignarlo a Carla
--   (una ficha con cargo apagado); empleados Ana (conserje/diurno, …00e1), Beto (jardinero/nocturno,
--   …00e2), Carla (zz_temporal/diurno, …00e3); área «ZZ RRH Pasillos» (…00b1); actividad
--   «ZZ RRH Barrido» conserje (…00d1); programación «ZZ RRH Pasillos» cargo jardinero (…00f1).
-- Roles: «ZZ RRH Config» (…00e8): rrhh_config + .create + .edit + .delete + personal + .create +
--        .edit + plantillas_cargo + .create + .edit + prog_limpieza;
--        «ZZ RRH Solo personal» (…00e9): personal + .create + .edit.
-- ════════════════════════════════════════════════════════════════════════════
DO $rrh$
DECLARE
  ca  constant uuid := '5b5b6000-0000-0000-0000-00000000000c';
  cb  constant uuid := '5b5b6000-0000-0000-0000-00000000000d';
  p1  constant uuid := '5b5b6000-0000-0000-0000-0000000000a1';
  p2  constant uuid := '5b5b6000-0000-0000-0000-0000000000a2';
  pb  constant uuid := '5b5b6000-0000-0000-0000-0000000000a3';
  rcf constant uuid := '5b5b6000-0000-0000-0000-0000000000e8';
  rsp constant uuid := '5b5b6000-0000-0000-0000-0000000000e9';
  u uuid; n int;
  cuentas constant jsonb := jsonb_build_array(
    jsonb_build_object('n', 1, 'nombre', 'ZZ RRH Dueña',               'rol', 'company_owner', 'empresa', ca, 'proyecto', NULL, 'rbac', NULL),
    jsonb_build_object('n', 2, 'nombre', 'ZZ RRH Operadora P1',        'rol', 'operator',      'empresa', ca, 'proyecto', p1,   'rbac', rcf),
    jsonb_build_object('n', 3, 'nombre', 'ZZ RRH Solo personal P1',    'rol', 'operator',      'empresa', ca, 'proyecto', p1,   'rbac', rsp),
    jsonb_build_object('n', 4, 'nombre', 'ZZ RRH Admin B',             'rol', 'admin',         'empresa', cb, 'proyecto', NULL, 'rbac', NULL)
  );
  c jsonb;
BEGIN
  IF EXISTS (SELECT 1 FROM public.companies WHERE id IN (ca, cb)) THEN
    RAISE EXCEPTION 'ABORTA: los datos ZZ RRH ya existen';
  END IF;
  INSERT INTO public.companies (id, nombre, timezone) VALUES (ca, 'ZZ RRH Empresa', 'America/Guatemala'), (cb, 'ZZ RRH Otra empresa', 'America/Guatemala');
  INSERT INTO public.projects (id, company_id, nombre) VALUES
    (p1, ca, 'ZZ RRH Proyecto 1'), (p2, ca, 'ZZ RRH Proyecto 2'), (pb, cb, 'ZZ RRH Proyecto B');
  IF (SELECT count(*) FROM public.rrhh_cargos WHERE project_id IN (p1, p2, pb)) <> 18
     OR (SELECT count(*) FROM public.rrhh_tipos_turno WHERE project_id IN (p1, p2, pb)) <> 9 THEN
    RAISE EXCEPTION 'ABORTA: los proyectos nuevos no nacieron con 6 cargos y 3 turnos (¿falta 20261031000300?)';
  END IF;
  INSERT INTO public.roles (id, company_id, name, description, is_system) VALUES
    (rcf, ca, 'ZZ RRH Config', 'Prueba: configura cargos y turnos y administra el personal', false),
    (rsp, ca, 'ZZ RRH Solo personal', 'Prueba: administra el personal sin tocar el catálogo', false);
  INSERT INTO public.role_permissions (role_id, permission_key, effect) VALUES
    (rcf, 'condominios.tab.rrhh_config', 'allow'),
    (rcf, 'condominios.tab.rrhh_config.create', 'allow'),
    (rcf, 'condominios.tab.rrhh_config.edit', 'allow'),
    (rcf, 'condominios.tab.rrhh_config.delete', 'allow'),
    (rcf, 'condominios.tab.personal', 'allow'),
    (rcf, 'condominios.tab.personal.create', 'allow'),
    (rcf, 'condominios.tab.personal.edit', 'allow'),
    (rcf, 'condominios.tab.plantillas_cargo', 'allow'),
    (rcf, 'condominios.tab.plantillas_cargo.create', 'allow'),
    (rcf, 'condominios.tab.plantillas_cargo.edit', 'allow'),
    (rcf, 'condominios.tab.prog_limpieza', 'allow'),
    (rsp, 'condominios.tab.personal', 'allow'),
    (rsp, 'condominios.tab.personal.create', 'allow'),
    (rsp, 'condominios.tab.personal.edit', 'allow');

  FOR c IN SELECT * FROM jsonb_array_elements(cuentas) LOOP
    n := (c->>'n')::int;
    u := ('5b5b6000-0000-0000-0000-0000000000f' || n)::uuid;
    INSERT INTO auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
                            raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
                            confirmation_token, recovery_token, email_change, email_change_token_new,
                            email_change_token_current, phone_change, phone_change_token, reauthentication_token)
    VALUES ('00000000-0000-0000-0000-000000000000', u, 'authenticated', 'authenticated',
            'zz-rrh-' || n || '@example.invalid',
            crypt(current_setting('rrh.pw' || n, false), gen_salt('bf')), now(),
            '{"provider":"email","providers":["email"]}'::jsonb, jsonb_build_object('full_name', c->>'nombre'),
            now(), now(), '', '', '', '', '', '', '', '');
    INSERT INTO auth.identities (id, user_id, provider_id, provider, identity_data, last_sign_in_at, created_at, updated_at)
    VALUES (gen_random_uuid(), u, u::text, 'email',
            jsonb_build_object('sub', u::text, 'email', 'zz-rrh-' || n || '@example.invalid', 'email_verified', true),
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

  INSERT INTO public.rrhh_cargos (id, company_id, project_id, codigo, nombre, icono, orden) VALUES
    ('5b5b6000-0000-0000-0000-0000000000c1', ca, p1, 'zz_temporal', 'ZZ RRH Temporal', '🧪', 70);
  INSERT INTO public.areas_condominio (id, company_id, project_id, nombre, icono, orden, activo) VALUES
    ('5b5b6000-0000-0000-0000-0000000000b1', ca, p1, 'ZZ RRH Pasillos', '🚪', 1, true);
  INSERT INTO public.personal_condominio (id, company_id, project_id, nombre, cargo, turno, estado) VALUES
    ('5b5b6000-0000-0000-0000-0000000000e1', ca, p1, 'ZZ RRH Ana',   'conserje',    'diurno',   'activo'),
    ('5b5b6000-0000-0000-0000-0000000000e2', ca, p1, 'ZZ RRH Beto',  'jardinero',   'nocturno', 'activo'),
    ('5b5b6000-0000-0000-0000-0000000000e3', ca, p1, 'ZZ RRH Carla', 'zz_temporal', 'diurno',   'activo');
  UPDATE public.rrhh_cargos SET activo = false WHERE id = '5b5b6000-0000-0000-0000-0000000000c1';
  INSERT INTO public.plantillas_tarea_cargo (id, company_id, project_id, cargo, titulo, servicio, duracion_estimada_min, icono, orden) VALUES
    ('5b5b6000-0000-0000-0000-0000000000d1', ca, p1, 'conserje', 'ZZ RRH Barrido', 'limpieza', 20, '🧹', 1);
  INSERT INTO public.programacion_limpieza (id, company_id, project_id, area, area_id, frecuencia, cargo, turno, activo) VALUES
    ('5b5b6000-0000-0000-0000-0000000000f1', ca, p1, 'ZZ RRH Pasillos', '5b5b6000-0000-0000-0000-0000000000b1', 'diaria', 'jardinero', NULL, true);
  RAISE NOTICE 'ZZ RRH creado: 2 empresas, 3 proyectos (6+3 sembrados cada uno), 4 cuentas, 2 roles, 1 cargo propio (apagado), 3 empleados, 1 área, 1 actividad, 1 programación';
END $rrh$;
