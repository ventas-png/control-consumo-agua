-- ════════════════════════════════════════════════════════════════════════════
-- La conciliación del payfac era un check-then-insert en cuatro transacciones
-- ════════════════════════════════════════════════════════════════════════════
-- `confirm-charge`, después de preguntarle al proveedor si el cobro se aprobó,
-- hacía esto desde JavaScript, cada paso en SU PROPIA transacción:
--
--   1. SELECT id FROM pagos WHERE referencia = <ref> AND (registro|cuota)_id = …
--      → «¿ya lo concilié?»                                 (check)
--   2. INSERT INTO pagos …                                  (then-insert)
--   3. UPDATE registros / cuotas_condominio  ← acreditar
--   4. UPDATE payment_requests SET estado = 'succeeded'
--
-- Los cuatro fallos que eso deja abiertos, y ninguno es teórico —el retorno del
-- portal y el cron de reconciliación confirman la MISMA solicitud a la vez—:
--
--   · CARRERA EN EL GUARD. Dos confirmaciones pasan el paso 1 antes de que
--     ninguna llegue al 2: se insertan DOS pagos y se acredita DOS veces. No
--     había UNIQUE que lo impidiera; el índice existente es por
--     (provider, provider_ref) sobre `payment_requests`, no sobre `pagos`.
--   · ROTURA ENTRE 2 y 3. El pago queda insertado y el recibo sin acreditar:
--     cuadre roto, y el reintento se encuentra el pago del paso 1 y sale por
--     «already», así que NUNCA acredita. El dinero entró y nadie lo debe.
--   · ROTURA ENTRE 3 y 4. La solicitud queda en `pending` para siempre y el
--     cron la reintenta cada vuelta.
--   · EL GUARD MIRABA LA REFERENCIA, NO LA SOLICITUD. Dos `payment_requests`
--     distintas con la misma `provider_ref` se tapaban entre sí.
--
-- LO QUE HACE ESTA MIGRACIÓN. Mueve los cuatro pasos a UNA transacción, dentro
-- de una RPC que sólo recibe el id de la solicitud. El edge deja de decidir:
-- pregunta al proveedor y llama aquí. Todo lo que se escribe —el monto, el
-- ítem, el método, la referencia, el proyecto— sale de la FILA BLOQUEADA, no
-- del cuerpo de la petición.
--
-- Y la idempotencia deja de ser una consulta previa para ser una RESTRICCIÓN:
-- `pagos.payment_request_id` con UNIQUE. Una consulta previa se puede correr
-- dos veces a la vez; un índice único, no.
--
-- DOS DEFENSAS, Y LAS DOS HACEN FALTA. El bloqueo serializa; el índice impide
-- el duplicado si el bloqueo alguna vez no alcanzara. Medido por mutación
-- sobre la invariante 34:
--
--   sin FOR UPDATE, con el conflicto CORTANDO ......... correcto igual
--   sin FOR UPDATE, con el conflicto tragado ......... DOBLE ACREDITACIÓN
--
-- La segunda línea es la que importa: no basta con que el `INSERT` no duplique
-- el pago; al chocar con la llave hay que SALIR, porque el choque significa
-- «esto ya se acreditó». Seguir de largo deja el pago sin duplicar y el
-- importe sumado dos veces al recibo, que es peor que fallar.
--
-- REVERSIÓN
--   DROP FUNCTION IF EXISTS public.conciliar_pago_externo(uuid);
--   DROP INDEX IF EXISTS public.uq_pagos_payment_request;
--   ALTER TABLE public.pagos DROP COLUMN IF EXISTS payment_request_id;
--   -- y volver `confirm-charge` a los cuatro pasos sueltos (no recomendado).
--
-- Idempotente: ADD COLUMN IF NOT EXISTS, CREATE INDEX IF NOT EXISTS,
-- CREATE OR REPLACE.
-- ════════════════════════════════════════════════════════════════════════════

-- ── 1. La llave de idempotencia, como RESTRICCIÓN ───────────────────────────
-- Una solicitud de cobro produce como mucho UN pago. Antes eso era una
-- convención que un `SELECT` previo intentaba sostener; ahora lo sostiene el
-- índice, que es lo único que no se puede perder una carrera.
-- SIN clave foránea, y por higiene del auditor, no por descuido: los
-- `constraints` de `pagos` tienen DRIFT DECLARADO contra producción (la tabla
-- la creó una migración huérfana con otra forma; inventario en #826). Agregar
-- una FK desde aquí dejaría a producción, a `main` y a este PR diciendo tres
-- cosas distintas del mismo grupo, que es el *cambio ambiguo* que el auditor de
-- tres vías cierra en falso a propósito —y con razón: nadie puede decidir desde
-- el repositorio si eso arregla o empeora el drift—. La integridad que esta
-- migración necesita es la UNICIDAD, que es un índice y no un constraint, y ese
-- grupo sí está limpio. Cuando #826 reconcilie la tabla, la FK se agrega.
ALTER TABLE public.pagos
  ADD COLUMN IF NOT EXISTS payment_request_id uuid;

COMMENT ON COLUMN public.pagos.payment_request_id IS
  'Solicitud de cobro del payfac que originó este pago. UNIQUE: una solicitud acredita como mucho una vez. NULL en los pagos manuales y en todo lo anterior a esta migración.';

-- NO es parcial por `deleted_at`, y es deliberado: si borrar el pago liberara
-- la llave, reintentar una conciliación ya borrada volvería a acreditar. Es el
-- mismo criterio que `registros.idempotency_key` (20260910000200).
-- Los NULL no colisionan entre sí en Postgres, así que los pagos manuales y el
-- histórico entero caben sin tocar nada.
CREATE UNIQUE INDEX IF NOT EXISTS uq_pagos_payment_request
  ON public.pagos (payment_request_id);

-- ── 2. La conciliación, en una sola transacción ─────────────────────────────
-- Recibe SÓLO el id de la solicitud. Todo lo demás lo lee de la fila que acaba
-- de bloquear: el edge no puede mentir sobre el monto, el ítem ni el método
-- porque no tiene dónde decirlo.
--
-- Orden de bloqueos, y no es casual: primero `payment_requests` (una fila por
-- llamada, así que dos conciliaciones de la MISMA solicitud se serializan aquí)
-- y después el recibo o la cuota. Siempre en ese orden, así que dos solicitudes
-- distintas del mismo recibo no se cruzan los locks: no hay deadlock posible.
CREATE OR REPLACE FUNCTION public.conciliar_pago_externo(p_payment_request_id uuid)
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
  INSERT INTO public.pagos (
    payment_request_id, registro_id, cuota_id, cliente_id, project_id,
    monto, metodo, estado, verification_status, tipo_aplicacion, referencia
  ) VALUES (
    v_pr.id, v_pr.registro_id, v_pr.cuota_id, v_pr.cliente_id, v_proyecto,
    v_pr.monto, v_metodo, 'aplicado', 'aplicado', 'abono', v_ref
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

COMMENT ON FUNCTION public.conciliar_pago_externo(uuid) IS
  'Concilia en UNA transacción un cobro que el payfac ya aprobó: bloquea la solicitud, inserta el pago con llave única (pagos.payment_request_id), bloquea el recibo o la cuota, acredita y marca la solicitud succeeded. Recibe sólo el id de la solicitud: monto, ítem, método y referencia salen de la fila bloqueada. Repetirla sobre una solicitud ya conciliada es un no-op que devuelve el resultado existente. Sólo service_role.';

REVOKE EXECUTE ON FUNCTION public.conciliar_pago_externo(uuid)
  FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.conciliar_pago_externo(uuid)
  TO service_role;
