\set ON_ERROR_STOP on
\pset tuples_only on
\pset format unaligned

-- Invariantes de 20260906000100. Dos preguntas, y las dos hay que ejecutarlas:
--   A · ¿cambió algún acceso? (no debe)
--   B · ¿la forma nueva llegó al catálogo? (debe)

-- ════════════════════════════════════════════════════════════════════════════
-- A · NADIE GANÓ NI PERDIÓ ACCESO
-- ════════════════════════════════════════════════════════════════════════════

DO $$
DECLARE d record; n int;
BEGIN
  -- 1 · Las dos tandas existen y están completas. Sin esto, "no hay
  -- diferencias" podría significar "no se midió nada".
  SELECT count(*) INTO n FROM public.medicion WHERE etapa = 'antes';
  IF n <> 6 THEN RAISE EXCEPTION '1a: la tanda ANTES tiene % casos, se esperaban 6', n; END IF;
  SELECT count(*) INTO n FROM public.medicion WHERE etapa = 'despues';
  IF n <> 6 THEN RAISE EXCEPTION '1b: la tanda DESPUÉS tiene % casos, se esperaban 6', n; END IF;

  RAISE NOTICE 'OK 1  se midieron los seis accesos en las dos etapas';
END;
$$;

DO $$
DECLARE d record; hubo boolean := false;
BEGIN
  -- 2 · EL INVARIANTE CENTRAL. Caso por caso, mismo resultado antes y después.
  -- Una diferencia en cualquiera de los seis significa que la re-escritura
  -- cambió la semántica — abrió o cerró algo — y eso es exactamente lo que esta
  -- migración promete no hacer.
  FOR d IN
    SELECT a.caso, a.resultado AS antes, p.resultado AS despues
      FROM public.medicion a
      JOIN public.medicion p ON p.caso = a.caso AND p.etapa = 'despues'
     WHERE a.etapa = 'antes' AND a.resultado IS DISTINCT FROM p.resultado
  LOOP
    hubo := true;
    RAISE WARNING 'el acceso «%» cambió: antes=% después=%', d.caso, d.antes, d.despues;
  END LOOP;

  IF hubo THEN RAISE EXCEPTION '2: la migración cambió al menos un acceso'; END IF;
  RAISE NOTICE 'OK 2  los seis accesos dan idéntico antes y después';
END;
$$;

DO $$
DECLARE r text;
BEGIN
  -- 3 · Y los valores son los que deben ser, no seis coincidencias vacías. Si
  -- el fixture se rompiera y todo diera 0 o «rechazado», el invariante 2
  -- pasaría igual comparando basura contra basura.
  SELECT resultado INTO r FROM public.medicion WHERE etapa='despues' AND caso='bruno_ve_su_insumo';
  IF r <> '1' THEN RAISE EXCEPTION '3a: con el permiso, Bruno debería ver 1 insumo (vio %)', r; END IF;

  SELECT resultado INTO r FROM public.medicion WHERE etapa='despues' AND caso='bruno_registra_movimiento';
  IF r <> 'permitido' THEN RAISE EXCEPTION '3b: con el permiso, el movimiento debería entrar (%)', r; END IF;

  SELECT resultado INTO r FROM public.medicion WHERE etapa='despues' AND caso='bruno_borra_insumo';
  IF r <> '0' THEN RAISE EXCEPTION '3c: un operador no debería poder borrar (borró % filas)', r; END IF;

  SELECT resultado INTO r FROM public.medicion WHERE etapa='despues' AND caso='ana_ve_insumos';
  IF r <> '0' THEN RAISE EXCEPTION '3d: sin el permiso, Ana no debería ver nada (vio %)', r; END IF;

  SELECT resultado INTO r FROM public.medicion WHERE etapa='despues' AND caso='ana_registra_movimiento';
  IF r <> 'rechazado' THEN RAISE EXCEPTION '3e: sin el permiso, el movimiento debería rebotar (%)', r; END IF;

  SELECT resultado INTO r FROM public.medicion WHERE etapa='despues' AND caso='dana_ve_ajenos';
  IF r <> '0' THEN RAISE EXCEPTION '3f: el permiso cruzó el company_id (vio % ajenos)', r; END IF;

  RAISE NOTICE 'OK 3  y cada resultado es el correcto, no un empate de ceros';
END;
$$;

-- ════════════════════════════════════════════════════════════════════════════
-- B · LA FORMA NUEVA LLEGÓ AL CATÁLOGO
-- ════════════════════════════════════════════════════════════════════════════

-- Cuenta apariciones de `aguja` en `paja`. Sin regexp_count, que es de PG15 y
-- el sandbox no fija versión.
CREATE OR REPLACE FUNCTION pg_temp.veces(paja text, aguja text) RETURNS int
LANGUAGE sql IMMUTABLE AS $fn$
  SELECT (length($1) - length(replace($1, $2, ''))) / length($2)
$fn$;

DO $$
DECLARE d record; h text; desnudas text := '';
  HELPERS text[] := ARRAY['is_super_admin', 'get_my_company_id',
                          'user_has_permission', 'current_user_role'];
BEGIN
  -- 4 · Lo que el archivo .sql no puede demostrar: que Postgres guardó el
  -- predicado con el subselect. Es TODO el objetivo de la migración — si el
  -- envoltorio no llega al catálogo, el planificador sigue evaluando por fila y
  -- el PR no hizo nada, con los seis accesos igual de verdes.
  --
  -- No alcanza con «el predicado menciona SELECT»: bastaría UN helper envuelto
  -- para que pasara mientras otro quedó desnudo. Se exige que TODA llamada a
  -- cada helper esté precedida de SELECT. Postgres lo guarda como
  -- `( SELECT user_has_permission('…'::text) AS user_has_permission)`, así que
  -- se cuenta `helper(` —el alias no lleva paréntesis— contra `SELECT helper(`.
  FOR d IN
    SELECT policyname, COALESCE(qual, with_check) AS predicado
      FROM pg_policies
     WHERE schemaname = 'public'
       AND tablename IN ('suministros_condominio', 'movimientos_suministro')
  LOOP
    IF d.predicado IS NULL THEN
      desnudas := desnudas || ' ' || d.policyname || '(sin predicado)';
      CONTINUE;
    END IF;
    FOREACH h IN ARRAY HELPERS LOOP
      IF pg_temp.veces(d.predicado, h || '(') >
         pg_temp.veces(d.predicado, 'SELECT ' || h || '(') THEN
        desnudas := desnudas || ' ' || d.policyname || '.' || h;
      END IF;
    END LOOP;
  END LOOP;

  IF desnudas <> '' THEN
    RAISE EXCEPTION '4: llamadas sin envolver en el catálogo:%', desnudas; END IF;
  RAISE NOTICE 'OK 4  toda llamada quedó envuelta en pg_policies, helper por helper';
END;
$$;

DO $$
DECLARE n int;
BEGIN
  -- 5 · Están las ocho, ni una de menos. Un DROP sin su CREATE dejaría la tabla
  -- sin esa regla: con RLS activa nadie podría, y el invariante 2 lo vería…
  -- salvo justo en el caso que no se mide. Se cuenta explícitamente.
  SELECT count(*) INTO n FROM pg_policies
   WHERE schemaname = 'public'
     AND tablename IN ('suministros_condominio', 'movimientos_suministro');
  IF n <> 8 THEN RAISE EXCEPTION '5a: quedaron % políticas, se esperaban 8', n; END IF;

  SELECT count(*) INTO n FROM pg_policies
   WHERE schemaname = 'public'
     AND tablename IN ('suministros_condominio', 'movimientos_suministro')
     AND cmd = 'DELETE'
     AND position('current_user_role' in COALESCE(qual, '')) > 0;
  IF n <> 2 THEN RAISE EXCEPTION '5b: el DELETE dejó de mirar el rol (% de 2)', n; END IF;

  RAISE NOTICE 'OK 5  las ocho políticas siguen ahí y el DELETE sigue mirando el rol';
END;
$$;

DO $$
DECLARE v_prosrc text;
BEGIN
  -- 6 · Y la PLANTILLA del generador quedó corregida, que es lo que evita que
  -- la próxima tabla nazca con el mismo problema. Se mira el cuerpo guardado,
  -- no el archivo: la migración pudo no haberse aplicado.
  SELECT prosrc INTO v_prosrc FROM pg_proc
   WHERE proname = 'rbac_install_company_policies'
     AND pronamespace = 'public'::regnamespace;
  IF v_prosrc IS NULL THEN
    RAISE EXCEPTION '6a: desapareció rbac_install_company_policies'; END IF;
  IF position('(SELECT public.user_has_permission(%L))' in v_prosrc) = 0 THEN
    RAISE EXCEPTION '6b: la plantilla del generador sigue con la llamada desnuda'; END IF;

  -- Y NINGUNA queda desnuda. La plantilla emite la llamada CUATRO veces —SELECT,
  -- INSERT y las dos mitades del UPDATE— así que preguntar si alguna está
  -- envuelta no alcanza: desenvolver una sola dejaba pasar la invariante. Se
  -- borran las envueltas y se exige que no sobre ninguna mención.
  IF replace(v_prosrc, '(SELECT public.user_has_permission(%L))', '')
       LIKE '%user_has_permission%' THEN
    RAISE EXCEPTION '6c: quedó una llamada desnuda en la plantilla del generador'; END IF;

  RAISE NOTICE 'OK 6  el generador emite el envoltorio para las tablas futuras';
END;
$$;

