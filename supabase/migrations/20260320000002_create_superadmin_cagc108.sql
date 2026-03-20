-- Create superadmin user: cagc108@gmail.com
-- Inserts into auth.users and app_users atomically via CTE

WITH new_user AS (
  INSERT INTO auth.users (
    id, instance_id, aud, role, email, encrypted_password,
    email_confirmed_at, created_at, updated_at,
    raw_app_meta_data, raw_user_meta_data, is_super_admin,
    confirmation_token, recovery_token, email_change_token_new
  )
  VALUES (
    gen_random_uuid(),
    '00000000-0000-0000-0000-000000000000',
    'authenticated', 'authenticated',
    'cagc108@gmail.com',
    extensions.crypt('admin2026', extensions.gen_salt('bf')),
    now(), now(), now(),
    '{"provider":"email","providers":["email"]}', '{}', false,
    '', '', ''
  )
  RETURNING id
)
INSERT INTO public.app_users (id, full_name, role, company_id, activo)
SELECT id, 'Super Administrador', 'super_admin',
       'acce8cd9-fb0b-4b03-8d21-564c42d88198', true
FROM new_user;
