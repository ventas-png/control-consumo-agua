-- Huella de lo que deja 20261126000000: si re-aplicarla cambia algo, cambia el hash.
SELECT md5(string_agg(x, E'\n' ORDER BY x)) FROM (
  SELECT 'plan|' || code || '|' || base_activation_cents || '|' || includes_agua || includes_condominios || includes_rentas || '|' || feature_codes::text || '|' || sort_order
    FROM public.billing_plans
  UNION ALL
  SELECT 'fn|' || p.oid::regprocedure || '|' || md5(pg_get_functiondef(p.oid)) || '|' || coalesce(p.proacl::text, '')
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname IN ('plan_code_por_modulos', 'create_trial_subscription', 'companies_modulos_plan',
     'lock_companies_billing_columns', 'rentas_propiedades_independientes', 'calculate_monthly_total_cents', 'get_company_usage',
     'rentas_tope_unidades', 'get_superadmin_empresas')
  UNION ALL
  SELECT 'trg|' || tgrelid::regclass || '|' || tgname || '|' || pg_get_triggerdef(t.oid)
    FROM pg_trigger t WHERE NOT tgisinternal AND tgrelid IN ('public.companies'::regclass, 'public.rentas_propiedades'::regclass)
  UNION ALL
  SELECT 'mv|' || matviewname || '|' || md5(definition) FROM pg_matviews WHERE schemaname = 'public'
  UNION ALL
  SELECT 'idx|' || indexname || '|' || indexdef FROM pg_indexes WHERE schemaname = 'public' AND tablename LIKE 'mv\_superadmin%'
  UNION ALL
  SELECT 'acl|' || relname || '|' || coalesce(relacl::text, '') FROM pg_class
   WHERE relnamespace = 'public'::regnamespace AND relname LIKE 'mv\_superadmin%'
) t(x);
