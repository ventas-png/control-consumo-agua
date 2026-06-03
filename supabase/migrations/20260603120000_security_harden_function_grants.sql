-- Security hardening — Supabase advisors 0028/0029 (anon puede ejecutar SECURITY DEFINER)
--                       + 0011 (search_path mutable). Track T5 · infra:I-hardening.
--
-- POR QUÉ
-- El advisor de seguridad marca funciones `SECURITY DEFINER` en `public` que el rol
-- `anon` puede invocar como RPC vía `/rest/v1/rpc/<fn>`. Una función SECURITY DEFINER
-- corre con los privilegios de su owner (`postgres`), así que dejarla expuesta a `anon`
-- es superficie de escalada: cualquiera SIN autenticar podría disparar lógica
-- privilegiada (cálculos de billing, workers de email, dispatch de reportes, etc.).
--
-- Esta migración revoca el EXECUTE de `public`/`anon` sobre el subconjunto de funciones
-- cuyo caller real NO es anónimo. Los callers se verificaron en el código:
--   - frontend (src/)            → rol `authenticated`
--   - edge functions             → rol `service_role`
--   - workers de pg_cron         → corren bajo `postgres` (superuser, ignora estos grants)
-- Para las funciones privilegiadas de infraestructura (workers/cron) además se revoca
-- `authenticated`: ningún usuario logueado debe poder dispararlas; solo `service_role`
-- (edge) y `postgres` (cron).
--
-- NO se tocan `user_has_permission(text)` ni `company_has_feature(uuid,text)`: son helpers
-- usados DENTRO de policies RLS de ~150 tablas y se evalúan como parte del query del propio
-- rol, así que revocar su EXECUTE rompería la evaluación de las policies. Su WARN de advisor
-- queda pendiente de un análisis de accesibilidad-anon por tabla (PR aparte).
-- Tampoco se mueve `pg_net` fuera de `public` (advisor 0014): va en PR aparte por el audit
-- de referencias a `net.http_post` en dispatch_scheduled_reports/cron.
--
-- CALLER MAP (verificado en src/ y supabase/functions/):
--   calculate_monthly_total_cents → frontend (PerfilSection) + edge (stripe) → authenticated, service_role
--   get_company_effective_limits  → frontend (usePlanLimits)                 → authenticated
--   get_company_usage             → frontend (usePlanLimits)                 → authenticated
--   get_user_permissions          → frontend (useAuth)                       → authenticated
--   claim_due_scheduled_reports   → interno (dispatch_scheduled_reports)     → service_role
--   dispatch_scheduled_reports    → pg_cron (postgres)                       → service_role
--   enqueue_email                 → edge (send-email)                        → service_role
--   pop_email_batch               → edge (process-email-queue)               → service_role
--   rate_limit_check              → edge (checkout / billing-portal)         → service_role
--   run_billing_sync              → pg_cron (postgres)                       → service_role
--   run_email_queue_worker        → pg_cron (postgres)                       → service_role
--   update_email_attempt          → edge (process-email-queue)               → service_role
--
-- REVERSA
-- El estado original otorgaba EXECUTE a PUBLIC/anon/authenticated/service_role. Para revertir:
--   GRANT EXECUTE ON FUNCTION public.<fn>(<args>) TO anon, authenticated;
-- y, en touch_updated_at: `ALTER FUNCTION public.touch_updated_at() RESET search_path;`
--
-- IDEMPOTENTE: REVOKE/GRANT y ALTER FUNCTION ... SET son repetibles sin error.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1) advisor 0011 — fijar search_path en la única función que aún lo tiene mutable.
--    Cuerpo: `NEW.updated_at := now()`; `now()` vive en pg_catalog (siempre presente
--    en el search_path implícito), por lo que `''` es seguro.
alter function public.touch_updated_at() set search_path = '';

-- ─────────────────────────────────────────────────────────────────────────────
-- 2) advisor 0028/0029 — funciones TRIGGER (RETURNS trigger). El trigger lo dispara el
--    motor durante el DML de su tabla y NO depende del EXECUTE del rol de sesión, así que
--    revocar EXECUTE no afecta su funcionamiento; solo cierra el RPC directo. (Mismo
--    razonamiento que 20260521000001_security_harden_trigger_functions.sql.)
revoke execute on function public.audit_trigger_func()   from public, anon, authenticated;
revoke execute on function public.enforce_max_projects() from public, anon, authenticated;
revoke execute on function public.enforce_max_units()    from public, anon, authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3) advisor 0028/0029 — funciones de uso del frontend (rol `authenticated`).
--    Quitamos solo public/anon; mantenemos authenticated (+ service_role donde el edge
--    también la usa).
revoke execute on function public.calculate_monthly_total_cents(uuid) from public, anon;
grant  execute on function public.calculate_monthly_total_cents(uuid) to authenticated, service_role;

revoke execute on function public.get_company_effective_limits(uuid) from public, anon;
grant  execute on function public.get_company_effective_limits(uuid) to authenticated;

revoke execute on function public.get_company_usage(uuid) from public, anon;
grant  execute on function public.get_company_usage(uuid) to authenticated;

revoke execute on function public.get_user_permissions(uuid) from public, anon;
grant  execute on function public.get_user_permissions(uuid) to authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4) advisor 0028/0029 — funciones privilegiadas de infraestructura (workers/cron).
--    Ningún usuario logueado debe invocarlas: revocamos public/anon/authenticated y
--    dejamos solo service_role (edge). pg_cron corre bajo `postgres` (superuser), que
--    ignora estos grants, así que los jobs siguen funcionando.
revoke execute on function public.claim_due_scheduled_reports(text) from public, anon, authenticated;
grant  execute on function public.claim_due_scheduled_reports(text) to service_role;

revoke execute on function public.dispatch_scheduled_reports(text) from public, anon, authenticated;
grant  execute on function public.dispatch_scheduled_reports(text) to service_role;

revoke execute on function public.enqueue_email(jsonb, uuid, boolean, uuid, text) from public, anon, authenticated;
grant  execute on function public.enqueue_email(jsonb, uuid, boolean, uuid, text) to service_role;

revoke execute on function public.pop_email_batch(integer) from public, anon, authenticated;
grant  execute on function public.pop_email_batch(integer) to service_role;

revoke execute on function public.rate_limit_check(uuid, text, integer, interval) from public, anon, authenticated;
grant  execute on function public.rate_limit_check(uuid, text, integer, interval) to service_role;

revoke execute on function public.run_billing_sync() from public, anon, authenticated;
grant  execute on function public.run_billing_sync() to service_role;

revoke execute on function public.run_email_queue_worker() from public, anon, authenticated;
grant  execute on function public.run_email_queue_worker() to service_role;

revoke execute on function public.update_email_attempt(bigint, boolean, text) from public, anon, authenticated;
grant  execute on function public.update_email_attempt(bigint, boolean, text) to service_role;
