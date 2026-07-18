-- ============================================================================
-- Recargo por pago con tarjeta al cliente final (config del TENANT)
-- ============================================================================
-- Por qué: el cliente final pagaba EXACTAMENTE el monto del recibo/cuota
-- (create-charge / create-payment-intent) y el fee del payfac/tarjeta lo
-- absorbía el tenant en su liquidación. El recargo es decisión del TENANT (es
-- su contrato con el payfac), así que se configura por empresa+canal — misma
-- aritmética pct+fijo que comision_config (F7) pero con semántica OPUESTA:
--
--   · recargo_tarjeta_config — lo paga el CLIENTE FINAL encima del monto: el
--     proveedor cobra monto + recargo. El abono al recibo/cuota sigue siendo
--     el monto base (payment_requests.monto no cambia de semántica; la
--     conciliación de confirm-charge no se toca).
--   · comision_config (F7)   — take-rate de la PLATAFORMA facturable al
--     tenant (ledger). No confundir: no es el fee de tarjeta.
--
--   1. recargo_tarjeta_config — (company_id, canal) → pct + fijo + activo.
--      Sin fila (o inactiva) NO hay recargo (default seguro: nada cambia para
--      las empresas existentes). Escribe el company_owner; leen el tenant, el
--      superadmin y los clientes del portal (ven el desglose ANTES de pagar).
--   2. payment_requests.recargo / recargo_detalle — snapshot al crear el
--      cobro (cambios de config solo afectan cobros futuros). Aplica en TODOS
--      los ambientes: es el total del checkout, no facturación de plataforma.
--
-- Reversión: DROP TABLE public.recargo_tarjeta_config; las columnas nuevas de
-- payment_requests pueden quedarse (nullables e inocuas).
-- ============================================================================

-- ─── 1. Config por empresa+canal ─────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.recargo_tarjeta_config (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid        NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  -- 'default' aplica a todo canal sin fila propia; los demás son overrides.
  canal      text        NOT NULL DEFAULT 'default'
                         CHECK (canal IN ('default', 'qpaypro', 'stripe', 'paypal')),
  activo     boolean     NOT NULL DEFAULT true,
  -- Porcentaje como fracción (0.05 = 5%). Tope 20%: sanity check contra typos.
  pct        numeric(6,4) NOT NULL DEFAULT 0 CHECK (pct >= 0 AND pct <= 0.2),
  -- Monto fijo por pago, en la MONEDA DEL COBRO del tenant (Q, USD…).
  fijo       numeric(12,2) NOT NULL DEFAULT 0 CHECK (fijo >= 0),
  notas      text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT recargo_tarjeta_config_unica UNIQUE (company_id, canal)
);

CREATE INDEX IF NOT EXISTS idx_recargo_tarjeta_company
  ON public.recargo_tarjeta_config(company_id);

COMMENT ON TABLE public.recargo_tarjeta_config IS
  'Recargo por pago con tarjeta al CLIENTE FINAL, por empresa+canal. Lo configura el TENANT (company_owner) — es su contrato con el payfac. Se suma al total del checkout y se sella por pago en payment_requests.recargo; el abono al recibo/cuota sigue siendo el monto base. No confundir con comision_config (take-rate de la plataforma, F7).';

ALTER TABLE public.recargo_tarjeta_config ENABLE ROW LEVEL SECURITY;

-- Lectura: superadmin + el tenant + los clientes del portal de esa empresa
-- (necesitan el desglose antes de pagar). Mismo patrón que companies_select.
DROP POLICY IF EXISTS "recargo_tarjeta_sel" ON public.recargo_tarjeta_config;
CREATE POLICY "recargo_tarjeta_sel" ON public.recargo_tarjeta_config
  FOR SELECT TO authenticated
  USING (
    is_super_admin()
    OR company_id = get_my_company_id()
    OR (current_user_role() = 'cliente' AND EXISTS (
      SELECT 1 FROM company_clientes cc
      WHERE cc.company_id = recargo_tarjeta_config.company_id
        AND cc.cliente_id = get_my_cliente_id()
    ))
  );

-- Escritura: SOLO el dueño del tenant — es SU recargo, no de la plataforma.
DROP POLICY IF EXISTS "recargo_tarjeta_ins" ON public.recargo_tarjeta_config;
CREATE POLICY "recargo_tarjeta_ins" ON public.recargo_tarjeta_config
  FOR INSERT TO authenticated
  WITH CHECK (company_id = get_my_company_id() AND current_user_role() = 'company_owner');
DROP POLICY IF EXISTS "recargo_tarjeta_upd" ON public.recargo_tarjeta_config;
CREATE POLICY "recargo_tarjeta_upd" ON public.recargo_tarjeta_config
  FOR UPDATE TO authenticated
  USING (company_id = get_my_company_id() AND current_user_role() = 'company_owner')
  WITH CHECK (company_id = get_my_company_id() AND current_user_role() = 'company_owner');
DROP POLICY IF EXISTS "recargo_tarjeta_del" ON public.recargo_tarjeta_config;
CREATE POLICY "recargo_tarjeta_del" ON public.recargo_tarjeta_config
  FOR DELETE TO authenticated
  USING (company_id = get_my_company_id() AND current_user_role() = 'company_owner');

-- ─── 2. Snapshot en cada pago ────────────────────────────────────────────────

ALTER TABLE public.payment_requests
  ADD COLUMN IF NOT EXISTS recargo numeric(12,2),
  ADD COLUMN IF NOT EXISTS recargo_detalle jsonb;

COMMENT ON COLUMN public.payment_requests.recargo IS
  'Recargo por pago con tarjeta sellado al CREAR el cobro, en la moneda del cobro: el proveedor cobró monto + recargo. NULL = sin recargo (config ausente/inactiva o fila anterior a esta migración). El abono al recibo/cuota es `monto` (el recargo NO es parte de la deuda).';
COMMENT ON COLUMN public.payment_requests.recargo_detalle IS
  'Cómo se calculó el recargo: {canal, pct, fijo} de la config aplicada al momento del cobro.';
