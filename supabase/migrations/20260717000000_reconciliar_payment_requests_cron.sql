-- ============================================================================
-- Reconciliación de pagos hospedados abandonados (auditoría 2026-07-16, C3)
-- ============================================================================
-- confirm-charge fue diseñado idempotente para "retorno del portal + cron de
-- reconciliación", pero el cron nunca se agendó: un residente que paga en el
-- checkout hospedado y cierra la pestaña sin volver dejaba su payment_request
-- en 'pending' para siempre — dinero cobrado por el provider sin acreditar.
--
-- Este job corre cada 15 minutos y hace 3 barridos:
--   1. pending SIN provider_ref y >24 h  → 'failed' (nunca llegó al provider;
--      no hay nada que consultar).
--   2. pending CON provider_ref, entre 15 min y 30 días → POST a confirm-charge
--      (service_role), que consulta al provider y concilia si está aprobado.
--      confirm-charge es idempotente: reintentos no duplican pagos.
--   3. pending CON provider_ref y >30 días → 'failed'. La ventana amplia
--      garantiza que el backlog pre-cron sea CONSULTADO al provider antes de
--      expirar (por si algún pago viejo sí se aprobó y nunca se concilió).
--      Un 'failed' sigue siendo re-confirmable manualmente: confirm-charge
--      solo corto-circuita en 'succeeded'.
--
-- Secrets del vault (los MISMOS que usa dispatch_scheduled_reports, así la
-- activación del runbook SAVED_REPORTS_SCHEDULE.md enciende ambos):
--   · edge_function_url  — base https://<proj>.supabase.co/functions/v1
--   · service_role_key   — para el Bearer que confirm-charge exige del cron
-- Safe fallback: sin secrets, el job retorna 0 con NOTICE y no rompe el cron.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.reconciliar_payment_requests_pendientes()
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_base_url text;
  v_service_key text;
  v_expirados_sin_ref integer := 0;
  v_expirados integer := 0;
  v_enviados integer := 0;
  r record;
BEGIN
  -- 1) Higiene: pending sin referencia del provider tras 24 h → failed.
  WITH exp AS (
    UPDATE public.payment_requests
       SET estado = 'failed',
           notas = COALESCE(notas || ' · ', '') || 'expirado sin referencia del proveedor (reconciliación)',
           updated_at = now()
     WHERE estado = 'pending'
       AND provider_ref IS NULL
       AND created_at < now() - interval '24 hours'
     RETURNING 1
  )
  SELECT count(*) INTO v_expirados_sin_ref FROM exp;

  -- 3) Vencimiento: pending con referencia pero >30 días → failed. La ventana
  --    de 30 días asegura que todo pending viejo fue consultado al provider
  --    muchas veces por el barrido (2) antes de darse por vencido.
  WITH exp AS (
    UPDATE public.payment_requests
       SET estado = 'failed',
           notas = COALESCE(notas || ' · ', '') || 'expirado tras 30 días pendiente (reconciliación)',
           updated_at = now()
     WHERE estado = 'pending'
       AND provider_ref IS NOT NULL
       AND created_at < now() - interval '30 days'
     RETURNING 1
  )
  SELECT count(*) INTO v_expirados FROM exp;

  -- 2) Reconciliación real vía confirm-charge (consulta al provider).
  SELECT decrypted_secret INTO v_base_url
    FROM vault.decrypted_secrets WHERE name = 'edge_function_url';
  SELECT decrypted_secret INTO v_service_key
    FROM vault.decrypted_secrets WHERE name = 'service_role_key';

  IF v_base_url IS NULL OR v_service_key IS NULL THEN
    RAISE NOTICE 'reconciliar_payment_requests: secrets del vault no configurados (edge_function_url / service_role_key); % expirados sin ref, % vencidos', v_expirados_sin_ref, v_expirados;
    RETURN 0;
  END IF;

  -- Cap de 50 por corrida (oldest-first): el cron corre cada 15 min, el
  -- backlog drena solo. net.http_post es async (pg_net), no bloquea.
  FOR r IN
    SELECT id
      FROM public.payment_requests
     WHERE estado = 'pending'
       AND provider_ref IS NOT NULL
       AND created_at < now() - interval '15 minutes'
       AND created_at >= now() - interval '30 days'
     ORDER BY created_at
     LIMIT 50
  LOOP
    PERFORM net.http_post(
      url     := v_base_url || '/confirm-charge',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || v_service_key
      ),
      body    := jsonb_build_object('payment_request_id', r.id, 'source', 'pg_cron')
    );
    v_enviados := v_enviados + 1;
  END LOOP;

  RAISE NOTICE 'reconciliar_payment_requests: % enviados a confirm-charge, % expirados sin ref, % vencidos', v_enviados, v_expirados_sin_ref, v_expirados;
  RETURN v_enviados;
END $$;

REVOKE EXECUTE ON FUNCTION public.reconciliar_payment_requests_pendientes() FROM PUBLIC;

COMMENT ON FUNCTION public.reconciliar_payment_requests_pendientes() IS
  'Barrido de reconciliación de pagos en línea (cada 15 min via pg_cron): reenvía los pending con provider_ref a confirm-charge y expira los abandonados. Auditoría 2026-07-16, hallazgo C3.';

-- Reschedule idempotente (mismo patrón que email_queue_worker).
DO $$
BEGIN
  PERFORM cron.unschedule(jobid)
  FROM cron.job
  WHERE jobname = 'reconciliar_payment_requests';
EXCEPTION
  WHEN OTHERS THEN NULL;
END $$;

SELECT cron.schedule(
  'reconciliar_payment_requests',
  '*/15 * * * *',
  $$SELECT public.reconciliar_payment_requests_pendientes()$$
);
