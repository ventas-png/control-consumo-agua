-- ════════════════════════════════════════════════════════════════════════════
-- Retirada de los datos de prueba «ZZ HKF» del SANDBOX (jwpmivhvlstslncrtokb)
-- ════════════════════════════════════════════════════════════════════════════
-- Solo toca los identificadores EXACTOS de sandbox_datos_hkf.sql (nunca LIKE). Un bloque
-- atómico: guardas, borrado hijos → padres, auditoría al final (los disparadores de roles,
-- asignaciones y suscripciones insertan filas al borrar), verificación de que no queda nada y
-- de que las filas ajenas no cambian. `modo := 'ensayo'` revierte y devuelve el informe;
-- `'aplicar'` confirma. Antes de aplicar: ensayo → autorización de la persona responsable.
-- Las fotos de la prueba se retiran ANTES por las RPC (hk_eliminar_servicio) y la cola de
-- limpieza se drena (housekeeping-limpieza); este guion aborta si quedan objetos.
CREATE TEMP TABLE IF NOT EXISTS hkf_informe (paso int, tabla text, filas bigint);
DO $limpieza$
DECLARE
  modo constant text := 'ensayo';   -- ← 'aplicar' para confirmar
  empresas constant uuid[] := ARRAY['5b5b4000-0000-0000-0000-00000000000c', '5b5b4000-0000-0000-0000-00000000000d']::uuid[];
  proyectos constant uuid[] := ARRAY['5b5b4000-0000-0000-0000-0000000000a1', '5b5b4000-0000-0000-0000-0000000000a2', '5b5b4000-0000-0000-0000-0000000000a3']::uuid[];
  usuarios constant uuid[] := ARRAY['5b5b4000-0000-0000-0000-0000000000f1', '5b5b4000-0000-0000-0000-0000000000f2', '5b5b4000-0000-0000-0000-0000000000f3',
                                    '5b5b4000-0000-0000-0000-0000000000f4', '5b5b4000-0000-0000-0000-0000000000f5', '5b5b4000-0000-0000-0000-0000000000f6']::uuid[];
  roles_ constant uuid[] := ARRAY['5b5b4000-0000-0000-0000-0000000000e8', '5b5b4000-0000-0000-0000-0000000000e9']::uuid[];
  n bigint; p int := 0; ajenos_antes bigint; ajenos_despues bigint; informe text;
BEGIN
  DELETE FROM hkf_informe;
  IF (SELECT count(*) FROM public.companies WHERE (id, nombre) IN
        (('5b5b4000-0000-0000-0000-00000000000c'::uuid, 'ZZ HKF Empresa'), ('5b5b4000-0000-0000-0000-00000000000d'::uuid, 'ZZ HKF Otra empresa'))) <> 2
     OR (SELECT count(*) FROM auth.users WHERE id = ANY (usuarios) AND email LIKE 'zz-hkf-%@example.invalid') <> 6
     OR (SELECT count(*) FROM public.roles WHERE id = ANY (roles_) AND name LIKE 'ZZ HKF %') <> 2 THEN
    RAISE EXCEPTION 'ABORTA: los identificadores no son los de ZZ HKF (o ya se retiraron)';
  END IF;
  IF (SELECT count(*) FROM public.servicio_housekeeping_fotos WHERE company_id = ANY (empresas)) <> 0
     OR (SELECT count(*) FROM storage.objects WHERE bucket_id = 'housekeeping-evidencias' AND split_part(name, '/', 1) = ANY (proyectos::text[])) <> 0
     OR (SELECT count(*) FROM public.hk_limpieza_storage WHERE company_id = ANY (empresas)) <> 0 THEN
    RAISE EXCEPTION 'ABORTA: quedan fotos, objetos o cola de housekeeping de la prueba; retirarlos primero por las RPC';
  END IF;
  SELECT (SELECT count(*) FROM public.servicios_housekeeping WHERE company_id <> ALL (empresas))
       + (SELECT count(*) FROM public.reservas_str WHERE company_id <> ALL (empresas))
       + (SELECT count(*) FROM public.app_users WHERE id <> ALL (usuarios))
       + (SELECT count(*) FROM public.companies WHERE id <> ALL (empresas))
       + (SELECT count(*) FROM public.projects WHERE id <> ALL (proyectos))
       + (SELECT count(*) FROM public.roles WHERE id <> ALL (roles_))
       + (SELECT count(*) FROM public.notifications_outbox WHERE company_id IS NULL OR company_id <> ALL (empresas))
       + (SELECT count(*) FROM auth.users WHERE id <> ALL (usuarios)) INTO ajenos_antes;

  -- hijos → padres (lo que no cae en cascada se borra explícito)
  p := p + 1; DELETE FROM public.hk_recordatorios_log WHERE company_id = ANY (empresas); GET DIAGNOSTICS n = ROW_COUNT; INSERT INTO hkf_informe VALUES (p, 'hk_recordatorios_log', n);
  p := p + 1; DELETE FROM public.notifications_outbox WHERE company_id = ANY (empresas); GET DIAGNOSTICS n = ROW_COUNT; INSERT INTO hkf_informe VALUES (p, 'notifications_outbox', n);
  p := p + 1; DELETE FROM public.user_notifications WHERE user_id = ANY (usuarios); GET DIAGNOSTICS n = ROW_COUNT; INSERT INTO hkf_informe VALUES (p, 'user_notifications', n);
  p := p + 1; DELETE FROM public.servicios_housekeeping WHERE company_id = ANY (empresas); GET DIAGNOSTICS n = ROW_COUNT; INSERT INTO hkf_informe VALUES (p, 'servicios_housekeeping', n);
  p := p + 1; DELETE FROM public.str_importacion_filas WHERE company_id = ANY (empresas); GET DIAGNOSTICS n = ROW_COUNT; INSERT INTO hkf_informe VALUES (p, 'str_importacion_filas', n);
  p := p + 1; DELETE FROM public.str_importaciones WHERE company_id = ANY (empresas); GET DIAGNOSTICS n = ROW_COUNT; INSERT INTO hkf_informe VALUES (p, 'str_importaciones', n);
  p := p + 1; DELETE FROM public.huespedes_str WHERE reserva_str_id IN (SELECT id FROM public.reservas_str WHERE company_id = ANY (empresas)); GET DIAGNOSTICS n = ROW_COUNT; INSERT INTO hkf_informe VALUES (p, 'huespedes_str', n);
  p := p + 1; DELETE FROM public.reservas_str WHERE company_id = ANY (empresas); GET DIAGNOSTICS n = ROW_COUNT; INSERT INTO hkf_informe VALUES (p, 'reservas_str', n);
  p := p + 1; DELETE FROM public.unidades WHERE company_id = ANY (empresas); GET DIAGNOSTICS n = ROW_COUNT; INSERT INTO hkf_informe VALUES (p, 'unidades', n);
  p := p + 1; DELETE FROM public.user_project_assignments WHERE user_id = ANY (usuarios); GET DIAGNOSTICS n = ROW_COUNT; INSERT INTO hkf_informe VALUES (p, 'user_project_assignments', n);
  p := p + 1; DELETE FROM public.user_roles WHERE user_id = ANY (usuarios); GET DIAGNOSTICS n = ROW_COUNT; INSERT INTO hkf_informe VALUES (p, 'user_roles', n);
  p := p + 1; DELETE FROM public.role_permissions WHERE role_id = ANY (roles_); GET DIAGNOSTICS n = ROW_COUNT; INSERT INTO hkf_informe VALUES (p, 'role_permissions', n);
  p := p + 1; DELETE FROM public.roles WHERE id = ANY (roles_); GET DIAGNOSTICS n = ROW_COUNT; INSERT INTO hkf_informe VALUES (p, 'roles', n);
  p := p + 1; DELETE FROM public.app_users WHERE id = ANY (usuarios); GET DIAGNOSTICS n = ROW_COUNT; INSERT INTO hkf_informe VALUES (p, 'app_users', n);
  p := p + 1; DELETE FROM public.projects WHERE id = ANY (proyectos); GET DIAGNOSTICS n = ROW_COUNT; INSERT INTO hkf_informe VALUES (p, 'projects', n);
  p := p + 1; DELETE FROM public.companies WHERE id = ANY (empresas); GET DIAGNOSTICS n = ROW_COUNT; INSERT INTO hkf_informe VALUES (p, 'companies', n);
  p := p + 1; DELETE FROM auth.identities WHERE user_id = ANY (usuarios); GET DIAGNOSTICS n = ROW_COUNT; INSERT INTO hkf_informe VALUES (p, 'auth.identities', n);
  p := p + 1; DELETE FROM auth.users WHERE id = ANY (usuarios); GET DIAGNOSTICS n = ROW_COUNT; INSERT INTO hkf_informe VALUES (p, 'auth.users', n);
  -- auditoría que dejan los disparadores al borrar (misma forma que sandbox_limpieza_hkr.sql)
  p := p + 1; DELETE FROM public.bitacora_acciones WHERE usuario_id = ANY (usuarios) OR company_id = ANY (empresas); GET DIAGNOSTICS n = ROW_COUNT; INSERT INTO hkf_informe VALUES (p, 'bitacora_acciones', n);
  p := p + 1; DELETE FROM public.audit_log WHERE actor_id = ANY (usuarios) OR company_id = ANY (empresas); GET DIAGNOSTICS n = ROW_COUNT; INSERT INTO hkf_informe VALUES (p, 'audit_log', n);

  IF (SELECT count(*) FROM public.companies WHERE id = ANY (empresas)) + (SELECT count(*) FROM auth.users WHERE id = ANY (usuarios))
     + (SELECT count(*) FROM public.roles WHERE id = ANY (roles_)) + (SELECT count(*) FROM public.projects WHERE id = ANY (proyectos)) <> 0 THEN
    RAISE EXCEPTION 'ABORTA: quedan filas de ZZ HKF tras el borrado';
  END IF;
  SELECT (SELECT count(*) FROM public.servicios_housekeeping WHERE company_id <> ALL (empresas))
       + (SELECT count(*) FROM public.reservas_str WHERE company_id <> ALL (empresas))
       + (SELECT count(*) FROM public.app_users WHERE id <> ALL (usuarios))
       + (SELECT count(*) FROM public.companies WHERE id <> ALL (empresas))
       + (SELECT count(*) FROM public.projects WHERE id <> ALL (proyectos))
       + (SELECT count(*) FROM public.roles WHERE id <> ALL (roles_))
       + (SELECT count(*) FROM public.notifications_outbox WHERE company_id IS NULL OR company_id <> ALL (empresas))
       + (SELECT count(*) FROM auth.users WHERE id <> ALL (usuarios)) INTO ajenos_despues;
  IF ajenos_antes <> ajenos_despues THEN
    RAISE EXCEPTION 'ABORTA: cambiaron filas ajenas (% → %)', ajenos_antes, ajenos_despues;
  END IF;
  SELECT string_agg(tabla || '=' || filas, ', ' ORDER BY paso) INTO informe FROM hkf_informe;
  IF modo = 'aplicar' THEN
    RAISE NOTICE 'ZZ HKF retirado: %', informe;
  ELSE
    RAISE EXCEPTION 'ENSAYO (revertido): %', informe;
  END IF;
END $limpieza$;
