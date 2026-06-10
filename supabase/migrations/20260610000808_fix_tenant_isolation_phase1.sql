-- =====================================================================
-- Fase 1 — Aislamiento multi-tenant y bloqueo de auto-escalada.
-- Idempotente (CREATE OR REPLACE / DROP IF EXISTS) para reaplicarse sin daño.
-- Rollback: DROP TRIGGER trg_lock_app_users_self_privilege ON public.app_users;
--           DROP TRIGGER trg_lock_companies_billing_columns ON public.companies;
--           y restaurar las políticas registros_* previas (ver git history).
-- =====================================================================

-- ---------------------------------------------------------------------
-- #1  app_users: congelar columnas sensibles en auto-edición.
--     La política app_users_update permite "OR id = auth.uid()" sin
--     restricción de columnas → un usuario podía hacerse super_admin o
--     cambiar su company_id. Este trigger las fija a su valor previo
--     cuando el actor edita SU PROPIA fila y no es super_admin.
--     service_role (auth.uid() IS NULL) y super_admin NO se ven afectados.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.lock_app_users_self_privilege()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF (SELECT auth.uid()) = NEW.id AND NOT public.is_super_admin() THEN
    NEW.role            := OLD.role;
    NEW.company_id      := OLD.company_id;
    NEW.cliente_id      := OLD.cliente_id;
    NEW.project_id      := OLD.project_id;
    NEW.activo          := OLD.activo;
    NEW.permission_type := OLD.permission_type;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_lock_app_users_self_privilege ON public.app_users;
CREATE TRIGGER trg_lock_app_users_self_privilege
  BEFORE UPDATE ON public.app_users
  FOR EACH ROW EXECUTE FUNCTION public.lock_app_users_self_privilege();

-- ---------------------------------------------------------------------
-- #8  companies: congelar columnas de plan/límites para usuarios finales.
--     companies_update es ciega a columnas → un company_owner podía
--     inflar max_units/max_projects/plan. Solo service_role (webhook de
--     Stripe / signup) y super_admin pueden tocar estas columnas.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.lock_companies_billing_columns()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF (SELECT auth.role()) = 'authenticated' AND NOT public.is_super_admin() THEN
    NEW.plan          := OLD.plan;
    NEW.max_projects  := OLD.max_projects;
    NEW.max_units     := OLD.max_units;
    NEW.activa        := OLD.activa;
    NEW.signup_source := OLD.signup_source;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_lock_companies_billing_columns ON public.companies;
CREATE TRIGGER trg_lock_companies_billing_columns
  BEFORE UPDATE ON public.companies
  FOR EACH ROW EXECUTE FUNCTION public.lock_companies_billing_columns();

-- ---------------------------------------------------------------------
-- #4  registros: la rama "solo rol" de insert/update/delete carecía de
--     scope de tenant → staff de la empresa A escribía/borraba lecturas
--     en proyectos de la empresa B (registros no tiene company_id; el
--     aislamiento es vía project_id -> projects.company_id).
--     Se conserva: super_admin global, y asignación explícita a proyecto
--     (ligada al proyecto, no cross-tenant). La rama de rol/permiso ahora
--     exige que el proyecto pertenezca a la empresa del usuario.
-- ---------------------------------------------------------------------
DROP POLICY IF EXISTS registros_insert ON public.registros;
CREATE POLICY registros_insert ON public.registros
  FOR INSERT TO authenticated
  WITH CHECK (
    public.is_super_admin()
    OR EXISTS (SELECT 1 FROM public.user_project_assignments upa
               WHERE upa.user_id = (SELECT auth.uid()) AND upa.project_id = registros.project_id)
    OR (
      project_id IN (SELECT p.id FROM public.projects p WHERE p.company_id = (SELECT public.get_my_company_id()))
      AND (
        public.current_user_role() = ANY (ARRAY['admin','company_owner','operator','operador'])
        OR (SELECT public.user_has_permission('agua.lecturas.create'))
      )
    )
  );

DROP POLICY IF EXISTS registros_update ON public.registros;
CREATE POLICY registros_update ON public.registros
  FOR UPDATE TO authenticated
  USING (
    public.is_super_admin()
    OR EXISTS (SELECT 1 FROM public.user_project_assignments upa
               WHERE upa.user_id = (SELECT auth.uid()) AND upa.project_id = registros.project_id)
    OR (
      project_id IN (SELECT p.id FROM public.projects p WHERE p.company_id = (SELECT public.get_my_company_id()))
      AND (
        public.current_user_role() = ANY (ARRAY['admin','company_owner','operator','operador'])
        OR (SELECT public.user_has_permission('agua.lecturas.edit'))
      )
    )
  );

DROP POLICY IF EXISTS registros_delete ON public.registros;
CREATE POLICY registros_delete ON public.registros
  FOR DELETE TO authenticated
  USING (
    public.is_super_admin()
    OR EXISTS (SELECT 1 FROM public.user_project_assignments upa
               WHERE upa.user_id = (SELECT auth.uid()) AND upa.project_id = registros.project_id)
    OR (
      project_id IN (SELECT p.id FROM public.projects p WHERE p.company_id = (SELECT public.get_my_company_id()))
      AND (
        public.current_user_role() = ANY (ARRAY['admin','company_owner'])
        OR (SELECT public.user_has_permission('agua.lecturas.change_status'))
      )
    )
  );

-- ---------------------------------------------------------------------
-- #5  buscar_cliente_para_onboarding: era un oráculo de PII cross-tenant
--     (devolvía cliente_id + nombre + 'mismatched_fields' ante match 2-de-3).
--     Endurecido a coincidencia EXACTA 3-de-3; sin oráculo de campos.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.buscar_cliente_para_onboarding(p_cui_dui text, p_fecha_nac date, p_email text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_client record;
BEGIN
  IF p_cui_dui IS NULL OR p_fecha_nac IS NULL OR p_email IS NULL
     OR btrim(p_cui_dui) = '' OR btrim(p_email) = '' THEN
    RETURN jsonb_build_object('match_count', 0, 'cliente_id', NULL);
  END IF;

  SELECT id, nombre
    INTO v_client
    FROM clientes
   WHERE cui_dui = p_cui_dui
     AND fecha_nacimiento = p_fecha_nac
     AND lower(email) = lower(p_email)
   ORDER BY puede_crear_cuenta DESC NULLS LAST
   LIMIT 1;

  IF FOUND THEN
    RETURN jsonb_build_object('match_count', 3, 'cliente_id', v_client.id, 'cliente_nombre', v_client.nombre);
  END IF;

  RETURN jsonb_build_object('match_count', 0, 'cliente_id', NULL);
END;
$function$;

-- ---------------------------------------------------------------------
-- #3  RLS en el set de migraciones: prod ya tiene RLS en estas tablas,
--     pero el repo nunca la habilitaba → deploys frescos/staging quedaban
--     expuestos. Idempotente: no-op donde ya está habilitada.
-- ---------------------------------------------------------------------
ALTER TABLE public.clientes               ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.registros              ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.password_reset_tokens  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.registros_calidad      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payment_requests       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.convenios_pago         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.empresa_pagos_config   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.security_logs          ENABLE ROW LEVEL SECURITY;
