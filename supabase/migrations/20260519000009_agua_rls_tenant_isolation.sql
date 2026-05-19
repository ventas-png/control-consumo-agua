-- ============================================================
-- Fix: tenant isolation + RBAC gating for agua tables
-- ============================================================
-- Closes two cross-tenant leaks and removes over-permissive viewer/visor
-- access to agua data:
--   * registros_select had an UNSCOPED role allowlist
--     (admin/operator/operador/user/viewer/visor) -> any such user could
--     read EVERY company's readings (consumo, montos, pago, GPS, notas).
--   * rutas_* policies were `authenticated` only (rutas has no tenant key)
--     -> any logged-in user could read/insert/update EVERY company's routes
--     (incl. assignee email/phone PII).
--   * fuentes_agua / registros_calidad granted viewer/visor by legacy role.
--
-- New policies scope by company and gate staff access on the relevant
-- agua.* RBAC permission. user_has_permission() auto-grants
-- super_admin/company_owner/admin, so they keep full company access; roles
-- without the permission (e.g. "Visualizador Plataforma") lose agua data.

-- ---------- registros ----------
DROP POLICY IF EXISTS "registros_select" ON public.registros;
CREATE POLICY "registros_select" ON public.registros
  FOR SELECT TO authenticated
  USING (
    is_super_admin()
    OR (
      (
        (SELECT public.user_has_permission('agua.tabla.view'))
        OR (SELECT public.user_has_permission('agua.lecturas.view'))
        OR (SELECT public.user_has_permission('agua.dashboard.view'))
        OR (SELECT public.user_has_permission('agua.cobros.view'))
        OR (SELECT public.user_has_permission('agua.mapa.view'))
      )
      AND (SELECT get_my_company_id()) IS NOT NULL
      AND (
        project_id IN (
          SELECT p.id FROM public.projects p
          WHERE p.company_id = (SELECT get_my_company_id())
        )
        OR (project_id IS NULL AND cliente_id IN (
          SELECT cc.cliente_id FROM public.company_clientes cc
          WHERE cc.company_id = (SELECT get_my_company_id())
        ))
      )
    )
    OR (current_user_role() = 'cliente' AND cliente_id = (SELECT get_my_cliente_id()))
    OR (current_user_role() = 'cliente' AND contador_id IN (
      SELECT c.id FROM public.contadores c
      JOIN public.unidades u ON u.id = c.unidad_id
      WHERE u.cliente_id = (SELECT get_my_cliente_id()) AND c.activo = true AND u.activo = true
    ))
  );

-- ---------- fuentes_agua ----------
DROP POLICY IF EXISTS "fuentes_agua_select" ON public.fuentes_agua;
CREATE POLICY "fuentes_agua_select" ON public.fuentes_agua
  FOR SELECT TO authenticated
  USING (
    is_super_admin()
    OR (company_id = (SELECT get_my_company_id())
        AND (SELECT public.user_has_permission('agua.calidad.view')))
  );

-- ---------- registros_calidad ----------
DROP POLICY IF EXISTS "registros_calidad_select" ON public.registros_calidad;
CREATE POLICY "registros_calidad_select" ON public.registros_calidad
  FOR SELECT TO authenticated
  USING (
    is_super_admin()
    OR (company_id = (SELECT get_my_company_id())
        AND (SELECT public.user_has_permission('agua.calidad.view')))
  );

-- ---------- rutas: add tenant key, backfill, trigger, scoped policies ----------
ALTER TABLE public.rutas ADD COLUMN IF NOT EXISTS company_id uuid REFERENCES public.companies(id);

-- backfill from the assigned reader's company
UPDATE public.rutas r SET company_id = u.company_id
  FROM public.app_users u
  WHERE r.company_id IS NULL AND u.id = r.asignado_a;

-- backfill remaining from referenced contadores (jsonb array of uuid text)
UPDATE public.rutas r SET company_id = c.company_id
  FROM public.contadores c
  WHERE r.company_id IS NULL
    AND jsonb_typeof(r.contador_ids) = 'array'
    AND EXISTS (
      SELECT 1 FROM jsonb_array_elements_text(r.contador_ids) e(id)
      WHERE e.id = c.id::text
    );

-- backfill remaining from referenced unidades
UPDATE public.rutas r SET company_id = un.company_id
  FROM public.unidades un
  WHERE r.company_id IS NULL
    AND jsonb_typeof(r.unidad_ids) = 'array'
    AND EXISTS (
      SELECT 1 FROM jsonb_array_elements_text(r.unidad_ids) e(id)
      WHERE e.id = un.id::text
    );

-- backfill remaining from referenced clientes (via company_clientes link)
UPDATE public.rutas r SET company_id = cc.company_id
  FROM public.company_clientes cc
  WHERE r.company_id IS NULL
    AND jsonb_typeof(r.cliente_ids) = 'array'
    AND EXISTS (
      SELECT 1 FROM jsonb_array_elements_text(r.cliente_ids) e(id)
      WHERE e.id = cc.cliente_id::text
    );

-- auto-populate company_id on insert from the creator's company so the
-- frontend does not need to set it explicitly
CREATE OR REPLACE FUNCTION public.set_rutas_company_id()
  RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF NEW.company_id IS NULL THEN
    NEW.company_id := get_my_company_id();
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_rutas_company_id ON public.rutas;
CREATE TRIGGER trg_rutas_company_id BEFORE INSERT ON public.rutas
  FOR EACH ROW EXECUTE FUNCTION public.set_rutas_company_id();

CREATE INDEX IF NOT EXISTS idx_rutas_company_id ON public.rutas(company_id);

DROP POLICY IF EXISTS "rutas_select" ON public.rutas;
CREATE POLICY "rutas_select" ON public.rutas
  FOR SELECT TO authenticated
  USING (
    is_super_admin()
    OR asignado_a = (SELECT auth.uid())
    OR (company_id = (SELECT get_my_company_id())
        AND (SELECT public.user_has_permission('agua.rutas.view')))
  );

-- writes: scope to the user's company (closes cross-tenant writes); the
-- trigger fills company_id on insert. Delete stays admin/owner only.
DROP POLICY IF EXISTS "rutas_insert" ON public.rutas;
CREATE POLICY "rutas_insert" ON public.rutas
  FOR INSERT TO authenticated
  WITH CHECK (is_super_admin() OR company_id = (SELECT get_my_company_id()));

DROP POLICY IF EXISTS "rutas_update" ON public.rutas;
CREATE POLICY "rutas_update" ON public.rutas
  FOR UPDATE TO authenticated
  USING (is_super_admin() OR company_id = (SELECT get_my_company_id()))
  WITH CHECK (is_super_admin() OR company_id = (SELECT get_my_company_id()));

DROP POLICY IF EXISTS "rutas_delete" ON public.rutas;
CREATE POLICY "rutas_delete" ON public.rutas
  FOR DELETE TO authenticated
  USING (
    is_super_admin()
    OR (company_id = (SELECT get_my_company_id())
        AND current_user_role() = ANY (ARRAY['admin', 'company_owner']))
  );
