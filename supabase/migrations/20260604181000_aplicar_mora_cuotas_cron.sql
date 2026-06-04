-- ============================================================================
-- T4 · Facturación de dominio (épica #305) — cond:C6
-- CRON DE MORA DE CONDOMINIOS: emitida → vencida + recargo automático sobre el
-- agregado Cuota (`cuotas_condominio`). Follow-up de
-- 20260604180000_cuota_condominio_state_machine_mora.sql.
-- Paridad 1:1 con el cron de agua #385 (aplicar_mora_facturas_vencidas).
-- ============================================================================
-- Banda de migración EXCLUSIVA T4 del 2026-06-04: 180000–185959.
-- SQL idempotente y re-ejecutable.
--
-- QUÉ HACE (función public.aplicar_mora_cuotas_vencidas()):
--   1. Transición de estado: marca `emitida → vencida` (set vencida_at=now())
--      las cuotas cuyo `fecha_vencimiento + periodo_gracia < now()`.
--   2. Recargo de mora: replica EN SQL la lógica pura de `calcularMora` de
--      src/lib/business.ts (ver "PARIDAD" más abajo) — la MISMA función que el
--      cron de agua y que businessCondominios.ts reutilizan — inserta una fila
--      en `recargos_mora` (por unidad_id/cuota_id, forma condominios), setea
--      `cuotas_condominio.mora_monto` + `mora_aplicada_at` + `regla_mora_id` y
--      recompone `total_a_pagar = monto + mora_monto` (SIN IVA — la cuota de
--      mantenimiento no es factura comercial; ver cabecera de 180000).
--   3. Idempotente: no re-aplica mora si `mora_aplicada_at` ya está. La fila de
--      `recargos_mora` se de-duplica por el índice único parcial sobre cuota_id
--      (estado <> 'anulado'), uq_recargos_mora_cuota_vivo (de 180000).
--
-- POR QUÉ saldo == cuota == monto: `cuotas_condominio` no lleva pago parcial
--   (el pago es all-or-nothing vía estado/fecha_pago). Una cuota en estado
--   'vencida' está por definición impaga, así que su saldo vencido es el monto
--   completo. Por eso, sea cual sea reglas_mora_config.aplicar_sobre
--   ('saldo_vencido' | 'monto_cuota'), la base es `monto`. Esto es exactamente
--   lo que produce calcularMora cuando saldoVencido == montoCuota == monto.
--
-- PATRÓN DE CRON: idéntico a #385 (aplicar_mora_facturas_vencidas) /
-- schedule_route_reminders / harden_route_function_grants: función PL/pgSQL
-- SECURITY DEFINER con search_path fijado, REVOKE por NOMBRE de rol (no sólo
-- PUBLIC — anon/authenticated heredan el grant por defecto de PUBLIC y hay que
-- revocarlos explícitamente) + GRANT a service_role, y cron.schedule diario
-- idempotente (unschedule defensivo).
--
-- TENANT-SAFETY:
--   - La regla de mora (`reglas_mora_config`) y la cuota (`cuotas_condominio`)
--     comparten proyecto/empresa: el recargo se calcula con la regla activa del
--     MISMO project_id de la cuota (JOIN LATERAL por project_id), y la fila de
--     `recargos_mora` se inserta con (company_id, project_id, unidad_id,
--     cuota_id) derivados de la propia cuota. No cruza tenants.
--   - La función corre como SECURITY DEFINER (sin RLS) PERO sigue acotando por
--     project_id en cada operación; no es un barrido global ciego.
--   - Excluye cuotas soft-deleted (deleted_at IS NULL) y sin unidad
--     (unidad_id IS NOT NULL): el recargo necesita una unidad dueña para
--     satisfacer recargos_mora_owner_check (num_nonnulls(unidad_id,
--     registro_id)=1). Las cuotas globales tipo CAM (unidad_id NULL) no reciben
--     recargo por unidad — quedan fuera del scope del ledger por unidad.
-- ============================================================================

-- ────────────────────────────────────────────────────────────────────────────
-- 1. Función del cron: aplicar_mora_cuotas_vencidas().
--
-- PARIDAD CON calcularMora (src/lib/business.ts), por línea — IDÉNTICA a #385:
--   const dias       = floor(diasTranscurridos)               → v_dias
--   const diasVenc   = regla.dias_vencimiento || 0            → r.dias_vencimiento (col NOT NULL default 30)
--   const gracia     = regla.periodo_gracia   || 0            → r.periodo_gracia    (col NOT NULL default 0)
--   const saldo      = max(saldoVencido, 0)                   → GREATEST(monto, 0)  (cuota impaga: saldo=monto)
--   const cuota      = max(montoCuota,   0)                   → GREATEST(monto, 0)
--   const base       = aplicar_sobre==='monto_cuota'?cuota:saldo  (ambos = monto)
--   const diasAtraso = dias - diasVenc
--   if (diasAtraso <= 0)            → no aplica
--   if (diasAtraso <= gracia)       → no aplica (gracia)
--   if (tipo==='porcentaje' && base<=0) → no aplica
--   const valor = regla.valor>0 ? regla.valor : 0; if (valor<=0) → no aplica
--   monto = tipo==='monto_fijo' ? round2(valor) : round2(base*(valor/100))
--   aplica = monto > 0
-- diasTranscurridos se mide desde emitida_at (fecha base de la cuota; fallback
-- created_at), igual que el cálculo puro y que #385 (que usa emitida_at fallback
-- fecha). round2 ≡ round(x::numeric,2) (half away from zero, el mismo criterio
-- que numeric de Postgres y que redondear2).
--
-- La condición de la transición emitida→vencida (fecha_vencimiento +
-- periodo_gracia < now()) y la condición de mora (diasAtraso > gracia con
-- fecha_vencimiento = emitida + dias_vencimiento) COINCIDEN: ambas exigen que
-- haya pasado dias_vencimiento + periodo_gracia desde la emisión.
-- ────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.aplicar_mora_cuotas_vencidas()
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
  -- project_id de la propia cuota. Excluye soft-deleted.
  UPDATE public.cuotas_condominio c
  SET cuota_estado = 'vencida',
      vencida_at   = COALESCE(c.vencida_at, v_now)
  FROM (
    SELECT cu.id AS cuota_id,
           (cu.fecha_vencimiento
              + (COALESCE(rule.periodo_gracia, 0) || ' days')::interval) AS limite
    FROM public.cuotas_condominio cu
    LEFT JOIN LATERAL (
      SELECT rmc.periodo_gracia
      FROM public.reglas_mora_config rmc
      WHERE rmc.project_id = cu.project_id
        AND rmc.activa = true
      ORDER BY rmc.created_at DESC
      LIMIT 1
    ) rule ON true
    WHERE cu.cuota_estado = 'emitida'
      AND cu.fecha_vencimiento IS NOT NULL
      AND cu.deleted_at IS NULL
  ) v
  WHERE c.id = v.cuota_id
    AND v.limite < v_now;

  -- ── 2) Recargo de mora (replica calcularMora) ────────────────────────────
  -- Sólo cuotas ya vencidas, con regla activa, con unidad dueña, sin mora
  -- aplicada todavía (idempotencia por mora_aplicada_at). Se calcula la
  -- base/monto exactamente como la función pura y se persiste en
  -- cuotas_condominio + recargos_mora.
  WITH candidatas AS (
    SELECT
      cu.id             AS cuota_id,
      cu.project_id     AS project_id,
      cu.company_id     AS company_id,
      cu.unidad_id      AS unidad_id,
      r.id              AS regla_mora_id,
      r.tipo            AS tipo,
      r.valor           AS valor,
      r.aplicar_sobre   AS aplicar_sobre,
      r.dias_vencimiento AS dias_vencimiento,
      r.periodo_gracia  AS periodo_gracia,
      -- cuota impaga ⇒ saldo vencido == monto cuota == monto.
      GREATEST(COALESCE(cu.monto, 0), 0) AS cuota,
      GREATEST(COALESCE(cu.monto, 0), 0) AS saldo,
      -- dias = floor(diasTranscurridos) medido desde emitida_at (fallback created_at).
      floor(
        EXTRACT(EPOCH FROM (v_now - COALESCE(cu.emitida_at, cu.created_at))) / 86400.0
      )::int AS dias
    FROM public.cuotas_condominio cu
    JOIN LATERAL (
      SELECT rmc.id, rmc.tipo, rmc.valor, rmc.aplicar_sobre,
             rmc.dias_vencimiento, rmc.periodo_gracia
      FROM public.reglas_mora_config rmc
      WHERE rmc.project_id = cu.project_id
        AND rmc.activa = true
      ORDER BY rmc.created_at DESC
      LIMIT 1
    ) r ON true
    WHERE cu.cuota_estado = 'vencida'
      AND cu.mora_aplicada_at IS NULL       -- idempotencia
      AND cu.unidad_id IS NOT NULL          -- recargo necesita unidad dueña (owner_check)
      AND cu.deleted_at IS NULL
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
    WHERE calc.dias_atraso > 0                                -- diasAtraso <= 0 → no
      AND calc.dias_atraso > COALESCE(calc.periodo_gracia, 0) -- dentro de gracia → no
      AND NOT (calc.tipo = 'porcentaje' AND calc.base <= 0)   -- % sin base → no
      AND calc.valor_eff > 0                                  -- valor 0 → no
  ),
  finales AS (
    SELECT * FROM aplicables WHERE monto > 0  -- aplica = monto > 0
  ),
  -- Inserta el recargo en el ledger compartido recargos_mora, por unidad/cuota
  -- (forma condominios). ON CONFLICT contra el índice único parcial (cuota viva)
  -- → no duplica si por carrera ya existe.
  ins AS (
    INSERT INTO public.recargos_mora
      (company_id, project_id, unidad_id, cuota_id, registro_id,
       tipo, valor, monto_calculado, fecha_aplicacion, estado, motivo)
    SELECT
      f.company_id, f.project_id, f.unidad_id, f.cuota_id, NULL,
      f.tipo, f.valor_eff, f.monto, v_now::date, 'aplicado',
      'Recargo por mora automático (cron cond:C6) — ' || f.dias_atraso || ' días de atraso'
    FROM finales f
    ON CONFLICT (cuota_id) WHERE (cuota_id IS NOT NULL AND estado <> 'anulado')
    DO NOTHING
    RETURNING cuota_id
  )
  -- Persiste en la cuota: mora_monto, regla, timestamp y total recompuesto
  -- (monto + mora; SIN IVA).
  UPDATE public.cuotas_condominio cu
  SET mora_monto       = f.monto,
      regla_mora_id    = f.regla_mora_id,
      mora_aplicada_at = v_now,
      total_a_pagar    = round((COALESCE(cu.monto, 0) + f.monto)::numeric, 2)
  FROM finales f
  WHERE cu.id = f.cuota_id;
END
$$;

COMMENT ON FUNCTION public.aplicar_mora_cuotas_vencidas() IS
  'Cron de mora de condominios (cond:C6): marca cuotas emitidas vencidas (emitida→vencida) y aplica el recargo de mora replicando calcularMora de src/lib/business.ts, persistiendo en cuotas_condominio + recargos_mora (por unidad_id/cuota_id). Idempotente (mora_aplicada_at + índice único uq_recargos_mora_cuota_vivo). Tenant-safe (acota por project_id). SECURITY DEFINER; sólo service_role / el job pueden ejecutarla.';

-- ────────────────────────────────────────────────────────────────────────────
-- 2. Endurecer permisos (lección T5: revocar por NOMBRE de rol, no sólo PUBLIC).
--    Postgres otorga EXECUTE a PUBLIC por defecto, del que heredan anon y
--    authenticated; hay que revocarlos explícitamente para que no sea invocable
--    como RPC por usuarios finales. Sólo service_role (y el dueño, vía el cron).
-- ────────────────────────────────────────────────────────────────────────────
REVOKE EXECUTE ON FUNCTION public.aplicar_mora_cuotas_vencidas() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.aplicar_mora_cuotas_vencidas() FROM anon;
REVOKE EXECUTE ON FUNCTION public.aplicar_mora_cuotas_vencidas() FROM authenticated;
GRANT  EXECUTE ON FUNCTION public.aplicar_mora_cuotas_vencidas() TO service_role;

-- ────────────────────────────────────────────────────────────────────────────
-- 3. Schedule diario en la madrugada (pg_cron), idempotente.
--    03:45 UTC: ventana de bajo tráfico, separada de los demás jobs para no
--    solaparse — deactivate_expired_tarifas (03:00), aplicar_mora_facturas
--    (agua, 03:30), route_reminders (cada hora). Mismo patrón unschedule-
--    defensivo de los crons existentes.
-- ────────────────────────────────────────────────────────────────────────────
CREATE EXTENSION IF NOT EXISTS pg_cron;

SELECT cron.unschedule(jobid)
FROM cron.job
WHERE jobname = 'aplicar_mora_cuotas_vencidas_daily';

SELECT cron.schedule(
  'aplicar_mora_cuotas_vencidas_daily',
  '45 3 * * *',
  $$SELECT public.aplicar_mora_cuotas_vencidas();$$
);
