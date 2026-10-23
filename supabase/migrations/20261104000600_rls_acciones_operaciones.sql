-- ════════════════════════════════════════════════════════════════════════════
-- Operaciones: escribir exige la ACCIÓN del tab, también en la base
--
-- POR QUÉ
-- La pantalla decide cada escritura de estos tabs con su acción (canCreate /
-- canEdit / canDelete). Las policies de INSERT y UPDATE sólo pedían ver el tab
-- —quien sólo consulta podía crear y editar por la API— y las de DELETE sólo
-- dejaban a company_owner/admin, aunque la pantalla ofreciera «Eliminar» a
-- quien tuviera la acción. La rama del residente (comentar su propio ticket)
-- no cambia.
--
-- Tabs: Áreas, Bitácora de mantenimiento, Contratos de proveedores, Control de
-- plagas, Evaluación de proveedores, Garantías, Inventario, Mantenimiento
-- preventivo (y sus ejecuciones), Mensajes de tickets, Obras, Préstamos de
-- equipo, Proyectos y Suministros (y sus movimientos).
--
-- Queda fuera tickets_mantenimiento: 20261103000400 ya exige la acción para
-- crear, editar y dar de baja; su DELETE físico sigue reservado al admin.
--
-- QUÉ HACE (generado por scripts/rls-acciones/generar.mjs desde
-- supabase/rls-acciones/operaciones.json; no editar a mano)
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

-- ── areas_condominio ────────────────────────────────────────────────────────
--   INSERT areas_config.create
--   UPDATE areas_config.edit
--   DELETE areas_config.delete
--   El catálogo de áreas se administra sólo en el tab Áreas (AreasCatalog, con canCreate / canEdit /
--   canDelete de areas_config). checklist_areas dejaba escribir sólo con verlo y desde 20260910000000
--   ya no hospeda el catálogo: su átomo pasa a pedir la acción de Áreas. condominios.areas.manage
--   no es una clave de tab sino un permiso de escritura explícito, y se conserva.
DROP POLICY IF EXISTS areas_condominio_delete ON public.areas_condominio;
CREATE POLICY areas_condominio_delete ON public.areas_condominio
  AS PERMISSIVE FOR DELETE TO authenticated
  USING ((is_super_admin() OR (( SELECT (public.condominios_puede_actuar('areas_config', 'delete')) ) AND (company_id = get_my_company_id()))));
DROP POLICY IF EXISTS areas_condominio_insert ON public.areas_condominio;
CREATE POLICY areas_condominio_insert ON public.areas_condominio
  AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK ((( SELECT is_super_admin() AS is_super_admin) OR ((company_id = ( SELECT get_my_company_id() AS get_my_company_id)) AND ( SELECT (( SELECT (public.condominios_puede_actuar('areas_config', 'create')) ) OR user_has_permission('condominios.areas.manage'::text) OR ( SELECT (public.condominios_puede_actuar('areas_config', 'create')) ))))));
DROP POLICY IF EXISTS areas_condominio_update ON public.areas_condominio;
CREATE POLICY areas_condominio_update ON public.areas_condominio
  AS PERMISSIVE FOR UPDATE TO authenticated
  USING ((( SELECT is_super_admin() AS is_super_admin) OR ((company_id = ( SELECT get_my_company_id() AS get_my_company_id)) AND ( SELECT (( SELECT (public.condominios_puede_actuar('areas_config', 'edit')) ) OR user_has_permission('condominios.areas.manage'::text) OR ( SELECT (public.condominios_puede_actuar('areas_config', 'edit')) ))))))
  WITH CHECK ((( SELECT is_super_admin() AS is_super_admin) OR ((company_id = ( SELECT get_my_company_id() AS get_my_company_id)) AND ( SELECT (( SELECT (public.condominios_puede_actuar('areas_config', 'edit')) ) OR user_has_permission('condominios.areas.manage'::text) OR ( SELECT (public.condominios_puede_actuar('areas_config', 'edit')) ))))));

-- ── bitacora_manto ──────────────────────────────────────────────────────────
--   INSERT bitacora_manto.create
--   UPDATE bitacora_manto.edit
--   DELETE bitacora_manto.delete
DROP POLICY IF EXISTS bitacora_manto_delete ON public.bitacora_manto;
CREATE POLICY bitacora_manto_delete ON public.bitacora_manto
  AS PERMISSIVE FOR DELETE TO authenticated
  USING ((is_super_admin() OR (( SELECT (public.condominios_puede_actuar('bitacora_manto', 'delete')) ) AND (company_id = get_my_company_id()))));
DROP POLICY IF EXISTS bitacora_manto_insert ON public.bitacora_manto;
CREATE POLICY bitacora_manto_insert ON public.bitacora_manto
  AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK ((is_super_admin() OR ((company_id = get_my_company_id()) AND ( SELECT (public.condominios_puede_actuar('bitacora_manto', 'create')) ))));
DROP POLICY IF EXISTS bitacora_manto_update ON public.bitacora_manto;
CREATE POLICY bitacora_manto_update ON public.bitacora_manto
  AS PERMISSIVE FOR UPDATE TO authenticated
  USING ((is_super_admin() OR ((company_id = get_my_company_id()) AND ( SELECT (public.condominios_puede_actuar('bitacora_manto', 'edit')) ))))
  WITH CHECK ((is_super_admin() OR ((company_id = get_my_company_id()) AND ( SELECT (public.condominios_puede_actuar('bitacora_manto', 'edit')) ))));

-- ── comentarios_ticket ──────────────────────────────────────────────────────
--   INSERT kanban_tickets.create · mantenimiento.edit · portal.edit
--   UPDATE sin policy: nadie (no se crea)
--   DELETE kanban_tickets.delete
--   Los mensajes de un ticket se escriben desde la conversación de Mantenimiento (canWrite =
--   canEdit('mantenimiento')) y desde la vista previa del Portal del residente (canEdit('portal')).
DROP POLICY IF EXISTS comentarios_ticket_delete ON public.comentarios_ticket;
CREATE POLICY comentarios_ticket_delete ON public.comentarios_ticket
  AS PERMISSIVE FOR DELETE TO authenticated
  USING ((is_super_admin() OR (( SELECT (public.condominios_puede_actuar('kanban_tickets', 'delete')) ) AND (company_id = get_my_company_id()))));
DROP POLICY IF EXISTS comentarios_ticket_insert ON public.comentarios_ticket;
CREATE POLICY comentarios_ticket_insert ON public.comentarios_ticket
  AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK ((is_super_admin() OR ((company_id = get_my_company_id()) AND ( SELECT (public.condominios_puede_actuar('kanban_tickets', 'create') OR public.condominios_puede_actuar('mantenimiento', 'edit') OR public.condominios_puede_actuar('portal', 'edit')) )) OR ((es_interno = false) AND (estado_nuevo IS NULL) AND (EXISTS ( SELECT 1
   FROM tickets_mantenimiento t
  WHERE ((t.id = comentarios_ticket.ticket_id) AND (t.company_id = comentarios_ticket.company_id) AND (t.unidad_id IN ( SELECT mis_unidades_ids() AS mis_unidades_ids))))))));

-- ── contratos_proveedores ───────────────────────────────────────────────────
--   INSERT proveedores.create
--   UPDATE proveedores.edit
--   DELETE proveedores.delete
--   Un contrato nuevo nace en borrador, con modalidad y vinculado a un proveedor del catálogo (trigger de contratos): la fila de la prueba lo cumple.
DROP POLICY IF EXISTS contratos_proveedores_delete ON public.contratos_proveedores;
CREATE POLICY contratos_proveedores_delete ON public.contratos_proveedores
  AS PERMISSIVE FOR DELETE TO authenticated
  USING ((( SELECT is_super_admin() AS is_super_admin) OR (( SELECT (public.condominios_puede_actuar('proveedores', 'delete')) ) AND (company_id = ( SELECT get_my_company_id() AS get_my_company_id)) AND can_access_project(project_id))));
DROP POLICY IF EXISTS contratos_proveedores_insert ON public.contratos_proveedores;
CREATE POLICY contratos_proveedores_insert ON public.contratos_proveedores
  AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK ((( SELECT is_super_admin() AS is_super_admin) OR ((company_id = ( SELECT get_my_company_id() AS get_my_company_id)) AND can_access_project(project_id) AND ( SELECT (public.condominios_puede_actuar('proveedores', 'create')) ))));
DROP POLICY IF EXISTS contratos_proveedores_update ON public.contratos_proveedores;
CREATE POLICY contratos_proveedores_update ON public.contratos_proveedores
  AS PERMISSIVE FOR UPDATE TO authenticated
  USING ((( SELECT is_super_admin() AS is_super_admin) OR ((company_id = ( SELECT get_my_company_id() AS get_my_company_id)) AND can_access_project(project_id) AND ( SELECT (public.condominios_puede_actuar('proveedores', 'edit')) ))))
  WITH CHECK ((( SELECT is_super_admin() AS is_super_admin) OR ((company_id = ( SELECT get_my_company_id() AS get_my_company_id)) AND can_access_project(project_id) AND ( SELECT (public.condominios_puede_actuar('proveedores', 'edit')) ))));

-- ── control_plagas ──────────────────────────────────────────────────────────
--   INSERT control_plagas.create
--   UPDATE control_plagas.edit
--   DELETE control_plagas.delete
DROP POLICY IF EXISTS control_plagas_delete ON public.control_plagas;
CREATE POLICY control_plagas_delete ON public.control_plagas
  AS PERMISSIVE FOR DELETE TO authenticated
  USING ((is_super_admin() OR (( SELECT (public.condominios_puede_actuar('control_plagas', 'delete')) ) AND (company_id = get_my_company_id()))));
DROP POLICY IF EXISTS control_plagas_insert ON public.control_plagas;
CREATE POLICY control_plagas_insert ON public.control_plagas
  AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK ((is_super_admin() OR ((company_id = get_my_company_id()) AND ( SELECT (public.condominios_puede_actuar('control_plagas', 'create')) ))));
DROP POLICY IF EXISTS control_plagas_update ON public.control_plagas;
CREATE POLICY control_plagas_update ON public.control_plagas
  AS PERMISSIVE FOR UPDATE TO authenticated
  USING ((is_super_admin() OR ((company_id = get_my_company_id()) AND ( SELECT (public.condominios_puede_actuar('control_plagas', 'edit')) ))))
  WITH CHECK ((is_super_admin() OR ((company_id = get_my_company_id()) AND ( SELECT (public.condominios_puede_actuar('control_plagas', 'edit')) ))));

-- ── ejecuciones_mantenimiento ───────────────────────────────────────────────
--   INSERT mantenimiento.create · mant_preventivo.create
--   UPDATE sin policy: nadie (no se crea)
--   DELETE mantenimiento.delete
--   «Registrar ejecución» de un plan se ofrece en Mantenimiento preventivo con canCreate('mant_preventivo').
DROP POLICY IF EXISTS ejecuciones_mantenimiento_delete ON public.ejecuciones_mantenimiento;
CREATE POLICY ejecuciones_mantenimiento_delete ON public.ejecuciones_mantenimiento
  AS PERMISSIVE FOR DELETE TO authenticated
  USING ((is_super_admin() OR (( SELECT (public.condominios_puede_actuar('mantenimiento', 'delete')) ) AND (company_id = get_my_company_id()))));
DROP POLICY IF EXISTS ejecuciones_mantenimiento_insert ON public.ejecuciones_mantenimiento;
CREATE POLICY ejecuciones_mantenimiento_insert ON public.ejecuciones_mantenimiento
  AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK ((is_super_admin() OR ((company_id = get_my_company_id()) AND ( SELECT (public.condominios_puede_actuar('mantenimiento', 'create') OR public.condominios_puede_actuar('mant_preventivo', 'create')) ))));

-- ── evaluaciones_proveedor ──────────────────────────────────────────────────
--   INSERT eval_proveedor.create
--   UPDATE eval_proveedor.edit
--   DELETE eval_proveedor.delete
--   La evaluación se hace sobre un proveedor del catálogo (trigger de evaluaciones): la fila de la prueba lo trae.
DROP POLICY IF EXISTS evaluaciones_proveedor_delete ON public.evaluaciones_proveedor;
CREATE POLICY evaluaciones_proveedor_delete ON public.evaluaciones_proveedor
  AS PERMISSIVE FOR DELETE TO authenticated
  USING ((is_super_admin() OR (( SELECT (public.condominios_puede_actuar('eval_proveedor', 'delete')) ) AND (company_id = get_my_company_id()))));
DROP POLICY IF EXISTS evaluaciones_proveedor_insert ON public.evaluaciones_proveedor;
CREATE POLICY evaluaciones_proveedor_insert ON public.evaluaciones_proveedor
  AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK ((( SELECT is_super_admin() AS is_super_admin) OR ((company_id = ( SELECT get_my_company_id() AS get_my_company_id)) AND can_access_project(project_id) AND ( SELECT (public.condominios_puede_actuar('eval_proveedor', 'create')) ))));
DROP POLICY IF EXISTS evaluaciones_proveedor_update ON public.evaluaciones_proveedor;
CREATE POLICY evaluaciones_proveedor_update ON public.evaluaciones_proveedor
  AS PERMISSIVE FOR UPDATE TO authenticated
  USING ((( SELECT is_super_admin() AS is_super_admin) OR ((company_id = ( SELECT get_my_company_id() AS get_my_company_id)) AND can_access_project(project_id) AND ( SELECT (public.condominios_puede_actuar('eval_proveedor', 'edit')) ))))
  WITH CHECK ((( SELECT is_super_admin() AS is_super_admin) OR ((company_id = ( SELECT get_my_company_id() AS get_my_company_id)) AND can_access_project(project_id) AND ( SELECT (public.condominios_puede_actuar('eval_proveedor', 'edit')) ))));

-- ── garantias_equipo ────────────────────────────────────────────────────────
--   INSERT garantias.create
--   UPDATE garantias.edit
--   DELETE garantias.delete
DROP POLICY IF EXISTS garantias_equipo_delete ON public.garantias_equipo;
CREATE POLICY garantias_equipo_delete ON public.garantias_equipo
  AS PERMISSIVE FOR DELETE TO authenticated
  USING ((is_super_admin() OR (( SELECT (public.condominios_puede_actuar('garantias', 'delete')) ) AND (company_id = get_my_company_id()))));
DROP POLICY IF EXISTS garantias_equipo_insert ON public.garantias_equipo;
CREATE POLICY garantias_equipo_insert ON public.garantias_equipo
  AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK ((is_super_admin() OR ((company_id = get_my_company_id()) AND ( SELECT (public.condominios_puede_actuar('garantias', 'create')) ))));
DROP POLICY IF EXISTS garantias_equipo_update ON public.garantias_equipo;
CREATE POLICY garantias_equipo_update ON public.garantias_equipo
  AS PERMISSIVE FOR UPDATE TO authenticated
  USING ((is_super_admin() OR ((company_id = get_my_company_id()) AND ( SELECT (public.condominios_puede_actuar('garantias', 'edit')) ))))
  WITH CHECK ((is_super_admin() OR ((company_id = get_my_company_id()) AND ( SELECT (public.condominios_puede_actuar('garantias', 'edit')) ))));

-- ── inventario_condominio ───────────────────────────────────────────────────
--   INSERT inventario.create
--   UPDATE inventario.edit
--   DELETE inventario.delete
DROP POLICY IF EXISTS inventario_condominio_delete ON public.inventario_condominio;
CREATE POLICY inventario_condominio_delete ON public.inventario_condominio
  AS PERMISSIVE FOR DELETE TO authenticated
  USING ((is_super_admin() OR (( SELECT (public.condominios_puede_actuar('inventario', 'delete')) ) AND (company_id = get_my_company_id()))));
DROP POLICY IF EXISTS inventario_condominio_insert ON public.inventario_condominio;
CREATE POLICY inventario_condominio_insert ON public.inventario_condominio
  AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK ((is_super_admin() OR ((company_id = get_my_company_id()) AND ( SELECT (public.condominios_puede_actuar('inventario', 'create')) ))));
DROP POLICY IF EXISTS inventario_condominio_update ON public.inventario_condominio;
CREATE POLICY inventario_condominio_update ON public.inventario_condominio
  AS PERMISSIVE FOR UPDATE TO authenticated
  USING ((is_super_admin() OR ((company_id = get_my_company_id()) AND ( SELECT (public.condominios_puede_actuar('inventario', 'edit')) ))))
  WITH CHECK ((is_super_admin() OR ((company_id = get_my_company_id()) AND ( SELECT (public.condominios_puede_actuar('inventario', 'edit')) ))));

-- ── movimientos_suministro ──────────────────────────────────────────────────
--   INSERT suministros.create · suministros.edit
--   UPDATE suministros.edit
--   DELETE suministros.delete
--   «+ Movimiento» de un insumo se ofrece con canEdit('suministros'): mueve su stock.
DROP POLICY IF EXISTS movimientos_suministro_delete ON public.movimientos_suministro;
CREATE POLICY movimientos_suministro_delete ON public.movimientos_suministro
  AS PERMISSIVE FOR DELETE TO authenticated
  USING ((( SELECT is_super_admin() AS is_super_admin) OR (( SELECT (public.condominios_puede_actuar('suministros', 'delete')) ) AND (company_id = ( SELECT get_my_company_id() AS get_my_company_id)))));
DROP POLICY IF EXISTS movimientos_suministro_insert ON public.movimientos_suministro;
CREATE POLICY movimientos_suministro_insert ON public.movimientos_suministro
  AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK ((( SELECT is_super_admin() AS is_super_admin) OR ((company_id = ( SELECT get_my_company_id() AS get_my_company_id)) AND ( SELECT (public.condominios_puede_actuar('suministros', 'create') OR public.condominios_puede_actuar('suministros', 'edit')) ))));
DROP POLICY IF EXISTS movimientos_suministro_update ON public.movimientos_suministro;
CREATE POLICY movimientos_suministro_update ON public.movimientos_suministro
  AS PERMISSIVE FOR UPDATE TO authenticated
  USING ((( SELECT is_super_admin() AS is_super_admin) OR ((company_id = ( SELECT get_my_company_id() AS get_my_company_id)) AND ( SELECT (public.condominios_puede_actuar('suministros', 'edit')) ))))
  WITH CHECK ((( SELECT is_super_admin() AS is_super_admin) OR ((company_id = ( SELECT get_my_company_id() AS get_my_company_id)) AND ( SELECT (public.condominios_puede_actuar('suministros', 'edit')) ))));

-- ── obras_mejoras ───────────────────────────────────────────────────────────
--   INSERT obras.create
--   UPDATE obras.edit
--   DELETE obras.delete
DROP POLICY IF EXISTS obras_mejoras_delete ON public.obras_mejoras;
CREATE POLICY obras_mejoras_delete ON public.obras_mejoras
  AS PERMISSIVE FOR DELETE TO authenticated
  USING ((is_super_admin() OR (( SELECT (public.condominios_puede_actuar('obras', 'delete')) ) AND (company_id = get_my_company_id()))));
DROP POLICY IF EXISTS obras_mejoras_insert ON public.obras_mejoras;
CREATE POLICY obras_mejoras_insert ON public.obras_mejoras
  AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK ((is_super_admin() OR ((company_id = get_my_company_id()) AND ( SELECT (public.condominios_puede_actuar('obras', 'create')) ))));
DROP POLICY IF EXISTS obras_mejoras_update ON public.obras_mejoras;
CREATE POLICY obras_mejoras_update ON public.obras_mejoras
  AS PERMISSIVE FOR UPDATE TO authenticated
  USING ((is_super_admin() OR ((company_id = get_my_company_id()) AND ( SELECT (public.condominios_puede_actuar('obras', 'edit')) ))))
  WITH CHECK ((is_super_admin() OR ((company_id = get_my_company_id()) AND ( SELECT (public.condominios_puede_actuar('obras', 'edit')) ))));

-- ── planes_mantenimiento ────────────────────────────────────────────────────
--   INSERT mant_preventivo.create
--   UPDATE mant_preventivo.edit · mant_preventivo.create
--   DELETE mant_preventivo.delete
--   Registrar una ejecución (canCreate) actualiza la última y la próxima fecha del plan.
DROP POLICY IF EXISTS planes_mantenimiento_delete ON public.planes_mantenimiento;
CREATE POLICY planes_mantenimiento_delete ON public.planes_mantenimiento
  AS PERMISSIVE FOR DELETE TO authenticated
  USING ((is_super_admin() OR (( SELECT (public.condominios_puede_actuar('mant_preventivo', 'delete')) ) AND (company_id = get_my_company_id()))));
DROP POLICY IF EXISTS planes_mantenimiento_insert ON public.planes_mantenimiento;
CREATE POLICY planes_mantenimiento_insert ON public.planes_mantenimiento
  AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK ((is_super_admin() OR ((company_id = get_my_company_id()) AND ( SELECT (public.condominios_puede_actuar('mant_preventivo', 'create')) ))));
DROP POLICY IF EXISTS planes_mantenimiento_update ON public.planes_mantenimiento;
CREATE POLICY planes_mantenimiento_update ON public.planes_mantenimiento
  AS PERMISSIVE FOR UPDATE TO authenticated
  USING ((is_super_admin() OR ((company_id = get_my_company_id()) AND ( SELECT (public.condominios_puede_actuar('mant_preventivo', 'edit') OR public.condominios_puede_actuar('mant_preventivo', 'create')) ))))
  WITH CHECK ((is_super_admin() OR ((company_id = get_my_company_id()) AND ( SELECT (public.condominios_puede_actuar('mant_preventivo', 'edit') OR public.condominios_puede_actuar('mant_preventivo', 'create')) ))));

-- ── prestamos_equipo ────────────────────────────────────────────────────────
--   INSERT prestamos.create
--   UPDATE prestamos.edit
--   DELETE prestamos.delete
DROP POLICY IF EXISTS prestamos_equipo_delete ON public.prestamos_equipo;
CREATE POLICY prestamos_equipo_delete ON public.prestamos_equipo
  AS PERMISSIVE FOR DELETE TO authenticated
  USING ((is_super_admin() OR (( SELECT (public.condominios_puede_actuar('prestamos', 'delete')) ) AND (company_id = get_my_company_id()))));
DROP POLICY IF EXISTS prestamos_equipo_insert ON public.prestamos_equipo;
CREATE POLICY prestamos_equipo_insert ON public.prestamos_equipo
  AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK ((is_super_admin() OR ((company_id = get_my_company_id()) AND ( SELECT (public.condominios_puede_actuar('prestamos', 'create')) ))));
DROP POLICY IF EXISTS prestamos_equipo_update ON public.prestamos_equipo;
CREATE POLICY prestamos_equipo_update ON public.prestamos_equipo
  AS PERMISSIVE FOR UPDATE TO authenticated
  USING ((is_super_admin() OR ((company_id = get_my_company_id()) AND ( SELECT (public.condominios_puede_actuar('prestamos', 'edit')) ))))
  WITH CHECK ((is_super_admin() OR ((company_id = get_my_company_id()) AND ( SELECT (public.condominios_puede_actuar('prestamos', 'edit')) ))));

-- ── proyectos_condominio ────────────────────────────────────────────────────
--   INSERT proyectos_cond.create
--   UPDATE proyectos_cond.edit
--   DELETE proyectos_cond.delete
DROP POLICY IF EXISTS proyectos_condominio_delete ON public.proyectos_condominio;
CREATE POLICY proyectos_condominio_delete ON public.proyectos_condominio
  AS PERMISSIVE FOR DELETE TO authenticated
  USING ((is_super_admin() OR (( SELECT (public.condominios_puede_actuar('proyectos_cond', 'delete')) ) AND (company_id = get_my_company_id()))));
DROP POLICY IF EXISTS proyectos_condominio_insert ON public.proyectos_condominio;
CREATE POLICY proyectos_condominio_insert ON public.proyectos_condominio
  AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK ((is_super_admin() OR ((company_id = get_my_company_id()) AND ( SELECT (public.condominios_puede_actuar('proyectos_cond', 'create')) ))));
DROP POLICY IF EXISTS proyectos_condominio_update ON public.proyectos_condominio;
CREATE POLICY proyectos_condominio_update ON public.proyectos_condominio
  AS PERMISSIVE FOR UPDATE TO authenticated
  USING ((is_super_admin() OR ((company_id = get_my_company_id()) AND ( SELECT (public.condominios_puede_actuar('proyectos_cond', 'edit')) ))))
  WITH CHECK ((is_super_admin() OR ((company_id = get_my_company_id()) AND ( SELECT (public.condominios_puede_actuar('proyectos_cond', 'edit')) ))));

-- ── suministros_condominio ──────────────────────────────────────────────────
--   INSERT suministros.create
--   UPDATE suministros.edit
--   DELETE suministros.delete
DROP POLICY IF EXISTS suministros_condominio_delete ON public.suministros_condominio;
CREATE POLICY suministros_condominio_delete ON public.suministros_condominio
  AS PERMISSIVE FOR DELETE TO authenticated
  USING ((( SELECT is_super_admin() AS is_super_admin) OR (( SELECT (public.condominios_puede_actuar('suministros', 'delete')) ) AND (company_id = ( SELECT get_my_company_id() AS get_my_company_id)))));
DROP POLICY IF EXISTS suministros_condominio_insert ON public.suministros_condominio;
CREATE POLICY suministros_condominio_insert ON public.suministros_condominio
  AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK ((( SELECT is_super_admin() AS is_super_admin) OR ((company_id = ( SELECT get_my_company_id() AS get_my_company_id)) AND ( SELECT (public.condominios_puede_actuar('suministros', 'create')) ))));
DROP POLICY IF EXISTS suministros_condominio_update ON public.suministros_condominio;
CREATE POLICY suministros_condominio_update ON public.suministros_condominio
  AS PERMISSIVE FOR UPDATE TO authenticated
  USING ((( SELECT is_super_admin() AS is_super_admin) OR ((company_id = ( SELECT get_my_company_id() AS get_my_company_id)) AND ( SELECT (public.condominios_puede_actuar('suministros', 'edit')) ))))
  WITH CHECK ((( SELECT is_super_admin() AS is_super_admin) OR ((company_id = ( SELECT get_my_company_id() AS get_my_company_id)) AND ( SELECT (public.condominios_puede_actuar('suministros', 'edit')) )))
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
    ('areas_condominio', 3, 3),
    ('bitacora_manto', 3, 3),
    ('comentarios_ticket', 2, 2),
    ('contratos_proveedores', 3, 3),
    ('control_plagas', 3, 3),
    ('ejecuciones_mantenimiento', 2, 2),
    ('evaluaciones_proveedor', 3, 3),
    ('garantias_equipo', 3, 3),
    ('inventario_condominio', 3, 3),
    ('movimientos_suministro', 3, 3),
    ('obras_mejoras', 3, 3),
    ('planes_mantenimiento', 3, 3),
    ('prestamos_equipo', 3, 3),
    ('proyectos_condominio', 3, 3),
    ('suministros_condominio', 3, 3)
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
