-- Add default_currency column to companies table
ALTER TABLE companies ADD COLUMN default_currency VARCHAR(3) NOT NULL DEFAULT 'usd';

-- Add constraint for valid currencies supported by Stripe
ALTER TABLE companies ADD CONSTRAINT valid_currency CHECK (
  default_currency IN (
    'usd', 'eur', 'gbp', 'jpy', 'aud', 'cad', 'chf', 'cny', 'inr', 'mxn',
    'nzd', 'sgd', 'hkd', 'nok', 'sek', 'dkk', 'pln', 'czk', 'huf', 'ron',
    'bgn', 'hrk', 'rub', 'try', 'brl', 'ars', 'clp', 'cop', 'pen', 'uyu',
    'idr', 'myr', 'php', 'thb', 'vnd', 'zar', 'kes', 'egp', 'aed', 'qar'
  )
);

-- Create index for faster currency lookups
CREATE INDEX idx_companies_default_currency ON companies(default_currency);

-- Add comment for documentation
COMMENT ON COLUMN companies.default_currency IS 'Default currency for payment intents (ISO 4217 code, Stripe supported)';
