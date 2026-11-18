-- ════════════════════════════════════════════════════════════════════════════
-- Manejo de Rentas · datos de la estancia en la reserva independiente.
--
-- POR QUÉ. El formulario de reserva de Rentas pasa a capturar lo mismo que el
-- de la pestaña STR de Condominios. Las reservas de una propiedad enlazada
-- viven en `reservas_str`, que ya trae esos campos; a `rentas_reservas` (las de
-- propiedades independientes) le faltaban.
--
-- QUÉ AGREGA a `rentas_reservas`:
--   · fecha_reservacion, hora_llegada_estimada, hora_salida_estimada
--   · num_ninos y num_bebes (0 por defecto). `num_huespedes` sigue siendo el
--     TOTAL; los adultos son total − niños − bebés y tiene que haber al menos uno.
--
-- LO QUE **NO** HACE: fotos del huésped ni personas del grupo para propiedades
-- independientes (necesitan su propio bucket y tabla). No toca `reservas_str`.
--
-- Idempotente: se puede aplicar dos veces.
--
-- REVERSA: ALTER TABLE public.rentas_reservas DROP CONSTRAINT IF EXISTS
--   rentas_reservas_grupo_check, DROP COLUMN IF EXISTS fecha_reservacion,
--   DROP COLUMN IF EXISTS hora_llegada_estimada, DROP COLUMN IF EXISTS
--   hora_salida_estimada, DROP COLUMN IF EXISTS num_ninos, DROP COLUMN IF EXISTS num_bebes;
-- ════════════════════════════════════════════════════════════════════════════

ALTER TABLE public.rentas_reservas
  ADD COLUMN IF NOT EXISTS fecha_reservacion     date,
  ADD COLUMN IF NOT EXISTS hora_llegada_estimada time,
  ADD COLUMN IF NOT EXISTS hora_salida_estimada  time,
  ADD COLUMN IF NOT EXISTS num_ninos             integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS num_bebes             integer NOT NULL DEFAULT 0;

ALTER TABLE public.rentas_reservas DROP CONSTRAINT IF EXISTS rentas_reservas_grupo_check;
ALTER TABLE public.rentas_reservas
  ADD CONSTRAINT rentas_reservas_grupo_check
  CHECK (num_ninos >= 0 AND num_bebes >= 0 AND num_huespedes - num_ninos - num_bebes >= 1);

COMMENT ON COLUMN public.rentas_reservas.num_huespedes IS
  'Total de personas de la estancia (adultos + niños + bebés). Adultos = num_huespedes − num_ninos − num_bebes, al menos uno.';
COMMENT ON COLUMN public.rentas_reservas.fecha_reservacion IS 'Día en que se hizo la reserva (no la entrada).';
