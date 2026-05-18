-- ─── Migrate existing condominios_role(s) to user_roles ─────────────────────
-- For each user with a legacy single role or array, assign the matching
-- system role(s) via user_roles. Idempotent.

DO $$
DECLARE
  legacy_to_role_id jsonb := jsonb_build_object(
    'administrador_general', '00000000-0000-0000-0000-000000000001',
    'junta_directiva',       '00000000-0000-0000-0000-000000000002',
    'finanzas',              '00000000-0000-0000-0000-000000000003',
    'operaciones',           '00000000-0000-0000-0000-000000000004',
    'seguridad',             '00000000-0000-0000-0000-000000000005',
    'comunidad',             '00000000-0000-0000-0000-000000000006',
    'recepcion',             '00000000-0000-0000-0000-000000000007',
    'visualizador',          '00000000-0000-0000-0000-000000000008'
  );
BEGIN
  -- Path A: users with condominios_roles[] (array)
  INSERT INTO public.user_roles (user_id, role_id, assigned_at)
  SELECT
    u.id,
    (legacy_to_role_id ->> role_name)::uuid,
    now()
  FROM public.app_users u,
       LATERAL unnest(COALESCE(u.condominios_roles, ARRAY[]::text[])) AS role_name
  WHERE legacy_to_role_id ? role_name
  ON CONFLICT DO NOTHING;

  -- Path B: users with only the legacy condominios_role (single)
  -- Skipped if user already has condominios_roles[] populated
  INSERT INTO public.user_roles (user_id, role_id, assigned_at)
  SELECT
    u.id,
    (legacy_to_role_id ->> u.condominios_role)::uuid,
    now()
  FROM public.app_users u
  WHERE u.condominios_role IS NOT NULL
    AND legacy_to_role_id ? u.condominios_role
    AND (u.condominios_roles IS NULL OR u.condominios_roles = '{}')
  ON CONFLICT DO NOTHING;
END $$;
