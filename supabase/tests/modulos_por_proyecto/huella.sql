-- Huella de lo que deja 20261127000000: si re-aplicarla cambia algo, cambia el hash.
SELECT md5(string_agg(x, E'\n' ORDER BY x)) FROM (
  SELECT 'col|' || column_name || '|' || data_type || '|' || is_nullable || '|' || coalesce(column_default, '')
    FROM information_schema.columns
   WHERE table_schema = 'public' AND table_name = 'projects' AND column_name LIKE 'modulo\_%'
  UNION ALL
  SELECT 'fn|' || p.oid::regprocedure || '|' || md5(pg_get_functiondef(p.oid)) || '|' || coalesce(p.proacl::text, '')
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname IN ('projects_modulos_guard', 'portal_mis_unidades', 'rentas_propiedad_modulo_proyecto')
  UNION ALL
  SELECT 'trg|' || tgrelid::regclass || '|' || tgname || '|' || pg_get_triggerdef(t.oid)
    FROM pg_trigger t WHERE NOT tgisinternal AND tgrelid IN ('public.projects'::regclass, 'public.rentas_propiedades'::regclass)
) t(x);
