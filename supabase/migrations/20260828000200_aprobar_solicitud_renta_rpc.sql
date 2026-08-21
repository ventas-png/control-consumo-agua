-- Aprobar una solicitud de renta y —opcionalmente— crear el contrato de
-- arrendamiento con los datos que el propietario ya envió (20260828000000).
--
-- POR QUÉ UN SECURITY DEFINER Y NO UN UPDATE DESDE EL CLIENTE:
--
--   1) PERMISOS CRUZADOS. Resolver la solicitud exige
--      `condominios.tab.solicitudes_renta` (20260518000012), pero insertar en
--      `contratos_arrendamiento` exige `condominios.tab.arrendamientos`
--      (20260519000003:211). Un aprobador con el primero y sin el segundo no
--      podría crear el contrato — y quien evalúa autorizaciones de renta no
--      necesariamente administra los contratos.
--
--   2) ATOMICIDAD. Aprobar y crear el contrato deben ir en la misma transacción:
--      una aprobación con el insert fallido dejaría a la administración creyendo
--      que el contrato existe.
--
-- El RECHAZO sigue por el UPDATE normal (RLS de staff): no toca otra tabla.
--
-- El FOR UPDATE serializa contra `portal_baja_renta` (20260827000000): si el
-- propietario retira la solicitud mientras el admin aprueba, uno de los dos ve
-- el estado ya cambiado y falla con mensaje claro.

CREATE OR REPLACE FUNCTION public.aprobar_solicitud_renta(
  p_solicitud_id   uuid,
  p_tipo_aprobado  text,
  p_comentario     text    DEFAULT NULL,
  p_aprobado_por   text    DEFAULT NULL,
  p_crear_contrato boolean DEFAULT true
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $fn$
DECLARE
  v_sol        public.solicitud_renta_unidad%ROWTYPE;
  v_contrato   uuid := NULL;
  v_datos_ok   boolean;
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

  -- Autorización: el mismo gate que la RLS de staff sobre la tabla.
  IF NOT (
    public.is_super_admin()
    OR (v_sol.company_id = public.get_my_company_id()
        AND public.user_has_permission('condominios.tab.solicitudes_renta'))
  ) THEN
    RAISE EXCEPTION 'No autorizado para resolver solicitudes de renta.';
  END IF;

  IF v_sol.estado <> 'pendiente' THEN
    RAISE EXCEPTION 'La solicitud ya no está pendiente (estado actual: %).', v_sol.estado;
  END IF;

  UPDATE public.solicitud_renta_unidad
     SET estado           = 'aprobada',
         tipo_aprobado    = p_tipo_aprobado,
         comentario_admin = NULLIF(btrim(COALESCE(p_comentario, '')), ''),
         aprobado_por     = NULLIF(btrim(COALESCE(p_aprobado_por, '')), ''),
         fecha_resolucion = now()
   WHERE id = v_sol.id;

  -- El contrato solo tiene sentido si la autorización cubre arrendamiento y el
  -- propietario mandó los tres datos que `contratos_arrendamiento` exige NOT NULL.
  v_datos_ok := v_sol.arrendatario_nombre IS NOT NULL
            AND btrim(v_sol.arrendatario_nombre) <> ''
            AND v_sol.monto_renta  IS NOT NULL
            AND v_sol.fecha_inicio IS NOT NULL;

  IF p_crear_contrato
     AND p_tipo_aprobado IN ('arrendamiento', 'ambas')
     AND v_datos_ok THEN
    INSERT INTO public.contratos_arrendamiento (
      company_id, project_id, unidad_id,
      arrendatario_nombre, arrendatario_identificacion,
      arrendatario_telefono, arrendatario_email,
      monto_renta, dia_pago, fecha_inicio, fecha_fin,
      deposito, estado, notas
    ) VALUES (
      v_sol.company_id, v_sol.project_id, v_sol.unidad_id,
      btrim(v_sol.arrendatario_nombre), v_sol.arrendatario_identificacion,
      v_sol.arrendatario_telefono, v_sol.arrendatario_email,
      v_sol.monto_renta, COALESCE(v_sol.dia_pago, 1),
      v_sol.fecha_inicio, v_sol.fecha_fin,
      v_sol.deposito, 'activo', v_sol.notas_contrato
    )
    RETURNING id INTO v_contrato;

    UPDATE public.solicitud_renta_unidad
       SET contrato_id = v_contrato
     WHERE id = v_sol.id;
  END IF;

  RETURN jsonb_build_object(
    'contrato_id',     v_contrato,
    'contrato_creado', v_contrato IS NOT NULL
  );
END;
$fn$;

REVOKE ALL ON FUNCTION public.aprobar_solicitud_renta(uuid, text, text, text, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.aprobar_solicitud_renta(uuid, text, text, text, boolean) TO authenticated;
COMMENT ON FUNCTION public.aprobar_solicitud_renta(uuid, text, text, text, boolean) IS
  'Aprueba una solicitud de renta pendiente y, si la autorización cubre arrendamiento y el propietario envió nombre/monto/fecha de inicio, crea el contrato en contratos_arrendamiento enlazándolo en solicitud_renta_unidad.contrato_id. Devuelve {contrato_id, contrato_creado}.';
