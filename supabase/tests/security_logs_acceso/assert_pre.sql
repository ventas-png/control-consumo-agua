-- ════════════════════════════════════════════════════════════════════════════
-- ANTES de la migración: el fixture REPRODUCE el hallazgo
-- ════════════════════════════════════════════════════════════════════════════
--
-- Si esto no falla como falla producción, el escenario no reproduce nada y las
-- aserciones de después no prueban nada. Es la mitad de la prueba que se suele
-- olvidar: primero hay que ver el agujero abierto.

\set ON_ERROR_STOP on

DO $$
BEGIN
  -- (1) UN VISITANTE SIN SESIÓN ESCRIBE EN EL LOG DE AUDITORÍA.
  --     `security_logs_insert_anon` lo permite, y el grant por defecto de
  --     Supabase le da el INSERT de tabla. Las dos capas abiertas a la vez.
  PERFORM public.chk(public.puede_insertar('anon')::int, 1,
    'ANTES · anon PUEDE insertar (policy security_logs_insert_anon + grant por defecto)');

  -- (2) Cualquier usuario con sesión, de cualquier tenant, también.
  PERFORM public.chk(public.puede_insertar('authenticated', 'viewer')::int, 1,
    'ANTES · authenticated PUEDE insertar (security_logs_insert_authenticated)');

  -- (3) LA FUGA ENTRE TENANTS. `security_logs_select_by_role` concede SELECT a
  --     `public` con `current_user_role() = ''admin''` y sin filtro por empresa
  --     —la tabla no tiene company_id—, así que el admin de un tenant lee los
  --     eventos de seguridad de TODOS.
  PERFORM public.chk(public.filas_visibles('authenticated', 'admin'), 2,
    'ANTES · un admin de tenant LEE los 2 logs globales (fuga entre tenants)');

  -- (4) El super_admin lee, que es lo único correcto de este estado.
  PERFORM public.chk(public.filas_visibles('authenticated', 'super_admin'), 2,
    'ANTES · super_admin lee los 2 logs');

  -- (5) Y las cuatro policies están, que es lo que mide el auditor: producción
  --     tiene 4 y el repositorio declara 1.
  PERFORM public.chk(
    (SELECT count(*) FROM pg_policies WHERE schemaname = 'public' AND tablename = 'security_logs'),
    4, 'ANTES · 4 policies, como en producción (el repositorio declara 1)');

  -- (6) La segunda capa, la que nadie miró: anon y authenticated tienen los
  --     SIETE privilegios de tabla.
  PERFORM public.chk(
    (SELECT count(*) FROM information_schema.role_table_grants
      WHERE table_schema = 'public' AND table_name = 'security_logs'
        AND grantee IN ('anon', 'authenticated')),
    14, 'ANTES · anon y authenticated tienen los 7 privilegios cada uno (14 en total)');
END $$;
