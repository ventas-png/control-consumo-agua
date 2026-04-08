-- ============================================================
-- 1. Fix mutable search_path on functions
-- ============================================================

CREATE OR REPLACE FUNCTION public.sync_registro_monto_pagado()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path = public
AS $function$
BEGIN
  IF NEW.registro_id IS NOT NULL THEN
    UPDATE public.registros
    SET monto_pagado = (
      SELECT COALESCE(SUM(monto), 0)
      FROM public.pagos
      WHERE registro_id = NEW.registro_id
        AND estado IN ('verificado', 'aplicado')
    ),
    estado = CASE
      WHEN (
        SELECT COALESCE(SUM(monto), 0)
        FROM public.pagos
        WHERE registro_id = NEW.registro_id
          AND estado IN ('verificado', 'aplicado')
      ) >= monto_calculado THEN 'pagado'
      WHEN (
        SELECT COALESCE(SUM(monto), 0)
        FROM public.pagos
        WHERE registro_id = NEW.registro_id
          AND estado IN ('verificado', 'aplicado')
      ) > 0 THEN 'pendiente'
      ELSE estado
    END
    WHERE id = NEW.registro_id;
  END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.fill_company_id_from_user()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path = public
AS $function$
BEGIN
  IF NEW.company_id IS NULL THEN
    NEW.company_id := (
      SELECT company_id FROM public.app_users WHERE id = auth.uid()
    );
  END IF;
  RETURN NEW;
END;
$function$;

-- ============================================================
-- 2. Fix RLS always-true policies on convenios_pago
-- ============================================================

DROP POLICY IF EXISTS convenios_pago_insert ON public.convenios_pago;
DROP POLICY IF EXISTS convenios_pago_update ON public.convenios_pago;
DROP POLICY IF EXISTS convenios_pago_delete ON public.convenios_pago;

CREATE POLICY convenios_pago_insert ON public.convenios_pago
  FOR INSERT TO authenticated
  WITH CHECK (company_id = get_my_company_id());

CREATE POLICY convenios_pago_update ON public.convenios_pago
  FOR UPDATE TO authenticated
  USING (company_id = get_my_company_id());

CREATE POLICY convenios_pago_delete ON public.convenios_pago
  FOR DELETE TO authenticated
  USING (company_id = get_my_company_id());

-- ============================================================
-- 3. Fix RLS always-true policy on empresa_pagos_config
-- ============================================================

DROP POLICY IF EXISTS empresa_pagos_config_all ON public.empresa_pagos_config;

CREATE POLICY empresa_pagos_config_select ON public.empresa_pagos_config
  FOR SELECT TO authenticated
  USING (company_id = get_my_company_id());

CREATE POLICY empresa_pagos_config_insert ON public.empresa_pagos_config
  FOR INSERT TO authenticated
  WITH CHECK (company_id = get_my_company_id() AND (is_company_owner() OR is_super_admin()));

CREATE POLICY empresa_pagos_config_update ON public.empresa_pagos_config
  FOR UPDATE TO authenticated
  USING (company_id = get_my_company_id() AND (is_company_owner() OR is_super_admin()));

CREATE POLICY empresa_pagos_config_delete ON public.empresa_pagos_config
  FOR DELETE TO authenticated
  USING (company_id = get_my_company_id() AND (is_company_owner() OR is_super_admin()));

-- ============================================================
-- 4. Fix RLS always-true policies on payment_requests
-- ============================================================

DROP POLICY IF EXISTS payment_requests_insert ON public.payment_requests;
DROP POLICY IF EXISTS payment_requests_update ON public.payment_requests;

CREATE POLICY payment_requests_insert ON public.payment_requests
  FOR INSERT TO authenticated
  WITH CHECK (company_id = get_my_company_id());

CREATE POLICY payment_requests_update ON public.payment_requests
  FOR UPDATE TO authenticated
  USING (company_id = get_my_company_id());

-- ============================================================
-- 5. Add missing indexes on foreign keys (performance)
-- ============================================================

CREATE INDEX IF NOT EXISTS idx_clientes_project_id ON public.clientes(project_id);
CREATE INDEX IF NOT EXISTS idx_clientes_updated_by ON public.clientes(updated_by);
CREATE INDEX IF NOT EXISTS idx_company_clientes_added_by ON public.company_clientes(added_by);
CREATE INDEX IF NOT EXISTS idx_company_clientes_cliente_id ON public.company_clientes(cliente_id);
CREATE INDEX IF NOT EXISTS idx_contadores_company_id ON public.contadores(company_id);
CREATE INDEX IF NOT EXISTS idx_contadores_project_id ON public.contadores(project_id);
CREATE INDEX IF NOT EXISTS idx_contadores_tarifa_id ON public.contadores(tarifa_id);
CREATE INDEX IF NOT EXISTS idx_contadores_unidad_id ON public.contadores(unidad_id);
CREATE INDEX IF NOT EXISTS idx_contadores_updated_by ON public.contadores(updated_by);
CREATE INDEX IF NOT EXISTS idx_convenios_pago_cliente_id ON public.convenios_pago(cliente_id);
CREATE INDEX IF NOT EXISTS idx_convenios_pago_company_id ON public.convenios_pago(company_id);
CREATE INDEX IF NOT EXISTS idx_convenios_pago_created_by ON public.convenios_pago(created_by);
CREATE INDEX IF NOT EXISTS idx_convenios_pago_project_id ON public.convenios_pago(project_id);
CREATE INDEX IF NOT EXISTS idx_empresa_pagos_config_company_id ON public.empresa_pagos_config(company_id);
CREATE INDEX IF NOT EXISTS idx_empresa_pagos_config_configured_by ON public.empresa_pagos_config(configured_by);
CREATE INDEX IF NOT EXISTS idx_fuentes_agua_company_id ON public.fuentes_agua(company_id);
CREATE INDEX IF NOT EXISTS idx_pagos_cliente_id ON public.pagos(cliente_id);
CREATE INDEX IF NOT EXISTS idx_pagos_convenio_id ON public.pagos(convenio_id);
CREATE INDEX IF NOT EXISTS idx_pagos_created_by ON public.pagos(created_by);
CREATE INDEX IF NOT EXISTS idx_pagos_project_id ON public.pagos(project_id);
CREATE INDEX IF NOT EXISTS idx_pagos_registro_id ON public.pagos(registro_id);
CREATE INDEX IF NOT EXISTS idx_pagos_verified_by ON public.pagos(verified_by);
CREATE INDEX IF NOT EXISTS idx_password_reset_tokens_user_id ON public.password_reset_tokens(user_id);
CREATE INDEX IF NOT EXISTS idx_payment_requests_registro_id ON public.payment_requests(registro_id);
CREATE INDEX IF NOT EXISTS idx_projects_company_id ON public.projects(company_id);
CREATE INDEX IF NOT EXISTS idx_registros_cliente_id ON public.registros(cliente_id);
CREATE INDEX IF NOT EXISTS idx_registros_contador_id ON public.registros(contador_id);
CREATE INDEX IF NOT EXISTS idx_registros_project_id ON public.registros(project_id);
CREATE INDEX IF NOT EXISTS idx_registros_calidad_company_id ON public.registros_calidad(company_id);
CREATE INDEX IF NOT EXISTS idx_registros_calidad_created_by ON public.registros_calidad(created_by);
CREATE INDEX IF NOT EXISTS idx_registros_calidad_fuente_id ON public.registros_calidad(fuente_id);
CREATE INDEX IF NOT EXISTS idx_rutas_asignado_a ON public.rutas(asignado_a);
CREATE INDEX IF NOT EXISTS idx_tarifas_company_id ON public.tarifas(company_id);
CREATE INDEX IF NOT EXISTS idx_tarifas_project_id ON public.tarifas(project_id);
CREATE INDEX IF NOT EXISTS idx_tarifas_updated_by ON public.tarifas(updated_by);
CREATE INDEX IF NOT EXISTS idx_unidades_cliente_id ON public.unidades(cliente_id);
CREATE INDEX IF NOT EXISTS idx_unidades_company_id ON public.unidades(company_id);
CREATE INDEX IF NOT EXISTS idx_unidades_project_id ON public.unidades(project_id);
CREATE INDEX IF NOT EXISTS idx_unidades_updated_by ON public.unidades(updated_by);
CREATE INDEX IF NOT EXISTS idx_user_project_assignments_project_id ON public.user_project_assignments(project_id);
