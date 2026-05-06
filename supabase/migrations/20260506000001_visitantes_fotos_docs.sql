ALTER TABLE public.visitantes
  ADD COLUMN IF NOT EXISTS foto_documento_url text,
  ADD COLUMN IF NOT EXISTS foto_vehiculo_url  text;
