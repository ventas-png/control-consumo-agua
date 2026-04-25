-- Tracking de recordatorios enviados sobre reservas de amenidades
-- Permite que el administrador dispare un mensaje (WhatsApp/email) por
-- reserva próxima y evitar duplicados.

ALTER TABLE public.reservas_amenidades
  ADD COLUMN IF NOT EXISTS recordatorio_enviado    boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS recordatorio_enviado_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_reservas_recordatorio
  ON public.reservas_amenidades(fecha)
  WHERE recordatorio_enviado = false AND estado = 'confirmada';
