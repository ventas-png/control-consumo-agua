-- ════════════════════════════════════════════════════════════════════════════
-- Finanzas: escribir exige la ACCIÓN del tab, también en la base
--
-- POR QUÉ
-- La pantalla decide cada escritura de estos tabs con su acción (canCreate /
-- canEdit / canDelete). Las policies de INSERT y UPDATE sólo pedían ver el tab
-- —quien sólo consulta podía crear y editar por la API, también cuotas— y las
-- de DELETE sólo dejaban a company_owner/admin, aunque la pantalla ofreciera
-- «Eliminar» a quien tuviera la acción.
--
-- Tabs: Avisos de cobro, Caja chica, Campañas de cobro, Cargos adicionales,
-- Cierres mensuales y anual, Cobranza y cobranza judicial, Convenios, Cuotas,
-- Planes de pago, Fondo de reserva, Generación de cuotas, Historial de saldos,
-- Notificaciones enviadas, Plantillas de cuota, Presupuesto, Proformas,
-- Recargos de mora, Recibos digitales y Tarifas.
--
-- Quedan fuera, para su propio PR, las tablas que también escriben otros
-- módulos con permisos de módulo o de rol: convenios_pago (Cobros),
-- gastos_condominio (Compras) y reglas_mora_config (Facturación).
--
-- QUÉ HACE (generado por scripts/rls-acciones/generar.mjs desde
-- supabase/rls-acciones/finanzas.json; no editar a mano)
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

-- ── avisos_cobro ────────────────────────────────────────────────────────────
--   INSERT avisos_cobro.create
--   UPDATE avisos_cobro.edit
--   DELETE avisos_cobro.delete
DROP POLICY IF EXISTS avisos_cobro_delete ON public.avisos_cobro;
CREATE POLICY avisos_cobro_delete ON public.avisos_cobro
  AS PERMISSIVE FOR DELETE TO authenticated
  USING ((is_super_admin() OR (( SELECT (public.condominios_puede_actuar('avisos_cobro', 'delete')) ) AND (company_id = get_my_company_id()))));
DROP POLICY IF EXISTS avisos_cobro_insert ON public.avisos_cobro;
CREATE POLICY avisos_cobro_insert ON public.avisos_cobro
  AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK ((is_super_admin() OR ((company_id = get_my_company_id()) AND ( SELECT (public.condominios_puede_actuar('avisos_cobro', 'create')) ))));
DROP POLICY IF EXISTS avisos_cobro_update ON public.avisos_cobro;
CREATE POLICY avisos_cobro_update ON public.avisos_cobro
  AS PERMISSIVE FOR UPDATE TO authenticated
  USING ((is_super_admin() OR ((company_id = get_my_company_id()) AND ( SELECT (public.condominios_puede_actuar('avisos_cobro', 'edit')) ))))
  WITH CHECK ((is_super_admin() OR ((company_id = get_my_company_id()) AND ( SELECT (public.condominios_puede_actuar('avisos_cobro', 'edit')) ))));

-- ── caja_chica ──────────────────────────────────────────────────────────────
--   INSERT caja_chica.create
--   UPDATE caja_chica.edit
--   DELETE caja_chica.delete
DROP POLICY IF EXISTS caja_chica_delete ON public.caja_chica;
CREATE POLICY caja_chica_delete ON public.caja_chica
  AS PERMISSIVE FOR DELETE TO authenticated
  USING ((is_super_admin() OR (( SELECT (public.condominios_puede_actuar('caja_chica', 'delete')) ) AND (company_id = get_my_company_id()))));
DROP POLICY IF EXISTS caja_chica_insert ON public.caja_chica;
CREATE POLICY caja_chica_insert ON public.caja_chica
  AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK ((is_super_admin() OR ((company_id = get_my_company_id()) AND ( SELECT (public.condominios_puede_actuar('caja_chica', 'create')) ))));
DROP POLICY IF EXISTS caja_chica_update ON public.caja_chica;
CREATE POLICY caja_chica_update ON public.caja_chica
  AS PERMISSIVE FOR UPDATE TO authenticated
  USING ((is_super_admin() OR ((company_id = get_my_company_id()) AND ( SELECT (public.condominios_puede_actuar('caja_chica', 'edit')) ))))
  WITH CHECK ((is_super_admin() OR ((company_id = get_my_company_id()) AND ( SELECT (public.condominios_puede_actuar('caja_chica', 'edit')) ))));

-- ── campanas_cobro ──────────────────────────────────────────────────────────
--   INSERT campanas_cobro.create
--   UPDATE campanas_cobro.edit
--   DELETE campanas_cobro.delete
DROP POLICY IF EXISTS campanas_cobro_delete ON public.campanas_cobro;
CREATE POLICY campanas_cobro_delete ON public.campanas_cobro
  AS PERMISSIVE FOR DELETE TO authenticated
  USING ((is_super_admin() OR (( SELECT (public.condominios_puede_actuar('campanas_cobro', 'delete')) ) AND (company_id = get_my_company_id()))));
DROP POLICY IF EXISTS campanas_cobro_insert ON public.campanas_cobro;
CREATE POLICY campanas_cobro_insert ON public.campanas_cobro
  AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK ((is_super_admin() OR ((company_id = get_my_company_id()) AND ( SELECT (public.condominios_puede_actuar('campanas_cobro', 'create')) ))));
DROP POLICY IF EXISTS campanas_cobro_update ON public.campanas_cobro;
CREATE POLICY campanas_cobro_update ON public.campanas_cobro
  AS PERMISSIVE FOR UPDATE TO authenticated
  USING ((is_super_admin() OR ((company_id = get_my_company_id()) AND ( SELECT (public.condominios_puede_actuar('campanas_cobro', 'edit')) ))))
  WITH CHECK ((is_super_admin() OR ((company_id = get_my_company_id()) AND ( SELECT (public.condominios_puede_actuar('campanas_cobro', 'edit')) ))));

-- ── cargos_adicionales_unidad ───────────────────────────────────────────────
--   INSERT cargos_adicionales.create
--   UPDATE cargos_adicionales.edit
--   DELETE cargos_adicionales.delete
DROP POLICY IF EXISTS cargos_adicionales_unidad_delete ON public.cargos_adicionales_unidad;
CREATE POLICY cargos_adicionales_unidad_delete ON public.cargos_adicionales_unidad
  AS PERMISSIVE FOR DELETE TO authenticated
  USING ((is_super_admin() OR (( SELECT (public.condominios_puede_actuar('cargos_adicionales', 'delete')) ) AND (company_id = get_my_company_id()))));
DROP POLICY IF EXISTS cargos_adicionales_unidad_insert ON public.cargos_adicionales_unidad;
CREATE POLICY cargos_adicionales_unidad_insert ON public.cargos_adicionales_unidad
  AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK ((is_super_admin() OR ((company_id = get_my_company_id()) AND ( SELECT (public.condominios_puede_actuar('cargos_adicionales', 'create')) ))));
DROP POLICY IF EXISTS cargos_adicionales_unidad_update ON public.cargos_adicionales_unidad;
CREATE POLICY cargos_adicionales_unidad_update ON public.cargos_adicionales_unidad
  AS PERMISSIVE FOR UPDATE TO authenticated
  USING ((is_super_admin() OR ((company_id = get_my_company_id()) AND ( SELECT (public.condominios_puede_actuar('cargos_adicionales', 'edit')) ))))
  WITH CHECK ((is_super_admin() OR ((company_id = get_my_company_id()) AND ( SELECT (public.condominios_puede_actuar('cargos_adicionales', 'edit')) ))));

-- ── cierres_anuales ─────────────────────────────────────────────────────────
--   INSERT cierre_anual.create
--   UPDATE cierre_anual.edit · cierre_anual.create
--   DELETE cierre_anual.delete
--   «Generar cierre» (canCreate) es un upsert por (proyecto, año): regenerar un año actualiza su fila.
DROP POLICY IF EXISTS cierres_anuales_delete ON public.cierres_anuales;
CREATE POLICY cierres_anuales_delete ON public.cierres_anuales
  AS PERMISSIVE FOR DELETE TO authenticated
  USING ((is_super_admin() OR (( SELECT (public.condominios_puede_actuar('cierre_anual', 'delete')) ) AND (company_id = get_my_company_id()))));
DROP POLICY IF EXISTS cierres_anuales_insert ON public.cierres_anuales;
CREATE POLICY cierres_anuales_insert ON public.cierres_anuales
  AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK ((is_super_admin() OR ((company_id = get_my_company_id()) AND ( SELECT (public.condominios_puede_actuar('cierre_anual', 'create')) ))));
DROP POLICY IF EXISTS cierres_anuales_update ON public.cierres_anuales;
CREATE POLICY cierres_anuales_update ON public.cierres_anuales
  AS PERMISSIVE FOR UPDATE TO authenticated
  USING ((is_super_admin() OR ((company_id = get_my_company_id()) AND ( SELECT (public.condominios_puede_actuar('cierre_anual', 'edit') OR public.condominios_puede_actuar('cierre_anual', 'create')) ))))
  WITH CHECK ((is_super_admin() OR ((company_id = get_my_company_id()) AND ( SELECT (public.condominios_puede_actuar('cierre_anual', 'edit') OR public.condominios_puede_actuar('cierre_anual', 'create')) ))));

-- ── cierres_mensuales ───────────────────────────────────────────────────────
--   INSERT cierres.create
--   UPDATE cierres.edit
--   DELETE cierres.delete
DROP POLICY IF EXISTS cierres_mensuales_delete ON public.cierres_mensuales;
CREATE POLICY cierres_mensuales_delete ON public.cierres_mensuales
  AS PERMISSIVE FOR DELETE TO authenticated
  USING ((is_super_admin() OR (( SELECT (public.condominios_puede_actuar('cierres', 'delete')) ) AND (company_id = get_my_company_id()))));
DROP POLICY IF EXISTS cierres_mensuales_insert ON public.cierres_mensuales;
CREATE POLICY cierres_mensuales_insert ON public.cierres_mensuales
  AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK ((is_super_admin() OR ((company_id = get_my_company_id()) AND ( SELECT (public.condominios_puede_actuar('cierres', 'create')) ))));
DROP POLICY IF EXISTS cierres_mensuales_update ON public.cierres_mensuales;
CREATE POLICY cierres_mensuales_update ON public.cierres_mensuales
  AS PERMISSIVE FOR UPDATE TO authenticated
  USING ((is_super_admin() OR ((company_id = get_my_company_id()) AND ( SELECT (public.condominios_puede_actuar('cierres', 'edit')) ))))
  WITH CHECK ((is_super_admin() OR ((company_id = get_my_company_id()) AND ( SELECT (public.condominios_puede_actuar('cierres', 'edit')) ))));

-- ── cobranza_judicial ───────────────────────────────────────────────────────
--   INSERT cobranza_judicial.create
--   UPDATE cobranza_judicial.edit
--   DELETE cobranza_judicial.delete
DROP POLICY IF EXISTS cobranza_judicial_delete ON public.cobranza_judicial;
CREATE POLICY cobranza_judicial_delete ON public.cobranza_judicial
  AS PERMISSIVE FOR DELETE TO authenticated
  USING ((is_super_admin() OR (( SELECT (public.condominios_puede_actuar('cobranza_judicial', 'delete')) ) AND (company_id = get_my_company_id()))));
DROP POLICY IF EXISTS cobranza_judicial_insert ON public.cobranza_judicial;
CREATE POLICY cobranza_judicial_insert ON public.cobranza_judicial
  AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK ((is_super_admin() OR ((company_id = get_my_company_id()) AND ( SELECT (public.condominios_puede_actuar('cobranza_judicial', 'create')) ))));
DROP POLICY IF EXISTS cobranza_judicial_update ON public.cobranza_judicial;
CREATE POLICY cobranza_judicial_update ON public.cobranza_judicial
  AS PERMISSIVE FOR UPDATE TO authenticated
  USING ((is_super_admin() OR ((company_id = get_my_company_id()) AND ( SELECT (public.condominios_puede_actuar('cobranza_judicial', 'edit')) ))))
  WITH CHECK ((is_super_admin() OR ((company_id = get_my_company_id()) AND ( SELECT (public.condominios_puede_actuar('cobranza_judicial', 'edit')) ))));

-- ── convenios_cuota_cond ────────────────────────────────────────────────────
--   INSERT convenios_cuota.create
--   UPDATE convenios_cuota.edit
--   DELETE convenios_cuota.delete
DROP POLICY IF EXISTS convenios_cuota_cond_delete ON public.convenios_cuota_cond;
CREATE POLICY convenios_cuota_cond_delete ON public.convenios_cuota_cond
  AS PERMISSIVE FOR DELETE TO authenticated
  USING ((is_super_admin() OR (( SELECT (public.condominios_puede_actuar('convenios_cuota', 'delete')) ) AND (company_id = get_my_company_id()))));
DROP POLICY IF EXISTS convenios_cuota_cond_insert ON public.convenios_cuota_cond;
CREATE POLICY convenios_cuota_cond_insert ON public.convenios_cuota_cond
  AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK ((is_super_admin() OR ((company_id = get_my_company_id()) AND ( SELECT (public.condominios_puede_actuar('convenios_cuota', 'create')) ))));
DROP POLICY IF EXISTS convenios_cuota_cond_update ON public.convenios_cuota_cond;
CREATE POLICY convenios_cuota_cond_update ON public.convenios_cuota_cond
  AS PERMISSIVE FOR UPDATE TO authenticated
  USING ((is_super_admin() OR ((company_id = get_my_company_id()) AND ( SELECT (public.condominios_puede_actuar('convenios_cuota', 'edit')) ))))
  WITH CHECK ((is_super_admin() OR ((company_id = get_my_company_id()) AND ( SELECT (public.condominios_puede_actuar('convenios_cuota', 'edit')) ))));

-- ── cuotas_condominio ───────────────────────────────────────────────────────
--   INSERT cuotas.create · generacion_cuotas.create · integracion_agua.create · plantillas_cuota.create · amenidades.create · amenidades.edit
--   UPDATE cuotas.edit · cuotas.delete · recargos_mora.create · conciliacion_cobros.create · estadocuenta.edit · automatizaciones.edit
--   DELETE cuotas.delete
--   Eliminar una cuota es una baja lógica (UPDATE de deleted_at) que la pantalla ofrece con canDelete.
--   Crean cuotas el generador, la integración con agua, las plantillas y Amenidades (la tarifa al
--   reservar con canCreate; el depósito retenido y la aprobación con canEdit). Las editan el recargo
--   masivo (marca la mora aplicada), la conciliación, el estado de cuenta y las automatizaciones.
DROP POLICY IF EXISTS cuotas_condominio_delete ON public.cuotas_condominio;
CREATE POLICY cuotas_condominio_delete ON public.cuotas_condominio
  AS PERMISSIVE FOR DELETE TO authenticated
  USING ((is_super_admin() OR (( SELECT (public.condominios_puede_actuar('cuotas', 'delete')) ) AND (company_id = get_my_company_id()))));
DROP POLICY IF EXISTS cuotas_condominio_insert ON public.cuotas_condominio;
CREATE POLICY cuotas_condominio_insert ON public.cuotas_condominio
  AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK ((is_super_admin() OR ((company_id = get_my_company_id()) AND ( SELECT (public.condominios_puede_actuar('cuotas', 'create') OR public.condominios_puede_actuar('generacion_cuotas', 'create') OR public.condominios_puede_actuar('integracion_agua', 'create') OR public.condominios_puede_actuar('plantillas_cuota', 'create') OR public.condominios_puede_actuar('amenidades', 'create') OR public.condominios_puede_actuar('amenidades', 'edit')) ))));
DROP POLICY IF EXISTS cuotas_condominio_update ON public.cuotas_condominio;
CREATE POLICY cuotas_condominio_update ON public.cuotas_condominio
  AS PERMISSIVE FOR UPDATE TO authenticated
  USING ((is_super_admin() OR ((company_id = get_my_company_id()) AND ( SELECT (public.condominios_puede_actuar('cuotas', 'edit') OR public.condominios_puede_actuar('cuotas', 'delete') OR public.condominios_puede_actuar('recargos_mora', 'create') OR public.condominios_puede_actuar('conciliacion_cobros', 'create') OR public.condominios_puede_actuar('estadocuenta', 'edit') OR public.condominios_puede_actuar('automatizaciones', 'edit')) ))))
  WITH CHECK ((is_super_admin() OR ((company_id = get_my_company_id()) AND ( SELECT (public.condominios_puede_actuar('cuotas', 'edit') OR public.condominios_puede_actuar('cuotas', 'delete') OR public.condominios_puede_actuar('recargos_mora', 'create') OR public.condominios_puede_actuar('conciliacion_cobros', 'create') OR public.condominios_puede_actuar('estadocuenta', 'edit') OR public.condominios_puede_actuar('automatizaciones', 'edit')) ))));

-- ── cuotas_plan_pago ────────────────────────────────────────────────────────
--   INSERT plan_pago.create
--   UPDATE plan_pago.edit
--   DELETE plan_pago.delete
DROP POLICY IF EXISTS cuotas_plan_pago_delete ON public.cuotas_plan_pago;
CREATE POLICY cuotas_plan_pago_delete ON public.cuotas_plan_pago
  AS PERMISSIVE FOR DELETE TO authenticated
  USING ((is_super_admin() OR (( SELECT (public.condominios_puede_actuar('plan_pago', 'delete')) ) AND (company_id = get_my_company_id()))));
DROP POLICY IF EXISTS cuotas_plan_pago_insert ON public.cuotas_plan_pago;
CREATE POLICY cuotas_plan_pago_insert ON public.cuotas_plan_pago
  AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK ((is_super_admin() OR ((company_id = get_my_company_id()) AND ( SELECT (public.condominios_puede_actuar('plan_pago', 'create')) ))));
DROP POLICY IF EXISTS cuotas_plan_pago_update ON public.cuotas_plan_pago;
CREATE POLICY cuotas_plan_pago_update ON public.cuotas_plan_pago
  AS PERMISSIVE FOR UPDATE TO authenticated
  USING ((is_super_admin() OR ((company_id = get_my_company_id()) AND ( SELECT (public.condominios_puede_actuar('plan_pago', 'edit')) ))))
  WITH CHECK ((is_super_admin() OR ((company_id = get_my_company_id()) AND ( SELECT (public.condominios_puede_actuar('plan_pago', 'edit')) ))));

-- ── fondo_reserva ───────────────────────────────────────────────────────────
--   INSERT fondo_reserva.create · gestion_fondo.create
--   UPDATE fondo_reserva.edit
--   DELETE fondo_reserva.delete
--   Los movimientos los registra Gestión del fondo con canCreate('gestion_fondo').
DROP POLICY IF EXISTS fondo_reserva_delete ON public.fondo_reserva;
CREATE POLICY fondo_reserva_delete ON public.fondo_reserva
  AS PERMISSIVE FOR DELETE TO authenticated
  USING ((is_super_admin() OR (( SELECT (public.condominios_puede_actuar('fondo_reserva', 'delete')) ) AND (company_id = get_my_company_id()))));
DROP POLICY IF EXISTS fondo_reserva_insert ON public.fondo_reserva;
CREATE POLICY fondo_reserva_insert ON public.fondo_reserva
  AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK ((is_super_admin() OR ((company_id = get_my_company_id()) AND ( SELECT (public.condominios_puede_actuar('fondo_reserva', 'create') OR public.condominios_puede_actuar('gestion_fondo', 'create')) ))));
DROP POLICY IF EXISTS fondo_reserva_update ON public.fondo_reserva;
CREATE POLICY fondo_reserva_update ON public.fondo_reserva
  AS PERMISSIVE FOR UPDATE TO authenticated
  USING ((is_super_admin() OR ((company_id = get_my_company_id()) AND ( SELECT (public.condominios_puede_actuar('fondo_reserva', 'edit')) ))))
  WITH CHECK ((is_super_admin() OR ((company_id = get_my_company_id()) AND ( SELECT (public.condominios_puede_actuar('fondo_reserva', 'edit')) ))));

-- ── fondo_reserva_condominio ────────────────────────────────────────────────
--   INSERT fondo_reserva.create
--   UPDATE fondo_reserva.edit · fondo_reserva.delete
--   DELETE fondo_reserva.delete
--   Eliminar un movimiento es una baja lógica (UPDATE de deleted_at) que la pantalla ofrece con canDelete.
DROP POLICY IF EXISTS fondo_reserva_condominio_delete ON public.fondo_reserva_condominio;
CREATE POLICY fondo_reserva_condominio_delete ON public.fondo_reserva_condominio
  AS PERMISSIVE FOR DELETE TO authenticated
  USING ((is_super_admin() OR (( SELECT (public.condominios_puede_actuar('fondo_reserva', 'delete')) ) AND (company_id = get_my_company_id()))));
DROP POLICY IF EXISTS fondo_reserva_condominio_insert ON public.fondo_reserva_condominio;
CREATE POLICY fondo_reserva_condominio_insert ON public.fondo_reserva_condominio
  AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK ((is_super_admin() OR ((company_id = get_my_company_id()) AND ( SELECT (public.condominios_puede_actuar('fondo_reserva', 'create')) ))));
DROP POLICY IF EXISTS fondo_reserva_condominio_update ON public.fondo_reserva_condominio;
CREATE POLICY fondo_reserva_condominio_update ON public.fondo_reserva_condominio
  AS PERMISSIVE FOR UPDATE TO authenticated
  USING ((is_super_admin() OR ((company_id = get_my_company_id()) AND ( SELECT (public.condominios_puede_actuar('fondo_reserva', 'edit') OR public.condominios_puede_actuar('fondo_reserva', 'delete')) ))))
  WITH CHECK ((is_super_admin() OR ((company_id = get_my_company_id()) AND ( SELECT (public.condominios_puede_actuar('fondo_reserva', 'edit') OR public.condominios_puede_actuar('fondo_reserva', 'delete')) ))));

-- ── generacion_cuotas_log ───────────────────────────────────────────────────
--   INSERT generacion_cuotas.create
--   UPDATE generacion_cuotas.edit
--   DELETE generacion_cuotas.delete
DROP POLICY IF EXISTS generacion_cuotas_log_delete ON public.generacion_cuotas_log;
CREATE POLICY generacion_cuotas_log_delete ON public.generacion_cuotas_log
  AS PERMISSIVE FOR DELETE TO authenticated
  USING ((is_super_admin() OR (( SELECT (public.condominios_puede_actuar('generacion_cuotas', 'delete')) ) AND (company_id = get_my_company_id()))));
DROP POLICY IF EXISTS generacion_cuotas_log_insert ON public.generacion_cuotas_log;
CREATE POLICY generacion_cuotas_log_insert ON public.generacion_cuotas_log
  AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK ((is_super_admin() OR ((company_id = get_my_company_id()) AND ( SELECT (public.condominios_puede_actuar('generacion_cuotas', 'create')) ))));
DROP POLICY IF EXISTS generacion_cuotas_log_update ON public.generacion_cuotas_log;
CREATE POLICY generacion_cuotas_log_update ON public.generacion_cuotas_log
  AS PERMISSIVE FOR UPDATE TO authenticated
  USING ((is_super_admin() OR ((company_id = get_my_company_id()) AND ( SELECT (public.condominios_puede_actuar('generacion_cuotas', 'edit')) ))))
  WITH CHECK ((is_super_admin() OR ((company_id = get_my_company_id()) AND ( SELECT (public.condominios_puede_actuar('generacion_cuotas', 'edit')) ))));

-- ── gestion_cobranza ────────────────────────────────────────────────────────
--   INSERT cobranza.create
--   UPDATE cobranza.edit
--   DELETE cobranza.delete
DROP POLICY IF EXISTS gestion_cobranza_delete ON public.gestion_cobranza;
CREATE POLICY gestion_cobranza_delete ON public.gestion_cobranza
  AS PERMISSIVE FOR DELETE TO authenticated
  USING ((is_super_admin() OR (( SELECT (public.condominios_puede_actuar('cobranza', 'delete')) ) AND (company_id = get_my_company_id()))));
DROP POLICY IF EXISTS gestion_cobranza_insert ON public.gestion_cobranza;
CREATE POLICY gestion_cobranza_insert ON public.gestion_cobranza
  AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK ((is_super_admin() OR ((company_id = get_my_company_id()) AND ( SELECT (public.condominios_puede_actuar('cobranza', 'create')) ))));
DROP POLICY IF EXISTS gestion_cobranza_update ON public.gestion_cobranza;
CREATE POLICY gestion_cobranza_update ON public.gestion_cobranza
  AS PERMISSIVE FOR UPDATE TO authenticated
  USING ((is_super_admin() OR ((company_id = get_my_company_id()) AND ( SELECT (public.condominios_puede_actuar('cobranza', 'edit')) ))))
  WITH CHECK ((is_super_admin() OR ((company_id = get_my_company_id()) AND ( SELECT (public.condominios_puede_actuar('cobranza', 'edit')) ))));

-- ── historial_saldos_unidad ─────────────────────────────────────────────────
--   INSERT historial_saldos.create
--   UPDATE historial_saldos.edit · historial_saldos.create
--   DELETE historial_saldos.delete
--   «Generar snapshot» (canCreate) es un upsert por (proyecto, unidad, periodo): repetir un periodo actualiza sus filas.
DROP POLICY IF EXISTS historial_saldos_unidad_delete ON public.historial_saldos_unidad;
CREATE POLICY historial_saldos_unidad_delete ON public.historial_saldos_unidad
  AS PERMISSIVE FOR DELETE TO authenticated
  USING ((is_super_admin() OR (( SELECT (public.condominios_puede_actuar('historial_saldos', 'delete')) ) AND (company_id = get_my_company_id()))));
DROP POLICY IF EXISTS historial_saldos_unidad_insert ON public.historial_saldos_unidad;
CREATE POLICY historial_saldos_unidad_insert ON public.historial_saldos_unidad
  AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK ((is_super_admin() OR ((company_id = get_my_company_id()) AND ( SELECT (public.condominios_puede_actuar('historial_saldos', 'create')) ))));
DROP POLICY IF EXISTS historial_saldos_unidad_update ON public.historial_saldos_unidad;
CREATE POLICY historial_saldos_unidad_update ON public.historial_saldos_unidad
  AS PERMISSIVE FOR UPDATE TO authenticated
  USING ((is_super_admin() OR ((company_id = get_my_company_id()) AND ( SELECT (public.condominios_puede_actuar('historial_saldos', 'edit') OR public.condominios_puede_actuar('historial_saldos', 'create')) ))))
  WITH CHECK ((is_super_admin() OR ((company_id = get_my_company_id()) AND ( SELECT (public.condominios_puede_actuar('historial_saldos', 'edit') OR public.condominios_puede_actuar('historial_saldos', 'create')) ))));

-- ── movimientos_caja ────────────────────────────────────────────────────────
--   INSERT caja_chica.create
--   UPDATE sin policy: nadie (no se crea)
--   DELETE caja_chica.delete
DROP POLICY IF EXISTS movimientos_caja_delete ON public.movimientos_caja;
CREATE POLICY movimientos_caja_delete ON public.movimientos_caja
  AS PERMISSIVE FOR DELETE TO authenticated
  USING ((is_super_admin() OR (( SELECT (public.condominios_puede_actuar('caja_chica', 'delete')) ) AND (company_id = get_my_company_id()))));
DROP POLICY IF EXISTS movimientos_caja_insert ON public.movimientos_caja;
CREATE POLICY movimientos_caja_insert ON public.movimientos_caja
  AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK ((is_super_admin() OR ((company_id = get_my_company_id()) AND ( SELECT (public.condominios_puede_actuar('caja_chica', 'create')) ))));

-- ── notificaciones_enviadas ─────────────────────────────────────────────────
--   INSERT notificaciones_enviadas.create · envio_masivo.create
--   UPDATE notificaciones_enviadas.edit
--   DELETE notificaciones_enviadas.delete
--   El registro de cada envío lo crea Envío masivo, con canCreate('envio_masivo').
DROP POLICY IF EXISTS notificaciones_enviadas_delete ON public.notificaciones_enviadas;
CREATE POLICY notificaciones_enviadas_delete ON public.notificaciones_enviadas
  AS PERMISSIVE FOR DELETE TO authenticated
  USING ((is_super_admin() OR (( SELECT (public.condominios_puede_actuar('notificaciones_enviadas', 'delete')) ) AND (company_id = get_my_company_id()))));
DROP POLICY IF EXISTS notificaciones_enviadas_insert ON public.notificaciones_enviadas;
CREATE POLICY notificaciones_enviadas_insert ON public.notificaciones_enviadas
  AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK ((is_super_admin() OR ((company_id = get_my_company_id()) AND ( SELECT (public.condominios_puede_actuar('notificaciones_enviadas', 'create') OR public.condominios_puede_actuar('envio_masivo', 'create')) ))));
DROP POLICY IF EXISTS notificaciones_enviadas_update ON public.notificaciones_enviadas;
CREATE POLICY notificaciones_enviadas_update ON public.notificaciones_enviadas
  AS PERMISSIVE FOR UPDATE TO authenticated
  USING ((is_super_admin() OR ((company_id = get_my_company_id()) AND ( SELECT (public.condominios_puede_actuar('notificaciones_enviadas', 'edit')) ))))
  WITH CHECK ((is_super_admin() OR ((company_id = get_my_company_id()) AND ( SELECT (public.condominios_puede_actuar('notificaciones_enviadas', 'edit')) ))));

-- ── planes_pago_condominio ──────────────────────────────────────────────────
--   INSERT plan_pago.create
--   UPDATE plan_pago.edit
--   DELETE plan_pago.delete
DROP POLICY IF EXISTS planes_pago_condominio_delete ON public.planes_pago_condominio;
CREATE POLICY planes_pago_condominio_delete ON public.planes_pago_condominio
  AS PERMISSIVE FOR DELETE TO authenticated
  USING ((is_super_admin() OR (( SELECT (public.condominios_puede_actuar('plan_pago', 'delete')) ) AND (company_id = get_my_company_id()))));
DROP POLICY IF EXISTS planes_pago_condominio_insert ON public.planes_pago_condominio;
CREATE POLICY planes_pago_condominio_insert ON public.planes_pago_condominio
  AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK ((is_super_admin() OR ((company_id = get_my_company_id()) AND ( SELECT (public.condominios_puede_actuar('plan_pago', 'create')) ))));
DROP POLICY IF EXISTS planes_pago_condominio_update ON public.planes_pago_condominio;
CREATE POLICY planes_pago_condominio_update ON public.planes_pago_condominio
  AS PERMISSIVE FOR UPDATE TO authenticated
  USING ((is_super_admin() OR ((company_id = get_my_company_id()) AND ( SELECT (public.condominios_puede_actuar('plan_pago', 'edit')) ))))
  WITH CHECK ((is_super_admin() OR ((company_id = get_my_company_id()) AND ( SELECT (public.condominios_puede_actuar('plan_pago', 'edit')) ))));

-- ── plantillas_cuota ────────────────────────────────────────────────────────
--   INSERT plantillas_cuota.create
--   UPDATE plantillas_cuota.edit
--   DELETE plantillas_cuota.delete
DROP POLICY IF EXISTS plantillas_cuota_delete ON public.plantillas_cuota;
CREATE POLICY plantillas_cuota_delete ON public.plantillas_cuota
  AS PERMISSIVE FOR DELETE TO authenticated
  USING ((is_super_admin() OR (( SELECT (public.condominios_puede_actuar('plantillas_cuota', 'delete')) ) AND (company_id = get_my_company_id()))));
DROP POLICY IF EXISTS plantillas_cuota_insert ON public.plantillas_cuota;
CREATE POLICY plantillas_cuota_insert ON public.plantillas_cuota
  AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK ((is_super_admin() OR ((company_id = get_my_company_id()) AND ( SELECT (public.condominios_puede_actuar('plantillas_cuota', 'create')) ))));
DROP POLICY IF EXISTS plantillas_cuota_update ON public.plantillas_cuota;
CREATE POLICY plantillas_cuota_update ON public.plantillas_cuota
  AS PERMISSIVE FOR UPDATE TO authenticated
  USING ((is_super_admin() OR ((company_id = get_my_company_id()) AND ( SELECT (public.condominios_puede_actuar('plantillas_cuota', 'edit')) ))))
  WITH CHECK ((is_super_admin() OR ((company_id = get_my_company_id()) AND ( SELECT (public.condominios_puede_actuar('plantillas_cuota', 'edit')) ))));

-- ── presupuesto_condominio ──────────────────────────────────────────────────
--   INSERT presupuesto.create
--   UPDATE presupuesto.edit
--   DELETE presupuesto.delete
DROP POLICY IF EXISTS presupuesto_condominio_delete ON public.presupuesto_condominio;
CREATE POLICY presupuesto_condominio_delete ON public.presupuesto_condominio
  AS PERMISSIVE FOR DELETE TO authenticated
  USING ((is_super_admin() OR (( SELECT (public.condominios_puede_actuar('presupuesto', 'delete')) ) AND (company_id = get_my_company_id()))));
DROP POLICY IF EXISTS presupuesto_condominio_insert ON public.presupuesto_condominio;
CREATE POLICY presupuesto_condominio_insert ON public.presupuesto_condominio
  AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK ((is_super_admin() OR ((company_id = get_my_company_id()) AND ( SELECT (public.condominios_puede_actuar('presupuesto', 'create')) ))));
DROP POLICY IF EXISTS presupuesto_condominio_update ON public.presupuesto_condominio;
CREATE POLICY presupuesto_condominio_update ON public.presupuesto_condominio
  AS PERMISSIVE FOR UPDATE TO authenticated
  USING ((is_super_admin() OR ((company_id = get_my_company_id()) AND ( SELECT (public.condominios_puede_actuar('presupuesto', 'edit')) ))))
  WITH CHECK ((is_super_admin() OR ((company_id = get_my_company_id()) AND ( SELECT (public.condominios_puede_actuar('presupuesto', 'edit')) ))));

-- ── proformas_condominio ────────────────────────────────────────────────────
--   INSERT proformas.create
--   UPDATE proformas.edit
--   DELETE proformas.delete
DROP POLICY IF EXISTS proformas_condominio_delete ON public.proformas_condominio;
CREATE POLICY proformas_condominio_delete ON public.proformas_condominio
  AS PERMISSIVE FOR DELETE TO authenticated
  USING ((is_super_admin() OR (( SELECT (public.condominios_puede_actuar('proformas', 'delete')) ) AND (company_id = get_my_company_id()))));
DROP POLICY IF EXISTS proformas_condominio_insert ON public.proformas_condominio;
CREATE POLICY proformas_condominio_insert ON public.proformas_condominio
  AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK ((is_super_admin() OR ((company_id = get_my_company_id()) AND ( SELECT (public.condominios_puede_actuar('proformas', 'create')) ))));
DROP POLICY IF EXISTS proformas_condominio_update ON public.proformas_condominio;
CREATE POLICY proformas_condominio_update ON public.proformas_condominio
  AS PERMISSIVE FOR UPDATE TO authenticated
  USING ((is_super_admin() OR ((company_id = get_my_company_id()) AND ( SELECT (public.condominios_puede_actuar('proformas', 'edit')) ))))
  WITH CHECK ((is_super_admin() OR ((company_id = get_my_company_id()) AND ( SELECT (public.condominios_puede_actuar('proformas', 'edit')) ))));

-- ── recargos_mora ───────────────────────────────────────────────────────────
--   INSERT recargos_mora.create
--   UPDATE recargos_mora.edit
--   DELETE recargos_mora.delete
DROP POLICY IF EXISTS recargos_mora_delete ON public.recargos_mora;
CREATE POLICY recargos_mora_delete ON public.recargos_mora
  AS PERMISSIVE FOR DELETE TO authenticated
  USING ((is_super_admin() OR (( SELECT (public.condominios_puede_actuar('recargos_mora', 'delete')) ) AND (company_id = get_my_company_id()))));
DROP POLICY IF EXISTS recargos_mora_insert ON public.recargos_mora;
CREATE POLICY recargos_mora_insert ON public.recargos_mora
  AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK ((is_super_admin() OR ((company_id = get_my_company_id()) AND ( SELECT (public.condominios_puede_actuar('recargos_mora', 'create')) ))));
DROP POLICY IF EXISTS recargos_mora_update ON public.recargos_mora;
CREATE POLICY recargos_mora_update ON public.recargos_mora
  AS PERMISSIVE FOR UPDATE TO authenticated
  USING ((is_super_admin() OR ((company_id = get_my_company_id()) AND ( SELECT (public.condominios_puede_actuar('recargos_mora', 'edit')) ))))
  WITH CHECK ((is_super_admin() OR ((company_id = get_my_company_id()) AND ( SELECT (public.condominios_puede_actuar('recargos_mora', 'edit')) ))));

-- ── recibos_digitales ───────────────────────────────────────────────────────
--   INSERT recibos_digitales.create · cuotas.create
--   UPDATE recibos_digitales.edit
--   DELETE recibos_digitales.delete
--   Cuotas crea el recibo de una cuota pagada con canCreate('cuotas').
DROP POLICY IF EXISTS recibos_digitales_delete ON public.recibos_digitales;
CREATE POLICY recibos_digitales_delete ON public.recibos_digitales
  AS PERMISSIVE FOR DELETE TO authenticated
  USING ((is_super_admin() OR (( SELECT (public.condominios_puede_actuar('recibos_digitales', 'delete')) ) AND (company_id = get_my_company_id()))));
DROP POLICY IF EXISTS recibos_digitales_insert ON public.recibos_digitales;
CREATE POLICY recibos_digitales_insert ON public.recibos_digitales
  AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK ((is_super_admin() OR ((company_id = get_my_company_id()) AND ( SELECT (public.condominios_puede_actuar('recibos_digitales', 'create') OR public.condominios_puede_actuar('cuotas', 'create')) ))));
DROP POLICY IF EXISTS recibos_digitales_update ON public.recibos_digitales;
CREATE POLICY recibos_digitales_update ON public.recibos_digitales
  AS PERMISSIVE FOR UPDATE TO authenticated
  USING ((is_super_admin() OR ((company_id = get_my_company_id()) AND ( SELECT (public.condominios_puede_actuar('recibos_digitales', 'edit')) ))))
  WITH CHECK ((is_super_admin() OR ((company_id = get_my_company_id()) AND ( SELECT (public.condominios_puede_actuar('recibos_digitales', 'edit')) ))));

-- ── tarifas_condominio ──────────────────────────────────────────────────────
--   INSERT tarifas.create
--   UPDATE tarifas.edit
--   DELETE tarifas.delete
DROP POLICY IF EXISTS tarifas_condominio_delete ON public.tarifas_condominio;
CREATE POLICY tarifas_condominio_delete ON public.tarifas_condominio
  AS PERMISSIVE FOR DELETE TO authenticated
  USING ((is_super_admin() OR (( SELECT (public.condominios_puede_actuar('tarifas', 'delete')) ) AND (company_id = get_my_company_id()))));
DROP POLICY IF EXISTS tarifas_condominio_insert ON public.tarifas_condominio;
CREATE POLICY tarifas_condominio_insert ON public.tarifas_condominio
  AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK ((is_super_admin() OR ((company_id = get_my_company_id()) AND ( SELECT (public.condominios_puede_actuar('tarifas', 'create')) ))));
DROP POLICY IF EXISTS tarifas_condominio_update ON public.tarifas_condominio;
CREATE POLICY tarifas_condominio_update ON public.tarifas_condominio
  AS PERMISSIVE FOR UPDATE TO authenticated
  USING ((is_super_admin() OR ((company_id = get_my_company_id()) AND ( SELECT (public.condominios_puede_actuar('tarifas', 'edit')) ))))
  WITH CHECK ((is_super_admin() OR ((company_id = get_my_company_id()) AND ( SELECT (public.condominios_puede_actuar('tarifas', 'edit')) )))
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
    ('avisos_cobro', 3, 3),
    ('caja_chica', 3, 3),
    ('campanas_cobro', 3, 3),
    ('cargos_adicionales_unidad', 3, 3),
    ('cierres_anuales', 3, 3),
    ('cierres_mensuales', 3, 3),
    ('cobranza_judicial', 3, 4),
    ('convenios_cuota_cond', 3, 3),
    ('cuotas_condominio', 3, 4),
    ('cuotas_plan_pago', 3, 3),
    ('fondo_reserva', 3, 3),
    ('fondo_reserva_condominio', 3, 3),
    ('generacion_cuotas_log', 3, 3),
    ('gestion_cobranza', 3, 3),
    ('historial_saldos_unidad', 3, 3),
    ('movimientos_caja', 2, 2),
    ('notificaciones_enviadas', 3, 3),
    ('planes_pago_condominio', 3, 3),
    ('plantillas_cuota', 3, 3),
    ('presupuesto_condominio', 3, 3),
    ('proformas_condominio', 3, 3),
    ('recargos_mora', 3, 3),
    ('recibos_digitales', 3, 3),
    ('tarifas_condominio', 3, 3)
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
