-- ============================================================================
-- Llaves naturales UNIQUE anti-duplicado (auditoría 2026-07-16, E1 / cierra D4)
-- ============================================================================
-- Los duplicados nacen de DOS carreras que ningún CHECK cubría:
--   · registros — el sync offline verifica registroExiste() ANTES de insertar;
--     dos dispositivos sincronizando la misma lectura pasan ambos el pre-check
--     y ambos insertan (TOCTOU). Clave natural: (contador_id, lectura_actual,
--     fecha) — la misma del pre-check.
--   · cuotas_condominio — el generador pre-filtra "unidades que ya tienen
--     cuota" client-side; dos generaciones concurrentes del mismo período/
--     concepto duplican. Clave natural: (unidad_id, periodo, concepto).
--
-- Diseño:
--   1. DEDUPE de lo existente (si no, el CREATE UNIQUE INDEX falla): por grupo
--      duplicado se CONSERVA la fila "más valiosa" (pagada > más antigua) y el
--      resto se SOFT-DELETEA (deleted_at; E2 ya excluye soft-deleted de todos
--      los consumidores, así que desaparecen de la UI sin perder auditoría).
--   2. Índices únicos PARCIALES (WHERE deleted_at IS NULL): una lectura/cuota
--      borrada NO bloquea re-capturarla — borrar y volver a capturar es un
--      flujo legítimo.
--
-- Nota frontend: PostgREST no puede usar índices parciales como árbitro de
-- ON CONFLICT, así que los inserts NO cambian a upsert: el índice rechaza el
-- duplicado con 23505 y el frontend lo trata como "ya existía" (se reporta
-- como omitida, no como error). Ver createRegistro / validatedInsert.
--
-- Idempotente: los UPDATE de dedupe solo tocan filas duplicadas vivas (re-corre
-- en vacío); CREATE UNIQUE INDEX IF NOT EXISTS.
-- ============================================================================

-- ─── 1a. Dedupe registros (conserva pagada > más antigua; soft-deletea el resto) ──

WITH duplicados AS (
  SELECT
    id,
    row_number() OVER (
      PARTITION BY contador_id, lectura_actual, fecha
      ORDER BY
        (estado = 'pagado' OR COALESCE(monto_pagado, 0) > 0) DESC,  -- pagada primero
        created_at ASC NULLS LAST,                                   -- luego la más antigua
        id ASC                                                       -- desempate estable
    ) AS rn
  FROM public.registros
  WHERE deleted_at IS NULL
    AND contador_id IS NOT NULL
)
UPDATE public.registros r
SET
  deleted_at = now(),
  notas = left(COALESCE(r.notas || ' · ', '') || '[E1: duplicado de clave natural, omitido en dedupe]', 2000)
FROM duplicados d
WHERE r.id = d.id
  AND d.rn > 1;

-- ─── 1b. Dedupe cuotas_condominio (conserva pagada > más antigua) ───────────

WITH duplicados AS (
  SELECT
    id,
    row_number() OVER (
      PARTITION BY unidad_id, periodo, concepto
      ORDER BY
        (estado = 'pagado') DESC,
        created_at ASC NULLS LAST,
        id ASC
    ) AS rn
  FROM public.cuotas_condominio
  WHERE deleted_at IS NULL
    AND unidad_id IS NOT NULL
)
UPDATE public.cuotas_condominio c
SET deleted_at = now()
FROM duplicados d
WHERE c.id = d.id
  AND d.rn > 1;

-- ─── 2. Índices únicos parciales (la garantía que cierra ambas carreras) ────

CREATE UNIQUE INDEX IF NOT EXISTS uq_registros_llave_natural
  ON public.registros (contador_id, lectura_actual, fecha)
  WHERE deleted_at IS NULL AND contador_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_cuotas_condominio_llave_natural
  ON public.cuotas_condominio (unidad_id, periodo, concepto)
  WHERE deleted_at IS NULL AND unidad_id IS NOT NULL;

COMMENT ON INDEX public.uq_registros_llave_natural IS
  'Clave natural anti-duplicado del sync offline (espeja registroExiste). Parcial: soft-deleted no bloquea re-captura. Auditoría 2026-07-16, E1.';
COMMENT ON INDEX public.uq_cuotas_condominio_llave_natural IS
  'Clave natural anti-duplicado de la generación de cuotas (unidad+período+concepto). Parcial: soft-deleted no bloquea regeneración. Auditoría 2026-07-16, E1.';
