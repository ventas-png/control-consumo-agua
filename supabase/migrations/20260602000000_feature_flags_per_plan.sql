-- ============================================================================
-- Feature flags por plan (plat:P36)
-- ============================================================================
-- Habilita gating de funcionalidades por plan de suscripcion. Antes el control
-- era binario (servicio_agua / servicio_condominios) — ahora cada plan declara
-- explicitamente que features programaticas incluye.
--
-- **Diferencia con billing_plans.features** (jsonb existente):
--   - `features`       → strings de marketing ("Lecturas en vivo", "Reportes")
--   - `feature_codes`  → identificadores programaticos ("asambleas_digitales",
--                        "transparencia_financiera", "cobranza_judicial")
--
-- **Helper SQL**: `company_has_feature(p_company_id uuid, p_feature_code text)`
-- — SECURITY DEFINER. Mira la subscription activa de la company y devuelve
-- TRUE si el plan incluye el feature_code. Llamable desde RLS policies y RPC.
--
-- **Catalogo inicial** de feature codes:
--   - asambleas_digitales       — Asambleas/votaciones digitales (condominios)
--   - transparencia_financiera  — Portal financiero para residentes (condos)
--   - cobranza_judicial         — Modulo de cobranza judicial (agua + condos)
--   - analisis_cartera          — Analytics avanzados de cartera
--   - automation                — Automatizaciones / workflows
--   - api_access                — API publica
--   - white_label               — White-label / branding custom
--   - multi_proyecto            — Mas de 1 proyecto activo
--   - exportacion_avanzada      — Export PDF/XLSX/CSV con templates custom
--
-- **Asignacion inicial**:
--   - agua_only:        cobranza_judicial, analisis_cartera, exportacion_avanzada
--   - condominios_only: asambleas_digitales, transparencia_financiera,
--                       cobranza_judicial, exportacion_avanzada
--   - bundle:           todas las anteriores + multi_proyecto
--
-- Enterprise/Pro tiers (automation, api_access, white_label) quedan reservados
-- — se asignan via UPDATE manual cuando el tenant negocia el plan custom.
-- ============================================================================

-- ────────────────────────────────────────────────────────────────────────────
-- 1. Columna feature_codes en billing_plans
-- ────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.billing_plans
  ADD COLUMN IF NOT EXISTS feature_codes jsonb NOT NULL DEFAULT '[]'::jsonb;

COMMENT ON COLUMN public.billing_plans.feature_codes IS
  'Array de codigos programaticos de features incluidas en el plan. Distinto de `features` (marketing strings). Consultable via company_has_feature(company_id, feature_code).';

-- ────────────────────────────────────────────────────────────────────────────
-- 2. Helper function company_has_feature
-- ────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.company_has_feature(
  p_company_id uuid,
  p_feature_code text
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.subscriptions s
    JOIN public.billing_plans p ON p.id = s.plan_id
    WHERE s.company_id = p_company_id
      AND s.status IN ('trialing', 'active', 'past_due')
      AND p.feature_codes ? p_feature_code
  );
$$;

REVOKE EXECUTE ON FUNCTION public.company_has_feature(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.company_has_feature(uuid, text) TO authenticated;

COMMENT ON FUNCTION public.company_has_feature IS
  'Devuelve TRUE si la subscription activa de la company incluye el feature code. SECURITY DEFINER permite usarlo desde RLS sin exponer billing_plans/subscriptions.';

-- ────────────────────────────────────────────────────────────────────────────
-- 3. Vista para frontend: my_feature_flags
-- ────────────────────────────────────────────────────────────────────────────
-- El frontend carga TODAS las features del usuario actual en una sola query.
-- La vista respeta RLS (SECURITY INVOKER) pero el usuario solo ve sus propias
-- features porque la subquery filtra por get_my_company_id().
CREATE OR REPLACE VIEW public.my_feature_flags
WITH (security_invoker = true)
AS
SELECT
  jsonb_array_elements_text(p.feature_codes) AS feature_code,
  p.code   AS plan_code,
  p.name   AS plan_name,
  s.status AS subscription_status,
  s.current_period_end
FROM public.subscriptions s
JOIN public.billing_plans p ON p.id = s.plan_id
WHERE s.company_id = public.get_my_company_id()
  AND s.status IN ('trialing', 'active', 'past_due');

COMMENT ON VIEW public.my_feature_flags IS
  'Features programaticas del usuario actual via su company subscription. Carga unica para hook React useFeatureFlags.';

GRANT SELECT ON public.my_feature_flags TO authenticated;

-- ────────────────────────────────────────────────────────────────────────────
-- 4. Seed feature_codes en planes existentes
-- ────────────────────────────────────────────────────────────────────────────
UPDATE public.billing_plans
SET feature_codes = '[
  "cobranza_judicial",
  "analisis_cartera",
  "exportacion_avanzada"
]'::jsonb
WHERE code = 'agua_only';

UPDATE public.billing_plans
SET feature_codes = '[
  "asambleas_digitales",
  "transparencia_financiera",
  "cobranza_judicial",
  "exportacion_avanzada"
]'::jsonb
WHERE code = 'condominios_only';

UPDATE public.billing_plans
SET feature_codes = '[
  "asambleas_digitales",
  "transparencia_financiera",
  "cobranza_judicial",
  "analisis_cartera",
  "exportacion_avanzada",
  "multi_proyecto"
]'::jsonb
WHERE code = 'bundle';
