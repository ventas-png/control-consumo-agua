-- Security hardening — advisor 0028 (anon puede ejecutar SECURITY DEFINER). Track T5 · infra:I2.
--
-- POR QUÉ
-- `get_advisors(security)` deja 0 ERROR y solo WARN. Los dos ÚNICOS WARN de la clase de
-- mayor severidad de cara al exterior — 0028 "anon_security_definer_function_executable",
-- funciones SECURITY DEFINER invocables SIN autenticar vía /rest/v1/rpc/<fn> — son:
--     public.company_has_feature(uuid, text)   → EXECUTE concedido a `anon`
--     public.user_has_permission(text)         → EXECUTE concedido a `PUBLIC`
-- Una función SECURITY DEFINER corre con los privilegios de su owner (`postgres`); dejarla
-- accesible a `anon`/`PUBLIC` es superficie de escalada (gating de features / permisos RBAC
-- consultables sin sesión, y posible enumeración).
--
-- POR QUÉ ES SEGURO (verificado contra el estado vivo de la DB, no asumido)
-- La migración previa 20260603120000 dejó estas dos funciones INTACTAS por cautela: se usan
-- DENTRO de policies RLS de ~150 tablas y revocar `authenticated` rompería su evaluación.
-- Aquí NO tocamos `authenticated`: solo recortamos `anon`/`PUBLIC`. Se confirmó vía pg_policies
-- que de las 463 policies que usan `user_has_permission` y las 5 que usan `company_has_feature`,
-- CERO aplican al rol `anon` (todas son `{authenticated}`). Las únicas 2 policies que nombran
-- `anon` (security_logs_insert_anon, user_sessions "No direct access") no referencian estas
-- funciones. Por tanto recortar `anon`/`PUBLIC` no afecta ninguna evaluación de RLS anónima.
--
-- Ambas funciones YA tienen `search_path = public` fijado (verificado en pg_proc.proconfig),
-- así que NO hay nada que endurecer en advisor 0011 (search_path mutable) — esta migración es
-- exclusivamente de grants.
--
-- DOCUMENTADO COMO FOLLOW-UP (fuera de este PR, a propósito):
--   - advisor 0014 (extension_in_public): `pg_net` vive en `public`. Moverlo requiere auditar
--     todas las referencias `net.http_post` en dispatch_scheduled_reports / jobs de pg_cron; es
--     riesgoso y va en PR aparte (igual que ya anotaba 20260603120000).
--   - advisor 0029 (authenticated_security_definer_function_executable, ~30 funciones): son
--     helpers de RLS (is_super_admin, has_*_access, get_my_*, current_user_role…) y RPCs que el
--     frontend invoca legítimamente como `authenticated` (paquete_*, buscar_cliente_para_onboarding).
--     `authenticated` es un grant intencional; revocarlo rompería policies/feature. Se deja
--     documentado como esperado.
--
-- REVERSA
--   GRANT EXECUTE ON FUNCTION public.company_has_feature(uuid, text) TO anon;
--   GRANT EXECUTE ON FUNCTION public.user_has_permission(text)       TO PUBLIC;
--
-- IDEMPOTENTE: REVOKE/GRANT son repetibles sin error aunque ya estén en el estado objetivo.

-- ─────────────────────────────────────────────────────────────────────────────
-- 0028 — company_has_feature: quitar SOLO anon; mantener authenticated (+ service_role).
revoke execute on function public.company_has_feature(uuid, text) from anon;
grant  execute on function public.company_has_feature(uuid, text) to authenticated, service_role;

-- 0028 — user_has_permission: quitar PUBLIC (que arrastra anon); mantener authenticated
--        (+ service_role). Revocar a PUBLIC no quita los grants explícitos a authenticated.
revoke execute on function public.user_has_permission(text) from public;
grant  execute on function public.user_has_permission(text) to authenticated, service_role;
