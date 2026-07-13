-- Portal propietario vs inquilino — FASE 2 · batch 1 (P1 · condominios).
--
-- Repunta las policies SELECT del residente para que usen el helper
-- `mis_unidades_ids()` (fase 1) en vez del subquery inline. PRESERVA LA CONDUCTA:
-- el helper es, por definición, IDÉNTICO al subquery inline —
--   mis_unidades_ids() = SELECT u.id FROM unidades u WHERE u.activo AND u.cliente_id = get_my_cliente_id()
--   get_my_cliente_id() = SELECT cliente_id FROM app_users WHERE id = auth.uid()  (id es PK ⇒ LIMIT 1 no-op)
-- por lo que `unidad_id IN (SELECT mis_unidades_ids())` devuelve el MISMO set que el
-- subquery inline. Solo cambia esa rama; is_super_admin() y el gate de permiso quedan
-- intactos. Validado contra prod vía BEGIN…ROLLBACK (las 3 quedan usa_helper=true,
-- inline=false). NO habilita todavía la duplicidad (eso es la fase 3, que extenderá
-- el helper en un solo lugar y con estas policies ya centralizadas se propaga solo).
--
-- Batch 1 = las 3 tablas condominio-unidad con el patrón limpio de 3 ramas. Las
-- demás policies (agua/registros con scoping por cliente/contador, y el resto de
-- tablas condominio) siguen en batches posteriores, cada uno validado contra prod.

DROP POLICY IF EXISTS cuotas_condominio_select ON public.cuotas_condominio;
CREATE POLICY cuotas_condominio_select ON public.cuotas_condominio
  FOR SELECT TO authenticated
  USING (
    is_super_admin()
    OR ((company_id = get_my_company_id()) AND user_has_permission('condominios.tab.cuotas'))
    OR (unidad_id IN (SELECT public.mis_unidades_ids()))
  );

DROP POLICY IF EXISTS tickets_mantenimiento_select ON public.tickets_mantenimiento;
CREATE POLICY tickets_mantenimiento_select ON public.tickets_mantenimiento
  FOR SELECT TO authenticated
  USING (
    is_super_admin()
    OR ((company_id = get_my_company_id()) AND user_has_permission('condominios.tab.mantenimiento'))
    OR (unidad_id IN (SELECT public.mis_unidades_ids()))
  );

DROP POLICY IF EXISTS visitantes_select ON public.visitantes;
CREATE POLICY visitantes_select ON public.visitantes
  FOR SELECT TO authenticated
  USING (
    is_super_admin()
    OR ((company_id = get_my_company_id()) AND user_has_permission('condominios.tab.visitantes'))
    OR (unidad_id IN (SELECT public.mis_unidades_ids()))
  );
