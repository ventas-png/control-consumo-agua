-- Portal propietario vs inquilino — FASE 2 · batch 4 (P1 · condominios).
--
-- Repunta 23 policies SELECT del residente al helper `mis_unidades_ids()`. Todas la
-- MISMA estructura de 3 ramas (verificado: num_or=2 / staff is_super_admin+permiso /
-- residente por unidad_id forma join unidades⋈app_users), por lo que se reconstruyen
-- desde el mismo template con su permission key. El subquery del residente (join) es
-- igual a mis_unidades_ids() → behavior-preserving; solo cambia esa rama.
--
-- Se usa el MISMO bloque DO que se validó contra prod (BEGIN…ROLLBACK): resultado
-- total_policies=23, con_helper=23, con_app_users=0, con_project_id=0, con_staff=23,
-- exactamente un <tabla>_select por tabla (sin duplicados). Reusar el artefacto
-- validado evita reintroducir errores de transcripción.
--
-- Progreso fase 2: 42/~44. Pendientes (batches/diseño aparte): amenidades/
-- amenidades_bloqueos (scoping por project_id → helper de proyectos), solicitud_
-- mudanza/renta_unidad (5 ramas), mensajes_portal + config_condominio (staff
-- distinto), y agua (registros/contadores).

DO $do$
DECLARE r record;
DECLARE keys jsonb := '{
  "accesos_residentes":"condominios.tab.accesos_res","convenios_cuota_cond":"condominios.tab.convenios_cuota",
  "entrega_unidades":"condominios.tab.entrega_unidad","firmas_digitales":"condominios.tab.firmas",
  "historial_residentes":"condominios.tab.directorio","historial_saldos_unidad":"condominios.tab.historial_saldos",
  "lecturas_medidor_gas":"condominios.tab.gas","medidores_unidad":"condominios.tab.medidores_unidad",
  "notificaciones_enviadas":"condominios.tab.notificaciones_enviadas","onboarding_residentes":"condominios.tab.onboarding",
  "parqueos_condominio":"condominios.tab.parqueos","permisos_obra_unidad":"condominios.tab.permisos_obra",
  "planes_pago_condominio":"condominios.tab.plan_pago","prestamos_equipo":"condominios.tab.prestamos",
  "recargos_mora":"condominios.tab.recargos_mora","registro_asistentes_evento":"condominios.tab.eventos_comunidad",
  "respuestas_encuesta":"condominios.tab.encuestas","servicios_housekeeping":"condominios.tab.housekeeping",
  "solicitudes_certificado":"condominios.tab.certificados","solicitudes_concierge":"condominios.tab.concierge",
  "solicitudes_residente":"condominios.tab.solicitudes","vehiculos_residentes":"condominios.tab.vehiculos",
  "visitas_frecuentes":"condominios.tab.vis_frecuentes"}'::jsonb;
BEGIN
  FOR r IN SELECT key AS tbl, value AS pkey FROM jsonb_each_text(keys) LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', r.tbl||'_select', r.tbl);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR SELECT TO authenticated USING (is_super_admin() OR ((company_id = get_my_company_id()) AND user_has_permission(%L)) OR (unidad_id IN (SELECT public.mis_unidades_ids())))', r.tbl||'_select', r.tbl, r.pkey);
  END LOOP;
END $do$;
