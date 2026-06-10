-- ════════════════════════════════════════════════════════════════════════════
-- BANCOS Y CONCILIACIÓN — FASE 4 ERP · parte A: esquema
-- Ver ROADMAP_ERP_FINANZAS.md (Fase 4). Depende de la Fase 1 (conta_*).
--
--   cuentas_bancarias — bancos formales de la empresa, cada uno atado a su
--                       cuenta contable de detalle (da hogar a los bancos
--                       multimoneda de la Fase 1)
--   banco_movimientos — líneas del extracto importado (CSV/XLSX); estado
--                       pendiente → conciliado (match con pago / orden de
--                       pago / asiento de ajuste) o descartado
-- ════════════════════════════════════════════════════════════════════════════

-- ── 1. Cuentas bancarias ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.cuentas_bancarias (
  id                 uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id         uuid        NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  nombre             text        NOT NULL,  -- alias visible ("BI monetaria GTQ")
  banco              text        NOT NULL,  -- institución
  -- solo los últimos dígitos; nunca el número completo
  numero_mascara     text,
  -- ISO 4217; NULL = moneda base de la empresa
  moneda             text,
  cuenta_contable_id uuid        NOT NULL REFERENCES public.conta_cuentas(id) ON DELETE RESTRICT,
  activa             boolean     NOT NULL DEFAULT true,
  notas              text,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, nombre),
  -- dos bancos no comparten cuenta contable (el saldo libro sería ambiguo)
  UNIQUE (cuenta_contable_id)
);

CREATE INDEX IF NOT EXISTS idx_cuentas_bancarias_company ON public.cuentas_bancarias(company_id);

-- ── 2. Movimientos del extracto ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.banco_movimientos (
  id                 uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id         uuid          NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  cuenta_bancaria_id uuid          NOT NULL REFERENCES public.cuentas_bancarias(id) ON DELETE CASCADE,
  fecha              date          NOT NULL,
  descripcion        text,
  referencia         text,
  -- con signo, en la moneda de la cuenta bancaria: > 0 deposita, < 0 retira
  monto              numeric(14,2) NOT NULL CHECK (monto <> 0),
  -- agrupa las filas de una misma importación de extracto
  lote_id            uuid,
  estado             text          NOT NULL DEFAULT 'pendiente'
                     CHECK (estado IN ('pendiente','conciliado','descartado')),
  -- con qué se concilió: un pago recibido, una orden de pago a proveedor, o
  -- un asiento de ajuste (comisión/interés bancario)
  match_tipo         text CHECK (match_tipo IN ('pago','orden_pago','ajuste')),
  match_id           uuid,
  conciliado_por     uuid          REFERENCES auth.users(id) ON DELETE SET NULL,
  conciliado_at      timestamptz,
  created_at         timestamptz   NOT NULL DEFAULT now(),
  CHECK (estado <> 'conciliado' OR (match_tipo IS NOT NULL AND match_id IS NOT NULL))
);

-- Dedup de importaciones repetidas (cuando el extracto trae referencia).
CREATE UNIQUE INDEX IF NOT EXISTS uq_banco_mov_dedup
  ON public.banco_movimientos(cuenta_bancaria_id, fecha, monto, referencia)
  WHERE referencia IS NOT NULL;

-- Un pago/orden solo concilia con UN movimiento vivo.
CREATE UNIQUE INDEX IF NOT EXISTS uq_banco_mov_match
  ON public.banco_movimientos(match_tipo, match_id)
  WHERE estado = 'conciliado' AND match_tipo IN ('pago','orden_pago');

CREATE INDEX IF NOT EXISTS idx_banco_mov_cuenta ON public.banco_movimientos(cuenta_bancaria_id, fecha DESC);
CREATE INDEX IF NOT EXISTS idx_banco_mov_estado ON public.banco_movimientos(company_id, estado);
CREATE INDEX IF NOT EXISTS idx_banco_mov_conciliado_por ON public.banco_movimientos(conciliado_por);

-- ── 3. RLS ──────────────────────────────────────────────────────────────────
ALTER TABLE public.cuentas_bancarias ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.banco_movimientos ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['cuentas_bancarias','banco_movimientos'] LOOP
    EXECUTE format('DROP POLICY IF EXISTS "%s_select" ON public.%I', t, t);
    EXECUTE format($p$
      CREATE POLICY "%s_select" ON public.%I
        FOR SELECT TO authenticated
        USING (company_id = get_my_company_id() OR is_super_admin())
    $p$, t, t);

    EXECUTE format('DROP POLICY IF EXISTS "%s_insert" ON public.%I', t, t);
    EXECUTE format($p$
      CREATE POLICY "%s_insert" ON public.%I
        FOR INSERT TO authenticated
        WITH CHECK (is_super_admin() OR (current_user_role() = ANY(ARRAY['company_owner','admin'])
                    AND company_id = get_my_company_id()))
    $p$, t, t);

    EXECUTE format('DROP POLICY IF EXISTS "%s_update" ON public.%I', t, t);
    EXECUTE format($p$
      CREATE POLICY "%s_update" ON public.%I
        FOR UPDATE TO authenticated
        USING (is_super_admin() OR (current_user_role() = ANY(ARRAY['company_owner','admin'])
               AND company_id = get_my_company_id()))
        WITH CHECK (is_super_admin() OR (current_user_role() = ANY(ARRAY['company_owner','admin'])
                    AND company_id = get_my_company_id()))
    $p$, t, t);

    EXECUTE format('DROP POLICY IF EXISTS "%s_delete" ON public.%I', t, t);
    EXECUTE format($p$
      CREATE POLICY "%s_delete" ON public.%I
        FOR DELETE TO authenticated
        USING (is_super_admin() OR (current_user_role() = ANY(ARRAY['company_owner','admin'])
               AND company_id = get_my_company_id()))
    $p$, t, t);
  END LOOP;
END $$;

-- ── 4. Guarda: la conciliación pasa por las RPCs ────────────────────────────
-- El estado conciliado/desconciliado se maneja con banco_conciliar_movimiento /
-- banco_desconciliar_movimiento (validan tenant, duplicidad y existencia del
-- match). La edición directa solo permite pendiente ↔ descartado.
CREATE OR REPLACE FUNCTION public.banco_proteger_movimiento()
RETURNS trigger LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  IF current_setting('conta.allow_system_write', true) = 'on' THEN
    RETURN NEW;
  END IF;
  IF NEW.estado = 'conciliado' AND OLD.estado <> 'conciliado' THEN
    RAISE EXCEPTION 'BANCO_RPC: usa banco_conciliar_movimiento() para conciliar.'
      USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.estado = 'conciliado' AND NEW.estado <> 'conciliado' THEN
    RAISE EXCEPTION 'BANCO_RPC: usa banco_desconciliar_movimiento() para desconciliar.'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_banco_proteger_movimiento ON public.banco_movimientos;
CREATE TRIGGER trg_banco_proteger_movimiento
  BEFORE UPDATE ON public.banco_movimientos
  FOR EACH ROW EXECUTE FUNCTION public.banco_proteger_movimiento();

-- ── 5. Comentarios ──────────────────────────────────────────────────────────
COMMENT ON TABLE public.cuentas_bancarias IS
  'Bancos de la empresa (Fase 4 ERP), cada uno atado 1:1 a su cuenta contable de detalle. numero_mascara guarda solo los últimos dígitos.';
COMMENT ON TABLE public.banco_movimientos IS
  'Líneas de extracto bancario importadas. pendiente → conciliado (pago / orden_pago / asiento de ajuste) o descartado. Montos con signo en la moneda de la cuenta.';
