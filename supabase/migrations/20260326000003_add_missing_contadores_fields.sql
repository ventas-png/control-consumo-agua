-- Add missing fields to contadores table
ALTER TABLE public.contadores
  ADD COLUMN IF NOT EXISTS numero_derecho_servicio text,
  ADD COLUMN IF NOT EXISTS cantidad_derecho_servicio_m3 numeric,
  ADD COLUMN IF NOT EXISTS periodicidad_lectura_dias integer,
  ADD COLUMN IF NOT EXISTS contratista_instalador text,
  ADD COLUMN IF NOT EXISTS garantia_instalacion_vence date;
