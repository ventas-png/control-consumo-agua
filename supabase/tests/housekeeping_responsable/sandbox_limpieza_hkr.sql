-- ════════════════════════════════════════════════════════════════════════════
-- Retirada de los datos de prueba «ZZ HKR» del SANDBOX (jwpmivhvlstslncrtokb)
-- ════════════════════════════════════════════════════════════════════════════
-- Solo toca los identificadores EXACTOS de sandbox_datos_hkr.sql (nunca LIKE). Un bloque
-- atómico: guardas, borrado hijos → padres, auditoría al final (los disparadores de roles,
-- asignaciones y suscripciones insertan filas al borrar), verificación de que no queda nada y
-- de que las filas ajenas no cambian. `modo := 'ensayo'` revierte y devuelve el informe;
-- `'aplicar'` confirma. Antes de aplicar: ensayo → autorización de la persona responsable.
CREATE TEMP TABLE IF NOT EXISTS hkr_informe (paso int, tabla text, filas bigint);
DO $limpieza$
DECLARE
  modo constant text := 'ensayo';   -- ← 'aplicar' para confirmar
  empresas constant uuid[] := ARRAY['5b5b3000-0000-0000-0000-00000000000c', '5b5b3000-0000-0000-0000-00000000000d']::uuid[];
  proyectos constant uuid[] := ARRAY['5b5b3000-0000-0000-0000-0000000000a1', '5b5b3000-0000-0000-0000-0000000000a2', '5b5b3000-0000-0000-0000-0000000000a3']::uuid[];
  usuarios constant uuid[] := ARRAY['5b5b3000-0000-0000-0000-0000000000f1', '5b5b3000-0000-0000-0000-0000000000f2', '5b5b3000-0000-0000-0000-0000000000f3',
                                    '5b5b3000-0000-0000-0000-0000000000f4', '5b5b3000-0000-0000-0000-0000000000f5', '5b5b3000-0000-0000-0000-0000000000f6',
                                    '5b5b3000-0000-0000-0000-0000000000f7']::uuid[];
  roles_ constant uuid[] := ARRAY['5b5b3000-0000-0000-0000-0000000000e8', '5b5b3000-0000-0000-0000-0000000000e9']::uuid[];
  n bigint; p int := 0; ajenos_antes bigint; ajenos_despues bigint; informe text;
BEGIN
  DELETE FROM hkr_informe;
  IF (SELECT count(*) FROM public.companies WHERE (id, nombre) IN
        (('5b5b3000-0000-0000-0000-00000000000c'::uuid, 'ZZ HKR Empresa'), ('5b5b3000-0000-0000-0000-00000000000d'::uuid, 'ZZ HKR Otra empresa'))) <> 2
     OR (SELECT count(*) FROM auth.users WHERE id = ANY (usuarios) AND email LIKE 'zz-hkr-%@example.invalid') <> 7
     OR (SELECT count(*) FROM public.roles WHERE id = ANY (roles_) AND name LIKE 'ZZ HKR %') <> 2 THEN
    RAISE EXCEPTION 'ABORTA: los identificadores no son los de ZZ HKR (o ya se retiraron)';
  END IF;
  IF (SELECT count(*) FROM public.servicio_housekeeping_fotos WHERE company_id = ANY (empresas)) <> 0
     OR (SELECT count(*) FROM storage.objects WHERE bucket_id = 'housekeeping-evidencias' AND split_part(name, '/', 1) = ANY (proyectos::text[])) <> 0
     OR (SELECT count(*) FROM public.hk_limpieza_storage WHERE company_id = ANY (empresas)) <> 0 THEN
    RAISE EXCEPTION 'ABORTA: quedan fotos, objetos o cola de housekeeping de la prueba; retirarlos primero por las RPC';
  END IF;
  -- Filas ajenas: todo lo que no es de la prueba, en las tablas que se tocan.
  SELECT (SELECT count(*) FROM public.servicios_housekeeping WHERE company_id <> ALL (empresas))
       + (SELECT count(*) FROM public.app_users WHERE id <> ALL (usuarios))
       + (SELECT count(*) FROM public.companies WHERE id <> ALL (empresas))
       + (SELECT count(*) FROM public.projects WHERE id <> ALL (proyectos))
       + (SELECT count(*) FROM public.roles WHERE id <> ALL (roles_))
       + (SELECT count(*) FROM auth.users WHERE id <> ALL (usuarios)) INTO ajenos_antes;

  DELETE FROM public.servicios_housekeeping WHERE company_id = ANY (empresas); GET DIAGNOSTICS n = ROW_COUNT; p := p + 1; INSERT INTO hkr_informe VALUES (p, 'servicios_housekeeping', n);
  DELETE FROM public.user_project_assignments WHERE user_id = ANY (usuarios) OR project_id = ANY (proyectos); GET DIAGNOSTICS n = ROW_COUNT; p := p + 1; INSERT INTO hkr_informe VALUES (p, 'user_project_assignments', n);
  DELETE FROM public.user_roles WHERE user_id = ANY (usuarios) OR role_id = ANY (roles_); GET DIAGNOSTICS n = ROW_COUNT; p := p + 1; INSERT INTO hkr_informe VALUES (p, 'user_roles', n);
  DELETE FROM public.role_permissions WHERE role_id = ANY (roles_); GET DIAGNOSTICS n = ROW_COUNT; p := p + 1; INSERT INTO hkr_informe VALUES (p, 'role_permissions', n);
  DELETE FROM public.roles WHERE id = ANY (roles_); GET DIAGNOSTICS n = ROW_COUNT; p := p + 1; INSERT INTO hkr_informe VALUES (p, 'roles', n);
  DELETE FROM public.user_presence WHERE user_id = ANY (usuarios); GET DIAGNOSTICS n = ROW_COUNT; p := p + 1; INSERT INTO hkr_informe VALUES (p, 'user_presence', n);
  DELETE FROM public.bitacora_acciones WHERE usuario_id = ANY (usuarios) OR company_id = ANY (empresas); GET DIAGNOSTICS n = ROW_COUNT; p := p + 1; INSERT INTO hkr_informe VALUES (p, 'bitacora_acciones', n);
  DELETE FROM public.app_users WHERE id = ANY (usuarios); GET DIAGNOSTICS n = ROW_COUNT; p := p + 1; INSERT INTO hkr_informe VALUES (p, 'app_users', n);
  DELETE FROM auth.refresh_tokens WHERE user_id::text = ANY (usuarios::text[]); GET DIAGNOSTICS n = ROW_COUNT; p := p + 1; INSERT INTO hkr_informe VALUES (p, 'auth.refresh_tokens', n);
  DELETE FROM auth.sessions WHERE user_id = ANY (usuarios); GET DIAGNOSTICS n = ROW_COUNT; p := p + 1; INSERT INTO hkr_informe VALUES (p, 'auth.sessions', n);
  DELETE FROM auth.identities WHERE user_id = ANY (usuarios); GET DIAGNOSTICS n = ROW_COUNT; p := p + 1; INSERT INTO hkr_informe VALUES (p, 'auth.identities', n);
  DELETE FROM auth.users WHERE id = ANY (usuarios); GET DIAGNOSTICS n = ROW_COUNT; p := p + 1; INSERT INTO hkr_informe VALUES (p, 'auth.users', n);
  DELETE FROM public.projects WHERE id = ANY (proyectos); GET DIAGNOSTICS n = ROW_COUNT; p := p + 1; INSERT INTO hkr_informe VALUES (p, 'projects', n);
  DELETE FROM public.subscriptions WHERE company_id = ANY (empresas); GET DIAGNOSTICS n = ROW_COUNT; p := p + 1; INSERT INTO hkr_informe VALUES (p, 'subscriptions', n);
  DELETE FROM public.companies WHERE id = ANY (empresas); GET DIAGNOSTICS n = ROW_COUNT; p := p + 1; INSERT INTO hkr_informe VALUES (p, 'companies', n);
  -- Auditoría al final: los disparadores insertan al borrar roles/llaves/asignaciones/suscripciones.
  DELETE FROM public.permission_audit_log WHERE target_user_id = ANY (usuarios) OR target_role_id = ANY (roles_) OR actor_id = ANY (usuarios)
     OR (details->>'role_id')::uuid = ANY (roles_) OR (details->>'user_id')::uuid = ANY (usuarios); GET DIAGNOSTICS n = ROW_COUNT; p := p + 1; INSERT INTO hkr_informe VALUES (p, 'permission_audit_log', n);
  DELETE FROM public.audit_log WHERE company_id = ANY (empresas) OR actor_id = ANY (usuarios); GET DIAGNOSTICS n = ROW_COUNT; p := p + 1; INSERT INTO hkr_informe VALUES (p, 'audit_log', n);

  SELECT (SELECT count(*) FROM public.servicios_housekeeping WHERE company_id <> ALL (empresas))
       + (SELECT count(*) FROM public.app_users WHERE id <> ALL (usuarios))
       + (SELECT count(*) FROM public.companies WHERE id <> ALL (empresas))
       + (SELECT count(*) FROM public.projects WHERE id <> ALL (proyectos))
       + (SELECT count(*) FROM public.roles WHERE id <> ALL (roles_))
       + (SELECT count(*) FROM auth.users WHERE id <> ALL (usuarios)) INTO ajenos_despues;
  IF ajenos_antes <> ajenos_despues THEN RAISE EXCEPTION 'ABORTA: cambió el número de filas ajenas (% → %)', ajenos_antes, ajenos_despues; END IF;
  IF (SELECT count(*) FROM public.companies WHERE id = ANY (empresas)) + (SELECT count(*) FROM auth.users WHERE id = ANY (usuarios))
     + (SELECT count(*) FROM public.roles WHERE id = ANY (roles_)) + (SELECT count(*) FROM public.projects WHERE id = ANY (proyectos)) <> 0 THEN
    RAISE EXCEPTION 'ABORTA: quedan filas de la prueba';
  END IF;
  SELECT string_agg(tabla || '=' || filas, ', ' ORDER BY paso) INTO informe FROM hkr_informe;
  IF modo = 'ensayo' THEN
    RAISE EXCEPTION 'ENSAYO (revertido): % · filas ajenas (antes = después)=%', informe, ajenos_antes;
  END IF;
  RAISE NOTICE 'APLICADO: % · filas ajenas (antes = después)=%', informe, ajenos_antes;
END $limpieza$;
