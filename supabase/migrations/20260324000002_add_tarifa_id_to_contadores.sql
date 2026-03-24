-- Add tarifa_id FK to contadores (nullable, no-breaking)
ALTER TABLE public.contadores
  ADD COLUMN IF NOT EXISTS tarifa_id uuid REFERENCES public.tarifas(id) ON DELETE SET NULL;
