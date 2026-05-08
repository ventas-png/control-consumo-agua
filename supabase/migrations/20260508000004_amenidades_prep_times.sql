ALTER TABLE amenidades
  ADD COLUMN IF NOT EXISTS minutos_preparacion_previa integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS minutos_preparacion_posterior integer NOT NULL DEFAULT 0;
