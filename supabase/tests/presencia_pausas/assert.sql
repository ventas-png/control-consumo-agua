-- ════════════════════════════════════════════════════════════════════════════
-- Invariantes de 20260908000300 · las pausas de la jornada
-- ════════════════════════════════════════════════════════════════════════════
-- Cada bloque levanta si su afirmación no se cumple; el `RAISE NOTICE` es lo que
-- el runner imprime cuando sí. El orden importa: varias invariantes leen el
-- estado que dejó la anterior.
\set ON_ERROR_STOP on

-- Atajos de identidad (auth.uid() lee este GUC, como el claim del JWT).
\set MARCO   '''e0000000-0000-0000-0000-000000000002'''
\set SUPER   '''e0000000-0000-0000-0000-000000000003'''
\set ADA     '''e0000000-0000-0000-0000-00000000000d'''
\set NOE     '''e0000000-0000-0000-0000-000000000004'''
\set PROY    '''11111111-0000-0000-0000-000000000001'''
\set EMPRESA '''aaaaaaaa-0000-0000-0000-00000000000a'''

-- ── 1 · Sin jornada abierta no hay nada que pausar ──────────────────────────
DO $$
BEGIN
  PERFORM set_config('app.uid', 'e0000000-0000-0000-0000-000000000002', true);
  BEGIN
    PERFORM public.presencia_pausar(
      '11111111-0000-0000-0000-000000000001'::uuid, 'iniciar', 'almuerzo');
    RAISE EXCEPTION 'INVARIANTE 1: pausó sin haber marcado entrada';
  EXCEPTION WHEN sqlstate '22023' THEN
    NULL;
  END;
  RAISE NOTICE 'OK 1  antes de marcar entrada no se puede pausar';
END $$;

-- ── 2 · Iniciar: el instante lo pone el servidor, y no hay minutos todavía ──
DO $$
DECLARE
  v_reg   uuid;
  v_pausa uuid;
  v_fila  public.presencia_pausas%ROWTYPE;
BEGIN
  PERFORM set_config('app.uid', 'e0000000-0000-0000-0000-000000000002', true);
  SELECT registro_id INTO v_reg FROM public.presencia_marcar(
    '11111111-0000-0000-0000-000000000001'::uuid, 'entrada');

  SELECT pausa_id INTO v_pausa FROM public.presencia_pausar(
    '11111111-0000-0000-0000-000000000001'::uuid, 'iniciar', 'almuerzo');

  SELECT * INTO v_fila FROM public.presencia_pausas WHERE id = v_pausa;
  IF v_fila.inicio_en IS NULL THEN RAISE EXCEPTION 'INVARIANTE 2: sin instante de inicio'; END IF;
  IF v_fila.fin_en IS NOT NULL THEN RAISE EXCEPTION 'INVARIANTE 2: nació cerrada'; END IF;
  IF v_fila.minutos IS NOT NULL THEN RAISE EXCEPTION 'INVARIANTE 2: una pausa abierta no dura nada todavía'; END IF;
  IF v_fila.registro_id <> v_reg THEN RAISE EXCEPTION 'INVARIANTE 2: colgada del marcaje equivocado'; END IF;
  IF v_fila.origen <> 'autoservicio' THEN RAISE EXCEPTION 'INVARIANTE 2: origen incorrecto'; END IF;
  RAISE NOTICE 'OK 2  iniciar sella el instante en el servidor y deja la pausa abierta';
END $$;

-- ── 3 · Una pausa abierta a la vez ─────────────────────────────────────────
DO $$
BEGIN
  PERFORM set_config('app.uid', 'e0000000-0000-0000-0000-000000000002', true);
  BEGIN
    PERFORM public.presencia_pausar(
      '11111111-0000-0000-0000-000000000001'::uuid, 'iniciar', 'refaccion');
    RAISE EXCEPTION 'INVARIANTE 3: abrió una segunda pausa encima de la abierta';
  EXCEPTION WHEN sqlstate '23505' THEN
    NULL;
  END;
  RAISE NOTICE 'OK 3  no se abre una segunda pausa con una abierta';
END $$;

-- ── 4 · El tipo tiene que existir en el catálogo ────────────────────────────
DO $$
DECLARE v_reg uuid;
BEGIN
  PERFORM set_config('app.uid', 'e0000000-0000-0000-0000-000000000004', true);
  SELECT registro_id INTO v_reg FROM public.presencia_marcar(
    '11111111-0000-0000-0000-000000000001'::uuid, 'entrada');
  BEGIN
    PERFORM public.presencia_pausar(
      '11111111-0000-0000-0000-000000000001'::uuid, 'iniciar', 'siesta_larga');
    RAISE EXCEPTION 'INVARIANTE 4: aceptó un tipo que nadie configuró';
  EXCEPTION WHEN sqlstate '22023' THEN
    NULL;
  END;
  RAISE NOTICE 'OK 4  un tipo inventado se rechaza: su regla de planilla no la decidió nadie';
END $$;

-- ── 5 · Terminar sella los minutos DESDE LOS INSTANTES ─────────────────────
DO $$
DECLARE
  v_pausa uuid;
  v_fila  public.presencia_pausas%ROWTYPE;
BEGIN
  PERFORM set_config('app.uid', 'e0000000-0000-0000-0000-000000000002', true);
  -- Se retrasa el inicio 45 minutos para medir algo que no sea cero. Es lo
  -- ÚNICO que el test toca a mano, y lo hace como dueño, no por la RPC: por la
  -- RPC no hay forma de mandar una hora, que es exactamente el punto.
  UPDATE public.presencia_pausas SET inicio_en = now() - interval '45 minutes'
   WHERE fin_en IS NULL;

  SELECT pausa_id INTO v_pausa FROM public.presencia_pausar(
    '11111111-0000-0000-0000-000000000001'::uuid, 'terminar');

  SELECT * INTO v_fila FROM public.presencia_pausas WHERE id = v_pausa;
  IF v_fila.fin_en IS NULL THEN RAISE EXCEPTION 'INVARIANTE 5: no cerró'; END IF;
  IF v_fila.minutos IS NULL OR v_fila.minutos < 44.9 OR v_fila.minutos > 45.1 THEN
    RAISE EXCEPTION 'INVARIANTE 5: minutos mal sellados (%)', v_fila.minutos;
  END IF;
  RAISE NOTICE 'OK 5  terminar sella la duración desde los dos instantes (% min)', ROUND(v_fila.minutos);
END $$;

-- ── 6 · Terminar sin pausa abierta ─────────────────────────────────────────
DO $$
BEGIN
  PERFORM set_config('app.uid', 'e0000000-0000-0000-0000-000000000002', true);
  BEGIN
    PERFORM public.presencia_pausar('11111111-0000-0000-0000-000000000001'::uuid, 'terminar');
    RAISE EXCEPTION 'INVARIANTE 6: cerró una pausa que no existe';
  EXCEPTION WHEN sqlstate '22023' THEN
    NULL;
  END;
  RAISE NOTICE 'OK 6  terminar sin pausa abierta se rechaza';
END $$;

-- ── 7 · La regla de planilla se copia del catálogo ─────────────────────────
DO $$
DECLARE v_descuenta boolean;
BEGIN
  SELECT descuenta INTO v_descuenta FROM public.presencia_pausas WHERE tipo = 'almuerzo' LIMIT 1;
  IF v_descuenta IS NOT true THEN
    RAISE EXCEPTION 'INVARIANTE 7: el almuerzo debería descontar por defecto';
  END IF;
  RAISE NOTICE 'OK 7  el almuerzo nace descontando, como dice el default de la casa';
END $$;

-- ── 8 · Cambiar el catálogo NO reescribe lo ya registrado ──────────────────
DO $$
DECLARE
  v_antes boolean;
  v_despues boolean;
  v_tipo  boolean;
BEGIN
  SELECT descuenta INTO v_antes FROM public.presencia_pausas WHERE tipo = 'almuerzo' LIMIT 1;

  PERFORM set_config('app.uid', 'e0000000-0000-0000-0000-00000000000d', true);
  PERFORM public.presencia_tipos_pausa_guardar('almuerzo', 'Almuerzo', false, 60, true);

  SELECT descuenta INTO v_despues FROM public.presencia_pausas WHERE tipo = 'almuerzo' LIMIT 1;
  SELECT descuenta INTO v_tipo FROM public.presencia_tipos_pausa_efectivos() WHERE codigo = 'almuerzo';

  IF v_despues IS DISTINCT FROM v_antes THEN
    RAISE EXCEPTION 'INVARIANTE 8: cambiar la política reescribió una planilla ya cerrada';
  END IF;
  IF v_tipo IS NOT false THEN
    RAISE EXCEPTION 'INVARIANTE 8: el cambio de política no quedó guardado';
  END IF;
  RAISE NOTICE 'OK 8  la regla vale hacia adelante: la pausa ya registrada conserva la suya';

  -- Se deja como estaba: las invariantes de horas cuentan con que descuenta.
  PERFORM public.presencia_tipos_pausa_guardar('almuerzo', 'Almuerzo', true, 60, true);
END $$;

-- ── 9 · El catálogo: defaults si no hay nada, propios si los hay ───────────
DO $$
DECLARE
  v_n int;
  v_configurados int;
BEGIN
  PERFORM set_config('app.uid', 'e0000000-0000-0000-0000-00000000000d', true);
  SELECT count(*), count(*) FILTER (WHERE configurado)
    INTO v_n, v_configurados FROM public.presencia_tipos_pausa_efectivos();
  -- La 8 ya guardó «almuerzo», así que ahora la empresa tiene los SUYOS.
  IF v_configurados = 0 THEN
    RAISE EXCEPTION 'INVARIANTE 9: guardó un tipo y sigue devolviendo defaults';
  END IF;
  -- Y SIGUEN SIENDO CUATRO. Guardar uno solo no puede dejar a la empresa con un
  -- catálogo de un elemento: sería un clic en «el almuerzo ya no descuenta»
  -- borrando el botón de la refacción de la pantalla de todo el personal.
  IF v_n <> 4 THEN
    RAISE EXCEPTION 'INVARIANTE 9: guardar un tipo dejó el catálogo en % tipos', v_n;
  END IF;
  RAISE NOTICE 'OK 9  guardar un tipo deja el catálogo COMPLETO (% tipos), no uno solo', v_n;
END $$;

-- ── 10 · El cómputo separa estadía, descanso y horas laborales ─────────────
DO $$
DECLARE
  v_reg uuid;
  h record;
BEGIN
  -- Una jornada limpia y medible: 06:00 → 14:00 con un almuerzo de 60 min.
  PERFORM set_config('app.uid', 'e0000000-0000-0000-0000-00000000000d', true);
  INSERT INTO public.presencia_personal
    (company_id, project_id, personal_id, nombre, cargo, fecha, hora_entrada, hora_salida, estado)
  VALUES ('aaaaaaaa-0000-0000-0000-00000000000a', '11111111-0000-0000-0000-000000000001',
          '9e000000-0000-0000-0000-000000000003', 'Ana sin cuenta', 'conserje',
          CURRENT_DATE - 3, '06:00', '14:00', 'presente')
  RETURNING id INTO v_reg;

  INSERT INTO public.presencia_pausas
    (company_id, project_id, registro_id, personal_id, tipo, etiqueta, descuenta,
     inicio_en, fin_en, origen)
  VALUES ('aaaaaaaa-0000-0000-0000-00000000000a', '11111111-0000-0000-0000-000000000001',
          v_reg, '9e000000-0000-0000-0000-000000000003', 'almuerzo', 'Almuerzo', true,
          (CURRENT_DATE - 3 + time '12:00') AT TIME ZONE 'America/Guatemala',
          (CURRENT_DATE - 3 + time '13:00') AT TIME ZONE 'America/Guatemala',
          'autoservicio');

  SELECT * INTO h FROM public.calcular_horas_personal(
    '11111111-0000-0000-0000-000000000001'::uuid, CURRENT_DATE - 3, CURRENT_DATE - 3)
  WHERE personal_id = '9e000000-0000-0000-0000-000000000003';

  IF h.horas_estadia <> 8 THEN RAISE EXCEPTION 'INVARIANTE 10: estadía = % (esperado 8)', h.horas_estadia; END IF;
  IF h.horas_descanso <> 1 THEN RAISE EXCEPTION 'INVARIANTE 10: descanso = % (esperado 1)', h.horas_descanso; END IF;
  IF h.horas_trabajadas <> 7 THEN RAISE EXCEPTION 'INVARIANTE 10: laborales = % (esperado 7)', h.horas_trabajadas; END IF;
  RAISE NOTICE 'OK 10 8 h en el puesto, 1 h de almuerzo, 7 h laborales';
END $$;

-- ── 11 · La pausa que NO descuenta se mide, pero no resta ──────────────────
DO $$
DECLARE
  v_reg uuid;
  h record;
BEGIN
  PERFORM set_config('app.uid', 'e0000000-0000-0000-0000-00000000000d', true);
  SELECT id INTO v_reg FROM public.presencia_personal
   WHERE personal_id = '9e000000-0000-0000-0000-000000000003' AND fecha = CURRENT_DATE - 3;

  INSERT INTO public.presencia_pausas
    (company_id, project_id, registro_id, personal_id, tipo, etiqueta, descuenta,
     inicio_en, fin_en, origen)
  VALUES ('aaaaaaaa-0000-0000-0000-00000000000a', '11111111-0000-0000-0000-000000000001',
          v_reg, '9e000000-0000-0000-0000-000000000003', 'refaccion', 'Refacción', false,
          (CURRENT_DATE - 3 + time '09:00') AT TIME ZONE 'America/Guatemala',
          (CURRENT_DATE - 3 + time '09:30') AT TIME ZONE 'America/Guatemala',
          'autoservicio');

  SELECT * INTO h FROM public.calcular_horas_personal(
    '11111111-0000-0000-0000-000000000001'::uuid, CURRENT_DATE - 3, CURRENT_DATE - 3)
  WHERE personal_id = '9e000000-0000-0000-0000-000000000003';

  IF h.horas_descanso <> 1.5 THEN RAISE EXCEPTION 'INVARIANTE 11: descanso = % (esperado 1.5)', h.horas_descanso; END IF;
  IF h.horas_trabajadas <> 7 THEN RAISE EXCEPTION 'INVARIANTE 11: laborales = % (esperado 7)', h.horas_trabajadas; END IF;
  RAISE NOTICE 'OK 11 la refacción sube el descanso (1.5 h) y NO baja las laborales (7 h)';
END $$;

-- ── 12 · Anular una pausa devuelve las horas ───────────────────────────────
DO $$
DECLARE
  v_pausa uuid;
  h record;
BEGIN
  SELECT pa.id INTO v_pausa FROM public.presencia_pausas pa
   JOIN public.presencia_personal pp ON pp.id = pa.registro_id
   WHERE pp.personal_id = '9e000000-0000-0000-0000-000000000003' AND pa.tipo = 'almuerzo';

  PERFORM set_config('app.uid', 'e0000000-0000-0000-0000-00000000000d', true);
  PERFORM public.presencia_pausa_anular(v_pausa, 'Nunca salió a almorzar: cubrió el turno');

  SELECT * INTO h FROM public.calcular_horas_personal(
    '11111111-0000-0000-0000-000000000001'::uuid, CURRENT_DATE - 3, CURRENT_DATE - 3)
  WHERE personal_id = '9e000000-0000-0000-0000-000000000003';

  IF h.horas_trabajadas <> 8 THEN RAISE EXCEPTION 'INVARIANTE 12: laborales = % (esperado 8)', h.horas_trabajadas; END IF;
  IF h.horas_descanso <> 0.5 THEN RAISE EXCEPTION 'INVARIANTE 12: descanso = % (esperado 0.5)', h.horas_descanso; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.presencia_pausas WHERE id = v_pausa) THEN
    RAISE EXCEPTION 'INVARIANTE 12: anular BORRÓ la pausa';
  END IF;
  RAISE NOTICE 'OK 12 anular devuelve la hora (7 → 8) y la pausa sigue ahí, marcada';
END $$;

-- ── 13 · Ajustar cambia la duración, recoloca el fin y deja huella ─────────
DO $$
DECLARE
  v_pausa uuid;
  v_fila  public.presencia_pausas%ROWTYPE;
BEGIN
  SELECT pa.id INTO v_pausa FROM public.presencia_pausas pa
   JOIN public.presencia_personal pp ON pp.id = pa.registro_id
   WHERE pp.personal_id = '9e000000-0000-0000-0000-000000000003' AND pa.tipo = 'refaccion';

  PERFORM set_config('app.uid', 'e0000000-0000-0000-0000-000000000003', true);  -- supervisor: .edit
  PERFORM public.presencia_pausa_ajustar(v_pausa, 15, 'Volvió a los 15 minutos');

  SELECT * INTO v_fila FROM public.presencia_pausas WHERE id = v_pausa;
  IF v_fila.minutos <> 15 THEN RAISE EXCEPTION 'INVARIANTE 13: minutos = %', v_fila.minutos; END IF;
  IF v_fila.fin_en <> v_fila.inicio_en + interval '15 minutes' THEN
    RAISE EXCEPTION 'INVARIANTE 13: el fin no se recolocó desde el inicio real';
  END IF;
  IF v_fila.corregido_por_nombre IS DISTINCT FROM 'Sin Ficha' THEN
    RAISE EXCEPTION 'INVARIANTE 13: no quedó quién ajustó (%)', v_fila.corregido_por_nombre;
  END IF;
  IF v_fila.motivo_correccion IS NULL OR v_fila.corregido_en IS NULL THEN
    RAISE EXCEPTION 'INVARIANTE 13: falta el motivo o el instante';
  END IF;
  RAISE NOTICE 'OK 13 ajustar corrige la duración (30 → 15 min) y sella quién, cuándo y por qué';
END $$;

-- ── 14 · Ajustar exige motivo de verdad ────────────────────────────────────
DO $$
DECLARE v_pausa uuid;
BEGIN
  SELECT pa.id INTO v_pausa FROM public.presencia_pausas pa WHERE pa.tipo = 'refaccion' LIMIT 1;
  PERFORM set_config('app.uid', 'e0000000-0000-0000-0000-000000000003', true);
  BEGIN
    PERFORM public.presencia_pausa_ajustar(v_pausa, 20, '.');
    RAISE EXCEPTION 'INVARIANTE 14: un punto pasó por motivo';
  EXCEPTION WHEN sqlstate '22023' THEN
    NULL;
  END;
  RAISE NOTICE 'OK 14 un «.» no es un motivo';
END $$;

-- ── 15 · Anular exige `.delete`, no `.edit` ────────────────────────────────
DO $$
DECLARE v_pausa uuid;
BEGIN
  SELECT pa.id INTO v_pausa FROM public.presencia_pausas pa WHERE pa.tipo = 'refaccion' LIMIT 1;
  PERFORM set_config('app.uid', 'e0000000-0000-0000-0000-000000000003', true);  -- .edit sin .delete
  BEGIN
    PERFORM public.presencia_pausa_anular(v_pausa, 'No debería poder');
    RAISE EXCEPTION 'INVARIANTE 15: anuló con solo .edit';
  EXCEPTION WHEN sqlstate '42501' THEN
    NULL;
  END;
  RAISE NOTICE 'OK 15 con .edit se ajusta pero NO se anula: son dos permisos';
END $$;

-- ── 16 · Agregar la pausa que nadie marcó ──────────────────────────────────
DO $$
DECLARE
  v_reg   uuid;
  v_pausa uuid;
  v_fila  public.presencia_pausas%ROWTYPE;
  h record;
BEGIN
  SELECT id INTO v_reg FROM public.presencia_personal
   WHERE personal_id = '9e000000-0000-0000-0000-000000000003' AND fecha = CURRENT_DATE - 3;

  PERFORM set_config('app.uid', 'e0000000-0000-0000-0000-000000000003', true);
  SELECT pausa_id INTO v_pausa FROM public.presencia_pausa_agregar(
    v_reg, 'almuerzo', 60, 'Almorzó y olvidó marcarlo');

  SELECT * INTO v_fila FROM public.presencia_pausas WHERE id = v_pausa;
  IF v_fila.origen <> 'manual' THEN RAISE EXCEPTION 'INVARIANTE 16: origen %', v_fila.origen; END IF;
  IF v_fila.inicio_en IS NOT NULL OR v_fila.fin_en IS NOT NULL THEN
    RAISE EXCEPTION 'INVARIANTE 16: le inventó una hora que nadie sabe';
  END IF;
  IF v_fila.minutos <> 60 THEN RAISE EXCEPTION 'INVARIANTE 16: minutos %', v_fila.minutos; END IF;

  -- El supervisor tiene `.edit` sobre presencia, pero NO el permiso del tab de
  -- horas: el cómputo se consulta como quien sí puede consultarlo.
  PERFORM set_config('app.uid', 'e0000000-0000-0000-0000-00000000000d', true);
  SELECT * INTO h FROM public.calcular_horas_personal(
    '11111111-0000-0000-0000-000000000001'::uuid, CURRENT_DATE - 3, CURRENT_DATE - 3)
  WHERE personal_id = '9e000000-0000-0000-0000-000000000003';
  IF h.horas_trabajadas <> 7 THEN RAISE EXCEPTION 'INVARIANTE 16: laborales = % (esperado 7)', h.horas_trabajadas; END IF;
  RAISE NOTICE 'OK 16 la pausa agregada nace SIN instantes, y descuenta igual (8 → 7 h)';
END $$;

-- ── 17 · La pausa huérfana se cierra al cerrar la jornada ──────────────────
DO $$
DECLARE
  v_reg   uuid;
  v_pausa uuid;
  v_fila  public.presencia_pausas%ROWTYPE;
BEGIN
  PERFORM set_config('app.uid', 'e0000000-0000-0000-0000-000000000004', true);  -- Noe
  SELECT pausa_id INTO v_pausa FROM public.presencia_pausar(
    '11111111-0000-0000-0000-000000000001'::uuid, 'iniciar', 'cena');
  UPDATE public.presencia_pausas SET inicio_en = now() - interval '30 minutes' WHERE id = v_pausa;

  -- Se va sin volver de la cena.
  SELECT registro_id INTO v_reg FROM public.presencia_marcar(
    '11111111-0000-0000-0000-000000000001'::uuid, 'salida');

  SELECT * INTO v_fila FROM public.presencia_pausas WHERE id = v_pausa;
  IF v_fila.fin_en IS NULL THEN RAISE EXCEPTION 'INVARIANTE 17: la pausa quedó abierta para siempre'; END IF;
  IF NOT v_fila.cerrada_al_salir THEN RAISE EXCEPTION 'INVARIANTE 17: se cerró sin dejar la marca'; END IF;
  RAISE NOTICE 'OK 17 marcar salida con una pausa abierta la cierra, y lo deja dicho en la fila';
END $$;

-- ── 18 · También por el camino MANUAL (el botón del tab) ───────────────────
DO $$
DECLARE
  v_reg   uuid;
  v_pausa uuid;
  v_fila  public.presencia_pausas%ROWTYPE;
BEGIN
  PERFORM set_config('app.uid', 'e0000000-0000-0000-0000-00000000000d', true);
  INSERT INTO public.presencia_personal
    (company_id, project_id, personal_id, nombre, fecha, hora_entrada, estado)
  VALUES ('aaaaaaaa-0000-0000-0000-00000000000a', '11111111-0000-0000-0000-000000000001',
          '9e000000-0000-0000-0000-000000000003', 'Ana sin cuenta', CURRENT_DATE - 5, '06:00', 'presente')
  RETURNING id INTO v_reg;

  INSERT INTO public.presencia_pausas
    (company_id, project_id, registro_id, personal_id, tipo, etiqueta, descuenta, inicio_en, origen)
  VALUES ('aaaaaaaa-0000-0000-0000-00000000000a', '11111111-0000-0000-0000-000000000001',
          v_reg, '9e000000-0000-0000-0000-000000000003', 'almuerzo', 'Almuerzo', true,
          now() - interval '20 minutes', 'autoservicio')
  RETURNING id INTO v_pausa;

  -- El botón «Registrar salida» del tab: un UPDATE llano, sin pasar por la RPC.
  UPDATE public.presencia_personal SET hora_salida = '14:00' WHERE id = v_reg;

  SELECT * INTO v_fila FROM public.presencia_pausas WHERE id = v_pausa;
  IF v_fila.fin_en IS NULL OR NOT v_fila.cerrada_al_salir THEN
    RAISE EXCEPTION 'INVARIANTE 18: el camino manual dejó la pausa abierta';
  END IF;
  RAISE NOTICE 'OK 18 la regla vive en la fila: cerrar la jornada a mano cierra la pausa igual';
END $$;

-- ── 19 · Las nocturnas bajan con la parte de la pausa que cayó de noche ────
DO $$
DECLARE
  v_reg uuid;
  h record;
  v_noche_antes numeric;
BEGIN
  PERFORM set_config('app.uid', 'e0000000-0000-0000-0000-00000000000d', true);
  -- 20:00 → 04:00: ocho horas, TODAS nocturnas.
  INSERT INTO public.presencia_personal
    (company_id, project_id, personal_id, nombre, fecha, hora_entrada, hora_salida, estado)
  VALUES ('aaaaaaaa-0000-0000-0000-00000000000a', '11111111-0000-0000-0000-000000000001',
          '9e000000-0000-0000-0000-000000000001', 'Dina Villatoro', CURRENT_DATE - 7,
          '20:00', '04:00', 'presente')
  RETURNING id INTO v_reg;

  SELECT horas_nocturnas INTO v_noche_antes FROM public.calcular_horas_personal(
    '11111111-0000-0000-0000-000000000001'::uuid, CURRENT_DATE - 7, CURRENT_DATE - 7)
  WHERE personal_id = '9e000000-0000-0000-0000-000000000001';
  IF v_noche_antes <> 8 THEN RAISE EXCEPTION 'INVARIANTE 19: nocturnas de partida = %', v_noche_antes; END IF;

  -- Una cena de una hora, dentro de la franja, que descuenta.
  INSERT INTO public.presencia_pausas
    (company_id, project_id, registro_id, personal_id, tipo, etiqueta, descuenta,
     inicio_en, fin_en, origen)
  VALUES ('aaaaaaaa-0000-0000-0000-00000000000a', '11111111-0000-0000-0000-000000000001',
          v_reg, '9e000000-0000-0000-0000-000000000001', 'cena', 'Cena', true,
          (CURRENT_DATE - 7 + time '23:00') AT TIME ZONE 'America/Guatemala',
          (CURRENT_DATE - 7 + time '24:00') AT TIME ZONE 'America/Guatemala',
          'autoservicio');

  SELECT * INTO h FROM public.calcular_horas_personal(
    '11111111-0000-0000-0000-000000000001'::uuid, CURRENT_DATE - 7, CURRENT_DATE - 7)
  WHERE personal_id = '9e000000-0000-0000-0000-000000000001';

  IF h.horas_trabajadas <> 7 THEN RAISE EXCEPTION 'INVARIANTE 19: laborales = %', h.horas_trabajadas; END IF;
  IF h.horas_nocturnas <> 7 THEN
    RAISE EXCEPTION 'INVARIANTE 19: nocturnas = % (esperado 7) — el recargo se pagaría sobre la cena descontada', h.horas_nocturnas;
  END IF;
  RAISE NOTICE 'OK 19 la cena descontada baja también el recargo nocturno (8 → 7 h)';
END $$;

-- ── 20 · La pausa que cruza la medianoche se mide entera ───────────────────
DO $$
DECLARE
  v_reg uuid;
  h record;
BEGIN
  PERFORM set_config('app.uid', 'e0000000-0000-0000-0000-00000000000d', true);
  INSERT INTO public.presencia_personal
    (company_id, project_id, personal_id, nombre, fecha, hora_entrada, hora_salida, estado)
  VALUES ('aaaaaaaa-0000-0000-0000-00000000000a', '11111111-0000-0000-0000-000000000001',
          '9e000000-0000-0000-0000-000000000005', 'Luz Jardinera', CURRENT_DATE - 9,
          '20:00', '04:00', 'presente')
  RETURNING id INTO v_reg;

  -- 23:40 → 00:20: cuarenta minutos que un par de `time` habría leído como 24 h.
  INSERT INTO public.presencia_pausas
    (company_id, project_id, registro_id, personal_id, tipo, etiqueta, descuenta,
     inicio_en, fin_en, origen)
  VALUES ('aaaaaaaa-0000-0000-0000-00000000000a', '11111111-0000-0000-0000-000000000001',
          v_reg, '9e000000-0000-0000-0000-000000000005', 'cena', 'Cena', true,
          (CURRENT_DATE - 9 + time '23:40') AT TIME ZONE 'America/Guatemala',
          (CURRENT_DATE - 8 + time '00:20') AT TIME ZONE 'America/Guatemala',
          'autoservicio');

  SELECT * INTO h FROM public.calcular_horas_personal(
    '11111111-0000-0000-0000-000000000001'::uuid, CURRENT_DATE - 9, CURRENT_DATE - 9)
  WHERE personal_id = '9e000000-0000-0000-0000-000000000005';

  IF h.horas_descanso <> 0.67 THEN RAISE EXCEPTION 'INVARIANTE 20: descanso = % (esperado 0.67)', h.horas_descanso; END IF;
  IF h.horas_trabajadas <> 7.33 THEN RAISE EXCEPTION 'INVARIANTE 20: laborales = %', h.horas_trabajadas; END IF;
  RAISE NOTICE 'OK 20 una pausa de 23:40 a 00:20 son 40 minutos, no 24 horas (#839)';
END $$;

-- ── 21 · La jornada abierta de AYER es la que ve la pantalla ───────────────
DO $$
DECLARE f record;
BEGIN
  PERFORM set_config('app.uid', 'e0000000-0000-0000-0000-00000000000d', true);
  -- Marco cerró la suya de hoy en la 5; se le abre una de AYER, sin cerrar.
  UPDATE public.presencia_personal SET hora_salida = '14:00'
   WHERE personal_id = '9e000000-0000-0000-0000-000000000002' AND hora_salida IS NULL;
  INSERT INTO public.presencia_personal
    (company_id, project_id, personal_id, nombre, fecha, hora_entrada, estado, origen)
  VALUES ('aaaaaaaa-0000-0000-0000-00000000000a', '11111111-0000-0000-0000-000000000001',
          '9e000000-0000-0000-0000-000000000002', 'Marco Antonio Sical',
          (now() AT TIME ZONE 'America/Guatemala')::date - 1, '22:00', 'presente', 'autoservicio');

  PERFORM set_config('app.uid', 'e0000000-0000-0000-0000-000000000002', true);
  SELECT * INTO f FROM public.presencia_mi_ficha('11111111-0000-0000-0000-000000000001'::uuid);

  IF f.registro_fecha <> (now() AT TIME ZONE 'America/Guatemala')::date - 1 THEN
    RAISE EXCEPTION 'INVARIANTE 21: la ficha no vio la jornada abierta de ayer (%)', f.registro_fecha;
  END IF;
  IF f.hora_salida IS NOT NULL THEN RAISE EXCEPTION 'INVARIANTE 21: la dio por cerrada'; END IF;
  RAISE NOTICE 'OK 21 el turno nocturno puede cerrarse y pausarse desde el día siguiente';
END $$;

-- ── 22 · El ciclo completo COMO `authenticated`, no como dueño ─────────────
DO $$
DECLARE
  v_pausa uuid;
  v_min   numeric;
BEGIN
  PERFORM set_config('app.uid', 'e0000000-0000-0000-0000-000000000005', true);
  SET LOCAL ROLE authenticated;

  PERFORM public.presencia_marcar('11111111-0000-0000-0000-000000000001'::uuid, 'entrada');
  SELECT pausa_id INTO v_pausa FROM public.presencia_pausar(
    '11111111-0000-0000-0000-000000000001'::uuid, 'iniciar', 'refaccion');
  IF v_pausa IS NULL THEN RAISE EXCEPTION 'INVARIANTE 22: authenticated no pudo pausar'; END IF;

  SELECT minutos INTO v_min FROM public.presencia_pausar(
    '11111111-0000-0000-0000-000000000001'::uuid, 'terminar');
  IF v_min IS NULL THEN RAISE EXCEPTION 'INVARIANTE 22: authenticated no pudo cerrar su pausa'; END IF;

  -- Y ve la suya por la policy, sin tener el permiso del tab.
  IF NOT EXISTS (SELECT 1 FROM public.presencia_pausas WHERE id = v_pausa) THEN
    RAISE EXCEPTION 'INVARIANTE 22: no ve su propia pausa';
  END IF;
  RESET ROLE;
  RAISE NOTICE 'OK 22 el ciclo entero funciona con el rol real, y cada quien ve la suya';
END $$;

-- ── 23 · La tabla no se escribe por fuera de las RPC ───────────────────────
DO $$
DECLARE v_reg uuid;
BEGIN
  SELECT id INTO v_reg FROM public.presencia_personal LIMIT 1;
  PERFORM set_config('app.uid', 'e0000000-0000-0000-0000-00000000000d', true);
  SET LOCAL ROLE authenticated;
  BEGIN
    INSERT INTO public.presencia_pausas
      (company_id, project_id, registro_id, tipo, etiqueta, descuenta, minutos, origen)
    VALUES ('aaaaaaaa-0000-0000-0000-00000000000a', '11111111-0000-0000-0000-000000000001',
            v_reg, 'almuerzo', 'Almuerzo', true, 480, 'manual');
    RESET ROLE;
    RAISE EXCEPTION 'INVARIANTE 23: un cliente escribió la tabla directamente';
  EXCEPTION WHEN insufficient_privilege THEN
    RESET ROLE;
  END;
  RAISE NOTICE 'OK 23 sin policy de escritura, la única puerta son las RPC';
END $$;

-- ── 24 · La ACL: quién puede llamar a qué ──────────────────────────────────
DO $$
DECLARE
  v_expuestas text;
  v_faltantes text;
BEGIN
  SELECT string_agg(p.proname, ', ') INTO v_expuestas
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname LIKE 'presencia_%pausa%'
    AND has_function_privilege('anon', p.oid, 'EXECUTE');
  IF v_expuestas IS NOT NULL THEN
    RAISE EXCEPTION 'INVARIANTE 24: anon ejecuta %', v_expuestas;
  END IF;

  SELECT string_agg(f, ', ') INTO v_faltantes FROM unnest(ARRAY[
    'presencia_pausar(uuid, text, text, jsonb)',
    'presencia_pausa_ajustar(uuid, numeric, text)',
    'presencia_pausa_anular(uuid, text)',
    'presencia_pausa_agregar(uuid, text, numeric, text)',
    'presencia_tipos_pausa_efectivos()',
    'presencia_tipos_pausa_guardar(text, text, boolean, integer, boolean)'
  ]) f WHERE NOT has_function_privilege('authenticated', 'public.' || f, 'EXECUTE');
  IF v_faltantes IS NOT NULL THEN
    RAISE EXCEPTION 'INVARIANTE 24: authenticated NO puede llamar a %', v_faltantes;
  END IF;

  -- Y las guardas internas siguen cerradas: sus llamadores son cuerpos DEFINER.
  IF has_function_privilege('authenticated', 'public.presencia_minutos_pausa(uuid, text)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.presencia_pausa_editable(uuid, text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'INVARIANTE 24: una guarda interna quedó expuesta a authenticated';
  END IF;
  RAISE NOTICE 'OK 24 anon nada; authenticated las seis RPC; las guardas internas ninguna';
END $$;

-- ── 25 · La bitácora quedó inscrita ────────────────────────────────────────
DO $$
DECLARE v_n int;
BEGIN
  SELECT count(*) INTO v_n FROM public.bitacora_acciones WHERE tabla = 'presencia_pausas';
  IF v_n = 0 THEN
    RAISE EXCEPTION 'INVARIANTE 25: presencia_pausas no quedó inscrita en la bitácora';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.bitacora_acciones WHERE tabla = 'presencia_tipos_pausa') THEN
    RAISE EXCEPTION 'INVARIANTE 25: el catálogo tampoco';
  END IF;
  RAISE NOTICE 'OK 25 las dos tablas nuevas dejan rastro en la bitácora (% acciones)', v_n;
END $$;
