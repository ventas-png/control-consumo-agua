-- Aprobación administrativa + aceptación de reglamento de amenidad
--
-- amenidades:
--   requiere_aprobacion: las reservas nacen como 'pendiente' y un admin
--                        debe aprobarlas o rechazarlas antes de bloquear
--                        el horario y de cobrar.
--   reglamento: texto que el residente debe leer y aceptar al reservar.
--
-- reservas_amenidades:
--   reglamento_aceptado_at: timestamp de aceptación del reglamento.
--   aprobada_por / aprobada_at: huella de quien confirmó la reserva.
--   rechazada_motivo: detalle cuando se cancela/rechaza desde el flujo
--                     de aprobación.

ALTER TABLE public.amenidades
  ADD COLUMN IF NOT EXISTS requiere_aprobacion boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS reglamento          text;

ALTER TABLE public.reservas_amenidades
  ADD COLUMN IF NOT EXISTS reglamento_aceptado_at timestamptz,
  ADD COLUMN IF NOT EXISTS aprobada_por           uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS aprobada_at            timestamptz,
  ADD COLUMN IF NOT EXISTS rechazada_motivo       text;

CREATE INDEX IF NOT EXISTS idx_reservas_pendientes
  ON public.reservas_amenidades(fecha)
  WHERE estado = 'pendiente';
