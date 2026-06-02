-- ============================================================================
-- F4.5.1c-real — activa el dispatch real a la edge function
-- ============================================================================
-- Sustituye la version stub de dispatch_scheduled_reports() (que solo
-- loguea via RAISE NOTICE) por una version que invoca la edge function
-- process-scheduled-reports vía pg_net.http_post.
--
-- Secrets requeridos en supabase_vault (crear manualmente UNA VEZ):
--   SELECT vault.create_secret('https://<proyecto>.supabase.co/functions/v1', 'edge_function_url');
--   SELECT vault.create_secret('<service_role_key>', 'service_role_key');
--
-- Si los secrets NO existen, la función falla silenciosamente con NOTICE para
-- no romper el cron job. El operador puede verificar con:
--   SELECT name FROM vault.decrypted_secrets WHERE name IN ('edge_function_url', 'service_role_key');
-- ============================================================================

CREATE OR REPLACE FUNCTION public.dispatch_scheduled_reports(p_schedule_kind text)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_count integer := 0;
  v_template record;
  v_function_url text;
  v_service_key  text;
BEGIN
  -- Lee secrets del vault. Si no existen, loguea y termina sin error.
  BEGIN
    SELECT decrypted_secret INTO v_function_url
      FROM vault.decrypted_secrets WHERE name = 'edge_function_url';
    SELECT decrypted_secret INTO v_service_key
      FROM vault.decrypted_secrets WHERE name = 'service_role_key';
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'F4.5.1c dispatch_scheduled_reports: vault no disponible (%). Salteado.', SQLERRM;
    RETURN 0;
  END;

  IF v_function_url IS NULL OR v_service_key IS NULL THEN
    RAISE NOTICE 'F4.5.1c dispatch_scheduled_reports: secrets edge_function_url/service_role_key faltantes. Salteado.';
    RETURN 0;
  END IF;

  FOR v_template IN
    SELECT * FROM public.claim_due_scheduled_reports(p_schedule_kind)
  LOOP
    v_count := v_count + 1;

    -- Async POST a la edge function. pg_net.http_post devuelve el request_id
    -- inmediatamente; el resultado del POST queda en net._http_response.
    PERFORM net.http_post(
      url     := v_function_url || '/process-scheduled-reports',
      headers := jsonb_build_object(
        'Content-Type',  'application/json',
        'Authorization', 'Bearer ' || v_service_key
      ),
      body    := jsonb_build_object('template_id', v_template.id)
    );
  END LOOP;

  RAISE NOTICE 'F4.5.1c dispatch_scheduled_reports(%): % templates dispatched', p_schedule_kind, v_count;
  RETURN v_count;
END;
$$;

COMMENT ON FUNCTION public.dispatch_scheduled_reports IS
  'F4.5.1c-real — invoca edge function process-scheduled-reports via pg_net.http_post para cada template due. Secrets vault: edge_function_url + service_role_key.';
