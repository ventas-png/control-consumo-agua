-- ════════════════════════════════════════════════════════════════════════════
-- Sandbox de recepción: andamiaje ANTERIOR al motor único
-- ════════════════════════════════════════════════════════════════════════════
-- QUÉ ES. La base desechable sobre la que el runner aplica LAS MIGRACIONES
-- REALES en orden (20260829 → 20260830 → 20260831 → 20260901) y después corre
-- los escenarios como cada usuario. No hay copia de SQL: lo que se prueba es el
-- archivo que se va a desplegar.
--
-- POR QUÉ ARRANCA "ANTES" DEL MOTOR. La primera versión de este sandbox creaba
-- `paquetes_recibidos` ya generalizada y simplificada, y eso ocultó un fallo
-- real: el FK de unidad decía ON DELETE SET NULL mientras dos CHECK exigían
-- `unidad_id NOT NULL`, así que borrar una unidad con historial abortaba con un
-- 23514 ilegible. Una tabla inventada a mano no tiene esa contradicción — hay
-- que dejar que la escriban las migraciones. Aquí se monta la tabla TAL COMO
-- ERA (unidad_id NOT NULL, FK CASCADE, sin `clase`) y son ellas las que la
-- transforman.
--
-- LO QUE NO ES. No reproduce GoTrue ni el resto del esquema; el andamiaje imita
-- los helpers de RBAC, no los importa.
--
-- Uso:  scripts/rls-evidencias-sandbox.sh
-- ════════════════════════════════════════════════════════════════════════════

\set ON_ERROR_STOP on

CREATE SCHEMA IF NOT EXISTS auth;
CREATE SCHEMA IF NOT EXISTS storage;

CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid
LANGUAGE sql STABLE AS $$
  SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;

-- ── storage: lo mínimo que tocan las policies y la RPC ──────────────────────
-- `foldername` es la de Supabase: parte por '/' y DESCARTA el último segmento
-- (el nombre del archivo). Para 'proy/pieza/f.jpg' devuelve {proy, pieza}.
CREATE TABLE storage.buckets (
  id text PRIMARY KEY,
  name text NOT NULL,
  public boolean NOT NULL DEFAULT false,
  file_size_limit bigint,
  allowed_mime_types text[]
);

CREATE TABLE storage.objects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bucket_id text NOT NULL REFERENCES storage.buckets(id),
  name text NOT NULL,
  owner uuid,
  -- Supabase guarda aquí mimetype/size; la RPC del acuse lo mira para exigir
  -- que la firma sea una imagen.
  metadata jsonb,
  UNIQUE (bucket_id, name)
);
ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION storage.foldername(name text) RETURNS text[]
LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE _parts text[];
BEGIN
  SELECT string_to_array(name, '/') INTO _parts;
  RETURN _parts[1 : array_length(_parts, 1) - 1];
END $$;

-- ── RBAC: copias fieles de los helpers de producción ────────────────────────
CREATE TABLE public.app_users (
  id uuid PRIMARY KEY, company_id uuid NOT NULL, role text NOT NULL, full_name text
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

-- COPIA FIEL de 20260518000008: para company_owner/admin dice true a CUALQUIER
-- clave. Por eso el reparto de borrado va por rol y no por permiso.
CREATE OR REPLACE FUNCTION public.user_has_permission(perm_key text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH me AS (SELECT role FROM public.app_users WHERE id = auth.uid())
  SELECT CASE
    WHEN auth.uid() IS NULL THEN false
    WHEN (SELECT role FROM me) IN ('super_admin','superadmin','company_owner','admin') THEN true
    ELSE EXISTS (
      SELECT 1 FROM public.user_roles ur
      JOIN public.role_permissions rp ON rp.role_id = ur.role_id
      WHERE ur.user_id = auth.uid() AND rp.permission_key = perm_key
        AND rp.effect = 'allow' AND (ur.expires_at IS NULL OR ur.expires_at > now())
    )
  END
$$;

CREATE TABLE public.projects (id uuid PRIMARY KEY, company_id uuid NOT NULL, nombre text);

-- can_access_project: exentos por rol (20260815000000) o asignación explícita.
CREATE OR REPLACE FUNCTION public.can_access_project(p_project_id uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT p_project_id IS NULL
     OR public.current_user_role() = ANY (ARRAY['super_admin','superadmin','company_owner'])
     OR (public.current_user_role() = 'admin'
         AND NOT EXISTS (SELECT 1 FROM public.user_project_assignments upa WHERE upa.user_id = auth.uid()))
     OR EXISTS (SELECT 1 FROM public.user_project_assignments upa
                 WHERE upa.user_id = auth.uid() AND upa.project_id = p_project_id)
$$;

CREATE TABLE public.unidades (
  id uuid PRIMARY KEY, company_id uuid NOT NULL, project_id uuid NOT NULL,
  nombre text, cliente_id uuid, activo boolean NOT NULL DEFAULT true
);
CREATE OR REPLACE FUNCTION public.mis_unidades_ids() RETURNS SETOF uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT u.id FROM public.unidades u
   WHERE u.activo AND u.cliente_id IS NOT NULL AND u.cliente_id = auth.uid()
$$;

-- ── paquetes_recibidos TAL COMO ESTABA ANTES DEL MOTOR ──────────────────────
-- Sin `clase`, con unidad_id NOT NULL y FK CASCADE. Las migraciones la
-- generalizan; el sandbox no se adelanta a ellas.
CREATE TABLE public.paquetes_recibidos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL,
  project_id uuid NOT NULL,
  unidad_id uuid NOT NULL REFERENCES public.unidades(id) ON DELETE CASCADE,
  tipo text NOT NULL DEFAULT 'paquete',
  estado text NOT NULL DEFAULT 'pendiente',
  descripcion text NOT NULL,
  direccion text NOT NULL DEFAULT 'entrante',
  remitente text,
  num_guia text,
  empresa_mensajeria text,
  notas text,
  fotos text[],
  firma_path text,
  entregado_a_nombre text,
  entregado_por uuid,
  entregado_via text,
  recibido_por uuid,
  notificado_at timestamptz,
  hora_recepcion timestamptz NOT NULL DEFAULT now(),
  hora_entrega timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.paquetes_recibidos ENABLE ROW LEVEL SECURITY;

CREATE ROLE anon;
CREATE ROLE authenticated;
-- service_role es el de las edge functions: en Supabase tiene BYPASSRLS y
-- privilegios plenos. Aquí igual, para que el sandbox no le regale una
-- restricción que en producción no tiene.
CREATE ROLE service_role BYPASSRLS;
GRANT USAGE ON SCHEMA public, auth, storage TO authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.paquetes_recibidos TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.paquetes_recibidos TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON storage.objects TO authenticated;
GRANT SELECT ON storage.buckets, public.app_users, public.unidades, public.projects TO authenticated;
-- `unidades` va sin RLS aquí a propósito: lo que se prueba de ella es la
-- INTEGRIDAD REFERENCIAL (el FK), no quién la ve.
GRANT SELECT, UPDATE, DELETE ON public.unidades TO authenticated;

-- ── Aserciones ──────────────────────────────────────────────────────────────
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

/**
 * Ejecuta `sql` esperando que REVIENTE. Si pasa, es un fallo del test.
 * Deja el SQLERRM en el mensaje para poder leer POR QUÉ falló.
 */
CREATE OR REPLACE FUNCTION public.assert_falla(sql text, mensaje text)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  BEGIN
    EXECUTE sql;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE '  ok  % [%]', mensaje, left(SQLERRM, 70);
    RETURN;
  END;
  RAISE EXCEPTION 'FALLO: % (la operación NO falló, y debía)', mensaje;
END $$;

/** Como assert_falla, pero exigiendo además el SQLSTATE. */
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
        mensaje, sqlstate_esperado, v_estado, left(SQLERRM, 60);
    END IF;
    RAISE NOTICE '  ok  % [%]', mensaje, v_estado;
    RETURN;
  END;
  RAISE EXCEPTION 'FALLO: % (la operación NO falló, y debía)', mensaje;
END $$;

GRANT EXECUTE ON FUNCTION public.assert_eq(bigint, bigint, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.assert_true(boolean, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.assert_falla(text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.assert_falla_con(text, text, text) TO authenticated;
