-- Add default_currency column to companies table
--
-- Idempotencia (infra:I42 patrón aplicado): IF NOT EXISTS porque la baseline
-- de fase 1 (20260317000000) ya crea companies con `default_currency`. En
-- producción esta migración corrió antes de la baseline y dejó la columna
-- creada; en branches DB nuevas la baseline la crea primero. En ambos casos
-- el `IF NOT EXISTS` la hace no-op. El constraint y el índice usan el mismo
-- patrón idempotente (DO block para el CONSTRAINT porque PostgreSQL no
-- soporta `ADD CONSTRAINT IF NOT EXISTS`).

ALTER TABLE companies ADD COLUMN IF NOT EXISTS default_currency VARCHAR(3) NOT NULL DEFAULT 'usd';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'valid_currency'
      AND conrelid = 'public.companies'::regclass
  ) THEN
    ALTER TABLE companies ADD CONSTRAINT valid_currency CHECK (
      default_currency IN (
        'usd', 'eur', 'gbp', 'jpy', 'aud', 'cad', 'chf', 'cny', 'inr', 'mxn',
        'nzd', 'sgd', 'hkd', 'nok', 'sek', 'dkk', 'pln', 'czk', 'huf', 'ron',
        'bgn', 'hrk', 'rub', 'try', 'brl', 'ars', 'clp', 'cop', 'pen', 'uyu',
        'idr', 'myr', 'php', 'thb', 'vnd', 'zar', 'kes', 'egp', 'aed', 'qar'
      )
    );
  END IF;
END $$;

-- Create index for faster currency lookups
CREATE INDEX IF NOT EXISTS idx_companies_default_currency ON companies(default_currency);

-- Add comment for documentation
COMMENT ON COLUMN companies.default_currency IS 'Default currency for payment intents (ISO 4217 code, Stripe supported)';
