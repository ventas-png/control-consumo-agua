-- Huella del catálogo que deja 20261031000000: si re-aplicarla cambia algo, cambia el hash.
SELECT md5(string_agg(x, E'\n' ORDER BY x)) FROM (
  SELECT 'trg|' || tgrelid::regclass || '|' || tgname || '|' || pg_get_triggerdef(t.oid)
    FROM pg_trigger t WHERE NOT tgisinternal
     AND tgrelid IN ('public.servicios_housekeeping'::regclass, 'public.servicio_housekeeping_fotos'::regclass)
  UNION ALL
  SELECT 'fn|' || p.oid::regprocedure || '|' || md5(pg_get_functiondef(p.oid)) || '|' || coalesce(p.proacl::text,'')
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND (p.proname LIKE 'hk\_%' OR p.proname = 'run_hk_recordatorios_previos')
  UNION ALL
  SELECT 'idx|' || indexname || '|' || indexdef FROM pg_indexes
   WHERE schemaname = 'public' AND tablename IN ('servicios_housekeeping', 'hk_recordatorios_log')
  UNION ALL
  SELECT 'col|' || table_name || '|' || column_name || '|' || data_type || '|' || is_nullable FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name IN ('servicios_housekeeping', 'hk_recordatorios_log')
  UNION ALL
  SELECT 'con|' || conrelid::regclass || '|' || conname || '|' || pg_get_constraintdef(c.oid) FROM pg_constraint c
    WHERE c.conrelid IN ('public.servicios_housekeeping'::regclass, 'public.servicio_housekeeping_fotos'::regclass, 'public.hk_recordatorios_log'::regclass)
      AND c.contype IN ('f', 'c', 'u')
  UNION ALL
  SELECT 'pol|' || schemaname || '.' || tablename || '|' || policyname || '|' || coalesce(qual, '') || '|' || coalesce(with_check, '')
    FROM pg_policies WHERE (schemaname = 'storage' AND policyname LIKE 'hk\_%') OR tablename = 'hk_recordatorios_log'
  UNION ALL
  SELECT 'tpl|' || key || '|' || channel || '|' || md5(coalesce(subject, '') || body) FROM public.notification_templates
    WHERE company_id IS NULL AND key LIKE 'housekeeping\_%'
  UNION ALL
  SELECT 'cron|' || jobname || '|' || schedule || '|' || command FROM cron.job
  UNION ALL
  SELECT 'com|' || a.attname || '|' || coalesce(col_description('public.servicios_housekeeping'::regclass, a.attnum), '')
    FROM pg_attribute a WHERE a.attrelid = 'public.servicios_housekeeping'::regclass AND a.attnum > 0 AND NOT a.attisdropped
) t(x);
