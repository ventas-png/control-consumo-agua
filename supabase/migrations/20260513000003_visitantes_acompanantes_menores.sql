-- Companions and minor registration support for visitantes
ALTER TABLE public.visitantes
  ADD COLUMN IF NOT EXISTS visitante_principal_id uuid REFERENCES public.visitantes(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS es_menor boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS fecha_nacimiento date;

CREATE INDEX IF NOT EXISTS idx_visitantes_principal ON public.visitantes(visitante_principal_id);
