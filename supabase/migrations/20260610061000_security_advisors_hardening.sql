-- Security hardening — advisors 0028 (anon ejecuta SECURITY DEFINER) y 0014
-- (extension en public). Cierra los WARN que la Fase 4 (#19/#20) reabrió y el
-- follow-up de pg_net que 20260603120000/20260604200000 dejaron anotado.
--
-- POR QUÉ
-- `get_advisors(security)` reporta 3 hallazgos accionables:
--   1. public.create_trial_subscription()    → EXECUTE para PUBLIC/anon/authenticated
--   2. public.company_write_enabled(uuid)    → EXECUTE para PUBLIC/anon
--   3. pg_net instalado en `public` (0014)   → follow-up explícito de PRs anteriores
-- Las dos funciones nacieron en 20260610053543 (Fase 4) con el ACL por defecto:
-- en este proyecto toda función nueva de `public` queda ejecutable por
-- PUBLIC/anon/authenticated/service_role (lección de #378/#380 — default
-- privileges + grant implícito a PUBLIC). El guard de CI (security-guard.mjs,
-- nightly 07:00 UTC) falla con CUALQUIER SECURITY DEFINER anon-ejecutable fuera
-- del allowlist, así que sin esta migración la corrida nocturna queda en rojo.
--
-- QUÉ HACE (verificado contra el estado vivo de prod, no asumido)
--   a) create_trial_subscription: es función de TRIGGER (trg_create_trial_subscription
--      AFTER INSERT ON companies). El motor la dispara durante el DML y NO depende
--      del EXECUTE del rol de sesión (mismo razonamiento que la sección 2 de
--      20260603120000), así que se revoca a public/anon/authenticated por completo.
--   b) company_write_enabled: la llaman los triggers de enforcement
--      (enforce_company_write_active / enforce_registros_write_active), que NO son
--      SECURITY DEFINER → corren como el rol de sesión (`authenticated`). Se revoca
--      solo public/anon y se mantiene authenticated (+ service_role).
--   c) pg_net → schema `extensions` (advisor 0014). El audit que pedían los PRs
--      anteriores está hecho:
--        - La API de pg_net vive SIEMPRE en el schema `net` (verificado en prod:
--          extensión en public, funciones en net) — moverla de schema NO cambia
--          las referencias `net.http_post(...)` de los jobs.
--        - Los 10 jobs de cron.job corren como `postgres`, que pasa a ser owner
--          del schema `net` recreado → siguen funcionando.
--        - Cero triggers de Database Webhooks (supabase_functions) en prod.
--        - Requests async en vuelo (net._http_response) se pierden al recrear:
--          aceptable, los jobs reintentan en su siguiente corrida.
--      Bonus de hardening: el schema `net` recreado pierde el `USAGE` que PUBLIC/
--      anon/authenticated tenían antes; solo se re-otorga a supabase_functions_admin
--      (lo necesita el wrapper de Database Webhooks si algún día se usan).
--   d) Default privileges: se quita anon/PUBLIC del EXECUTE por defecto de las
--      funciones futuras de `public` creadas por `postgres` (rol de las
--      migraciones). Las funciones que de verdad necesiten anon (p. ej.
--      sso_lookup_domain) deberán llevar GRANT explícito — disciplina deliberada.
--      Nota honesta: hay rutas de creación que igual re-otorgan grants (event
--      triggers de la plataforma), por eso la defensa DURABLE es el guard nightly
--      + allowlist, no esta capa.
--
-- ALLOWLIST: scripts/security-guard.allowlist.json queda IGUAL (solo
-- sso_lookup_domain, anon-callable a propósito para descubrimiento SSO pre-login).
--
-- REVERSA
--   GRANT EXECUTE ON FUNCTION public.create_trial_subscription() TO authenticated;
--   GRANT EXECUTE ON FUNCTION public.company_write_enabled(uuid) TO anon;
--   DROP EXTENSION pg_net; CREATE EXTENSION pg_net;  -- (vuelve a public)
--   ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
--     GRANT EXECUTE ON FUNCTIONS TO anon;
--
-- IDEMPOTENTE: REVOKE/GRANT/ALTER DEFAULT PRIVILEGES son repetibles; el move de
-- pg_net va en un DO condicionado al schema actual (re-aplicar es no-op). Esto
-- importa porque apply-migrations-prod.yml re-aplica el archivo al mergear.

-- ─────────────────────────────────────────────────────────────────────────────
-- a) 0028 — create_trial_subscription: trigger function; nadie debe invocarla
--    como RPC (/rest/v1/rpc/create_trial_subscription). El trigger sigue
--    disparándose sin estos grants.
revoke execute on function public.create_trial_subscription() from public, anon, authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- b) 0028 — company_write_enabled: la evalúan triggers que corren como el rol de
--    sesión; authenticated debe conservar EXECUTE. anon no escribe en
--    cuotas_condominio/registros (cero policies de INSERT/UPDATE para anon), así
--    que recortarlo no afecta ninguna evaluación.
revoke execute on function public.company_write_enabled(uuid) from public, anon;
grant  execute on function public.company_write_enabled(uuid) to authenticated, service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- c) 0014 — pg_net fuera de `public`. Condicionado: solo si hoy está en public
--    (prod y previews que replayean las CREATE EXTENSION de migraciones viejas).
do $$
begin
  if exists (
    select 1 from pg_extension e
    join pg_namespace n on n.oid = e.extnamespace
    where e.extname = 'pg_net' and n.nspname = 'public'
  ) then
    drop extension pg_net;
    create extension pg_net with schema extensions;
    -- El wrapper de Database Webhooks (supabase_functions.http_request, SECURITY
    -- DEFINER de supabase_functions_admin) necesita acceso a net.* si llegara a
    -- usarse. PUBLIC/anon/authenticated NO se re-otorgan: tightening intencional.
    if exists (select 1 from pg_roles where rolname = 'supabase_functions_admin') then
      grant usage on schema net to supabase_functions_admin;
      grant execute on all functions in schema net to supabase_functions_admin;
    end if;
  end if;
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- d) Anti-recurrencia — las funciones futuras de `public` creadas por postgres
--    ya no nacen ejecutables por anon ni PUBLIC. authenticated/service_role se
--    mantienen en el default (el estilo de la casa igual hace GRANT explícito).
alter default privileges for role postgres in schema public revoke execute on functions from public;
alter default privileges for role postgres in schema public revoke execute on functions from anon;
