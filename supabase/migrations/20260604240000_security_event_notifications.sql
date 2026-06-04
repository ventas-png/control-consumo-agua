-- ============================================================================
-- Notificaciones de seguridad (T3 Plataforma · plat:P11)
-- ============================================================================
-- Banda de migracion P11: 20260604240000.
--
-- Cuando un evento sensible de seguridad cae en public.security_logs, este
-- trigger encola una notificacion (in_app + email) al usuario afectado a traves
-- del orquestador YA existente: enqueue_notification → notifications_outbox →
-- notifications-dispatcher (cron) → user_notifications / Gmail, resolviendo
-- notification_templates por (key, channel, locale). NADA del pipeline cambia;
-- esto solo agrega un PRODUCTOR mas (#301/#313-#315 son el backbone).
--
-- Por que un TRIGGER en la tabla, y no encolar desde el edge log-security-event:
--   Los eventos de seguridad llegan desde MULTIPLES origenes:
--     - el edge `log-security-event`  → login_success, password_reset_completed…
--     - funciones SQL SECURITY DEFINER legacy → update_user_password emite
--       'password_updated'; validate_reset_token emite 'password_reset_*'.
--   Un trigger en security_logs los captura TODOS de forma uniforme y mantiene
--   a TODOS los callers SIN CAMBIOS (mismo principio que el caller de timbrado).
--
-- Eventos notificables (v1):
--   - password_changed / password_reset_completed / password_updated →
--     "tu contraseña fue cambiada" (critico de cuenta; SIEMPRE notifica).
--   - login_success desde dispositivo/IP NUEVO → "nuevo inicio de sesión"
--     (heuristica: no hubo otro login_success previo con la misma IP+user_agent
--     para ese usuario).
--   No notificables en v1 (ruido / requieren umbral; ver follow-ups abajo):
--     failed_login_attempt, login_error, logout, mfa_* de exito, etc.
--
-- Robustez: el enqueue va envuelto en EXCEPTION → un fallo de notificacion NUNCA
-- bloquea el INSERT en security_logs (el log de auditoria es lo primario). El
-- email es best-effort en su propio bloque: si falla resolverlo, el in_app igual
-- sale.
--
-- Seguridad: funciones SECURITY DEFINER con search_path fijo; REVOKE EXECUTE de
-- PUBLIC, anon, authenticated POR NOMBRE + GRANT service_role (en Supabase anon/
-- authenticated heredan EXECUTE por default privileges: revocar solo PUBLIC NO
-- basta — leccion de #380/#... ). El trigger se sigue disparando: su ejecucion
-- la hace el motor durante el DML, no depende del EXECUTE del rol de la sesion
-- (mismo razonamiento que 20260521000001_security_harden_trigger_functions).
--
-- Follow-ups (siguiente PR): aviso de intentos de login fallidos por umbral
-- (resolver usuario por details->>'email' en auth.users, dedupe por ventana);
-- preferencias de opt-out por usuario para avisos NO criticos (el cambio de
-- contraseña tipicamente no es opt-out).
--
-- Idempotente: CREATE OR REPLACE, CREATE INDEX/TRIGGER IF NOT EXISTS (DROP antes),
-- ON CONFLICT DO NOTHING en el seed.
-- ============================================================================

-- Soporta la deteccion de "dispositivo nuevo" sin escanear toda la tabla.
CREATE INDEX IF NOT EXISTS idx_security_logs_user_event
  ON public.security_logs (user_id, event_type);

-- ────────────────────────────────────────────────────────────────────────────
-- notify_security_event — clasifica el evento, resuelve al destinatario y encola
-- la(s) notificacion(es). La invoca el trigger (abajo) con los campos de NEW.
-- ────────────────────────────────────────────────────────────────────────────
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

  -- Vars comunes de plantilla (+ tipo/seccion para la campana in_app).
  v_payload := jsonb_build_object(
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

COMMENT ON FUNCTION public.notify_security_event IS
  'plat:P11 — encola notificacion de seguridad (in_app + email) para el usuario afectado por un evento de security_logs. Solo eventos del catalogo; login_success solo si dispositivo/IP nuevo. La invoca el trigger security_logs_notify.';

-- ────────────────────────────────────────────────────────────────────────────
-- Trigger en security_logs: AFTER INSERT FOR EACH ROW. El enqueue va aislado en
-- EXCEPTION → jamas bloquea el log de seguridad (auditoria primero).
-- ────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.trg_security_logs_notify()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  BEGIN
    PERFORM public.notify_security_event(
      NEW.id, NEW.user_id, NEW.event_type, NEW.ip_address, NEW.user_agent, NEW.timestamp
    );
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'trg_security_logs_notify: enqueue fallo para log % (evento %): %',
      NEW.id, NEW.event_type, SQLERRM;
  END;
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.trg_security_logs_notify IS
  'plat:P11 — trigger AFTER INSERT en security_logs que delega en notify_security_event. Tolerante a fallos: nunca bloquea el INSERT del log.';

DROP TRIGGER IF EXISTS security_logs_notify ON public.security_logs;
CREATE TRIGGER security_logs_notify
  AFTER INSERT ON public.security_logs
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_security_logs_notify();

-- ────────────────────────────────────────────────────────────────────────────
-- Hardening de grants (hacerlo BIEN desde el inicio, no como hotfix posterior):
-- REVOKE de PUBLIC, anon, authenticated POR NOMBRE + GRANT service_role.
-- Revocar EXECUTE del trigger NO lo rompe (lo dispara el motor en el DML).
-- ────────────────────────────────────────────────────────────────────────────
DO $$
DECLARE
  fn text;
  fns text[] := ARRAY[
    'public.notify_security_event(uuid, uuid, text, text, text, timestamptz)',
    'public.trg_security_logs_notify()'
  ];
BEGIN
  FOREACH fn IN ARRAY fns LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC, anon, authenticated', fn);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', fn);
  END LOOP;
END $$;

-- ────────────────────────────────────────────────────────────────────────────
-- Seed: plantillas globales (company_id NULL) de las notificaciones de seguridad.
-- Fallback compartido; un tenant puede refinarlas con su propia fila. Vars {{..}}
-- del payload: nombre, ip_address, user_agent, fecha; empresa_nombre lo inyecta
-- el dispatcher para email. ON CONFLICT DO NOTHING → idempotente.
-- ────────────────────────────────────────────────────────────────────────────
INSERT INTO public.notification_templates (company_id, key, channel, subject, body, locale, is_active)
VALUES
  (NULL, 'security_new_device_login', 'in_app', 'Nuevo inicio de sesión',
   'Hola {{nombre}}: detectamos un inicio de sesión en tu cuenta desde una nueva ubicación o dispositivo (IP {{ip_address}}, {{fecha}}). Si no fuiste tú, cambia tu contraseña de inmediato.',
   'es', true),
  (NULL, 'security_new_device_login', 'email', 'Nuevo inicio de sesión en tu cuenta',
   'Hola {{nombre}},

Detectamos un nuevo inicio de sesión en tu cuenta:

  - IP: {{ip_address}}
  - Dispositivo: {{user_agent}}
  - Fecha: {{fecha}}

Si fuiste tú, puedes ignorar este mensaje. Si NO reconoces este acceso, cambia tu contraseña de inmediato y contacta al administrador.

— {{empresa_nombre}}',
   'es', true),
  (NULL, 'security_password_changed', 'in_app', 'Tu contraseña fue cambiada',
   'Hola {{nombre}}: la contraseña de tu cuenta se cambió el {{fecha}}. Si no fuiste tú, contacta al administrador de inmediato.',
   'es', true),
  (NULL, 'security_password_changed', 'email', 'Tu contraseña fue cambiada',
   'Hola {{nombre}},

La contraseña de tu cuenta se cambió el {{fecha}}.

Si realizaste este cambio, no necesitas hacer nada. Si NO fuiste tú, contacta al administrador de inmediato para proteger tu cuenta.

— {{empresa_nombre}}',
   'es', true)
ON CONFLICT (company_id, key, channel, locale) DO NOTHING;
