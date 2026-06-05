-- ============================================================================
-- Productor de seguridad emite user_id en el payload (T2 Comunicación · com:N9)
-- ============================================================================
-- Épica #301 · banda de migración T2 (2026-06-06): 20260606110000.
--
-- Contexto: el dispatcher ahora respeta notification_preferences (20260606100000
-- + notifications-dispatcher). Para suprimir un EMAIL cuando el usuario desactivó
-- el canal, el dispatcher necesita el user_id del destinatario — pero en el canal
-- email el `recipient` del outbox es la dirección de correo, NO un user_id. El
-- contrato (helper puro `resolvePreferenceUserId`) es: el productor declara el
-- usuario destino en `payload.user_id`.
--
-- `notify_security_event` (plat:P11) es el productor canónico que abanica in_app +
-- email al MISMO usuario (cambio de contraseña, login en dispositivo nuevo). Hoy
-- su payload NO lleva user_id, así que su email no podía respetar la preferencia.
-- Este PR lo hace cumplir el contrato: agrega `'user_id', p_user_id` a v_payload
-- (aditivo; el resto del cuerpo es idéntico al de 20260604240000). Así, el email
-- de seguridad de un usuario que desactivó 'email' queda 'suppressed' y su in_app
-- (exento) igual sale — la Definición de Hecho de este track.
--
-- Coordinación: si T3 (plat:P11) cambia esta función en una migración POSTERIOR,
-- debe conservar `'user_id', p_user_id` en el payload o el email dejará de
-- respetar la preferencia. (En in_app es inocuo: in_app nunca se suprime.)
--
-- Idempotente: CREATE OR REPLACE + re-REVOKE/GRANT por nombre de rol.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.notify_security_event(
  p_log_id     uuid,
  p_user_id    uuid,
  p_event_type text,
  p_ip         text,
  p_user_agent text,
  p_event_at   timestamptz
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_template_key text;
  v_company_id   uuid;
  v_nombre       text;
  v_email        text;
  v_titulo       text;
  v_cuerpo       text;
  v_fecha        text;
  v_ip           text := COALESCE(NULLIF(p_ip, ''), 'desconocida');
  v_ua           text := COALESCE(NULLIF(p_user_agent, ''), 'desconocido');
  v_payload      jsonb;
BEGIN
  -- 1) ¿Evento notificable? (catalogo inline = fuente de verdad). Para agregar
  --    uno: añade el WHEN aqui y siembra su plantilla in_app/email abajo.
  v_template_key := CASE p_event_type
    WHEN 'password_changed'         THEN 'security_password_changed'  -- cambio in-app autenticado (PerfilSection)
    WHEN 'password_reset_completed' THEN 'security_password_changed'  -- completó reset por enlace
    WHEN 'password_updated'         THEN 'security_password_changed'  -- placeholder legacy (sin user_id hoy)
    WHEN 'login_success'            THEN 'security_new_device_login'  -- solo si dispositivo/IP nuevo
    ELSE NULL
  END;
  IF v_template_key IS NULL THEN
    RETURN;  -- evento no notificable
  END IF;

  -- 2) Sin usuario afectado no hay a quien avisar (eventos pre-auth con JWT nulo).
  IF p_user_id IS NULL THEN
    RETURN;
  END IF;

  -- 3) login_success: solo si es dispositivo/IP NUEVO. Si ya hubo un login_success
  --    previo (otra fila) con la misma IP + user_agent, es conocido → no avisar.
  IF p_event_type = 'login_success' THEN
    IF EXISTS (
      SELECT 1
      FROM public.security_logs s
      WHERE s.user_id = p_user_id
        AND s.event_type = 'login_success'
        AND s.id <> p_log_id
        AND COALESCE(s.ip_address, '') = COALESCE(p_ip, '')
        AND COALESCE(s.user_agent, '') = COALESCE(p_user_agent, '')
    ) THEN
      RETURN;  -- dispositivo/IP ya conocido
    END IF;
  END IF;

  -- 4) Destinatario: nombre + tenant desde app_users.
  SELECT au.company_id, au.full_name
    INTO v_company_id, v_nombre
  FROM public.app_users au
  WHERE au.id = p_user_id;

  v_nombre := COALESCE(NULLIF(v_nombre, ''), 'usuario');
  v_fecha  := to_char(COALESCE(p_event_at, now()) AT TIME ZONE 'UTC', 'DD/MM/YYYY HH24:MI') || ' UTC';

  -- Vars comunes de plantilla (+ tipo/seccion para la campana in_app). user_id
  -- declara el usuario destino para que el dispatcher respete su preferencia de
  -- canal (com:N9: contrato `resolvePreferenceUserId` lee payload.user_id).
  v_payload := jsonb_build_object(
    'user_id',    p_user_id,
    'nombre',     v_nombre,
    'ip_address', v_ip,
    'user_agent', v_ua,
    'fecha',      v_fecha,
    'evento',     p_event_type,
    'tipo',       'seguridad',
    'seccion',    'perfil'
  );

  IF p_event_type = 'login_success' THEN
    v_titulo := 'Nuevo inicio de sesión';
    v_cuerpo := 'Detectamos un inicio de sesión en tu cuenta desde una nueva ubicación o dispositivo (IP '
                || v_ip || ', ' || v_fecha || '). Si no fuiste tú, cambia tu contraseña de inmediato.';
  ELSE
    v_titulo := 'Tu contraseña fue cambiada';
    v_cuerpo := 'La contraseña de tu cuenta se cambió el ' || v_fecha
                || '. Si no fuiste tú, contacta al administrador de inmediato.';
  END IF;

  -- 5) in_app (recipient = user_id). La plantilla in_app renderiza titulo/cuerpo;
  --    igual mandamos titulo/cuerpo en el payload como fallback si no hay plantilla.
  --    Args posicionales de enqueue_notification:
  --    (p_channel, p_recipient, p_payload, p_company_id, p_template_key, p_scheduled_at)
  PERFORM public.enqueue_notification(
    'in_app',
    p_user_id::text,
    v_payload || jsonb_build_object('titulo', v_titulo, 'cuerpo', v_cuerpo),
    v_company_id,
    v_template_key,
    now()
  );

  -- 6) email best-effort: requiere tenant (el dispatcher exige company_id) y un
  --    email resoluble. Bloque propio para que un fallo aqui no pierda el in_app.
  IF v_company_id IS NOT NULL THEN
    BEGIN
      SELECT u.email INTO v_email FROM auth.users u WHERE u.id = p_user_id;
      IF v_email IS NOT NULL AND v_email <> '' THEN
        PERFORM public.enqueue_notification(
          'email',
          v_email,
          v_payload || jsonb_build_object('subject', v_titulo, 'body', v_cuerpo),
          v_company_id,
          v_template_key,
          now()
        );
      END IF;
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'notify_security_event: email enqueue fallo (user %): %', p_user_id, SQLERRM;
    END;
  END IF;
END;
$$;

-- Re-aplica el hardening de grants (idempotente; mismo conjunto que 20260604240000).
REVOKE EXECUTE ON FUNCTION public.notify_security_event(uuid, uuid, text, text, text, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.notify_security_event(uuid, uuid, text, text, text, timestamptz) TO service_role;
