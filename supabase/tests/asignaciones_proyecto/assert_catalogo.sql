\set ON_ERROR_STOP on
-- ============================================================================
-- CATÁLOGO Y PRIVILEGIOS — la forma exacta que deja la migración 20261026000600
-- ============================================================================
-- El texto que imprimen pg_get_expr / pg_get_triggerdef DEPENDE del search_path de la sesión (con `auth` en el search_path «auth.uid()» sale como
-- «uid()»; con el search_path vacío todo sale calificado). Estas aserciones comparan texto, así que fijan el suyo: pasan igual lanzadas con
-- PGOPTIONS='-c search_path=auth,public' (run.sh lo comprueba en 4d). Lo que sí se prueba con otro search_path es la propia migración y su reversión.
SET search_path = public, pg_catalog;

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
  'true|search_path="",lock_timeout=2s', '[catálogo] asignacion_bloquear_propia: SECURITY DEFINER, search_path vacío y lock_timeout propio de 2 s (la espera del candado de bajas en cascada es corta)');
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

-- ═══ 5 · la baja en cascada toma el candado POR EMPRESA (R2-1, V3-01), comprobado por COMPORTAMIENTO ═══════════════════════
-- Antes esto leía el texto de la función (strpos sobre prosrc): un refactor inocuo —p. ej. cambiar `NOT EXISTS` por `count(*) = 0`— ponía la suite en rojo
-- sin que el comportamiento cambiara, y una mutación sí equivalente pasaba. Ahora se OBSERVA: tras borrar un proyecto con una sesión de la API, la
-- transacción retiene un candado de aviso que antes del borrado no tenía; con el rol de servicio (sin auth.uid()) el trigger no interviene y no lo toma.
-- Que el candado sirva de verdad —que la 2ª sesión espere y vea lo que la 1ª confirmó— lo prueban run.sh (F1, R2-1) con sesiones reales.
-- El COALESCE del trigger (F3) se prueba en assert_defensa (una sesión sin app_users con una política permisiva «zz») y su mutación.
DO $$
DECLARE
  a text;  v_res text := '';  v_antes boolean;  v_despues boolean;
BEGIN
  FOREACH a IN ARRAY ARRAY['AP', 'OW', 'SU', 'SERVICIO'] LOOP
    v_antes := NULL;  v_despues := NULL;
    BEGIN
      PERFORM asgt.poner_actor(a);
      v_antes := EXISTS (SELECT 1 FROM pg_locks WHERE locktype = 'advisory' AND pid = pg_backend_pid() AND granted);
      DELETE FROM public.projects WHERE id = asgt.pid_de(3);
      v_despues := EXISTS (SELECT 1 FROM pg_locks WHERE locktype = 'advisory' AND pid = pg_backend_pid() AND granted);
      PERFORM asgt.poner_actor('SISTEMA');
      RAISE EXCEPTION USING ERRCODE = 'AS999', MESSAGE = 'deshacer';
    EXCEPTION WHEN SQLSTATE 'AS999' THEN NULL;
    END;
    PERFORM asgt.poner_actor('SISTEMA');
    v_res := v_res || CASE WHEN v_res = '' THEN '' ELSE ', ' END || a || ':' || COALESCE(v_antes::text, '?') || '>' || COALESCE(v_despues::text, '?');
  END LOOP;
  PERFORM asgt.chk_txt(v_res, 'AP:false>true, OW:false>true, SU:false>true, SERVICIO:false>false',
    '[catálogo] borrar un proyecto con una sesión de la API (administrador acotado, propietario, superadministrador) toma un candado de aviso que antes no tenía; el rol de servicio no');
END $$;

-- La CLAVE (V3-01). Una sola por baja, la MISMA para cualquier actor de una empresa y DISTINTA entre empresas: así un propietario sólo estorba a las bajas de SU empresa. Se compara la clave retenida
-- (classid:objid del candado en pg_locks) sin repetir aquí cómo se calcula: borrar P3 (7 personas de C asignadas, entre ellas un administrador acotado) como AP, OW y SU debe dejar el MISMO candado único, y
-- borrar D1 (una persona de D) como el propietario de D, uno DISTINTO. El candado global de la ronda anterior da la misma clave en las dos empresas; uno por persona da una clave por cada fila de la cascada.
DO $$
DECLARE
  a text;  v_n text := '';  v_k text;  v_claves text[] := '{}';  v_cnt int;  v_kd text;  v_cnt_d int;
BEGIN
  FOREACH a IN ARRAY ARRAY['AP', 'OW', 'SU'] LOOP
    v_k := NULL;  v_cnt := NULL;
    BEGIN
      PERFORM asgt.poner_actor(a);
      DELETE FROM public.projects WHERE id = asgt.pid_de(3);
      SELECT count(*), min(classid::text || ':' || objid::text) INTO v_cnt, v_k
        FROM pg_locks WHERE locktype = 'advisory' AND pid = pg_backend_pid() AND granted;
      PERFORM asgt.poner_actor('SISTEMA');
      RAISE EXCEPTION USING ERRCODE = 'AS999', MESSAGE = 'deshacer';
    EXCEPTION WHEN SQLSTATE 'AS999' THEN NULL;
    END;
    PERFORM asgt.poner_actor('SISTEMA');
    v_n := v_n || CASE WHEN v_n = '' THEN '' ELSE ', ' END || a || '=' || COALESCE(v_cnt::text, '?');
    v_claves := v_claves || COALESCE(v_k, '?');
  END LOOP;
  BEGIN
    PERFORM asgt.poner_actor('SISTEMA');
    INSERT INTO public.user_project_assignments (user_id, project_id, permission_type) VALUES (asgt.uid_de(12), asgt.pid_de(11), 'total');        -- DOP (operador de D) en D1
    PERFORM asgt.poner_actor('DOW');
    DELETE FROM public.projects WHERE id = asgt.pid_de(11);
    SELECT count(*), min(classid::text || ':' || objid::text) INTO v_cnt_d, v_kd
      FROM pg_locks WHERE locktype = 'advisory' AND pid = pg_backend_pid() AND granted;
    PERFORM asgt.poner_actor('SISTEMA');
    RAISE EXCEPTION USING ERRCODE = 'AS999', MESSAGE = 'deshacer';
  EXCEPTION WHEN SQLSTATE 'AS999' THEN NULL;
  END;
  PERFORM asgt.poner_actor('SISTEMA');
  PERFORM asgt.chk_txt(v_n || ', DOW=' || COALESCE(v_cnt_d::text, '?'), 'AP=1, OW=1, SU=1, DOW=1',
    '[catálogo] cada baja en cascada retiene UN solo candado (no uno por fila ni por persona de la cascada)');
  PERFORM asgt.chk_bool(v_claves[1] <> '?' AND v_claves[1] = v_claves[2] AND v_claves[2] = v_claves[3], true,
    '[catálogo] la baja de un proyecto de C retiene la MISMA clave sea quien sea el actor (administrador acotado, propietario, superadministrador): se ordenan entre sí');
  PERFORM asgt.chk_bool(v_kd IS NOT NULL AND v_kd <> v_claves[1], true,
    '[catálogo] y la baja de un proyecto de D retiene OTRA clave: el propietario de una empresa no retiene el candado de otra (V3-01)');
END $$;

-- La clave sale de la empresa de la PERSONA cuya fila se borra, no de la de quien borra (H-05, ronda 4: los mutantes M6 y M7 sobrevivían). Los casos de arriba usan actores de la MISMA
-- empresa que las personas de la cascada, así que una clave tomada de la empresa del ACTOR (get_my_company_id()) daba lo mismo. Aquí el actor es de OTRA empresa (SU2, superadministrador
-- de D, borra un proyecto de C) y las personas no tienen empresa; se compara la clave retenida sin repetir cómo se calcula.
DO $$
DECLARE
  v_k_ow text;  v_k_su2 text;  v_k_se1 text;  v_k_se2 text;  v_n_su2 int;  v_n_se1 int;  v_n_se2 int;
BEGIN
  -- (a) OW (propietario de C) y SU2 (superadministrador de D) borran el MISMO proyecto de C (P3, con personas de C): retienen la MISMA clave, la de C
  BEGIN
    PERFORM asgt.poner_actor('OW');
    DELETE FROM public.projects WHERE id = asgt.pid_de(3);
    SELECT min(classid::text || ':' || objid::text) INTO v_k_ow FROM pg_locks WHERE locktype = 'advisory' AND pid = pg_backend_pid() AND granted;
    PERFORM asgt.poner_actor('SISTEMA');
    RAISE EXCEPTION USING ERRCODE = 'AS999', MESSAGE = 'deshacer';
  EXCEPTION WHEN SQLSTATE 'AS999' THEN NULL;
  END;
  BEGIN
    PERFORM asgt.poner_actor('SU2');
    DELETE FROM public.projects WHERE id = asgt.pid_de(3);
    SELECT count(*), min(classid::text || ':' || objid::text) INTO v_n_su2, v_k_su2 FROM pg_locks WHERE locktype = 'advisory' AND pid = pg_backend_pid() AND granted;
    PERFORM asgt.poner_actor('SISTEMA');
    RAISE EXCEPTION USING ERRCODE = 'AS999', MESSAGE = 'deshacer';
  EXCEPTION WHEN SQLSTATE 'AS999' THEN NULL;
  END;
  PERFORM asgt.poner_actor('SISTEMA');
  PERFORM asgt.chk_bool(v_n_su2 = 1 AND v_k_ow IS NOT NULL AND v_k_su2 = v_k_ow, true,
    '[catálogo] H-05/M6 · el superadministrador de OTRA empresa (SU2, de D) que borra un proyecto de C retiene la MISMA clave que el propietario de C: la clave sale de la empresa de la PERSONA, no de la del actor');

  -- (b) personas SIN empresa con filas heredadas (el trigger de integridad hoy no deja crearlas; se montan con los disparadores apagados): la clave es la compartida «sin-empresa»,
  --     UNA sola, la misma sea cual sea la empresa de quien borra (OW de C borra un proyecto de C con la fila de SINEMP; DOW de D borra uno de D con la de CLI), y distinta de la de C
  BEGIN
    PERFORM asgt.poner_actor('SISTEMA');
    SET LOCAL session_replication_role = replica;
    INSERT INTO public.projects (id, company_id, nombre) VALUES (asgt.pid_de(91), 'a5c00000-0000-0000-0000-000000000001', 'ASG Z sin empresa C');       -- un proyecto SOLO con la fila heredada
    INSERT INTO public.user_project_assignments (user_id, project_id, permission_type) VALUES (asgt.uid_de(11), asgt.pid_de(91), 'total');     -- SINEMP: operador sin empresa
    SET LOCAL session_replication_role = origin;
    PERFORM asgt.poner_actor('OW');
    DELETE FROM public.projects WHERE id = asgt.pid_de(91);
    SELECT count(*), min(classid::text || ':' || objid::text) INTO v_n_se1, v_k_se1 FROM pg_locks WHERE locktype = 'advisory' AND pid = pg_backend_pid() AND granted;
    PERFORM asgt.poner_actor('SISTEMA');
    RAISE EXCEPTION USING ERRCODE = 'AS999', MESSAGE = 'deshacer';
  EXCEPTION WHEN SQLSTATE 'AS999' THEN NULL;
  END;
  BEGIN
    PERFORM asgt.poner_actor('SISTEMA');
    SET LOCAL session_replication_role = replica;
    INSERT INTO public.projects (id, company_id, nombre) VALUES (asgt.pid_de(92), 'a5c00000-0000-0000-0000-000000000002', 'ASG Z sin empresa D');
    INSERT INTO public.user_project_assignments (user_id, project_id, permission_type) VALUES (asgt.uid_de(9), asgt.pid_de(92), 'total');      -- CLI: cliente sin empresa
    SET LOCAL session_replication_role = origin;
    PERFORM asgt.poner_actor('DOW');
    DELETE FROM public.projects WHERE id = asgt.pid_de(92);
    SELECT count(*), min(classid::text || ':' || objid::text) INTO v_n_se2, v_k_se2 FROM pg_locks WHERE locktype = 'advisory' AND pid = pg_backend_pid() AND granted;
    PERFORM asgt.poner_actor('SISTEMA');
    RAISE EXCEPTION USING ERRCODE = 'AS999', MESSAGE = 'deshacer';
  EXCEPTION WHEN SQLSTATE 'AS999' THEN NULL;
  END;
  PERFORM asgt.poner_actor('SISTEMA');
  PERFORM asgt.chk_txt(COALESCE(v_n_se1::text, '?') || '|' || COALESCE(v_n_se2::text, '?'), '1|1',
    '[catálogo] H-05/M7 · la baja en cascada de la fila de una persona SIN empresa también toma UN candado (con la clave NULL —sin el COALESCE de «sin-empresa»— pg_advisory_xact_lock no bloquea nada)');
  PERFORM asgt.chk_bool(v_k_se1 IS NOT NULL AND v_k_se1 = v_k_se2 AND v_k_se1 <> v_k_ow, true,
    '[catálogo] H-03/H-05 · las personas sin empresa comparten UNA clave («sin-empresa»), la misma para el propietario de C y el de D y distinta de la de C: es el límite documentado (el candado de una empresa estorba a otra sólo con datos heredados)');
END $$;

-- Un borrado DIRECTO de una asignación (el proyecto sigue existiendo) NO toma ningún candado (V3-03 M-c): sin esto, dos propietarios que editan a personas distintas se esperarían sin motivo
-- (medido: 0,02 s → 1,5 s) y ninguna otra prueba lo notaba.
DO $$
DECLARE
  a text;  v_res text := '';  v_despues boolean;  v_n bigint;
BEGIN
  FOREACH a IN ARRAY ARRAY['OW', 'SU', 'AX'] LOOP
    v_despues := NULL;  v_n := NULL;
    BEGIN
      PERFORM asgt.poner_actor(a);
      DELETE FROM public.user_project_assignments WHERE user_id = asgt.uid_de(21) AND project_id = asgt.pid_de(1);
      GET DIAGNOSTICS v_n = ROW_COUNT;
      v_despues := EXISTS (SELECT 1 FROM pg_locks WHERE locktype = 'advisory' AND pid = pg_backend_pid() AND granted);
      PERFORM asgt.poner_actor('SISTEMA');
      RAISE EXCEPTION USING ERRCODE = 'AS999', MESSAGE = 'deshacer';
    EXCEPTION WHEN SQLSTATE 'AS999' THEN NULL;
    END;
    PERFORM asgt.poner_actor('SISTEMA');
    v_res := v_res || CASE WHEN v_res = '' THEN '' ELSE ', ' END || a || ':' || COALESCE(v_n::text, '?') || '>' || COALESCE(v_despues::text, '?');
  END LOOP;
  PERFORM asgt.chk_txt(v_res, 'OW:1>false, SU:1>false, AX:1>false',
    '[catálogo] borrar DIRECTAMENTE una asignación (OP1 en P1; el proyecto sigue existiendo) afecta 1 fila y NO retiene ningún candado: sólo lo toma la baja en cascada');
END $$;

-- Una fila HUÉRFANA (la persona no existe en app_users) no toma candado: sin rol no puede quedar exenta. Se monta una asignación huérfana a un proyecto nuevo (con los disparadores
-- apagados sólo para montarla: hoy el trigger de integridad no deja escribir una) y se borra el proyecto con la API.
DO $$
DECLARE
  v_antes boolean;  v_despues boolean;  v_n bigint;  v_cnt int;
BEGIN
  BEGIN
    PERFORM asgt.poner_actor('SISTEMA');
    SET LOCAL session_replication_role = replica;      -- sin el tope de proyectos del plan ni el trigger de integridad, sólo para montar el caso
    INSERT INTO public.projects (id, company_id, nombre) VALUES (asgt.pid_de(90), 'a5c00000-0000-0000-0000-000000000001', 'ASG Z huérfano');
    INSERT INTO public.user_project_assignments (user_id, project_id, permission_type) VALUES (asgt.uid_de(51), asgt.pid_de(90), 'total');    -- ORF1: no existe en app_users
    SET LOCAL session_replication_role = origin;
    PERFORM asgt.poner_actor('OW');
    DELETE FROM public.projects WHERE id = asgt.pid_de(90);
    GET DIAGNOSTICS v_n = ROW_COUNT;
    v_despues := EXISTS (SELECT 1 FROM pg_locks WHERE locktype = 'advisory' AND pid = pg_backend_pid() AND granted);
    PERFORM asgt.poner_actor('SISTEMA');
    SELECT count(*) INTO v_cnt FROM public.user_project_assignments WHERE project_id = asgt.pid_de(90);
    RAISE EXCEPTION USING ERRCODE = 'AS999', MESSAGE = 'deshacer';
  EXCEPTION WHEN SQLSTATE 'AS999' THEN NULL;
  END;
  PERFORM asgt.poner_actor('SISTEMA');
  PERFORM asgt.chk_txt(COALESCE(v_n::text, '?') || '|' || COALESCE(v_cnt::text, '?') || '|' || COALESCE(v_despues::text, '?'), '1|0|false',
    '[catálogo] la baja en cascada de un proyecto cuya única asignación es HUÉRFANA (la persona no existe en app_users) la borra y NO toma candado: sin rol no puede quedar exenta');
END $$;
SELECT asgt.chk_bool(NOT EXISTS (SELECT 1 FROM pg_locks WHERE locktype = 'advisory' AND pid = pg_backend_pid()), true,
  '[catálogo] y tras deshacer los casos esta sesión no retiene ningún candado (sin residuos)');
