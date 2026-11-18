-- Huella del catálogo que deja 20261202000000: si re-aplicarla cambia algo, cambia el hash.
SELECT md5(string_agg(x, E'\n' ORDER BY x)) FROM (
  SELECT 'fn|' || p.oid::regprocedure || '|' || md5(pg_get_functiondef(p.oid)) || '|' || coalesce(p.proacl::text, '')
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname LIKE 'rentas\_%'
  UNION ALL
  SELECT 'col|' || column_name || '|' || data_type || '|' || is_nullable || '|' || coalesce(column_default, '')
    FROM information_schema.columns
   WHERE table_schema = 'public' AND table_name = 'rentas_inventario'
  UNION ALL
  SELECT 'con|' || conname || '|' || pg_get_constraintdef(c.oid)
    FROM pg_constraint c WHERE c.conrelid = 'public.rentas_inventario'::regclass
  UNION ALL
  SELECT 'pol|' || policyname || '|' || cmd || '|' || array_to_string(roles, ',') || '|' || coalesce(qual, '') || '|' || coalesce(with_check, '')
    FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects'
  UNION ALL
  SELECT 'bkt|' || id || '|' || public || '|' || coalesce(file_size_limit::text, '') || '|' || coalesce(allowed_mime_types::text, '')
    FROM storage.buckets
) t(x);
