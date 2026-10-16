-- Huella del catálogo que deja 20261031000300: si re-aplicarla cambia algo, cambia el hash.
SELECT md5(string_agg(x, E'\n' ORDER BY x)) FROM (
  SELECT 'trg|' || tgrelid::regclass || '|' || tgname || '|' || pg_get_triggerdef(t.oid)
    FROM pg_trigger t WHERE NOT tgisinternal
     AND tgrelid IN ('public.rrhh_cargos'::regclass, 'public.rrhh_tipos_turno'::regclass, 'public.projects'::regclass,
                     'public.personal_condominio'::regclass, 'public.plantillas_tarea_cargo'::regclass,
                     'public.programacion_limpieza'::regclass, 'public.ejecuciones_limpieza'::regclass)
  UNION ALL
  SELECT 'fn|' || p.oid::regprocedure || '|' || md5(pg_get_functiondef(p.oid)) || '|' || coalesce(p.proacl::text,'')
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND (p.proname LIKE 'rrhh\_%' OR p.proname IN ('plantillas_cargo_valida_cargo', 'plantillas_import_evaluar'))
  UNION ALL
  SELECT 'idx|' || indexname || '|' || indexdef FROM pg_indexes
   WHERE schemaname = 'public' AND tablename IN ('rrhh_cargos', 'rrhh_tipos_turno')
  UNION ALL
  SELECT 'col|' || table_name || '|' || column_name || '|' || data_type || '|' || is_nullable FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name IN ('rrhh_cargos', 'rrhh_tipos_turno')
  UNION ALL
  SELECT 'con|' || conrelid::regclass || '|' || conname || '|' || pg_get_constraintdef(c.oid) FROM pg_constraint c
    WHERE c.conrelid IN ('public.rrhh_cargos'::regclass, 'public.rrhh_tipos_turno'::regclass,
                         'public.programacion_limpieza'::regclass, 'public.ejecuciones_limpieza'::regclass)
  UNION ALL
  SELECT 'pol|' || tablename || '|' || policyname || '|' || coalesce(qual, '') || '|' || coalesce(with_check, '')
    FROM pg_policies WHERE tablename IN ('rrhh_cargos', 'rrhh_tipos_turno')
  UNION ALL
  SELECT 'acl|' || relname || '|' || coalesce(relacl::text, '') FROM pg_class
    WHERE relname IN ('rrhh_cargos', 'rrhh_tipos_turno')
  UNION ALL
  SELECT 'perm|' || key FROM public.permissions WHERE key LIKE 'condominios.tab.rrhh\_config%'
  UNION ALL
  SELECT 'rp|' || role_id || '|' || permission_key || '|' || effect FROM public.role_permissions WHERE permission_key LIKE 'condominios.tab.rrhh\_config%'
  UNION ALL
  SELECT 'cat|' || project_id || '|' || codigo || '|' || nombre || '|' || activo FROM public.rrhh_cargos
  UNION ALL
  SELECT 'tur|' || project_id || '|' || codigo || '|' || nombre || '|' || activo FROM public.rrhh_tipos_turno
) t(x);
