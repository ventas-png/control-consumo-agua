-- Huella del catálogo que deja 20261031000100: si re-aplicarla cambia algo, cambia el hash.
SELECT md5(string_agg(x, E'\n' ORDER BY x)) FROM (
  SELECT 'trg|' || tgrelid::regclass || '|' || tgname || '|' || pg_get_triggerdef(t.oid)
    FROM pg_trigger t WHERE NOT tgisinternal
     AND tgrelid IN ('public.str_importaciones'::regclass, 'public.str_importacion_filas'::regclass, 'public.reservas_str'::regclass)
  UNION ALL
  SELECT 'fn|' || p.oid::regprocedure || '|' || md5(pg_get_functiondef(p.oid)) || '|' || coalesce(p.proacl::text,'')
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname LIKE 'str\_%'
  UNION ALL
  SELECT 'idx|' || indexname || '|' || indexdef FROM pg_indexes
   WHERE schemaname = 'public' AND tablename IN ('str_importaciones', 'str_importacion_filas')
  UNION ALL
  SELECT 'col|' || table_name || '|' || column_name || '|' || data_type || '|' || is_nullable FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name IN ('str_importaciones', 'str_importacion_filas')
  UNION ALL
  SELECT 'con|' || conrelid::regclass || '|' || conname || '|' || pg_get_constraintdef(c.oid) FROM pg_constraint c
    WHERE c.conrelid IN ('public.str_importaciones'::regclass, 'public.str_importacion_filas'::regclass)
  UNION ALL
  SELECT 'pol|' || tablename || '|' || policyname || '|' || coalesce(qual, '') || '|' || coalesce(with_check, '')
    FROM pg_policies WHERE tablename IN ('str_importaciones', 'str_importacion_filas', 'reservas_str')
  UNION ALL
  SELECT 'acl|' || relname || '|' || coalesce(relacl::text, '') FROM pg_class
    WHERE relname IN ('str_importaciones', 'str_importacion_filas')
) t(x);
