\set ON_ERROR_STOP on
\pset tuples_only on
\pset format unaligned

-- Post-idempotencia: re-aplicar 20260907000800 no duplica triggers, no afloja
-- el guard y no toca lo copiado legítimamente.

DO $$
DECLARE
  n bigint;
  t record;
BEGIN
  SELECT count(*) INTO n FROM pg_trigger
   WHERE tgrelid = 'public.tareas_bloque'::regclass AND NOT tgisinternal
     AND tgname = 'trg_referencias_del_scope';
  IF n <> 1 THEN
    RAISE EXCEPTION 'idem-1: trg_referencias_del_scope quedó % veces (esperado 1)', n; END IF;
  SELECT count(*) INTO n FROM pg_trigger
   WHERE tgrelid = 'public.tareas_bloque'::regclass AND NOT tgisinternal
     AND tgname = 'trg_tarea_copiar_snapshot';
  IF n <> 1 THEN
    RAISE EXCEPTION 'idem-2: trg_tarea_copiar_snapshot quedó % veces (esperado 1)', n; END IF;

  -- La tarea legítima conserva su snapshot.
  SELECT * INTO t FROM public.tareas_bloque
   WHERE id = 'b2000000-0000-0000-0000-000000000001';
  IF t.instrucciones_seguridad IS DISTINCT FROM 'Usar guantes y gafas; no mezclar productos'
     OR jsonb_array_length(t.checklist) <> 3 THEN
    RAISE EXCEPTION 'idem-3: la re-aplicación tocó el snapshot legítimo'; END IF;
  RAISE NOTICE 'OK   re-aplicar no duplica triggers ni toca lo copiado';
END;
$$;

-- Y sigue cerrando: el mismo ataque de la NEGATIVA, ahora como usuaria.
DO $$
BEGIN
  SET LOCAL ROLE scope_tester;
  PERFORM set_config('app.uid', 'a0000000-0000-0000-0000-00000000000a', true);
  BEGIN
    INSERT INTO public.tareas_bloque (bloque_id, plantilla_id, titulo)
    VALUES ('70000000-0000-0000-0000-000000000001',
            '80000000-0000-0000-0000-000000000013', 'Robo B, segundo intento');
    RAISE EXCEPTION 'idem-4: tras re-aplicar, la plantilla ajena volvió a entrar';
  EXCEPTION WHEN foreign_key_violation THEN
    NULL;
  END;
  RAISE NOTICE 'OK   tras re-aplicar, el UUID ajeno sigue sin ser credencial';
END;
$$;
