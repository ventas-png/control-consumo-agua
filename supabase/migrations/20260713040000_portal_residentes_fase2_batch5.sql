-- Portal propietario vs inquilino — FASE 2 · batch 5 (P1 · condominios): casos especiales.
--
-- Cierra el grueso de la fase 2 centralizando las policies que NO encajaban en el
-- recipe de unidad_id. Añade el helper hermano `mis_proyectos_ids()` (proyectos de
-- mis unidades activas) para las tablas scopeadas por project_id. Todo behavior-
-- preserving (validado contra prod vía BEGIN…ROLLBACK):
--   • amenidades / amenidades_bloqueos: project_id IN (proyectos de mis unidades) ⇒
--     project_id IN (SELECT mis_proyectos_ids()).
--   • config_condominio: EXISTS(unidad mía activa en el proyecto del config) ⇒
--     (cliente) project_id IN (SELECT mis_proyectos_ids()). Ramas de staff intactas.
--   • mensajes_portal: unidad_id IN (mis unidades) ⇒ SELECT mis_unidades_ids();
--     rama de staff (company_id IN de app_users) intacta.
--
-- DEFERIDAS (no incluidas): solicitud_mudanza_unidad / solicitud_renta_unidad — su
-- rama EXISTS NO filtra u.activo, así que reemplazarla por el helper (que sí filtra)
-- NARROWEA el acceso (no es behavior-preserving). Se deciden aparte (probablemente en
-- fase 3, junto con la extensión del helper). Tampoco se tocan las tablas de agua
-- (registros/contadores): scopean por cliente/contador, fuera del modelo de unidad.
--
-- Con esto, todas las policies condominio-unidad/proyecto quedan centralizadas en los
-- helpers → la fase 3 habilita la duplicidad propietario/inquilino extendiéndolos en
-- DOS lugares (mis_unidades_ids + mis_proyectos_ids), no en ~44 policies.

CREATE OR REPLACE FUNCTION public.mis_proyectos_ids()
RETURNS SETOF uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $fn$ SELECT DISTINCT u.project_id FROM public.unidades u WHERE u.activo = true AND u.cliente_id = public.get_my_cliente_id() $fn$;
REVOKE ALL ON FUNCTION public.mis_proyectos_ids() FROM public, anon;
GRANT EXECUTE ON FUNCTION public.mis_proyectos_ids() TO authenticated;

DROP POLICY IF EXISTS amenidades_select ON public.amenidades;
CREATE POLICY amenidades_select ON public.amenidades FOR SELECT TO authenticated
  USING (is_super_admin() OR ((company_id = get_my_company_id()) AND user_has_permission('condominios.tab.amenidades')) OR (project_id IN (SELECT public.mis_proyectos_ids())));

DROP POLICY IF EXISTS amenidades_bloqueos_select ON public.amenidades_bloqueos;
CREATE POLICY amenidades_bloqueos_select ON public.amenidades_bloqueos FOR SELECT TO authenticated
  USING (is_super_admin() OR ((company_id = get_my_company_id()) AND user_has_permission('condominios.tab.amenidades')) OR (project_id IN (SELECT public.mis_proyectos_ids())));

DROP POLICY IF EXISTS config_cond_select ON public.config_condominio;
CREATE POLICY config_cond_select ON public.config_condominio FOR SELECT TO authenticated
  USING ((company_id = get_my_company_id()) OR (project_id = (SELECT app_users.project_id FROM app_users WHERE app_users.id = (SELECT auth.uid()))) OR ((current_user_role() = 'cliente') AND (project_id IN (SELECT public.mis_proyectos_ids()))));

DROP POLICY IF EXISTS mensajes_portal_select ON public.mensajes_portal;
CREATE POLICY mensajes_portal_select ON public.mensajes_portal FOR SELECT TO authenticated
  USING ((company_id IN (SELECT app_users.company_id FROM app_users WHERE app_users.id = (SELECT auth.uid()) AND app_users.company_id IS NOT NULL)) OR (unidad_id IN (SELECT public.mis_unidades_ids())));
