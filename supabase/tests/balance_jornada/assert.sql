-- ════════════════════════════════════════════════════════════════════════════
-- Invariantes de 20260912020400 · el balance del día (Fase 2)
-- ════════════════════════════════════════════════════════════════════════════
-- La 1 vuelve a ser la más importante, por la misma razón que en la fase 1:
-- esta migración se anuncia como LECTURA y no debe mover ni un número de la
-- planilla. Las demás comprueban que la lectura sea correcta, incluida la que
-- mide contra la medianoche —donde ya se rompió una vez (#839)—.
\set ON_ERROR_STOP on

\set ADA     '''e0000000-0000-0000-0000-00000000000d'''
\set PROY    '''11111111-0000-0000-0000-000000000001'''
\set ANA     '''9e000000-0000-0000-0000-000000000003'''

-- Escenario común: jornada diurna 06–14 con 30 min de descanso, tolerancia 10,
-- tramo compensable hasta 30, cupos de 45 de almuerzo y 15 de refacción.
DO $$
DECLARE v_plant uuid;
BEGIN
  PERFORM set_config('app.uid', 'e0000000-0000-0000-0000-00000000000d', true);
  INSERT INTO public.plantillas_horario
    (id, company_id, project_id, nombre, hora_inicio, hora_fin, minutos_descanso,
     tolerancia_entrada_min, tolerancia_salida_min, demora_compensable_hasta_min,
     extra_requiere_autorizacion)
  VALUES ('bbbbbbbb-0000-0000-0000-00000000000d',
          'aaaaaaaa-0000-0000-0000-00000000000a', '11111111-0000-0000-0000-000000000001',
          'Diurna 6-14', '06:00', '14:00', 45, 10, 5, 30, true)
  RETURNING id INTO v_plant;
  INSERT INTO public.plantilla_cupos_pausa (company_id, project_id, plantilla_horario_id, tipo, minutos) VALUES
    ('aaaaaaaa-0000-0000-0000-00000000000a', '11111111-0000-0000-0000-000000000001', v_plant, 'almuerzo', 45),
    ('aaaaaaaa-0000-0000-0000-00000000000a', '11111111-0000-0000-0000-000000000001', v_plant, 'refaccion', 15);
  RAISE NOTICE 'OK 0  escenario: jornada 06–14, tolerancia 10, compensable 30, cupos 45+15';
END $$;

/** Crea un día completo: bloque con vara, marcaje y (opcional) una pausa. */
CREATE OR REPLACE FUNCTION pg_temp.sembrar_dia(
  p_fecha date, p_entrada time, p_salida time,
  p_tipo_pausa text DEFAULT NULL, p_min_pausa int DEFAULT NULL,
  p_con_bloque boolean DEFAULT true
) RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE v_reg uuid;
BEGIN
  IF p_con_bloque THEN
    INSERT INTO public.bloques_turno
      (company_id, project_id, personal_id, fecha, plantilla_horario_id,
       hora_inicio, hora_fin, horas_planificadas)
    VALUES ('aaaaaaaa-0000-0000-0000-00000000000a', '11111111-0000-0000-0000-000000000001',
            '9e000000-0000-0000-0000-000000000003', p_fecha,
            'bbbbbbbb-0000-0000-0000-00000000000d', '06:00', '14:00', 7.25);
  END IF;

  INSERT INTO public.presencia_personal
    (company_id, project_id, personal_id, nombre, fecha, hora_entrada, hora_salida, estado)
  VALUES ('aaaaaaaa-0000-0000-0000-00000000000a', '11111111-0000-0000-0000-000000000001',
          '9e000000-0000-0000-0000-000000000003', 'Ana sin cuenta', p_fecha,
          p_entrada, p_salida, 'presente')
  RETURNING id INTO v_reg;

  IF p_tipo_pausa IS NOT NULL THEN
    INSERT INTO public.presencia_pausas
      (company_id, project_id, registro_id, personal_id, tipo, etiqueta, descuenta,
       inicio_en, fin_en, origen)
    VALUES ('aaaaaaaa-0000-0000-0000-00000000000a', '11111111-0000-0000-0000-000000000001',
            v_reg, '9e000000-0000-0000-0000-000000000003', p_tipo_pausa, p_tipo_pausa, true,
            (p_fecha + time '12:00') AT TIME ZONE 'America/Guatemala',
            (p_fecha + time '12:00' + (p_min_pausa || ' minutes')::interval) AT TIME ZONE 'America/Guatemala',
            'autoservicio');
  END IF;
  RETURN v_reg;
END $$;

-- ── 1 · El balance NO mueve la planilla ────────────────────────────────────
DO $$
DECLARE
  h_antes record;
  h_despues record;
BEGIN
  PERFORM set_config('app.uid', 'e0000000-0000-0000-0000-00000000000d', true);
  PERFORM pg_temp.sembrar_dia(CURRENT_DATE - 30, '06:00', '14:00', 'almuerzo', 45);

  SELECT * INTO h_antes FROM public.calcular_horas_personal(
    '11111111-0000-0000-0000-000000000001'::uuid, CURRENT_DATE - 30, CURRENT_DATE - 30)
  WHERE personal_id = '9e000000-0000-0000-0000-000000000003';

  PERFORM count(*) FROM public.presencia_balance_dia(
    '11111111-0000-0000-0000-000000000001'::uuid, CURRENT_DATE - 30, CURRENT_DATE - 30);

  SELECT * INTO h_despues FROM public.calcular_horas_personal(
    '11111111-0000-0000-0000-000000000001'::uuid, CURRENT_DATE - 30, CURRENT_DATE - 30)
  WHERE personal_id = '9e000000-0000-0000-0000-000000000003';

  IF h_antes IS DISTINCT FROM h_despues THEN
    RAISE EXCEPTION 'INVARIANTE 1: consultar el balance movió el cómputo';
  END IF;
  RAISE NOTICE 'OK 1  el balance es LECTURA: el cómputo de horas no se mueve';
END $$;

-- ── 2 · Un día que cumple, cumple ──────────────────────────────────────────
DO $$
DECLARE b record;
BEGIN
  PERFORM set_config('app.uid', 'e0000000-0000-0000-0000-00000000000d', true);
  SELECT * INTO b FROM public.presencia_balance_dia(
    '11111111-0000-0000-0000-000000000001'::uuid, CURRENT_DATE - 30, CURRENT_DATE - 30);

  IF NOT b.cumple THEN RAISE EXCEPTION 'INVARIANTE 2: no cumple (%)', b.hallazgos; END IF;
  IF b.minutos_tarde <> 0 OR b.minutos_salida_temprana <> 0 OR b.minutos_exceso_descanso <> 0 THEN
    RAISE EXCEPTION 'INVARIANTE 2: desvíos donde no los hay';
  END IF;
  IF b.horas_estadia <> 8 OR b.horas_descanso <> 0.75 OR b.horas_laborales <> 7.25 THEN
    RAISE EXCEPTION 'INVARIANTE 2: desglose = % / % / %', b.horas_estadia, b.horas_descanso, b.horas_laborales;
  END IF;
  IF NOT b.tiene_vara THEN RAISE EXCEPTION 'INVARIANTE 2: el día no tomó la vara'; END IF;
  RAISE NOTICE 'OK 2  8 h de estadía, 45 min de almuerzo, 7.25 h laborales: cumple y sin hallazgos';
END $$;

-- ── 3 · Los tres tramos de la demora, medidos ──────────────────────────────
DO $$
DECLARE
  b_ok    record;
  b_comp  record;
  b_deb   record;
BEGIN
  PERFORM set_config('app.uid', 'e0000000-0000-0000-0000-00000000000d', true);
  PERFORM pg_temp.sembrar_dia(CURRENT_DATE - 29, '06:08', '14:00');  -- 8 min: dentro
  PERFORM pg_temp.sembrar_dia(CURRENT_DATE - 28, '06:25', '14:00');  -- 25: compensable
  PERFORM pg_temp.sembrar_dia(CURRENT_DATE - 27, '06:50', '14:00');  -- 50: se debita

  SELECT * INTO b_ok   FROM public.presencia_balance_dia('11111111-0000-0000-0000-000000000001'::uuid, CURRENT_DATE - 29, CURRENT_DATE - 29);
  SELECT * INTO b_comp FROM public.presencia_balance_dia('11111111-0000-0000-0000-000000000001'::uuid, CURRENT_DATE - 28, CURRENT_DATE - 28);
  SELECT * INTO b_deb  FROM public.presencia_balance_dia('11111111-0000-0000-0000-000000000001'::uuid, CURRENT_DATE - 27, CURRENT_DATE - 27);

  IF b_ok.tramo_demora   <> 'sin_consecuencia' THEN RAISE EXCEPTION 'INVARIANTE 3: 8 min → %', b_ok.tramo_demora; END IF;
  IF b_comp.tramo_demora <> 'compensable'      THEN RAISE EXCEPTION 'INVARIANTE 3: 25 min → %', b_comp.tramo_demora; END IF;
  IF b_deb.tramo_demora  <> 'debitada'         THEN RAISE EXCEPTION 'INVARIANTE 3: 50 min → %', b_deb.tramo_demora; END IF;
  IF b_ok.minutos_tarde <> 8 OR b_comp.minutos_tarde <> 25 OR b_deb.minutos_tarde <> 50 THEN
    RAISE EXCEPTION 'INVARIANTE 3: minutos mal contados (% / % / %)',
      b_ok.minutos_tarde, b_comp.minutos_tarde, b_deb.minutos_tarde;
  END IF;
  -- Dentro de la tolerancia no es un hallazgo: la política dice que no pasa nada.
  IF 'demora' = ANY(b_ok.hallazgos) THEN RAISE EXCEPTION 'INVARIANTE 3: 8 min salió como hallazgo'; END IF;
  IF NOT ('demora' = ANY(b_comp.hallazgos)) THEN RAISE EXCEPTION 'INVARIANTE 3: 25 min no salió como hallazgo'; END IF;
  RAISE NOTICE 'OK 3  8 min sin consecuencia, 25 compensable, 50 debitada — los tres tramos leídos';
END $$;

-- ── 4 · Llegar ANTES no es un desvío ───────────────────────────────────────
DO $$
DECLARE b record;
BEGIN
  PERFORM set_config('app.uid', 'e0000000-0000-0000-0000-00000000000d', true);
  PERFORM pg_temp.sembrar_dia(CURRENT_DATE - 26, '05:30', '14:00');
  SELECT * INTO b FROM public.presencia_balance_dia('11111111-0000-0000-0000-000000000001'::uuid, CURRENT_DATE - 26, CURRENT_DATE - 26);
  IF b.minutos_tarde <> 0 THEN RAISE EXCEPTION 'INVARIANTE 4: media hora antes contó como % tarde', b.minutos_tarde; END IF;
  IF 'demora' = ANY(b.hallazgos) THEN RAISE EXCEPTION 'INVARIANTE 4: llegar antes se reportó como demora'; END IF;
  IF 'salida_temprana' = ANY(b.hallazgos) THEN RAISE EXCEPTION 'INVARIANTE 4: la salida a las 14:00 se leyó temprana'; END IF;
  -- Y sin embargo el día NO cumple, con razón: media hora antes son 30 minutos
  -- trabajados que nadie pidió, y esta jornada exige autorizar la extra. Que
  -- «llegar antes no es demora» y «llegar antes no es gratis» convivan es
  -- justamente lo que separa el desvío de horario del exceso de jornada.
  IF NOT ('extra_sin_autorizar' = ANY(b.hallazgos)) THEN
    RAISE EXCEPTION 'INVARIANTE 4: la media hora de más no se señaló (%)', b.hallazgos;
  END IF;
  IF b.cumple THEN
    RAISE EXCEPTION 'INVARIANTE 4: un día con extra sin autorizar no puede decir que cumple';
  END IF;
  RAISE NOTICE 'OK 4  llegar media hora antes no es demora — y la media hora de más se señala igual';
END $$;

-- ── 5 · La salida temprana respeta su tolerancia ───────────────────────────
DO $$
DECLARE
  b_dentro record;
  b_fuera  record;
BEGIN
  PERFORM set_config('app.uid', 'e0000000-0000-0000-0000-00000000000d', true);
  PERFORM pg_temp.sembrar_dia(CURRENT_DATE - 25, '06:00', '13:57');  -- 3 min: dentro de 5
  PERFORM pg_temp.sembrar_dia(CURRENT_DATE - 24, '06:00', '13:30');  -- 30 min: fuera

  SELECT * INTO b_dentro FROM public.presencia_balance_dia('11111111-0000-0000-0000-000000000001'::uuid, CURRENT_DATE - 25, CURRENT_DATE - 25);
  SELECT * INTO b_fuera  FROM public.presencia_balance_dia('11111111-0000-0000-0000-000000000001'::uuid, CURRENT_DATE - 24, CURRENT_DATE - 24);

  IF b_dentro.minutos_salida_temprana <> 0 THEN
    RAISE EXCEPTION 'INVARIANTE 5: 3 min salió como % de salida temprana', b_dentro.minutos_salida_temprana;
  END IF;
  IF b_fuera.minutos_salida_temprana <> 30 THEN
    RAISE EXCEPTION 'INVARIANTE 5: 30 min salió como %', b_fuera.minutos_salida_temprana;
  END IF;
  IF NOT ('salida_temprana' = ANY(b_fuera.hallazgos)) THEN
    RAISE EXCEPTION 'INVARIANTE 5: no quedó como hallazgo';
  END IF;
  RAISE NOTICE 'OK 5  irse 3 min antes está dentro de la vara; 30 no, y se reporta';
END $$;

-- ── 6 · El exceso de descanso se mide TIPO A TIPO ──────────────────────────
DO $$
DECLARE b record;
BEGIN
  PERFORM set_config('app.uid', 'e0000000-0000-0000-0000-00000000000d', true);
  -- 90 min de almuerzo contra un cupo de 45: 45 de exceso. Si se comparara el
  -- TOTAL contra la suma de cupos (60), el exceso saldría 30 y se le estaría
  -- regalando la refacción que no se tomó.
  PERFORM pg_temp.sembrar_dia(CURRENT_DATE - 23, '06:00', '14:00', 'almuerzo', 90);
  SELECT * INTO b FROM public.presencia_balance_dia('11111111-0000-0000-0000-000000000001'::uuid, CURRENT_DATE - 23, CURRENT_DATE - 23);

  IF b.minutos_exceso_descanso <> 45 THEN
    RAISE EXCEPTION 'INVARIANTE 6: exceso = % (esperado 45; 30 significa que se comparó el total)', b.minutos_exceso_descanso;
  END IF;
  IF NOT ('exceso_descanso' = ANY(b.hallazgos)) THEN RAISE EXCEPTION 'INVARIANTE 6: sin hallazgo'; END IF;
  IF b.cumple THEN RAISE EXCEPTION 'INVARIANTE 6: cumple con 45 min de exceso'; END IF;
  RAISE NOTICE 'OK 6  90 min de almuerzo contra un cupo de 45 son 45 de exceso, no 30';
END $$;

-- ── 7 · Una pausa SIN cupo declarado no inventa exceso ─────────────────────
DO $$
DECLARE b record;
BEGIN
  PERFORM set_config('app.uid', 'e0000000-0000-0000-0000-00000000000d', true);
  -- La jornada no declara cupo de cena. No declarar no es declarar cero: sin
  -- vara para ese tipo, no hay exceso que reportar.
  PERFORM pg_temp.sembrar_dia(CURRENT_DATE - 22, '06:00', '14:00', 'cena', 60);
  SELECT * INTO b FROM public.presencia_balance_dia('11111111-0000-0000-0000-000000000001'::uuid, CURRENT_DATE - 22, CURRENT_DATE - 22);
  IF b.minutos_exceso_descanso <> 0 THEN
    RAISE EXCEPTION 'INVARIANTE 7: sin cupo declarado inventó % de exceso', b.minutos_exceso_descanso;
  END IF;
  RAISE NOTICE 'OK 7  un tipo sin cupo declarado no produce exceso: no declarar no es declarar cero';
END $$;

-- ── 8 · La medianoche, otra vez ────────────────────────────────────────────
DO $$
DECLARE
  v_plant uuid;
  b record;
BEGIN
  PERFORM set_config('app.uid', 'e0000000-0000-0000-0000-00000000000d', true);
  INSERT INTO public.plantillas_horario
    (company_id, project_id, nombre, hora_inicio, hora_fin, minutos_descanso, tolerancia_entrada_min)
  VALUES ('aaaaaaaa-0000-0000-0000-00000000000a', '11111111-0000-0000-0000-000000000001',
          'Nocturna 22-06', '22:00', '06:00', 0, 10)
  RETURNING id INTO v_plant;

  -- Turno que empieza a las 22:00; la persona llega a las 00:30 del día
  -- siguiente: 150 minutos tarde. Con una resta a pelo darían −1290.
  INSERT INTO public.bloques_turno
    (company_id, project_id, personal_id, fecha, plantilla_horario_id, hora_inicio, hora_fin,
     cruza_medianoche, horas_planificadas)
  VALUES ('aaaaaaaa-0000-0000-0000-00000000000a', '11111111-0000-0000-0000-000000000001',
          '9e000000-0000-0000-0000-000000000005', CURRENT_DATE - 21, v_plant, '22:00', '06:00', true, 8);
  INSERT INTO public.presencia_personal
    (company_id, project_id, personal_id, nombre, fecha, hora_entrada, hora_salida, estado)
  VALUES ('aaaaaaaa-0000-0000-0000-00000000000a', '11111111-0000-0000-0000-000000000001',
          '9e000000-0000-0000-0000-000000000005', 'Luz Jardinera', CURRENT_DATE - 21,
          '00:30', '06:00', 'presente');

  SELECT * INTO b FROM public.presencia_balance_dia(
    '11111111-0000-0000-0000-000000000001'::uuid, CURRENT_DATE - 21, CURRENT_DATE - 21)
  WHERE personal_id = '9e000000-0000-0000-0000-000000000005';

  IF b.minutos_tarde <> 150 THEN
    RAISE EXCEPTION 'INVARIANTE 8: la demora nocturna dio % (esperado 150)', b.minutos_tarde;
  END IF;
  RAISE NOTICE 'OK 8  entrar a las 00:30 a un turno de las 22:00 son 150 min tarde, no −1290';
END $$;

-- ── 9 · Sin vara no se juzga ───────────────────────────────────────────────
DO $$
DECLARE b record;
BEGIN
  PERFORM set_config('app.uid', 'e0000000-0000-0000-0000-00000000000d', true);
  -- Día marcado SIN bloque: no hay jornada contra la cual medir.
  PERFORM pg_temp.sembrar_dia(CURRENT_DATE - 20, '09:47', '11:03', NULL, NULL, false);
  SELECT * INTO b FROM public.presencia_balance_dia('11111111-0000-0000-0000-000000000001'::uuid, CURRENT_DATE - 20, CURRENT_DATE - 20);

  IF b.tiene_vara THEN RAISE EXCEPTION 'INVARIANTE 9: se inventó una vara'; END IF;
  IF b.tramo_demora IS NOT NULL THEN RAISE EXCEPTION 'INVARIANTE 9: juzgó la demora sin vara (%)', b.tramo_demora; END IF;
  IF b.cumple THEN RAISE EXCEPTION 'INVARIANTE 9: afirmó que cumple sin nada contra qué medir'; END IF;
  IF NOT ('sin_vara' = ANY(b.hallazgos) AND 'sin_planificar' = ANY(b.hallazgos)) THEN
    RAISE EXCEPTION 'INVARIANTE 9: no lo dijo (%)', b.hallazgos;
  END IF;
  RAISE NOTICE 'OK 9  sin vara no se juzga: lo dice, y no afirma que cumple';
END $$;

-- ── 10 · El día planificado que nadie cubrió aparece ───────────────────────
DO $$
DECLARE b record;
BEGIN
  PERFORM set_config('app.uid', 'e0000000-0000-0000-0000-00000000000d', true);
  INSERT INTO public.bloques_turno
    (company_id, project_id, personal_id, fecha, plantilla_horario_id, hora_inicio, hora_fin, horas_planificadas)
  VALUES ('aaaaaaaa-0000-0000-0000-00000000000a', '11111111-0000-0000-0000-000000000001',
          '9e000000-0000-0000-0000-000000000003', CURRENT_DATE - 19,
          'bbbbbbbb-0000-0000-0000-00000000000d', '06:00', '14:00', 7.25);

  SELECT * INTO b FROM public.presencia_balance_dia('11111111-0000-0000-0000-000000000001'::uuid, CURRENT_DATE - 19, CURRENT_DATE - 19);
  IF b.registro_id IS NOT NULL THEN RAISE EXCEPTION 'INVARIANTE 10: apareció un marcaje que no existe'; END IF;
  IF NOT ('sin_marcaje' = ANY(b.hallazgos)) THEN RAISE EXCEPTION 'INVARIANTE 10: el día sin cubrir no se reporta (%)', b.hallazgos; END IF;
  IF b.horas_planificadas <> 7.25 THEN RAISE EXCEPTION 'INVARIANTE 10: planificadas = %', b.horas_planificadas; END IF;
  RAISE NOTICE 'OK 10 el turno planificado que nadie cubrió sale en el balance, no desaparece';
END $$;

-- ── 11 · La jornada abierta no se juzga como cumplida ──────────────────────
DO $$
DECLARE b record;
BEGIN
  PERFORM set_config('app.uid', 'e0000000-0000-0000-0000-00000000000d', true);
  PERFORM pg_temp.sembrar_dia(CURRENT_DATE - 18, '06:00', NULL);
  SELECT * INTO b FROM public.presencia_balance_dia('11111111-0000-0000-0000-000000000001'::uuid, CURRENT_DATE - 18, CURRENT_DATE - 18);
  IF b.cumple THEN RAISE EXCEPTION 'INVARIANTE 11: una jornada sin cerrar salió como cumplida'; END IF;
  IF NOT ('jornada_abierta' = ANY(b.hallazgos)) THEN RAISE EXCEPTION 'INVARIANTE 11: no se reporta (%)', b.hallazgos; END IF;
  RAISE NOTICE 'OK 11 sin salida no hay jornada que juzgar: se marca abierta, no cumplida';
END $$;

-- ── 12 · La extra sobre la jornada se señala, no se reconoce ───────────────
DO $$
DECLARE b record;
BEGIN
  PERFORM set_config('app.uid', 'e0000000-0000-0000-0000-00000000000d', true);
  PERFORM pg_temp.sembrar_dia(CURRENT_DATE - 17, '06:00', '17:00');  -- 11 h contra 7.25
  SELECT * INTO b FROM public.presencia_balance_dia('11111111-0000-0000-0000-000000000001'::uuid, CURRENT_DATE - 17, CURRENT_DATE - 17);

  IF b.horas_sobre_jornada <> 3.75 THEN
    RAISE EXCEPTION 'INVARIANTE 12: sobre la jornada = % (esperado 3.75)', b.horas_sobre_jornada;
  END IF;
  IF NOT b.extra_requiere_autorizacion THEN RAISE EXCEPTION 'INVARIANTE 12: la vara pedía autorización y no viajó'; END IF;
  IF NOT ('extra_sin_autorizar' = ANY(b.hallazgos)) THEN
    RAISE EXCEPTION 'INVARIANTE 12: no se señala que la extra no está autorizada (%)', b.hallazgos;
  END IF;
  RAISE NOTICE 'OK 12 3.75 h sobre la jornada se SEÑALAN como extra sin autorizar, no se reconocen';
END $$;

-- ── 13 · Lo anulado no se juzga ────────────────────────────────────────────
DO $$
DECLARE
  v_reg uuid;
  b record;
BEGIN
  PERFORM set_config('app.uid', 'e0000000-0000-0000-0000-00000000000d', true);
  v_reg := pg_temp.sembrar_dia(CURRENT_DATE - 16, '08:30', '14:00');  -- 150 min tarde
  PERFORM public.presencia_anular(v_reg, 'Marcó en el condominio equivocado');

  SELECT * INTO b FROM public.presencia_balance_dia('11111111-0000-0000-0000-000000000001'::uuid, CURRENT_DATE - 16, CURRENT_DATE - 16);
  IF b.registro_id IS NOT NULL THEN
    RAISE EXCEPTION 'INVARIANTE 13: el balance juzgó un marcaje anulado';
  END IF;
  IF NOT ('sin_marcaje' = ANY(b.hallazgos)) THEN RAISE EXCEPTION 'INVARIANTE 13: %', b.hallazgos; END IF;
  RAISE NOTICE 'OK 13 un marcaje anulado no se juzga: para el balance ese día no se marcó';
END $$;

-- ── 14 · La ACL ────────────────────────────────────────────────────────────
DO $$
BEGIN
  IF has_function_privilege('anon', 'public.presencia_balance_dia(uuid, date, date)', 'EXECUTE') THEN
    RAISE EXCEPTION 'INVARIANTE 14: anon puede leer el balance';
  END IF;
  IF NOT has_function_privilege('authenticated', 'public.presencia_balance_dia(uuid, date, date)', 'EXECUTE') THEN
    RAISE EXCEPTION 'INVARIANTE 14: authenticated no puede leer el balance';
  END IF;
  -- service_role TAMPOCO, y es deliberado: no hay ningún llamador de backend
  -- —el único es el frontend como authenticated— y una entrada por la que el
  -- control de proyecto no puede decidir nada es superficie que nadie ejerce.
  IF has_function_privilege('service_role', 'public.presencia_balance_dia(uuid, date, date)', 'EXECUTE') THEN
    RAISE EXCEPTION 'INVARIANTE 14: service_role conserva una entrada que se retiró a propósito';
  END IF;
  RAISE NOTICE 'OK 14 anon no, service_role tampoco; authenticated sí, y el permiso lo decide la función';
END $$;

-- ── 15 · Sin permiso del tab no hay balance ────────────────────────────────
DO $$
BEGIN
  -- Marco es guardia: ficha, pero no administra ni presencia ni turnos.
  PERFORM set_config('app.uid', 'e0000000-0000-0000-0000-000000000002', true);
  BEGIN
    PERFORM count(*) FROM public.presencia_balance_dia(
      '11111111-0000-0000-0000-000000000001'::uuid, CURRENT_DATE - 30, CURRENT_DATE);
    RAISE EXCEPTION 'INVARIANTE 15: un guardia leyó el balance de todo el condominio';
  EXCEPTION WHEN sqlstate '42501' THEN
    NULL;
  END;
  RAISE NOTICE 'OK 15 el balance del equipo exige el permiso del tab, no basta con fichar';
END $$;

-- ── 16 · Los cuatro casos del turno nocturno, con fecha y no con corazonada ─
--
-- Turno 22:00–06:00. Las cuatro salidas de abajo son las que la resta de dos
-- `time` no podía separar: 23:00 y 05:00 dan −7 h y −1 h respectivamente, y
-- NINGÚN umbral en horas distingue «se fue a la hora, cruzando el día» de «se
-- fue a mitad del turno». Lo que los separa es la fecha, que ahora está.
DO $$
DECLARE
  v_plant uuid;
  v_pid   uuid := '9e000000-0000-0000-0000-000000000005';
  b       record;
  caso    record;
BEGIN
  PERFORM set_config('app.uid', 'e0000000-0000-0000-0000-00000000000d', true);
  SELECT id INTO v_plant FROM public.plantillas_horario WHERE nombre = 'Nocturna 22-06';

  FOR caso IN
    SELECT * FROM (VALUES
      -- fecha,                     salida,       esperado (min de salida anticipada)
      (CURRENT_DATE - 45, time '23:00', 420),
      (CURRENT_DATE - 44, time '05:00',  60),
      (CURRENT_DATE - 43, time '06:00',   0),
      -- Quedarse una hora de más no es salida anticipada: es cero por ese lado.
      (CURRENT_DATE - 42, time '07:00',   0)
    ) AS t(fecha, salida, esperado)
  LOOP
    INSERT INTO public.bloques_turno
      (company_id, project_id, personal_id, fecha, plantilla_horario_id, hora_inicio, hora_fin,
       cruza_medianoche, horas_planificadas)
    VALUES ('aaaaaaaa-0000-0000-0000-00000000000a', '11111111-0000-0000-0000-000000000001',
            v_pid, caso.fecha, v_plant, '22:00', '06:00', true, 8);
    INSERT INTO public.presencia_personal
      (company_id, project_id, personal_id, nombre, fecha, hora_entrada, hora_salida, estado)
    VALUES ('aaaaaaaa-0000-0000-0000-00000000000a', '11111111-0000-0000-0000-000000000001',
            v_pid, 'Luz Jardinera', caso.fecha, '22:00', caso.salida, 'presente');

    SELECT * INTO b FROM public.presencia_balance_dia(
      '11111111-0000-0000-0000-000000000001'::uuid, caso.fecha, caso.fecha)
    WHERE personal_id = v_pid;

    IF b.minutos_salida_temprana <> caso.esperado THEN
      RAISE EXCEPTION 'INVARIANTE 16: salida % dio % min anticipados (esperado %)',
        caso.salida, b.minutos_salida_temprana, caso.esperado;
    END IF;
    IF b.minutos_tarde <> 0 THEN
      RAISE EXCEPTION 'INVARIANTE 16: entrar a las 22:00 en punto dio % min tarde', b.minutos_tarde;
    END IF;
  END LOOP;
  RAISE NOTICE 'OK 16 nocturno 22–06: salir 23:00 son 420 min antes, 05:00 son 60, 06:00 es 0 y 07:00 no es anticipada';
END $$;

-- ── 17 · El turno partido suma sus bloques y no inventa nada ───────────────
--
-- Dos bloques de 4 h (06–10 y 14–18) y UN marcaje de 06:00 a 18:00. Lo que se
-- puede afirmar: se planificaron 8 h, se entró en hora y se salió en hora. Lo
-- que NO: cuánto de esas 12 h de estadía fue trabajo. El hueco entre las 10:00
-- y las 14:00 no está registrado en ningún lado, así que repartirlo sería
-- inventarlo — y descartar un bloque, que es lo que hacía el primer borrador,
-- producía 8 h de extra y 8 h de salida anticipada, las dos falsas.
DO $$
DECLARE
  v_p1  uuid;
  v_p2  uuid;
  v_pid uuid := '9e000000-0000-0000-0000-000000000004';
  b     record;
BEGIN
  PERFORM set_config('app.uid', 'e0000000-0000-0000-0000-00000000000d', true);

  INSERT INTO public.plantillas_horario
    (company_id, project_id, nombre, hora_inicio, hora_fin, minutos_descanso, tolerancia_entrada_min,
     tolerancia_salida_min, demora_compensable_hasta_min, extra_requiere_autorizacion)
  VALUES ('aaaaaaaa-0000-0000-0000-00000000000a', '11111111-0000-0000-0000-000000000001',
          'Partida manana', '06:00', '10:00', 0, 10, 5, 30, true)
  RETURNING id INTO v_p1;
  INSERT INTO public.plantillas_horario
    (company_id, project_id, nombre, hora_inicio, hora_fin, minutos_descanso, tolerancia_entrada_min,
     tolerancia_salida_min, demora_compensable_hasta_min, extra_requiere_autorizacion)
  VALUES ('aaaaaaaa-0000-0000-0000-00000000000a', '11111111-0000-0000-0000-000000000001',
          'Partida tarde', '14:00', '18:00', 0, 10, 5, 30, true)
  RETURNING id INTO v_p2;

  INSERT INTO public.bloques_turno
    (company_id, project_id, personal_id, fecha, plantilla_horario_id, hora_inicio, hora_fin, horas_planificadas)
  VALUES
    ('aaaaaaaa-0000-0000-0000-00000000000a', '11111111-0000-0000-0000-000000000001',
     v_pid, CURRENT_DATE - 41, v_p1, '06:00', '10:00', 4),
    ('aaaaaaaa-0000-0000-0000-00000000000a', '11111111-0000-0000-0000-000000000001',
     v_pid, CURRENT_DATE - 41, v_p2, '14:00', '18:00', 4);

  INSERT INTO public.presencia_personal
    (company_id, project_id, personal_id, nombre, fecha, hora_entrada, hora_salida, estado)
  VALUES ('aaaaaaaa-0000-0000-0000-00000000000a', '11111111-0000-0000-0000-000000000001',
          v_pid, 'Noe Nocturno', CURRENT_DATE - 41, '06:00', '18:00', 'presente');

  SELECT * INTO b FROM public.presencia_balance_dia(
    '11111111-0000-0000-0000-000000000001'::uuid, CURRENT_DATE - 41, CURRENT_DATE - 41)
  WHERE personal_id = v_pid;

  IF b.bloques <> 2 THEN
    RAISE EXCEPTION 'INVARIANTE 17: el día trajo % bloque(s), se descartó uno', b.bloques;
  END IF;
  IF b.horas_planificadas <> 8 THEN
    RAISE EXCEPTION 'INVARIANTE 17: se planificaron % h y eran 8', b.horas_planificadas;
  END IF;
  IF b.turno_inicio <> time '06:00' OR b.turno_fin <> time '18:00' THEN
    RAISE EXCEPTION 'INVARIANTE 17: la ventana del día quedó %–%', b.turno_inicio, b.turno_fin;
  END IF;
  IF b.minutos_salida_temprana <> 0 THEN
    RAISE EXCEPTION 'INVARIANTE 17: salir a las 18:00 dio % min anticipados — se midió contra el primer bloque',
      b.minutos_salida_temprana;
  END IF;
  IF b.minutos_tarde <> 0 THEN
    RAISE EXCEPTION 'INVARIANTE 17: entrar a las 06:00 dio % min tarde', b.minutos_tarde;
  END IF;
  IF b.horas_sobre_jornada IS NOT NULL THEN
    RAISE EXCEPTION 'INVARIANTE 17: se afirmaron % h sobre la jornada, y el hueco entre bloques no está registrado',
      b.horas_sobre_jornada;
  END IF;
  IF 'extra_sin_autorizar' = ANY(b.hallazgos) THEN
    RAISE EXCEPTION 'INVARIANTE 17: extra inventada en un turno partido';
  END IF;
  IF NOT ('turno_partido' = ANY(b.hallazgos)) THEN
    RAISE EXCEPTION 'INVARIANTE 17: el día partido no se marcó como tal (%)', b.hallazgos;
  END IF;
  IF b.cumple THEN
    RAISE EXCEPTION 'INVARIANTE 17: se afirmó que cumple un día que no se puede juzgar';
  END IF;
  RAISE NOTICE 'OK 17 turno partido: 8 h planificadas, salida contra el ÚLTIMO bloque, y la extra no se inventa';
END $$;

-- ── 17b · Dos bloques con varas distintas no tienen vara del día ───────────
DO $$
DECLARE
  v_p1  uuid;
  v_p3  uuid;
  v_pid uuid := '9e000000-0000-0000-0000-000000000004';
  b     record;
BEGIN
  PERFORM set_config('app.uid', 'e0000000-0000-0000-0000-00000000000d', true);
  SELECT id INTO v_p1 FROM public.plantillas_horario WHERE nombre = 'Partida manana';
  -- Misma forma horaria, OTRA tolerancia: las dos varas del día discrepan.
  INSERT INTO public.plantillas_horario
    (company_id, project_id, nombre, hora_inicio, hora_fin, minutos_descanso, tolerancia_entrada_min,
     tolerancia_salida_min, demora_compensable_hasta_min, extra_requiere_autorizacion)
  VALUES ('aaaaaaaa-0000-0000-0000-00000000000a', '11111111-0000-0000-0000-000000000001',
          'Partida tarde estricta', '14:00', '18:00', 0, 0, 0, 0, false)
  RETURNING id INTO v_p3;

  INSERT INTO public.bloques_turno
    (company_id, project_id, personal_id, fecha, plantilla_horario_id, hora_inicio, hora_fin, horas_planificadas)
  VALUES
    ('aaaaaaaa-0000-0000-0000-00000000000a', '11111111-0000-0000-0000-000000000001',
     v_pid, CURRENT_DATE - 40, v_p1, '06:00', '10:00', 4),
    ('aaaaaaaa-0000-0000-0000-00000000000a', '11111111-0000-0000-0000-000000000001',
     v_pid, CURRENT_DATE - 40, v_p3, '14:00', '18:00', 4);
  INSERT INTO public.presencia_personal
    (company_id, project_id, personal_id, nombre, fecha, hora_entrada, hora_salida, estado)
  VALUES ('aaaaaaaa-0000-0000-0000-00000000000a', '11111111-0000-0000-0000-000000000001',
          v_pid, 'Noe Nocturno', CURRENT_DATE - 40, '06:30', '18:00', 'presente');

  SELECT * INTO b FROM public.presencia_balance_dia(
    '11111111-0000-0000-0000-000000000001'::uuid, CURRENT_DATE - 40, CURRENT_DATE - 40)
  WHERE personal_id = v_pid;

  IF b.tiene_vara THEN
    RAISE EXCEPTION 'INVARIANTE 17b: se eligió una de las dos varas del día';
  END IF;
  IF NOT ('politica_ambigua' = ANY(b.hallazgos)) THEN
    RAISE EXCEPTION 'INVARIANTE 17b: la discrepancia de varas no se dijo (%)', b.hallazgos;
  END IF;
  -- Media hora tarde con una tolerancia de 10 y otra de 0: cuál rige no lo dice
  -- ningún dato, así que no se juzga la demora — pero el minutaje SÍ se informa.
  IF b.tramo_demora IS NOT NULL THEN
    RAISE EXCEPTION 'INVARIANTE 17b: se le puso tramo a una demora sin vara (%)', b.tramo_demora;
  END IF;
  IF b.minutos_tarde <> 30 THEN
    RAISE EXCEPTION 'INVARIANTE 17b: los 30 min tarde se perdieron (%)', b.minutos_tarde;
  END IF;
  IF b.cumple THEN RAISE EXCEPTION 'INVARIANTE 17b: cumple sin vara'; END IF;
  RAISE NOTICE 'OK 17b dos varas distintas en un día no son una vara: se dice, y no se elige';
END $$;

-- ── 18 · `cumple` no puede contradecir a `hallazgos`, nunca ────────────────
--
-- La contradicción concreta que existía: un día con `extra_sin_autorizar`
-- afirmaba `cumple = true`, porque la condición estaba escrita dos veces y sólo
-- se actualizó una. Esta invariante no comprueba ese caso: comprueba la REGLA,
-- sobre TODAS las filas que el sandbox produjo, así que también atrapa al
-- próximo hallazgo que alguien agregue y se olvide de restar.
DO $$
DECLARE
  v_mal int;
  v_fila record;
BEGIN
  PERFORM set_config('app.uid', 'e0000000-0000-0000-0000-00000000000d', true);
  SELECT count(*) INTO v_mal
    FROM public.presencia_balance_dia(
      '11111111-0000-0000-0000-000000000001'::uuid, CURRENT_DATE - 60, CURRENT_DATE) b
   WHERE b.cumple AND cardinality(b.hallazgos) > 0;

  IF v_mal > 0 THEN
    FOR v_fila IN
      SELECT b.fecha, b.nombre, b.hallazgos
        FROM public.presencia_balance_dia(
          '11111111-0000-0000-0000-000000000001'::uuid, CURRENT_DATE - 60, CURRENT_DATE) b
       WHERE b.cumple AND cardinality(b.hallazgos) > 0
    LOOP
      RAISE WARNING 'cumple=true con hallazgos: % % %', v_fila.fecha, v_fila.nombre, v_fila.hallazgos;
    END LOOP;
    RAISE EXCEPTION 'INVARIANTE 18: % día(s) afirman cumplir con hallazgos encima', v_mal;
  END IF;

  -- Y la recíproca: un día sin hallazgos y con todo para juzgar TIENE que
  -- cumplir. Sin esto, «cumple = false siempre» pasaría la prueba de arriba.
  SELECT count(*) INTO v_mal
    FROM public.presencia_balance_dia(
      '11111111-0000-0000-0000-000000000001'::uuid, CURRENT_DATE - 60, CURRENT_DATE) b
   WHERE NOT b.cumple AND cardinality(b.hallazgos) = 0
     AND b.tiene_vara AND b.registro_id IS NOT NULL AND b.hora_salida IS NOT NULL;
  IF v_mal > 0 THEN
    RAISE EXCEPTION 'INVARIANTE 18: % día(s) sin un solo hallazgo dicen no cumplir', v_mal;
  END IF;
  RAISE NOTICE 'OK 18 cumple ⇔ no hay hallazgos: la regla se comprueba sobre todas las filas, no sobre un caso';
END $$;

-- ── 19 · 21:50 en un turno de las 22:00 es llegar TEMPRANO ─────────────────
--
-- El fallo que esto fija: la regla anterior mandaba al día siguiente toda hora
-- menor que la de inicio, así que diez minutos de anticipación se leían como
-- 1 430 minutos de tardanza. La tardanza más grande que el sistema puede
-- producir, sobre alguien que llegó puntual.
DO $$
DECLARE
  v_plant uuid;
  v_pid   uuid := '9e000000-0000-0000-0000-000000000005';
  b       record;
  caso    record;
BEGIN
  PERFORM set_config('app.uid', 'e0000000-0000-0000-0000-00000000000d', true);
  SELECT id INTO v_plant FROM public.plantillas_horario WHERE nombre = 'Nocturna 22-06';

  FOR caso IN
    SELECT * FROM (VALUES
      -- fecha,            entrada,      min tarde esperados
      (CURRENT_DATE - 39, time '21:50',   0),   -- diez minutos ANTES
      (CURRENT_DATE - 38, time '20:30',   0),   -- hora y media antes, aún legible
      (CURRENT_DATE - 37, time '22:00',   0),   -- en punto
      (CURRENT_DATE - 36, time '00:30', 150)    -- dentro de la ventana, tarde
    ) AS t(fecha, entrada, esperado)
  LOOP
    INSERT INTO public.bloques_turno
      (company_id, project_id, personal_id, fecha, plantilla_horario_id, hora_inicio, hora_fin,
       cruza_medianoche, horas_planificadas)
    VALUES ('aaaaaaaa-0000-0000-0000-00000000000a', '11111111-0000-0000-0000-000000000001',
            v_pid, caso.fecha, v_plant, '22:00', '06:00', true, 8);
    INSERT INTO public.presencia_personal
      (company_id, project_id, personal_id, nombre, fecha, hora_entrada, hora_salida, estado)
    VALUES ('aaaaaaaa-0000-0000-0000-00000000000a', '11111111-0000-0000-0000-000000000001',
            v_pid, 'Luz Jardinera', caso.fecha, caso.entrada, '06:00', 'presente');

    SELECT * INTO b FROM public.presencia_balance_dia(
      '11111111-0000-0000-0000-000000000001'::uuid, caso.fecha, caso.fecha)
    WHERE personal_id = v_pid;

    IF b.minutos_tarde <> caso.esperado THEN
      RAISE EXCEPTION 'INVARIANTE 19: entrada % dio % min tarde (esperado %)',
        caso.entrada, b.minutos_tarde, caso.esperado;
    END IF;
    IF 'marcaje_ambiguo' = ANY(b.hallazgos) THEN
      RAISE EXCEPTION 'INVARIANTE 19: entrada % se declaró ambigua y no lo es', caso.entrada;
    END IF;
  END LOOP;
  RAISE NOTICE 'OK 19 nocturno 22–06: 21:50 y 20:30 son llegar antes (0 tarde); 00:30 sigue siendo 150 tarde';
END $$;

-- ── 20 · El marcaje manual que no se puede ubicar se DICE ──────────────────
--
-- Las 14:00 en un turno 22:00–06:00 están a ocho horas del inicio y a ocho del
-- fin: las dos lecturas posibles son igual de malas. No hay respuesta correcta,
-- así que no se da ninguna — y sobre todo no se fabrica una tardanza.
DO $$
DECLARE
  v_plant uuid;
  v_pid   uuid := '9e000000-0000-0000-0000-000000000005';
  b       record;
BEGIN
  PERFORM set_config('app.uid', 'e0000000-0000-0000-0000-00000000000d', true);
  SELECT id INTO v_plant FROM public.plantillas_horario WHERE nombre = 'Nocturna 22-06';

  INSERT INTO public.bloques_turno
    (company_id, project_id, personal_id, fecha, plantilla_horario_id, hora_inicio, hora_fin,
     cruza_medianoche, horas_planificadas)
  VALUES ('aaaaaaaa-0000-0000-0000-00000000000a', '11111111-0000-0000-0000-000000000001',
          v_pid, CURRENT_DATE - 35, v_plant, '22:00', '06:00', true, 8);
  INSERT INTO public.presencia_personal
    (company_id, project_id, personal_id, nombre, fecha, hora_entrada, hora_salida, estado)
  VALUES ('aaaaaaaa-0000-0000-0000-00000000000a', '11111111-0000-0000-0000-000000000001',
          v_pid, 'Luz Jardinera', CURRENT_DATE - 35, '14:00', '06:00', 'presente');

  SELECT * INTO b FROM public.presencia_balance_dia(
    '11111111-0000-0000-0000-000000000001'::uuid, CURRENT_DATE - 35, CURRENT_DATE - 35)
  WHERE personal_id = v_pid;

  IF NOT ('marcaje_ambiguo' = ANY(b.hallazgos)) THEN
    RAISE EXCEPTION 'INVARIANTE 20: las 14:00 se resolvieron a algo (%), y no se puede', b.hallazgos;
  END IF;
  IF b.minutos_tarde <> 0 THEN
    RAISE EXCEPTION 'INVARIANTE 20: se inventaron % minutos de tardanza sobre un marcaje ilegible', b.minutos_tarde;
  END IF;
  IF b.tramo_demora IS NOT NULL THEN
    RAISE EXCEPTION 'INVARIANTE 20: se le puso tramo (%) a una demora que no se pudo medir', b.tramo_demora;
  END IF;
  IF b.cumple THEN RAISE EXCEPTION 'INVARIANTE 20: cumple con un marcaje ilegible'; END IF;
  RAISE NOTICE 'OK 20 un marcaje manual que no se puede ubicar en el día se reporta ambiguo, no se convierte en tardanza';
END $$;

-- ── 21 · Con instante EXACTO no hay nada que resolver ──────────────────────
--
-- `entrada_marcada_en` lo pone el servidor al fichar, así que el día no se
-- deduce: se sabe. Esta invariante entra por el caso que la regla de cercanía
-- NO resolvería —una entrada a las 14:00— y comprueba que con el instante
-- puesto deja de ser ambigua y se mide de verdad.
DO $$
DECLARE
  v_plant uuid;
  v_pid   uuid := '9e000000-0000-0000-0000-000000000005';
  b       record;
BEGIN
  PERFORM set_config('app.uid', 'e0000000-0000-0000-0000-00000000000d', true);
  SELECT id INTO v_plant FROM public.plantillas_horario WHERE nombre = 'Nocturna 22-06';

  INSERT INTO public.bloques_turno
    (company_id, project_id, personal_id, fecha, plantilla_horario_id, hora_inicio, hora_fin,
     cruza_medianoche, horas_planificadas)
  VALUES ('aaaaaaaa-0000-0000-0000-00000000000a', '11111111-0000-0000-0000-000000000001',
          v_pid, CURRENT_DATE - 34, v_plant, '22:00', '06:00', true, 8);
  -- Mismas horas del reloj que la invariante 20, pero con los instantes reales:
  -- entró a las 14:00 del DÍA DEL TURNO, ocho horas antes de las 22:00.
  INSERT INTO public.presencia_personal
    (company_id, project_id, personal_id, nombre, fecha, hora_entrada, hora_salida, estado,
     entrada_marcada_en, salida_marcada_en)
  VALUES ('aaaaaaaa-0000-0000-0000-00000000000a', '11111111-0000-0000-0000-000000000001',
          v_pid, 'Luz Jardinera', CURRENT_DATE - 34, '14:00', '06:00', 'presente',
          ((CURRENT_DATE - 34) + time '14:00') AT TIME ZONE 'America/Guatemala',
          ((CURRENT_DATE - 33) + time '06:00') AT TIME ZONE 'America/Guatemala');

  SELECT * INTO b FROM public.presencia_balance_dia(
    '11111111-0000-0000-0000-000000000001'::uuid, CURRENT_DATE - 34, CURRENT_DATE - 34)
  WHERE personal_id = v_pid;

  IF 'marcaje_ambiguo' = ANY(b.hallazgos) THEN
    RAISE EXCEPTION 'INVARIANTE 21: con instante exacto se declaró ambiguo (%)', b.hallazgos;
  END IF;
  IF b.minutos_tarde <> 0 THEN
    RAISE EXCEPTION 'INVARIANTE 21: entrar ocho horas ANTES dio % min tarde', b.minutos_tarde;
  END IF;
  IF b.minutos_salida_temprana <> 0 THEN
    RAISE EXCEPTION 'INVARIANTE 21: salir a las 06:00 dio % min anticipados', b.minutos_salida_temprana;
  END IF;
  RAISE NOTICE 'OK 21 con entrada_marcada_en el día no se deduce: se sabe, y la ambigüedad desaparece';
END $$;

-- ── 22 · Dos marcajes manuales el mismo día ────────────────────────────────
--
-- `presencia_personal` permite varias filas manuales para la misma persona y
-- fecha, y `calcular_horas_personal` las SUMA. El primer borrador del balance
-- tomaba `DISTINCT ON` y se quedaba con una: el balance y la planilla contaban
-- horas distintas para el mismo día, en silencio.
DO $$
DECLARE
  v_plant uuid;
  v_pid   uuid := '9e000000-0000-0000-0000-000000000003';
  v_fecha date := CURRENT_DATE - 33;
  b       record;
  h       record;
BEGIN
  PERFORM set_config('app.uid', 'e0000000-0000-0000-0000-00000000000d', true);
  SELECT id INTO v_plant FROM public.plantillas_horario WHERE nombre = 'Diurna 6-14';

  INSERT INTO public.bloques_turno
    (company_id, project_id, personal_id, fecha, plantilla_horario_id, hora_inicio, hora_fin, horas_planificadas)
  VALUES ('aaaaaaaa-0000-0000-0000-00000000000a', '11111111-0000-0000-0000-000000000001',
          v_pid, v_fecha, v_plant, '06:00', '14:00', 7.25);

  -- Dos tramos capturados a mano: 06:00–10:00 y 12:00–16:00. Ocho horas de
  -- estadía en total, con un hueco de dos horas que nadie trabajó.
  INSERT INTO public.presencia_personal
    (company_id, project_id, personal_id, nombre, fecha, hora_entrada, hora_salida, estado)
  VALUES
    ('aaaaaaaa-0000-0000-0000-00000000000a', '11111111-0000-0000-0000-000000000001',
     v_pid, 'Ana sin cuenta', v_fecha, '06:00', '10:00', 'presente'),
    ('aaaaaaaa-0000-0000-0000-00000000000a', '11111111-0000-0000-0000-000000000001',
     v_pid, 'Ana sin cuenta', v_fecha, '12:00', '16:00', 'presente');

  SELECT * INTO b FROM public.presencia_balance_dia(
    '11111111-0000-0000-0000-000000000001'::uuid, v_fecha, v_fecha)
  WHERE personal_id = v_pid;

  IF b.registros <> 2 THEN
    RAISE EXCEPTION 'INVARIANTE 22: el día trajo % marcaje(s); se descartó uno', b.registros;
  END IF;
  IF cardinality(b.registro_ids) <> 2 THEN
    RAISE EXCEPTION 'INVARIANTE 22: viajaron % ids y la pantalla necesita los dos', cardinality(b.registro_ids);
  END IF;

  -- LO QUE IMPORTA: el balance y la planilla tienen que decir lo mismo.
  SELECT * INTO h FROM public.calcular_horas_personal(
    '11111111-0000-0000-0000-000000000001'::uuid, v_fecha, v_fecha)
  WHERE personal_id = v_pid;
  IF ROUND(b.horas_estadia, 2) <> ROUND(h.horas_estadia, 2) THEN
    RAISE EXCEPTION 'INVARIANTE 22: el balance dice % h de estadía y la planilla % h',
      b.horas_estadia, h.horas_estadia;
  END IF;
  IF b.horas_estadia <> 8 THEN
    RAISE EXCEPTION 'INVARIANTE 22: 4 h + 4 h dieron % (medir de 06:00 a 16:00 daría 10)', b.horas_estadia;
  END IF;

  IF NOT ('marcajes_multiples' = ANY(b.hallazgos)) THEN
    RAISE EXCEPTION 'INVARIANTE 22: no se dijo que el día tiene varios marcajes (%)', b.hallazgos;
  END IF;
  IF b.horas_sobre_jornada IS NOT NULL THEN
    RAISE EXCEPTION 'INVARIANTE 22: se afirmaron % h de extra sin poder atribuir la presencia',
      b.horas_sobre_jornada;
  END IF;
  IF b.cumple THEN
    RAISE EXCEPTION 'INVARIANTE 22: se afirmó que cumple un día que no se puede juzgar';
  END IF;
  RAISE NOTICE 'OK 22 dos marcajes el mismo día: se SUMAN como en la planilla (8 h), los dos ids viajan, y el día no se juzga';
END $$;

-- ── 22b · Uno de los dos marcajes sigue abierto ────────────────────────────
DO $$
DECLARE
  v_plant uuid;
  v_pid   uuid := '9e000000-0000-0000-0000-000000000003';
  v_fecha date := CURRENT_DATE - 32;
  b       record;
BEGIN
  PERFORM set_config('app.uid', 'e0000000-0000-0000-0000-00000000000d', true);
  SELECT id INTO v_plant FROM public.plantillas_horario WHERE nombre = 'Diurna 6-14';
  INSERT INTO public.bloques_turno
    (company_id, project_id, personal_id, fecha, plantilla_horario_id, hora_inicio, hora_fin, horas_planificadas)
  VALUES ('aaaaaaaa-0000-0000-0000-00000000000a', '11111111-0000-0000-0000-000000000001',
          v_pid, v_fecha, v_plant, '06:00', '14:00', 7.25);
  INSERT INTO public.presencia_personal
    (company_id, project_id, personal_id, nombre, fecha, hora_entrada, hora_salida, estado)
  VALUES
    ('aaaaaaaa-0000-0000-0000-00000000000a', '11111111-0000-0000-0000-000000000001',
     v_pid, 'Ana sin cuenta', v_fecha, '06:00', '10:00', 'presente'),
    ('aaaaaaaa-0000-0000-0000-00000000000a', '11111111-0000-0000-0000-000000000001',
     v_pid, 'Ana sin cuenta', v_fecha, '12:00', NULL, 'presente');

  SELECT * INTO b FROM public.presencia_balance_dia(
    '11111111-0000-0000-0000-000000000001'::uuid, v_fecha, v_fecha)
  WHERE personal_id = v_pid;

  -- Mirar sólo el último marcaje daría el día por cerrado. Basta UNO abierto.
  IF NOT ('jornada_abierta' = ANY(b.hallazgos)) THEN
    RAISE EXCEPTION 'INVARIANTE 22b: con un marcaje sin salida el día se dio por cerrado (%)', b.hallazgos;
  END IF;
  IF b.cumple THEN RAISE EXCEPTION 'INVARIANTE 22b: cumple con una jornada abierta'; END IF;
  RAISE NOTICE 'OK 22b un solo marcaje sin salida deja el día abierto, aunque otro ya haya cerrado';
END $$;

-- ── 23 · La empresa no es el alcance: el proyecto también se comprueba ──────
--
-- Esta es la invariante que descubre el agujero, y por eso los cuatro casos van
-- juntos: separados, cada uno pasaría por razones distintas y ninguno probaría
-- la regla.
--
-- Sandra y «Sin Ficha» tienen EXACTAMENTE el mismo permiso del tab y son de la
-- MISMA empresa. Lo único que los distingue es el condominio. Si el balance sólo
-- mirara `assert_company_scope` —que era el caso—, los dos leerían los dos
-- condominios con sólo cambiar el uuid del argumento, y la función es SECURITY
-- DEFINER, así que ninguna policy estaría ahí para impedirlo.
--
-- Todo se ejerce COMO `authenticated`, que es el rol con el que llega el
-- frontend. Ejercerlo como el dueño de la función mediría otra cosa.
DO $$
DECLARE v_n int;
BEGIN
  -- (a) El supervisor del condominio 1 lee el condominio 1. Sin esto, las tres
  --     negaciones de abajo podrían estar pasando porque la función niega
  --     SIEMPRE, que es la forma más fácil de fingir que un control funciona.
  PERFORM set_config('app.uid', 'e0000000-0000-0000-0000-000000000003', true);
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO v_n FROM public.presencia_balance_dia(
    '11111111-0000-0000-0000-000000000001'::uuid, CURRENT_DATE - 30, CURRENT_DATE);
  RESET ROLE;
  IF v_n = 0 THEN
    RAISE EXCEPTION 'INVARIANTE 23a: el supervisor no vio NADA de su propio condominio';
  END IF;

  -- (b) El mismo usuario, el mismo permiso, la misma empresa, otro condominio.
  PERFORM set_config('app.uid', 'e0000000-0000-0000-0000-000000000003', true);
  SET LOCAL ROLE authenticated;
  BEGIN
    PERFORM count(*) FROM public.presencia_balance_dia(
      '11111111-0000-0000-0000-000000000002'::uuid, CURRENT_DATE - 30, CURRENT_DATE);
    RESET ROLE;
    RAISE EXCEPTION 'INVARIANTE 23b: leyó el balance de un condominio que no administra';
  EXCEPTION WHEN sqlstate '42501' THEN
    RESET ROLE;
  END;

  -- Y el simétrico, para que no se lea como «el condominio 2 no se puede leer»:
  -- Sandra sí lo lee, porque es el suyo.
  PERFORM set_config('app.uid', 'e0000000-0000-0000-0000-000000000006', true);
  SET LOCAL ROLE authenticated;
  PERFORM count(*) FROM public.presencia_balance_dia(
    '11111111-0000-0000-0000-000000000002'::uuid, CURRENT_DATE - 30, CURRENT_DATE);
  RESET ROLE;

  -- (c) Otra empresa. Lo cubría `assert_company_scope` y tiene que seguir
  --     cubriéndolo: agregar una puerta no puede aflojar la anterior.
  PERFORM set_config('app.uid', 'e0000000-0000-0000-0000-000000000003', true);
  SET LOCAL ROLE authenticated;
  BEGIN
    PERFORM count(*) FROM public.presencia_balance_dia(
      '22222222-0000-0000-0000-000000000001'::uuid, CURRENT_DATE - 30, CURRENT_DATE);
    RESET ROLE;
    RAISE EXCEPTION 'INVARIANTE 23c: leyó el balance de otra empresa';
  EXCEPTION WHEN sqlstate '42501' THEN
    RESET ROLE;
  END;

  -- (d) super_admin conserva lo previsto: los dos condominios de la empresa A
  --     —incluido el que no es «suyo», porque no tiene ninguno— y también el de
  --     la empresa B. Susana no tiene NINGÚN permiso de tab: si pasa, pasa por
  --     `is_super_admin()`, que es justo lo que hay que conservar.
  PERFORM set_config('app.uid', 'e0000000-0000-0000-0000-000000000007', true);
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO v_n FROM public.presencia_balance_dia(
    '11111111-0000-0000-0000-000000000001'::uuid, CURRENT_DATE - 30, CURRENT_DATE);
  PERFORM count(*) FROM public.presencia_balance_dia(
    '11111111-0000-0000-0000-000000000002'::uuid, CURRENT_DATE - 30, CURRENT_DATE);
  PERFORM count(*) FROM public.presencia_balance_dia(
    '22222222-0000-0000-0000-000000000001'::uuid, CURRENT_DATE - 30, CURRENT_DATE);
  RESET ROLE;
  IF v_n = 0 THEN
    RAISE EXCEPTION 'INVARIANTE 23d: super_admin dejó de ver el balance';
  END IF;

  RAISE NOTICE 'OK 23 mismo permiso y misma empresa no alcanzan: el condominio ajeno se niega con 42501, y super_admin sigue pasando';
END $$;

-- ── 24 · Un proyecto inexistente no se confunde con uno ajeno ───────────────
-- 42704 y no 42501, para que quien depure sepa si el uuid está mal o si el
-- permiso falta. Y sobre todo: NULL no puede colarse. `can_access_project`
-- devuelve `true` ante NULL a propósito —fila ambigua, no ajena— y si esa
-- puerta quedara alcanzable aquí, pasar NULL sería la forma de saltarse el
-- control que acaba de agregarse.
DO $$
BEGIN
  PERFORM set_config('app.uid', 'e0000000-0000-0000-0000-000000000003', true);
  SET LOCAL ROLE authenticated;
  BEGIN
    PERFORM count(*) FROM public.presencia_balance_dia(
      NULL::uuid, CURRENT_DATE - 30, CURRENT_DATE);
    RESET ROLE;
    RAISE EXCEPTION 'INVARIANTE 24: un proyecto NULL atravesó el control de alcance';
  EXCEPTION WHEN sqlstate '42704' THEN
    RESET ROLE;
  END;
  RAISE NOTICE 'OK 24 sin proyecto no hay balance: 42704, y NULL no es una puerta';
END $$;
