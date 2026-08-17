-- ════════════════════════════════════════════════════════════════════════════
-- La campana, otra vez: reservas que nadie anunciaba y avisos que no salían
--
-- POR QUÉ
-- Reportado desde producción: "no aparecen las notificaciones de nuevas
-- reservas, solicitudes o mensajes, y eso que han hecho nuevas solicitudes".
-- Son DOS fallos distintos con el mismo síntoma.
--
--   1. RESERVAS — no existía productor. 20260819000000 cubrió mensajes,
--      difusiones y solicitudes; `reservas_amenidades` se quedó fuera, así que
--      una reserva nueva (incluida la que espera aprobación) no avisaba a nadie
--      por diseño. Se arregla con el trigger de la parte 1.
--
--   2. ENTREGA — las filas `in_app` del outbox sólo llegan a
--      `user_notifications` si el edge `notifications-dispatcher` corre. Ese
--      cron (20260604100000) hace un HTTP a la Edge Function vía pg_net y lee
--      su URL y su secreto del Vault:
--
--        IF v_url IS NULL OR v_secret IS NULL THEN RETURN; END IF;
--
--      Es decir: si `notifications_dispatcher_url` /
--      `notifications_dispatcher_cron_secret` no están puestos —y son un par
--      PROPIO, distinto del `route_reminders_*` que sí se configuró y del par
--      compartido `edge_function_url`/`service_role_key` que usan otros crons—
--      el dispatcher no corre, NO da error, y el outbox se llena en silencio.
--      Encaja con el síntoma: lo único que llegó a la campana viene de
--      `route-reminders` y de paquetería, los dos productores que escriben
--      `user_notifications` DIRECTO sin pasar por el outbox.
--
-- CÓMO (parte 2)
-- `in_app` es el único canal que no habla con un proveedor externo: entregarlo
-- es un INSERT en la MISMA base. Hacerlo depender de un viaje de ida y vuelta
-- (pg_cron → pg_net → Edge Function → base) es fragilidad sin contrapartida.
-- `despachar_in_app_pendientes()` materializa en SQL las filas `in_app` que
-- llevan rezagadas más de `p_retraso`, con el mismo claim atómico
-- (FOR UPDATE SKIP LOCKED) y los mismos sellos de estado que usa el edge:
--
--   · No compite con el dispatcher: el retraso (60s por defecto) le cede el
--     turno. El cron del edge corre cada minuto, así que cuando está sano se
--     lleva todo antes de que esta función mire; sólo recoge lo que quedó
--     tirado. Y si dos procesos miran a la vez, el claim atómico decide: el que
--     no obtiene el lock ni siquiera ve la fila.
--   · Sella `provider_message_id` con el id de la fila de la campana, igual que
--     `dispatchInApp`, para que el trigger de lectura (20260709100000) siga
--     correlacionando el "leído" con su fila del outbox.
--   · Al aplicarse, DRENA lo ya acumulado: las notificaciones represadas
--     aparecen en la campana en la siguiente corrida.
--
-- LO QUE ESTO NO ARREGLA: los `email` del outbox siguen necesitando el edge
-- (Gmail está fuera de la base). Si el dispatcher está caído, esos correos
-- siguen sin salir — hay que poner las dos claves del Vault igual. Esta
-- migración evita que la campana dependa de ello, no sustituye al dispatcher.
--
-- CÓMO REVERTIR
--   DROP TRIGGER trg_notif_reserva_nueva ON public.reservas_amenidades;
--   DROP FUNCTION public.fn_notificar_reserva_nueva();
--   SELECT cron.unschedule('notif_in_app_fallback');
--   DROP FUNCTION public.despachar_in_app_pendientes(integer, interval);
--   DROP FUNCTION public.run_despachar_in_app_pendientes();
--
-- Idempotente: CREATE OR REPLACE, DROP TRIGGER IF EXISTS antes de CREATE,
-- unschedule defensivo antes de schedule.
-- ════════════════════════════════════════════════════════════════════════════

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. RESERVAS: aviso al staff del proyecto
-- ─────────────────────────────────────────────────────────────────────────────
-- Una reserva `pendiente` espera una decisión del equipo (la amenidad pide
-- aprobación) y una `confirmada` es sólo para enterarse; el título lo dice,
-- porque no son la misma urgencia. Las canceladas no avisan: nacen así sólo si
-- alguien las importa, y una cancelación no es trabajo entrante.
--
-- El autor no se avisa a sí mismo (`created_by`), igual que en los demás
-- triggers: cuando la reserva la mete el propio staff desde el panel, el aviso
-- iría a quien acaba de escribirla.
CREATE OR REPLACE FUNCTION public.fn_notificar_reserva_nueva()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_destinos uuid[];
  v_unidad   text;
  v_amenidad text;
  v_titulo   text;
BEGIN
  IF NEW.estado = 'cancelada' THEN
    RETURN NEW;
  END IF;

  SELECT array_agg(s.user_id)
    INTO v_destinos
    FROM public.notif_staff_de_proyecto(NEW.company_id, NEW.project_id) s;

  v_destinos := array_remove(coalesce(v_destinos, ARRAY[]::uuid[]), NEW.created_by);
  IF cardinality(v_destinos) = 0 THEN
    RETURN NEW;
  END IF;

  SELECT u.nombre INTO v_unidad   FROM public.unidades  u WHERE u.id = NEW.unidad_id;
  SELECT a.nombre INTO v_amenidad FROM public.amenidades a WHERE a.id = NEW.amenidad_id;

  v_titulo := CASE NEW.estado
    WHEN 'pendiente' THEN 'Reserva pendiente de aprobación'
    ELSE 'Reserva nueva'
  END;

  PERFORM public.notif_encolar_in_app(
    NEW.company_id,
    v_destinos,
    'reserva',
    v_titulo,
    concat_ws(' · ',
      coalesce(v_amenidad, 'Amenidad'),
      CASE WHEN v_unidad IS NOT NULL THEN 'Unidad ' || v_unidad END,
      to_char(NEW.fecha, 'DD/MM/YYYY') || ' ' || to_char(NEW.hora_inicio, 'HH24:MI')
        || '–' || to_char(NEW.hora_fin, 'HH24:MI')
    ),
    'condominios',
    jsonb_build_object(
      'reserva_id',  NEW.id,
      'amenidad_id', NEW.amenidad_id,
      'unidad_id',   NEW.unidad_id
    )
  );

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  -- El aviso jamás puede tumbar la reserva: el residente ya la pagó/confirmó.
  RAISE WARNING 'fn_notificar_reserva_nueva(%): %', NEW.id, SQLERRM;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.fn_notificar_reserva_nueva() FROM public, anon, authenticated;

DROP TRIGGER IF EXISTS trg_notif_reserva_nueva ON public.reservas_amenidades;
CREATE TRIGGER trg_notif_reserva_nueva
  AFTER INSERT ON public.reservas_amenidades
  FOR EACH ROW EXECUTE FUNCTION public.fn_notificar_reserva_nueva();

COMMENT ON FUNCTION public.fn_notificar_reserva_nueva() IS
  'Avisa al staff del proyecto de una reserva nueva de amenidad. Distingue pendiente de aprobación vs confirmada; ignora las canceladas y no avisa a quien la creó.';

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Entrega in_app en la propia base (red de seguridad del dispatcher)
-- ─────────────────────────────────────────────────────────────────────────────
-- Espejo SQL de `dispatchInApp` (notifications-dispatcher/index.ts): mismo
-- destino, mismas columnas, mismos sellos. La diferencia deliberada es que NO
-- resuelve `template_key` contra notification_templates — eso vive en el edge.
-- Todos los productores in_app actuales (`notif_encolar_in_app` y el de
-- anuncios) ya escriben `titulo`/`cuerpo` en el payload, así que la plantilla
-- sólo aportaría un texto alternativo; entregar el del payload es infinitamente
-- mejor que no entregar nada. Las filas SIN `titulo` se dejan para el edge.
--
-- Devuelve cuántas entregó (el cron lo ignora; los tests lo usan como aserción).
CREATE OR REPLACE FUNCTION public.despachar_in_app_pendientes(
  p_lote    integer  DEFAULT 200,
  p_retraso interval DEFAULT interval '60 seconds'
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ids      uuid[];
  v_fila     record;
  v_notif_id uuid;
  v_n        integer := 0;
BEGIN
  -- Claim en UNA sentencia (igual que claim_notifications_batch): marca las
  -- filas 'sending' y se queda con sus ids. Recorrerlas después, y no sobre el
  -- RETURNING del propio UPDATE, deja el claim cerrado antes de volver a tocar
  -- la tabla dentro del bucle.
  WITH tomadas AS (
    SELECT o.id
    FROM public.notifications_outbox o
    WHERE o.status = 'queued'
      AND o.channel = 'in_app'
      AND o.scheduled_at <= now() - p_retraso
      -- recipient = user_id; sin él dispatchInApp también falla (no retriable).
      AND o.recipient IS NOT NULL
      AND coalesce(o.payload->>'titulo', '') <> ''
    ORDER BY o.scheduled_at
    LIMIT GREATEST(p_lote, 1)
    FOR UPDATE SKIP LOCKED
  ), marcadas AS (
    UPDATE public.notifications_outbox u
    SET status = 'sending', updated_at = now()
    FROM tomadas
    WHERE u.id = tomadas.id
    RETURNING u.id
  )
  SELECT array_agg(id) INTO v_ids FROM marcadas;

  IF v_ids IS NULL THEN
    RETURN 0;
  END IF;

  FOR v_fila IN
    SELECT o.id, o.company_id, o.payload, o.recipient
    FROM public.notifications_outbox o
    WHERE o.id = ANY(v_ids)
  LOOP
    BEGIN
      INSERT INTO public.user_notifications
        (user_id, company_id, tipo, titulo, cuerpo, seccion, ruta_id, ocurrencia_id)
      VALUES (
        v_fila.recipient::uuid,
        v_fila.company_id,
        coalesce(nullif(v_fila.payload->>'tipo', ''), 'notificacion'),
        v_fila.payload->>'titulo',
        nullif(v_fila.payload->>'cuerpo', ''),
        nullif(v_fila.payload->>'seccion', ''),
        nullif(v_fila.payload->>'ruta_id', '')::uuid,
        nullif(v_fila.payload->>'ocurrencia_id', '')::uuid
      )
      RETURNING id INTO v_notif_id;

      UPDATE public.notifications_outbox
      SET status              = 'sent',
          sent_at             = now(),
          provider_message_id = v_notif_id::text,
          last_error          = NULL,
          updated_at          = now()
      WHERE id = v_fila.id;

      v_n := v_n + 1;
    EXCEPTION WHEN OTHERS THEN
      -- Un destinatario borrado o un payload torcido no puede dejar la fila
      -- clavada en 'sending' para siempre: vuelve a la cola con el error a la
      -- vista y un respiro, con el mismo tope de intentos que el edge.
      UPDATE public.notifications_outbox
      SET status       = CASE WHEN attempts + 1 >= max_attempts THEN 'failed' ELSE 'queued' END,
          attempts     = attempts + 1,
          last_error   = SQLERRM,
          scheduled_at = now() + interval '5 minutes',
          updated_at   = now()
      WHERE id = v_fila.id;
    END;
  END LOOP;

  RETURN v_n;
END;
$$;

REVOKE ALL ON FUNCTION public.despachar_in_app_pendientes(integer, interval) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.despachar_in_app_pendientes(integer, interval) TO service_role;

COMMENT ON FUNCTION public.despachar_in_app_pendientes(integer, interval) IS
  'Entrega en SQL las notificaciones in_app del outbox rezagadas más de p_retraso: INSERT en user_notifications + sellos sent/provider_message_id, con claim FOR UPDATE SKIP LOCKED. Red de seguridad de notifications-dispatcher, que sólo corre si sus claves del Vault están puestas. No resuelve template_key (eso es del edge).';

-- Envoltorio sin argumentos: pg_cron guarda texto SQL y así el job no depende de
-- la firma (si mañana cambian los defaults, el job sigue igual).
CREATE OR REPLACE FUNCTION public.run_despachar_in_app_pendientes()
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$ SELECT public.despachar_in_app_pendientes(); $$;

REVOKE ALL ON FUNCTION public.run_despachar_in_app_pendientes() FROM public, anon, authenticated;

COMMENT ON FUNCTION public.run_despachar_in_app_pendientes() IS
  'Entrada del cron notif_in_app_fallback: despacha el in_app rezagado con los defaults de despachar_in_app_pendientes.';

-- pg_cron cada minuto. Reschedule idempotente, igual que 20260604100000.
DO $$
BEGIN
  PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname = 'notif_in_app_fallback';
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

DO $$
BEGIN
  PERFORM cron.schedule(
    'notif_in_app_fallback',
    '* * * * *',
    $cron$SELECT public.run_despachar_in_app_pendientes();$cron$
  );
EXCEPTION WHEN OTHERS THEN
  -- Sin pg_cron (entornos de test en Postgres pelado) la función queda igual y
  -- se puede invocar a mano; no es motivo para abortar la migración.
  RAISE NOTICE 'pg_cron no disponible: notif_in_app_fallback sin programar (%)', SQLERRM;
END $$;
