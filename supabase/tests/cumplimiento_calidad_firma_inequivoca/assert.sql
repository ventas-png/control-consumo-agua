-- ════════════════════════════════════════════════════════════════════════════
-- DESPUÉS de la migración: pg_catalog, celda por celda.
--   · el trigger registros_calidad_cumplimiento: uno solo, sobre la tabla,
--     BEFORE ROW INSERT/UPDATE (tgtype 23), habilitado, sin args ni WHEN,
--     UPDATE OF {cumple_total, cumplimiento, fuente_id, parametros}, ejecutando
--     trg_registros_calidad_cumplimiento_catalogo(); pg_get_triggerdef exacto.
--   · la función nueva: SECURITY INVOKER, search_path = '', sin EXECUTE para
--     PUBLIC/anon/authenticated.
--   · la firma de tres argumentos: sigue INVOKER y STABLE; authenticated y
--     service_role SÍ ejecutan; PUBLIC y anon NO.
--   · lo que NO debía moverse: la sobrecarga de dos argumentos y la función de
--     trigger vieja siguen existiendo (run.sh compara además su cuerpo y ACL
--     antes/después), y ningún trigger apunta ya a la vieja.
--   · el orden de disparo: los BEFORE ROW van por nombre, y el de cumplimiento
--     sigue yendo ANTES que fill_company_id.
-- ════════════════════════════════════════════════════════════════════════════
\set ON_ERROR_STOP on
SET search_path = public;

DO $$
DECLARE
  v_tabla oid := 'public.registros_calidad'::regclass;
  v_fn3   oid := to_regprocedure('public.calcular_cumplimiento_calidad(text, jsonb, uuid)')::oid;
  v_fn2   oid := to_regprocedure('public.calcular_cumplimiento_calidad(text, jsonb)')::oid;
  v_vieja oid := to_regprocedure('public.trg_registros_calidad_cumplimiento()')::oid;
  v_nueva oid := to_regprocedure('public.trg_registros_calidad_cumplimiento_catalogo()')::oid;
  v_r     record;
BEGIN
  PERFORM public.chk(v_nueva IS NOT NULL, true, 'existe trg_registros_calidad_cumplimiento_catalogo()');
  PERFORM public.chk(v_fn3 IS NOT NULL AND v_fn2 IS NOT NULL AND v_vieja IS NOT NULL, true,
    'las dos sobrecargas y la función de trigger vieja siguen existiendo (no se tocan)');

  PERFORM public.chk((SELECT count(*) FROM pg_trigger WHERE tgname = 'registros_calidad_cumplimiento' AND NOT tgisinternal),
    1, 'exactamente un trigger llamado registros_calidad_cumplimiento en todo el catálogo');

  SELECT t.oid, t.tgrelid, t.tgfoid, t.tgtype, t.tgenabled, t.tgnargs, (t.tgqual IS NOT NULL) AS con_when,
         t.tgconstraint, t.tgdeferrable, t.tginitdeferred,
         (t.tgoldtable IS NOT NULL OR t.tgnewtable IS NOT NULL) AS con_transicion,
         (SELECT array_agg(a.attname::text ORDER BY a.attname) FROM unnest(t.tgattr::int2[]) k
            JOIN pg_attribute a ON a.attrelid = t.tgrelid AND a.attnum = k) AS columnas
    INTO v_r FROM pg_trigger t WHERE t.tgname = 'registros_calidad_cumplimiento' AND NOT t.tgisinternal;

  PERFORM public.chk(v_r.tgrelid = v_tabla, true, 'registros_calidad_cumplimiento · sobre public.registros_calidad');
  PERFORM public.chk_txt(v_r.tgfoid::regprocedure::text, 'trg_registros_calidad_cumplimiento_catalogo()',
    'registros_calidad_cumplimiento · función');
  PERFORM public.chk(v_r.tgtype, 23, 'registros_calidad_cumplimiento · tgtype = 23 (ROW | BEFORE | INSERT | UPDATE)');
  PERFORM public.chk((v_r.tgtype & 1) <> 0, true,  'registros_calidad_cumplimiento · FOR EACH ROW');
  PERFORM public.chk((v_r.tgtype & 2) <> 0, true,  'registros_calidad_cumplimiento · BEFORE');
  PERFORM public.chk((v_r.tgtype & 4) <> 0, true,  'registros_calidad_cumplimiento · INSERT');
  PERFORM public.chk((v_r.tgtype & 16) <> 0, true, 'registros_calidad_cumplimiento · UPDATE');
  PERFORM public.chk((v_r.tgtype & (8 | 32 | 64)) = 0, true, 'registros_calidad_cumplimiento · ni DELETE, ni TRUNCATE, ni INSTEAD OF');
  PERFORM public.chk_txt(v_r.tgenabled::text, 'O', 'registros_calidad_cumplimiento · habilitado (tgenabled = O)');
  PERFORM public.chk(v_r.tgnargs, 0, 'registros_calidad_cumplimiento · sin argumentos');
  PERFORM public.chk(v_r.con_when, false, 'registros_calidad_cumplimiento · sin cláusula WHEN');
  PERFORM public.chk(v_r.tgconstraint::bigint, 0, 'registros_calidad_cumplimiento · no es constraint trigger');
  PERFORM public.chk(v_r.tgdeferrable OR v_r.tginitdeferred, false, 'registros_calidad_cumplimiento · no deferrable');
  PERFORM public.chk(v_r.con_transicion, false, 'registros_calidad_cumplimiento · sin tablas de transición');
  PERFORM public.chk_txt(array_to_string(v_r.columnas, ','), 'cumple_total,cumplimiento,fuente_id,parametros',
    'registros_calidad_cumplimiento · UPDATE OF cumple_total, cumplimiento, fuente_id, parametros');
  PERFORM public.chk_txt(pg_get_triggerdef(v_r.oid),
    'CREATE TRIGGER registros_calidad_cumplimiento BEFORE INSERT OR UPDATE OF parametros, fuente_id, cumplimiento, cumple_total ON public.registros_calidad FOR EACH ROW EXECUTE FUNCTION trg_registros_calidad_cumplimiento_catalogo()',
    'registros_calidad_cumplimiento · pg_get_triggerdef exacto');

  -- Orden de disparo: por nombre. El de cumplimiento va antes que el que
  -- rellena company_id, igual que con S22; por eso la función deriva la
  -- empresa de la fuente y no de NEW.company_id.
  PERFORM public.chk_txt(
    (SELECT string_agg(tgname, ' → ' ORDER BY tgname) FROM pg_trigger
      WHERE tgrelid = v_tabla AND NOT tgisinternal AND (tgtype & 3) = 3),
    'registros_calidad_cumplimiento → registros_calidad_fill_company_id',
    'orden de los BEFORE ROW en registros_calidad');

  PERFORM public.chk((SELECT count(*) FROM pg_trigger WHERE tgfoid = v_vieja), 0,
    'ningún trigger ejecuta ya trg_registros_calidad_cumplimiento()');

  -- La función nueva.
  PERFORM public.chk((SELECT prosecdef FROM pg_proc WHERE oid = v_nueva), false,
    'trg_registros_calidad_cumplimiento_catalogo() es SECURITY INVOKER');
  PERFORM public.chk_txt((SELECT array_to_string(proconfig, ';') FROM pg_proc WHERE oid = v_nueva), 'search_path=""',
    'trg_registros_calidad_cumplimiento_catalogo() · search_path = ''''');
  PERFORM public.chk(has_function_privilege('public',        v_nueva, 'EXECUTE'), false, 'PUBLIC        NO ejecuta la función de trigger nueva');
  PERFORM public.chk(has_function_privilege('anon',          v_nueva, 'EXECUTE'), false, 'anon          NO ejecuta la función de trigger nueva');
  PERFORM public.chk(has_function_privilege('authenticated', v_nueva, 'EXECUTE'), false, 'authenticated NO ejecuta la función de trigger nueva');
  PERFORM public.chk(has_function_privilege('service_role',  v_nueva, 'EXECUTE'), true,  'service_role  SÍ ejecuta la función de trigger nueva');

  -- La firma de tres argumentos: INVOKER, STABLE, y la ACL declarada.
  PERFORM public.chk((SELECT prosecdef FROM pg_proc WHERE oid = v_fn3), false,
    'calcular_cumplimiento_calidad(text, jsonb, uuid) sigue SECURITY INVOKER');
  PERFORM public.chk_txt((SELECT provolatile::text FROM pg_proc WHERE oid = v_fn3), 's',
    'calcular_cumplimiento_calidad(text, jsonb, uuid) sigue STABLE');
  PERFORM public.chk(has_function_privilege('public',        v_fn3, 'EXECUTE'), false, 'PUBLIC        NO ejecuta calcular_cumplimiento_calidad(text, jsonb, uuid)');
  PERFORM public.chk(has_function_privilege('anon',          v_fn3, 'EXECUTE'), false, 'anon          NO ejecuta calcular_cumplimiento_calidad(text, jsonb, uuid)');
  PERFORM public.chk(has_function_privilege('authenticated', v_fn3, 'EXECUTE'), true,  'authenticated SÍ ejecuta calcular_cumplimiento_calidad(text, jsonb, uuid)');
  PERFORM public.chk(has_function_privilege('service_role',  v_fn3, 'EXECUTE'), true,  'service_role  SÍ ejecuta calcular_cumplimiento_calidad(text, jsonb, uuid)');

  -- La sobrecarga de dos argumentos no se toca: sigue con la ACL de S22
  -- (EXECUTE de PUBLIC por defecto) y sigue IMMUTABLE.
  PERFORM public.chk_txt((SELECT provolatile::text FROM pg_proc WHERE oid = v_fn2), 'i',
    'calcular_cumplimiento_calidad(text, jsonb) sigue IMMUTABLE (no se tocó)');
  PERFORM public.chk(has_function_privilege('public', v_fn2, 'EXECUTE'), true,
    'calcular_cumplimiento_calidad(text, jsonb) conserva su ACL de S22 (no se tocó)');

  -- La forma exacta de la llamada del trigger no es ambigua.
  PERFORM public.chk_txt(
    (public.calcular_cumplimiento_calidad('potable'::text, '{"pH": 7.5}'::jsonb, NULL::uuid) ->> 'cumple_total'),
    'true', 'calcular_cumplimiento_calidad(text, jsonb, uuid) resuelve sin 42725 y calcula con el catálogo global');
END $$;

-- ── La función acotada que resuelve la fuente (el contrato de RBAC) ──────────
DO $$
DECLARE
  v_fuente oid := to_regprocedure('public.agua_fuente_de_mi_empresa(uuid)')::oid;
  v_nueva  oid := to_regprocedure('public.trg_registros_calidad_cumplimiento_catalogo()')::oid;
BEGIN
  PERFORM public.chk(v_fuente IS NOT NULL, true, 'existe agua_fuente_de_mi_empresa(uuid)');
  PERFORM public.chk((SELECT prosecdef FROM pg_proc WHERE oid = v_fuente), true,
    'agua_fuente_de_mi_empresa(uuid) es SECURITY DEFINER (tiene que responder sin agua.calidad.view)');
  PERFORM public.chk_txt((SELECT array_to_string(proconfig, ';') FROM pg_proc WHERE oid = v_fuente), 'search_path=""',
    'agua_fuente_de_mi_empresa(uuid) · search_path bloqueado a ''''');
  PERFORM public.chk_txt((SELECT provolatile::text FROM pg_proc WHERE oid = v_fuente), 's',
    'agua_fuente_de_mi_empresa(uuid) · STABLE');
  PERFORM public.chk_txt((SELECT pg_get_function_result(v_fuente)), 'TABLE(tipo_agua text, company_id uuid)',
    'agua_fuente_de_mi_empresa(uuid) · devuelve sólo (tipo_agua, company_id)');
  PERFORM public.chk_txt((SELECT pg_get_function_identity_arguments(v_fuente)), 'p_fuente_id uuid',
    'agua_fuente_de_mi_empresa(uuid) · no acepta company_id del cliente');
  PERFORM public.chk(has_function_privilege('public',        v_fuente, 'EXECUTE'), false, 'PUBLIC        NO ejecuta agua_fuente_de_mi_empresa(uuid)');
  PERFORM public.chk(has_function_privilege('anon',          v_fuente, 'EXECUTE'), false, 'anon          NO ejecuta agua_fuente_de_mi_empresa(uuid)');
  PERFORM public.chk(has_function_privilege('authenticated', v_fuente, 'EXECUTE'), true,  'authenticated SÍ ejecuta agua_fuente_de_mi_empresa(uuid)');
  PERFORM public.chk(has_function_privilege('service_role',  v_fuente, 'EXECUTE'), false, 'service_role  NO ejecuta agua_fuente_de_mi_empresa(uuid): sin JWT siempre daría cero filas, su camino es el privilegiado');

  -- El aislamiento está EN EL CUERPO de la acotada, no sólo en la RLS.
  PERFORM public.chk((SELECT prosrc LIKE '%get_my_company_id%' FROM pg_proc WHERE oid = v_fuente), true,
    'agua_fuente_de_mi_empresa(uuid) filtra por get_my_company_id() en su propio WHERE');

  -- Y el trigger NO lee fuentes_agua directamente: ésa es la corrección.
  PERFORM public.chk((SELECT prosrc LIKE '%agua_fuente_de_mi_empresa%' FROM pg_proc WHERE oid = v_nueva), true,
    'el trigger resuelve la fuente con la función acotada');
  -- El SELECT sobre fuentes_agua existe, pero SÓLO detrás del cheque de la rama
  -- privilegiada: el camino de anon/authenticated no pasa por ahí.
  PERFORM public.chk((SELECT (length(prosrc) - length(replace(prosrc, 'FROM public.fuentes_agua', '')))
                             / length('FROM public.fuentes_agua') FROM pg_proc WHERE oid = v_nueva), 1,
    'el trigger lee fuentes_agua en UN solo sitio');
  PERFORM public.chk((SELECT position('rolbypassrls' in prosrc) > 0
                        AND position('rolbypassrls' in prosrc) < position('FROM public.fuentes_agua' in prosrc)
                       FROM pg_proc WHERE oid = v_nueva), true,
    'y ese SELECT va DESPUÉS del cheque de rolsuper/rolbypassrls: es la rama privilegiada');
  PERFORM public.chk((SELECT position('FROM public.fuentes_agua' in prosrc) < position('agua_fuente_de_mi_empresa(NEW.fuente_id)' in prosrc)
                       FROM pg_proc WHERE oid = v_nueva), true,
    'la rama de usuario es la otra, y resuelve por la función acotada');

  -- Las policies de fuentes_agua no se han tocado: nada de USING (true).
  PERFORM public.chk((SELECT count(*) FROM pg_policies
    WHERE tablename = 'fuentes_agua' AND cmd = 'SELECT' AND qual LIKE '%user_has_permission%'), 1,
    'fuentes_agua_select sigue exigiendo agua.calidad.view (no se abrió la tabla)');
END $$;


-- ── La rama privilegiada y lo que la migración exigió antes de conceder ──────
DO $$
DECLARE
  v_fn3    oid := to_regprocedure('public.calcular_cumplimiento_calidad(text, jsonb, uuid)')::oid;
  v_nueva  oid := to_regprocedure('public.trg_registros_calidad_cumplimiento_catalogo()')::oid;
  v_fuente oid := to_regprocedure('public.agua_fuente_de_mi_empresa(uuid)')::oid;
  v_src    text;
  v_acl    text[];
  v_pol    record;
BEGIN
  -- El predicado del contrato privilegiado vive en la función de trigger, que
  -- es SECURITY INVOKER: es el único sitio donde CURRENT_USER es el invocador.
  v_src := (SELECT prosrc FROM pg_proc WHERE oid = v_nueva);
  PERFORM public.chk(v_src LIKE '%pg_catalog.pg_roles%' AND v_src LIKE '%rolbypassrls%', true,
    'el trigger decide la rama privilegiada con rolsuper/rolbypassrls sobre pg_catalog.pg_roles');
  PERFORM public.chk(v_src LIKE '%CURRENT_USER%', true,
    'y lo hace sobre CURRENT_USER, en una función SECURITY INVOKER');
  PERFORM public.chk(v_src LIKE '%FROM public.fuentes_agua fa%', true,
    'la rama privilegiada lee fuentes_agua con los permisos del propio invocador');
  PERFORM public.chk(v_src LIKE '%agua_fuente_de_mi_empresa%', true,
    'y la rama de usuario sigue pasando por la función acotada');
  -- La acotada NO mira current_user: allí sería el dueño y el cheque sería un bypass.
  PERFORM public.chk((SELECT prosrc ILIKE '%current_user%' FROM pg_proc WHERE oid = v_fuente), false,
    'la SECURITY DEFINER no mira current_user (allí es el dueño, no el invocador)');

  -- La firma de tres argumentos, tal como la migración exige verla ANTES de
  -- concederle EXECUTE a authenticated.
  PERFORM public.chk_txt((SELECT l.lanname FROM pg_proc p JOIN pg_language l ON l.oid = p.prolang WHERE p.oid = v_fn3),
    'plpgsql', 'calcular_cumplimiento_calidad(text, jsonb, uuid) · plpgsql');
  PERFORM public.chk_txt((SELECT provolatile::text FROM pg_proc WHERE oid = v_fn3), 's',
    'calcular_cumplimiento_calidad(text, jsonb, uuid) · STABLE');
  PERFORM public.chk((SELECT prosecdef FROM pg_proc WHERE oid = v_fn3), false,
    'calcular_cumplimiento_calidad(text, jsonb, uuid) · SECURITY INVOKER');
  PERFORM public.chk_txt((SELECT array_to_string(proconfig, ';') FROM pg_proc WHERE oid = v_fn3), 'search_path=""',
    'calcular_cumplimiento_calidad(text, jsonb, uuid) · search_path = ''''');
  PERFORM public.chk_txt((SELECT pg_get_function_identity_arguments(v_fn3)),
    'p_tipo_agua text, p_parametros jsonb, p_company_id uuid',
    'calcular_cumplimiento_calidad(text, jsonb, uuid) · argumentos exactos');
  PERFORM public.chk_txt((SELECT pg_get_function_result(v_fn3)), 'jsonb',
    'calcular_cumplimiento_calidad(text, jsonb, uuid) · devuelve jsonb, no SETOF');
  PERFORM public.chk((SELECT pronargs::bigint FROM pg_proc WHERE oid = v_fn3), 3,
    'calcular_cumplimiento_calidad(text, jsonb, uuid) · 3 argumentos');
  PERFORM public.chk((SELECT pronargdefaults::bigint FROM pg_proc WHERE oid = v_fn3), 1,
    'calcular_cumplimiento_calidad(text, jsonb, uuid) · 1 DEFAULT (el que causaba el 42725)');
  -- Cuerpo: sólo lee calidad_tipologias, y nada más de public.
  v_src := (SELECT prosrc FROM pg_proc WHERE oid = v_fn3);
  PERFORM public.chk(
    ((length(v_src) - length(replace(v_src, 'public.', ''))) / length('public.'))
      = ((length(v_src) - length(replace(v_src, 'public.calidad_tipologias', ''))) / length('public.calidad_tipologias')),
    true, 'su cuerpo no referencia ninguna relación de public salvo calidad_tipologias');
  PERFORM public.chk(v_src ~* '\m(execute|insert|update|delete|truncate|create|drop|alter|grant|revoke|copy|dblink|pg_read)\M',
    false, 'su cuerpo no escribe ni usa SQL dinámico');

  -- ACL posterior: el conjunto exacto.
  SELECT array_agg(x ORDER BY x) INTO v_acl FROM (
    SELECT DISTINCT CASE WHEN a.grantee = 0 THEN 'PUBLIC' ELSE a.grantee::regrole::text END AS x
      FROM pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
     WHERE p.oid = v_fn3 AND a.privilege_type = 'EXECUTE') s;
  PERFORM public.chk_txt(array_to_string(v_acl, ','), 'authenticated,postgres,service_role',
    'la ACL de calcular_cumplimiento_calidad(text, jsonb, uuid) es exactamente {authenticated, postgres, service_role}');

  -- Y la RLS de la que depende su aislamiento.
  PERFORM public.chk((SELECT relrowsecurity FROM pg_class WHERE oid = 'public.calidad_tipologias'::regclass), true,
    'calidad_tipologias conserva la RLS: sin ella la firma INVOKER filtraría overrides ajenos');
  SELECT pol.polcmd::text AS cmd, pol.polpermissive,
         replace(pg_get_expr(pol.polqual, pol.polrelid), 'public.', '') AS qual,
         (SELECT array_agg(r.rolname::text ORDER BY r.rolname) FROM unnest(pol.polroles) rr JOIN pg_roles r ON r.oid = rr) AS roles
    INTO v_pol FROM pg_policy pol
   WHERE pol.polrelid = 'public.calidad_tipologias'::regclass AND pol.polname = 'calidad_tipologias_select';
  PERFORM public.chk_txt(v_pol.cmd, 'r', 'calidad_tipologias_select sigue siendo la policy de SELECT');
  PERFORM public.chk(v_pol.polpermissive, true, 'calidad_tipologias_select sigue siendo permisiva');
  PERFORM public.chk_txt(array_to_string(v_pol.roles, ','), 'authenticated', 'calidad_tipologias_select sigue siendo TO authenticated');
  PERFORM public.chk_txt(v_pol.qual, '((company_id IS NULL) OR (company_id = get_my_company_id()))',
    'calidad_tipologias_select conserva su USING exacto');
END $$;
