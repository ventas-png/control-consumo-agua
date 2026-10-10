-- Fixture de la prueba de housekeeping_evidencias: lo mínimo de Supabase y del esquema
-- para EJECUTAR las migraciones reales en un Postgres de verdad.
--
-- · Roles/privilegios como en Supabase: `authenticated`/`anon`/`service_role` reciben ALL por
--   defecto en las tablas nuevas de `public` (es lo que la migración REVOCA), y `service_role`
--   salta la RLS.
-- · `auth.uid()` se emula con el GUC `app.uid` (mismo patrón que presencia_marcaje).
-- · Los helpers de acceso (`get_my_company_id`, `can_access_project`, `user_has_permission`…)
--   son COPIA de sus definiciones vigentes en el sandbox; los permisos de RBAC se reducen a la
--   tabla `test_permisos`.
-- · Las policies de `servicios_housekeeping` son las VIGENTES (consultadas en el sandbox), no la
--   versión original de 2026-04: exigen el permiso de pestaña y dan lectura a la unidad propia.

CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE SCHEMA IF NOT EXISTS auth;
CREATE SCHEMA IF NOT EXISTS storage;

GRANT USAGE ON SCHEMA public, auth, storage TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA storage GRANT ALL ON TABLES TO anon, authenticated, service_role;

CREATE TABLE auth.users (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), email text);

CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT NULLIF(current_setting('app.uid', true), '')::uuid
$$;

CREATE TABLE public.companies (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), nombre text);
CREATE TABLE public.projects  (id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE, nombre text);
CREATE TABLE public.app_users (id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name text, role text NOT NULL DEFAULT 'operator', activo boolean NOT NULL DEFAULT true,
  company_id uuid REFERENCES public.companies(id) ON DELETE CASCADE,
  project_id uuid REFERENCES public.projects(id) ON DELETE SET NULL);
CREATE TABLE public.user_project_assignments (user_id uuid NOT NULL REFERENCES public.app_users(id) ON DELETE CASCADE,
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE, PRIMARY KEY (user_id, project_id));
CREATE TABLE public.test_permisos (user_id uuid NOT NULL, permiso text NOT NULL);
CREATE TABLE public.test_mis_unidades (user_id uuid NOT NULL, unidad_id uuid NOT NULL);

CREATE FUNCTION public.current_user_role() RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT role FROM public.app_users WHERE id = auth.uid() $$;
CREATE FUNCTION public.get_my_company_id() RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT company_id FROM public.app_users WHERE id = auth.uid() LIMIT 1 $$;
CREATE FUNCTION public.is_super_admin() RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT current_user_role() IN ('super_admin', 'superadmin') $$;
CREATE FUNCTION public.user_has_permission(perm_key text) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT CASE
    WHEN auth.uid() IS NULL THEN false
    WHEN (SELECT role FROM public.app_users WHERE id = auth.uid()) IN ('super_admin','superadmin','company_owner','admin') THEN true
    ELSE EXISTS (SELECT 1 FROM public.test_permisos WHERE user_id = auth.uid() AND permiso = perm_key)
  END $$;
CREATE FUNCTION public.user_has_project_access(p_project_id uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT EXISTS (SELECT 1 FROM public.app_users WHERE id = auth.uid() AND project_id = p_project_id)
      OR EXISTS (SELECT 1 FROM public.user_project_assignments WHERE user_id = auth.uid() AND project_id = p_project_id) $$;
CREATE FUNCTION public.user_is_project_exempt() RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO '' AS $$
  SELECT public.current_user_role() = ANY (ARRAY['super_admin', 'superadmin', 'company_owner'])
    OR (public.current_user_role() = 'admin' AND NOT EXISTS (
        SELECT 1 FROM public.user_project_assignments upa WHERE upa.user_id = (SELECT auth.uid()))) $$;
CREATE FUNCTION public.can_access_project(p_project_id uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO '' AS $$
  SELECT p_project_id IS NULL OR public.user_is_project_exempt() OR public.user_has_project_access(p_project_id) $$;
CREATE FUNCTION public.mis_unidades_ids() RETURNS SETOF uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT unidad_id FROM public.test_mis_unidades WHERE user_id = auth.uid() $$;

GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO authenticated, service_role;

-- `sellar_actor()`: COPIA LITERAL de 20260731000000_trazabilidad_creado_por.sql
CREATE OR REPLACE FUNCTION public.sellar_actor()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_col  text := TG_ARGV[0];
  v_modo text := COALESCE(TG_ARGV[1], 'forzar');
  v_uid  uuid := auth.uid();
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF v_uid IS NOT NULL AND (v_modo = 'forzar' OR to_jsonb(NEW)->>v_col IS NULL) THEN
      NEW := jsonb_populate_record(NEW, jsonb_build_object(v_col, v_uid));
    END IF;
  ELSE
    -- INMUTABLE. Solo se reescribe si alguien intentó cambiarla, para no pagar
    -- el jsonb_populate_record en cada UPDATE normal.
    IF to_jsonb(NEW)->>v_col IS DISTINCT FROM to_jsonb(OLD)->>v_col THEN
      NEW := jsonb_populate_record(NEW, jsonb_build_object(v_col, to_jsonb(OLD)->>v_col));
    END IF;
  END IF;
  RETURN NEW;
END;
$$;


-- ── servicios_housekeeping tal como está hoy ────────────────────────────────
CREATE TABLE public.servicios_housekeeping (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id   uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  project_id   uuid NOT NULL REFERENCES public.projects(id)  ON DELETE CASCADE,
  unidad_id    uuid,
  tipo         text NOT NULL DEFAULT 'limpieza_estandar',
  fecha        date NOT NULL DEFAULT CURRENT_DATE,
  hora_inicio  time, hora_fin time, responsable text,
  estado       text NOT NULL DEFAULT 'pendiente',
  costo        numeric(10,2), notas text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  creado_por   uuid REFERENCES auth.users(id) ON DELETE SET NULL
);
ALTER TABLE public.servicios_housekeeping ENABLE ROW LEVEL SECURITY;
CREATE TRIGGER trg_sellar_creado_por BEFORE INSERT OR UPDATE ON public.servicios_housekeeping
  FOR EACH ROW EXECUTE FUNCTION public.sellar_actor('creado_por', 'forzar');

CREATE POLICY servicios_housekeeping_select ON public.servicios_housekeeping FOR SELECT TO authenticated USING (
  is_super_admin() OR ((company_id = get_my_company_id()) AND user_has_permission('condominios.tab.housekeeping'))
  OR (unidad_id IN (SELECT mis_unidades_ids())));
CREATE POLICY servicios_housekeeping_insert ON public.servicios_housekeeping FOR INSERT TO authenticated WITH CHECK (
  is_super_admin() OR ((company_id = get_my_company_id()) AND user_has_permission('condominios.tab.housekeeping')));
CREATE POLICY servicios_housekeeping_update ON public.servicios_housekeeping FOR UPDATE TO authenticated USING (
  is_super_admin() OR ((company_id = get_my_company_id()) AND user_has_permission('condominios.tab.housekeeping')))
  WITH CHECK (is_super_admin() OR ((company_id = get_my_company_id()) AND user_has_permission('condominios.tab.housekeeping')));
CREATE POLICY servicios_housekeeping_delete ON public.servicios_housekeeping FOR DELETE TO authenticated USING (
  is_super_admin() OR ((current_user_role() = ANY (ARRAY['company_owner','admin'])) AND (company_id = get_my_company_id())));

-- ── Storage (lo justo para que las policies del bucket se puedan ejercer) ───
CREATE TABLE storage.buckets (id text PRIMARY KEY, name text NOT NULL, public boolean NOT NULL DEFAULT false,
  file_size_limit bigint, allowed_mime_types text[]);
CREATE TABLE storage.objects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bucket_id text NOT NULL REFERENCES storage.buckets(id) ON DELETE CASCADE,
  name text NOT NULL, owner uuid, created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (bucket_id, name));
ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;
-- `storage.foldername`: las carpetas de la ruta, sin el archivo (igual que Supabase).
CREATE FUNCTION storage.foldername(name text) RETURNS text[] LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE _parts text[];
BEGIN
  SELECT string_to_array(name, '/') INTO _parts;
  RETURN _parts[1:array_length(_parts, 1) - 1];
END $$;
GRANT EXECUTE ON FUNCTION storage.foldername(text) TO anon, authenticated, service_role;
