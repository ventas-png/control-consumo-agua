-- Huella del catálogo que deja 20261124000000: si re-aplicarla cambia algo, cambia el hash.
SELECT md5(string_agg(x, E'\n' ORDER BY x)) FROM (
  SELECT 'trg|' || tgrelid::regclass || '|' || tgname || '|' || pg_get_triggerdef(t.oid)
    FROM pg_trigger t WHERE NOT tgisinternal
     AND tgrelid IN ('public.servicios_housekeeping'::regclass, 'public.servicio_housekeeping_fotos'::regclass,
                     'public.servicio_housekeeping_inconvenientes'::regclass)
  UNION ALL
  SELECT 'fn|' || p.oid::regprocedure || '|' || md5(pg_get_functiondef(p.oid)) || '|' || coalesce(p.proacl::text,'')
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname LIKE 'hk\_%'
  UNION ALL
  SELECT 'idx|' || indexname || '|' || indexdef FROM pg_indexes
   WHERE schemaname = 'public' AND tablename IN ('servicio_housekeeping_fotos', 'servicio_housekeeping_inconvenientes')
  UNION ALL
  SELECT 'col|' || table_name || '|' || column_name || '|' || data_type || '|' || is_nullable || '|' || coalesce(column_default, '')
    FROM information_schema.columns
   WHERE table_schema = 'public' AND table_name IN ('servicio_housekeeping_fotos', 'servicio_housekeeping_inconvenientes')
  UNION ALL
  SELECT 'con|' || conrelid::regclass || '|' || conname || '|' || pg_get_constraintdef(c.oid) FROM pg_constraint c
   WHERE c.conrelid IN ('public.servicio_housekeeping_fotos'::regclass, 'public.servicio_housekeeping_inconvenientes'::regclass)
     AND c.contype IN ('f', 'c', 'u', 'p')
  UNION ALL
  SELECT 'pol|' || schemaname || '.' || tablename || '|' || policyname || '|' || coalesce(qual, '') || '|' || coalesce(with_check, '')
    FROM pg_policies WHERE tablename IN ('servicio_housekeeping_fotos', 'servicio_housekeeping_inconvenientes')
  UNION ALL
  SELECT 'acl|' || c.relname || '|' || coalesce(c.relacl::text, '') FROM pg_class c
   WHERE c.relname IN ('servicio_housekeeping_fotos', 'servicio_housekeeping_inconvenientes')
  UNION ALL
  SELECT 'com|' || a.attrelid::regclass || '|' || a.attname || '|' || coalesce(col_description(a.attrelid, a.attnum), '')
    FROM pg_attribute a
   WHERE a.attrelid IN ('public.servicios_housekeeping'::regclass, 'public.servicio_housekeeping_fotos'::regclass)
     AND a.attnum > 0 AND NOT a.attisdropped
  UNION ALL
  SELECT 'dat|' || count(*) FROM public.servicio_housekeeping_inconvenientes
) t(x);
