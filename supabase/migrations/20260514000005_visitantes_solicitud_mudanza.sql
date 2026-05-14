-- Permite al guardia ligar un ingreso de visitante a una autorización de mudanza
-- ya aprobada/programada (similar a reserva_str_id para Renta corta).

ALTER TABLE public.visitantes
  ADD COLUMN IF NOT EXISTS solicitud_mudanza_id UUID
    REFERENCES public.solicitud_mudanza_unidad(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_visitantes_solicitud_mudanza
  ON public.visitantes (solicitud_mudanza_id);
