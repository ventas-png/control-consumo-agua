-- ============================================================================
-- Endurecimiento del tracking de apertura de correos (com:N4, sobre #726)
-- ============================================================================
-- El píxel de apertura es un endpoint PÚBLICO sin autenticar (track-email-open,
-- verify_jwt=false). Su autorización —token HMAC firmado— es sólida, pero el
-- camino de escritura que abre no tenía tope: CADA petición con un token válido
-- llegaba a la base y escribía, aunque el sello ya estuviera puesto.
--
-- Eso importa porque las peticiones repetidas son la norma, no la excepción:
-- los proxies de imágenes de Gmail/Outlook recargan el píxel, y quien reciba un
-- correo puede reenviarlo o reabrirlo indefinidamente. Antes de este cambio,
-- `mark_notification_delivery('read')` INSERTABA una fila en notification_events
-- en cada una de esas peticiones — crecimiento sin cota de una tabla, disparable
-- desde fuera con un solo token legítimo.
--
-- Este cambio hace que ambas RPCs sean no-op REAL cuando el evento no cambia el
-- estado: ni UPDATE ni fila de evento. El rastro append-only se conserva para
-- las TRANSICIONES, que es lo que se quería registrar; lo que desaparece son los
-- duplicados del mismo evento.
--
-- Idempotente: solo CREATE OR REPLACE.
-- ============================================================================

-- ────────────────────────────────────────────────────────────────────────────
-- 1. mark_email_open — no escribir si ya estaba sellado
-- ────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.mark_email_open(p_tracking_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  -- El `AND opened_at IS NULL` es el tope: la segunda apertura y las siguientes
  -- no tocan la fila. Antes el COALESCE conservaba el valor pero el UPDATE se
  -- ejecutaba igual, generando WAL y despertando triggers en cada píxel.
  UPDATE public.email_send_log
  SET opened_at = now()
  WHERE tracking_id = p_tracking_id
    AND opened_at IS NULL;
END;
$$;

COMMENT ON FUNCTION public.mark_email_open IS
  'Marca opened_at (primera apertura) de un envío de send-email por su tracking_id. No-op real en aperturas posteriores: no escribe. Solo service_role (track-email-open).';

-- ────────────────────────────────────────────────────────────────────────────
-- 2. mark_notification_delivery — salir antes si el evento no cambia el estado
-- ────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.mark_notification_delivery(
  p_outbox_id uuid,
  p_event     text,
  p_detail    jsonb DEFAULT '{}'::jsonb
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_status       text;
  v_delivered_at timestamptz;
  v_read_at      timestamptz;
  v_bounced_at   timestamptz;
BEGIN
  IF p_event NOT IN ('delivered', 'read', 'bounced') THEN
    RAISE EXCEPTION 'evento de entrega invalido: %', p_event;
  END IF;

  SELECT status, delivered_at, read_at, bounced_at
    INTO v_status, v_delivered_at, v_read_at, v_bounced_at
  FROM public.notifications_outbox
  WHERE id = p_outbox_id
  FOR UPDATE;

  IF v_status IS NULL OR v_status NOT IN ('sent', 'delivered', 'read') THEN
    RETURN;  -- inexistente o aún no entregada al proveedor: no-op
  END IF;

  -- TOPE DE ESCRITURA: si el sello de este evento ya está puesto, el evento no
  -- aporta información nueva. Se sale ANTES del UPDATE y —sobre todo— antes del
  -- INSERT en notification_events. Sin esto, un endpoint público sin autenticar
  -- podía hacer crecer esa tabla sin límite con un único token válido.
  IF (p_event = 'read'      AND v_read_at      IS NOT NULL)
  OR (p_event = 'delivered' AND v_delivered_at IS NOT NULL)
  OR (p_event = 'bounced'   AND v_bounced_at   IS NOT NULL) THEN
    RETURN;
  END IF;

  IF p_event = 'delivered' THEN
    UPDATE public.notifications_outbox
    SET delivered_at = now(),
        -- no degradar 'read' a 'delivered'
        status = CASE WHEN status = 'read' THEN 'read' ELSE 'delivered' END,
        updated_at = now()
    WHERE id = p_outbox_id;
  ELSIF p_event = 'read' THEN
    UPDATE public.notifications_outbox
    SET read_at = now(),
        -- una apertura implica entrega
        delivered_at = COALESCE(delivered_at, now()),
        status = 'read',
        updated_at = now()
    WHERE id = p_outbox_id;
  ELSE  -- bounced
    UPDATE public.notifications_outbox
    SET bounced_at = now(),
        bounce_reason = COALESCE(NULLIF(p_detail->>'reason', ''), bounce_reason),
        status = 'bounced',
        updated_at = now()
    WHERE id = p_outbox_id;
  END IF;

  -- Append-only para TRANSICIONES: se llega aquí solo cuando el sello estaba
  -- vacío, así que hay como mucho una fila por (outbox_id, event_type).
  INSERT INTO public.notification_events (outbox_id, event_type, detail)
  VALUES (p_outbox_id, p_event, COALESCE(p_detail, '{}'::jsonb));
END;
$$;

COMMENT ON FUNCTION public.mark_notification_delivery IS
  'Máquina de estados de entrega del outbox (delivered/read/bounced). Solo avanza desde sent/delivered/read y nunca resucita fallidas. No-op real si el sello del evento ya estaba puesto: ni UPDATE ni fila de evento. Solo service_role.';
