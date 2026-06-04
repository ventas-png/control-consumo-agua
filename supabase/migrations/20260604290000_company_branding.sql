-- ============================================================================
-- Branding / white-label por empresa (T3 Plataforma · plat:P20/P28)
-- ============================================================================
-- Banda de migración P20: 20260604290000.
--
-- El plan ya expone el feature flag `white_label` (20260602000000), y companies
-- ya guarda `logo_url`, pero faltaba dónde guardar el COLOR de marca del tenant y
-- aplicarlo. Esta tabla guarda el color primario de marca por empresa; la app lo
-- usa para temizar (override de --at-primary). La aplicación app-wide del tema es
-- incremental (follow-up: hook en el shell autenticado); este PR aterriza el
-- almacenamiento + el helper de color + la UI de configuración con vista previa.
--
-- Tabla aislada (no toca companies ni su RLS): lectura para cualquier miembro de
-- la empresa (necesario para temizar), escritura solo owner/admin (o super_admin).
-- Sin RPC. Idempotente.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.company_branding (
  company_id    uuid PRIMARY KEY REFERENCES public.companies(id) ON DELETE CASCADE,
  -- Color primario de marca (hex #RRGGBB). NULL = usar el tema por defecto.
  primary_color text CHECK (primary_color IS NULL OR primary_color ~ '^#[0-9A-Fa-f]{6}$'),
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.company_branding IS
  'plat:P20 — branding/white-label por empresa (color de marca). Lectura para miembros del tenant (temizado); escritura owner/admin. RLS por company.';

ALTER TABLE public.company_branding ENABLE ROW LEVEL SECURITY;

-- SELECT: cualquier miembro de la empresa (para temizar la app) + super_admin.
DROP POLICY IF EXISTS "company_branding_select" ON public.company_branding;
CREATE POLICY "company_branding_select" ON public.company_branding
  FOR SELECT TO authenticated
  USING (is_super_admin() OR company_id = get_my_company_id());

-- INSERT/UPDATE: owner/admin del propio tenant (o super_admin). DELETE no se
-- expone (poner primary_color = NULL restablece el tema por defecto).
DROP POLICY IF EXISTS "company_branding_insert" ON public.company_branding;
CREATE POLICY "company_branding_insert" ON public.company_branding
  FOR INSERT TO authenticated
  WITH CHECK (
    is_super_admin()
    OR (company_id = get_my_company_id() AND current_user_role() = ANY(ARRAY['company_owner', 'admin']))
  );

DROP POLICY IF EXISTS "company_branding_update" ON public.company_branding;
CREATE POLICY "company_branding_update" ON public.company_branding
  FOR UPDATE TO authenticated
  USING (
    is_super_admin()
    OR (company_id = get_my_company_id() AND current_user_role() = ANY(ARRAY['company_owner', 'admin']))
  )
  WITH CHECK (
    is_super_admin()
    OR (company_id = get_my_company_id() AND current_user_role() = ANY(ARRAY['company_owner', 'admin']))
  );

-- updated_at automático en cada UPDATE.
CREATE OR REPLACE FUNCTION public.touch_company_branding_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.touch_company_branding_updated_at() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.touch_company_branding_updated_at() TO service_role;

DROP TRIGGER IF EXISTS company_branding_touch ON public.company_branding;
CREATE TRIGGER company_branding_touch
  BEFORE UPDATE ON public.company_branding
  FOR EACH ROW
  EXECUTE FUNCTION public.touch_company_branding_updated_at();
