-- Huella del catálogo que dejan 20261125000000 + 20261128000000: si re-aplicarla cambia algo, cambia el hash.
SELECT md5(string_agg(x, E'\n' ORDER BY x)) FROM (
  SELECT 'trg|' || tgrelid::regclass || '|' || tgname || '|' || pg_get_triggerdef(t.oid)
    FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
   WHERE NOT tgisinternal AND (c.relname LIKE 'rentas\_%' OR tgname = 'trg_companies_rentas_conceptos')
  UNION ALL
  SELECT 'fn|' || p.oid::regprocedure || '|' || md5(pg_get_functiondef(p.oid)) || '|' || coalesce(p.proacl::text,'')
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND (p.proname LIKE 'rentas\_%' OR p.proname = 'companies_rentas_conceptos')
  UNION ALL
  SELECT 'idx|' || indexname || '|' || indexdef FROM pg_indexes
   WHERE schemaname = 'public' AND tablename LIKE 'rentas\_%'
  UNION ALL
  SELECT 'col|' || table_name || '|' || column_name || '|' || data_type || '|' || is_nullable || '|' || coalesce(column_default, '')
    FROM information_schema.columns
   WHERE table_schema = 'public' AND (table_name LIKE 'rentas\_%' OR (table_name = 'companies' AND column_name = 'servicio_rentas'))
  UNION ALL
  SELECT 'con|' || conrelid::regclass || '|' || conname || '|' || pg_get_constraintdef(c.oid)
    FROM pg_constraint c JOIN pg_class r ON r.oid = c.conrelid WHERE r.relname LIKE 'rentas\_%'
  UNION ALL
  SELECT 'pol|' || tablename || '|' || policyname || '|' || cmd || '|' || coalesce(qual, '') || '|' || coalesce(with_check, '')
    FROM pg_policies WHERE tablename LIKE 'rentas\_%'
  UNION ALL
  SELECT 'acl|' || relname || '|' || coalesce(relacl::text, '') FROM pg_class
   WHERE relnamespace = 'public'::regnamespace AND relname LIKE 'rentas\_%' AND relkind = 'r'
  UNION ALL
  SELECT 'perm|' || key || '|' || category || '|' || label FROM public.permissions WHERE key LIKE 'rentas.%'
  UNION ALL
  SELECT 'grant|' || role_id || '|' || permission_key || '|' || effect FROM public.role_permissions WHERE permission_key LIKE 'rentas.%'
  UNION ALL
  SELECT 'concepto|' || company_id || '|' || bloque || '|' || codigo || '|' || nombre || '|' || signo || '|' || comisionable || '|' || orden
    FROM public.rentas_conceptos
) t(x);
