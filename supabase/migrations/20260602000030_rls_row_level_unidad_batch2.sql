-- ============================================================================
-- RLS row-level por unidad (cond:C2) — Batch 2: 10 tablas
-- ============================================================================
-- Continua cond:C2 batch 1 (20260602000020). Mismo pattern: agregar clausula
-- de unidad propia a las policies SELECT para residentes (rol cliente).
--
-- **Tablas batch 2** (todas con unidad_id, financiero/legal/soporte):
-- 1. avisos_cobro                 — financiero
-- 2. cobranza_judicial            — financiero/legal
-- 3. comunicados_condominio       — comunicacion
-- 4. convenios_cuota_cond         — financiero
-- 5. notificaciones_enviadas      — comunicacion
-- 6. planes_pago_condominio       — financiero
-- 7. reclamos_condominio          — soporte
-- 8. sanciones_condominio         — legal
-- 9. solicitudes_residente        — soporte
-- 10. sugerencias_condominio      — soporte
--
-- Acumulado tras batch 2: 18 tablas con RLS row-level por unidad.
-- Pendiente: ~22 tablas mas en batches 3/4.
-- ============================================================================

DROP POLICY IF EXISTS "avisos_cobro_select" ON public.avisos_cobro;
CREATE POLICY "avisos_cobro_select" ON public.avisos_cobro FOR SELECT TO authenticated
  USING (is_super_admin() OR ((company_id = get_my_company_id()) AND user_has_permission('condominios.tab.avisos_cobro'))
         OR (unidad_id IN (SELECT u.id FROM unidades u JOIN app_users au ON au.cliente_id = u.cliente_id WHERE au.id = (SELECT auth.uid()) AND u.activo = true)));

DROP POLICY IF EXISTS "cobranza_judicial_select" ON public.cobranza_judicial;
CREATE POLICY "cobranza_judicial_select" ON public.cobranza_judicial FOR SELECT TO authenticated
  USING (is_super_admin() OR ((company_id = get_my_company_id()) AND user_has_permission('condominios.tab.cobranza_judicial'))
         OR (unidad_id IN (SELECT u.id FROM unidades u JOIN app_users au ON au.cliente_id = u.cliente_id WHERE au.id = (SELECT auth.uid()) AND u.activo = true)));

DROP POLICY IF EXISTS "comunicados_condominio_select" ON public.comunicados_condominio;
CREATE POLICY "comunicados_condominio_select" ON public.comunicados_condominio FOR SELECT TO authenticated
  USING (is_super_admin() OR ((company_id = get_my_company_id()) AND user_has_permission('condominios.tab.comunicados'))
         OR (unidad_id IN (SELECT u.id FROM unidades u JOIN app_users au ON au.cliente_id = u.cliente_id WHERE au.id = (SELECT auth.uid()) AND u.activo = true)));

DROP POLICY IF EXISTS "convenios_cuota_cond_select" ON public.convenios_cuota_cond;
CREATE POLICY "convenios_cuota_cond_select" ON public.convenios_cuota_cond FOR SELECT TO authenticated
  USING (is_super_admin() OR ((company_id = get_my_company_id()) AND user_has_permission('condominios.tab.convenios_cuota'))
         OR (unidad_id IN (SELECT u.id FROM unidades u JOIN app_users au ON au.cliente_id = u.cliente_id WHERE au.id = (SELECT auth.uid()) AND u.activo = true)));

DROP POLICY IF EXISTS "notificaciones_enviadas_select" ON public.notificaciones_enviadas;
CREATE POLICY "notificaciones_enviadas_select" ON public.notificaciones_enviadas FOR SELECT TO authenticated
  USING (is_super_admin() OR ((company_id = get_my_company_id()) AND user_has_permission('condominios.tab.notificaciones_enviadas'))
         OR (unidad_id IN (SELECT u.id FROM unidades u JOIN app_users au ON au.cliente_id = u.cliente_id WHERE au.id = (SELECT auth.uid()) AND u.activo = true)));

DROP POLICY IF EXISTS "planes_pago_condominio_select" ON public.planes_pago_condominio;
CREATE POLICY "planes_pago_condominio_select" ON public.planes_pago_condominio FOR SELECT TO authenticated
  USING (is_super_admin() OR ((company_id = get_my_company_id()) AND user_has_permission('condominios.tab.plan_pago'))
         OR (unidad_id IN (SELECT u.id FROM unidades u JOIN app_users au ON au.cliente_id = u.cliente_id WHERE au.id = (SELECT auth.uid()) AND u.activo = true)));

DROP POLICY IF EXISTS "reclamos_condominio_select" ON public.reclamos_condominio;
CREATE POLICY "reclamos_condominio_select" ON public.reclamos_condominio FOR SELECT TO authenticated
  USING (is_super_admin() OR ((company_id = get_my_company_id()) AND user_has_permission('condominios.tab.reclamos'))
         OR (unidad_id IN (SELECT u.id FROM unidades u JOIN app_users au ON au.cliente_id = u.cliente_id WHERE au.id = (SELECT auth.uid()) AND u.activo = true)));

DROP POLICY IF EXISTS "sanciones_condominio_select" ON public.sanciones_condominio;
CREATE POLICY "sanciones_condominio_select" ON public.sanciones_condominio FOR SELECT TO authenticated
  USING (is_super_admin() OR ((company_id = get_my_company_id()) AND user_has_permission('condominios.tab.sanciones'))
         OR (unidad_id IN (SELECT u.id FROM unidades u JOIN app_users au ON au.cliente_id = u.cliente_id WHERE au.id = (SELECT auth.uid()) AND u.activo = true)));

DROP POLICY IF EXISTS "solicitudes_residente_select" ON public.solicitudes_residente;
CREATE POLICY "solicitudes_residente_select" ON public.solicitudes_residente FOR SELECT TO authenticated
  USING (is_super_admin() OR ((company_id = get_my_company_id()) AND user_has_permission('condominios.tab.solicitudes'))
         OR (unidad_id IN (SELECT u.id FROM unidades u JOIN app_users au ON au.cliente_id = u.cliente_id WHERE au.id = (SELECT auth.uid()) AND u.activo = true)));

DROP POLICY IF EXISTS "sugerencias_condominio_select" ON public.sugerencias_condominio;
CREATE POLICY "sugerencias_condominio_select" ON public.sugerencias_condominio FOR SELECT TO authenticated
  USING (is_super_admin() OR ((company_id = get_my_company_id()) AND user_has_permission('condominios.tab.buzon_sugerencias'))
         OR (unidad_id IN (SELECT u.id FROM unidades u JOIN app_users au ON au.cliente_id = u.cliente_id WHERE au.id = (SELECT auth.uid()) AND u.activo = true)));
