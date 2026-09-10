\set ON_ERROR_STOP on
\pset tuples_only on
\pset format unaligned

-- Los dos parámetros que entrega run.sh: la cadena de conexión para la segunda
-- sesión (concurrencia real, invariante 31) y el fichero de casos de paridad
-- (invariante 32), que es EL MISMO que consume el test de vitest.
SELECT set_config('app.conn',  :'conn',  false);
SELECT set_config('app.casos', :'casos', false);

-- ════════════════════════════════════════════════════════════════════════════
-- Invariantes de la lectura autoritativa (20260910000001 / 20260910000101).
--
--    1-3   el servidor calcula: nada de lo que decide el importe es parámetro
--    4-6   varias lecturas el mismo día: se encadenan, con orden total
--    7-9   el reintento del outbox: idempotente, y el duplicado real no
--   10-13  el reset de medidor: consumo real, motivo obligatorio, límites
--   14-15  la lectura retroactiva y la del futuro
--   16-17  la lectura borrada no encadena
--   18-21  cruce de tenant / proyecto / contador ajeno o inactivo
--   22-24  la tarifa sale de la base y tiene que estar vigente
--   25-27  el payload que intenta falsificar el importe por el INSERT directo
--   28     quien captura sin poder leer la tabla: la base sigue siendo la buena
--   29-30  evidencia: la foto ajena y el GPS basura
--   31     concurrencia real: dos capturas del mismo contador se serializan
--   32     paridad TypeScript ↔ SQL sobre el mismo fichero de casos
--   33-35  el reporte de inconsistencias: ve lo que hay y no toca nada
--   36-38  la ACL de las RPC y el trigger
-- ════════════════════════════════════════════════════════════════════════════

DO $$
DECLARE
  M1     constant uuid := 'c0000000-0000-0000-0000-000000000001';
  M2     constant uuid := 'c0000000-0000-0000-0000-000000000002';
  M3     constant uuid := 'c0000000-0000-0000-0000-000000000003';
  M4     constant uuid := 'c0000000-0000-0000-0000-000000000004';
  M5     constant uuid := 'c0000000-0000-0000-0000-000000000005';
  M9     constant uuid := 'c0000000-0000-0000-0000-000000000009';
  M0     constant uuid := 'c0000000-0000-0000-0000-000000000000';
  P1     constant uuid := '11111111-0000-0000-0000-000000000001';
  CLI1   constant uuid := 'c1000000-0000-0000-0000-000000000001';
  LUCIA  constant uuid := 'e0000000-0000-0000-0000-000000000001';
  BETO   constant uuid := 'e0000000-0000-0000-0000-000000000002';
  NADIA  constant uuid := 'e0000000-0000-0000-0000-000000000003';
  CURRO  constant uuid := 'e0000000-0000-0000-0000-000000000004';
  HOY    date := (now() AT TIME ZONE 'America/Guatemala')::date;
  reg    public.registros;
  reg2   public.registros;
  otra   public.registros;
  n      bigint;
  v_txt  text;
BEGIN
  PERFORM set_config('app.uid', LUCIA::text, false);

  -- ── 1 · El servidor calcula TODO lo que decide el importe ────────────────
  -- M-1 arranca en lectura_inicial 100, tarifa plana 3.75 / exceso 6.50 /
  -- canon 20 / mínimo 5, derecho de servicio 20 m³. Lectura 130 → consumo 30,
  -- que pasa del derecho: 20×3.75 + 10×6.50 = 140.00.
  SELECT * INTO reg FROM public.registrar_lectura(
    M1, 130, HOY, 'idem-0001-primera', 'Lectura de rutina', NULL, NULL);

  IF reg.lectura_anterior <> 100 THEN
    RAISE EXCEPTION '1: lectura_anterior salió % (esperada 100, la lectura_inicial del contador)', reg.lectura_anterior; END IF;
  IF reg.consumo <> 30 THEN
    RAISE EXCEPTION '1: consumo salió % (esperado 30)', reg.consumo; END IF;
  IF reg.monto_calculado <> 140.00 THEN
    RAISE EXCEPTION '1: monto salió % (esperado 140.00)', reg.monto_calculado; END IF;
  IF reg.tipo_cobro <> 'Consumo con Exceso' THEN
    RAISE EXCEPTION '1: tipo_cobro salió %', reg.tipo_cobro; END IF;
  IF reg.tarifa_aplicada <> 3.75 OR reg.tarifa_exceso_aplicada <> 6.50 OR reg.canon_aplicado <> 20 THEN
    RAISE EXCEPTION '1: el snapshot de tarifa no salió de la base (% / % / %)',
      reg.tarifa_aplicada, reg.tarifa_exceso_aplicada, reg.canon_aplicado; END IF;
  RAISE NOTICE 'OK 1  consumo, tarifa, canon, exceso e importe los resolvió la base';

  -- ── 2 · Proyecto, cliente y estado inicial tampoco son del cliente ───────
  IF reg.project_id <> P1 THEN
    RAISE EXCEPTION '2: project_id salió % (esperado el del contador)', reg.project_id; END IF;
  IF reg.cliente_id <> CLI1 THEN
    RAISE EXCEPTION '2: cliente_id salió % (esperado el de la unidad del contador)', reg.cliente_id; END IF;
  IF reg.cliente_nombre <> 'Familia Pérez' THEN
    RAISE EXCEPTION '2: cliente_nombre salió %', reg.cliente_nombre; END IF;
  IF reg.estado <> 'pendiente' THEN
    RAISE EXCEPTION '2: la lectura no nació pendiente, nació %', reg.estado; END IF;
  IF reg.origen <> 'rpc' THEN
    RAISE EXCEPTION '2: origen salió %', reg.origen; END IF;
  IF reg.creado_por <> LUCIA THEN
    RAISE EXCEPTION '2: creado_por salió %', reg.creado_por; END IF;
  RAISE NOTICE 'OK 2  proyecto, cliente y estado inicial los pone el servidor';

  -- ── 3 · Días de servicio y fecha ancladas por la base ────────────────────
  IF reg.fecha_lectura_anterior IS DISTINCT FROM '2026-01-15'::date::timestamptz THEN
    RAISE EXCEPTION '3: fecha_lectura_anterior salió % (esperada la instalación)', reg.fecha_lectura_anterior; END IF;
  IF reg.dias_servicio IS NULL OR reg.dias_servicio < 0 THEN
    RAISE EXCEPTION '3: dias_servicio salió %', reg.dias_servicio; END IF;
  IF (reg.fecha AT TIME ZONE 'America/Guatemala')::date <> HOY THEN
    RAISE EXCEPTION '3: la fecha guardada cayó en otro día (%)', reg.fecha; END IF;
  RAISE NOTICE 'OK 3  la fecha se ancló al mediodía de la zona del tenant';

  -- ── 4 · Dos lecturas del MISMO día se encadenan ──────────────────────────
  SELECT * INTO reg2 FROM public.registrar_lectura(
    M1, 145, HOY, 'idem-0002-relectura', 'Re-lectura: la primera se leyó mal', NULL, NULL);
  IF reg2.lectura_anterior <> 130 THEN
    RAISE EXCEPTION '4: la segunda del día tomó como anterior % en vez de 130', reg2.lectura_anterior; END IF;
  IF reg2.consumo <> 15 THEN
    RAISE EXCEPTION '4: consumo de la segunda salió % (esperado 15)', reg2.consumo; END IF;
  RAISE NOTICE 'OK 4  la segunda lectura del día encadena contra la primera';

  -- ── 5 · Y la TERCERA contra la segunda (el orden total es monótono) ──────
  SELECT * INTO reg FROM public.registrar_lectura(
    M1, 150, HOY, 'idem-0003-tercera', 'Tercera del día', NULL, NULL);
  IF reg.lectura_anterior <> 145 THEN
    RAISE EXCEPTION '5: la tercera del día tomó como anterior % en vez de 145', reg.lectura_anterior; END IF;
  RAISE NOTICE 'OK 5  la tercera encadena contra la segunda, no contra la primera';

  -- ── 6 · El desempate no depende del azar: mismas fechas, orden estable ───
  SELECT count(*) INTO n FROM public.registros r
   WHERE r.contador_id = M1 AND r.deleted_at IS NULL
     AND (r.fecha AT TIME ZONE 'America/Guatemala')::date = HOY;
  IF n <> 3 THEN RAISE EXCEPTION '6: quedaron % lecturas del día (esperadas 3)', n; END IF;
  SELECT r.lectura_actual::text INTO v_txt FROM public.registros r
   WHERE r.contador_id = M1 AND r.deleted_at IS NULL
   ORDER BY COALESCE(r.secuencia, 0) DESC, r.fecha DESC,
            r.created_at DESC NULLS LAST, r.id DESC LIMIT 1;
  IF v_txt <> '150' THEN RAISE EXCEPTION '6: la vigente del contador es % y debería ser 150', v_txt; END IF;
  RAISE NOTICE 'OK 6  el orden total por secuencia resuelve el empate del mismo día';

  -- ── 7 · Replay offline: la MISMA llave devuelve la MISMA fila ────────────
  SELECT * INTO reg2 FROM public.registrar_lectura(
    M1, 150, HOY, 'idem-0003-tercera', 'Tercera del día', NULL, NULL);
  IF reg2.id <> reg.id THEN
    RAISE EXCEPTION '7: el reintento creó una fila nueva (% vs %)', reg2.id, reg.id; END IF;
  SELECT count(*) INTO n FROM public.registros r WHERE r.idempotency_key = 'idem-0003-tercera';
  IF n <> 1 THEN RAISE EXCEPTION '7: el reintento dejó % filas', n; END IF;
  RAISE NOTICE 'OK 7  el reenvío del outbox devuelve la lectura ya creada, sin duplicar';

  -- ── 8 · El replay funciona aunque el payload venga distinto ──────────────
  -- La llave identifica la OPERACIÓN. Si el mismo acto se reenvía con otro
  -- número (cliente viejo, payload editado), no se cuela una lectura nueva.
  SELECT * INTO reg2 FROM public.registrar_lectura(
    M1, 999, HOY, 'idem-0003-tercera', 'otra cosa', NULL, NULL);
  IF reg2.id <> reg.id OR reg2.lectura_actual <> 150 THEN
    RAISE EXCEPTION '8: la llave de idempotencia no ganó sobre el payload reenviado'; END IF;
  RAISE NOTICE 'OK 8  la llave manda sobre el payload: un reintento nunca captura otra cosa';

  -- ── 9 · Un duplicado REAL (otra operación, misma llave natural) se rechaza ─
  BEGIN
    PERFORM public.registrar_lectura(M1, 150, HOY, 'idem-0004-otra-operacion', 'duplicada', NULL, NULL);
    RAISE EXCEPTION '9: entró una lectura duplicada por llave natural';
  EXCEPTION WHEN unique_violation THEN NULL;
  END;
  RAISE NOTICE 'OK 9  misma (contador, lectura, fecha) con otra operación → 23505';

  -- ── 10 · Reset: el consumo es el REAL, no cero ───────────────────────────
  -- El medidor se cambia: el retirado quedó en 168 (venía de 150) y el nuevo
  -- arranca marcando 4. Consumo = (168 − 150) + 4 = 22.
  SELECT * INTO reg2 FROM public.registrar_lectura(
    M1, 4, HOY, 'idem-0005-reset',
    'Cambio físico de medidor por rotura de carátula, acta 118', NULL, NULL,
    true, 168);
  IF reg2.consumo <> 22 THEN
    RAISE EXCEPTION '10: el reset dio consumo % (esperado 22 = (168−150)+4)', reg2.consumo; END IF;
  IF reg2.es_reset IS NOT TRUE OR reg2.lectura_final_retirada <> 168 THEN
    RAISE EXCEPTION '10: el reset no quedó marcado ni auditable'; END IF;
  IF reg2.lectura_anterior <> 150 THEN
    RAISE EXCEPTION '10: lectura_anterior del reset salió %', reg2.lectura_anterior; END IF;
  RAISE NOTICE 'OK 10  el reset cobra el agua del medidor retirado, no la regala';

  -- ── 11 · Un reset sin la lectura final del retirado no se acepta ─────────
  BEGIN
    PERFORM public.registrar_lectura(M1, 9, HOY, 'idem-0006', 'Cambio de medidor sin dato', NULL, NULL, true, NULL);
    RAISE EXCEPTION '11: se aceptó un reset sin la lectura final del medidor retirado';
  EXCEPTION WHEN SQLSTATE '22023' THEN NULL;
  END;
  RAISE NOTICE 'OK 11  reset sin lectura final del retirado → 22023';

  -- ── 12 · Y sin motivo escrito, tampoco ───────────────────────────────────
  BEGIN
    PERFORM public.registrar_lectura(M1, 9, HOY, 'idem-0007', 'roto', NULL, NULL, true, 200);
    RAISE EXCEPTION '12: se aceptó un reset sin motivo';
  EXCEPTION WHEN SQLSTATE '22023' THEN NULL;
  END;
  RAISE NOTICE 'OK 12  el motivo del reset es obligatorio, no recomendable';

  -- ── 13 · Un reset "hacia atrás" en el medidor retirado se rechaza ────────
  BEGIN
    PERFORM public.registrar_lectura(M1, 9, HOY, 'idem-0008',
      'Cambio de medidor con lectura final imposible', NULL, NULL, true, 1);
    RAISE EXCEPTION '13: se aceptó una lectura final del retirado menor que su anterior';
  EXCEPTION WHEN SQLSTATE '22023' THEN NULL;
  END;
  RAISE NOTICE 'OK 13  la lectura final del retirado no puede ir por debajo de su anterior';

  -- ── 14 · Retroactiva: rechazada ──────────────────────────────────────────
  BEGIN
    PERFORM public.registrar_lectura(M1, 500, HOY - 5, 'idem-0009', 'del mes pasado', NULL, NULL);
    RAISE EXCEPTION '14: entró una lectura con fecha anterior a la vigente';
  EXCEPTION WHEN SQLSTATE '22023' THEN NULL;
  END;
  RAISE NOTICE 'OK 14  lectura retroactiva → 22023 (el histórico se corrige aparte)';

  -- ── 15 · Del futuro: rechazada ───────────────────────────────────────────
  BEGIN
    PERFORM public.registrar_lectura(M1, 500, HOY + 30, 'idem-0010', 'del mes que viene', NULL, NULL);
    RAISE EXCEPTION '15: entró una lectura con fecha futura';
  EXCEPTION WHEN SQLSTATE '22023' THEN NULL;
  END;
  RAISE NOTICE 'OK 15  lectura del futuro → 22023';

  -- ── 16 · Una lectura BORRADA no encadena ─────────────────────────────────
  -- Se borra (soft) la del reset: la vigente vuelve a ser 150.
  UPDATE public.registros SET deleted_at = now() WHERE id = reg2.id;
  SELECT * INTO otra FROM public.registrar_lectura(
    M1, 160, HOY, 'idem-0011-tras-borrado', 'Tras anular el reset', NULL, NULL);
  IF otra.lectura_anterior <> 150 THEN
    RAISE EXCEPTION '16: encadenó contra una lectura soft-deleted (anterior = %)', otra.lectura_anterior; END IF;
  RAISE NOTICE 'OK 16  la lectura soft-deleted desaparece también de la cadena';

  -- ── 17 · Pero su llave de idempotencia sigue quemada ─────────────────────
  -- Reintentar la operación borrada NO la resucita: es el mismo acto y ya tuvo
  -- desenlace. (uq_registros_idempotencia NO es parcial por deleted_at.)
  SELECT * INTO reg FROM public.registrar_lectura(
    M1, 4, HOY, 'idem-0005-reset',
    'Cambio físico de medidor por rotura de carátula, acta 118', NULL, NULL, true, 168);
  IF reg.id <> reg2.id OR reg.deleted_at IS NULL THEN
    RAISE EXCEPTION '17: el reintento de una operación borrada creó una fila nueva'; END IF;
  RAISE NOTICE 'OK 17  reintentar una operación ya borrada no la resucita ni la duplica';

  -- ── 18 · Empresa vecina sobre nuestro contador ───────────────────────────
  PERFORM set_config('app.uid', NADIA::text, false);
  BEGIN
    PERFORM public.registrar_lectura(M1, 900, HOY, 'idem-0012', 'ajena', NULL, NULL);
    RAISE EXCEPTION '18: una cuenta de otra empresa registró sobre nuestro contador';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  RAISE NOTICE 'OK 18  cruce de tenant → 42501';

  -- ── 19 · Y nosotros sobre el suyo ────────────────────────────────────────
  PERFORM set_config('app.uid', LUCIA::text, false);
  BEGIN
    PERFORM public.registrar_lectura(M9, 5, HOY, 'idem-0013', 'ajena', NULL, NULL);
    RAISE EXCEPTION '19: se registró una lectura en un contador de otra empresa';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  RAISE NOTICE 'OK 19  el contador de la empresa vecina no existe para nosotros';

  -- ── 20 · Proyecto de la MISMA empresa al que no se está asignado ─────────
  BEGIN
    PERFORM public.registrar_lectura(M5, 5, HOY, 'idem-0014', 'otro condominio', NULL, NULL);
    RAISE EXCEPTION '20: se registró en un proyecto no asignado';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  PERFORM set_config('app.uid', CURRO::text, false);
  BEGIN
    PERFORM public.registrar_lectura(M1, 900, HOY, 'idem-0015', 'sin acceso', NULL, NULL);
    RAISE EXCEPTION '20: una cuenta sin asignación ni permisos registró una lectura';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  RAISE NOTICE 'OK 20  el alcance por proyecto se respeta dentro de la misma empresa';

  -- ── 21 · Contador inactivo ───────────────────────────────────────────────
  PERFORM set_config('app.uid', LUCIA::text, false);
  BEGIN
    PERFORM public.registrar_lectura(M0, 5, HOY, 'idem-0016', 'de baja', NULL, NULL);
    RAISE EXCEPTION '21: se registró una lectura en un contador inactivo';
  EXCEPTION WHEN SQLSTATE '22023' THEN NULL;
  END;
  RAISE NOTICE 'OK 21  el contador dado de baja no acepta lecturas';

  -- ── 22 · Sin tarifa asignada ─────────────────────────────────────────────
  BEGIN
    PERFORM public.registrar_lectura(M4, 5, HOY, 'idem-0017', 'sin tarifa', NULL, NULL);
    RAISE EXCEPTION '22: se registró una lectura sin tarifa';
  EXCEPTION WHEN SQLSTATE '22023' THEN NULL;
  END;
  RAISE NOTICE 'OK 22  contador sin tarifa → 22023, no un recibo en cero';

  -- ── 23 · Tarifa dada de baja ─────────────────────────────────────────────
  BEGIN
    PERFORM public.registrar_lectura(M3, 5, HOY, 'idem-0018', 'tarifa vencida', NULL, NULL);
    RAISE EXCEPTION '23: se registró una lectura con tarifa no vigente';
  EXCEPTION WHEN SQLSTATE '22023' THEN NULL;
  END;
  RAISE NOTICE 'OK 23  la tarifa tiene que estar VIGENTE en la base';

  -- ── 24 · La tarifa escalonada se aplica por bloques ──────────────────────
  SELECT * INTO reg FROM public.registrar_lectura(M2, 45, HOY, 'idem-0019-escalonada', NULL, NULL, NULL);
  IF reg.monto_calculado <> 245.00 OR reg.tipo_cobro <> 'Consumo Escalonado' THEN
    RAISE EXCEPTION '24: la escalonada dio % / %', reg.monto_calculado, reg.tipo_cobro; END IF;
  RAISE NOTICE 'OK 24  la tarifa escalonada se resuelve por bloques en la base';

  -- ── 25 · El payload que falsifica el importe: por la RPC no se puede ─────
  -- No hay parámetro donde escribirlo. Se comprueba en el catálogo: si alguien
  -- añade un p_consumo/p_monto/p_tarifa/p_estado, esta invariante lo caza.
  SELECT pg_get_function_arguments(to_regproc('public.registrar_lectura')::oid) INTO v_txt;
  IF v_txt IS NULL THEN RAISE EXCEPTION '25: registrar_lectura no existe'; END IF;
  IF v_txt ~* '(p_consumo|p_monto|p_tarifa|p_canon|p_estado|p_project_id|p_cliente_id|p_lectura_anterior)' THEN
    RAISE EXCEPTION '25: registrar_lectura acepta un parámetro que decide el cobro: %', v_txt; END IF;
  RAISE NOTICE 'OK 25  la RPC no tiene dónde recibir consumo, tarifa, importe ni estado';

  -- ── 26 · El INSERT directo con valores falsificados se RECALCULA ─────────
  -- La vigente de M-1 es 160 (invariante 16). El cliente manda consumo 0,
  -- importe 0, tarifa 0, estado 'pagado' y el proyecto de otro condominio.
  INSERT INTO public.registros (
    contador_id, project_id, cliente_id, cliente_nombre, fecha,
    lectura_anterior, lectura_actual, consumo,
    tarifa_aplicada, tarifa_exceso_aplicada, canon_aplicado,
    monto_calculado, tipo_cobro, estado, monto_pagado, fecha_pago, notas
  ) VALUES (
    M1, '11111111-0000-0000-0000-000000000002', NULL, 'Yo Mismo', now(),
    0, 200, 0, 0, 0, 0, 0, 'Regalado', 'pagado', 9999, now(), 'INSERT directo'
  ) RETURNING * INTO reg;

  IF reg.consumo <> 40 THEN
    RAISE EXCEPTION '26: el INSERT directo guardó consumo % (esperado 40 = 200−160)', reg.consumo; END IF;
  IF reg.lectura_anterior <> 160 THEN
    RAISE EXCEPTION '26: el INSERT directo guardó lectura_anterior %', reg.lectura_anterior; END IF;
  IF reg.monto_calculado <> 205.00 THEN
    RAISE EXCEPTION '26: el INSERT directo guardó importe % (esperado 205.00)', reg.monto_calculado; END IF;
  IF reg.tarifa_aplicada <> 3.75 OR reg.canon_aplicado <> 20 THEN
    RAISE EXCEPTION '26: el INSERT directo conservó la tarifa que mandó el cliente'; END IF;
  RAISE NOTICE 'OK 26  el INSERT directo pasa por el MISMO motor: sus números se recalculan';

  -- ── 27 · Y el estado, el proyecto y el cobro también se corrigen ─────────
  IF reg.estado <> 'pendiente' OR reg.monto_pagado IS NOT NULL OR reg.fecha_pago IS NOT NULL THEN
    RAISE EXCEPTION '27: el INSERT directo se fabricó un recibo pagado (% / % / %)',
      reg.estado, reg.monto_pagado, reg.fecha_pago; END IF;
  IF reg.project_id <> P1 OR reg.cliente_id <> CLI1 THEN
    RAISE EXCEPTION '27: el INSERT directo contabilizó la lectura en otro proyecto/cliente'; END IF;
  IF reg.origen <> 'directo' THEN
    RAISE EXCEPTION '27: la fila del INSERT directo no quedó marcada como tal'; END IF;
  RAISE NOTICE 'OK 27  estado, proyecto y cliente del INSERT directo los reescribe el servidor';

  -- ── 28 · Quien captura pero NO puede leer la tabla ───────────────────────
  -- Beto tiene agua.lecturas.create y NO agua.lecturas.view. Si la lectura
  -- vigente se resolviera con sus privilegios, vería cero filas, el servidor
  -- concluiría "primera lectura" y facturaría contra lectura_inicial (100).
  PERFORM set_config('app.uid', BETO::text, false);
  SELECT * INTO reg FROM public.registrar_lectura(M1, 210, HOY, 'idem-0020-beto', 'Captura de Beto', NULL, NULL);
  IF reg.lectura_anterior <> 200 THEN
    RAISE EXCEPTION '28: para quien no puede leer la tabla, la anterior salió % (esperada 200)', reg.lectura_anterior; END IF;
  RAISE NOTICE 'OK 28  captura sin permiso de lectura: la base sigue siendo la verdadera';

  -- ── 29 · La foto tiene que colgar de la carpeta del cliente resuelto ─────
  PERFORM set_config('app.uid', LUCIA::text, false);
  BEGIN
    PERFORM public.registrar_lectura(M1, 220, HOY, 'idem-0021', NULL,
      'c1000000-0000-0000-0000-000000000002/robada.jpg', NULL);
    RAISE EXCEPTION '29: se aceptó una foto colgada del expediente de otro cliente';
  EXCEPTION WHEN SQLSTATE '22023' THEN NULL;
  END;
  RAISE NOTICE 'OK 29  la evidencia va bajo la carpeta del cliente que resolvió el servidor';

  -- ── 30 · Un GPS imposible no tira la lectura, sólo se descarta ───────────
  SELECT * INTO reg FROM public.registrar_lectura(
    M1, 230, HOY, 'idem-0022-gps', NULL, NULL, '{"lat":"norte","lng":999}'::jsonb);
  IF reg.gps IS NOT NULL THEN
    RAISE EXCEPTION '30: se guardó un GPS imposible: %', reg.gps; END IF;
  SELECT * INTO reg FROM public.registrar_lectura(
    M1, 240, HOY, 'idem-0023-gps-ok', NULL, NULL,
    '{"lat":14.60271,"lng":-90.51328,"exactitud_m":12,"spoof":true}'::jsonb);
  IF reg.gps <> '{"lat":14.60271,"lng":-90.51328}'::jsonb THEN
    RAISE EXCEPTION '30: el GPS no se normalizó: %', reg.gps; END IF;
  RAISE NOTICE 'OK 30  el GPS se normaliza a {lat,lng} o no se guarda; la lectura no se pierde';
END $$;

-- ── 31 · Concurrencia REAL: dos capturas del mismo contador se serializan ──
-- El bloqueo cuelga del CONTADOR, no de una fila, y eso es lo que hay que
-- probar: se ejerce sobre M-2 —que no tiene ninguna lectura— porque es
-- justamente el caso donde un `SELECT … FOR UPDATE` no tendría nada que
-- bloquear y dos "primeras lecturas" simultáneas encadenarían las dos contra
-- `lectura_inicial`. La segunda conexión es de verdad (dblink), no simulada.
BEGIN;
SELECT set_config('app.uid', 'e0000000-0000-0000-0000-000000000001', false);
SELECT pg_advisory_xact_lock(hashtext('agua.registrar_lectura'),
                             hashtext('c0000000-0000-0000-0000-000000000002'));
DO $$
DECLARE v_err text;
BEGIN
  PERFORM public.dblink_connect('conc', current_setting('app.conn'));
  PERFORM public.dblink_exec('conc', 'SET lock_timeout = ''2s''');
  -- `dblink_exec` no admite sentencias que devuelvan filas; para esas va
  -- `dblink(...) AS t(...)`, que es lo que hace falta aquí dos veces.
  PERFORM t.x FROM public.dblink('conc',
    'SELECT set_config(''app.uid'', ''e0000000-0000-0000-0000-000000000001'', false)') AS t(x text);
  BEGIN
    PERFORM t.x FROM public.dblink('conc',
      'SELECT public.registrar_lectura(''c0000000-0000-0000-0000-000000000002''::uuid, ' ||
      '77, current_date, ''idem-conc-0001'', NULL, NULL, NULL)::text') AS t(x text);
    RAISE EXCEPTION '31: la segunda captura NO esperó al bloqueo del contador';
  EXCEPTION WHEN OTHERS THEN
    v_err := SQLERRM;
    IF v_err !~* '(lock|bloqueo|timeout|cancel)' THEN
      RAISE EXCEPTION '31: la segunda captura falló por otra cosa: %', v_err; END IF;
  END;
  PERFORM public.dblink_disconnect('conc');
  RAISE NOTICE 'OK 31  el bloqueo por contador serializa las capturas simultáneas (también la primera)';
END $$;
ROLLBACK;

-- Y en cuanto se suelta, la MISMA captura entra sin más: el bloqueo hace cola,
-- no rechaza.
DO $$
DECLARE reg public.registros;
BEGIN
  PERFORM set_config('app.uid', 'e0000000-0000-0000-0000-000000000001', false);
  SELECT * INTO reg FROM public.registrar_lectura(
    'c0000000-0000-0000-0000-000000000002'::uuid, 77,
    (now() AT TIME ZONE 'America/Guatemala')::date, 'idem-conc-0001', NULL, NULL, NULL);
  IF reg.id IS NULL THEN RAISE EXCEPTION '31: la captura no entró tras soltarse el bloqueo'; END IF;
END $$;

-- ── 32 · Paridad TypeScript ↔ SQL sobre el MISMO fichero de casos ──────────
-- Los `esperado` del JSON están escritos a mano: si las dos implementaciones se
-- equivocaran de la misma manera, esto lo vería igual. El otro lado del mismo
-- fichero lo comprueba src/lib/__tests__/paridad-costo-tarifa.test.ts.
DO $$
DECLARE
  caso  jsonb;
  n     int := 0;
  got   record;
BEGIN
  FOR caso IN SELECT value FROM jsonb_array_elements(current_setting('app.casos')::jsonb -> 'casos')
  LOOP
    SELECT * INTO got FROM public.agua_costo_tarifa(
      (caso ->> 'consumo')::numeric,
      (caso ->> 'precio_m3')::numeric,
      (caso ->> 'precio_m3_exceso')::numeric,
      (caso ->> 'canon_fijo')::numeric,
      (caso ->> 'consumo_minimo')::numeric,
      CASE WHEN jsonb_typeof(caso -> 'tramos') = 'array' THEN caso -> 'tramos' ELSE NULL END,
      NULLIF(caso ->> 'derecho_m3', '')::numeric
    );
    IF got.total <> (caso -> 'esperado' ->> 'total')::numeric THEN
      RAISE EXCEPTION '32: «%» dio % y se esperaba %',
        caso ->> 'nombre', got.total, caso -> 'esperado' ->> 'total'; END IF;
    IF got.tipo_cobro <> (caso -> 'esperado' ->> 'tipo_cobro') THEN
      RAISE EXCEPTION '32: «%» dio tipo_cobro % y se esperaba %',
        caso ->> 'nombre', got.tipo_cobro, caso -> 'esperado' ->> 'tipo_cobro'; END IF;
    n := n + 1;
  END LOOP;
  IF n < 17 THEN RAISE EXCEPTION '32: sólo se ejercieron % casos de paridad', n; END IF;
  RAISE NOTICE 'OK 32  % casos de importe dan lo mismo en SQL que en TypeScript', n;
END $$;

-- ── 33-35 · El reporte de inconsistencias ──────────────────────────────────
DO $$
DECLARE
  LUCIA constant uuid := 'e0000000-0000-0000-0000-000000000001';
  NADIA constant uuid := 'e0000000-0000-0000-0000-000000000003';
  P1    constant uuid := '11111111-0000-0000-0000-000000000001';
  v_antes  bigint;
  v_despues bigint;
  n        bigint;
  v_id     uuid;
BEGIN
  -- Se siembra una fila HISTÓRICA rota tal como las dejaba el cálculo en el
  -- navegador: consumo que no es la resta de sus lecturas, importe en cero y
  -- nacida 'pagado'. Entra por service_role, que es la vía exenta del trigger
  -- (backfills y sembrado) — si entrara por el camino normal se corregiría
  -- sola y no habría nada que reportar.
  PERFORM set_config('app.uid', LUCIA::text, false);
  PERFORM set_config('request.jwt.claims', '{"role":"service_role"}', false);
  INSERT INTO public.registros (
    contador_id, project_id, cliente_id, cliente_nombre, fecha,
    lectura_anterior, lectura_actual, consumo, tarifa_aplicada, canon_aplicado,
    monto_calculado, tipo_cobro, estado
  ) VALUES (
    'c0000000-0000-0000-0000-000000000001', P1, 'c1000000-0000-0000-0000-000000000001',
    'Familia Pérez', now() - interval '400 days',
    0, 90, 7, 3.75, 20, 0, 'Consumo Normal', 'pagado'
  ) RETURNING id INTO v_id;
  PERFORM set_config('request.jwt.claims', '', false);

  SELECT count(*) INTO v_antes FROM public.registros;

  -- 33 · Ve los hallazgos que tiene que ver, sobre ESA fila.
  SELECT count(*) INTO n FROM public.agua_lecturas_inconsistencias(P1) i
   WHERE i.registro_id = v_id
     AND i.hallazgo IN ('consumo_incoherente', 'monto_cero_con_consumo', 'pagada_sin_pago', 'retroactiva');
  IF n < 4 THEN
    RAISE EXCEPTION '33: el reporte sólo vio % de los 4 hallazgos de la fila sembrada', n; END IF;
  RAISE NOTICE 'OK 33  el reporte nombra el consumo incoherente, el importe en cero, el recibo nacido pagado y la retroactiva';

  -- 34 · Y NO toca nada. Es la mitad del contrato de este reporte.
  SELECT count(*) INTO v_despues FROM public.registros;
  IF v_antes <> v_despues THEN
    RAISE EXCEPTION '34: el reporte cambió el número de filas (% → %)', v_antes, v_despues; END IF;
  SELECT count(*) INTO n FROM public.registros r
   WHERE r.id = v_id AND r.consumo = 7 AND r.monto_calculado = 0 AND r.estado = 'pagado';
  IF n <> 1 THEN RAISE EXCEPTION '34: el reporte reescribió la fila que sólo tenía que reportar'; END IF;
  SELECT count(*) INTO n FROM pg_proc p
    JOIN pg_namespace ns ON ns.oid = p.pronamespace
   WHERE ns.nspname = 'public'
     AND p.proname IN ('agua_lecturas_inconsistencias', 'agua_lecturas_inconsistencias_resumen')
     AND p.provolatile = 'v';
  IF n <> 0 THEN RAISE EXCEPTION '34: alguna función del reporte es VOLATILE (podría escribir)'; END IF;
  RAISE NOTICE 'OK 34  el reporte no reescribe ninguna fila, y no puede: es STABLE';

  -- 35 · Y está acotado: la empresa vecina no ve nada de aquí.
  PERFORM set_config('app.uid', NADIA::text, false);
  SELECT count(*) INTO n FROM public.agua_lecturas_inconsistencias(NULL);
  IF n <> 0 THEN
    RAISE EXCEPTION '35: la empresa vecina vio % hallazgos de nuestros proyectos', n; END IF;
  PERFORM set_config('app.uid', LUCIA::text, false);
  SELECT count(*) INTO n FROM public.agua_lecturas_inconsistencias_resumen(NULL);
  IF n = 0 THEN RAISE EXCEPTION '35: el resumen salió vacío para quien sí tiene acceso'; END IF;
  RAISE NOTICE 'OK 35  el reporte está acotado a la empresa y a los proyectos del caller';
END $$;

-- ── 36-38 · La ACL y el camino ejercido COMO `authenticated` ───────────────
DO $$
DECLARE
  reg public.registros;
  n   bigint;
BEGIN
  -- 36 · anon no ejecuta NADA de esto.
  IF EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace ns ON ns.oid = p.pronamespace
     WHERE ns.nspname = 'public'
       AND p.proname IN ('registrar_lectura', 'agua_lectura_contexto', 'agua_lectura_resolver',
                         'agua_costo_tarifa', 'agua_lectura_por_idempotencia',
                         'agua_lecturas_inconsistencias', 'agua_lecturas_inconsistencias_resumen',
                         'agua_tg_lectura_autoritativa')
       AND has_function_privilege('anon', p.oid, 'EXECUTE')
  ) THEN
    RAISE EXCEPTION '36: alguna función de la captura quedó ejecutable por anon'; END IF;
  IF has_function_privilege('authenticated', 'public.agua_tg_lectura_autoritativa()', 'EXECUTE') THEN
    RAISE EXCEPTION '36: el cuerpo del trigger quedó ejecutable por authenticated'; END IF;
  IF NOT has_function_privilege('authenticated',
        'public.registrar_lectura(uuid, numeric, date, text, text, text, jsonb, boolean, numeric, date)', 'EXECUTE') THEN
    RAISE EXCEPTION '36: authenticated no puede ejecutar registrar_lectura'; END IF;
  RAISE NOTICE 'OK 36  anon no ejecuta nada; authenticated ejecuta la RPC y no el trigger';

  -- 37 · El camino real, COMO `authenticated`: todo lo anterior corrió como
  -- superusuario, que se salta la RLS. Esto es lo único que prueba que una
  -- operadora de verdad puede registrar su lectura con la policy puesta.
  SET LOCAL ROLE authenticated;
  PERFORM set_config('app.uid', 'e0000000-0000-0000-0000-000000000001', false);
  SELECT * INTO reg FROM public.registrar_lectura(
    'c0000000-0000-0000-0000-000000000001'::uuid, 260,
    (now() AT TIME ZONE 'America/Guatemala')::date, 'idem-auth-0001', 'Como authenticated', NULL, NULL);
  IF reg.id IS NULL OR reg.consumo <> 20 THEN
    RAISE EXCEPTION '37: la captura como authenticated no entró o calculó mal (consumo %)', reg.consumo; END IF;
  RAISE NOTICE 'OK 37  una operadora real registra su lectura con la RLS puesta';

  -- 38 · Y la policy sigue siendo la puerta: sobre el proyecto ajeno, no.
  BEGIN
    PERFORM public.registrar_lectura(
      'c0000000-0000-0000-0000-000000000005'::uuid, 5,
      (now() AT TIME ZONE 'America/Guatemala')::date, 'idem-auth-0002', NULL, NULL, NULL);
    RAISE EXCEPTION '38: como authenticated se registró en un proyecto no asignado';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  RESET ROLE;
  RAISE NOTICE 'OK 38  la autorización sigue siendo la policy registros_insert, no un guard copiado';
END $$;
