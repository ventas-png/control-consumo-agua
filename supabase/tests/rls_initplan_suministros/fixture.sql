-- Fixture para EJECUTAR 20260906000000 contra un Postgres de verdad.
--
-- LA IDEA DEL SANDBOX
-- El cambio es de forma, no de fondo: `(SELECT public.user_has_permission(…))`
-- en vez de la llamada desnuda. Justamente por eso hay que probarlo corriendo:
-- una migración que re-escribe ocho políticas puede teclear otro permiso, otro
-- nombre de política o dejar una tabla sin su regla, y el SQL seguiría siendo
-- válido. Se miden los MISMOS accesos antes y después y se exige que den igual.
--
-- Para que la medición valga, las políticas de partida tienen que ser las de
-- producción, no una imitación: por eso más abajo va `rbac_install_company_
-- policies` COPIADA LITERAL de 20260518000010 y aplicada a las dos tablas.
--
-- `auth.uid()` se emula con un GUC (`app.uid`), como en el resto de los
-- sandboxes: es lo que Supabase hace por debajo con el claim del JWT.

CREATE SCHEMA IF NOT EXISTS auth;
CREATE TABLE auth.users (id uuid PRIMARY KEY DEFAULT gen_random_uuid());

CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid
LANGUAGE sql STABLE AS $$
  SELECT NULLIF(current_setting('app.uid', true), '')::uuid
$$;

CREATE TABLE public.companies (id uuid PRIMARY KEY DEFAULT gen_random_uuid());
CREATE TABLE public.projects (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE
);
CREATE TABLE public.app_users (
  id         uuid PRIMARY KEY,
  full_name  text,
  company_id uuid REFERENCES public.companies(id) ON DELETE CASCADE,
  role       text NOT NULL DEFAULT 'operador',
  activo     boolean NOT NULL DEFAULT true
);

-- ── Helpers de identidad (SECURITY DEFINER como en prod, 20260518000008) ─────
-- Sin SECURITY DEFINER, el rol del test no puede leer `app_users` desde dentro
-- de una policy y la RLS devolvería 0 filas por falta de permisos en vez de por
-- la regla: el sandbox diría "aislado" estando roto.
GRANT USAGE ON SCHEMA auth TO PUBLIC;

CREATE OR REPLACE FUNCTION public.current_user_role() RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT role FROM public.app_users WHERE id = auth.uid()
$$;

CREATE OR REPLACE FUNCTION public.get_my_company_id() RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT company_id FROM public.app_users WHERE id = auth.uid()
$$;

CREATE OR REPLACE FUNCTION public.is_super_admin() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(public.current_user_role() IN ('super_admin', 'superadmin'), false)
$$;

CREATE TABLE public.permissions (
  key         text PRIMARY KEY,
  category    text,
  label       text,
  description text
);
CREATE TABLE public.role_permissions (
  role_id        uuid NOT NULL,
  permission_key text NOT NULL,
  effect         text NOT NULL DEFAULT 'allow',
  PRIMARY KEY (role_id, permission_key)
);
CREATE TABLE public.user_roles (
  user_id uuid NOT NULL,
  role_id uuid NOT NULL,
  PRIMARY KEY (user_id, role_id)
);

CREATE OR REPLACE FUNCTION public.user_has_permission(perm_key text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT
    COALESCE(public.current_user_role() IN
      ('super_admin', 'superadmin', 'company_owner', 'admin'), false)
    OR EXISTS (
      SELECT 1 FROM public.user_roles ur
      JOIN public.role_permissions rp ON rp.role_id = ur.role_id
      WHERE ur.user_id = auth.uid()
        AND rp.permission_key = perm_key
        AND rp.effect = 'allow'
    )
$$;

-- ── Las dos tablas, con las columnas que tienen hoy en prod ─────────────────
-- `project_id` está aunque las políticas no lo miren (20260729000600 lo agregó):
-- el sandbox reproduce la tabla real, no la que le conviene a la prueba.
CREATE TABLE public.suministros_condominio (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id     uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  project_id     uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  nombre         text NOT NULL,
  categoria      text NOT NULL DEFAULT 'limpieza',
  unidad_medida  text NOT NULL DEFAULT 'unidad',
  stock_actual   numeric(10,2) NOT NULL DEFAULT 0,
  stock_minimo   numeric(10,2) NOT NULL DEFAULT 0,
  activo         boolean NOT NULL DEFAULT true,
  created_at     timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.suministros_condominio ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.movimientos_suministro (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id    uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  project_id    uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  suministro_id uuid NOT NULL REFERENCES public.suministros_condominio(id) ON DELETE CASCADE,
  tipo          text NOT NULL DEFAULT 'salida' CHECK (tipo IN ('entrada','salida','ajuste')),
  cantidad      numeric(10,2) NOT NULL,
  motivo        text,
  fecha         date NOT NULL DEFAULT CURRENT_DATE,
  created_at    timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.movimientos_suministro ENABLE ROW LEVEL SECURITY;

-- ── Las políticas de partida: el generador VIEJO, literal ───────────────────
-- Copia de 20260518000010:13-112 tal cual está en main, con la llamada desnuda.
-- Es lo que hace honesta la comparación: se mide contra las políticas que hay
-- en producción hoy, no contra una aproximación escrita para el test.
CREATE OR REPLACE FUNCTION public.rbac_install_company_policies(
  tbl text,
  perm_key text
) RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  pol record;
  existing_ops text[];
  had_select boolean := false;
  had_insert boolean := false;
  had_update boolean := false;
  had_delete boolean := false;
BEGIN
  -- Detect which operations had policies BEFORE we drop them. This preserves
  -- existing immutability patterns (e.g., audit-style tables with no UPDATE).
  -- Matches both canonical (_select|insert|update|delete) and truncated
  -- (_sel|ins|upd|del) suffixes used by older migrations.
  SELECT array_agg(DISTINCT cmd) INTO existing_ops
  FROM pg_policies
  WHERE schemaname = 'public' AND tablename = tbl
    AND policyname ~ '_(select|insert|update|delete|sel|ins|upd|del)$'
    AND policyname NOT ILIKE '%cliente%';

  IF existing_ops IS NOT NULL THEN
    had_select := 'SELECT' = ANY(existing_ops) OR 'ALL' = ANY(existing_ops);
    had_insert := 'INSERT' = ANY(existing_ops) OR 'ALL' = ANY(existing_ops);
    had_update := 'UPDATE' = ANY(existing_ops) OR 'ALL' = ANY(existing_ops);
    had_delete := 'DELETE' = ANY(existing_ops) OR 'ALL' = ANY(existing_ops);
  ELSE
    -- No prior CRUD policies → assume the table was fully open or new;
    -- install all four operations.
    had_select := true; had_insert := true; had_update := true; had_delete := true;
  END IF;

  -- Drop existing CRUD policies (skip cliente-specific ones). Same regex as
  -- the detection above so we drop every legacy policy that "covered" CRUD.
  FOR pol IN
    SELECT policyname FROM pg_policies
    WHERE schemaname = 'public' AND tablename = tbl
      AND policyname ~ '_(select|insert|update|delete|sel|ins|upd|del)$'
      AND policyname NOT ILIKE '%cliente%'
  LOOP
    EXECUTE format('DROP POLICY %I ON public.%I', pol.policyname, tbl);
  END LOOP;

  IF had_select THEN
    EXECUTE format($pol$
      CREATE POLICY %I ON public.%I
        FOR SELECT TO authenticated
        USING (
          public.is_super_admin()
          OR (company_id = public.get_my_company_id()
              AND public.user_has_permission(%L))
        )
    $pol$, tbl || '_select', tbl, perm_key);
  END IF;

  IF had_insert THEN
    EXECUTE format($pol$
      CREATE POLICY %I ON public.%I
        FOR INSERT TO authenticated
        WITH CHECK (
          public.is_super_admin()
          OR (company_id = public.get_my_company_id()
              AND public.user_has_permission(%L))
        )
    $pol$, tbl || '_insert', tbl, perm_key);
  END IF;

  IF had_update THEN
    EXECUTE format($pol$
      CREATE POLICY %I ON public.%I
        FOR UPDATE TO authenticated
        USING (
          public.is_super_admin()
          OR (company_id = public.get_my_company_id()
              AND public.user_has_permission(%L))
        )
        WITH CHECK (
          public.is_super_admin()
          OR (company_id = public.get_my_company_id()
              AND public.user_has_permission(%L))
        )
    $pol$, tbl || '_update', tbl, perm_key, perm_key);
  END IF;

  IF had_delete THEN
    EXECUTE format($pol$
      CREATE POLICY %I ON public.%I
        FOR DELETE TO authenticated
        USING (
          public.is_super_admin()
          OR (public.current_user_role() = ANY(ARRAY['company_owner','admin'])
              AND company_id = public.get_my_company_id())
        )
    $pol$, tbl || '_delete', tbl);
  END IF;
END;
$$;

SELECT public.rbac_install_company_policies('suministros_condominio', 'condominios.tab.suministros');
SELECT public.rbac_install_company_policies('movimientos_suministro',  'condominios.tab.suministros');

-- ── GRANTs de tabla, como en producción ─────────────────────────────────────
-- Supabase los otorga por defecto y lo que decide quién ve y escribe qué es la
-- RLS. Sin esto, un rechazo podría venir del privilegio faltante y no de la
-- política: mismo SQLSTATE (42501), y todo el sandbox mediría otra cosa.
GRANT USAGE ON SCHEMA public TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO anon, authenticated;

-- ── Dónde se anotan las mediciones ──────────────────────────────────────────
-- Sin RLS y sin GRANT: sólo el superusuario escribe aquí, después de soltar el
-- rol de prueba. Es el cuaderno del test, no parte del escenario.
CREATE TABLE public.medicion (
  etapa     text NOT NULL,
  caso      text NOT NULL,
  resultado text NOT NULL,
  PRIMARY KEY (etapa, caso)
);
REVOKE ALL ON public.medicion FROM anon, authenticated;

-- ── Padrón ──────────────────────────────────────────────────────────────────
-- Todos `operador`: `user_has_permission` auto-concede a company_owner y admin
-- (20260518000008), así que con esos roles el permiso no probaría nada.
--
--   Bruno  empresa 1, CON `condominios.tab.suministros`
--   Ana    empresa 1, SIN el permiso
--   Dana   empresa 2, CON el permiso — para el corte entre empresas
INSERT INTO public.companies (id) VALUES
  ('c0000000-0000-0000-0000-000000000001'),
  ('c0000000-0000-0000-0000-000000000002');
INSERT INTO public.projects (id, company_id) VALUES
  ('11111111-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000001'),
  ('11111111-0000-0000-0000-000000000002', 'c0000000-0000-0000-0000-000000000002');

INSERT INTO auth.users (id) VALUES
  ('a0000000-0000-0000-0000-00000000000a'),
  ('a0000000-0000-0000-0000-00000000000b'),
  ('a0000000-0000-0000-0000-00000000000d');
INSERT INTO public.app_users (id, full_name, company_id, role) VALUES
  ('a0000000-0000-0000-0000-00000000000a', 'Ana',   'c0000000-0000-0000-0000-000000000001', 'operador'),
  ('a0000000-0000-0000-0000-00000000000b', 'Bruno', 'c0000000-0000-0000-0000-000000000001', 'operador'),
  ('a0000000-0000-0000-0000-00000000000d', 'Dana',  'c0000000-0000-0000-0000-000000000002', 'operador');

INSERT INTO public.permissions (key) VALUES
  ('condominios.tab.suministros'),
  ('condominios.tab.tareas_personal');
INSERT INTO public.user_roles (user_id, role_id) VALUES
  ('a0000000-0000-0000-0000-00000000000a', 'd0000000-0000-0000-0000-00000000000a'),
  ('a0000000-0000-0000-0000-00000000000b', 'd0000000-0000-0000-0000-00000000000b'),
  ('a0000000-0000-0000-0000-00000000000d', 'd0000000-0000-0000-0000-00000000000d');
INSERT INTO public.role_permissions (role_id, permission_key) VALUES
  ('d0000000-0000-0000-0000-00000000000a', 'condominios.tab.tareas_personal'),
  ('d0000000-0000-0000-0000-00000000000b', 'condominios.tab.suministros'),
  ('d0000000-0000-0000-0000-00000000000d', 'condominios.tab.suministros');

-- Un insumo por empresa: el de la 2 existe para que "no ver" signifique algo.
INSERT INTO public.suministros_condominio (id, company_id, project_id, nombre) VALUES
  ('50000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000001',
   '11111111-0000-0000-0000-000000000001', 'Cloro'),
  ('50000000-0000-0000-0000-000000000002', 'c0000000-0000-0000-0000-000000000002',
   '11111111-0000-0000-0000-000000000002', 'Cloro de la otra empresa');
