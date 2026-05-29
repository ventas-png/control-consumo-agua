-- ============================================================================
-- Usage-based pricing model (plat:P1 ajuste, F2.14)
-- ============================================================================
-- Cambia billing_plans del modelo flat ($10/$10/$15 mes fijo) al modelo real
-- usado en el landing /pricing (componentes por uso):
--
--   total_mensual = base_activation
--                 + (proyectos - 1) * extra_project
--                 + unidades_primary * unit_primary
--                 + unidades_extra * unit_extra
--
-- "primary project" = el proyecto mas antiguo de la company (cronologico).
-- "extra projects" = proyectos creados despues del primario.
--
-- Modelo confirmado por producto: A híbrido A
--   - A: Stripe Checkout con multi-line items (4 prices por plan)
--   - Híbrido: sliders del landing topean 20/500/1000 (UX) pero la DB solo
--     pone safety caps (50/10000) para evitar runaway
--   - A: primary cronologico (MIN created_at)
--
-- Idempotencia: ADD COLUMN IF NOT EXISTS + ON CONFLICT DO UPDATE en seed.
-- ============================================================================

-- ────────────────────────────────────────────────────────────────────────────
-- 1. Nuevas columnas de pricing por componente en billing_plans
-- ────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.billing_plans
  ADD COLUMN IF NOT EXISTS base_activation_cents integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS extra_project_cents   integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS unit_primary_cents    integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS unit_extra_cents      integer NOT NULL DEFAULT 0,
  -- Cada componente tiene su propio Stripe Price (4 totales por plan, 2 si
  -- el plan ofrece ambos ciclos monthly/yearly). El cycle se hereda del Price.
  ADD COLUMN IF NOT EXISTS stripe_price_id_activation     text,
  ADD COLUMN IF NOT EXISTS stripe_price_id_extra_project  text,
  ADD COLUMN IF NOT EXISTS stripe_price_id_unit_primary   text,
  ADD COLUMN IF NOT EXISTS stripe_price_id_unit_extra     text;

COMMENT ON COLUMN public.billing_plans.base_activation_cents IS
  'Costo base mensual del plan en cents. Cobrado como line item "Activacion" con quantity=1.';
COMMENT ON COLUMN public.billing_plans.extra_project_cents IS
  'Costo en cents por cada proyecto adicional (despues del primero). quantity = max(0, projects_count - 1).';
COMMENT ON COLUMN public.billing_plans.unit_primary_cents IS
  'Costo en cents por unidad en el proyecto principal (el mas antiguo cronologicamente).';
COMMENT ON COLUMN public.billing_plans.unit_extra_cents IS
  'Costo en cents por unidad en proyectos adicionales (no-primary).';

-- ────────────────────────────────────────────────────────────────────────────
-- 2. Actualizar seed con valores del landing
-- ────────────────────────────────────────────────────────────────────────────
-- Valores extraidos de src/components/landing/Pricing.tsx (comentario lines 5-9):
--   single module → $10 activation
--   bundle → $15 activation
--   $10 por proyecto extra, $1 por unit primary, $0.80 por unit extra
--
-- Aplica a todos los planes igual (los componentes per-unit no varian entre
-- agua/condominios/bundle — el bundle solo varia en base_activation).
UPDATE public.billing_plans SET
  base_activation_cents = 1000,
  extra_project_cents   = 1000,
  unit_primary_cents    = 100,
  unit_extra_cents      = 80,
  -- max_projects/units pasan a safety caps (hibrido)
  max_projects          = 50,
  max_units             = 10000,
  -- price_monthly_cents legacy ya no se usa para cobro pero lo dejamos
  -- como "base reference" del landing card
  price_monthly_cents   = 1000
WHERE code IN ('agua_only', 'condominios_only');

UPDATE public.billing_plans SET
  base_activation_cents = 1500,
  extra_project_cents   = 1000,
  unit_primary_cents    = 100,
  unit_extra_cents      = 80,
  max_projects          = 50,
  max_units             = 10000,
  price_monthly_cents   = 1500
WHERE code = 'bundle';

-- ────────────────────────────────────────────────────────────────────────────
-- 3. RPC calculate_monthly_total_cents
--    Calcula el monto que Stripe deberia cobrar este mes en funcion del uso.
--    Devuelve desglose para que la UI muestre breakdown (como el landing).
-- ────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.calculate_monthly_total_cents(p_company_id uuid)
RETURNS TABLE(
  total_cents             integer,
  base_activation_cents   integer,
  extra_projects_subtotal integer,
  primary_units_subtotal  integer,
  extra_units_subtotal    integer,
  extra_projects_count    integer,
  primary_units_count     integer,
  extra_units_count       integer,
  primary_project_id      uuid
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_plan record;
  v_primary_id uuid;
  v_projects_total integer;
  v_primary_units integer;
  v_extra_units integer;
  v_extra_projects integer;
BEGIN
  -- Activo plan de la company
  SELECT bp.base_activation_cents, bp.extra_project_cents, bp.unit_primary_cents, bp.unit_extra_cents
    INTO v_plan
  FROM public.companies c
  LEFT JOIN public.subscriptions s ON s.company_id = c.id
    AND s.status IN ('trialing', 'active', 'past_due', 'incomplete')
  LEFT JOIN public.billing_plans bp ON bp.id = s.plan_id
  WHERE c.id = p_company_id
  LIMIT 1;

  IF v_plan IS NULL OR v_plan.base_activation_cents IS NULL THEN
    total_cents := 0;
    base_activation_cents := 0;
    extra_projects_subtotal := 0;
    primary_units_subtotal := 0;
    extra_units_subtotal := 0;
    extra_projects_count := 0;
    primary_units_count := 0;
    extra_units_count := 0;
    primary_project_id := NULL;
    RETURN NEXT;
    RETURN;
  END IF;

  -- Primary = proyecto mas antiguo
  SELECT id INTO v_primary_id
  FROM public.projects
  WHERE company_id = p_company_id
  ORDER BY created_at ASC NULLS LAST, id ASC
  LIMIT 1;

  SELECT COUNT(*) INTO v_projects_total
  FROM public.projects
  WHERE company_id = p_company_id;

  v_extra_projects := GREATEST(0, v_projects_total - 1);

  IF v_primary_id IS NOT NULL THEN
    SELECT COUNT(*) INTO v_primary_units
    FROM public.unidades
    WHERE company_id = p_company_id AND project_id = v_primary_id;
  ELSE
    v_primary_units := 0;
  END IF;

  IF v_primary_id IS NOT NULL THEN
    SELECT COUNT(*) INTO v_extra_units
    FROM public.unidades
    WHERE company_id = p_company_id AND (project_id IS NULL OR project_id <> v_primary_id);
  ELSE
    SELECT COUNT(*) INTO v_extra_units
    FROM public.unidades
    WHERE company_id = p_company_id;
  END IF;

  base_activation_cents   := v_plan.base_activation_cents;
  extra_projects_subtotal := v_extra_projects * v_plan.extra_project_cents;
  primary_units_subtotal  := v_primary_units  * v_plan.unit_primary_cents;
  extra_units_subtotal    := v_extra_units    * v_plan.unit_extra_cents;
  total_cents := base_activation_cents + extra_projects_subtotal
               + primary_units_subtotal + extra_units_subtotal;
  extra_projects_count    := v_extra_projects;
  primary_units_count     := v_primary_units;
  extra_units_count       := v_extra_units;
  primary_project_id      := v_primary_id;

  RETURN NEXT;
END;
$$;

COMMENT ON FUNCTION public.calculate_monthly_total_cents IS
  'Cobro esperado del mes para la company segun el modelo del landing. Devuelve desglose para UI. Primary project = MIN(created_at).';
