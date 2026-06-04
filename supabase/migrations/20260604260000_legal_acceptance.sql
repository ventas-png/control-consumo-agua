-- ============================================================================
-- Aceptación de documentos legales (T3 Plataforma · plat:P33-P34)
-- ============================================================================
-- Banda de migración P33: 20260604260000.
--
-- Framework de cumplimiento legal: registra QUÉ versión de cada documento legal
-- (Términos, Aviso de Privacidad, DPA) aceptó cada usuario/empresa y cuándo. Es
-- el rastro de auditoría que piden ventas enterprise y GDPR / Ley de Protección
-- de Datos (GT/MX). El CONTENIDO legal vive fuera (URLs publicadas, decisión de
-- negocio/legal — igual que el PAC); aquí va el ESQUELETO + el registro.
--
--   - legal_documents:   catálogo versionado (doc_type, version, locale, url…).
--                        is_current marca la versión vigente por (doc_type, locale).
--   - legal_acceptances: una fila por (usuario, doc_type, versión) aceptada.
--
-- Audiencia:
--   - 'user'    → todos los usuarios deben aceptarlo (Términos, Privacidad).
--   - 'company' → lo acepta el owner/admin EN NOMBRE del tenant (DPA).
--
-- API (RPC SECURITY DEFINER, user-facing, acotadas por auth.uid()):
--   - get_legal_status()         → documentos vigentes aplicables al usuario +
--                                   si ya los aceptó (para la UI de Perfil/gate).
--   - record_legal_acceptance()  → registra la aceptación de la versión vigente.
--
-- Follow-ups (otro PR): gate bloqueante en el shell si hay pendientes; captura de
-- IP server-side; export de datos del titular (plat:P35, GDPR); panel de
-- cumplimiento por empresa (quién aceptó qué).
--
-- Seguridad: RPC user-facing → GRANT authenticated + REVOKE PUBLIC/anon; escritura
-- de acceptances SOLO vía la RPC (sin policy INSERT para authenticated). RLS por
-- usuario/tenant. Idempotente.
-- ============================================================================

-- ── Catálogo de documentos legales versionados ───────────────────────────────
CREATE TABLE IF NOT EXISTS public.legal_documents (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  doc_type     text NOT NULL CHECK (doc_type IN ('tos', 'privacy', 'dpa')),
  version      text NOT NULL,
  locale       text NOT NULL DEFAULT 'es',
  title        text NOT NULL,
  url          text,                 -- enlace al documento publicado
  summary      text,                 -- resumen corto (para el aviso de cambios)
  audience     text NOT NULL DEFAULT 'user' CHECK (audience IN ('user', 'company')),
  published_at timestamptz NOT NULL DEFAULT now(),
  is_current   boolean NOT NULL DEFAULT true,
  created_at   timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.legal_documents IS
  'plat:P33 — catálogo versionado de documentos legales (tos/privacy/dpa). is_current marca la versión vigente por (doc_type, locale). El contenido vive en url.';

-- Una versión única por (doc_type, version, locale) y una sola vigente por tipo.
CREATE UNIQUE INDEX IF NOT EXISTS uq_legal_documents_version
  ON public.legal_documents (doc_type, version, locale);
CREATE UNIQUE INDEX IF NOT EXISTS uq_legal_documents_current
  ON public.legal_documents (doc_type, locale) WHERE is_current;

ALTER TABLE public.legal_documents ENABLE ROW LEVEL SECURITY;

-- Cualquier authenticated lee el catálogo (necesario para mostrar/aceptar).
-- Gestión (alta de versiones) solo super_admin/service_role: sin policy de
-- escritura para authenticated.
DROP POLICY IF EXISTS "legal_docs_select" ON public.legal_documents;
CREATE POLICY "legal_docs_select" ON public.legal_documents
  FOR SELECT TO authenticated
  USING (true);

-- ── Registro de aceptaciones ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.legal_acceptances (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  company_id  uuid REFERENCES public.companies(id) ON DELETE SET NULL,
  doc_type    text NOT NULL,
  version     text NOT NULL,
  locale      text NOT NULL DEFAULT 'es',
  accepted_at timestamptz NOT NULL DEFAULT now(),
  user_agent  text
);

COMMENT ON TABLE public.legal_acceptances IS
  'plat:P33 — registro inmutable de aceptación de un documento legal por un usuario (rastro de auditoría). Escritura solo vía record_legal_acceptance().';

-- Una aceptación por (usuario, doc_type, versión, locale): idempotente.
CREATE UNIQUE INDEX IF NOT EXISTS uq_legal_acceptances
  ON public.legal_acceptances (user_id, doc_type, version, locale);
CREATE INDEX IF NOT EXISTS idx_legal_acceptances_company
  ON public.legal_acceptances (company_id, doc_type) WHERE company_id IS NOT NULL;

ALTER TABLE public.legal_acceptances ENABLE ROW LEVEL SECURITY;

-- SELECT: el usuario ve las suyas; super_admin todo; owner/admin las de su tenant
-- (panel de cumplimiento). Sin INSERT/UPDATE/DELETE para authenticated: el
-- registro es vía RPC SECURITY DEFINER y es inmutable.
DROP POLICY IF EXISTS "legal_acc_select" ON public.legal_acceptances;
CREATE POLICY "legal_acc_select" ON public.legal_acceptances
  FOR SELECT TO authenticated
  USING (
    user_id = auth.uid()
    OR is_super_admin()
    OR (company_id = get_my_company_id() AND current_user_role() = ANY(ARRAY['company_owner', 'admin']))
  );

-- ── RPC: estado legal del usuario actual (vigentes aplicables + si aceptó) ─────
CREATE OR REPLACE FUNCTION public.get_legal_status(p_locale text DEFAULT 'es')
RETURNS TABLE (
  doc_type    text,
  version     text,
  title       text,
  url         text,
  summary     text,
  audience    text,
  accepted    boolean,
  accepted_at timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_role text := current_user_role();
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN;
  END IF;
  RETURN QUERY
    SELECT
      d.doc_type, d.version, d.title, d.url, d.summary, d.audience,
      (a.id IS NOT NULL) AS accepted,
      a.accepted_at
    FROM public.legal_documents d
    LEFT JOIN public.legal_acceptances a
      ON a.user_id = auth.uid()
     AND a.doc_type = d.doc_type
     AND a.version  = d.version
     AND a.locale   = d.locale
    WHERE d.is_current
      AND d.locale = p_locale
      AND (
        d.audience = 'user'
        OR (d.audience = 'company'
            AND (is_super_admin() OR v_role = ANY(ARRAY['company_owner', 'admin'])))
      )
    ORDER BY d.doc_type;
END;
$$;

COMMENT ON FUNCTION public.get_legal_status IS
  'plat:P33 — documentos legales vigentes aplicables al usuario actual (DPA solo a owner/admin) + si ya aceptó la versión vigente. User-facing: GRANT a authenticated.';

-- ── RPC: registrar aceptación de la versión vigente de un documento ───────────
CREATE OR REPLACE FUNCTION public.record_legal_acceptance(
  p_doc_type   text,
  p_user_agent text DEFAULT NULL,
  p_locale     text DEFAULT 'es'
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_doc  public.legal_documents%ROWTYPE;
  v_role text := current_user_role();
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'no autenticado';
  END IF;

  SELECT * INTO v_doc
  FROM public.legal_documents
  WHERE is_current AND doc_type = p_doc_type AND locale = p_locale
  LIMIT 1;

  IF v_doc.id IS NULL THEN
    RAISE EXCEPTION 'documento legal vigente no encontrado: % (%)', p_doc_type, p_locale;
  END IF;

  -- Los documentos 'company' (DPA) solo los acepta owner/admin (o super_admin).
  IF v_doc.audience = 'company'
     AND NOT (is_super_admin() OR v_role = ANY(ARRAY['company_owner', 'admin'])) THEN
    RAISE EXCEPTION 'no autorizado para aceptar el documento %', p_doc_type;
  END IF;

  INSERT INTO public.legal_acceptances (user_id, company_id, doc_type, version, locale, user_agent)
  VALUES (auth.uid(), get_my_company_id(), v_doc.doc_type, v_doc.version, v_doc.locale, NULLIF(p_user_agent, ''))
  ON CONFLICT (user_id, doc_type, version, locale) DO NOTHING;

  RETURN v_doc.version;
END;
$$;

COMMENT ON FUNCTION public.record_legal_acceptance IS
  'plat:P33 — registra que el usuario actual acepta la versión VIGENTE de un documento legal. DPA solo owner/admin. Idempotente. User-facing: GRANT a authenticated.';

-- ── Grants (user-facing): REVOKE de PUBLIC/anon + GRANT a authenticated ───────
DO $$
DECLARE
  fn text;
  fns text[] := ARRAY[
    'public.get_legal_status(text)',
    'public.record_legal_acceptance(text, text, text)'
  ];
BEGIN
  FOREACH fn IN ARRAY fns LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC, anon', fn);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated', fn);
  END LOOP;
END $$;

-- ── Seed: versiones vigentes (es). El contenido se publica en las URLs; el
-- dueño actualiza texto/URL y rota la versión (is_current). ON CONFLICT idempotente.
INSERT INTO public.legal_documents (doc_type, version, locale, title, url, summary, audience, is_current)
VALUES
  ('tos', '2026-06-01', 'es', 'Términos y Condiciones',
   'https://administratodo.com/legal/terminos',
   'Condiciones de uso del servicio AdministraTodo.', 'user', true),
  ('privacy', '2026-06-01', 'es', 'Aviso de Privacidad',
   'https://administratodo.com/legal/privacidad',
   'Cómo recolectamos, tratamos y protegemos tus datos personales.', 'user', true),
  ('dpa', '2026-06-01', 'es', 'Acuerdo de Tratamiento de Datos (DPA)',
   'https://administratodo.com/legal/dpa',
   'Acuerdo de encargo del tratamiento para empresas (GDPR / Ley de Protección de Datos).', 'company', true)
ON CONFLICT (doc_type, version, locale) DO NOTHING;
