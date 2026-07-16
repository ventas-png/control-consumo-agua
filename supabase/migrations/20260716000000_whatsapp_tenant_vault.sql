-- WhatsApp por tenant — bóveda de credenciales (P1 · comunicación).
--
-- CONTEXTO (auditoría 2026-07-10): "WhatsApp por tenant en el outbox (hoy stubs;
-- el único WhatsApp real usa credenciales globales y no pasa por el outbox)". El
-- outbox multi-canal ya existe (notifications_outbox + notifications-dispatcher)
-- y 'whatsapp' es un canal declarado pero stubbeado (failed no-retriable). Este
-- PR agrega la PIEZA DE DATOS: credenciales de Meta WhatsApp Cloud API por
-- empresa, para que el dispatcher (service_role, en el edge) entregue mensajes
-- del canal 'whatsapp' con el número del tenant. INERTE por diseño: sin fila
-- activa aquí, el dispatcher marca la fila failed no-retriable ("sin WhatsApp
-- configurado") y nada más cambia — igual que el canal email sin Gmail.
--
-- PATRÓN (espejo de payfac_secrets / P0 #7): tabla deny-all (solo service_role,
-- que bypassa RLS, la toca — los writes llegarán por edges whatsapp-save-credentials
-- en el follow-up de UI); access_token cifrado en reposo vía secretsCrypto
-- (enc:v1:, passthrough hasta que el operador aprovisione TENANT_SECRETS_ENC_KEY,
-- dual-read al leer); el cliente solo ve metadata NO sensible vía el RPC
-- whatsapp_estatus (SECURITY DEFINER, caller-scoped a admin/owner del tenant).
--
-- Meta exige PLANTILLA pre-aprobada para mensajes iniciados por el negocio
-- (fuera de la ventana de 24 h de servicio): template_default/template_lang
-- guardan la plantilla del tenant; el payload del outbox puede sobreescribirla
-- (template_name/template_lang/template_params).
--
-- Interin sin UI: el operador puede sembrar credenciales desde el SQL editor del
-- dashboard (corre como postgres, dueño de la tabla ⇒ no lo bloquea el RLS):
--   INSERT INTO public.company_whatsapp_configs
--     (company_id, phone_number_id, access_token, template_default)
--   VALUES ('<company_id>', '<phone_number_id>', '<token>', '<plantilla>');
--
-- Apply por el gate de migraciones (P0 #9).

-- ── Bóveda: credenciales de WhatsApp por empresa ─────────────────────────────
CREATE TABLE IF NOT EXISTS public.company_whatsapp_configs (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Tenant dueño de las credenciales. UNA fila por empresa.
  company_id        uuid        NOT NULL UNIQUE REFERENCES public.companies(id) ON DELETE CASCADE,

  -- Proveedor de la API. Hoy solo Meta WhatsApp Cloud API (graph.facebook.com);
  -- CHECK abierto a futuros ('twilio') vía migración.
  provider          text        NOT NULL DEFAULT 'meta' CHECK (provider IN ('meta')),

  -- Identificador del número emisor en Meta (no es secreto; la UI lo muestra).
  phone_number_id   text        NOT NULL,

  -- Token de acceso de la app de Meta. CIFRADO en reposo (secretsCrypto enc:v1:;
  -- passthrough hasta aprovisionar TENANT_SECRETS_ENC_KEY). NUNCA se proyecta al
  -- cliente (tabla deny-all + el RPC de estatus solo expone metadata).
  access_token      text        NOT NULL,

  -- Plantilla aprobada por defecto del tenant (Meta la exige para mensajes
  -- iniciados por el negocio) y su locale. El payload puede sobreescribirlas.
  template_default  text,
  template_lang     text        NOT NULL DEFAULT 'es',

  is_active         boolean     NOT NULL DEFAULT true,

  -- Resultado del último "probar conexión" (lo escribirá whatsapp-test-connection
  -- en el follow-up de UI). Metadata NO sensible: se expone vía whatsapp_estatus.
  estado_conexion   text        NOT NULL DEFAULT 'desconocido'
                                CHECK (estado_conexion IN ('desconocido', 'ok', 'error')),
  estado_mensaje    text,
  estado_probado_en timestamptz,

  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.company_whatsapp_configs ENABLE ROW LEVEL SECURITY;

-- Deny-all (patrón payfac_secrets): SOLO service_role (bypassa RLS) lee/escribe.
-- El cliente consulta metadata vía el RPC whatsapp_estatus.
DROP POLICY IF EXISTS "Deny access to all" ON public.company_whatsapp_configs;
CREATE POLICY "Deny access to all" ON public.company_whatsapp_configs
  AS RESTRICTIVE FOR ALL
  USING (false)
  WITH CHECK (false);

-- ── RPC: estatus NO sensible para la UI de configuración ────────────────────
CREATE OR REPLACE FUNCTION public.whatsapp_estatus(p_company_id uuid)
RETURNS TABLE (
  id                uuid,
  company_id        uuid,
  provider          text,
  phone_number_id   text,
  template_default  text,
  template_lang     text,
  is_active         boolean,
  estado_conexion   text,
  estado_mensaje    text,
  estado_probado_en timestamptz,
  tiene_token       boolean,
  created_at        timestamptz,
  updated_at        timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  -- Autorización: super_admin ve cualquier tenant; admin/owner solo el suyo.
  -- IS NOT TRUE (no `IF NOT (...)`): con auth.uid()/helpers NULL la condición
  -- evalúa a NULL y `NOT NULL` no entra al IF (lógica trivaluada) — fail-closed
  -- también con claims vacíos. Verificado contra prod: `IF NOT` NO rechazaba.
  IF (
    public.is_super_admin()
    OR (
      p_company_id = public.get_my_company_id()
      AND public.current_user_role() IN ('company_owner', 'admin')
    )
  ) IS NOT TRUE THEN
    RAISE EXCEPTION 'No autorizado para consultar el estatus de WhatsApp de este tenant';
  END IF;

  RETURN QUERY
  SELECT
    c.id, c.company_id, c.provider, c.phone_number_id,
    c.template_default, c.template_lang, c.is_active,
    c.estado_conexion, c.estado_mensaje, c.estado_probado_en,
    (c.access_token IS NOT NULL AND c.access_token <> '') AS tiene_token,
    c.created_at, c.updated_at
  FROM public.company_whatsapp_configs c
  WHERE c.company_id = p_company_id;
END;
$$;

-- SECURITY DEFINER → cerrar el RPC por nombre y conceder solo a authenticated
-- (la propia función valida rol) + service_role (lección 20260604210000).
REVOKE EXECUTE ON FUNCTION public.whatsapp_estatus(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.whatsapp_estatus(uuid) TO authenticated, service_role;

COMMENT ON TABLE public.company_whatsapp_configs IS
  'Credenciales de Meta WhatsApp Cloud API por empresa para el canal whatsapp del outbox (notifications-dispatcher). Deny-all: solo service_role la toca; access_token cifrado en reposo (secretsCrypto). Metadata no sensible vía whatsapp_estatus.';
COMMENT ON FUNCTION public.whatsapp_estatus(uuid) IS
  'Estatus NO sensible de la config de WhatsApp del tenant. SECURITY DEFINER acotado: valida admin/owner del tenant (o super_admin) y devuelve metadata + flag tiene_token, NUNCA el access_token. Espeja payfac_estatus.';

-- ── HARDENING (hallazgo del dry-run de este PR): payfac_estatus y
-- fiscal_pac_estatus usan `IF NOT (guard)` — con helpers NULL (p. ej. un auth
-- user huérfano sin fila en app_users) la condición evalúa a NULL, `NOT NULL`
-- no entra al IF y el RPC DEVUELVE la metadata de cualquier tenant (fail-open;
-- verificado contra prod con claims vacíos). Mismo bug trivaluado corregido en
-- condominios_cerrar_ciclo. Se re-declaran con `IS NOT TRUE` (fail-closed);
-- cuerpos idénticos a los de prod salvo el guard. Solo expone metadata (nunca
-- credenciales), pero un guard de autorización no debe depender de la suerte.

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
  IF (
    public.is_super_admin()
    OR (
      p_company_id = public.get_my_company_id()
      AND public.current_user_role() IN ('company_owner', 'admin')
    )
  ) IS NOT TRUE THEN
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

CREATE OR REPLACE FUNCTION public.fiscal_pac_estatus(p_company_id uuid)
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
  IF (
    public.is_super_admin()
    OR (
      p_company_id = public.get_my_company_id()
      AND public.current_user_role() IN ('company_owner', 'admin')
    )
  ) IS NOT TRUE THEN
    RAISE EXCEPTION 'No autorizado para consultar el estatus fiscal de este tenant';
  END IF;

  RETURN QUERY
  SELECT
    s.id, s.company_id, s.project_id, s.proveedor,
    s.estado_conexion, s.estado_mensaje, s.estado_probado_en,
    (s.credenciales ? 'sandbox') AS tiene_sandbox,
    (s.credenciales ? 'prod')    AS tiene_prod,
    s.created_at, s.updated_at
  FROM public.fiscal_pac_secrets s
  WHERE s.company_id = p_company_id;
END;
$$;
