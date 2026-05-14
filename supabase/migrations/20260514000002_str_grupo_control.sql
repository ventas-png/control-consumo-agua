-- Pre-registration of STR group guests
CREATE TABLE IF NOT EXISTS public.huespedes_str (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reserva_str_id      uuid NOT NULL REFERENCES public.reservas_str(id) ON DELETE CASCADE,
  nombre              text NOT NULL,
  identificacion      text,
  es_menor            boolean NOT NULL DEFAULT false,
  fecha_nacimiento    date,
  foto_url            text,
  foto_documento_url  text,
  visitante_id        uuid REFERENCES public.visitantes(id) ON DELETE SET NULL,
  created_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_huespedes_str_reserva ON public.huespedes_str(reserva_str_id);
CREATE INDEX IF NOT EXISTS idx_huespedes_str_visitante ON public.huespedes_str(visitante_id);

ALTER TABLE public.huespedes_str ENABLE ROW LEVEL SECURITY;
CREATE POLICY "company_access" ON public.huespedes_str USING (
  EXISTS (SELECT 1 FROM public.reservas_str r WHERE r.id = reserva_str_id AND r.company_id = (SELECT company_id FROM public.app_users WHERE id = auth.uid()))
) WITH CHECK (
  EXISTS (SELECT 1 FROM public.reservas_str r WHERE r.id = reserva_str_id AND r.company_id = (SELECT company_id FROM public.app_users WHERE id = auth.uid()))
);

-- Link visitor entries to their STR reservation
ALTER TABLE public.visitantes
  ADD COLUMN IF NOT EXISTS reserva_str_id uuid REFERENCES public.reservas_str(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_visitantes_reserva_str ON public.visitantes(reserva_str_id);
