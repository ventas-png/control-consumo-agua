-- ════════════════════════════════════════════════════════════════════════════
-- Restaurar el guard de `get_company_effective_limits` y hacerlo no-borrable
-- (auditoría 2026-07-28, Bloque A · PR-4).
--
-- POR QUÉ
-- `20260606150000_secure_company_scoped_rpcs.sql` existe para cerrar lecturas
-- cross-tenant en tres RPCs que reciben `p_company_id` del cliente, y documenta
-- el hallazgo textualmente: "un usuario autenticado podía pasar el UUID de OTRA
-- empresa y leer sus conteos, límites de plan y total de facturación mensual".
-- Para poder llevar el guard, convirtió dos funciones de `sql` a `plpgsql`.
--
-- SEIS DÍAS DESPUÉS, `20260612210000_limits_effective_v2.sql:37` recreó
-- `get_company_effective_limits` con LA MISMA FIRMA para cambiar la semántica
-- del límite (quitar el GREATEST(plan, empresa)) — y la envió como `LANGUAGE sql`
-- SIN el guard:
--
--   CREATE OR REPLACE FUNCTION public.get_company_effective_limits(p_company_id uuid)
--   RETURNS TABLE(max_projects integer, max_units integer)
--   LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
--   AS $$ SELECT c.max_projects, c.max_units FROM public.companies c
--         WHERE c.id = p_company_id LIMIT 1 $$;
--
-- `CREATE OR REPLACE` con firma idéntica CONSERVA los GRANTs, así que el
-- `grant execute ... to authenticated` de 20260603120000:71 sigue vivo y la RPC
-- siguió siendo invocable — solo que ya sin control de scope. `get_company_usage`
-- y `calculate_monthly_total_cents` conservaron el suyo: regresó solo ésta.
--
-- EL ARREGLO, EN DOS PARTES
--   1. Restaurar el guard, preservando la semántica v2 (límite = columnas de
--      `companies`, sin GREATEST). Vuelve a `plpgsql` porque un cuerpo `sql` no
--      puede llevar el RAISE.
--   2. Lo que de verdad importa: extraer el guard a `assert_company_scope()`.
--      Mientras el guard viva COPIADO dentro de cada cuerpo, una reescritura
--      futura puede perderlo por omisión — que es exactamente lo que pasó aquí.
--      Como llamada única y nombrada, su ausencia se ve en el diff.
--
-- El guard replica EXACTAMENTE la forma de 20260606150000 (super_admin ∨ propia
-- empresa ∨ service_role), que ya se validó contra prod en transacción con
-- ROLLBACK. Los triggers de enforcement de 20260528000050:97,144 siguen
-- funcionando: salen antes por `is_super_admin()`, o llegan con
-- `NEW.company_id` = la empresa del caller, o corren bajo service_role.
-- ════════════════════════════════════════════════════════════════════════════

-- ---------------------------------------------------------------------
-- 1. assert_company_scope — el guard, una sola vez y con nombre.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.assert_company_scope(p_company_id uuid)
RETURNS void
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NOT (
    public.is_super_admin()
    OR p_company_id = public.get_my_company_id()
    OR COALESCE(current_setting('request.jwt.claims', true)::jsonb ->> 'role', '') = 'service_role'
  ) THEN
    RAISE EXCEPTION 'no autorizado' USING ERRCODE = '42501';
  END IF;
END;
$$;

COMMENT ON FUNCTION public.assert_company_scope(uuid) IS
  'Guard de scope para RPCs SECURITY DEFINER que reciben p_company_id del cliente: permite super_admin, la propia empresa del caller, o service_role; si no, lanza 42501. Extraído en la auditoría 2026-07-28 (Bloque A · PR-4) porque el guard copiado dentro de get_company_effective_limits se perdió en un CREATE OR REPLACE (20260612210000). Toda RPC nueva con p_company_id/p_project_id debe llamarlo en su primera línea.';

REVOKE EXECUTE ON FUNCTION public.assert_company_scope(uuid) FROM public, anon;
GRANT  EXECUTE ON FUNCTION public.assert_company_scope(uuid) TO authenticated, service_role;

-- ---------------------------------------------------------------------
-- 2. get_company_effective_limits v3 = semántica v2 + guard restaurado.
--    Misma firma → los triggers de enforcement y usePlanLimits siguen igual.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_company_effective_limits(p_company_id uuid)
RETURNS TABLE(max_projects integer, max_units integer)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  PERFORM public.assert_company_scope(p_company_id);

  RETURN QUERY
    SELECT c.max_projects, c.max_units
    FROM public.companies c
    WHERE c.id = p_company_id
    LIMIT 1;
END;
$$;

COMMENT ON FUNCTION public.get_company_effective_limits(uuid) IS
  'Límites efectivos de una company = companies.max_projects/max_units (los fija el superadmin o los amplía el dueño vía solicitar_ampliacion_limites). billing_plans.max_X es solo el techo del autoservicio. v3: mantiene la semántica v2 (sin GREATEST) y restaura el guard de scope perdido en 20260612210000, ahora vía assert_company_scope().';

-- Los GRANTs sobrevivieron al CREATE OR REPLACE, pero se re-declaran para que
-- la migración sea autocontenida y aplicable desde cero.
REVOKE EXECUTE ON FUNCTION public.get_company_effective_limits(uuid) FROM public, anon;
GRANT  EXECUTE ON FUNCTION public.get_company_effective_limits(uuid) TO authenticated;
