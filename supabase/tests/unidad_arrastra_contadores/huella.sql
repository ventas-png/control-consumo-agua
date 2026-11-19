-- Huella del catálogo que deja 20261204000000: si re-aplicarla cambia algo, cambia el hash.
SELECT md5(string_agg(x, E'\n' ORDER BY x)) FROM (
  SELECT 'trg|' || tgrelid::regclass || '|' || tgname || '|' || pg_get_triggerdef(t.oid)
    FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
   WHERE NOT tgisinternal AND c.relname IN ('unidades', 'contadores', 'agua_historial_lecturas')
  UNION ALL
  SELECT 'fn|' || p.oid::regprocedure || '|' || md5(pg_get_functiondef(p.oid)) || '|' || coalesce(p.proacl::text, '')
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname IN ('unidad_arrastra_contadores', 'contador_arrastra_historial')
  UNION ALL
  SELECT 'dato|' || c.id || '|' || c.project_id || '|' || coalesce(c.company_id::text, '') FROM public.contadores c
  UNION ALL
  SELECT 'hist|' || h.id || '|' || h.project_id || '|' || h.company_id FROM public.agua_historial_lecturas h
) t(x);
