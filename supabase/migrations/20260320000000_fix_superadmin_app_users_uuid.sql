-- Fix: superadmin@plataforma.com profile had a random UUID in app_users
-- that did not match the auth.users UUID, causing the user to appear as viewer.
-- This migration links the correct auth user UUID to the app_users profile.

DELETE FROM public.app_users WHERE id = 'eeace131-0d40-4696-9963-afe5671be881';

INSERT INTO public.app_users (id, full_name, role, company_id, activo, created_at)
VALUES (
  'acce8cd9-fb0b-4b03-8d21-564c42d88198',
  'Super Administrador',
  'superadmin',
  'acce8cd9-fb0b-4b03-8d21-564c42d88198',
  true,
  now()
);
