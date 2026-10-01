-- ============================================================================
-- E7 · LA TARIFA DE UNA RESERVA CANCELADA SE ANULA (NO SE BORRA)
--
-- Decisión aprobada el 2026-10-01 (docs/DECISIONES_PENDIENTES_CONTABILIDAD.md
-- §E7, opción «basta, pero con evidencia»):
--   · cancelar (o rechazar) la reserva AUTORIZA quitar su tarifa sin una
--     segunda aprobación;
--   · pero la tarifa se ANULA —reverso del devengo y de la mora vinculados a
--     los originales y evidencia inmutable (conta_cuota_anulaciones: quién,
--     cuándo, motivo, solicitud)— en vez de borrarse;
--   · sólo quien puede administrar reservas (company_owner/admin, permiso
--     de amenidades o de condominios);
--   · si la tarifa tiene cobros, saldo a favor aplicado, un cobro en línea en
--     curso, una rebaja o cualquier otra dependencia, NO se anula aquí: queda
--     vigente y se anula con una solicitud aprobada por otra persona.
--
-- CÓMO. `conta_reserva_cancelar` cancela la reserva y, en la MISMA
-- transacción, crea una solicitud anular_cuota con canal
-- 'reserva_cancelada' (vinculada a la reserva) y la ejecuta por el mismo
-- camino que una aprobada (conta_ajuste_ejecutar: revalida documento,
-- período y dependencias con la cuota bloqueada; reversos y evidencia). La
-- bitácora dice que la autorizó la cancelación. No es una autoaprobación (E1
-- no aplica: no hay una segunda persona que pedir, la cancelación es el acto
-- de negocio que deja a la tarifa sin causa) y queda marcado por el canal.
-- Si la ejecución falla (p. ej. período cerrado), la reserva queda cancelada
-- y la solicitud «fallida», visible y reintentable por quien aprueba.
--
-- ELIMINAR. Desde aquí ninguna cuota se elimina desde la aplicación
-- (CUOTA_ELIMINACION_SOLO_POR_SOLICITUD): la de una reserva se anula al
-- cancelarla; cualquier otra, con una solicitud.
--
-- CÓMO SE REVIERTE: restaurar conta_cuota_exigir_eliminable de
-- 20261014000000, DROP de conta_reserva_cancelar, y retirar la columna
-- reserva_id y las restricciones de canal (sólo si no hay solicitudes con
-- canal 'reserva_cancelada': son historia).
-- ============================================================================

-- ── 1. Solicitudes: canal «reserva_cancelada» ───────────────────────────────
ALTER TABLE public.conta_ajustes_solicitudes
  ADD COLUMN reserva_id uuid REFERENCES public.reservas_amenidades(id) ON DELETE RESTRICT;
COMMENT ON COLUMN public.conta_ajustes_solicitudes.reserva_id IS
  'Canal reserva_cancelada: la reserva cuya cancelación autorizó anular su tarifa (E7).';
CREATE INDEX idx_conta_ajustes_reserva ON public.conta_ajustes_solicitudes (reserva_id) WHERE reserva_id IS NOT NULL;

ALTER TABLE public.conta_ajustes_solicitudes DROP CONSTRAINT conta_ajustes_canal_valido;
ALTER TABLE public.conta_ajustes_solicitudes ADD CONSTRAINT conta_ajustes_canal_valido CHECK (
  canal IN ('backoffice','portal','reserva_cancelada'));
ALTER TABLE public.conta_ajustes_solicitudes ADD CONSTRAINT conta_ajustes_reserva_cancelada CHECK (
  (canal = 'reserva_cancelada') = (reserva_id IS NOT NULL)
  AND (canal <> 'reserva_cancelada' OR (tipo = 'anular_cuota' AND NOT autoaprobada)));
-- La anulación por cancelación la registra quien canceló: no es una
-- autoaprobación (E1), y por eso no lleva la marca; el canal la distingue.
ALTER TABLE public.conta_ajustes_solicitudes DROP CONSTRAINT conta_ajustes_autoaprobacion_marcada;
ALTER TABLE public.conta_ajustes_solicitudes ADD CONSTRAINT conta_ajustes_autoaprobacion_marcada CHECK (
  (NOT autoaprobada OR revisado_por = solicitado_por)
  AND (canal = 'reserva_cancelada' OR estado NOT IN ('ejecutada','fallida')
       OR autoaprobada = (revisado_por = solicitado_por)));

-- ── 2. Ninguna cuota se elimina desde la aplicación ─────────────────────────
CREATE OR REPLACE FUNCTION public.conta_cuota_exigir_eliminable(p_cuota public.cuotas_condominio)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  RAISE EXCEPTION 'CUOTA_ELIMINACION_SOLO_POR_SOLICITUD: una cuota no se elimina, se anula (con reverso de su devengo y evidencia). La tarifa de una reserva se anula al cancelar la reserva; cualquier otra cuota, con una solicitud aprobada.'
    USING ERRCODE = '42501';
END;
$$;

REVOKE EXECUTE ON FUNCTION public.conta_cuota_exigir_eliminable(public.cuotas_condominio) FROM PUBLIC, anon, authenticated;

-- ── 3. Cancelar la reserva y anular su tarifa ───────────────────────────────
CREATE FUNCTION public.conta_reserva_cancelar(
  p_reserva_id uuid,
  p_motivo     text DEFAULT NULL,
  p_rechazo    boolean DEFAULT false
)
RETURNS TABLE (reserva_id uuid, tarifa text, cuota_id uuid, solicitud_id uuid, detalle text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_company uuid;
  v_r       public.reservas_amenidades;
  v_project uuid;
  v_cuota   public.cuotas_condominio;
  v_deps    text;
  v_foto    jsonb;
  v_sol     public.conta_ajustes_solicitudes;
  v_motivo  text := NULLIF(btrim(COALESCE(p_motivo, '')), '');
  v_texto   text;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'No autorizado: se requiere una sesión.' USING ERRCODE = '42501';
  END IF;
  v_company := public.get_my_company_id();
  IF v_company IS NULL THEN
    RAISE EXCEPTION 'No autorizado: la sesión no tiene empresa activa.' USING ERRCODE = '42501';
  END IF;
  IF NOT (public.is_super_admin()
          OR public.current_user_role() = ANY (ARRAY['company_owner','admin'])
          OR public.user_has_permission('condominios.tab.amenidades')
          OR public.user_has_permission('platform.condominios.edit')) THEN
    RAISE EXCEPTION 'No autorizado para cancelar reservas.' USING ERRCODE = '42501';
  END IF;
  PERFORM public.assert_company_scope(v_company);
  IF p_rechazo AND v_motivo IS NULL THEN
    RAISE EXCEPTION 'RESERVA_MOTIVO: indica el motivo del rechazo.' USING ERRCODE = '22023';
  END IF;

  -- La reserva (bloqueada), en el ámbito. Ajena = inexistente.
  SELECT * INTO v_r FROM public.reservas_amenidades r
   WHERE r.id = p_reserva_id AND r.company_id = v_company FOR UPDATE;
  SELECT a.project_id INTO v_project FROM public.amenidades a WHERE a.id = v_r.amenidad_id;
  IF v_r.id IS NULL OR v_project IS NULL OR NOT public.can_access_project(v_project) THEN
    RAISE EXCEPTION 'La reserva no existe o no está en tu ámbito.' USING ERRCODE = 'P0002';
  END IF;

  IF v_r.estado IS DISTINCT FROM 'cancelada' THEN
    UPDATE public.reservas_amenidades r
       SET estado = 'cancelada',
           rechazada_motivo = CASE WHEN p_rechazo THEN v_motivo ELSE r.rechazada_motivo END
     WHERE r.id = v_r.id;
  END IF;

  -- La tarifa.
  IF v_r.cuota_id IS NULL THEN
    RETURN QUERY SELECT v_r.id, 'sin_tarifa'::text, NULL::uuid, NULL::uuid, NULL::text;
    RETURN;
  END IF;
  SELECT * INTO v_cuota FROM public.cuotas_condominio c WHERE c.id = v_r.cuota_id AND c.company_id = v_company;
  IF v_cuota.id IS NULL OR v_cuota.deleted_at IS NOT NULL THEN
    RETURN QUERY SELECT v_r.id, 'sin_tarifa'::text, v_r.cuota_id, NULL::uuid, NULL::text;
    RETURN;
  END IF;
  IF v_cuota.cuota_estado = 'anulada' THEN
    RETURN QUERY SELECT v_r.id, 'ya_anulada'::text, v_cuota.id,
      (SELECT an.solicitud_id FROM public.conta_cuota_anulaciones an WHERE an.cuota_id = v_cuota.id), NULL::text;
    RETURN;
  END IF;

  -- Con dependencias NO se anula aquí: se informa y queda para una solicitud.
  SELECT string_agg('• ' || d.detalle || COALESCE(' (' || d.monto || ')', '') || ': ' || d.como_resolver, E'\n')
    INTO v_deps
    FROM public.conta_cuota_dependencias(v_cuota.id, true) d;
  IF v_deps IS NOT NULL THEN
    RETURN QUERY SELECT v_r.id, 'requiere_solicitud'::text, v_cuota.id, NULL::uuid, v_deps;
    RETURN;
  END IF;

  v_texto := CASE WHEN p_rechazo THEN 'Reserva rechazada' ELSE 'Reserva cancelada' END
             || ' (' || to_char(v_r.fecha, 'YYYY-MM-DD') || ')'
             || COALESCE(': ' || v_motivo, '');
  v_foto := public.conta_ajuste_foto(v_company, v_cuota.project_id, 'anular_cuota', 'cuotas_condominio', v_cuota.id, NULL, false);

  BEGIN
    INSERT INTO public.conta_ajustes_solicitudes (
      id, company_id, project_id, tipo, documento_tabla, documento_id, importe, motivo, canal,
      reserva_id, solicitado_por, foto_documento)
    VALUES (
      gen_random_uuid(), v_company, v_cuota.project_id, 'anular_cuota', 'cuotas_condominio', v_cuota.id,
      (v_foto ->> 'monto')::numeric(14,2), v_texto, 'reserva_cancelada', v_r.id, auth.uid(), v_foto)
    RETURNING * INTO v_sol;
  EXCEPTION WHEN unique_violation THEN
    RETURN QUERY SELECT v_r.id, 'requiere_solicitud'::text, v_cuota.id, NULL::uuid,
      'Ya hay una solicitud de anulación abierta para esta tarifa: resuélvela en Contabilidad › Solicitudes de ajuste.'::text;
    RETURN;
  END;
  PERFORM public.conta_ajuste_evento(v_sol, 'solicitada', NULL, 'pendiente', v_texto);

  UPDATE public.conta_ajustes_solicitudes s
     SET revisado_por = auth.uid(), revisado_at = now(),
         motivo_revision = 'Autorizada por la cancelación de la reserva (E7).', updated_at = now()
   WHERE s.id = v_sol.id
  RETURNING * INTO v_sol;
  PERFORM public.conta_ajuste_evento(v_sol, 'aprobada', 'pendiente', 'pendiente',
    'Autorizada por la cancelación de la reserva (E7).');

  v_sol := public.conta_ajuste_ejecutar(v_sol, 'aprobar');
  RETURN QUERY SELECT v_r.id,
    CASE WHEN v_sol.estado = 'ejecutada' THEN 'anulada' ELSE 'fallida' END,
    v_cuota.id, v_sol.id, v_sol.error_ejecucion;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.conta_reserva_cancelar(uuid, text, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.conta_reserva_cancelar(uuid, text, boolean) TO authenticated;

COMMENT ON FUNCTION public.conta_reserva_cancelar(uuid, text, boolean) IS
  'E7: cancela (o rechaza, con motivo) una reserva y, en la misma transacción, anula su tarifa con reverso y evidencia (solicitud anular_cuota con canal reserva_cancelada, autorizada por la cancelación). Con dependencias (cobros, saldo a favor, cobro en línea, rebaja…) la tarifa queda vigente: tarifa = requiere_solicitud con el detalle. Si la ejecución falla, la reserva queda cancelada y la solicitud fallida, reintentable.';
