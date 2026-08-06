-- Portal propietario vs inquilino — FASE 1: fundación (P1 · condominios).
--
-- Sin cambio de conducta: NO se toca ninguna policy existente. El acceso del
-- residente sigue exactamente igual (unidades.cliente_id = mi cliente). Esta fase
-- solo AGREGA la infraestructura para habilitar, en fases posteriores, múltiples
-- logins por unidad (propietario + inquilino) diferenciados:
--   • Junction `unidad_residentes` (varios residentes por unidad, con rol).
--   • Helper `mis_unidades_ids()` que HOY reproduce la conducta actual y en la
--     fase 3 se extenderá (en UN solo lugar) para incluir `unidad_residentes`.
--   • Backfill: cada unidad con cliente_id → una membresía 'propietario'.
--
-- Validado contra prod vía BEGIN…ROLLBACK (79 memberships, 4 policies, 1 helper).

-- ── 1) Junction unidad ↔ residente ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.unidad_residentes (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  unidad_id uuid NOT NULL REFERENCES public.unidades(id) ON DELETE CASCADE,
  cliente_id uuid NOT NULL REFERENCES public.clientes(id) ON DELETE CASCADE,
  -- company_id/project_id desnormalizados (como en el resto: las policies scopean
  -- el tenant directamente por estas columnas).
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  tipo text NOT NULL DEFAULT 'propietario' CHECK (tipo IN ('propietario','arrendatario','familiar','otro')),
  activo boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT unidad_residentes_unico UNIQUE (unidad_id, cliente_id)
);
CREATE INDEX IF NOT EXISTS idx_unidad_residentes_unidad ON public.unidad_residentes(unidad_id);
CREATE INDEX IF NOT EXISTS idx_unidad_residentes_cliente ON public.unidad_residentes(cliente_id);
CREATE INDEX IF NOT EXISTS idx_unidad_residentes_company ON public.unidad_residentes(company_id);

-- ── 2) RLS: mismo patrón que `unidades` ─────────────────────────────────────
-- SELECT: staff del tenant (owner/admin/operator/viewer) + el residente ve su
-- propia membresía. Escrituras: solo staff (el residente no se auto-asigna).
ALTER TABLE public.unidad_residentes ENABLE ROW LEVEL SECURITY;

CREATE POLICY unidad_residentes_select ON public.unidad_residentes
  FOR SELECT TO authenticated
  USING (
    has_super_admin_access()
    OR has_company_owner_company_access(company_id)
    OR has_admin_project_access(project_id)
    OR has_operator_project_access(project_id)
    OR has_viewer_project_access(project_id)
    OR ((current_user_role() = 'cliente') AND (cliente_id = get_my_cliente_id()))
  );
CREATE POLICY unidad_residentes_insert ON public.unidad_residentes
  FOR INSERT TO authenticated
  WITH CHECK (
    has_super_admin_access() OR has_company_owner_company_access(company_id)
    OR has_admin_project_access(project_id) OR has_operator_project_access(project_id)
  );
CREATE POLICY unidad_residentes_update ON public.unidad_residentes
  FOR UPDATE TO authenticated
  USING (
    has_super_admin_access() OR has_company_owner_company_access(company_id)
    OR has_admin_project_access(project_id) OR has_operator_project_access(project_id)
  )
  WITH CHECK (
    has_super_admin_access() OR has_company_owner_company_access(company_id)
    OR has_admin_project_access(project_id) OR has_operator_project_access(project_id)
  );
CREATE POLICY unidad_residentes_delete ON public.unidad_residentes
  FOR DELETE TO authenticated
  USING (
    has_super_admin_access() OR has_company_owner_company_access(company_id)
    OR has_admin_project_access(project_id) OR has_operator_project_access(project_id)
  );

-- ── 3) Helper de acceso del residente a unidades ────────────────────────────
-- FASE 1: reproduce EXACTAMENTE la conducta actual (unidades.cliente_id = mi
-- cliente). En la fase 3 se extenderá (aquí, en UN solo lugar) para unir también
-- unidad_residentes → habilita propietario + inquilino a la vez. SECURITY DEFINER
-- + auth.uid() (vía get_my_cliente_id): SIEMPRE acotado al llamante.
CREATE OR REPLACE FUNCTION public.mis_unidades_ids()
RETURNS SETOF uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $fn$
  SELECT u.id FROM public.unidades u
  WHERE u.activo = true AND u.cliente_id = public.get_my_cliente_id()
$fn$;
REVOKE ALL ON FUNCTION public.mis_unidades_ids() FROM public, anon;
GRANT EXECUTE ON FUNCTION public.mis_unidades_ids() TO authenticated;

-- ── 4) Backfill (idempotente): unidad con cliente → membresía 'propietario' ──
-- Default 'propietario'; el operador reclasifica inquilinos desde la UI (fase 3).
INSERT INTO public.unidad_residentes (unidad_id, cliente_id, company_id, project_id, tipo, activo)
SELECT u.id, u.cliente_id, u.company_id, u.project_id, 'propietario', u.activo
FROM public.unidades u
WHERE u.cliente_id IS NOT NULL
ON CONFLICT (unidad_id, cliente_id) DO NOTHING;
