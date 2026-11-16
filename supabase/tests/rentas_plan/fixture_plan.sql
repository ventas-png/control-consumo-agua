-- Fixture de rentas_plan: lo que 20261126000000 necesita y los fixtures compartidos no traen.
-- Se aplica DESPUÉS del padrón y de 20261125000000 (rentas_propiedades ya existe).
--
-- · Columnas de `companies` que usa el cobro (flags de servicio con su default `true`,
--   límites, suspensión) y `projects.created_at` (el proyecto principal es el más antiguo).
-- · `billing_plans` con los TRES planes tal como están en producción (2026-11-16) y
--   `subscriptions` con su índice de una viva por empresa (20260528000030).
-- · `auth.role()`, `sesion_api_sin_empresa()` (20261029000000) en versión mínima.
-- · Las funciones y triggers VIGENTES que la migración reemplaza: create_trial_subscription
--   (20260717130000) y lock_companies_billing_columns (20260612210000), copiadas de producción.
-- · Una plataforma (super_admin) para ejercer los interruptores.
ALTER TABLE public.companies
  ADD COLUMN IF NOT EXISTS servicio_agua boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS servicio_condominios boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS max_projects integer,
  ADD COLUMN IF NOT EXISTS max_units integer,
  ADD COLUMN IF NOT EXISTS activa boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS signup_source text,
  ADD COLUMN IF NOT EXISTS suspended_at timestamptz,
  ADD COLUMN IF NOT EXISTS suspended_reason text,
  ADD COLUMN IF NOT EXISTS nit text,
  ADD COLUMN IF NOT EXISTS email text,
  ADD COLUMN IF NOT EXISTS telefono text,
  ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE public.projects ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now();
-- PA1 es el proyecto principal de A.
UPDATE public.projects SET created_at = now() - interval '2 days' WHERE id = hkt.pa1();

CREATE OR REPLACE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$
  SELECT CASE WHEN current_user IN ('authenticated', 'anon', 'service_role') THEN current_user::text ELSE 'postgres' END $$;
CREATE OR REPLACE FUNCTION public.sesion_api_sin_empresa() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  -- Dentro de un SECURITY DEFINER current_user es el dueño: la sesión se reconoce por su JWT (auth.uid()).
  SELECT (SELECT auth.uid()) IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM public.app_users u WHERE u.id = (SELECT auth.uid())) $$;
GRANT EXECUTE ON FUNCTION auth.role(), public.sesion_api_sin_empresa() TO anon, authenticated, service_role;

CREATE TABLE public.billing_plans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE, name text NOT NULL, description text,
  price_monthly_cents integer NOT NULL DEFAULT 0, price_yearly_cents integer,
  currency text NOT NULL DEFAULT 'usd', max_projects integer, max_units integer,
  includes_agua boolean NOT NULL DEFAULT false, includes_condominios boolean NOT NULL DEFAULT false,
  features jsonb NOT NULL DEFAULT '[]', is_active boolean NOT NULL DEFAULT true,
  stripe_price_id_monthly text, stripe_price_id_yearly text, sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  base_activation_cents integer NOT NULL DEFAULT 0, extra_project_cents integer NOT NULL DEFAULT 0,
  unit_primary_cents integer NOT NULL DEFAULT 0, unit_extra_cents integer NOT NULL DEFAULT 0,
  stripe_price_id_activation text, stripe_price_id_extra_project text,
  stripe_price_id_unit_primary text, stripe_price_id_unit_extra text,
  feature_codes jsonb NOT NULL DEFAULT '[]');
INSERT INTO public.billing_plans (code, name, price_monthly_cents, price_yearly_cents, max_projects, max_units,
  includes_agua, includes_condominios, sort_order, base_activation_cents, extra_project_cents, unit_primary_cents, unit_extra_cents, feature_codes) VALUES
  ('agua_only', 'Solo Agua', 1000, 10000, 50, 10000, true, false, 10, 1000, 1000, 100, 80,
   '["cobranza_judicial","analisis_cartera","exportacion_avanzada"]'),
  ('condominios_only', 'Solo Condominios', 1000, 10000, 50, 10000, false, true, 20, 1000, 1000, 100, 80,
   '["asambleas_digitales","transparencia_financiera","cobranza_judicial","exportacion_avanzada"]'),
  ('bundle', 'Bundle Completo', 1500, 15000, 50, 10000, true, true, 30, 1500, 1000, 100, 80,
   '["asambleas_digitales","transparencia_financiera","cobranza_judicial","analisis_cartera","exportacion_avanzada","multi_proyecto","enterprise_sso"]');

CREATE TABLE public.subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  plan_id uuid NOT NULL REFERENCES public.billing_plans(id),
  status text NOT NULL, billing_cycle text NOT NULL DEFAULT 'monthly',
  current_period_start timestamptz, current_period_end timestamptz, trial_end timestamptz,
  canceled_at timestamptz, stripe_subscription_id text,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now());
CREATE UNIQUE INDEX subscriptions_company_active ON public.subscriptions (company_id)
  WHERE status IN ('trialing', 'active', 'past_due', 'incomplete');
ALTER TABLE public.subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.billing_plans ENABLE ROW LEVEL SECURITY;

-- Vigentes en producción (pg_get_functiondef, 2026-11-16).
CREATE OR REPLACE FUNCTION public.create_trial_subscription() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $function$
DECLARE
  v_code text;
  v_plan uuid;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.subscriptions s WHERE s.company_id = NEW.id) THEN
    v_code := CASE
      WHEN COALESCE(NEW.servicio_agua, false) AND NOT COALESCE(NEW.servicio_condominios, false)
        THEN 'agua_only'
      WHEN COALESCE(NEW.servicio_condominios, false) AND NOT COALESCE(NEW.servicio_agua, false)
        THEN 'condominios_only'
      ELSE 'bundle'
    END;
    SELECT id INTO v_plan FROM public.billing_plans WHERE code = v_code LIMIT 1;
    IF v_plan IS NULL THEN
      SELECT id INTO v_plan FROM public.billing_plans WHERE code = 'bundle' LIMIT 1;
    END IF;
    INSERT INTO public.subscriptions (company_id, plan_id, status, billing_cycle,
                                      current_period_start, current_period_end, trial_end)
    VALUES (NEW.id, v_plan, 'trialing', 'monthly', now(), now() + interval '14 days', now() + interval '14 days');
  END IF;
  RETURN NEW;
END;
$function$;
CREATE TRIGGER trg_create_trial_subscription AFTER INSERT ON public.companies
  FOR EACH ROW EXECUTE FUNCTION public.create_trial_subscription();

CREATE OR REPLACE FUNCTION public.lock_companies_billing_columns() RETURNS trigger
LANGUAGE plpgsql SET search_path TO '' AS $function$
BEGIN
  IF (SELECT auth.role()) = 'authenticated' AND NOT public.is_super_admin() THEN
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
$function$;
CREATE TRIGGER trg_lock_companies_billing_columns BEFORE UPDATE ON public.companies
  FOR EACH ROW EXECUTE FUNCTION public.lock_companies_billing_columns();

-- Estado de partida: A es de solo Agua (activa, sin Stripe); B es bundle (activa).
UPDATE public.companies SET servicio_agua = true, servicio_condominios = false, servicio_rentas = false WHERE id = hkt.ca();
INSERT INTO public.subscriptions (company_id, plan_id, status) VALUES
  (hkt.ca(), (SELECT id FROM public.billing_plans WHERE code = 'agua_only'), 'active'),
  (hkt.cb(), (SELECT id FROM public.billing_plans WHERE code = 'bundle'), 'active');

-- La plataforma.
INSERT INTO auth.users (id, email) VALUES (hkt.uid(14), 'plataforma@prueba.test');
INSERT INTO public.app_users (id, full_name, role, company_id, activo) VALUES (hkt.uid(14), 'Plataforma', 'super_admin', NULL, true);
