-- Security hardening — Supabase advisors 0011 / 0028 / 0029
--
-- Contexto: las 5 funciones afectadas son TRIGGERS (RETURNS trigger). Un trigger
-- lo ejecuta el motor de Postgres durante el DML de su tabla y NO depende del
-- privilegio EXECUTE del rol de la sesión. Por eso revocar EXECUTE NO afecta el
-- funcionamiento del trigger: solo elimina la posibilidad de invocarlo
-- directamente como RPC vía PostgREST (/rest/v1/rpc/...).

-- 1) Fijar search_path en el trigger de updated_at (advisor 0011).
--    Su cuerpo solo usa now() (de pg_catalog, siempre disponible), por lo que
--    search_path = '' es seguro y elimina el vector de "search_path mutable".
alter function public.update_email_config_updated_at() set search_path = '';

-- 2) Quitar el acceso RPC directo (PUBLIC/anon/authenticated) a funciones de
--    trigger que quedaron expuestas innecesariamente (advisors 0028 / 0029).
--    Los triggers se siguen disparando con normalidad en el DML de sus tablas.
revoke execute on function public.update_email_config_updated_at() from public, anon, authenticated;
revoke execute on function public.audit_role_permissions_changes() from public, anon, authenticated;
revoke execute on function public.audit_roles_changes()            from public, anon, authenticated;
revoke execute on function public.audit_user_roles_changes()       from public, anon, authenticated;
revoke execute on function public.set_rutas_company_id()           from public, anon, authenticated;
