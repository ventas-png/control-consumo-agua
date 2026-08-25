-- `aprobar_solicitud_renta` v2 — el contrato se crea SIEMPRE, la identidad de
-- auditoría es la del servidor, y el contrato anterior se cierra solo.
--
-- Qué cambia respecto de la v1 (20260828000200), y por qué:
--
--   • NO MÁS APROBACIÓN SILENCIOSA. La v1, si faltaban datos, aprobaba y
--     devolvía contrato_creado=false. La administración se quedaba creyendo que
--     tenía el contrato. Ahora, si se pidió el contrato y los datos no están,
--     la función FALLA y no aprueba nada.
--
--   • APROBAR SIN CONTRATO EXIGE JUSTIFICACIÓN. Solo existe para las
--     solicitudes heredadas (las que ya estaban pendientes antes de esta
--     feature y no traen datos). Se guarda en `motivo_sin_contrato` y la UI la
--     muestra destacada. El trigger de 20260829000000 la usa como escape.
--
--   • IDENTIDAD CONFIABLE. `p_aprobado_por` (texto que mandaba el cliente)
--     desaparece de la firma. Se registra `aprobado_por_user_id = auth.uid()` y
--     el nombre se lee de app_users en el servidor.
--
--   • HISTÓRICO DE CONTRATOS. Al cambiar de inquilino, el contrato vigente de
--     la unidad pasa a 'terminado' con su fecha_fin real y el nuevo nace
--     'activo'. NO se sobrescribe: la fila vieja conserva sus fechas, montos y
--     responsables, y la unidad queda con exactamente un contrato activo.
--
--   • RESPONSABLES. Los seis viajan de la solicitud al contrato.
--
-- Todo ocurre dentro de la función: cualquier RAISE revierte la aprobación, el
-- contrato, el cierre del anterior y el enlace contrato_id.
--
-- La firma cambia, así que hay que soltar la v1 (misma rama, sin mergear).
DROP FUNCTION IF EXISTS public.aprobar_solicitud_renta(uuid, text, text, text, boolean);

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
    UPDATE public.contratos_arrendamiento
       SET estado    = 'terminado',
           fecha_fin = COALESCE(fecha_fin, v_sol.fecha_inicio - 1)
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
  'Aprueba una solicitud de renta pendiente. Con arrendamiento crea el contrato (falla si faltan datos), copia los seis responsables, cierra el contrato activo anterior de la unidad y enlaza contrato_id. Aprobar sin contrato exige justificación escrita. La identidad de auditoría sale de auth.uid(). Devuelve {contrato_id, contrato_creado, contrato_anterior_terminado}.';
