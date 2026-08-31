-- ════════════════════════════════════════════════════════════════════════════
-- Invariantes de 20260907001000 (sesión única; la carrera con barrera corre
-- aparte, en run.sh, porque necesita DOS conexiones de verdad).
--
-- Identidad: `app.uid` emula auth.uid() (fixture). Cada DO es una transacción:
-- set_config(..., true) se redeclara por bloque.
--
-- Después de CADA caso se comprueba lo que pide #809: stock, movimientos,
-- vínculo movimiento_id y estado de la tarea.
-- ════════════════════════════════════════════════════════════════════════════

-- ── 1 · camino feliz: cierre y consumo en UNA llamada ───────────────────────
DO $$
DECLARE
  r record;
  v record;
  v_movs int;
BEGIN
  PERFORM set_config('app.uid', 'a0000000-0000-0000-0000-00000000000a', true);

  SELECT * INTO r FROM public.cerrar_tarea_y_consumir_insumos(
    'a1000000-0000-0000-0000-000000000001', 'completada', NULL,
    '[{"suministro_id":"50000000-0000-0000-0000-000000000001","cantidad":2},
      {"suministro_id":"50000000-0000-0000-0000-000000000002","cantidad":3}]'::jsonb);
  IF r.consumidos <> 2 OR r.no_usados <> 0 THEN
    RAISE EXCEPTION '1a: se esperaba 2 consumidos / 0 no usados (hubo %/%)',
      r.consumidos, r.no_usados;
  END IF;
  IF jsonb_array_length(r.sin_stock) <> 1
     OR r.sin_stock -> 0 ->> 'suministro_id' <> '50000000-0000-0000-0000-000000000002' THEN
    RAISE EXCEPTION '1b: el faltante de Bolsas (1 < 3) debía avisarse: %', r.sin_stock;
  END IF;

  SELECT estado, completada_en, completado_por, motivo_sin_evidencia
    INTO v FROM public.tareas_bloque WHERE id = 'a1000000-0000-0000-0000-000000000001';
  IF v.estado <> 'completada' OR v.completada_en IS NULL THEN
    RAISE EXCEPTION '1c: la tarea no quedó cerrada (estado=%, en=%)', v.estado, v.completada_en;
  END IF;
  IF v.completado_por IS DISTINCT FROM 'a0000000-0000-0000-0000-00000000000a' THEN
    RAISE EXCEPTION '1d: completado_por debía sellarlo la BD con Ana (quedó %)', v.completado_por;
  END IF;

  SELECT count(*) INTO v_movs FROM public.movimientos_suministro
   WHERE origen_tabla = 'tareas_bloque'
     AND origen_id = 'a1000000-0000-0000-0000-000000000001';
  IF v_movs <> 2 THEN
    RAISE EXCEPTION '1e: se esperaban 2 movimientos de T1 (hay %)', v_movs;
  END IF;
  IF EXISTS (SELECT 1 FROM public.tarea_bloque_suministros
             WHERE tarea_id = 'a1000000-0000-0000-0000-000000000001'
               AND (movimiento_id IS NULL OR no_usado_en IS NOT NULL)) THEN
    RAISE EXCEPTION '1f: tras el cierre no debía quedar fila sin vincular a su movimiento';
  END IF;
  IF (SELECT stock_actual FROM public.suministros_condominio
      WHERE id = '50000000-0000-0000-0000-000000000001') <> 8 THEN
    RAISE EXCEPTION '1g: el Cloro debía quedar en 8';
  END IF;
  IF (SELECT stock_actual FROM public.suministros_condominio
      WHERE id = '50000000-0000-0000-0000-000000000002') <> 0 THEN
    RAISE EXCEPTION '1h: las Bolsas debían tocar el piso 0 (motor de 20260821000200)';
  END IF;
  RAISE NOTICE '1 · UNA llamada cerró, selló al actor, consumió 2 y avisó el faltante';
END $$;

-- ── 2 · respuesta perdida y reintento: como máximo un movimiento por fila ──
DO $$
DECLARE
  r record;
  v_movs int;
BEGIN
  PERFORM set_config('app.uid', 'a0000000-0000-0000-0000-00000000000a', true);
  SELECT * INTO r FROM public.cerrar_tarea_y_consumir_insumos(
    'a1000000-0000-0000-0000-000000000001', 'completada', NULL,
    '[{"suministro_id":"50000000-0000-0000-0000-000000000001","cantidad":2},
      {"suministro_id":"50000000-0000-0000-0000-000000000002","cantidad":3}]'::jsonb);
  IF r.consumidos <> 0 OR r.no_usados <> 0 THEN
    RAISE EXCEPTION '2a: el reintento no debía re-consumir (consumidos=%, no_usados=%)',
      r.consumidos, r.no_usados;
  END IF;
  SELECT count(*) INTO v_movs FROM public.movimientos_suministro
   WHERE origen_id = 'a1000000-0000-0000-0000-000000000001';
  IF v_movs <> 2 THEN
    RAISE EXCEPTION '2b: el reintento duplicó movimientos (hay %)', v_movs;
  END IF;
  IF (SELECT stock_actual FROM public.suministros_condominio
      WHERE id = '50000000-0000-0000-0000-000000000001') <> 8 THEN
    RAISE EXCEPTION '2c: el reintento volvió a descontar';
  END IF;
  RAISE NOTICE '2 · reintentar tras respuesta perdida: 0 consumidos, ni un movimiento más';
END $$;

-- ── 3 · fallo del RPC después de iniciar el cierre: TODO revierte ───────────
UPDATE public.tareas_bloque SET requiere_foto = true
 WHERE id = 'a1000000-0000-0000-0000-000000000002';

DO $$
DECLARE
  v record;
  v_movs int;
BEGIN
  PERFORM set_config('app.uid', 'a0000000-0000-0000-0000-00000000000a', true);
  BEGIN
    PERFORM public.cerrar_tarea_y_consumir_insumos(
      'a1000000-0000-0000-0000-000000000002', 'completada', NULL,
      '[{"suministro_id":"50000000-0000-0000-0000-000000000001","cantidad":2}]'::jsonb);
    RAISE EXCEPTION '3a: cerró sin la foto exigida y sin motivo';
  EXCEPTION WHEN check_violation THEN
    IF SQLERRM NOT LIKE 'EVIDENCIA:%' THEN RAISE; END IF;
  END;

  SELECT estado, completada_en, completado_por INTO v
  FROM public.tareas_bloque WHERE id = 'a1000000-0000-0000-0000-000000000002';
  IF v.estado <> 'pendiente' OR v.completada_en IS NOT NULL OR v.completado_por IS NOT NULL THEN
    RAISE EXCEPTION '3b: la tarea debía seguir pendiente y sin sellos (estado=%, en=%, por=%)',
      v.estado, v.completada_en, v.completado_por;
  END IF;
  SELECT count(*) INTO v_movs FROM public.movimientos_suministro
   WHERE origen_id = 'a1000000-0000-0000-0000-000000000002';
  IF v_movs <> 0 THEN
    RAISE EXCEPTION '3c: el fallo del cierre dejó % movimiento(s): el consumo debía revertirse', v_movs;
  END IF;
  IF (SELECT stock_actual FROM public.suministros_condominio
      WHERE id = '50000000-0000-0000-0000-000000000001') <> 8 THEN
    RAISE EXCEPTION '3d: el stock cambió aunque el cierre falló';
  END IF;
  RAISE NOTICE '3 · sin evidencia el RPC falla y NADA queda: ni cierre, ni movimiento, ni descuento';
END $$;

-- ── 4 · el JSON se valida ANTES de escribir nada ────────────────────────────
DO $$
DECLARE
  caso record;
  v_movs int;
BEGIN
  PERFORM set_config('app.uid', 'a0000000-0000-0000-0000-00000000000a', true);
  FOR caso IN SELECT * FROM (VALUES
    ('NaN como string',
     '[{"suministro_id":"50000000-0000-0000-0000-000000000001","cantidad":"NaN"}]'::jsonb),
    ('cantidad negativa',
     '[{"suministro_id":"50000000-0000-0000-0000-000000000001","cantidad":-1}]'::jsonb),
    ('suministro duplicado',
     '[{"suministro_id":"50000000-0000-0000-0000-000000000001","cantidad":1},
       {"suministro_id":"50000000-0000-0000-0000-000000000001","cantidad":2}]'::jsonb),
    ('ajeno al plan de la tarea',
     '[{"suministro_id":"50000000-0000-0000-0000-000000000003","cantidad":1}]'::jsonb),
    ('no es un arreglo', '{"suministro_id":"x"}'::jsonb),
    ('elemento que no es objeto', '[42]'::jsonb),
    ('uuid inválido', '[{"suministro_id":"esto-no-es-uuid","cantidad":1}]'::jsonb),
    ('cantidad no numérica', '[{"suministro_id":"50000000-0000-0000-0000-000000000001","cantidad":true}]'::jsonb),
    -- 20260907001100: lo que numeric(10,2) redondearía en silencio se rechaza.
    ('tres decimales (0.001)',
     '[{"suministro_id":"50000000-0000-0000-0000-000000000001","cantidad":0.001}]'::jsonb),
    -- 20260907001100: el MISMO uuid en otra representación (sin guiones; el
    -- cast acepta ambas — may/min cubierto por lo mismo) no es «otro»
    -- suministro: el duplicado se agrupa por el uuid NORMALIZADO.
    ('mismo uuid en dos representaciones',
     ('[{"suministro_id":"50000000-0000-0000-0000-000000000001","cantidad":1},' ||
      '{"suministro_id":"' || replace('50000000-0000-0000-0000-000000000001', '-', '') || '","cantidad":2}]')::jsonb)
  ) AS t(nombre, payload) LOOP
    BEGIN
      PERFORM public.cerrar_tarea_y_consumir_insumos(
        'a1000000-0000-0000-0000-000000000002', 'completada',
        'la cámara del turno se dañó', caso.payload);
      RAISE EXCEPTION '4: el payload «%» debía rechazarse', caso.nombre;
    EXCEPTION WHEN invalid_parameter_value THEN
      NULL; -- 22023: rechazado antes de escribir, como debe.
    END;
  END LOOP;

  IF (SELECT estado FROM public.tareas_bloque
      WHERE id = 'a1000000-0000-0000-0000-000000000002') <> 'pendiente' THEN
    RAISE EXCEPTION '4a: un payload inválido cerró la tarea';
  END IF;
  SELECT count(*) INTO v_movs FROM public.movimientos_suministro
   WHERE origen_id = 'a1000000-0000-0000-0000-000000000002';
  IF v_movs <> 0 THEN
    RAISE EXCEPTION '4b: un payload inválido dejó % movimiento(s)', v_movs;
  END IF;
  RAISE NOTICE '4 · NaN, negativos, duplicados (exactos y may/min), 0.001, ajenos y JSON deforme: 22023 y ni una escritura';
END $$;

-- ── 5 · el cero es TERMINAL: sella no_usado_en y deja de ser reclamable ─────
DO $$
DECLARE
  r record;
  v record;
BEGIN
  PERFORM set_config('app.uid', 'a0000000-0000-0000-0000-00000000000a', true);
  SELECT * INTO r FROM public.cerrar_tarea_y_consumir_insumos(
    'a1000000-0000-0000-0000-000000000002', 'completada',
    'la cámara del turno se dañó',
    '[{"suministro_id":"50000000-0000-0000-0000-000000000001","cantidad":0},
      {"suministro_id":"50000000-0000-0000-0000-000000000002","cantidad":1}]'::jsonb);
  IF r.consumidos <> 1 OR r.no_usados <> 1 THEN
    RAISE EXCEPTION '5a: se esperaba 1 consumido / 1 no usado (hubo %/%)',
      r.consumidos, r.no_usados;
  END IF;

  SELECT movimiento_id, no_usado_en, motivo_no_usado INTO v
  FROM public.tarea_bloque_suministros
  WHERE tarea_id = 'a1000000-0000-0000-0000-000000000002'
    AND suministro_id = '50000000-0000-0000-0000-000000000001';
  IF v.movimiento_id IS NOT NULL OR v.no_usado_en IS NULL OR v.motivo_no_usado IS NULL THEN
    RAISE EXCEPTION '5b: el 0 debía sellar no_usado_en + motivo sin movimiento (mov=%, en=%, motivo=%)',
      v.movimiento_id, v.no_usado_en, v.motivo_no_usado;
  END IF;
  IF (SELECT motivo_sin_evidencia FROM public.tareas_bloque
      WHERE id = 'a1000000-0000-0000-0000-000000000002')
     IS DISTINCT FROM 'la cámara del turno se dañó' THEN
    RAISE EXCEPTION '5c: el motivo declarado debía quedar escrito en la tarea';
  END IF;
  IF (SELECT stock_actual FROM public.suministros_condominio
      WHERE id = '50000000-0000-0000-0000-000000000001') <> 8 THEN
    RAISE EXCEPTION '5d: el 0 descontó Cloro';
  END IF;
  RAISE NOTICE '5 · «no lo necesité» quedó sellado: fecha, motivo y ningún movimiento';
END $$;

-- ── 6 · el reintento NO consume la fila sellada como no usada ───────────────
DO $$
DECLARE
  r record;
  v_movs int;
BEGIN
  PERFORM set_config('app.uid', 'a0000000-0000-0000-0000-00000000000a', true);
  -- El reintento del frontend viejo era «sin cantidades»: el plan entero. Es
  -- EXACTAMENTE el accidente que el sello viene a impedir.
  SELECT * INTO r FROM public.cerrar_tarea_y_consumir_insumos(
    'a1000000-0000-0000-0000-000000000002', 'completada', NULL, '[]'::jsonb);
  IF r.consumidos <> 0 OR r.no_usados <> 0 THEN
    RAISE EXCEPTION '6a: el reintento reclamó filas selladas (consumidos=%, no_usados=%)',
      r.consumidos, r.no_usados;
  END IF;
  IF (SELECT movimiento_id FROM public.tarea_bloque_suministros
      WHERE tarea_id = 'a1000000-0000-0000-0000-000000000002'
        AND suministro_id = '50000000-0000-0000-0000-000000000001') IS NOT NULL THEN
    RAISE EXCEPTION '6b: la fila sellada terminó consumida';
  END IF;
  SELECT count(*) INTO v_movs FROM public.movimientos_suministro
   WHERE origen_id = 'a1000000-0000-0000-0000-000000000002';
  IF v_movs <> 1 THEN
    RAISE EXCEPTION '6c: T2 debía seguir con exactamente 1 movimiento (hay %)', v_movs;
  END IF;
  RAISE NOTICE '6 · el reintento sin payload ya no puede consumir el «no usado» por accidente';
END $$;

-- ── 7 · consumida Y descartada a la vez es un estado imposible (CHECK) ──────
DO $$
DECLARE
  v_mov uuid;
BEGIN
  SELECT movimiento_id INTO v_mov FROM public.tarea_bloque_suministros
   WHERE tarea_id = 'a1000000-0000-0000-0000-000000000002'
     AND suministro_id = '50000000-0000-0000-0000-000000000002';
  BEGIN
    UPDATE public.tarea_bloque_suministros
       SET movimiento_id = v_mov
     WHERE tarea_id = 'a1000000-0000-0000-0000-000000000002'
       AND suministro_id = '50000000-0000-0000-0000-000000000001';
    RAISE EXCEPTION '7: una fila quedó consumida y descartada a la vez';
  EXCEPTION WHEN check_violation THEN
    IF SQLERRM NOT LIKE '%tbs_consumo_o_descarte_check%' THEN RAISE; END IF;
  END;
  RAISE NOTICE '7 · tbs_consumo_o_descarte_check impide movimiento_id + no_usado_en juntos';
END $$;

-- ── 8 · una tarea PENDIENTE nunca consume inventario ────────────────────────
DO $$
DECLARE
  v_movs int;
BEGIN
  PERFORM set_config('app.uid', 'a0000000-0000-0000-0000-00000000000a', true);
  -- La RPC vieja, endurecida: rechaza el consumo sin cierre.
  BEGIN
    PERFORM public.consumir_insumos_tarea(
      'a1000000-0000-0000-0000-000000000004',
      '[]'::jsonb);
    RAISE EXCEPTION '8a: consumir_insumos_tarea aceptó una tarea pendiente';
  EXCEPTION WHEN check_violation THEN
    IF SQLERRM NOT LIKE 'CONSUMO:%' THEN RAISE; END IF;
  END;
  -- La RPC nueva no abre puertas laterales: sólo cierra en 'completada'.
  BEGIN
    PERFORM public.cerrar_tarea_y_consumir_insumos(
      'a1000000-0000-0000-0000-000000000004', 'omitida');
    RAISE EXCEPTION '8b: la RPC nueva aceptó cerrar en omitida';
  EXCEPTION WHEN invalid_parameter_value THEN NULL;
  END;

  SELECT count(*) INTO v_movs FROM public.movimientos_suministro
   WHERE origen_id IN ('a1000000-0000-0000-0000-000000000003',
                       'a1000000-0000-0000-0000-000000000004');
  IF v_movs <> 0 THEN
    RAISE EXCEPTION '8c: una tarea sin cerrar generó movimientos (%)', v_movs;
  END IF;
  RAISE NOTICE '8 · sin cierre no hay consumo: la RPC vieja lo exige y la nueva no lo esquiva';
END $$;

-- ── 9 · el camino post-cierre SIGUE existiendo (con_observacion + declarar) ─
DO $$
DECLARE
  r record;
BEGIN
  PERFORM set_config('app.uid', 'a0000000-0000-0000-0000-00000000000a', true);
  -- El hallazgo se reporta por su camino de siempre (UPDATE directo)…
  UPDATE public.tareas_bloque
     SET estado = 'con_observacion',
         novedad = 'la bomba hace un ruido raro',
         prioridad = 'alta',
         completada_en = now()
   WHERE id = 'a1000000-0000-0000-0000-000000000005';
  -- …y el consumo se declara DESPUÉS, por la RPC vieja: es su rol desde ahora.
  SELECT * INTO r FROM public.consumir_insumos_tarea(
    'a1000000-0000-0000-0000-000000000005',
    '[{"suministro_id":"50000000-0000-0000-0000-000000000001","cantidad":1},
      {"suministro_id":"50000000-0000-0000-0000-000000000002","cantidad":0}]'::jsonb);
  IF r.consumidos <> 1 OR r.no_usados <> 1 THEN
    RAISE EXCEPTION '9a: se esperaba 1 consumido / 1 no usado (hubo %/%)',
      r.consumidos, r.no_usados;
  END IF;
  IF (SELECT stock_actual FROM public.suministros_condominio
      WHERE id = '50000000-0000-0000-0000-000000000001') <> 7 THEN
    RAISE EXCEPTION '9b: el Cloro debía quedar en 7';
  END IF;
  RAISE NOTICE '9 · cerrada con observación, el consumo declarado después sigue funcionando';
END $$;

-- ── 10 · el scope es de compañía, no sólo de permiso ────────────────────────
DO $$
BEGIN
  -- Diego: MISMO permiso que Ana (tareas_personal), OTRA compañía.
  PERFORM set_config('app.uid', 'a0000000-0000-0000-0000-00000000000d', true);
  BEGIN
    PERFORM public.cerrar_tarea_y_consumir_insumos(
      'a1000000-0000-0000-0000-000000000006', 'completada');
    RAISE EXCEPTION '10a: la empresa vecina cerró una tarea ajena';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    PERFORM public.consumir_insumos_tarea(
      'a1000000-0000-0000-0000-000000000001', '[]'::jsonb);
    RAISE EXCEPTION '10b: la empresa vecina consumió una tarea ajena';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  RAISE NOTICE '10 · conocer el UUID no alcanza: el scope de compañía corta a la vecina';
END $$;

DO $$
BEGIN
  -- Bruno: MISMA compañía, permiso equivocado (suministros, no tareas).
  PERFORM set_config('app.uid', 'a0000000-0000-0000-0000-00000000000b', true);
  BEGIN
    PERFORM public.cerrar_tarea_y_consumir_insumos(
      'a1000000-0000-0000-0000-000000000006', 'completada');
    RAISE EXCEPTION '10c: el de almacén cerró una tarea sin permiso de tareas';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  IF (SELECT estado FROM public.tareas_bloque
      WHERE id = 'a1000000-0000-0000-0000-000000000006') <> 'pendiente' THEN
    RAISE EXCEPTION '10d: T6 debía seguir pendiente para la prueba de concurrencia';
  END IF;
  RAISE NOTICE '10 · el permiso de almacén no cierra tareas; T6 sigue pendiente para la carrera';
END $$;

-- ── 11 · inexistente: mismo error, sin oráculo de existencia ────────────────
DO $$
BEGIN
  PERFORM set_config('app.uid', 'a0000000-0000-0000-0000-00000000000a', true);
  BEGIN
    PERFORM public.cerrar_tarea_y_consumir_insumos(
      '00000000-0000-0000-0000-00000000dead', 'completada');
    RAISE EXCEPTION '11: una tarea inexistente no debía cerrar';
  EXCEPTION WHEN undefined_object THEN NULL;
  END;
  RAISE NOTICE '11 · tarea inexistente: 42704 sin filtrar datos';
END $$;

-- ── 12 · contabilidad global: exactamente un movimiento por fila reclamada ──
DO $$
DECLARE
  v_reclamadas int;
  v_distintos int;
  v_rotos int;
BEGIN
  SELECT count(*), count(DISTINCT movimiento_id)
    INTO v_reclamadas, v_distintos
  FROM public.tarea_bloque_suministros WHERE movimiento_id IS NOT NULL;
  IF v_reclamadas <> 4 OR v_distintos <> 4 THEN
    RAISE EXCEPTION '12a: se esperaban 4 filas reclamadas con 4 movimientos DISTINTOS (%/%)',
      v_reclamadas, v_distintos;
  END IF;

  SELECT count(*) INTO v_rotos
  FROM public.tarea_bloque_suministros tbs
  JOIN public.movimientos_suministro m ON m.id = tbs.movimiento_id
  WHERE m.tipo <> 'salida'
     OR m.origen_tabla <> 'tareas_bloque'
     OR m.origen_id <> tbs.tarea_id
     OR m.suministro_id <> tbs.suministro_id;
  IF v_rotos <> 0 THEN
    RAISE EXCEPTION '12b: % vínculo(s) movimiento↔fila no cuadran', v_rotos;
  END IF;

  IF (SELECT count(*) FROM public.movimientos_suministro) <> 4 THEN
    RAISE EXCEPTION '12c: hay movimientos sin fila que los reclame';
  END IF;
  RAISE NOTICE '12 · 4 filas reclamadas ↔ 4 movimientos, 1:1 y bien trazados';
END $$;

-- ── 13 · lo OMITIDO no consume por NINGUNA RPC (20260907001100) ─────────────
DO $$
DECLARE
  v_movs int;
BEGIN
  PERFORM set_config('app.uid', 'a0000000-0000-0000-0000-00000000000a', true);
  -- T3 se omite por su camino de siempre (no se hizo el trabajo).
  UPDATE public.tareas_bloque
     SET estado = 'omitida', completada_en = now()
   WHERE id = 'a1000000-0000-0000-0000-000000000003';

  BEGIN
    PERFORM public.consumir_insumos_tarea(
      'a1000000-0000-0000-0000-000000000003', '[]'::jsonb);
    RAISE EXCEPTION '13a: consumir_insumos_tarea aceptó una tarea omitida';
  EXCEPTION WHEN check_violation THEN
    IF SQLERRM NOT LIKE 'CONSUMO:%omitida%' THEN RAISE; END IF;
  END;
  BEGIN
    PERFORM public.cerrar_tarea_y_consumir_insumos(
      'a1000000-0000-0000-0000-000000000003', 'completada');
    RAISE EXCEPTION '13b: la RPC de cierre re-cerró una tarea omitida';
  EXCEPTION WHEN check_violation THEN NULL;
  END;

  SELECT count(*) INTO v_movs FROM public.movimientos_suministro
   WHERE origen_id = 'a1000000-0000-0000-0000-000000000003';
  IF v_movs <> 0 THEN
    RAISE EXCEPTION '13c: la tarea omitida generó % movimiento(s)', v_movs;
  END IF;
  RAISE NOTICE '13 · lo que NO se hizo no gasta insumos: omitida rechazada por las dos RPC';
END $$;

-- ── 14 · cantidades finas EXACTAS: 0.01 y el máximo de numeric(10,2) ────────
-- En transacción REVERTIDA: T6 tiene que seguir pendiente y sin plan tocado
-- para la carrera de run.sh, y los totales de 12 no deben moverse.
BEGIN;
DO $$
DECLARE
  r record;
  v_001 numeric;
  v_max numeric;
BEGIN
  PERFORM set_config('app.uid', 'a0000000-0000-0000-0000-00000000000a', true);
  SELECT * INTO r FROM public.cerrar_tarea_y_consumir_insumos(
    'a1000000-0000-0000-0000-000000000006', 'completada', NULL,
    '[{"suministro_id":"50000000-0000-0000-0000-000000000001","cantidad":0.01},
      {"suministro_id":"50000000-0000-0000-0000-000000000002","cantidad":99999999.99}]'::jsonb);
  IF r.consumidos <> 2 THEN
    RAISE EXCEPTION '14a: 0.01 y el máximo debían consumirse (consumidos=%)', r.consumidos;
  END IF;
  SELECT m.cantidad INTO v_001 FROM public.movimientos_suministro m
   WHERE m.origen_id = 'a1000000-0000-0000-0000-000000000006'
     AND m.suministro_id = '50000000-0000-0000-0000-000000000001';
  SELECT m.cantidad INTO v_max FROM public.movimientos_suministro m
   WHERE m.origen_id = 'a1000000-0000-0000-0000-000000000006'
     AND m.suministro_id = '50000000-0000-0000-0000-000000000002';
  IF v_001 IS DISTINCT FROM 0.01 OR v_max IS DISTINCT FROM 99999999.99 THEN
    RAISE EXCEPTION '14b: las cantidades no viajaron EXACTAS (0.01→%, max→%)', v_001, v_max;
  END IF;
  RAISE NOTICE '14 · 0.01 y 99999999.99 entran y se registran EXACTOS — sin redondeos fantasma';
END $$;
ROLLBACK;

-- Tras el ROLLBACK, nada se movió: T6 lista para la carrera y totales de 12.
DO $$
BEGIN
  IF (SELECT estado FROM public.tareas_bloque
      WHERE id = 'a1000000-0000-0000-0000-000000000006') <> 'pendiente' THEN
    RAISE EXCEPTION '14c: T6 debía volver a pendiente tras el ROLLBACK';
  END IF;
  IF (SELECT count(*) FROM public.movimientos_suministro) <> 4 THEN
    RAISE EXCEPTION '14d: el ROLLBACK no devolvió los 4 movimientos';
  END IF;
  RAISE NOTICE '14 · el ensayo fino se revirtió limpio: T6 pendiente y 4 movimientos';
END $$;
