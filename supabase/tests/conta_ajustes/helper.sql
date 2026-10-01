-- ============================================================================
-- AYUDANTE DE ARNÉS · ejecutar una operación POR EL FLUJO DE SOLICITUDES
--
-- Desde 20261011000000 anular un cobro de cargo, un anticipo o un cargo, y
-- revertir una aplicación de saldo a favor, sólo se hace con una solicitud
-- aprobada por OTRA persona. Las suites anteriores probaban esas operaciones
-- llamándolas directo; ahora pasan por aquí, que hace lo que haría la
-- aplicación: la sesión actual SOLICITA y un aprobador de la misma empresa
-- APRUEBA (y así se ejecuta). Si la ejecución falla, se relanza el motivo
-- del servidor, igual que antes lanzaba la RPC directa.
--
-- El aprobador es un usuario sintético con rol admin de la empresa de la
-- sesión, creado la primera vez.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.tst_ajuste_aprobador()
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_company uuid := public.get_my_company_id();
  v_id      uuid;
BEGIN
  IF v_company IS NULL THEN
    RAISE EXCEPTION 'tst_ajuste_aprobador: la sesión no tiene empresa';
  END IF;
  v_id := (substr(md5('aprobador:' || v_company::text), 1, 8) || '-0000-4000-8000-' ||
           substr(md5('aprobador:' || v_company::text), 9, 12))::uuid;
  INSERT INTO auth.users (id) VALUES (v_id) ON CONFLICT DO NOTHING;
  INSERT INTO public.app_users (id, company_id, full_name, role)
  VALUES (v_id, v_company, 'SINT Aprobador de ajustes', 'admin') ON CONFLICT (id) DO NOTHING;
  INSERT INTO public.user_project_assignments (user_id, project_id, permission_type)
  SELECT v_id, p.id, 'total' FROM public.projects p
   WHERE p.company_id = v_company
     AND NOT EXISTS (SELECT 1 FROM public.user_project_assignments x WHERE x.user_id = v_id AND x.project_id = p.id);
  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.tst_ajuste(
  p_tipo    text,
  p_tabla   text,
  p_id      uuid,
  p_motivo  text,
  p_origen  uuid DEFAULT NULL,
  p_importe numeric DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql SET search_path = public AS $$
DECLARE
  v_sol uuid := gen_random_uuid();
  v_yo  text := current_setting('request.jwt.claim.sub', true);
  v_ap  uuid;
  v_r   record;
BEGIN
  PERFORM public.conta_ajuste_solicitar(v_sol, p_tipo, p_tabla, p_id, p_motivo, p_origen, p_importe);
  v_ap := public.tst_ajuste_aprobador();
  PERFORM set_config('request.jwt.claim.sub', v_ap::text, false);
  BEGIN
    SELECT * INTO v_r FROM public.conta_ajuste_aprobar(v_sol);
  EXCEPTION WHEN OTHERS THEN
    PERFORM set_config('request.jwt.claim.sub', v_yo, false);
    RAISE;
  END;
  PERFORM set_config('request.jwt.claim.sub', v_yo, false);
  IF v_r.estado <> 'ejecutada' THEN
    RAISE EXCEPTION '%', v_r.error_ejecucion;
  END IF;
  RETURN v_r.resultado;
END;
$$;

-- Mismas columnas que las RPC que reemplazan.
CREATE OR REPLACE FUNCTION public.tst_anular_cobro_cargo(p_pago_id uuid, p_motivo text)
RETURNS TABLE (pago_id uuid, resultado text, asiento_id uuid, reverso_id uuid,
               reverso_numero bigint, estado_cargo text, cobros_pendientes bigint)
LANGUAGE sql SET search_path = public AS $$
  SELECT r.* FROM jsonb_to_record(public.tst_ajuste('anular_cobro_cargo', 'pagos', p_pago_id, p_motivo))
    AS r(pago_id uuid, resultado text, asiento_id uuid, reverso_id uuid,
         reverso_numero bigint, estado_cargo text, cobros_pendientes bigint)
$$;

CREATE OR REPLACE FUNCTION public.tst_anular_anticipo(p_pago_id uuid, p_motivo text)
RETURNS TABLE (pago_id uuid, resultado text, asiento_id uuid, reverso_id uuid, reverso_numero bigint)
LANGUAGE sql SET search_path = public AS $$
  SELECT r.* FROM jsonb_to_record(public.tst_ajuste('anular_anticipo', 'pagos', p_pago_id, p_motivo))
    AS r(pago_id uuid, resultado text, asiento_id uuid, reverso_id uuid, reverso_numero bigint)
$$;

CREATE OR REPLACE FUNCTION public.tst_revertir_aplicacion_saldo_favor(p_aplicacion_id uuid, p_motivo text)
RETURNS TABLE (aplicacion_id uuid, resultado text, reverso_id uuid, reverso_numero bigint,
               disponible_restante numeric, estado_documento text)
LANGUAGE sql SET search_path = public AS $$
  SELECT r.* FROM jsonb_to_record(public.tst_ajuste('revertir_aplicacion_saldo_favor',
                                                    'conta_saldo_favor_aplicaciones', p_aplicacion_id, p_motivo))
    AS r(aplicacion_id uuid, resultado text, reverso_id uuid, reverso_numero bigint,
         disponible_restante numeric, estado_documento text)
$$;

CREATE OR REPLACE FUNCTION public.tst_anular_cargo(p_cargo_id uuid, p_motivo text)
RETURNS jsonb
LANGUAGE sql SET search_path = public AS $$
  SELECT public.tst_ajuste('anular_cargo', 'cargos_adicionales_unidad', p_cargo_id, p_motivo)
$$;

GRANT EXECUTE ON FUNCTION public.tst_ajuste_aprobador() TO authenticated;
GRANT EXECUTE ON FUNCTION public.tst_ajuste(text, text, uuid, text, uuid, numeric) TO authenticated;
GRANT EXECUTE ON FUNCTION public.tst_anular_cobro_cargo(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.tst_anular_anticipo(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.tst_revertir_aplicacion_saldo_favor(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.tst_anular_cargo(uuid, text) TO authenticated;
