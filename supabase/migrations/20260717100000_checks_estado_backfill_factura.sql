-- ============================================================================
-- CHECKs en columnas estado desnudas + backfill factura_estado (E5 / cierra D6)
-- ============================================================================
-- D6: 0 ENUMs en 231 tablas; columnas `estado` sin CHECK; y la DOBLE máquina de
-- estados de `registros` (estado legacy + factura_estado canónico) quedó a
-- medias — la migración 20260604160000 dejó explícito el follow-up:
--   "los registros legacy quedan NULL hasta que se emitan o se haga el
--    backfill follow-up" ... "El CHECK admite además los valores legacy
--    'pagado' y 'mora' ... para que un futuro backfill no rompa".
-- Este PR ES ese backfill + el endurecimiento.
--
--   1. Backfill estado → factura_estado (misma normalización que
--      normalizarEstadoFactura en business.ts: pagado→pagada, mora→vencida,
--      resto→pendiente) + sella pagada_at desde fecha_pago si faltaba.
--   2. Endurece registros_factura_estado_check a los 5 canónicos (todos los
--      writers — PagoModal, aplicar_mora cron, agua_cerrar_ciclo — ya escriben
--      canónico; los legacy tolerados quedan normalizados por el paso 1).
--   3. CHECKs a las columnas desnudas del camino del dinero:
--      · registros.estado          ∈ (pendiente, pagado, mora)
--      · cuotas_condominio.estado  ∈ (pendiente, pagado, moroso)  [espeja el
--        z.enum de domain/condominios/schemas.ts]
--      Se agregan NOT VALID (validan solo escrituras NUEVAS) y se intenta
--      VALIDATE en un bloque protegido: si algún dato histórico viola el
--      CHECK, la migración NO muere — el constraint queda NOT VALID (las
--      escrituras nuevas quedan protegidas igual) y el WARNING deja el rastro
--      para limpiar a mano.
--
-- Idempotente: UPDATEs con WHERE que re-corren en vacío; DROP CONSTRAINT IF
-- EXISTS + ADD; VALIDATE protegido.
-- ============================================================================

-- ─── 1. Backfill estado → factura_estado ────────────────────────────────────

-- 1a. Los NULL (legacy pre-máquina): derivar del estado legacy.
UPDATE public.registros
SET factura_estado = CASE estado
  WHEN 'pagado' THEN 'pagada'
  WHEN 'mora'   THEN 'vencida'
  ELSE 'pendiente'
END
WHERE factura_estado IS NULL;

-- 1b. Los valores legacy tolerados dentro de factura_estado.
UPDATE public.registros SET factura_estado = 'pagada'  WHERE factura_estado = 'pagado';
UPDATE public.registros SET factura_estado = 'vencida' WHERE factura_estado = 'mora';

-- 1c. Sello de pago faltante: si quedó 'pagada' sin pagada_at pero hay
-- fecha_pago, usarla (mejor aproximación disponible del momento real).
UPDATE public.registros
SET pagada_at = fecha_pago::timestamptz
WHERE factura_estado = 'pagada'
  AND pagada_at IS NULL
  AND fecha_pago IS NOT NULL;

-- ─── 2. Endurecer el CHECK de factura_estado a los canónicos ────────────────
-- NULL sigue tolerado por si algún insert lo setea explícito; el DEFAULT
-- 'pendiente' cubre las filas nuevas.

ALTER TABLE public.registros DROP CONSTRAINT IF EXISTS registros_factura_estado_check;
ALTER TABLE public.registros
  ADD CONSTRAINT registros_factura_estado_check
  CHECK (
    factura_estado IS NULL
    OR factura_estado IN ('pendiente', 'emitida', 'pagada', 'vencida', 'anulada')
  );

COMMENT ON COLUMN public.registros.factura_estado IS
  'Estado canónico de la Factura (agua:C4). Máquina: pendiente→emitida→{pagada|vencida}, anulada terminal. Backfilleado desde estado legacy (E5); ya SIN tolerancia legacy. La lógica de transición vive en src/lib/business.ts.';

-- ─── 3. CHECKs en las columnas estado desnudas (NOT VALID + VALIDATE protegido) ──

-- registros.estado (legacy, la consume la UI de agua)
ALTER TABLE public.registros DROP CONSTRAINT IF EXISTS registros_estado_check;
ALTER TABLE public.registros
  ADD CONSTRAINT registros_estado_check
  CHECK (estado IN ('pendiente', 'pagado', 'mora'))
  NOT VALID;

-- cuotas_condominio.estado (espeja el z.enum del dominio)
ALTER TABLE public.cuotas_condominio DROP CONSTRAINT IF EXISTS cuotas_condominio_estado_check;
ALTER TABLE public.cuotas_condominio
  ADD CONSTRAINT cuotas_condominio_estado_check
  CHECK (estado IN ('pendiente', 'pagado', 'moroso'))
  NOT VALID;

-- VALIDATE protegido: si hay histórico fuera del set, el constraint queda
-- NOT VALID (escrituras nuevas protegidas igual) y el WARNING deja rastro.
DO $$
BEGIN
  BEGIN
    ALTER TABLE public.registros VALIDATE CONSTRAINT registros_estado_check;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'registros_estado_check queda NOT VALID (histórico fuera del set): %', SQLERRM;
  END;
  BEGIN
    ALTER TABLE public.cuotas_condominio VALIDATE CONSTRAINT cuotas_condominio_estado_check;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'cuotas_condominio_estado_check queda NOT VALID (histórico fuera del set): %', SQLERRM;
  END;
END;
$$;
