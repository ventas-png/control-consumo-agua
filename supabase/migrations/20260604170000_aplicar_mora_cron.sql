-- ============================================================================
-- T4 · Facturación de dominio (épica #305) — agua:C4 / cond:C6
-- CRON DE MORA: emitida → vencida + recargo automático sobre el agregado
-- Factura (`registros`). Follow-up de 20260604160000_factura_state_machine_mora_iva.
-- ============================================================================
-- Banda de migración EXCLUSIVA de este PR: 170000–175959 (dentro de la banda
-- T4 del 2026-06-04, 16–18h). SQL idempotente y re-ejecutable.
--
-- QUÉ HACE (función public.aplicar_mora_facturas_vencidas()):
--   1. Transición de estado: marca `emitida → vencida` (set vencida_at=now())
--      las facturas cuyo `fecha_vencimiento + periodo_gracia < now()`.
--   2. Recargo de mora: replica EN SQL la lógica pura de `calcularMora` de
--      src/lib/business.ts (ver "PARIDAD" más abajo), inserta una fila en
--      `recargos_mora`, setea `registros.mora_monto` + `mora_aplicada_at` y
--      recompone `total_a_pagar = monto_calculado + iva_monto + mora_monto`.
--   3. Idempotente: no re-aplica mora si `mora_aplicada_at` ya está. La fila de
--      `recargos_mora` se de-duplica por un índice único parcial sobre
--      registro_id (estado <> 'anulado').
--
-- PATRÓN DE CRON: mismo estilo que schedule_route_reminders_cron /
-- harden_route_function_grants / schedule_deactivate_expired_tarifas_cron:
-- función PL/pgSQL SECURITY DEFINER con search_path fijado, REVOKE por nombre
-- de rol (no solo PUBLIC — lección de T5: anon/authenticated heredan el grant
-- por defecto de PUBLIC y hay que revocarlos explícitamente) + GRANT a
-- service_role, y cron.schedule diario idempotente (unschedule defensivo).
--
-- TENANT-SAFETY:
--   - La regla de mora (`reglas_mora_config`) y la factura (`registros`)
--     comparten proyecto/empresa: el recargo se calcula con la regla activa del
--     MISMO project_id del registro (join por project_id), y la fila de
--     `recargos_mora` se inserta con (company_id, project_id) derivados de
--     `projects.company_id` del propio registro. No cruza tenants.
--   - La función corre como SECURITY DEFINER (sin RLS) PERO sigue acotando por
--     project_id en cada operación; no es un barrido global ciego.
--
-- ────────────────────────────────────────────────────────────────────────────
-- recargos_mora — PUENTE AGUA↔CONDOMINIOS (additivo, NO recrea la tabla):
--   `recargos_mora` se creó para condominios (20260420000029_condominios_fase29)
--   con `unidad_id NOT NULL → unidades(id)` y `cuota_id → cuotas_condominio(id)`,
--   tablas que la factura de AGUA (`registros`) no tiene. Para poder asentar el
--   recargo de agua en la MISMA tabla-ledger (en vez de duplicar una tabla
--   paralela) este PR, de forma ADITIVA:
--     · agrega `registro_id uuid → registros(id)` (nullable),
--     · relaja `unidad_id` a NULLABLE,
--     · añade un CHECK "exactamente uno de (unidad_id, registro_id)" para que
--       las filas de condominios (unidad_id) y las de agua (registro_id) sean
--       ambas válidas y mutuamente excluyentes.
--   No se inserta hoy en `recargos_mora` desde ningún punto del código (sólo se
--   lee desde la UI de condominios), así que añadir el CHECK no rompe inserts
--   existentes. Esto respeta la regla "no recrear reglas_mora_config /
--   recargos_mora": sólo se ALTERan de forma compatible.
-- ============================================================================

-- ────────────────────────────────────────────────────────────────────────────
-- 0. recargos_mora: puente para agua (ALTER aditivo + idempotente).
-- ────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.recargos_mora
  ADD COLUMN IF NOT EXISTS registro_id uuid;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'recargos_mora_registro_id_fkey'
      AND conrelid = 'public.recargos_mora'::regclass
  ) THEN
    ALTER TABLE public.recargos_mora
      ADD CONSTRAINT recargos_mora_registro_id_fkey
      FOREIGN KEY (registro_id)
      REFERENCES public.registros(id) ON DELETE CASCADE;
  END IF;
END $$;

-- unidad_id deja de ser obligatorio (las filas de agua usan registro_id).
ALTER TABLE public.recargos_mora ALTER COLUMN unidad_id DROP NOT NULL;

-- Exactamente uno de los dos "dueños" debe estar presente: una fila es de una
-- unidad de condominio (unidad_id) O de una factura de agua (registro_id).
ALTER TABLE public.recargos_mora DROP CONSTRAINT IF EXISTS recargos_mora_owner_check;
ALTER TABLE public.recargos_mora
  ADD CONSTRAINT recargos_mora_owner_check
  CHECK (num_nonnulls(unidad_id, registro_id) = 1);

COMMENT ON COLUMN public.recargos_mora.registro_id IS
  'Factura de agua (registros.id) a la que pertenece el recargo, cuando el recargo es de agua:C4 (en condominios se usa unidad_id). Excluyente con unidad_id (recargos_mora_owner_check).';

-- Idempotencia del recargo de agua a nivel DB: a lo sumo UNA fila viva por
-- factura. El cron, además, no re-inserta si mora_aplicada_at ya está.
CREATE UNIQUE INDEX IF NOT EXISTS uq_recargos_mora_registro_vivo
  ON public.recargos_mora(registro_id)
  WHERE registro_id IS NOT NULL AND estado <> 'anulado';

CREATE INDEX IF NOT EXISTS idx_recargos_mora_registro
  ON public.recargos_mora(registro_id)
  WHERE registro_id IS NOT NULL;

-- ────────────────────────────────────────────────────────────────────────────
-- 1. Función del cron: aplicar_mora_facturas_vencidas().
--
-- PARIDAD CON calcularMora (src/lib/business.ts), por línea:
--   const dias       = floor(diasTranscurridos)               → v_dias
--   const diasVenc   = regla.dias_vencimiento || 0            → r.dias_vencimiento (col NOT NULL default 30)
--   const gracia     = regla.periodo_gracia   || 0            → r.periodo_gracia    (col NOT NULL default 0)
--   const saldo      = max(saldoVencido, 0)                   → GREATEST(monto_calculado - COALESCE(monto_pagado,0), 0)
--   const cuota      = max(montoCuota,   0)                   → GREATEST(monto_calculado, 0)
--   const base       = aplicar_sobre==='monto_cuota'?cuota:saldo
--   const diasAtraso = dias - diasVenc
--   if (diasAtraso <= 0)            → no aplica
--   if (diasAtraso <= gracia)       → no aplica (gracia)
--   if (tipo==='porcentaje' && base<=0) → no aplica
--   const valor = regla.valor>0 ? regla.valor : 0; if (valor<=0) → no aplica
--   monto = tipo==='monto_fijo' ? round2(valor) : round2(base*(valor/100))
--   aplica = monto > 0
-- diasTranscurridos se mide desde emitida_at (la fecha base de la factura),
-- igual que el cálculo puro; round2 ≡ round(x::numeric,2) (half away from zero,
-- el mismo criterio que numeric de Postgres y que redondear2).
--
-- La condición de la transición emitida→vencida (fecha_vencimiento +
-- periodo_gracia < now()) y la condición de mora (diasAtraso > gracia con
-- fecha_vencimiento = emitida + dias_vencimiento) COINCIDEN: ambas exigen que
-- haya pasado dias_vencimiento + periodo_gracia desde la emisión.
-- ────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.aplicar_mora_facturas_vencidas()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_now timestamptz := now();
BEGIN
  -- ── 1) Transición emitida → vencida ──────────────────────────────────────
  -- Vence cuando fecha_vencimiento + periodo_gracia (de la regla activa del
  -- proyecto; 0 si no hay regla) ya pasó. Tenant-safe: la regla se busca por el
  -- project_id del propio registro.
  UPDATE public.registros r
  SET factura_estado = 'vencida',
      vencida_at      = COALESCE(r.vencida_at, v_now)
  FROM (
    SELECT reg.id AS registro_id,
           (reg.fecha_vencimiento
              + (COALESCE(rule.periodo_gracia, 0) || ' days')::interval) AS limite
    FROM public.registros reg
    LEFT JOIN LATERAL (
      SELECT rmc.periodo_gracia
      FROM public.reglas_mora_config rmc
      WHERE rmc.project_id = reg.project_id
        AND rmc.activa = true
      ORDER BY rmc.created_at DESC
      LIMIT 1
    ) rule ON true
    WHERE reg.factura_estado = 'emitida'
      AND reg.fecha_vencimiento IS NOT NULL
  ) v
  WHERE r.id = v.registro_id
    AND v.limite < v_now;

  -- ── 2) Recargo de mora (replica calcularMora) ────────────────────────────
  -- Sólo facturas ya vencidas, con regla activa, sin mora aplicada todavía
  -- (idempotencia por mora_aplicada_at). Se calcula la base/monto exactamente
  -- como la función pura y se persiste en registros + recargos_mora.
  WITH candidatas AS (
    SELECT
      reg.id            AS registro_id,
      reg.project_id    AS project_id,
      p.company_id      AS company_id,
      r.id              AS regla_mora_id,
      r.tipo            AS tipo,
      r.valor           AS valor,
      r.aplicar_sobre   AS aplicar_sobre,
      r.dias_vencimiento AS dias_vencimiento,
      r.periodo_gracia  AS periodo_gracia,
      COALESCE(reg.iva_monto, 0)        AS iva_monto,
      GREATEST(COALESCE(reg.monto_calculado, 0), 0) AS cuota,
      GREATEST(COALESCE(reg.monto_calculado, 0)
               - COALESCE(reg.monto_pagado, 0), 0)  AS saldo,
      -- dias = floor(diasTranscurridos) medido desde emitida_at (fallback fecha).
      floor(
        EXTRACT(EPOCH FROM (v_now - COALESCE(reg.emitida_at, reg.fecha))) / 86400.0
      )::int AS dias
    FROM public.registros reg
    JOIN public.projects p ON p.id = reg.project_id
    JOIN LATERAL (
      SELECT rmc.id, rmc.tipo, rmc.valor, rmc.aplicar_sobre,
             rmc.dias_vencimiento, rmc.periodo_gracia
      FROM public.reglas_mora_config rmc
      WHERE rmc.project_id = reg.project_id
        AND rmc.activa = true
      ORDER BY rmc.created_at DESC
      LIMIT 1
    ) r ON true
    WHERE reg.factura_estado = 'vencida'
      AND reg.mora_aplicada_at IS NULL       -- idempotencia
      AND reg.project_id IS NOT NULL
  ),
  calc AS (
    SELECT
      c.*,
      (c.dias - COALESCE(c.dias_vencimiento, 0))                      AS dias_atraso,
      CASE WHEN c.aplicar_sobre = 'monto_cuota' THEN c.cuota ELSE c.saldo END AS base,
      CASE WHEN COALESCE(c.valor, 0) > 0 THEN c.valor ELSE 0 END      AS valor_eff
    FROM candidatas c
  ),
  aplicables AS (
    SELECT
      calc.*,
      CASE
        WHEN calc.tipo = 'monto_fijo' THEN round(calc.valor_eff::numeric, 2)
        ELSE round((calc.base * (calc.valor_eff / 100.0))::numeric, 2)
      END AS monto
    FROM calc
    WHERE calc.dias_atraso > 0                              -- diasAtraso <= 0 → no
      AND calc.dias_atraso > COALESCE(calc.periodo_gracia, 0) -- dentro de gracia → no
      AND NOT (calc.tipo = 'porcentaje' AND calc.base <= 0)   -- % sin base → no
      AND calc.valor_eff > 0                                  -- valor 0 → no
  ),
  finales AS (
    SELECT * FROM aplicables WHERE monto > 0  -- aplica = monto > 0
  ),
  -- Inserta el recargo en el ledger compartido. ON CONFLICT contra el índice
  -- único parcial (registro vivo) → no duplica si por carrera ya existe.
  ins AS (
    INSERT INTO public.recargos_mora
      (company_id, project_id, unidad_id, cuota_id, registro_id,
       tipo, valor, monto_calculado, fecha_aplicacion, estado, motivo)
    SELECT
      f.company_id, f.project_id, NULL, NULL, f.registro_id,
      f.tipo, f.valor_eff, f.monto, v_now::date, 'aplicado',
      'Recargo por mora automático (cron agua:C4) — ' || f.dias_atraso || ' días de atraso'
    FROM finales f
    ON CONFLICT (registro_id) WHERE (registro_id IS NOT NULL AND estado <> 'anulado')
    DO NOTHING
    RETURNING registro_id
  )
  -- Persiste en la factura: mora_monto, regla, timestamp y total recompuesto.
  UPDATE public.registros reg
  SET mora_monto       = f.monto,
      regla_mora_id    = f.regla_mora_id,
      mora_aplicada_at = v_now,
      total_a_pagar    = round(
        (COALESCE(reg.monto_calculado, 0) + f.iva_monto + f.monto)::numeric, 2
      )
  FROM finales f
  WHERE reg.id = f.registro_id;
END
$$;

COMMENT ON FUNCTION public.aplicar_mora_facturas_vencidas() IS
  'Cron de mora (agua:C4): marca facturas emitidas vencidas (emitida→vencida) y aplica el recargo de mora replicando calcularMora de src/lib/business.ts, persistiendo en registros + recargos_mora. Idempotente (mora_aplicada_at + índice único). SECURITY DEFINER; sólo service_role / el job pueden ejecutarla.';

-- ────────────────────────────────────────────────────────────────────────────
-- 2. Endurecer permisos (lección T5: revocar por NOMBRE de rol, no sólo PUBLIC).
--    Postgres otorga EXECUTE a PUBLIC por defecto, del que heredan anon y
--    authenticated; hay que revocarlos explícitamente para que no sea invocable
--    como RPC por usuarios finales. Sólo service_role (y el dueño, vía el cron).
-- ────────────────────────────────────────────────────────────────────────────
REVOKE EXECUTE ON FUNCTION public.aplicar_mora_facturas_vencidas() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.aplicar_mora_facturas_vencidas() FROM anon;
REVOKE EXECUTE ON FUNCTION public.aplicar_mora_facturas_vencidas() FROM authenticated;
GRANT  EXECUTE ON FUNCTION public.aplicar_mora_facturas_vencidas() TO service_role;

-- ────────────────────────────────────────────────────────────────────────────
-- 3. Schedule diario en la madrugada (pg_cron), idempotente.
--    03:30 UTC: ventana de bajo tráfico, separada de los demás jobs
--    (deactivate_expired_tarifas 03:00, route_reminders cada hora) para no
--    solaparse. Mismo patrón unschedule-defensivo de los crons existentes.
-- ────────────────────────────────────────────────────────────────────────────
CREATE EXTENSION IF NOT EXISTS pg_cron;

SELECT cron.unschedule(jobid)
FROM cron.job
WHERE jobname = 'aplicar_mora_facturas_vencidas_daily';

SELECT cron.schedule(
  'aplicar_mora_facturas_vencidas_daily',
  '30 3 * * *',
  $$SELECT public.aplicar_mora_facturas_vencidas();$$
);
