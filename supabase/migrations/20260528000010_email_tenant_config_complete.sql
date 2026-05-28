-- ============================================================================
-- Email tenant config completo (plat:P6, F2.9)
-- ============================================================================
-- Cierra el ultimo gap de email per-tenant antes de SaaS:
--
--   1. from_name / reply_to por tenant — antes el "From" llegaba con el
--      email crudo del Gmail conectado y sin reply_to. Tenants quieren
--      mostrar "AdministradoraXYZ <noreply@admin-xyz.com>" y dirigir
--      respuestas a una cuenta especifica.
--
--   2. email_send_log — bitacora de cada envio (exitoso o no). Permite a
--      admins debugear porque un residente no recibio el aviso, ver tasas
--      de entrega, auditar comunicacion masiva. Idempotente: el insert
--      ocurre desde el edge function send-email, no desde cliente.
--
-- Sin cambios de RLS en company_email_configs ni email_templates — siguen
-- igual (tenant scoped + superadmin bypass + service_role bypass).
--
-- Idempotencia: ADD COLUMN IF NOT EXISTS y CREATE TABLE IF NOT EXISTS.
-- ============================================================================

-- 1. From-name y reply-to por tenant
ALTER TABLE public.company_email_configs
  ADD COLUMN IF NOT EXISTS from_name text,
  ADD COLUMN IF NOT EXISTS reply_to  text;

COMMENT ON COLUMN public.company_email_configs.from_name IS
  'Nombre de display que se usa en el "From" de los correos enviados desde este tenant (ej: "Administradora Maya"). Si es NULL, se usa el email conectado.';

COMMENT ON COLUMN public.company_email_configs.reply_to IS
  'Direccion a la que se enrutan las respuestas. Si es NULL, las respuestas van al email conectado.';

-- 2. Bitacora de envios
CREATE TABLE IF NOT EXISTS public.email_send_log (
  id              bigserial   PRIMARY KEY,
  company_id      uuid        REFERENCES public.companies(id) ON DELETE CASCADE,
  is_superadmin   boolean     NOT NULL DEFAULT false,
  template_key    text        NOT NULL,
  to_email        text        NOT NULL,
  from_email      text,
  status          text        NOT NULL CHECK (status IN ('sent', 'failed')),
  error_message   text,
  triggered_by    uuid        REFERENCES auth.users(id) ON DELETE SET NULL,
  sent_at         timestamptz NOT NULL DEFAULT now()
);

-- Indices para queries comunes
CREATE INDEX IF NOT EXISTS idx_email_send_log_company_recent
  ON public.email_send_log(company_id, sent_at DESC)
  WHERE company_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_email_send_log_failed
  ON public.email_send_log(company_id, sent_at DESC)
  WHERE status = 'failed';

CREATE INDEX IF NOT EXISTS idx_email_send_log_recipient
  ON public.email_send_log(to_email, sent_at DESC);

ALTER TABLE public.email_send_log ENABLE ROW LEVEL SECURITY;

-- SELECT: tenant ve su propio log; superadmin ve todo
DROP POLICY IF EXISTS "email_send_log_select" ON public.email_send_log;
CREATE POLICY "email_send_log_select" ON public.email_send_log
  FOR SELECT TO authenticated
  USING (
    is_super_admin()
    OR (
      company_id = get_my_company_id()
      AND current_user_role() = ANY(ARRAY['company_owner', 'admin'])
    )
  );

-- Sin INSERT/UPDATE/DELETE policies — solo el edge function send-email
-- (service_role) escribe. Mismo patron que audit_log de F2.7.
DROP POLICY IF EXISTS "service_role_email_send_log" ON public.email_send_log;
CREATE POLICY "service_role_email_send_log" ON public.email_send_log
  TO service_role USING (true) WITH CHECK (true);

COMMENT ON TABLE public.email_send_log IS
  'Bitacora de cada intento de envio de email. Escrito por send-email edge function (service_role). Solo lectura para admin/owner del tenant.';
