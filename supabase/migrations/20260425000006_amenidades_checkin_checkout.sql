-- Check-in / check-out de reservas de amenidades + cierre de depósito
--
-- Permite registrar:
--  * llegada del residente (check-in con foto del estado inicial)
--  * salida (check-out con foto y observaciones)
--  * devolución del depósito o retención por daños
--  * referencia opcional a una cuota generada automáticamente cuando se
--    decide convertir el depósito retenido en un cargo a la unidad

ALTER TABLE public.reservas_amenidades
  ADD COLUMN IF NOT EXISTS checkin_at         timestamptz,
  ADD COLUMN IF NOT EXISTS checkin_foto_url   text,
  ADD COLUMN IF NOT EXISTS checkin_por        uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS checkout_at        timestamptz,
  ADD COLUMN IF NOT EXISTS checkout_foto_url  text,
  ADD COLUMN IF NOT EXISTS checkout_por       uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS observaciones_uso  text,
  ADD COLUMN IF NOT EXISTS deposito_estado    text NOT NULL DEFAULT 'no_aplica',
  -- deposito_estado:
  --   'no_aplica'  : amenidad no requiere depósito
  --   'pendiente'  : la amenidad requiere depósito y aún no se cobró
  --   'cobrado'    : depósito recibido (pago en garantía)
  --   'devuelto'   : depósito devuelto al residente al cerrar
  --   'retenido'   : depósito retenido (parcial o total) por daños/falta
  ADD COLUMN IF NOT EXISTS deposito_devuelto_at timestamptz,
  ADD COLUMN IF NOT EXISTS deposito_retenido_monto numeric(10,2),
  ADD COLUMN IF NOT EXISTS deposito_retenido_motivo text,
  ADD COLUMN IF NOT EXISTS cuota_retencion_id uuid REFERENCES public.cuotas_condominio(id) ON DELETE SET NULL;
