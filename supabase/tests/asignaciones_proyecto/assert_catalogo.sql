\set ON_ERROR_STOP on
-- ============================================================================
-- CATÁLOGO Y PRIVILEGIOS — la forma exacta que deja la migración 20261026000600
-- ============================================================================

-- ═══ 1 · políticas ════════════════════════════════════════════════════════════════════════════════════════════
SELECT asgt.chk((SELECT count(*) FROM pg_policy WHERE polrelid = 'public.user_project_assignments'::regclass), 4,
  '[catálogo] user_project_assignments tiene exactamente 4 políticas');
SELECT asgt.chk_txt((SELECT string_agg(polname || ':' || polcmd::text || ':' || polroles::regrole[]::text, ', ' ORDER BY polname)
                       FROM pg_policy WHERE polrelid = 'public.user_project_assignments'::regclass),
  'user_project_assignments_delete:d:{authenticated}, user_project_assignments_insert:a:{authenticated}, user_project_assignments_select:r:{authenticated}, user_project_assignments_update:w:{authenticated}',
  '[catálogo] los mismos 4 nombres de siempre, cada una para su comando y TO authenticated');
SELECT asgt.chk_txt((SELECT pg_get_expr(polwithcheck, polrelid) FROM pg_policy WHERE polrelid = 'public.user_project_assignments'::regclass AND polname = 'user_project_assignments_insert'),
  'asignacion_puede_administrar(user_id, project_id)', '[catálogo] INSERT: WITH CHECK = asignacion_puede_administrar(user_id, project_id)');
SELECT asgt.chk_txt((SELECT pg_get_expr(polqual, polrelid) || ' / ' || pg_get_expr(polwithcheck, polrelid) FROM pg_policy WHERE polrelid = 'public.user_project_assignments'::regclass AND polname = 'user_project_assignments_update'),
  'asignacion_puede_administrar(user_id, project_id) / asignacion_puede_administrar(user_id, project_id)', '[catálogo] UPDATE: USING y WITH CHECK = la misma regla (la fila vieja Y la nueva)');
SELECT asgt.chk_txt((SELECT pg_get_expr(polqual, polrelid) FROM pg_policy WHERE polrelid = 'public.user_project_assignments'::regclass AND polname = 'user_project_assignments_delete'),
  'asignacion_puede_administrar(user_id, project_id)', '[catálogo] DELETE: USING = la misma regla');
-- la SELECT es la de producción, palabra por palabra (espacios normalizados): conserva «OR user_id = auth.uid()»
SELECT asgt.chk_txt((SELECT regexp_replace(pg_get_expr(polqual, polrelid), '\s+', ' ', 'g') FROM pg_policy WHERE polrelid = 'public.user_project_assignments'::regclass AND polname = 'user_project_assignments_select'),
  '(is_super_admin() OR ((current_user_role() = ANY (ARRAY[''company_owner''::text, ''admin''::text])) AND (project_id IN ( SELECT projects.id FROM projects WHERE (projects.company_id = get_my_company_id())))) OR (user_id = ( SELECT auth.uid() AS uid)))',
  '[catálogo] SELECT: SIN CAMBIOS (cada persona lee las suyas), idéntica al texto de producción');
SELECT asgt.chk((SELECT count(*) FROM pg_class WHERE oid = 'public.user_project_assignments'::regclass AND relrowsecurity AND NOT relforcerowsecurity), 1,
  '[catálogo] RLS activa y no forzada, como en producción');

-- ═══ 2 · triggers ═════════════════════════════════════════════════════════════════════════════════════════════
SELECT asgt.chk_txt((SELECT string_agg(tgname::text || ':' || tgenabled::text || ':' ||
         CASE WHEN tgtype & 1 = 1 THEN 'fila' ELSE 'sentencia' END || ':' || CASE WHEN tgtype & 2 = 2 THEN 'BEFORE' ELSE 'AFTER' END || ':' ||
         concat_ws('+', CASE WHEN tgtype & 4 = 4 THEN 'INSERT' END, CASE WHEN tgtype & 8 = 8 THEN 'DELETE' END, CASE WHEN tgtype & 16 = 16 THEN 'UPDATE' END),
         ', ' ORDER BY tgname)
       FROM pg_trigger WHERE tgrelid = 'public.user_project_assignments'::regclass AND NOT tgisinternal),
  'trg_asignacion_empresa:O:fila:BEFORE:INSERT+UPDATE, trg_asignacion_propia:O:fila:BEFORE:INSERT+DELETE+UPDATE',
  '[catálogo] 2 triggers por fila, BEFORE, habilitados (origen): integridad (INSERT, UPDATE OF user_id, project_id) y autoasignación (INSERT, UPDATE, DELETE)');
SELECT asgt.chk_txt((SELECT pg_get_triggerdef(oid) FROM pg_trigger WHERE tgrelid = 'public.user_project_assignments'::regclass AND tgname = 'trg_asignacion_empresa'),
  'CREATE TRIGGER trg_asignacion_empresa BEFORE INSERT OR UPDATE OF user_id, project_id ON public.user_project_assignments FOR EACH ROW EXECUTE FUNCTION asignacion_validar_empresa()',
  '[catálogo] el trigger de integridad sólo se dispara al escribir user_id / project_id (no mira filas existentes)');

-- ═══ 3 · funciones ════════════════════════════════════════════════════════════════════════════════════════════
SELECT asgt.chk_txt((SELECT p.prosecdef::text || '|' || p.provolatile::text || '|' || COALESCE(array_to_string(p.proconfig, ','), '') FROM pg_proc p WHERE p.oid = 'public.asignacion_puede_administrar(uuid,uuid)'::regprocedure),
  'true|s|search_path=""', '[catálogo] asignacion_puede_administrar: SECURITY DEFINER, STABLE, search_path vacío');
SELECT asgt.chk_txt((SELECT p.prosecdef::text || '|' || COALESCE(array_to_string(p.proconfig, ','), '') FROM pg_proc p WHERE p.oid = 'public.asignacion_validar_empresa()'::regprocedure),
  'true|search_path=""', '[catálogo] asignacion_validar_empresa: SECURITY DEFINER, search_path vacío');
SELECT asgt.chk_txt((SELECT p.prosecdef::text || '|' || COALESCE(array_to_string(p.proconfig, ','), '') FROM pg_proc p WHERE p.oid = 'public.asignacion_bloquear_propia()'::regprocedure),
  'true|search_path=""', '[catálogo] asignacion_bloquear_propia: SECURITY DEFINER, search_path vacío');
SELECT asgt.chk_txt((SELECT string_agg(r || '=' || has_function_privilege(r, 'public.asignacion_puede_administrar(uuid,uuid)', 'EXECUTE')::text, ', ' ORDER BY r)
                       FROM unnest(ARRAY['anon', 'authenticated', 'service_role']) r),
  'anon=false, authenticated=true, service_role=true', '[catálogo] EXECUTE de la regla: authenticated y service_role; anon NO (ni PUBLIC)');
SELECT asgt.chk_bool(NOT EXISTS (SELECT 1 FROM pg_proc p, aclexplode(p.proacl) a
                                   WHERE p.oid = 'public.asignacion_puede_administrar(uuid,uuid)'::regprocedure AND a.grantee = 0),
  true, '[catálogo] y PUBLIC no tiene EXECUTE (el REVOKE ALL … FROM PUBLIC quedó)');
SELECT asgt.chk_txt((SELECT string_agg(f || ':' || r || '=' || has_function_privilege(r, f::regprocedure, 'EXECUTE')::text, ', ' ORDER BY f, r)
                       FROM unnest(ARRAY['public.asignacion_validar_empresa()', 'public.asignacion_bloquear_propia()']) f,
                            unnest(ARRAY['anon', 'authenticated']) r),
  'public.asignacion_bloquear_propia():anon=false, public.asignacion_bloquear_propia():authenticated=false, public.asignacion_validar_empresa():anon=false, public.asignacion_validar_empresa():authenticated=false',
  '[catálogo] las funciones de trigger no son invocables por anon ni authenticated');
SELECT asgt.caso('[catálogo] authenticated no puede invocar el trigger de integridad a mano', 'OP1', 'SELECT public.asignacion_validar_empresa()', 'error',
  p_sqlstate => '42501', p_patron => 'permission denied for function asignacion_validar_empresa', p_control => false);
SELECT asgt.caso('[catálogo] ni el de autoasignación', 'AP', 'SELECT public.asignacion_bloquear_propia()', 'error',
  p_sqlstate => '42501', p_patron => 'permission denied for function asignacion_bloquear_propia', p_control => false);
SELECT asgt.caso('[catálogo] anon no puede invocar la regla', 'ANON', 'SELECT public.asignacion_puede_administrar(NULL, NULL)', 'error',
  p_sqlstate => '42501', p_patron => 'permission denied for function asignacion_puede_administrar', p_control => false);
-- la regla, evaluada directamente (como cada persona): la misma que aplican las políticas
DO $$
DECLARE a text; v text := ''; x boolean;
BEGIN
  FOREACH a IN ARRAY ARRAY['AP', 'AX', 'DAD', 'OP1', 'OW', 'SU'] LOOP
    PERFORM set_config('request.jwt.claim.sub', (SELECT id::text FROM asgt.ids WHERE alias = a), true);
    x := public.asignacion_puede_administrar(asgt.uid_de(21), asgt.pid_de(3));
    v := v || CASE WHEN v = '' THEN '' ELSE ', ' END || a || '=' || x;
  END LOOP;
  PERFORM set_config('request.jwt.claim.sub', '', true);
  PERFORM asgt.chk_txt(v, 'AP=true, AX=true, DAD=false, OP1=false, OW=true, SU=true',
    '[catálogo] la regla sobre (OP1, P3): AP y AX sí (ven P3), OW y SU sí, OP1 no (es sí mismo y no administra), DAD no (otra empresa)');
END $$;
SELECT asgt.chk_bool(public.asignacion_puede_administrar(NULL, NULL), false, '[catálogo] sin sesión la regla es false (nunca NULL)');
SELECT asgt.chk_bool(public.asignacion_puede_administrar(asgt.uid_de(21), NULL), false, '[catálogo] con proyecto NULL la regla es false (project_id es NOT NULL: no existe una asignación «sin proyecto» que escribir)');

-- ═══ 4 · privilegios de la tabla ══════════════════════════════════════════════════════════════════════════════
SELECT asgt.chk_txt((SELECT string_agg(p, ',' ORDER BY p) FROM unnest(ARRAY['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']) p
                      WHERE has_table_privilege('anon', 'public.user_project_assignments', p)), NULL, '[privilegios] anon: NINGUNO de los 7');
SELECT asgt.chk_txt((SELECT string_agg(p, ',' ORDER BY p) FROM unnest(ARRAY['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']) p
                      WHERE has_table_privilege('authenticated', 'public.user_project_assignments', p)), 'DELETE,INSERT,SELECT,UPDATE',
  '[privilegios] authenticated: SELECT, INSERT, UPDATE, DELETE (los usa la RLS); sin TRUNCATE, REFERENCES ni TRIGGER');
SELECT asgt.chk_txt((SELECT string_agg(p, ',' ORDER BY p) FROM unnest(ARRAY['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']) p
                      WHERE has_table_privilege('service_role', 'public.user_project_assignments', p)), 'DELETE,INSERT,REFERENCES,SELECT,TRIGGER,TRUNCATE,UPDATE',
  '[privilegios] service_role conserva los 7');
SELECT asgt.chk_bool(NOT EXISTS (SELECT 1 FROM pg_class c, aclexplode(c.relacl) a WHERE c.oid = 'public.user_project_assignments'::regclass AND a.grantee = 0),
  true, '[privilegios] y PUBLIC no tiene ninguno sobre la tabla');
SELECT asgt.err_priv('[privilegios] TRUNCATE como authenticated falla con permission denied', 'AX', 'TRUNCATE public.user_project_assignments', false);
SELECT asgt.err_priv('[privilegios] TRUNCATE como propietario también', 'OW', 'TRUNCATE public.user_project_assignments', false);
SELECT asgt.err_priv('[privilegios] TRUNCATE como superadministrador también (es un rol de la API, no de la base)', 'SU', 'TRUNCATE public.user_project_assignments', false);
SELECT asgt.err_priv('[privilegios] anon no lee ni cuenta', 'ANON', 'SELECT count(*) FROM public.user_project_assignments', false);
SELECT asgt.ok('[privilegios] el rol de servicio sí puede TRUNCATE (se deshace con el caso)', 'SERVICIO', 'TRUNCATE public.user_project_assignments', 0,
  p_efecto_sql => 'SELECT count(*) FROM public.user_project_assignments', p_efecto => '0');
SELECT asgt.chk((SELECT count(*) FROM public.user_project_assignments), 43, '[privilegios] control: tras el TRUNCATE deshecho siguen las 43 filas');
