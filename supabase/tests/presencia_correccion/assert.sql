\set ON_ERROR_STOP on
\pset tuples_only on
\pset format unaligned

-- ════════════════════════════════════════════════════════════════════════════
-- Invariantes de la corrección y la anulación de marcajes (20260908000200).
--
--    1-4   corregir: exige permiso, motivo, hora de entrada y estado válido
--    5-7   corregir deja huella y NO toca la evidencia ni el expediente
--    8     reabrir una jornada cerrada por error (salida → NULL)
--    9-12  anular: otro permiso, con motivo, no borra, y no se repite
--   13-14  LO QUE HACE QUE ANULAR SIRVA: el cómputo de horas la excluye
--   15     una fila anulada no se corrige
--   16     tras anular, la persona PUEDE volver a marcar ese día
--   17-19  la ACL
-- ════════════════════════════════════════════════════════════════════════════

DO $$
DECLARE
  CO     uuid := 'aaaaaaaa-0000-0000-0000-00000000000a';
  P1     uuid := '11111111-0000-0000-0000-000000000001';
  ADA    uuid := 'e0000000-0000-0000-0000-00000000000d';  -- admin: todo
  SUPER  uuid := 'e0000000-0000-0000-0000-000000000003';  -- ve + edita, NO anula
  MARCO  uuid := 'e0000000-0000-0000-0000-000000000002';  -- sin ningún permiso
  F_MAR  uuid := '9e000000-0000-0000-0000-000000000002';
  RUTA   text := '11111111-0000-0000-0000-000000000001/9e000000-0000-0000-0000-000000000002/selfie.jpg';
  v_reg  uuid;
  fila   public.presencia_personal%ROWTYPE;
  antes  public.presencia_personal%ROWTYPE;
  r      record;
BEGIN
  -- El caso real: Jorge entró 06:02:07 y "salió" 06:02:41 por volver a pulsar.
  INSERT INTO storage.objects (bucket_id, name, owner)
    VALUES ('presencia-evidencias', RUTA, MARCO);
  INSERT INTO public.presencia_personal (
    company_id, project_id, personal_id, nombre, cargo, fecha,
    hora_entrada, hora_salida, estado, origen, foto_entrada, gps_entrada, entrada_marcada_en)
  VALUES (
    CO, P1, F_MAR, 'Marco Antonio Sical', 'guardia', current_date - 1,
    '06:02:07', '06:02:41', 'presente', 'autoservicio', RUTA,
    '{"lat":14.6,"lng":-90.5,"exactitud_m":12}'::jsonb, now())
  RETURNING id INTO v_reg;
  SELECT * INTO antes FROM public.presencia_personal WHERE id = v_reg;

  -- ── 1 · Corregir exige el permiso ────────────────────────────────────────
  PERFORM set_config('app.uid', MARCO::text, false);
  BEGIN
    PERFORM public.presencia_corregir(v_reg, '06:02', '14:00', 'presente', 'salida marcada por error');
    RAISE EXCEPTION '1: un empleado sin permiso corrigió asistencia';
  EXCEPTION WHEN insufficient_privilege THEN
    RAISE NOTICE 'OK 1  sin condominios.tab.presencia.edit no se corrige';
  END;

  -- ── 2 · Sin motivo no hay corrección ─────────────────────────────────────
  PERFORM set_config('app.uid', SUPER::text, false);
  BEGIN
    PERFORM public.presencia_corregir(v_reg, '06:02', '14:00', 'presente', '   ');
    RAISE EXCEPTION '2: aceptó una corrección sin motivo';
  EXCEPTION WHEN invalid_parameter_value THEN NULL;
  END;
  BEGIN
    PERFORM public.presencia_corregir(v_reg, '06:02', '14:00', 'presente', '.');
    RAISE EXCEPTION '2: aceptó un motivo de un carácter';
  EXCEPTION WHEN invalid_parameter_value THEN
    RAISE NOTICE 'OK 2  el motivo es obligatorio y un «.» no lo es';
  END;

  -- ── 3 · La entrada es obligatoria; para lo demás está anular ─────────────
  BEGIN
    PERFORM public.presencia_corregir(v_reg, NULL, '14:00', 'presente', 'quitar la entrada');
    RAISE EXCEPTION '3: dejó una fila de asistencia sin hora de entrada';
  EXCEPTION WHEN invalid_parameter_value THEN
    RAISE NOTICE 'OK 3  sin hora de entrada la fila no dice nada: eso es anular';
  END;

  -- ── 4 · Estado del vocabulario, no cualquier texto ───────────────────────
  BEGIN
    PERFORM public.presencia_corregir(v_reg, '06:02', '14:00', 'trabajando', 'estado raro');
    RAISE EXCEPTION '4: aceptó un estado fuera del vocabulario';
  EXCEPTION WHEN invalid_parameter_value THEN
    RAISE NOTICE 'OK 4  el estado se valida contra el vocabulario de la tabla';
  END;

  -- ── 5 · La corrección buena ──────────────────────────────────────────────
  SELECT * INTO r FROM public.presencia_corregir(
    v_reg, '06:02', '14:05', 'presente', 'salida marcada por error el primer día');
  SELECT * INTO fila FROM public.presencia_personal WHERE id = v_reg;
  IF fila.hora_entrada <> '06:02' OR fila.hora_salida <> '14:05' THEN
    RAISE EXCEPTION '5: no aplicó las horas (% → %)', fila.hora_entrada, fila.hora_salida; END IF;
  RAISE NOTICE 'OK 5  la corrección aplica las horas que se le pidieron';

  -- ── 6 · …y deja huella de quién, cuándo y por qué ────────────────────────
  IF fila.corregido_por IS DISTINCT FROM SUPER
     OR fila.corregido_en IS NULL
     OR fila.motivo_correccion <> 'salida marcada por error el primer día' THEN
    RAISE EXCEPTION '6: la huella quedó incompleta (por=%, en=%, motivo=%)',
      fila.corregido_por, fila.corregido_en, fila.motivo_correccion; END IF;
  -- El nombre va desnormalizado para que la fila siga siendo legible aunque esa
  -- cuenta se borre, y para no consultar app_users al pintar la lista.
  IF fila.corregido_por_nombre IS DISTINCT FROM 'Sin Ficha' THEN
    RAISE EXCEPTION '6: no se selló el nombre legible (%)', fila.corregido_por_nombre; END IF;
  RAISE NOTICE 'OK 6  queda sellado quién corrigió (con nombre), cuándo y con qué motivo';

  -- ── 7 · La evidencia y el expediente NO se tocan ─────────────────────────
  IF fila.foto_entrada IS DISTINCT FROM antes.foto_entrada
     OR fila.gps_entrada IS DISTINCT FROM antes.gps_entrada
     OR fila.origen      IS DISTINCT FROM antes.origen
     OR fila.personal_id IS DISTINCT FROM antes.personal_id
     OR fila.fecha       IS DISTINCT FROM antes.fecha THEN
    RAISE EXCEPTION '7: la corrección tocó la evidencia o el expediente'; END IF;
  RAISE NOTICE 'OK 7  la foto, el GPS, el origen, el empleado y la fecha quedan intactos';

  -- ── 8 · Reabrir una jornada cerrada por error ────────────────────────────
  PERFORM public.presencia_corregir(v_reg, '06:02', NULL, 'presente', 'reabrir: aún no salía');
  SELECT * INTO fila FROM public.presencia_personal WHERE id = v_reg;
  IF fila.hora_salida IS NOT NULL THEN
    RAISE EXCEPTION '8: no se pudo reabrir la jornada'; END IF;
  RAISE NOTICE 'OK 8  mandar NULL en la salida reabre la jornada';
  -- Se vuelve a cerrar para las invariantes de horas.
  PERFORM public.presencia_corregir(v_reg, '06:02', '14:05', 'presente', 'cierre con la hora real');

  -- ── 9 · Anular NO es el permiso de corregir ──────────────────────────────
  BEGIN
    PERFORM public.presencia_anular(v_reg, 'no debería poder');
    RAISE EXCEPTION '9: quien solo puede corregir logró anular';
  EXCEPTION WHEN insufficient_privilege THEN
    RAISE NOTICE 'OK 9  anular exige .delete: corregir no alcanza';
  END;

  -- ── 10 · Anular tampoco se hace sin motivo ───────────────────────────────
  PERFORM set_config('app.uid', ADA::text, false);
  BEGIN
    PERFORM public.presencia_anular(v_reg, 'ups');
    RAISE EXCEPTION '10: anuló con un motivo de tres letras';
  EXCEPTION WHEN invalid_parameter_value THEN
    RAISE NOTICE 'OK 10 anular también exige motivo';
  END;

  PERFORM set_config('app.uid', NULL, false);
END $$;

-- ════════════════════════════════════════════════════════════════════════════
-- 11-15 · Anular, y lo que eso le hace a la planilla
-- ════════════════════════════════════════════════════════════════════════════
DO $$
DECLARE
  CO    uuid := 'aaaaaaaa-0000-0000-0000-00000000000a';
  P1    uuid := '11111111-0000-0000-0000-000000000001';
  ADA   uuid := 'e0000000-0000-0000-0000-00000000000d';
  F_MAR uuid := '9e000000-0000-0000-0000-000000000002';
  v_reg uuid;
  horas_antes   numeric;
  horas_despues numeric;
  n     bigint;
  fila  public.presencia_personal%ROWTYPE;
BEGIN
  SELECT id INTO v_reg FROM public.presencia_personal WHERE personal_id = F_MAR LIMIT 1;
  PERFORM set_config('app.uid', ADA::text, false);

  -- ── 13 (antes) · La jornada corregida SÍ cuenta ──────────────────────────
  SELECT horas_trabajadas INTO horas_antes
  FROM public.calcular_horas_personal(P1, current_date - 2, current_date)
  WHERE personal_id = F_MAR;
  IF COALESCE(horas_antes, 0) <= 0 THEN
    RAISE EXCEPTION '13: la jornada corregida no llega al cómputo (horas=%)', horas_antes; END IF;
  RAISE NOTICE 'OK 13 antes de anular, el cómputo cuenta la jornada (% h)', horas_antes;

  -- ── 11 · Anular ──────────────────────────────────────────────────────────
  PERFORM public.presencia_anular(v_reg, 'marcaje de prueba del primer día');
  SELECT * INTO fila FROM public.presencia_personal WHERE id = v_reg;
  IF fila.anulado_en IS NULL OR fila.corregido_por IS DISTINCT FROM ADA
     OR fila.motivo_correccion <> 'marcaje de prueba del primer día' THEN
    RAISE EXCEPTION '11: la anulación no quedó sellada'; END IF;
  RAISE NOTICE 'OK 11 anular sella cuándo, quién y por qué';

  -- ── 12 · …y NO borra: la fila sigue ahí, con sus horas y su evidencia ────
  SELECT count(*) INTO n FROM public.presencia_personal WHERE id = v_reg;
  IF n <> 1 THEN RAISE EXCEPTION '12: la anulación borró la fila'; END IF;
  IF fila.hora_entrada IS NULL OR fila.foto_entrada IS NULL THEN
    RAISE EXCEPTION '12: la anulación destruyó el dato o la evidencia'; END IF;
  RAISE NOTICE 'OK 12 la fila sobrevive entera: es evidencia de planilla';

  -- ── 13 (después) · Lo que hace que anular signifique algo ────────────────
  SELECT horas_trabajadas INTO horas_despues
  FROM public.calcular_horas_personal(P1, current_date - 2, current_date)
  WHERE personal_id = F_MAR;
  IF COALESCE(horas_despues, 0) <> 0 THEN
    RAISE EXCEPTION '13: la fila anulada SIGUE sumando horas a la planilla (%)', horas_despues; END IF;
  RAISE NOTICE 'OK 13 tras anular, el cómputo de horas la excluye (% → 0 h)', horas_antes;

  -- ── 14 · Anular dos veces no es anular más ───────────────────────────────
  BEGIN
    PERFORM public.presencia_anular(v_reg, 'otra vez por si acaso');
    RAISE EXCEPTION '14: dejó anular dos veces';
  EXCEPTION WHEN invalid_parameter_value THEN
    RAISE NOTICE 'OK 14 una fila anulada no se vuelve a anular';
  END;

  -- ── 15 · Y no se corrige lo anulado ──────────────────────────────────────
  BEGIN
    PERFORM public.presencia_corregir(v_reg, '06:00', '14:00', 'presente', 'corregir lo anulado');
    RAISE EXCEPTION '15: corrigió una fila anulada';
  EXCEPTION WHEN invalid_parameter_value THEN
    RAISE NOTICE 'OK 15 lo anulado no se corrige: se vuelve a marcar';
  END;

  PERFORM set_config('app.uid', NULL, false);
END $$;

-- ════════════════════════════════════════════════════════════════════════════
-- 16 · Lo anulado no ocupa el día
-- `presencia_corregir` le dice a quien administra «lo anulado no se corrige: se
-- vuelve a marcar». Esta invariante es la que hace cierta esa frase: sin el
-- índice parcial y sin el filtro dentro de presencia_marcar, la fila anulada
-- seguiría ocupando el hueco y el nuevo marcaje moriría con «Ya marcaste tu
-- entrada hoy».
-- ════════════════════════════════════════════════════════════════════════════
DO $$
DECLARE
  CO    uuid := 'aaaaaaaa-0000-0000-0000-00000000000a';
  P1    uuid := '11111111-0000-0000-0000-000000000001';
  ADA   uuid := 'e0000000-0000-0000-0000-00000000000d';
  LUZ   uuid := 'e0000000-0000-0000-0000-000000000005';
  F_LUZ uuid := '9e000000-0000-0000-0000-000000000005';
  v_reg uuid;
  reg   record;
  n     bigint;
BEGIN
  -- Luz marca hoy…
  PERFORM set_config('app.uid', LUZ::text, false);
  SELECT registro_id INTO v_reg FROM public.presencia_marcar(P1, 'entrada', NULL, NULL, NULL);

  -- …se lo anulan…
  PERFORM set_config('app.uid', ADA::text, false);
  PERFORM public.presencia_anular(v_reg, 'marcó en el condominio equivocado');

  -- …y tiene que poder volver a marcar el MISMO día.
  PERFORM set_config('app.uid', LUZ::text, false);
  SELECT * INTO reg FROM public.presencia_marcar(P1, 'entrada', NULL, NULL, 'segundo intento');
  IF reg.registro_id IS NULL OR reg.registro_id = v_reg THEN
    RAISE EXCEPTION '16: no pudo volver a marcar tras la anulación'; END IF;

  -- Las dos filas conviven: la anulada como rastro, la nueva como la vigente.
  SELECT count(*) INTO n FROM public.presencia_personal
   WHERE personal_id = F_LUZ AND fecha = (now() AT TIME ZONE 'America/Guatemala')::date;
  IF n <> 2 THEN RAISE EXCEPTION '16: se esperaban 2 filas (la anulada y la nueva), hay %', n; END IF;
  RAISE NOTICE 'OK 16 tras anular, la persona vuelve a marcar y la anulada queda de rastro';

  -- Y su pantalla tiene que enseñar UNA fila, la vigente: con dos filas el mismo
  -- día, un LEFT JOIN llano devolvería las dos y la vista tomaría una al azar.
  SELECT count(*) INTO n FROM public.presencia_mi_ficha(P1);
  IF n <> 1 THEN RAISE EXCEPTION '16b: mi_ficha devolvió % filas, no 1', n; END IF;
  SELECT * INTO reg FROM public.presencia_mi_ficha(P1);
  IF reg.registro_id = v_reg OR reg.anulado_en IS NOT NULL THEN
    RAISE EXCEPTION '16b: mi_ficha se quedó con la fila anulada'; END IF;
  RAISE NOTICE 'OK 16b su pantalla enseña la fila vigente, no la anulada';

  PERFORM set_config('app.uid', NULL, false);
END $$;

-- ════════════════════════════════════════════════════════════════════════════
-- 17-19 · La ACL
-- ════════════════════════════════════════════════════════════════════════════
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname IN ('presencia_corregir', 'presencia_anular',
                        'presencia_fila_editable', 'presencia_nombre_de_usuario')
      AND has_function_privilege('anon', p.oid, 'EXECUTE')
  ) THEN RAISE EXCEPTION '17: anon puede ejecutar algo de la corrección'; END IF;
  RAISE NOTICE 'OK 17 anon no ejecuta nada de la corrección';

  IF NOT has_function_privilege('authenticated', 'public.presencia_corregir(uuid,time,time,text,text)', 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'public.presencia_anular(uuid,text)', 'EXECUTE') THEN
    RAISE EXCEPTION '18: authenticated no puede ejecutar las dos RPC'; END IF;
  RAISE NOTICE 'OK 18 authenticated ejecuta corregir y anular (el permiso lo decide la RPC)';

  IF has_function_privilege('authenticated', 'public.presencia_fila_editable(uuid,text)', 'EXECUTE') THEN
    RAISE EXCEPTION '19: la guarda interna quedó concedida a authenticated'; END IF;
  RAISE NOTICE 'OK 19 la guarda interna no se le concede a authenticated';
END $$;
