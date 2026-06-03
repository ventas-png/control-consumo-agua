-- I2 (Track T5) — rate-limit server-side generalizado por "subject" (IP o user id).
--
-- POR QUÉ
-- El rate-limiting existía solo client-side + inline en 2 edge functions de billing, vía
-- `rate_limit_check(p_user_id uuid, ...)`. Ese helper solo puede limitar por `user_id`,
-- así que NO cubre los endpoints anónimos (signup / login / oauth), que son el principal
-- vector de abuso (spam de altas self-service). Esta migración agrega un contador genérico
-- keyed por un `subject text` (p. ej. `ip:1.2.3.4` para anónimos, o el user id para
-- autenticados), reutilizable desde `supabase/functions/_shared/rateLimit.ts`.
--
-- Aditivo y backward-compatible: `rate_limit_check(uuid,...)` y sus 2 callers de billing
-- quedan intactos. No se backfillea `subject` en filas viejas: el contador es por ventana
-- móvil (las filas viejas caen fuera de la ventana enseguida), así que no hace falta.
--
-- REVERSA:
--   drop function if exists public.rate_limit_hit(text, text, integer, interval);
--   drop index  if exists public.idx_rate_limit_log_subject_action_at;
--   alter table public.rate_limit_log drop column if exists subject;
-- IDEMPOTENTE: ADD COLUMN/INDEX IF NOT EXISTS, CREATE OR REPLACE FUNCTION, REVOKE/GRANT.

alter table public.rate_limit_log add column if not exists subject text;

-- Índice para el COUNT por ventana — evita seq scan a medida que el log crece.
create index if not exists idx_rate_limit_log_subject_action_at
  on public.rate_limit_log (subject, action, at desc);

-- Contador genérico: devuelve false si ya se alcanzó el máximo dentro de la ventana; si no,
-- registra el hit y devuelve true. Misma semántica que rate_limit_check, pero por `subject`.
create or replace function public.rate_limit_hit(
  p_subject text,
  p_action text,
  p_max_count integer,
  p_window interval default '01:00:00'::interval
) returns boolean
language plpgsql
security definer
set search_path to 'public'
as $function$
declare v_count integer;
begin
  select count(*) into v_count
  from public.rate_limit_log
  where subject = p_subject and action = p_action and at > (now() - p_window);
  if v_count >= p_max_count then return false; end if;
  insert into public.rate_limit_log (subject, action) values (p_subject, p_action);
  return true;
end;
$function$;

-- Solo edge functions (service_role) deben invocarla; nunca anon/authenticated por RPC.
-- (Consistente con el hardening de 20260603120000_security_harden_function_grants.sql.)
revoke execute on function public.rate_limit_hit(text, text, integer, interval) from public, anon, authenticated;
grant  execute on function public.rate_limit_hit(text, text, integer, interval) to service_role;
