\set ON_ERROR_STOP on
\pset tuples_only on
\pset format unaligned

-- ════════════════════════════════════════════════════════════════════════════
-- Invariantes del marcaje de turno por el propio empleado (20260908000000).
--
--    1-3   la vía existe SIN el permiso del tab, y la hora la pone el servidor
--    4-6   la evidencia: foto propia y existente; ajena e inventada, no
--    7-8   la ubicación se normaliza o no se guarda
--    9-11  el doble marcaje, la salida y el turno que cruza medianoche
--   12-14  quién NO puede marcar: sin ficha, ficha inactiva, sin acceso
--   15     la tardanza sale de la tolerancia de la plantilla de horario
--   16-19  el bucket: privado, y sus policies (propia sí, ajena no, sin UPDATE)
--   20-21  la ACL de las RPC
-- ════════════════════════════════════════════════════════════════════════════

DO $$
DECLARE
  CO    uuid := 'aaaaaaaa-0000-0000-0000-00000000000a';
  P1    uuid := '11111111-0000-0000-0000-000000000001';
  ADA   uuid := 'e0000000-0000-0000-0000-00000000000d';
  DINA  uuid := 'e0000000-0000-0000-0000-000000000001';
  MARCO uuid := 'e0000000-0000-0000-0000-000000000002';
  NADIE uuid := 'e0000000-0000-0000-0000-000000000003';
  NOE   uuid := 'e0000000-0000-0000-0000-000000000004';
  F_MAR uuid := '9e000000-0000-0000-0000-000000000002';
  F_NOE uuid := '9e000000-0000-0000-0000-000000000004';
  F_ANA uuid := '9e000000-0000-0000-0000-000000000003';
  RUTA_MARCO text := '11111111-0000-0000-0000-000000000001/9e000000-0000-0000-0000-000000000002/selfie.jpg';
  RUTA_ANA   text := '11111111-0000-0000-0000-000000000001/9e000000-0000-0000-0000-000000000003/selfie.jpg';
  v_local timestamp;
  reg     record;
  fila    record;
  t       text;
  b       boolean;
  n       bigint;
BEGIN
  v_local := now() AT TIME ZONE 'America/Guatemala';

  -- ── 1 · La columna que distingue una vía de la otra ──────────────────────
  SELECT column_default INTO t FROM information_schema.columns
   WHERE table_schema = 'public' AND table_name = 'presencia_personal' AND column_name = 'origen';
  IF t IS NULL OR t NOT LIKE '%manual%' THEN
    RAISE EXCEPTION '1: presencia_personal.origen no existe o no default "manual" (%)', t; END IF;
  RAISE NOTICE 'OK 1  origen existe y por defecto describe lo que ya había: manual';

  -- ── 2 · Marcar NO exige el permiso del tab ───────────────────────────────
  -- Marco no tiene ni una fila en test_permisos: si esto pasa, el conserje
  -- puede fichar sin poder administrar la asistencia de nadie.
  PERFORM set_config('app.uid', MARCO::text, false);
  IF public.user_has_permission('condominios.tab.presencia') THEN
    RAISE EXCEPTION '2: el fixture le dio a Marco el permiso del tab; la prueba no probaría nada'; END IF;

  INSERT INTO storage.objects (bucket_id, name, owner) VALUES ('presencia-evidencias', RUTA_MARCO, MARCO);
  SELECT * INTO reg FROM public.presencia_marcar(
    P1, 'entrada', RUTA_MARCO, '{"lat":14.60271,"lng":-90.51328,"exactitud_m":12}'::jsonb, 'Ingreso a turno');
  IF reg.registro_id IS NULL THEN RAISE EXCEPTION '2: no se registró la entrada'; END IF;
  RAISE NOTICE 'OK 2  un empleado sin el permiso del tab marca su propia entrada';

  -- ── 3 · La hora la pone el servidor, en la zona del tenant ───────────────
  SELECT * INTO fila FROM public.presencia_personal WHERE id = reg.registro_id;
  IF fila.fecha IS DISTINCT FROM v_local::date THEN
    RAISE EXCEPTION '3: la fecha (%) no es la del tenant (%)', fila.fecha, v_local::date; END IF;
  IF abs(EXTRACT(EPOCH FROM (fila.hora_entrada - v_local::time))) > 120 THEN
    RAISE EXCEPTION '3: la hora (%) no es la del servidor (%)', fila.hora_entrada, v_local::time; END IF;
  IF fila.entrada_marcada_en IS NULL OR fila.origen <> 'autoservicio' THEN
    RAISE EXCEPTION '3: la fila no quedó sellada como autoservicio (origen=%, sello=%)',
      fila.origen, fila.entrada_marcada_en; END IF;
  IF fila.nombre <> 'Marco Antonio Sical' OR fila.cargo <> 'guardia' OR fila.personal_id <> F_MAR THEN
    RAISE EXCEPTION '3: el expediente no se copió solo (nombre=%, cargo=%)', fila.nombre, fila.cargo; END IF;
  RAISE NOTICE 'OK 3  fecha, hora, nombre y cargo los puso el sistema, no el cliente';

  -- ── 4 · La foto propia y ya subida queda ligada ──────────────────────────
  IF fila.foto_entrada IS DISTINCT FROM RUTA_MARCO THEN
    RAISE EXCEPTION '4: la foto no quedó ligada (%)', fila.foto_entrada; END IF;
  RAISE NOTICE 'OK 4  la foto propia queda ligada al marcaje';

  -- ── 5 · Una foto bajo el expediente de otro se rechaza ───────────────────
  INSERT INTO storage.objects (bucket_id, name, owner) VALUES ('presencia-evidencias', RUTA_ANA, MARCO);
  BEGIN
    PERFORM public.presencia_marcar(P1, 'salida', RUTA_ANA, NULL, NULL);
    RAISE EXCEPTION '5: aceptó una foto colgada del expediente de otra persona';
  EXCEPTION WHEN insufficient_privilege THEN
    RAISE NOTICE 'OK 5  una foto bajo el expediente de otro se rechaza';
  END;

  -- ── 6 · Un path inventado se rechaza ─────────────────────────────────────
  BEGIN
    PERFORM public.presencia_marcar(
      P1, 'salida', P1::text || '/' || F_MAR::text || '/nunca-subida.jpg', NULL, NULL);
    RAISE EXCEPTION '6: aceptó una foto que no existe en el bucket';
  EXCEPTION WHEN invalid_parameter_value THEN
    RAISE NOTICE 'OK 6  una fila no puede afirmar tener evidencia que no está';
  END;

  -- ── 7 · La ubicación válida se normaliza ─────────────────────────────────
  IF (fila.gps_entrada->>'lat')::numeric <> 14.60271
     OR (fila.gps_entrada->>'exactitud_m')::numeric <> 12 THEN
    RAISE EXCEPTION '7: el GPS no se guardó normalizado (%)', fila.gps_entrada; END IF;
  RAISE NOTICE 'OK 7  la ubicación se guarda como {lat, lng, exactitud_m}';

  -- ── 8 · La ubicación ilegible es NULL, no ruido ──────────────────────────
  PERFORM set_config('app.uid', NOE::text, false);
  INSERT INTO public.presencia_personal (company_id, project_id, personal_id, nombre, cargo, fecha, hora_entrada, estado, origen)
    VALUES (CO, P1, F_NOE, 'Noe Nocturno', 'guardia', v_local::date - 1, '22:00', 'presente', 'autoservicio');
  SELECT * INTO reg FROM public.presencia_marcar(P1, 'salida', NULL, '{"lat":"basura"}'::jsonb, NULL);
  SELECT * INTO fila FROM public.presencia_personal WHERE id = reg.registro_id;
  IF fila.gps_salida IS NOT NULL THEN
    RAISE EXCEPTION '8: guardó una coordenada ilegible (%)', fila.gps_salida; END IF;
  RAISE NOTICE 'OK 8  una coordenada ilegible se descarta en vez de guardarse como dato';

  -- ── 9 · La salida cierra la entrada de AYER: el turno nocturno ───────────
  IF fila.fecha <> v_local::date - 1 OR fila.hora_entrada <> '22:00' THEN
    RAISE EXCEPTION '9: cerró la fila equivocada (fecha=%, entrada=%)', fila.fecha, fila.hora_entrada; END IF;
  IF fila.hora_salida IS NULL OR fila.salida_marcada_en IS NULL THEN
    RAISE EXCEPTION '9: no cerró la jornada nocturna'; END IF;
  RAISE NOTICE 'OK 9  la salida cierra el turno que empezó ayer, no inventa uno de hoy';

  -- ── 10 · Sin entrada abierta no hay salida que dar ───────────────────────
  BEGIN
    PERFORM public.presencia_marcar(P1, 'salida', NULL, NULL, NULL);
    RAISE EXCEPTION '10: cerró una jornada que no estaba abierta';
  EXCEPTION WHEN invalid_parameter_value THEN
    RAISE NOTICE 'OK 10 sin entrada abierta, la salida se rechaza';
  END;

  -- ── 11 · El doble marcaje de entrada se rechaza ──────────────────────────
  PERFORM set_config('app.uid', MARCO::text, false);
  BEGIN
    PERFORM public.presencia_marcar(P1, 'entrada', NULL, NULL, NULL);
    RAISE EXCEPTION '11: dejó marcar la entrada dos veces';
  EXCEPTION WHEN unique_violation THEN
    RAISE NOTICE 'OK 11 la segunda entrada del día se rechaza diciendo la hora de la primera';
  END;

  -- ── 12 · Una cuenta sin expediente aquí no marca ─────────────────────────
  PERFORM set_config('app.uid', NADIE::text, false);
  SELECT count(*) INTO n FROM public.presencia_mi_ficha(P1);
  IF n <> 0 THEN RAISE EXCEPTION '12: mi_ficha devolvió % filas para una cuenta sin expediente', n; END IF;
  BEGIN
    PERFORM public.presencia_marcar(P1, 'entrada', NULL, NULL, NULL);
    RAISE EXCEPTION '12: dejó marcar a una cuenta sin expediente';
  EXCEPTION WHEN insufficient_privilege THEN
    RAISE NOTICE 'OK 12 sin expediente vinculado no hay marcaje (y mi_ficha no es un error)';
  END;

  -- ── 13 · Un expediente dado de baja no marca ─────────────────────────────
  PERFORM set_config('app.uid', DINA::text, false);
  UPDATE public.app_users SET project_id = P1 WHERE id = DINA;  -- aislar el motivo
  BEGIN
    PERFORM public.presencia_marcar(P1, 'entrada', NULL, NULL, NULL);
    RAISE EXCEPTION '13: dejó marcar a un expediente inactivo';
  EXCEPTION WHEN insufficient_privilege THEN
    RAISE NOTICE 'OK 13 un expediente inactivo no puede fichar';
  END;

  -- ── 14 · Con ficha aquí pero sin acceso al condominio, tampoco ───────────
  UPDATE public.app_users SET project_id = '11111111-0000-0000-0000-000000000002' WHERE id = DINA;
  UPDATE public.personal_condominio SET estado = 'activo' WHERE id = '9e000000-0000-0000-0000-000000000001';
  BEGIN
    PERFORM public.presencia_marcar(P1, 'entrada', NULL, NULL, NULL);
    RAISE EXCEPTION '14: dejó marcar en un condominio al que la cuenta no tiene acceso';
  EXCEPTION WHEN insufficient_privilege THEN
    RAISE NOTICE 'OK 14 tener ficha no basta: la cuenta necesita acceso a ESE condominio';
  END;

  -- ── 15 · La tardanza usa la tolerancia de la plantilla de horario ────────
  -- Cerca de medianoche local, "hace 40 minutos" cae en el día anterior y la
  -- resta de `time` daría negativa: la ventana se salta antes que mentir.
  IF v_local::time > '01:00' THEN
    PERFORM set_config('app.uid', NOE::text, false);
    INSERT INTO public.plantillas_horario (id, company_id, project_id, nombre, hora_inicio, hora_fin, tolerancia_entrada_min)
      VALUES ('7a000000-0000-0000-0000-000000000001', CO, P1, 'Con tolerancia 10',
              (v_local - interval '40 minutes')::time, (v_local + interval '4 hours')::time, 10);
    INSERT INTO public.bloques_turno (company_id, project_id, personal_id, fecha, plantilla_horario_id, hora_inicio, hora_fin)
      VALUES (CO, P1, F_NOE, v_local::date, '7a000000-0000-0000-0000-000000000001',
              (v_local - interval '40 minutes')::time, (v_local + interval '4 hours')::time);
    SELECT * INTO reg FROM public.presencia_marcar(P1, 'entrada', NULL, NULL, NULL);
    IF reg.estado <> 'tardanza' THEN
      RAISE EXCEPTION '15: 40 minutos tarde con tolerancia 10 no se marcó como tardanza (%)', reg.estado; END IF;
    SELECT bloque_id INTO t FROM public.presencia_personal WHERE id = reg.registro_id;
    IF t IS NULL THEN RAISE EXCEPTION '15: el marcaje no quedó atado al turno planificado'; END IF;
    RAISE NOTICE 'OK 15 la tardanza sale del turno planificado y su tolerancia, y ata el bloque';
  ELSE
    RAISE NOTICE '·· 15 omitida (son las % locales: la ventana cruzaría medianoche)', v_local::time;
  END IF;

  -- ── 16 · El bucket es privado y solo acepta imágenes ─────────────────────
  SELECT public INTO b FROM storage.buckets WHERE id = 'presencia-evidencias';
  IF b IS DISTINCT FROM false THEN RAISE EXCEPTION '16: el bucket no es privado'; END IF;
  SELECT 'image/jpeg' = ANY(allowed_mime_types) INTO b FROM storage.buckets WHERE id = 'presencia-evidencias';
  IF b IS NOT TRUE THEN RAISE EXCEPTION '16: el bucket no restringe los mime a imágenes'; END IF;
  RAISE NOTICE 'OK 16 las fotos viven en un bucket privado propio, no en condominios-media';

  PERFORM set_config('app.uid', NULL, false);
END $$;

-- ════════════════════════════════════════════════════════════════════════════
-- 17-19 · Las policies del bucket, ejercidas como `authenticated`
-- Un SECURITY DEFINER puede leer lo que quiera; lo que decide quién ve la cara
-- de un trabajador es la policy, y la policy solo se comprueba desde el rol que
-- la sufre.
-- ════════════════════════════════════════════════════════════════════════════
DO $$
DECLARE
  MARCO uuid := 'e0000000-0000-0000-0000-000000000002';
  ADA   uuid := 'e0000000-0000-0000-0000-00000000000d';
  RUTA_MARCO text := '11111111-0000-0000-0000-000000000001/9e000000-0000-0000-0000-000000000002/selfie.jpg';
  RUTA_ANA   text := '11111111-0000-0000-0000-000000000001/9e000000-0000-0000-0000-000000000003/selfie.jpg';
  n bigint;
BEGIN
  PERFORM set_config('app.uid', MARCO::text, false);
  SET LOCAL ROLE authenticated;

  -- 17 · Marco ve SU foto y no la de Ana.
  SELECT count(*) INTO n FROM storage.objects WHERE name = RUTA_MARCO;
  IF n <> 1 THEN RAISE EXCEPTION '17: el dueño no puede leer su propia foto de fichaje'; END IF;
  SELECT count(*) INTO n FROM storage.objects WHERE name = RUTA_ANA;
  IF n <> 0 THEN RAISE EXCEPTION '17: un empleado puede leer la foto de fichaje de otro'; END IF;
  RAISE NOTICE 'OK 17 cada quien ve su foto; la del compañero, no';

  -- 18 · Ni la sustituye ni la borra.
  BEGIN
    UPDATE storage.objects SET name = name || '.x' WHERE name = RUTA_MARCO;
    IF FOUND THEN RAISE EXCEPTION '18: se pudo sustituir la evidencia de un fichaje'; END IF;
  EXCEPTION WHEN insufficient_privilege THEN NULL;  -- también vale: sin policy de UPDATE
  END;
  DELETE FROM storage.objects WHERE name = RUTA_MARCO;
  IF FOUND THEN RAISE EXCEPTION '18: el propio dueño pudo borrar su evidencia'; END IF;
  RAISE NOTICE 'OK 18 la evidencia no se sustituye ni la borra quien fichó';

  -- 19 · Subir bajo el expediente de otro no se puede.
  BEGIN
    INSERT INTO storage.objects (bucket_id, name, owner)
      VALUES ('presencia-evidencias',
              '11111111-0000-0000-0000-000000000001/9e000000-0000-0000-0000-000000000003/colada.jpg', MARCO);
    RAISE EXCEPTION '19: se pudo colgar una foto del expediente de otra persona';
  EXCEPTION WHEN insufficient_privilege THEN
    RAISE NOTICE 'OK 19 no se puede subir evidencia bajo el expediente de otro';
  END;

  RESET ROLE;
  PERFORM set_config('app.uid', NULL, false);
END $$;

-- ════════════════════════════════════════════════════════════════════════════
-- 20-21 · La ACL de las RPC
-- ════════════════════════════════════════════════════════════════════════════
DO $$
DECLARE
  fn   text;
  faltan text := '';
BEGIN
  FOREACH fn IN ARRAY ARRAY['presencia_marcar', 'presencia_mi_ficha',
                            'presencia_ficha_de_usuario', 'presencia_ficha_es_propia',
                            'presencia_zona_horaria'] LOOP
    -- 20 · anon no ejecuta ninguna.
    IF EXISTS (
      SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public' AND p.proname = fn
        AND has_function_privilege('anon', p.oid, 'EXECUTE')
    ) THEN faltan := faltan || fn || ' '; END IF;
  END LOOP;
  IF faltan <> '' THEN RAISE EXCEPTION '20: anon puede ejecutar: %', faltan; END IF;
  RAISE NOTICE 'OK 20 anon no ejecuta ninguna de las funciones del marcaje';

  IF NOT has_function_privilege('authenticated', 'public.presencia_marcar(uuid,text,text,jsonb,text)', 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'public.presencia_mi_ficha(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION '21: authenticated no puede ejecutar las RPC del marcaje'; END IF;
  RAISE NOTICE 'OK 21 authenticated sí: es quien marca';
END $$;
