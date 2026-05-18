-- ─── RLS hardening on critical financial tables ─────────────────────────────
-- Adds permission-based enforcement on top of existing company_id isolation.
-- super_admin / company_owner / admin always pass (handled inside
-- user_has_permission). Other roles must have the canonical permission key.
--
-- Scope of this migration:
--   cuotas_condominio       -> condominios.tab.cuotas
--   gastos_condominio       -> condominios.tab.contabilidad
--   presupuesto_condominio  -> condominios.tab.presupuesto
--   cuotas_plan_pago        -> condominios.tab.plan_pago
--
-- Hardening of remaining condominios tables is intentionally deferred to
-- follow-up migrations so it can be rolled out incrementally and verified
-- table-by-table.

-- ─── cuotas_condominio ──────────────────────────────────────────────────────
DROP POLICY IF EXISTS "cuotas_condominio_select" ON public.cuotas_condominio;
CREATE POLICY "cuotas_condominio_select" ON public.cuotas_condominio
  FOR SELECT TO authenticated
  USING (
    is_super_admin()
    OR (
      company_id = get_my_company_id()
      AND public.user_has_permission('condominios.tab.cuotas')
    )
  );

DROP POLICY IF EXISTS "cuotas_condominio_insert" ON public.cuotas_condominio;
CREATE POLICY "cuotas_condominio_insert" ON public.cuotas_condominio
  FOR INSERT TO authenticated
  WITH CHECK (
    is_super_admin()
    OR (
      company_id = get_my_company_id()
      AND public.user_has_permission('condominios.tab.cuotas')
    )
  );

DROP POLICY IF EXISTS "cuotas_condominio_update" ON public.cuotas_condominio;
CREATE POLICY "cuotas_condominio_update" ON public.cuotas_condominio
  FOR UPDATE TO authenticated
  USING (
    is_super_admin()
    OR (
      company_id = get_my_company_id()
      AND public.user_has_permission('condominios.tab.cuotas')
    )
  )
  WITH CHECK (
    is_super_admin()
    OR (
      company_id = get_my_company_id()
      AND public.user_has_permission('condominios.tab.cuotas')
    )
  );

DROP POLICY IF EXISTS "cuotas_condominio_delete" ON public.cuotas_condominio;
CREATE POLICY "cuotas_condominio_delete" ON public.cuotas_condominio
  FOR DELETE TO authenticated
  USING (
    is_super_admin()
    OR (
      current_user_role() = ANY(ARRAY['company_owner','admin'])
      AND company_id = get_my_company_id()
    )
  );

-- ─── gastos_condominio ──────────────────────────────────────────────────────
-- Drop both possible legacy policy names so we have a clean slate
DROP POLICY IF EXISTS "gastos_select" ON public.gastos_condominio;
DROP POLICY IF EXISTS "gastos_insert" ON public.gastos_condominio;
DROP POLICY IF EXISTS "gastos_update" ON public.gastos_condominio;
DROP POLICY IF EXISTS "gastos_delete" ON public.gastos_condominio;
DROP POLICY IF EXISTS "gastos_condominio_select" ON public.gastos_condominio;
CREATE POLICY "gastos_condominio_select" ON public.gastos_condominio
  FOR SELECT TO authenticated
  USING (
    is_super_admin()
    OR (
      company_id = get_my_company_id()
      AND public.user_has_permission('condominios.tab.contabilidad')
    )
  );

DROP POLICY IF EXISTS "gastos_condominio_insert" ON public.gastos_condominio;
CREATE POLICY "gastos_condominio_insert" ON public.gastos_condominio
  FOR INSERT TO authenticated
  WITH CHECK (
    is_super_admin()
    OR (
      company_id = get_my_company_id()
      AND public.user_has_permission('condominios.tab.contabilidad')
    )
  );

DROP POLICY IF EXISTS "gastos_condominio_update" ON public.gastos_condominio;
CREATE POLICY "gastos_condominio_update" ON public.gastos_condominio
  FOR UPDATE TO authenticated
  USING (
    is_super_admin()
    OR (
      company_id = get_my_company_id()
      AND public.user_has_permission('condominios.tab.contabilidad')
    )
  )
  WITH CHECK (
    is_super_admin()
    OR (
      company_id = get_my_company_id()
      AND public.user_has_permission('condominios.tab.contabilidad')
    )
  );

DROP POLICY IF EXISTS "gastos_condominio_delete" ON public.gastos_condominio;
CREATE POLICY "gastos_condominio_delete" ON public.gastos_condominio
  FOR DELETE TO authenticated
  USING (
    is_super_admin()
    OR (
      current_user_role() = ANY(ARRAY['company_owner','admin'])
      AND company_id = get_my_company_id()
    )
  );

-- ─── presupuesto_condominio ─────────────────────────────────────────────────
DROP POLICY IF EXISTS "presupuesto_select" ON public.presupuesto_condominio;
DROP POLICY IF EXISTS "presupuesto_insert" ON public.presupuesto_condominio;
DROP POLICY IF EXISTS "presupuesto_update" ON public.presupuesto_condominio;
DROP POLICY IF EXISTS "presupuesto_delete" ON public.presupuesto_condominio;
DROP POLICY IF EXISTS "presupuesto_condominio_select" ON public.presupuesto_condominio;
CREATE POLICY "presupuesto_condominio_select" ON public.presupuesto_condominio
  FOR SELECT TO authenticated
  USING (
    is_super_admin()
    OR (
      company_id = get_my_company_id()
      AND public.user_has_permission('condominios.tab.presupuesto')
    )
  );

DROP POLICY IF EXISTS "presupuesto_condominio_insert" ON public.presupuesto_condominio;
CREATE POLICY "presupuesto_condominio_insert" ON public.presupuesto_condominio
  FOR INSERT TO authenticated
  WITH CHECK (
    is_super_admin()
    OR (
      company_id = get_my_company_id()
      AND public.user_has_permission('condominios.tab.presupuesto')
    )
  );

DROP POLICY IF EXISTS "presupuesto_condominio_update" ON public.presupuesto_condominio;
CREATE POLICY "presupuesto_condominio_update" ON public.presupuesto_condominio
  FOR UPDATE TO authenticated
  USING (
    is_super_admin()
    OR (
      company_id = get_my_company_id()
      AND public.user_has_permission('condominios.tab.presupuesto')
    )
  )
  WITH CHECK (
    is_super_admin()
    OR (
      company_id = get_my_company_id()
      AND public.user_has_permission('condominios.tab.presupuesto')
    )
  );

DROP POLICY IF EXISTS "presupuesto_condominio_delete" ON public.presupuesto_condominio;
CREATE POLICY "presupuesto_condominio_delete" ON public.presupuesto_condominio
  FOR DELETE TO authenticated
  USING (
    is_super_admin()
    OR (
      current_user_role() = ANY(ARRAY['company_owner','admin'])
      AND company_id = get_my_company_id()
    )
  );

-- ─── cuotas_plan_pago ───────────────────────────────────────────────────────
-- Existing policies may differ; we DROP IF EXISTS and recreate.
DROP POLICY IF EXISTS "cuota_plan_select" ON public.cuotas_plan_pago;
DROP POLICY IF EXISTS "cuotas_plan_pago_select" ON public.cuotas_plan_pago;
CREATE POLICY "cuotas_plan_pago_select" ON public.cuotas_plan_pago
  FOR SELECT TO authenticated
  USING (
    is_super_admin()
    OR (
      company_id = get_my_company_id()
      AND public.user_has_permission('condominios.tab.plan_pago')
    )
  );

DROP POLICY IF EXISTS "cuota_plan_insert" ON public.cuotas_plan_pago;
DROP POLICY IF EXISTS "cuotas_plan_pago_insert" ON public.cuotas_plan_pago;
CREATE POLICY "cuotas_plan_pago_insert" ON public.cuotas_plan_pago
  FOR INSERT TO authenticated
  WITH CHECK (
    is_super_admin()
    OR (
      company_id = get_my_company_id()
      AND public.user_has_permission('condominios.tab.plan_pago')
    )
  );

DROP POLICY IF EXISTS "cuota_plan_update" ON public.cuotas_plan_pago;
DROP POLICY IF EXISTS "cuotas_plan_pago_update" ON public.cuotas_plan_pago;
CREATE POLICY "cuotas_plan_pago_update" ON public.cuotas_plan_pago
  FOR UPDATE TO authenticated
  USING (
    is_super_admin()
    OR (
      company_id = get_my_company_id()
      AND public.user_has_permission('condominios.tab.plan_pago')
    )
  )
  WITH CHECK (
    is_super_admin()
    OR (
      company_id = get_my_company_id()
      AND public.user_has_permission('condominios.tab.plan_pago')
    )
  );

DROP POLICY IF EXISTS "cuota_plan_delete" ON public.cuotas_plan_pago;
DROP POLICY IF EXISTS "cuotas_plan_pago_delete" ON public.cuotas_plan_pago;
CREATE POLICY "cuotas_plan_pago_delete" ON public.cuotas_plan_pago
  FOR DELETE TO authenticated
  USING (
    is_super_admin()
    OR (
      current_user_role() = ANY(ARRAY['company_owner','admin'])
      AND company_id = get_my_company_id()
    )
  );
