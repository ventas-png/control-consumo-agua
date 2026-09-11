\set ON_ERROR_STOP on
\pset tuples_only on
\pset format unaligned

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
        'public.agua_factura_emitir(uuid, integer)', 'EXECUTE') THEN
    RAISE EXCEPTION '15: authenticated no puede emitir'; END IF;

  -- Y la auditoría suelta, sin la llave de capacidad, no escribe nada.
  ok := false;
  BEGIN PERFORM public.agua_cobro_auditar(reg.id, 'inventado', '{}'::jsonb);
  EXCEPTION WHEN insufficient_privilege THEN ok := true; END;
  IF NOT ok THEN RAISE EXCEPTION '15: se pudo fabricar una fila de auditoría desde fuera de una RPC'; END IF;
  RAISE NOTICE 'OK 15  anon no ejecuta nada; el guard y el trigger no son API; la auditoría no se fabrica desde fuera';
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
