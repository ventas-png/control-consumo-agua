-- ============================================================================
-- Plan limits enforcement: max_projects + max_units (plat:P1 part 3, F2.13)
-- ============================================================================
-- Cierra plat:P1 conectando billing_plans con la realidad operativa: cuando
-- un usuario intenta crear un projeto o unidad que excede el limite de su
-- subscription's plan, la DB bloquea la operacion. Defense in depth: ningun
-- bug del front, llamada via SQL Editor o import malformado puede saltarse.
--
-- Limite efectivo por company:
--   - Si el plan tiene NULL → unlimited (ninguna verificacion)
--   - Si no, GREATEST(plan.max_X, COALESCE(companies.max_X, 0))
--     → grandfather legacy: tenants que en companies.max_units = 300 mantienen
--       ese override aunque el plan defaulta a 50. Self-service signups
--       siguen el plan strict.
--
-- Super admin BYPASS:
--   - is_super_admin() = true → trigger devuelve NEW sin chequear. Soporte,
--     migraciones masivas, edits de emergencia siguen funcionando.
--
-- Tablas afectadas:
--   - public.projects (max_projects por company)
--   - public.unidades (max_units por company, total cross-projects)
-- ============================================================================

-- ────────────────────────────────────────────────────────────────────────────
-- get_company_effective_limits: helper que centraliza la logica de limite.
-- Reusada por triggers y por el frontend (via RPC).
-- ────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_company_effective_limits(p_company_id uuid)
RETURNS TABLE(max_projects integer, max_units integer)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT
    CASE
      WHEN bp.max_projects IS NULL THEN NULL
      ELSE GREATEST(bp.max_projects, COALESCE(c.max_projects, 0))
    END AS max_projects,
    CASE
      WHEN bp.max_units IS NULL THEN NULL
      ELSE GREATEST(bp.max_units, COALESCE(c.max_units, 0))
    END AS max_units
  FROM public.companies c
  LEFT JOIN public.subscriptions s ON s.company_id = c.id
    AND s.status IN ('trialing', 'active', 'past_due', 'incomplete')
  LEFT JOIN public.billing_plans bp ON bp.id = s.plan_id
  WHERE c.id = p_company_id
  LIMIT 1
$$;

COMMENT ON FUNCTION public.get_company_effective_limits IS
  'Limites efectivos de una company. NULL en cada campo significa unlimited (el plan no define limit). GREATEST entre plan y legacy override grandfather tenants con limites altos.';

-- ────────────────────────────────────────────────────────────────────────────
-- get_company_usage: actual usage counts. Permite al frontend mostrar
-- "3 de 5 proyectos" sin queries adicionales.
-- ────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_company_usage(p_company_id uuid)
RETURNS TABLE(projects_count bigint, units_count bigint)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT
    (SELECT COUNT(*) FROM public.projects WHERE company_id = p_company_id),
    (SELECT COUNT(*) FROM public.unidades WHERE company_id = p_company_id)
$$;

-- ────────────────────────────────────────────────────────────────────────────
-- enforce_max_projects trigger
-- ────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.enforce_max_projects()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_limit integer;
  v_count integer;
BEGIN
  -- Super admin bypass: necesario para migraciones, soporte, dev.
  IF is_super_admin() THEN
    RETURN NEW;
  END IF;

  -- Sin company_id no hay limite aplicable (caso patologico — la columna
  -- es NOT NULL en projects pero defensivamente).
  IF NEW.company_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT max_projects INTO v_limit
  FROM public.get_company_effective_limits(NEW.company_id);

  -- NULL = unlimited
  IF v_limit IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT COUNT(*) INTO v_count
  FROM public.projects
  WHERE company_id = NEW.company_id;

  IF v_count >= v_limit THEN
    RAISE EXCEPTION 'plan_limit_reached: max_projects = % (actual: %). Actualiza tu plan para agregar mas proyectos.', v_limit, v_count
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS enforce_max_projects_before_insert ON public.projects;
CREATE TRIGGER enforce_max_projects_before_insert
  BEFORE INSERT ON public.projects
  FOR EACH ROW EXECUTE FUNCTION public.enforce_max_projects();

-- ────────────────────────────────────────────────────────────────────────────
-- enforce_max_units trigger
-- ────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.enforce_max_units()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_limit integer;
  v_count integer;
BEGIN
  IF is_super_admin() THEN
    RETURN NEW;
  END IF;

  IF NEW.company_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT max_units INTO v_limit
  FROM public.get_company_effective_limits(NEW.company_id);

  IF v_limit IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT COUNT(*) INTO v_count
  FROM public.unidades
  WHERE company_id = NEW.company_id;

  IF v_count >= v_limit THEN
    RAISE EXCEPTION 'plan_limit_reached: max_units = % (actual: %). Actualiza tu plan para agregar mas unidades.', v_limit, v_count
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS enforce_max_units_before_insert ON public.unidades;
CREATE TRIGGER enforce_max_units_before_insert
  BEFORE INSERT ON public.unidades
  FOR EACH ROW EXECUTE FUNCTION public.enforce_max_units();

COMMENT ON FUNCTION public.enforce_max_projects IS
  'Trigger BEFORE INSERT en projects. Bloquea con check_violation si la company excede max_projects efectivo. Super admin bypassea.';

COMMENT ON FUNCTION public.enforce_max_units IS
  'Trigger BEFORE INSERT en unidades. Bloquea con check_violation si la company excede max_units efectivo. Super admin bypassea.';
