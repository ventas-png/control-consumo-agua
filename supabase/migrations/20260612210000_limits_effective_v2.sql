-- =====================================================================
-- Límites efectivos v2 — el límite por empresa vuelve a ser autoritativo
-- + ampliación self-service de límites (RPC) con auditoría.
--
-- PROBLEMA (reportado con capturas): el superadmin fijaba 5 proyectos /
-- 300 unidades y la empresa veía "6/50, 84/10000". get_company_effective_limits
-- (20260528000050) devolvía GREATEST(bp.max_X, c.max_X) para grandfathering,
-- pero al pasar al cobro por uso (20260528000060) los límites del plan se
-- volvieron safety caps enormes (50/10000) → GREATEST siempre ganaba el cap
-- y los límites por empresa quedaron decorativos (display Y enforcement,
-- porque los triggers usan la misma función).
--
-- SEMÁNTICA NUEVA:
--   · Límite efectivo = companies.max_projects / max_units (lo fija el
--     superadmin o lo amplía el dueño). Única fuente de verdad para la card
--     de la empresa, el drawer del superadmin y los triggers.
--   · billing_plans.max_X queda SOLO como techo absoluto del autoservicio.
--   · El cobro no cambia aquí: ya es por uso (calculate_monthly_total_cents
--     + sync diario a Stripe); ampliar límites permite crecer y el cobro se
--     ajusta cuando se crean los proyectos/unidades.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Normalización one-time: ninguna empresa queda sobre-límite al cambiar
--    la semántica (p.ej. la del reporte: 6 proyectos con límite 5 → 6).
--    Corre como rol de migración (auth.role() nulo) → el lock trigger no
--    congela las columnas.
-- ---------------------------------------------------------------------
UPDATE public.companies c
SET max_projects = GREATEST(c.max_projects, (SELECT count(*)::int FROM public.projects p WHERE p.company_id = c.id)),
    max_units    = GREATEST(c.max_units,    (SELECT count(*)::int FROM public.unidades u WHERE u.company_id = c.id));

-- ---------------------------------------------------------------------
-- 2. get_company_effective_limits v2 (misma firma → triggers de
--    enforcement y usePlanLimits del frontend siguen funcionando igual).
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_company_effective_limits(p_company_id uuid)
RETURNS TABLE(max_projects integer, max_units integer)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT c.max_projects, c.max_units
  FROM public.companies c
  WHERE c.id = p_company_id
  LIMIT 1
$$;

COMMENT ON FUNCTION public.get_company_effective_limits IS
  'Límites efectivos de una company = companies.max_projects/max_units (los fija el superadmin o los amplía el dueño vía solicitar_ampliacion_limites). billing_plans.max_X es solo el techo del autoservicio. v2: reemplaza el GREATEST(plan, empresa) que dejaba los límites por empresa decorativos.';

-- ---------------------------------------------------------------------
-- 3. lock_companies_billing_columns: escape hatch transaccional para que
--    la RPC de ampliación (definer, pero auth.role() sigue siendo
--    'authenticated') pueda tocar SOLO max_projects/max_units.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.lock_companies_billing_columns()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF (SELECT auth.role()) = 'authenticated' AND NOT public.is_super_admin() THEN
    -- GUC transaction-local seteado ÚNICAMENTE por solicitar_ampliacion_limites
    -- (que ya validó rol, suscripción y topes del plan).
    IF COALESCE(current_setting('app.allow_limits_update', true), '') <> '1' THEN
      NEW.max_projects := OLD.max_projects;
      NEW.max_units    := OLD.max_units;
    END IF;
    NEW.activa           := OLD.activa;
    NEW.signup_source    := OLD.signup_source;
    NEW.suspended_at     := OLD.suspended_at;
    NEW.suspended_reason := OLD.suspended_reason;
  END IF;
  RETURN NEW;
END;
$$;

-- ---------------------------------------------------------------------
-- 4. RPC solicitar_ampliacion_limites — ampliación self-service.
--    Solo company_owner/admin de SU empresa; solo AMPLIAR (reducir es del
--    superadmin); tope = límites del billing plan activo. Tras la
--    normalización (#1) y la regla "nuevo >= actual", el nuevo límite
--    siempre cubre el uso actual. Audita en audit_log (definer bypasea RLS;
--    la tabla no tiene policies de INSERT de cliente).
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.solicitar_ampliacion_limites(
  p_max_projects integer,
  p_max_units    integer
)
RETURNS TABLE(max_projects integer, max_units integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_uid     uuid := auth.uid();
  v_company uuid;
  v_role    text;
  v_cur     record;
  v_caps    record;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'no autenticado' USING ERRCODE = '42501';
  END IF;

  SELECT au.company_id, au.role INTO v_company, v_role
  FROM public.app_users au WHERE au.id = v_uid;

  IF v_company IS NULL OR v_role NOT IN ('company_owner', 'admin') THEN
    RAISE EXCEPTION 'Solo el dueño o un administrador de la empresa puede ampliar los límites'
      USING ERRCODE = '42501';
  END IF;

  SELECT c.max_projects, c.max_units INTO v_cur
  FROM public.companies c WHERE c.id = v_company FOR UPDATE;

  SELECT bp.max_projects, bp.max_units INTO v_caps
  FROM public.subscriptions s
  JOIN public.billing_plans bp ON bp.id = s.plan_id
  WHERE s.company_id = v_company
    AND s.status IN ('trialing', 'active', 'past_due', 'incomplete')
  LIMIT 1;

  IF v_caps IS NULL THEN
    RAISE EXCEPTION 'La empresa no tiene una suscripción activa — reactiva el plan para ampliar límites'
      USING ERRCODE = 'check_violation';
  END IF;

  IF p_max_projects IS NULL OR p_max_units IS NULL
     OR p_max_projects < v_cur.max_projects OR p_max_units < v_cur.max_units THEN
    RAISE EXCEPTION 'Los límites solo pueden ampliarse (para reducirlos contacta a soporte de AdministraTodo)'
      USING ERRCODE = 'check_violation';
  END IF;

  IF (v_caps.max_projects IS NOT NULL AND p_max_projects > v_caps.max_projects)
     OR (v_caps.max_units IS NOT NULL AND p_max_units > v_caps.max_units) THEN
    RAISE EXCEPTION 'El límite solicitado excede el tope del plan (% proyectos / % unidades) — contacta a soporte de AdministraTodo',
      v_caps.max_projects, v_caps.max_units
      USING ERRCODE = 'check_violation';
  END IF;

  PERFORM set_config('app.allow_limits_update', '1', true);

  UPDATE public.companies c
  SET max_projects = p_max_projects, max_units = p_max_units
  WHERE c.id = v_company;

  INSERT INTO public.audit_log (table_name, record_id, action, actor_id, company_id, before, after)
  VALUES (
    'companies', v_company, 'UPDATE', v_uid, v_company,
    jsonb_build_object('max_projects', v_cur.max_projects, 'max_units', v_cur.max_units,
                       'origen', 'ampliacion_self_service'),
    jsonb_build_object('max_projects', p_max_projects, 'max_units', p_max_units,
                       'origen', 'ampliacion_self_service')
  );

  RETURN QUERY SELECT p_max_projects, p_max_units;
END
$$;

COMMENT ON FUNCTION public.solicitar_ampliacion_limites(integer, integer) IS
  'Ampliación self-service de los límites del tenant (companies.max_projects/max_units) por el company_owner/admin, acotada por los topes del billing plan activo. Solo amplía; reducir es del superadmin. Audita en audit_log. El cobro se ajusta por uso (sync diario a Stripe).';

REVOKE EXECUTE ON FUNCTION public.solicitar_ampliacion_limites(integer, integer) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.solicitar_ampliacion_limites(integer, integer) FROM anon;
GRANT  EXECUTE ON FUNCTION public.solicitar_ampliacion_limites(integer, integer) TO authenticated;
