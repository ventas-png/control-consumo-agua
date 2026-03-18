-- ============================================================
-- 1. Fix mutable search_path on all public functions
-- ============================================================

-- current_user_role: only accesses public.app_users
ALTER FUNCTION public.current_user_role()
  SET search_path = public, pg_temp;

-- request_password_reset (text variant): uses gen_random_bytes from pgcrypto
ALTER FUNCTION public.request_password_reset(text, text, text)
  SET search_path = public, extensions, pg_temp;

-- request_password_reset (varchar variant): uses gen_random_bytes from pgcrypto
ALTER FUNCTION public.request_password_reset(character varying, character varying, text)
  SET search_path = public, extensions, pg_temp;

-- validate_reset_token (text variant): only accesses public tables
ALTER FUNCTION public.validate_reset_token(text)
  SET search_path = public, pg_temp;

-- validate_reset_token (varchar variant): only accesses public tables
ALTER FUNCTION public.validate_reset_token(character varying)
  SET search_path = public, pg_temp;

-- update_user_password: only accesses public tables
ALTER FUNCTION public.update_user_password(character varying, character varying)
  SET search_path = public, pg_temp;

-- migrate_custom_auth_to_supabase_unconfirmed: uses crypt/gen_salt from pgcrypto
ALTER FUNCTION public.migrate_custom_auth_to_supabase_unconfirmed()
  SET search_path = public, extensions, pg_temp;

-- ============================================================
-- 2. Move extensions from public schema to extensions schema
-- ============================================================

ALTER EXTENSION pgcrypto SET SCHEMA extensions;
ALTER EXTENSION "uuid-ossp" SET SCHEMA extensions;
