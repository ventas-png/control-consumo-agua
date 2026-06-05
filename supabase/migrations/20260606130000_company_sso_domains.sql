-- ============================================================================
-- T3 · plat:P10 — SSO/SAML enterprise: modelo de datos + lookup seguro PRE-login.
-- Banda de migración EXCLUSIVA de este PR (T3): 20260606130000–20260606135959.
-- ============================================================================
--
-- CONTEXTO
--   Cierre del Track T3 (Plataforma, épica #302). Lo único pendiente era
--   SSO/SAML (P10). Igual que el adapter PAC quedó parqueado en #391 (núcleo
--   listo, handshake real bloqueado por decisión externa), aquí se construye TODO
--   el andamiaje app-level y se PARQUEA solo el handshake real, que depende de
--   habilitar SSO a nivel proyecto Supabase (plan Pro + GOTRUE_SAML_ENABLED +
--   clave de firma + registro de proveedor por GoTrue Admin SSO API).
--
-- QUÉ HACE ESTA MIGRACIÓN
--   1. `company_sso_domains`: mapeo dominio→empresa para SSO, con verificación de
--      propiedad del dominio (token + gate) para evitar que el tenant A secuestre
--      el SSO del dominio del tenant B.
--   2. RLS: SOLO owner/admin de ESA empresa lee/escribe SUS filas; anon y otros
--      tenants ven 0 filas (RLS es la defensa primaria; el edge sso-admin será el
--      escritor canónico desde el front, pero la tabla NO es deny-all porque la UI
--      admin necesita LEER el estado de sus propios dominios directamente).
--   3. GATE de verificación: `enforced` NO puede ser true si `verified=false`
--      (CHECK). El chequeo DNS/email real es follow-up; el GATE existe ya para que
--      nadie pueda FORZAR SSO sobre un dominio sin probar su propiedad.
--   4. RPC `sso_lookup_domain(p_domain)` — EXCEPCIÓN INTENCIONAL anon-callable
--      (se llama PRE-login, sin sesión). SECURITY DEFINER, devuelve SOLO lo
--      mínimo (¿este dominio usa SSO? ¿está forzado? provider hint) y NUNCA
--      identidad/datos del tenant. A diferencia del default del repo (revocar a
--      anon/authenticated), esta SÍ se concede a anon a propósito (documentado).
--
-- SEGURIDAD (lección 20260603120000 / #380): toda función SECURITY DEFINER →
--   REVOKE EXECUTE FROM PUBLIC, anon, authenticated POR NOMBRE + GRANT service_role.
--   ÚNICA excepción justificada: sso_lookup_domain (anon-callable a propósito,
--   salida mínima/segura). El trigger updated_at es SECURITY INVOKER y se le
--   revoca EXECUTE a public/anon/authenticated por nombre.
--
-- IDEMPOTENTE: CREATE EXTENSION/TABLE/INDEX IF NOT EXISTS, DROP POLICY/TRIGGER
--   IF EXISTS + recreate, CREATE OR REPLACE FUNCTION. Re-ejecutable.
-- ============================================================================

-- citext: dominios case-insensitive (Example.COM = example.com) con unicidad
-- nativa. Se instala en el schema `extensions` (convención 20260318000001).
CREATE EXTENSION IF NOT EXISTS citext WITH SCHEMA extensions;

-- ────────────────────────────────────────────────────────────────────────────
-- 1. Tabla company_sso_domains — mapeo dominio→empresa para SSO enterprise.
-- ────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.company_sso_domains (
  id                 uuid           PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Tenant dueño del dominio. ON DELETE CASCADE.
  company_id         uuid           NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,

  -- Dominio de correo asociado (ej. 'acme.com'). citext = unicidad GLOBAL
  -- case-insensitive: un dominio pertenece a UNA sola empresa en toda la
  -- plataforma (impide que dos tenants reclamen el mismo dominio).
  domain             extensions.citext NOT NULL UNIQUE,

  -- ID del proveedor SAML registrado en GoTrue (Admin SSO API), cuando SSO esté
  -- habilitado en el proyecto. NULL = aún no sincronizado (handshake parqueado).
  sso_provider_id    text,

  -- ¿Se probó la propiedad del dominio? Gate de `enforced`. El chequeo DNS/email
  -- real es follow-up; este flag + el token dejan el gate listo.
  verified           boolean        NOT NULL DEFAULT false,

  -- Token de verificación (ej. para registro TXT DNS `_admtdo-sso.<domain>` o
  -- correo de confirmación). Random por defecto. NO es secreto sensible.
  verification_token text           NOT NULL DEFAULT encode(extensions.gen_random_bytes(16), 'hex'),

  -- ¿SSO OBLIGATORIO para este dominio? Si true, el login oculta el password.
  -- GATE: solo puede ser true si verified=true (CHECK abajo) → sin secuestro.
  enforced           boolean        NOT NULL DEFAULT false,

  created_at         timestamptz    NOT NULL DEFAULT now(),
  updated_at         timestamptz    NOT NULL DEFAULT now(),

  -- GATE anti-secuestro: no se puede FORZAR SSO sobre un dominio no verificado.
  CONSTRAINT company_sso_domains_enforced_requires_verified
    CHECK (NOT enforced OR verified)
);

CREATE INDEX IF NOT EXISTS idx_company_sso_domains_company_id
  ON public.company_sso_domains (company_id);

COMMENT ON TABLE public.company_sso_domains IS
  'Mapeo dominio→empresa para SSO/SAML enterprise (plat:P10). RLS: SOLO owner/admin de ESA empresa lee/escribe sus filas. `domain` es UNIQUE global (un dominio = una empresa). `enforced` requiere `verified` (CHECK) para impedir secuestro cross-tenant del SSO. El registro del proveedor SAML en GoTrue (sso_provider_id) se sincroniza vía el edge sso-admin cuando SSO esté habilitado en el proyecto; si no, queda NULL (handshake parqueado, ver issue de cierre P10).';
COMMENT ON COLUMN public.company_sso_domains.domain IS
  'Dominio de correo (citext, case-insensitive). UNIQUE global: un dominio pertenece a una sola empresa.';
COMMENT ON COLUMN public.company_sso_domains.sso_provider_id IS
  'ID del proveedor SAML en GoTrue (Admin SSO API). NULL hasta sincronizar (requiere SSO habilitado en el proyecto). Se usa como hint en signInWithSSO.';
COMMENT ON COLUMN public.company_sso_domains.verified IS
  'Propiedad del dominio probada. Gate de `enforced`. El chequeo DNS/email real es follow-up; el flag + verification_token dejan el gate listo.';
COMMENT ON COLUMN public.company_sso_domains.enforced IS
  'SSO obligatorio para el dominio (el login oculta password). CHECK: solo true si verified=true → sin secuestro de dominio ajeno.';

-- ────────────────────────────────────────────────────────────────────────────
-- 2. updated_at automático. SECURITY INVOKER (no DEFINER): no escala privilegios.
-- ────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.set_company_sso_domains_updated_at()
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
REVOKE EXECUTE ON FUNCTION public.set_company_sso_domains_updated_at()
  FROM public, anon, authenticated;

DROP TRIGGER IF EXISTS trg_company_sso_domains_updated_at ON public.company_sso_domains;
CREATE TRIGGER trg_company_sso_domains_updated_at
  BEFORE UPDATE ON public.company_sso_domains
  FOR EACH ROW EXECUTE FUNCTION public.set_company_sso_domains_updated_at();

-- ────────────────────────────────────────────────────────────────────────────
-- 3. RLS — SOLO owner/admin de ESA empresa. anon y otros tenants = 0 filas.
--    Espeja las policies de app_users (current_user_role() + get_my_company_id(),
--    ambas SECURITY DEFINER → sin recursión de RLS).
-- ────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.company_sso_domains ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "SSO domains: owner/admin of own company" ON public.company_sso_domains;
CREATE POLICY "SSO domains: owner/admin of own company" ON public.company_sso_domains
  FOR ALL
  USING (
    company_id = public.get_my_company_id()
    AND public.current_user_role() = ANY (ARRAY['admin', 'super_admin', 'superadmin', 'company_owner'])
  )
  WITH CHECK (
    company_id = public.get_my_company_id()
    AND public.current_user_role() = ANY (ARRAY['admin', 'super_admin', 'superadmin', 'company_owner'])
  );

COMMENT ON POLICY "SSO domains: owner/admin of own company" ON public.company_sso_domains IS
  'SOLO owner/admin de ESA empresa lee/escribe sus filas (company_id = get_my_company_id()). anon y otros tenants = 0 filas. WITH CHECK impide insertar/mover una fila a otra empresa. El descubrimiento PRE-login (sin sesión) NO usa esta policy: usa la RPC sso_lookup_domain (SECURITY DEFINER, anon-callable, salida mínima).';

-- ────────────────────────────────────────────────────────────────────────────
-- 4. RPC sso_lookup_domain — EXCEPCIÓN INTENCIONAL anon-callable (PRE-login).
--    company_sso_domains está bajo RLS (un anónimo ve 0 filas), pero el login
--    necesita saber ANTES de autenticar si un dominio usa SSO para ofrecer/forzar
--    el botón "Continuar con SSO". Esta RPC SECURITY DEFINER expone SOLO lo
--    mínimo y seguro: ¿hay SSO disponible para el dominio? ¿está forzado? y el
--    provider hint que GoTrue ya expone públicamente (necesario para
--    signInWithSSO). NUNCA filtra company_id, nombre del tenant ni datos.
--
--    SOLO se considera "disponible" cuando verified=true (un dominio sin probar
--    propiedad NO se anuncia). enforced ya implica verified por el CHECK.
--
--    RATE-LIMIT: por ser anon-callable y llamarse al teclear el email, el rate
--    limit por IP debe aplicarse en la capa de borde/gateway (no hay IP dentro de
--    Postgres). La función es barata (lookup por índice UNIQUE de `domain`).
-- ────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.sso_lookup_domain(p_domain text)
RETURNS TABLE (
  sso_available boolean,
  enforced      boolean,
  provider_id   text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_domain extensions.citext;
BEGIN
  -- Normaliza: recorta y descarta vacío/NULL (devuelve 0 filas → "sin SSO").
  v_domain := NULLIF(btrim(coalesce(p_domain, '')), '')::extensions.citext;
  IF v_domain IS NULL THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT
    true                AS sso_available,
    d.enforced          AS enforced,
    d.sso_provider_id   AS provider_id
  FROM public.company_sso_domains d
  WHERE d.domain = v_domain
    AND d.verified = true   -- solo dominios con propiedad probada se anuncian
  LIMIT 1;
END;
$$;

-- EXCEPCIÓN documentada: a diferencia del default del repo, esta RPC SÍ se
-- concede a anon (y authenticated) porque se invoca PRE-login. Su salida es
-- mínima y no sensible. Se revoca a PUBLIC para conceder explícitamente por rol.
REVOKE EXECUTE ON FUNCTION public.sso_lookup_domain(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.sso_lookup_domain(text) TO anon, authenticated, service_role;

COMMENT ON FUNCTION public.sso_lookup_domain(text) IS
  'EXCEPCIÓN INTENCIONAL anon-callable (PRE-login). Devuelve SOLO si un dominio usa SSO (verified=true), si está enforced y el provider hint para signInWithSSO. NUNCA filtra company_id/identidad/datos del tenant. Rate-limit por IP debe ir en la capa de borde. Espeja la semántica mínima de descubrimiento de SSO de GoTrue.';
