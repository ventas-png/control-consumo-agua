-- ============================================================================
-- Captura de IP server-side + versión vigente VFinal-2026 (suite legal pública)
-- ============================================================================
-- Continúa el framework legal de 20260604260000_legal_acceptance.sql, cuyo encabezado
-- dejó marcado como follow-up explícito: "captura de IP server-side".
--
-- Qué hace:
--   1) legal_acceptances += client_ip: la dirección IP de origen del consentimiento
--      click-wrap, capturada en el servidor (edge functions signup-company /
--      create-cliente-account vía getClientIp(), respetando la cadena de proxies).
--      Junto con accepted_at, version y user_agent completa el rastro de evidencia
--      (legal_terms_accepted = existe fila · legal_version_accepted = version ·
--       legal_acceptance_timestamp = accepted_at · legal_acceptance_ip = client_ip).
--      Tipo text (no inet) porque getClientIp puede devolver 'unknown'.
--
--   2) Rota el catálogo a la versión vigente 'VFinal-2026' (es) de los tres documentos
--      publicados como páginas públicas e indexables, apuntando is_current + url a las
--      rutas nuevas (/terminos-servicio, /politica-privacidad, /acuerdo-dpa-cookies).
--      Respeta el índice único parcial uq_legal_documents_current (una vigente por
--      doc_type/locale): primero baja is_current de las versiones previas, luego sube
--      las nuevas. Idempotente (ON CONFLICT DO UPDATE).
--
-- Seguridad: sin cambios de RLS. La escritura de aceptaciones en signup ocurre con
-- service_role (bypassa RLS, infra:I2); el RPC record_legal_acceptance() user-facing
-- queda intacto (la captura de IP fiable es server-side, no desde el navegador).
-- ============================================================================

-- ── 1) Columna de IP en el rastro de aceptaciones ────────────────────────────
ALTER TABLE public.legal_acceptances
  ADD COLUMN IF NOT EXISTS client_ip text;

COMMENT ON COLUMN public.legal_acceptances.client_ip IS
  'Dirección IP de origen del consentimiento (click-wrap), capturada server-side en el signup vía getClientIp(). Parte del rastro de evidencia legal. text (no inet) porque puede ser ''unknown''.';

-- ── 2) Versión vigente VFinal-2026 (es) con las URLs públicas nuevas ──────────
-- Baja la vigencia de las versiones previas de estos documentos (locale es) para no
-- chocar con el índice único parcial de "una sola vigente por (doc_type, locale)".
UPDATE public.legal_documents
   SET is_current = false
 WHERE locale = 'es'
   AND doc_type IN ('tos', 'privacy', 'dpa')
   AND is_current;

-- Alta (o re-activación idempotente) de la versión vigente VFinal-2026.
INSERT INTO public.legal_documents
  (doc_type, version, locale, title, url, summary, audience, is_current, published_at)
VALUES
  ('tos', 'VFinal-2026', 'es', 'Términos de Servicio',
   'https://administratodo.com/terminos-servicio',
   'Condiciones del SaaS multiempresa y multiproyecto, suscripciones, pagos recurrentes y propiedad de los datos.',
   'user', true, '2026-06-04 00:00:00+00'),
  ('privacy', 'VFinal-2026', 'es', 'Política de Privacidad',
   'https://administratodo.com/politica-privacidad',
   'Cómo recolectamos, tratamos y protegemos tus datos personales (RGPD / CCPA / LATAM).',
   'user', true, '2026-06-05 00:00:00+00'),
  ('dpa', 'VFinal-2026', 'es', 'Anexo DPA y Política de Cookies',
   'https://administratodo.com/acuerdo-dpa-cookies',
   'Acuerdo de encargo del tratamiento (RGPD), subprocesadores y política de cookies.',
   'company', true, '2026-06-04 00:00:00+00')
ON CONFLICT (doc_type, version, locale) DO UPDATE
  SET is_current   = true,
      title        = EXCLUDED.title,
      url          = EXCLUDED.url,
      summary      = EXCLUDED.summary,
      audience     = EXCLUDED.audience,
      published_at = EXCLUDED.published_at;
