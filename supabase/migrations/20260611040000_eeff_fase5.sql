-- ════════════════════════════════════════════════════════════════════════════
-- ESTADOS FINANCIEROS Y CIERRE — FASE 5 ERP
-- Ver ROADMAP_ERP_FINANZAS.md (Fase 5). Depende de las Fases 1–4.
--
--   conta_estado_resultados — P&L por rango de periodos (desde la balanza)
--   conta_balance_general   — activo/pasivo/capital al cierre de un periodo,
--                             con el resultado del ejercicio integrado para
--                             que el balance CUADRE sin cierre anual previo
--   conta_flujo_efectivo    — entradas/salidas del periodo por cuenta de
--                             efectivo (caja/bancos/pasarelas)
--   conta_cierres_anuales + conta_cierre_anual — cierre formal del ejercicio:
--                             salda ingresos y gastos contra 3201/3101
--
-- Todas las lecturas son SECURITY INVOKER (la RLS de conta_* aplica sola) y
-- agregan 100 % en servidor.
-- ════════════════════════════════════════════════════════════════════════════

-- ── 0. Tipo de asiento 'cierre' ─────────────────────────────────────────────
-- El asiento de cierre anual lleva tipo propio para que el P&L pueda excluirlo
-- (si contara, el estado de resultados de un año cerrado saldría en ceros).
ALTER TABLE public.conta_asientos DROP CONSTRAINT IF EXISTS conta_asientos_tipo_check;
ALTER TABLE public.conta_asientos
  ADD CONSTRAINT conta_asientos_tipo_check
  CHECK (tipo IN ('diario','ingreso','egreso','apertura','cierre'));

-- ── 1. Estado de resultados (P&L) ───────────────────────────────────────────
-- Cuentas de resultados (ingreso/gasto) con su monto del rango, con signo por
-- naturaleza (ingreso = haber−debe; gasto = debe−haber). La UI agrupa y
-- totaliza: resultado = Σingresos − Σgastos.
CREATE OR REPLACE FUNCTION public.conta_estado_resultados(
  p_company_id uuid,
  p_project_id uuid,
  p_desde      text,  -- 'YYYY-MM' inclusive
  p_hasta      text   -- 'YYYY-MM' inclusive
)
RETURNS TABLE (
  cuenta_id uuid,
  codigo    text,
  nombre    text,
  tipo      text,
  monto     numeric
)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public, pg_temp AS $$
  SELECT
    c.id,
    c.codigo,
    c.nombre,
    c.tipo,
    SUM(CASE WHEN c.tipo = 'ingreso' THEN l.haber - l.debe
             ELSE l.debe - l.haber END)::numeric(14,2)
  FROM public.conta_asiento_lineas l
  JOIN public.conta_asientos a ON a.id = l.asiento_id
  JOIN public.conta_cuentas  c ON c.id = l.cuenta_id
  WHERE l.company_id = p_company_id
    AND a.estado = 'publicado'
    AND a.tipo <> 'cierre'
    AND a.periodo BETWEEN p_desde AND p_hasta
    AND c.tipo IN ('ingreso','gasto')
    AND (p_project_id IS NULL OR a.project_id = p_project_id)
  GROUP BY c.id, c.codigo, c.nombre, c.tipo
  HAVING SUM(CASE WHEN c.tipo = 'ingreso' THEN l.haber - l.debe
                  ELSE l.debe - l.haber END) <> 0
  ORDER BY c.codigo
$$;

REVOKE EXECUTE ON FUNCTION public.conta_estado_resultados(uuid, uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.conta_estado_resultados(uuid, uuid, text, text) TO authenticated;

-- ── 2. Balance general ──────────────────────────────────────────────────────
-- Saldos acumulados de activo/pasivo/capital al cierre del periodo (signo por
-- naturaleza) MÁS una fila sintética 'RESULTADO' con el neto acumulado de las
-- cuentas de resultados aún no cerradas: así Activo = Pasivo + Capital sin
-- requerir el cierre anual.
CREATE OR REPLACE FUNCTION public.conta_balance_general(
  p_company_id uuid,
  p_project_id uuid,
  p_periodo    text
)
RETURNS TABLE (
  cuenta_id uuid,
  codigo    text,
  nombre    text,
  tipo      text,
  saldo     numeric
)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public, pg_temp AS $$
  WITH lineas AS (
    SELECT l.cuenta_id, l.debe, l.haber
    FROM public.conta_asiento_lineas l
    JOIN public.conta_asientos a ON a.id = l.asiento_id
    WHERE l.company_id = p_company_id
      AND a.estado = 'publicado'
      AND a.periodo <= p_periodo
      AND (p_project_id IS NULL OR a.project_id = p_project_id)
  )
  SELECT
    c.id,
    c.codigo,
    c.nombre,
    c.tipo,
    SUM(CASE WHEN c.naturaleza = 'deudora' THEN x.debe - x.haber
             ELSE x.haber - x.debe END)::numeric(14,2)
  FROM lineas x
  JOIN public.conta_cuentas c ON c.id = x.cuenta_id
  WHERE c.tipo IN ('activo','pasivo','capital')
  GROUP BY c.id, c.codigo, c.nombre, c.tipo
  HAVING SUM(CASE WHEN c.naturaleza = 'deudora' THEN x.debe - x.haber
                  ELSE x.haber - x.debe END) <> 0
  UNION ALL
  -- Resultado neto = Σ(haber − debe) de las cuentas de resultados: los
  -- ingresos (saldo acreedor) suman y los gastos (saldo deudor) restan.
  SELECT
    NULL::uuid,
    'RESULTADO',
    'Resultado del periodo (sin cerrar)',
    'capital',
    COALESCE(SUM(x.haber - x.debe), 0)::numeric(14,2)
  FROM lineas x
  JOIN public.conta_cuentas c ON c.id = x.cuenta_id
  WHERE c.tipo IN ('ingreso','gasto')
  HAVING COALESCE(SUM(x.haber - x.debe), 0) <> 0
  ORDER BY 2
$$;

REVOKE EXECUTE ON FUNCTION public.conta_balance_general(uuid, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.conta_balance_general(uuid, uuid, text) TO authenticated;

-- ── 3. Flujo de efectivo (entradas/salidas por cuenta de dinero) ────────────
-- "Efectivo" = cuentas mapeadas a los eventos metodo_* (caja, bancos,
-- pasarelas) ∪ cuentas contables de cuentas_bancarias. Por cuenta: saldo
-- inicial, entradas (cargos), salidas (abonos) y saldo final del periodo.
CREATE OR REPLACE FUNCTION public.conta_flujo_efectivo(
  p_company_id uuid,
  p_project_id uuid,
  p_periodo    text
)
RETURNS TABLE (
  cuenta_id     uuid,
  codigo        text,
  nombre        text,
  saldo_inicial numeric,
  entradas      numeric,
  salidas       numeric,
  saldo_final   numeric
)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public, pg_temp AS $$
  WITH efectivo AS (
    SELECT DISTINCT cuenta_id FROM (
      SELECT m.cuenta_id
      FROM public.conta_mapeo_cuentas m
      WHERE m.company_id = p_company_id AND m.evento LIKE 'metodo_%'
      UNION
      SELECT cb.cuenta_contable_id
      FROM public.cuentas_bancarias cb
      WHERE cb.company_id = p_company_id
    ) q
  )
  SELECT
    c.id,
    c.codigo,
    c.nombre,
    COALESCE(SUM(CASE WHEN a.periodo < p_periodo THEN l.debe - l.haber END), 0)::numeric(14,2),
    COALESCE(SUM(CASE WHEN a.periodo = p_periodo THEN l.debe  END), 0)::numeric(14,2),
    COALESCE(SUM(CASE WHEN a.periodo = p_periodo THEN l.haber END), 0)::numeric(14,2),
    COALESCE(SUM(CASE WHEN a.periodo <= p_periodo THEN l.debe - l.haber END), 0)::numeric(14,2)
  FROM efectivo e
  JOIN public.conta_cuentas c ON c.id = e.cuenta_id
  LEFT JOIN public.conta_asiento_lineas l
    ON l.cuenta_id = e.cuenta_id AND l.company_id = p_company_id
  LEFT JOIN public.conta_asientos a
    ON a.id = l.asiento_id AND a.estado = 'publicado' AND a.periodo <= p_periodo
   AND (p_project_id IS NULL OR a.project_id = p_project_id)
  GROUP BY c.id, c.codigo, c.nombre
  ORDER BY c.codigo
$$;

REVOKE EXECUTE ON FUNCTION public.conta_flujo_efectivo(uuid, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.conta_flujo_efectivo(uuid, uuid, text) TO authenticated;

-- ── 4. Cierre anual ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.conta_cierres_anuales (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid        NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  anio       int         NOT NULL CHECK (anio BETWEEN 2000 AND 2100),
  asiento_id uuid        NOT NULL REFERENCES public.conta_asientos(id) ON DELETE RESTRICT,
  cerrado_por uuid       REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, anio)
);

ALTER TABLE public.conta_cierres_anuales ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "conta_cierres_anuales_select" ON public.conta_cierres_anuales;
CREATE POLICY "conta_cierres_anuales_select" ON public.conta_cierres_anuales
  FOR SELECT TO authenticated
  USING (company_id = get_my_company_id() OR is_super_admin());
-- escritura solo vía RPC (sin policies de INSERT/UPDATE/DELETE)

-- Cierra el ejercicio: un asiento al 31/12 que salda cada cuenta de
-- resultados (ingresos al debe, gastos al haber) contra 3201 Resultado del
-- ejercicio. Tras el cierre, el P&L del año siguiente arranca en cero y el
-- balance muestra el resultado en capital. Idempotente: un cierre por año.
CREATE OR REPLACE FUNCTION public.conta_cierre_anual(p_anio int)
RETURNS public.conta_asientos LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp AS $$
DECLARE
  v_company   uuid;
  v_cta3201   uuid;
  v_neto      numeric(14,2) := 0;
  v_asiento   public.conta_asientos;
  v_orden     int := 0;
  r           record;
BEGIN
  v_company := public.get_my_company_id();
  IF NOT (
    public.is_super_admin()
    OR (v_company IS NOT NULL
        AND public.current_user_role() = ANY(ARRAY['company_owner','admin']))
  ) THEN
    RAISE EXCEPTION 'no autorizado' USING ERRCODE = '42501';
  END IF;
  IF p_anio >= extract(year FROM CURRENT_DATE) THEN
    RAISE EXCEPTION 'Solo se cierran ejercicios terminados (año < %).', extract(year FROM CURRENT_DATE)
      USING ERRCODE = 'check_violation';
  END IF;
  IF EXISTS (SELECT 1 FROM public.conta_cierres_anuales WHERE company_id = v_company AND anio = p_anio) THEN
    RAISE EXCEPTION 'El ejercicio % ya está cerrado.', p_anio USING ERRCODE = 'check_violation';
  END IF;

  SELECT id INTO v_cta3201 FROM public.conta_cuentas
  WHERE company_id = v_company AND codigo = '3201' AND es_detalle;
  IF v_cta3201 IS NULL THEN
    RAISE EXCEPTION 'Falta la cuenta 3201 (Resultado del ejercicio) en el catálogo.'
      USING ERRCODE = 'check_violation';
  END IF;

  PERFORM set_config('conta.allow_system_write', 'on', true);

  INSERT INTO public.conta_asientos (
    company_id, project_id, fecha, tipo, concepto, estado, origen, moneda_base, created_by
  )
  VALUES (
    v_company, NULL, make_date(p_anio, 12, 31), 'cierre',
    'Cierre del ejercicio ' || p_anio, 'borrador', 'manual',
    public.conta_moneda_base(v_company), auth.uid()
  )
  RETURNING * INTO v_asiento;

  -- Salda cada cuenta de resultados con movimiento neto en el año.
  FOR r IN
    SELECT c.id AS cuenta_id, c.tipo,
           SUM(CASE WHEN c.tipo = 'ingreso' THEN l.haber - l.debe
                    ELSE l.debe - l.haber END)::numeric(14,2) AS neto
    FROM public.conta_asiento_lineas l
    JOIN public.conta_asientos a ON a.id = l.asiento_id
    JOIN public.conta_cuentas  c ON c.id = l.cuenta_id
    WHERE l.company_id = v_company
      AND a.estado = 'publicado'
      AND a.periodo BETWEEN p_anio::text || '-01' AND p_anio::text || '-12'
      AND c.tipo IN ('ingreso','gasto')
    GROUP BY c.id, c.tipo
    HAVING SUM(CASE WHEN c.tipo = 'ingreso' THEN l.haber - l.debe
                    ELSE l.debe - l.haber END) <> 0
  LOOP
    v_orden := v_orden + 1;
    -- ingreso con neto positivo se salda al DEBE; gasto al HABER (y al revés
    -- si el neto es negativo).
    INSERT INTO public.conta_asiento_lineas (
      asiento_id, company_id, cuenta_id, orden, descripcion, debe, haber
    )
    VALUES (
      v_asiento.id, v_company, r.cuenta_id, v_orden, 'Cierre ' || p_anio,
      CASE WHEN (r.tipo = 'ingreso') = (r.neto > 0) THEN abs(r.neto) ELSE 0 END,
      CASE WHEN (r.tipo = 'ingreso') = (r.neto > 0) THEN 0 ELSE abs(r.neto) END
    );
    v_neto := v_neto + CASE WHEN r.tipo = 'ingreso' THEN r.neto ELSE -r.neto END;
  END LOOP;

  IF v_orden = 0 THEN
    PERFORM set_config('conta.allow_system_write', 'off', true);
    RAISE EXCEPTION 'El ejercicio % no tiene movimientos de resultados que cerrar.', p_anio
      USING ERRCODE = 'check_violation';
  END IF;

  -- Contrapartida: utilidad (neto > 0) al haber de 3201; pérdida al debe.
  IF v_neto <> 0 THEN
    INSERT INTO public.conta_asiento_lineas (
      asiento_id, company_id, cuenta_id, orden, descripcion, debe, haber
    )
    VALUES (
      v_asiento.id, v_company, v_cta3201, v_orden + 1,
      CASE WHEN v_neto > 0 THEN 'Utilidad del ejercicio ' ELSE 'Pérdida del ejercicio ' END || p_anio,
      CASE WHEN v_neto < 0 THEN abs(v_neto) ELSE 0 END,
      CASE WHEN v_neto > 0 THEN v_neto ELSE 0 END
    );
  END IF;

  UPDATE public.conta_asientos
  SET estado = 'publicado',
      numero = public.conta_siguiente_folio(v_company),
      total_debe  = (SELECT COALESCE(SUM(debe), 0)  FROM public.conta_asiento_lineas WHERE asiento_id = v_asiento.id),
      total_haber = (SELECT COALESCE(SUM(haber), 0) FROM public.conta_asiento_lineas WHERE asiento_id = v_asiento.id),
      publicado_at = now(),
      updated_at = now()
  WHERE id = v_asiento.id
  RETURNING * INTO v_asiento;

  INSERT INTO public.conta_cierres_anuales (company_id, anio, asiento_id, cerrado_por)
  VALUES (v_company, p_anio, v_asiento.id, auth.uid());

  PERFORM set_config('conta.allow_system_write', 'off', true);
  RETURN v_asiento;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.conta_cierre_anual(int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.conta_cierre_anual(int) TO authenticated;

COMMENT ON TABLE public.conta_cierres_anuales IS
  'Cierres de ejercicio (Fase 5 ERP): un asiento publicado al 31/12 que salda ingresos/gastos contra 3201. Escritura solo vía conta_cierre_anual().';
