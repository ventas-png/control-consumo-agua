\set ON_ERROR_STOP on
\pset tuples_only on
\pset format unaligned

-- NEGATIVA: con 20260907000600 a solas, el UUID ajeno FUNCIONA como
-- credencial. Si esto dejara de reproducirse, el escenario ya no prueba nada
-- (la lección de drift_turnos). Ana —autenticada, de la compañía A, sin poder
-- LEER las plantillas de B por RLS— inserta en SU bloque con el UUID de la
-- plantilla de B, y el trigger SECURITY DEFINER le copia el snapshot ajeno.

CREATE ROLE scope_tester;
GRANT authenticated TO scope_tester;

DO $$
DECLARE
  t record;
BEGIN
  SET LOCAL ROLE scope_tester;
  PERFORM set_config('app.uid', 'a0000000-0000-0000-0000-00000000000a', true);

  -- Directo, por RLS, Ana NO ve la plantilla de B: la fuga no viene de ahí.
  IF EXISTS (SELECT 1 FROM public.plantillas_tarea_cargo
             WHERE id = '80000000-0000-0000-0000-000000000013') THEN
    RAISE EXCEPTION 'pre-0: la RLS del catálogo dejó ver la plantilla ajena — el escenario no reproduce producción';
  END IF;

  INSERT INTO public.tareas_bloque (id, bloque_id, plantilla_id, titulo)
  VALUES ('b2000000-0000-0000-0000-0000000000f1',
          '70000000-0000-0000-0000-000000000001',
          '80000000-0000-0000-0000-000000000013',   -- plantilla de la compañía B
          'Robo de receta');

  SELECT * INTO t FROM public.tareas_bloque
   WHERE id = 'b2000000-0000-0000-0000-0000000000f1';
  IF t.instrucciones_seguridad IS DISTINCT FROM 'SECRETO-B instrucciones'
     OR t.checklist::text NOT LIKE '%SECRETO-B%'
     OR NOT (t.requiere_foto AND t.requiere_comentario AND t.requiere_checklist) THEN
    RAISE EXCEPTION 'pre-1: la vulnerabilidad ya no se reproduce (no se copió el snapshot ajeno) — el escenario no vale';
  END IF;

  RAISE NOTICE 'OK pre  sin la reparación, el UUID ajeno copia checklist, instrucciones y exigencias de otra compañía';
END;
$$;

-- Limpieza (superusuario): el tablero queda como antes del ataque.
DELETE FROM public.tareas_bloque WHERE id = 'b2000000-0000-0000-0000-0000000000f1';
