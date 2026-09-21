\set ON_ERROR_STOP on
\pset tuples_only on
\pset format unaligned

-- Re-verificación DESPUÉS de re-aplicar la migración. No repite las 12
-- invariantes: comprueba que la segunda pasada no duplicó objetos, no reescribió
-- datos y dejó las reglas vivas — que es lo único que una re-aplicación puede
-- romper.

DO $$
DECLARE n int;
BEGIN
  -- 1 · Nada duplicado: un trigger de cada uno, no dos.
  SELECT count(*) INTO n FROM pg_trigger
   WHERE tgname = 'trg_visitas_control_evidencia' AND NOT tgisinternal;
  IF n <> 1 THEN RAISE EXCEPTION 're-aplicar dejó % triggers de evidencia', n; END IF;

  SELECT count(*) INTO n FROM pg_trigger
   WHERE tgname = 'trg_puntos_control_ruta_tenant' AND NOT tgisinternal;
  IF n <> 1 THEN RAISE EXCEPTION 're-aplicar dejó % guards de tenant', n; END IF;

  SELECT count(*) INTO n FROM pg_policies
   WHERE schemaname = 'public' AND tablename = 'puntos_verificacion';
  IF n <> 4 THEN RAISE EXCEPTION 're-aplicar dejó % policies en el catálogo', n; END IF;

  SELECT count(*) INTO n FROM pg_constraint
   WHERE conname = 'puntos_control_ruta_punto_fkey';
  IF n <> 1 THEN RAISE EXCEPTION 're-aplicar dejó % FKs compuestas', n; END IF;

  RAISE NOTICE 'OK A  la segunda pasada no duplicó triggers, policies ni constraints';
END;
$$;

DO $$
DECLARE n int;
BEGIN
  -- 2 · Los datos del assert siguen ahí: `ADD COLUMN IF NOT EXISTS` con DEFAULT
  -- no puede haber reseteado `foto_urls` de lo ya cerrado.
  SELECT count(*) INTO n FROM public.visitas_control
   WHERE estado IN ('ok', 'novedad') AND jsonb_array_length(foto_urls) > 0;
  IF n < 1 THEN RAISE EXCEPTION 're-aplicar borró la evidencia ya cargada'; END IF;

  RAISE NOTICE 'OK B  la evidencia cargada sobrevivió a la re-aplicación';
END;
$$;

DO $$
BEGIN
  -- 3 · Y la regla sigue viva: sin foto, el punto que la exige sigue sin cerrar.
  BEGIN
    UPDATE public.visitas_control SET estado = 'ok', foto_urls = '[]'::jsonb
    WHERE id = 'a0000000-0000-0000-0000-000000000041';
    RAISE EXCEPTION 'tras re-aplicar, el gate de evidencia dejó de exigir';
  EXCEPTION WHEN check_violation THEN NULL;
  END;

  RAISE NOTICE 'OK C  el gate sigue exigiendo después de re-aplicar';
END;
$$;
