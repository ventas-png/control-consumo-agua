-- Hotfix de seguridad — endurece los grants de los RPC del orquestador de notificaciones (T2, #378).
--
-- Causa raíz: en Supabase los roles `anon` y `authenticated` reciben EXECUTE sobre las funciones
-- nuevas de `public` mediante DEFAULT PRIVILEGES (grant EXPLÍCITO), no solo a través de PUBLIC.
-- Por eso el `REVOKE EXECUTE ... FROM PUBLIC` de la migración 20260604100000_notifications_outbox
-- NO fue suficiente: estas 4 funciones SECURITY DEFINER siguieron siendo invocables por `anon`
-- (advisor 0028 anon_security_definer_function_executable) y por `authenticated` (advisor 0029)
-- vía /rest/v1/rpc/*, permitiendo a un atacante NO autenticado:
--   - enqueue_notification:      encolar notificaciones suplantando cualquier tenant/destinatario
--                                (spam/phishing desde el Gmail del tenant cuando el dispatcher se active)
--   - claim_notifications_batch: drenar/bloquear la cola y leer destinatarios/payloads (exposición de datos)
--   - mark_notification_result:  falsear el estado de entrega
--   - run_notifications_dispatcher: disparar el despacho a voluntad (abuso/DoS)
--
-- Estas funciones solo deben invocarlas el edge `notifications-dispatcher` y el cron pg_net,
-- ambos como `service_role` (o `postgres`, dueño de la función SECURITY DEFINER). Restringimos
-- EXECUTE a `service_role` y revocamos por nombre de `anon`/`authenticated`/`PUBLIC`.
--
-- Idempotente y resiliente. Reversa (si alguna vez se necesita encolar desde el cliente):
--   GRANT EXECUTE ON FUNCTION ... TO authenticated;
-- pero hágase con derivación/validación de `company_id` desde la sesión, NO reabriendo estos RPC
-- (hoy aceptan company_id arbitrario → reabrir a `authenticated` sería un hueco cross-tenant).
-- NO se restablece `anon`/`PUBLIC` a propósito.

DO $$
DECLARE
  fn text;
  fns text[] := ARRAY[
    'public.enqueue_notification(text, text, jsonb, uuid, text, timestamptz)',
    'public.claim_notifications_batch(integer)',
    'public.mark_notification_result(uuid, boolean, text, boolean)',
    'public.run_notifications_dispatcher()'
  ];
BEGIN
  FOREACH fn IN ARRAY fns LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC, anon, authenticated', fn);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', fn);
  END LOOP;
END $$;
