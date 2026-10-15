-- Huella del catálogo que deja 20261030000100: si re-aplicarla cambia algo, cambia el hash.
SELECT md5(string_agg(x, E'\n' ORDER BY x)) FROM (
  SELECT 'trg|' || tgrelid::regclass || '|' || tgname || '|' || pg_get_triggerdef(t.oid)
    FROM pg_trigger t WHERE NOT tgisinternal AND tgrelid = 'public.servicios_housekeeping'::regclass
  UNION ALL
  SELECT 'fn|' || p.oid::regprocedure || '|' || md5(pg_get_functiondef(p.oid)) || '|' || coalesce(p.proacl::text,'')
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND (p.proname LIKE 'hk\_responsable%' OR p.proname = 'usuario_tiene_permiso')
  UNION ALL
  SELECT 'idx|' || indexname || '|' || indexdef FROM pg_indexes WHERE schemaname = 'public' AND tablename = 'servicios_housekeeping'
  UNION ALL
  SELECT 'col|' || column_name || '|' || data_type || '|' || is_nullable FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'servicios_housekeeping'
  UNION ALL
  SELECT 'fk|' || conname || '|' || pg_get_constraintdef(c.oid) FROM pg_constraint c
    WHERE c.conrelid = 'public.servicios_housekeeping'::regclass AND c.contype = 'f'
  UNION ALL
  SELECT 'com|' || a.attname || '|' || coalesce(col_description('public.servicios_housekeeping'::regclass, a.attnum), '')
    FROM pg_attribute a WHERE a.attrelid = 'public.servicios_housekeeping'::regclass AND a.attnum > 0 AND NOT a.attisdropped
) t(x);
