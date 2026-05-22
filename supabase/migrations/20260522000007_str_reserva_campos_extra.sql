-- STR: campos adicionales de reserva
-- codigo de confirmacion, fecha de reservacion, bebes, horas estimadas,
-- politica de cancelacion y mascotas.
ALTER TABLE public.reservas_str
  ADD COLUMN IF NOT EXISTS codigo_confirmacion   text,
  ADD COLUMN IF NOT EXISTS fecha_reservacion     date,
  ADD COLUMN IF NOT EXISTS num_bebes             int     NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS hora_llegada_estimada time,
  ADD COLUMN IF NOT EXISTS hora_salida_estimada  time,
  ADD COLUMN IF NOT EXISTS politica_cancelacion  text,
  -- politica_cancelacion: 'flexible' | 'moderada' | 'estricta' | 'no_reembolsable' | 'na' | 'otra'
  ADD COLUMN IF NOT EXISTS mascotas              boolean NOT NULL DEFAULT false;
