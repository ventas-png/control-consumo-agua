-- `aprobar_solicitud_renta`: el contrato anterior no puede solaparse con el nuevo.
--
-- HALLAZGO. 20260829000300 cerraba el contrato vigente con
--     fecha_fin = COALESCE(fecha_fin, v_sol.fecha_inicio - 1)
-- que solo rellena la fecha cuando FALTA. Si el contrato vigente ya traía una
-- fecha_fin POSTERIOR al inicio del nuevo —el caso normal de una salida
-- anticipada o una renovación adelantada: contrato hasta 2030 y el inquilino
-- nuevo entra en 2028— esa fecha se conservaba tal cual y la unidad quedaba con
-- DOS plazos solapados. El histórico dejaba de ser legible: dos contratos
-- vigentes a la vez sobre las mismas fechas, y los reportes de renta mensual
-- sumando ambos.
--
-- ARREGLO: LEAST(fecha existente, inicio del nuevo - 1). Si ya terminaba antes,
-- se respeta su fecha; si terminaba después, se recorta al día previo.
--
-- Va en migración APARTE y no editando 20260829000300 porque esa ya se aplicó
-- al preview branch, y Supabase solo empuja migraciones NUEVAS: corregir el
-- archivo en el sitio dejaría el preview con la versión vieja de la función.
--
-- Solo cambia esa línea: el resto del cuerpo es idéntico a 20260829000300, y la
-- firma no cambia, así que CREATE OR REPLACE basta (sin DROP).

CREATE OR REPLACE FUNCTION public.aprobar_solicitud_renta(
  p_solicitud_id        uuid,
  p_tipo_aprobado       text,
  p_comentario          text    DEFAULT NULL,
  p_crear_contrato      boolean DEFAULT true,
  p_motivo_sin_contrato text    DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $fn$
DECLARE
  v_sol       public.solicitud_renta_unidad%ROWTYPE;
  v_contrato  uuid := NULL;
  v_anterior  uuid := NULL;
  v_arrend    boolean;
  v_datos_ok  boolean;
  v_motivo    text;
  v_uid       uuid := auth.uid();
  v_nombre    text;
BEGIN
  IF p_tipo_aprobado IS NULL OR p_tipo_aprobado NOT IN ('arrendamiento', 'str', 'ambas') THEN
    RAISE EXCEPTION 'Tipo de renta inválido: %', p_tipo_aprobado;
  END IF;

  SELECT * INTO v_sol
    FROM public.solicitud_renta_unidad
   WHERE id = p_solicitud_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'La solicitud no existe.';
  END IF;

  -- Mismo gate que la RLS de staff sobre la tabla.
  IF NOT (
    public.is_super_admin()
    OR (v_sol.company_id = public.get_my_company_id()
        AND public.user_has_permission('condominios.tab.solicitudes_renta'))
  ) THEN
    RAISE EXCEPTION 'No autorizado para resolver solicitudes de renta.';
  END IF;

  IF v_sol.estado <> 'pendiente' THEN
    RAISE EXCEPTION 'La solicitud no está pendiente (estado actual: %).', v_sol.estado;
  END IF;

  v_arrend   := p_tipo_aprobado IN ('arrendamiento', 'ambas');
  v_datos_ok := v_sol.arrendatario_nombre IS NOT NULL
            AND btrim(v_sol.arrendatario_nombre) <> ''
            AND v_sol.monto_renta  IS NOT NULL
            AND v_sol.fecha_inicio IS NOT NULL;
  v_motivo   := nullif(btrim(coalesce(p_motivo_sin_contrato, '')), '');

  IF v_arrend THEN
    IF p_crear_contrato AND NOT v_datos_ok THEN
      RAISE EXCEPTION 'La solicitud no trae los datos del contrato (arrendatario, monto y fecha de inicio). No se puede aprobar creando el contrato.';
    END IF;
    IF NOT p_crear_contrato AND v_motivo IS NULL THEN
      RAISE EXCEPTION 'Para aprobar un arrendamiento sin crear el contrato hay que justificarlo por escrito.';
    END IF;
  ELSE
    -- Con STR nunca hay contrato de arrendamiento: la justificación sobra.
    v_motivo := NULL;
  END IF;

  SELECT full_name INTO v_nombre FROM public.app_users WHERE id = v_uid;

  UPDATE public.solicitud_renta_unidad
     SET estado               = 'aprobada',
         tipo_aprobado        = p_tipo_aprobado,
         comentario_admin     = nullif(btrim(coalesce(p_comentario, '')), ''),
         aprobado_por         = v_nombre,
         aprobado_por_user_id = v_uid,
         motivo_sin_contrato  = v_motivo,
         fecha_resolucion     = now()
   WHERE id = v_sol.id;

  IF v_arrend AND p_crear_contrato THEN
    -- Cambio de inquilino: se cierra el contrato vigente antes de abrir el
    -- nuevo. Si no traía fecha_fin, se le pone el día previo al inicio del que
    -- entra, para que el plazo quede acotado y sin solapes.
    -- LEAST y no COALESCE: si el contrato vigente ya traía una fecha_fin
    -- POSTERIOR al inicio del nuevo (renovación anticipada, salida antes de
    -- tiempo), conservarla dejaría dos plazos solapados sobre la misma unidad.
    -- Se recorta al día previo al inicio del que entra; si ya terminaba antes,
    -- se respeta su fecha.
    UPDATE public.contratos_arrendamiento
       SET estado    = 'terminado',
           fecha_fin = LEAST(COALESCE(fecha_fin, v_sol.fecha_inicio - 1), v_sol.fecha_inicio - 1)
     WHERE unidad_id = v_sol.unidad_id
       AND estado    = 'activo'
    RETURNING id INTO v_anterior;

    INSERT INTO public.contratos_arrendamiento (
      company_id, project_id, unidad_id,
      arrendatario_nombre, arrendatario_identificacion,
      arrendatario_telefono, arrendatario_email,
      monto_renta, dia_pago, fecha_inicio, fecha_fin,
      deposito, estado, notas,
      resp_mantenimiento, resp_agua, resp_electricidad,
      resp_basura, resp_telefonia, resp_internet
    ) VALUES (
      v_sol.company_id, v_sol.project_id, v_sol.unidad_id,
      btrim(v_sol.arrendatario_nombre), v_sol.arrendatario_identificacion,
      v_sol.arrendatario_telefono, v_sol.arrendatario_email,
      v_sol.monto_renta, COALESCE(v_sol.dia_pago, 1),
      v_sol.fecha_inicio, v_sol.fecha_fin,
      v_sol.deposito, 'activo', v_sol.notas_contrato,
      v_sol.resp_mantenimiento, v_sol.resp_agua, v_sol.resp_electricidad,
      v_sol.resp_basura, v_sol.resp_telefonia, v_sol.resp_internet
    )
    RETURNING id INTO v_contrato;

    UPDATE public.solicitud_renta_unidad
       SET contrato_id = v_contrato
     WHERE id = v_sol.id;
  END IF;

  RETURN jsonb_build_object(
    'contrato_id',                 v_contrato,
    'contrato_creado',             v_contrato IS NOT NULL,
    'contrato_anterior_terminado', v_anterior
  );
END;
$fn$;

REVOKE ALL ON FUNCTION public.aprobar_solicitud_renta(uuid, text, text, boolean, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.aprobar_solicitud_renta(uuid, text, text, boolean, text) TO authenticated;
COMMENT ON FUNCTION public.aprobar_solicitud_renta(uuid, text, text, boolean, text) IS
  'Aprueba una solicitud de renta pendiente. Con arrendamiento crea el contrato (falla si faltan datos), copia los seis responsables, cierra el contrato activo anterior recortando su fecha_fin para que no se solape, y enlaza contrato_id. Aprobar sin contrato exige justificación escrita. La identidad de auditoría sale de auth.uid(). Devuelve {contrato_id, contrato_creado, contrato_anterior_terminado}.';
