-- ════════════════════════════════════════════════════════════════════════════
-- Invariantes de 20260909000100 · el balance del día (Fase 2)
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
  INSERT INTO public.plantilla_cupos_pausa (company_id, plantilla_horario_id, tipo, minutos) VALUES
    ('aaaaaaaa-0000-0000-0000-00000000000a', v_plant, 'almuerzo', 45),
    ('aaaaaaaa-0000-0000-0000-00000000000a', v_plant, 'refaccion', 15);
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
  IF NOT b.cumple THEN RAISE EXCEPTION 'INVARIANTE 4: llegar antes lo dejó en incumplimiento (%)', b.hallazgos; END IF;
  RAISE NOTICE 'OK 4  llegar media hora antes no es una demora negativa: es cero';
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
    (company_id, project_id, personal_id, fecha, plantilla_horario_id, hora_inicio, hora_fin, horas_planificadas)
  VALUES ('aaaaaaaa-0000-0000-0000-00000000000a', '11111111-0000-0000-0000-000000000001',
          '9e000000-0000-0000-0000-000000000005', CURRENT_DATE - 21, v_plant, '22:00', '06:00', 8);
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
  RAISE NOTICE 'OK 14 anon no; authenticated sí, y el permiso lo decide la función';
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
