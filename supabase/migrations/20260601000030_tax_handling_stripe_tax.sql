-- ============================================================================
-- F4.3.4 — Tax handling con Stripe Tax (LATAM-ready)
-- ============================================================================
-- Agrega campos de país, tax_id y address a `companies` (para Stripe Tax y
-- factura fiscal). Agrega snapshot de tax al modelo `invoices` (subtotal,
-- impuesto, tax_id del cliente al momento de cobro, país facturado).
--
-- Stripe Tax calcula IVA/VAT automáticamente cuando:
--   1. `automatic_tax: { enabled: true }` en checkout/subscription
--   2. customer.address está configurado (country mínimo)
--   3. Stripe Tax habilitado en Dashboard → Settings → Tax
-- ============================================================================

-- ── companies: datos fiscales del tenant ──────────────────────────────────
ALTER TABLE public.companies
  ADD COLUMN IF NOT EXISTS country            varchar(2),
  ADD COLUMN IF NOT EXISTS tax_id             text,
  ADD COLUMN IF NOT EXISTS tax_id_type        text,
  ADD COLUMN IF NOT EXISTS address_line1      text,
  ADD COLUMN IF NOT EXISTS address_city       text,
  ADD COLUMN IF NOT EXISTS address_state      text,
  ADD COLUMN IF NOT EXISTS address_postal_code text;

-- ISO 3166-1 alpha-2 (MX, GT, CR, CO, AR, etc.) — validamos formato
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE table_schema = 'public' AND table_name = 'companies'
      AND constraint_name = 'companies_country_format_chk'
  ) THEN
    ALTER TABLE public.companies
      ADD CONSTRAINT companies_country_format_chk
      CHECK (country IS NULL OR country ~ '^[A-Z]{2}$');
  END IF;
END $$;

-- tax_id_type acotado a los tipos comunes en LATAM + genéricos. Mantengo
-- 'other' como escape para casos no contemplados.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE table_schema = 'public' AND table_name = 'companies'
      AND constraint_name = 'companies_tax_id_type_chk'
  ) THEN
    ALTER TABLE public.companies
      ADD CONSTRAINT companies_tax_id_type_chk
      CHECK (tax_id_type IS NULL OR tax_id_type IN (
        -- LATAM
        'mx_rfc',    -- México
        'gt_nit',    -- Guatemala
        'cr_tin',    -- Costa Rica
        'co_nit',    -- Colombia
        'ar_cuit',   -- Argentina
        'cl_tin',    -- Chile
        'pe_ruc',    -- Perú
        'uy_rut',    -- Uruguay
        'do_rcn',    -- República Dominicana
        'ec_ruc',    -- Ecuador
        'sv_nit',    -- El Salvador
        'pa_ruc',    -- Panamá
        'br_cnpj',   -- Brasil empresa
        'br_cpf',    -- Brasil persona
        -- Internacionales
        'us_ein',
        'eu_vat',
        'gb_vat',
        'other'
      ));
  END IF;
END $$;

COMMENT ON COLUMN public.companies.country IS 'ISO 3166-1 alpha-2 country code (MX, GT, CR, etc.). Usado por Stripe Tax.';
COMMENT ON COLUMN public.companies.tax_id IS 'RFC/NIT/RUT/CUIT del tenant (formato según tax_id_type).';
COMMENT ON COLUMN public.companies.tax_id_type IS 'Tipo de tax_id alineado con Stripe Tax IDs (mx_rfc, gt_nit, etc.).';

-- ── invoices: snapshot del cobro con desglose tax ─────────────────────────
ALTER TABLE public.invoices
  ADD COLUMN IF NOT EXISTS subtotal_cents     integer  CHECK (subtotal_cents IS NULL OR subtotal_cents >= 0),
  ADD COLUMN IF NOT EXISTS tax_amount_cents   integer  CHECK (tax_amount_cents IS NULL OR tax_amount_cents >= 0),
  ADD COLUMN IF NOT EXISTS tax_id             text,
  ADD COLUMN IF NOT EXISTS tax_id_type        text,
  ADD COLUMN IF NOT EXISTS country_billed     varchar(2);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE table_schema = 'public' AND table_name = 'invoices'
      AND constraint_name = 'invoices_country_billed_format_chk'
  ) THEN
    ALTER TABLE public.invoices
      ADD CONSTRAINT invoices_country_billed_format_chk
      CHECK (country_billed IS NULL OR country_billed ~ '^[A-Z]{2}$');
  END IF;
END $$;

COMMENT ON COLUMN public.invoices.subtotal_cents IS 'Subtotal sin impuesto. amount_cents = subtotal_cents + tax_amount_cents.';
COMMENT ON COLUMN public.invoices.tax_amount_cents IS 'Impuesto cobrado en este invoice (Stripe Tax total).';
COMMENT ON COLUMN public.invoices.tax_id IS 'Snapshot del tax_id del cliente al momento del cobro.';
COMMENT ON COLUMN public.invoices.country_billed IS 'País usado por Stripe Tax para calcular el impuesto en este invoice.';
