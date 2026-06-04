-- ============================================================================
-- Cobros "elige tu payfac y solo conecta" — PAYFAC PLUGGABLE.
-- Espeja EXACTO el patrón fiscal serv:S11 (20260604220000 + 20260604230000),
-- pero para el PROCESADOR DE PAGOS (payfac) en lugar del certificador (PAC).
-- ============================================================================
-- Banda de migración EXCLUSIVA de este PR: 20260604233000–20260604235959.
--
-- CONTEXTO:
--   Hoy el módulo de cobros tiene Stripe cableado a fuego y PayPal a medias, sin
--   capa pluggable. La facturación FEL ya resolvió "cada empresa elige su PAC y
--   solo conecta credenciales" (interfaz + factory + bóveda + override por
--   locación). Este PR replica ese patrón para que cada EMPRESA/LOCACIÓN elija su
--   PAYFAC (sandbox | stripe | paypal | qpaypro | visanet) y solo conecte:
--     1. Proveedor de pago elegido a nivel EMPRESA (companies.proveedor_pago) con
--        OVERRIDE por LOCACIÓN (projects.proveedor_pago nullable).
--     2. BÓVEDA de credenciales del payfac (tabla `payfac_secrets`), keyed por
--        (company_id, project_id) — project_id NULL = nivel empresa.
--     3. payment_requests acepta los nuevos providers + una referencia genérica.
--
--   STRIPE QUEDA INTACTO: sigue usando company_payment_secrets +
--   create-payment-intent. Esta bóveda es para los payfacs NUEVOS (qpaypro/
--   visanet/…). La unificación de Stripe a esta bóveda es follow-up.
--
-- LOCACIÓN = `projects` (igual que en fiscal): cada empresa tiene varias
--   locaciones (condominios / sistemas de agua) y puede querer cobrar con un
--   payfac distinto por locación (cuenta de comercio distinta), de ahí el override.
--
-- SEMÁNTICA DEL OVERRIDE (la implementa resolverConfigPagoEfectiva en
--   src/lib/businessPagos.ts y su espejo Deno _shared/payments/resolverConfigPago):
--     config_efectiva.proveedor = projects.proveedor_pago ?? companies.proveedor_pago
--   NULL en projects = "hereda de la empresa".
--
-- PATRÓN DE SECRETOS (réplica EXACTA de company_payment_secrets /
--   fiscal_pac_secrets): el SECRETO vive en una tabla SEPARADA con RLS habilitado
--   + policy "deny all" (USING false / WITH CHECK false) → SOLO service_role
--   (que bypassa RLS) lee/escribe. El cliente NUNCA lee `credenciales`: lee el
--   ESTATUS no sensible (proveedor + estado_conexion) vía la RPC payfac_estatus.
--
-- IDEMPOTENTE: ADD COLUMN IF NOT EXISTS, CREATE TABLE/INDEX IF NOT EXISTS,
--   DROP CONSTRAINT/POLICY/TRIGGER IF EXISTS + recreate. Re-ejecutable.
--
-- SEGURIDAD (lección 20260603120000 / 20260604230000): la única función nueva no
--   trigger es la RPC de estatus, SECURITY DEFINER acotada (valida admin/owner del
--   tenant) y devuelve SOLO metadata NO sensible. El trigger updated_at es
--   SECURITY INVOKER y se le revoca EXECUTE a public/anon/authenticated por nombre.
-- ============================================================================

-- ────────────────────────────────────────────────────────────────────────────
-- 1. Proveedor de pago elegido — columnas en companies (empresa) y projects
--    (locación, override). Espeja proveedor_timbrado de la config fiscal.
-- ────────────────────────────────────────────────────────────────────────────

-- Payfac a nivel EMPRESA. NOT NULL DEFAULT 'sandbox' (igual que companies.
-- proveedor_timbrado): out-of-the-box todo cae al SandboxPaymentProvider (cobro
-- simulado determinista) hasta que el dueño elija un payfac real y conecte.
ALTER TABLE public.companies
  ADD COLUMN IF NOT EXISTS proveedor_pago text NOT NULL DEFAULT 'sandbox';

-- Payfac a nivel LOCACIÓN. NULL = hereda companies.proveedor_pago. Texto libre
-- (resuelto por getPaymentProvider). Override por locación con cuenta propia.
ALTER TABLE public.projects
  ADD COLUMN IF NOT EXISTS proveedor_pago text;

COMMENT ON COLUMN public.companies.proveedor_pago IS
  'Payfac elegido por la empresa (cobros pluggable). sandbox|stripe|paypal|qpaypro|visanet. Default ''sandbox'' (cobro simulado). Las CREDENCIALES NO van aquí: van en payfac_secrets (service-role-only). Lo resuelve getPaymentProvider.';
COMMENT ON COLUMN public.projects.proveedor_pago IS
  'Override del payfac por locación (cobros pluggable). NULL = hereda companies.proveedor_pago. Lo resuelve resolverConfigPagoEfectiva.';

-- ────────────────────────────────────────────────────────────────────────────
-- 2. payment_requests: aceptar los nuevos providers + referencia genérica.
--    Stripe/PayPal conservan sus columnas dedicadas (stripe_payment_intent /
--    paypal_order_id); los payfacs nuevos usan `provider_ref` (id de transacción
--    del payfac, ej. el x_trans_id de QPayPro).
-- ────────────────────────────────────────────────────────────────────────────

-- Relaja el CHECK de provider para incluir sandbox/qpaypro/visanet (antes solo
-- stripe/paypal/manual). DROP + ADD idempotente.
ALTER TABLE public.payment_requests
  DROP CONSTRAINT IF EXISTS payment_requests_provider_check;
ALTER TABLE public.payment_requests
  ADD CONSTRAINT payment_requests_provider_check
  CHECK (provider IN ('stripe', 'paypal', 'manual', 'sandbox', 'qpaypro', 'visanet'));

-- Referencia genérica del payfac (id de transacción/checkout del proveedor) para
-- los providers que no tienen columna dedicada. NULL para stripe/paypal (usan la
-- suya) o mientras el cobro no devolvió referencia.
ALTER TABLE public.payment_requests
  ADD COLUMN IF NOT EXISTS provider_ref text;

COMMENT ON COLUMN public.payment_requests.provider_ref IS
  'Referencia de transacción del payfac genérico (qpaypro/visanet/sandbox), ej. x_trans_id de QPayPro. Stripe/PayPal usan stripe_payment_intent/paypal_order_id. NULL hasta que el proveedor devuelva referencia.';

-- Unicidad por (provider, provider_ref) cuando hay referencia: evita procesar dos
-- veces la misma transacción del payfac (idempotencia de la confirmación).
CREATE UNIQUE INDEX IF NOT EXISTS uq_payment_requests_provider_ref
  ON public.payment_requests (provider, provider_ref)
  WHERE provider_ref IS NOT NULL;

-- ────────────────────────────────────────────────────────────────────────────
-- 3. BÓVEDA de credenciales del payfac — tabla `payfac_secrets`.
--    Patrón EXACTO de company_payment_secrets / fiscal_pac_secrets: RLS + policy
--    "deny all" → SOLO service_role accede. Keyed por (company_id, project_id
--    NULL=nivel empresa) para credenciales compartidas + override por locación.
-- ────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.payfac_secrets (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Tenant dueño de las credenciales. ON DELETE CASCADE.
  company_id      uuid        NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,

  -- Locación de las credenciales. NULL = NIVEL EMPRESA (compartidas por las
  -- locaciones que no tengan las suyas). ON DELETE CASCADE.
  project_id      uuid        REFERENCES public.projects(id) ON DELETE CASCADE,

  -- Payfac al que pertenecen estas credenciales (ej. 'sandbox', 'qpaypro',
  -- 'visanet', 'stripe', 'paypal'). Snapshot informativo; el proveedor efectivo
  -- lo decide la config de pago (proveedor_pago).
  proveedor       text        NOT NULL DEFAULT 'sandbox',

  -- Credenciales del payfac, separadas por ambiente. jsonb OPACO para el resto
  -- del sistema: SOLO el adapter (service_role, en el edge) lo lee. Forma:
  --   { "sandbox": { ... }, "prod": { ... } }
  -- QPayPro p. ej.: { "x_login": "...", "x_api_key": "...", "x_private_key": "...",
  --                   "x_api_secret": "..." }. NUNCA se proyecta al cliente.
  credenciales    jsonb       NOT NULL DEFAULT '{}'::jsonb,

  -- Resultado del último "probar conexión" (lo escribe payfac-test-connection).
  -- Metadata NO sensible: SÍ se expone al cliente (vía la RPC payfac_estatus).
  estado_conexion text        NOT NULL DEFAULT 'desconocido'
                              CHECK (estado_conexion IN ('desconocido', 'ok', 'error')),
  estado_mensaje  text,
  estado_probado_en timestamptz,

  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

-- UNA fila por locación (y una por empresa con project_id IS NULL). NULLS NOT
-- DISTINCT trata el NULL de empresa como un único valor; target del ON CONFLICT.
CREATE UNIQUE INDEX IF NOT EXISTS uq_payfac_secrets_company_project
  ON public.payfac_secrets (company_id, project_id) NULLS NOT DISTINCT;

CREATE INDEX IF NOT EXISTS idx_payfac_secrets_company_id
  ON public.payfac_secrets (company_id);

-- updated_at automático. SECURITY INVOKER (no DEFINER): no escala privilegios.
CREATE OR REPLACE FUNCTION public.set_payfac_secrets_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

-- Revoca EXECUTE a public/anon/authenticated por nombre (lección 20260603120000).
REVOKE EXECUTE ON FUNCTION public.set_payfac_secrets_updated_at()
  FROM public, anon, authenticated;

DROP TRIGGER IF EXISTS trg_payfac_secrets_updated_at ON public.payfac_secrets;
CREATE TRIGGER trg_payfac_secrets_updated_at
  BEFORE UPDATE ON public.payfac_secrets
  FOR EACH ROW EXECUTE FUNCTION public.set_payfac_secrets_updated_at();

-- RLS + policy "deny all" = SOLO service_role accede (idéntico a
-- company_payment_secrets / fiscal_pac_secrets). El cliente NUNCA lee/escribe
-- esta tabla; lo hacen las edge functions con service_role.
ALTER TABLE public.payfac_secrets ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Deny access to all" ON public.payfac_secrets;
CREATE POLICY "Deny access to all" ON public.payfac_secrets
  USING (false)
  WITH CHECK (false);

COMMENT ON POLICY "Deny access to all" ON public.payfac_secrets IS
  'Deny all access except service_role. Esta tabla contiene credenciales del payfac y solo debe accederse desde Edge Functions con service_role key (patrón company_payment_secrets / fiscal_pac_secrets).';

COMMENT ON TABLE public.payfac_secrets IS
  'Bóveda de credenciales del payfac (cobros pluggable; espeja fiscal_pac_secrets). Keyed por (company_id, project_id NULL=nivel empresa). RLS service-role-only (policy "Deny access to all"): el cliente NUNCA lee `credenciales`. La escritura y el "probar conexión" los hacen edge functions (payfac-save-credentials / payfac-test-connection / create-charge) con service_role. El estatus NO sensible (proveedor + estado_conexion) se expone vía la RPC payfac_estatus.';
COMMENT ON COLUMN public.payfac_secrets.project_id IS
  'Locación de las credenciales. NULL = nivel empresa (compartidas). Espeja el override del payfac por locación.';
COMMENT ON COLUMN public.payfac_secrets.credenciales IS
  'Credenciales del payfac por ambiente { sandbox, prod }. jsonb OPACO: SOLO el adapter (service_role) lo lee. NUNCA se proyecta al cliente.';
COMMENT ON COLUMN public.payfac_secrets.estado_conexion IS
  'Resultado del último "probar conexión": desconocido|ok|error. Metadata NO sensible (expuesta vía la RPC payfac_estatus).';

-- ────────────────────────────────────────────────────────────────────────────
-- 4. RPC de ESTATUS por tenant (SECURITY DEFINER acotado).
--    payfac_secrets es deny-all bajo RLS, así que exponemos el ESTATUS NO
--    sensible vía una RPC SECURITY DEFINER que valida admin/owner del tenant (o
--    super_admin) y devuelve SOLO metadata (proveedor + estado_conexion + flags),
--    NUNCA `credenciales`. Espeja fiscal_pac_estatus.
-- ────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.payfac_estatus(p_company_id uuid)
RETURNS TABLE (
  id                uuid,
  company_id        uuid,
  project_id        uuid,
  proveedor         text,
  estado_conexion   text,
  estado_mensaje    text,
  estado_probado_en timestamptz,
  tiene_sandbox     boolean,
  tiene_prod        boolean,
  created_at        timestamptz,
  updated_at        timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  -- Autorización: super_admin ve cualquier tenant; admin/owner solo el suyo.
  IF NOT (
    public.is_super_admin()
    OR (
      p_company_id = public.get_my_company_id()
      AND public.current_user_role() IN ('company_owner', 'admin')
    )
  ) THEN
    RAISE EXCEPTION 'No autorizado para consultar el estatus de payfac de este tenant';
  END IF;

  RETURN QUERY
  SELECT
    s.id, s.company_id, s.project_id, s.proveedor,
    s.estado_conexion, s.estado_mensaje, s.estado_probado_en,
    (s.credenciales ? 'sandbox') AS tiene_sandbox,
    (s.credenciales ? 'prod')    AS tiene_prod,
    s.created_at, s.updated_at
  FROM public.payfac_secrets s
  WHERE s.company_id = p_company_id;
END;
$$;

-- SECURITY DEFINER → cerrar el RPC a roles no esperados por nombre y conceder
-- solo a authenticated (la propia función valida rol) + service_role.
REVOKE EXECUTE ON FUNCTION public.payfac_estatus(uuid)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.payfac_estatus(uuid)
  TO authenticated, service_role;

COMMENT ON FUNCTION public.payfac_estatus(uuid) IS
  'Estatus NO sensible de credenciales del payfac por tenant (cobros pluggable). SECURITY DEFINER acotado: valida admin/owner del tenant (o super_admin) y devuelve SOLO metadata (proveedor + estado_conexion + flags tiene_sandbox/tiene_prod), NUNCA el jsonb `credenciales`. Espeja fiscal_pac_estatus.';
