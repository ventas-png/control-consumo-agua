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
