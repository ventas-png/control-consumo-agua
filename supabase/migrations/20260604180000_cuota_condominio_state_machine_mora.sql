-- ============================================================================
-- T4 · Facturación de dominio (épica #305) — cond:C4 / cond:C6
-- Máquina de estados de Cuota de condominio + enganche a mora, sobre
-- `cuotas_condominio`. Espejo del agregado Factura de agua (#383,
-- 20260604160000_factura_state_machine_mora_iva.sql) llevado a condominios.
-- ============================================================================
-- Banda de migración EXCLUSIVA T4 del 2026-06-04: 180000–185959.
--
-- CONTEXTO (DESIGN_CRITIQUE cond:C4, cond:C6):
--   La cuota de mantenimiento de un condominio YA vive en `cuotas_condominio`
--   (monto, periodo, fecha_vencimiento, estado, fecha_pago/metodo_pago) — es
--   la "factura" del residente. Hoy, sin embargo:
--     · El estado es texto libre con 3 valores legacy ('pendiente' | 'pagado'
--       | 'moroso') y SIN máquina de estados explícita ni timestamps de
--       transición (cond:C4 — la transición pendiente→moroso se decide HOY en
--       el cliente, en CuotasTab.aplicarMoraMasiva()).
--     · El recargo de mora se calcula EN EL CLIENTE (RecargosTab.calcularMonto /
--       aplicarMasivo: monto = base * pct / 100), sin reusar `calcularMora`
--       (reglas_mora_config) ni un cron (cond:C6 — la mora es manual/masiva).
--   Este PR (foundation) formaliza la Cuota como un AGREGADO sobre la entidad
--   existente — columnas nuevas en `cuotas_condominio`, NO una tabla paralela —
--   exactamente como #383 hizo con `registros` para agua.
--
-- POR QUÉ COLUMNAS EN `cuotas_condominio` (y no tabla nueva):
--   - `cuotas_condominio` ya ES la cuota/factura del residente (tiene monto,
--     periodo, fecha_vencimiento, estado, pago).
--   - Ya está cableada en toda la UI de condominios (CuotasTab, RecargosTab,
--     EstadoCuentaResidenteTab, recibos_digitales) y en `recargos_mora.cuota_id`.
--   - RLS de `cuotas_condominio` ya scopea por tenant (company_id =
--     get_my_company_id(), con RLS row-level por unidad en
--     20260525000000_rls_cuotas_row_level_unidad.sql). Las columnas nuevas
--     HEREDAN esas policies automáticamente — no se requiere RLS nuevo aquí.
--
-- MÁQUINA DE ESTADOS (columna canónica `cuota_estado`):
--
--        ┌──────────┐  emitir   ┌──────────┐  pagar   ┌──────────┐
--        │ pendiente│──────────▶│ emitida  │─────────▶│  pagada  │
--        └────┬─────┘           └────┬─────┘          └──────────┘
--             │                      │ vencer (cron de mora cond:C6)
--             │  anular              ▼
--             │                 ┌──────────┐  pagar   ┌──────────┐
--             ├────────────────▶│ vencida  │─────────▶│  pagada  │
--             │                 └────┬─────┘          └──────────┘
--             ▼                      │ anular
--        ┌──────────┐◀───────────────┘
--        │ anulada  │   (estado terminal; también alcanzable desde emitida)
--        └──────────┘
--
--   Estados canónicos (idénticos a la Factura de agua, fuente de verdad en
--   src/lib/business.ts → TRANSICIONES_FACTURA): pendiente, emitida, pagada,
--   vencida, anulada. La lógica pura de transición/normalización/mora vive en
--   src/lib/businessCondominios.ts (cuotas) + src/lib/business.ts (reusadas),
--   testeada con vitest.
--
-- COMPATIBILIDAD CON DATOS LEGACY:
--   La columna canónica nueva es `cuota_estado` (NO se toca la columna `estado`
--   existente, que App/CuotasTab siguen consumiendo con sus 3 valores). El CHECK
--   de `cuota_estado` admite además los valores legacy 'pagado' y 'moroso' (lo
--   que hoy escribe la UI en `estado`) para que un futuro backfill
--   `estado` → `cuota_estado` no rompa y no forzar una reescritura masiva en
--   este PR foundation. Las funciones puras normalizan 'pagado'→'pagada' y
--   'moroso'→'vencida' (normalizarEstadoCuota).
--
-- IVA — POR QUÉ NO SE INCLUYE (decisión de dominio):
--   A diferencia de la Factura de agua (#383, que sí lleva iva_tasa/iva_monto/
--   monto_con_iva porque es un cobro comercial de servicio), la cuota de
--   mantenimiento de condominio en GT/MX NO es una factura comercial gravada
--   con IVA: es una contribución de copropietarios para gastos comunes. Por eso
--   este agregado NO agrega columnas de IVA y `total_a_pagar = monto +
--   mora_monto` (sin IVA). Si un tenant necesitara facturar IVA sobre la cuota
--   (caso CAM comercial), sería un follow-up aditivo, no se fuerza aquí.
--
-- IDEMPOTENCIA: ADD COLUMN IF NOT EXISTS, DROP CONSTRAINT IF EXISTS +
-- ADD CONSTRAINT, CREATE INDEX IF NOT EXISTS. Re-ejecutable sin efectos.
-- ============================================================================

-- ────────────────────────────────────────────────────────────────────────────
-- 1. Máquina de estados de Cuota sobre `cuotas_condominio`.
--    Columna canónica `cuota_estado` (NULL = aún sin formalizar; las cuotas
--    legacy quedan NULL hasta que se emitan o se haga el backfill follow-up).
--    Default 'pendiente' para filas nuevas. NO se toca la columna `estado`.
-- ────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.cuotas_condominio
  ADD COLUMN IF NOT EXISTS cuota_estado text DEFAULT 'pendiente';

ALTER TABLE public.cuotas_condominio DROP CONSTRAINT IF EXISTS cuotas_condominio_cuota_estado_check;
ALTER TABLE public.cuotas_condominio
  ADD CONSTRAINT cuotas_condominio_cuota_estado_check
  CHECK (
    cuota_estado IS NULL
    OR cuota_estado IN (
      -- canónicos de la máquina de estados
      'pendiente', 'emitida', 'pagada', 'vencida', 'anulada',
      -- legacy tolerados (lo que hoy escribe la UI en `estado`)
      'pagado', 'moroso'
    )
  );

COMMENT ON COLUMN public.cuotas_condominio.cuota_estado IS
  'Estado canónico de la Cuota (cond:C4). Máquina: pendiente→emitida→{pagada|vencida}, anulada terminal. Admite legacy pagado/moroso por compatibilidad. La lógica de transición vive en src/lib/businessCondominios.ts. NO confundir con la columna legacy `estado`.';

-- Timestamps de transición (auditoría de la máquina de estados).
ALTER TABLE public.cuotas_condominio ADD COLUMN IF NOT EXISTS emitida_at timestamptz;
ALTER TABLE public.cuotas_condominio ADD COLUMN IF NOT EXISTS pagada_at  timestamptz;
ALTER TABLE public.cuotas_condominio ADD COLUMN IF NOT EXISTS vencida_at timestamptz;
ALTER TABLE public.cuotas_condominio ADD COLUMN IF NOT EXISTS anulada_at timestamptz;

-- NOTA: `cuotas_condominio.fecha_vencimiento` (date) YA EXISTE (MVP) — es la
-- fecha base de la máquina/cron; no se recrea.

-- ────────────────────────────────────────────────────────────────────────────
-- 2. Enganche a mora (paridad con la Factura de agua, #383).
--    regla_mora_id: FK a la regla de mora aplicada (reglas_mora_config).
--    mora_monto: recargo calculado y persistido en la cuota.
--    mora_aplicada_at: cuándo se aplicó (idempotencia del cron cond:C6 — no
--    recargar dos veces la misma cuota).
--
--    Consistencia de tenant: reglas_mora_config está scopeada por
--    (company_id, project_id) y `cuotas_condominio.project_id` apunta al mismo
--    proyecto; RLS impide leer reglas de otro tenant, así que la FK no puede
--    cruzar empresas en la práctica. ON DELETE SET NULL: si se borra la regla,
--    la cuota conserva el mora_monto ya calculado pero pierde el puntero.
-- ────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.cuotas_condominio ADD COLUMN IF NOT EXISTS regla_mora_id    uuid;
ALTER TABLE public.cuotas_condominio ADD COLUMN IF NOT EXISTS mora_monto       numeric(12,2);
ALTER TABLE public.cuotas_condominio ADD COLUMN IF NOT EXISTS mora_aplicada_at timestamptz;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'cuotas_condominio_regla_mora_id_fkey'
      AND conrelid = 'public.cuotas_condominio'::regclass
  ) THEN
    ALTER TABLE public.cuotas_condominio
      ADD CONSTRAINT cuotas_condominio_regla_mora_id_fkey
      FOREIGN KEY (regla_mora_id)
      REFERENCES public.reglas_mora_config(id) ON DELETE SET NULL;
  END IF;
END $$;

ALTER TABLE public.cuotas_condominio DROP CONSTRAINT IF EXISTS cuotas_condominio_mora_monto_check;
ALTER TABLE public.cuotas_condominio
  ADD CONSTRAINT cuotas_condominio_mora_monto_check
  CHECK (mora_monto IS NULL OR mora_monto >= 0);

-- ────────────────────────────────────────────────────────────────────────────
-- 3. Total a pagar de la Cuota = monto (subtotal) + mora. SIN IVA (ver cabecera).
--    Derivado persistido (no GENERATED) para incluir la mora que el cron agrega
--    después de la emisión sin recomputar. Lo calcula la capa de negocio
--    (calcularTotalCuota en businessCondominios.ts, que reusa calcularTotalFactura
--    de business.ts con iva = 0).
-- ────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.cuotas_condominio ADD COLUMN IF NOT EXISTS total_a_pagar numeric(12,2);

ALTER TABLE public.cuotas_condominio DROP CONSTRAINT IF EXISTS cuotas_condominio_total_a_pagar_check;
ALTER TABLE public.cuotas_condominio
  ADD CONSTRAINT cuotas_condominio_total_a_pagar_check
  CHECK (total_a_pagar IS NULL OR total_a_pagar >= 0);

-- ────────────────────────────────────────────────────────────────────────────
-- 4. Índices.
--    - idx parcial para el CRON de mora (cond:C6): cuotas emitidas con fecha de
--      vencimiento, candidatas a pasar a vencida / aplicar recargo. Filtra
--      deleted_at (soft delete) para no barrer cuotas eliminadas.
--    - idx por estado canónico para tableros de cobranza.
-- ────────────────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_cuotas_cond_cuota_estado
  ON public.cuotas_condominio(cuota_estado)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_cuotas_cond_vencimiento_emitida
  ON public.cuotas_condominio(fecha_vencimiento)
  WHERE cuota_estado = 'emitida' AND fecha_vencimiento IS NOT NULL AND deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_cuotas_cond_regla_mora_id
  ON public.cuotas_condominio(regla_mora_id)
  WHERE regla_mora_id IS NOT NULL;

-- ────────────────────────────────────────────────────────────────────────────
-- 5. recargos_mora — idempotencia del recargo de cuota a nivel DB.
--    A lo sumo UNA fila viva por cuota (cuota_id). El cron, además, no
--    re-inserta si mora_aplicada_at ya está. Espeja el índice
--    uq_recargos_mora_registro_vivo de agua (#385), pero para cuota_id.
--    NOTA: recargos_mora YA tiene unidad_id (nullable, #385) y cuota_id; las
--    filas de condominios usan (unidad_id, cuota_id) → satisfacen el
--    recargos_mora_owner_check de #385 (num_nonnulls(unidad_id, registro_id)=1,
--    con registro_id NULL). No se recrea la tabla; sólo se añade el índice.
-- ────────────────────────────────────────────────────────────────────────────
CREATE UNIQUE INDEX IF NOT EXISTS uq_recargos_mora_cuota_vivo
  ON public.recargos_mora(cuota_id)
  WHERE cuota_id IS NOT NULL AND estado <> 'anulado';
