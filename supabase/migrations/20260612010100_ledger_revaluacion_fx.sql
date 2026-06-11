-- ════════════════════════════════════════════════════════════════════════════
-- LEDGER (entidad contable) · parte E: revaluación FX POR LEDGER
--
-- conta_revaluar_fx gana p_project_id: revalúa las cuentas con moneda propia
-- DEL LEDGER contra SU 3301, comparando contra la moneda base DEL LEDGER y
-- generando el asiento de ajuste en ese ledger. La firma vieja (date, boolean)
-- queda como wrapper del ledger empresa.
-- ════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.conta_revaluar_fx(
  p_fecha      date,
  p_aplicar    boolean,
  p_project_id uuid
)
RETURNS TABLE (
  cuenta_id       uuid,
  codigo          text,
  nombre          text,
  moneda          text,
  saldo_origen    numeric(14,2),
  tasa            numeric(12,6),
  saldo_libro     numeric(14,2),
  saldo_revaluado numeric(14,2),
  ajuste          numeric(14,2),
  resultado       text,
  asiento_id      uuid
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_company  uuid;
  v_base     text;
  v_3301     uuid;
  v_cta      record;
  v_moneda   text;
  v_tasa     numeric(12,6);
  v_origen   numeric(14,2);
  v_libro    numeric(14,2);
  v_reval    numeric(14,2);
  v_ajuste   numeric(14,2);
  v_lineas   jsonb;
  v_asiento  uuid;
BEGIN
  v_company := public.get_my_company_id();

  IF NOT (
    public.is_super_admin()
    OR (v_company IS NOT NULL
        AND public.current_user_role() = ANY(ARRAY['company_owner','admin']))
  ) THEN
    RAISE EXCEPTION 'no autorizado' USING ERRCODE = '42501';
  END IF;

  IF p_fecha > CURRENT_DATE THEN
    RAISE EXCEPTION 'La fecha de revaluación no puede ser futura.' USING ERRCODE = 'check_violation';
  END IF;

  -- Moneda base y 3301 DEL LEDGER.
  v_base := public.conta_moneda_base(v_company, p_project_id);

  SELECT c.id INTO v_3301
  FROM public.conta_cuentas c
  WHERE c.company_id = v_company AND c.codigo = '3301' AND c.es_detalle AND c.activa
    AND c.project_id IS NOT DISTINCT FROM p_project_id;
  IF p_aplicar AND v_3301 IS NULL THEN
    RAISE EXCEPTION 'Falta la cuenta 3301 (Diferencial cambiario) activa y de detalle en el catálogo de esta contabilidad.'
      USING ERRCODE = 'check_violation';
  END IF;

  FOR v_cta IN
    SELECT c.id, c.codigo AS cod, c.nombre AS nom, c.moneda AS mon, c.naturaleza
    FROM public.conta_cuentas c
    WHERE c.company_id = v_company
      AND c.project_id IS NOT DISTINCT FROM p_project_id
      AND c.es_detalle AND c.activa
      AND c.moneda IS NOT NULL
    ORDER BY c.codigo
  LOOP
    v_moneda := public.conta_normalizar_moneda(v_cta.mon);
    IF v_moneda IS NULL OR v_moneda = v_base THEN
      CONTINUE; -- cuenta en la moneda base del ledger: nada que revaluar
    END IF;

    -- Saldos al corte (asientos publicados DEL LEDGER), con el signo de la
    -- naturaleza. El saldo origen suma solo líneas con monto_origen.
    SELECT
      COALESCE(SUM(CASE WHEN v_cta.naturaleza = 'deudora' THEN l.debe - l.haber
                        ELSE l.haber - l.debe END), 0),
      COALESCE(SUM(CASE WHEN l.monto_origen IS NULL THEN 0
                        WHEN (l.debe > 0) = (v_cta.naturaleza = 'deudora') THEN l.monto_origen
                        ELSE -l.monto_origen END), 0)
    INTO v_libro, v_origen
    FROM public.conta_asiento_lineas l
    JOIN public.conta_asientos a ON a.id = l.asiento_id
    WHERE l.cuenta_id = v_cta.id
      AND a.estado = 'publicado'
      AND a.fecha <= p_fecha;

    -- Tasa de la moneda de la cuenta hacia la base DEL LEDGER (cruzada).
    v_tasa := public.conta_tasa_entre(v_company, v_moneda, v_base, p_fecha);

    cuenta_id    := v_cta.id;
    codigo       := v_cta.cod;
    nombre       := v_cta.nom;
    moneda       := v_moneda;
    saldo_origen := v_origen;
    saldo_libro  := v_libro;
    asiento_id   := NULL;

    IF v_tasa IS NULL THEN
      tasa := NULL; saldo_revaluado := NULL; ajuste := NULL;
      resultado := 'sin_tasa';
      RETURN NEXT;
      CONTINUE;
    END IF;

    v_reval  := round(v_origen * v_tasa, 2);
    v_ajuste := v_reval - v_libro;

    tasa := v_tasa;
    saldo_revaluado := v_reval;
    ajuste := v_ajuste;

    IF v_ajuste = 0 THEN
      resultado := 'sin_cambio';
      RETURN NEXT;
      CONTINUE;
    END IF;

    IF NOT p_aplicar THEN
      resultado := 'previsualizacion';
      RETURN NEXT;
      CONTINUE;
    END IF;

    IF (v_ajuste > 0) = (v_cta.naturaleza = 'deudora') THEN
      v_lineas := jsonb_build_array(
        jsonb_build_object('cuenta_id', v_cta.id, 'debe',  abs(v_ajuste),
                           'descripcion', 'Revaluación ' || v_moneda || ' @ ' || v_tasa),
        jsonb_build_object('cuenta_id', v_3301,  'haber', abs(v_ajuste),
                           'descripcion', 'Diferencial cambiario ' || v_cta.cod)
      );
    ELSE
      v_lineas := jsonb_build_array(
        jsonb_build_object('cuenta_id', v_cta.id, 'haber', abs(v_ajuste),
                           'descripcion', 'Revaluación ' || v_moneda || ' @ ' || v_tasa),
        jsonb_build_object('cuenta_id', v_3301,  'debe',  abs(v_ajuste),
                           'descripcion', 'Diferencial cambiario ' || v_cta.cod)
      );
    END IF;

    v_asiento := public.conta_generar_asiento(
      v_company,
      p_project_id,
      'conta_revaluacion_fx',
      v_cta.id,
      'fx_' || to_char(p_fecha, 'YYYY-MM-DD'),
      p_fecha,
      'Revaluación FX ' || v_cta.cod || ' ' || v_cta.nom || ' (' || v_moneda || ' @ ' || v_tasa || ')',
      'diario',
      v_base,
      v_lineas
    );

    asiento_id := v_asiento;
    resultado  := CASE WHEN v_asiento IS NULL THEN 'ya_revaluado' ELSE 'ajustado' END;
    RETURN NEXT;
  END LOOP;

  RETURN;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.conta_revaluar_fx(date, boolean, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.conta_revaluar_fx(date, boolean, uuid) TO authenticated;

-- Wrapper de compat (ledger empresa) para el frontend previo. La versión
-- anterior tenía DEFAULTs (no removibles con CREATE OR REPLACE): drop +
-- recreación conservándolos — sin ambigüedad PostgREST porque la firma de
-- 3 args no tiene defaults.
DROP FUNCTION IF EXISTS public.conta_revaluar_fx(date, boolean);
CREATE FUNCTION public.conta_revaluar_fx(p_fecha date DEFAULT CURRENT_DATE, p_aplicar boolean DEFAULT false)
RETURNS TABLE (
  cuenta_id       uuid,
  codigo          text,
  nombre          text,
  moneda          text,
  saldo_origen    numeric(14,2),
  tasa            numeric(12,6),
  saldo_libro     numeric(14,2),
  saldo_revaluado numeric(14,2),
  ajuste          numeric(14,2),
  resultado       text,
  asiento_id      uuid
)
LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT * FROM public.conta_revaluar_fx(p_fecha, p_aplicar, NULL)
$$;

COMMENT ON FUNCTION public.conta_revaluar_fx(date, boolean, uuid) IS
  'Revaluación FX del ledger (empresa con project NULL, o proyecto): cuentas con moneda propia contra el 3301 del ledger, a la tasa cruzada hacia la base del ledger.';

REVOKE EXECUTE ON FUNCTION public.conta_revaluar_fx(date, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.conta_revaluar_fx(date, boolean) TO authenticated;
