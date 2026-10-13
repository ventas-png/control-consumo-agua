-- Huella del catálogo que deja la migración: si re-aplicarla cambia algo, cambia el hash.
SELECT md5(string_agg(x, E'\n' ORDER BY x)) FROM (
  SELECT 'pol|' || schemaname || '.' || tablename || '|' || policyname || '|' || cmd || '|' || coalesce(roles::text,'') || '|' || coalesce(qual,'') || '|' || coalesce(with_check,'')
    FROM pg_policies WHERE (schemaname = 'public' AND tablename IN ('servicio_housekeeping_fotos','hk_limpieza_storage','servicios_housekeeping'))
                        OR (schemaname = 'storage' AND policyname LIKE 'hk\_evidencias\_%')
  UNION ALL
  SELECT 'trg|' || tgrelid::regclass || '|' || tgname || '|' || pg_get_triggerdef(t.oid)
    FROM pg_trigger t WHERE NOT tgisinternal AND tgrelid IN ('public.servicio_housekeeping_fotos'::regclass, 'public.servicios_housekeeping'::regclass, 'public.hk_limpieza_storage'::regclass)
  UNION ALL
  SELECT 'fn|' || p.oid::regprocedure || '|' || md5(pg_get_functiondef(p.oid)) || '|' || coalesce(p.proacl::text,'')
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND p.proname LIKE 'hk\_%'
  UNION ALL
  SELECT 'idx|' || indexname || '|' || indexdef FROM pg_indexes WHERE schemaname = 'public' AND tablename IN ('servicio_housekeeping_fotos','hk_limpieza_storage')
  UNION ALL
  SELECT 'col|' || table_name || '|' || column_name || '|' || data_type || '|' || is_nullable FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name IN ('servicio_housekeeping_fotos','hk_limpieza_storage') OR (table_name = 'servicios_housekeeping' AND column_name IN ('hallazgos_ingreso','observaciones_cierre','iniciado_por','iniciado_en','completado_por','completado_en'))
  UNION ALL
  SELECT 'acl|' || c.relname || '|' || coalesce(c.relacl::text,'') FROM pg_class c WHERE c.relnamespace = 'public'::regnamespace AND c.relname IN ('servicio_housekeeping_fotos','hk_limpieza_storage')
) t(x);
