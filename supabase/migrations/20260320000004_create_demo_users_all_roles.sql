-- Create demo users for each role (password: admin2026 for all)
-- All users belong to company: acce8cd9-fb0b-4b03-8d21-564c42d88198 (Mi Empresa)

DO $$
DECLARE
  admin_id    uuid := gen_random_uuid();
  operador_id uuid := gen_random_uuid();
  visor_id    uuid := gen_random_uuid();
  cid         uuid := 'acce8cd9-fb0b-4b03-8d21-564c42d88198';
  pwd         text := extensions.crypt('admin2026', extensions.gen_salt('bf'));
BEGIN

  /* ── ADMIN ── */
  INSERT INTO auth.users (
    id, instance_id, aud, role, email, encrypted_password,
    email_confirmed_at, created_at, updated_at,
    raw_app_meta_data, raw_user_meta_data, is_super_admin,
    confirmation_token, recovery_token,
    email_change, email_change_token_new, email_change_token_current
  ) VALUES (
    admin_id, '00000000-0000-0000-0000-000000000000',
    'authenticated', 'authenticated',
    'admin.demo@aquacontrol.com', pwd,
    now(), now(), now(),
    '{"provider":"email","providers":["email"]}', '{}', false,
    '', '', '', '', ''
  );
  INSERT INTO auth.identities (id, user_id, identity_data, provider, provider_id, last_sign_in_at, created_at, updated_at)
  VALUES (admin_id, admin_id,
    jsonb_build_object('sub', admin_id::text, 'email', 'admin.demo@aquacontrol.com', 'email_verified', true, 'provider', 'email'),
    'email', 'admin.demo@aquacontrol.com', now(), now(), now());
  INSERT INTO public.app_users (id, full_name, role, company_id, activo)
  VALUES (admin_id, 'Administrador Demo', 'admin', cid, true);

  /* ── OPERADOR ── */
  INSERT INTO auth.users (
    id, instance_id, aud, role, email, encrypted_password,
    email_confirmed_at, created_at, updated_at,
    raw_app_meta_data, raw_user_meta_data, is_super_admin,
    confirmation_token, recovery_token,
    email_change, email_change_token_new, email_change_token_current
  ) VALUES (
    operador_id, '00000000-0000-0000-0000-000000000000',
    'authenticated', 'authenticated',
    'operador.demo@aquacontrol.com', pwd,
    now(), now(), now(),
    '{"provider":"email","providers":["email"]}', '{}', false,
    '', '', '', '', ''
  );
  INSERT INTO auth.identities (id, user_id, identity_data, provider, provider_id, last_sign_in_at, created_at, updated_at)
  VALUES (operador_id, operador_id,
    jsonb_build_object('sub', operador_id::text, 'email', 'operador.demo@aquacontrol.com', 'email_verified', true, 'provider', 'email'),
    'email', 'operador.demo@aquacontrol.com', now(), now(), now());
  INSERT INTO public.app_users (id, full_name, role, company_id, activo)
  VALUES (operador_id, 'Operador Demo', 'operador', cid, true);

  /* ── VISOR ── */
  INSERT INTO auth.users (
    id, instance_id, aud, role, email, encrypted_password,
    email_confirmed_at, created_at, updated_at,
    raw_app_meta_data, raw_user_meta_data, is_super_admin,
    confirmation_token, recovery_token,
    email_change, email_change_token_new, email_change_token_current
  ) VALUES (
    visor_id, '00000000-0000-0000-0000-000000000000',
    'authenticated', 'authenticated',
    'visor.demo@aquacontrol.com', pwd,
    now(), now(), now(),
    '{"provider":"email","providers":["email"]}', '{}', false,
    '', '', '', '', ''
  );
  INSERT INTO auth.identities (id, user_id, identity_data, provider, provider_id, last_sign_in_at, created_at, updated_at)
  VALUES (visor_id, visor_id,
    jsonb_build_object('sub', visor_id::text, 'email', 'visor.demo@aquacontrol.com', 'email_verified', true, 'provider', 'email'),
    'email', 'visor.demo@aquacontrol.com', now(), now(), now());
  INSERT INTO public.app_users (id, full_name, role, company_id, activo)
  VALUES (visor_id, 'Visor Demo', 'visor', cid, true);

END $$;
