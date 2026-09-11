-- Invariantes del webhook de Stripe contra un Postgres real.
--
-- Lo que se demuestra aquí no es que las funciones existan, sino que la
-- distinción que el PR introduce —«vi el evento» contra «terminé el evento»—
-- cambia el comportamiento. Con el handler viejo, un fallo después de reclamar
-- dejaba el cobro sin acreditar y a Stripe convencido de que ya estaba hecho.

\set ON_ERROR_STOP on

-- La cadena de conexión de dblink viaja por un GUC de sesión: psql no
-- interpola `:'conn'` dentro de un bloque dollar-quoted. Mismo patrón que
-- supabase/tests/proteger_update_registros/assert.sql.
SELECT set_config('app.conn', :'conn', false);

-- ── 1-4 · El reclamo: quién puede volver a intentarlo ───────────────────────
DO $$
DECLARE
  r jsonb;
BEGIN
  PERFORM set_config('request.jwt.claims', '{"role":"service_role"}', true);

  -- 1 · Un evento nuevo se reclama.
  r := public.stripe_webhook_evento_reclamar('evt_1', 'payment_intent.succeeded', false, '{}'::jsonb);
  IF (r ->> 'reclamado')::boolean IS NOT TRUE THEN
    RAISE EXCEPTION '1: un evento nuevo no se pudo reclamar (%)', r; END IF;
  IF (SELECT estado FROM public.stripe_webhook_events WHERE event_id = 'evt_1') <> 'procesando' THEN
    RAISE EXCEPTION '1: el evento reclamado no quedó en procesando'; END IF;
  RAISE NOTICE 'OK 1   un evento nuevo se reclama y queda en procesando';

  -- 2 · COMPLETADO no se re-reclama, y se distingue de los demás casos.
  PERFORM public.stripe_webhook_evento_cerrar('evt_1', true, NULL);
  IF (SELECT estado FROM public.stripe_webhook_events WHERE event_id = 'evt_1') <> 'completado' THEN
    RAISE EXCEPTION '2: cerrar con ok no dejó completado'; END IF;
  IF (SELECT processed_at FROM public.stripe_webhook_events WHERE event_id = 'evt_1') IS NULL THEN
    RAISE EXCEPTION '2: completado sin processed_at'; END IF;

  r := public.stripe_webhook_evento_reclamar('evt_1', 'payment_intent.succeeded', false, '{}'::jsonb);
  IF (r ->> 'reclamado')::boolean IS NOT FALSE THEN
    RAISE EXCEPTION '2: un evento COMPLETADO se volvió a reclamar — se re-aplicaría el cobro'; END IF;
  IF (r ->> 'ya_completado')::boolean IS NOT TRUE THEN
    RAISE EXCEPTION '2: no se reconoce como completado, el edge respondería 409 para siempre'; END IF;
  RAISE NOTICE 'OK 2   un evento COMPLETADO no se re-reclama, y se dice que lo está';

  -- 3 · FALLIDO sí se re-reclama, y de inmediato. Es la diferencia entera: el
  -- handler viejo trataba este caso igual que el anterior.
  PERFORM public.stripe_webhook_evento_reclamar('evt_2', 'payment_intent.succeeded', false, '{}'::jsonb);
  PERFORM public.stripe_webhook_evento_cerrar('evt_2', false, 'se cayó a medias');
  IF (SELECT processed_at FROM public.stripe_webhook_events WHERE event_id = 'evt_2') IS NOT NULL THEN
    RAISE EXCEPTION '3: un evento FALLIDO quedó con processed_at — se lee como hecho'; END IF;

  r := public.stripe_webhook_evento_reclamar('evt_2', 'payment_intent.succeeded', false, '{}'::jsonb);
  IF (r ->> 'reclamado')::boolean IS NOT TRUE THEN
    RAISE EXCEPTION '3: un evento FALLIDO no se pudo reintentar (%)', r; END IF;
  IF (r ->> 'intentos')::int <> 2 THEN
    RAISE EXCEPTION '3: el contador de intentos no avanzó (%)', r; END IF;
  RAISE NOTICE 'OK 3   un evento FALLIDO se reintenta enseguida, y el intento se cuenta';

  -- 4 · `procesando` RANCIO: una invocación que murió sin cerrar no puede
  -- bloquear el evento para siempre.
  PERFORM public.stripe_webhook_evento_reclamar('evt_3', 'payment_intent.succeeded', false, '{}'::jsonb);
  r := public.stripe_webhook_evento_reclamar('evt_3', 'payment_intent.succeeded', false, '{}'::jsonb);
  IF (r ->> 'reclamado')::boolean IS NOT FALSE THEN
    RAISE EXCEPTION '4: un `procesando` FRESCO se dejó re-reclamar — dos invocaciones a la vez'; END IF;

  UPDATE public.stripe_webhook_events SET received_at = now() - interval '30 minutes'
   WHERE event_id = 'evt_3';
  r := public.stripe_webhook_evento_reclamar('evt_3', 'payment_intent.succeeded', false, '{}'::jsonb);
  IF (r ->> 'reclamado')::boolean IS NOT TRUE THEN
    RAISE EXCEPTION '4: un `procesando` RANCIO quedó bloqueado para siempre (%)', r; END IF;
  RAISE NOTICE 'OK 4   el `procesando` fresco no se pisa, y el rancio se retoma';
END $$;

-- ── 5 · Dos entregas SIMULTÁNEAS del mismo evento ──────────────────────────
-- Con dos conexiones de verdad. Un check-then-insert las deja pasar las dos, y
-- es exactamente el fallo que el INSERT … ON CONFLICT DO UPDATE cierra.
DO $$
DECLARE
  ganadores int;
  v_conn text := current_setting('app.conn');
BEGIN
  PERFORM set_config('request.jwt.claims', '{"role":"service_role"}', true);
  PERFORM public.dblink_connect('e1', v_conn);
  PERFORM public.dblink_connect('e2', v_conn);
  -- `dblink_exec` no admite sentencias que devuelvan filas, y `set_config` las
  -- devuelve. Se usa `dblink(...)`, como en el arnés hermano.
  PERFORM t.x FROM public.dblink('e1',
    $c$SELECT set_config('request.jwt.claims','{"role":"service_role"}',false)$c$) AS t(x text);
  PERFORM t.x FROM public.dblink('e2',
    $c$SELECT set_config('request.jwt.claims','{"role":"service_role"}',false)$c$) AS t(x text);

  PERFORM public.dblink_send_query('e1',
    $c$SELECT (public.stripe_webhook_evento_reclamar('evt_race','payment_intent.succeeded',false,'{}'::jsonb) ->> 'reclamado')$c$);
  PERFORM public.dblink_send_query('e2',
    $c$SELECT (public.stripe_webhook_evento_reclamar('evt_race','payment_intent.succeeded',false,'{}'::jsonb) ->> 'reclamado')$c$);

  SELECT count(*) FILTER (WHERE v = 'true') INTO ganadores FROM (
    SELECT * FROM public.dblink_get_result('e1') AS t(v text)
    UNION ALL
    SELECT * FROM public.dblink_get_result('e2') AS t(v text)
  ) s;

  PERFORM public.dblink_get_result('e1'); PERFORM public.dblink_get_result('e2');
  PERFORM public.dblink_disconnect('e1'); PERFORM public.dblink_disconnect('e2');

  IF ganadores <> 1 THEN
    RAISE EXCEPTION '5: % entregas simultáneas reclamaron el mismo evento (debía ser 1)', ganadores; END IF;
  RAISE NOTICE 'OK 5   dos entregas simultáneas del mismo evento: lo reclama UNA';
END $$;

-- ── 6-8 · El recibo: acreditar, fallar y reintentar ────────────────────────
DO $$
DECLARE
  M1     constant uuid := 'c0000000-0000-0000-0000-000000000001';
  LUCIA  constant uuid := 'e0000000-0000-0000-0000-000000000001';
  HOY    date := (now() AT TIME ZONE 'America/Guatemala')::date;
  reg    public.registros;
  fila   public.registros;
  v_pr   uuid;
  v_pago public.pagos;
  r      jsonb;
  ok     boolean;
BEGIN
  PERFORM set_config('request.jwt.claims', '{"role":"service_role"}', true);
  PERFORM set_config('app.uid', LUCIA::text, false);
  SELECT * INTO reg FROM public.registrar_lectura(
    M1, 1200, HOY, 'idem-whk-0001', 'Para el webhook', NULL, NULL);
  PERFORM public.agua_factura_emitir(reg.id);

  INSERT INTO public.payment_requests (cliente_id, registro_id, company_id, monto,
                                       provider, estado, stripe_payment_intent, ambiente)
  VALUES (reg.cliente_id, reg.id, M1, 40.00, 'stripe', 'pending', 'pi_ok_1', 'produccion')
  RETURNING id INTO v_pr;

  -- 6 · El camino feliz. El pago queda `aplicado` —porque se acreditó— Y con la
  -- procedencia de quién lo verificó. Perder eso al unificar habría sido el
  -- precio oculto de reutilizar la RPC.
  r := public.conciliar_pago_externo(v_pr, 'stripe_webhook', now());
  SELECT * INTO v_pago FROM public.pagos WHERE payment_request_id = v_pr;
  IF v_pago.estado <> 'aplicado' OR v_pago.verification_status <> 'aplicado' THEN
    RAISE EXCEPTION '6: el pago no quedó aplicado (% / %)', v_pago.estado, v_pago.verification_status; END IF;
  IF v_pago.verified_by <> 'stripe_webhook' OR v_pago.verified_at IS NULL THEN
    RAISE EXCEPTION '6: se perdió la procedencia de la verificación (% / %)',
      v_pago.verified_by, v_pago.verified_at; END IF;
  SELECT * INTO fila FROM public.registros WHERE id = reg.id;
  IF COALESCE(fila.monto_pagado, 0) <> 40.00 THEN
    RAISE EXCEPTION '6: el recibo no se acreditó (monto_pagado %)', fila.monto_pagado; END IF;
  IF (SELECT estado FROM public.payment_requests WHERE id = v_pr) <> 'succeeded' THEN
    RAISE EXCEPTION '6: la solicitud no quedó succeeded'; END IF;
  RAISE NOTICE 'OK 6   el pago queda APLICADO, con quién lo verificó, y el recibo acreditado';

  -- 8 · Una segunda entrega del MISMO evento no vuelve a acreditar.
  r := public.conciliar_pago_externo(v_pr, 'stripe_webhook', now());
  IF (r ->> 'ya_conciliado')::boolean IS NOT TRUE THEN
    RAISE EXCEPTION '8: la segunda entrega no se reconoció como ya conciliada (%)', r; END IF;
  SELECT * INTO fila FROM public.registros WHERE id = reg.id;
  IF COALESCE(fila.monto_pagado, 0) <> 40.00 THEN
    RAISE EXCEPTION '8: DOBLE ACREDITACIÓN: monto_pagado quedó en %', fila.monto_pagado; END IF;
  IF (SELECT count(*) FROM public.pagos WHERE payment_request_id = v_pr) <> 1 THEN
    RAISE EXCEPTION '8: se registró más de un pago para la misma solicitud'; END IF;
  RAISE NOTICE 'OK 8   dos entregas del mismo cobro acreditan UNA sola vez';

  -- 7 · Fallo ENTRE el reclamo del evento y la acreditación. Es el escenario
  -- que el handler viejo perdía: el evento quedaba marcado, el recibo sin
  -- tocar, y el reintento recibía 200.
  INSERT INTO public.payment_requests (cliente_id, registro_id, company_id, monto,
                                       provider, estado, stripe_payment_intent, ambiente)
  VALUES (reg.cliente_id, reg.id, M1, 10.00, 'stripe', 'pending', 'pi_roto_1', 'produccion')
  RETURNING id INTO v_pr;

  PERFORM public.stripe_webhook_evento_reclamar('evt_roto', 'payment_intent.succeeded', false, '{}'::jsonb);
  ok := false;
  BEGIN
    PERFORM set_config('test.romper_acreditacion', 'on', true);
    PERFORM public.conciliar_pago_externo(v_pr, 'stripe_webhook', now());
  EXCEPTION WHEN OTHERS THEN ok := true;
  END;
  PERFORM set_config('test.romper_acreditacion', 'off', true);
  IF NOT ok THEN
    RAISE EXCEPTION '7: el fallo provocado no se produjo — el escenario ya no vale'; END IF;

  -- La transacción de la RPC revirtió entera: ni pago ni acreditación.
  IF EXISTS (SELECT 1 FROM public.pagos WHERE payment_request_id = v_pr) THEN
    RAISE EXCEPTION '7: quedó un pago escrito pese al fallo'; END IF;
  SELECT * INTO fila FROM public.registros WHERE id = reg.id;
  IF COALESCE(fila.monto_pagado, 0) <> 40.00 THEN
    RAISE EXCEPTION '7: el recibo se movió pese al fallo (%)', fila.monto_pagado; END IF;

  -- Y el evento se cierra como FALLIDO, que es lo que lo deja reintentable.
  PERFORM public.stripe_webhook_evento_cerrar('evt_roto', false, 'fallo provocado');
  r := public.stripe_webhook_evento_reclamar('evt_roto', 'payment_intent.succeeded', false, '{}'::jsonb);
  IF (r ->> 'reclamado')::boolean IS NOT TRUE THEN
    RAISE EXCEPTION '7: tras el fallo el evento no se pudo reintentar — cobro perdido'; END IF;

  -- El reintento cuadra.
  r := public.conciliar_pago_externo(v_pr, 'stripe_webhook', now());
  SELECT * INTO fila FROM public.registros WHERE id = reg.id;
  IF COALESCE(fila.monto_pagado, 0) <> 50.00 THEN
    RAISE EXCEPTION '7: el reintento no acreditó (monto_pagado %)', fila.monto_pagado; END IF;
  PERFORM public.stripe_webhook_evento_cerrar('evt_roto', true, NULL);
  RAISE NOTICE 'OK 7   un fallo tras reclamar revierte TODO, deja el evento reintentable, y el reintento cuadra';
END $$;

-- ── 9 · Una cuota de condominio por la misma vía ───────────────────────────
DO $$
DECLARE
  M1    constant uuid := 'c0000000-0000-0000-0000-000000000001';
  P1    constant uuid := '11111111-0000-0000-0000-000000000001';
  v_cu  uuid;
  v_pr  uuid;
  v_cli uuid;
BEGIN
  PERFORM set_config('request.jwt.claims', '{"role":"service_role"}', true);
  SELECT r.cliente_id INTO v_cli FROM public.registros r
   WHERE r.cliente_id IS NOT NULL ORDER BY r.created_at LIMIT 1;

  INSERT INTO public.cuotas_condominio (company_id, project_id, monto, total_a_pagar)
  VALUES (M1, P1, 80.00, 80.00) RETURNING id INTO v_cu;

  INSERT INTO public.payment_requests (cliente_id, cuota_id, company_id, monto,
                                       provider, estado, stripe_payment_intent, ambiente)
  VALUES (v_cli, v_cu, M1, 80.00, 'stripe', 'pending', 'pi_cuota_1', 'produccion')
  RETURNING id INTO v_pr;

  PERFORM public.conciliar_pago_externo(v_pr, 'stripe_webhook', now());

  IF (SELECT cuota_estado FROM public.cuotas_condominio WHERE id = v_cu) <> 'pagada' THEN
    RAISE EXCEPTION '9: la cuota no quedó pagada'; END IF;
  IF (SELECT verified_by FROM public.pagos WHERE payment_request_id = v_pr) <> 'stripe_webhook' THEN
    RAISE EXCEPTION '9: la cuota perdió la procedencia de la verificación'; END IF;
  RAISE NOTICE 'OK 9   una cuota de condominio se liquida por la misma vía, con su procedencia';
END $$;

-- ── 10-12 · La firma vieja, y quién NO puede llamar ────────────────────────
DO $$
DECLARE
  M1    constant uuid := 'c0000000-0000-0000-0000-000000000001';
  v_pr  uuid;
  v_cli uuid;
  ok    boolean;
  rol   text;
BEGIN
  PERFORM set_config('request.jwt.claims', '{"role":"service_role"}', true);

  -- 10 · `confirm-charge` llama con UN argumento nombrado. Si la firma vieja
  -- siguiera viva, esa llamada quedaría AMBIGUA en tiempo de ejecución — que es
  -- por lo que la migración hace DROP + CREATE y no CREATE OR REPLACE.
  IF to_regprocedure('public.conciliar_pago_externo(uuid)') IS NOT NULL THEN
    RAISE EXCEPTION '10: sigue viva la firma de un argumento'; END IF;

  SELECT r.cliente_id INTO v_cli FROM public.registros r
   WHERE r.cliente_id IS NOT NULL ORDER BY r.created_at LIMIT 1;
  INSERT INTO public.cuotas_condominio (company_id, project_id, monto, total_a_pagar)
  VALUES (M1, '11111111-0000-0000-0000-000000000001', 5.00, 5.00) RETURNING id INTO v_pr;
  INSERT INTO public.payment_requests (cliente_id, cuota_id, company_id, monto,
                                       provider, estado, stripe_payment_intent, ambiente)
  VALUES (v_cli, v_pr, M1, 5.00, 'sandbox', 'pending', 'pi_uno', 'sandbox')
  RETURNING id INTO v_pr;
  -- La llamada tal cual la hace confirm-charge: un solo parámetro nombrado.
  PERFORM public.conciliar_pago_externo(p_payment_request_id := v_pr);
  IF (SELECT verified_by FROM public.pagos WHERE payment_request_id = v_pr) IS NOT NULL THEN
    RAISE EXCEPTION '10: sin procedencia, verified_by debería quedar NULL'; END IF;
  RAISE NOTICE 'OK 10  confirm-charge sigue llamando con UN argumento, y sin procedencia no la inventa';

  -- 11 · Ni anon ni authenticated alcanzan las RPC del webhook.
  FOREACH rol IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF has_function_privilege(rol, 'public.stripe_webhook_evento_reclamar(text, text, boolean, jsonb)'::regprocedure, 'EXECUTE')
       OR has_function_privilege(rol, 'public.stripe_webhook_evento_cerrar(text, boolean, text)'::regprocedure, 'EXECUTE')
       OR has_function_privilege(rol, 'public.conciliar_pago_externo(uuid, text, timestamptz)'::regprocedure, 'EXECUTE') THEN
      RAISE EXCEPTION '11: % alcanza una RPC del webhook', rol; END IF;
  END LOOP;
  RAISE NOTICE 'OK 11  ni anon ni authenticated tienen EXECUTE sobre las RPC del webhook';

  -- 12 · Ni por la puerta de atrás de una SECURITY DEFINER suya: el GRANT no
  -- basta, porque una DEFINER corre como el dueño y tendría EXECUTE implícito.
  -- Lo que la para es el chequeo de rol EFECTIVO dentro de la función.
  ok := false;
  PERFORM set_config('request.jwt.claims', '', true);
  SET LOCAL ROLE authenticated;
  BEGIN
    PERFORM public.test_definer_reclama_evento('evt_hostil');
  EXCEPTION WHEN insufficient_privilege THEN ok := true; END;
  RESET ROLE;
  IF NOT ok THEN
    RAISE EXCEPTION '12: una SECURITY DEFINER de authenticated reclamó un evento'; END IF;
  RAISE NOTICE 'OK 12  ni desde una SECURITY DEFINER suya: el chequeo de rol efectivo la para';
END $$;
