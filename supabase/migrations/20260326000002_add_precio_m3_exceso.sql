-- Add excess price per m³ field to tarifas
ALTER TABLE public.tarifas
  ADD COLUMN IF NOT EXISTS precio_m3_exceso numeric(10,4) NOT NULL DEFAULT 0;

-- Add snapshot of excess price applied at reading time to registros
ALTER TABLE public.registros
  ADD COLUMN IF NOT EXISTS tarifa_exceso_aplicada numeric(10,4);
