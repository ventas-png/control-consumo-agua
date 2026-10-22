-- ════════════════════════════════════════════════════════════════════════════
-- Seguridad, Panel y especiales: escribir exige la ACCIÓN del tab, también en la base
--
-- POR QUÉ
-- La pantalla decide cada escritura de estos tabs con su acción (canCreate /
-- canEdit / canDelete). Las policies de INSERT y UPDATE sólo pedían ver el tab
-- —quien sólo consulta podía crear y editar por la API— y las de DELETE sólo
-- dejaban a company_owner/admin, aunque la pantalla le ofreciera «Eliminar» a
-- quien tuviera la acción: la RLS borraba cero filas sin error.
--
-- Tabs: Alertas, Informe mensual, Bitácora de guardia, Emergencias, Objetos
-- perdidos, Rutas de ronda (puntos de control y de verificación), Reclamos,
-- Seguridad (rondas y su checklist), Visitantes, Visitas frecuentes, Locales,
-- Residuos y Concierge.
--
-- QUÉ HACE (generado por scripts/rls-acciones/generar.mjs desde
-- supabase/rls-acciones/seguridad.json; no editar a mano)
-- En cada policy de escritura de las tablas de abajo se sustituyen SÓLO los
-- átomos de permiso —user_has_permission('condominios.tab.<tab>') y
-- current_user_role() = ANY (company_owner, admin)— por la acción del tab que
-- la pantalla exige para ese comando (condominios_puede_actuar, réplica de
-- canActInCondominiosTab). Empresa, EXISTS al padre, ramas del residente y
-- cualquier otra condición quedan idénticas. company_owner/admin siguen
-- pasando (exentos en user_has_permission); super_admin, como antes.
--
-- IMPACTO: ningún dato cambia. Quien sólo VE un tab deja de crear, editar o
-- borrar por la API; quien tiene la acción (o el par legado) hace en la base lo
-- que ya le ofrecía la pantalla. Las RPC SECURITY DEFINER y service_role no
-- pasan por RLS.
--
-- REVERSIÓN: node scripts/rls-acciones/generar.mjs <sección> --revertir
-- emite las policies tal como estaban.
--
-- IDEMPOTENTE: DROP POLICY IF EXISTS antes de cada CREATE.
-- ════════════════════════════════════════════════════════════════════════════

-- ── alertas_condominio ──────────────────────────────────────────────────────
--   INSERT alertas.create
--   UPDATE alertas.edit
--   DELETE alertas.delete
DROP POLICY IF EXISTS alertas_condominio_delete ON public.alertas_condominio;
CREATE POLICY alertas_condominio_delete ON public.alertas_condominio
  AS PERMISSIVE FOR DELETE TO authenticated
  USING ((is_super_admin() OR (( SELECT (public.condominios_puede_actuar('alertas', 'delete')) ) AND (company_id = get_my_company_id()))));
DROP POLICY IF EXISTS alertas_condominio_insert ON public.alertas_condominio;
CREATE POLICY alertas_condominio_insert ON public.alertas_condominio
  AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK ((is_super_admin() OR ((company_id = get_my_company_id()) AND ( SELECT (public.condominios_puede_actuar('alertas', 'create')) ))));
DROP POLICY IF EXISTS alertas_condominio_update ON public.alertas_condominio;
CREATE POLICY alertas_condominio_update ON public.alertas_condominio
  AS PERMISSIVE FOR UPDATE TO authenticated
  USING ((is_super_admin() OR ((company_id = get_my_company_id()) AND ( SELECT (public.condominios_puede_actuar('alertas', 'edit')) ))))
  WITH CHECK ((is_super_admin() OR ((company_id = get_my_company_id()) AND ( SELECT (public.condominios_puede_actuar('alertas', 'edit')) ))));

-- ── bitacora_guardia ────────────────────────────────────────────────────────
--   INSERT bitacora_guardia.create
--   UPDATE bitacora_guardia.edit
--   DELETE bitacora_guardia.delete
DROP POLICY IF EXISTS bitacora_guardia_delete ON public.bitacora_guardia;
CREATE POLICY bitacora_guardia_delete ON public.bitacora_guardia
  AS PERMISSIVE FOR DELETE TO authenticated
  USING ((is_super_admin() OR (( SELECT (public.condominios_puede_actuar('bitacora_guardia', 'delete')) ) AND (company_id = get_my_company_id()))));
DROP POLICY IF EXISTS bitacora_guardia_insert ON public.bitacora_guardia;
CREATE POLICY bitacora_guardia_insert ON public.bitacora_guardia
  AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK ((is_super_admin() OR ((company_id = get_my_company_id()) AND ( SELECT (public.condominios_puede_actuar('bitacora_guardia', 'create')) ))));
DROP POLICY IF EXISTS bitacora_guardia_update ON public.bitacora_guardia;
CREATE POLICY bitacora_guardia_update ON public.bitacora_guardia
  AS PERMISSIVE FOR UPDATE TO authenticated
  USING ((is_super_admin() OR ((company_id = get_my_company_id()) AND ( SELECT (public.condominios_puede_actuar('bitacora_guardia', 'edit')) ))))
  WITH CHECK ((is_super_admin() OR ((company_id = get_my_company_id()) AND ( SELECT (public.condominios_puede_actuar('bitacora_guardia', 'edit')) ))));

-- ── contactos_emergencia ────────────────────────────────────────────────────
--   INSERT emergencias.create
--   UPDATE emergencias.edit
--   DELETE emergencias.delete
DROP POLICY IF EXISTS contactos_emergencia_delete ON public.contactos_emergencia;
CREATE POLICY contactos_emergencia_delete ON public.contactos_emergencia
  AS PERMISSIVE FOR DELETE TO authenticated
  USING ((is_super_admin() OR (( SELECT (public.condominios_puede_actuar('emergencias', 'delete')) ) AND (company_id = get_my_company_id()))));
DROP POLICY IF EXISTS contactos_emergencia_insert ON public.contactos_emergencia;
CREATE POLICY contactos_emergencia_insert ON public.contactos_emergencia
  AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK ((is_super_admin() OR ((company_id = get_my_company_id()) AND ( SELECT (public.condominios_puede_actuar('emergencias', 'create')) ))));
DROP POLICY IF EXISTS contactos_emergencia_update ON public.contactos_emergencia;
CREATE POLICY contactos_emergencia_update ON public.contactos_emergencia
  AS PERMISSIVE FOR UPDATE TO authenticated
  USING ((is_super_admin() OR ((company_id = get_my_company_id()) AND ( SELECT (public.condominios_puede_actuar('emergencias', 'edit')) ))))
  WITH CHECK ((is_super_admin() OR ((company_id = get_my_company_id()) AND ( SELECT (public.condominios_puede_actuar('emergencias', 'edit')) ))));

-- ── informes_mensuales ──────────────────────────────────────────────────────
--   INSERT informe_mensual.create
--   UPDATE informe_mensual.edit · informe_mensual.create
--   DELETE informe_mensual.delete
--   InformeMensualTab sólo recibe canCreate: con él se genera (upsert) y se publica (update).
DROP POLICY IF EXISTS informes_mensuales_delete ON public.informes_mensuales;
CREATE POLICY informes_mensuales_delete ON public.informes_mensuales
  AS PERMISSIVE FOR DELETE TO authenticated
  USING ((is_super_admin() OR (( SELECT (public.condominios_puede_actuar('informe_mensual', 'delete')) ) AND (company_id = get_my_company_id()))));
DROP POLICY IF EXISTS informes_mensuales_insert ON public.informes_mensuales;
CREATE POLICY informes_mensuales_insert ON public.informes_mensuales
  AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK ((is_super_admin() OR ((company_id = get_my_company_id()) AND ( SELECT (public.condominios_puede_actuar('informe_mensual', 'create')) ))));
DROP POLICY IF EXISTS informes_mensuales_update ON public.informes_mensuales;
CREATE POLICY informes_mensuales_update ON public.informes_mensuales
  AS PERMISSIVE FOR UPDATE TO authenticated
  USING ((is_super_admin() OR ((company_id = get_my_company_id()) AND ( SELECT (public.condominios_puede_actuar('informe_mensual', 'edit') OR public.condominios_puede_actuar('informe_mensual', 'create')) ))))
  WITH CHECK ((is_super_admin() OR ((company_id = get_my_company_id()) AND ( SELECT (public.condominios_puede_actuar('informe_mensual', 'edit') OR public.condominios_puede_actuar('informe_mensual', 'create')) ))));

-- ── locales_comerciales ─────────────────────────────────────────────────────
--   INSERT locales.create
--   UPDATE locales.edit
--   DELETE locales.delete
DROP POLICY IF EXISTS locales_comerciales_delete ON public.locales_comerciales;
CREATE POLICY locales_comerciales_delete ON public.locales_comerciales
  AS PERMISSIVE FOR DELETE TO authenticated
  USING ((is_super_admin() OR (( SELECT (public.condominios_puede_actuar('locales', 'delete')) ) AND (company_id = get_my_company_id()))));
DROP POLICY IF EXISTS locales_comerciales_insert ON public.locales_comerciales;
CREATE POLICY locales_comerciales_insert ON public.locales_comerciales
  AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK ((is_super_admin() OR ((company_id = get_my_company_id()) AND ( SELECT (public.condominios_puede_actuar('locales', 'create')) ))));
DROP POLICY IF EXISTS locales_comerciales_update ON public.locales_comerciales;
CREATE POLICY locales_comerciales_update ON public.locales_comerciales
  AS PERMISSIVE FOR UPDATE TO authenticated
  USING ((is_super_admin() OR ((company_id = get_my_company_id()) AND ( SELECT (public.condominios_puede_actuar('locales', 'edit')) ))))
  WITH CHECK ((is_super_admin() OR ((company_id = get_my_company_id()) AND ( SELECT (public.condominios_puede_actuar('locales', 'edit')) ))));

-- ── objetos_perdidos ────────────────────────────────────────────────────────
--   INSERT objetos.create
--   UPDATE objetos.edit
--   DELETE objetos.delete
DROP POLICY IF EXISTS objetos_perdidos_delete ON public.objetos_perdidos;
CREATE POLICY objetos_perdidos_delete ON public.objetos_perdidos
  AS PERMISSIVE FOR DELETE TO authenticated
  USING ((is_super_admin() OR (( SELECT (public.condominios_puede_actuar('objetos', 'delete')) ) AND (company_id = get_my_company_id()))));
DROP POLICY IF EXISTS objetos_perdidos_insert ON public.objetos_perdidos;
CREATE POLICY objetos_perdidos_insert ON public.objetos_perdidos
  AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK ((is_super_admin() OR ((company_id = get_my_company_id()) AND ( SELECT (public.condominios_puede_actuar('objetos', 'create')) ))));
DROP POLICY IF EXISTS objetos_perdidos_update ON public.objetos_perdidos;
CREATE POLICY objetos_perdidos_update ON public.objetos_perdidos
  AS PERMISSIVE FOR UPDATE TO authenticated
  USING ((is_super_admin() OR ((company_id = get_my_company_id()) AND ( SELECT (public.condominios_puede_actuar('objetos', 'edit')) ))))
  WITH CHECK ((is_super_admin() OR ((company_id = get_my_company_id()) AND ( SELECT (public.condominios_puede_actuar('objetos', 'edit')) ))));

-- ── puntos_control_ruta ─────────────────────────────────────────────────────
--   INSERT rutas_ronda.create
--   UPDATE rutas_ronda.edit
--   DELETE rutas_ronda.delete
DROP POLICY IF EXISTS puntos_control_ruta_delete ON public.puntos_control_ruta;
CREATE POLICY puntos_control_ruta_delete ON public.puntos_control_ruta
  AS PERMISSIVE FOR DELETE TO authenticated
  USING ((is_super_admin() OR (EXISTS ( SELECT 1
   FROM rutas_ronda r
  WHERE ((r.id = puntos_control_ruta.ruta_id) AND (r.company_id = get_my_company_id()) AND ( SELECT (public.condominios_puede_actuar('rutas_ronda', 'delete')) ))))));
DROP POLICY IF EXISTS puntos_control_ruta_insert ON public.puntos_control_ruta;
CREATE POLICY puntos_control_ruta_insert ON public.puntos_control_ruta
  AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK ((is_super_admin() OR (EXISTS ( SELECT 1
   FROM rutas_ronda r
  WHERE ((r.id = puntos_control_ruta.ruta_id) AND (r.company_id = get_my_company_id()) AND ( SELECT (public.condominios_puede_actuar('rutas_ronda', 'create')) ))))));
DROP POLICY IF EXISTS puntos_control_ruta_update ON public.puntos_control_ruta;
CREATE POLICY puntos_control_ruta_update ON public.puntos_control_ruta
  AS PERMISSIVE FOR UPDATE TO authenticated
  USING ((is_super_admin() OR (EXISTS ( SELECT 1
   FROM rutas_ronda r
  WHERE ((r.id = puntos_control_ruta.ruta_id) AND (r.company_id = get_my_company_id()) AND ( SELECT (public.condominios_puede_actuar('rutas_ronda', 'edit')) ))))))
  WITH CHECK ((is_super_admin() OR (EXISTS ( SELECT 1
   FROM rutas_ronda r
  WHERE ((r.id = puntos_control_ruta.ruta_id) AND (r.company_id = get_my_company_id()) AND ( SELECT (public.condominios_puede_actuar('rutas_ronda', 'edit')) ))))));

-- ── puntos_verificacion ─────────────────────────────────────────────────────
--   INSERT rutas_ronda.create
--   UPDATE rutas_ronda.edit
--   DELETE rutas_ronda.delete
DROP POLICY IF EXISTS puntos_verificacion_delete ON public.puntos_verificacion;
CREATE POLICY puntos_verificacion_delete ON public.puntos_verificacion
  AS PERMISSIVE FOR DELETE TO authenticated
  USING ((( SELECT is_super_admin() AS is_super_admin) OR (( SELECT (public.condominios_puede_actuar('rutas_ronda', 'delete')) ) AND (company_id = ( SELECT get_my_company_id() AS get_my_company_id)))));
DROP POLICY IF EXISTS puntos_verificacion_insert ON public.puntos_verificacion;
CREATE POLICY puntos_verificacion_insert ON public.puntos_verificacion
  AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK ((( SELECT is_super_admin() AS is_super_admin) OR ((company_id = ( SELECT get_my_company_id() AS get_my_company_id)) AND ( SELECT (public.condominios_puede_actuar('rutas_ronda', 'create')) ))));
DROP POLICY IF EXISTS puntos_verificacion_update ON public.puntos_verificacion;
CREATE POLICY puntos_verificacion_update ON public.puntos_verificacion
  AS PERMISSIVE FOR UPDATE TO authenticated
  USING ((( SELECT is_super_admin() AS is_super_admin) OR ((company_id = ( SELECT get_my_company_id() AS get_my_company_id)) AND ( SELECT (public.condominios_puede_actuar('rutas_ronda', 'edit')) ))))
  WITH CHECK ((( SELECT is_super_admin() AS is_super_admin) OR ((company_id = ( SELECT get_my_company_id() AS get_my_company_id)) AND ( SELECT (public.condominios_puede_actuar('rutas_ronda', 'edit')) ))));

-- ── reclamos_condominio ─────────────────────────────────────────────────────
--   INSERT reclamos.create
--   UPDATE reclamos.edit
--   DELETE reclamos.delete
DROP POLICY IF EXISTS reclamos_condominio_delete ON public.reclamos_condominio;
CREATE POLICY reclamos_condominio_delete ON public.reclamos_condominio
  AS PERMISSIVE FOR DELETE TO authenticated
  USING ((is_super_admin() OR (( SELECT (public.condominios_puede_actuar('reclamos', 'delete')) ) AND (company_id = get_my_company_id()))));
DROP POLICY IF EXISTS reclamos_condominio_insert ON public.reclamos_condominio;
CREATE POLICY reclamos_condominio_insert ON public.reclamos_condominio
  AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK ((is_super_admin() OR ((company_id = get_my_company_id()) AND ( SELECT (public.condominios_puede_actuar('reclamos', 'create')) ))));
DROP POLICY IF EXISTS reclamos_condominio_update ON public.reclamos_condominio;
CREATE POLICY reclamos_condominio_update ON public.reclamos_condominio
  AS PERMISSIVE FOR UPDATE TO authenticated
  USING ((is_super_admin() OR ((company_id = get_my_company_id()) AND ( SELECT (public.condominios_puede_actuar('reclamos', 'edit')) ))))
  WITH CHECK ((is_super_admin() OR ((company_id = get_my_company_id()) AND ( SELECT (public.condominios_puede_actuar('reclamos', 'edit')) ))));

-- ── registros_residuos ──────────────────────────────────────────────────────
--   INSERT residuos.create
--   UPDATE residuos.edit
--   DELETE residuos.delete
DROP POLICY IF EXISTS registros_residuos_delete ON public.registros_residuos;
CREATE POLICY registros_residuos_delete ON public.registros_residuos
  AS PERMISSIVE FOR DELETE TO authenticated
  USING ((is_super_admin() OR (( SELECT (public.condominios_puede_actuar('residuos', 'delete')) ) AND (company_id = get_my_company_id()))));
DROP POLICY IF EXISTS registros_residuos_insert ON public.registros_residuos;
CREATE POLICY registros_residuos_insert ON public.registros_residuos
  AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK ((is_super_admin() OR ((company_id = get_my_company_id()) AND ( SELECT (public.condominios_puede_actuar('residuos', 'create')) ))));
DROP POLICY IF EXISTS registros_residuos_update ON public.registros_residuos;
CREATE POLICY registros_residuos_update ON public.registros_residuos
  AS PERMISSIVE FOR UPDATE TO authenticated
  USING ((is_super_admin() OR ((company_id = get_my_company_id()) AND ( SELECT (public.condominios_puede_actuar('residuos', 'edit')) ))))
  WITH CHECK ((is_super_admin() OR ((company_id = get_my_company_id()) AND ( SELECT (public.condominios_puede_actuar('residuos', 'edit')) ))));

-- ── rondas_seguridad ────────────────────────────────────────────────────────
--   INSERT rutas_ronda.create · seguridad.create
--   UPDATE rutas_ronda.edit · seguridad.edit
--   DELETE rutas_ronda.delete
--   La ronda se inicia en Seguridad con canCreate('seguridad') y se cierra con canEdit('seguridad').
DROP POLICY IF EXISTS rondas_seguridad_delete ON public.rondas_seguridad;
CREATE POLICY rondas_seguridad_delete ON public.rondas_seguridad
  AS PERMISSIVE FOR DELETE TO authenticated
  USING ((is_super_admin() OR (( SELECT (public.condominios_puede_actuar('rutas_ronda', 'delete')) ) AND (company_id = get_my_company_id()))));
DROP POLICY IF EXISTS rondas_seguridad_insert ON public.rondas_seguridad;
CREATE POLICY rondas_seguridad_insert ON public.rondas_seguridad
  AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK ((is_super_admin() OR ((company_id = get_my_company_id()) AND ( SELECT (public.condominios_puede_actuar('rutas_ronda', 'create') OR public.condominios_puede_actuar('seguridad', 'create')) ))));
DROP POLICY IF EXISTS rondas_seguridad_update ON public.rondas_seguridad;
CREATE POLICY rondas_seguridad_update ON public.rondas_seguridad
  AS PERMISSIVE FOR UPDATE TO authenticated
  USING ((is_super_admin() OR ((company_id = get_my_company_id()) AND ( SELECT (public.condominios_puede_actuar('rutas_ronda', 'edit') OR public.condominios_puede_actuar('seguridad', 'edit')) ))))
  WITH CHECK ((is_super_admin() OR ((company_id = get_my_company_id()) AND ( SELECT (public.condominios_puede_actuar('rutas_ronda', 'edit') OR public.condominios_puede_actuar('seguridad', 'edit')) ))));

-- ── solicitudes_concierge ───────────────────────────────────────────────────
--   INSERT concierge.create
--   UPDATE concierge.edit
--   DELETE concierge.delete
DROP POLICY IF EXISTS solicitudes_concierge_delete ON public.solicitudes_concierge;
CREATE POLICY solicitudes_concierge_delete ON public.solicitudes_concierge
  AS PERMISSIVE FOR DELETE TO authenticated
  USING ((is_super_admin() OR (( SELECT (public.condominios_puede_actuar('concierge', 'delete')) ) AND (company_id = get_my_company_id()))));
DROP POLICY IF EXISTS solicitudes_concierge_insert ON public.solicitudes_concierge;
CREATE POLICY solicitudes_concierge_insert ON public.solicitudes_concierge
  AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK ((is_super_admin() OR ((company_id = get_my_company_id()) AND ( SELECT (public.condominios_puede_actuar('concierge', 'create')) ))));
DROP POLICY IF EXISTS solicitudes_concierge_update ON public.solicitudes_concierge;
CREATE POLICY solicitudes_concierge_update ON public.solicitudes_concierge
  AS PERMISSIVE FOR UPDATE TO authenticated
  USING ((is_super_admin() OR ((company_id = get_my_company_id()) AND ( SELECT (public.condominios_puede_actuar('concierge', 'edit')) ))))
  WITH CHECK ((is_super_admin() OR ((company_id = get_my_company_id()) AND ( SELECT (public.condominios_puede_actuar('concierge', 'edit')) ))));

-- ── visitantes ──────────────────────────────────────────────────────────────
--   INSERT visitantes.create · seguridad.create · control_accesos_qr.create · portal.edit
--   UPDATE visitantes.edit · visitantes.create · control_accesos_qr.create
--   DELETE visitantes.delete
--   Registran visitantes: Visitantes y Control de accesos QR (canCreate), el acceso de Seguridad
--   (canCreate('seguridad')) y el portal en vista de administración (canEdit('portal')). Entrada y
--   salida (UPDATE) se marcan en Visitantes y en Control de accesos QR, que sólo reciben canCreate.
--   La rama del residente (sus unidades) no cambia.
DROP POLICY IF EXISTS visitantes_delete ON public.visitantes;
CREATE POLICY visitantes_delete ON public.visitantes
  AS PERMISSIVE FOR DELETE TO authenticated
  USING ((is_super_admin() OR (( SELECT (public.condominios_puede_actuar('visitantes', 'delete')) ) AND (company_id = get_my_company_id()))));
DROP POLICY IF EXISTS visitantes_insert ON public.visitantes;
CREATE POLICY visitantes_insert ON public.visitantes
  AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK ((is_super_admin() OR ((company_id = get_my_company_id()) AND ( SELECT (public.condominios_puede_actuar('visitantes', 'create') OR public.condominios_puede_actuar('seguridad', 'create') OR public.condominios_puede_actuar('control_accesos_qr', 'create') OR public.condominios_puede_actuar('portal', 'edit')) )) OR (unidad_id IN ( SELECT mis_unidades_ids() AS mis_unidades_ids))));
DROP POLICY IF EXISTS visitantes_update ON public.visitantes;
CREATE POLICY visitantes_update ON public.visitantes
  AS PERMISSIVE FOR UPDATE TO authenticated
  USING ((is_super_admin() OR ((company_id = get_my_company_id()) AND ( SELECT (public.condominios_puede_actuar('visitantes', 'edit') OR public.condominios_puede_actuar('visitantes', 'create') OR public.condominios_puede_actuar('control_accesos_qr', 'create')) ))))
  WITH CHECK ((is_super_admin() OR ((company_id = get_my_company_id()) AND ( SELECT (public.condominios_puede_actuar('visitantes', 'edit') OR public.condominios_puede_actuar('visitantes', 'create') OR public.condominios_puede_actuar('control_accesos_qr', 'create')) ))));

-- ── visitas_control ─────────────────────────────────────────────────────────
--   INSERT rutas_ronda.create · seguridad.create
--   UPDATE rutas_ronda.edit · seguridad.edit
--   DELETE rutas_ronda.delete
--   El checklist de la ronda nace al iniciarla (canCreate('seguridad')) y cada punto se marca con canEdit('seguridad').
DROP POLICY IF EXISTS visitas_control_delete ON public.visitas_control;
CREATE POLICY visitas_control_delete ON public.visitas_control
  AS PERMISSIVE FOR DELETE TO authenticated
  USING ((is_super_admin() OR (EXISTS ( SELECT 1
   FROM rondas_seguridad r
  WHERE ((r.id = visitas_control.ronda_id) AND (r.company_id = get_my_company_id()) AND ( SELECT (public.condominios_puede_actuar('rutas_ronda', 'delete')) ))))));
DROP POLICY IF EXISTS visitas_control_insert ON public.visitas_control;
CREATE POLICY visitas_control_insert ON public.visitas_control
  AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK ((is_super_admin() OR (EXISTS ( SELECT 1
   FROM rondas_seguridad r
  WHERE ((r.id = visitas_control.ronda_id) AND (r.company_id = get_my_company_id()) AND ( SELECT (public.condominios_puede_actuar('rutas_ronda', 'create') OR public.condominios_puede_actuar('seguridad', 'create')) ))))));
DROP POLICY IF EXISTS visitas_control_update ON public.visitas_control;
CREATE POLICY visitas_control_update ON public.visitas_control
  AS PERMISSIVE FOR UPDATE TO authenticated
  USING ((is_super_admin() OR (EXISTS ( SELECT 1
   FROM rondas_seguridad r
  WHERE ((r.id = visitas_control.ronda_id) AND (r.company_id = get_my_company_id()) AND ( SELECT (public.condominios_puede_actuar('rutas_ronda', 'edit') OR public.condominios_puede_actuar('seguridad', 'edit')) ))))))
  WITH CHECK ((is_super_admin() OR (EXISTS ( SELECT 1
   FROM rondas_seguridad r
  WHERE ((r.id = visitas_control.ronda_id) AND (r.company_id = get_my_company_id()) AND ( SELECT (public.condominios_puede_actuar('rutas_ronda', 'edit') OR public.condominios_puede_actuar('seguridad', 'edit')) ))))));

-- ── visitas_frecuentes ──────────────────────────────────────────────────────
--   INSERT vis_frecuentes.create
--   UPDATE vis_frecuentes.edit
--   DELETE vis_frecuentes.delete
DROP POLICY IF EXISTS visitas_frecuentes_delete ON public.visitas_frecuentes;
CREATE POLICY visitas_frecuentes_delete ON public.visitas_frecuentes
  AS PERMISSIVE FOR DELETE TO authenticated
  USING ((is_super_admin() OR (( SELECT (public.condominios_puede_actuar('vis_frecuentes', 'delete')) ) AND (company_id = get_my_company_id()))));
DROP POLICY IF EXISTS visitas_frecuentes_insert ON public.visitas_frecuentes;
CREATE POLICY visitas_frecuentes_insert ON public.visitas_frecuentes
  AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK ((is_super_admin() OR ((company_id = get_my_company_id()) AND ( SELECT (public.condominios_puede_actuar('vis_frecuentes', 'create')) ))));
DROP POLICY IF EXISTS visitas_frecuentes_update ON public.visitas_frecuentes;
CREATE POLICY visitas_frecuentes_update ON public.visitas_frecuentes
  AS PERMISSIVE FOR UPDATE TO authenticated
  USING ((is_super_admin() OR ((company_id = get_my_company_id()) AND ( SELECT (public.condominios_puede_actuar('vis_frecuentes', 'edit')) ))))
  WITH CHECK ((is_super_admin() OR ((company_id = get_my_company_id()) AND ( SELECT (public.condominios_puede_actuar('vis_frecuentes', 'edit')) )))
);

-- ── Guarda de postcondición ────────────────────────────────────────────────────
-- Ninguna policy de escritura de estas tablas conserva la visibilidad del tab
-- ni el rol como permiso, y todas las reescritas exigen una acción. Una
-- policy permisiva de más se uniría con OR y volvería opcional la acción: el
-- número de policies de escritura por tabla tiene que ser el de antes.
DO $$
DECLARE
  v_t text; v_n int; v_total int; v_esperado int; v_esperado_total int; v_mal text;
BEGIN
  FOR v_t, v_esperado, v_esperado_total IN SELECT * FROM (VALUES
    ('alertas_condominio', 3, 3),
    ('bitacora_guardia', 3, 3),
    ('contactos_emergencia', 3, 3),
    ('informes_mensuales', 3, 3),
    ('locales_comerciales', 3, 3),
    ('objetos_perdidos', 3, 3),
    ('puntos_control_ruta', 3, 3),
    ('puntos_verificacion', 3, 3),
    ('reclamos_condominio', 3, 3),
    ('registros_residuos', 3, 3),
    ('rondas_seguridad', 3, 3),
    ('solicitudes_concierge', 3, 3),
    ('visitantes', 3, 3),
    ('visitas_control', 3, 3),
    ('visitas_frecuentes', 3, 3)
  ) AS e(tabla, n, total) LOOP
    SELECT count(*) FILTER (WHERE coalesce(qual, '') || coalesce(with_check, '') ~ 'condominios_puede_actuar'),
           count(*),
           string_agg(policyname, ', ') FILTER (WHERE coalesce(qual, '') || coalesce(with_check, '') ~ $r$user_has_permission\(\s*('condominios\.tab\.|CASE)|ARRAY\['company_owner'::text, 'admin'::text\]$r$)
      INTO v_n, v_total, v_mal
    FROM pg_policies WHERE schemaname = 'public' AND tablename = v_t AND cmd <> 'SELECT';
    IF v_mal IS NOT NULL THEN
      RAISE EXCEPTION 'acciones por permiso: % conserva visibilidad o rol como permiso de escritura en: %', v_t, v_mal;
    END IF;
    IF v_n <> v_esperado THEN
      RAISE EXCEPTION 'acciones por permiso: % tiene % policies de escritura por acción (se esperaban %)', v_t, v_n, v_esperado;
    END IF;
    IF v_total <> v_esperado_total THEN
      RAISE EXCEPTION 'acciones por permiso: % tiene % policies de escritura (se esperaban %): una de más se uniría con OR', v_t, v_total, v_esperado_total;
    END IF;
  END LOOP;
END $$;
