-- ============================================================
-- Fix contadores: add INSERT + UPDATE policies for operators
-- Fix unidades: enable RLS and apply all scoped policies
--
-- Root causes:
--  1. contadores had SELECT-only for operators — INSERT/UPDATE blocked
--  2. unidades had RLS disabled — any authenticated user could access
--     all companies' unit data (security hole)
--
-- Idempotencia (infra:I41): cada CREATE POLICY va precedido por
-- DROP POLICY IF EXISTS porque varias de estas policies en `unidades`
-- ya fueron creadas en 20260324000003_create_unidades.sql con el mismo
-- nombre. Sin el DROP, Supabase Branching (DB nueva) falla con
-- "policy already exists". En producción el bug nunca afloró porque la
-- migración corrió una sola vez con estado limpio.
-- ============================================================

-- ── contadores: operator INSERT ───────────────────────────────
DROP POLICY IF EXISTS "operator insert contadores" ON public.contadores;
CREATE POLICY "operator insert contadores" ON public.contadores
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.app_users
      WHERE id = auth.uid()
        AND role IN ('operator', 'operador', 'user')
        AND project_id = contadores.project_id
    )
  );

-- ── contadores: operator UPDATE ───────────────────────────────
DROP POLICY IF EXISTS "operator update contadores" ON public.contadores;
CREATE POLICY "operator update contadores" ON public.contadores
  FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.app_users
      WHERE id = auth.uid()
        AND role IN ('operator', 'operador', 'user')
        AND project_id = contadores.project_id
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.app_users
      WHERE id = auth.uid()
        AND role IN ('operator', 'operador', 'user')
        AND project_id = contadores.project_id
    )
  );

-- ── unidades: enable RLS ──────────────────────────────────────
ALTER TABLE public.unidades ENABLE ROW LEVEL SECURITY;

-- super_admin: full access
DROP POLICY IF EXISTS "super_admin full access on unidades" ON public.unidades;
CREATE POLICY "super_admin full access on unidades" ON public.unidades
  FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.app_users
      WHERE id = auth.uid() AND role IN ('super_admin', 'superadmin')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.app_users
      WHERE id = auth.uid() AND role IN ('super_admin', 'superadmin')
    )
  );

-- company_owner: full access scoped to their company
DROP POLICY IF EXISTS "company_owner access on unidades" ON public.unidades;
CREATE POLICY "company_owner access on unidades" ON public.unidades
  FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.app_users
      WHERE id = auth.uid() AND role = 'company_owner' AND company_id = unidades.company_id
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.app_users
      WHERE id = auth.uid() AND role = 'company_owner' AND company_id = unidades.company_id
    )
  );

-- admin: full access via direct project_id OR via user_project_assignments
-- (mirrors the pattern already used in the live contadores admin policy)
DROP POLICY IF EXISTS "admin access on unidades" ON public.unidades;
CREATE POLICY "admin access on unidades" ON public.unidades
  FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.app_users
      WHERE id = auth.uid() AND role = 'admin' AND project_id = unidades.project_id
    )
    OR EXISTS (
      SELECT 1 FROM public.app_users u
      JOIN public.user_project_assignments upa ON upa.user_id = u.id
      WHERE u.id = auth.uid() AND u.role = 'admin' AND upa.project_id = unidades.project_id
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.app_users
      WHERE id = auth.uid() AND role = 'admin' AND project_id = unidades.project_id
    )
    OR EXISTS (
      SELECT 1 FROM public.app_users u
      JOIN public.user_project_assignments upa ON upa.user_id = u.id
      WHERE u.id = auth.uid() AND u.role = 'admin' AND upa.project_id = unidades.project_id
    )
  );

-- operator: SELECT scoped to their project
DROP POLICY IF EXISTS "operator read unidades" ON public.unidades;
CREATE POLICY "operator read unidades" ON public.unidades
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.app_users
      WHERE id = auth.uid()
        AND role IN ('operator', 'operador', 'user')
        AND project_id = unidades.project_id
    )
  );

-- operator: INSERT scoped to their project
DROP POLICY IF EXISTS "operator insert unidades" ON public.unidades;
CREATE POLICY "operator insert unidades" ON public.unidades
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.app_users
      WHERE id = auth.uid()
        AND role IN ('operator', 'operador', 'user')
        AND project_id = unidades.project_id
    )
  );

-- operator: UPDATE scoped to their project
DROP POLICY IF EXISTS "operator update unidades" ON public.unidades;
CREATE POLICY "operator update unidades" ON public.unidades
  FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.app_users
      WHERE id = auth.uid()
        AND role IN ('operator', 'operador', 'user')
        AND project_id = unidades.project_id
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.app_users
      WHERE id = auth.uid()
        AND role IN ('operator', 'operador', 'user')
        AND project_id = unidades.project_id
    )
  );

-- viewer: read-only scoped to their project
DROP POLICY IF EXISTS "viewer read unidades" ON public.unidades;
CREATE POLICY "viewer read unidades" ON public.unidades
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.app_users
      WHERE id = auth.uid()
        AND role IN ('viewer', 'visor', 'cliente')
        AND project_id = unidades.project_id
    )
  );
