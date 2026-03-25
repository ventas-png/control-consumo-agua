-- Add technical/installation fields to contadores table
ALTER TABLE public.contadores
  ADD COLUMN IF NOT EXISTS medida text,
  ADD COLUMN IF NOT EXISTS material text,
  ADD COLUMN IF NOT EXISTS tipo_contador text,
  ADD COLUMN IF NOT EXISTS valvula_cheque text,
  ADD COLUMN IF NOT EXISTS tipo_llave text,
  ADD COLUMN IF NOT EXISTS llave_antifraude text,
  ADD COLUMN IF NOT EXISTS valvula_aire text,
  ADD COLUMN IF NOT EXISTS fecha_reemplazo_sugerida date;
