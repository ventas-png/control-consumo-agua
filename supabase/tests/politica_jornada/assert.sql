-- ════════════════════════════════════════════════════════════════════════════
-- Invariantes de 20260909000000 · la vara de la jornada (Fase 1)
-- ════════════════════════════════════════════════════════════════════════════
-- La más importante es la 1: que declarar la vara NO cambie ni un número del
-- cómputo de horas. Todo lo demás de esta migración es inerte por diseño, y una
-- migración inerte que mueve la planilla es exactamente el fallo que no se ve.
\set ON_ERROR_STOP on

-- ── 1 · Declarar la vara NO mueve la planilla ──────────────────────────────
DO $$
DECLARE
  v_plant uuid;
  v_reg   uuid;
  h_antes record;
  h_despues record;
BEGIN
  PERFORM set_config('app.uid', 'e0000000-0000-0000-0000-00000000000d', true);

  -- Una jornada de 8 h con 30 min de descanso, y un día trabajado de 06 a 14.
  INSERT INTO public.plantillas_horario
    (company_id, project_id, nombre, hora_inicio, hora_fin, minutos_descanso, tolerancia_entrada_min)
  VALUES ('aaaaaaaa-0000-0000-0000-00000000000a', '11111111-0000-0000-0000-000000000001',
          'Diurna 6-14', '06:00', '14:00', 30, 10)
  RETURNING id INTO v_plant;

  INSERT INTO public.bloques_turno
    (company_id, project_id, personal_id, fecha, plantilla_horario_id, hora_inicio, hora_fin, horas_planificadas)
  VALUES ('aaaaaaaa-0000-0000-0000-00000000000a', '11111111-0000-0000-0000-000000000001',
          '9e000000-0000-0000-0000-000000000003', CURRENT_DATE - 20, v_plant, '06:00', '14:00', 7.5);

  INSERT INTO public.presencia_personal
    (company_id, project_id, personal_id, nombre, fecha, hora_entrada, hora_salida, estado)
  VALUES ('aaaaaaaa-0000-0000-0000-00000000000a', '11111111-0000-0000-0000-000000000001',
          '9e000000-0000-0000-0000-000000000003', 'Ana sin cuenta', CURRENT_DATE - 20,
          '06:00', '14:00', 'presente')
  RETURNING id INTO v_reg;

  SELECT * INTO h_antes FROM public.calcular_horas_personal(
    '11111111-0000-0000-0000-000000000001'::uuid, CURRENT_DATE - 20, CURRENT_DATE - 20)
  WHERE personal_id = '9e000000-0000-0000-0000-000000000003';

  -- Se declara la vara ENTERA: tolerancias, tramo compensable, autorización y
  -- cupos por tipo. Es todo lo que esta migración permite decir.
  UPDATE public.plantillas_horario
     SET tolerancia_salida_min = 5,
         demora_compensable_hasta_min = 30,
         extra_requiere_autorizacion = true
   WHERE id = v_plant;

  INSERT INTO public.plantilla_cupos_pausa (company_id, plantilla_horario_id, tipo, minutos) VALUES
    ('aaaaaaaa-0000-0000-0000-00000000000a', v_plant, 'almuerzo', 45),
    ('aaaaaaaa-0000-0000-0000-00000000000a', v_plant, 'refaccion', 15);

  SELECT * INTO h_despues FROM public.calcular_horas_personal(
    '11111111-0000-0000-0000-000000000001'::uuid, CURRENT_DATE - 20, CURRENT_DATE - 20)
  WHERE personal_id = '9e000000-0000-0000-0000-000000000003';

  IF h_antes IS DISTINCT FROM h_despues THEN
    RAISE EXCEPTION 'INVARIANTE 1: declarar la vara movió el cómputo (antes % / después %)',
      h_antes, h_despues;
  END IF;
  RAISE NOTICE 'OK 1  declarar la vara no mueve NI UN número del cómputo (planificadas %, trabajadas %)',
    h_despues.horas_planificadas, h_despues.horas_trabajadas;
END $$;

-- ── 2 · El bloque congela la vara al materializarse ────────────────────────
DO $$
DECLARE
  v_plant uuid;
  v_pol   jsonb;
BEGIN
  SELECT id INTO v_plant FROM public.plantillas_horario WHERE nombre = 'Diurna 6-14';

  INSERT INTO public.bloques_turno
    (company_id, project_id, personal_id, fecha, plantilla_horario_id, hora_inicio, hora_fin, horas_planificadas)
  VALUES ('aaaaaaaa-0000-0000-0000-00000000000a', '11111111-0000-0000-0000-000000000001',
          '9e000000-0000-0000-0000-000000000003', CURRENT_DATE - 10, v_plant, '06:00', '14:00', 7.5)
  RETURNING politica INTO v_pol;

  IF v_pol IS NULL THEN RAISE EXCEPTION 'INVARIANTE 2: el bloque nació sin vara'; END IF;
  IF (v_pol->>'tolerancia_entrada_min')::int <> 10 THEN
    RAISE EXCEPTION 'INVARIANTE 2: tolerancia de entrada = %', v_pol->>'tolerancia_entrada_min';
  END IF;
  IF (v_pol->>'demora_compensable_hasta_min')::int <> 30 THEN
    RAISE EXCEPTION 'INVARIANTE 2: tramo compensable = %', v_pol->>'demora_compensable_hasta_min';
  END IF;
  IF (v_pol->>'extra_requiere_autorizacion')::boolean IS NOT true THEN
    RAISE EXCEPTION 'INVARIANTE 2: la autorización de extra no viajó';
  END IF;
  IF (v_pol->'cupos'->>'almuerzo')::int <> 45 OR (v_pol->'cupos'->>'refaccion')::int <> 15 THEN
    RAISE EXCEPTION 'INVARIANTE 2: los cupos no viajaron (%)', v_pol->'cupos';
  END IF;
  RAISE NOTICE 'OK 2  el bloque congela los tres tramos, la autorización y los cupos por tipo';
END $$;

-- ── 3 · Cambiar la jornada NO reescribe el bloque ya materializado ─────────
DO $$
DECLARE
  v_plant uuid;
  v_pol   jsonb;
BEGIN
  SELECT id INTO v_plant FROM public.plantillas_horario WHERE nombre = 'Diurna 6-14';

  UPDATE public.plantillas_horario SET tolerancia_entrada_min = 20 WHERE id = v_plant;
  UPDATE public.plantilla_cupos_pausa SET minutos = 90
   WHERE plantilla_horario_id = v_plant AND tipo = 'almuerzo';

  SELECT politica INTO v_pol FROM public.bloques_turno
   WHERE plantilla_horario_id = v_plant AND fecha = CURRENT_DATE - 10;

  IF (v_pol->>'tolerancia_entrada_min')::int <> 10 THEN
    RAISE EXCEPTION 'INVARIANTE 3: cambiar la jornada reescribió la tolerancia del bloque viejo (%)',
      v_pol->>'tolerancia_entrada_min';
  END IF;
  IF (v_pol->'cupos'->>'almuerzo')::int <> 45 THEN
    RAISE EXCEPTION 'INVARIANTE 3: cambiar el cupo reescribió el bloque viejo (%)', v_pol->'cupos';
  END IF;
  RAISE NOTICE 'OK 3  cambiar la jornada NO reescribe contra qué se midió un día ya planificado';
END $$;

-- ── 4 · …pero un bloque NUEVO sí nace con la vara nueva ────────────────────
DO $$
DECLARE
  v_plant uuid;
  v_pol   jsonb;
BEGIN
  SELECT id INTO v_plant FROM public.plantillas_horario WHERE nombre = 'Diurna 6-14';
  INSERT INTO public.bloques_turno
    (company_id, project_id, personal_id, fecha, plantilla_horario_id, hora_inicio, hora_fin, horas_planificadas)
  VALUES ('aaaaaaaa-0000-0000-0000-00000000000a', '11111111-0000-0000-0000-000000000001',
          '9e000000-0000-0000-0000-000000000003', CURRENT_DATE + 3, v_plant, '06:00', '14:00', 7.5)
  RETURNING politica INTO v_pol;

  IF (v_pol->>'tolerancia_entrada_min')::int <> 20 OR (v_pol->'cupos'->>'almuerzo')::int <> 90 THEN
    RAISE EXCEPTION 'INVARIANTE 4: el bloque nuevo no tomó la vara vigente (%)', v_pol;
  END IF;
  RAISE NOTICE 'OK 4  la vara vale hacia adelante: el bloque nuevo nace con la vigente';
END $$;

-- ── 5 · Un UPDATE cualquiera del bloque no refresca la foto ────────────────
DO $$
DECLARE v_pol jsonb;
BEGIN
  -- Cerrar el turno es el UPDATE más común de esta tabla.
  UPDATE public.bloques_turno
     SET estado = 'cerrado', notas = 'turno cerrado sin novedad'
   WHERE fecha = CURRENT_DATE - 10;

  SELECT politica INTO v_pol FROM public.bloques_turno WHERE fecha = CURRENT_DATE - 10;
  IF (v_pol->>'tolerancia_entrada_min')::int <> 10 THEN
    RAISE EXCEPTION 'INVARIANTE 5: un UPDATE cualquiera refrescó la foto (%)', v_pol;
  END IF;
  RAISE NOTICE 'OK 5  cerrar el turno o corregir una nota no refresca la vara congelada';
END $$;

-- ── 6 · Cambiar el bloque DE jornada sí refresca la foto ───────────────────
DO $$
DECLARE
  v_otra uuid;
  v_pol  jsonb;
BEGIN
  PERFORM set_config('app.uid', 'e0000000-0000-0000-0000-00000000000d', true);
  INSERT INTO public.plantillas_horario
    (company_id, project_id, nombre, hora_inicio, hora_fin, minutos_descanso, tolerancia_entrada_min)
  VALUES ('aaaaaaaa-0000-0000-0000-00000000000a', '11111111-0000-0000-0000-000000000001',
          'Nocturna 18-06', '18:00', '06:00', 60, 20)
  RETURNING id INTO v_otra;
  INSERT INTO public.plantilla_cupos_pausa (company_id, plantilla_horario_id, tipo, minutos)
  VALUES ('aaaaaaaa-0000-0000-0000-00000000000a', v_otra, 'cena', 40);

  UPDATE public.bloques_turno SET plantilla_horario_id = v_otra WHERE fecha = CURRENT_DATE - 10;

  SELECT politica INTO v_pol FROM public.bloques_turno WHERE fecha = CURRENT_DATE - 10;
  IF (v_pol->>'tolerancia_entrada_min')::int <> 20 OR (v_pol->'cupos'->>'cena')::int <> 40 THEN
    RAISE EXCEPTION 'INVARIANTE 6: cambiar de jornada no refrescó la vara (%)', v_pol;
  END IF;
  RAISE NOTICE 'OK 6  mover el bloque a OTRA jornada sí toma la vara de esa jornada';
END $$;

-- ── 7 · Un bloque sin jornada no tiene vara, y lo dice con NULL ────────────
DO $$
DECLARE v_pol jsonb;
BEGIN
  INSERT INTO public.bloques_turno
    (company_id, project_id, personal_id, fecha, hora_inicio, hora_fin, horas_planificadas)
  VALUES ('aaaaaaaa-0000-0000-0000-00000000000a', '11111111-0000-0000-0000-000000000001',
          '9e000000-0000-0000-0000-000000000003', CURRENT_DATE + 5, '06:00', '14:00', 8)
  RETURNING politica INTO v_pol;

  IF v_pol IS NOT NULL THEN
    RAISE EXCEPTION 'INVARIANTE 7: un bloque sin jornada se inventó una vara (%)', v_pol;
  END IF;
  RAISE NOTICE 'OK 7  sin jornada no hay vara: NULL, no una inventada';
END $$;

-- ── 8 · Los bloques viejos siguen sin vara: no se rellena hacia atrás ──────
DO $$
DECLARE v_n int;
BEGIN
  -- El de la invariante 1 se creó ANTES de declarar la vara y con la plantilla
  -- ya existente: su foto es la de entonces, no la de ahora.
  SELECT count(*) INTO v_n FROM public.bloques_turno
   WHERE fecha = CURRENT_DATE - 20
     AND COALESCE((politica->>'demora_compensable_hasta_min')::int, 0) <> 0;
  IF v_n <> 0 THEN
    RAISE EXCEPTION 'INVARIANTE 8: se rellenó hacia atrás la vara de un bloque viejo';
  END IF;
  RAISE NOTICE 'OK 8  lo planificado antes de la vara se queda sin vara, que es la verdad';
END $$;

-- ── 9 · Los tres tramos de la demora quedan expresables ────────────────────
DO $$
DECLARE
  v_pol  jsonb;
  v_tol  int;
  v_comp int;
BEGIN
  SELECT politica INTO v_pol FROM public.bloques_turno WHERE fecha = CURRENT_DATE + 3;
  v_tol  := (v_pol->>'tolerancia_entrada_min')::int;
  v_comp := (v_pol->>'demora_compensable_hasta_min')::int;

  -- El primer tramo es la tolerancia que YA usaba presencia_marcar: la vara no
  -- inventó un segundo umbral de gracia que pudiera divergir del primero.
  IF v_tol IS NULL OR v_comp IS NULL THEN
    RAISE EXCEPTION 'INVARIANTE 9: falta uno de los dos umbrales';
  END IF;
  IF v_comp <> 0 AND v_comp <= v_tol THEN
    RAISE EXCEPTION 'INVARIANTE 9: el tramo compensable (%) no deja lugar tras la tolerancia (%)', v_comp, v_tol;
  END IF;
  RAISE NOTICE 'OK 9  los tres tramos quedan dichos: hasta % nada, hasta % se compensa, más allá se debita', v_tol, v_comp;
END $$;

-- ── 9b · Los tramos no se pueden declarar al revés ─────────────────────────
DO $$
DECLARE v_plant uuid;
BEGIN
  SELECT id INTO v_plant FROM public.plantillas_horario WHERE nombre = 'Diurna 6-14';
  PERFORM set_config('app.uid', 'e0000000-0000-0000-0000-00000000000d', true);
  BEGIN
    -- Tolerancia 45 con tope compensable 30: el segundo tramo quedaría vacío y
    -- la política C se volvería «todo se debita» sin que nadie lo decidiera.
    UPDATE public.plantillas_horario SET tolerancia_entrada_min = 45 WHERE id = v_plant;
    RAISE EXCEPTION 'INVARIANTE 9b: se aceptó un tramo compensable por debajo de la tolerancia';
  EXCEPTION WHEN check_violation THEN
    NULL;
  END;
  RAISE NOTICE 'OK 9b un tope compensable por debajo de la tolerancia se rechaza: vaciaría el tramo';
END $$;

-- ── 10 · La vara no se puede escribir desde el cliente ─────────────────────
DO $$
DECLARE
  v_plant uuid;
  v_pol   jsonb;
BEGIN
  SELECT id INTO v_plant FROM public.plantillas_horario WHERE nombre = 'Diurna 6-14';
  -- Se manda una política inventada en el INSERT: el trigger la descarta.
  INSERT INTO public.bloques_turno
    (company_id, project_id, personal_id, fecha, plantilla_horario_id,
     hora_inicio, hora_fin, horas_planificadas, politica)
  VALUES ('aaaaaaaa-0000-0000-0000-00000000000a', '11111111-0000-0000-0000-000000000001',
          '9e000000-0000-0000-0000-000000000003', CURRENT_DATE + 7, v_plant,
          '06:00', '14:00', 7.5,
          '{"tolerancia_entrada_min": 999, "cupos": {"almuerzo": 999}}'::jsonb)
  RETURNING politica INTO v_pol;

  IF (v_pol->>'tolerancia_entrada_min')::int = 999 OR (v_pol->'cupos'->>'almuerzo')::int = 999 THEN
    RAISE EXCEPTION 'INVARIANTE 10: el cliente escribió la vara (%)', v_pol;
  END IF;
  RAISE NOTICE 'OK 10 la vara es derivada: lo que manda el cliente se ignora';
END $$;

-- ── 11 · Los cupos los gobierna el permiso del tab de TURNOS ───────────────
DO $$
DECLARE v_plant uuid;
BEGIN
  SELECT id INTO v_plant FROM public.plantillas_horario WHERE nombre = 'Diurna 6-14';

  -- Marco es guardia: ficha, pero no administra turnos ni presencia.
  PERFORM set_config('app.uid', 'e0000000-0000-0000-0000-000000000002', true);
  SET LOCAL ROLE authenticated;
  BEGIN
    INSERT INTO public.plantilla_cupos_pausa (company_id, plantilla_horario_id, tipo, minutos)
    VALUES ('aaaaaaaa-0000-0000-0000-00000000000a', v_plant, 'descanso', 120);
    RESET ROLE;
    RAISE EXCEPTION 'INVARIANTE 11: un guardia se puso su propio cupo';
  EXCEPTION WHEN insufficient_privilege THEN
    RESET ROLE;
  END;

  IF EXISTS (
    SELECT 1 FROM public.plantilla_cupos_pausa
    WHERE plantilla_horario_id = v_plant AND tipo = 'descanso'
  ) THEN
    RAISE EXCEPTION 'INVARIANTE 11: el cupo se escribió igual';
  END IF;
  RAISE NOTICE 'OK 11 quien solo ficha no puede fijarse su propio cupo de descanso';
END $$;

-- ── 12 · Quien administra turnos sí puede ──────────────────────────────────
DO $$
DECLARE v_plant uuid;
BEGIN
  SELECT id INTO v_plant FROM public.plantillas_horario WHERE nombre = 'Nocturna 18-06';
  PERFORM set_config('app.uid', 'e0000000-0000-0000-0000-000000000003', true);
  SET LOCAL ROLE authenticated;
  INSERT INTO public.plantilla_cupos_pausa (company_id, plantilla_horario_id, tipo, minutos)
  VALUES ('aaaaaaaa-0000-0000-0000-00000000000a', v_plant, 'refaccion', 20);
  RESET ROLE;
  RAISE NOTICE 'OK 12 con condominios.tab.turnos se administran los cupos de la jornada';
END $$;

-- ── 13 · La ACL de las funciones internas ──────────────────────────────────
DO $$
BEGIN
  IF has_function_privilege('authenticated', 'public.turnos_politica_efectiva(uuid)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.turnos_politica_efectiva(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'INVARIANTE 13: turnos_politica_efectiva quedó expuesta';
  END IF;
  IF has_function_privilege('anon', 'public.turnos_sellar_politica()', 'EXECUTE') THEN
    RAISE EXCEPTION 'INVARIANTE 13: el trigger de sellado quedó expuesto a anon';
  END IF;
  RAISE NOTICE 'OK 13 las funciones internas no se le conceden a nadie: sus llamadores son triggers';
END $$;

-- ── 14 · El cupo deja rastro en la bitácora ────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.bitacora_acciones WHERE tabla = 'plantilla_cupos_pausa') THEN
    RAISE EXCEPTION 'INVARIANTE 14: los cupos no quedaron inscritos en la bitácora';
  END IF;
  RAISE NOTICE 'OK 14 cambiar lo que se le exige a la gente deja rastro';
END $$;
