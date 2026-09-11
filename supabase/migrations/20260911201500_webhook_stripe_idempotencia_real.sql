-- ════════════════════════════════════════════════════════════════════════════
-- El webhook de Stripe marcaba el evento como visto ANTES de procesarlo
-- ════════════════════════════════════════════════════════════════════════════
-- `stripe-webhook-handler` insertaba en `stripe_webhook_events` nada más
-- verificar la firma, y respondía `200 already_processed` ante un duplicado.
-- Pero la tabla trae desde 20260528000040 dos columnas —`processed_at` y
-- `error_message`— que el handler NUNCA escribió. Consecuencia:
--
--   1. El evento se reclama.
--   2. El procesamiento revienta (o la función se corta a medias).
--   3. Stripe reintenta. Encuentra la fila. Responde 200 «ya procesado».
--   4. Nunca se acreditó nada, y no queda nadie que lo vuelva a intentar.
--
-- «Ya lo vi» y «ya lo terminé» son cosas distintas, y confundirlas convierte un
-- fallo transitorio en una pérdida definitiva. Un webhook de cobro no puede
-- permitírselo: del otro lado hay un cliente al que ya se le cobró la tarjeta.
--
-- ── LO QUE AÑADE ESTA MIGRACIÓN ─────────────────────────────────────────────
--   · `estado` con las cuatro fases reales: recibido · procesando ·
--     completado · fallido. Con CHECK, para que un quinto valor no entre por
--     descuido.
--   · `intentos`, que hace visible el evento que Stripe reintenta sin parar.
--   · `stripe_webhook_evento_reclamar()` — reclama el evento en UNA sentencia
--     (`INSERT … ON CONFLICT DO UPDATE … WHERE`), no con un SELECT y luego un
--     INSERT. Dos entregas simultáneas del mismo evento son exactamente el caso
--     que un check-then-insert deja pasar, y es el mismo fallo que
--     20260911042839 cerró en la conciliación.
--   · `stripe_webhook_evento_cerrar()` — sella el resultado, con su error si lo
--     hubo. `processed_at` SÓLO se escribe cuando terminó bien, y es esa columna
--     —no el `estado` a solas— la que autoriza a responderle 200 a un
--     reintento.
--   · Procedencia de la verificación en `conciliar_pago_externo`, ver abajo.
--
-- ── «verificado» Y «aplicado» SON DOS HECHOS, NO DOS NOMBRES DEL MISMO ──────
-- El camino de Stripe escribía `pagos.estado = 'verificado'` con
-- `verified_by = 'stripe_webhook'`, y NO acreditaba el recibo.
-- `conciliar_pago_externo` escribe `'aplicado'` y SÍ acredita. Reutilizar la RPC
-- tal cual —que es lo correcto, porque acreditar es justo lo que faltaba—
-- perdería por el camino quién verificó el cobro. Y esa procedencia no es
-- decorativa: es lo único que prueba que el dinero se movió de verdad.
--
--   verificado → la firma HMAC de Stripe demuestra que el cobro OCURRIÓ.
--                Es autenticidad. La aporta el webhook.
--   aplicado   → el importe se ACREDITÓ contra el recibo o la cuota.
--                Es contabilidad. La aporta la conciliación.
--
-- Un pago por Stripe es las dos cosas. Así que `conciliar_pago_externo` recibe
-- dos parámetros opcionales de procedencia y los escribe EN LA MISMA
-- transacción: el pago queda `aplicado` y conserva `verified_by` y
-- `verified_at`. Hacerlo con un UPDATE posterior desde el edge reintroduciría
-- la segunda transacción que 20260911042839 vino a eliminar.
--
-- Los parámetros van con DEFAULT NULL y al final: `confirm-charge`, que llama
-- con un solo argumento nombrado, sigue funcionando sin tocarlo. Se hace con
-- DROP + CREATE y no con CREATE OR REPLACE porque cambiar la aridad crearía una
-- SOBRECARGA, y con parámetros por defecto una llamada de un argumento quedaría
-- ambigua en tiempo de ejecución.
--
-- REVERSIÓN
--   -- volver a 20260911042839 para conciliar_pago_externo (mismo cuerpo, sin
--   -- los dos parámetros de procedencia y sin las dos columnas del INSERT);
--   DROP FUNCTION IF EXISTS public.stripe_webhook_evento_reclamar(text, text, boolean, jsonb);
--   DROP FUNCTION IF EXISTS public.stripe_webhook_evento_cerrar(text, boolean, text);
--   ALTER TABLE public.stripe_webhook_events DROP COLUMN IF EXISTS estado;
--   ALTER TABLE public.stripe_webhook_events DROP COLUMN IF EXISTS intentos;
--
-- Idempotente: ADD COLUMN IF NOT EXISTS, CREATE OR REPLACE, DROP … IF EXISTS.
-- ════════════════════════════════════════════════════════════════════════════

-- ── 1. Las cuatro fases ─────────────────────────────────────────────────────
ALTER TABLE public.stripe_webhook_events
  ADD COLUMN IF NOT EXISTS estado   text NOT NULL DEFAULT 'recibido',
  ADD COLUMN IF NOT EXISTS intentos integer NOT NULL DEFAULT 0;

-- Los que ya existen: si tienen `processed_at` es que el handler viejo llegó al
-- final, así que son `completado`. Los demás quedan `recibido` — y eso es
-- exactamente lo que hay que decir de ellos: se recibieron, y no consta que se
-- hayan terminado. Marcarlos `completado` sería inventar un hecho.
UPDATE public.stripe_webhook_events
   SET estado = 'completado'
 WHERE processed_at IS NOT NULL AND estado = 'recibido';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'stripe_webhook_events_estado_check'
       AND conrelid = 'public.stripe_webhook_events'::regclass
  ) THEN
    ALTER TABLE public.stripe_webhook_events
      ADD CONSTRAINT stripe_webhook_events_estado_check
      CHECK (estado IN ('recibido', 'procesando', 'completado', 'fallido'));
  END IF;
END $$;

COMMENT ON COLUMN public.stripe_webhook_events.estado IS
  'Fase del evento: recibido (insertado y nada más) · procesando (reclamado por una invocación viva) · completado (procesado de punta a punta; SÓLO este justifica responderle 200 a un reintento) · fallido (se intentó y se cayó; el reintento de Stripe DEBE volver a intentarlo).';

CREATE INDEX IF NOT EXISTS idx_stripe_webhook_events_sin_terminar
  ON public.stripe_webhook_events (received_at DESC)
  WHERE estado <> 'completado';

-- ── 2. Reclamar el evento, en UNA sentencia ─────────────────────────────────
-- Devuelve `reclamado`:
--   true  → este invocador es el dueño; hay que procesar.
--   false → `ya_completado` dice si fue porque otro ya lo terminó (responder
--           200 y no re-aplicar) o porque otro lo tiene en vuelo (responder
--           reintentable: que Stripe lo traiga de nuevo).
--
-- La condición del DO UPDATE es la clave: se re-reclama lo que está `recibido`,
-- `fallido` o `procesando` RANCIO —una invocación que murió sin cerrar—, y
-- NUNCA lo `completado`. El umbral de rancio es deliberadamente holgado: el
-- coste de re-procesar tarde es que `conciliar_pago_externo` responda
-- `ya_conciliado`, que es inofensivo; el coste de darlo por terminado sin serlo
-- es un cobro sin acreditar.
CREATE OR REPLACE FUNCTION public.stripe_webhook_evento_reclamar(
  p_event_id   text,
  p_event_type text,
  p_livemode   boolean,
  p_payload    jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_rol    text;
  v_fila   public.stripe_webhook_events;
  v_previo public.stripe_webhook_events;
BEGIN
  v_rol := COALESCE(
    (NULLIF(current_setting('request.jwt.claims', true), '')::jsonb) ->> 'role', '');
  IF v_rol <> 'service_role' AND current_user <> 'service_role' THEN
    RAISE EXCEPTION 'stripe_webhook_evento_reclamar es del webhook, no de un usuario'
      USING ERRCODE = '42501';
  END IF;

  IF p_event_id IS NULL OR p_event_id = '' THEN
    RAISE EXCEPTION 'falta el event_id de Stripe' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.stripe_webhook_events AS e
    (event_id, event_type, livemode, payload, estado, intentos)
  VALUES
    (p_event_id, p_event_type, COALESCE(p_livemode, false),
     COALESCE(p_payload, '{}'::jsonb), 'procesando', 1)
  ON CONFLICT (event_id) DO UPDATE
    SET estado   = 'procesando',
        intentos = e.intentos + 1
    -- «Terminado» exige LAS DOS cosas: `estado = 'completado'` Y un
    -- `processed_at` que lo confirme. No es redundancia: son dos columnas, y
    -- dos columnas pueden divergir —una reparación a mano, un backfill, un
    -- error futuro—. Si divergen, la lectura segura es «no consta que
    -- terminara», porque el coste de re-procesar es que la conciliación
    -- responda `ya_conciliado` (inofensivo) y el de darlo por hecho sin serlo
    -- es un cobro que nadie acredita nunca.
    WHERE NOT (e.estado = 'completado' AND e.processed_at IS NOT NULL)
      AND (e.estado <> 'procesando' OR e.received_at < now() - interval '15 minutes')
  RETURNING * INTO v_fila;

  IF FOUND THEN
    RETURN jsonb_build_object(
      'reclamado', true, 'ya_completado', false, 'intentos', v_fila.intentos);
  END IF;

  -- El DO UPDATE no tocó nada: o está completado, o alguien lo tiene en vuelo.
  -- Hay que mirar la fila para decir CUÁL de las dos, porque la respuesta HTTP
  -- es distinta: 200 definitivo contra 409 reintentable.
  SELECT * INTO v_previo FROM public.stripe_webhook_events
   WHERE event_id = p_event_id;

  RETURN jsonb_build_object(
    'reclamado', false,
    -- Mismo criterio que el WHERE de arriba: sin `processed_at` no hay
    -- constancia de que terminara, y el edge NO debe responder 200.
    'ya_completado', (COALESCE(v_previo.estado, '') = 'completado'
                      AND v_previo.processed_at IS NOT NULL),
    'estado_previo', v_previo.estado,
    'intentos', COALESCE(v_previo.intentos, 0));
END;
$$;

COMMENT ON FUNCTION public.stripe_webhook_evento_reclamar(text, text, boolean, jsonb) IS
  'Reclama un evento de Stripe para procesarlo, en UNA sentencia (INSERT … ON CONFLICT DO UPDATE … WHERE). Devuelve reclamado=true si hay que procesar; si no, ya_completado distingue «otro lo terminó» (200) de «otro lo tiene en vuelo» (reintentable). Sólo service_role.';

REVOKE EXECUTE ON FUNCTION public.stripe_webhook_evento_reclamar(text, text, boolean, jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.stripe_webhook_evento_reclamar(text, text, boolean, jsonb)
  TO service_role;

-- ── 3. Cerrar el evento ─────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.stripe_webhook_evento_cerrar(
  p_event_id text,
  p_ok       boolean,
  p_error    text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_rol text;
BEGIN
  v_rol := COALESCE(
    (NULLIF(current_setting('request.jwt.claims', true), '')::jsonb) ->> 'role', '');
  IF v_rol <> 'service_role' AND current_user <> 'service_role' THEN
    RAISE EXCEPTION 'stripe_webhook_evento_cerrar es del webhook, no de un usuario'
      USING ERRCODE = '42501';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.stripe_webhook_events WHERE event_id = p_event_id) THEN
    -- Cerrar un evento que no está reclamado significa que el edge perdió el
    -- hilo. Callarlo dejaría el resultado sin sellar y el evento retomable por
    -- el umbral de rancio, que es tarde.
    RAISE EXCEPTION 'no hay evento % que cerrar', p_event_id USING ERRCODE = 'P0002';
  END IF;

  UPDATE public.stripe_webhook_events
     SET estado        = CASE WHEN p_ok THEN 'completado' ELSE 'fallido' END,
         -- `processed_at` sólo se sella cuando terminó BIEN. Un fallo no es un
         -- procesamiento: dejarle fecha invitaría a leerlo como hecho.
         processed_at  = CASE WHEN p_ok THEN now() ELSE processed_at END,
         error_message = CASE WHEN p_ok THEN NULL ELSE left(COALESCE(p_error, 'error sin detalle'), 2000) END
   WHERE event_id = p_event_id;
END;
$$;

COMMENT ON FUNCTION public.stripe_webhook_evento_cerrar(text, boolean, text) IS
  'Sella el resultado de un evento de Stripe: completado (con processed_at) o fallido (con error_message y SIN processed_at). Sólo service_role.';

REVOKE EXECUTE ON FUNCTION public.stripe_webhook_evento_cerrar(text, boolean, text)
  FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.stripe_webhook_evento_cerrar(text, boolean, text)
  TO service_role;


-- ── 4. La procedencia de la verificación, dentro de la misma transacción ────
-- DROP de la firma VIEJA y CREATE OR REPLACE de la nueva. El DROP hace falta
-- porque cambiar la aridad no reemplaza: crearía una SOBRECARGA, y con
-- parámetros por defecto `conciliar_pago_externo(uuid)` quedaría ambigua en
-- tiempo de ejecución. El OR REPLACE hace falta para que aplicar la migración
-- dos veces no falle — lo cazó el arnés, que aplica toda la cadena por
-- duplicado justo para eso.
--
-- El cuerpo es el de 20260911042839 palabra por palabra; lo único que cambia
-- son los dos parámetros de la firma y las dos columnas del INSERT.
DROP FUNCTION IF EXISTS public.conciliar_pago_externo(uuid);

CREATE OR REPLACE FUNCTION public.conciliar_pago_externo(
  p_payment_request_id uuid,
  -- PROCEDENCIA DE LA VERIFICACIÓN. Opcionales y al final: `confirm-charge`
  -- llama con un solo argumento nombrado y no se entera. Los usa el webhook de
  -- Stripe, donde la firma HMAC es lo que prueba que el cobro ocurrió — y ese
  -- hecho tiene que viajar EN LA MISMA transacción que la acreditación, no en
  -- un UPDATE posterior.
  p_verificado_por text DEFAULT NULL,
  p_verificado_en  timestamptz DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_rol       text;
  v_pr        public.payment_requests;
  v_pago_id   uuid;
  v_reg       public.registros;
  v_cuota     public.cuotas_condominio;
  v_ref       text;
  v_metodo    text;
  v_proyecto  uuid;
  v_total     numeric;
  v_abonado   numeric;
  v_liquida   boolean;
  v_saldo     numeric;
  v_ahora     timestamptz := now();
BEGIN
  -- El GRANT deja fuera a anon y authenticated, pero una función SECURITY
  -- DEFINER del esquema corre como el DUEÑO y tiene EXECUTE implícito sobre
  -- todo: por eso se comprueba además el rol efectivo. Mismo criterio que
  -- `agua_registro_acreditar_pago_externo` (20260911031701).
  v_rol := COALESCE(
    (NULLIF(current_setting('request.jwt.claims', true), '')::jsonb) ->> 'role', '');
  IF v_rol <> 'service_role' AND current_user <> 'service_role' THEN
    RAISE EXCEPTION 'conciliar_pago_externo es del proveedor de pago, no de un usuario'
      USING ERRCODE = '42501';
  END IF;

  IF p_payment_request_id IS NULL THEN
    RAISE EXCEPTION 'falta la solicitud de cobro' USING ERRCODE = '22023';
  END IF;

  -- EL BLOQUEO, PRIMERO. Todo lo que sigue ocurre con esta fila retenida hasta
  -- el COMMIT, así que la segunda confirmación de la misma solicitud espera
  -- aquí y, cuando entra, ya ve `succeeded`.
  SELECT * INTO v_pr FROM public.payment_requests pr
   WHERE pr.id = p_payment_request_id
     FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'solicitud de cobro no encontrada' USING ERRCODE = 'P0002';
  END IF;

  -- YA CONCILIADA: se devuelve lo que hay y no se acredita de nuevo. Esto es
  -- lo que hace que el reintento del cron sea barato y seguro.
  IF v_pr.estado = 'succeeded' THEN
    SELECT p.id INTO v_pago_id FROM public.pagos p
     WHERE p.payment_request_id = v_pr.id;

    -- El estado del ítem se LEE, no se recalcula: esta rama no acredita nada.
    IF v_pr.registro_id IS NOT NULL THEN
      SELECT * INTO v_reg FROM public.registros r WHERE r.id = v_pr.registro_id;
      v_total   := COALESCE(v_reg.total_a_pagar, v_reg.monto_calculado, 0);
      v_liquida := v_reg.estado = 'pagado';
      v_saldo   := round(GREATEST(v_total - COALESCE(v_reg.monto_pagado, 0), 0), 2);
    ELSE
      SELECT * INTO v_cuota FROM public.cuotas_condominio c WHERE c.id = v_pr.cuota_id;
      SELECT COALESCE(sum(p.monto), 0) INTO v_abonado
        FROM public.pagos p
       WHERE p.cuota_id = v_pr.cuota_id AND p.deleted_at IS NULL;
      v_total   := COALESCE(v_cuota.total_a_pagar, v_cuota.monto, 0);
      v_liquida := v_total > 0 AND (v_total - v_abonado) <= 0.005;
      v_saldo   := round(GREATEST(v_total - v_abonado, 0), 2);
    END IF;

    RETURN jsonb_build_object(
      'ok', true, 'ya_conciliado', true, 'pago_id', v_pago_id,
      'liquidado', v_liquida, 'saldo_restante', v_saldo);
  END IF;

  -- Un cobro paga un recibo O una cuota, nunca los dos ni ninguno.
  IF (v_pr.registro_id IS NULL) = (v_pr.cuota_id IS NULL) THEN
    RAISE EXCEPTION 'la solicitud de cobro no apunta a exactamente un ítem'
      USING ERRCODE = '22023';
  END IF;
  IF COALESCE(v_pr.monto, 0) <= 0 THEN
    RAISE EXCEPTION 'la solicitud de cobro no tiene monto' USING ERRCODE = '22023';
  END IF;

  -- Referencia del proveedor: la genérica, o la de stripe/paypal que tienen
  -- columna propia. Es informativa — la idempotencia ya no depende de ella.
  v_ref := COALESCE(v_pr.provider_ref, v_pr.stripe_payment_intent, v_pr.paypal_order_id);

  -- Sello anti-confusión (auditoría C1): lo aprobado por el proveedor SIMULADO
  -- se marca 'sandbox' y nunca se confunde con dinero real. Sale de
  -- `payment_requests.provider`, no de lo que diga el edge.
  v_metodo := CASE WHEN v_pr.provider = 'sandbox' THEN 'sandbox' ELSE 'tarjeta_credito' END;

  -- ── El ítem: bloquear, y de ahí sacar proyecto y total ────────────────────
  IF v_pr.registro_id IS NOT NULL THEN
    SELECT * INTO v_reg FROM public.registros r
     WHERE r.id = v_pr.registro_id AND r.deleted_at IS NULL
       FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'recibo no encontrado' USING ERRCODE = 'P0002';
    END IF;
    v_proyecto := v_reg.project_id;
    v_total    := COALESCE(v_reg.total_a_pagar, v_reg.monto_calculado, 0);
  ELSE
    SELECT * INTO v_cuota FROM public.cuotas_condominio c
     WHERE c.id = v_pr.cuota_id AND c.deleted_at IS NULL
       FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'cuota no encontrada' USING ERRCODE = 'P0002';
    END IF;
    v_proyecto := v_cuota.project_id;
    v_total    := COALESCE(v_cuota.total_a_pagar, v_cuota.monto, 0);
    -- La cuota no lleva acumulador propio: su abonado es la suma de sus pagos.
    -- Se calcula DESPUÉS del INSERT de abajo, con la cuota ya bloqueada.
  END IF;

  -- ── El pago ──────────────────────────────────────────────────────────────
  -- La llave única es la SEGUNDA línea de defensa, detrás del bloqueo. Con el
  -- bloqueo puesto no debería alcanzarse —quien insertó el pago dejó también
  -- la solicitud en `succeeded`, o revirtió las dos cosas—, pero si se alcanza
  -- hay que tratarla como lo que significa: esta solicitud YA se acreditó.
  --
  -- `estado`/`verification_status` quedan en 'aplicado' —el importe se acreditó,
  -- que es el hecho contable— y `verified_by`/`verified_at` guardan QUIÉN probó
  -- que el cobro ocurrió. Son dos hechos distintos y ninguno sustituye al otro:
  -- ver la cabecera de 20260911201500.
  INSERT INTO public.pagos (
    payment_request_id, registro_id, cuota_id, cliente_id, project_id,
    monto, metodo, estado, verification_status, tipo_aplicacion, referencia,
    verified_by, verified_at
  ) VALUES (
    v_pr.id, v_pr.registro_id, v_pr.cuota_id, v_pr.cliente_id, v_proyecto,
    v_pr.monto, v_metodo, 'aplicado', 'aplicado', 'abono', v_ref,
    p_verificado_por,
    CASE WHEN p_verificado_por IS NULL THEN NULL
         ELSE COALESCE(p_verificado_en, v_ahora) END
  )
  ON CONFLICT (payment_request_id) DO NOTHING
  RETURNING id INTO v_pago_id;

  IF v_pago_id IS NULL THEN
    -- Conflicto: el pago ya existe. Y AQUÍ SE SALE, sin acreditar. Seguir
    -- adelante «porque el INSERT no falló» convertiría el índice único en un
    -- silenciador: el pago no se duplicaría, pero el importe se sumaría dos
    -- veces al recibo. Que es el fallo que esta migración vino a cerrar.
    SELECT p.id INTO v_pago_id FROM public.pagos p
     WHERE p.payment_request_id = v_pr.id;

    IF v_pr.registro_id IS NOT NULL THEN
      v_liquida := v_reg.estado = 'pagado';
      v_saldo   := round(GREATEST(v_total - COALESCE(v_reg.monto_pagado, 0), 0), 2);
    ELSE
      SELECT COALESCE(sum(p.monto), 0) INTO v_abonado
        FROM public.pagos p
       WHERE p.cuota_id = v_pr.cuota_id AND p.deleted_at IS NULL;
      v_liquida := v_total > 0 AND (v_total - v_abonado) <= 0.005;
      v_saldo   := round(GREATEST(v_total - v_abonado, 0), 2);
    END IF;

    UPDATE public.payment_requests pr
       SET estado = 'succeeded', updated_at = v_ahora
     WHERE pr.id = v_pr.id;

    RETURN jsonb_build_object(
      'ok', true, 'ya_conciliado', true, 'pago_id', v_pago_id,
      'liquidado', v_liquida, 'saldo_restante', v_saldo);
  END IF;

  -- ── Acreditar ────────────────────────────────────────────────────────────
  IF v_pr.registro_id IS NOT NULL THEN
    -- El recibo lleva su acumulador en la fila y su propia RPC autoritativa,
    -- que vuelve a bloquear (ya lo tenemos), suma y audita. No se duplica aquí
    -- la máquina de estados del cobro: hay un solo sitio donde vive.
    v_reg := public.agua_registro_acreditar_pago_externo(
      v_pr.registro_id, v_pr.monto, v_ref);
    v_liquida := v_reg.estado = 'pagado';
    v_saldo   := round(GREATEST(v_total - COALESCE(v_reg.monto_pagado, 0), 0), 2);
  ELSE
    SELECT COALESCE(sum(p.monto), 0) INTO v_abonado
      FROM public.pagos p
     WHERE p.cuota_id = v_pr.cuota_id AND p.deleted_at IS NULL;
    v_liquida := v_total > 0 AND (v_total - v_abonado) <= 0.005;
    v_saldo   := round(GREATEST(v_total - v_abonado, 0), 2);

    IF v_liquida THEN
      UPDATE public.cuotas_condominio c
         SET cuota_estado    = 'pagada',
             pagada_at       = v_ahora,
             estado          = 'pagado',
             fecha_pago      = v_ahora::date,
             metodo_pago     = 'en_linea:' || v_pr.provider,
             referencia_pago = v_ref,
             pago_id         = v_pago_id
       WHERE c.id = v_pr.cuota_id;
    END IF;
  END IF;

  -- Un pago que liquida es 'pago_total'; el que no, 'abono'. Se sabe DESPUÉS
  -- de acreditar, así que se sella aquí.
  IF v_liquida THEN
    UPDATE public.pagos p SET tipo_aplicacion = 'pago_total' WHERE p.id = v_pago_id;
  END IF;

  -- ── Y la solicitud, cerrada en la MISMA transacción ──────────────────────
  UPDATE public.payment_requests pr
     SET estado = 'succeeded', updated_at = v_ahora
   WHERE pr.id = v_pr.id;

  RETURN jsonb_build_object(
    'ok', true, 'ya_conciliado', false, 'pago_id', v_pago_id,
    'liquidado', v_liquida, 'saldo_restante', v_saldo);
END;
$$;

COMMENT ON FUNCTION public.conciliar_pago_externo(uuid, text, timestamptz) IS
  'Concilia un cobro externo en UNA transacción: bloquea la solicitud, inserta el pago (idempotente por UNIQUE sobre payment_request_id), acredita el ítem y cierra la solicitud. Recibe sólo el id — monto, ítem, método y referencia salen de la fila bloqueada. Los dos parámetros opcionales guardan QUIÉN verificó el cobro (la firma de Stripe, p.ej.) sin sacarlo de la transacción. Sólo service_role.';

REVOKE EXECUTE ON FUNCTION public.conciliar_pago_externo(uuid, text, timestamptz)
  FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.conciliar_pago_externo(uuid, text, timestamptz)
  TO service_role;

-- ── Autoverificación ────────────────────────────────────────────────────────
DO $verif$
DECLARE
  v_rol text;
BEGIN
  -- La firma vieja no puede quedar viva: dos sobrecargas con defaults harían
  -- ambigua la llamada de un argumento de `confirm-charge`.
  IF to_regprocedure('public.conciliar_pago_externo(uuid)') IS NOT NULL THEN
    RAISE EXCEPTION '20260911201500: sigue viva conciliar_pago_externo(uuid) — la llamada de confirm-charge quedaría ambigua';
  END IF;
  IF to_regprocedure('public.conciliar_pago_externo(uuid, text, timestamptz)') IS NULL THEN
    RAISE EXCEPTION '20260911201500: no se creó conciliar_pago_externo(uuid, text, timestamptz)';
  END IF;

  -- Ningún rol de API alcanza las tres: son del webhook y del cron.
  FOREACH v_rol IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = v_rol) THEN CONTINUE; END IF;
    IF has_function_privilege(v_rol, 'public.conciliar_pago_externo(uuid, text, timestamptz)'::regprocedure, 'EXECUTE')
       OR has_function_privilege(v_rol, 'public.stripe_webhook_evento_reclamar(text, text, boolean, jsonb)'::regprocedure, 'EXECUTE')
       OR has_function_privilege(v_rol, 'public.stripe_webhook_evento_cerrar(text, boolean, text)'::regprocedure, 'EXECUTE') THEN
      RAISE EXCEPTION '20260911201500: % alcanza una RPC del webhook', v_rol USING ERRCODE = '42501';
    END IF;
  END LOOP;
END $verif$;
