-- ════════════════════════════════════════════════════════════════════════════
-- DESPUÉS de la migración: quién puede hacer qué, medido con el rol puesto
-- ════════════════════════════════════════════════════════════════════════════
--
-- No se pregunta por el catálogo: se INTENTA la operación con `SET LOCAL ROLE`
-- y se mira si sale. `filas_visibles` devuelve -1 cuando la denegó el GRANT y 0
-- cuando la denegó la RLS, y esa diferencia importa: son las dos capas, y esta
-- migración cierra las dos.

\set ON_ERROR_STOP on

DO $$
BEGIN
  -- ── 1 · anon: ni escribe ni lee ──────────────────────────────────────────
  PERFORM public.chk(public.puede_insertar('anon')::int, 0,
    'anon NO puede insertar');
  PERFORM public.chk(public.filas_visibles('anon'), -1,
    'anon NO puede leer, y lo deniega el GRANT (no la RLS): no le queda ni SELECT');

  -- ── 2 · authenticated normal: ni escribe ni lee ──────────────────────────
  PERFORM public.chk(public.puede_insertar('authenticated', 'viewer', '11111111-1111-4111-8111-111111111111'::uuid)::int, 0,
    'authenticated normal NO puede insertar, ni siquiera a su propio nombre');
  PERFORM public.chk(public.filas_visibles('authenticated', 'viewer'), 0,
    'authenticated normal NO lee ninguna fila (conserva el SELECT de tabla; lo deniega la RLS)');

  -- ── 3 · admin y company_owner de un tenant: NO leen el log global ────────
  --     Es la fuga entre tenants que cerraba `security_logs_select_by_role`.
  --     La tabla no tiene company_id: no hay forma de acotarla por empresa, así
  --     que la respuesta correcta es que un tenant no la vea en absoluto.
  PERFORM public.chk(public.filas_visibles('authenticated', 'admin'), 0,
    'un admin de tenant NO lee los logs globales (la fuga entre tenants, cerrada)');
  PERFORM public.chk(public.filas_visibles('authenticated', 'company_owner'), 0,
    'un company_owner de tenant NO lee los logs globales');
  PERFORM public.chk(public.puede_insertar('authenticated', 'admin')::int, 0,
    'un admin de tenant tampoco puede insertar');

  -- ── 4 · super_admin SÍ lee ───────────────────────────────────────────────
  --     El operador de la plataforma. Si esto se rompiera, el log no lo leería
  --     nadie y la migración habría cerrado de más.
  PERFORM public.chk(public.filas_visibles('authenticated', 'super_admin'), 2,
    'super_admin SÍ lee los 2 logs');
  PERFORM public.chk(public.puede_insertar('authenticated', 'super_admin')::int, 0,
    'super_admin lee pero NO escribe: escribir es de service_role');

  -- ── 5 · service_role escribe ─────────────────────────────────────────────
  --     Es lo que hacen log-security-event y create-cliente-account.
  PERFORM public.chk(public.puede_insertar('service_role')::int, 1,
    'service_role SÍ puede escribir (log-security-event y create-cliente-account)');
  -- Los INSERT de prueba se deshacen (ver `puede_insertar`), así que el conteo
  -- es estable y no depende del orden de las aserciones.
  PERFORM public.chk(public.filas_visibles('service_role'), 2,
    'service_role lee las 2 filas (BYPASSRLS)');
END $$;

-- ── 6 · RLS y grants: el estado del catálogo, no sólo el comportamiento ────
DO $$
DECLARE v_priv text;
BEGIN
  PERFORM public.chk(
    (SELECT relrowsecurity::int FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relname = 'security_logs'),
    1, 'la RLS sigue HABILITADA');

  PERFORM public.chk(
    (SELECT count(*) FROM pg_policies WHERE schemaname = 'public' AND tablename = 'security_logs'),
    1, 'queda UNA policy (las tres de producción, retiradas)');

  PERFORM public.chk(
    (SELECT count(*) FROM pg_policies
      WHERE schemaname = 'public' AND tablename = 'security_logs'
        AND policyname = 'security_logs_select_superadmin' AND cmd = 'SELECT'),
    1, 'y es security_logs_select_superadmin, SELECT, la del repositorio');

  -- Las tres, por nombre: que el conteo dé 1 no dice CUÁLES se fueron.
  FOREACH v_priv IN ARRAY ARRAY['security_logs_insert_anon',
                                'security_logs_insert_authenticated',
                                'security_logs_select_by_role'] LOOP
    PERFORM public.chk(
      (SELECT count(*) FROM pg_policies
        WHERE schemaname = 'public' AND tablename = 'security_logs' AND policyname = v_priv),
      0, format('la policy %s ya no existe', v_priv));
  END LOOP;

  -- anon: cero privilegios. Ni uno.
  PERFORM public.chk(
    (SELECT count(*) FROM information_schema.role_table_grants
      WHERE table_schema = 'public' AND table_name = 'security_logs' AND grantee = 'anon'),
    0, 'anon se queda con CERO privilegios de tabla');

  -- authenticated: SELECT y sólo SELECT.
  PERFORM public.chk(
    (SELECT count(*) FROM information_schema.role_table_grants
      WHERE table_schema = 'public' AND table_name = 'security_logs' AND grantee = 'authenticated'),
    1, 'authenticated se queda con UN privilegio');
  PERFORM public.chk(
    (SELECT count(*) FROM information_schema.role_table_grants
      WHERE table_schema = 'public' AND table_name = 'security_logs'
        AND grantee = 'authenticated' AND privilege_type = 'SELECT'),
    1, 'y ese privilegio es SELECT (lo necesita la policy de super_admin)');

  -- service_role: SELECT + INSERT, y nada de UPDATE/DELETE.
  PERFORM public.chk(
    (SELECT count(*) FROM information_schema.role_table_grants
      WHERE table_schema = 'public' AND table_name = 'security_logs' AND grantee = 'service_role'),
    2, 'service_role se queda con DOS privilegios');
  FOREACH v_priv IN ARRAY ARRAY['SELECT', 'INSERT'] LOOP
    PERFORM public.chk(
      (SELECT count(*) FROM information_schema.role_table_grants
        WHERE table_schema = 'public' AND table_name = 'security_logs'
          AND grantee = 'service_role' AND privilege_type = v_priv),
      1, format('service_role conserva %s', v_priv));
  END LOOP;
  FOREACH v_priv IN ARRAY ARRAY['UPDATE', 'DELETE', 'TRUNCATE'] LOOP
    PERFORM public.chk(
      (SELECT count(*) FROM information_schema.role_table_grants
        WHERE table_schema = 'public' AND table_name = 'security_logs'
          AND grantee = 'service_role' AND privilege_type = v_priv),
      0, format('service_role NO conserva %s (el log es de sólo-anexar)', v_priv));
  END LOOP;

  -- PUBLIC no tiene nada, ni lo tenía: el REVOKE es la red por si algún día lo tiene.
  PERFORM public.chk(
    (SELECT count(*) FROM information_schema.role_table_grants
      WHERE table_schema = 'public' AND table_name = 'security_logs' AND grantee = 'PUBLIC'),
    0, 'PUBLIC no tiene ningún privilegio');
END $$;
