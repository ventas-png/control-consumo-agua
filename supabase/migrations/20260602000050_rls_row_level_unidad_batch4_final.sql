-- ============================================================================
-- RLS row-level por unidad (cond:C2) — Batch 4 FINAL: 9 tablas
-- ============================================================================
-- Cierra cond:C2. Mismo pattern para 9 tablas adicionales (privacidad/legal/
-- operacional). Tras este batch, todas las tablas con unidad_id que residentes
-- legitimamente consultan tienen filtro de unidad propia.
--
-- **Tablas batch 4**:
-- 1. entrega_unidades            — record de entrega (residente ve la suya)
-- 2. gestion_cobranza            — financiero (residente ve su deuda)
-- 3. historial_residentes        — privacidad (su historial)
-- 4. onboarding_residentes       — privacidad (su onboarding)
-- 5. registro_asistentes_evento  — privacidad (eventos a los que asistio)
-- 6. respuestas_encuesta         — privacidad (sus respuestas)
-- 7. servicios_housekeeping      — operacional (servicios contratados)
-- 8. visitas_frecuentes          — privacidad (sus visitas frecuentes)
-- 9. votos                       — privacidad (sus votos)
--
-- **Tablas explicitamente NO gated por unidad**:
-- - conciliacion_cobros_log → admin-only por diseno (auditoria interna)
-- - llaves_condominio      → admin asset tracking
-- - junta_directiva        → typically visible a todos los residentes
-- - votos_asamblea         → ya tiene policy via JOIN a asambleas
--
-- Acumulado total cond:C2: 37 tablas con RLS row-level por unidad.
-- Bloqueante absoluto del PR #166 §5 CERRADO.
-- ============================================================================

DROP POLICY IF EXISTS "entrega_unidades_select" ON public.entrega_unidades;
CREATE POLICY "entrega_unidades_select" ON public.entrega_unidades FOR SELECT TO authenticated
  USING (is_super_admin() OR ((company_id = get_my_company_id()) AND user_has_permission('condominios.tab.entrega_unidad'))
         OR (unidad_id IN (SELECT u.id FROM unidades u JOIN app_users au ON au.cliente_id = u.cliente_id WHERE au.id = (SELECT auth.uid()) AND u.activo = true)));

DROP POLICY IF EXISTS "gestion_cobranza_select" ON public.gestion_cobranza;
CREATE POLICY "gestion_cobranza_select" ON public.gestion_cobranza FOR SELECT TO authenticated
  USING (is_super_admin() OR ((company_id = get_my_company_id()) AND user_has_permission('condominios.tab.cobranza'))
         OR (unidad_id IN (SELECT u.id FROM unidades u JOIN app_users au ON au.cliente_id = u.cliente_id WHERE au.id = (SELECT auth.uid()) AND u.activo = true)));

DROP POLICY IF EXISTS "historial_residentes_select" ON public.historial_residentes;
CREATE POLICY "historial_residentes_select" ON public.historial_residentes FOR SELECT TO authenticated
  USING (is_super_admin() OR ((company_id = get_my_company_id()) AND user_has_permission('condominios.tab.directorio'))
         OR (unidad_id IN (SELECT u.id FROM unidades u JOIN app_users au ON au.cliente_id = u.cliente_id WHERE au.id = (SELECT auth.uid()) AND u.activo = true)));

DROP POLICY IF EXISTS "onboarding_residentes_select" ON public.onboarding_residentes;
CREATE POLICY "onboarding_residentes_select" ON public.onboarding_residentes FOR SELECT TO authenticated
  USING (is_super_admin() OR ((company_id = get_my_company_id()) AND user_has_permission('condominios.tab.onboarding'))
         OR (unidad_id IN (SELECT u.id FROM unidades u JOIN app_users au ON au.cliente_id = u.cliente_id WHERE au.id = (SELECT auth.uid()) AND u.activo = true)));

DROP POLICY IF EXISTS "registro_asistentes_evento_select" ON public.registro_asistentes_evento;
CREATE POLICY "registro_asistentes_evento_select" ON public.registro_asistentes_evento FOR SELECT TO authenticated
  USING (is_super_admin() OR ((company_id = get_my_company_id()) AND user_has_permission('condominios.tab.eventos_comunidad'))
         OR (unidad_id IN (SELECT u.id FROM unidades u JOIN app_users au ON au.cliente_id = u.cliente_id WHERE au.id = (SELECT auth.uid()) AND u.activo = true)));

DROP POLICY IF EXISTS "respuestas_encuesta_select" ON public.respuestas_encuesta;
CREATE POLICY "respuestas_encuesta_select" ON public.respuestas_encuesta FOR SELECT TO authenticated
  USING (is_super_admin() OR ((company_id = get_my_company_id()) AND user_has_permission('condominios.tab.encuestas'))
         OR (unidad_id IN (SELECT u.id FROM unidades u JOIN app_users au ON au.cliente_id = u.cliente_id WHERE au.id = (SELECT auth.uid()) AND u.activo = true)));

DROP POLICY IF EXISTS "servicios_housekeeping_select" ON public.servicios_housekeeping;
CREATE POLICY "servicios_housekeeping_select" ON public.servicios_housekeeping FOR SELECT TO authenticated
  USING (is_super_admin() OR ((company_id = get_my_company_id()) AND user_has_permission('condominios.tab.housekeeping'))
         OR (unidad_id IN (SELECT u.id FROM unidades u JOIN app_users au ON au.cliente_id = u.cliente_id WHERE au.id = (SELECT auth.uid()) AND u.activo = true)));

DROP POLICY IF EXISTS "visitas_frecuentes_select" ON public.visitas_frecuentes;
CREATE POLICY "visitas_frecuentes_select" ON public.visitas_frecuentes FOR SELECT TO authenticated
  USING (is_super_admin() OR ((company_id = get_my_company_id()) AND user_has_permission('condominios.tab.vis_frecuentes'))
         OR (unidad_id IN (SELECT u.id FROM unidades u JOIN app_users au ON au.cliente_id = u.cliente_id WHERE au.id = (SELECT auth.uid()) AND u.activo = true)));

DROP POLICY IF EXISTS "votos_select" ON public.votos;
CREATE POLICY "votos_select" ON public.votos FOR SELECT TO authenticated
  USING (is_super_admin() OR ((company_id = get_my_company_id()) AND user_has_permission('condominios.tab.votaciones'))
         OR (unidad_id IN (SELECT u.id FROM unidades u JOIN app_users au ON au.cliente_id = u.cliente_id WHERE au.id = (SELECT auth.uid()) AND u.activo = true)));
