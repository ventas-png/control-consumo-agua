-- Add consumo_minimo column to tarifas and clientes tables
ALTER TABLE public.tarifas
  ADD COLUMN IF NOT EXISTS consumo_minimo numeric(10,4) NOT NULL DEFAULT 0;

ALTER TABLE public.clientes
  ADD COLUMN IF NOT EXISTS consumo_minimo numeric(10,4) NOT NULL DEFAULT 0;
