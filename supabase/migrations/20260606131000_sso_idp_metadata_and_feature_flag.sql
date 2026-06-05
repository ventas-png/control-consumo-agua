-- ============================================================================
-- T3 · plat:P10 (PR2) — Persistencia de metadata IdP (parqueada) + feature flag
-- `enterprise_sso`. Banda T3 2026-06-06 (este PR usa 131000; PR1 usó 130000).
-- ============================================================================
--
-- POR QUÉ
--   El edge `sso-admin` intenta registrar el proveedor SAML en GoTrue (Admin SSO
--   API). Si SSO NO está habilitado en el proyecto (plan/flag → handshake
--   parqueado), igual debe PERSISTIR la config para no perderla. Aquí se agrega
--   la columna `idp_metadata` (jsonb) a `company_sso_domains` para guardar la
--   metadata subida (URL/XML, entity_id, ACS, attribute mapping) hasta que SSO se
--   habilite y se sincronice el proveedor.
--
--   Además se agrega el feature code `enterprise_sso` al catálogo de planes para
--   gatear la UI admin (useFeatureFlags().has('enterprise_sso')). Se concede al
--   plan `bundle` (premium); ajustarlo por plan es decisión de billing.
--
-- IDEMPOTENTE: ADD COLUMN IF NOT EXISTS, UPDATE condicional sobre jsonb.
-- NO recrea funciones SECURITY DEFINER (las trae PR1).
-- ============================================================================

-- 1. Metadata del IdP (parqueable). jsonb OPACO: la UI admin (owner/admin) la
--    lee/escribe vía el edge; NO contiene secretos (es config pública del IdP).
ALTER TABLE public.company_sso_domains
  ADD COLUMN IF NOT EXISTS idp_metadata jsonb NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN public.company_sso_domains.idp_metadata IS
  'Metadata del IdP SAML subida por el admin (metadata_url/xml, entity_id, acs_url, attribute_mapping). Se persiste aunque SSO no esté habilitado en el proyecto (handshake parqueado); al habilitarse, el edge sso-admin la usa para registrar el proveedor en GoTrue y rellena sso_provider_id. NO contiene secretos (config pública del IdP).';

-- 2. Feature code `enterprise_sso` en el catálogo de planes. Idempotente: solo
--    agrega el code si no está ya en feature_codes (mantiene sync con el catálogo
--    de src/lib/featureFlags.tsx). Se concede al plan `bundle`.
UPDATE public.billing_plans
SET feature_codes = feature_codes || '["enterprise_sso"]'::jsonb
WHERE code = 'bundle'
  AND NOT (feature_codes ? 'enterprise_sso');
