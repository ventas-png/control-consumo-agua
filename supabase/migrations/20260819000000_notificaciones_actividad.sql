-- ════════════════════════════════════════════════════════════════════════════
-- Centro de notificaciones: avisar mensajes, difusiones y solicitudes nuevas
--
-- POR QUÉ
-- La campana (`user_notifications` + NotificationBell) sólo se llena hoy con
-- cinco productores: recordatorios de ruta, paquetería (20260523000005),
-- eventos de seguridad (20260604240000), partidas presupuestarias excedidas
-- (20260611060000) y anuncios del tablón (20260801000500). Es decir: la
-- actividad que un administrador revisa TODOS los días —el hilo del cliente que
-- acaba de responder, el comunicado que le acaba de llegar, la solicitud que un
-- residente acaba de meter— no dispara ningún aviso. Se entera sólo si abre la
-- pantalla correspondiente y la mira.
--
-- Concretamente faltaban tres productores:
--   1. MENSAJES     `conversation_messages` se inserta desde
--                   domain/comunicacion/conversations.ts sin encolar nada.
--   2. DIFUSIONES   create-broadcast encola SÓLO `email` (index.ts paso 8), así
--                   que un destinatario sin correo registrado no se entera de
--                   un comunicado, y quien sí lo tiene no ve nada en la app.
--   3. SOLICITUDES  las cinco tablas de solicitud (residente, concierge,
--                   certificado, mudanza, renta) y `mensajes_portal` son INSERT
--                   planos vía createCondominioRow, sin aviso al staff.
--
-- CÓMO
-- Igual que 20260801000500 (anuncios): un TRIGGER encola en
-- `notifications_outbox` con channel `in_app`; el cron de notifications-
-- dispatcher lo convierte en la fila de `user_notifications` que la campana ya
-- lee por Realtime. Va en trigger y no en el cliente ni en una edge nueva
-- porque cada evento tiene varios caminos de escritura (la app, el portal del
-- residente, la edge de difusión) y un trigger los cubre todos sin poder
-- saltárselo.
--
-- CANALES: sólo `in_app`. Un email por cada mensaje de chat sería spam, y la
-- difusión YA manda su email desde create-broadcast — duplicarlo aquí enviaría
-- dos correos por comunicado. `push` sigue sin implementarse en el dispatcher.
--
-- El payload lleva `user_id` porque es lo que el dispatcher lee para respetar
-- `notification_channel_enabled` (com:N9), y `tipo`/`seccion` porque son las
-- columnas con las que la campana agrupa y navega.
--
-- CÓMO REVERTIR
--   DROP TRIGGER trg_notif_mensaje_conversacion ON public.conversation_messages;
--   DROP TRIGGER trg_notif_difusion             ON public.broadcast_recipients;
--   DROP TRIGGER trg_notif_mensaje_portal       ON public.mensajes_portal;
--   DROP TRIGGER trg_notif_solicitud_residente  ON public.solicitudes_residente;
--   DROP TRIGGER trg_notif_solicitud_concierge  ON public.solicitudes_concierge;
--   DROP TRIGGER trg_notif_solicitud_certificado ON public.solicitudes_certificado;
--   DROP TRIGGER trg_notif_solicitud_mudanza    ON public.solicitud_mudanza_unidad;
--   DROP TRIGGER trg_notif_solicitud_renta      ON public.solicitud_renta_unidad;
--   DROP FUNCTION public.fn_notificar_mensaje_conversacion();
--   DROP FUNCTION public.fn_notificar_difusion();
--   DROP FUNCTION public.fn_notificar_mensaje_portal();
--   DROP FUNCTION public.fn_notificar_solicitud_nueva();
--   DROP FUNCTION public.notif_encolar_in_app(uuid, uuid[], text, text, text, text, jsonb);
--   DROP FUNCTION public.notif_staff_de_proyecto(uuid, uuid);
--   DROP INDEX public.idx_notif_outbox_in_app_reciente;
--
-- Idempotente: CREATE OR REPLACE en funciones, DROP TRIGGER IF EXISTS antes de
-- CREATE TRIGGER, CREATE INDEX IF NOT EXISTS.
-- ════════════════════════════════════════════════════════════════════════════

-- ─────────────────────────────────────────────────────────────────────────────
-- 0. Índice de apoyo para el anti-ráfaga
-- ─────────────────────────────────────────────────────────────────────────────
-- `fn_notificar_mensaje_conversacion` consulta "¿ya avisé a este usuario de este
-- hilo hace poco?" en cada mensaje. Sin índice eso es un seq scan del outbox
-- entero por mensaje enviado. Parcial por canal: el outbox también guarda email,
-- que esta consulta nunca mira.
CREATE INDEX IF NOT EXISTS idx_notif_outbox_in_app_reciente
  ON public.notifications_outbox (recipient, created_at DESC)
  WHERE channel = 'in_app';

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Helper: staff que debe enterarse de un evento de un proyecto
-- ─────────────────────────────────────────────────────────────────────────────
-- Misma regla de alcance que `conversations_select` (20260814000000) y
-- `projects_select` (20260519000007): company_owner/admin ven la empresa
-- completa; el resto, sólo los proyectos que tienen asignados. Un evento sin
-- proyecto (`p_project_id IS NULL`) es ambiguo, no ajeno: se avisa a todo el
-- staff de la empresa, igual que esas policies lo dejan visible.
--
-- `cliente_id IS NULL` separa staff de cuentas de residente/cliente, que viven
-- en la misma tabla (ver 20260801000400).
CREATE OR REPLACE FUNCTION public.notif_staff_de_proyecto(
  p_company_id uuid,
  p_project_id uuid
)
RETURNS TABLE (user_id uuid)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT au.id
  FROM public.app_users au
  WHERE au.company_id = p_company_id
    AND coalesce(au.activo, true)
    AND au.cliente_id IS NULL
    AND (
      au.role IN ('company_owner', 'admin')
      OR p_project_id IS NULL
      OR au.project_id = p_project_id
      OR EXISTS (
        SELECT 1 FROM public.user_project_assignments upa
        WHERE upa.user_id = au.id AND upa.project_id = p_project_id
      )
    );
$$;

REVOKE ALL ON FUNCTION public.notif_staff_de_proyecto(uuid, uuid) FROM public, anon, authenticated;

COMMENT ON FUNCTION public.notif_staff_de_proyecto(uuid, uuid) IS
  'Usuarios de staff (no cuentas de cliente) que deben recibir el aviso de un evento de un proyecto. company_owner/admin ven toda la empresa; el resto sólo sus proyectos asignados. project_id NULL = ambiguo, avisa a toda la empresa. Misma regla que conversations_select.';

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Helper: encolar un in_app para varios destinatarios
-- ─────────────────────────────────────────────────────────────────────────────
-- Un solo INSERT ... SELECT para todo el fan-out. `p_excluir` deja fuera al
-- autor del evento: nadie necesita que le avisen de su propio mensaje.
-- Devuelve cuántas filas encoló (los tests SQL lo usan como aserción).
CREATE OR REPLACE FUNCTION public.notif_encolar_in_app(
  p_company_id uuid,
  p_user_ids   uuid[],
  p_tipo       text,
  p_titulo     text,
  p_cuerpo     text,
  p_seccion    text,
  p_extra      jsonb DEFAULT '{}'::jsonb
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_n integer;
BEGIN
  IF p_user_ids IS NULL OR cardinality(p_user_ids) = 0 THEN
    RETURN 0;
  END IF;

  WITH insertadas AS (
    INSERT INTO public.notifications_outbox (company_id, channel, payload, recipient)
    SELECT
      p_company_id,
      'in_app',
      coalesce(p_extra, '{}'::jsonb) || jsonb_build_object(
        'user_id', destinatario,   -- el dispatcher lo lee para las preferencias
        'tipo',    p_tipo,
        'titulo',  p_titulo,
        'cuerpo',  p_cuerpo,
        'seccion', p_seccion
      ),
      destinatario::text
    FROM unnest(p_user_ids) AS destinatario
    WHERE destinatario IS NOT NULL
    RETURNING 1
  )
  SELECT count(*)::integer INTO v_n FROM insertadas;

  RETURN coalesce(v_n, 0);
END;
$$;

REVOKE ALL ON FUNCTION public.notif_encolar_in_app(uuid, uuid[], text, text, text, text, jsonb) FROM public, anon, authenticated;

COMMENT ON FUNCTION public.notif_encolar_in_app(uuid, uuid[], text, text, text, text, jsonb) IS
  'Encola una notificación in_app para cada destinatario en un único INSERT. Sin template_key: el dispatcher usa titulo/cuerpo del payload tal cual (dispatchInApp). Devuelve el número de filas encoladas.';

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. MENSAJES: aviso al otro lado de la conversación
-- ─────────────────────────────────────────────────────────────────────────────
-- Quién recibe según quién escribe:
--   · escribe el cliente  → el agente asignado si lo hay; si no, el staff del
--                           proyecto de la conversación.
--   · escribe un agente   → las cuentas del cliente dueño del hilo.
--   · nota interna        → nunca sale del staff (is_internal_note es
--                           explícitamente "sólo visible para agentes").
--   · discusión interna   → el resto del staff del proyecto.
-- El autor nunca se avisa a sí mismo.
--
-- ANTI-RÁFAGA: si en los últimos 10 minutos ya se encoló un in_app de este mismo
-- hilo para ese destinatario, no se encola otro. Sin esto una conversación viva
-- deja veinte campanadas idénticas y el usuario acaba ignorando la campana
-- entera, que es justo lo contrario de lo que se busca.
CREATE OR REPLACE FUNCTION public.fn_notificar_mensaje_conversacion()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_conv        record;
  v_destinos    uuid[];
  v_titulo      text;
  v_cuerpo      text;
  v_extracto    text;
  v_remitente   text;
BEGIN
  SELECT c.id, c.company_id, c.project_id, c.cliente_id, c.cliente_nombre,
         c.subject, c.assigned_to, c.is_internal
    INTO v_conv
    FROM public.conversations c
   WHERE c.id = NEW.conversation_id;

  IF v_conv.id IS NULL OR v_conv.company_id IS NULL THEN
    RETURN NEW;
  END IF;

  IF NEW.sender_type = 'cliente' THEN
    -- Del cliente hacia dentro: al agente asignado, o a todo el staff del hilo.
    IF v_conv.assigned_to IS NOT NULL THEN
      v_destinos := ARRAY[v_conv.assigned_to];
    ELSE
      SELECT array_agg(s.user_id)
        INTO v_destinos
        FROM public.notif_staff_de_proyecto(v_conv.company_id, v_conv.project_id) s;
    END IF;

  ELSIF NEW.is_internal_note OR v_conv.is_internal THEN
    -- Nota interna o discusión de equipo: se queda dentro del staff.
    SELECT array_agg(s.user_id)
      INTO v_destinos
      FROM public.notif_staff_de_proyecto(v_conv.company_id, v_conv.project_id) s;

  ELSE
    -- Respuesta del agente al cliente: a las cuentas de ese cliente.
    IF v_conv.cliente_id IS NULL THEN
      RETURN NEW;
    END IF;
    SELECT array_agg(au.id)
      INTO v_destinos
      FROM public.app_users au
     WHERE au.cliente_id = v_conv.cliente_id
       AND coalesce(au.activo, true);
  END IF;

  -- Fuera el autor: avisarle de su propio mensaje no aporta nada.
  v_destinos := array_remove(coalesce(v_destinos, ARRAY[]::uuid[]), NEW.sender_id);

  -- Anti-ráfaga: quita a quien ya tenga un aviso reciente de este mismo hilo.
  SELECT array_agg(d)
    INTO v_destinos
    FROM unnest(v_destinos) AS d
   WHERE NOT EXISTS (
     SELECT 1 FROM public.notifications_outbox o
      WHERE o.channel = 'in_app'
        AND o.recipient = d::text
        AND o.created_at > now() - interval '10 minutes'
        AND o.payload->>'conversation_id' = NEW.conversation_id::text
   );

  IF v_destinos IS NULL OR cardinality(v_destinos) = 0 THEN
    RETURN NEW;
  END IF;

  v_remitente := coalesce(nullif(NEW.sender_name, ''), coalesce(v_conv.cliente_nombre, 'Alguien'));
  v_extracto  := left(regexp_replace(coalesce(NEW.body, ''), '\s+', ' ', 'g'), 140);

  IF NEW.sender_type = 'cliente' THEN
    v_titulo := 'Mensaje nuevo de ' || v_remitente;
  ELSIF v_conv.is_internal THEN
    v_titulo := 'Mensaje nuevo en la discusión interna';
  ELSE
    v_titulo := 'Mensaje nuevo de ' || v_remitente;
  END IF;

  v_cuerpo := coalesce(nullif(v_conv.subject, ''), 'Conversación')
              || CASE WHEN v_extracto <> '' THEN ' — ' || v_extracto ELSE '' END;

  PERFORM public.notif_encolar_in_app(
    v_conv.company_id,
    v_destinos,
    'mensaje',
    v_titulo,
    v_cuerpo,
    'comunicacion',
    jsonb_build_object('conversation_id', NEW.conversation_id, 'message_id', NEW.id)
  );

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  -- El aviso nunca puede impedir que el mensaje se guarde.
  RAISE WARNING 'fn_notificar_mensaje_conversacion(%): %', NEW.id, SQLERRM;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.fn_notificar_mensaje_conversacion() FROM public, anon, authenticated;

DROP TRIGGER IF EXISTS trg_notif_mensaje_conversacion ON public.conversation_messages;
CREATE TRIGGER trg_notif_mensaje_conversacion
  AFTER INSERT ON public.conversation_messages
  FOR EACH ROW EXECUTE FUNCTION public.fn_notificar_mensaje_conversacion();

COMMENT ON FUNCTION public.fn_notificar_mensaje_conversacion() IS
  'Avisa al otro lado de la conversación de un mensaje nuevo (cliente→staff, staff→cliente, notas internas sólo staff). Excluye al autor y agrupa ráfagas de 10 min por hilo.';

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. DIFUSIONES: aviso in-app al destinatario del comunicado
-- ─────────────────────────────────────────────────────────────────────────────
-- Trigger a nivel SENTENCIA sobre `broadcast_recipients`: create-broadcast los
-- inserta en lotes de 1000, así que un trigger por fila haría 1000 consultas
-- para el mismo comunicado. Con la tabla de transición es un INSERT ... SELECT
-- por lote.
CREATE OR REPLACE FUNCTION public.fn_notificar_difusion()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.notifications_outbox (company_id, channel, payload, recipient)
  SELECT
    b.company_id,
    'in_app',
    jsonb_build_object(
      'user_id',      au.id,
      'tipo',         'difusion',
      'titulo',       'Comunicado: ' || b.title,
      'cuerpo',       left(regexp_replace(coalesce(b.body, ''), '\s+', ' ', 'g'), 200),
      'seccion',      'comunicacion',
      'broadcast_id', b.id,
      'cliente_id',   nuevos.cliente_id
    ),
    au.id::text
  FROM new_rows AS nuevos
  JOIN public.broadcasts b ON b.id = nuevos.broadcast_id
  JOIN public.app_users au ON au.cliente_id = nuevos.cliente_id
   AND coalesce(au.activo, true)
  -- El emisor no se avisa de su propia difusión (puede ser también residente).
  WHERE au.id IS DISTINCT FROM b.sent_by_id;

  RETURN NULL;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'fn_notificar_difusion: %', SQLERRM;
  RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.fn_notificar_difusion() FROM public, anon, authenticated;

DROP TRIGGER IF EXISTS trg_notif_difusion ON public.broadcast_recipients;
CREATE TRIGGER trg_notif_difusion
  AFTER INSERT ON public.broadcast_recipients
  REFERENCING NEW TABLE AS new_rows
  FOR EACH STATEMENT EXECUTE FUNCTION public.fn_notificar_difusion();

COMMENT ON FUNCTION public.fn_notificar_difusion() IS
  'Encola el in_app de un comunicado para las cuentas de cada destinatario. A nivel sentencia porque create-broadcast inserta los recipients en lotes de 1000.';

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. SOLICITUDES: aviso al staff del proyecto
-- ─────────────────────────────────────────────────────────────────────────────
-- Una sola función genérica para las cinco tablas de solicitud: se leen por
-- `to_jsonb(NEW)`, así que una columna que la tabla no tenga sale NULL en vez de
-- romper. TG_ARGV[0] = etiqueta legible, TG_ARGV[1] = sección de navegación.
-- La alternativa —cinco funciones casi idénticas— sólo multiplica el sitio
-- donde arreglar el próximo detalle del texto.
CREATE OR REPLACE FUNCTION public.fn_notificar_solicitud_nueva()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_fila      jsonb := to_jsonb(NEW);
  v_etiqueta  text  := TG_ARGV[0];
  v_seccion   text  := TG_ARGV[1];
  v_company   uuid;
  v_project   uuid;
  v_unidad    text;
  v_detalle   text;
  v_destinos  uuid[];
BEGIN
  v_company := nullif(v_fila->>'company_id', '')::uuid;
  IF v_company IS NULL THEN
    RETURN NEW;
  END IF;
  v_project := nullif(v_fila->>'project_id', '')::uuid;

  SELECT array_agg(s.user_id)
    INTO v_destinos
    FROM public.notif_staff_de_proyecto(v_company, v_project) s;

  IF v_destinos IS NULL OR cardinality(v_destinos) = 0 THEN
    RETURN NEW;
  END IF;

  SELECT u.nombre INTO v_unidad
    FROM public.unidades u
   WHERE u.id = nullif(v_fila->>'unidad_id', '')::uuid;

  -- El texto útil está en una columna distinta según la tabla; se toma la
  -- primera que traiga algo.
  v_detalle := coalesce(
    nullif(v_fila->>'descripcion', ''),
    nullif(v_fila->>'motivo', ''),
    nullif(v_fila->>'observaciones', ''),
    nullif(v_fila->>'tipo', ''),
    ''
  );
  v_detalle := left(regexp_replace(v_detalle, '\s+', ' ', 'g'), 160);

  PERFORM public.notif_encolar_in_app(
    v_company,
    v_destinos,
    'solicitud',
    'Solicitud nueva: ' || v_etiqueta,
    CASE WHEN v_unidad IS NOT NULL THEN 'Unidad ' || v_unidad ELSE 'Sin unidad' END
      || CASE WHEN v_detalle <> '' THEN ' — ' || v_detalle ELSE '' END,
    v_seccion,
    jsonb_build_object('solicitud_id', v_fila->>'id', 'origen', TG_TABLE_NAME)
  );

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  -- El aviso nunca puede impedir que la solicitud se registre.
  RAISE WARNING 'fn_notificar_solicitud_nueva(%): %', TG_TABLE_NAME, SQLERRM;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.fn_notificar_solicitud_nueva() FROM public, anon, authenticated;

COMMENT ON FUNCTION public.fn_notificar_solicitud_nueva() IS
  'Trigger genérico: avisa al staff del proyecto de una solicitud nueva. TG_ARGV[0]=etiqueta legible, TG_ARGV[1]=sección de navegación. Lee la fila vía to_jsonb para servir a tablas con columnas distintas.';

DROP TRIGGER IF EXISTS trg_notif_solicitud_residente ON public.solicitudes_residente;
CREATE TRIGGER trg_notif_solicitud_residente
  AFTER INSERT ON public.solicitudes_residente
  FOR EACH ROW EXECUTE FUNCTION public.fn_notificar_solicitud_nueva('residente', 'condominios');

DROP TRIGGER IF EXISTS trg_notif_solicitud_concierge ON public.solicitudes_concierge;
CREATE TRIGGER trg_notif_solicitud_concierge
  AFTER INSERT ON public.solicitudes_concierge
  FOR EACH ROW EXECUTE FUNCTION public.fn_notificar_solicitud_nueva('concierge', 'condominios');

DROP TRIGGER IF EXISTS trg_notif_solicitud_certificado ON public.solicitudes_certificado;
CREATE TRIGGER trg_notif_solicitud_certificado
  AFTER INSERT ON public.solicitudes_certificado
  FOR EACH ROW EXECUTE FUNCTION public.fn_notificar_solicitud_nueva('certificado', 'condominios');

DROP TRIGGER IF EXISTS trg_notif_solicitud_mudanza ON public.solicitud_mudanza_unidad;
CREATE TRIGGER trg_notif_solicitud_mudanza
  AFTER INSERT ON public.solicitud_mudanza_unidad
  FOR EACH ROW EXECUTE FUNCTION public.fn_notificar_solicitud_nueva('mudanza', 'condominios');

DROP TRIGGER IF EXISTS trg_notif_solicitud_renta ON public.solicitud_renta_unidad;
CREATE TRIGGER trg_notif_solicitud_renta
  AFTER INSERT ON public.solicitud_renta_unidad
  FOR EACH ROW EXECUTE FUNCTION public.fn_notificar_solicitud_nueva('renta', 'condominios');

-- ─────────────────────────────────────────────────────────────────────────────
-- 6. MENSAJES DEL PORTAL: el residente escribe al administrador
-- ─────────────────────────────────────────────────────────────────────────────
-- Tabla aparte de `conversation_messages` (es el canal del portal del
-- residente, no el centro de comunicación), con su propio texto: aquí el asunto
-- y el tipo —una emergencia no es una consulta— son la información útil.
CREATE OR REPLACE FUNCTION public.fn_notificar_mensaje_portal()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_destinos uuid[];
  v_unidad   text;
BEGIN
  SELECT array_agg(s.user_id)
    INTO v_destinos
    FROM public.notif_staff_de_proyecto(NEW.company_id, NEW.project_id) s;

  IF v_destinos IS NULL OR cardinality(v_destinos) = 0 THEN
    RETURN NEW;
  END IF;

  SELECT u.nombre INTO v_unidad FROM public.unidades u WHERE u.id = NEW.unidad_id;

  PERFORM public.notif_encolar_in_app(
    NEW.company_id,
    v_destinos,
    'mensaje',
    CASE NEW.tipo
      WHEN 'emergencia' THEN 'Emergencia reportada desde el portal'
      WHEN 'queja'      THEN 'Queja nueva desde el portal'
      WHEN 'sugerencia' THEN 'Sugerencia nueva desde el portal'
      ELSE 'Mensaje nuevo desde el portal'
    END,
    coalesce('Unidad ' || v_unidad || ' — ', '') || NEW.asunto,
    'condominios',
    jsonb_build_object('mensaje_portal_id', NEW.id, 'unidad_id', NEW.unidad_id)
  );

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'fn_notificar_mensaje_portal(%): %', NEW.id, SQLERRM;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.fn_notificar_mensaje_portal() FROM public, anon, authenticated;

DROP TRIGGER IF EXISTS trg_notif_mensaje_portal ON public.mensajes_portal;
CREATE TRIGGER trg_notif_mensaje_portal
  AFTER INSERT ON public.mensajes_portal
  FOR EACH ROW EXECUTE FUNCTION public.fn_notificar_mensaje_portal();

COMMENT ON FUNCTION public.fn_notificar_mensaje_portal() IS
  'Avisa al staff del proyecto de un mensaje nuevo del portal del residente. El título distingue emergencia/queja/sugerencia/consulta.';
