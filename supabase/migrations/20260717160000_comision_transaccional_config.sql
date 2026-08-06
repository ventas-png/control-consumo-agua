-- ============================================================================
-- Comisión transaccional configurable por empresa y canal (F7)
-- ============================================================================
-- Modelo SaaS: no hay UN pricing global — el superadmin configura la comisión
-- de la plataforma POR EMPRESA (y opcionalmente por canal de pago), y cada
-- cobro en línea la lee AL MOMENTO de crearse y la sella en el
-- payment_request. Como los cobros corren con credenciales PROPIAS del tenant
-- (payfac_secrets / company_payment_secrets), la plataforma no está en el
-- flujo del dinero y NO puede descontar en la fuente: la comisión es un
-- LEDGER facturable al tenant (agregable por mes). Si algún día Stripe migra
-- a Connect, esta misma config alimenta el application_fee.
--
--   1. comision_config — (company_id, canal) → pct + fijo + activo. Sin fila
--      (o inactiva) la empresa NO genera comisión (default seguro). El canal
--      'default' aplica a cualquier proveedor sin fila propia.
--   2. payment_requests.comision / comision_detalle — snapshot al crear el
--      cobro (los cambios de config solo afectan cobros futuros). Solo pagos
--      de ambiente prod generan comisión (sandbox/demo jamás factura).
--   3. superadmin_comisiones_resumen(p_company_id) — agregado mensual de
--      pagos succeeded con comisión, para el drawer del superadmin.
-- ============================================================================

-- ─── 1. Config por empresa+canal ─────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.comision_config (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid        NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  -- 'default' aplica a todo canal sin fila propia; los demás son overrides.
  canal      text        NOT NULL DEFAULT 'default'
                         CHECK (canal IN ('default', 'qpaypro', 'stripe', 'paypal')),
  activo     boolean     NOT NULL DEFAULT true,
  -- Porcentaje como fracción (0.025 = 2.5%). Tope 20%: sanity check contra
  -- typos (nadie cobra 25 "por ciento" escrito como 25).
  pct        numeric(6,4) NOT NULL DEFAULT 0 CHECK (pct >= 0 AND pct <= 0.2),
  -- Monto fijo por pago, en la MONEDA DEL COBRO del tenant (Q, USD…).
  fijo       numeric(12,2) NOT NULL DEFAULT 0 CHECK (fijo >= 0),
  notas      text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT comision_config_unica UNIQUE (company_id, canal)
);

CREATE INDEX IF NOT EXISTS idx_comision_config_company
  ON public.comision_config(company_id);

COMMENT ON TABLE public.comision_config IS
  'Comisión transaccional de la plataforma por empresa+canal (F7). La configura el superadmin; el tenant la puede LEER (transparencia). Sin fila o inactiva → comisión 0. Se sella por pago en payment_requests.comision al crear el cobro (solo ambiente prod).';

ALTER TABLE public.comision_config ENABLE ROW LEVEL SECURITY;

-- Lectura: superadmin + el propio tenant (debe poder ver qué se le cobra).
DROP POLICY IF EXISTS "comision_config_sel" ON public.comision_config;
CREATE POLICY "comision_config_sel" ON public.comision_config
  FOR SELECT TO authenticated
  USING (is_super_admin() OR company_id = get_my_company_id());

-- Escritura: SOLO superadmin — es el precio de la plataforma, no del tenant.
DROP POLICY IF EXISTS "comision_config_ins" ON public.comision_config;
CREATE POLICY "comision_config_ins" ON public.comision_config
  FOR INSERT TO authenticated WITH CHECK (is_super_admin());
DROP POLICY IF EXISTS "comision_config_upd" ON public.comision_config;
CREATE POLICY "comision_config_upd" ON public.comision_config
  FOR UPDATE TO authenticated USING (is_super_admin()) WITH CHECK (is_super_admin());
DROP POLICY IF EXISTS "comision_config_del" ON public.comision_config;
CREATE POLICY "comision_config_del" ON public.comision_config
  FOR DELETE TO authenticated USING (is_super_admin());

-- ─── 2. Snapshot en cada pago ────────────────────────────────────────────────

ALTER TABLE public.payment_requests
  ADD COLUMN IF NOT EXISTS comision numeric(12,2),
  ADD COLUMN IF NOT EXISTS comision_detalle jsonb;

COMMENT ON COLUMN public.payment_requests.comision IS
  'Comisión de plataforma sellada al CREAR el cobro (F7), en la moneda del cobro. NULL = sin comisión (config ausente/inactiva, pago sandbox, o fila anterior a F7).';
COMMENT ON COLUMN public.payment_requests.comision_detalle IS
  'Cómo se calculó: {canal, pct, fijo} de la config aplicada al momento del cobro.';

-- ─── 3. Resumen mensual para el superadmin ───────────────────────────────────

CREATE OR REPLACE FUNCTION public.superadmin_comisiones_resumen(p_company_id uuid)
RETURNS TABLE (
  mes            text,
  pagos          integer,
  monto_total    numeric,
  comision_total numeric
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'no autorizado' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
    SELECT to_char(date_trunc('month', pr.created_at), 'YYYY-MM') AS mes,
           count(*)::int                                          AS pagos,
           COALESCE(sum(pr.monto), 0)::numeric                    AS monto_total,
           COALESCE(sum(pr.comision), 0)::numeric                 AS comision_total
    FROM public.payment_requests pr
    WHERE pr.company_id = p_company_id
      AND pr.estado = 'succeeded'
      AND pr.comision IS NOT NULL
    GROUP BY 1
    ORDER BY 1 DESC
    LIMIT 6;
END
$$;

COMMENT ON FUNCTION public.superadmin_comisiones_resumen(uuid) IS
  'Agregado mensual (últimos 6 meses con actividad) de pagos succeeded con comisión de plataforma sellada, por empresa. Solo superadmin.';

REVOKE ALL ON FUNCTION public.superadmin_comisiones_resumen(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.superadmin_comisiones_resumen(uuid) TO authenticated;
