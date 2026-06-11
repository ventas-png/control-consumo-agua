-- ════════════════════════════════════════════════════════════════════════════
-- LEDGER (entidad contable) · parte F: bancos y conciliación POR LEDGER
--
--   · cuentas_bancarias gana project_id: cada banco pertenece a una
--     contabilidad (NULL = empresa). Las existentes quedan en el ledger
--     empresa (coherente con la migración de asientos pre-ledger).
--   · Su cuenta contable debe ser una cuenta de detalle DEL MISMO ledger
--     (trigger de validación).
--   · banco_ajuste_conciliacion asienta en el ledger del banco (antes
--     siempre en empresa) — los mapeos gasto_otros/ingreso_otros se
--     resuelven en ese ledger.
--   · banco_sugerencias_conciliacion filtra candidatos por el ledger del
--     banco: pagos del proyecto del banco; órdenes de pago del mismo ámbito.
-- ════════════════════════════════════════════════════════════════════════════

-- ── 1. Banco por ledger ─────────────────────────────────────────────────────
ALTER TABLE public.cuentas_bancarias
  ADD COLUMN IF NOT EXISTS project_id uuid REFERENCES public.projects(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_cuentas_bancarias_ledger
  ON public.cuentas_bancarias(company_id, project_id);

-- La cuenta contable del banco debe pertenecer al MISMO ledger.
CREATE OR REPLACE FUNCTION public.banco_tg_cuenta_mismo_ledger()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.conta_cuentas c
    WHERE c.id = NEW.cuenta_contable_id
      AND c.company_id = NEW.company_id
      AND c.project_id IS NOT DISTINCT FROM NEW.project_id
      AND c.es_detalle
  ) THEN
    RAISE EXCEPTION 'BANCO_LEDGER: la cuenta contable no pertenece a la contabilidad (empresa/proyecto) de la cuenta bancaria.'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_banco_cuenta_mismo_ledger ON public.cuentas_bancarias;
CREATE TRIGGER trg_banco_cuenta_mismo_ledger
  BEFORE INSERT OR UPDATE OF cuenta_contable_id, project_id ON public.cuentas_bancarias
  FOR EACH ROW EXECUTE FUNCTION public.banco_tg_cuenta_mismo_ledger();

-- ── 2. Ajuste de conciliación: asienta en el ledger del banco ───────────────
CREATE OR REPLACE FUNCTION public.banco_ajuste_conciliacion(
  p_movimiento_id uuid,
  p_descripcion   text DEFAULT NULL
)
RETURNS public.banco_movimientos LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp AS $$
DECLARE
  v_mov     public.banco_movimientos;
  v_cuenta  public.cuentas_bancarias;
  v_monto   numeric(14,2);
  v_asiento uuid;
  v_lineas  jsonb;
BEGIN
  SELECT * INTO v_mov FROM public.banco_movimientos WHERE id = p_movimiento_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Movimiento no encontrado.' USING ERRCODE = 'no_data_found';
  END IF;
  IF NOT (
    public.is_super_admin()
    OR (v_mov.company_id = public.get_my_company_id()
        AND public.current_user_role() = ANY(ARRAY['company_owner','admin']))
  ) THEN
    RAISE EXCEPTION 'no autorizado' USING ERRCODE = '42501';
  END IF;
  IF v_mov.estado <> 'pendiente' THEN
    RAISE EXCEPTION 'Solo un movimiento pendiente admite ajuste (estado: %).', v_mov.estado
      USING ERRCODE = 'check_violation';
  END IF;

  SELECT * INTO v_cuenta FROM public.cuentas_bancarias WHERE id = v_mov.cuenta_bancaria_id;
  v_monto := abs(v_mov.monto);

  IF v_mov.monto < 0 THEN
    -- Cargo bancario (comisión): gasto contra banco.
    v_lineas := jsonb_build_array(
      jsonb_build_object('evento', 'gasto_otros', 'debe', v_monto,
                         'descripcion', COALESCE(p_descripcion, v_mov.descripcion)),
      jsonb_build_object('cuenta_id', v_cuenta.cuenta_contable_id, 'haber', v_monto)
    );
  ELSE
    -- Abono bancario (intereses): banco contra otros ingresos.
    v_lineas := jsonb_build_array(
      jsonb_build_object('cuenta_id', v_cuenta.cuenta_contable_id, 'debe', v_monto),
      jsonb_build_object('evento', 'ingreso_otros', 'haber', v_monto,
                         'descripcion', COALESCE(p_descripcion, v_mov.descripcion))
    );
  END IF;

  -- El asiento vive en el LEDGER del banco (antes: siempre empresa).
  v_asiento := public.conta_generar_asiento(
    v_mov.company_id, v_cuenta.project_id, 'banco_movimientos', v_mov.id, 'banco_ajuste',
    v_mov.fecha,
    'Ajuste bancario ' || v_cuenta.nombre || ' — ' ||
      COALESCE(p_descripcion, v_mov.descripcion, CASE WHEN v_mov.monto < 0 THEN 'comisión' ELSE 'intereses' END),
    CASE WHEN v_mov.monto < 0 THEN 'egreso' ELSE 'ingreso' END,
    v_cuenta.moneda,
    v_lineas
  );
  IF v_asiento IS NULL THEN
    RAISE EXCEPTION 'No se pudo generar la póliza de ajuste (revisa mapeos contables y tipos de cambio).'
      USING ERRCODE = 'check_violation';
  END IF;

  PERFORM set_config('conta.allow_system_write', 'on', true);
  UPDATE public.banco_movimientos
  SET estado = 'conciliado', match_tipo = 'ajuste', match_id = v_asiento,
      conciliado_por = auth.uid(), conciliado_at = now()
  WHERE id = p_movimiento_id
  RETURNING * INTO v_mov;
  PERFORM set_config('conta.allow_system_write', 'off', true);

  RETURN v_mov;
END;
$$;

-- ── 3. Sugerencias acotadas al ledger del banco ─────────────────────────────
DROP FUNCTION IF EXISTS public.banco_sugerencias_conciliacion(uuid);

CREATE FUNCTION public.banco_sugerencias_conciliacion(p_cuenta_bancaria_id uuid)
RETURNS TABLE (
  movimiento_id         uuid,
  candidato_tipo        text,
  candidato_id          uuid,
  candidato_fecha       date,
  candidato_monto       numeric,
  candidato_descripcion text,
  confianza             text
)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public, pg_temp AS $$
  WITH cta AS (
    SELECT cb.* FROM public.cuentas_bancarias cb WHERE cb.id = p_cuenta_bancaria_id
  ),
  mov AS (
    SELECT m.* FROM public.banco_movimientos m
    WHERE m.cuenta_bancaria_id = p_cuenta_bancaria_id AND m.estado = 'pendiente'
  )
  -- Ingresos ↔ pagos de clientes DEL LEDGER del banco (los cobros pertenecen
  -- al proyecto que factura; un banco de empresa no sugiere pagos de proyectos).
  SELECT
    mov.id, 'pago', p.id,
    COALESCE(p.verified_at::date, p.created_at::date),
    p.monto,
    'Pago ' || p.metodo || COALESCE(' ref. ' || NULLIF(p.referencia, ''), ''),
    CASE WHEN p.monto = mov.monto
              AND abs(COALESCE(p.verified_at::date, p.created_at::date) - mov.fecha) <= 3
         THEN 'exacta' ELSE 'aproximada' END
  FROM mov
  CROSS JOIN cta
  JOIN public.pagos p
    ON p.estado IN ('verificado','aplicado')
   AND p.deleted_at IS NULL
   AND (
         (p.monto = mov.monto
          AND abs(COALESCE(p.verified_at::date, p.created_at::date) - mov.fecha) <= 7)
      OR (p.monto <> mov.monto
          AND abs(p.monto - mov.monto) <= GREATEST(1.00, abs(mov.monto) * 0.005)
          AND abs(COALESCE(p.verified_at::date, p.created_at::date) - mov.fecha) <= 3)
       )
   AND p.project_id IS NOT DISTINCT FROM cta.project_id
  JOIN public.projects pr ON pr.id = p.project_id AND pr.company_id = mov.company_id
  WHERE mov.monto > 0
    AND NOT EXISTS (
      SELECT 1 FROM public.banco_movimientos x
      WHERE x.match_tipo = 'pago' AND x.match_id = p.id AND x.estado = 'conciliado'
    )
  UNION ALL
  -- Egresos ↔ órdenes de pago DEL LEDGER del banco.
  SELECT
    mov.id, 'orden_pago', o.id,
    o.fecha_pago,
    -o.monto,
    'Pago a proveedor' || COALESCE(' ref. ' || NULLIF(o.referencia, ''), ''),
    CASE WHEN o.monto = -mov.monto AND abs(o.fecha_pago - mov.fecha) <= 3
         THEN 'exacta' ELSE 'aproximada' END
  FROM mov
  CROSS JOIN cta
  JOIN public.ordenes_pago o
    ON o.estado = 'pagada'
   AND o.company_id = mov.company_id
   AND o.fecha_pago IS NOT NULL
   AND (
         (o.monto = -mov.monto AND abs(o.fecha_pago - mov.fecha) <= 7)
      OR (o.monto <> -mov.monto
          AND abs(o.monto - (-mov.monto)) <= GREATEST(1.00, abs(mov.monto) * 0.005)
          AND abs(o.fecha_pago - mov.fecha) <= 3)
       )
   AND o.project_id IS NOT DISTINCT FROM cta.project_id
  WHERE mov.monto < 0
    AND NOT EXISTS (
      SELECT 1 FROM public.banco_movimientos x
      WHERE x.match_tipo = 'orden_pago' AND x.match_id = o.id AND x.estado = 'conciliado'
    )
  -- Exactas primero dentro de cada movimiento ('exacta' > 'aproximada').
  ORDER BY 1, 7 DESC, 4
$$;

REVOKE EXECUTE ON FUNCTION public.banco_sugerencias_conciliacion(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.banco_sugerencias_conciliacion(uuid) TO authenticated;

COMMENT ON COLUMN public.cuentas_bancarias.project_id IS
  'Ledger dueño del banco: NULL = contabilidad de la empresa; uuid = contabilidad del proyecto. Su cuenta contable y conciliación pertenecen a ese ledger.';
