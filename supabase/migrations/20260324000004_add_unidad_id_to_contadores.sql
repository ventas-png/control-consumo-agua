-- Add unidad_id to contadores
-- Associates each meter with a specific unit within the project
ALTER TABLE public.contadores
  ADD COLUMN IF NOT EXISTS unidad_id uuid REFERENCES public.unidades(id) ON DELETE SET NULL;

-- Index for efficient queries by unit
CREATE INDEX IF NOT EXISTS idx_contadores_unidad_id ON public.contadores(unidad_id);
