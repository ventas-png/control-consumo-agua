-- Add guest photo columns to reservas_str
ALTER TABLE public.reservas_str
  ADD COLUMN IF NOT EXISTS foto_url text,
  ADD COLUMN IF NOT EXISTS foto_documento_url text;
