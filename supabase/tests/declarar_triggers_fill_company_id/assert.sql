-- ════════════════════════════════════════════════════════════════════════════
-- DESPUÉS de la migración: los dos triggers, celda por celda, en pg_catalog.
--
-- Es la definición que tiene hoy nnsqmeigtgewatameexo (pg_trigger, leído el
-- 2026-09-12): tgtype = 7 (ROW | BEFORE | INSERT), tgenabled = 'O', sin WHEN,
-- sin argumentos, no es constraint trigger, sin tablas de transición, y la
-- función es public.fill_company_id_from_user(). Además el texto que imprime
-- pg_get_triggerdef con search_path = public, byte a byte igual al de
-- producción.
--
-- Y lo que la migración NO debía mover: la función sigue SECURITY DEFINER y su
-- ACL sigue siendo la de 20260911223000 (sólo service_role).
-- ════════════════════════════════════════════════════════════════════════════
\set ON_ERROR_STOP on

SET LOCAL search_path = public;

DO $$
DECLARE
  v_fn       oid := to_regprocedure('public.fill_company_id_from_user()')::oid;
  v_esperado record;
  v_r        record;
BEGIN
  IF v_fn IS NULL THEN
    RAISE EXCEPTION '❌ no existe public.fill_company_id_from_user()';
  END IF;

  FOR v_esperado IN
    SELECT * FROM (VALUES
      ('public.fuentes_agua',      'fuentes_agua_fill_company_id',
       'CREATE TRIGGER fuentes_agua_fill_company_id BEFORE INSERT ON public.fuentes_agua FOR EACH ROW EXECUTE FUNCTION fill_company_id_from_user()'),
      ('public.registros_calidad', 'registros_calidad_fill_company_id',
       'CREATE TRIGGER registros_calidad_fill_company_id BEFORE INSERT ON public.registros_calidad FOR EACH ROW EXECUTE FUNCTION fill_company_id_from_user()')
    ) AS t(tabla, trigger, definicion)
  LOOP
    PERFORM public.chk(
      (SELECT count(*) FROM pg_trigger WHERE tgname = v_esperado.trigger AND NOT tgisinternal),
      1, format('exactamente un trigger llamado %s en todo el catálogo', v_esperado.trigger));

    SELECT t.oid, t.tgrelid, t.tgfoid, t.tgtype, t.tgenabled, t.tgnargs,
           (t.tgqual IS NOT NULL) AS con_when, t.tgconstraint, t.tgdeferrable, t.tginitdeferred,
           (t.tgoldtable IS NOT NULL OR t.tgnewtable IS NOT NULL) AS con_transicion
      INTO v_r
      FROM pg_trigger t WHERE t.tgname = v_esperado.trigger AND NOT t.tgisinternal;

    PERFORM public.chk_txt(
      (SELECT n.nspname || '.' || c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE c.oid = v_r.tgrelid),
      v_esperado.tabla, format('%s · tabla', v_esperado.trigger));
    PERFORM public.chk_txt(v_r.tgfoid::regprocedure::text, 'fill_company_id_from_user()',
      format('%s · función', v_esperado.trigger));
    PERFORM public.chk(v_r.tgtype, 7,
      format('%s · tgtype = 7 (ROW | BEFORE | INSERT)', v_esperado.trigger));
    PERFORM public.chk((v_r.tgtype & 1) <> 0, true, format('%s · FOR EACH ROW', v_esperado.trigger));
    PERFORM public.chk((v_r.tgtype & 2) <> 0, true, format('%s · BEFORE', v_esperado.trigger));
    PERFORM public.chk((v_r.tgtype & 4) <> 0, true, format('%s · INSERT', v_esperado.trigger));
    PERFORM public.chk((v_r.tgtype & (8 | 16 | 32 | 64)) = 0, true,
      format('%s · ni DELETE, ni UPDATE, ni TRUNCATE, ni INSTEAD OF', v_esperado.trigger));
    PERFORM public.chk_txt(v_r.tgenabled::text, 'O', format('%s · habilitado (tgenabled = O)', v_esperado.trigger));
    PERFORM public.chk(v_r.tgnargs, 0, format('%s · sin argumentos', v_esperado.trigger));
    PERFORM public.chk(v_r.con_when, false, format('%s · sin cláusula WHEN', v_esperado.trigger));
    PERFORM public.chk(v_r.tgconstraint::bigint, 0, format('%s · no es constraint trigger', v_esperado.trigger));
    PERFORM public.chk(v_r.tgdeferrable OR v_r.tginitdeferred, false, format('%s · no deferrable', v_esperado.trigger));
    PERFORM public.chk(v_r.con_transicion, false, format('%s · sin tablas de transición', v_esperado.trigger));
    PERFORM public.chk_txt(pg_get_triggerdef(v_r.oid), v_esperado.definicion,
      format('%s · pg_get_triggerdef igual al de producción', v_esperado.trigger));
  END LOOP;

  -- Lo que no debía moverse.
  PERFORM public.chk((SELECT prosecdef FROM pg_proc WHERE oid = v_fn), true,
    'fill_company_id_from_user() sigue siendo SECURITY DEFINER');
  PERFORM public.chk(has_function_privilege('public',        v_fn, 'EXECUTE'), false, 'PUBLIC        NO ejecuta fill_company_id_from_user()');
  PERFORM public.chk(has_function_privilege('anon',          v_fn, 'EXECUTE'), false, 'anon          NO ejecuta fill_company_id_from_user()');
  PERFORM public.chk(has_function_privilege('authenticated', v_fn, 'EXECUTE'), false, 'authenticated NO ejecuta fill_company_id_from_user()');
  PERFORM public.chk(has_function_privilege('service_role',  v_fn, 'EXECUTE'), true,  'service_role  SÍ ejecuta fill_company_id_from_user()');
END $$;
