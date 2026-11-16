-- ════════════════════════════════════════════════════════════════════════════
-- Manejo de Rentas como TERCER MÓDULO del plan
-- ════════════════════════════════════════════════════════════════════════════
--
-- EL PROBLEMA
-- 20261125000000 dejó Rentas como un interruptor suelto (companies.servicio_rentas)
-- que no existe para el cobro: no hay plan que lo incluya, el total mensual no
-- lo ve y las propiedades que la empresa administra fuera de sus proyectos no
-- cuentan como unidades. Además:
--   · el plan de una empresa se fija al crearla y los interruptores de módulos
--     NO lo mueven: una empresa de solo Agua a la que la plataforma le enciende
--     Condominios sigue pagando la activación de un módulo;
--   · la RLS de `companies` deja al dueño actualizar SU fila y nada congela las
--     columnas servicio_*: un dueño puede encenderse un módulo por la API.
--
-- LO QUE HACE ESTA MIGRACIÓN
--   1. Planes para cada combinación con Rentas. La activación sigue la misma
--      escalera: 1 módulo $10, 2 módulos $15, 3 módulos $20.
--        rentas_only         Rentas                        $10
--        agua_rentas         Agua + Rentas                 $15
--        condominios_rentas  Condominios + Rentas          $15
--        suite               Agua + Condominios + Rentas   $20
--      (`bundle` sigue siendo Agua + Condominios, $15.) Los precios por uso
--      (proyecto extra, unidad) son los mismos de todos los planes.
--   2. `plan_code_por_modulos(agua, condominios, rentas)`: la única tabla de
--      verdad módulos → plan. La usan el alta (`create_trial_subscription`) y
--      el trigger nuevo.
--   3. Trigger `trg_companies_modulos_plan`: al cambiar un servicio_* la
--      suscripción viva pasa al plan de esa combinación. Si la suscripción ya
--      la factura Stripe NO se toca desde aquí (repuntar plan_id sin cambiar
--      los precios en Stripe duplicaría líneas en la siguiente sincronización):
--      se rechaza con MODULOS_PLAN_STRIPE y el cambio va por el checkout.
--   4. Las columnas servicio_* quedan congeladas para todo el que no sea la
--      plataforma (mismo trigger que ya congela límites y suspensión).
--   5. Las propiedades en renta INDEPENDIENTES (sin unidad enlazada) de una
--      empresa con Rentas contratado cuentan como unidades de proyecto
--      adicional: en el total mensual, en el uso, en el panel de plataforma y
--      contra el límite de unidades al registrarlas.
--   6. El listado de empresas de la plataforma devuelve `servicio_rentas` y
--      admite filtrar por él.
--
-- LO QUE **NO** HACE
--   · No cambia el plan de ninguna empresa existente: sólo se mueve cuando
--     alguien toca sus módulos. (Una empresa cuyo plan ya no coincidía con sus
--     módulos sigue igual hasta entonces.)
--   · No crea precios en Stripe: los planes nuevos nacen sin stripe_price_id_*,
--     igual que los tres actuales en producción. Antes de cobrar por Stripe hay
--     que cargarlos (docs/STRIPE_PLATFORM_SETUP.md).
--   · No toca enforce_max_units (drift declarado): el tope de unidades al crear
--     una UNIDAD sigue contando sólo unidades.
--
-- Idempotente: se puede aplicar dos veces.
-- REVERSA: scripts/reversion-rentas-plan.sql
-- ════════════════════════════════════════════════════════════════════════════

-- ────────────────────────────────────────────────────────────────────────────
-- 1. Planes
-- ────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.billing_plans
  ADD COLUMN IF NOT EXISTS includes_rentas boolean NOT NULL DEFAULT false;
COMMENT ON COLUMN public.billing_plans.includes_rentas IS
  'El plan incluye el módulo Manejo de Rentas (companies.servicio_rentas).';

-- Precios por uso, topes y moneda se copian de `bundle` (son iguales en los
-- tres planes actuales). Los feature_codes se HEREDAN del plan equivalente sin
-- Rentas: un plan nuevo con Condominios que no llevara `asambleas_digitales`
-- dejaría a esa empresa sin asambleas.
INSERT INTO public.billing_plans (
  code, name, description, price_monthly_cents, price_yearly_cents, currency,
  max_projects, max_units, includes_agua, includes_condominios, includes_rentas,
  features, feature_codes, is_active, sort_order,
  base_activation_cents, extra_project_cents, unit_primary_cents, unit_extra_cents)
SELECT v.code, v.name, v.descripcion, v.base, v.base * 10, b.currency,
       b.max_projects, b.max_units, v.agua, v.condominios, true,
       v.features::jsonb,
       COALESCE(h.feature_codes, '["exportacion_avanzada"]'::jsonb),
       true, v.orden,
       v.base, b.extra_project_cents, b.unit_primary_cents, b.unit_extra_cents
FROM (VALUES
  ('rentas_only', 'Solo Rentas',
   'Propiedades en renta, reservas, contratos e inventario. Para administradoras de rentas.',
   1000, false, false, NULL, 25,
   '["Cartera de propiedades","Reservas de corto plazo","Contratos de renta","Inventario por propiedad"]'),
  ('agua_rentas', 'Agua + Rentas',
   'Control de agua y manejo de rentas en una sola cuenta.',
   1500, true, false, 'agua_only', 32,
   '["Todo de Solo Agua","Todo de Solo Rentas"]'),
  ('condominios_rentas', 'Condominios + Rentas',
   'Condominios y manejo de rentas: las unidades que se rentan y las propiedades externas.',
   1500, false, true, 'condominios_only', 34,
   '["Todo de Solo Condominios","Todo de Solo Rentas"]'),
  ('suite', 'Suite Completa',
   'Agua + Condominios + Rentas. Los tres módulos para administradoras integrales.',
   2000, true, true, 'bundle', 40,
   '["Todo del Bundle Completo","Todo de Solo Rentas"]')
) AS v(code, name, descripcion, base, agua, condominios, hereda_de, orden, features)
JOIN public.billing_plans b ON b.code = 'bundle'
LEFT JOIN public.billing_plans h ON h.code = v.hereda_de
ON CONFLICT (code) DO NOTHING;

DO $$
DECLARE
  v_n int;
BEGIN
  SELECT count(*) INTO v_n FROM public.billing_plans
   WHERE code IN ('rentas_only', 'agua_rentas', 'condominios_rentas', 'suite') AND includes_rentas;
  IF v_n <> 4 THEN
    RAISE EXCEPTION 'rentas_plan: se esperaban 4 planes con Rentas, hay % (¿falta el plan bundle del que se copian los precios?)', v_n;
  END IF;
END;
$$;

-- ────────────────────────────────────────────────────────────────────────────
-- 2. Módulos → plan
-- ────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.plan_code_por_modulos(p_agua boolean, p_condominios boolean, p_rentas boolean)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
  SELECT CASE
    WHEN COALESCE(p_agua, false) AND COALESCE(p_condominios, false) AND COALESCE(p_rentas, false) THEN 'suite'
    WHEN COALESCE(p_agua, false) AND COALESCE(p_condominios, false) THEN 'bundle'
    WHEN COALESCE(p_agua, false) AND COALESCE(p_rentas, false)      THEN 'agua_rentas'
    WHEN COALESCE(p_condominios, false) AND COALESCE(p_rentas, false) THEN 'condominios_rentas'
    WHEN COALESCE(p_agua, false)        THEN 'agua_only'
    WHEN COALESCE(p_condominios, false) THEN 'condominios_only'
    WHEN COALESCE(p_rentas, false)      THEN 'rentas_only'
    ELSE NULL
  END
$$;
COMMENT ON FUNCTION public.plan_code_por_modulos(boolean, boolean, boolean) IS
  'Código del billing plan que corresponde a una combinación de módulos. NULL si no hay ninguno encendido.';
REVOKE EXECUTE ON FUNCTION public.plan_code_por_modulos(boolean, boolean, boolean) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.plan_code_por_modulos(boolean, boolean, boolean) TO authenticated, service_role;

-- Alta de empresa: mismo cuerpo que 20260717130000, con la tabla de arriba.
-- Sin ningún módulo (o si el plan no existiera) cae en `bundle`, como antes.
CREATE OR REPLACE FUNCTION public.create_trial_subscription()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_code text;
  v_plan uuid;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.subscriptions s WHERE s.company_id = NEW.id) THEN
    v_code := COALESCE(
      public.plan_code_por_modulos(NEW.servicio_agua, NEW.servicio_condominios, NEW.servicio_rentas),
      'bundle');
    SELECT id INTO v_plan FROM public.billing_plans WHERE code = v_code LIMIT 1;
    IF v_plan IS NULL THEN
      SELECT id INTO v_plan FROM public.billing_plans WHERE code = 'bundle' LIMIT 1;
    END IF;
    INSERT INTO public.subscriptions (company_id, plan_id, status, billing_cycle,
                                      current_period_start, current_period_end, trial_end)
    VALUES (
      NEW.id, v_plan,
      'trialing', 'monthly', now(), now() + interval '14 days', now() + interval '14 days'
    );
  END IF;
  RETURN NEW;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.create_trial_subscription() FROM PUBLIC, anon, authenticated;

-- ────────────────────────────────────────────────────────────────────────────
-- 3. Al cambiar los módulos, la suscripción viva cambia de plan
-- ────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.companies_modulos_plan()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_code   text;
  v_plan   uuid;
  v_sub    record;
BEGIN
  IF NEW.servicio_agua        IS NOT DISTINCT FROM OLD.servicio_agua
     AND NEW.servicio_condominios IS NOT DISTINCT FROM OLD.servicio_condominios
     AND NEW.servicio_rentas      IS NOT DISTINCT FROM OLD.servicio_rentas THEN
    RETURN NEW;
  END IF;
  v_code := public.plan_code_por_modulos(NEW.servicio_agua, NEW.servicio_condominios, NEW.servicio_rentas);
  -- Sin módulos no hay plan al que pasar: la suscripción se queda como está.
  IF v_code IS NULL THEN
    RETURN NEW;
  END IF;
  SELECT s.id, s.plan_id, s.stripe_subscription_id INTO v_sub
    FROM public.subscriptions s
   WHERE s.company_id = NEW.id
     AND s.status IN ('trialing', 'active', 'past_due', 'incomplete')
   ORDER BY s.created_at DESC
   LIMIT 1;
  IF NOT FOUND THEN
    RETURN NEW;
  END IF;
  SELECT bp.id INTO v_plan FROM public.billing_plans bp WHERE bp.code = v_code LIMIT 1;
  IF v_plan IS NULL THEN
    RAISE EXCEPTION 'MODULOS_PLAN_INEXISTENTE: no existe el plan % para esa combinación de módulos', v_code
      USING ERRCODE = 'check_violation';
  END IF;
  IF v_sub.plan_id IS NOT DISTINCT FROM v_plan THEN
    RETURN NEW;
  END IF;
  IF v_sub.stripe_subscription_id IS NOT NULL THEN
    RAISE EXCEPTION 'MODULOS_PLAN_STRIPE: esta empresa ya se factura por Stripe; cambia su plan desde el checkout para que los precios cambien también allá'
      USING ERRCODE = 'check_violation';
  END IF;
  UPDATE public.subscriptions SET plan_id = v_plan WHERE id = v_sub.id;
  RETURN NEW;
END;
$$;
COMMENT ON FUNCTION public.companies_modulos_plan() IS
  'Trigger de companies: al cambiar servicio_agua/condominios/rentas pasa la suscripción viva al plan de esa combinación (plan_code_por_modulos). Rechaza si la suscripción ya vive en Stripe.';
REVOKE EXECUTE ON FUNCTION public.companies_modulos_plan() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_companies_modulos_plan ON public.companies;
CREATE TRIGGER trg_companies_modulos_plan
  AFTER UPDATE OF servicio_agua, servicio_condominios, servicio_rentas ON public.companies
  FOR EACH ROW EXECUTE FUNCTION public.companies_modulos_plan();

-- ────────────────────────────────────────────────────────────────────────────
-- 4. Los módulos los enciende la plataforma, no la empresa
-- ────────────────────────────────────────────────────────────────────────────
-- Mismo cuerpo vigente (20260612210000) más las tres columnas servicio_*.
-- El alta por signup-company entra con service_role y no pasa por aquí.
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
    -- Los módulos definen el plan y lo que se cobra.
    NEW.servicio_agua        := OLD.servicio_agua;
    NEW.servicio_condominios := OLD.servicio_condominios;
    NEW.servicio_rentas      := OLD.servicio_rentas;
  END IF;
  RETURN NEW;
END;
$$;

-- ────────────────────────────────────────────────────────────────────────────
-- 5. Propiedades independientes = unidades de proyecto adicional
-- ────────────────────────────────────────────────────────────────────────────
-- Cuántas propiedades en renta de la empresa NO son una unidad de un proyecto.
-- Sólo cuentan con Rentas contratado: con el servicio apagado la empresa no las
-- ve (RLS) y no se le cobran. Interna: la llaman las funciones de abajo.
CREATE OR REPLACE FUNCTION public.rentas_propiedades_independientes(p_company_id uuid)
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT CASE WHEN COALESCE((SELECT c.servicio_rentas FROM public.companies c WHERE c.id = p_company_id), false)
    THEN (SELECT count(*)::int FROM public.rentas_propiedades p
           WHERE p.company_id = p_company_id AND p.unidad_id IS NULL)
    ELSE 0 END
$$;
COMMENT ON FUNCTION public.rentas_propiedades_independientes(uuid) IS
  'Propiedades en renta sin unidad enlazada de una empresa con Rentas contratado (0 si no lo tiene). Se cobran y se topan como unidades de proyecto adicional.';
REVOKE EXECUTE ON FUNCTION public.rentas_propiedades_independientes(uuid) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.rentas_propiedades_independientes(uuid) TO service_role;

-- 5.1 Total mensual. Cuerpo vigente en producción (20260606150000 + el guard de
-- 20261029000000) con una sola línea nueva: las independientes se suman a las
-- unidades adicionales. No cambia el RETURNS TABLE ni los cuatro componentes
-- que Stripe factura.
CREATE OR REPLACE FUNCTION public.calculate_monthly_total_cents(p_company_id uuid)
RETURNS TABLE(total_cents integer, base_activation_cents integer, extra_projects_subtotal integer, primary_units_subtotal integer, extra_units_subtotal integer, extra_projects_count integer, primary_units_count integer, extra_units_count integer, primary_project_id uuid)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
declare
  v_plan record;
  v_primary_id uuid;
  v_projects_total integer;
  v_primary_units integer;
  v_extra_units integer;
  v_extra_projects integer;
begin
  if public.sesion_api_sin_empresa() or not (
    public.is_super_admin()
    or p_company_id = public.get_my_company_id()
    or coalesce(current_setting('request.jwt.claims', true)::jsonb ->> 'role', '') = 'service_role'
  ) then
    raise exception 'no autorizado' using errcode = '42501';
  end if;
  select bp.base_activation_cents, bp.extra_project_cents, bp.unit_primary_cents, bp.unit_extra_cents
    into v_plan
  from public.companies c
  left join public.subscriptions s on s.company_id = c.id and s.status in ('trialing','active','past_due','incomplete')
  left join public.billing_plans bp on bp.id = s.plan_id
  where c.id = p_company_id limit 1;
  if v_plan is null or v_plan.base_activation_cents is null then
    total_cents := 0; base_activation_cents := 0; extra_projects_subtotal := 0;
    primary_units_subtotal := 0; extra_units_subtotal := 0;
    extra_projects_count := 0; primary_units_count := 0; extra_units_count := 0;
    primary_project_id := null; return next; return;
  end if;
  select id into v_primary_id from public.projects where company_id = p_company_id
    order by created_at asc nulls last, id asc limit 1;
  select count(*) into v_projects_total from public.projects where company_id = p_company_id;
  v_extra_projects := greatest(0, v_projects_total - 1);
  if v_primary_id is not null then
    select count(*) into v_primary_units from public.unidades where company_id = p_company_id and project_id = v_primary_id;
  else
    v_primary_units := 0;
  end if;
  if v_primary_id is not null then
    select count(*) into v_extra_units from public.unidades where company_id = p_company_id and (project_id is null or project_id <> v_primary_id);
  else
    select count(*) into v_extra_units from public.unidades where company_id = p_company_id;
  end if;
  -- Manejo de Rentas: las propiedades independientes se cobran como unidades adicionales.
  v_extra_units := v_extra_units + public.rentas_propiedades_independientes(p_company_id);
  base_activation_cents := v_plan.base_activation_cents;
  extra_projects_subtotal := v_extra_projects * v_plan.extra_project_cents;
  primary_units_subtotal := v_primary_units * v_plan.unit_primary_cents;
  extra_units_subtotal := v_extra_units * v_plan.unit_extra_cents;
  total_cents := base_activation_cents + extra_projects_subtotal + primary_units_subtotal + extra_units_subtotal;
  extra_projects_count := v_extra_projects;
  primary_units_count := v_primary_units;
  extra_units_count := v_extra_units;
  primary_project_id := v_primary_id;
  return next;
end;
$function$;
REVOKE ALL ON FUNCTION public.calculate_monthly_total_cents(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.calculate_monthly_total_cents(uuid) TO authenticated, service_role;

-- 5.2 Uso: lo que se compara contra el límite de unidades.
CREATE OR REPLACE FUNCTION public.get_company_usage(p_company_id uuid)
RETURNS TABLE(projects_count bigint, units_count bigint)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
begin
  if public.sesion_api_sin_empresa() or not (
    public.is_super_admin()
    or p_company_id = public.get_my_company_id()
    or coalesce(current_setting('request.jwt.claims', true)::jsonb ->> 'role', '') = 'service_role'
  ) then
    raise exception 'no autorizado' using errcode = '42501';
  end if;
  return query
    select
      (select count(*) from public.projects where company_id = p_company_id),
      (select count(*) from public.unidades where company_id = p_company_id)
        + public.rentas_propiedades_independientes(p_company_id)::bigint;
end;
$function$;
REVOKE ALL ON FUNCTION public.get_company_usage(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_company_usage(uuid) TO authenticated, service_role;

-- 5.3 Tope al REGISTRAR una propiedad independiente. Sólo en el alta: una
-- propiedad que pasa a independiente porque se eliminó su unidad
-- (ON DELETE SET NULL) no debe impedir ese borrado. Mismo criterio y mismo
-- mensaje que enforce_max_units: sin límite (NULL) no se topa. (La plataforma
-- no escribe propiedades —su RLS sólo le deja leerlas—, así que no hay excepción.)
CREATE OR REPLACE FUNCTION public.rentas_tope_unidades()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_limite int;
  v_uso    int;
BEGIN
  IF NEW.unidad_id IS NOT NULL OR NEW.company_id IS NULL THEN
    RETURN NEW;
  END IF;
  SELECT c.max_units INTO v_limite FROM public.companies c WHERE c.id = NEW.company_id;
  IF v_limite IS NULL THEN
    RETURN NEW;
  END IF;
  SELECT (SELECT count(*) FROM public.unidades u WHERE u.company_id = NEW.company_id)
       + (SELECT count(*) FROM public.rentas_propiedades p WHERE p.company_id = NEW.company_id AND p.unidad_id IS NULL)
    INTO v_uso;
  IF v_uso >= v_limite THEN
    RAISE EXCEPTION 'plan_limit_reached: max_units = %', v_limite
      USING ERRCODE = 'check_violation',
            HINT = 'Las propiedades independientes cuentan como unidades. Amplía el límite de unidades de la empresa.';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.rentas_tope_unidades() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_rentas_propiedades_tope ON public.rentas_propiedades;
CREATE TRIGGER trg_rentas_propiedades_tope
  BEFORE INSERT ON public.rentas_propiedades
  FOR EACH ROW EXECUTE FUNCTION public.rentas_tope_unidades();

-- ────────────────────────────────────────────────────────────────────────────
-- 6. Panel de plataforma
-- ────────────────────────────────────────────────────────────────────────────
-- Las MVs no admiten CREATE OR REPLACE con otra consulta: DROP + CREATE, primero
-- la que depende (mv_superadmin_plataforma) y luego la base. La de plataforma
-- se recrea con la MISMA consulta de 20260717130000.
DROP MATERIALIZED VIEW IF EXISTS public.mv_superadmin_plataforma;
DROP MATERIALIZED VIEW IF EXISTS public.mv_superadmin_empresa_counts;

CREATE MATERIALIZED VIEW public.mv_superadmin_empresa_counts AS
WITH primary_project AS (
  -- Proyecto "principal" = el más antiguo (mismo criterio que
  -- calculate_monthly_total_cents: MIN created_at, desempate por id).
  SELECT DISTINCT ON (company_id) company_id, id AS project_id
  FROM public.projects
  ORDER BY company_id, created_at ASC NULLS LAST, id ASC
),
unidades_split AS (
  SELECT
    u.company_id,
    count(*)::int AS unit_count,
    count(*) FILTER (WHERE pp.project_id IS NOT NULL AND u.project_id = pp.project_id)::int AS primary_units,
    count(*) FILTER (WHERE pp.project_id IS NULL OR u.project_id IS DISTINCT FROM pp.project_id)::int AS extra_units
  FROM public.unidades u
  LEFT JOIN primary_project pp ON pp.company_id = u.company_id
  GROUP BY u.company_id
),
rentas_indep AS (
  -- Propiedades en renta sin unidad enlazada, sólo con Rentas contratado
  -- (mismo criterio que rentas_propiedades_independientes).
  SELECT rp.company_id, count(*)::int AS cnt
  FROM public.rentas_propiedades rp
  JOIN public.companies rc ON rc.id = rp.company_id AND rc.servicio_rentas
  WHERE rp.unidad_id IS NULL
  GROUP BY rp.company_id
)
SELECT
  c.id                        AS company_id,
  COALESCE(p.cnt,  0)         AS project_count,
  COALESCE(au.cnt, 0)         AS user_count,
  COALESCE(us.unit_count, 0) + COALESCE(ri.cnt, 0) AS unit_count,
  s.status                    AS subscription_status,
  bp.code                     AS plan_code,
  CASE WHEN bp.id IS NULL THEN 0 ELSE
    bp.base_activation_cents
    + GREATEST(COALESCE(p.cnt, 0) - 1, 0) * bp.extra_project_cents
    + COALESCE(us.primary_units, 0)       * bp.unit_primary_cents
    + (COALESCE(us.extra_units, 0) + COALESCE(ri.cnt, 0)) * bp.unit_extra_cents
  END                         AS monthly_total_cents
FROM public.companies c
LEFT JOIN (
  SELECT company_id, count(*)::int AS cnt FROM public.projects  GROUP BY company_id
) p  ON p.company_id  = c.id
LEFT JOIN (
  SELECT company_id, count(*)::int AS cnt FROM public.app_users GROUP BY company_id
) au ON au.company_id = c.id
LEFT JOIN unidades_split us ON us.company_id = c.id
LEFT JOIN rentas_indep ri ON ri.company_id = c.id
LEFT JOIN LATERAL (
  SELECT sub.status, sub.plan_id
  FROM public.subscriptions sub
  WHERE sub.company_id = c.id
    AND sub.status IN ('trialing', 'active', 'past_due', 'incomplete')
  ORDER BY sub.created_at DESC
  LIMIT 1
) s ON true
LEFT JOIN public.billing_plans bp ON bp.id = s.plan_id;

CREATE UNIQUE INDEX IF NOT EXISTS mv_superadmin_empresa_counts_pk
  ON public.mv_superadmin_empresa_counts (company_id);

COMMENT ON MATERIALIZED VIEW public.mv_superadmin_empresa_counts IS
  'Conteos (proyectos/usuarios/unidades + propiedades en renta independientes) + suscripción activa + total mensual estimado por empresa para el panel superadmin. Refrescada por pg_cron. Acceso sólo vía RPC get_superadmin_empresas.';

REVOKE ALL ON public.mv_superadmin_empresa_counts FROM PUBLIC, anon, authenticated;

CREATE MATERIALIZED VIEW public.mv_superadmin_plataforma AS
WITH sub AS (
  SELECT s.status, s.canceled_at, bp.code, bp.name
  FROM public.subscriptions s
  JOIN public.billing_plans bp ON bp.id = s.plan_id
),
vigentes AS (
  SELECT * FROM sub WHERE status IN ('active', 'trialing')
),
plan_dist AS (
  SELECT jsonb_agg(
           jsonb_build_object('planCode', code, 'planName', name, 'count', cnt)
           ORDER BY cnt DESC
         ) AS dist
  FROM (
    SELECT code, name, count(*)::int AS cnt
    FROM vigentes
    GROUP BY code, name
  ) g
),
-- F2 (C6): partición del MRR active por cobrabilidad. Una empresa es COBRABLE
-- si su suscripción active tiene stripe_subscription_id (Stripe la factura);
-- sin él es un piloto grandfathered que opera gratis (MRR potencial).
mrr_particion AS (
  SELECT
    COALESCE(sum(ec.monthly_total_cents) FILTER (WHERE cob.es_cobrable), 0)::bigint     AS cobrable,
    COALESCE(sum(ec.monthly_total_cents) FILTER (WHERE NOT cob.es_cobrable), 0)::bigint AS potencial,
    count(*) FILTER (WHERE NOT cob.es_cobrable)::int                                    AS grandfathered
  FROM public.mv_superadmin_empresa_counts ec
  CROSS JOIN LATERAL (
    SELECT EXISTS (
      SELECT 1 FROM public.subscriptions s
      WHERE s.company_id = ec.company_id
        AND s.status = 'active'
        AND s.stripe_subscription_id IS NOT NULL
    ) AS es_cobrable
  ) cob
  WHERE ec.subscription_status = 'active'
)
SELECT
  1::smallint AS singleton,
  (SELECT count(*)::int FROM public.companies)                       AS total_empresas,
  (SELECT count(*)::int FROM public.companies WHERE activa)          AS empresas_activas,
  (SELECT count(*)::int FROM public.companies WHERE NOT activa)      AS empresas_inactivas,
  (SELECT count(*)::int FROM public.app_users)                       AS total_usuarios,
  (SELECT count(*)::int FROM public.projects)                        AS total_proyectos,
  (SELECT count(*)::int FROM public.unidades)                        AS total_unidades,
  -- mrr_cents: semántica INTACTA (todas las active, por uso) — la serie diaria
  -- de platform_metrics_daily sigue comparable. El desglose va aparte.
  COALESCE((
    SELECT sum(ec.monthly_total_cents)::bigint
    FROM public.mv_superadmin_empresa_counts ec
    WHERE ec.subscription_status = 'active'
  ), 0)                                                              AS mrr_cents,
  (SELECT cobrable FROM mrr_particion)                               AS mrr_cobrable_cents,
  (SELECT potencial FROM mrr_particion)                              AS mrr_potencial_cents,
  (SELECT grandfathered FROM mrr_particion)                          AS empresas_grandfathered,
  (SELECT count(*)::int FROM sub WHERE status = 'active')            AS suscripciones_activas,
  (SELECT count(*)::int FROM sub WHERE status = 'trialing')          AS suscripciones_trialing,
  (SELECT count(*)::int FROM sub
     WHERE status = 'canceled'
       AND canceled_at IS NOT NULL
       AND canceled_at >= now() - interval '30 days')                AS canceladas_30d,
  (SELECT count(*)::int FROM vigentes)                              AS suscripciones_vigentes,
  COALESCE((SELECT dist FROM plan_dist), '[]'::jsonb)               AS plan_distribution,
  now()                                                             AS refreshed_at;

CREATE UNIQUE INDEX IF NOT EXISTS mv_superadmin_plataforma_pk
  ON public.mv_superadmin_plataforma (singleton);

COMMENT ON MATERIALIZED VIEW public.mv_superadmin_plataforma IS
  'KPIs globales del SaaS. mrr_cents = total mensual por USO de las active; mrr_cobrable_cents/mrr_potencial_cents lo parten por cobrabilidad (con/sin stripe_subscription_id — F2/C6); empresas_grandfathered = pilotos active sin Stripe. Refrescada por pg_cron después de mv_superadmin_empresa_counts. Acceso sólo vía RPC.';

REVOKE ALL ON public.mv_superadmin_plataforma FROM PUBLIC, anon, authenticated;

-- 6.1 Listado de empresas: devuelve servicio_rentas y filtra por él.
-- Cambia el RETURNS TABLE → DROP + CREATE.
DROP FUNCTION IF EXISTS public.get_superadmin_empresas(text, integer, integer, text, text, text);

CREATE FUNCTION public.get_superadmin_empresas(
  p_search text DEFAULT NULL, p_limit integer DEFAULT 25, p_offset integer DEFAULT 0,
  p_status text DEFAULT NULL, p_module text DEFAULT NULL, p_sort text DEFAULT 'nombre')
RETURNS TABLE(id uuid, nombre text, nit text, email text, telefono text, activa boolean, suspended_at timestamp with time zone, suspended_reason text, created_at timestamp with time zone, max_projects integer, max_units integer, servicio_agua boolean, servicio_condominios boolean, servicio_rentas boolean, project_count integer, user_count integer, unit_count integer, plan_code text, subscription_status text, monthly_total_cents integer, total_count bigint)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_limit  int  := LEAST(GREATEST(COALESCE(p_limit, 25), 1), 100);
  v_offset int  := GREATEST(COALESCE(p_offset, 0), 0);
  v_search text := NULLIF(btrim(COALESCE(p_search, '')), '');
  v_status text := NULLIF(btrim(COALESCE(p_status, '')), '');
  v_module text := NULLIF(btrim(COALESCE(p_module, '')), '');
  v_sort   text := COALESCE(NULLIF(btrim(COALESCE(p_sort, '')), ''), 'nombre');
BEGIN
  IF NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'no autorizado' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
    WITH filtradas AS (
      SELECT c.*
      FROM public.companies c
      WHERE (v_search IS NULL
             OR c.nombre ILIKE '%' || v_search || '%'
             OR c.nit    ILIKE '%' || v_search || '%'
             OR c.email  ILIKE '%' || v_search || '%')
        AND (v_status IS NULL
             OR (v_status = 'activas'     AND c.activa)
             OR (v_status = 'suspendidas' AND NOT c.activa))
        AND (v_module IS NULL
             OR (v_module = 'agua'        AND c.servicio_agua AND NOT c.servicio_condominios)
             OR (v_module = 'condominios' AND c.servicio_condominios AND NOT c.servicio_agua)
             OR (v_module = 'ambos'       AND c.servicio_agua AND c.servicio_condominios)
             OR (v_module = 'rentas'      AND c.servicio_rentas))
    )
    SELECT
      f.id, f.nombre, f.nit, f.email, f.telefono,
      f.activa, f.suspended_at, f.suspended_reason, f.created_at,
      f.max_projects, f.max_units, f.servicio_agua, f.servicio_condominios, f.servicio_rentas,
      COALESCE(mc.project_count, 0)       AS project_count,
      COALESCE(mc.user_count,    0)       AS user_count,
      COALESCE(mc.unit_count,    0)       AS unit_count,
      mc.plan_code,
      mc.subscription_status,
      COALESCE(mc.monthly_total_cents, 0) AS monthly_total_cents,
      count(*) OVER ()                    AS total_count
    FROM filtradas f
    LEFT JOIN public.mv_superadmin_empresa_counts mc ON mc.company_id = f.id
    ORDER BY
      CASE WHEN v_sort = 'unidades'   THEN COALESCE(mc.unit_count, 0)          END DESC,
      CASE WHEN v_sort = 'monto'      THEN COALESCE(mc.monthly_total_cents, 0) END DESC,
      CASE WHEN v_sort = 'created_at' THEN f.created_at                        END DESC,
      f.nombre ASC
    LIMIT v_limit OFFSET v_offset;
END
$function$;

COMMENT ON FUNCTION public.get_superadmin_empresas(text, integer, integer, text, text, text) IS
  'Listado paginado de empresas del panel superadmin (filtros, orden, módulos incl. Rentas y facturación). Acotada a super_admin.';
REVOKE ALL ON FUNCTION public.get_superadmin_empresas(text, integer, integer, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_superadmin_empresas(text, integer, integer, text, text, text) TO authenticated, service_role;
