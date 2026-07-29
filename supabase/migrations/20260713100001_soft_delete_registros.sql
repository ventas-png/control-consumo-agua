-- ============================================================================
-- Soft delete (lote 2): registros (lecturas/recibos de agua)
-- ============================================================================
-- Por qué: el pago en línea de recibos de agua está ROTO en producción. Las
-- edge functions `create-charge` y `confirm-charge` proyectan `deleted_at` al
-- cargar el registro a cobrar (SELECT … deleted_at FROM registros), pero el
-- lote 1 de soft delete (20260528000001_soft_delete_critical_tables.sql) no
-- incluyó `registros`: PostgREST responde
--     column registros.deleted_at does not exist
-- y el portal del residente muestra "No se pudo iniciar el pago" ANTES de
-- siquiera resolver el payfac del tenant (por eso parece que "no reconoce" el
-- payfac configurado).
--
-- Misma estrategia conservadora del lote 1 — solo columnas + índice parcial:
-- las RLS policies no cambian, las queries existentes siguen funcionando, y el
-- frontend puede migrar gradualmente su DELETE de registros a soft delete.
--
-- Impacto en datos productivos: ADD COLUMN nullable sin DEFAULT (no reescribe
-- la tabla). Revert:
--   DROP INDEX IF EXISTS public.idx_registros_active;
--   ALTER TABLE public.registros DROP COLUMN IF EXISTS deleted_at,
--     DROP COLUMN IF EXISTS deleted_by;
--
-- Idempotencia: ADD COLUMN IF NOT EXISTS + CREATE INDEX IF NOT EXISTS.
-- ============================================================================

ALTER TABLE public.registros
  ADD COLUMN IF NOT EXISTS deleted_at timestamptz,
  ADD COLUMN IF NOT EXISTS deleted_by uuid REFERENCES auth.users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_registros_active
  ON public.registros(created_at DESC) WHERE deleted_at IS NULL;

COMMENT ON COLUMN public.registros.deleted_at IS
  'Soft delete: ver doc en pagos.deleted_at.';
