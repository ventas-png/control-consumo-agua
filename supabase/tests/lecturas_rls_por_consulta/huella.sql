-- Huella de las policies que toca 20261212000000: si re-aplicarla cambia algo, cambia el hash.
SELECT md5(string_agg(x, E'\n' ORDER BY x)) FROM (
  SELECT 'pol|' || tablename || '|' || policyname || '|' || cmd || '|' || permissive || '|' ||
         array_to_string(roles, ',') || '|' || coalesce(qual, '') || '|' || coalesce(with_check, '')
    FROM pg_policies WHERE schemaname = 'public' AND tablename IN ('registros', 'bitacora_acciones')
) t(x);
