-- ============================================================================
-- RLS row-level por unidad (cond:C2) — Batch 1: 8 tablas críticas
-- ============================================================================
-- Bloqueante absoluto del PR #166 §5. Antes el RLS filtraba por company_id
-- pero residentes con permission especial podian ver datos de TODAS las
-- unidades del condominio. Este PR agrega filtro de unidad propia para
-- residentes (rol cliente) en 8 tablas financieras y de privacidad.
--
-- **Pattern**: las policies tienen una clausula OR adicional que matchea
-- unidad_id IN (unidades del cliente actual). Asi:
--   1) super_admin sigue viendo todo
--   2) admin/operator con perm sigue viendo todo del company
--   3) residente cliente solo ve registros de SUS unidades
--
-- **Tablas (todas con unidad_id)**:
-- 1. mascotas                    — privacidad
-- 2. vehiculos_residentes         — privacidad
-- 3. historial_saldos_unidad      — financiero
-- 4. recibos_digitales            — financiero
-- 5. medidores_unidad             — utility readings
-- 6. infracciones_condominio      — legal
-- 7. recargos_mora                — financiero
-- 8. cargos_adicionales_unidad    — financiero
--
-- **Mismo patron ya usado** en visitantes, tickets_mantenimiento,
-- reservas_amenidades, paquetes_recibidos, mensajes_portal — este PR
-- replica el patron en 8 tablas faltantes.
--
-- **Solo SELECT**: las policies INSERT/UPDATE/DELETE quedan como estan
-- porque residentes no tienen los permisos admin necesarios para writes
-- en estas tablas. Si llega a necesitarse residentes-write (ej. mascotas),
-- se agrega en otro PR.
-- ============================================================================

-- ────────────────────────────────────────────────────────────────────────────
-- Helper inline: unidades del residente actual
-- ────────────────────────────────────────────────────────────────────────────
-- Subquery usada por todas las policies. Resuelve el cliente_id del auth user
-- y devuelve los ids de unidades activas que tiene asignadas.
--
-- No la encapsulamos en una funcion porque las subqueries inline son
-- optimizables por el planner y consistentes con el resto del codigo RLS.

-- ────────────────────────────────────────────────────────────────────────────
-- 1. mascotas
-- ────────────────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "mascotas_select" ON public.mascotas;
CREATE POLICY "mascotas_select"
  ON public.mascotas
  FOR SELECT
  TO authenticated
  USING (
    is_super_admin()
    OR ((company_id = get_my_company_id()) AND user_has_permission('condominios.tab.mascotas'))
    OR (unidad_id IN (
      SELECT u.id FROM unidades u
      JOIN app_users au ON au.cliente_id = u.cliente_id
      WHERE au.id = (SELECT auth.uid()) AND u.activo = true
    ))
  );

-- ────────────────────────────────────────────────────────────────────────────
-- 2. vehiculos_residentes
-- ────────────────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "vehiculos_residentes_select" ON public.vehiculos_residentes;
CREATE POLICY "vehiculos_residentes_select"
  ON public.vehiculos_residentes
  FOR SELECT
  TO authenticated
  USING (
    is_super_admin()
    OR ((company_id = get_my_company_id()) AND user_has_permission('condominios.tab.vehiculos'))
    OR (unidad_id IN (
      SELECT u.id FROM unidades u
      JOIN app_users au ON au.cliente_id = u.cliente_id
      WHERE au.id = (SELECT auth.uid()) AND u.activo = true
    ))
  );

-- ────────────────────────────────────────────────────────────────────────────
-- 3. historial_saldos_unidad
-- ────────────────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "historial_saldos_unidad_select" ON public.historial_saldos_unidad;
CREATE POLICY "historial_saldos_unidad_select"
  ON public.historial_saldos_unidad
  FOR SELECT
  TO authenticated
  USING (
    is_super_admin()
    OR ((company_id = get_my_company_id()) AND user_has_permission('condominios.tab.historial_saldos'))
    OR (unidad_id IN (
      SELECT u.id FROM unidades u
      JOIN app_users au ON au.cliente_id = u.cliente_id
      WHERE au.id = (SELECT auth.uid()) AND u.activo = true
    ))
  );

-- ────────────────────────────────────────────────────────────────────────────
-- 4. recibos_digitales
-- ────────────────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "recibos_digitales_select" ON public.recibos_digitales;
CREATE POLICY "recibos_digitales_select"
  ON public.recibos_digitales
  FOR SELECT
  TO authenticated
  USING (
    is_super_admin()
    OR ((company_id = get_my_company_id()) AND user_has_permission('condominios.tab.recibos_digitales'))
    OR (unidad_id IN (
      SELECT u.id FROM unidades u
      JOIN app_users au ON au.cliente_id = u.cliente_id
      WHERE au.id = (SELECT auth.uid()) AND u.activo = true
    ))
  );

-- ────────────────────────────────────────────────────────────────────────────
-- 5. medidores_unidad
-- ────────────────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "medidores_unidad_select" ON public.medidores_unidad;
CREATE POLICY "medidores_unidad_select"
  ON public.medidores_unidad
  FOR SELECT
  TO authenticated
  USING (
    is_super_admin()
    OR ((company_id = get_my_company_id()) AND user_has_permission('condominios.tab.medidores_unidad'))
    OR (unidad_id IN (
      SELECT u.id FROM unidades u
      JOIN app_users au ON au.cliente_id = u.cliente_id
      WHERE au.id = (SELECT auth.uid()) AND u.activo = true
    ))
  );

-- ────────────────────────────────────────────────────────────────────────────
-- 6. infracciones_condominio
-- ────────────────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "infracciones_condominio_select" ON public.infracciones_condominio;
CREATE POLICY "infracciones_condominio_select"
  ON public.infracciones_condominio
  FOR SELECT
  TO authenticated
  USING (
    is_super_admin()
    OR ((company_id = get_my_company_id()) AND user_has_permission('condominios.tab.infracciones'))
    OR (unidad_id IN (
      SELECT u.id FROM unidades u
      JOIN app_users au ON au.cliente_id = u.cliente_id
      WHERE au.id = (SELECT auth.uid()) AND u.activo = true
    ))
  );

-- ────────────────────────────────────────────────────────────────────────────
-- 7. recargos_mora
-- ────────────────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "recargos_mora_select" ON public.recargos_mora;
CREATE POLICY "recargos_mora_select"
  ON public.recargos_mora
  FOR SELECT
  TO authenticated
  USING (
    is_super_admin()
    OR ((company_id = get_my_company_id()) AND user_has_permission('condominios.tab.recargos_mora'))
    OR (unidad_id IN (
      SELECT u.id FROM unidades u
      JOIN app_users au ON au.cliente_id = u.cliente_id
      WHERE au.id = (SELECT auth.uid()) AND u.activo = true
    ))
  );

-- ────────────────────────────────────────────────────────────────────────────
-- 8. cargos_adicionales_unidad
-- ────────────────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "cargos_adicionales_unidad_select" ON public.cargos_adicionales_unidad;
CREATE POLICY "cargos_adicionales_unidad_select"
  ON public.cargos_adicionales_unidad
  FOR SELECT
  TO authenticated
  USING (
    is_super_admin()
    OR ((company_id = get_my_company_id()) AND user_has_permission('condominios.tab.cargos_adicionales'))
    OR (unidad_id IN (
      SELECT u.id FROM unidades u
      JOIN app_users au ON au.cliente_id = u.cliente_id
      WHERE au.id = (SELECT auth.uid()) AND u.activo = true
    ))
  );
