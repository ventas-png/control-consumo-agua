-- RPCs del portal para la solicitud de renta. Reemplazan la escritura directa
-- de la tabla que 20260829000100 le quitó al residente.
--
-- Dos pasos y no uno porque los documentos necesitan que la fila EXISTA antes
-- de subirse: el path de `renta-docs` es {unidad_id}/{solicitud_id}/{archivo} y
-- su policy verifica contra la solicitud (20260829000400). Sin la fila, lo
-- único comprobable sería la unidad — no a qué solicitud pertenece el archivo
-- ni si ya se resolvió.
--
--   1) portal_reservar_solicitud_renta  → crea/devuelve el BORRADOR y su id.
--   2) portal_enviar_solicitud_renta    → valida todo y pasa a 'pendiente'.
--   3) portal_descartar_solicitud_renta → tira el borrador si se arrepiente.
--
-- Las tres son SECURITY DEFINER acotadas por mis_unidades_propietario_ids()
-- (mismo gate que portal_baja_renta, 20260827000000): un inquilino de la unidad
-- no reserva, no envía y no descarta.

-- ── 1) Reservar ──────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.portal_reservar_solicitud_renta(p_unidad_id uuid)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $fn$
DECLARE
  v_id      uuid;
  v_unidad  public.unidades%ROWTYPE;
  v_estado  text;
BEGIN
  IF current_user_role() <> 'cliente' THEN
    RAISE EXCEPTION 'Solo el propietario puede iniciar una solicitud de renta desde el portal.';
  END IF;
  IF p_unidad_id IS NULL
     OR NOT EXISTS (SELECT 1 FROM public.mis_unidades_propietario_ids() x WHERE x = p_unidad_id) THEN
    RAISE EXCEPTION 'No autorizado: la unidad no le pertenece.';
  END IF;

  -- Reservar es idempotente: si ya hay un borrador, se devuelve ESE (con sus
  -- documentos ya subidos), que es lo que permite retomar tras una recarga.
  SELECT id INTO v_id
    FROM public.solicitud_renta_unidad
   WHERE unidad_id = p_unidad_id AND estado = 'borrador';
  IF FOUND THEN
    RETURN v_id;
  END IF;

  SELECT estado INTO v_estado
    FROM public.solicitud_renta_unidad
   WHERE unidad_id = p_unidad_id AND estado IN ('pendiente', 'aprobada');
  IF FOUND THEN
    RAISE EXCEPTION 'La unidad ya tiene una solicitud de renta % .', v_estado;
  END IF;

  SELECT * INTO v_unidad FROM public.unidades WHERE id = p_unidad_id;

  INSERT INTO public.solicitud_renta_unidad (
    company_id, project_id, unidad_id, cliente_id, tipo_renta, estado
  ) VALUES (
    v_unidad.company_id, v_unidad.project_id, p_unidad_id,
    get_my_cliente_id(), 'arrendamiento', 'borrador'
  )
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$fn$;

-- ── 2) Enviar ────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.portal_enviar_solicitud_renta(
  p_solicitud_id                uuid,
  p_tipo_renta                  text,
  p_motivo                      text    DEFAULT NULL,
  p_arrendatario_nombre         text    DEFAULT NULL,
  p_arrendatario_identificacion text    DEFAULT NULL,
  p_arrendatario_telefono       text    DEFAULT NULL,
  p_arrendatario_email          text    DEFAULT NULL,
  p_monto_renta                 numeric DEFAULT NULL,
  p_deposito                    numeric DEFAULT NULL,
  p_dia_pago                    int     DEFAULT NULL,
  p_fecha_inicio                date    DEFAULT NULL,
  p_fecha_fin                   date    DEFAULT NULL,
  p_notas                       text    DEFAULT NULL,
  p_responsables                jsonb   DEFAULT NULL,
  p_documentos                  jsonb   DEFAULT '[]'::jsonb
)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $fn$
DECLARE
  v_sol       public.solicitud_renta_unidad%ROWTYPE;
  v_arrend    boolean;
  v_prefijo   text;
  v_doc       jsonb;
  v_servicio  text;
  v_valor     text;
  v_resp      text[] := ARRAY[]::text[];
BEGIN
  IF current_user_role() <> 'cliente' THEN
    RAISE EXCEPTION 'Solo el propietario puede enviar la solicitud desde el portal.';
  END IF;
  IF p_tipo_renta IS NULL OR p_tipo_renta NOT IN ('arrendamiento', 'str', 'ambas') THEN
    RAISE EXCEPTION 'Tipo de renta inválido: %', p_tipo_renta;
  END IF;

  SELECT * INTO v_sol
    FROM public.solicitud_renta_unidad
   WHERE id = p_solicitud_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'La solicitud no existe.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.mis_unidades_propietario_ids() x WHERE x = v_sol.unidad_id) THEN
    RAISE EXCEPTION 'No autorizado: la unidad no le pertenece.';
  END IF;
  IF v_sol.estado <> 'borrador' THEN
    RAISE EXCEPTION 'La solicitud ya fue enviada (estado actual: %).', v_sol.estado;
  END IF;

  v_arrend := p_tipo_renta IN ('arrendamiento', 'ambas');

  -- Responsables: los seis, y solo los dos valores permitidos. El trigger de
  -- 20260829000000 vuelve a exigir que no sean nulos; aquí además se rechaza
  -- un valor desconocido con un mensaje que nombra el servicio.
  IF v_arrend THEN
    FOREACH v_servicio IN ARRAY ARRAY['mantenimiento','agua','electricidad','basura','telefonia','internet'] LOOP
      v_valor := nullif(btrim(coalesce(p_responsables->>v_servicio, '')), '');
      IF v_valor IS NULL THEN
        RAISE EXCEPTION 'Falta el responsable del servicio "%".', v_servicio;
      END IF;
      IF v_valor NOT IN ('propietario', 'inquilino') THEN
        RAISE EXCEPTION 'Responsable inválido para "%": % (solo propietario o inquilino).', v_servicio, v_valor;
      END IF;
      v_resp := v_resp || v_valor;
    END LOOP;
  END IF;

  -- Documentos: tope, forma y —lo importante— que cada path caiga DENTRO de la
  -- carpeta de esta solicitud. Sin esto, un path apuntando a otra solicitud de
  -- la misma unidad se registraría como propio.
  IF jsonb_typeof(coalesce(p_documentos, '[]'::jsonb)) <> 'array' THEN
    RAISE EXCEPTION 'Los documentos deben venir como arreglo.';
  END IF;
  IF jsonb_array_length(coalesce(p_documentos, '[]'::jsonb)) > 8 THEN
    RAISE EXCEPTION 'Máximo 8 documentos por solicitud.';
  END IF;
  v_prefijo := v_sol.unidad_id::text || '/' || v_sol.id::text || '/';
  FOR v_doc IN SELECT * FROM jsonb_array_elements(coalesce(p_documentos, '[]'::jsonb)) LOOP
    IF nullif(btrim(coalesce(v_doc->>'path', '')), '') IS NULL THEN
      RAISE EXCEPTION 'Un documento llegó sin path.';
    END IF;
    IF left(v_doc->>'path', length(v_prefijo)) <> v_prefijo THEN
      RAISE EXCEPTION 'El documento "%" no pertenece a esta solicitud.', v_doc->>'path';
    END IF;
  END LOOP;

  UPDATE public.solicitud_renta_unidad
     SET tipo_renta                  = p_tipo_renta,
         motivo                      = nullif(btrim(coalesce(p_motivo, '')), ''),
         arrendatario_nombre         = CASE WHEN v_arrend THEN nullif(btrim(coalesce(p_arrendatario_nombre, '')), '') END,
         arrendatario_identificacion = CASE WHEN v_arrend THEN nullif(btrim(coalesce(p_arrendatario_identificacion, '')), '') END,
         arrendatario_telefono       = CASE WHEN v_arrend THEN nullif(btrim(coalesce(p_arrendatario_telefono, '')), '') END,
         arrendatario_email          = CASE WHEN v_arrend THEN nullif(btrim(coalesce(p_arrendatario_email, '')), '') END,
         monto_renta                 = CASE WHEN v_arrend THEN p_monto_renta END,
         deposito                    = CASE WHEN v_arrend THEN p_deposito END,
         dia_pago                    = CASE WHEN v_arrend THEN coalesce(p_dia_pago, 1) END,
         fecha_inicio                = CASE WHEN v_arrend THEN p_fecha_inicio END,
         fecha_fin                   = CASE WHEN v_arrend THEN p_fecha_fin END,
         notas_contrato              = CASE WHEN v_arrend THEN nullif(btrim(coalesce(p_notas, '')), '') END,
         resp_mantenimiento          = CASE WHEN v_arrend THEN v_resp[1] END,
         resp_agua                   = CASE WHEN v_arrend THEN v_resp[2] END,
         resp_electricidad           = CASE WHEN v_arrend THEN v_resp[3] END,
         resp_basura                 = CASE WHEN v_arrend THEN v_resp[4] END,
         resp_telefonia              = CASE WHEN v_arrend THEN v_resp[5] END,
         resp_internet               = CASE WHEN v_arrend THEN v_resp[6] END,
         documentos                  = coalesce(p_documentos, '[]'::jsonb),
         estado                      = 'pendiente',
         created_at                  = now()
   WHERE id = v_sol.id;

  RETURN v_sol.id;
END;
$fn$;

-- ── 3) Descartar ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.portal_descartar_solicitud_renta(p_solicitud_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $fn$
DECLARE v_sol public.solicitud_renta_unidad%ROWTYPE;
BEGIN
  IF current_user_role() <> 'cliente' THEN
    RAISE EXCEPTION 'Solo el propietario puede descartar su borrador.';
  END IF;
  SELECT * INTO v_sol FROM public.solicitud_renta_unidad WHERE id = p_solicitud_id FOR UPDATE;
  IF NOT FOUND THEN RETURN; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.mis_unidades_propietario_ids() x WHERE x = v_sol.unidad_id) THEN
    RAISE EXCEPTION 'No autorizado: la unidad no le pertenece.';
  END IF;
  IF v_sol.estado <> 'borrador' THEN
    RAISE EXCEPTION 'Solo se puede descartar un borrador.';
  END IF;
  DELETE FROM public.solicitud_renta_unidad WHERE id = v_sol.id;
END;
$fn$;

-- ── ACL ──────────────────────────────────────────────────────────────────────
REVOKE ALL ON FUNCTION public.portal_reservar_solicitud_renta(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.portal_reservar_solicitud_renta(uuid) TO authenticated;

REVOKE ALL ON FUNCTION public.portal_enviar_solicitud_renta(uuid, text, text, text, text, text, text, numeric, numeric, int, date, date, text, jsonb, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.portal_enviar_solicitud_renta(uuid, text, text, text, text, text, text, numeric, numeric, int, date, date, text, jsonb, jsonb) TO authenticated;

REVOKE ALL ON FUNCTION public.portal_descartar_solicitud_renta(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.portal_descartar_solicitud_renta(uuid) TO authenticated;

COMMENT ON FUNCTION public.portal_reservar_solicitud_renta(uuid) IS
  'Crea (o devuelve) el borrador de solicitud de renta de una unidad propia. Su id es la carpeta de los adjuntos en renta-docs.';
COMMENT ON FUNCTION public.portal_enviar_solicitud_renta(uuid, text, text, text, text, text, text, numeric, numeric, int, date, date, text, jsonb, jsonb) IS
  'Valida y envía el borrador: datos del contrato y los seis responsables si el tipo incluye arrendamiento, y que cada documento cuelgue de {unidad_id}/{solicitud_id}/. Deja la solicitud en pendiente.';
COMMENT ON FUNCTION public.portal_descartar_solicitud_renta(uuid) IS
  'Elimina el borrador de solicitud de renta de una unidad propia.';
