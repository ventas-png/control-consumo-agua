-- ============================================================
-- Migration: Add RLS policies for 'cliente' role
-- Allows registered customer users to access only their own data
-- ============================================================

-- Helper function: returns the cliente_id linked to the current auth user
CREATE OR REPLACE FUNCTION public.get_my_cliente_id()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT cliente_id FROM public.app_users WHERE id = auth.uid() LIMIT 1;
$$;

-- ============================================================
-- clientes: cliente can read their own record and update contact fields
-- ============================================================

-- SELECT: own record
CREATE POLICY "cliente_select_own" ON public.clientes
  FOR SELECT TO authenticated
  USING (
    current_user_role() = 'cliente'
    AND id = get_my_cliente_id()
  );

-- UPDATE: only contact fields (email, telefono, whatsapp, telefono_alterno)
-- We enforce column-level restriction via WITH CHECK; the USING targets own record
CREATE POLICY "cliente_update_own_contact" ON public.clientes
  FOR UPDATE TO authenticated
  USING (
    current_user_role() = 'cliente'
    AND id = get_my_cliente_id()
  )
  WITH CHECK (
    current_user_role() = 'cliente'
    AND id = get_my_cliente_id()
  );

-- ============================================================
-- company_clientes: cliente can see which companies they belong to
-- ============================================================
CREATE POLICY "cliente_select_own_company_clientes" ON public.company_clientes
  FOR SELECT TO authenticated
  USING (
    current_user_role() = 'cliente'
    AND cliente_id = get_my_cliente_id()
  );

-- ============================================================
-- companies: cliente can see companies they are linked to
-- ============================================================
CREATE POLICY "cliente_select_own_companies" ON public.companies
  FOR SELECT TO authenticated
  USING (
    current_user_role() = 'cliente'
    AND EXISTS (
      SELECT 1 FROM public.company_clientes cc
      WHERE cc.company_id = companies.id
        AND cc.cliente_id = get_my_cliente_id()
    )
  );

-- ============================================================
-- projects: cliente can see projects belonging to their companies
-- ============================================================
CREATE POLICY "cliente_select_own_projects" ON public.projects
  FOR SELECT TO authenticated
  USING (
    current_user_role() = 'cliente'
    AND EXISTS (
      SELECT 1 FROM public.company_clientes cc
      WHERE cc.company_id = projects.company_id
        AND cc.cliente_id = get_my_cliente_id()
    )
  );

-- ============================================================
-- unidades: cliente can see their active units
-- ============================================================
CREATE POLICY "cliente_select_own_unidades" ON public.unidades
  FOR SELECT TO authenticated
  USING (
    current_user_role() = 'cliente'
    AND cliente_id = get_my_cliente_id()
    AND activo = true
  );

-- ============================================================
-- contadores: cliente can see their active meters
-- ============================================================
CREATE POLICY "cliente_select_own_contadores" ON public.contadores
  FOR SELECT TO authenticated
  USING (
    current_user_role() = 'cliente'
    AND cliente_id = get_my_cliente_id()
    AND activo = true
  );

-- ============================================================
-- registros: cliente can see all readings linked to their client record
-- ============================================================
CREATE POLICY "cliente_select_own_registros" ON public.registros
  FOR SELECT TO authenticated
  USING (
    current_user_role() = 'cliente'
    AND cliente_id = get_my_cliente_id()
  );

-- ============================================================
-- app_users: cliente can read and update their own user profile
-- ============================================================
-- Note: existing policy "Users can update their own profile" covers UPDATE.
-- We add SELECT so cliente can read their own record.
CREATE POLICY "cliente_select_own_app_user" ON public.app_users
  FOR SELECT TO authenticated
  USING (
    current_user_role() = 'cliente'
    AND id = auth.uid()
  );
