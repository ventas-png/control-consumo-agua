-- ════════════════════════════════════════════════════════════════════════════
-- Administración: escribir exige la ACCIÓN del tab, también en la base
--
-- POR QUÉ
-- La pantalla decide cada escritura de estos tabs con su acción (canCreate /
-- canEdit / canApprove / canDelete). Las policies de INSERT y UPDATE sólo
-- pedían ver el tab —quien sólo consulta podía crear y editar por la API— y
-- las de DELETE sólo dejaban a company_owner/admin, aunque la pantalla
-- ofreciera «Eliminar» a quien tuviera la acción.
--
-- Tabs: Automatizaciones (y reglas de notificación), Bitácora de acciones,
-- Configuración, Documentos, Firmas, Flujo de aprobación, Inspecciones, Libro
-- de novedades (y las novedades de seguridad), Memoria de labores, Notas,
-- Plantillas de mensaje, Pólizas, Propuestas, Registro de autoridades,
-- Reglamento y Vencimientos críticos.
--
-- Queda fuera paquetes_recibidos: su policy elige la clave del tab por la
-- clase del paquete (CASE clase); va con los casos especiales.
--
-- QUÉ HACE (generado por scripts/rls-acciones/generar.mjs desde
-- supabase/rls-acciones/administracion.json; no editar a mano)
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

-- ── automatizaciones_cond ───────────────────────────────────────────────────
--   INSERT automatizaciones.create
--   UPDATE automatizaciones.edit
--   DELETE automatizaciones.delete
DROP POLICY IF EXISTS automatizaciones_cond_delete ON public.automatizaciones_cond;
CREATE POLICY automatizaciones_cond_delete ON public.automatizaciones_cond
  AS PERMISSIVE FOR DELETE TO authenticated
  USING ((is_super_admin() OR (( SELECT (public.condominios_puede_actuar('automatizaciones', 'delete')) ) AND (company_id = get_my_company_id()))));
DROP POLICY IF EXISTS automatizaciones_cond_insert ON public.automatizaciones_cond;
CREATE POLICY automatizaciones_cond_insert ON public.automatizaciones_cond
  AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK ((is_super_admin() OR ((company_id = get_my_company_id()) AND ( SELECT (public.condominios_puede_actuar('automatizaciones', 'create')) ))));
DROP POLICY IF EXISTS automatizaciones_cond_update ON public.automatizaciones_cond;
CREATE POLICY automatizaciones_cond_update ON public.automatizaciones_cond
  AS PERMISSIVE FOR UPDATE TO authenticated
  USING ((is_super_admin() OR ((company_id = get_my_company_id()) AND ( SELECT (public.condominios_puede_actuar('automatizaciones', 'edit')) ))))
  WITH CHECK ((is_super_admin() OR ((company_id = get_my_company_id()) AND ( SELECT (public.condominios_puede_actuar('automatizaciones', 'edit')) ))));

-- ── bitacora_acciones ───────────────────────────────────────────────────────
--   INSERT bitacora_acciones.create
--   UPDATE sin policy: nadie (no se crea)
--   DELETE sin policy: nadie (no se crea)
DROP POLICY IF EXISTS bitacora_acciones_insert ON public.bitacora_acciones;
CREATE POLICY bitacora_acciones_insert ON public.bitacora_acciones
  AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK ((is_super_admin() OR ((company_id = get_my_company_id()) AND ( SELECT (public.condominios_puede_actuar('bitacora_acciones', 'create')) ))));

-- ── configuracion_condominio ────────────────────────────────────────────────
--   INSERT configuracion_cond.create · configuracion.edit
--   UPDATE configuracion_cond.edit · configuracion.edit
--   DELETE configuracion_cond.delete
--   La escribe la pestaña Configuración con canEdit('configuracion'): guardar crea la fila la primera vez.
DROP POLICY IF EXISTS configuracion_condominio_delete ON public.configuracion_condominio;
CREATE POLICY configuracion_condominio_delete ON public.configuracion_condominio
  AS PERMISSIVE FOR DELETE TO authenticated
  USING ((is_super_admin() OR (( SELECT (public.condominios_puede_actuar('configuracion_cond', 'delete')) ) AND (company_id = get_my_company_id()))));
DROP POLICY IF EXISTS configuracion_condominio_insert ON public.configuracion_condominio;
CREATE POLICY configuracion_condominio_insert ON public.configuracion_condominio
  AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK ((is_super_admin() OR ((company_id = get_my_company_id()) AND ( SELECT (public.condominios_puede_actuar('configuracion_cond', 'create') OR public.condominios_puede_actuar('configuracion', 'edit')) ))));
DROP POLICY IF EXISTS configuracion_condominio_update ON public.configuracion_condominio;
CREATE POLICY configuracion_condominio_update ON public.configuracion_condominio
  AS PERMISSIVE FOR UPDATE TO authenticated
  USING ((is_super_admin() OR ((company_id = get_my_company_id()) AND ( SELECT (public.condominios_puede_actuar('configuracion_cond', 'edit') OR public.condominios_puede_actuar('configuracion', 'edit')) ))))
  WITH CHECK ((is_super_admin() OR ((company_id = get_my_company_id()) AND ( SELECT (public.condominios_puede_actuar('configuracion_cond', 'edit') OR public.condominios_puede_actuar('configuracion', 'edit')) ))));

-- ── documentos_condominio ───────────────────────────────────────────────────
--   INSERT documentos.create
--   UPDATE documentos.edit
--   DELETE documentos.delete
DROP POLICY IF EXISTS documentos_condominio_delete ON public.documentos_condominio;
CREATE POLICY documentos_condominio_delete ON public.documentos_condominio
  AS PERMISSIVE FOR DELETE TO authenticated
  USING ((is_super_admin() OR (( SELECT (public.condominios_puede_actuar('documentos', 'delete')) ) AND (company_id = get_my_company_id()))));
DROP POLICY IF EXISTS documentos_condominio_insert ON public.documentos_condominio;
CREATE POLICY documentos_condominio_insert ON public.documentos_condominio
  AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK ((is_super_admin() OR ((company_id = get_my_company_id()) AND ( SELECT (public.condominios_puede_actuar('documentos', 'create')) ))));
DROP POLICY IF EXISTS documentos_condominio_update ON public.documentos_condominio;
CREATE POLICY documentos_condominio_update ON public.documentos_condominio
  AS PERMISSIVE FOR UPDATE TO authenticated
  USING ((is_super_admin() OR ((company_id = get_my_company_id()) AND ( SELECT (public.condominios_puede_actuar('documentos', 'edit')) ))))
  WITH CHECK ((is_super_admin() OR ((company_id = get_my_company_id()) AND ( SELECT (public.condominios_puede_actuar('documentos', 'edit')) ))));

-- ── firmas_digitales ────────────────────────────────────────────────────────
--   INSERT firmas.create
--   UPDATE firmas.edit
--   DELETE firmas.delete
DROP POLICY IF EXISTS firmas_digitales_delete ON public.firmas_digitales;
CREATE POLICY firmas_digitales_delete ON public.firmas_digitales
  AS PERMISSIVE FOR DELETE TO authenticated
  USING ((is_super_admin() OR (( SELECT (public.condominios_puede_actuar('firmas', 'delete')) ) AND (company_id = get_my_company_id()))));
DROP POLICY IF EXISTS firmas_digitales_insert ON public.firmas_digitales;
CREATE POLICY firmas_digitales_insert ON public.firmas_digitales
  AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK ((is_super_admin() OR ((company_id = get_my_company_id()) AND ( SELECT (public.condominios_puede_actuar('firmas', 'create')) ))));
DROP POLICY IF EXISTS firmas_digitales_update ON public.firmas_digitales;
CREATE POLICY firmas_digitales_update ON public.firmas_digitales
  AS PERMISSIVE FOR UPDATE TO authenticated
  USING ((is_super_admin() OR ((company_id = get_my_company_id()) AND ( SELECT (public.condominios_puede_actuar('firmas', 'edit')) ))))
  WITH CHECK ((is_super_admin() OR ((company_id = get_my_company_id()) AND ( SELECT (public.condominios_puede_actuar('firmas', 'edit')) ))));

-- ── flujo_aprobacion_cond ───────────────────────────────────────────────────
--   INSERT flujo_aprobacion.create
--   UPDATE flujo_aprobacion.edit · flujo_aprobacion.approve
--   DELETE flujo_aprobacion.delete
--   Aprobar o rechazar una solicitud se ofrece con canApprove('flujo_aprobacion').
DROP POLICY IF EXISTS flujo_aprobacion_cond_delete ON public.flujo_aprobacion_cond;
CREATE POLICY flujo_aprobacion_cond_delete ON public.flujo_aprobacion_cond
  AS PERMISSIVE FOR DELETE TO authenticated
  USING ((is_super_admin() OR (( SELECT (public.condominios_puede_actuar('flujo_aprobacion', 'delete')) ) AND (company_id = get_my_company_id()))));
DROP POLICY IF EXISTS flujo_aprobacion_cond_insert ON public.flujo_aprobacion_cond;
CREATE POLICY flujo_aprobacion_cond_insert ON public.flujo_aprobacion_cond
  AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK ((is_super_admin() OR ((company_id = get_my_company_id()) AND ( SELECT (public.condominios_puede_actuar('flujo_aprobacion', 'create')) ))));
DROP POLICY IF EXISTS flujo_aprobacion_cond_update ON public.flujo_aprobacion_cond;
CREATE POLICY flujo_aprobacion_cond_update ON public.flujo_aprobacion_cond
  AS PERMISSIVE FOR UPDATE TO authenticated
  USING ((is_super_admin() OR ((company_id = get_my_company_id()) AND ( SELECT (public.condominios_puede_actuar('flujo_aprobacion', 'edit') OR public.condominios_puede_actuar('flujo_aprobacion', 'approve')) ))))
  WITH CHECK ((is_super_admin() OR ((company_id = get_my_company_id()) AND ( SELECT (public.condominios_puede_actuar('flujo_aprobacion', 'edit') OR public.condominios_puede_actuar('flujo_aprobacion', 'approve')) ))));

-- ── inspecciones_normativas ─────────────────────────────────────────────────
--   INSERT inspecciones.create
--   UPDATE inspecciones.edit
--   DELETE inspecciones.delete
DROP POLICY IF EXISTS inspecciones_normativas_delete ON public.inspecciones_normativas;
CREATE POLICY inspecciones_normativas_delete ON public.inspecciones_normativas
  AS PERMISSIVE FOR DELETE TO authenticated
  USING ((is_super_admin() OR (( SELECT (public.condominios_puede_actuar('inspecciones', 'delete')) ) AND (company_id = get_my_company_id()))));
DROP POLICY IF EXISTS inspecciones_normativas_insert ON public.inspecciones_normativas;
CREATE POLICY inspecciones_normativas_insert ON public.inspecciones_normativas
  AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK ((is_super_admin() OR ((company_id = get_my_company_id()) AND ( SELECT (public.condominios_puede_actuar('inspecciones', 'create')) ))));
DROP POLICY IF EXISTS inspecciones_normativas_update ON public.inspecciones_normativas;
CREATE POLICY inspecciones_normativas_update ON public.inspecciones_normativas
  AS PERMISSIVE FOR UPDATE TO authenticated
  USING ((is_super_admin() OR ((company_id = get_my_company_id()) AND ( SELECT (public.condominios_puede_actuar('inspecciones', 'edit')) ))))
  WITH CHECK ((is_super_admin() OR ((company_id = get_my_company_id()) AND ( SELECT (public.condominios_puede_actuar('inspecciones', 'edit')) ))));

-- ── libro_novedades ─────────────────────────────────────────────────────────
--   INSERT libro_novedades.create
--   UPDATE libro_novedades.edit
--   DELETE libro_novedades.delete
DROP POLICY IF EXISTS libro_novedades_delete ON public.libro_novedades;
CREATE POLICY libro_novedades_delete ON public.libro_novedades
  AS PERMISSIVE FOR DELETE TO authenticated
  USING ((is_super_admin() OR (( SELECT (public.condominios_puede_actuar('libro_novedades', 'delete')) ) AND (company_id = get_my_company_id()))));
DROP POLICY IF EXISTS libro_novedades_insert ON public.libro_novedades;
CREATE POLICY libro_novedades_insert ON public.libro_novedades
  AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK ((is_super_admin() OR ((company_id = get_my_company_id()) AND ( SELECT (public.condominios_puede_actuar('libro_novedades', 'create')) ))));
DROP POLICY IF EXISTS libro_novedades_update ON public.libro_novedades;
CREATE POLICY libro_novedades_update ON public.libro_novedades
  AS PERMISSIVE FOR UPDATE TO authenticated
  USING ((is_super_admin() OR ((company_id = get_my_company_id()) AND ( SELECT (public.condominios_puede_actuar('libro_novedades', 'edit')) ))))
  WITH CHECK ((is_super_admin() OR ((company_id = get_my_company_id()) AND ( SELECT (public.condominios_puede_actuar('libro_novedades', 'edit')) ))));

-- ── memoria_labores ─────────────────────────────────────────────────────────
--   INSERT memoria.create
--   UPDATE memoria.edit
--   DELETE memoria.delete
DROP POLICY IF EXISTS memoria_labores_delete ON public.memoria_labores;
CREATE POLICY memoria_labores_delete ON public.memoria_labores
  AS PERMISSIVE FOR DELETE TO authenticated
  USING ((is_super_admin() OR (( SELECT (public.condominios_puede_actuar('memoria', 'delete')) ) AND (company_id = get_my_company_id()))));
DROP POLICY IF EXISTS memoria_labores_insert ON public.memoria_labores;
CREATE POLICY memoria_labores_insert ON public.memoria_labores
  AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK ((is_super_admin() OR ((company_id = get_my_company_id()) AND ( SELECT (public.condominios_puede_actuar('memoria', 'create')) ))));
DROP POLICY IF EXISTS memoria_labores_update ON public.memoria_labores;
CREATE POLICY memoria_labores_update ON public.memoria_labores
  AS PERMISSIVE FOR UPDATE TO authenticated
  USING ((is_super_admin() OR ((company_id = get_my_company_id()) AND ( SELECT (public.condominios_puede_actuar('memoria', 'edit')) ))))
  WITH CHECK ((is_super_admin() OR ((company_id = get_my_company_id()) AND ( SELECT (public.condominios_puede_actuar('memoria', 'edit')) ))));

-- ── notas_admin ─────────────────────────────────────────────────────────────
--   INSERT notas_admin.create
--   UPDATE notas_admin.edit
--   DELETE notas_admin.delete
DROP POLICY IF EXISTS notas_admin_delete ON public.notas_admin;
CREATE POLICY notas_admin_delete ON public.notas_admin
  AS PERMISSIVE FOR DELETE TO authenticated
  USING ((is_super_admin() OR (( SELECT (public.condominios_puede_actuar('notas_admin', 'delete')) ) AND (company_id = get_my_company_id()))));
DROP POLICY IF EXISTS notas_admin_insert ON public.notas_admin;
CREATE POLICY notas_admin_insert ON public.notas_admin
  AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK ((is_super_admin() OR ((company_id = get_my_company_id()) AND ( SELECT (public.condominios_puede_actuar('notas_admin', 'create')) ))));
DROP POLICY IF EXISTS notas_admin_update ON public.notas_admin;
CREATE POLICY notas_admin_update ON public.notas_admin
  AS PERMISSIVE FOR UPDATE TO authenticated
  USING ((is_super_admin() OR ((company_id = get_my_company_id()) AND ( SELECT (public.condominios_puede_actuar('notas_admin', 'edit')) ))))
  WITH CHECK ((is_super_admin() OR ((company_id = get_my_company_id()) AND ( SELECT (public.condominios_puede_actuar('notas_admin', 'edit')) ))));

-- ── novedades_seguridad ─────────────────────────────────────────────────────
--   INSERT libro_novedades.create · seguridad.create · visitantes.create
--   UPDATE libro_novedades.edit
--   DELETE libro_novedades.delete · seguridad.delete
--   Seguridad registra y borra novedades; Visitantes registra la de una salida con novedad.
DROP POLICY IF EXISTS novedades_seguridad_delete ON public.novedades_seguridad;
CREATE POLICY novedades_seguridad_delete ON public.novedades_seguridad
  AS PERMISSIVE FOR DELETE TO authenticated
  USING ((is_super_admin() OR (( SELECT (public.condominios_puede_actuar('libro_novedades', 'delete') OR public.condominios_puede_actuar('seguridad', 'delete')) ) AND (company_id = get_my_company_id()))));
DROP POLICY IF EXISTS novedades_seguridad_insert ON public.novedades_seguridad;
CREATE POLICY novedades_seguridad_insert ON public.novedades_seguridad
  AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK ((is_super_admin() OR ((company_id = get_my_company_id()) AND ( SELECT (public.condominios_puede_actuar('libro_novedades', 'create') OR public.condominios_puede_actuar('seguridad', 'create') OR public.condominios_puede_actuar('visitantes', 'create')) ))));
DROP POLICY IF EXISTS novedades_seguridad_update ON public.novedades_seguridad;
CREATE POLICY novedades_seguridad_update ON public.novedades_seguridad
  AS PERMISSIVE FOR UPDATE TO authenticated
  USING ((is_super_admin() OR ((company_id = get_my_company_id()) AND ( SELECT (public.condominios_puede_actuar('libro_novedades', 'edit')) ))))
  WITH CHECK ((is_super_admin() OR ((company_id = get_my_company_id()) AND ( SELECT (public.condominios_puede_actuar('libro_novedades', 'edit')) ))));

-- ── plantillas_mensaje_cond ─────────────────────────────────────────────────
--   INSERT plantillas_mensaje.create
--   UPDATE plantillas_mensaje.edit
--   DELETE plantillas_mensaje.delete
DROP POLICY IF EXISTS plantillas_mensaje_cond_delete ON public.plantillas_mensaje_cond;
CREATE POLICY plantillas_mensaje_cond_delete ON public.plantillas_mensaje_cond
  AS PERMISSIVE FOR DELETE TO authenticated
  USING ((is_super_admin() OR (( SELECT (public.condominios_puede_actuar('plantillas_mensaje', 'delete')) ) AND (company_id = get_my_company_id()))));
DROP POLICY IF EXISTS plantillas_mensaje_cond_insert ON public.plantillas_mensaje_cond;
CREATE POLICY plantillas_mensaje_cond_insert ON public.plantillas_mensaje_cond
  AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK ((is_super_admin() OR ((company_id = get_my_company_id()) AND ( SELECT (public.condominios_puede_actuar('plantillas_mensaje', 'create')) ))));
DROP POLICY IF EXISTS plantillas_mensaje_cond_update ON public.plantillas_mensaje_cond;
CREATE POLICY plantillas_mensaje_cond_update ON public.plantillas_mensaje_cond
  AS PERMISSIVE FOR UPDATE TO authenticated
  USING ((is_super_admin() OR ((company_id = get_my_company_id()) AND ( SELECT (public.condominios_puede_actuar('plantillas_mensaje', 'edit')) ))))
  WITH CHECK ((is_super_admin() OR ((company_id = get_my_company_id()) AND ( SELECT (public.condominios_puede_actuar('plantillas_mensaje', 'edit')) ))));

-- ── polizas_seguro ──────────────────────────────────────────────────────────
--   INSERT polizas.create
--   UPDATE polizas.edit
--   DELETE polizas.delete
DROP POLICY IF EXISTS polizas_seguro_delete ON public.polizas_seguro;
CREATE POLICY polizas_seguro_delete ON public.polizas_seguro
  AS PERMISSIVE FOR DELETE TO authenticated
  USING ((is_super_admin() OR (( SELECT (public.condominios_puede_actuar('polizas', 'delete')) ) AND (company_id = get_my_company_id()))));
DROP POLICY IF EXISTS polizas_seguro_insert ON public.polizas_seguro;
CREATE POLICY polizas_seguro_insert ON public.polizas_seguro
  AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK ((is_super_admin() OR ((company_id = get_my_company_id()) AND ( SELECT (public.condominios_puede_actuar('polizas', 'create')) ))));
DROP POLICY IF EXISTS polizas_seguro_update ON public.polizas_seguro;
CREATE POLICY polizas_seguro_update ON public.polizas_seguro
  AS PERMISSIVE FOR UPDATE TO authenticated
  USING ((is_super_admin() OR ((company_id = get_my_company_id()) AND ( SELECT (public.condominios_puede_actuar('polizas', 'edit')) ))))
  WITH CHECK ((is_super_admin() OR ((company_id = get_my_company_id()) AND ( SELECT (public.condominios_puede_actuar('polizas', 'edit')) ))));

-- ── propuestas_inversion ────────────────────────────────────────────────────
--   INSERT propuestas.create
--   UPDATE propuestas.edit
--   DELETE propuestas.delete
DROP POLICY IF EXISTS propuestas_inversion_delete ON public.propuestas_inversion;
CREATE POLICY propuestas_inversion_delete ON public.propuestas_inversion
  AS PERMISSIVE FOR DELETE TO authenticated
  USING ((is_super_admin() OR (( SELECT (public.condominios_puede_actuar('propuestas', 'delete')) ) AND (company_id = get_my_company_id()))));
DROP POLICY IF EXISTS propuestas_inversion_insert ON public.propuestas_inversion;
CREATE POLICY propuestas_inversion_insert ON public.propuestas_inversion
  AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK ((is_super_admin() OR ((company_id = get_my_company_id()) AND ( SELECT (public.condominios_puede_actuar('propuestas', 'create')) ))));
DROP POLICY IF EXISTS propuestas_inversion_update ON public.propuestas_inversion;
CREATE POLICY propuestas_inversion_update ON public.propuestas_inversion
  AS PERMISSIVE FOR UPDATE TO authenticated
  USING ((is_super_admin() OR ((company_id = get_my_company_id()) AND ( SELECT (public.condominios_puede_actuar('propuestas', 'edit')) ))))
  WITH CHECK ((is_super_admin() OR ((company_id = get_my_company_id()) AND ( SELECT (public.condominios_puede_actuar('propuestas', 'edit')) ))));

-- ── registro_autoridades ────────────────────────────────────────────────────
--   INSERT reg_autoridades.create
--   UPDATE reg_autoridades.edit
--   DELETE reg_autoridades.delete
DROP POLICY IF EXISTS registro_autoridades_delete ON public.registro_autoridades;
CREATE POLICY registro_autoridades_delete ON public.registro_autoridades
  AS PERMISSIVE FOR DELETE TO authenticated
  USING ((is_super_admin() OR (( SELECT (public.condominios_puede_actuar('reg_autoridades', 'delete')) ) AND (company_id = get_my_company_id()))));
DROP POLICY IF EXISTS registro_autoridades_insert ON public.registro_autoridades;
CREATE POLICY registro_autoridades_insert ON public.registro_autoridades
  AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK ((is_super_admin() OR ((company_id = get_my_company_id()) AND ( SELECT (public.condominios_puede_actuar('reg_autoridades', 'create')) ))));
DROP POLICY IF EXISTS registro_autoridades_update ON public.registro_autoridades;
CREATE POLICY registro_autoridades_update ON public.registro_autoridades
  AS PERMISSIVE FOR UPDATE TO authenticated
  USING ((is_super_admin() OR ((company_id = get_my_company_id()) AND ( SELECT (public.condominios_puede_actuar('reg_autoridades', 'edit')) ))))
  WITH CHECK ((is_super_admin() OR ((company_id = get_my_company_id()) AND ( SELECT (public.condominios_puede_actuar('reg_autoridades', 'edit')) ))));

-- ── reglamento_condominio ───────────────────────────────────────────────────
--   INSERT reglamento.create
--   UPDATE reglamento.edit
--   DELETE reglamento.delete
DROP POLICY IF EXISTS reglamento_condominio_delete ON public.reglamento_condominio;
CREATE POLICY reglamento_condominio_delete ON public.reglamento_condominio
  AS PERMISSIVE FOR DELETE TO authenticated
  USING ((is_super_admin() OR (( SELECT (public.condominios_puede_actuar('reglamento', 'delete')) ) AND (company_id = get_my_company_id()))));
DROP POLICY IF EXISTS reglamento_condominio_insert ON public.reglamento_condominio;
CREATE POLICY reglamento_condominio_insert ON public.reglamento_condominio
  AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK ((is_super_admin() OR ((company_id = get_my_company_id()) AND ( SELECT (public.condominios_puede_actuar('reglamento', 'create')) ))));
DROP POLICY IF EXISTS reglamento_condominio_update ON public.reglamento_condominio;
CREATE POLICY reglamento_condominio_update ON public.reglamento_condominio
  AS PERMISSIVE FOR UPDATE TO authenticated
  USING ((is_super_admin() OR ((company_id = get_my_company_id()) AND ( SELECT (public.condominios_puede_actuar('reglamento', 'edit')) ))))
  WITH CHECK ((is_super_admin() OR ((company_id = get_my_company_id()) AND ( SELECT (public.condominios_puede_actuar('reglamento', 'edit')) ))));

-- ── reglas_notificacion ─────────────────────────────────────────────────────
--   INSERT automatizaciones.create · notificaciones.create
--   UPDATE automatizaciones.edit · notificaciones.edit
--   DELETE automatizaciones.delete · notificaciones.delete
--   Las reglas las administra la pestaña Notificaciones, con sus propias acciones.
DROP POLICY IF EXISTS reglas_notificacion_delete ON public.reglas_notificacion;
CREATE POLICY reglas_notificacion_delete ON public.reglas_notificacion
  AS PERMISSIVE FOR DELETE TO authenticated
  USING ((is_super_admin() OR (( SELECT (public.condominios_puede_actuar('automatizaciones', 'delete') OR public.condominios_puede_actuar('notificaciones', 'delete')) ) AND (company_id = get_my_company_id()))));
DROP POLICY IF EXISTS reglas_notificacion_insert ON public.reglas_notificacion;
CREATE POLICY reglas_notificacion_insert ON public.reglas_notificacion
  AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK ((is_super_admin() OR ((company_id = get_my_company_id()) AND ( SELECT (public.condominios_puede_actuar('automatizaciones', 'create') OR public.condominios_puede_actuar('notificaciones', 'create')) ))));
DROP POLICY IF EXISTS reglas_notificacion_update ON public.reglas_notificacion;
CREATE POLICY reglas_notificacion_update ON public.reglas_notificacion
  AS PERMISSIVE FOR UPDATE TO authenticated
  USING ((is_super_admin() OR ((company_id = get_my_company_id()) AND ( SELECT (public.condominios_puede_actuar('automatizaciones', 'edit') OR public.condominios_puede_actuar('notificaciones', 'edit')) ))))
  WITH CHECK ((is_super_admin() OR ((company_id = get_my_company_id()) AND ( SELECT (public.condominios_puede_actuar('automatizaciones', 'edit') OR public.condominios_puede_actuar('notificaciones', 'edit')) ))));

-- ── vencimientos_extra ──────────────────────────────────────────────────────
--   INSERT vencimientos_criticos.create
--   UPDATE vencimientos_criticos.edit
--   DELETE vencimientos_criticos.delete
DROP POLICY IF EXISTS vencimientos_extra_delete ON public.vencimientos_extra;
CREATE POLICY vencimientos_extra_delete ON public.vencimientos_extra
  AS PERMISSIVE FOR DELETE TO authenticated
  USING ((is_super_admin() OR (( SELECT (public.condominios_puede_actuar('vencimientos_criticos', 'delete')) ) AND (company_id = get_my_company_id()))));
DROP POLICY IF EXISTS vencimientos_extra_insert ON public.vencimientos_extra;
CREATE POLICY vencimientos_extra_insert ON public.vencimientos_extra
  AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK ((is_super_admin() OR ((company_id = get_my_company_id()) AND ( SELECT (public.condominios_puede_actuar('vencimientos_criticos', 'create')) ))));
DROP POLICY IF EXISTS vencimientos_extra_update ON public.vencimientos_extra;
CREATE POLICY vencimientos_extra_update ON public.vencimientos_extra
  AS PERMISSIVE FOR UPDATE TO authenticated
  USING ((is_super_admin() OR ((company_id = get_my_company_id()) AND ( SELECT (public.condominios_puede_actuar('vencimientos_criticos', 'edit')) ))))
  WITH CHECK ((is_super_admin() OR ((company_id = get_my_company_id()) AND ( SELECT (public.condominios_puede_actuar('vencimientos_criticos', 'edit')) )))
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
    ('automatizaciones_cond', 3, 4),
    ('bitacora_acciones', 1, 1),
    ('configuracion_condominio', 3, 3),
    ('documentos_condominio', 3, 3),
    ('firmas_digitales', 3, 3),
    ('flujo_aprobacion_cond', 3, 3),
    ('inspecciones_normativas', 3, 3),
    ('libro_novedades', 3, 3),
    ('memoria_labores', 3, 3),
    ('notas_admin', 3, 3),
    ('novedades_seguridad', 3, 3),
    ('plantillas_mensaje_cond', 3, 3),
    ('polizas_seguro', 3, 3),
    ('propuestas_inversion', 3, 3),
    ('registro_autoridades', 3, 3),
    ('reglamento_condominio', 3, 3),
    ('reglas_notificacion', 3, 3),
    ('vencimientos_extra', 3, 3)
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
