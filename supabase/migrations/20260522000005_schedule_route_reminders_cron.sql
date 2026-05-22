-- ============================================================
-- Job de recordatorios de rutas (pg_cron + pg_net)
-- ============================================================
-- Cada hora: (1) genera/actualiza ocurrencias, (2) invoca el edge function
-- `route-reminders` para que envíe los recordatorios que ya entran en su ventana
-- de anticipación. Hora (no día) para poder respetar `hora_programada`.
--
-- Requiere dos secretos en Vault (se cargan una sola vez, fuera de git):
--   - route_reminders_url          = https://<ref>.supabase.co/functions/v1/route-reminders
--   - route_reminders_service_key  = SERVICE_ROLE_KEY del proyecto
-- Si faltan, run_route_reminders() solo genera ocurrencias y NO hace la llamada
-- HTTP (no falla), así esta migración es segura de aplicar antes de configurarlos.

CREATE EXTENSION IF NOT EXISTS pg_net;

CREATE OR REPLACE FUNCTION public.run_route_reminders()
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_url text;
  v_key text;
BEGIN
  -- 1) Generar ocurrencias y marcar vencidas.
  PERFORM public.generar_ocurrencias_rutas(30);

  -- 2) Leer secretos de Vault (si no existen, no se envían recordatorios).
  SELECT decrypted_secret INTO v_url FROM vault.decrypted_secrets WHERE name = 'route_reminders_url';
  SELECT decrypted_secret INTO v_key FROM vault.decrypted_secrets WHERE name = 'route_reminders_service_key';

  IF v_url IS NOT NULL AND v_key IS NOT NULL THEN
    PERFORM net.http_post(
      url     := v_url,
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || v_key
      ),
      body    := jsonb_build_object('mode', 'batch')
    );
  END IF;
END $$;

-- Programación horaria idempotente (mismo patrón que deactivate_expired_tarifas).
SELECT cron.unschedule(jobid)
FROM cron.job
WHERE jobname = 'route_reminders_hourly';

SELECT cron.schedule(
  'route_reminders_hourly',
  '0 * * * *',
  $$SELECT public.run_route_reminders();$$
);
