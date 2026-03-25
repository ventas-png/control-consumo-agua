-- Add personal identification, billing, and contact fields to clientes

ALTER TABLE public.clientes
  ADD COLUMN IF NOT EXISTS nacionalidad       text,
  ADD COLUMN IF NOT EXISTS cui_dui            text,
  ADD COLUMN IF NOT EXISTS fecha_nacimiento   date,
  ADD COLUMN IF NOT EXISTS numero_facturacion text,
  ADD COLUMN IF NOT EXISTS telefono_alterno   text;
