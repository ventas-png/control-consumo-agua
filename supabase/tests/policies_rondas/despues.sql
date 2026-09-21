\set ON_ERROR_STOP on
\pset tuples_only on
\pset format unaligned

-- EL AGUJERO, CERRADO. Corre DESPUÉS de 20260922000000, sobre el MISMO esquema
-- y el MISMO padrón que acaba de demostrarlo abierto.
--
-- Se comprueban las dos direcciones. Cerrar de más también es un fallo: si el
-- encargado dejara de poder trabajar, la migración habría roto el tab en vez de
-- protegerlo.

-- ════════════════════════════════════════════════════════════════════════════
-- A · EL OPERATIVO SIN PERMISO YA NO PUEDE NADA
-- ════════════════════════════════════════════════════════════════════════════
SET ROLE authenticated;
SELECT set_config('app.uid', '11111111-0000-0000-0000-000000000001', false);

DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM public.puntos_control_ruta;
  IF n <> 0 THEN RAISE EXCEPTION 'B1: sigue leyendo % parada(s) sin permiso', n; END IF;

  SELECT count(*) INTO n FROM public.visitas_control;
  IF n <> 0 THEN RAISE EXCEPTION 'B2: sigue leyendo % visita(s) sin permiso', n; END IF;

  -- Un UPDATE sin policy que lo permita no lanza: no encuentra la fila. Se mide
  -- por filas afectadas, que es como se ve de verdad.
  UPDATE public.puntos_control_ruta SET instrucciones = 'otra vez sin permiso'
   WHERE id = 'f0000000-0000-0000-0000-000000000021';
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 0 THEN RAISE EXCEPTION 'B3: sigue modificando paradas sin permiso'; END IF;

  DELETE FROM public.visitas_control WHERE id = 'a0000000-0000-0000-0000-000000000041';
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 0 THEN RAISE EXCEPTION 'B4: sigue borrando visitas sin ser dueño'; END IF;

  -- El INSERT sí lanza: lo rechaza el WITH CHECK.
  BEGIN
    INSERT INTO public.puntos_control_ruta (ruta_id, area_id, orden)
    VALUES ('e0000000-0000-0000-0000-000000000011',
            'c0000000-0000-0000-0000-0000000000a1', 8);
    RAISE EXCEPTION 'B5: sigue insertando paradas sin permiso';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;

  RAISE NOTICE 'OK 1  sin el permiso del tab: no lee, no escribe, no borra';
END;
$$;

-- ════════════════════════════════════════════════════════════════════════════
-- B · EL ENCARGADO CON PERMISO SIGUE TRABAJANDO (no se cerró de más)
-- ════════════════════════════════════════════════════════════════════════════
SELECT set_config('app.uid', '22222222-0000-0000-0000-000000000002', false);

DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM public.puntos_control_ruta;
  IF n = 0 THEN RAISE EXCEPTION 'B6: el encargado con permiso dejó de leer paradas'; END IF;

  UPDATE public.puntos_control_ruta SET instrucciones = 'revisar candado y cámara'
   WHERE id = 'f0000000-0000-0000-0000-000000000021';
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN RAISE EXCEPTION 'B7: el encargado con permiso dejó de editar paradas'; END IF;

  INSERT INTO public.puntos_control_ruta (ruta_id, area_id, orden, instrucciones)
  VALUES ('e0000000-0000-0000-0000-000000000011',
          'c0000000-0000-0000-0000-0000000000a1', 7, 'alta legítima');

  RAISE NOTICE 'OK 2  con el permiso: lee, edita y da de alta, como antes';
END;
$$;

DO $$
DECLARE n int;
BEGIN
  -- Pero el DELETE NO: el gate lo reserva a company_owner/admin, y tener el
  -- permiso del tab no alcanza. Es la segunda puerta, y es independiente.
  DELETE FROM public.visitas_control WHERE id = 'a0000000-0000-0000-0000-000000000041';
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 0 THEN
    RAISE EXCEPTION 'B8: el encargado borró una visita sin ser company_owner ni admin'; END IF;

  RAISE NOTICE 'OK 3  el permiso del tab NO habilita el borrado';
END;
$$;

-- ════════════════════════════════════════════════════════════════════════════
-- C · LA DUEÑA SÍ PUEDE BORRAR
-- ════════════════════════════════════════════════════════════════════════════
SELECT set_config('app.uid', '33333333-0000-0000-0000-000000000003', false);

DO $$
DECLARE n int;
BEGIN
  DELETE FROM public.visitas_control WHERE id = 'a0000000-0000-0000-0000-000000000041';
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN
    RAISE EXCEPTION 'B9: company_owner no pudo borrar; se cerró de más'; END IF;

  RAISE NOTICE 'OK 4  company_owner conserva el borrado';
END;
$$;

RESET ROLE;

-- ════════════════════════════════════════════════════════════════════════════
-- D · LO QUE QUEDA EN EL CATÁLOGO
-- ════════════════════════════════════════════════════════════════════════════
DO $$
DECLARE sobrante text;
BEGIN
  SELECT string_agg(tablename || '.' || policyname, ', ' ORDER BY tablename, policyname)
    INTO sobrante
  FROM pg_policies
  WHERE schemaname = 'public'
    AND tablename IN ('puntos_control_ruta', 'visitas_control')
    AND policyname LIKE 'company\_rw\_%';

  IF sobrante IS NOT NULL THEN
    RAISE EXCEPTION 'B10: sobrevivió una policy legada: %', sobrante; END IF;

  SELECT string_agg(tablename || ': ' || n::text, ', ' ORDER BY tablename) INTO sobrante
  FROM (SELECT tablename, count(*) AS n FROM pg_policies
        WHERE schemaname='public' AND tablename IN ('puntos_control_ruta','visitas_control')
        GROUP BY tablename) t
  WHERE n <> 4;

  IF sobrante IS NOT NULL THEN
    RAISE EXCEPTION 'B11: alguna tabla no quedó con exactamente 4 policies (%)', sobrante; END IF;

  RAISE NOTICE 'OK 5  quedan exactamente las 4 policies de RBAC por tabla';
END;
$$;
