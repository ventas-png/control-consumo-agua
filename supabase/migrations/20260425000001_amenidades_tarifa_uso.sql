-- Tarifas por uso de amenidades + método de pago en reservas
-- Extiende: amenidades (tarifa de uso editable por admin)
--           reservas_amenidades (monto, método de pago, estado del cobro, cuota generada)

-- ── amenidades: tarifa por uso ───────────────────────────────────────────────
ALTER TABLE public.amenidades
  ADD COLUMN IF NOT EXISTS requiere_tarifa boolean       NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS tarifa_uso      numeric(10,2);

-- ── reservas_amenidades: cobro de la tarifa ──────────────────────────────────
ALTER TABLE public.reservas_amenidades
  ADD COLUMN IF NOT EXISTS monto_tarifa       numeric(10,2),
  ADD COLUMN IF NOT EXISTS metodo_pago_tarifa text,
  -- metodo_pago_tarifa: 'cargar_unidad' | 'pagar_momento' | NULL (no aplica)
  ADD COLUMN IF NOT EXISTS tarifa_pagada      boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS cuota_id           uuid    REFERENCES public.cuotas_condominio(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_reservas_cuota ON public.reservas_amenidades(cuota_id);
