-- ============================================================================
-- Baseline legacy RLS helpers (infra:I39 cont.)
-- ============================================================================
-- Tercera capa de la "cebolla" infra:I39: funciones helper de RLS que existen
-- en producción desde fase 1 (auditado vía MCP el 2026-05-27) pero que
-- ninguna migración del repo crea. Son usadas en USING/CHECK clauses de
-- policies definidas en migraciones MUY posteriores (conversation_messages,
-- portal residente, etc), por lo que aplicar las migraciones desde cero en
-- Supabase Branching falla en cuanto el motor llega a la primera CREATE
-- POLICY que las referencia.
--
-- Por qué viven aquí y no en 20260317000001_baseline_legacy_tables_phase2.sql:
-- los cuerpos `LANGUAGE sql` parsean y resuelven sus referencias en tiempo de
-- CREATE FUNCTION. Estas dos funciones llaman a:
--   - current_user_role()        ← creada en baseline phase 2
--   - get_my_company_id()        ← creada en 20260320000003
--   - get_my_cliente_id()        ← creada en 20260330000001
-- por lo que su CREATE necesita correr DESPUÉS de esas tres. El timestamp
-- 20260330000002 las coloca inmediatamente después de get_my_cliente_id y
-- antes de las primeras policies que las usan (conversation_messages,
-- consolidate_rls_policies_part2, portal residente).
--
-- Idempotencia: CREATE OR REPLACE FUNCTION → no-op en producción (las
-- funciones ya existen con cuerpo idéntico, replicado tal cual desde prod).
-- ============================================================================

-- has_admin_or_owner_access_in_company — helper RLS usado por policies de
-- conversation_messages y otras tablas con scope multi-rol por compañía.
CREATE OR REPLACE FUNCTION public.has_admin_or_owner_access_in_company(p_company_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT
    (current_user_role() = 'admin' AND get_my_company_id() = p_company_id)
    OR (current_user_role() = 'company_owner' AND get_my_company_id() = p_company_id)
$function$;

-- is_user_cliente_with_id — helper RLS para residente/cliente que solo accede
-- a sus propias filas vía cliente_id. Usado en policies de portal residente.
CREATE OR REPLACE FUNCTION public.is_user_cliente_with_id(p_cliente_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT
    current_user_role() = 'cliente'
    AND get_my_cliente_id() = p_cliente_id
$function$;
