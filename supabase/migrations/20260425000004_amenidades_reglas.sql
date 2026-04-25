-- Reglas anti-abuso por amenidad + tracking de no-show
--
-- amenidades:
--   max_reservas_mes_unidad: máximo de reservas confirmadas por unidad/mes
--                            (NULL = sin límite)
--   horas_minimas_antelacion: ventana mínima entre "ahora" y la reserva
--                             (NULL = sin restricción)
--   duracion_max_horas: duración máxima de una reserva (NULL = sin tope)
--
-- reservas_amenidades:
--   no_show: marcada cuando la unidad no se presentó a usar la amenidad

ALTER TABLE public.amenidades
  ADD COLUMN IF NOT EXISTS max_reservas_mes_unidad  int,
  ADD COLUMN IF NOT EXISTS horas_minimas_antelacion int,
  ADD COLUMN IF NOT EXISTS duracion_max_horas       numeric(4,2);

ALTER TABLE public.reservas_amenidades
  ADD COLUMN IF NOT EXISTS no_show boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_reservas_no_show
  ON public.reservas_amenidades(unidad_id)
  WHERE no_show = true;
