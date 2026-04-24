-- Fecha de nacimiento para personal del condominio (cumpleaños)
ALTER TABLE personal_condominio
  ADD COLUMN IF NOT EXISTS fecha_nacimiento date NULL;
