-- ============================================================================
-- T4 · Facturación de dominio (épica #305) — agua:C4
-- Máquina de estados de Factura + IVA + enganche a mora, sobre `registros`.
-- ============================================================================
-- Banda de migración EXCLUSIVA T4 del 2026-06-04: 160000–185959.
--
-- CONTEXTO (DESIGN_CRITIQUE_AGUA_2026-05-26 agua:C4, cond:C6):
--   Hoy el cobro al cliente final de agua vive en `registros` (lectura +
--   monto) y `pagos`, SIN máquina de estados explícita ni IVA/mora
--   automáticos. `registros.estado` es texto libre que en producción toma
--   los valores 'pendiente' | 'pagado' | 'mora'. Este PR (foundation)
--   formaliza la Factura como un AGREGADO sobre la entidad de cobro
--   existente — columnas nuevas en `registros`, NO una tabla paralela —
--   porque `registros` YA es la factura de agua (tiene monto_calculado,
--   monto_pagado, fecha_pago, tipo_cobro, project_id).
--
-- POR QUÉ COLUMNAS EN `registros` (y no tabla `facturas` nueva):
--   - Evita duplicar el modelo de cobro y mantener dos fuentes de verdad.
--   - `registros` ya está cableado en toda la UI de agua (cobros/recibos)
--     y en la capa de datos (src/domain/agua, useRegistrosQuery).
--   - RLS de `registros` ya scopea por tenant (project_id → projects.company_id,
--     con fallback por company_clientes cuando project_id es NULL; ver
--     20260519000009_agua_rls_tenant_isolation.sql). Las columnas nuevas
--     HEREDAN esas policies automáticamente — no se requiere RLS nuevo aquí.
--
-- MÁQUINA DE ESTADOS (columna canónica `factura_estado`):
--
--        ┌──────────┐  emitir   ┌──────────┐  pagar   ┌──────────┐
--        │ pendiente│──────────▶│ emitida  │─────────▶│  pagada  │
--        └────┬─────┘           └────┬─────┘          └──────────┘
--             │                      │ vencer (cron de mora)
--             │  anular              ▼
--             │                 ┌──────────┐  pagar   ┌──────────┐
--             ├────────────────▶│ vencida  │─────────▶│  pagada  │
--             │                 └────┬─────┘          └──────────┘
--             ▼                      │ anular
--        ┌──────────┐◀───────────────┘
--        │ anulada  │   (estado terminal; también alcanzable desde emitida)
--        └──────────┘
--
--   Estados canónicos: pendiente, emitida, pagada, vencida, anulada.
--   - pendiente: borrador, lectura capturada, sin emitir formalmente.
--   - emitida:   factura emitida al cliente (cuenta para cobro/IVA/mora).
--   - pagada:    saldada (terminal).
--   - vencida:   pasó fecha de vencimiento sin pago (la marca el cron de mora,
--                follow-up). Aún puede pagarse.
--   - anulada:   cancelada (terminal). Alcanzable desde pendiente/emitida/vencida.
--   La lógica pura de transiciones vive en src/lib/business.ts
--   (puedeTransicionarFactura / aplicarTransicionFactura), testeada con vitest.
--
-- COMPATIBILIDAD CON DATOS LEGACY:
--   El CHECK de `factura_estado` admite además los valores legacy
--   'pagado' y 'mora' (los que hoy escribe la UI en `registros.estado`) para
--   que un futuro backfill `estado` → `factura_estado` no rompa, y para no
--   forzar una reescritura masiva en este PR foundation. Las funciones puras
--   normalizan 'pagado'→'pagada' y 'mora'→'vencida'. La columna legacy
--   `estado` NO se toca (sigue siendo la que consume App.tsx hoy).
--
-- IDEMPOTENCIA: ADD COLUMN IF NOT EXISTS, DROP CONSTRAINT IF EXISTS +
-- ADD CONSTRAINT, DROP POLICY IF EXISTS + CREATE (no aplica aquí: sin RLS
-- nuevo), CREATE INDEX IF NOT EXISTS. Re-ejecutable sin efectos.
-- ============================================================================

-- ────────────────────────────────────────────────────────────────────────────
-- 1. IVA configurable por tenant (companies.iva_tasa_default).
--    Guatemala = 0.12 (12%). Cada tenant puede ajustarlo (MX 0.16, etc.).
--    Se guarda como fracción [0,1] para multiplicar directo (0.12 = 12%).
-- ────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.companies
  ADD COLUMN IF NOT EXISTS iva_tasa_default numeric(5,4) NOT NULL DEFAULT 0.12;

ALTER TABLE public.companies DROP CONSTRAINT IF EXISTS companies_iva_tasa_default_check;
ALTER TABLE public.companies
  ADD CONSTRAINT companies_iva_tasa_default_check
  CHECK (iva_tasa_default >= 0 AND iva_tasa_default <= 1);

COMMENT ON COLUMN public.companies.iva_tasa_default IS
  'Tasa de IVA por defecto del tenant, como fracción [0,1] (GT=0.12). La aplica el cálculo de Factura cuando registros.iva_tasa es NULL.';

-- ────────────────────────────────────────────────────────────────────────────
-- 2. Máquina de estados de Factura sobre `registros`.
--    Columna canónica `factura_estado` (NULL = aún sin formalizar como
--    factura; los registros legacy quedan NULL hasta que se emitan o se haga
--    el backfill follow-up). Default 'pendiente' para filas nuevas.
-- ────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.registros
  ADD COLUMN IF NOT EXISTS factura_estado text DEFAULT 'pendiente';

ALTER TABLE public.registros DROP CONSTRAINT IF EXISTS registros_factura_estado_check;
ALTER TABLE public.registros
  ADD CONSTRAINT registros_factura_estado_check
  CHECK (
    factura_estado IS NULL
    OR factura_estado IN (
      -- canónicos de la máquina de estados
      'pendiente', 'emitida', 'pagada', 'vencida', 'anulada',
      -- legacy tolerados (lo que hoy escribe la UI en `estado`)
      'pagado', 'mora'
    )
  );

COMMENT ON COLUMN public.registros.factura_estado IS
  'Estado canónico de la Factura (agua:C4). Máquina: pendiente→emitida→{pagada|vencida}, anulada terminal. Admite legacy pagado/mora por compatibilidad. La lógica de transición vive en src/lib/business.ts.';

-- Timestamps de transición (auditoría de la máquina de estados).
ALTER TABLE public.registros ADD COLUMN IF NOT EXISTS emitida_at  timestamptz;
ALTER TABLE public.registros ADD COLUMN IF NOT EXISTS pagada_at   timestamptz;
ALTER TABLE public.registros ADD COLUMN IF NOT EXISTS vencida_at  timestamptz;
ALTER TABLE public.registros ADD COLUMN IF NOT EXISTS anulada_at  timestamptz;

-- Fecha de vencimiento de la factura (cuándo pasa a vencida si no se paga).
-- La calcula la emisión a partir de reglas_mora_config.dias_vencimiento; se
-- persiste para que el cron (follow-up) la consulte sin recomputar.
ALTER TABLE public.registros ADD COLUMN IF NOT EXISTS fecha_vencimiento date;

-- ────────────────────────────────────────────────────────────────────────────
-- 3. Campos de IVA en la Factura.
--    iva_tasa: fracción aplicada a ESTA factura (snapshot; default = la del
--    tenant al emitir). iva_monto y monto_con_iva: derivados persistidos para
--    que el recibo/PDF no recompute y quede el histórico aunque cambie la tasa.
-- ────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.registros ADD COLUMN IF NOT EXISTS iva_tasa      numeric(5,4);
ALTER TABLE public.registros ADD COLUMN IF NOT EXISTS iva_monto     numeric(12,2);
ALTER TABLE public.registros ADD COLUMN IF NOT EXISTS monto_con_iva numeric(12,2);

ALTER TABLE public.registros DROP CONSTRAINT IF EXISTS registros_iva_tasa_check;
ALTER TABLE public.registros
  ADD CONSTRAINT registros_iva_tasa_check
  CHECK (iva_tasa IS NULL OR (iva_tasa >= 0 AND iva_tasa <= 1));

ALTER TABLE public.registros DROP CONSTRAINT IF EXISTS registros_iva_monto_check;
ALTER TABLE public.registros
  ADD CONSTRAINT registros_iva_monto_check
  CHECK (iva_monto IS NULL OR iva_monto >= 0);

-- ────────────────────────────────────────────────────────────────────────────
-- 4. Enganche a mora.
--    regla_mora_id: FK a la regla de mora aplicada (reglas_mora_config).
--    mora_monto: recargo calculado y persistido en la factura.
--    mora_aplicada_at: cuándo se aplicó (idempotencia del cron — no recargar dos
--    veces el mismo periodo).
--
--    Consistencia de tenant: reglas_mora_config está scopeada por
--    (company_id, project_id) y `registros.project_id` apunta al mismo
--    proyecto; RLS impide leer/seleccionar reglas de otro tenant, así que la
--    FK no puede cruzar empresas en la práctica. ON DELETE SET NULL: si se
--    borra la regla, la factura conserva el mora_monto ya calculado pero
--    pierde el puntero (no se recalcula sobre una regla inexistente).
-- ────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.registros ADD COLUMN IF NOT EXISTS regla_mora_id    uuid;
ALTER TABLE public.registros ADD COLUMN IF NOT EXISTS mora_monto       numeric(12,2);
ALTER TABLE public.registros ADD COLUMN IF NOT EXISTS mora_aplicada_at timestamptz;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'registros_regla_mora_id_fkey'
      AND conrelid = 'public.registros'::regclass
  ) THEN
    ALTER TABLE public.registros
      ADD CONSTRAINT registros_regla_mora_id_fkey
      FOREIGN KEY (regla_mora_id)
      REFERENCES public.reglas_mora_config(id) ON DELETE SET NULL;
  END IF;
END $$;

ALTER TABLE public.registros DROP CONSTRAINT IF EXISTS registros_mora_monto_check;
ALTER TABLE public.registros
  ADD CONSTRAINT registros_mora_monto_check
  CHECK (mora_monto IS NULL OR mora_monto >= 0);

-- ────────────────────────────────────────────────────────────────────────────
-- 5. Total a pagar de la Factura = subtotal (monto_calculado) + IVA + mora.
--    Derivado persistido (no GENERATED) para incluir mora que el cron agrega
--    después de la emisión sin recomputar el subtotal. Lo calcula la capa de
--    negocio (calcularTotalFactura en business.ts).
-- ────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.registros ADD COLUMN IF NOT EXISTS total_a_pagar numeric(12,2);

ALTER TABLE public.registros DROP CONSTRAINT IF EXISTS registros_total_a_pagar_check;
ALTER TABLE public.registros
  ADD CONSTRAINT registros_total_a_pagar_check
  CHECK (total_a_pagar IS NULL OR total_a_pagar >= 0);

-- ────────────────────────────────────────────────────────────────────────────
-- 6. Índices.
--    - idx parcial para el CRON de mora (follow-up): facturas emitidas con
--      fecha de vencimiento, candidatas a pasar a vencida / aplicar recargo.
--    - idx por estado para tableros de cobranza.
-- ────────────────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_registros_factura_estado
  ON public.registros(factura_estado);

CREATE INDEX IF NOT EXISTS idx_registros_vencimiento_emitida
  ON public.registros(fecha_vencimiento)
  WHERE factura_estado = 'emitida' AND fecha_vencimiento IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_registros_regla_mora_id
  ON public.registros(regla_mora_id)
  WHERE regla_mora_id IS NOT NULL;
