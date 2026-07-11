-- F1 — Pago en línea del residente (P1). Permitir que un pago / solicitud de
-- cobro apunte a una CUOTA de condominio (además del REGISTRO de agua que ya
-- soportan). Esto habilita:
--   • que el residente pague sus cuotas desde el portal (create-charge/confirm-charge),
--   • ABONOS PARCIALES: el saldo de una cuota = total_a_pagar − sum(pagos activos
--     de esa cuota); la cuota pasa a 'pagado' solo cuando el saldo llega a 0.
--
-- Aditivo y no-disruptivo: columnas nullable, sin tocar el flujo de agua. La
-- invariante "un pago referencia EXACTAMENTE un ítem (registro XOR cuota)" se
-- garantiza en la capa de aplicación (los pagos también admiten convenios/
-- anticipos, así que no se fuerza con un CHECK rígido).

ALTER TABLE public.pagos
  ADD COLUMN IF NOT EXISTS cuota_id uuid REFERENCES public.cuotas_condominio(id) ON DELETE SET NULL;

ALTER TABLE public.payment_requests
  ADD COLUMN IF NOT EXISTS cuota_id uuid REFERENCES public.cuotas_condominio(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.pagos.cuota_id IS
  'Cuota de condominio que este pago abona (alternativo a registro_id). Permite abonos parciales: saldo de la cuota = total_a_pagar − sum(pagos activos). (F1 pago en línea)';
COMMENT ON COLUMN public.payment_requests.cuota_id IS
  'Cuota que la solicitud de cobro paga (alternativo a registro_id). (F1 pago en línea)';

-- Índices parciales: los lookups de pagos/solicitudes por cuota son por-cuota y
-- solo aplican a las filas de condominio.
CREATE INDEX IF NOT EXISTS idx_pagos_cuota_id
  ON public.pagos(cuota_id) WHERE cuota_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_payment_requests_cuota_id
  ON public.payment_requests(cuota_id) WHERE cuota_id IS NOT NULL;
