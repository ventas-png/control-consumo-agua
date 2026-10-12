-- ════════════════════════════════════════════════════════════════════════════
-- Retirada de los datos de prueba `ZZ HK E2E` del SANDBOX (jwpmivhvlstslncrtokb)
-- ════════════════════════════════════════════════════════════════════════════
-- Solo toca los identificadores EXACTOS de abajo (ni prefijos ni LIKE: en el sandbox hay filas de
-- OTRAS empresas cuyo id aleatorio empieza por «e2e», p. ej. conta_asientos e2eace36-… y
-- bitacora_acciones e2ee01c7-…, de la empresa e4668da9-…; no se tocan).
--
-- `modo`: 'ensayo' hace todo y lo revierte con una excepción que trae el informe;
--         'aplicar' confirma y deja el informe en la tabla temporal e2e_informe.
-- Orden: los disparadores de auditoría de roles, role_permissions, user_roles y subscriptions
-- INSERTAN filas al borrar (y las FK de permission_audit_log ponen target_* a NULL), así que la
-- auditoría se borra AL FINAL, por el rol/usuario exacto de `details` y por company_id exacto.
-- Ejecutado el 2026-10-12 con autorización (ver docs/HOUSEKEEPING_EVIDENCIAS.md §Datos de prueba).
-- ════════════════════════════════════════════════════════════════════════════
CREATE TEMP TABLE IF NOT EXISTS e2e_informe (paso int, tabla text, filas bigint);
TRUNCATE e2e_informe;

DO $limpieza$
DECLARE
  modo constant text := 'ensayo';   -- ← 'aplicar' para confirmar
  empresas constant uuid[] := ARRAY['e2e0000a-0000-4000-8000-00000000000a', 'e2e0000b-0000-4000-8000-00000000000b']::uuid[];
  proyectos constant uuid[] := ARRAY['e2e000a1-0000-4000-8000-000000000001', 'e2e000a2-0000-4000-8000-000000000002',
                                     'e2e000b1-0000-4000-8000-000000000001']::uuid[];
  usuarios constant uuid[] := ARRAY['e2e00000-0000-4000-8000-000000000001', 'e2e00000-0000-4000-8000-000000000003',
                                    'e2e00000-0000-4000-8000-000000000004', 'e2e00000-0000-4000-8000-000000000007']::uuid[];
  rol constant uuid := 'e2e0001e-0000-4000-8000-0000000000a8';
  n bigint; p int := 0; ajenos_antes bigint; ajenos_despues bigint; informe text;
BEGIN
  -- Guardas: es el sandbox esperado y no quedan servicios ni archivos de housekeeping de prueba.
  IF (SELECT count(*) FROM public.companies WHERE (id, nombre) IN
        (('e2e0000a-0000-4000-8000-00000000000a'::uuid, 'ZZ HK E2E Empresa A'), ('e2e0000b-0000-4000-8000-00000000000b'::uuid, 'ZZ HK E2E Empresa B'))) <> 2
     OR (SELECT count(*) FROM auth.users WHERE id = ANY (usuarios) AND email LIKE 'zz-hk-e2e-%@example.invalid') <> 4
     OR (SELECT count(*) FROM public.roles WHERE id = rol AND name = 'ZZ HK E2E Housekeeping' AND company_id = empresas[1]) <> 1 THEN
    RAISE EXCEPTION 'ABORTA: los identificadores no corresponden a los datos ZZ HK E2E; no es el sandbox esperado.';
  END IF;
  IF EXISTS (SELECT 1 FROM public.servicios_housekeeping WHERE company_id = ANY (empresas))
     OR EXISTS (SELECT 1 FROM storage.objects WHERE bucket_id = 'housekeeping-evidencias' AND (storage.foldername(name))[1] = ANY (proyectos::text[]))
     OR EXISTS (SELECT 1 FROM public.hk_limpieza_storage WHERE company_id = ANY (empresas)) THEN
    RAISE EXCEPTION 'ABORTA: quedan servicios, objetos o cola de housekeeping de prueba; retirarlos antes por la pantalla o las RPC.';
  END IF;
  -- Huella de lo ajeno: todas las filas de estas tablas que NO son de la prueba.
  SELECT (SELECT count(*) FROM public.companies WHERE id <> ALL (empresas)) + (SELECT count(*) FROM public.projects WHERE id <> ALL (proyectos))
       + (SELECT count(*) FROM auth.users WHERE id <> ALL (usuarios)) + (SELECT count(*) FROM public.app_users WHERE id <> ALL (usuarios))
       + (SELECT count(*) FROM public.roles WHERE id <> rol) + (SELECT count(*) FROM public.bitacora_acciones WHERE company_id <> ALL (empresas))
       + (SELECT count(*) FROM public.audit_log WHERE company_id IS DISTINCT FROM empresas[1] AND company_id IS DISTINCT FROM empresas[2])
    INTO ajenos_antes;

  DELETE FROM public.user_project_assignments WHERE user_id = ANY (usuarios) OR project_id = ANY (proyectos); GET DIAGNOSTICS n = ROW_COUNT; p := p + 1; INSERT INTO e2e_informe VALUES (p, 'user_project_assignments', n);
  DELETE FROM public.user_roles        WHERE role_id = rol OR user_id = ANY (usuarios);   GET DIAGNOSTICS n = ROW_COUNT; p := p + 1; INSERT INTO e2e_informe VALUES (p, 'user_roles', n);
  DELETE FROM public.role_permissions  WHERE role_id = rol;                               GET DIAGNOSTICS n = ROW_COUNT; p := p + 1; INSERT INTO e2e_informe VALUES (p, 'role_permissions', n);
  DELETE FROM public.roles             WHERE id = rol;                                    GET DIAGNOSTICS n = ROW_COUNT; p := p + 1; INSERT INTO e2e_informe VALUES (p, 'roles', n);
  DELETE FROM public.subscriptions     WHERE company_id = ANY (empresas);                 GET DIAGNOSTICS n = ROW_COUNT; p := p + 1; INSERT INTO e2e_informe VALUES (p, 'subscriptions', n);
  DELETE FROM public.user_presence     WHERE user_id = ANY (usuarios);                    GET DIAGNOSTICS n = ROW_COUNT; p := p + 1; INSERT INTO e2e_informe VALUES (p, 'user_presence', n);
  DELETE FROM public.bitacora_acciones WHERE company_id = ANY (empresas);                 GET DIAGNOSTICS n = ROW_COUNT; p := p + 1; INSERT INTO e2e_informe VALUES (p, 'bitacora_acciones', n);
  DELETE FROM public.app_users         WHERE id = ANY (usuarios);                         GET DIAGNOSTICS n = ROW_COUNT; p := p + 1; INSERT INTO e2e_informe VALUES (p, 'app_users', n);
  DELETE FROM auth.refresh_tokens      WHERE user_id = ANY (usuarios::text[]);            GET DIAGNOSTICS n = ROW_COUNT; p := p + 1; INSERT INTO e2e_informe VALUES (p, 'auth.refresh_tokens', n);
  DELETE FROM auth.sessions            WHERE user_id = ANY (usuarios);                    GET DIAGNOSTICS n = ROW_COUNT; p := p + 1; INSERT INTO e2e_informe VALUES (p, 'auth.sessions', n);
  DELETE FROM auth.identities          WHERE user_id = ANY (usuarios);                    GET DIAGNOSTICS n = ROW_COUNT; p := p + 1; INSERT INTO e2e_informe VALUES (p, 'auth.identities', n);
  DELETE FROM auth.users               WHERE id = ANY (usuarios);                         GET DIAGNOSTICS n = ROW_COUNT; p := p + 1; INSERT INTO e2e_informe VALUES (p, 'auth.users', n);
  DELETE FROM public.projects          WHERE id = ANY (proyectos);                        GET DIAGNOSTICS n = ROW_COUNT; p := p + 1; INSERT INTO e2e_informe VALUES (p, 'projects', n);
  DELETE FROM public.companies         WHERE id = ANY (empresas);                         GET DIAGNOSTICS n = ROW_COUNT; p := p + 1; INSERT INTO e2e_informe VALUES (p, 'companies', n);
  -- Auditoría al final (incluye las filas que acaban de generar los disparadores).
  DELETE FROM public.permission_audit_log
   WHERE target_role_id = rol OR target_user_id = ANY (usuarios)
      OR details->>'role_id' = rol::text OR details->>'user_id' = ANY (usuarios::text[]);  GET DIAGNOSTICS n = ROW_COUNT; p := p + 1; INSERT INTO e2e_informe VALUES (p, 'permission_audit_log', n);
  DELETE FROM public.audit_log         WHERE company_id = ANY (empresas);                 GET DIAGNOSTICS n = ROW_COUNT; p := p + 1; INSERT INTO e2e_informe VALUES (p, 'audit_log', n);

  -- Verificación: nada de la prueba queda en ninguna de las tablas, y lo ajeno no cambió.
  IF EXISTS (SELECT 1 FROM public.companies WHERE id = ANY (empresas)) OR EXISTS (SELECT 1 FROM public.projects WHERE id = ANY (proyectos))
     OR EXISTS (SELECT 1 FROM auth.users WHERE id = ANY (usuarios)) OR EXISTS (SELECT 1 FROM public.app_users WHERE id = ANY (usuarios))
     OR EXISTS (SELECT 1 FROM public.roles WHERE id = rol)
     OR EXISTS (SELECT 1 FROM public.permission_audit_log WHERE details->>'role_id' = rol::text OR details->>'user_id' = ANY (usuarios::text[]))
     OR EXISTS (SELECT 1 FROM public.audit_log WHERE company_id = ANY (empresas)) THEN
    RAISE EXCEPTION 'ABORTA: quedan filas de la prueba tras el borrado.';
  END IF;
  SELECT (SELECT count(*) FROM public.companies WHERE id <> ALL (empresas)) + (SELECT count(*) FROM public.projects WHERE id <> ALL (proyectos))
       + (SELECT count(*) FROM auth.users WHERE id <> ALL (usuarios)) + (SELECT count(*) FROM public.app_users WHERE id <> ALL (usuarios))
       + (SELECT count(*) FROM public.roles WHERE id <> rol) + (SELECT count(*) FROM public.bitacora_acciones WHERE company_id <> ALL (empresas))
       + (SELECT count(*) FROM public.audit_log WHERE company_id IS DISTINCT FROM empresas[1] AND company_id IS DISTINCT FROM empresas[2])
    INTO ajenos_despues;
  IF ajenos_despues <> ajenos_antes OR NOT EXISTS (SELECT 1 FROM public.conta_asientos WHERE id = 'e2eace36-7a00-47ed-b643-d3f61b3e0f44') THEN
    RAISE EXCEPTION 'ABORTA: cambió una fila ajena a la prueba (% → %).', ajenos_antes, ajenos_despues;
  END IF;
  p := p + 1; INSERT INTO e2e_informe VALUES (p, 'filas ajenas (antes = después)', ajenos_despues);

  IF modo <> 'aplicar' THEN
    SELECT string_agg(tabla || '=' || filas, ', ' ORDER BY paso) INTO informe FROM e2e_informe;
    RAISE EXCEPTION 'ENSAYO (revertido): %', informe;
  END IF;
END
$limpieza$;

SELECT tabla, filas FROM e2e_informe ORDER BY paso;
SELECT (SELECT count(*) FROM storage.objects WHERE bucket_id = 'housekeeping-evidencias') AS objetos_hk,
       (SELECT count(*) FROM public.hk_limpieza_storage) AS cola_hk,
       (SELECT count(*) FROM public.servicio_housekeeping_fotos) AS fotos_hk,
       (SELECT count(*) FROM public.conta_asientos WHERE id = 'e2eace36-7a00-47ed-b643-d3f61b3e0f44') AS ajeno_intacto;
