\set ON_ERROR_STOP on
\pset tuples_only on
\pset format unaligned

-- Post-idempotencia: re-aplicar 20260907000900 deja UNA policy de INSERT con
-- el contrato puesto, y ni afloja el alta ni rompe la puerta legítima.

DO $$
DECLARE
  n bigint;
BEGIN
  SELECT count(*) INTO n FROM pg_policy pol
   JOIN pg_class c ON c.oid = pol.polrelid
  WHERE c.relname = 'tareas_bloque' AND pol.polname = 'tareas_bloque_insert';
  IF n <> 1 THEN
    RAISE EXCEPTION 'idem-1: tareas_bloque_insert quedó % veces (esperada 1)', n; END IF;
  SELECT count(*) INTO n FROM pg_policy pol
   JOIN pg_class c ON c.oid = pol.polrelid
  WHERE c.relname = 'tareas_bloque' AND pol.polcmd = 'a';
  IF n <> 1 THEN
    RAISE EXCEPTION 'idem-2: hay % policies de INSERT sobre tareas_bloque (esperada 1)', n; END IF;
END;
$$;

DO $$
BEGIN
  SET LOCAL ROLE insert_tester;
  PERFORM set_config('app.uid', 'e0000000-0000-0000-0000-00000000000b', true);
  BEGIN
    INSERT INTO public.tareas_bloque (bloque_id, titulo, estado)
    VALUES ('e3000000-0000-0000-0000-000000000001', 'Cerrada, segundo intento', 'completada');
    RAISE EXCEPTION 'idem-3: tras re-aplicar, la cerrada directa volvió a entrar';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  INSERT INTO public.tareas_bloque (id, bloque_id, titulo)
  VALUES ('e5000000-0000-0000-0000-0000000000b1',
          'e3000000-0000-0000-0000-000000000001', 'Pendiente tras re-aplicar');

  -- Y el super_admin sigue DENTRO del contrato tras el replay 000900 → 001100:
  -- si el orden del re-apply dejara la forma vieja, esto lo grita.
  PERFORM set_config('app.uid', 'e0000000-0000-0000-0000-000000000010', true);
  BEGIN
    INSERT INTO public.tareas_bloque (bloque_id, titulo, estado)
    VALUES ('e3000000-0000-0000-0000-000000000001',
            'Cerrada por super_admin, segundo intento', 'completada');
    RAISE EXCEPTION 'idem-4: tras el replay, el super_admin volvió a quedar exento';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  RAISE NOTICE 'OK   re-aplicar es no-op: una sola policy, cerradas fuera (super_admin incluido), pendientes dentro';
END;
$$;
