-- Tarifa diferenciada de amenidad para fin de semana (sábado/domingo)
-- Si tarifa_uso_finde es NULL, se usa tarifa_uso para todos los días.

ALTER TABLE public.amenidades
  ADD COLUMN IF NOT EXISTS tarifa_uso_finde numeric(10,2);
