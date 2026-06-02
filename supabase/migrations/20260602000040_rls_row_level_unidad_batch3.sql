-- ============================================================================
-- RLS row-level por unidad (cond:C2) — Batch 3: 10 tablas
-- ============================================================================
-- Continua cond:C2/C2b. Mismo pattern para 10 tablas adicionales.
--
-- **Tablas batch 3** (privacidad/asset/operacional):
-- 1. accesos_residentes           — privacidad (acceso a accesos)
-- 2. bodegas_condominio           — asset asignado
-- 3. correspondencia_condominio   — comunicacion
-- 4. firmas_digitales             — legal (firmas de docs)
-- 5. lecturas_medidor_gas         — utility readings
-- 6. parqueos_condominio          — asset asignado
-- 7. permisos_obra_unidad         — legal/operacional
-- 8. prestamos_equipo             — operacional
-- 9. solicitudes_certificado      — admin/legal
-- 10. solicitudes_concierge       — operacional
--
-- Acumulado tras batch 3: 28 tablas con RLS row-level por unidad.
-- ============================================================================

DROP POLICY IF EXISTS "accesos_residentes_select" ON public.accesos_residentes;
CREATE POLICY "accesos_residentes_select" ON public.accesos_residentes FOR SELECT TO authenticated
  USING (is_super_admin() OR ((company_id = get_my_company_id()) AND user_has_permission('condominios.tab.accesos_res'))
         OR (unidad_id IN (SELECT u.id FROM unidades u JOIN app_users au ON au.cliente_id = u.cliente_id WHERE au.id = (SELECT auth.uid()) AND u.activo = true)));

DROP POLICY IF EXISTS "bodegas_condominio_select" ON public.bodegas_condominio;
CREATE POLICY "bodegas_condominio_select" ON public.bodegas_condominio FOR SELECT TO authenticated
  USING (is_super_admin() OR ((company_id = get_my_company_id()) AND user_has_permission('condominios.tab.bodegas'))
         OR (unidad_id IN (SELECT u.id FROM unidades u JOIN app_users au ON au.cliente_id = u.cliente_id WHERE au.id = (SELECT auth.uid()) AND u.activo = true)));

DROP POLICY IF EXISTS "correspondencia_condominio_select" ON public.correspondencia_condominio;
CREATE POLICY "correspondencia_condominio_select" ON public.correspondencia_condominio FOR SELECT TO authenticated
  USING (is_super_admin() OR ((company_id = get_my_company_id()) AND user_has_permission('condominios.tab.correspondencia'))
         OR (unidad_id IN (SELECT u.id FROM unidades u JOIN app_users au ON au.cliente_id = u.cliente_id WHERE au.id = (SELECT auth.uid()) AND u.activo = true)));

DROP POLICY IF EXISTS "firmas_digitales_select" ON public.firmas_digitales;
CREATE POLICY "firmas_digitales_select" ON public.firmas_digitales FOR SELECT TO authenticated
  USING (is_super_admin() OR ((company_id = get_my_company_id()) AND user_has_permission('condominios.tab.firmas'))
         OR (unidad_id IN (SELECT u.id FROM unidades u JOIN app_users au ON au.cliente_id = u.cliente_id WHERE au.id = (SELECT auth.uid()) AND u.activo = true)));

DROP POLICY IF EXISTS "lecturas_medidor_gas_select" ON public.lecturas_medidor_gas;
CREATE POLICY "lecturas_medidor_gas_select" ON public.lecturas_medidor_gas FOR SELECT TO authenticated
  USING (is_super_admin() OR ((company_id = get_my_company_id()) AND user_has_permission('condominios.tab.gas'))
         OR (unidad_id IN (SELECT u.id FROM unidades u JOIN app_users au ON au.cliente_id = u.cliente_id WHERE au.id = (SELECT auth.uid()) AND u.activo = true)));

DROP POLICY IF EXISTS "parqueos_condominio_select" ON public.parqueos_condominio;
CREATE POLICY "parqueos_condominio_select" ON public.parqueos_condominio FOR SELECT TO authenticated
  USING (is_super_admin() OR ((company_id = get_my_company_id()) AND user_has_permission('condominios.tab.parqueos'))
         OR (unidad_id IN (SELECT u.id FROM unidades u JOIN app_users au ON au.cliente_id = u.cliente_id WHERE au.id = (SELECT auth.uid()) AND u.activo = true)));

DROP POLICY IF EXISTS "permisos_obra_unidad_select" ON public.permisos_obra_unidad;
CREATE POLICY "permisos_obra_unidad_select" ON public.permisos_obra_unidad FOR SELECT TO authenticated
  USING (is_super_admin() OR ((company_id = get_my_company_id()) AND user_has_permission('condominios.tab.permisos_obra'))
         OR (unidad_id IN (SELECT u.id FROM unidades u JOIN app_users au ON au.cliente_id = u.cliente_id WHERE au.id = (SELECT auth.uid()) AND u.activo = true)));

DROP POLICY IF EXISTS "prestamos_equipo_select" ON public.prestamos_equipo;
CREATE POLICY "prestamos_equipo_select" ON public.prestamos_equipo FOR SELECT TO authenticated
  USING (is_super_admin() OR ((company_id = get_my_company_id()) AND user_has_permission('condominios.tab.prestamos'))
         OR (unidad_id IN (SELECT u.id FROM unidades u JOIN app_users au ON au.cliente_id = u.cliente_id WHERE au.id = (SELECT auth.uid()) AND u.activo = true)));

DROP POLICY IF EXISTS "solicitudes_certificado_select" ON public.solicitudes_certificado;
CREATE POLICY "solicitudes_certificado_select" ON public.solicitudes_certificado FOR SELECT TO authenticated
  USING (is_super_admin() OR ((company_id = get_my_company_id()) AND user_has_permission('condominios.tab.certificados'))
         OR (unidad_id IN (SELECT u.id FROM unidades u JOIN app_users au ON au.cliente_id = u.cliente_id WHERE au.id = (SELECT auth.uid()) AND u.activo = true)));

DROP POLICY IF EXISTS "solicitudes_concierge_select" ON public.solicitudes_concierge;
CREATE POLICY "solicitudes_concierge_select" ON public.solicitudes_concierge FOR SELECT TO authenticated
  USING (is_super_admin() OR ((company_id = get_my_company_id()) AND user_has_permission('condominios.tab.concierge'))
         OR (unidad_id IN (SELECT u.id FROM unidades u JOIN app_users au ON au.cliente_id = u.cliente_id WHERE au.id = (SELECT auth.uid()) AND u.activo = true)));
