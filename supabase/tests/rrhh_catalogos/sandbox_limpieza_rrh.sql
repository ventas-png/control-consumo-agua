-- ════════════════════════════════════════════════════════════════════════════
-- Retirada de los datos de prueba «ZZ RRH» del SANDBOX (jwpmivhvlstslncrtokb)
-- ════════════════════════════════════════════════════════════════════════════
-- Solo toca los identificadores EXACTOS de sandbox_datos_rrh.sql (nunca LIKE) y lo que la
-- prueba creó DENTRO de esas empresas (cargos, turnos, personal, actividades, programaciones y
-- ejecuciones, que llevan company_id). Un bloque atómico: guardas, borrado hijos → padres,
-- auditoría al final, verificación de que no queda nada y de que las filas ajenas no cambian.
-- `modo := 'ensayo'` revierte y devuelve el informe; `'aplicar'` confirma.
CREATE TEMP TABLE IF NOT EXISTS rrh_informe (paso int, tabla text, filas bigint);
DO $limpieza$
DECLARE
  modo constant text := 'ensayo';   -- ← 'aplicar' para confirmar
  empresas constant uuid[] := ARRAY['5b5b6000-0000-0000-0000-00000000000c', '5b5b6000-0000-0000-0000-00000000000d']::uuid[];
  proyectos constant uuid[] := ARRAY['5b5b6000-0000-0000-0000-0000000000a1', '5b5b6000-0000-0000-0000-0000000000a2', '5b5b6000-0000-0000-0000-0000000000a3']::uuid[];
  usuarios constant uuid[] := ARRAY['5b5b6000-0000-0000-0000-0000000000f1', '5b5b6000-0000-0000-0000-0000000000f2',
                                    '5b5b6000-0000-0000-0000-0000000000f3', '5b5b6000-0000-0000-0000-0000000000f4']::uuid[];
  roles_ constant uuid[] := ARRAY['5b5b6000-0000-0000-0000-0000000000e8', '5b5b6000-0000-0000-0000-0000000000e9']::uuid[];
  n bigint; p int := 0; ajenos_antes bigint; ajenos_despues bigint; informe text;
BEGIN
  DELETE FROM rrh_informe;
  IF (SELECT count(*) FROM public.companies WHERE (id, nombre) IN
        (('5b5b6000-0000-0000-0000-00000000000c'::uuid, 'ZZ RRH Empresa'), ('5b5b6000-0000-0000-0000-00000000000d'::uuid, 'ZZ RRH Otra empresa'))) <> 2
     OR (SELECT count(*) FROM auth.users WHERE id = ANY (usuarios) AND email LIKE 'zz-rrh-%@example.invalid') <> 4
     OR (SELECT count(*) FROM public.roles WHERE id = ANY (roles_) AND name LIKE 'ZZ RRH %') <> 2 THEN
    RAISE EXCEPTION 'ABORTA: los identificadores no son los de ZZ RRH (o ya se retiraron)';
  END IF;
  SELECT (SELECT count(*) FROM public.rrhh_cargos WHERE company_id <> ALL (empresas))
       + (SELECT count(*) FROM public.rrhh_tipos_turno WHERE company_id <> ALL (empresas))
       + (SELECT count(*) FROM public.personal_condominio WHERE company_id <> ALL (empresas))
       + (SELECT count(*) FROM public.plantillas_tarea_cargo WHERE company_id <> ALL (empresas))
       + (SELECT count(*) FROM public.programacion_limpieza WHERE company_id <> ALL (empresas))
       + (SELECT count(*) FROM public.ejecuciones_limpieza WHERE company_id <> ALL (empresas))
       + (SELECT count(*) FROM public.areas_condominio WHERE company_id <> ALL (empresas))
       + (SELECT count(*) FROM public.app_users WHERE id <> ALL (usuarios))
       + (SELECT count(*) FROM public.companies WHERE id <> ALL (empresas))
       + (SELECT count(*) FROM public.projects WHERE id <> ALL (proyectos))
       + (SELECT count(*) FROM public.roles WHERE id <> ALL (roles_))
       + (SELECT count(*) FROM auth.users WHERE id <> ALL (usuarios)) INTO ajenos_antes;

  -- hijos → padres. Los catálogos se borran con los triggers de "en uso" apagados: aquí se
  -- retira TODO el tenant de prueba, incluidas las filas que los usan.
  p := p + 1; DELETE FROM public.ejecuciones_limpieza WHERE company_id = ANY (empresas); GET DIAGNOSTICS n = ROW_COUNT; INSERT INTO rrh_informe VALUES (p, 'ejecuciones_limpieza', n);
  p := p + 1; DELETE FROM public.programacion_limpieza WHERE company_id = ANY (empresas); GET DIAGNOSTICS n = ROW_COUNT; INSERT INTO rrh_informe VALUES (p, 'programacion_limpieza', n);
  p := p + 1; DELETE FROM public.plantilla_tarea_suministros WHERE company_id = ANY (empresas); GET DIAGNOSTICS n = ROW_COUNT; INSERT INTO rrh_informe VALUES (p, 'plantilla_tarea_suministros', n);
  p := p + 1; DELETE FROM public.plantilla_tarea_herramientas WHERE company_id = ANY (empresas); GET DIAGNOSTICS n = ROW_COUNT; INSERT INTO rrh_informe VALUES (p, 'plantilla_tarea_herramientas', n);
  p := p + 1; DELETE FROM public.plantillas_tarea_cargo WHERE company_id = ANY (empresas); GET DIAGNOSTICS n = ROW_COUNT; INSERT INTO rrh_informe VALUES (p, 'plantillas_tarea_cargo', n);
  p := p + 1; DELETE FROM public.personal_condominio WHERE company_id = ANY (empresas); GET DIAGNOSTICS n = ROW_COUNT; INSERT INTO rrh_informe VALUES (p, 'personal_condominio', n);
  p := p + 1; DELETE FROM public.rrhh_cargos WHERE company_id = ANY (empresas); GET DIAGNOSTICS n = ROW_COUNT; INSERT INTO rrh_informe VALUES (p, 'rrhh_cargos', n);
  p := p + 1; DELETE FROM public.rrhh_tipos_turno WHERE company_id = ANY (empresas); GET DIAGNOSTICS n = ROW_COUNT; INSERT INTO rrh_informe VALUES (p, 'rrhh_tipos_turno', n);
  p := p + 1; DELETE FROM public.areas_condominio WHERE company_id = ANY (empresas); GET DIAGNOSTICS n = ROW_COUNT; INSERT INTO rrh_informe VALUES (p, 'areas_condominio', n);
  p := p + 1; DELETE FROM public.user_notifications WHERE user_id = ANY (usuarios); GET DIAGNOSTICS n = ROW_COUNT; INSERT INTO rrh_informe VALUES (p, 'user_notifications', n);
  p := p + 1; DELETE FROM public.user_project_assignments WHERE user_id = ANY (usuarios); GET DIAGNOSTICS n = ROW_COUNT; INSERT INTO rrh_informe VALUES (p, 'user_project_assignments', n);
  p := p + 1; DELETE FROM public.user_roles WHERE user_id = ANY (usuarios); GET DIAGNOSTICS n = ROW_COUNT; INSERT INTO rrh_informe VALUES (p, 'user_roles', n);
  p := p + 1; DELETE FROM public.role_permissions WHERE role_id = ANY (roles_); GET DIAGNOSTICS n = ROW_COUNT; INSERT INTO rrh_informe VALUES (p, 'role_permissions', n);
  p := p + 1; DELETE FROM public.roles WHERE id = ANY (roles_); GET DIAGNOSTICS n = ROW_COUNT; INSERT INTO rrh_informe VALUES (p, 'roles', n);
  p := p + 1; DELETE FROM public.app_users WHERE id = ANY (usuarios); GET DIAGNOSTICS n = ROW_COUNT; INSERT INTO rrh_informe VALUES (p, 'app_users', n);
  p := p + 1; DELETE FROM public.projects WHERE id = ANY (proyectos); GET DIAGNOSTICS n = ROW_COUNT; INSERT INTO rrh_informe VALUES (p, 'projects', n);
  p := p + 1; DELETE FROM public.companies WHERE id = ANY (empresas); GET DIAGNOSTICS n = ROW_COUNT; INSERT INTO rrh_informe VALUES (p, 'companies', n);
  p := p + 1; DELETE FROM auth.identities WHERE user_id = ANY (usuarios); GET DIAGNOSTICS n = ROW_COUNT; INSERT INTO rrh_informe VALUES (p, 'auth.identities', n);
  p := p + 1; DELETE FROM auth.users WHERE id = ANY (usuarios); GET DIAGNOSTICS n = ROW_COUNT; INSERT INTO rrh_informe VALUES (p, 'auth.users', n);
  p := p + 1; DELETE FROM public.bitacora_acciones WHERE usuario_id = ANY (usuarios) OR company_id = ANY (empresas); GET DIAGNOSTICS n = ROW_COUNT; INSERT INTO rrh_informe VALUES (p, 'bitacora_acciones', n);
  p := p + 1; DELETE FROM public.audit_log WHERE actor_id = ANY (usuarios) OR company_id = ANY (empresas); GET DIAGNOSTICS n = ROW_COUNT; INSERT INTO rrh_informe VALUES (p, 'audit_log', n);

  IF (SELECT count(*) FROM public.companies WHERE id = ANY (empresas)) + (SELECT count(*) FROM auth.users WHERE id = ANY (usuarios))
     + (SELECT count(*) FROM public.roles WHERE id = ANY (roles_)) + (SELECT count(*) FROM public.projects WHERE id = ANY (proyectos))
     + (SELECT count(*) FROM public.rrhh_cargos WHERE company_id = ANY (empresas))
     + (SELECT count(*) FROM public.personal_condominio WHERE company_id = ANY (empresas)) <> 0 THEN
    RAISE EXCEPTION 'ABORTA: quedan filas de ZZ RRH tras el borrado';
  END IF;
  SELECT (SELECT count(*) FROM public.rrhh_cargos WHERE company_id <> ALL (empresas))
       + (SELECT count(*) FROM public.rrhh_tipos_turno WHERE company_id <> ALL (empresas))
       + (SELECT count(*) FROM public.personal_condominio WHERE company_id <> ALL (empresas))
       + (SELECT count(*) FROM public.plantillas_tarea_cargo WHERE company_id <> ALL (empresas))
       + (SELECT count(*) FROM public.programacion_limpieza WHERE company_id <> ALL (empresas))
       + (SELECT count(*) FROM public.ejecuciones_limpieza WHERE company_id <> ALL (empresas))
       + (SELECT count(*) FROM public.areas_condominio WHERE company_id <> ALL (empresas))
       + (SELECT count(*) FROM public.app_users WHERE id <> ALL (usuarios))
       + (SELECT count(*) FROM public.companies WHERE id <> ALL (empresas))
       + (SELECT count(*) FROM public.projects WHERE id <> ALL (proyectos))
       + (SELECT count(*) FROM public.roles WHERE id <> ALL (roles_))
       + (SELECT count(*) FROM auth.users WHERE id <> ALL (usuarios)) INTO ajenos_despues;
  IF ajenos_antes <> ajenos_despues THEN
    RAISE EXCEPTION 'ABORTA: cambiaron filas ajenas (% → %)', ajenos_antes, ajenos_despues;
  END IF;
  SELECT string_agg(tabla || '=' || filas, ', ' ORDER BY paso) INTO informe FROM rrh_informe;
  IF modo = 'aplicar' THEN
    RAISE NOTICE 'ZZ RRH retirado: %', informe;
  ELSE
    RAISE EXCEPTION 'ENSAYO (revertido): %', informe;
  END IF;
END $limpieza$;
