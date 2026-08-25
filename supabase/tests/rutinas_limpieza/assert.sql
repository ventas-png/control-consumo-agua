\set ON_ERROR_STOP on
\pset tuples_only on
\pset format unaligned

-- Invariantes de 20260905000200 (rutinas de limpieza), verificadas EJECUTANDO
-- contra Postgres. Lo que se lee del SQL no cuenta: aquí se comprueba que la
-- base efectivamente rechaza lo que debe rechazar.

-- ════════════════════════════════════════════════════════════════════════════
-- A · DEFINICIÓN Y DOMINIO
-- ════════════════════════════════════════════════════════════════════════════

DO $$
DECLARE
  C1 uuid := 'c0000000-0000-0000-0000-000000000001';
  P1 uuid := '11111111-0000-0000-0000-000000000001';
  n  bigint;
  v  uuid;
BEGIN
  -- 1 · La rutina se crea y sella a su autor.
  PERFORM set_config('app.uid', 'a0000000-0000-0000-0000-00000000000a', true);

  INSERT INTO public.rutinas_limpieza (id, company_id, project_id, nombre, area_id, plantilla_horario_id)
  VALUES ('4a000000-0000-0000-0000-000000000001', C1, P1, 'Rutina matutina de piscina',
          'e0000000-0000-0000-0000-000000000001', 'f0000000-0000-0000-0000-000000000001');

  SELECT creado_por INTO v FROM public.rutinas_limpieza
  WHERE id = '4a000000-0000-0000-0000-000000000001';
  IF v IS DISTINCT FROM 'a0000000-0000-0000-0000-00000000000a'::uuid THEN
    RAISE EXCEPTION '1a: creado_por quedó % en vez del autor de la sesión', v; END IF;

  -- El sello es INMUTABLE ('forzar'): pasar otro autor no lo cambia.
  UPDATE public.rutinas_limpieza
     SET creado_por = 'a0000000-0000-0000-0000-00000000000d'
   WHERE id = '4a000000-0000-0000-0000-000000000001';
  SELECT creado_por INTO v FROM public.rutinas_limpieza
  WHERE id = '4a000000-0000-0000-0000-000000000001';
  IF v IS DISTINCT FROM 'a0000000-0000-0000-0000-00000000000a'::uuid THEN
    RAISE EXCEPTION '1b: se pudo reescribir creado_por a %', v; END IF;

  -- El servicio por defecto es limpieza.
  IF (SELECT servicio FROM public.rutinas_limpieza
      WHERE id = '4a000000-0000-0000-0000-000000000001') <> 'limpieza' THEN
    RAISE EXCEPTION '1c: el servicio por defecto no es limpieza'; END IF;

  RAISE NOTICE 'OK 1  la rutina existe, sabe de quién es y la BD impone el autor';
END;
$$;

DO $$
DECLARE
  C1 uuid := 'c0000000-0000-0000-0000-000000000001';
  P1 uuid := '11111111-0000-0000-0000-000000000001';
BEGIN
  -- 2 · Nombre en blanco y servicio inválido: rechazados.
  BEGIN
    INSERT INTO public.rutinas_limpieza (company_id, project_id, nombre)
    VALUES (C1, P1, '   ');
    RAISE EXCEPTION '2a: se aceptó una rutina con nombre en blanco';
  EXCEPTION WHEN check_violation THEN NULL;
  END;

  BEGIN
    INSERT INTO public.rutinas_limpieza (company_id, project_id, nombre, servicio)
    VALUES (C1, P1, 'Rutina rara', 'contabilidad');
    RAISE EXCEPTION '2b: se aceptó un servicio fuera del dominio';
  EXCEPTION WHEN check_violation THEN NULL;
  END;

  -- Duplicado por nombre normalizado (acentos, mayúsculas y espacios incluidos).
  BEGIN
    INSERT INTO public.rutinas_limpieza (company_id, project_id, nombre)
    VALUES (C1, P1, '  RUTINA MATUTINA DE PISCINA  ');
    RAISE EXCEPTION '2c: se aceptó una rutina duplicada por nombre normalizado';
  EXCEPTION WHEN unique_violation THEN NULL;
  END;

  -- Pero el MISMO nombre en OTRO proyecto de la misma empresa sí se permite:
  -- el UNIQUE es por proyecto, no por empresa.
  INSERT INTO public.rutinas_limpieza (id, company_id, project_id, nombre)
  VALUES ('4a000000-0000-0000-0000-00000000001b', C1,
          '11111111-0000-0000-0000-00000000001b', 'Rutina matutina de piscina');

  RAISE NOTICE 'OK 2  nombre y servicio controlados; el homónimo de otro proyecto convive';
END;
$$;

-- ════════════════════════════════════════════════════════════════════════════
-- B · TENANT CONGELADO (FKs compuestas + trigger)
-- ════════════════════════════════════════════════════════════════════════════

DO $$
DECLARE
  C1 uuid := 'c0000000-0000-0000-0000-000000000001';
  P1 uuid := '11111111-0000-0000-0000-000000000001';
  R1 uuid := '4a000000-0000-0000-0000-000000000001';
BEGIN
  -- 3 · La rutina no puede apuntar a un área de otra empresa NI de otro
  -- proyecto de la misma empresa. Lo bloquea la FK compuesta, no un trigger.
  BEGIN
    INSERT INTO public.rutinas_limpieza (company_id, project_id, nombre, area_id)
    VALUES (C1, P1, 'Con área ajena', 'e0000000-0000-0000-0000-000000000003');
    RAISE EXCEPTION '3a: se aceptó un área de OTRA empresa';
  EXCEPTION WHEN foreign_key_violation THEN NULL;
  END;

  BEGIN
    INSERT INTO public.rutinas_limpieza (company_id, project_id, nombre, area_id)
    VALUES (C1, P1, 'Con área de otro proyecto', 'e0000000-0000-0000-0000-00000000001b');
    RAISE EXCEPTION '3b: se aceptó un área de OTRO proyecto de la misma empresa';
  EXCEPTION WHEN foreign_key_violation THEN NULL;
  END;

  -- Lo mismo con la jornada.
  BEGIN
    INSERT INTO public.rutinas_limpieza (company_id, project_id, nombre, plantilla_horario_id)
    VALUES (C1, P1, 'Con jornada de otro proyecto', 'f0000000-0000-0000-0000-00000000001b');
    RAISE EXCEPTION '3c: se aceptó una jornada de OTRO proyecto';
  EXCEPTION WHEN foreign_key_violation THEN NULL;
  END;

  -- Y sin área ni jornada se acepta: en MATCH SIMPLE la FK compuesta con una
  -- columna NULL no se verifica, que es justo lo que queremos.
  INSERT INTO public.rutinas_limpieza (id, company_id, project_id, nombre)
  VALUES ('4a000000-0000-0000-0000-000000000009', C1, P1, 'Rutina general sin zona');

  RAISE NOTICE 'OK 3  el área y la jornada no cruzan empresa ni proyecto; sin ellas se permite';
END;
$$;

DO $$
DECLARE
  C1 uuid := 'c0000000-0000-0000-0000-000000000001';
  C2 uuid := 'c0000000-0000-0000-0000-000000000002';
  P1 uuid := '11111111-0000-0000-0000-000000000001';
  P2 uuid := '22222222-0000-0000-0000-000000000002';
  R1 uuid := '4a000000-0000-0000-0000-000000000001';
  v_c uuid; v_p uuid;
BEGIN
  -- 4 · El paso hereda el tenant de su rutina, aunque el cliente mienta.
  PERFORM set_config('app.uid', 'a0000000-0000-0000-0000-00000000000a', true);

  INSERT INTO public.rutina_actividades
    (id, company_id, project_id, rutina_id, plantilla_tarea_id, orden)
  VALUES ('4b000000-0000-0000-0000-000000000001', C2, P2, R1,
          'd0000000-0000-0000-0000-000000000001', 1);

  SELECT company_id, project_id INTO v_c, v_p
  FROM public.rutina_actividades WHERE id = '4b000000-0000-0000-0000-000000000001';
  IF v_c <> C1 OR v_p <> P1 THEN
    RAISE EXCEPTION '4a: el tenant del paso quedó %/% en vez del de la rutina', v_c, v_p; END IF;

  -- Actividad de OTRA empresa: aborta con mensaje legible, no con "no existe".
  BEGIN
    INSERT INTO public.rutina_actividades (company_id, project_id, rutina_id, plantilla_tarea_id)
    VALUES (C1, P1, R1, 'd0000000-0000-0000-0000-000000000004');
    RAISE EXCEPTION '4b: se aceptó una actividad de OTRA empresa';
  EXCEPTION WHEN check_violation THEN NULL;
  END;

  -- Actividad de la MISMA empresa pero de OTRO proyecto: el caso que una RLS
  -- por empresa no distingue, y que aquí sí se bloquea.
  BEGIN
    INSERT INTO public.rutina_actividades (company_id, project_id, rutina_id, plantilla_tarea_id)
    VALUES (C1, P1, R1, 'd0000000-0000-0000-0000-00000000001b');
    RAISE EXCEPTION '4c: se aceptó una actividad de OTRO proyecto de la misma empresa';
  EXCEPTION WHEN check_violation THEN NULL;
  END;

  -- Actividad inexistente: error de FK, no de check.
  BEGIN
    INSERT INTO public.rutina_actividades (company_id, project_id, rutina_id, plantilla_tarea_id)
    VALUES (C1, P1, R1, 'd0000000-0000-0000-0000-0000000000ff');
    RAISE EXCEPTION '4d: se aceptó una actividad inexistente';
  EXCEPTION WHEN foreign_key_violation THEN NULL;
  END;

  RAISE NOTICE 'OK 4  el paso hereda el tenant de su rutina y no admite actividad ajena';
END;
$$;

DO $$
DECLARE
  C1 uuid := 'c0000000-0000-0000-0000-000000000001';
  P1 uuid := '11111111-0000-0000-0000-000000000001';
  R1 uuid := '4a000000-0000-0000-0000-000000000001';
BEGIN
  -- 5 · La misma actividad dos veces en la misma rutina es duplicado.
  BEGIN
    INSERT INTO public.rutina_actividades (company_id, project_id, rutina_id, plantilla_tarea_id)
    VALUES (C1, P1, R1, 'd0000000-0000-0000-0000-000000000001');
    RAISE EXCEPTION '5a: se aceptó la misma actividad dos veces en la rutina';
  EXCEPTION WHEN unique_violation THEN NULL;
  END;

  -- Pero la misma actividad en OTRA rutina sí: el UNIQUE es por par.
  INSERT INTO public.rutina_actividades
    (id, company_id, project_id, rutina_id, plantilla_tarea_id)
  VALUES ('4b000000-0000-0000-0000-000000000009', C1, P1,
          '4a000000-0000-0000-0000-000000000009', 'd0000000-0000-0000-0000-000000000001');

  RAISE NOTICE 'OK 5  una actividad por rutina; reutilizarla en otra rutina se permite';
END;
$$;

DO $$
DECLARE
  C1 uuid := 'c0000000-0000-0000-0000-000000000001';
  R1 uuid := '4a000000-0000-0000-0000-000000000001';
  n  bigint;
BEGIN
  -- 6 · Mover la rutina de empresa/proyecto estando ya relacionada: bloqueado
  -- por la FK compuesta del paso. Un trigger sobre la hija NO puede ver esto.
  --
  -- Se usa la rutina SIN zona (…009, con un paso desde el assert 5) y no R1: R1
  -- tiene un homónimo en P1B, así que moverla chocaría antes con
  -- uq_rutinas_nombre_normalizado y la prueba pasaría por el motivo equivocado.
  BEGIN
    UPDATE public.rutinas_limpieza
       SET project_id = '11111111-0000-0000-0000-00000000001b'
     WHERE id = '4a000000-0000-0000-0000-000000000009';
    RAISE EXCEPTION '6a: se pudo mover de proyecto una rutina ya relacionada';
  EXCEPTION WHEN foreign_key_violation THEN NULL;
  END;

  -- Lo mismo con la actividad: no se muda con pasos colgando.
  BEGIN
    UPDATE public.plantillas_tarea_cargo
       SET project_id = '11111111-0000-0000-0000-00000000001b'
     WHERE id = 'd0000000-0000-0000-0000-000000000001';
    RAISE EXCEPTION '6b: se pudo mover de proyecto una actividad ya usada por una rutina';
  EXCEPTION WHEN foreign_key_violation THEN NULL;
  END;

  -- Y el área tampoco.
  BEGIN
    UPDATE public.areas_condominio
       SET project_id = '11111111-0000-0000-0000-00000000001b'
     WHERE id = 'e0000000-0000-0000-0000-000000000001';
    RAISE EXCEPTION '6c: se pudo mover de proyecto un área ya usada por una rutina';
  EXCEPTION WHEN foreign_key_violation THEN NULL;
  END;

  RAISE NOTICE 'OK 6  el tenant queda congelado mientras la relación viva';
END;
$$;

-- ════════════════════════════════════════════════════════════════════════════
-- C · BORRADO
-- ════════════════════════════════════════════════════════════════════════════

DO $$
DECLARE
  C1 uuid := 'c0000000-0000-0000-0000-000000000001';
  P1 uuid := '11111111-0000-0000-0000-000000000001';
  n  bigint;
BEGIN
  -- 7 · La actividad usada por una rutina no se borra (RESTRICT); la rutina sí
  -- se borra y se lleva sus pasos (CASCADE) — son definición, no historial.
  BEGIN
    DELETE FROM public.plantillas_tarea_cargo
    WHERE id = 'd0000000-0000-0000-0000-000000000001';
    RAISE EXCEPTION '7a: se borró una actividad que una rutina usa';
  EXCEPTION WHEN foreign_key_violation THEN NULL;
  END;

  -- El área usada tampoco.
  BEGIN
    DELETE FROM public.areas_condominio WHERE id = 'e0000000-0000-0000-0000-000000000001';
    RAISE EXCEPTION '7b: se borró un área que una rutina usa';
  EXCEPTION WHEN foreign_key_violation THEN NULL;
  END;

  -- La jornada usada tampoco.
  BEGIN
    DELETE FROM public.plantillas_horario WHERE id = 'f0000000-0000-0000-0000-000000000001';
    RAISE EXCEPTION '7c: se borró una jornada que una rutina usa';
  EXCEPTION WHEN foreign_key_violation THEN NULL;
  END;

  -- La rutina sí, arrastrando sus pasos.
  INSERT INTO public.rutinas_limpieza (id, company_id, project_id, nombre)
  VALUES ('4a000000-0000-0000-0000-0000000000de', C1, P1, 'Rutina desechable');
  INSERT INTO public.rutina_actividades (company_id, project_id, rutina_id, plantilla_tarea_id)
  VALUES (C1, P1, '4a000000-0000-0000-0000-0000000000de', 'd0000000-0000-0000-0000-000000000002');

  DELETE FROM public.rutinas_limpieza WHERE id = '4a000000-0000-0000-0000-0000000000de';
  SELECT count(*) INTO n FROM public.rutina_actividades
  WHERE rutina_id = '4a000000-0000-0000-0000-0000000000de';
  IF n <> 0 THEN
    RAISE EXCEPTION '7d: la rutina se borró y dejó % pasos huérfanos', n; END IF;

  RAISE NOTICE 'OK 7  lo referenciado no se borra; la receta se lleva sus pasos';
END;
$$;

-- ════════════════════════════════════════════════════════════════════════════
-- D · RLS
-- ════════════════════════════════════════════════════════════════════════════

SET ROLE authenticated;

DO $$
DECLARE
  C1 uuid := 'c0000000-0000-0000-0000-000000000001';
  P1 uuid := '11111111-0000-0000-0000-000000000001';
  n  bigint;
BEGIN
  -- 8 · Con el permiso del tab Limpieza —y NADA del módulo Seguridad— se
  -- administra la rutina completa.
  PERFORM set_config('app.uid', 'a0000000-0000-0000-0000-00000000000a', true);

  SELECT count(*) INTO n FROM public.rutinas_limpieza;
  IF n = 0 THEN
    RAISE EXCEPTION '8a: prog_limpieza no ve ninguna rutina de su empresa'; END IF;

  SELECT count(*) INTO n FROM public.rutina_actividades;
  IF n = 0 THEN
    RAISE EXCEPTION '8b: prog_limpieza no ve ningún paso'; END IF;

  INSERT INTO public.rutinas_limpieza (id, company_id, project_id, nombre)
  VALUES ('4a000000-0000-0000-0000-0000000000aa', C1, P1, 'Rutina creada por Limpieza');

  UPDATE public.rutinas_limpieza SET activa = false
  WHERE id = '4a000000-0000-0000-0000-0000000000aa';

  DELETE FROM public.rutinas_limpieza WHERE id = '4a000000-0000-0000-0000-0000000000aa';
  SELECT count(*) INTO n FROM public.rutinas_limpieza
  WHERE id = '4a000000-0000-0000-0000-0000000000aa';
  IF n <> 0 THEN
    RAISE EXCEPTION '8c: el DELETE de Limpieza no borró (policy de owner/admin?)'; END IF;

  RAISE NOTICE 'OK 8  prog_limpieza administra rutinas sin permisos del módulo Seguridad';
END;
$$;

DO $$
DECLARE
  C1 uuid := 'c0000000-0000-0000-0000-000000000001';
  P1 uuid := '11111111-0000-0000-0000-000000000001';
  n  bigint;
BEGIN
  -- 9 · Sin permiso no hay rutinas — ni para leer ni para escribir.
  PERFORM set_config('app.uid', 'a0000000-0000-0000-0000-00000000000b', true);

  SELECT count(*) INTO n FROM public.rutinas_limpieza;
  IF n <> 0 THEN
    RAISE EXCEPTION '9a: un usuario sin permiso ve % rutinas', n; END IF;

  SELECT count(*) INTO n FROM public.rutina_actividades;
  IF n <> 0 THEN
    RAISE EXCEPTION '9b: un usuario sin permiso ve % pasos', n; END IF;

  BEGIN
    INSERT INTO public.rutinas_limpieza (company_id, project_id, nombre)
    VALUES (C1, P1, 'Rutina sin permiso');
    RAISE EXCEPTION '9c: un usuario sin permiso creó una rutina';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;

  RAISE NOTICE 'OK 9  sin el permiso del tab no hay lectura ni escritura';
END;
$$;

DO $$
DECLARE
  C2 uuid := 'c0000000-0000-0000-0000-000000000002';
  P2 uuid := '22222222-0000-0000-0000-000000000002';
  n  bigint;
BEGIN
  -- 10 · La empresa vecina tiene el MISMO permiso y aun así no ve nada ajeno:
  -- el aislamiento no depende del permiso, sino de company_id.
  PERFORM set_config('app.uid', 'a0000000-0000-0000-0000-00000000000c', true);

  SELECT count(*) INTO n FROM public.rutinas_limpieza;
  IF n <> 0 THEN
    RAISE EXCEPTION '10a: la empresa vecina ve % rutinas ajenas', n; END IF;

  SELECT count(*) INTO n FROM public.rutina_actividades;
  IF n <> 0 THEN
    RAISE EXCEPTION '10b: la empresa vecina ve % pasos ajenos', n; END IF;

  -- Tampoco puede escribir en el tenant ajeno.
  BEGIN
    INSERT INTO public.rutinas_limpieza (company_id, project_id, nombre)
    VALUES ('c0000000-0000-0000-0000-000000000001',
            '11111111-0000-0000-0000-000000000001', 'Rutina intrusa');
    RAISE EXCEPTION '10c: la empresa vecina escribió en el tenant ajeno';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;

  RAISE NOTICE 'OK 10 la empresa vecina, con el mismo permiso, no ve ni escribe lo ajeno';
END;
$$;

RESET ROLE;

DO $$
DECLARE
  n bigint;
BEGIN
  -- 11 · anon no toca las tablas nuevas (GRANT de mínimo privilegio).
  SELECT count(*) INTO n
  FROM information_schema.role_table_grants
  WHERE grantee = 'anon'
    AND table_schema = 'public'
    AND table_name IN ('rutinas_limpieza', 'rutina_actividades');
  IF n <> 0 THEN
    RAISE EXCEPTION '11a: anon conserva % permisos sobre las tablas de rutinas', n; END IF;

  -- La SECURITY DEFINER nueva no es ejecutable por nadie salvo el dueño.
  IF has_function_privilege('authenticated', 'public.rutina_actividad_coherente()', 'EXECUTE') THEN
    RAISE EXCEPTION '11b: authenticated puede ejecutar rutina_actividad_coherente()'; END IF;
  IF has_function_privilege('anon', 'public.rutina_actividad_coherente()', 'EXECUTE') THEN
    RAISE EXCEPTION '11c: anon puede ejecutar rutina_actividad_coherente()'; END IF;

  -- Las cuatro policies de cada tabla existen.
  SELECT count(*) INTO n FROM pg_policies
  WHERE schemaname = 'public' AND tablename = 'rutinas_limpieza';
  IF n <> 4 THEN
    RAISE EXCEPTION '11d: rutinas_limpieza tiene % policies (esperadas 4)', n; END IF;

  SELECT count(*) INTO n FROM pg_policies
  WHERE schemaname = 'public' AND tablename = 'rutina_actividades';
  IF n <> 4 THEN
    RAISE EXCEPTION '11e: rutina_actividades tiene % policies (esperadas 4)', n; END IF;

  RAISE NOTICE 'OK 11 mínimo privilegio: anon fuera, la SECURITY DEFINER sin EXECUTE público';
END;
$$;
