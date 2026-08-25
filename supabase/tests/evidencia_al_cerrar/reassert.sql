\set ON_ERROR_STOP on
\pset tuples_only on
\pset format unaligned

-- Post-idempotencia: re-aplicar 20260905000400 no duplica el trigger, no
-- afloja el control y no toca lo ya cerrado.

DO $$
DECLARE n bigint;
BEGIN
  SELECT count(*) INTO n FROM pg_trigger t
  JOIN pg_class c ON c.oid = t.tgrelid
  WHERE NOT t.tgisinternal AND c.relname = 'tareas_bloque'
    AND t.tgname = 'trg_exigir_evidencia';
  IF n <> 1 THEN
    RAISE EXCEPTION 'idem-1: quedaron % triggers de evidencia (esperado 1)', n; END IF;

  -- Lo que se cerró con evidencia sigue cerrado.
  IF (SELECT estado FROM public.tareas_bloque
      WHERE id = '80000000-0000-0000-0000-0000000000c0') <> 'completada' THEN
    RAISE EXCEPTION 'idem-2: la re-aplicación revirtió un cierre válido'; END IF;

  -- El motivo declarado sobrevive.
  IF COALESCE(btrim((SELECT motivo_sin_evidencia FROM public.tareas_bloque
                     WHERE id = '80000000-0000-0000-0000-0000000000b0')), '') = '' THEN
    RAISE EXCEPTION 'idem-3: se perdió el motivo declarado'; END IF;

  -- Y el control sigue mordiendo.
  BEGIN
    UPDATE public.tareas_bloque SET estado = 'completada'
    WHERE id = '80000000-0000-0000-0000-0000000000f0';
    RAISE EXCEPTION 'idem-4: tras re-aplicar se pudo cerrar sin foto';
  EXCEPTION WHEN check_violation THEN NULL;
  END;

  RAISE NOTICE 'OK   re-aplicar no duplica el trigger, conserva los cierres y sigue exigiendo';
END;
$$;
