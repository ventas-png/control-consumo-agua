-- Seguridad · scope cross-tenant en RPCs SECURITY DEFINER con p_company_id.
--
-- Hallazgo (auditoría T7): get_company_usage / get_company_effective_limits /
-- calculate_monthly_total_cents son SECURITY DEFINER, ejecutables por `authenticated`
-- (correcto: el front las llama para la empresa propia), pero NO verificaban que el
-- llamador perteneciera a `p_company_id`. Un usuario autenticado podía pasar el UUID
-- de OTRA empresa y leer sus conteos, límites de plan y total de facturación mensual
-- (fuga cross-tenant de datos de negocio; solo lectura).
--
-- Fix: guard al inicio de cada función — super_admin, o empresa propia
-- (get_my_company_id), o service_role (preserva los triggers de enforcement de
-- límites y el edge sync-stripe-quantities, que corren server-side).
--
-- Idempotente (CREATE OR REPLACE, misma firma → preserva los GRANT existentes).
-- Las 2 funciones SQL pasan a plpgsql para poder llevar el guard; el contrato
-- (RETURNS TABLE) no cambia. Validado contra prod en transacción con ROLLBACK.

create or replace function public.get_company_usage(p_company_id uuid)
returns table(projects_count bigint, units_count bigint)
language plpgsql stable security definer set search_path to 'public'
as $function$
begin
  if not (
    public.is_super_admin()
    or p_company_id = public.get_my_company_id()
    or coalesce(current_setting('request.jwt.claims', true)::jsonb ->> 'role', '') = 'service_role'
  ) then
    raise exception 'no autorizado' using errcode = '42501';
  end if;
  return query
    select
      (select count(*) from public.projects where company_id = p_company_id),
      (select count(*) from public.unidades where company_id = p_company_id);
end;
$function$;

create or replace function public.get_company_effective_limits(p_company_id uuid)
returns table(max_projects integer, max_units integer)
language plpgsql stable security definer set search_path to 'public'
as $function$
begin
  if not (
    public.is_super_admin()
    or p_company_id = public.get_my_company_id()
    or coalesce(current_setting('request.jwt.claims', true)::jsonb ->> 'role', '') = 'service_role'
  ) then
    raise exception 'no autorizado' using errcode = '42501';
  end if;
  return query
    select
      case when bp.max_projects is null then null else greatest(bp.max_projects, coalesce(c.max_projects, 0)) end,
      case when bp.max_units is null then null else greatest(bp.max_units, coalesce(c.max_units, 0)) end
    from public.companies c
    left join public.subscriptions s on s.company_id = c.id and s.status in ('trialing','active','past_due','incomplete')
    left join public.billing_plans bp on bp.id = s.plan_id
    where c.id = p_company_id limit 1;
end;
$function$;

create or replace function public.calculate_monthly_total_cents(p_company_id uuid)
returns table(total_cents integer, base_activation_cents integer, extra_projects_subtotal integer, primary_units_subtotal integer, extra_units_subtotal integer, extra_projects_count integer, primary_units_count integer, extra_units_count integer, primary_project_id uuid)
language plpgsql stable security definer set search_path to 'public'
as $function$
declare
  v_plan record;
  v_primary_id uuid;
  v_projects_total integer;
  v_primary_units integer;
  v_extra_units integer;
  v_extra_projects integer;
begin
  if not (
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
