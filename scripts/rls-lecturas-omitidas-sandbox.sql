-- ════════════════════════════════════════════════════════════════════════════
-- Sandbox de lecturas omitidas: andamiaje sobre el que se aplica la migración
-- ════════════════════════════════════════════════════════════════════════════
-- QUÉ ES. La base desechable sobre la que el runner aplica la migración REAL
-- 20261224000000_agua_lecturas_omitidas.sql (el archivo entero, sin copiar
-- SQL) y después corre los escenarios como cada usuario.
--
-- LO QUE NO ES. No reproduce GoTrue ni el resto del esquema: las tablas que la
-- migración referencia (companies, projects, unidades, contadores, rutas,
-- registros) llevan sólo las columnas que toca, y los helpers de RBAC son
-- copias de los de producción (mismos que rls-evidencias-sandbox.sql).
--
-- Uso:  scripts/rls-lecturas-omitidas-sandbox.sh
-- ════════════════════════════════════════════════════════════════════════════

\set ON_ERROR_STOP on

CREATE SCHEMA IF NOT EXISTS auth;
CREATE SCHEMA IF NOT EXISTS storage;

CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid
LANGUAGE sql STABLE AS $$
  SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;

-- ── storage: lo mínimo que tocan las policies ───────────────────────────────
CREATE TABLE storage.buckets (
  id text PRIMARY KEY, name text NOT NULL, public boolean NOT NULL DEFAULT false,
  file_size_limit bigint, allowed_mime_types text[]
);
CREATE TABLE storage.objects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bucket_id text NOT NULL REFERENCES storage.buckets(id),
  name text NOT NULL, owner uuid, metadata jsonb,
  UNIQUE (bucket_id, name)
);
ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;

-- Como la de Supabase: parte por '/' y descarta el último segmento.
CREATE OR REPLACE FUNCTION storage.foldername(name text) RETURNS text[]
LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE _parts text[];
BEGIN
  SELECT string_to_array(name, '/') INTO _parts;
  RETURN _parts[1 : array_length(_parts, 1) - 1];
END $$;

-- ── RBAC: copias de los helpers de producción ───────────────────────────────
CREATE TABLE public.companies (id uuid PRIMARY KEY, nombre text);
CREATE TABLE public.app_users (
  id uuid PRIMARY KEY, company_id uuid, role text NOT NULL, full_name text
);
CREATE TABLE public.user_roles (user_id uuid NOT NULL, role_id uuid NOT NULL, expires_at timestamptz);
CREATE TABLE public.role_permissions (role_id uuid NOT NULL, permission_key text NOT NULL, effect text NOT NULL DEFAULT 'allow');
CREATE TABLE public.user_project_assignments (user_id uuid NOT NULL, project_id uuid NOT NULL);

CREATE OR REPLACE FUNCTION public.get_my_company_id() RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT company_id FROM public.app_users WHERE id = auth.uid()
$$;
CREATE OR REPLACE FUNCTION public.current_user_role() RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT role FROM public.app_users WHERE id = auth.uid()
$$;
CREATE OR REPLACE FUNCTION public.is_super_admin() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE((SELECT role FROM public.app_users WHERE id = auth.uid())
                  IN ('super_admin','superadmin'), false)
$$;
-- Copia de 20260518000008: exentos por rol, el DENY vence al allow.
CREATE OR REPLACE FUNCTION public.user_has_permission(perm_key text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH me AS (SELECT role FROM public.app_users WHERE id = auth.uid())
  SELECT CASE
    WHEN auth.uid() IS NULL THEN false
    WHEN (SELECT role FROM me) IN ('super_admin','superadmin','company_owner','admin') THEN true
    WHEN EXISTS (
      SELECT 1 FROM public.user_roles ur
      JOIN public.role_permissions rp ON rp.role_id = ur.role_id
      WHERE ur.user_id = auth.uid() AND rp.permission_key = perm_key
        AND rp.effect = 'deny' AND (ur.expires_at IS NULL OR ur.expires_at > now())
    ) THEN false
    ELSE EXISTS (
      SELECT 1 FROM public.user_roles ur
      JOIN public.role_permissions rp ON rp.role_id = ur.role_id
      WHERE ur.user_id = auth.uid() AND rp.permission_key = perm_key
        AND rp.effect = 'allow' AND (ur.expires_at IS NULL OR ur.expires_at > now())
    )
  END
$$;
-- La compuerta MFA no es lo que se prueba aquí.
CREATE OR REPLACE FUNCTION public.mfa_requirement_met() RETURNS boolean
LANGUAGE sql STABLE AS $$ SELECT true $$;

CREATE TABLE public.projects (id uuid PRIMARY KEY, company_id uuid NOT NULL REFERENCES public.companies(id), nombre text);

CREATE OR REPLACE FUNCTION public.can_access_project(p_project_id uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT p_project_id IS NULL
     OR public.current_user_role() = ANY (ARRAY['super_admin','superadmin','company_owner'])
     OR (public.current_user_role() = 'admin'
         AND NOT EXISTS (SELECT 1 FROM public.user_project_assignments upa WHERE upa.user_id = auth.uid()))
     OR EXISTS (SELECT 1 FROM public.user_project_assignments upa
                 WHERE upa.user_id = auth.uid() AND upa.project_id = p_project_id)
$$;

-- ── Tablas de agua: sólo las columnas que la migración toca ─────────────────
CREATE TABLE public.unidades (
  id uuid PRIMARY KEY, company_id uuid NOT NULL, project_id uuid NOT NULL REFERENCES public.projects(id),
  nombre text, cliente_id uuid, activo boolean NOT NULL DEFAULT true
);
CREATE TABLE public.contadores (
  id uuid PRIMARY KEY, company_id uuid NOT NULL, project_id uuid NOT NULL,
  unidad_id uuid REFERENCES public.unidades(id), numero_serie text, activo boolean NOT NULL DEFAULT true
);
CREATE TABLE public.rutas (
  id uuid PRIMARY KEY, company_id uuid, project_id uuid, nombre text
);
CREATE TABLE public.registros (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contador_id uuid REFERENCES public.contadores(id),
  fecha date NOT NULL DEFAULT current_date,
  lectura_actual numeric,
  deleted_at timestamptz
);

CREATE ROLE anon;
CREATE ROLE authenticated;
GRANT USAGE ON SCHEMA public, auth, storage TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON storage.objects TO authenticated;
GRANT SELECT ON storage.buckets TO authenticated;
-- En producción authenticated lee estas tablas (con su propia RLS, que aquí no
-- se prueba): la policy de la tabla nueva consulta `projects`.
GRANT SELECT ON public.projects, public.unidades, public.contadores, public.rutas,
  public.app_users, public.companies TO authenticated;
-- Por defecto Supabase da todo sobre public a authenticated y anon: la
-- migración tiene que QUITARLO, y el sandbox lo comprueba.
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO anon, authenticated;

-- ── Aserciones (las mismas de rls-evidencias-sandbox.sql) ───────────────────
CREATE OR REPLACE FUNCTION public.assert_eq(actual bigint, esperado bigint, mensaje text)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF actual IS DISTINCT FROM esperado THEN
    RAISE EXCEPTION 'FALLO: % (esperado %, obtenido %)', mensaje, esperado, actual;
  END IF;
  RAISE NOTICE '  ok  %', mensaje;
END $$;

CREATE OR REPLACE FUNCTION public.assert_true(cond boolean, mensaje text)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF cond IS NOT TRUE THEN RAISE EXCEPTION 'FALLO: %', mensaje; END IF;
  RAISE NOTICE '  ok  %', mensaje;
END $$;

CREATE OR REPLACE FUNCTION public.assert_falla_con(sql text, sqlstate_esperado text, mensaje text)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE v_estado text;
BEGIN
  BEGIN
    EXECUTE sql;
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_estado = RETURNED_SQLSTATE;
    IF v_estado IS DISTINCT FROM sqlstate_esperado THEN
      RAISE EXCEPTION 'FALLO: % (esperado SQLSTATE %, obtenido % — %)',
        mensaje, sqlstate_esperado, v_estado, left(SQLERRM, 80);
    END IF;
    RAISE NOTICE '  ok  % [%]', mensaje, v_estado;
    RETURN;
  END;
  RAISE EXCEPTION 'FALLO: % (la operación NO falló, y debía)', mensaje;
END $$;

-- Las aserciones se crean ANTES de la migración: los default privileges ya les
-- dan EXECUTE a authenticated.
