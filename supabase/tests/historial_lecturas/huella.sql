-- Huella del catálogo que deja 20261130000000: si re-aplicarla cambia algo, cambia el hash.
SELECT md5(string_agg(x, E'\n' ORDER BY x)) FROM (
  SELECT 'trg|' || tgrelid::regclass || '|' || tgname || '|' || pg_get_triggerdef(t.oid)
    FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
   WHERE NOT tgisinternal AND c.relname = 'agua_historial_lecturas'
  UNION ALL
  SELECT 'fn|' || p.oid::regprocedure || '|' || md5(pg_get_functiondef(p.oid)) || '|' || coalesce(p.proacl::text, '')
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname LIKE 'agua\_historial\_%'
  UNION ALL
  SELECT 'idx|' || indexname || '|' || indexdef FROM pg_indexes
   WHERE schemaname = 'public' AND tablename = 'agua_historial_lecturas'
  UNION ALL
  SELECT 'col|' || column_name || '|' || data_type || '|' || is_nullable || '|' || coalesce(column_default, '')
    FROM information_schema.columns
   WHERE table_schema = 'public' AND table_name = 'agua_historial_lecturas'
  UNION ALL
  SELECT 'con|' || conname || '|' || pg_get_constraintdef(c.oid)
    FROM pg_constraint c WHERE c.conrelid = 'public.agua_historial_lecturas'::regclass
  UNION ALL
  SELECT 'pol|' || policyname || '|' || cmd || '|' || coalesce(qual, '') || '|' || coalesce(with_check, '')
    FROM pg_policies WHERE tablename = 'agua_historial_lecturas'
  UNION ALL
  SELECT 'acl|' || coalesce(relacl::text, '') || '|' || relrowsecurity
    FROM pg_class WHERE oid = 'public.agua_historial_lecturas'::regclass
) t(x);
