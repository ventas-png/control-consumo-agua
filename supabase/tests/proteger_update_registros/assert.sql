\set ON_ERROR_STOP on
\pset tuples_only on
\pset format unaligned

SELECT set_config('app.conn', :'conn', false);

-- ════════════════════════════════════════════════════════════════════════════
-- Invariantes del guard de UPDATE y del camino autorizado de cobro
-- (20260910235732), y de la autorización del reporte (corrige 20260910000300).
--
--    1-2   EL AGUJERO, EJERCIDO: sin el trigger, un PATCH COMO `authenticated`
--          reescribe la lectura entera y fabrica el cobro. Con el trigger, no.
--    3-6   el guard por grupos: inmutables, cobro, y lo que sigue siendo libre
--    7-12  el camino autorizado: emitir, anular, pagar, mora, estado, auditoría
--   13-15  la autorización de las RPC: sin permiso, otro tenant, y la ACL
--    16    la excepción de `service_role`, enumerada
--   17-21  el reporte: quién NO lo ve y quién sí
--    22    el camino completo ejercido COMO `authenticated`, con la RLS puesta
-- ════════════════════════════════════════════════════════════════════════════

-- ── 1-2 · El agujero, ejercido ──────────────────────────────────────────────
DO $$
DECLARE
  M1     constant uuid := 'c0000000-0000-0000-0000-000000000001';
  M2     constant uuid := 'c0000000-0000-0000-0000-000000000002';
  LUCIA  constant uuid := 'e0000000-0000-0000-0000-000000000001';
  HOY    date := (now() AT TIME ZONE 'America/Guatemala')::date;
  reg    public.registros;
  despues public.registros;
BEGIN
  PERFORM set_config('app.uid', LUCIA::text, false);
  SELECT * INTO reg FROM public.registrar_lectura(
    M1, 130, HOY, 'idem-upd-demo-0001', 'Para la demostración', NULL, NULL);

  -- 1 · SIN el trigger: la policy `registros_update` autoriza la fila y no mira
  -- ni una columna, así que UN SOLO PATCH cambia la lectura entera y el cobro.
  EXECUTE 'ALTER TABLE public.registros DISABLE TRIGGER trg_agua_registros_proteger_update';
  SET LOCAL ROLE authenticated;
  -- `project_id` NO entra en la falsificación: la policy de SELECT se aplica
  -- también a la fila resultante, así que mudarla a un proyecto que Lucía no ve
  -- ya lo paraba la RLS. Lo que sí entra es todo lo demás — incluido el
  -- CONTADOR, que reasigna la lectura al medidor de otra unidad y otro cliente.
  UPDATE public.registros SET
    contador_id = M2, cliente_id = NULL, fecha = HOY - 30,
    lectura_anterior = 0, lectura_actual = 1, consumo = 0,
    tarifa_aplicada = 0, tarifa_exceso_aplicada = 0, canon_aplicado = 0,
    monto_calculado = 0, tipo_cobro = 'Regalado', secuencia = 999,
    idempotency_key = 'robada', origen = 'rpc', es_reset = true,
    lectura_final_retirada = 0,
    estado = 'pagado', monto_pagado = 999999, fecha_pago = HOY,
    factura_estado = 'pagada', emitida_at = now(), pagada_at = now(),
    total_a_pagar = 0, monto_con_iva = 0, iva_monto = 0
  WHERE id = reg.id;
  RESET ROLE;
  EXECUTE 'ALTER TABLE public.registros ENABLE TRIGGER trg_agua_registros_proteger_update';

  SELECT * INTO despues FROM public.registros WHERE id = reg.id;
  IF despues.monto_calculado <> 0 OR despues.consumo <> 0
     OR despues.estado <> 'pagado' OR despues.monto_pagado <> 999999
     OR despues.contador_id <> M2 OR despues.idempotency_key <> 'robada'
     OR despues.factura_estado <> 'pagada' OR despues.total_a_pagar <> 0 THEN
    RAISE EXCEPTION '1: el PATCH sin trigger NO entró — la demostración del agujero ya no aplica (monto %, estado %, contador %)',
      despues.monto_calculado, despues.estado, despues.contador_id;
  END IF;
  RAISE NOTICE 'OK 1   sin el trigger, un PATCH como authenticated deja la lectura en consumo 0, monto 0, otro contador y "pagada" con 999999 abonados';

  -- Se deshace la falsificación: la demostración no contamina lo que sigue.
  DELETE FROM public.registros WHERE id = reg.id;

  -- 2 · CON el trigger: el mismo PATCH, rechazado, y por la primera columna.
  SELECT * INTO reg FROM public.registrar_lectura(
    M1, 130, HOY, 'idem-upd-demo-0002', 'Para la demostración', NULL, NULL);
  SET LOCAL ROLE authenticated;
  BEGIN
    UPDATE public.registros SET
      contador_id = M2, monto_calculado = 0, consumo = 0,
      estado = 'pagado', monto_pagado = 999999
    WHERE id = reg.id;
    RESET ROLE;
    RAISE EXCEPTION '2: el PATCH entró con el trigger puesto';
  EXCEPTION WHEN insufficient_privilege THEN
    RESET ROLE;
  END;

  SELECT * INTO despues FROM public.registros WHERE id = reg.id;
  IF despues.monto_calculado <> reg.monto_calculado OR despues.estado <> 'pendiente' THEN
    RAISE EXCEPTION '2: la fila cambió pese al rechazo (monto %, estado %)',
      despues.monto_calculado, despues.estado;
  END IF;
  RAISE NOTICE 'OK 2   con el trigger, el mismo PATCH se rechaza (42501) y la fila no se mueve';
  DELETE FROM public.registros WHERE id = reg.id;
END $$;

-- ── 3-6 · El guard, columna por columna ─────────────────────────────────────
DO $$
DECLARE
  M1    constant uuid := 'c0000000-0000-0000-0000-000000000001';
  M2    constant uuid := 'c0000000-0000-0000-0000-000000000002';
  LUCIA constant uuid := 'e0000000-0000-0000-0000-000000000001';
  HOY   date := (now() AT TIME ZONE 'America/Guatemala')::date;
  reg   public.registros;
  col   text;
  sql   text;
  ok    boolean;
  fila  public.registros;
BEGIN
  PERFORM set_config('app.uid', LUCIA::text, false);
  SELECT * INTO reg FROM public.registrar_lectura(
    M1, 160, HOY, 'idem-upd-guard-0001', 'Guard por columnas', NULL, NULL);

  -- 3 · El importe y su cálculo: una por una, cada intento se rechaza.
  SET LOCAL ROLE authenticated;
  FOREACH col IN ARRAY ARRAY[
    'monto_calculado = 0', 'consumo = 0', 'tarifa_aplicada = 0',
    'tarifa_exceso_aplicada = 0', 'canon_aplicado = 0', 'tipo_cobro = ''Regalado''',
    'lectura_actual = 1', 'lectura_anterior = 0', 'secuencia = 99',
    'idempotency_key = ''otra''', 'origen = ''directo''', 'es_reset = true',
    'lectura_final_retirada = 5', 'dias_servicio = 999', 'fecha = now()',
    'fecha_lectura_anterior = now()', 'mes = ''1999-01''', 'creado_por = NULL'
  ] LOOP
    ok := false;
    BEGIN
      EXECUTE format('UPDATE public.registros SET %s WHERE id = %L', col, reg.id);
    EXCEPTION WHEN insufficient_privilege THEN
      -- Se exige el mensaje DEL GUARD: si el rechazo viniera de la RLS, la
      -- invariante estaría pasando por el motivo equivocado.
      ok := SQLERRM LIKE '%es inmutable%';
    END;
    IF NOT ok THEN
      RESET ROLE;
      RAISE EXCEPTION '3: "%" no la paró el guard (se dejó cambiar, o el rechazo vino de otro sitio)', col;
    END IF;
  END LOOP;
  RESET ROLE;
  RAISE NOTICE 'OK 3   las 18 columnas de la lectura y su cálculo son inmutables por UPDATE';

  -- 4 · Contador, proyecto y cliente: la fila no se muda de sitio.
  SET LOCAL ROLE authenticated;
  FOREACH col IN ARRAY ARRAY[
    format('contador_id = %L', M2),
    'project_id = ''11111111-0000-0000-0000-000000000002''',
    'cliente_id = NULL', 'cliente_nombre = ''Otro'''
  ] LOOP
    ok := false;
    BEGIN
      EXECUTE format('UPDATE public.registros SET %s WHERE id = %L', col, reg.id);
    EXCEPTION WHEN insufficient_privilege THEN
      ok := SQLERRM LIKE '%es inmutable%';
    END;
    IF NOT ok THEN
      RESET ROLE;
      RAISE EXCEPTION '4: "%" no la paró el guard (la RLS sola no alcanza: dentro del alcance de la cuenta deja mudar la fila)', col;
    END IF;
  END LOOP;
  RESET ROLE;
  RAISE NOTICE 'OK 4   contador, proyecto y cliente no se cambian: la fila no se muda de condominio';

  -- 5 · Las columnas de cobro, sin la llave de capacidad.
  SET LOCAL ROLE authenticated;
  FOREACH col IN ARRAY ARRAY[
    'estado = ''pagado''', 'factura_estado = ''pagada''', 'monto_pagado = 500',
    'fecha_pago = now()', 'fecha_vencimiento = now()', 'iva_tasa = 0',
    'iva_monto = 0', 'monto_con_iva = 0', 'total_a_pagar = 0',
    'mora_monto = 0', 'mora_aplicada_at = now()', 'regla_mora_id = gen_random_uuid()',
    'emitida_at = now()', 'pagada_at = now()', 'vencida_at = now()', 'anulada_at = now()'
  ] LOOP
    ok := false;
    BEGIN
      EXECUTE format('UPDATE public.registros SET %s WHERE id = %L', col, reg.id);
    EXCEPTION WHEN insufficient_privilege THEN
      ok := SQLERRM LIKE '%el cobro no se edita%';
    END;
    IF NOT ok THEN
      RESET ROLE;
      RAISE EXCEPTION '5: "%" se dejó cambiar por UPDATE directo — el cobro se fabrica', col;
    END IF;
  END LOOP;
  RESET ROLE;
  RAISE NOTICE 'OK 5   las 16 columnas del cobro sólo cambian por su RPC';

  -- 6 · Y lo que NO es cobro sigue siendo un UPDATE normal.
  SET LOCAL ROLE authenticated;
  UPDATE public.registros
     SET notas = 'corrijo la nota', foto = NULL, gps = '{"lat":14.6,"lng":-90.5}'::jsonb
   WHERE id = reg.id;
  RESET ROLE;
  SELECT * INTO fila FROM public.registros WHERE id = reg.id;
  IF fila.notas <> 'corrijo la nota' THEN
    RAISE EXCEPTION '6: el guard también bloqueó las notas'; END IF;

  SET LOCAL ROLE authenticated;
  UPDATE public.registros SET deleted_at = now(), deleted_by = LUCIA WHERE id = reg.id;
  RESET ROLE;
  SELECT * INTO fila FROM public.registros WHERE id = reg.id;
  IF fila.deleted_at IS NULL THEN
    RAISE EXCEPTION '6: el borrado lógico dejó de funcionar'; END IF;
  RAISE NOTICE 'OK 6   notas, foto, gps y el borrado lógico siguen siendo un UPDATE normal';

  DELETE FROM public.registros WHERE id = reg.id;
END $$;

-- ── 7-12 · El camino autorizado ─────────────────────────────────────────────
DO $$
DECLARE
  M1     constant uuid := 'c0000000-0000-0000-0000-000000000001';
  LUCIA  constant uuid := 'e0000000-0000-0000-0000-000000000001';
  HOY    date := (now() AT TIME ZONE 'America/Guatemala')::date;
  reg    public.registros;
  fac     public.registros;
  n       bigint;
  ok      boolean;
  base    numeric;
  total   numeric;
  parcial numeric;
BEGIN
  PERFORM set_config('app.uid', LUCIA::text, false);
  SELECT * INTO reg FROM public.registrar_lectura(
    M1, 190, HOY, 'idem-upd-cobro-0001', 'Ciclo de cobro', NULL, NULL);
  IF COALESCE(reg.monto_calculado, 0) <= 0 THEN
    RAISE EXCEPTION '7: la lectura base salió sin importe (%)', reg.monto_calculado; END IF;
  base := reg.monto_calculado;

  -- 7 · EMITIR: el snapshot lo calcula el servidor. IVA 12% del tenant, días de
  -- la regla de mora activa del proyecto (15), total = base + IVA + mora. Los
  -- números esperados se derivan de la propia base y NO se fijan a mano: lo que
  -- se afirma es la ARITMÉTICA (la misma de calcularTotalFactura y de
  -- agua_cerrar_ciclo_nucleo), no un importe concreto que dependa de cuántas
  -- lecturas lleve el contador.
  SELECT * INTO fac FROM public.agua_factura_emitir(reg.id);
  IF fac.factura_estado <> 'emitida' THEN
    RAISE EXCEPTION '7: factura_estado salió %', fac.factura_estado; END IF;
  IF fac.iva_tasa <> 0.12
     OR fac.iva_monto <> round(base * 0.12, 2)
     OR fac.monto_con_iva <> round(base + round(base * 0.12, 2), 2)
     OR fac.total_a_pagar <> round(base + round(base * 0.12, 2), 2) THEN
    RAISE EXCEPTION '7: el desglose salió iva % monto_con_iva % total % sobre una base de %',
      fac.iva_monto, fac.monto_con_iva, fac.total_a_pagar, base; END IF;
  IF fac.fecha_vencimiento <> (now() + interval '15 days')::date THEN
    RAISE EXCEPTION '7: el vencimiento salió % (esperado +15 días, la regla activa del proyecto)', fac.fecha_vencimiento; END IF;
  IF fac.emitida_at IS NULL THEN RAISE EXCEPTION '7: sin emitida_at'; END IF;
  RAISE NOTICE 'OK 7   emitir calcula IVA, total y vencimiento en el servidor: ninguno es parámetro';

  -- 8 · La máquina de estados: emitir dos veces, no.
  ok := false;
  BEGIN
    PERFORM public.agua_factura_emitir(reg.id);
  EXCEPTION WHEN restrict_violation OR invalid_parameter_value OR data_exception THEN ok := true;
  END;
  IF NOT ok THEN RAISE EXCEPTION '8: se emitió dos veces la misma factura'; END IF;
  RAISE NOTICE 'OK 8   la máquina de estados vive en el servidor: no se emite dos veces';

  -- 9 · PAGAR: el abono parcial no liquida; el que completa, sí.
  ok := false;
  BEGIN PERFORM public.agua_factura_registrar_pago(reg.id, 0);
  EXCEPTION WHEN data_exception THEN ok := true; END;
  IF NOT ok THEN RAISE EXCEPTION '9: se aceptó un pago de 0'; END IF;

  ok := false;
  BEGIN PERFORM public.agua_factura_registrar_pago(reg.id, fac.total_a_pagar + 1);
  EXCEPTION WHEN data_exception THEN ok := true; END;
  IF NOT ok THEN RAISE EXCEPTION '9: se aceptó un pago que excede el saldo'; END IF;

  total  := fac.total_a_pagar;
  parcial := round(total / 2, 2);

  SELECT * INTO fac FROM public.agua_factura_registrar_pago(reg.id, parcial);
  IF fac.monto_pagado <> parcial OR fac.estado <> 'pendiente'
     OR fac.factura_estado <> 'emitida' OR fac.fecha_pago IS NOT NULL THEN
    RAISE EXCEPTION '9: el abono parcial liquidó (abonado %, estado %, factura %)',
      fac.monto_pagado, fac.estado, fac.factura_estado; END IF;

  SELECT * INTO fac FROM public.agua_factura_registrar_pago(reg.id, total - parcial);
  IF fac.monto_pagado <> total OR fac.estado <> 'pagado'
     OR fac.factura_estado <> 'pagada' OR fac.pagada_at IS NULL
     OR fac.fecha_pago IS NULL THEN
    RAISE EXCEPTION '9: el pago que liquida no cerró la factura (abonado %, estado %, factura %)',
      fac.monto_pagado, fac.estado, fac.factura_estado; END IF;

  ok := false;
  BEGIN PERFORM public.agua_factura_registrar_pago(reg.id, 10);
  EXCEPTION WHEN data_exception THEN ok := true; END;
  IF NOT ok THEN RAISE EXCEPTION '9: se cobró sobre una factura ya pagada'; END IF;
  RAISE NOTICE 'OK 9   pagar: el monto es el único dato de entrada; el abonado, la fecha y la transición los pone el servidor';

  -- 10 · ANULAR, sobre otra lectura (la pagada es terminal).
  SELECT * INTO reg FROM public.registrar_lectura(
    M1, 200, HOY, 'idem-upd-cobro-0002', 'Para anular', NULL, NULL);
  SELECT * INTO fac FROM public.agua_factura_anular(reg.id, 'lectura repetida por error');
  IF fac.factura_estado <> 'anulada' OR fac.anulada_at IS NULL THEN
    RAISE EXCEPTION '10: la anulación no quedó (%)' , fac.factura_estado; END IF;
  ok := false;
  BEGIN PERFORM public.agua_factura_anular(reg.id);
  EXCEPTION WHEN data_exception THEN ok := true; END;
  IF NOT ok THEN RAISE EXCEPTION '10: se anuló una factura ya anulada'; END IF;
  RAISE NOTICE 'OK 10  anular deja rastro y es terminal';

  -- 11 · MORA y cambio de estado a mano. Y "pagado" a mano, NO.
  SELECT * INTO reg FROM public.registrar_lectura(
    M1, 210, HOY, 'idem-upd-cobro-0003', 'Para mora', NULL, NULL);
  IF public.agua_registro_marcar_mora(ARRAY[reg.id]) <> 1 THEN
    RAISE EXCEPTION '11: marcar_mora no marcó'; END IF;
  SELECT * INTO fac FROM public.registros WHERE id = reg.id;
  IF fac.estado <> 'mora' THEN RAISE EXCEPTION '11: el estado salió %', fac.estado; END IF;

  SELECT * INTO fac FROM public.agua_registro_cambiar_estado(reg.id, 'pendiente');
  IF fac.estado <> 'pendiente' THEN RAISE EXCEPTION '11: no volvió a pendiente'; END IF;

  ok := false;
  BEGIN PERFORM public.agua_registro_cambiar_estado(reg.id, 'pagado');
  EXCEPTION WHEN insufficient_privilege THEN ok := true; END;
  IF NOT ok THEN
    RAISE EXCEPTION '11: se marcó "pagado" a mano, sin pago, sin monto y sin fecha'; END IF;
  RAISE NOTICE 'OK 11  mora y estado se cambian por su RPC; "pagado" a mano se rechaza (exige registrar el pago)';

  -- 12 · La auditoría llegó, pese a que `authenticated` no escribe en la tabla.
  SELECT count(*) INTO n FROM public.security_logs
   WHERE event_type LIKE 'agua_cobro.%' AND user_id = LUCIA;
  -- Seis transiciones: emitir, dos pagos, anular, mora y cambio de estado.
  IF n <> 6 THEN
    RAISE EXCEPTION '12: % filas de auditoría (esperadas 6: emitir, 2 pagos, anular, mora, estado)', n; END IF;
  SELECT count(*) INTO n FROM public.security_logs
   WHERE event_type = 'agua_cobro.registrar_pago'
     AND (details ->> 'liquida')::boolean
     AND (details ->> 'monto')::numeric > 0
     AND (details ->> 'abonado')::numeric = (details ->> 'total')::numeric;
  IF n <> 1 THEN
    RAISE EXCEPTION '12: el pago que liquidó no quedó auditado con su monto y su saldo'; END IF;
  RAISE NOTICE 'OK 12  cada transición deja su fila en security_logs, con monto y proyecto';
END $$;

-- ── 13-15 · La autorización de las RPC ──────────────────────────────────────
DO $$
DECLARE
  M1    constant uuid := 'c0000000-0000-0000-0000-000000000001';
  LUCIA constant uuid := 'e0000000-0000-0000-0000-000000000001';
  BETO  constant uuid := 'e0000000-0000-0000-0000-000000000002';
  NADIA constant uuid := 'e0000000-0000-0000-0000-000000000003';
  HOY   date := (now() AT TIME ZONE 'America/Guatemala')::date;
  reg   public.registros;
  ok    boolean;
BEGIN
  PERFORM set_config('app.uid', LUCIA::text, false);
  SELECT * INTO reg FROM public.registrar_lectura(
    M1, 230, HOY, 'idem-upd-acl-0001', 'Para la ACL', NULL, NULL);

  -- 13 · Beto captura lecturas y no cobra: ninguna RPC de cobro le contesta.
  PERFORM set_config('app.uid', BETO::text, false);
  ok := false;
  BEGIN PERFORM public.agua_factura_emitir(reg.id);
  EXCEPTION WHEN insufficient_privilege THEN ok := true; END;
  IF NOT ok THEN RAISE EXCEPTION '13: Beto emitió una factura sin permiso de cobro'; END IF;
  ok := false;
  BEGIN PERFORM public.agua_factura_registrar_pago(reg.id, 10);
  EXCEPTION WHEN insufficient_privilege THEN ok := true; END;
  IF NOT ok THEN RAISE EXCEPTION '13: Beto registró un pago sin permiso de cobro'; END IF;
  ok := false;
  BEGIN PERFORM public.agua_registro_marcar_mora(ARRAY[reg.id]);
  EXCEPTION WHEN insufficient_privilege THEN ok := true; END;
  IF NOT ok THEN RAISE EXCEPTION '13: Beto marcó mora sin permiso de cobro'; END IF;
  RAISE NOTICE 'OK 13  quien captura lecturas no cobra: las RPC exigen el permiso de cobro';

  -- 14 · La empresa vecina no existe para este registro.
  PERFORM set_config('app.uid', NADIA::text, false);
  ok := false;
  BEGIN PERFORM public.agua_factura_emitir(reg.id);
  EXCEPTION WHEN insufficient_privilege THEN ok := true; END;
  IF NOT ok THEN RAISE EXCEPTION '14: otro tenant emitió la factura'; END IF;
  RAISE NOTICE 'OK 14  el cruce de tenant se rechaza en el guard, no en la RLS de rebote';

  -- 15 · La ACL: quién puede ejecutar qué.
  IF EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace ns ON ns.oid = p.pronamespace
     WHERE ns.nspname = 'public'
       AND p.proname IN ('agua_factura_emitir','agua_factura_anular','agua_factura_registrar_pago',
                         'agua_registro_marcar_mora','agua_registro_cambiar_estado',
                         'agua_cobro_auditar','agua_cobro_guard',
                         'agua_tg_registros_proteger_update','agua_lecturas_inconsistencias')
       AND has_function_privilege('anon', p.oid, 'EXECUTE')
  ) THEN RAISE EXCEPTION '15: algo del cobro quedó ejecutable por anon'; END IF;

  IF has_function_privilege('authenticated', 'public.agua_cobro_guard(uuid, text)', 'EXECUTE') THEN
    RAISE EXCEPTION '15: el guard quedó ejecutable por authenticated'; END IF;
  IF has_function_privilege('authenticated', 'public.agua_tg_registros_proteger_update()', 'EXECUTE') THEN
    RAISE EXCEPTION '15: el cuerpo del trigger quedó ejecutable por authenticated'; END IF;
  IF NOT has_function_privilege('authenticated',
        'public.agua_factura_emitir(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION '15: authenticated no puede emitir'; END IF;

  -- Y la auditoría suelta, sin la llave de capacidad, no escribe nada.
  ok := false;
  BEGIN PERFORM public.agua_cobro_auditar(reg.id, 'inventado', '{}'::jsonb);
  EXCEPTION WHEN insufficient_privilege THEN ok := true; END;
  IF NOT ok THEN RAISE EXCEPTION '15: se pudo fabricar una fila de auditoría desde fuera de una RPC'; END IF;
  -- La firma de dos argumentos se elimina, no se deja como sobrecarga: dejarla
  -- viva sería dejar abierta la puerta que se cierra.
  IF to_regprocedure('public.agua_factura_emitir(uuid, integer)') IS NOT NULL THEN
    RAISE EXCEPTION '15: sigue viva agua_factura_emitir(uuid, integer) — el plazo vuelve a ser un parámetro del cliente'; END IF;
  IF has_function_privilege('authenticated', 'public.agua_cobro_bloquear(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION '15: el bloqueo quedó ejecutable por authenticated'; END IF;
  RAISE NOTICE 'OK 15  anon no ejecuta nada; el guard, el bloqueo y el trigger no son API; la auditoría no se fabrica desde fuera; el plazo ya no es parámetro';
END $$;

-- ── 16 · La excepción de `service_role`, enumerada ──────────────────────────
DO $$
DECLARE
  M1    constant uuid := 'c0000000-0000-0000-0000-000000000001';
  LUCIA constant uuid := 'e0000000-0000-0000-0000-000000000001';
  HOY   date := (now() AT TIME ZONE 'America/Guatemala')::date;
  reg   public.registros;
  fila  public.registros;
BEGIN
  PERFORM set_config('app.uid', LUCIA::text, false);
  SELECT * INTO reg FROM public.registrar_lectura(
    M1, 250, HOY, 'idem-upd-service-0001', 'Para service_role', NULL, NULL);

  -- El timbrado fiscal, la purga de fotos, los backfills y el cron corren con
  -- esta llave. No es el navegador, que es el sujeto del problema.
  SET LOCAL ROLE service_role;
  UPDATE public.registros
     SET monto_calculado = 1, estado = 'pagado', foto = NULL
   WHERE id = reg.id;
  RESET ROLE;

  SELECT * INTO fila FROM public.registros WHERE id = reg.id;
  IF fila.monto_calculado <> 1 OR fila.estado <> 'pagado' THEN
    RAISE EXCEPTION '16: service_role perdió la excepción documentada (monto %, estado %)',
      fila.monto_calculado, fila.estado; END IF;
  RAISE NOTICE 'OK 16  service_role conserva su excepción (timbrado, purga, backfills, cron) y ningún otro rol la tiene';

  DELETE FROM public.registros WHERE id = reg.id;
END $$;

-- ── 17-21 · El reporte: quién NO lo ve, y quién sí ──────────────────────────
DO $$
DECLARE
  P1     constant uuid := '11111111-0000-0000-0000-000000000001';
  M1     constant uuid := 'c0000000-0000-0000-0000-000000000001';
  LUCIA  constant uuid := 'e0000000-0000-0000-0000-000000000001';
  BETO   constant uuid := 'e0000000-0000-0000-0000-000000000002';
  NADIA  constant uuid := 'e0000000-0000-0000-0000-000000000003';
  RESI   constant uuid := 'e0000000-0000-0000-0000-00000000000c';
  ACME   constant uuid := 'aaaaaaaa-0000-0000-0000-00000000000a';
  n      bigint;
  m      bigint;
BEGIN
  -- Una fila históricamente incoherente, escrita por la vía de sistema (que es
  -- de donde vienen: backfills y el cliente viejo). Sin ella el reporte no
  -- tendría nada que enseñar y las invariantes pasarían por vacías.
  -- El claim, además del rol: `trg_agua_lectura_autoritativa` (20260910000200)
  -- es SECURITY DEFINER, y ahí `current_user` es el DUEÑO de la función, no el
  -- rol de la petición — su comprobación de `current_user = 'service_role'` no
  -- puede dar true nunca. Lo que sí funciona, y es lo que usa Supabase, es el
  -- claim del JWT. Se emula tal cual para que la siembra de sistema entre como
  -- entra en producción (si no, la regla de retroactividad la rechazaría).
  PERFORM set_config('request.jwt.claims', '{"role":"service_role"}', true);
  SET LOCAL ROLE service_role;
  INSERT INTO public.registros (
    contador_id, project_id, cliente_id, cliente_nombre, fecha,
    lectura_anterior, lectura_actual, consumo, tarifa_aplicada,
    monto_calculado, estado, mes
  ) VALUES (
    M1, P1, 'c1000000-0000-0000-0000-000000000001', 'Familia Pérez',
    now() - interval '400 days', 0, 10, 999, 5.00, 0, 'pendiente', '2025-08'
  );
  RESET ROLE;
  PERFORM set_config('request.jwt.claims', '', true);

  -- 17 · BETO: misma empresa, ASIGNADO al proyecto, sin permiso de lectura.
  -- Las dos condiciones que usaba la versión vieja se cumplen —y aun así no ve
  -- nada—: eso es exactamente lo que probaba que aquella autorización no era
  -- la de `registros_select`.
  PERFORM set_config('app.uid', BETO::text, false);
  IF public.get_my_company_id() <> ACME OR NOT public.can_access_project(P1) THEN
    RAISE EXCEPTION '17: la demostración no aplica — Beto ya no pasa el predicado viejo'; END IF;
  SELECT count(*) INTO n FROM public.agua_lecturas_inconsistencias(NULL);
  IF n <> 0 THEN
    RAISE EXCEPTION '17: Beto, sin permiso de lectura, recibió % hallazgos del proyecto', n; END IF;
  SELECT count(*) INTO m FROM public.agua_lecturas_inconsistencias_resumen(NULL);
  IF m <> 0 THEN RAISE EXCEPTION '17: el resumen sí le contestó a Beto'; END IF;
  RAISE NOTICE 'OK 17  misma empresa y mismo proyecto, sin permiso de lectura: cero filas (y el predicado viejo sí lo dejaba pasar)';

  -- 18 · LUCÍA, con permiso, ve lo suyo: el proyecto Uno y nada más.
  PERFORM set_config('app.uid', LUCIA::text, false);
  SELECT count(*) INTO n FROM public.agua_lecturas_inconsistencias(NULL);
  IF n = 0 THEN RAISE EXCEPTION '18: con permiso válido el reporte salió vacío'; END IF;
  SELECT count(*) INTO m FROM public.agua_lecturas_inconsistencias(NULL) i
   WHERE i.project_id <> P1;
  IF m <> 0 THEN
    RAISE EXCEPTION '18: Lucía recibió % filas de proyectos a los que no tiene acceso', m; END IF;
  RAISE NOTICE 'OK 18  con permiso válido: sólo los proyectos permitidos (% hallazgos, todos del Uno)', n;

  -- 19 · La empresa vecina: cero.
  PERFORM set_config('app.uid', NADIA::text, false);
  SELECT count(*) INTO n FROM public.agua_lecturas_inconsistencias(NULL);
  IF n <> 0 THEN RAISE EXCEPTION '19: otro tenant recibió % filas', n; END IF;
  RAISE NOTICE 'OK 19  otro tenant: cero datos';

  -- 20 · El RESIDENTE: rol `cliente`, asignado al proyecto y CON un permiso de
  -- lectura de agua. Pasa las dos puertas viejas y aun así no recibe el
  -- agregado del condominio — sus filas las ve por el portal, no por aquí.
  PERFORM set_config('app.uid', RESI::text, false);
  IF public.get_my_company_id() <> ACME OR NOT public.can_access_project(P1)
     OR NOT public.user_has_permission('agua.cobros.view') THEN
    RAISE EXCEPTION '20: la demostración no aplica — el residente ya no pasa el predicado viejo'; END IF;
  SELECT count(*) INTO n FROM public.agua_lecturas_inconsistencias(P1);
  IF n <> 0 THEN
    RAISE EXCEPTION '20: un residente recibió % hallazgos del condominio entero', n; END IF;
  RAISE NOTICE 'OK 20  un residente no consulta el reporte del proyecto, ni con permiso de cobros.view';

  -- 21 · Y sigue sin escribir nada: STABLE.
  SELECT count(*) INTO n FROM pg_proc p JOIN pg_namespace ns ON ns.oid = p.pronamespace
   WHERE ns.nspname = 'public'
     AND p.proname IN ('agua_lecturas_inconsistencias','agua_lecturas_inconsistencias_resumen')
     AND p.provolatile <> 's';
  IF n <> 0 THEN RAISE EXCEPTION '21: el reporte dejó de ser STABLE — podría escribir'; END IF;
  RAISE NOTICE 'OK 21  el reporte sigue siendo STABLE: no puede escribir aunque el SQL lo intentara';
END $$;

-- ── 22 · El camino completo, COMO `authenticated` y con la RLS puesta ───────
DO $$
DECLARE
  M1    constant uuid := 'c0000000-0000-0000-0000-000000000001';
  LUCIA constant uuid := 'e0000000-0000-0000-0000-000000000001';
  HOY   date := (now() AT TIME ZONE 'America/Guatemala')::date;
  reg   public.registros;
  fac   public.registros;
BEGIN
  SET LOCAL ROLE authenticated;
  PERFORM set_config('app.uid', LUCIA::text, false);

  SELECT * INTO reg FROM public.registrar_lectura(
    M1, 300, HOY, 'idem-upd-auth-0001', 'Como authenticated', NULL, NULL);
  SELECT * INTO fac FROM public.agua_factura_emitir(reg.id);
  IF fac.factura_estado <> 'emitida' OR fac.total_a_pagar IS NULL THEN
    RAISE EXCEPTION '22: emitir no funcionó como authenticated'; END IF;

  SELECT * INTO fac FROM public.agua_factura_registrar_pago(reg.id, fac.total_a_pagar);
  IF fac.estado <> 'pagado' OR fac.factura_estado <> 'pagada' THEN
    RAISE EXCEPTION '22: pagar no funcionó como authenticated (estado %, factura %)',
      fac.estado, fac.factura_estado; END IF;

  RESET ROLE;
  RAISE NOTICE 'OK 22  una cobradora real emite y cobra por el camino autorizado, con la RLS puesta';
END $$;

-- ── 23-25 · La exención de `postgres` cerrada, y la capacidad por función ───
DO $$
DECLARE
  M1    constant uuid := 'c0000000-0000-0000-0000-000000000001';
  P1    constant uuid := '11111111-0000-0000-0000-000000000001';
  LUCIA constant uuid := 'e0000000-0000-0000-0000-000000000001';
  HOY   date := (now() AT TIME ZONE 'America/Guatemala')::date;
  reg   public.registros;
  fila  public.registros;
  ok    boolean;
  cfg   text[];
BEGIN
  PERFORM set_config('app.uid', LUCIA::text, false);
  SELECT * INTO reg FROM public.registrar_lectura(
    M1, 400, HOY, 'idem-upd-definer-0001', 'Para la DEFINER hostil', NULL, NULL);

  -- 23 · UNA SECURITY DEFINER INVOCABLE POR `authenticated` NO PASA.
  -- Es el agujero que dejaba la exención por `current_user`: dentro de una
  -- DEFINER `current_user` es el DUEÑO (`postgres`), así que la lista
  -- ('service_role','postgres','supabase_admin') eximía a CUALQUIER función
  -- DEFINER del esquema — incluida ésta, que sólo existe para demostrarlo.
  SET LOCAL ROLE authenticated;
  ok := false;
  BEGIN
    PERFORM public.test_definer_falsifica_cobro(reg.id);
  EXCEPTION WHEN insufficient_privilege THEN
    -- Toca `monto_calculado` (inmutable) y `estado`/`monto_pagado` (cobro): el
    -- guard corta en el primero que encuentra, y cualquiera de los dos mensajes
    -- prueba que cortó el GUARD y no otra cosa.
    ok := SQLERRM LIKE '%es inmutable%' OR SQLERRM LIKE '%el cobro no se edita%';
  END;
  RESET ROLE;
  IF NOT ok THEN
    RAISE EXCEPTION '23: una SECURITY DEFINER invocable por authenticated fabricó el cobro'; END IF;

  SELECT * INTO fila FROM public.registros WHERE id = reg.id;
  IF fila.monto_calculado <> reg.monto_calculado OR fila.estado <> 'pendiente'
     OR COALESCE(fila.monto_pagado, 0) <> 0 THEN
    RAISE EXCEPTION '23: la fila cambió pese al rechazo (monto %, estado %, abonado %)',
      fila.monto_calculado, fila.estado, fila.monto_pagado; END IF;
  RAISE NOTICE 'OK 23  una SECURITY DEFINER ejecutable por authenticated ya NO elude el guard (42501)';

  -- 24 · Y con la llave DE COBRO puesta tampoco toca la lectura: son dos
  -- capacidades distintas, y la del cobro no compra la del histórico.
  SET LOCAL ROLE authenticated;
  ok := false;
  BEGIN
    PERFORM public.test_definer_falsifica_lectura(reg.id);
  EXCEPTION WHEN insufficient_privilege THEN
    ok := SQLERRM LIKE '%es inmutable%';
  END;
  RESET ROLE;
  IF NOT ok THEN
    RAISE EXCEPTION '24: con la llave de cobro se pudo reescribir el consumo'; END IF;
  RAISE NOTICE 'OK 24  la llave de cobro no abre las columnas de la lectura';

  -- 25 · Los DOS caminos de sistema enumerados SÍ pasan, y por la capacidad
  -- POR FUNCIÓN, no por su rol.
  --
  -- La llave va en el CUERPO, no en `proconfig`. No es una preferencia: meter un
  -- GUC de clase personalizada en `proconfig` está reservado al superusuario
  -- (`validate_option_array_item` → `42501 permission denied to set parameter`)
  -- y el `postgres` de una Supabase gestionada no lo es. Con `ALTER FUNCTION …
  -- SET` la migración abortaba la cadena entera; se vio en la Supabase Preview
  -- de #847 el 2026-09-11. Aquí no se veía porque este arnés levanta Postgres
  -- con `initdb` y ahí `postgres` SÍ es superusuario — por eso esta invariante
  -- ahora exige lo contrario: que NADIE la lleve en proconfig.
  IF EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public'
       AND p.proconfig IS NOT NULL
       AND 'agua.cobro_autoritativo=on' = ANY (p.proconfig)
  ) THEN
    RAISE EXCEPTION '25: alguna función lleva la llave en proconfig — eso no lo puede aplicar Supabase (42501)'; END IF;

  -- Y la llevan en el cuerpo, las dos y sólo las dos.
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.proname = 'agua_cerrar_ciclo_nucleo'
       AND p.prosrc LIKE '%set_config(''agua.cobro_autoritativo'', ''on'', true)%'
  ) THEN
    RAISE EXCEPTION '25: agua_cerrar_ciclo_nucleo no enciende la llave en su cuerpo'; END IF;
  -- La mora del cron la lleva la ENVOLTURA, no la función real: esa tiene drift
  -- declarado contra producción y tocarla desde el repositorio dejaría el
  -- auditor de tres vías en ambiguo.
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.proname = 'agua_mora_cron_aplicar'
       AND p.prosrc LIKE '%set_config(''agua.cobro_autoritativo'', ''on'', true)%'
  ) THEN
    RAISE EXCEPTION '25: agua_mora_cron_aplicar no enciende la llave en su cuerpo'; END IF;
  IF EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.proname = 'aplicar_mora_facturas_vencidas'
       AND p.prosrc LIKE '%agua.cobro_autoritativo%'
  ) THEN
    RAISE EXCEPTION '25: la función con drift recibió la llave — eso es el ambiguo del auditor'; END IF;

  -- Y funciona de verdad: el cierre de ciclo emite sobre una fila pendiente.
  PERFORM public.agua_cerrar_ciclo_nucleo(P1, to_char(HOY, 'YYYY-MM'), false);
  SELECT * INTO fila FROM public.registros WHERE id = reg.id;
  IF fila.factura_estado <> 'emitida' THEN
    RAISE EXCEPTION '25: el cierre de ciclo no pudo emitir con su llave por función (estado %)',
      fila.factura_estado; END IF;

  -- La mora, sin la envoltura, se estrella contra el guard aunque corra como el
  -- DUEÑO: es la demostración de que la exención de `postgres` ya no existe.
  ok := false;
  BEGIN
    PERFORM public.aplicar_mora_facturas_vencidas();
  EXCEPTION WHEN insufficient_privilege THEN ok := true; END;
  IF NOT ok THEN
    RAISE EXCEPTION '25: la mora escribió el cobro sin llave, corriendo como postgres'; END IF;

  -- Con la envoltura sí, y eso prueba lo único que hacía falta probar: que el
  -- `SET` de la envoltura cubre la llamada ANIDADA.
  PERFORM public.agua_mora_cron_aplicar();
  SELECT * INTO fila FROM public.registros WHERE id = reg.id;
  IF COALESCE(fila.mora_monto, 0) <> 25.00 THEN
    RAISE EXCEPTION '25: la envoltura no le pasó la llave a la función anidada (mora %)',
      fila.mora_monto; END IF;

  -- Ninguna otra función del esquema la enciende: la capacidad está enumerada,
  -- no repartida. La lista son las dos vías de sistema y las RPC de cobro, que
  -- la encienden tras validar el permiso.
  IF EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public'
       AND p.prosrc LIKE '%set_config(''agua.cobro_autoritativo'', ''on''%'
       AND p.proname NOT IN (
         'agua_cerrar_ciclo_nucleo', 'agua_mora_cron_aplicar',
         'agua_factura_emitir', 'agua_factura_anular', 'agua_factura_registrar_pago',
         'agua_registro_marcar_mora', 'agua_registro_cambiar_estado',
         'agua_registro_acreditar_pago_externo',
         -- La DEFINER hostil del fixture: la enciende a propósito, es el ataque
         -- que la invariante 24 ejerce. Nombrada, no filtrada por prefijo, para
         -- que un fixture nuevo que la encienda tenga que declararse aquí.
         'test_definer_falsifica_lectura'
       )
  ) THEN
    RAISE EXCEPTION '25: alguna otra función enciende la llave de cobro'; END IF;
  RAISE NOTICE 'OK 25  la capacidad va por FUNCIÓN: el cierre de ciclo la enciende, la mora la recibe de su envoltura, y nadie más';

  -- 25b · La llave NO sobrevive a la función que la encendió.
  --
  -- Es la propiedad que `proconfig` daba de regalo y que `set_config(…, true)`
  -- NO da: un SET local vive hasta el final de la TRANSACCIÓN, no de la función.
  -- Si el núcleo no la apagara al salir, el resto de esta misma transacción
  -- —el cron actualiza cierre_ciclo_config y encola avisos después de que el
  -- núcleo devuelve— quedaría con la capacidad puesta. Se comprueba de las dos
  -- formas: leyendo el GUC y, sobre todo, EJERCIENDO el UPDATE que debe fallar.
  --
  -- «Apagada» NO es literalmente 'off': el valor de reposo de un GUC de clase
  -- personalizada es la cadena VACÍA, y ahí vuelve cuando se desapila. El guard
  -- exige 'on' para abrir, así que lo que se comprueba es que NO esté en 'on'.
  IF COALESCE(current_setting('agua.cobro_autoritativo', true), '') = 'on' THEN
    RAISE EXCEPTION '25b: la llave sobrevivió al cierre de ciclo (%)',
      current_setting('agua.cobro_autoritativo', true); END IF;
  ok := false;
  BEGIN
    UPDATE public.registros SET monto_pagado = 999999 WHERE id = reg.id;
  EXCEPTION WHEN insufficient_privilege THEN ok := true; END;
  IF NOT ok THEN
    RAISE EXCEPTION '25b: tras el cierre de ciclo se pudo escribir el cobro a pelo en la misma transacción'; END IF;
  RAISE NOTICE 'OK 25b la llave se apaga al salir: la transacción que llamó al cierre no la hereda';
END $$;

-- ── 26-27 · Concurrencia real: dos conexiones sobre la misma factura ────────
-- La preparación va en su PROPIO bloque, y no es un detalle de estilo: psql
-- envuelve cada DO en una transacción, así que una fila creada dentro del mismo
-- bloque que abre la segunda conexión todavía no está confirmada y la otra
-- sesión no la ve. Primero se crean y emiten las dos facturas —eso confirma—,
-- después se corre la carrera.
DO $$
DECLARE
  M1    constant uuid := 'c0000000-0000-0000-0000-000000000001';
  LUCIA constant uuid := 'e0000000-0000-0000-0000-000000000001';
  HOY   date := (now() AT TIME ZONE 'America/Guatemala')::date;
  reg   public.registros;
  fac   public.registros;
BEGIN
  PERFORM set_config('app.uid', LUCIA::text, false);

  SELECT * INTO reg FROM public.registrar_lectura(
    M1, 450, HOY, 'idem-upd-carrera-0001', 'Para la carrera de abonos', NULL, NULL);
  SELECT * INTO fac FROM public.agua_factura_emitir(reg.id);
  PERFORM set_config('app.carrera_pago', reg.id::text, false);
  PERFORM set_config('app.carrera_total', fac.total_a_pagar::text, false);

  SELECT * INTO reg FROM public.registrar_lectura(
    M1, 460, HOY, 'idem-upd-carrera-0002', 'Para la carrera de emisión', NULL, NULL);
  PERFORM set_config('app.carrera_emision', reg.id::text, false);
END $$;

DO $$
DECLARE
  LUCIA  constant uuid := 'e0000000-0000-0000-0000-000000000001';
  v_conn text    := current_setting('app.conn');
  v_id   uuid    := current_setting('app.carrera_pago')::uuid;
  total  numeric := current_setting('app.carrera_total')::numeric;
  abono  numeric;
  remoto numeric;
  fila   public.registros;
  n      bigint;
BEGIN
  PERFORM set_config('app.uid', LUCIA::text, false);
  abono := round(total / 3, 2);

  -- 26 · DOS ABONOS QUE SE SOLAPAN DE VERDAD.
  --
  -- La forma obvia —abrir transacción en la otra conexión y ver que ésta se
  -- rinde por `lock_timeout`— NO prueba nada: un `UPDATE` a secas también
  -- bloquea la fila, así que ese test pasaría igual SIN el `FOR UPDATE` y el
  -- abono se seguiría perdiendo. Lo que hay que reproducir es el solapamiento
  -- exacto: que la segunda sesión LEA el abonado mientras la primera todavía no
  -- ha confirmado.
  --
  -- Por eso la consulta remota va ASÍNCRONA. Esta sesión abona y NO confirma;
  -- la otra dispara su abono y se queda esperando; esta sesión confirma; la
  -- otra despierta. Con `FOR UPDATE`, la lectura del abonado de la segunda
  -- estaba bloqueada y al despertar ve 1×abono y deja 2×abono. Sin él, habría
  -- leído 0 antes de bloquearse y dejaría 1×abono: un pago cobrado al cliente
  -- y perdido en la factura.
  PERFORM public.dblink_connect('carrera', v_conn);
  PERFORM t.x FROM public.dblink('carrera',
    format('SELECT set_config(%L, %L, false)', 'app.uid', LUCIA::text)) AS t(x text);

  PERFORM public.agua_factura_registrar_pago(v_id, abono);   -- local, SIN confirmar

  PERFORM public.dblink_send_query('carrera',
    format('SELECT monto_pagado FROM public.agua_factura_registrar_pago(%L, %s)', v_id, abono));
  PERFORM pg_sleep(0.5);   -- lo justo para que la otra llegue al bloqueo

  COMMIT;                  -- y aquí la otra despierta

  SELECT t.x INTO remoto FROM public.dblink_get_result('carrera') AS t(x numeric);
  PERFORM public.dblink_disconnect('carrera');

  IF remoto IS DISTINCT FROM round(abono * 2, 2) THEN
    RAISE EXCEPTION '26: el segundo abono dejó % (esperado %) — se perdió uno',
      remoto, round(abono * 2, 2); END IF;

  SELECT * INTO fila FROM public.registros WHERE id = v_id;
  IF fila.monto_pagado <> round(abono * 2, 2) THEN
    RAISE EXCEPTION '26: la fila quedó con % abonado (esperado %)',
      fila.monto_pagado, round(abono * 2, 2); END IF;
  IF fila.monto_pagado > total + 0.005 THEN
    RAISE EXCEPTION '26: los dos abonos juntos se pasaron del saldo'; END IF;
  IF fila.factura_estado <> 'emitida' THEN
    RAISE EXCEPTION '26: dos tercios del total liquidaron la factura (%)', fila.factura_estado; END IF;

  SELECT count(*) INTO n FROM public.security_logs
   WHERE event_type = 'agua_cobro.registrar_pago'
     AND (details ->> 'registro_id')::uuid = v_id;
  IF n <> 2 THEN
    RAISE EXCEPTION '26: % filas de auditoría para dos abonos (esperadas 2)', n; END IF;
  RAISE NOTICE 'OK 26  dos abonos solapados de verdad: los dos se contabilizan, una sola vez cada uno, y el saldo cuadra';
END $$;

DO $$
DECLARE
  LUCIA  constant uuid := 'e0000000-0000-0000-0000-000000000001';
  v_conn text := current_setting('app.conn');
  v_id   uuid := current_setting('app.carrera_emision')::uuid;
  ok     boolean := false;
  n      bigint;
  fila   public.registros;
BEGIN
  PERFORM set_config('app.uid', LUCIA::text, false);

  -- 27 · DOS EMISIONES QUE SE SOLAPAN. Mismo solapamiento real: sin el
  -- bloqueo, la segunda leería `factura_estado` = 'pendiente' antes de que la
  -- primera confirmara y emitiría OTRA VEZ, pisando `emitida_at` y el total.
  PERFORM public.dblink_connect('carrera2', v_conn);
  PERFORM t.x FROM public.dblink('carrera2',
    format('SELECT set_config(%L, %L, false)', 'app.uid', LUCIA::text)) AS t(x text);

  PERFORM public.agua_factura_emitir(v_id);   -- local, SIN confirmar

  PERFORM public.dblink_send_query('carrera2',
    format('SELECT 1 FROM public.agua_factura_emitir(%L)', v_id));
  PERFORM pg_sleep(0.5);

  COMMIT;

  BEGIN
    PERFORM t.x FROM public.dblink_get_result('carrera2') AS t(x integer);
  EXCEPTION WHEN OTHERS THEN
    ok := SQLERRM LIKE '%transición inválida%';
  END;
  PERFORM public.dblink_disconnect('carrera2');

  IF NOT ok THEN RAISE EXCEPTION '27: la segunda emisión no se rechazó'; END IF;

  SELECT count(*) INTO n FROM public.security_logs
   WHERE event_type = 'agua_cobro.emitir' AND (details ->> 'registro_id')::uuid = v_id;
  IF n <> 1 THEN RAISE EXCEPTION '27: % emisiones auditadas (esperada 1)', n; END IF;

  SELECT * INTO fila FROM public.registros WHERE id = v_id;
  IF fila.factura_estado <> 'emitida' THEN
    RAISE EXCEPTION '27: la factura no quedó emitida (%)', fila.factura_estado; END IF;
  RAISE NOTICE 'OK 27  dos emisiones solapadas: emite una, la otra se encuentra la factura hecha';
END $$;

-- ── 28-30 · Las carreras pagar/anular, pagar/mora y el estado a mano ───────
DO $$
DECLARE
  M1    constant uuid := 'c0000000-0000-0000-0000-000000000001';
  LUCIA constant uuid := 'e0000000-0000-0000-0000-000000000001';
  HOY   date := (now() AT TIME ZONE 'America/Guatemala')::date;
  reg   public.registros;
  fac   public.registros;
  fila  public.registros;
  ok    boolean;
BEGIN
  PERFORM set_config('app.uid', LUCIA::text, false);

  -- 28 · PAGAR / ANULAR. Con el bloqueo, una de las dos llega primero. Si fue
  -- el pago, anular borraría el rastro de un dinero que entró: se rechaza.
  SELECT * INTO reg FROM public.registrar_lectura(
    M1, 470, HOY, 'idem-upd-carrera-0003', 'pagar vs anular', NULL, NULL);
  SELECT * INTO fac FROM public.agua_factura_emitir(reg.id);
  PERFORM public.agua_factura_registrar_pago(reg.id, round(fac.total_a_pagar / 2, 2));
  ok := false;
  BEGIN PERFORM public.agua_factura_anular(reg.id, 'me arrepentí');
  EXCEPTION WHEN data_exception THEN ok := true; END;
  IF NOT ok THEN
    RAISE EXCEPTION '28: se anuló una factura con abonos — el pago queda sin rastro'; END IF;
  -- Y sin abonos, anular sigue funcionando.
  SELECT * INTO reg FROM public.registrar_lectura(
    M1, 480, HOY, 'idem-upd-carrera-0004', 'anulable', NULL, NULL);
  SELECT * INTO fila FROM public.agua_factura_anular(reg.id, 'duplicada');
  IF fila.factura_estado <> 'anulada' THEN
    RAISE EXCEPTION '28: la anulación legítima dejó de funcionar'; END IF;
  RAISE NOTICE 'OK 28  pagar/anular: con abonos no se anula; sin abonos sí';

  -- 29 · PAGAR / MORA. Un abono parcial no saca de mora, y la mora no marca
  -- morosa una factura ya pagada.
  SELECT * INTO reg FROM public.registrar_lectura(
    M1, 490, HOY, 'idem-upd-carrera-0005', 'pagar vs mora', NULL, NULL);
  SELECT * INTO fac FROM public.agua_factura_emitir(reg.id);
  PERFORM public.agua_registro_marcar_mora(ARRAY[reg.id]);
  SELECT * INTO fila FROM public.agua_factura_registrar_pago(reg.id, round(fac.total_a_pagar / 2, 2));
  IF fila.estado <> 'mora' THEN
    RAISE EXCEPTION '29: un abono parcial sacó la factura de mora (estado %)', fila.estado; END IF;

  SELECT * INTO fila FROM public.agua_factura_registrar_pago(
    reg.id, fac.total_a_pagar - round(fac.total_a_pagar / 2, 2));
  IF fila.estado <> 'pagado' THEN
    RAISE EXCEPTION '29: el pago que liquida no salió de mora (estado %)', fila.estado; END IF;
  IF public.agua_registro_marcar_mora(ARRAY[reg.id]) <> 0 THEN
    RAISE EXCEPTION '29: se marcó como morosa una factura ya pagada'; END IF;
  RAISE NOTICE 'OK 29  pagar/mora: el abono parcial no saca de mora, y lo pagado no vuelve a mora';

  -- 30 · Y el estado a mano no le quita el cobrado a una factura pagada.
  ok := false;
  BEGIN PERFORM public.agua_registro_cambiar_estado(reg.id, 'pendiente');
  EXCEPTION WHEN data_exception THEN ok := true; END;
  IF NOT ok THEN
    RAISE EXCEPTION '30: se devolvió a pendiente una factura pagada'; END IF;
  RAISE NOTICE 'OK 30  el estado a mano no revierte un cobro: para eso hay que revertir el pago';
END $$;

-- ── 31-33 · La última excepción de service_role: la RPC del proveedor ──────
-- `confirm-charge` acreditaba el pago del payfac con un `UPDATE` genérico que
-- sumaba en JavaScript sobre un `monto_pagado` leído sin bloquear. Ahora pasa
-- por `agua_registro_acreditar_pago_externo`. Aquí se comprueban las tres
-- cosas que la hacen una excepción y no otra puerta: quién NO puede llamarla
-- (ni siquiera desde una DEFINER), y que quien sí puede suma bien.
DO $$
DECLARE
  M1    constant uuid := 'c0000000-0000-0000-0000-000000000001';
  LUCIA constant uuid := 'e0000000-0000-0000-0000-000000000001';
  HOY   date := (now() AT TIME ZONE 'America/Guatemala')::date;
  reg   public.registros;
  fac   public.registros;
  fila  public.registros;
  ab1   numeric;
  ab2   numeric;
  n     bigint;
  ok    boolean;
BEGIN
  PERFORM set_config('app.uid', LUCIA::text, false);
  SELECT * INTO reg FROM public.registrar_lectura(
    M1, 520, HOY, 'idem-upd-payfac-0001', 'pago del proveedor', NULL, NULL);
  SELECT * INTO fac FROM public.agua_factura_emitir(reg.id);

  -- 31 · `authenticated` no la tiene. El GRANT es sólo para `service_role`.
  ok := false;
  SET LOCAL ROLE authenticated;
  BEGIN
    PERFORM public.agua_registro_acreditar_pago_externo(reg.id, 1, 'a mano');
  EXCEPTION WHEN insufficient_privilege THEN ok := true; END;
  RESET ROLE;
  IF NOT ok THEN
    RAISE EXCEPTION '31: authenticated pudo acreditar un pago del proveedor'; END IF;
  RAISE NOTICE 'OK 31  la RPC del payfac está revocada de authenticated: 42501';

  -- 32 · Y tampoco por la puerta de atrás. Una SECURITY DEFINER corre como el
  -- DUEÑO, que tiene EXECUTE implícito sobre todo: el GRANT no la para. La
  -- para el chequeo de rol efectivo de dentro de la RPC.
  ok := false;
  SET LOCAL ROLE authenticated;
  BEGIN
    PERFORM public.test_definer_acredita_pago(reg.id);
  EXCEPTION WHEN insufficient_privilege THEN ok := true; END;
  RESET ROLE;
  IF NOT ok THEN
    RAISE EXCEPTION '32: una función DEFINER de authenticated acreditó un pago inventado'; END IF;
  SELECT r.monto_pagado INTO ab1 FROM public.registros r WHERE r.id = reg.id;
  IF COALESCE(ab1, 0) <> 0 THEN
    RAISE EXCEPTION '32: el intento dejó % abonados', ab1; END IF;
  RAISE NOTICE 'OK 32  ni desde una SECURITY DEFINER: el GRANT no basta y el chequeo de rol sí';

  -- 33 · Con el rol del proveedor, acredita: suma sobre lo abonado, liquida
  -- cuando llega al total y cierra la factura. Es el camino de `confirm-charge`.
  ab1 := round(fac.total_a_pagar / 3, 2);
  ab2 := fac.total_a_pagar - ab1;
  PERFORM set_config('request.jwt.claims', '{"role":"service_role"}', true);
  SET LOCAL ROLE service_role;

  SELECT * INTO fila FROM public.agua_registro_acreditar_pago_externo(reg.id, ab1, 'ref-1');
  IF fila.monto_pagado <> ab1 OR fila.estado <> 'pendiente' THEN
    RAISE EXCEPTION '33: el primer abono dejó % / %', fila.monto_pagado, fila.estado; END IF;

  SELECT * INTO fila FROM public.agua_registro_acreditar_pago_externo(reg.id, ab2, 'ref-2');
  IF fila.monto_pagado <> fac.total_a_pagar THEN
    RAISE EXCEPTION '33: los dos abonos suman % y el total es %',
      fila.monto_pagado, fac.total_a_pagar; END IF;
  IF fila.estado <> 'pagado' OR fila.factura_estado <> 'pagada' OR fila.fecha_pago IS NULL THEN
    RAISE EXCEPTION '33: liquidó sin cerrar: estado %, factura %, fecha %',
      fila.estado, fila.factura_estado, fila.fecha_pago; END IF;

  RESET ROLE;
  PERFORM set_config('request.jwt.claims', '', true);

  SELECT count(*) INTO n FROM public.security_logs s
   WHERE s.event_type = 'agua_cobro.acreditar_pago_externo'
     AND (s.details ->> 'registro_id')::uuid = reg.id;
  IF n <> 2 THEN
    RAISE EXCEPTION '33: la acreditación del proveedor dejó % rastros (esperado 2)', n; END IF;
  RAISE NOTICE 'OK 33  service_role acredita, suma sobre lo abonado, liquida y queda auditado';
END $$;

-- ════════════════════════════════════════════════════════════════════════════
-- 34-39 · La conciliación del payfac, en UNA transacción
-- ════════════════════════════════════════════════════════════════════════════
-- `confirm-charge` conciliaba en cuatro transacciones sueltas: un SELECT de
-- idempotencia por `referencia`, el INSERT del pago, la acreditación del ítem y
-- el cierre de la solicitud. Lo que sigue ejerce los tres fallos que eso dejaba
-- abiertos, con dos conexiones y con una rotura provocada de verdad.
--
-- La preparación va en su PROPIO bloque para que CONFIRME: la otra conexión no
-- puede ver filas que esta transacción todavía no escribió.
DO $$
DECLARE
  M1    constant uuid := 'c0000000-0000-0000-0000-000000000001';
  LUCIA constant uuid := 'e0000000-0000-0000-0000-000000000001';
  CLI   constant uuid := 'c1000000-0000-0000-0000-000000000001';
  ACME  constant uuid := 'aaaaaaaa-0000-0000-0000-00000000000a';
  HOY   date := (now() AT TIME ZONE 'America/Guatemala')::date;
  reg   public.registros;
  fac   public.registros;
  pr1   uuid;
  pr2   uuid;
  tercio numeric;
BEGIN
  PERFORM set_config('app.uid', LUCIA::text, false);

  -- Un recibo emitido, y DOS solicitudes de cobro de un tercio cada una: la
  -- primera para la carrera de la misma solicitud, la segunda para la carrera
  -- de dos solicitudes distintas sobre el mismo recibo.
  SELECT * INTO reg FROM public.registrar_lectura(
    M1, 600, HOY, 'idem-conc-0001', 'Para la conciliación', NULL, NULL);
  SELECT * INTO fac FROM public.agua_factura_emitir(reg.id);
  tercio := round(fac.total_a_pagar / 3, 2);

  INSERT INTO public.payment_requests (cliente_id, registro_id, company_id, monto, provider, estado, provider_ref)
  VALUES (CLI, reg.id, ACME, tercio, 'sandbox', 'pending', 'ref-conc-1') RETURNING id INTO pr1;
  INSERT INTO public.payment_requests (cliente_id, registro_id, company_id, monto, provider, estado, provider_ref)
  VALUES (CLI, reg.id, ACME, tercio, 'sandbox', 'pending', 'ref-conc-2') RETURNING id INTO pr2;

  PERFORM set_config('app.conc_registro', reg.id::text, false);
  PERFORM set_config('app.conc_total',    fac.total_a_pagar::text, false);
  PERFORM set_config('app.conc_tercio',   tercio::text, false);
  PERFORM set_config('app.conc_pr1',      pr1::text, false);
  PERFORM set_config('app.conc_pr2',      pr2::text, false);

  -- Y un tercer recibo con su solicitud, para la rotura provocada.
  SELECT * INTO reg FROM public.registrar_lectura(
    M1, 610, HOY, 'idem-conc-0002', 'Para la rotura provocada', NULL, NULL);
  SELECT * INTO fac FROM public.agua_factura_emitir(reg.id);
  INSERT INTO public.payment_requests (cliente_id, registro_id, company_id, monto, provider, estado, provider_ref)
  VALUES (CLI, reg.id, ACME, round(fac.total_a_pagar / 2, 2), 'sandbox', 'pending', 'ref-conc-3')
  RETURNING id INTO pr1;
  PERFORM set_config('app.conc_roto_reg', reg.id::text, false);
  PERFORM set_config('app.conc_roto_pr',  pr1::text, false);
END $$;

-- ── 34 · DOS CONFIRMACIONES CONCURRENTES DE LA MISMA SOLICITUD ─────────────
DO $$
DECLARE
  v_conn  text    := current_setting('app.conn');
  v_reg   uuid    := current_setting('app.conc_registro')::uuid;
  v_pr    uuid    := current_setting('app.conc_pr1')::uuid;
  tercio  numeric := current_setting('app.conc_tercio')::numeric;
  remoto  jsonb;
  fila    public.registros;
  n       bigint;
  pr_est  text;
BEGIN
  -- El solapamiento se reproduce igual que en la invariante 26: esta sesión
  -- concilia y NO confirma, la otra dispara su conciliación y se queda en el
  -- bloqueo de `payment_requests`, esta confirma y la otra despierta. Con el
  -- guard viejo —un SELECT de idempotencia en JavaScript— las dos habrían
  -- pasado el chequeo antes de que ninguna insertara: dos pagos y doble
  -- acreditación.
  PERFORM public.dblink_connect('conciliacion', v_conn);

  PERFORM public.test_conciliar_como_payfac(v_pr);   -- local, SIN confirmar

  PERFORM public.dblink_send_query('conciliacion',
    format('SELECT public.test_conciliar_como_payfac(%L)', v_pr));
  PERFORM pg_sleep(0.5);

  COMMIT;

  SELECT t.x INTO remoto FROM public.dblink_get_result('conciliacion') AS t(x jsonb);
  -- Drenar: una consulta asíncrona no termina hasta que `dblink_get_result`
  -- devuelve cero filas. Sin esto la conexión queda «ocupada» y la siguiente
  -- invariante no puede usarla.
  PERFORM public.dblink_get_result('conciliacion');
  PERFORM public.dblink_disconnect('conciliacion');

  IF (remoto ->> 'ya_conciliado') IS DISTINCT FROM 'true' THEN
    RAISE EXCEPTION '34: la segunda confirmación volvió a conciliar (%)', remoto; END IF;

  SELECT count(*) INTO n FROM public.pagos p WHERE p.payment_request_id = v_pr;
  IF n <> 1 THEN
    RAISE EXCEPTION '34: la solicitud dejó % pagos (esperado 1)', n; END IF;

  SELECT * INTO fila FROM public.registros WHERE id = v_reg;
  IF fila.monto_pagado <> tercio THEN
    RAISE EXCEPTION '34: se acreditó % (esperado %) — doble acreditación',
      fila.monto_pagado, tercio; END IF;

  SELECT pr.estado INTO pr_est FROM public.payment_requests pr WHERE pr.id = v_pr;
  IF pr_est <> 'succeeded' THEN
    RAISE EXCEPTION '34: la solicitud quedó en % y no en succeeded', pr_est; END IF;

  RAISE NOTICE 'OK 34  dos confirmaciones concurrentes de la misma solicitud: un pago, una acreditación';
END $$;

-- ── 35 · ROTURA ENTRE EL INSERT DEL PAGO Y LA ACREDITACIÓN ─────────────────
DO $$
DECLARE
  v_reg  uuid := current_setting('app.conc_roto_reg')::uuid;
  v_pr   uuid := current_setting('app.conc_roto_pr')::uuid;
  fila   public.registros;
  n      bigint;
  pr_est text;
  ok     boolean := false;
  res    jsonb;
BEGIN
  -- El trigger de prueba revienta el `UPDATE` del recibo, que es lo PRIMERO
  -- que ocurre después de insertar el pago. Si la conciliación no fuera
  -- atómica, el pago quedaría escrito y el recibo sin acreditar — y el
  -- reintento, encontrándose ese pago, saldría por «ya conciliado» y NUNCA
  -- acreditaría. Eso es exactamente lo que pasaba con los cuatro pasos sueltos.
  PERFORM set_config('test.romper_acreditacion', 'on', false);
  BEGIN
    PERFORM public.test_conciliar_como_payfac(v_pr);
  EXCEPTION WHEN OTHERS THEN
    ok := SQLERRM LIKE '%fallo provocado%';
  END;
  PERFORM set_config('test.romper_acreditacion', 'off', false);

  IF NOT ok THEN
    RAISE EXCEPTION '35: la rotura provocada no se disparó — la prueba no aplica'; END IF;

  SELECT count(*) INTO n FROM public.pagos p WHERE p.payment_request_id = v_pr;
  IF n <> 0 THEN
    RAISE EXCEPTION '35: quedaron % pagos huérfanos tras la rotura', n; END IF;

  SELECT pr.estado INTO pr_est FROM public.payment_requests pr WHERE pr.id = v_pr;
  IF pr_est <> 'pending' THEN
    RAISE EXCEPTION '35: la solicitud quedó en % tras revertir', pr_est; END IF;

  SELECT * INTO fila FROM public.registros WHERE id = v_reg;
  IF COALESCE(fila.monto_pagado, 0) <> 0 THEN
    RAISE EXCEPTION '35: el recibo quedó con % acreditado tras revertir', fila.monto_pagado; END IF;

  -- Y el reintento, ya sin la rotura, cuadra.
  res := public.test_conciliar_como_payfac(v_pr);
  IF (res ->> 'ya_conciliado') <> 'false' THEN
    RAISE EXCEPTION '35: el reintento se creyó que ya estaba conciliado (%)', res; END IF;

  SELECT count(*) INTO n FROM public.pagos p WHERE p.payment_request_id = v_pr;
  SELECT * INTO fila FROM public.registros WHERE id = v_reg;
  IF n <> 1 OR COALESCE(fila.monto_pagado, 0) <= 0 THEN
    RAISE EXCEPTION '35: el reintento dejó % pagos y % acreditado', n, fila.monto_pagado; END IF;

  RAISE NOTICE 'OK 35  un fallo entre el INSERT y la acreditación revierte TODO, y el reintento cuadra';
END $$;

-- ── 36 · DOS SOLICITUDES DISTINTAS DEL MISMO RECIBO, A LA VEZ ──────────────
DO $$
DECLARE
  v_conn text    := current_setting('app.conn');
  v_reg  uuid    := current_setting('app.conc_registro')::uuid;
  v_pr2  uuid    := current_setting('app.conc_pr2')::uuid;
  tercio numeric := current_setting('app.conc_tercio')::numeric;
  total  numeric := current_setting('app.conc_total')::numeric;
  remoto jsonb;
  fila   public.registros;
  n      bigint;
BEGIN
  -- El bloqueo de `payment_requests` NO cubre este caso: son filas distintas.
  -- Lo que lo cubre es el bloqueo del RECIBO, tomado siempre después y siempre
  -- en el mismo orden. Aquí la solicitud 2 entra mientras la 1 (invariante 34)
  -- ya está conciliada, y se comprueba que los DOS abonos suman.
  PERFORM public.dblink_connect('conciliacion', v_conn);
  PERFORM public.dblink_send_query('conciliacion',
    format('SELECT public.test_conciliar_como_payfac(%L)', v_pr2));
  PERFORM pg_sleep(0.3);
  SELECT t.x INTO remoto FROM public.dblink_get_result('conciliacion') AS t(x jsonb);
  PERFORM public.dblink_get_result('conciliacion');
  PERFORM public.dblink_disconnect('conciliacion');

  IF (remoto ->> 'ok') IS DISTINCT FROM 'true' THEN
    RAISE EXCEPTION '36: la segunda solicitud no concilió (%)', remoto; END IF;

  SELECT count(*) INTO n FROM public.pagos p
   WHERE p.registro_id = v_reg AND p.deleted_at IS NULL;
  IF n <> 2 THEN
    RAISE EXCEPTION '36: el recibo quedó con % pagos (esperado 2)', n; END IF;

  SELECT * INTO fila FROM public.registros WHERE id = v_reg;
  IF fila.monto_pagado <> round(tercio * 2, 2) THEN
    RAISE EXCEPTION '36: los dos abonos suman % (esperado %)',
      fila.monto_pagado, round(tercio * 2, 2); END IF;
  IF fila.monto_pagado > total + 0.005 THEN
    RAISE EXCEPTION '36: los dos abonos juntos se pasaron del saldo'; END IF;

  RAISE NOTICE 'OK 36  dos solicitudes distintas del mismo recibo suman los dos abonos';
END $$;

-- ── 37-39 · No-op, y quién NO puede llamarla ───────────────────────────────
DO $$
DECLARE
  v_reg  uuid := current_setting('app.conc_registro')::uuid;
  v_pr   uuid := current_setting('app.conc_pr1')::uuid;
  antes  numeric;
  fila   public.registros;
  n      bigint;
  res    jsonb;
  ok     boolean;
BEGIN
  SELECT r.monto_pagado INTO antes FROM public.registros r WHERE r.id = v_reg;

  -- 37 · Repetir una ya conciliada: devuelve lo que hay y no acredita de nuevo.
  res := public.test_conciliar_como_payfac(v_pr);
  IF (res ->> 'ya_conciliado') <> 'true' OR (res ->> 'pago_id') IS NULL THEN
    RAISE EXCEPTION '37: repetir una conciliada no devolvió el resultado existente (%)', res; END IF;

  SELECT count(*) INTO n FROM public.pagos p WHERE p.payment_request_id = v_pr;
  SELECT * INTO fila FROM public.registros WHERE id = v_reg;
  IF n <> 1 OR fila.monto_pagado <> antes THEN
    RAISE EXCEPTION '37: el no-op escribió: % pagos, abonado % (antes %)',
      n, fila.monto_pagado, antes; END IF;
  RAISE NOTICE 'OK 37  repetir una solicitud ya conciliada es un no-op que devuelve lo que hay';

  -- El claim que puso `test_conciliar_como_payfac` es transaccional, y este
  -- bloque es UNA transacción: hay que quitarlo antes de comprobar quién NO
  -- puede llamarla, o la 39 pasaría por arrastre y no probaría nada.
  PERFORM set_config('request.jwt.claims', '', true);

  -- 38 · `authenticated` no la tiene.
  ok := false;
  SET LOCAL ROLE authenticated;
  BEGIN
    PERFORM public.conciliar_pago_externo(v_pr);
  EXCEPTION WHEN insufficient_privilege THEN ok := true; END;
  RESET ROLE;
  IF NOT ok THEN
    RAISE EXCEPTION '38: authenticated pudo conciliar un cobro'; END IF;
  RAISE NOTICE 'OK 38  conciliar_pago_externo está revocada de authenticated: 42501';

  -- 39 · Ni por la puerta de atrás de una SECURITY DEFINER suya.
  ok := false;
  SET LOCAL ROLE authenticated;
  BEGIN
    PERFORM public.test_definer_concilia(v_pr);
  EXCEPTION WHEN insufficient_privilege THEN ok := true; END;
  RESET ROLE;
  IF NOT ok THEN
    RAISE EXCEPTION '39: una DEFINER de authenticated alcanzó la conciliación'; END IF;
  RAISE NOTICE 'OK 39  ni desde una SECURITY DEFINER: el chequeo de rol efectivo la para';
END $$;
