\set ON_ERROR_STOP on
\pset tuples_only on
\pset format unaligned

-- Post-idempotencia: re-aplicar 20260907000500 no duplica el trigger de copia,
-- no reabre lo ya consumido y no afloja la autorización.

DO $$
DECLARE n bigint; v_stock numeric;
BEGIN
  SELECT count(*) INTO n FROM pg_trigger t
  JOIN pg_class c ON c.oid = t.tgrelid
  WHERE NOT t.tgisinternal AND c.relname = 'tareas_bloque'
    AND t.tgname = 'trg_tarea_copiar_insumos';
  IF n <> 1 THEN
    RAISE EXCEPTION 'idem-1: quedaron % triggers de copia (esperado 1)', n; END IF;

  -- El plan copiado no se duplicó (lo impediría el UNIQUE, pero conviene que
  -- la prueba lo diga en vez de confiar en que alguien recuerde la constraint).
  SELECT count(*) INTO n FROM public.tarea_bloque_suministros
   WHERE tarea_id = 'a1000000-0000-0000-0000-000000000001';
  IF n <> 2 THEN
    RAISE EXCEPTION 'idem-2: el plan quedó con % filas (esperado 2)', n; END IF;

  -- Lo consumido sigue consumido: el stock no se «recalcula» al re-aplicar.
  SELECT stock_actual INTO v_stock FROM public.suministros_condominio
   WHERE id = '50000000-0000-0000-0000-000000000001';
  IF v_stock <> 3 THEN
    RAISE EXCEPTION 'idem-3: el stock cambió al re-aplicar (quedó en %)', v_stock; END IF;

  IF (SELECT count(*) FROM public.movimientos_suministro
       WHERE origen_tabla = 'tareas_bloque') <> 3 THEN
    RAISE EXCEPTION 'idem-4: cambió la cantidad de salidas trazadas'; END IF;
END;
$$;

DO $$
DECLARE r record;
BEGIN
  -- Y la RPC sigue siendo idempotente y sigue autorizando igual.
  PERFORM set_config('app.uid', 'a0000000-0000-0000-0000-00000000000a', true);
  SELECT * INTO r FROM public.consumir_insumos_tarea(
    'a1000000-0000-0000-0000-000000000001',
    '[{"suministro_id": "50000000-0000-0000-0000-000000000001", "cantidad": 2}]'::jsonb);
  IF r.consumidos <> 0 THEN
    RAISE EXCEPTION 'idem-5: tras re-aplicar se volvió a descontar'; END IF;

  PERFORM set_config('app.uid', 'a0000000-0000-0000-0000-00000000000b', true);
  BEGIN
    PERFORM public.consumir_insumos_tarea(
      'a1000000-0000-0000-0000-000000000002', '[]'::jsonb);
    RAISE EXCEPTION 'idem-6: tras re-aplicar el de almacén pudo consumir';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;

  RAISE NOTICE 'OK   re-aplicar no duplica el trigger, conserva el consumo y sigue autorizando igual';
END;
$$;
