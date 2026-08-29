\set ON_ERROR_STOP on
\pset tuples_only on
\pset format unaligned

-- NEGATIVA: con la policy de 20260907000100 a solas, el INSERT es la puerta
-- de atrás del cierre. Si esto dejara de reproducirse, el escenario no prueba
-- nada. Beto (operador, solo `tareas_personal`) crea una tarea YA CERRADA,
-- con fecha inventada, el cierre ATRIBUIDO A OTRA PERSONA (sellar_cierre solo
-- sella en UPDATE) y la excepción de evidencia pre-cargada.

CREATE ROLE insert_tester;
GRANT authenticated TO insert_tester;
GRANT USAGE ON SCHEMA public TO insert_tester;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO insert_tester;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO insert_tester;

DO $$
DECLARE
  t record;
BEGIN
  SET LOCAL ROLE insert_tester;
  PERFORM set_config('app.uid', 'e0000000-0000-0000-0000-00000000000b', true);  -- Beto

  INSERT INTO public.tareas_bloque
    (id, bloque_id, titulo, estado, completada_en, completado_por, motivo_sin_evidencia)
  VALUES
    ('e5000000-0000-0000-0000-0000000000f1', 'e3000000-0000-0000-0000-000000000001',
     'Nacida cerrada', 'completada', TIMESTAMPTZ '2026-08-01 08:00Z',
     'e0000000-0000-0000-0000-00000000000c',   -- ¡atribuida a Caro, la vecina!
     'pre-sellada al nacer');

  SELECT * INTO t FROM public.tareas_bloque
   WHERE id = 'e5000000-0000-0000-0000-0000000000f1';
  IF t.estado IS DISTINCT FROM 'completada'
     OR t.completada_en IS NULL
     OR t.completado_por IS DISTINCT FROM 'e0000000-0000-0000-0000-00000000000c'
     OR t.motivo_sin_evidencia IS DISTINCT FROM 'pre-sellada al nacer' THEN
    RAISE EXCEPTION 'pre-1: la vulnerabilidad ya no se reproduce (el alta pre-cerrada no entró tal cual) — el escenario no vale';
  END IF;

  RAISE NOTICE 'OK pre  sin la reparación, un INSERT directo crea la tarea cerrada, atribuida a otra persona y pre-sellada';
END;
$$;

-- Limpieza (superusuario): el tablero queda como antes del ataque.
DELETE FROM public.tareas_bloque WHERE id = 'e5000000-0000-0000-0000-0000000000f1';
