-- ============================================================================
-- F4.5.1c — pg_cron schedule para auto-envío de saved reports
-- ============================================================================
-- Cierra el ciclo "set & forget" de Reportes guardados. La cadena queda:
--   pg_cron (Supabase) → invoca edge function process-scheduled-reports →
--   por cada template due: ejecuta query → genera CSV → upload Storage →
--   encola email via email_send_queue → UPDATE last_run_at + INSERT report_runs.
--
-- Esta migration solo crea la INFRAESTRUCTURA SQL (columna + función helper
-- + cron jobs registrados). Los cron jobs estan REGISTRADOS pero apuntan a
-- una funcion local stub que loguea por defecto — el operador debe
-- configurar el supabase_vault con los secrets supabase_url + service_role_key
-- y descomentar las lineas de pg_net.http_post para activar el dispatch real.
--
-- Diseño:
--   1. Column `last_run_at` rastrea ultima ejecucion exitosa.
--   2. Function claim_due_scheduled_reports(schedule_kind) retorna IDs a
--      procesar (schedule matchea + no se ha corrido HOY).
--   3. Cron jobs corren a las 09:00 UTC del dia 1 (monthly) y lunes (weekly).
--   4. Función dispatch_scheduled_reports() es un wrapper que el cron invoca;
--      por defecto solo registra en notification_log para diagnostico, pero
--      con vault configurado puede llamar a la edge function.
-- ============================================================================

-- ─── 1. Column last_run_at ──────────────────────────────────────────────────
ALTER TABLE public.report_templates
  ADD COLUMN IF NOT EXISTS last_run_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_report_templates_schedule_lastrun
  ON public.report_templates(schedule_kind, last_run_at)
  WHERE schedule_kind != 'manual';

-- ─── 2. Función claim_due_scheduled_reports ─────────────────────────────────
-- Returns: ids de templates que matchean el schedule_kind + no se corrieron
-- hoy (UTC). El caller actualiza last_run_at tras procesar exitosamente.
CREATE OR REPLACE FUNCTION public.claim_due_scheduled_reports(p_schedule_kind text)
RETURNS TABLE (
  id            uuid,
  company_id    uuid,
  name          text,
  source_table  text,
  default_format text
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    rt.id, rt.company_id, rt.name, rt.source_table, rt.default_format
  FROM public.report_templates rt
  WHERE rt.schedule_kind = p_schedule_kind
    AND (
      rt.last_run_at IS NULL
      OR rt.last_run_at < date_trunc('day', now() AT TIME ZONE 'UTC')
    )
    AND array_length(
      ARRAY(SELECT jsonb_array_elements_text(rt.recipients)),
      1
    ) > 0;
$$;

COMMENT ON FUNCTION public.claim_due_scheduled_reports IS
  'F4.5.1c — devuelve report_templates que deben ejecutarse hoy segun schedule_kind y last_run_at. Excluye templates sin recipients.';

-- ─── 3. Función wrapper dispatch_scheduled_reports ──────────────────────────
-- Esta es la SQL function que pg_cron invoca. Por defecto solo loguea via
-- NOTICE — con vault configurado, descomenta las lineas de pg_net.http_post
-- para que llame a la edge function.
CREATE OR REPLACE FUNCTION public.dispatch_scheduled_reports(p_schedule_kind text)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_count integer := 0;
  v_template record;
  -- Para activacion: descomenta y configura via vault.create_secret
  -- v_function_url text := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'edge_function_url') || '/process-scheduled-reports';
  -- v_service_key  text := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'service_role_key');
BEGIN
  FOR v_template IN
    SELECT * FROM public.claim_due_scheduled_reports(p_schedule_kind)
  LOOP
    v_count := v_count + 1;
    RAISE NOTICE 'F4.5.1c dispatch: template_id=% name=% schedule=%',
      v_template.id, v_template.name, p_schedule_kind;

    -- Activacion real (requiere vault secrets configurados):
    -- PERFORM net.http_post(
    --   url := v_function_url,
    --   headers := jsonb_build_object(
    --     'Content-Type', 'application/json',
    --     'Authorization', 'Bearer ' || v_service_key
    --   ),
    --   body := jsonb_build_object('template_id', v_template.id)
    -- );
  END LOOP;

  RETURN v_count;
END;
$$;

COMMENT ON FUNCTION public.dispatch_scheduled_reports IS
  'F4.5.1c — invocado por pg_cron. Por defecto solo loguea; con vault secrets, llama a edge function process-scheduled-reports.';

-- ─── 4. Cron jobs ────────────────────────────────────────────────────────────
-- Los cron jobs se registran idempotentemente. Si ya existen, se actualizan.
-- IMPORTANTE: timezone del schedule es UTC.
DO $$
BEGIN
  -- Monthly: dia 1 de cada mes a las 09:00 UTC
  PERFORM cron.unschedule('reports-monthly-day1') WHERE EXISTS (
    SELECT 1 FROM cron.job WHERE jobname = 'reports-monthly-day1'
  );
  PERFORM cron.schedule(
    'reports-monthly-day1',
    '0 9 1 * *',
    $cmd$ SELECT public.dispatch_scheduled_reports('monthly_day1'); $cmd$
  );

  -- Weekly: cada lunes a las 09:00 UTC
  PERFORM cron.unschedule('reports-weekly-monday') WHERE EXISTS (
    SELECT 1 FROM cron.job WHERE jobname = 'reports-weekly-monday'
  );
  PERFORM cron.schedule(
    'reports-weekly-monday',
    '0 9 * * 1',
    $cmd$ SELECT public.dispatch_scheduled_reports('weekly_monday'); $cmd$
  );
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'cron.schedule fallo: %. Configura los crons manualmente via Dashboard.', SQLERRM;
END $$;
