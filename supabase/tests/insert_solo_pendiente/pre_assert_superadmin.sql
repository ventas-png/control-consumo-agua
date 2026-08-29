\set ON_ERROR_STOP on
\pset tuples_only on
\pset format unaligned

-- NEGATIVA (fase 2): con 20260907000900 aplicada, el contrato del alta rige
-- para todos… MENOS para el super_admin, que el OR dejaba exento. Silvia crea
-- la tarea YA CERRADA, con fecha inventada, el cierre atribuido a Caro y la
-- excepción de evidencia pre-cargada — exactamente el ataque que 000900 cerró
-- para el resto. Si esto dejara de reproducirse, el escenario no prueba nada.

DO $$
DECLARE
  t record;
BEGIN
  SET LOCAL ROLE insert_tester;
  PERFORM set_config('app.uid', 'e0000000-0000-0000-0000-000000000010', true);  -- Silvia

  INSERT INTO public.tareas_bloque
    (id, bloque_id, titulo, estado, completada_en, completado_por, motivo_sin_evidencia)
  VALUES
    ('e5000000-0000-0000-0000-0000000000f2', 'e3000000-0000-0000-0000-000000000001',
     'Nacida cerrada por la super_admin', 'completada', TIMESTAMPTZ '2026-08-02 08:00Z',
     'e0000000-0000-0000-0000-00000000000c',
     'pre-sellada al nacer');

  SELECT * INTO t FROM public.tareas_bloque
   WHERE id = 'e5000000-0000-0000-0000-0000000000f2';
  IF t.estado IS DISTINCT FROM 'completada'
     OR t.completada_en IS NULL
     OR t.completado_por IS DISTINCT FROM 'e0000000-0000-0000-0000-00000000000c'
     OR t.motivo_sin_evidencia IS DISTINCT FROM 'pre-sellada al nacer' THEN
    RAISE EXCEPTION 'pre-2: la vulnerabilidad ya no se reproduce (el alta pre-cerrada del super_admin no entró tal cual) — el escenario no vale';
  END IF;

  RAISE NOTICE 'OK pre2 con 20260907000900 a solas, el super_admin sigue creando la tarea cerrada, atribuida a otra persona y pre-sellada';
END;
$$;

-- Limpieza (superusuario): el tablero queda como antes del ataque.
DELETE FROM public.tareas_bloque WHERE id = 'e5000000-0000-0000-0000-0000000000f2';
