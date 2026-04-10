ALTER TABLE public.registros
  ADD COLUMN IF NOT EXISTS fecha_lectura_anterior timestamptz,
  ADD COLUMN IF NOT EXISTS dias_servicio integer;

COMMENT ON COLUMN public.registros.fecha_lectura_anterior IS 'Date of the previous reading for this counter';
COMMENT ON COLUMN public.registros.dias_servicio IS 'Number of days between previous and current reading';
