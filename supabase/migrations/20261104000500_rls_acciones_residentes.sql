-- ════════════════════════════════════════════════════════════════════════════
-- Residentes: escribir exige la ACCIÓN del tab, también en la base
--
-- POR QUÉ
-- La pantalla decide cada escritura de estos tabs con su acción (canCreate /
-- canEdit / canApprove / canDelete). Las policies de INSERT y UPDATE sólo
-- pedían ver el tab —quien sólo consulta podía crear y editar por la API— y
-- las de DELETE sólo dejaban a company_owner/admin, aunque la pantalla
-- ofreciera «Eliminar» a quien tuviera la acción. Las ramas del residente
-- (solicitar una mudanza desde el portal) no cambian.
--
-- Tabs: Accesos de residentes, Entrega de unidades, Directorio (historial),
-- Manual del residente, Mascotas, Onboarding, Solicitudes de mudanza y de
-- renta, Certificados, Solicitudes y Vehículos.
--
-- Quedan fuera, para el PR de módulos compartidos, contratos_arrendamiento,
-- reservas_str y huespedes_str: también las escribe el módulo Clientes.
--
-- QUÉ HACE (generado por scripts/rls-acciones/generar.mjs desde
-- supabase/rls-acciones/residentes.json; no editar a mano)
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

-- ── accesos_residentes ──────────────────────────────────────────────────────
--   INSERT accesos_res.create
--   UPDATE accesos_res.edit
--   DELETE accesos_res.delete
DROP POLICY IF EXISTS accesos_residentes_delete ON public.accesos_residentes;
CREATE POLICY accesos_residentes_delete ON public.accesos_residentes
  AS PERMISSIVE FOR DELETE TO authenticated
  USING ((is_super_admin() OR (( SELECT (public.condominios_puede_actuar('accesos_res', 'delete')) ) AND (company_id = get_my_company_id()))));
DROP POLICY IF EXISTS accesos_residentes_insert ON public.accesos_residentes;
CREATE POLICY accesos_residentes_insert ON public.accesos_residentes
  AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK ((is_super_admin() OR ((company_id = get_my_company_id()) AND ( SELECT (public.condominios_puede_actuar('accesos_res', 'create')) ))));
DROP POLICY IF EXISTS accesos_residentes_update ON public.accesos_residentes;
CREATE POLICY accesos_residentes_update ON public.accesos_residentes
  AS PERMISSIVE FOR UPDATE TO authenticated
  USING ((is_super_admin() OR ((company_id = get_my_company_id()) AND ( SELECT (public.condominios_puede_actuar('accesos_res', 'edit')) ))))
  WITH CHECK ((is_super_admin() OR ((company_id = get_my_company_id()) AND ( SELECT (public.condominios_puede_actuar('accesos_res', 'edit')) ))));

-- ── entrega_unidades ────────────────────────────────────────────────────────
--   INSERT entrega_unidad.create
--   UPDATE entrega_unidad.edit
--   DELETE entrega_unidad.delete
DROP POLICY IF EXISTS entrega_unidades_delete ON public.entrega_unidades;
CREATE POLICY entrega_unidades_delete ON public.entrega_unidades
  AS PERMISSIVE FOR DELETE TO authenticated
  USING ((is_super_admin() OR (( SELECT (public.condominios_puede_actuar('entrega_unidad', 'delete')) ) AND (company_id = get_my_company_id()))));
DROP POLICY IF EXISTS entrega_unidades_insert ON public.entrega_unidades;
CREATE POLICY entrega_unidades_insert ON public.entrega_unidades
  AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK ((is_super_admin() OR ((company_id = get_my_company_id()) AND ( SELECT (public.condominios_puede_actuar('entrega_unidad', 'create')) ))));
DROP POLICY IF EXISTS entrega_unidades_update ON public.entrega_unidades;
CREATE POLICY entrega_unidades_update ON public.entrega_unidades
  AS PERMISSIVE FOR UPDATE TO authenticated
  USING ((is_super_admin() OR ((company_id = get_my_company_id()) AND ( SELECT (public.condominios_puede_actuar('entrega_unidad', 'edit')) ))))
  WITH CHECK ((is_super_admin() OR ((company_id = get_my_company_id()) AND ( SELECT (public.condominios_puede_actuar('entrega_unidad', 'edit')) ))));

-- ── historial_residentes ────────────────────────────────────────────────────
--   INSERT directorio.create · historial_res.create
--   UPDATE directorio.edit · historial_res.edit
--   DELETE directorio.delete · historial_res.delete
--   La escribe la pestaña Historial de residentes, con sus propias acciones.
DROP POLICY IF EXISTS historial_residentes_delete ON public.historial_residentes;
CREATE POLICY historial_residentes_delete ON public.historial_residentes
  AS PERMISSIVE FOR DELETE TO authenticated
  USING ((is_super_admin() OR (( SELECT (public.condominios_puede_actuar('directorio', 'delete') OR public.condominios_puede_actuar('historial_res', 'delete')) ) AND (company_id = get_my_company_id()))));
DROP POLICY IF EXISTS historial_residentes_insert ON public.historial_residentes;
CREATE POLICY historial_residentes_insert ON public.historial_residentes
  AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK ((is_super_admin() OR ((company_id = get_my_company_id()) AND ( SELECT (public.condominios_puede_actuar('directorio', 'create') OR public.condominios_puede_actuar('historial_res', 'create')) ))));
DROP POLICY IF EXISTS historial_residentes_update ON public.historial_residentes;
CREATE POLICY historial_residentes_update ON public.historial_residentes
  AS PERMISSIVE FOR UPDATE TO authenticated
  USING ((is_super_admin() OR ((company_id = get_my_company_id()) AND ( SELECT (public.condominios_puede_actuar('directorio', 'edit') OR public.condominios_puede_actuar('historial_res', 'edit')) ))))
  WITH CHECK ((is_super_admin() OR ((company_id = get_my_company_id()) AND ( SELECT (public.condominios_puede_actuar('directorio', 'edit') OR public.condominios_puede_actuar('historial_res', 'edit')) ))));

-- ── manual_residente_cond ───────────────────────────────────────────────────
--   INSERT manual_residente.create
--   UPDATE manual_residente.edit
--   DELETE manual_residente.delete
DROP POLICY IF EXISTS manual_residente_cond_delete ON public.manual_residente_cond;
CREATE POLICY manual_residente_cond_delete ON public.manual_residente_cond
  AS PERMISSIVE FOR DELETE TO authenticated
  USING ((is_super_admin() OR (( SELECT (public.condominios_puede_actuar('manual_residente', 'delete')) ) AND (company_id = get_my_company_id()))));
DROP POLICY IF EXISTS manual_residente_cond_insert ON public.manual_residente_cond;
CREATE POLICY manual_residente_cond_insert ON public.manual_residente_cond
  AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK ((is_super_admin() OR ((company_id = get_my_company_id()) AND ( SELECT (public.condominios_puede_actuar('manual_residente', 'create')) ))));
DROP POLICY IF EXISTS manual_residente_cond_update ON public.manual_residente_cond;
CREATE POLICY manual_residente_cond_update ON public.manual_residente_cond
  AS PERMISSIVE FOR UPDATE TO authenticated
  USING ((is_super_admin() OR ((company_id = get_my_company_id()) AND ( SELECT (public.condominios_puede_actuar('manual_residente', 'edit')) ))))
  WITH CHECK ((is_super_admin() OR ((company_id = get_my_company_id()) AND ( SELECT (public.condominios_puede_actuar('manual_residente', 'edit')) ))));

-- ── mascotas ────────────────────────────────────────────────────────────────
--   INSERT mascotas.create
--   UPDATE mascotas.edit
--   DELETE mascotas.delete
DROP POLICY IF EXISTS mascotas_delete ON public.mascotas;
CREATE POLICY mascotas_delete ON public.mascotas
  AS PERMISSIVE FOR DELETE TO authenticated
  USING ((is_super_admin() OR (( SELECT (public.condominios_puede_actuar('mascotas', 'delete')) ) AND (company_id = get_my_company_id()))));
DROP POLICY IF EXISTS mascotas_insert ON public.mascotas;
CREATE POLICY mascotas_insert ON public.mascotas
  AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK ((is_super_admin() OR ((company_id = get_my_company_id()) AND ( SELECT (public.condominios_puede_actuar('mascotas', 'create')) ))));
DROP POLICY IF EXISTS mascotas_update ON public.mascotas;
CREATE POLICY mascotas_update ON public.mascotas
  AS PERMISSIVE FOR UPDATE TO authenticated
  USING ((is_super_admin() OR ((company_id = get_my_company_id()) AND ( SELECT (public.condominios_puede_actuar('mascotas', 'edit')) ))))
  WITH CHECK ((is_super_admin() OR ((company_id = get_my_company_id()) AND ( SELECT (public.condominios_puede_actuar('mascotas', 'edit')) ))));

-- ── onboarding_residentes ───────────────────────────────────────────────────
--   INSERT onboarding.create
--   UPDATE onboarding.edit
--   DELETE onboarding.delete
DROP POLICY IF EXISTS onboarding_residentes_delete ON public.onboarding_residentes;
CREATE POLICY onboarding_residentes_delete ON public.onboarding_residentes
  AS PERMISSIVE FOR DELETE TO authenticated
  USING ((is_super_admin() OR (( SELECT (public.condominios_puede_actuar('onboarding', 'delete')) ) AND (company_id = get_my_company_id()))));
DROP POLICY IF EXISTS onboarding_residentes_insert ON public.onboarding_residentes;
CREATE POLICY onboarding_residentes_insert ON public.onboarding_residentes
  AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK ((is_super_admin() OR ((company_id = get_my_company_id()) AND ( SELECT (public.condominios_puede_actuar('onboarding', 'create')) ))));
DROP POLICY IF EXISTS onboarding_residentes_update ON public.onboarding_residentes;
CREATE POLICY onboarding_residentes_update ON public.onboarding_residentes
  AS PERMISSIVE FOR UPDATE TO authenticated
  USING ((is_super_admin() OR ((company_id = get_my_company_id()) AND ( SELECT (public.condominios_puede_actuar('onboarding', 'edit')) ))))
  WITH CHECK ((is_super_admin() OR ((company_id = get_my_company_id()) AND ( SELECT (public.condominios_puede_actuar('onboarding', 'edit')) ))));

-- ── solicitud_mudanza_unidad ────────────────────────────────────────────────
--   INSERT solicitudes_mudanza.create
--   UPDATE solicitudes_mudanza.edit · visitantes.create
--   DELETE solicitudes_mudanza.delete
--   Visitantes pasa la mudanza a «en curso» al registrar su ingreso, con canCreate('visitantes').
DROP POLICY IF EXISTS solicitud_mudanza_unidad_delete ON public.solicitud_mudanza_unidad;
CREATE POLICY solicitud_mudanza_unidad_delete ON public.solicitud_mudanza_unidad
  AS PERMISSIVE FOR DELETE TO authenticated
  USING ((is_super_admin() OR (( SELECT (public.condominios_puede_actuar('solicitudes_mudanza', 'delete')) ) AND (company_id = get_my_company_id()))));
DROP POLICY IF EXISTS solicitud_mudanza_unidad_insert ON public.solicitud_mudanza_unidad;
CREATE POLICY solicitud_mudanza_unidad_insert ON public.solicitud_mudanza_unidad
  AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK ((is_super_admin() OR ((company_id = get_my_company_id()) AND ( SELECT (public.condominios_puede_actuar('solicitudes_mudanza', 'create')) )) OR ((current_user_role() = 'cliente'::text) AND ((cliente_id = get_my_cliente_id()) OR ((estado = 'pendiente'::text) AND (unidad_id IN ( SELECT mis_unidades_ids() AS mis_unidades_ids)))))));
DROP POLICY IF EXISTS solicitud_mudanza_unidad_update ON public.solicitud_mudanza_unidad;
CREATE POLICY solicitud_mudanza_unidad_update ON public.solicitud_mudanza_unidad
  AS PERMISSIVE FOR UPDATE TO authenticated
  USING ((is_super_admin() OR ((company_id = get_my_company_id()) AND ( SELECT (public.condominios_puede_actuar('solicitudes_mudanza', 'edit') OR public.condominios_puede_actuar('visitantes', 'create')) ))))
  WITH CHECK ((is_super_admin() OR ((company_id = get_my_company_id()) AND ( SELECT (public.condominios_puede_actuar('solicitudes_mudanza', 'edit') OR public.condominios_puede_actuar('visitantes', 'create')) ))));

-- ── solicitud_renta_unidad ──────────────────────────────────────────────────
--   INSERT solicitudes_renta.create
--   UPDATE solicitudes_renta.edit
--   DELETE solicitudes_renta.delete
--   La fila de la prueba es una solicitud ya resuelta: la unidad admite una sola pendiente o aprobada (idx_solicitud_renta_unidad_activa), y la fabricada y el alta comparten unidad; además, una enviada exige el contrato completo (fn_validar_solicitud_renta_completa), que nada tiene que ver con la acción.
DROP POLICY IF EXISTS solicitud_renta_unidad_delete ON public.solicitud_renta_unidad;
CREATE POLICY solicitud_renta_unidad_delete ON public.solicitud_renta_unidad
  AS PERMISSIVE FOR DELETE TO authenticated
  USING ((is_super_admin() OR (( SELECT (public.condominios_puede_actuar('solicitudes_renta', 'delete')) ) AND (company_id = get_my_company_id()))));
DROP POLICY IF EXISTS solicitud_renta_unidad_insert ON public.solicitud_renta_unidad;
CREATE POLICY solicitud_renta_unidad_insert ON public.solicitud_renta_unidad
  AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK ((is_super_admin() OR ((company_id = get_my_company_id()) AND ( SELECT (public.condominios_puede_actuar('solicitudes_renta', 'create')) ))));
DROP POLICY IF EXISTS solicitud_renta_unidad_update ON public.solicitud_renta_unidad;
CREATE POLICY solicitud_renta_unidad_update ON public.solicitud_renta_unidad
  AS PERMISSIVE FOR UPDATE TO authenticated
  USING ((is_super_admin() OR ((company_id = get_my_company_id()) AND ( SELECT (public.condominios_puede_actuar('solicitudes_renta', 'edit')) ))))
  WITH CHECK ((is_super_admin() OR ((company_id = get_my_company_id()) AND ( SELECT (public.condominios_puede_actuar('solicitudes_renta', 'edit')) ))));

-- ── solicitudes_certificado ─────────────────────────────────────────────────
--   INSERT certificados.create
--   UPDATE certificados.edit
--   DELETE certificados.delete
DROP POLICY IF EXISTS solicitudes_certificado_delete ON public.solicitudes_certificado;
CREATE POLICY solicitudes_certificado_delete ON public.solicitudes_certificado
  AS PERMISSIVE FOR DELETE TO authenticated
  USING ((is_super_admin() OR (( SELECT (public.condominios_puede_actuar('certificados', 'delete')) ) AND (company_id = get_my_company_id()))));
DROP POLICY IF EXISTS solicitudes_certificado_insert ON public.solicitudes_certificado;
CREATE POLICY solicitudes_certificado_insert ON public.solicitudes_certificado
  AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK ((is_super_admin() OR ((company_id = get_my_company_id()) AND ( SELECT (public.condominios_puede_actuar('certificados', 'create')) ))));
DROP POLICY IF EXISTS solicitudes_certificado_update ON public.solicitudes_certificado;
CREATE POLICY solicitudes_certificado_update ON public.solicitudes_certificado
  AS PERMISSIVE FOR UPDATE TO authenticated
  USING ((is_super_admin() OR ((company_id = get_my_company_id()) AND ( SELECT (public.condominios_puede_actuar('certificados', 'edit')) ))))
  WITH CHECK ((is_super_admin() OR ((company_id = get_my_company_id()) AND ( SELECT (public.condominios_puede_actuar('certificados', 'edit')) ))));

-- ── solicitudes_residente ───────────────────────────────────────────────────
--   INSERT solicitudes.create
--   UPDATE solicitudes.edit · solicitudes.approve
--   DELETE solicitudes.delete
--   Aprobar o rechazar una solicitud se ofrece con canApprove('solicitudes').
DROP POLICY IF EXISTS solicitudes_residente_delete ON public.solicitudes_residente;
CREATE POLICY solicitudes_residente_delete ON public.solicitudes_residente
  AS PERMISSIVE FOR DELETE TO authenticated
  USING ((is_super_admin() OR (( SELECT (public.condominios_puede_actuar('solicitudes', 'delete')) ) AND (company_id = get_my_company_id()))));
DROP POLICY IF EXISTS solicitudes_residente_insert ON public.solicitudes_residente;
CREATE POLICY solicitudes_residente_insert ON public.solicitudes_residente
  AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK ((is_super_admin() OR ((company_id = get_my_company_id()) AND ( SELECT (public.condominios_puede_actuar('solicitudes', 'create')) ))));
DROP POLICY IF EXISTS solicitudes_residente_update ON public.solicitudes_residente;
CREATE POLICY solicitudes_residente_update ON public.solicitudes_residente
  AS PERMISSIVE FOR UPDATE TO authenticated
  USING ((is_super_admin() OR ((company_id = get_my_company_id()) AND ( SELECT (public.condominios_puede_actuar('solicitudes', 'edit') OR public.condominios_puede_actuar('solicitudes', 'approve')) ))))
  WITH CHECK ((is_super_admin() OR ((company_id = get_my_company_id()) AND ( SELECT (public.condominios_puede_actuar('solicitudes', 'edit') OR public.condominios_puede_actuar('solicitudes', 'approve')) ))));

-- ── vehiculos_residentes ────────────────────────────────────────────────────
--   INSERT vehiculos.create
--   UPDATE vehiculos.edit
--   DELETE vehiculos.delete
DROP POLICY IF EXISTS vehiculos_residentes_delete ON public.vehiculos_residentes;
CREATE POLICY vehiculos_residentes_delete ON public.vehiculos_residentes
  AS PERMISSIVE FOR DELETE TO authenticated
  USING ((is_super_admin() OR (( SELECT (public.condominios_puede_actuar('vehiculos', 'delete')) ) AND (company_id = get_my_company_id()))));
DROP POLICY IF EXISTS vehiculos_residentes_insert ON public.vehiculos_residentes;
CREATE POLICY vehiculos_residentes_insert ON public.vehiculos_residentes
  AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK ((is_super_admin() OR ((company_id = get_my_company_id()) AND ( SELECT (public.condominios_puede_actuar('vehiculos', 'create')) ))));
DROP POLICY IF EXISTS vehiculos_residentes_update ON public.vehiculos_residentes;
CREATE POLICY vehiculos_residentes_update ON public.vehiculos_residentes
  AS PERMISSIVE FOR UPDATE TO authenticated
  USING ((is_super_admin() OR ((company_id = get_my_company_id()) AND ( SELECT (public.condominios_puede_actuar('vehiculos', 'edit')) ))))
  WITH CHECK ((is_super_admin() OR ((company_id = get_my_company_id()) AND ( SELECT (public.condominios_puede_actuar('vehiculos', 'edit')) )))
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
    ('accesos_residentes', 3, 3),
    ('entrega_unidades', 3, 3),
    ('historial_residentes', 3, 3),
    ('manual_residente_cond', 3, 3),
    ('mascotas', 3, 3),
    ('onboarding_residentes', 3, 3),
    ('solicitud_mudanza_unidad', 3, 3),
    ('solicitud_renta_unidad', 3, 3),
    ('solicitudes_certificado', 3, 3),
    ('solicitudes_residente', 3, 3),
    ('vehiculos_residentes', 3, 3)
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
