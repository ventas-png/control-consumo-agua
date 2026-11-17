-- ════════════════════════════════════════════════════════════════════════════
-- Manejo de Rentas · moneda por reserva, por gasto y por contrato.
--
-- POR QUÉ. Las plataformas liquidan en dólares aunque la empresa lleve sus
-- condominios en moneda local, y una misma cartera mezcla reservas en USD con
-- otras en moneda local. Hasta ahora todo se mostraba con el símbolo del primer
-- proyecto de la empresa.
--
-- QUÉ AGREGA. Una columna `moneda` (código ISO 4217 en mayúsculas, 'USD' por
-- defecto) en:
--   · rentas_liquidaciones — es la ficha de Rentas de una reserva, venga de
--     rentas_reservas o de reservas_str; ahí vive la moneda de la reserva para
--     las dos fuentes sin tocar reservas_str. Una reserva sin ficha es USD.
--   · rentas_gastos
--   · rentas_contratos
--
-- No hay tipo de cambio: Finanzas suma por moneda, nunca mezcla.
--
-- Idempotente: se puede aplicar dos veces.
--
-- REVERSA: ALTER TABLE … DROP COLUMN moneda en las tres tablas (los montos no
-- cambian; sólo se pierde en qué moneda estaban).
-- ════════════════════════════════════════════════════════════════════════════

ALTER TABLE public.rentas_liquidaciones ADD COLUMN IF NOT EXISTS moneda text NOT NULL DEFAULT 'USD';
ALTER TABLE public.rentas_gastos        ADD COLUMN IF NOT EXISTS moneda text NOT NULL DEFAULT 'USD';
ALTER TABLE public.rentas_contratos     ADD COLUMN IF NOT EXISTS moneda text NOT NULL DEFAULT 'USD';

ALTER TABLE public.rentas_liquidaciones DROP CONSTRAINT IF EXISTS rentas_liquidaciones_moneda_check;
ALTER TABLE public.rentas_liquidaciones
  ADD CONSTRAINT rentas_liquidaciones_moneda_check CHECK (moneda ~ '^[A-Z]{3}$');
ALTER TABLE public.rentas_gastos DROP CONSTRAINT IF EXISTS rentas_gastos_moneda_check;
ALTER TABLE public.rentas_gastos
  ADD CONSTRAINT rentas_gastos_moneda_check CHECK (moneda ~ '^[A-Z]{3}$');
ALTER TABLE public.rentas_contratos DROP CONSTRAINT IF EXISTS rentas_contratos_moneda_check;
ALTER TABLE public.rentas_contratos
  ADD CONSTRAINT rentas_contratos_moneda_check CHECK (moneda ~ '^[A-Z]{3}$');

COMMENT ON COLUMN public.rentas_liquidaciones.moneda IS
  'Moneda de la reserva (ISO 4217, mayúsculas). Aplica a su monto total y a todo el desglose. Sin ficha de liquidación, la reserva se considera en USD.';
COMMENT ON COLUMN public.rentas_gastos.moneda IS 'Moneda del gasto (ISO 4217, mayúsculas).';
COMMENT ON COLUMN public.rentas_contratos.moneda IS 'Moneda de la renta mensual y del depósito (ISO 4217, mayúsculas).';
