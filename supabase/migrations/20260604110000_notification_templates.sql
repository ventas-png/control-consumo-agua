-- ============================================================================
-- Notification templates — plantillas multi-canal por tenant (T2/com:N3)
-- ============================================================================
-- Epica #301 · sub-issue #314 (N3). Banda de migracion T2: 20260604110000.
--
-- Plantillas reutilizables que el orquestador (notifications-dispatcher)
-- resuelve por (template_key, channel, locale) al despachar una fila de
-- notifications_outbox. Existe ya email_templates (HTML especifico de email);
-- notification_templates generaliza a cualquier canal — in_app (titulo/cuerpo),
-- email (subject/body), whatsapp (texto), push (titulo/cuerpo) — y soporta
-- locale para i18n futura.
--
-- Modelo de fallback de 2 niveles, igual que email_templates:
--   - company_id = <tenant>  → override propio del tenant (gana).
--   - company_id = NULL      → plantilla global por defecto (fallback).
-- El dispatcher busca primero la del tenant; si no existe, cae a la global.
--
-- Render: el body/subject usan placeholders {{var}} que el dispatcher sustituye
-- con notifications_outbox.payload (mismo motor applyVars de send-email /
-- route-reminders).
--
-- RLS: scope por company_id — admin/owner del tenant gestiona sus plantillas;
-- super_admin gestiona todo incluyendo las globales (company_id NULL); cualquier
-- authenticated puede LEER las globales activas (necesarias como fallback).
--
-- UNIQUE (company_id, key, channel, locale): una plantilla por combinacion.
-- NULLS NOT DISTINCT para que company_id NULL (globales) tambien sea unico por
-- (key, channel, locale) — Postgres 15+ (el proyecto corre PG17).
--
-- Idempotencia: CREATE TABLE/INDEX IF NOT EXISTS, DROP POLICY IF EXISTS antes de
-- CREATE POLICY, ON CONFLICT DO NOTHING en el seed.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.notification_templates (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- NULL = plantilla global por defecto (fallback para todos los tenants).
  company_id  uuid REFERENCES public.companies(id) ON DELETE CASCADE,
  key         text NOT NULL,
  channel     text NOT NULL CHECK (channel IN ('in_app', 'email', 'whatsapp', 'push')),
  -- subject solo aplica a email; el resto de canales usan body (y opcionalmente
  -- subject como titulo). Nullable para no forzarlo en canales sin asunto.
  subject     text,
  body        text NOT NULL,
  locale      text NOT NULL DEFAULT 'es',
  is_active   boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.notification_templates IS
  'Plantillas multi-canal por tenant para el orquestador (T2/com:N3). company_id NULL = global fallback. El dispatcher resuelve (key, channel, locale) y sustituye {{vars}} del payload. RLS scope tenant.';

-- Una plantilla por (tenant|global, key, channel, locale). NULLS NOT DISTINCT
-- trata company_id NULL como un valor unico, asi solo hay una global por combo.
CREATE UNIQUE INDEX IF NOT EXISTS uq_notif_templates_key
  ON public.notification_templates (company_id, key, channel, locale)
  NULLS NOT DISTINCT;

-- Lookup del dispatcher: resolver activos por key/channel/locale.
CREATE INDEX IF NOT EXISTS idx_notif_templates_lookup
  ON public.notification_templates (key, channel, locale)
  WHERE is_active = true;

ALTER TABLE public.notification_templates ENABLE ROW LEVEL SECURITY;

-- SELECT: super_admin todo; admin/owner las de su tenant; cualquier authenticated
-- las globales activas (company_id NULL) porque son el fallback compartido.
DROP POLICY IF EXISTS "notif_templates_select" ON public.notification_templates;
CREATE POLICY "notif_templates_select" ON public.notification_templates
  FOR SELECT TO authenticated
  USING (
    is_super_admin()
    OR (company_id IS NULL AND is_active = true)
    OR company_id = get_my_company_id()
  );

-- INSERT/UPDATE/DELETE: admin/owner gestiona SOLO sus plantillas de tenant
-- (company_id = el suyo, nunca NULL). super_admin gestiona todo (incluye
-- globales). service_role bypassea RLS.
DROP POLICY IF EXISTS "notif_templates_insert" ON public.notification_templates;
CREATE POLICY "notif_templates_insert" ON public.notification_templates
  FOR INSERT TO authenticated
  WITH CHECK (
    is_super_admin()
    OR (
      company_id = get_my_company_id()
      AND current_user_role() = ANY(ARRAY['company_owner', 'admin'])
    )
  );

DROP POLICY IF EXISTS "notif_templates_update" ON public.notification_templates;
CREATE POLICY "notif_templates_update" ON public.notification_templates
  FOR UPDATE TO authenticated
  USING (
    is_super_admin()
    OR (
      company_id = get_my_company_id()
      AND current_user_role() = ANY(ARRAY['company_owner', 'admin'])
    )
  )
  WITH CHECK (
    is_super_admin()
    OR (
      company_id = get_my_company_id()
      AND current_user_role() = ANY(ARRAY['company_owner', 'admin'])
    )
  );

DROP POLICY IF EXISTS "notif_templates_delete" ON public.notification_templates;
CREATE POLICY "notif_templates_delete" ON public.notification_templates
  FOR DELETE TO authenticated
  USING (
    is_super_admin()
    OR (
      company_id = get_my_company_id()
      AND current_user_role() = ANY(ARRAY['company_owner', 'admin'])
    )
  );

-- ────────────────────────────────────────────────────────────────────────────
-- Seed: plantillas globales por defecto (company_id NULL). Sirven de fallback
-- cuando un tenant no define la suya. ON CONFLICT DO NOTHING → idempotente y
-- no pisa overrides de tenant (que tienen company_id distinto).
-- ────────────────────────────────────────────────────────────────────────────
INSERT INTO public.notification_templates (company_id, key, channel, subject, body, locale, is_active)
VALUES
  -- in_app: recordatorio generico (titulo en subject, cuerpo en body).
  (NULL, 'generic_reminder', 'in_app', 'Recordatorio',
   'Hola {{nombre}}, este es un recordatorio: {{mensaje}}', 'es', true),
  -- email: comunicado generico (sirve de base; tenants pueden refinarlo).
  (NULL, 'generic_announcement', 'email', 'Comunicado de {{empresa_nombre}}',
   'Estimado/a {{nombre}},

{{mensaje}}

Atentamente,
{{empresa_nombre}}', 'es', true)
ON CONFLICT (company_id, key, channel, locale) DO NOTHING;
