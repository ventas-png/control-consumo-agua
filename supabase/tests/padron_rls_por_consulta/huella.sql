-- Huella de lo que toca 20261213000000: si re-aplicarla cambia algo, cambia el hash.
SELECT md5(string_agg(x, E'\n' ORDER BY x)) FROM (
  SELECT 'pol|' || tablename || '|' || policyname || '|' || cmd || '|' || permissive || '|' ||
         array_to_string(roles, ',') || '|' || coalesce(qual, '') || '|' || coalesce(with_check, '')
    FROM pg_policies WHERE schemaname = 'public' AND tablename IN ('contadores', 'unidades')
  UNION ALL
  SELECT 'fn|' || p.oid::regprocedure || '|' || md5(pg_get_functiondef(p.oid)) || '|' || coalesce(p.proacl::text, '')
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'mis_proyectos_asignados'
) t(x);
