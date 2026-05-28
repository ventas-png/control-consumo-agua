-- ============================================================================
-- Soft delete universal (lote 1: tablas financieras y operativas, F2.7)
-- ============================================================================
-- Agrega columnas `deleted_at` y `deleted_by` a las tablas más críticas para
-- preservar historia: pagos (financiero, NUNCA hard-delete), cuotas, fondo
-- de reserva, tickets de mantenimiento.
--
-- Estrategia conservadora — solo agrega columnas + indices parciales:
--
--   1. Las RLS policies SELECT NO se modifican en este PR. El frontend que
--      quiera filtrar borrados ya puede hacerlo con `.is('deleted_at', null)`,
--      pero las queries existentes siguen funcionando sin cambios.
--   2. El frontend migra gradualmente: cada flow que hoy hace DELETE pasa a
--      UPDATE SET deleted_at = now(), deleted_by = auth.uid(). Mientras tanto
--      coexisten ambos patrones.
--   3. Indices parciales `WHERE deleted_at IS NULL` aceleran "rows activos"
--      sin penalizar las queries que necesitan historia completa.
--
-- Esta NO es la versión definitiva de "soft delete universal" — es el lote 1.
-- PRs siguientes pueden agregar las columnas a visitantes, paquetes,
-- comunicados, documentos, etc., y luego mover el filtro a las policies cuando
-- el front esté completamente migrado.
--
-- Idempotencia: ADD COLUMN IF NOT EXISTS + CREATE INDEX IF NOT EXISTS.
-- Aplicado y verificado no-op en producción via MCP antes del commit.
-- ============================================================================

-- pagos: NUNCA borrar un pago hard. Auditoría financiera + reversiones requieren
-- el row original.
ALTER TABLE public.pagos
  ADD COLUMN IF NOT EXISTS deleted_at timestamptz,
  ADD COLUMN IF NOT EXISTS deleted_by uuid REFERENCES auth.users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_pagos_active
  ON public.pagos(created_at DESC) WHERE deleted_at IS NULL;

-- cuotas_condominio: el historial fiscal del condominio depende de las cuotas
-- emitidas. Reemitir una cuota debe marcar la anterior como deleted_at, no
-- eliminarla.
ALTER TABLE public.cuotas_condominio
  ADD COLUMN IF NOT EXISTS deleted_at timestamptz,
  ADD COLUMN IF NOT EXISTS deleted_by uuid REFERENCES auth.users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_cuotas_condominio_active
  ON public.cuotas_condominio(periodo, created_at DESC) WHERE deleted_at IS NULL;

-- fondo_reserva_condominio: igual que pagos, son movimientos contables.
ALTER TABLE public.fondo_reserva_condominio
  ADD COLUMN IF NOT EXISTS deleted_at timestamptz,
  ADD COLUMN IF NOT EXISTS deleted_by uuid REFERENCES auth.users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_fondo_reserva_condominio_active
  ON public.fondo_reserva_condominio(created_at DESC) WHERE deleted_at IS NULL;

-- tickets_mantenimiento: historia de incidencias importante para SLA / disputas.
ALTER TABLE public.tickets_mantenimiento
  ADD COLUMN IF NOT EXISTS deleted_at timestamptz,
  ADD COLUMN IF NOT EXISTS deleted_by uuid REFERENCES auth.users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_tickets_mantenimiento_active
  ON public.tickets_mantenimiento(created_at DESC) WHERE deleted_at IS NULL;

COMMENT ON COLUMN public.pagos.deleted_at IS
  'Soft delete: timestamp en que la fila se marcó como eliminada. NULL = activa. Por convención todas las operaciones de UI deben filtrar IS NULL excepto en vistas de auditoría.';
COMMENT ON COLUMN public.cuotas_condominio.deleted_at IS
  'Soft delete: ver doc en pagos.deleted_at.';
COMMENT ON COLUMN public.fondo_reserva_condominio.deleted_at IS
  'Soft delete: ver doc en pagos.deleted_at.';
COMMENT ON COLUMN public.tickets_mantenimiento.deleted_at IS
  'Soft delete: ver doc en pagos.deleted_at.';
