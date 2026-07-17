-- ============================================================================
-- Recordatorios automáticos de cobranza en AGUA (F4 — espejo de 20260713090000)
-- ============================================================================
-- Condominios ya tiene recordatorios automáticos de cuotas impagas (próximas a
-- vencer o vencidas) vía cron + outbox in_app. Agua no: un recibo emitido que
-- el cliente no paga solo se entera al entrar a su portal. Este PR replica el
-- MISMO patrón sobre `registros`:
--
--   · Candidatos: registros no borrados cuya Factura (proyección sobre
--     registros, 20260604160000) esté 'emitida' o 'vencida' — misma
--     normalización legacy que agua_cerrar_ciclo ('pagado'→pagada,
--     'mora'→vencida) — con fecha_vencimiento a ≤3 días o pasada.
--   · Destinatario: el cliente del recibo con login de portal activo
--     (app_users.cliente_id → registros.cliente_id), igual que el aviso de
--     emisión del cierre de ciclo. `registros` no tiene company_id: se
--     resuelve por projects.company_id.
--   · Idempotente: registro_recordatorios_log con UNIQUE(registro_id,
--     user_id, hito) → a lo sumo un 'proximo' y un 'vencida' por
--     recibo/cliente. INSERT ... ON CONFLICT DO NOTHING RETURNING encola solo
--     los nuevos.
--   · Canal in_app (la campana): SIEMPRE entregable, sin credenciales
--     externas — mismo criterio que los recordatorios de cuotas.
-- ============================================================================

-- ── Log de recordatorios enviados (idempotencia + auditoría) ────────────────
CREATE TABLE IF NOT EXISTS public.registro_recordatorios_log (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  registro_id uuid NOT NULL REFERENCES public.registros(id) ON DELETE CASCADE,
  user_id     uuid NOT NULL,          -- destinatario (app_users.id)
  hito        text NOT NULL CHECK (hito IN ('proximo','vencida')),
  company_id  uuid,
  created_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT registro_recordatorio_unico UNIQUE (registro_id, user_id, hito)
);
CREATE INDEX IF NOT EXISTS idx_registro_recordatorios_registro
  ON public.registro_recordatorios_log(registro_id);

ALTER TABLE public.registro_recordatorios_log ENABLE ROW LEVEL SECURITY;

-- Solo lectura para staff del tenant (auditoría); escribe el cron (owner,
-- bypassa RLS). Mismo patrón que cuota_recordatorios_log.
DROP POLICY IF EXISTS "registro_recordatorios_log_select" ON public.registro_recordatorios_log;
CREATE POLICY "registro_recordatorios_log_select" ON public.registro_recordatorios_log
  FOR SELECT TO authenticated
  USING (
    is_super_admin()
    OR (company_id = get_my_company_id() AND user_has_permission('agua.cobros.view'))
  );

-- ── Función: encola recordatorios de los recibos de agua impagos ────────────
CREATE OR REPLACE FUNCTION public.enqueue_recordatorios_agua()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_count integer := 0;
BEGIN
  WITH candidatas AS (
    -- Recibos emitidos/vencidos impagos con vencimiento: pasados o a ≤3 días.
    SELECT r.id AS registro_id, p.company_id, r.cliente_id, r.fecha_vencimiento,
           COALESCE(r.total_a_pagar, r.monto_calculado) AS monto,
           COALESCE(p.moneda, '') AS moneda,
           CASE WHEN r.fecha_vencimiento < current_date THEN 'vencida' ELSE 'proximo' END AS hito
    FROM public.registros r
    JOIN public.projects p ON p.id = r.project_id
    WHERE r.deleted_at IS NULL
      AND r.cliente_id IS NOT NULL
      AND r.fecha_vencimiento IS NOT NULL
      AND r.fecha_vencimiento <= current_date + 3
      -- Normalización de la máquina de estados de Factura (idéntica a
      -- agua_cerrar_ciclo): solo emitida/vencida reciben recordatorio —
      -- pendiente aún no se emitió; pagada/anulada ya no se cobran.
      AND (CASE
             WHEN COALESCE(r.factura_estado, r.estado) IN ('pendiente','emitida','pagada','vencida','anulada')
               THEN COALESCE(r.factura_estado, r.estado)
             WHEN COALESCE(r.factura_estado, r.estado) = 'pagado' THEN 'pagada'
             WHEN COALESCE(r.factura_estado, r.estado) = 'mora'   THEN 'vencida'
             ELSE 'pendiente'
           END) IN ('emitida','vencida')
  ),
  destinatarios AS (
    -- El cliente del recibo con login de portal activo (enlace directo, igual
    -- que el aviso de emisión del cierre de ciclo).
    SELECT DISTINCT ca.registro_id, ca.company_id, ca.hito, ca.fecha_vencimiento,
           ca.monto, ca.moneda, au.id AS user_id
    FROM candidatas ca
    JOIN public.app_users au ON au.cliente_id = ca.cliente_id AND au.activo = true
  ),
  logged AS (
    INSERT INTO public.registro_recordatorios_log (registro_id, user_id, hito, company_id)
    SELECT registro_id, user_id, hito, company_id FROM destinatarios
    ON CONFLICT (registro_id, user_id, hito) DO NOTHING
    RETURNING registro_id, user_id, hito
  )
  SELECT count(public.enqueue_notification(
    'in_app',
    d.user_id::text,
    jsonb_build_object(
      'tipo', 'recibo_agua_recordatorio',
      'titulo', CASE WHEN d.hito = 'vencida' THEN 'Recibo de agua vencido' ELSE 'Recibo de agua por vencer' END,
      'cuerpo',
        'Recibo de agua por '
        || (CASE WHEN d.moneda <> '' THEN d.moneda || ' ' ELSE '' END)
        || to_char(d.monto, 'FM999999990.00')
        || CASE WHEN d.hito = 'vencida'
                THEN ' — vencido desde el ' || to_char(d.fecha_vencimiento, 'DD/MM/YYYY') || '. Regulariza tu pago.'
                ELSE ' — vence el ' || to_char(d.fecha_vencimiento, 'DD/MM/YYYY') || '.' END,
      'seccion', 'cobros',
      'registro_id', d.registro_id,
      'hito', d.hito
    ),
    d.company_id,
    NULL::text,
    now()
  ))::integer
  INTO v_count
  FROM destinatarios d
  JOIN logged l ON l.registro_id = d.registro_id AND l.user_id = d.user_id AND l.hito = d.hito;

  RETURN COALESCE(v_count, 0);
END
$fn$;

-- Grants por nombre (lección 20260604210000 + hardening 20260713110000: los
-- default privileges dan EXECUTE a authenticated — revocar explícito; el cron
-- corre como owner y no necesita grant).
REVOKE ALL ON FUNCTION public.enqueue_recordatorios_agua() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.enqueue_recordatorios_agua() FROM anon;
REVOKE ALL ON FUNCTION public.enqueue_recordatorios_agua() FROM authenticated;

COMMENT ON FUNCTION public.enqueue_recordatorios_agua IS
  'Encola recordatorios in-app (outbox) a los clientes con recibos de agua emitidos/vencidos impagos (próximos a vencer o vencidos). Idempotente vía registro_recordatorios_log. Devuelve cuántos encoló. Espejo de enqueue_recordatorios_cuotas (F4).';

-- ── pg_cron: diario 13:35 UTC (07:35 GT, tras el de cuotas a las 13:30) ─────
DO $$
BEGIN
  PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname = 'recordatorios_agua_daily';
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

SELECT cron.schedule(
  'recordatorios_agua_daily',
  '35 13 * * *',
  $$SELECT public.enqueue_recordatorios_agua();$$
);
