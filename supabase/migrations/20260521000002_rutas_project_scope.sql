-- ============================================================
-- Scope rutas by project (defense in depth)
-- ============================================================
-- rutas only had a company_id, so a non-owner/admin user assigned to a subset
-- of a company's projects could read routes belonging to projects they cannot
-- access. Even with the client now hiding them, the route ROW still leaked via
-- the API (name, assignee email/phone, dates, item counts).
--
-- Add project_id, backfill it from the route's items, and scope rutas_select by
-- per-project access. company_owner/admin/super_admin keep full company access;
-- the assignee always sees their own routes; everyone else only sees routes for
-- projects they can access. Routes whose project_id could not be derived stay
-- NULL and fall back to company scope so they are never hidden from legit users.

ALTER TABLE public.rutas ADD COLUMN IF NOT EXISTS project_id uuid REFERENCES public.projects(id);

-- Backfill from referenced contadores (jsonb array of uuid text)
UPDATE public.rutas r SET project_id = c.project_id
  FROM public.contadores c
  WHERE r.project_id IS NULL
    AND jsonb_typeof(r.contador_ids) = 'array'
    AND EXISTS (
      SELECT 1 FROM jsonb_array_elements_text(r.contador_ids) e(id)
      WHERE e.id = c.id::text
    );

-- Backfill from referenced unidades
UPDATE public.rutas r SET project_id = un.project_id
  FROM public.unidades un
  WHERE r.project_id IS NULL
    AND jsonb_typeof(r.unidad_ids) = 'array'
    AND EXISTS (
      SELECT 1 FROM jsonb_array_elements_text(r.unidad_ids) e(id)
      WHERE e.id = un.id::text
    );

-- Backfill cliente routes from readings (registros.cliente_id -> project_id)
UPDATE public.rutas r SET project_id = reg.project_id
  FROM public.registros reg
  WHERE r.project_id IS NULL
    AND reg.project_id IS NOT NULL
    AND jsonb_typeof(r.cliente_ids) = 'array'
    AND EXISTS (
      SELECT 1 FROM jsonb_array_elements_text(r.cliente_ids) e(id)
      WHERE e.id = reg.cliente_id::text
    );

-- Backfill remaining cliente routes from owned unidades (unidades.cliente_id -> project_id)
UPDATE public.rutas r SET project_id = un.project_id
  FROM public.unidades un
  WHERE r.project_id IS NULL
    AND un.cliente_id IS NOT NULL
    AND jsonb_typeof(r.cliente_ids) = 'array'
    AND EXISTS (
      SELECT 1 FROM jsonb_array_elements_text(r.cliente_ids) e(id)
      WHERE e.id = un.cliente_id::text
    );

CREATE INDEX IF NOT EXISTS idx_rutas_project_id ON public.rutas(project_id);

DROP POLICY IF EXISTS "rutas_select" ON public.rutas;
CREATE POLICY "rutas_select" ON public.rutas
  FOR SELECT TO authenticated
  USING (
    is_super_admin()
    OR asignado_a = (SELECT auth.uid())
    OR (
      company_id = (SELECT get_my_company_id())
      AND (SELECT public.user_has_permission('agua.rutas.view'))
      AND (
        current_user_role() = ANY (ARRAY['company_owner', 'admin'])
        OR project_id IS NULL
        OR public.user_has_project_access(project_id)
      )
    )
  );
