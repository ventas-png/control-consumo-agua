\set ON_ERROR_STOP on
\pset tuples_only on
\pset format unaligned

-- NEGATIVA: sin la reparación, el fallo de producción se reproduce. Si esto
-- dejara de fallar, el fixture ya no reproduce nada y el resto no prueba.
-- Es el 23514 que ve la UI al completar una tarea con el homónimo legacy vivo.

DO $$
DECLARE
  T_PENDIENTE uuid := 'a1000000-0000-0000-0000-000000000001';
BEGIN
  BEGIN
    UPDATE public.tareas_bloque SET estado = 'completada' WHERE id = T_PENDIENTE;
    RAISE EXCEPTION 'pre-1: el homónimo legacy aceptó ''completada'' — el fixture ya no reproduce producción';
  EXCEPTION WHEN check_violation THEN
    NULL;
  END;
  BEGIN
    UPDATE public.tareas_bloque SET estado = 'con_observacion' WHERE id = T_PENDIENTE;
    RAISE EXCEPTION 'pre-2: el homónimo legacy aceptó ''con_observacion''';
  EXCEPTION WHEN check_violation THEN
    NULL;
  END;
  BEGIN
    UPDATE public.tareas_bloque SET estado = 'omitida' WHERE id = T_PENDIENTE;
    RAISE EXCEPTION 'pre-3: el homónimo legacy aceptó ''omitida''';
  EXCEPTION WHEN check_violation THEN
    NULL;
  END;
  RAISE NOTICE 'OK pre  el homónimo legacy rechaza los tres cierres canónicos (23514): el escenario reproduce producción';
END;
$$;
