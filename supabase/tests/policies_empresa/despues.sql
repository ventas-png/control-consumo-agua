\set ON_ERROR_STOP on
\pset tuples_only on
\pset format unaligned

-- EL AGUJERO, CERRADO. Corre DESPUÉS de 20260923000000, sobre el MISMO esquema
-- y el MISMO padrón que acaba de demostrarlo abierto.
--
-- Se comprueban las dos direcciones. Cerrar de más también es un fallo: el
-- único lector real de esta tabla es `useEmpresaQuery`, y si dejara de leer, la
-- migración habría roto la aplicación en vez de protegerla.
--
-- OJO CON LA FORMA DEL RECHAZO. Acá se cierran DOS capas, y fallan distinto:
--   · sin policy         → la fila no se encuentra: 0 filas afectadas, sin error
--   · sin grant de tabla → error 42501 insufficient_privilege
-- Como esta migración quita también los grants, la escritura LANZA. Se mide de
-- las dos formas para que la prueba no dependa de cuál capa mordió primero.

-- ════════════════════════════════════════════════════════════════════════════
-- A · EL ADMIN DE LA OTRA EMPRESA YA NO MANDA
-- ════════════════════════════════════════════════════════════════════════════
SET ROLE authenticated;
SELECT set_config('app.uid', 'bbbbbbbb-0000-0000-0000-00000000000b', false);  -- admin, empresa B

DO $$
DECLARE n int;
BEGIN
  BEGIN
    UPDATE public.empresa SET nombre = 'otra vez desde B'
     WHERE id = 'e0000000-0000-0000-0000-000000000001';
    GET DIAGNOSTICS n = ROW_COUNT;
    IF n <> 0 THEN RAISE EXCEPTION 'B1: el admin de otra empresa sigue modificando'; END IF;
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;

  BEGIN
    DELETE FROM public.empresa WHERE id = 'e0000000-0000-0000-0000-000000000003';
    GET DIAGNOSTICS n = ROW_COUNT;
    IF n <> 0 THEN RAISE EXCEPTION 'B2: el admin de otra empresa sigue borrando'; END IF;
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;

  BEGIN
    INSERT INTO public.empresa (nombre) VALUES ('otra insertada desde B');
    RAISE EXCEPTION 'B3: el admin de otra empresa sigue insertando';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;

  RAISE NOTICE 'OK 1  el admin de otra empresa no modifica, no borra, no inserta';
END;
$$;

-- ════════════════════════════════════════════════════════════════════════════
-- B · LA LECTURA SIGUE FUNCIONANDO (no se cerró de más)
--
-- Es literalmente lo que hace `useEmpresaQuery`: select sin filtro, limit 1.
-- Se comprueba con los dos roles de la empresa A —el admin y el operativo—
-- porque la policy que queda es `USING (true)` para todo `authenticated`.
-- ════════════════════════════════════════════════════════════════════════════
SELECT set_config('app.uid', 'aaaaaaaa-0000-0000-0000-00000000000a', false);  -- admin, empresa A

DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM (SELECT * FROM public.empresa LIMIT 1) q;
  IF n <> 1 THEN RAISE EXCEPTION 'B4: useEmpresaQuery dejó de leer (admin)'; END IF;
  RAISE NOTICE 'OK 2  el admin sigue leyendo: useEmpresaQuery no se rompe';
END;
$$;

SELECT set_config('app.uid', 'cccccccc-0000-0000-0000-00000000000c', false);  -- operator, empresa A

DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM (SELECT * FROM public.empresa LIMIT 1) q;
  IF n <> 1 THEN RAISE EXCEPTION 'B5: el operativo dejó de leer'; END IF;

  -- Y escribir sigue sin poder, como antes: esto no era el agujero y no cambia.
  BEGIN
    UPDATE public.empresa SET nombre = 'x' WHERE id = 'e0000000-0000-0000-0000-000000000001';
    GET DIAGNOSTICS n = ROW_COUNT;
    IF n <> 0 THEN RAISE EXCEPTION 'B6: el operativo pasó a poder escribir'; END IF;
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;

  RAISE NOTICE 'OK 3  el operativo lee y sigue sin escribir';
END;
$$;

RESET ROLE;

-- ════════════════════════════════════════════════════════════════════════════
-- C · `anon` NO EXISTE PARA ESTA TABLA
--
-- Antes tampoco podía —`current_user_role()` da NULL sin sesión— pero lo hacía
-- por el PREDICADO, con los siete grants puestos. Ahora no llega ni al
-- predicado: el grant ya no está.
-- ════════════════════════════════════════════════════════════════════════════
SET ROLE anon;

DO $$
DECLARE n int;
BEGIN
  BEGIN
    SELECT count(*) INTO n FROM public.empresa;
    RAISE EXCEPTION 'B7: anon todavía lee la tabla';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;

  BEGIN
    INSERT INTO public.empresa (nombre) VALUES ('desde anon');
    RAISE EXCEPTION 'B8: anon todavía inserta';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;

  RAISE NOTICE 'OK 4  anon no lee ni escribe: se le cayó el grant, no sólo el predicado';
END;
$$;

RESET ROLE;

-- ════════════════════════════════════════════════════════════════════════════
-- D · LO QUE QUEDA EN EL CATÁLOGO
-- ════════════════════════════════════════════════════════════════════════════
DO $$
DECLARE sobrante text; v_n int; v_rol text; v_priv text;
BEGIN
  -- Las cuatro legadas, por nombre.
  SELECT string_agg(policyname, ', ' ORDER BY policyname) INTO sobrante
  FROM pg_policies
  WHERE schemaname = 'public' AND tablename = 'empresa'
    AND policyname IN ('empresa_insert_by_role','empresa_update_by_role',
                       'empresa_delete_by_role','empresa_select_by_role');
  IF sobrante IS NOT NULL THEN
    RAISE EXCEPTION 'B9: sobrevivió una policy legada: %', sobrante; END IF;

  -- Y el conteo, que es lo que de verdad decide: una permisiva de más reabre
  -- el OR aunque no se llame como ninguna de las cuatro.
  SELECT count(*) INTO v_n FROM pg_policies
   WHERE schemaname = 'public' AND tablename = 'empresa';
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'B10: quedaron % policies, se esperaba exactamente 1', v_n; END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies
                  WHERE schemaname='public' AND tablename='empresa'
                    AND policyname='empresa_select_authenticated' AND cmd='SELECT') THEN
    RAISE EXCEPTION 'B11: la que queda no es empresa_select_authenticated'; END IF;

  RAISE NOTICE 'OK 5  queda exactamente una policy, y es la del repositorio';
END;
$$;

DO $$
DECLARE v_rol text; v_priv text;
BEGIN
  -- La segunda capa, medida por separado: que las policies estén bien no dice
  -- nada sobre los grants, y era justamente el grant lo que dejaba el arma
  -- cargada para la próxima policy permisiva.
  FOREACH v_rol IN ARRAY ARRAY['anon','authenticated','service_role'] LOOP
    FOREACH v_priv IN ARRAY ARRAY['INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER'] LOOP
      IF has_table_privilege(v_rol, 'public.empresa', v_priv) THEN
        RAISE EXCEPTION 'B12: % conserva % sobre empresa', v_rol, v_priv; END IF;
    END LOOP;
  END LOOP;

  IF has_table_privilege('anon', 'public.empresa', 'SELECT') THEN
    RAISE EXCEPTION 'B13: anon conserva SELECT'; END IF;

  IF NOT has_table_privilege('authenticated', 'public.empresa', 'SELECT') THEN
    RAISE EXCEPTION 'B14: authenticated perdió SELECT; se cerró de más'; END IF;

  RAISE NOTICE 'OK 6  grants: anon nada, authenticated sólo SELECT, nadie escribe';
END;
$$;
