-- =====================================================================
-- Moneda de cobro por empresa — habilitar monedas de Centroamérica/LatAm.
--
-- companies.default_currency es la moneda efectiva de los cobros (payfac,
-- Stripe del tenant) y la moneda base contable (conta_moneda_base), pero el
-- CHECK valid_currency (20260409000001) era Stripe-céntrico y NO incluía
-- 'gtq' ni las demás monedas de la región — mientras los fallbacks del
-- código (resolverConfigPagoEfectiva, conta_moneda_base) asumen GTQ. Se
-- recrea el CHECK conservando la lista original y agregando las monedas
-- LatAm faltantes. La UI (PayfacConfigSection / superadmin / alta) escribe
-- esta columna a partir de este PR; el DEFAULT 'usd' queda como red de
-- seguridad para inserts sin moneda explícita.
-- =====================================================================

ALTER TABLE public.companies DROP CONSTRAINT IF EXISTS valid_currency;
ALTER TABLE public.companies ADD CONSTRAINT valid_currency CHECK (
  default_currency::text IN (
    -- lista original (20260409000001)
    'usd', 'eur', 'gbp', 'jpy', 'aud', 'cad', 'chf', 'cny', 'inr', 'mxn',
    'nzd', 'sgd', 'hkd', 'nok', 'sek', 'dkk', 'pln', 'czk', 'huf', 'ron',
    'bgn', 'hrk', 'rub', 'try', 'brl', 'ars', 'clp', 'cop', 'pen', 'uyu',
    'idr', 'myr', 'php', 'thb', 'vnd', 'zar', 'kes', 'egp', 'aed', 'qar',
    -- Centroamérica / LatAm (faltaban; el código asume GTQ como fallback)
    'gtq', 'hnl', 'nio', 'crc', 'pab', 'dop', 'bob', 'pyg'
  )
);

COMMENT ON COLUMN public.companies.default_currency IS
  'Moneda de cobro de la empresa (ISO 4217 en minúsculas). Usada por payfac/Stripe del tenant y como moneda base contable (conta_moneda_base). Editable por owner/superadmin.';
