\set ON_ERROR_STOP on
-- ============================================================================
-- PRIVILEGIOS RELATIVOS — lo que la migración deja en la ACL de la tabla sea cual sea el punto de partida
--
-- La primera versión de la migración exigía, como un ABSOLUTO, que authenticated TUVIERA SELECT/INSERT/UPDATE/DELETE sobre la tabla. Supabase
-- Preview (una base construida sólo con migraciones) tiene authenticated=Dxtm (sin DML) y producción arwdDxtm; la migración abortó en la primera.
-- Esta suite se corre sobre las DOS formas de ACL y comprueba lo mismo, relativo a lo que había:
--   · -v dml_antes=<lista>   el DML que authenticated tenía ANTES de la migración (vacío = ninguno) — debe seguir IGUAL (la migración no lo toca);
--   · anon no conserva NINGÚN privilegio; authenticated no conserva TRUNCATE, REFERENCES ni TRIGGER; PUBLIC no tiene ninguno.
-- ============================================================================
SELECT asgt.chk_txt((SELECT string_agg(p, ',' ORDER BY p) FROM unnest(ARRAY['SELECT','INSERT','UPDATE','DELETE']) p
                      WHERE has_table_privilege('authenticated', 'public.user_project_assignments', p)),
  NULLIF(:'dml_antes', ''),
  '[acl] authenticated conserva EXACTAMENTE el DML que tenía antes [' || COALESCE(NULLIF(:'dml_antes', ''), 'ninguno') || ']: la migración ni lo concede ni lo quita');
SELECT asgt.chk_txt((SELECT string_agg(p, ',' ORDER BY p) FROM unnest(ARRAY['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']) p
                      WHERE has_table_privilege('anon', 'public.user_project_assignments', p)), NULL, '[acl] anon: NINGUNO de los 7 privilegios');
SELECT asgt.chk_bool(NOT EXISTS (SELECT 1 FROM pg_class c, aclexplode(c.relacl) a WHERE c.oid = 'public.user_project_assignments'::regclass AND a.grantee = 'anon'::regrole),
  true, '[acl] y anon no figura en la ACL (tampoco con MAINTAIN de PostgreSQL 17)');
SELECT asgt.chk_txt((SELECT string_agg(p, ',' ORDER BY p) FROM unnest(ARRAY['TRUNCATE','REFERENCES','TRIGGER']) p
                      WHERE has_table_privilege('authenticated', 'public.user_project_assignments', p)), NULL,
  '[acl] authenticated: sin TRUNCATE, REFERENCES ni TRIGGER');
SELECT asgt.chk_bool(NOT EXISTS (SELECT 1 FROM pg_class c, aclexplode(c.relacl) a WHERE c.oid = 'public.user_project_assignments'::regclass AND a.grantee = 0),
  true, '[acl] PUBLIC no tiene ningún privilegio sobre la tabla');
SELECT asgt.chk((SELECT count(*) FROM public.user_project_assignments), 43, '[acl] las 43 filas siguen ahí');
SELECT asgt.chk((SELECT count(*) FROM pg_policy WHERE polrelid = 'public.user_project_assignments'::regclass), 4, '[acl] las 4 políticas existen');
SELECT asgt.chk((SELECT count(*) FROM pg_trigger WHERE tgrelid = 'public.user_project_assignments'::regclass AND NOT tgisinternal
                  AND tgname IN ('trg_asignacion_empresa', 'trg_asignacion_propia') AND tgenabled = 'O'), 2, '[acl] los 2 triggers están habilitados');
SELECT asgt.chk_txt((SELECT string_agg(f || ':' || r || '=' || has_function_privilege(r, f::regprocedure, 'EXECUTE')::text, ', ' ORDER BY f, r)
                       FROM unnest(ARRAY['public.asignacion_puede_administrar(uuid,uuid)', 'public.asignacion_validar_empresa()', 'public.asignacion_bloquear_propia()']) f,
                            unnest(ARRAY['anon', 'authenticated']) r),
  'public.asignacion_bloquear_propia():anon=false, public.asignacion_bloquear_propia():authenticated=false, public.asignacion_puede_administrar(uuid,uuid):anon=false, public.asignacion_puede_administrar(uuid,uuid):authenticated=true, public.asignacion_validar_empresa():anon=false, public.asignacion_validar_empresa():authenticated=false',
  '[acl] EXECUTE de las 3 funciones: la regla sólo para authenticated; las de trigger para nadie (sea cual sea la ACL por defecto de las funciones)');
SELECT asgt.chk_bool(NOT EXISTS (SELECT 1 FROM pg_proc p, aclexplode(p.proacl) a
                                   WHERE p.proname IN ('asignacion_puede_administrar', 'asignacion_validar_empresa', 'asignacion_bloquear_propia')
                                     AND p.pronamespace = 'public'::regnamespace AND a.grantee = 0),
  true, '[acl] y PUBLIC no tiene EXECUTE en ninguna de las 3 funciones');
