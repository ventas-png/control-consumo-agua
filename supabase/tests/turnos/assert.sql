\set ON_ERROR_STOP on
\pset tuples_only on
\pset format unaligned

-- Invariantes del control de asignación de turnos
-- (20260820000000 · 000100 · 000200 · 000300).
-- Cada bloque RAISE EXCEPTION si algo no se cumple.

DO $$
DECLARE
  ADMIN_A  uuid := 'e0000000-0000-0000-0000-00000000000a';
  GUARDIA  uuid := 'e0000000-0000-0000-0000-00000000000b';
  VECINA   uuid := 'e0000000-0000-0000-0000-00000000000c';
  CO       uuid := 'aaaaaaaa-0000-0000-0000-000000000001';
  PR       uuid := '11111111-0000-0000-0000-000000000001';
  PR_AJENO uuid := '11111111-0000-0000-0000-000000000002';
  PEDRO    uuid := '50000000-0000-0000-0000-000000000001';
  LUCIA    uuid := '50000000-0000-0000-0000-000000000002';
  MARIO    uuid := '50000000-0000-0000-0000-000000000003';
  ROL_TURNOS uuid := 'cccccccc-0000-0000-0000-000000000001';
  v_noct   uuid;
  v_diurno uuid;
  v_regla  uuid;
  v_aus    uuid;
  v_bloque uuid;
  n        bigint;
  num      numeric;
  t        text;
  r        record;
BEGIN
  PERFORM set_config('app.uid', ADMIN_A::text, false);

  -- ══ A. Aritmética de la jornada ═══════════════════════════════════════════

  -- ── 1. El turno nocturno deja de desaparecer ─────────────────────────────
  -- Es EL bug de PresenciaPersonalTab.tsx:167-174: 22:00→06:00 daba -960
  -- minutos y la UI lo escondía. Todo el turno de noche estaba sin contabilizar.
  num := public.turnos_horas_jornada(TIME '22:00', TIME '06:00', true, 0);
  IF num IS DISTINCT FROM 8.00 THEN
    RAISE EXCEPTION '1: 22:00→06:00 dio % h (esperado 8)', num; END IF;
  RAISE NOTICE 'OK 1  el turno que cruza medianoche cuenta 8 h, no negativo';

  -- ── 2. …aunque nadie marque la bandera de cruce ──────────────────────────
  num := public.turnos_horas_jornada(TIME '22:00', TIME '06:00', false, 0);
  IF num IS DISTINCT FROM 8.00 THEN
    RAISE EXCEPTION '2: sin bandera dio % h (esperado 8)', num; END IF;
  RAISE NOTICE 'OK 2  fin <= inicio se interpreta como cruce, sin depender del flag';

  -- ── 3. El descanso se descuenta ──────────────────────────────────────────
  num := public.turnos_horas_jornada(TIME '08:00', TIME '17:00', false, 60);
  IF num IS DISTINCT FROM 8.00 THEN
    RAISE EXCEPTION '3: 08:00→17:00 con 60 min de descanso dio % h', num; END IF;
  RAISE NOTICE 'OK 3  el descanso se descuenta de la jornada';

  -- ── 4. Franja nocturna 20:00–06:00 ───────────────────────────────────────
  num := public.turnos_horas_nocturnas(TIME '22:00', TIME '06:00', true);
  IF num IS DISTINCT FROM 8.00 THEN
    RAISE EXCEPTION '4a: 22:00→06:00 dio % h nocturnas (esperado 8)', num; END IF;
  num := public.turnos_horas_nocturnas(TIME '08:00', TIME '16:00', false);
  IF num IS DISTINCT FROM 0.00 THEN
    RAISE EXCEPTION '4b: 08:00→16:00 dio % h nocturnas (esperado 0)', num; END IF;
  num := public.turnos_horas_nocturnas(TIME '18:00', TIME '23:00', false);
  IF num IS DISTINCT FROM 3.00 THEN
    RAISE EXCEPTION '4c: 18:00→23:00 dio % h nocturnas (esperado 3)', num; END IF;
  RAISE NOTICE 'OK 4  la franja nocturna 20:00–06:00 se mide bien en los 3 casos';

  -- ── 5. horas_jornada la sella la BD, no el cliente ───────────────────────
  INSERT INTO public.plantillas_horario
    (id, company_id, project_id, nombre, codigo, turno, hora_inicio, hora_fin,
     cruza_medianoche, minutos_descanso, horas_jornada)
  VALUES
    ('60000000-0000-0000-0000-000000000001', CO, PR, 'Nocturno', 'N', 'noche',
     TIME '22:00', TIME '06:00', true, 0, 999)
  RETURNING id INTO v_noct;
  SELECT horas_jornada INTO num FROM public.plantillas_horario WHERE id = v_noct;
  IF num IS DISTINCT FROM 8.00 THEN
    RAISE EXCEPTION '5: el cliente logró sellar % h (debía calcularse 8)', num; END IF;
  RAISE NOTICE 'OK 5  horas_jornada es derivada: lo que manda el cliente se ignora';

  INSERT INTO public.plantillas_horario
    (id, company_id, project_id, nombre, codigo, turno, hora_inicio, hora_fin, minutos_descanso)
  VALUES
    ('60000000-0000-0000-0000-000000000002', CO, PR, 'Diurno', 'D', 'manana',
     TIME '06:00', TIME '14:00', 0)
  RETURNING id INTO v_diurno;

  -- ══ B. Las once periodicidades ════════════════════════════════════════════
  -- 2026-09-01 es martes; 2026-09-07 lunes.

  -- ── 6. diaria con intervalo ──────────────────────────────────────────────
  IF NOT public.turnos_regla_aplica('diaria', DATE '2026-09-01', '[]', 2, NULL, NULL, '[]', DATE '2026-09-03') THEN
    RAISE EXCEPTION '6a: día sí/día no debía caer el 3'; END IF;
  IF public.turnos_regla_aplica('diaria', DATE '2026-09-01', '[]', 2, NULL, NULL, '[]', DATE '2026-09-02') THEN
    RAISE EXCEPTION '6b: día sí/día no NO debía caer el 2'; END IF;
  RAISE NOTICE 'OK 6  diaria respeta intervalo_dias';

  -- ── 7. semanal por días ISO ──────────────────────────────────────────────
  -- [1,3,5] = lunes, miércoles, viernes.
  IF NOT public.turnos_regla_aplica('semanal', DATE '2026-09-01', '[1,3,5]', NULL, NULL, NULL, '[]', DATE '2026-09-02') THEN
    RAISE EXCEPTION '7a: el miércoles 2 debía caer'; END IF;
  IF public.turnos_regla_aplica('semanal', DATE '2026-09-01', '[1,3,5]', NULL, NULL, NULL, '[]', DATE '2026-09-03') THEN
    RAISE EXCEPTION '7b: el jueves 3 NO debía caer'; END IF;
  -- Sin días declarados, cubre la semana entera.
  IF NOT public.turnos_regla_aplica('semanal', DATE '2026-09-01', '[]', NULL, NULL, NULL, '[]', DATE '2026-09-03') THEN
    RAISE EXCEPTION '7c: sin dias_semana debía cubrir todos los días'; END IF;
  RAISE NOTICE 'OK 7  semanal filtra por día ISO y trata [] como "toda la semana"';

  -- ── 8. quincenal alterna semanas ─────────────────────────────────────────
  IF NOT public.turnos_regla_aplica('quincenal', DATE '2026-09-01', '[2]', NULL, NULL, NULL, '[]', DATE '2026-09-01') THEN
    RAISE EXCEPTION '8a: el martes de la semana 0 debía caer'; END IF;
  IF public.turnos_regla_aplica('quincenal', DATE '2026-09-01', '[2]', NULL, NULL, NULL, '[]', DATE '2026-09-08') THEN
    RAISE EXCEPTION '8b: el martes de la semana 1 NO debía caer'; END IF;
  IF NOT public.turnos_regla_aplica('quincenal', DATE '2026-09-01', '[2]', NULL, NULL, NULL, '[]', DATE '2026-09-15') THEN
    RAISE EXCEPTION '8c: el martes de la semana 2 debía caer'; END IF;
  RAISE NOTICE 'OK 8  quincenal alterna semanas, no días';

  -- ── 9. Las cinco periodicidades por mes ──────────────────────────────────
  IF NOT public.turnos_regla_aplica('mensual', DATE '2026-09-10', '[]', NULL, 10, NULL, '[]', DATE '2026-10-10') THEN
    RAISE EXCEPTION '9a: mensual debía caer el 10 de octubre'; END IF;
  IF public.turnos_regla_aplica('bimestral', DATE '2026-09-10', '[]', NULL, 10, NULL, '[]', DATE '2026-10-10') THEN
    RAISE EXCEPTION '9b: bimestral NO debía caer en octubre'; END IF;
  IF NOT public.turnos_regla_aplica('bimestral', DATE '2026-09-10', '[]', NULL, 10, NULL, '[]', DATE '2026-11-10') THEN
    RAISE EXCEPTION '9c: bimestral debía caer en noviembre'; END IF;
  IF NOT public.turnos_regla_aplica('trimestral', DATE '2026-09-10', '[]', NULL, 10, NULL, '[]', DATE '2026-12-10') THEN
    RAISE EXCEPTION '9d: trimestral debía caer en diciembre'; END IF;
  IF NOT public.turnos_regla_aplica('semestral', DATE '2026-09-10', '[]', NULL, 10, NULL, '[]', DATE '2027-03-10') THEN
    RAISE EXCEPTION '9e: semestral debía caer en marzo de 2027'; END IF;
  IF NOT public.turnos_regla_aplica('anual', DATE '2026-09-10', '[]', NULL, 10, NULL, '[]', DATE '2027-09-10') THEN
    RAISE EXCEPTION '9f: anual debía caer en septiembre de 2027'; END IF;
  IF public.turnos_regla_aplica('anual', DATE '2026-09-10', '[]', NULL, 10, NULL, '[]', DATE '2027-09-11') THEN
    RAISE EXCEPTION '9g: anual NO debía caer el 11'; END IF;
  RAISE NOTICE 'OK 9  mensual/bimestral/trimestral/semestral/anual saltan los meses correctos';

  -- ── 10. Día 31 en un mes que no lo tiene ─────────────────────────────────
  -- Recortar al último día real, y no saltarse el mes: si no, el empleado se
  -- queda sin turno siete veces al año.
  IF NOT public.turnos_regla_aplica('mensual', DATE '2026-01-31', '[]', NULL, 31, NULL, '[]', DATE '2026-02-28') THEN
    RAISE EXCEPTION '10a: día 31 debía recortarse al 28 de febrero'; END IF;
  IF NOT public.turnos_regla_aplica('mensual', DATE '2026-01-31', '[]', NULL, 31, NULL, '[]', DATE '2026-04-30') THEN
    RAISE EXCEPTION '10b: día 31 debía recortarse al 30 de abril'; END IF;
  RAISE NOTICE 'OK 10 el día 31 se recorta al último día real del mes';

  -- ── 11. unica y fechas sueltas ───────────────────────────────────────────
  IF NOT public.turnos_regla_aplica('unica', DATE '2026-09-05', '[]', NULL, NULL, NULL, '[]', DATE '2026-09-05') THEN
    RAISE EXCEPTION '11a: unica debía caer en su propia fecha'; END IF;
  IF public.turnos_regla_aplica('unica', DATE '2026-09-05', '[]', NULL, NULL, NULL, '[]', DATE '2026-09-06') THEN
    RAISE EXCEPTION '11b: unica NO debía caer al día siguiente'; END IF;
  IF NOT public.turnos_regla_aplica('fechas', DATE '2026-09-01', '[]', NULL, NULL, NULL,
        '["2026-09-14","2026-12-24"]', DATE '2026-12-24') THEN
    RAISE EXCEPTION '11c: la fecha suelta del 24 debía caer'; END IF;
  RAISE NOTICE 'OK 11 unica y fechas específicas caen solo donde deben';

  -- ── 11b. «Los días del mes que elijas» ──────────────────────────────────
  -- El gemelo mensual de 'semanal'. Los mismos casos que prueba reglaAplicaEn()
  -- en el lado TypeScript: si divergen, el calendario enseña un día que después
  -- nadie genera.
  IF NOT public.turnos_regla_aplica('mensual_dias', DATE '2026-09-01', '[]', NULL, NULL, NULL,
        '[]', DATE '2026-10-15', '[1,15,30]') THEN
    RAISE EXCEPTION '11d: el 15 de octubre debía caer'; END IF;
  IF public.turnos_regla_aplica('mensual_dias', DATE '2026-09-01', '[]', NULL, NULL, NULL,
        '[]', DATE '2026-10-16', '[1,15,30]') THEN
    RAISE EXCEPTION '11e: el 16 NO debía caer'; END IF;
  IF NOT public.turnos_regla_aplica('mensual_dias', DATE '2026-09-01', '[]', NULL, 7, NULL,
        '[]', DATE '2026-10-07', '[]') THEN
    RAISE EXCEPTION '11f: sin dias_mes debía caer en dia_mes'; END IF;
  RAISE NOTICE 'OK 11b mensual_dias cae en los días marcados y no en los demás';

  -- ── 11c. Los cuatro finales de mes, y la convergencia ───────────────────
  -- 2027 NO es bisiesto (febrero 28); 2028 SÍ (febrero 29). El 29, el 30 y el
  -- 31 se recortan al último día real, y cuando varios convergen en la misma
  -- fecha tiene que salir UN día, no tres — por eso el lado SQL es un EXISTS
  -- sobre la lista y no una fila por elemento.
  IF NOT public.turnos_regla_aplica('mensual_dias', DATE '2026-09-01', '[]', NULL, NULL, NULL,
        '[]', DATE '2027-02-28', '[28]') THEN
    RAISE EXCEPTION '11g: el 28 debía caer en febrero no bisiesto'; END IF;
  IF NOT public.turnos_regla_aplica('mensual_dias', DATE '2026-09-01', '[]', NULL, NULL, NULL,
        '[]', DATE '2027-02-28', '[31]') THEN
    RAISE EXCEPTION '11h: el 31 debía recortarse al 28 en febrero no bisiesto'; END IF;
  IF NOT public.turnos_regla_aplica('mensual_dias', DATE '2028-01-01', '[]', NULL, NULL, NULL,
        '[]', DATE '2028-02-29', '[31]') THEN
    RAISE EXCEPTION '11i: el 31 debía recortarse al 29 en febrero bisiesto'; END IF;
  IF public.turnos_regla_aplica('mensual_dias', DATE '2028-01-01', '[]', NULL, NULL, NULL,
        '[]', DATE '2028-02-28', '[31]') THEN
    RAISE EXCEPTION '11j: en bisiesto el 31 NO debe caer el 28'; END IF;
  -- Convergencia: 29+30+31 en un febrero de 28 son el MISMO día.
  IF NOT public.turnos_regla_aplica('mensual_dias', DATE '2026-09-01', '[]', NULL, NULL, NULL,
        '[]', DATE '2027-02-28', '[29,30,31]') THEN
    RAISE EXCEPTION '11k: 29/30/31 convergentes debían caer el 28'; END IF;
  IF public.turnos_regla_aplica('mensual_dias', DATE '2026-09-01', '[]', NULL, NULL, NULL,
        '[]', DATE '2027-02-27', '[29,30,31]') THEN
    RAISE EXCEPTION '11l: 29/30/31 no debían caer el 27'; END IF;
  -- Y en un mes de 31 no se recorta nada: son tres días distintos.
  IF NOT (public.turnos_regla_aplica('mensual_dias', DATE '2026-09-01', '[]', NULL, NULL, NULL, '[]', DATE '2027-01-29', '[29,30,31]')
      AND public.turnos_regla_aplica('mensual_dias', DATE '2026-09-01', '[]', NULL, NULL, NULL, '[]', DATE '2027-01-30', '[29,30,31]')
      AND public.turnos_regla_aplica('mensual_dias', DATE '2026-09-01', '[]', NULL, NULL, NULL, '[]', DATE '2027-01-31', '[29,30,31]')) THEN
    RAISE EXCEPTION '11m: en enero los tres días son distintos y los tres debían caer'; END IF;
  RAISE NOTICE 'OK 11c 28/29/30/31: se recortan al último día real y convergen en UNO';

  -- ── 11d. El CHECK rechaza una lista que no son días ─────────────────────
  IF public.turnos_dias_mes_validos('[0]')  THEN RAISE EXCEPTION '11n: el 0 no es un día'; END IF;
  IF public.turnos_dias_mes_validos('[32]') THEN RAISE EXCEPTION '11o: el 32 no es un día'; END IF;
  IF public.turnos_dias_mes_validos('[2.5]') THEN RAISE EXCEPTION '11p: un decimal no es un día'; END IF;
  IF public.turnos_dias_mes_validos('["15"]') THEN RAISE EXCEPTION '11q: un texto no es un día'; END IF;
  IF public.turnos_dias_mes_validos('[null]') THEN RAISE EXCEPTION '11r: un nulo no es un día'; END IF;
  IF public.turnos_dias_mes_validos('{"a":1}') THEN RAISE EXCEPTION '11s: un objeto no es una lista'; END IF;
  IF NOT public.turnos_dias_mes_validos('[]') THEN RAISE EXCEPTION '11t: la lista vacía es válida'; END IF;
  IF NOT public.turnos_dias_mes_validos('[1,15,31]') THEN RAISE EXCEPTION '11u: 1/15/31 son válidos'; END IF;
  RAISE NOTICE 'OK 11d dias_mes sólo acepta enteros 1..31';

  -- ── 12. Nada cae antes de que empiece la regla ───────────────────────────
  IF public.turnos_regla_aplica('diaria', DATE '2026-09-10', '[]', NULL, NULL, NULL, '[]', DATE '2026-09-09') THEN
    RAISE EXCEPTION '12: una regla no puede caer antes de fecha_inicio'; END IF;
  RAISE NOTICE 'OK 12 ninguna periodicidad cae antes de fecha_inicio';

  -- ══ C. Backfill de presencia_personal ═════════════════════════════════════

  -- ── 13. El marcaje histórico se ata al empleado ──────────────────────────
  SELECT count(*) INTO n FROM public.presencia_personal
   WHERE nombre ILIKE '%pedro%' AND personal_id = PEDRO;
  IF n <> 2 THEN
    RAISE EXCEPTION '13a: se ataron % marcajes de Pedro (esperado 2, incluido el que trae espacios y minúsculas)', n; END IF;
  SELECT personal_id INTO v_bloque FROM public.presencia_personal WHERE nombre = 'Empleado Externo';
  IF v_bloque IS NOT NULL THEN
    RAISE EXCEPTION '13b: quien no está en plantilla debía quedar sin personal_id'; END IF;
  RAISE NOTICE 'OK 13 el backfill ata por nombre normalizado y deja fuera a quien no está en plantilla';

  -- ══ D. Generación de ocurrencias ══════════════════════════════════════════

  -- ── 14. Una regla semanal materializa sus días ───────────────────────────
  -- Pedro: nocturno de lunes a viernes, todo septiembre de 2026.
  INSERT INTO public.asignaciones_turno
    (id, company_id, project_id, personal_id, plantilla_horario_id, nombre,
     frecuencia, dias_semana, fecha_inicio, fecha_fin)
  VALUES
    ('70000000-0000-0000-0000-000000000001', CO, PR, PEDRO, v_noct,
     'Pedro · nocturno L-V', 'semanal', '[1,2,3,4,5]', DATE '2026-09-01', DATE '2026-09-30')
  RETURNING id INTO v_regla;

  SELECT generados INTO n FROM public.generar_bloques_turno(PR, DATE '2026-09-01', DATE '2026-09-30');
  -- Septiembre 2026 tiene 22 días hábiles (L-V).
  IF n <> 22 THEN
    RAISE EXCEPTION '14: generó % bloques (esperado 22 días hábiles de septiembre)', n; END IF;
  SELECT count(*) INTO n FROM public.bloques_turno
   WHERE asignacion_id = v_regla AND EXTRACT(ISODOW FROM fecha) > 5;
  IF n <> 0 THEN
    RAISE EXCEPTION '14b: se generaron % bloques en fin de semana', n; END IF;
  RAISE NOTICE 'OK 14 la regla semanal materializa exactamente sus días hábiles';

  -- ── 15. Las horas de la plantilla viajan al bloque ───────────────────────
  SELECT hora_inicio, hora_fin, horas_planificadas, origen, turno INTO r
    FROM public.bloques_turno WHERE asignacion_id = v_regla AND fecha = DATE '2026-09-01';
  IF r.hora_inicio <> TIME '22:00' OR r.hora_fin <> TIME '06:00' THEN
    RAISE EXCEPTION '15a: el bloque no heredó las horas de la plantilla'; END IF;
  IF r.horas_planificadas IS DISTINCT FROM 8.00 THEN
    RAISE EXCEPTION '15b: horas_planificadas = % (esperado 8)', r.horas_planificadas; END IF;
  IF r.origen <> 'recurrencia' OR r.turno <> 'noche' THEN
    RAISE EXCEPTION '15c: origen=% turno=% (esperado recurrencia/noche)', r.origen, r.turno; END IF;
  RAISE NOTICE 'OK 15 el bloque hereda horas, turno y queda marcado como recurrencia';

  -- ── 16. Re-generar es idempotente ────────────────────────────────────────
  SELECT generados INTO n FROM public.generar_bloques_turno(PR, DATE '2026-09-01', DATE '2026-09-30');
  IF n <> 0 THEN
    RAISE EXCEPTION '16: la segunda pasada generó % bloques (esperado 0)', n; END IF;
  SELECT count(*) INTO n FROM public.bloques_turno WHERE asignacion_id = v_regla;
  IF n <> 22 THEN
    RAISE EXCEPTION '16b: quedaron % bloques tras re-generar (esperado 22)', n; END IF;
  RAISE NOTICE 'OK 16 volver a generar no duplica nada';

  -- ── 17. No pisa un bloque puesto a mano ──────────────────────────────────
  -- Lucía tiene el 5 de octubre asignado a mano; la regla que la cubre no debe
  -- crear un segundo bloque de ese turno ese día.
  INSERT INTO public.bloques_turno (company_id, project_id, personal_id, turno, fecha, notas)
    VALUES (CO, PR, LUCIA, 'manana', DATE '2026-10-05', 'puesto a mano');
  -- Con fecha_fin: sin ella la regla seguiría viva en diciembre y contaminaría
  -- los conteos de la invariante 20.
  INSERT INTO public.asignaciones_turno
    (company_id, project_id, personal_id, plantilla_horario_id, nombre,
     frecuencia, dias_semana, fecha_inicio, fecha_fin)
  VALUES (CO, PR, LUCIA, v_diurno, 'Lucía · diurno L-V', 'semanal', '[1,2,3,4,5]',
          DATE '2026-10-01', DATE '2026-10-31');

  SELECT omitidos_existente INTO n FROM public.generar_bloques_turno(PR, DATE '2026-10-05', DATE '2026-10-05');
  IF n <> 1 THEN
    RAISE EXCEPTION '17a: debía omitir 1 por existente, omitió %', n; END IF;
  SELECT count(*) INTO n FROM public.bloques_turno
   WHERE personal_id = LUCIA AND fecha = DATE '2026-10-05';
  IF n <> 1 THEN
    RAISE EXCEPTION '17b: quedaron % bloques ese día (el manual debía seguir solo)', n; END IF;
  RAISE NOTICE 'OK 17 generar nunca pisa un bloque puesto a mano';

  -- ── 18. Las ausencias aprobadas bloquean la generación ───────────────────
  INSERT INTO public.ausencias_personal
    (id, company_id, project_id, personal_id, tipo, fecha_inicio, fecha_fin, estado)
  VALUES
    ('80000000-0000-0000-0000-000000000001', CO, PR, MARIO, 'vacaciones',
     DATE '2026-11-02', DATE '2026-11-06', 'aprobada')
  RETURNING id INTO v_aus;

  INSERT INTO public.asignaciones_turno
    (company_id, project_id, personal_id, plantilla_horario_id, nombre,
     frecuencia, dias_semana, fecha_inicio, fecha_fin)
  VALUES (CO, PR, MARIO, v_diurno, 'Mario · diurno L-V', 'semanal', '[1,2,3,4,5]',
          DATE '2026-11-01', DATE '2026-11-30');

  SELECT generados, omitidos_ausencia INTO r
    FROM public.generar_bloques_turno(PR, DATE '2026-11-02', DATE '2026-11-06');
  IF r.omitidos_ausencia <> 5 THEN
    RAISE EXCEPTION '18a: debía omitir 5 días por vacaciones, omitió %', r.omitidos_ausencia; END IF;
  SELECT count(*) INTO n FROM public.bloques_turno
   WHERE personal_id = MARIO AND fecha BETWEEN DATE '2026-11-02' AND DATE '2026-11-06';
  IF n <> 0 THEN
    RAISE EXCEPTION '18b: se generaron % turnos durante las vacaciones', n; END IF;
  RAISE NOTICE 'OK 18 una ausencia aprobada impide que se le asignen turnos';

  -- ── 19. Una ausencia SOLO SOLICITADA no bloquea nada ─────────────────────
  UPDATE public.ausencias_personal SET estado = 'solicitada' WHERE id = v_aus;
  SELECT generados INTO n FROM public.generar_bloques_turno(PR, DATE '2026-11-02', DATE '2026-11-06');
  IF n <> 5 THEN
    RAISE EXCEPTION '19: con la ausencia sin aprobar debía generar 5, generó %', n; END IF;
  RAISE NOTICE 'OK 19 solo la ausencia APROBADA bloquea; la solicitada no';

  -- ── 20. Los días no laborables se saltan (salvo que la regla los cubra) ──
  INSERT INTO public.dias_no_laborables (company_id, project_id, fecha, nombre, tipo, factor_recargo)
    VALUES (CO, PR, DATE '2026-12-25', 'Navidad', 'festivo_nacional', 2.00);

  INSERT INTO public.asignaciones_turno
    (company_id, project_id, personal_id, plantilla_horario_id, nombre,
     frecuencia, dias_semana, fecha_inicio, cubre_dias_no_laborables)
  VALUES (CO, PR, LUCIA, v_diurno, 'Lucía · diciembre', 'semanal', '[]', DATE '2026-12-01', false);

  SELECT omitidos_no_laborable INTO n
    FROM public.generar_bloques_turno(PR, DATE '2026-12-25', DATE '2026-12-25');
  IF n <> 1 THEN
    RAISE EXCEPTION '20a: debía omitir Navidad, omitidos=%', n; END IF;

  -- La garita sí se cubre en Navidad: la regla lo declara.
  INSERT INTO public.asignaciones_turno
    (company_id, project_id, personal_id, plantilla_horario_id, nombre,
     frecuencia, dias_semana, fecha_inicio, cubre_dias_no_laborables)
  VALUES (CO, PR, PEDRO, v_noct, 'Pedro · garita 24/7', 'semanal', '[]', DATE '2026-12-01', true);

  SELECT generados INTO n FROM public.generar_bloques_turno(PR, DATE '2026-12-25', DATE '2026-12-25');
  IF n <> 1 THEN
    RAISE EXCEPTION '20b: la regla que cubre festivos debía generar 1, generó %', n; END IF;
  RAISE NOTICE 'OK 20 el festivo se salta, salvo en la regla que declara cubrirlo';

  -- ── 21. Un empleado dado de baja no recibe turnos nuevos ────────────────
  UPDATE public.personal_condominio SET estado = 'inactivo' WHERE id = MARIO;
  SELECT generados INTO n FROM public.generar_bloques_turno(PR, DATE '2026-11-09', DATE '2026-11-13');
  SELECT count(*) INTO n FROM public.bloques_turno
   WHERE personal_id = MARIO AND fecha BETWEEN DATE '2026-11-09' AND DATE '2026-11-13';
  IF n <> 0 THEN
    RAISE EXCEPTION '21: se generaron % turnos a un empleado inactivo', n; END IF;
  UPDATE public.personal_condominio SET estado = 'activo' WHERE id = MARIO;
  RAISE NOTICE 'OK 21 un empleado inactivo no recibe turnos generados';

  -- ══ E. Estado del expediente derivado de la ausencia ══════════════════════

  -- ── 22. Aprobar vacaciones vigentes marca el expediente ─────────────────
  INSERT INTO public.ausencias_personal
    (company_id, project_id, personal_id, tipo, fecha_inicio, fecha_fin, estado)
  VALUES (CO, PR, LUCIA, 'vacaciones', CURRENT_DATE - 1, CURRENT_DATE + 5, 'aprobada')
  RETURNING id INTO v_aus;
  SELECT estado INTO t FROM public.personal_condominio WHERE id = LUCIA;
  IF t <> 'vacaciones' THEN
    RAISE EXCEPTION '22: el expediente quedó en % (esperado vacaciones)', t; END IF;
  RAISE NOTICE 'OK 22 aprobar vacaciones vigentes marca el expediente (la ruta de limpieza deja de asignarle áreas)';

  -- ── 23. Cancelarlas lo devuelve a activo ────────────────────────────────
  UPDATE public.ausencias_personal SET estado = 'cancelada' WHERE id = v_aus;
  SELECT estado INTO t FROM public.personal_condominio WHERE id = LUCIA;
  IF t <> 'activo' THEN
    RAISE EXCEPTION '23: tras cancelar quedó en % (esperado activo)', t; END IF;
  RAISE NOTICE 'OK 23 cancelar la ausencia devuelve el expediente a activo';

  -- ── 24. 'inactivo' es terminal: ninguna ausencia lo resucita ────────────
  -- Es lo que separa "está de vacaciones" de "ya no trabaja aquí".
  UPDATE public.personal_condominio SET estado = 'inactivo' WHERE id = MARIO;
  INSERT INTO public.ausencias_personal
    (company_id, project_id, personal_id, tipo, fecha_inicio, fecha_fin, estado)
  VALUES (CO, PR, MARIO, 'vacaciones', CURRENT_DATE - 1, CURRENT_DATE + 5, 'aprobada')
  RETURNING id INTO v_aus;
  SELECT estado INTO t FROM public.personal_condominio WHERE id = MARIO;
  IF t <> 'inactivo' THEN
    RAISE EXCEPTION '24a: una ausencia movió un expediente inactivo a %', t; END IF;
  UPDATE public.ausencias_personal SET estado = 'cancelada' WHERE id = v_aus;
  SELECT estado INTO t FROM public.personal_condominio WHERE id = MARIO;
  IF t <> 'inactivo' THEN
    RAISE EXCEPTION '24b: cancelar la ausencia resucitó a un empleado dado de baja'; END IF;
  UPDATE public.personal_condominio SET estado = 'activo' WHERE id = MARIO;
  RAISE NOTICE 'OK 24 el estado inactivo nunca lo toca la sincronización';

  -- ── 25. Un permiso NO mueve el expediente ───────────────────────────────
  INSERT INTO public.ausencias_personal
    (company_id, project_id, personal_id, tipo, fecha_inicio, fecha_fin, estado)
  VALUES (CO, PR, LUCIA, 'permiso_goce', CURRENT_DATE, CURRENT_DATE, 'aprobada');
  SELECT estado INTO t FROM public.personal_condominio WHERE id = LUCIA;
  IF t <> 'activo' THEN
    RAISE EXCEPTION '25: un permiso de un día movió el expediente a %', t; END IF;
  RAISE NOTICE 'OK 25 permisos y suspensiones se ven en el calendario, no en el expediente';

  -- ── 26. Quién aprobó queda sellado ──────────────────────────────────────
  INSERT INTO public.ausencias_personal
    (company_id, project_id, personal_id, tipo, fecha_inicio, fecha_fin, estado)
  VALUES (CO, PR, PEDRO, 'suspension', DATE '2027-01-04', DATE '2027-01-05', 'solicitada')
  RETURNING id INTO v_aus;
  PERFORM set_config('app.uid', GUARDIA::text, false);
  UPDATE public.ausencias_personal SET estado = 'aprobada', aprobada_en = now() WHERE id = v_aus;
  SELECT aprobada_por INTO v_bloque FROM public.ausencias_personal WHERE id = v_aus;
  IF v_bloque IS DISTINCT FROM GUARDIA THEN
    RAISE EXCEPTION '26: aprobada_por = % (esperado el usuario que la aprobó)', v_bloque; END IF;
  PERFORM set_config('app.uid', ADMIN_A::text, false);
  RAISE NOTICE 'OK 26 aprobar sella quién lo hizo, aunque no sea quien la creó';

  -- ══ F. Cómputo de horas ═══════════════════════════════════════════════════

  -- ── 27. Ordinarias vs extra contra la jornada planificada ───────────────
  -- Pedro tiene turno nocturno de 8 h el 2026-09-01 (generado en 14). Marca de
  -- 22:00 a 08:00 = 10 h ⇒ 8 ordinarias + 2 extra.
  INSERT INTO public.presencia_personal
    (company_id, project_id, personal_id, nombre, fecha, hora_entrada, hora_salida, estado)
  VALUES (CO, PR, PEDRO, 'Pedro Guardia', DATE '2026-09-01', TIME '22:00', TIME '08:00', 'presente');

  SELECT horas_planificadas, horas_trabajadas, horas_ordinarias, horas_extra, horas_nocturnas
    INTO r
    FROM public.calcular_horas_personal(PR, DATE '2026-09-01', DATE '2026-09-01')
   WHERE personal_id = PEDRO;
  IF r.horas_planificadas IS DISTINCT FROM 8.00 THEN
    RAISE EXCEPTION '27a: planificadas = % (esperado 8)', r.horas_planificadas; END IF;
  IF r.horas_trabajadas IS DISTINCT FROM 10.00 THEN
    RAISE EXCEPTION '27b: trabajadas = % (esperado 10)', r.horas_trabajadas; END IF;
  IF r.horas_ordinarias IS DISTINCT FROM 8.00 THEN
    RAISE EXCEPTION '27c: ordinarias = % (esperado 8)', r.horas_ordinarias; END IF;
  IF r.horas_extra IS DISTINCT FROM 2.00 THEN
    RAISE EXCEPTION '27d: extra = % (esperado 2)', r.horas_extra; END IF;
  IF r.horas_nocturnas IS DISTINCT FROM 8.00 THEN
    RAISE EXCEPTION '27e: nocturnas = % (esperado 8: de 22:00 a 06:00)', r.horas_nocturnas; END IF;
  RAISE NOTICE 'OK 27 la extra se mide contra la jornada planificada, y el turno nocturno ya no se pierde';

  -- ── 28. Un marcaje sin turno asignado no es todo extra ──────────────────
  -- Mario vino un domingo que nadie programó y trabajó 9 h: 8 ordinarias
  -- (jornada de referencia) + 1 extra, no 9 extra.
  INSERT INTO public.presencia_personal
    (company_id, project_id, personal_id, nombre, fecha, hora_entrada, hora_salida, estado)
  VALUES (CO, PR, MARIO, 'Mario Jardinero', DATE '2026-09-06', TIME '07:00', TIME '16:00', 'presente');

  SELECT horas_ordinarias, horas_extra, dias_planificados INTO r
    FROM public.calcular_horas_personal(PR, DATE '2026-09-06', DATE '2026-09-06')
   WHERE personal_id = MARIO;
  IF r.dias_planificados <> 0 THEN
    RAISE EXCEPTION '28a: ese día no estaba planificado, dias_planificados=%', r.dias_planificados; END IF;
  IF r.horas_ordinarias IS DISTINCT FROM 8.00 OR r.horas_extra IS DISTINCT FROM 1.00 THEN
    RAISE EXCEPTION '28b: ordinarias=% extra=% (esperado 8 y 1)', r.horas_ordinarias, r.horas_extra; END IF;
  RAISE NOTICE 'OK 28 una cobertura no programada se mide contra la jornada de referencia';

  -- ── 29. El asueto trabajado se pondera con su factor ────────────────────
  INSERT INTO public.presencia_personal
    (company_id, project_id, personal_id, nombre, fecha, hora_entrada, hora_salida, estado)
  VALUES (CO, PR, PEDRO, 'Pedro Guardia', DATE '2026-12-25', TIME '22:00', TIME '06:00', 'presente');

  SELECT horas_asueto, horas_asueto_ponderadas, dias_asueto_trabajado INTO r
    FROM public.calcular_horas_personal(PR, DATE '2026-12-25', DATE '2026-12-25')
   WHERE personal_id = PEDRO;
  IF r.dias_asueto_trabajado <> 1 THEN
    RAISE EXCEPTION '29a: dias_asueto_trabajado = % (esperado 1)', r.dias_asueto_trabajado; END IF;
  IF r.horas_asueto IS DISTINCT FROM 8.00 THEN
    RAISE EXCEPTION '29b: horas_asueto = % (esperado 8)', r.horas_asueto; END IF;
  IF r.horas_asueto_ponderadas IS DISTINCT FROM 16.00 THEN
    RAISE EXCEPTION '29c: ponderadas = % (esperado 16 = 8 h × factor 2)', r.horas_asueto_ponderadas; END IF;
  RAISE NOTICE 'OK 29 trabajar en Navidad se computa con el factor de recargo del día';

  -- ── 30. El marcaje sin empleado no se le suma a nadie ───────────────────
  SELECT COALESCE(SUM(horas_trabajadas), 0) INTO num
    FROM public.calcular_horas_personal(PR, DATE '2026-07-01', DATE '2026-07-01');
  -- Solo los 8 h de Pedro (atados por el backfill). El "Empleado Externo",
  -- que quedó sin personal_id, no se le suma a nadie.
  IF num IS DISTINCT FROM 8.00 THEN
    RAISE EXCEPTION '30: total = % h (esperado 8; el marcaje sin empleado no debe imputarse)', num; END IF;
  RAISE NOTICE 'OK 30 un marcaje sin personal_id no se le imputa a ningún empleado';

  RAISE NOTICE '── 30 invariantes de datos OK ──';
END;
$$;

-- ══ G. RLS y aislamiento ═══════════════════════════════════════════════════
-- En bloque aparte: las policies solo aplican a roles no privilegiados, y el
-- dueño de las tablas las salta.
CREATE ROLE turnos_tester;
-- Membresía en `authenticated` obligatoria: TODAS las policies se declaran
-- `TO authenticated` (es el rol con el que PostgREST se conecta). Sin esto no
-- aplica ninguna policy y, con RLS encendida, el rol no ve NADA — el test
-- pasaría los asserts de aislamiento por el motivo equivocado y fallaría los de
-- acceso legítimo.
GRANT authenticated TO turnos_tester;
GRANT USAGE ON SCHEMA public TO turnos_tester;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO turnos_tester;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO turnos_tester;

-- ── Los tres roles con los que se prueba la autorización ───────────────────
-- La clave de TRES segmentos (`condominios.tab.turnos`) es VISIBILIDAD; las de
-- CUATRO son acciones. 20260916221839 dejó de aceptar la primera para escribir,
-- así que hacen falta tres perfiles distintos para probarlo:
--
--   · Beto  — visibilidad + acciones por tab. Es el que SÍ escribe.
--   · Tino  — SÓLO visibilidad. Lee el calendario y no puede tocarlo.
--   · Lola  — visibilidad + el par LEGADO de módulo completo, sin claves por
--             tab. Tiene que escribir igual, porque `canActInCondominiosTab`
--             lo acepta y la base no puede ser más estricta que el botón.
INSERT INTO public.role_permissions (role_id, permission_key, effect) VALUES
  ('cccccccc-0000-0000-0000-000000000001', 'condominios.tab.turnos',            'allow'),
  ('cccccccc-0000-0000-0000-000000000001', 'condominios.tab.turnos.create',     'allow'),
  ('cccccccc-0000-0000-0000-000000000001', 'condominios.tab.turnos.edit',       'allow'),
  ('cccccccc-0000-0000-0000-000000000002', 'condominios.tab.turnos',            'allow'),
  ('cccccccc-0000-0000-0000-000000000003', 'condominios.tab.turnos',            'allow'),
  ('cccccccc-0000-0000-0000-000000000003', 'platform.condominios.view',         'allow'),
  ('cccccccc-0000-0000-0000-000000000003', 'platform.condominios.create',       'allow'),
  ('cccccccc-0000-0000-0000-000000000003', 'platform.condominios.edit',         'allow');
--
-- Fede lleva el MISMO rol que Beto —visibilidad y acciones de Turnos— pero está
-- asignado al OTRO condominio. Tener el permiso y no alcanzar el proyecto es
-- justo el caso que separa «alcance por empresa» de «alcance por proyecto»
-- (invariantes 66-68).
INSERT INTO public.user_roles (user_id, role_id) VALUES
  ('e0000000-0000-0000-0000-00000000000b', 'cccccccc-0000-0000-0000-000000000001'),
  ('e0000000-0000-0000-0000-00000000000f', 'cccccccc-0000-0000-0000-000000000001'),
  ('e0000000-0000-0000-0000-000000000010', 'cccccccc-0000-0000-0000-000000000002'),
  ('e0000000-0000-0000-0000-000000000011', 'cccccccc-0000-0000-0000-000000000003');

DO $$
DECLARE
  n bigint;
  ok boolean;
BEGIN
  SET LOCAL ROLE turnos_tester;

  -- ── 31. El guardia con el permiso ve las reglas de su empresa ───────────
  PERFORM set_config('app.uid', 'e0000000-0000-0000-0000-00000000000b', true);
  SELECT count(*) INTO n FROM public.asignaciones_turno;
  IF n = 0 THEN
    RAISE EXCEPTION '31: con condominios.tab.turnos debía ver las reglas y vio 0'; END IF;
  RAISE NOTICE 'OK 31 el rol con el permiso del tab lee las reglas de su empresa';

  -- ── 32. …y NO ve las ausencias, que son de otro permiso ────────────────
  -- Salvo por la clave de turnos, que SÍ le da lectura (el generador las
  -- necesita para saltárselas). Lo que no puede es crearlas.
  BEGIN
    INSERT INTO public.ausencias_personal
      (company_id, project_id, personal_id, tipo, fecha_inicio, fecha_fin)
    VALUES ('aaaaaaaa-0000-0000-0000-000000000001', '11111111-0000-0000-0000-000000000001',
            '50000000-0000-0000-0000-000000000001', 'vacaciones', DATE '2027-02-01', DATE '2027-02-05');
    RAISE EXCEPTION '32: pudo crear una ausencia sin el permiso de ausencias';
  EXCEPTION WHEN insufficient_privilege OR check_violation THEN
    NULL;
  END;
  RAISE NOTICE 'OK 32 leer turnos no habilita a aprobar ausencias';

  -- ── 33. La empresa vecina no ve nada ───────────────────────────────────
  PERFORM set_config('app.uid', 'e0000000-0000-0000-0000-00000000000c', true);
  SELECT count(*) INTO n FROM public.asignaciones_turno;
  IF n <> 0 THEN
    RAISE EXCEPTION '33a: la empresa vecina vio % reglas ajenas', n; END IF;
  SELECT count(*) INTO n FROM public.plantillas_horario;
  IF n <> 0 THEN
    RAISE EXCEPTION '33b: la empresa vecina vio % jornadas ajenas', n; END IF;
  SELECT count(*) INTO n FROM public.bloques_turno;
  IF n <> 0 THEN
    RAISE EXCEPTION '33c: la empresa vecina vio % bloques ajenos', n; END IF;
  RAISE NOTICE 'OK 33 el aislamiento por empresa se sostiene en las 3 tablas';

  -- ── 34. …ni puede generar turnos en el condominio ajeno ────────────────
  BEGIN
    PERFORM public.generar_bloques_turno('11111111-0000-0000-0000-000000000001',
                                         DATE '2027-03-01', DATE '2027-03-31');
    RAISE EXCEPTION '34: la empresa vecina pudo generar turnos en un proyecto ajeno';
  EXCEPTION WHEN insufficient_privilege THEN
    NULL;
  END;
  RAISE NOTICE 'OK 34 generar_bloques_turno rechaza el proyecto de otra empresa (42501)';

  -- ── 35. …ni computar sus horas ─────────────────────────────────────────
  BEGIN
    PERFORM * FROM public.calcular_horas_personal('11111111-0000-0000-0000-000000000001',
                                                  DATE '2026-09-01', DATE '2026-09-30');
    RAISE EXCEPTION '35: la empresa vecina pudo computar horas de un proyecto ajeno';
  EXCEPTION WHEN insufficient_privilege THEN
    NULL;
  END;
  RAISE NOTICE 'OK 35 calcular_horas_personal rechaza el proyecto de otra empresa (42501)';

  -- ── 36. Un usuario sin ningún permiso del tab no ve nada ───────────────
  PERFORM set_config('app.uid', '', true);
  SELECT count(*) INTO n FROM public.asignaciones_turno;
  IF n <> 0 THEN
    RAISE EXCEPTION '36: sin sesión se vieron % reglas', n; END IF;
  RAISE NOTICE 'OK 36 sin sesión no se lee ninguna regla';

  RESET ROLE;
  RAISE NOTICE '── 6 invariantes de RLS OK ──';
END;
$$;

-- ════════════════════════════════════════════════════════════════════════════
-- H. El borrado de bloques no puede destruir historial — PARA NINGÚN ROL
-- ════════════════════════════════════════════════════════════════════════════
-- Cada caso monta su propio bloque, intenta borrarlo con un rol de aplicación
-- real y comprueba DOS cosas: que el borrado no ocurrió y que las filas hijas
-- siguen enteras. Un rechazo que se lleve por delante la tarea «de paso» sería
-- tan malo como el borrado.
DO $$
DECLARE
  CO       uuid := 'aaaaaaaa-0000-0000-0000-000000000001';
  PR       uuid := '11111111-0000-0000-0000-000000000001';
  PR_OTRO  uuid := '11111111-0000-0000-0000-000000000003';
  PEDRO    uuid := '50000000-0000-0000-0000-000000000001';
  ANA      uuid := 'e0000000-0000-0000-0000-00000000000a';  -- admin
  BETO     uuid := 'e0000000-0000-0000-0000-00000000000b';  -- operator + tab turnos
  CARO     uuid := 'e0000000-0000-0000-0000-00000000000c';  -- admin de la empresa vecina
  OLGA     uuid := 'e0000000-0000-0000-0000-00000000000d';  -- company_owner
  SAM      uuid := 'e0000000-0000-0000-0000-00000000000e';  -- super_admin
  FEDE     uuid := 'e0000000-0000-0000-0000-00000000000f';  -- otro condominio, misma empresa
  v_b      uuid;
  v_b2     uuid;
  v_t      uuid;
  n        bigint;
BEGIN
  SET LOCAL ROLE turnos_tester;

  -- ── 37. Admin NO puede borrar un bloque PASADO ─────────────────────────
  RESET ROLE;
  INSERT INTO public.bloques_turno (company_id, project_id, personal_id, turno, fecha, estado)
    VALUES (CO, PR, PEDRO, 'manana', CURRENT_DATE - 10, 'pendiente') RETURNING id INTO v_b;
  SET LOCAL ROLE turnos_tester;
  PERFORM set_config('app.uid', ANA::text, true);
  BEGIN
    DELETE FROM public.bloques_turno WHERE id = v_b;
    RAISE EXCEPTION '37: un admin borró un bloque de fecha pasada';
  EXCEPTION WHEN restrict_violation THEN NULL;
  END;
  RESET ROLE;
  SELECT count(*) INTO n FROM public.bloques_turno WHERE id = v_b;
  IF n <> 1 THEN RAISE EXCEPTION '37b: el bloque pasado desapareció igual'; END IF;
  RAISE NOTICE 'OK 37 company_owner/admin no pueden borrar un bloque pasado';

  -- ── 38. …ni uno INICIADO, ni uno CERRADO ───────────────────────────────
  INSERT INTO public.bloques_turno (company_id, project_id, personal_id, turno, fecha, estado, iniciado_en)
    VALUES (CO, PR, PEDRO, 'manana', CURRENT_DATE + 10, 'pendiente', now()) RETURNING id INTO v_b;
  SET LOCAL ROLE turnos_tester;
  PERFORM set_config('app.uid', OLGA::text, true);
  BEGIN
    DELETE FROM public.bloques_turno WHERE id = v_b;
    RAISE EXCEPTION '38a: la dueña borró un bloque ya iniciado';
  EXCEPTION WHEN restrict_violation THEN NULL;
  END;
  RESET ROLE;

  INSERT INTO public.bloques_turno (company_id, project_id, personal_id, turno, fecha, estado, cerrado_en)
    VALUES (CO, PR, PEDRO, 'tarde', CURRENT_DATE + 10, 'pendiente', now()) RETURNING id INTO v_b;
  SET LOCAL ROLE turnos_tester;
  PERFORM set_config('app.uid', OLGA::text, true);
  BEGIN
    DELETE FROM public.bloques_turno WHERE id = v_b;
    RAISE EXCEPTION '38b: la dueña borró un bloque ya cerrado';
  EXCEPTION WHEN restrict_violation THEN NULL;
  END;
  RESET ROLE;

  -- Y el estado, que es el tercer hito.
  INSERT INTO public.bloques_turno (company_id, project_id, personal_id, turno, fecha, estado)
    VALUES (CO, PR, PEDRO, 'noche', CURRENT_DATE + 10, 'completado') RETURNING id INTO v_b;
  SET LOCAL ROLE turnos_tester;
  PERFORM set_config('app.uid', SAM::text, true);
  BEGIN
    DELETE FROM public.bloques_turno WHERE id = v_b;
    RAISE EXCEPTION '38c: el super_admin borró un bloque completado';
  EXCEPTION WHEN restrict_violation THEN NULL;
  END;
  RESET ROLE;
  RAISE NOTICE 'OK 38 ni iniciado, ni cerrado, ni fuera de pendiente — tampoco para owner/super_admin';

  -- ── 39. …ni uno con CUALQUIER tarea, aunque esté pendiente ─────────────
  -- Es el caso que motiva todo: tareas_bloque cuelga con ON DELETE CASCADE.
  INSERT INTO public.bloques_turno (company_id, project_id, personal_id, turno, fecha, estado)
    VALUES (CO, PR, PEDRO, 'manana', CURRENT_DATE + 11, 'pendiente') RETURNING id INTO v_b;
  INSERT INTO public.tareas_bloque (bloque_id, titulo, estado)
    VALUES (v_b, 'Revisar bombas', 'pendiente') RETURNING id INTO v_t;
  SET LOCAL ROLE turnos_tester;
  PERFORM set_config('app.uid', ANA::text, true);
  BEGIN
    DELETE FROM public.bloques_turno WHERE id = v_b;
    RAISE EXCEPTION '39a: un admin borró un bloque con una tarea PENDIENTE';
  EXCEPTION WHEN restrict_violation THEN NULL;
  END;
  PERFORM set_config('app.uid', OLGA::text, true);
  BEGIN
    DELETE FROM public.bloques_turno WHERE id = v_b;
    RAISE EXCEPTION '39b: la dueña borró un bloque con una tarea';
  EXCEPTION WHEN restrict_violation THEN NULL;
  END;
  PERFORM set_config('app.uid', BETO::text, true);
  BEGIN
    DELETE FROM public.bloques_turno WHERE id = v_b;
    RAISE EXCEPTION '39c: el usuario con condominios.tab.turnos borró un bloque con una tarea';
  EXCEPTION WHEN restrict_violation THEN NULL;
  END;
  RESET ROLE;
  -- El rechazo no se llevó nada por delante.
  SELECT count(*) INTO n FROM public.bloques_turno WHERE id = v_b;
  IF n <> 1 THEN RAISE EXCEPTION '39d: el bloque desapareció pese al rechazo'; END IF;
  SELECT count(*) INTO n FROM public.tareas_bloque WHERE bloque_id = v_b;
  IF n <> 1 THEN RAISE EXCEPTION '39e: la tarea hija desapareció (quedaron %)', n; END IF;
  RAISE NOTICE 'OK 39 ningún rol borra un bloque con tareas, y el rechazo deja las hijas intactas';

  -- ── 40. …ni uno con REVISIÓN ───────────────────────────────────────────
  -- LA REVISIÓN VA SOBRE OTRO BLOQUE, uno SIN tareas propias. Colgarla del
  -- mismo bloque que ya tiene checklist no probaría nada: saltaría antes la
  -- comprobación de tareas y la de revisiones quedaría sin ejercitar. Lo
  -- descubrió la prueba de mutación —retirar la condición dejaba el arnés en
  -- verde— y por eso la revisión apunta a la tarea de `v_b` pero declara
  -- `bloque_id` del bloque nuevo, que es la única forma en que esta condición
  -- es la que decide. El esquema lo permite: `tarea_id` y `bloque_id` son dos
  -- FKs independientes, y esa discrepancia es justo contra lo que protege.
  INSERT INTO public.bloques_turno (company_id, project_id, personal_id, turno, fecha, estado)
    VALUES (CO, PR, PEDRO, 'tarde', CURRENT_DATE + 12, 'pendiente') RETURNING id INTO v_b2;
  INSERT INTO public.revisiones_tarea (tarea_id, bloque_id, revisado_por, estado)
    VALUES (v_t, v_b2, ANA, 'aprobado');
  SELECT count(*) INTO n FROM public.tareas_bloque WHERE bloque_id = v_b2;
  IF n <> 0 THEN RAISE EXCEPTION '40a: el bloque de la prueba debía estar SIN tareas propias'; END IF;
  SET LOCAL ROLE turnos_tester;
  PERFORM set_config('app.uid', OLGA::text, true);
  BEGIN
    DELETE FROM public.bloques_turno WHERE id = v_b2;
    RAISE EXCEPTION '40b: se borró un bloque con revisión';
  EXCEPTION WHEN restrict_violation THEN NULL;
  END;
  RESET ROLE;
  SELECT count(*) INTO n FROM public.revisiones_tarea WHERE bloque_id = v_b2;
  IF n <> 1 THEN RAISE EXCEPTION '40c: la revisión desapareció'; END IF;
  -- Se limpia por el camino que SÍ corresponde: primero las hijas.
  DELETE FROM public.revisiones_tarea WHERE bloque_id = v_b2;
  DELETE FROM public.bloques_turno    WHERE id = v_b2;
  DELETE FROM public.tareas_bloque    WHERE bloque_id = v_b;
  RAISE NOTICE 'OK 40 un bloque con revisión (y sin tareas propias) no se borra, y la revisión sobrevive';

  -- ── 41. …ni uno con MARCAJE de presencia ───────────────────────────────
  INSERT INTO public.presencia_personal (company_id, project_id, nombre, fecha, bloque_id)
    VALUES (CO, PR, 'Pedro Guardia', CURRENT_DATE + 11, v_b);
  SET LOCAL ROLE turnos_tester;
  PERFORM set_config('app.uid', ANA::text, true);
  BEGIN
    DELETE FROM public.bloques_turno WHERE id = v_b;
    RAISE EXCEPTION '41a: se borró un bloque con marcaje asociado';
  EXCEPTION WHEN restrict_violation THEN NULL;
  END;
  RESET ROLE;
  SELECT count(*) INTO n FROM public.presencia_personal WHERE bloque_id = v_b;
  IF n <> 1 THEN RAISE EXCEPTION '41b: el marcaje quedó huérfano (SET NULL) pese al rechazo'; END IF;
  DELETE FROM public.presencia_personal WHERE bloque_id = v_b;
  RAISE NOTICE 'OK 41 un bloque con marcaje no se borra y el marcaje no queda huérfano';

  -- ── 42. Un bloque LIMPIO de hoy/futuro y pendiente SÍ se borra ──────────
  -- Si no, la barrera estaría rota en la otra dirección: la función del PR es
  -- poder quitar un turno que todavía no pasó.
  SET LOCAL ROLE turnos_tester;
  PERFORM set_config('app.uid', ANA::text, true);
  DELETE FROM public.bloques_turno WHERE id = v_b;
  RESET ROLE;
  SELECT count(*) INTO n FROM public.bloques_turno WHERE id = v_b;
  IF n <> 0 THEN RAISE EXCEPTION '42a: el bloque limpio no se borró'; END IF;

  -- Y también hoy mismo, no sólo en el futuro.
  INSERT INTO public.bloques_turno (company_id, project_id, personal_id, turno, fecha, estado)
    VALUES (CO, PR, PEDRO, 'manana', CURRENT_DATE, 'pendiente') RETURNING id INTO v_b;
  SET LOCAL ROLE turnos_tester;
  PERFORM set_config('app.uid', BETO::text, true);
  DELETE FROM public.bloques_turno WHERE id = v_b;
  RESET ROLE;
  SELECT count(*) INTO n FROM public.bloques_turno WHERE id = v_b;
  IF n <> 0 THEN RAISE EXCEPTION '42b: el bloque de HOY no se borró'; END IF;
  RAISE NOTICE 'OK 42 un bloque limpio de hoy o del futuro sí se borra — con el permiso del tab y con admin';

  -- ── 43. El usuario del tab cumple EXACTAMENTE las mismas reglas ────────
  INSERT INTO public.bloques_turno (company_id, project_id, personal_id, turno, fecha, estado)
    VALUES (CO, PR, PEDRO, 'manana', CURRENT_DATE - 3, 'pendiente') RETURNING id INTO v_b;
  SET LOCAL ROLE turnos_tester;
  PERFORM set_config('app.uid', BETO::text, true);
  BEGIN
    DELETE FROM public.bloques_turno WHERE id = v_b;
    RAISE EXCEPTION '43: el usuario del tab borró un bloque pasado';
  EXCEPTION WHEN restrict_violation THEN NULL;
  END;
  RESET ROLE;
  -- No se limpia: el bloque pasado se queda ahí A PROPÓSITO. Intentar borrarlo
  -- como dueño de la tabla fallaría igual, y eso es exactamente lo que se
  -- quería demostrar — el trigger no distingue quién ejecuta el DELETE.
  RAISE NOTICE 'OK 43 condominios.tab.turnos no es una puerta lateral: mismas seis condiciones';

  -- ── 44. La empresa vecina nunca borra, ni conociendo el UUID ───────────
  INSERT INTO public.bloques_turno (company_id, project_id, personal_id, turno, fecha, estado)
    VALUES (CO, PR, PEDRO, 'manana', CURRENT_DATE + 12, 'pendiente') RETURNING id INTO v_b;
  SET LOCAL ROLE turnos_tester;
  PERFORM set_config('app.uid', CARO::text, true);
  DELETE FROM public.bloques_turno WHERE id = v_b;   -- la RLS lo deja en 0 filas
  RESET ROLE;
  SELECT count(*) INTO n FROM public.bloques_turno WHERE id = v_b;
  IF n <> 1 THEN RAISE EXCEPTION '44a: la empresa vecina borró un bloque ajeno'; END IF;

  -- ── …y el otro condominio de la MISMA empresa, tampoco ─────────────────
  -- Esto es lo que company_id por sí solo no cubre: mismo tenant, otro proyecto.
  SET LOCAL ROLE turnos_tester;
  PERFORM set_config('app.uid', FEDE::text, true);
  DELETE FROM public.bloques_turno WHERE id = v_b;
  RESET ROLE;
  SELECT count(*) INTO n FROM public.bloques_turno WHERE id = v_b;
  IF n <> 1 THEN RAISE EXCEPTION '44b: otro proyecto de la misma empresa borró el bloque'; END IF;
  DELETE FROM public.bloques_turno WHERE id = v_b;
  RAISE NOTICE 'OK 44 ni otra empresa ni otro condominio de la misma empresa pueden borrar';

  RAISE NOTICE '── 8 invariantes de borrado seguro OK ──';
END;
$$;

-- ════════════════════════════════════════════════════════════════════════════
-- I. excepciones_turno: el día quitado no vuelve, y la tabla está cerrada
-- ════════════════════════════════════════════════════════════════════════════
DO $$
DECLARE
  CO      uuid := 'aaaaaaaa-0000-0000-0000-000000000001';
  CO_VEC  uuid := 'aaaaaaaa-0000-0000-0000-000000000002';
  PR      uuid := '11111111-0000-0000-0000-000000000001';
  PR_VEC  uuid := '11111111-0000-0000-0000-000000000002';
  PR_OTRO uuid := '11111111-0000-0000-0000-000000000003';
  MARIO   uuid := '50000000-0000-0000-0000-000000000003';
  ANA     uuid := 'e0000000-0000-0000-0000-00000000000a';
  BETO    uuid := 'e0000000-0000-0000-0000-00000000000b';
  CARO    uuid := 'e0000000-0000-0000-0000-00000000000c';
  FEDE    uuid := 'e0000000-0000-0000-0000-00000000000f';
  v_regla uuid;
  v_ex    uuid;
  n       bigint;
BEGIN
  -- Regla diaria de Mario para una ventana futura limpia.
  INSERT INTO public.asignaciones_turno
    (company_id, project_id, personal_id, plantilla_horario_id, nombre,
     frecuencia, dias_semana, fecha_inicio, fecha_fin)
  SELECT CO, PR, MARIO, ph.id, 'Mario · diaria (excepciones)', 'diaria', '[]',
         DATE '2027-06-01', DATE '2027-06-05'
  FROM public.plantillas_horario ph WHERE ph.project_id = PR LIMIT 1
  RETURNING id INTO v_regla;

  -- ── 45. Generar, quitar un día y RE-generar: el día no vuelve ──────────
  PERFORM public.generar_bloques_turno(PR, DATE '2027-06-01', DATE '2027-06-05');
  SELECT count(*) INTO n FROM public.bloques_turno
   WHERE personal_id = MARIO AND fecha BETWEEN DATE '2027-06-01' AND DATE '2027-06-05';
  IF n <> 5 THEN RAISE EXCEPTION '45a: debía generar 5 días, generó %', n; END IF;

  DELETE FROM public.bloques_turno WHERE personal_id = MARIO AND fecha = DATE '2027-06-03';
  INSERT INTO public.excepciones_turno (company_id, project_id, personal_id, asignacion_id, fecha, motivo)
    VALUES (CO, PR, MARIO, v_regla, DATE '2027-06-03', 'cambio con Pérez')
    RETURNING id INTO v_ex;

  -- Idempotencia: tres pasadas seguidas tienen que dar lo mismo que una.
  PERFORM public.generar_bloques_turno(PR, DATE '2027-06-01', DATE '2027-06-05');
  PERFORM public.generar_bloques_turno(PR, DATE '2027-06-01', DATE '2027-06-05');
  PERFORM public.generar_bloques_turno(PR, DATE '2027-06-01', DATE '2027-06-05');
  SELECT count(*) INTO n FROM public.bloques_turno
   WHERE personal_id = MARIO AND fecha = DATE '2027-06-03';
  IF n <> 0 THEN RAISE EXCEPTION '45b: la excepción no impidió que el día volviera (% bloques)', n; END IF;
  SELECT count(*) INTO n FROM public.bloques_turno
   WHERE personal_id = MARIO AND fecha BETWEEN DATE '2027-06-01' AND DATE '2027-06-05';
  IF n <> 4 THEN RAISE EXCEPTION '45c: re-generar duplicó o comió días (quedaron %)', n; END IF;
  RAISE NOTICE 'OK 45 la excepción saca el día del generador, y re-generar N veces no duplica';

  -- ── 46. Retirar la excepción devuelve el día ───────────────────────────
  DELETE FROM public.excepciones_turno WHERE id = v_ex;
  PERFORM public.generar_bloques_turno(PR, DATE '2027-06-03', DATE '2027-06-03');
  SELECT count(*) INTO n FROM public.bloques_turno
   WHERE personal_id = MARIO AND fecha = DATE '2027-06-03';
  IF n <> 1 THEN RAISE EXCEPTION '46: al borrar la excepción el día debía volver, quedaron %', n; END IF;
  RAISE NOTICE 'OK 46 retirar la excepción devuelve el día a su regla';

  -- ── 47. La FK compuesta rechaza al empleado de otra empresa ────────────
  -- Conocer el UUID no alcanza: el par (company_id, project_id) tiene que casar.
  BEGIN
    INSERT INTO public.excepciones_turno (company_id, project_id, personal_id, fecha)
      VALUES (CO_VEC, PR_VEC, MARIO, DATE '2027-07-01');
    RAISE EXCEPTION '47a: se aceptó una excepción con un empleado de otra empresa';
  EXCEPTION WHEN foreign_key_violation THEN NULL;
  END;
  -- Ni el del otro condominio de la MISMA empresa.
  BEGIN
    INSERT INTO public.excepciones_turno (company_id, project_id, personal_id, fecha)
      VALUES (CO, PR_OTRO, MARIO, DATE '2027-07-02');
    RAISE EXCEPTION '47b: se aceptó una excepción con un empleado de otro condominio';
  EXCEPTION WHEN foreign_key_violation THEN NULL;
  END;
  RAISE NOTICE 'OK 47 las FKs compuestas cierran la referencia cruzada de empresa y de proyecto';

  -- ── 48. `creado_por` no se puede falsificar ────────────────────────────
  PERFORM set_config('app.uid', ANA::text, true);
  INSERT INTO public.excepciones_turno (company_id, project_id, personal_id, fecha, creado_por)
    VALUES (CO, PR, MARIO, DATE '2027-08-01', 'e0000000-0000-0000-0000-00000000000c')
    RETURNING id INTO v_ex;
  IF (SELECT creado_por FROM public.excepciones_turno WHERE id = v_ex) IS DISTINCT FROM ANA THEN
    RAISE EXCEPTION '48a: el cliente logró sellar un creado_por ajeno';
  END IF;
  UPDATE public.excepciones_turno SET creado_por = CARO WHERE id = v_ex;
  IF (SELECT creado_por FROM public.excepciones_turno WHERE id = v_ex) IS DISTINCT FROM ANA THEN
    RAISE EXCEPTION '48b: creado_por se pudo cambiar después';
  END IF;
  DELETE FROM public.excepciones_turno WHERE id = v_ex;
  RAISE NOTICE 'OK 48 creado_por lo sella la BD y es inmutable';
END;
$$;

-- Las cuatro operaciones de excepciones_turno, con roles reales.
DO $$
DECLARE
  CO    uuid := 'aaaaaaaa-0000-0000-0000-000000000001';
  PR    uuid := '11111111-0000-0000-0000-000000000001';
  LUCIA uuid := '50000000-0000-0000-0000-000000000002';
  BETO  uuid := 'e0000000-0000-0000-0000-00000000000b';
  CARO  uuid := 'e0000000-0000-0000-0000-00000000000c';
  FEDE  uuid := 'e0000000-0000-0000-0000-00000000000f';
  v_ex  uuid;
  n     bigint;
BEGIN
  SET LOCAL ROLE turnos_tester;

  -- ── 49. Con el permiso del tab: las cuatro operaciones funcionan ───────
  PERFORM set_config('app.uid', BETO::text, true);
  INSERT INTO public.excepciones_turno (company_id, project_id, personal_id, fecha, motivo)
    VALUES (CO, PR, LUCIA, DATE '2027-09-10', 'permiso') RETURNING id INTO v_ex;
  SELECT count(*) INTO n FROM public.excepciones_turno WHERE id = v_ex;
  IF n <> 1 THEN RAISE EXCEPTION '49a: no pudo leer la excepción que acaba de crear'; END IF;
  UPDATE public.excepciones_turno SET motivo = 'permiso sin goce' WHERE id = v_ex;
  IF (SELECT motivo FROM public.excepciones_turno WHERE id = v_ex) <> 'permiso sin goce' THEN
    RAISE EXCEPTION '49b: el UPDATE no surtió efecto'; END IF;
  RAISE NOTICE 'OK 49 con el permiso de editar en Turnos: insert, select y update de excepciones';

  -- ── 50. La empresa vecina no la ve ni la borra ─────────────────────────
  PERFORM set_config('app.uid', CARO::text, true);
  SELECT count(*) INTO n FROM public.excepciones_turno;
  IF n <> 0 THEN RAISE EXCEPTION '50a: la empresa vecina vio % excepciones ajenas', n; END IF;
  DELETE FROM public.excepciones_turno WHERE id = v_ex;

  -- ── …ni el otro condominio de la misma empresa ─────────────────────────
  PERFORM set_config('app.uid', FEDE::text, true);
  SELECT count(*) INTO n FROM public.excepciones_turno;
  IF n <> 0 THEN RAISE EXCEPTION '50b: otro condominio de la misma empresa vio % excepciones', n; END IF;
  DELETE FROM public.excepciones_turno WHERE id = v_ex;

  RESET ROLE;
  SELECT count(*) INTO n FROM public.excepciones_turno WHERE id = v_ex;
  IF n <> 1 THEN RAISE EXCEPTION '50c: alguien ajeno logró borrar la excepción'; END IF;
  RAISE NOTICE 'OK 50 el aislamiento de excepciones_turno se sostiene por empresa Y por proyecto';

  -- ── 51. Sin sesión, nada ───────────────────────────────────────────────
  SET LOCAL ROLE turnos_tester;
  PERFORM set_config('app.uid', '', true);
  SELECT count(*) INTO n FROM public.excepciones_turno;
  IF n <> 0 THEN RAISE EXCEPTION '51: sin sesión se vieron % excepciones', n; END IF;
  RESET ROLE;

  -- Y el dueño del tab sí puede borrar la suya.
  SET LOCAL ROLE turnos_tester;
  PERFORM set_config('app.uid', BETO::text, true);
  DELETE FROM public.excepciones_turno WHERE id = v_ex;
  RESET ROLE;
  SELECT count(*) INTO n FROM public.excepciones_turno WHERE id = v_ex;
  IF n <> 0 THEN RAISE EXCEPTION '51b: el dueño del tab no pudo borrar su excepción'; END IF;
  RAISE NOTICE 'OK 51 sin sesión no se lee ninguna excepción; con el permiso sí se borra';

  -- ── 52. El ACL de la tabla es el declarado, no el heredado ─────────────
  -- En Supabase, `ALTER DEFAULT PRIVILEGES` concede TODO sobre cada tabla nueva
  -- de `public` a anon y authenticated. La migración lo revoca y vuelve a
  -- conceder sólo el DML; esto comprueba el resultado.
  --
  -- TRUNCATE es el que no puede quedarse: **no pasa por RLS**. Con él, un solo
  -- TRUNCATE por cualquier vía SECURITY INVOKER vacía las excepciones de TODAS
  -- las empresas con las cuatro policies intactas y sin dejar rastro.
  IF has_table_privilege('authenticated', 'public.excepciones_turno', 'TRUNCATE')
     OR has_table_privilege('authenticated', 'public.excepciones_turno', 'REFERENCES')
     OR has_table_privilege('authenticated', 'public.excepciones_turno', 'TRIGGER') THEN
    RAISE EXCEPTION '52a: authenticated conserva TRUNCATE/REFERENCES/TRIGGER sobre excepciones_turno';
  END IF;

  IF NOT (has_table_privilege('authenticated', 'public.excepciones_turno', 'SELECT')
      AND has_table_privilege('authenticated', 'public.excepciones_turno', 'INSERT')
      AND has_table_privilege('authenticated', 'public.excepciones_turno', 'UPDATE')
      AND has_table_privilege('authenticated', 'public.excepciones_turno', 'DELETE')) THEN
    RAISE EXCEPTION '52b: authenticated perdió alguno de los cuatro privilegios de DML';
  END IF;

  IF has_table_privilege('anon', 'public.excepciones_turno', 'SELECT')
     OR has_table_privilege('anon', 'public.excepciones_turno', 'TRUNCATE') THEN
    RAISE EXCEPTION '52c: anon conserva privilegios sobre excepciones_turno';
  END IF;
  RAISE NOTICE 'OK 52 el ACL de excepciones_turno es el declarado: DML y nada más';

  RAISE NOTICE '── 8 invariantes de excepciones_turno OK ──';
END;
$$;

-- ══ J. Autorización por ACCIÓN, no por visibilidad ═════════════════════════
-- `condominios.tab.turnos` a secas significa «ves el tab». 20260916221839 dejó
-- de aceptarlo para escribir, porque la UI (canActInCondominiosTab) nunca lo
-- aceptó y una base más laxa que el botón es la forma cara de equivocarse: el
-- botón se esconde y la API sigue abierta.
--
-- Tres perfiles, tres respuestas distintas a la misma petición.
DO $$
DECLARE
  CO       uuid := 'aaaaaaaa-0000-0000-0000-000000000001';
  PR       uuid := '11111111-0000-0000-0000-000000000001';
  PEDRO    uuid := '50000000-0000-0000-0000-000000000001';
  BETO     uuid := 'e0000000-0000-0000-0000-00000000000b';  -- visibilidad + acciones
  TINO     uuid := 'e0000000-0000-0000-0000-000000000010';  -- SÓLO visibilidad
  LOLA     uuid := 'e0000000-0000-0000-0000-000000000011';  -- visibilidad + legado
  v_ph     uuid;
  v_b      uuid;
  v_ex     uuid;
  n        bigint;
  afectadas integer;
BEGIN
  SELECT ph.id INTO v_ph FROM public.plantillas_horario ph WHERE ph.project_id = PR LIMIT 1;

  -- Un bloque y una excepción, puestos por el dueño de las tablas, sobre los
  -- que Tino intentará escribir. Fecha futura y limpia: si algo lo rechaza
  -- tiene que ser el PERMISO, no el trigger de integridad.
  INSERT INTO public.bloques_turno (company_id, project_id, personal_id, plantilla_horario_id,
                                    turno, fecha, estado)
    VALUES (CO, PR, PEDRO, v_ph, 'manana', CURRENT_DATE + 40, 'pendiente')
    RETURNING id INTO v_b;
  INSERT INTO public.excepciones_turno (company_id, project_id, personal_id, fecha, motivo)
    VALUES (CO, PR, PEDRO, CURRENT_DATE + 41, 'sembrada para la prueba')
    RETURNING id INTO v_ex;

  SET LOCAL ROLE turnos_tester;
  PERFORM set_config('app.uid', TINO::text, true);

  -- ── 53. Ver el calendario SÍ: la lectura sigue siendo por visibilidad ──
  SELECT count(*) INTO n FROM public.asignaciones_turno;
  IF n = 0 THEN RAISE EXCEPTION '53a: con la clave base debía ver las reglas y vio 0'; END IF;
  SELECT count(*) INTO n FROM public.bloques_turno;
  IF n = 0 THEN RAISE EXCEPTION '53b: con la clave base debía ver los bloques y vio 0'; END IF;
  SELECT count(*) INTO n FROM public.excepciones_turno;
  IF n = 0 THEN RAISE EXCEPTION '53c: con la clave base debía ver las excepciones y vio 0'; END IF;
  RAISE NOTICE 'OK 53 sólo con la visibilidad del tab se LEE el calendario entero';

  -- ── 54. …pero no crear una excepción ───────────────────────────────────
  BEGIN
    INSERT INTO public.excepciones_turno (company_id, project_id, personal_id, fecha)
      VALUES (CO, PR, PEDRO, CURRENT_DATE + 42);
    RAISE EXCEPTION '54: creó una excepción con sólo la visibilidad del tab';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  RAISE NOTICE 'OK 54 la visibilidad no autoriza a crear excepciones (42501)';

  -- ── 55. …ni modificarla, ni retirarla ──────────────────────────────────
  -- Aquí la RLS no lanza: filtra. «0 filas afectadas» es la otra forma del no.
  UPDATE public.excepciones_turno SET motivo = 'pirateado' WHERE id = v_ex;
  GET DIAGNOSTICS afectadas = ROW_COUNT;
  IF afectadas <> 0 THEN RAISE EXCEPTION '55a: actualizó % excepciones sin permiso de acción', afectadas; END IF;
  DELETE FROM public.excepciones_turno WHERE id = v_ex;
  GET DIAGNOSTICS afectadas = ROW_COUNT;
  IF afectadas <> 0 THEN RAISE EXCEPTION '55b: borró % excepciones sin permiso de acción', afectadas; END IF;
  RAISE NOTICE 'OK 55 la visibilidad no autoriza a modificar ni retirar excepciones (0 filas)';

  -- ── 56. …ni escribir bloques ───────────────────────────────────────────
  BEGIN
    INSERT INTO public.bloques_turno (company_id, project_id, personal_id, plantilla_horario_id,
                                      turno, fecha, estado)
      VALUES (CO, PR, PEDRO, v_ph, 'tarde', CURRENT_DATE + 43, 'pendiente');
    RAISE EXCEPTION '56a: creó un bloque con sólo la visibilidad del tab';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  UPDATE public.bloques_turno SET notas = 'pirateado' WHERE id = v_b;
  GET DIAGNOSTICS afectadas = ROW_COUNT;
  IF afectadas <> 0 THEN RAISE EXCEPTION '56b: actualizó % bloques sin permiso de acción', afectadas; END IF;
  DELETE FROM public.bloques_turno WHERE id = v_b;
  GET DIAGNOSTICS afectadas = ROW_COUNT;
  IF afectadas <> 0 THEN RAISE EXCEPTION '56c: borró % bloques sin permiso de acción', afectadas; END IF;
  RAISE NOTICE 'OK 56 la visibilidad no autoriza a crear, cambiar ni borrar bloques';

  -- ── 57. …ni generar el mes ─────────────────────────────────────────────
  BEGIN
    PERFORM public.generar_bloques_turno(PR, CURRENT_DATE + 40, CURRENT_DATE + 45);
    RAISE EXCEPTION '57: generó el mes con sólo la visibilidad del tab';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  RAISE NOTICE 'OK 57 generar el mes exige CREAR en Turnos, no verlo (42501)';

  -- ── 58. …ni usar las RPC del día ───────────────────────────────────────
  BEGIN
    PERFORM public.turnos_guardar_dia(PR, PEDRO, CURRENT_DATE + 44, v_ph);
    RAISE EXCEPTION '58a: guardó un día con sólo la visibilidad del tab';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    PERFORM public.turnos_quitar_dia(PR, PEDRO, CURRENT_DATE + 40);
    RAISE EXCEPTION '58b: quitó un día con sólo la visibilidad del tab';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    PERFORM public.turnos_restaurar_dia(PR, PEDRO, CURRENT_DATE + 41);
    RAISE EXCEPTION '58c: restauró un día con sólo la visibilidad del tab';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  RAISE NOTICE 'OK 58 las tres RPC del día exigen EDITAR en Turnos (42501)';

  -- Y nada de lo anterior tocó una sola fila.
  RESET ROLE;
  SELECT count(*) INTO n FROM public.bloques_turno WHERE id = v_b AND notas IS NULL;
  IF n <> 1 THEN RAISE EXCEPTION '58d: el bloque sembrado no sobrevivió intacto'; END IF;
  SELECT count(*) INTO n FROM public.excepciones_turno WHERE id = v_ex AND motivo = 'sembrada para la prueba';
  IF n <> 1 THEN RAISE EXCEPTION '58e: la excepción sembrada no sobrevivió intacta'; END IF;

  -- ── 59. Con el permiso de ACCIÓN, las mismas operaciones pasan ──────────
  SET LOCAL ROLE turnos_tester;
  PERFORM set_config('app.uid', BETO::text, true);

  PERFORM public.generar_bloques_turno(PR, CURRENT_DATE + 40, CURRENT_DATE + 45);

  PERFORM public.turnos_guardar_dia(PR, PEDRO, CURRENT_DATE + 44, v_ph);
  SELECT count(*) INTO n FROM public.bloques_turno
   WHERE personal_id = PEDRO AND fecha = CURRENT_DATE + 44;
  IF n <> 1 THEN RAISE EXCEPTION '59a: con turnos.edit debía quedar 1 bloque, quedaron %', n; END IF;

  PERFORM public.turnos_quitar_dia(PR, PEDRO, CURRENT_DATE + 44);
  SELECT count(*) INTO n FROM public.bloques_turno
   WHERE personal_id = PEDRO AND fecha = CURRENT_DATE + 44;
  IF n <> 0 THEN RAISE EXCEPTION '59b: el bloque debía irse con la excepción, quedaron %', n; END IF;

  PERFORM public.turnos_restaurar_dia(PR, PEDRO, CURRENT_DATE + 44);
  SELECT count(*) INTO n FROM public.excepciones_turno
   WHERE personal_id = PEDRO AND fecha = CURRENT_DATE + 44;
  IF n <> 0 THEN RAISE EXCEPTION '59c: la excepción debía retirarse, quedaron %', n; END IF;
  RAISE NOTICE 'OK 59 con turnos.create/edit: generar, guardar, quitar y restaurar funcionan';

  -- ── 60. Y el camino LEGADO sigue abierto ───────────────────────────────
  -- platform.condominios.view + .create/.edit, sin claves por tab. Los roles
  -- creados antes de la granularidad no pueden perder lo que ya hacían.
  PERFORM set_config('app.uid', LOLA::text, true);
  PERFORM public.generar_bloques_turno(PR, CURRENT_DATE + 46, CURRENT_DATE + 47);
  PERFORM public.turnos_guardar_dia(PR, PEDRO, CURRENT_DATE + 48, v_ph);
  SELECT count(*) INTO n FROM public.bloques_turno
   WHERE personal_id = PEDRO AND fecha = CURRENT_DATE + 48;
  IF n <> 1 THEN RAISE EXCEPTION '60: el fallback legado no pudo guardar el día'; END IF;
  RESET ROLE;
  RAISE NOTICE 'OK 60 el fallback legado (platform.condominios.view + acción) sigue valiendo';

  RAISE NOTICE '── 8 invariantes de autorización por acción OK ──';
END;
$$;

-- ══ K. Un día se edita en UNA transacción ══════════════════════════════════
-- Quitar un día son dos escrituras y reasignarlo otras dos. Encadenarlas desde
-- el navegador deja una ventana en la que la base se contradice: un día quitado
-- con su turno vivo, o un turno vivo marcado como quitado. Las RPC de
-- 20260916221839 las meten en un commit; esto comprueba que de verdad es uno.
DO $$
DECLARE
  CO      uuid := 'aaaaaaaa-0000-0000-0000-000000000001';
  PR      uuid := '11111111-0000-0000-0000-000000000001';
  LUCIA   uuid := '50000000-0000-0000-0000-000000000002';
  BETO    uuid := 'e0000000-0000-0000-0000-00000000000b';
  v_ph    uuid;
  v_b     uuid;
  v_t     uuid;
  n       bigint;
  v_msg   text;
BEGIN
  SELECT ph.id INTO v_ph FROM public.plantillas_horario ph WHERE ph.project_id = PR LIMIT 1;

  SET LOCAL ROLE turnos_tester;
  PERFORM set_config('app.uid', BETO::text, true);

  -- ── 61. Guardar un día retira la excepción en el MISMO commit ──────────
  PERFORM public.turnos_quitar_dia(PR, LUCIA, CURRENT_DATE + 60);
  SELECT count(*) INTO n FROM public.excepciones_turno
   WHERE personal_id = LUCIA AND fecha = CURRENT_DATE + 60;
  IF n <> 1 THEN RAISE EXCEPTION '61a: quitar el día debía dejar 1 excepción, dejó %', n; END IF;

  PERFORM public.turnos_guardar_dia(PR, LUCIA, CURRENT_DATE + 60, v_ph);
  SELECT count(*) INTO n FROM public.bloques_turno
   WHERE personal_id = LUCIA AND fecha = CURRENT_DATE + 60;
  IF n <> 1 THEN RAISE EXCEPTION '61b: reasignar debía dejar 1 bloque, dejó %', n; END IF;
  SELECT count(*) INTO n FROM public.excepciones_turno
   WHERE personal_id = LUCIA AND fecha = CURRENT_DATE + 60;
  IF n <> 0 THEN RAISE EXCEPTION '61c: reasignar debía retirar la excepción, quedaron %', n; END IF;
  RAISE NOTICE 'OK 61 guardar un día escribe el bloque y retira la excepción a la vez';

  -- ── 62. Quitar un día borra el bloque en el MISMO commit ───────────────
  PERFORM public.turnos_quitar_dia(PR, LUCIA, CURRENT_DATE + 60, NULL, 'cambio con Pérez');
  SELECT count(*) INTO n FROM public.bloques_turno
   WHERE personal_id = LUCIA AND fecha = CURRENT_DATE + 60;
  IF n <> 0 THEN RAISE EXCEPTION '62a: quitar debía borrar el bloque, quedaron %', n; END IF;
  SELECT count(*) INTO n FROM public.excepciones_turno
   WHERE personal_id = LUCIA AND fecha = CURRENT_DATE + 60 AND motivo = 'cambio con Pérez';
  IF n <> 1 THEN RAISE EXCEPTION '62b: quitar debía dejar la excepción con su motivo'; END IF;
  RAISE NOTICE 'OK 62 quitar un día crea la excepción y borra el bloque a la vez';

  -- ── 63. Si el trigger rechaza el borrado, NO queda excepción huérfana ──
  -- Éste es el caso que justifica la transacción. Antes, la UI creaba la
  -- excepción, el borrado fallaba, y el «deshacer» era otra petición de red que
  -- también podía perderse: el día quedaba marcado como quitado con su turno
  -- intacto. Ahora la excepción se va con el rollback.
  RESET ROLE;
  INSERT INTO public.bloques_turno (company_id, project_id, personal_id, plantilla_horario_id,
                                    turno, fecha, estado)
    VALUES (CO, PR, LUCIA, v_ph, 'manana', CURRENT_DATE + 61, 'pendiente')
    RETURNING id INTO v_b;
  INSERT INTO public.tareas_bloque (bloque_id, titulo) VALUES (v_b, 'Barrer el lobby')
    RETURNING id INTO v_t;

  SET LOCAL ROLE turnos_tester;
  PERFORM set_config('app.uid', BETO::text, true);
  BEGIN
    PERFORM public.turnos_quitar_dia(PR, LUCIA, CURRENT_DATE + 61);
    RAISE EXCEPTION '63a: quitó un día cuyo bloque tiene checklist';
  EXCEPTION WHEN restrict_violation THEN
    GET STACKED DIAGNOSTICS v_msg = MESSAGE_TEXT;
    -- El mensaje que sube es el del TRIGGER, sin reescribir: es el que dice
    -- cuál de las condiciones falló.
    IF v_msg NOT LIKE '%tarea(s) asociada(s)%' THEN
      RAISE EXCEPTION '63b: el mensaje del trigger no llegó intacto: %', v_msg;
    END IF;
  END;
  RESET ROLE;

  SELECT count(*) INTO n FROM public.excepciones_turno
   WHERE personal_id = LUCIA AND fecha = CURRENT_DATE + 61;
  IF n <> 0 THEN RAISE EXCEPTION '63c: quedó una excepción huérfana tras el rechazo'; END IF;
  SELECT count(*) INTO n FROM public.bloques_turno WHERE id = v_b;
  IF n <> 1 THEN RAISE EXCEPTION '63d: el bloque rechazado no sobrevivió'; END IF;
  SELECT count(*) INTO n FROM public.tareas_bloque WHERE id = v_t;
  IF n <> 1 THEN RAISE EXCEPTION '63e: la tarea no sobrevivió al intento'; END IF;
  RAISE NOTICE 'OK 63 si el trigger rechaza, la excepción se revierte con él y sube su mensaje';

  -- ── 64. Restaurar es idempotente, y quitar dos veces también ───────────
  SET LOCAL ROLE turnos_tester;
  PERFORM set_config('app.uid', BETO::text, true);
  IF public.turnos_restaurar_dia(PR, LUCIA, CURRENT_DATE + 60) <> 1 THEN
    RAISE EXCEPTION '64a: restaurar debía retirar 1 excepción'; END IF;
  IF public.turnos_restaurar_dia(PR, LUCIA, CURRENT_DATE + 60) <> 0 THEN
    RAISE EXCEPTION '64b: restaurar dos veces debía retirar 0 la segunda'; END IF;

  PERFORM public.turnos_quitar_dia(PR, LUCIA, CURRENT_DATE + 62);
  PERFORM public.turnos_quitar_dia(PR, LUCIA, CURRENT_DATE + 62);
  SELECT count(*) INTO n FROM public.excepciones_turno
   WHERE personal_id = LUCIA AND fecha = CURRENT_DATE + 62;
  IF n <> 1 THEN RAISE EXCEPTION '64c: quitar dos veces dejó % excepciones', n; END IF;
  RESET ROLE;
  RAISE NOTICE 'OK 64 restaurar y quitar son idempotentes: repetir no duplica ni rompe';

  -- ── 65. Ni con un UUID ajeno se escribe fuera del inquilino ────────────
  SET LOCAL ROLE turnos_tester;
  PERFORM set_config('app.uid', BETO::text, true);
  BEGIN
    PERFORM public.turnos_guardar_dia('11111111-0000-0000-0000-000000000003',
                                      LUCIA, CURRENT_DATE + 63, v_ph);
    RAISE EXCEPTION '65a: escribió en un condominio que no tiene asignado';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    PERFORM public.turnos_guardar_dia(PR, '50000000-0000-0000-0000-000000000009',
                                      CURRENT_DATE + 63, v_ph);
    RAISE EXCEPTION '65b: escribió sobre un empleado que no es de este condominio';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  RESET ROLE;
  RAISE NOTICE 'OK 65 las RPC validan proyecto y empleado: un UUID ajeno no basta';

  RAISE NOTICE '── 5 invariantes de edición atómica del día OK ──';
END;
$$;

-- ══ L. El alcance es por PROYECTO, no por empresa ══════════════════════════
-- Una empresa puede tener varios condominios y el acceso se concede por
-- proyecto. Hasta 20260916232549, `bloques_turno_insert` y `_update`
-- comprobaban `company_id` y el permiso de acción pero NO
-- `can_access_project`: quien administraba el condominio 1 podía escribirle la
-- agenda al personal del condominio 3 de la misma empresa. El SELECT y el
-- DELETE sí lo comprobaban; el alta y el cambio, no.
DO $$
DECLARE
  CO      uuid := 'aaaaaaaa-0000-0000-0000-000000000001';
  PR_A    uuid := '11111111-0000-0000-0000-000000000001';  -- el de Beto
  PR_B    uuid := '11111111-0000-0000-0000-000000000003';  -- el de Fede
  PEDRO   uuid := '50000000-0000-0000-0000-000000000001';  -- de PR_A
  NORA    uuid := '50000000-0000-0000-0000-000000000004';  -- de PR_B
  BETO    uuid := 'e0000000-0000-0000-0000-00000000000b';  -- turnos.edit en PR_A
  FEDE    uuid := 'e0000000-0000-0000-0000-00000000000f';  -- turnos.edit en PR_B
  v_ph_a  uuid;
  v_ph_b  uuid;
  v_b_a   uuid;
  v_b_b   uuid;
  n       bigint;
  afectadas integer;
BEGIN
  SELECT ph.id INTO v_ph_a FROM public.plantillas_horario ph WHERE ph.project_id = PR_A LIMIT 1;
  INSERT INTO public.plantillas_horario (company_id, project_id, nombre, turno, hora_inicio, hora_fin)
    VALUES (CO, PR_B, 'Diurno del otro condo', 'manana', TIME '06:00', TIME '14:00')
    RETURNING id INTO v_ph_b;

  -- Un bloque limpio en cada condominio, puestos por el dueño de las tablas.
  INSERT INTO public.bloques_turno (company_id, project_id, personal_id, plantilla_horario_id,
                                    turno, fecha, estado)
    VALUES (CO, PR_A, PEDRO, v_ph_a, 'manana', CURRENT_DATE + 80, 'pendiente')
    RETURNING id INTO v_b_a;
  INSERT INTO public.bloques_turno (company_id, project_id, personal_id, plantilla_horario_id,
                                    turno, fecha, estado)
    VALUES (CO, PR_B, NORA, v_ph_b, 'manana', CURRENT_DATE + 80, 'pendiente')
    RETURNING id INTO v_b_b;

  SET LOCAL ROLE turnos_tester;
  PERFORM set_config('app.uid', BETO::text, true);

  -- ── 66. No puede DAR DE ALTA en el condominio que no administra ─────────
  BEGIN
    INSERT INTO public.bloques_turno (company_id, project_id, personal_id, plantilla_horario_id,
                                      turno, fecha, estado)
      VALUES (CO, PR_B, NORA, v_ph_b, 'tarde', CURRENT_DATE + 81, 'pendiente');
    RAISE EXCEPTION '66: creó un bloque en un condominio que no tiene asignado';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  RAISE NOTICE 'OK 66 con turnos.edit pero sin el proyecto, no se da de alta (42501)';

  -- ── 67. Ni CAMBIAR uno de allí ─────────────────────────────────────────
  UPDATE public.bloques_turno SET notas = 'pirateado' WHERE id = v_b_b;
  GET DIAGNOSTICS afectadas = ROW_COUNT;
  IF afectadas <> 0 THEN
    RAISE EXCEPTION '67: actualizó % bloques de otro condominio', afectadas; END IF;
  RAISE NOTICE 'OK 67 con turnos.edit pero sin el proyecto, no se actualiza (0 filas)';

  -- ── 68. Ni MOVER el suyo al condominio de al lado ───────────────────────
  -- Ésta es la puerta de atrás, y se cierra distinto que las otras dos: el
  -- USING SÍ deja tocar la fila —es del proyecto de Beto— así que no hay
  -- filtrado silencioso. Quien la rechaza es el WITH CHECK, evaluado sobre la
  -- fila NUEVA, y un WITH CHECK que falla LANZA (42501) en vez de afectar 0
  -- filas. Esa diferencia es la prueba de que el bloqueo viene de la mitad que
  -- faltaba, no del USING.
  BEGIN
    UPDATE public.bloques_turno SET project_id = PR_B, personal_id = NORA WHERE id = v_b_a;
    RAISE EXCEPTION '68a: movió el bloque a otro condominio';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  RESET ROLE;
  SELECT count(*) INTO n FROM public.bloques_turno WHERE id = v_b_a AND project_id = PR_A;
  IF n <> 1 THEN RAISE EXCEPTION '68b: el bloque no se quedó en su condominio'; END IF;
  RAISE NOTICE 'OK 68 el WITH CHECK impide mover un bloque a otro condominio';

  -- ── 69. Y quien SÍ administra ese condominio escribe con normalidad ─────
  -- Mismo rol RBAC que Beto; lo único distinto es a qué proyecto está asignado.
  SET LOCAL ROLE turnos_tester;
  PERFORM set_config('app.uid', FEDE::text, true);
  INSERT INTO public.bloques_turno (company_id, project_id, personal_id, plantilla_horario_id,
                                    turno, fecha, estado)
    VALUES (CO, PR_B, NORA, v_ph_b, 'tarde', CURRENT_DATE + 82, 'pendiente');
  UPDATE public.bloques_turno SET notas = 'legítimo' WHERE id = v_b_b;
  GET DIAGNOSTICS afectadas = ROW_COUNT;
  RESET ROLE;
  IF afectadas <> 1 THEN
    RAISE EXCEPTION '69: quien administra el condominio no pudo actualizar (% filas)', afectadas; END IF;
  SELECT count(*) INTO n FROM public.bloques_turno
   WHERE project_id = PR_B AND fecha = CURRENT_DATE + 82;
  IF n <> 1 THEN RAISE EXCEPTION '69b: quien administra el condominio no pudo dar de alta'; END IF;
  RAISE NOTICE 'OK 69 con el proyecto asignado, el mismo rol escribe con normalidad';

  RAISE NOTICE '── 4 invariantes de alcance por proyecto OK ──';
END;
$$;

-- ══ M. Re-planificar un día exige lo mismo que borrarlo ════════════════════
--
-- «La UI no es una frontera de seguridad». `turnos_guardar_dia` dejaba
-- cambiarle la jornada a un bloque pasado, iniciado, cerrado, no pendiente o
-- con dependencias: el calendario no ofrece el botón, pero la RPC estaba
-- publicada a `authenticated` y una llamada directa se saltaba el filtro.
--
-- CADA INVARIANTE AÍSLA UNA CONDICIÓN. El bloque de cada prueba está limpio en
-- todo lo demás, así que retirar esa condición de
-- `turnos_asegurar_bloque_libre` hace fallar ESA prueba y sólo ésa. Es lo que
-- las vuelve mutantes decisivos en vez de un paquete que pasa por accidente.
DO $$
DECLARE
  CO      uuid := 'aaaaaaaa-0000-0000-0000-000000000001';
  PR      uuid := '11111111-0000-0000-0000-000000000001';
  MARIO   uuid := '50000000-0000-0000-0000-000000000003';
  BETO    uuid := 'e0000000-0000-0000-0000-00000000000b';
  v_ph    uuid;
  v_otra  uuid;
  v_b     uuid;
  v_b2    uuid;
  v_t     uuid;
  v_ex    uuid;
  n       bigint;
  afectadas integer;
BEGIN
  SELECT ph.id INTO v_ph   FROM public.plantillas_horario ph WHERE ph.project_id = PR ORDER BY ph.nombre LIMIT 1;
  SELECT ph.id INTO v_otra FROM public.plantillas_horario ph WHERE ph.project_id = PR AND ph.id <> v_ph LIMIT 1;
  IF v_otra IS NULL THEN
    INSERT INTO public.plantillas_horario (company_id, project_id, nombre, turno, hora_inicio, hora_fin)
      VALUES (CO, PR, 'Vespertino de prueba', 'tarde', TIME '14:00', TIME '22:00')
      RETURNING id INTO v_otra;
  END IF;

  -- ── 70. Guardar un día PASADO: la RPC lo rechaza ───────────────────────
  SET LOCAL ROLE turnos_tester;
  PERFORM set_config('app.uid', BETO::text, true);
  BEGIN
    PERFORM public.turnos_guardar_dia(PR, MARIO, CURRENT_DATE - 1, v_ph);
    RAISE EXCEPTION '70: guardó un día pasado';
  EXCEPTION WHEN restrict_violation THEN NULL;
  END;
  RESET ROLE;
  SELECT count(*) INTO n FROM public.bloques_turno
   WHERE personal_id = MARIO AND fecha = CURRENT_DATE - 1;
  IF n <> 0 THEN RAISE EXCEPTION '70b: el rechazo dejó un bloque creado'; END IF;
  RAISE NOTICE 'OK 70 guardar una fecha pasada falla y no deja nada creado';

  -- ── 71. Quitar un día PASADO ───────────────────────────────────────────
  SET LOCAL ROLE turnos_tester;
  PERFORM set_config('app.uid', BETO::text, true);
  BEGIN
    PERFORM public.turnos_quitar_dia(PR, MARIO, CURRENT_DATE - 2);
    RAISE EXCEPTION '71: quitó un día pasado';
  EXCEPTION WHEN restrict_violation THEN NULL;
  END;
  RESET ROLE;
  SELECT count(*) INTO n FROM public.excepciones_turno
   WHERE personal_id = MARIO AND fecha = CURRENT_DATE - 2;
  IF n <> 0 THEN RAISE EXCEPTION '71b: el rechazo dejó una excepción creada'; END IF;
  RAISE NOTICE 'OK 71 quitar una fecha pasada falla y no deja excepción';

  -- ── 72. Restaurar un día PASADO ────────────────────────────────────────
  INSERT INTO public.excepciones_turno (company_id, project_id, personal_id, fecha, motivo)
    VALUES (CO, PR, MARIO, CURRENT_DATE - 3, 'histórica') RETURNING id INTO v_ex;
  SET LOCAL ROLE turnos_tester;
  PERFORM set_config('app.uid', BETO::text, true);
  BEGIN
    PERFORM public.turnos_restaurar_dia(PR, MARIO, CURRENT_DATE - 3);
    RAISE EXCEPTION '72: restauró un día pasado';
  EXCEPTION WHEN restrict_violation THEN NULL;
  END;
  RESET ROLE;
  SELECT count(*) INTO n FROM public.excepciones_turno WHERE id = v_ex;
  IF n <> 1 THEN RAISE EXCEPTION '72b: el rechazo borró la excepción histórica'; END IF;
  RAISE NOTICE 'OK 72 restaurar una fecha pasada falla y la excepción sigue intacta';

  -- ── 73. Cambiar la jornada de un bloque INICIADO ───────────────────────
  INSERT INTO public.bloques_turno (company_id, project_id, personal_id, plantilla_horario_id,
                                    turno, fecha, estado, iniciado_en)
    VALUES (CO, PR, MARIO, v_ph, 'manana', CURRENT_DATE + 90, 'pendiente', now())
    RETURNING id INTO v_b;
  SET LOCAL ROLE turnos_tester;
  PERFORM set_config('app.uid', BETO::text, true);
  BEGIN
    PERFORM public.turnos_guardar_dia(PR, MARIO, CURRENT_DATE + 90, v_otra);
    RAISE EXCEPTION '73a: cambió la jornada de un bloque iniciado';
  EXCEPTION WHEN restrict_violation THEN NULL;
  END;
  -- Y por la puerta directa, sin pasar por la RPC.
  BEGIN
    UPDATE public.bloques_turno SET plantilla_horario_id = v_otra WHERE id = v_b;
    RAISE EXCEPTION '73b: el UPDATE directo cambió la jornada de un bloque iniciado';
  EXCEPTION WHEN restrict_violation THEN NULL;
  END;
  RESET ROLE;
  SELECT count(*) INTO n FROM public.bloques_turno WHERE id = v_b AND plantilla_horario_id = v_ph;
  IF n <> 1 THEN RAISE EXCEPTION '73c: el bloque iniciado cambió de jornada'; END IF;
  RAISE NOTICE 'OK 73 un bloque iniciado no cambia de jornada, ni por RPC ni por UPDATE';

  -- ── 74. …ni uno CERRADO ────────────────────────────────────────────────
  INSERT INTO public.bloques_turno (company_id, project_id, personal_id, plantilla_horario_id,
                                    turno, fecha, estado, cerrado_en)
    VALUES (CO, PR, MARIO, v_ph, 'tarde', CURRENT_DATE + 91, 'pendiente', now())
    RETURNING id INTO v_b;
  SET LOCAL ROLE turnos_tester;
  PERFORM set_config('app.uid', BETO::text, true);
  BEGIN
    UPDATE public.bloques_turno SET plantilla_horario_id = v_otra WHERE id = v_b;
    RAISE EXCEPTION '74a: cambió la jornada de un bloque cerrado';
  EXCEPTION WHEN restrict_violation THEN NULL;
  END;
  RESET ROLE;
  SELECT count(*) INTO n FROM public.bloques_turno WHERE id = v_b AND plantilla_horario_id = v_ph;
  IF n <> 1 THEN RAISE EXCEPTION '74b: el bloque cerrado cambió de jornada'; END IF;
  RAISE NOTICE 'OK 74 un bloque cerrado no cambia de jornada';

  -- ── 75. …ni uno que no está PENDIENTE ──────────────────────────────────
  INSERT INTO public.bloques_turno (company_id, project_id, personal_id, plantilla_horario_id,
                                    turno, fecha, estado)
    VALUES (CO, PR, MARIO, v_ph, 'noche', CURRENT_DATE + 92, 'incompleto')
    RETURNING id INTO v_b;
  SET LOCAL ROLE turnos_tester;
  PERFORM set_config('app.uid', BETO::text, true);
  BEGIN
    UPDATE public.bloques_turno SET plantilla_horario_id = v_otra WHERE id = v_b;
    RAISE EXCEPTION '75a: cambió la jornada de un bloque en estado incompleto';
  EXCEPTION WHEN restrict_violation THEN NULL;
  END;
  RESET ROLE;
  SELECT count(*) INTO n FROM public.bloques_turno WHERE id = v_b AND plantilla_horario_id = v_ph;
  IF n <> 1 THEN RAISE EXCEPTION '75b: el bloque no pendiente cambió de jornada'; END IF;
  RAISE NOTICE 'OK 75 un bloque fuera de pendiente no cambia de jornada';

  -- ── 76. …ni uno con TAREA, y la tarea sobrevive ────────────────────────
  INSERT INTO public.bloques_turno (company_id, project_id, personal_id, plantilla_horario_id,
                                    turno, fecha, estado)
    VALUES (CO, PR, MARIO, v_ph, 'manana', CURRENT_DATE + 93, 'pendiente')
    RETURNING id INTO v_b;
  INSERT INTO public.tareas_bloque (bloque_id, titulo) VALUES (v_b, 'Podar setos')
    RETURNING id INTO v_t;
  SET LOCAL ROLE turnos_tester;
  PERFORM set_config('app.uid', BETO::text, true);
  BEGIN
    PERFORM public.turnos_guardar_dia(PR, MARIO, CURRENT_DATE + 93, v_otra);
    RAISE EXCEPTION '76a: cambió la jornada de un bloque con checklist';
  EXCEPTION WHEN restrict_violation THEN NULL;
  END;
  RESET ROLE;
  SELECT count(*) INTO n FROM public.bloques_turno WHERE id = v_b AND plantilla_horario_id = v_ph;
  IF n <> 1 THEN RAISE EXCEPTION '76b: el bloque con checklist cambió de jornada'; END IF;
  SELECT count(*) INTO n FROM public.tareas_bloque WHERE id = v_t;
  IF n <> 1 THEN RAISE EXCEPTION '76c: la tarea no sobrevivió al intento'; END IF;
  RAISE NOTICE 'OK 76 un bloque con checklist no cambia de jornada, y la tarea sigue';

  -- ── 77. …ni uno con REVISIÓN ───────────────────────────────────────────
  -- Bloque NUEVO y sin tareas propias, por el mismo motivo que la invariante
  -- 40: sobre un bloque que ya tiene checklist saltaría antes la comprobación
  -- de tareas y ésta no se ejercitaría. La revisión apunta a la tarea de
  -- `v_b` y declara `bloque_id` del bloque nuevo.
  INSERT INTO public.bloques_turno (company_id, project_id, personal_id, plantilla_horario_id,
                                    turno, fecha, estado)
    VALUES (CO, PR, MARIO, v_ph, 'noche', CURRENT_DATE + 96, 'pendiente')
    RETURNING id INTO v_b2;
  INSERT INTO public.revisiones_tarea (tarea_id, bloque_id, revisado_por, estado)
    VALUES (v_t, v_b2, 'e0000000-0000-0000-0000-00000000000a', 'aprobado');
  SELECT count(*) INTO n FROM public.tareas_bloque WHERE bloque_id = v_b2;
  IF n <> 0 THEN RAISE EXCEPTION '77a: el bloque de la prueba debía estar SIN tareas propias'; END IF;
  SET LOCAL ROLE turnos_tester;
  PERFORM set_config('app.uid', BETO::text, true);
  BEGIN
    UPDATE public.bloques_turno SET plantilla_horario_id = v_otra WHERE id = v_b2;
    RAISE EXCEPTION '77b: cambió la jornada de un bloque con revisión';
  EXCEPTION WHEN restrict_violation THEN NULL;
  END;
  RESET ROLE;
  SELECT count(*) INTO n FROM public.revisiones_tarea WHERE bloque_id = v_b2;
  IF n <> 1 THEN RAISE EXCEPTION '77c: la revisión no sobrevivió al intento'; END IF;
  SELECT count(*) INTO n FROM public.bloques_turno WHERE id = v_b2 AND plantilla_horario_id = v_ph;
  IF n <> 1 THEN RAISE EXCEPTION '77d: el bloque con revisión cambió de jornada'; END IF;
  RAISE NOTICE 'OK 77 un bloque con revisión (y sin tareas propias) no cambia de jornada';

  -- ── 78. …ni uno con MARCAJE de presencia ───────────────────────────────
  INSERT INTO public.bloques_turno (company_id, project_id, personal_id, plantilla_horario_id,
                                    turno, fecha, estado)
    VALUES (CO, PR, MARIO, v_ph, 'tarde', CURRENT_DATE + 94, 'pendiente')
    RETURNING id INTO v_b;
  INSERT INTO public.presencia_personal
    (company_id, project_id, personal_id, nombre, fecha, hora_entrada, estado, bloque_id)
    VALUES (CO, PR, MARIO, 'Mario Jardinero', CURRENT_DATE + 94, TIME '06:00', 'presente', v_b);
  SET LOCAL ROLE turnos_tester;
  PERFORM set_config('app.uid', BETO::text, true);
  BEGIN
    UPDATE public.bloques_turno SET plantilla_horario_id = v_otra WHERE id = v_b;
    RAISE EXCEPTION '78a: cambió la jornada de un bloque con marcaje';
  EXCEPTION WHEN restrict_violation THEN NULL;
  END;
  RESET ROLE;
  SELECT count(*) INTO n FROM public.presencia_personal WHERE bloque_id = v_b;
  IF n <> 1 THEN RAISE EXCEPTION '78b: el marcaje no sobrevivió al intento'; END IF;
  RAISE NOTICE 'OK 78 un bloque con marcaje no cambia de jornada, y el marcaje sigue';

  -- ── 79. Lo limpio de hoy y del futuro SIGUE funcionando ────────────────
  -- Sin esto, las ocho de arriba se satisfarían con un trigger que lo bloquea
  -- todo, que es el fallo contrario y tan malo como el original.
  SET LOCAL ROLE turnos_tester;
  PERFORM set_config('app.uid', BETO::text, true);
  PERFORM public.turnos_guardar_dia(PR, MARIO, CURRENT_DATE, v_ph);
  PERFORM public.turnos_guardar_dia(PR, MARIO, CURRENT_DATE, v_otra);   -- y cambiarla
  PERFORM public.turnos_guardar_dia(PR, MARIO, CURRENT_DATE + 95, v_ph);
  RESET ROLE;
  SELECT count(*) INTO n FROM public.bloques_turno
   WHERE personal_id = MARIO AND fecha = CURRENT_DATE AND plantilla_horario_id = v_otra;
  IF n <> 1 THEN RAISE EXCEPTION '79a: hoy, limpio y pendiente, debía poder cambiar de jornada'; END IF;
  SELECT count(*) INTO n FROM public.bloques_turno
   WHERE personal_id = MARIO AND fecha = CURRENT_DATE + 95;
  IF n <> 1 THEN RAISE EXCEPTION '79b: el futuro limpio debía poder asignarse'; END IF;
  RAISE NOTICE 'OK 79 hoy y el futuro, pendientes y sin dependencias, siguen editándose';

  -- ── 80. Y el CICLO DE VIDA del turno no se toca ────────────────────────
  -- Iniciar, cerrar, puntuar y anotar son UPDATE legítimos sobre bloques
  -- pasados y en curso: es lo que hace «Tareas por turno» todos los días. Un
  -- trigger que los bloqueara rompería la operación diaria.
  INSERT INTO public.bloques_turno (company_id, project_id, personal_id, plantilla_horario_id,
                                    turno, fecha, estado)
    VALUES (CO, PR, MARIO, v_ph, 'manana', CURRENT_DATE - 10, 'pendiente')
    RETURNING id INTO v_b;
  SET LOCAL ROLE turnos_tester;
  PERFORM set_config('app.uid', BETO::text, true);
  UPDATE public.bloques_turno SET estado = 'en_curso', iniciado_en = now() WHERE id = v_b;
  GET DIAGNOSTICS afectadas = ROW_COUNT;
  IF afectadas <> 1 THEN RAISE EXCEPTION '80a: no se pudo INICIAR un bloque pasado'; END IF;
  UPDATE public.bloques_turno
     SET estado = 'completado', cerrado_en = now(), puntaje_completitud = 100, notas = 'sin novedad'
   WHERE id = v_b;
  GET DIAGNOSTICS afectadas = ROW_COUNT;
  IF afectadas <> 1 THEN RAISE EXCEPTION '80b: no se pudo CERRAR un bloque pasado'; END IF;
  RESET ROLE;
  RAISE NOTICE 'OK 80 iniciar, cerrar, puntuar y anotar siguen permitidos, también en el pasado';

  -- ── 81. Desvincular la jornada tampoco es re-planificar ────────────────
  -- `plantilla_horario_id` cuelga con ON DELETE SET NULL: borrar una jornada
  -- pone NULL en los bloques históricos y CONSERVA la foto de `politica`
  -- (20260913040300). Si el trigger lo tratara como re-planificación, borrar
  -- una jornada sería imposible en cuanto tuviera un solo día pasado.
  INSERT INTO public.plantillas_horario (company_id, project_id, nombre, turno, hora_inicio, hora_fin)
    VALUES (CO, PR, 'Efímera', 'noche', TIME '22:00', TIME '06:00')
    RETURNING id INTO v_otra;
  INSERT INTO public.bloques_turno (company_id, project_id, personal_id, plantilla_horario_id,
                                    turno, fecha, estado, iniciado_en, cerrado_en)
    VALUES (CO, PR, MARIO, v_otra, 'noche', CURRENT_DATE - 20, 'completado', now(), now())
    RETURNING id INTO v_b;
  DELETE FROM public.plantillas_horario WHERE id = v_otra;
  SELECT count(*) INTO n FROM public.bloques_turno WHERE id = v_b AND plantilla_horario_id IS NULL;
  IF n <> 1 THEN
    RAISE EXCEPTION '81: borrar una jornada debía desvincular el bloque histórico, no fallar'; END IF;
  RAISE NOTICE 'OK 81 borrar una jornada desvincula el histórico sin chocar con el trigger';

  RAISE NOTICE '── 12 invariantes de re-planificación segura OK ──';
END;
$$;
