-- Portal propietario vs inquilino — FASE 2 · batch 3 (P1 · condominios).
--
-- Repunta 12 policies SELECT del residente al helper `mis_unidades_ids()`. Todas son
-- la MISMA estructura de 3 ramas verificada contra prod:
--   is_super_admin() OR (company_id = get_my_company_id() AND user_has_permission(KEY))
--   OR (unidad_id IN <unidades de mi cliente, forma join unidades⋈app_users>)
-- Pre-check contra prod: cada una tiene exactamente 2 ' OR ' (3 ramas) → el template
-- reconstruye la policy COMPLETA (sin ramas ocultas). El subquery del residente (join)
-- es igual a mis_unidades_ids(), así que es behavior-preserving; solo cambia esa rama.
-- Post-check contra prod (BEGIN…ROLLBACK): las 12 quedan con helper, 0 con app_users,
-- 0 con project_id, 12 con is_super_admin (staff intacto).
--
-- Progreso fase 2: 19/~44. Pendientes: resto condominio-unidad, project_id-scoped
-- (necesitan helper de proyectos), y agua (registros/contadores, diseño aparte).

DROP POLICY IF EXISTS avisos_cobro_select ON public.avisos_cobro;
CREATE POLICY avisos_cobro_select ON public.avisos_cobro FOR SELECT TO authenticated
  USING (is_super_admin() OR ((company_id = get_my_company_id()) AND user_has_permission('condominios.tab.avisos_cobro')) OR (unidad_id IN (SELECT public.mis_unidades_ids())));

DROP POLICY IF EXISTS bodegas_condominio_select ON public.bodegas_condominio;
CREATE POLICY bodegas_condominio_select ON public.bodegas_condominio FOR SELECT TO authenticated
  USING (is_super_admin() OR ((company_id = get_my_company_id()) AND user_has_permission('condominios.tab.bodegas')) OR (unidad_id IN (SELECT public.mis_unidades_ids())));

DROP POLICY IF EXISTS cargos_adicionales_unidad_select ON public.cargos_adicionales_unidad;
CREATE POLICY cargos_adicionales_unidad_select ON public.cargos_adicionales_unidad FOR SELECT TO authenticated
  USING (is_super_admin() OR ((company_id = get_my_company_id()) AND user_has_permission('condominios.tab.cargos_adicionales')) OR (unidad_id IN (SELECT public.mis_unidades_ids())));

DROP POLICY IF EXISTS cobranza_judicial_select ON public.cobranza_judicial;
CREATE POLICY cobranza_judicial_select ON public.cobranza_judicial FOR SELECT TO authenticated
  USING (is_super_admin() OR ((company_id = get_my_company_id()) AND user_has_permission('condominios.tab.cobranza_judicial')) OR (unidad_id IN (SELECT public.mis_unidades_ids())));

DROP POLICY IF EXISTS comunicados_condominio_select ON public.comunicados_condominio;
CREATE POLICY comunicados_condominio_select ON public.comunicados_condominio FOR SELECT TO authenticated
  USING (is_super_admin() OR ((company_id = get_my_company_id()) AND user_has_permission('condominios.tab.comunicados')) OR (unidad_id IN (SELECT public.mis_unidades_ids())));

DROP POLICY IF EXISTS correspondencia_condominio_select ON public.correspondencia_condominio;
CREATE POLICY correspondencia_condominio_select ON public.correspondencia_condominio FOR SELECT TO authenticated
  USING (is_super_admin() OR ((company_id = get_my_company_id()) AND user_has_permission('condominios.tab.correspondencia')) OR (unidad_id IN (SELECT public.mis_unidades_ids())));

DROP POLICY IF EXISTS gestion_cobranza_select ON public.gestion_cobranza;
CREATE POLICY gestion_cobranza_select ON public.gestion_cobranza FOR SELECT TO authenticated
  USING (is_super_admin() OR ((company_id = get_my_company_id()) AND user_has_permission('condominios.tab.cobranza')) OR (unidad_id IN (SELECT public.mis_unidades_ids())));

DROP POLICY IF EXISTS infracciones_condominio_select ON public.infracciones_condominio;
CREATE POLICY infracciones_condominio_select ON public.infracciones_condominio FOR SELECT TO authenticated
  USING (is_super_admin() OR ((company_id = get_my_company_id()) AND user_has_permission('condominios.tab.infracciones')) OR (unidad_id IN (SELECT public.mis_unidades_ids())));

DROP POLICY IF EXISTS recibos_digitales_select ON public.recibos_digitales;
CREATE POLICY recibos_digitales_select ON public.recibos_digitales FOR SELECT TO authenticated
  USING (is_super_admin() OR ((company_id = get_my_company_id()) AND user_has_permission('condominios.tab.recibos_digitales')) OR (unidad_id IN (SELECT public.mis_unidades_ids())));

DROP POLICY IF EXISTS reclamos_condominio_select ON public.reclamos_condominio;
CREATE POLICY reclamos_condominio_select ON public.reclamos_condominio FOR SELECT TO authenticated
  USING (is_super_admin() OR ((company_id = get_my_company_id()) AND user_has_permission('condominios.tab.reclamos')) OR (unidad_id IN (SELECT public.mis_unidades_ids())));

DROP POLICY IF EXISTS sanciones_condominio_select ON public.sanciones_condominio;
CREATE POLICY sanciones_condominio_select ON public.sanciones_condominio FOR SELECT TO authenticated
  USING (is_super_admin() OR ((company_id = get_my_company_id()) AND user_has_permission('condominios.tab.sanciones')) OR (unidad_id IN (SELECT public.mis_unidades_ids())));

DROP POLICY IF EXISTS sugerencias_condominio_select ON public.sugerencias_condominio;
CREATE POLICY sugerencias_condominio_select ON public.sugerencias_condominio FOR SELECT TO authenticated
  USING (is_super_admin() OR ((company_id = get_my_company_id()) AND user_has_permission('condominios.tab.buzon_sugerencias')) OR (unidad_id IN (SELECT public.mis_unidades_ids())));
