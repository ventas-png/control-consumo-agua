-- ════════════════════════════════════════════════════════════════════════════
-- Manejo de Rentas · país de procedencia del huésped.
--
-- POR QUÉ. El formulario de reserva de Rentas deja de pedir «Monto por noche» y
-- «Total» (los calcula el desglose de cobro) y en su lugar captura de qué país
-- viene el huésped, elegido de una lista con buscador.
--
-- QUÉ AGREGA: `huesped_pais` (código ISO 3166-1 alfa-2 en mayúsculas, p. ej.
-- 'GT', 'US'; NULL = sin especificar) en las DOS tablas donde vive una reserva
-- de Rentas: `rentas_reservas` (propiedades independientes) y `reservas_str`
-- (propiedades enlazadas a un condominio). Se guarda el código, no el nombre:
-- el nombre lo pone la aplicación en el idioma del usuario.
--
-- LO QUE **NO** HACE: no toca policies, grants ni funciones; no borra
-- `monto_noche` ni `monto_total` (siguen ahí para lo ya capturado, la carga
-- masiva y Finanzas). El CHECK valida la FORMA del código, no que el país exista.
--
-- Idempotente: se puede aplicar dos veces.
--
-- REVERSA:
--   ALTER TABLE public.rentas_reservas DROP CONSTRAINT IF EXISTS rentas_reservas_huesped_pais_check, DROP COLUMN IF EXISTS huesped_pais;
--   ALTER TABLE public.reservas_str    DROP CONSTRAINT IF EXISTS reservas_str_huesped_pais_check,    DROP COLUMN IF EXISTS huesped_pais;
-- ════════════════════════════════════════════════════════════════════════════

ALTER TABLE public.rentas_reservas ADD COLUMN IF NOT EXISTS huesped_pais text;
ALTER TABLE public.reservas_str    ADD COLUMN IF NOT EXISTS huesped_pais text;

ALTER TABLE public.rentas_reservas DROP CONSTRAINT IF EXISTS rentas_reservas_huesped_pais_check;
ALTER TABLE public.rentas_reservas
  ADD CONSTRAINT rentas_reservas_huesped_pais_check CHECK (huesped_pais IS NULL OR huesped_pais ~ '^[A-Z]{2}$');

ALTER TABLE public.reservas_str DROP CONSTRAINT IF EXISTS reservas_str_huesped_pais_check;
ALTER TABLE public.reservas_str
  ADD CONSTRAINT reservas_str_huesped_pais_check CHECK (huesped_pais IS NULL OR huesped_pais ~ '^[A-Z]{2}$');

COMMENT ON COLUMN public.rentas_reservas.huesped_pais IS 'País de procedencia del huésped: ISO 3166-1 alfa-2 en mayúsculas. NULL = sin especificar.';
COMMENT ON COLUMN public.reservas_str.huesped_pais    IS 'País de procedencia del huésped: ISO 3166-1 alfa-2 en mayúsculas. NULL = sin especificar.';
