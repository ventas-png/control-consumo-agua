\set ON_ERROR_STOP on
\pset tuples_only on
\pset format unaligned

-- Invariantes de 20260907000900: la tarea NACE pendiente y sin sellos, para
-- CADA familia de permisos que la policy acepta — y el gate de cierre de
-- 20260907000400 sigue intacto en UPDATE.

-- ── 1-3 · Las tres familias: cerrada NO, pendiente SÍ ────────────────────────
-- Que una puerta esté cerrada no dice nada de las otras dos: se prueba POR
-- FAMILIA (tareas_personal, turnos, prog_limpieza), con el mismo guion.
DO $$
DECLARE
  BLOQUE constant uuid := 'e3000000-0000-0000-0000-000000000001';
  familias constant uuid[] := ARRAY[
    'e0000000-0000-0000-0000-00000000000b',   -- Beto  · tareas_personal
    'e0000000-0000-0000-0000-00000000000f',   -- Tomás · turnos
    'e0000000-0000-0000-0000-00000000000d'    -- Hugo  · prog_limpieza
  ]::uuid[];
  etiquetas constant text[] := ARRAY['tareas_personal', 'turnos', 'prog_limpieza'];
  u uuid;
  i int;
  v_estado text;
  n bigint;
BEGIN
  SET LOCAL ROLE insert_tester;
  FOR i IN 1..3 LOOP
    u := familias[i];
    PERFORM set_config('app.uid', u::text, true);

    BEGIN
      INSERT INTO public.tareas_bloque (bloque_id, titulo, estado)
      VALUES (BLOQUE, format('Cerrada directa (%s)', etiquetas[i]), 'completada');
      RAISE EXCEPTION '%: el INSERT directo en completada entró', etiquetas[i];
    EXCEPTION WHEN insufficient_privilege THEN NULL;
    END;
    BEGIN
      INSERT INTO public.tareas_bloque (bloque_id, titulo, estado)
      VALUES (BLOQUE, format('Observada directa (%s)', etiquetas[i]), 'con_observacion');
      RAISE EXCEPTION '%: el INSERT directo en con_observacion entró', etiquetas[i];
    EXCEPTION WHEN insufficient_privilege THEN NULL;
    END;
    BEGIN
      INSERT INTO public.tareas_bloque (bloque_id, titulo, estado)
      VALUES (BLOQUE, format('Omitida directa (%s)', etiquetas[i]), 'omitida');
      RAISE EXCEPTION '%: el INSERT directo en omitida entró', etiquetas[i];
    EXCEPTION WHEN insufficient_privilege THEN NULL;
    END;

    -- El pendiente limpio de esa MISMA familia entra: la puerta legítima no
    -- se cerró junto con la de atrás.
    INSERT INTO public.tareas_bloque (id, bloque_id, titulo)
    VALUES (('e5000000-0000-0000-0000-00000000000' || i)::uuid, BLOQUE,
            format('Pendiente limpia (%s)', etiquetas[i]));
    SELECT estado INTO v_estado FROM public.tareas_bloque
     WHERE id = ('e5000000-0000-0000-0000-00000000000' || i)::uuid;
    IF v_estado IS DISTINCT FROM 'pendiente' THEN
      RAISE EXCEPTION '%: la pendiente limpia quedó en %', etiquetas[i], v_estado; END IF;

    RAISE NOTICE 'OK %  familia %: cerradas rechazadas (42501), pendiente limpia entra', i, etiquetas[i];
  END LOOP;

  -- Y ninguna de las nueve rechazadas dejó fila.
  SELECT count(*) INTO n FROM public.tareas_bloque WHERE titulo LIKE '%directa (%';
  IF n <> 0 THEN
    RAISE EXCEPTION '3b: % fila(s) rechazadas quedaron insertadas', n; END IF;
END;
$$;

-- ── 4 · Los sellos tampoco entran de a uno, ni con estado pendiente ─────────
DO $$
DECLARE
  BLOQUE constant uuid := 'e3000000-0000-0000-0000-000000000001';
BEGIN
  SET LOCAL ROLE insert_tester;
  PERFORM set_config('app.uid', 'e0000000-0000-0000-0000-00000000000b', true);  -- Beto

  BEGIN
    INSERT INTO public.tareas_bloque (bloque_id, titulo, completada_en)
    VALUES (BLOQUE, 'Con fecha de cierre', now());
    RAISE EXCEPTION '4a: entró una pendiente con completada_en pre-cargada';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    INSERT INTO public.tareas_bloque (bloque_id, titulo, completado_por)
    VALUES (BLOQUE, 'Con actor de cierre', 'e0000000-0000-0000-0000-00000000000c');
    RAISE EXCEPTION '4b: entró una pendiente con completado_por atribuido';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    INSERT INTO public.tareas_bloque (bloque_id, titulo, anulada_en, motivo_anulacion)
    VALUES (BLOQUE, 'Pre-anulada', now(), 'nació anulada');
    RAISE EXCEPTION '4c: entró una tarea pre-anulada';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    INSERT INTO public.tareas_bloque (bloque_id, titulo, motivo_sin_evidencia)
    VALUES (BLOQUE, 'Bypass pre-armado', 'para cerrar sin evidencia después');
    RAISE EXCEPTION '4d: entró el sello de excepción pre-cargado';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  RAISE NOTICE 'OK 4  fecha, actor, anulación y sello de excepción: NULL al nacer, sin excepciones';
END;
$$;

-- ── 5 · El rol de empresa no es un bypass, y las puertas viejas siguen ──────
DO $$
DECLARE
  BLOQUE constant uuid := 'e3000000-0000-0000-0000-000000000001';
BEGIN
  SET LOCAL ROLE insert_tester;

  -- Ana es admin: user_has_permission le dice sí a todo — pero el contrato
  -- del alta no distingue rangos dentro de la empresa.
  PERFORM set_config('app.uid', 'e0000000-0000-0000-0000-00000000000a', true);
  BEGIN
    INSERT INTO public.tareas_bloque (bloque_id, titulo, estado)
    VALUES (BLOQUE, 'Cerrada por la admin', 'completada');
    RAISE EXCEPTION '5a: la admin insertó una tarea ya cerrada';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;

  -- Elio, sin permisos: la puerta de permisos de 20260907000100 sigue.
  PERFORM set_config('app.uid', 'e0000000-0000-0000-0000-00000000000e', true);
  BEGIN
    INSERT INTO public.tareas_bloque (bloque_id, titulo)
    VALUES (BLOQUE, 'Sin permiso');
    RAISE EXCEPTION '5b: sin permisos se insertó igual';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;

  -- Caro, de la empresa vecina: el aislamiento por empresa sigue.
  PERFORM set_config('app.uid', 'e0000000-0000-0000-0000-00000000000c', true);
  BEGIN
    INSERT INTO public.tareas_bloque (bloque_id, titulo)
    VALUES (BLOQUE, 'Desde la vecina');
    RAISE EXCEPTION '5c: la vecina insertó en un bloque ajeno';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  RAISE NOTICE 'OK 5  ni admin, ni sin-permiso, ni la vecina: el endurecimiento no aflojó nada';
END;
$$;

-- ── 6 · El cierre legítimo (UPDATE) sigue tal como lo dejó 20260907000400 ───
DO $$
DECLARE
  BLOQUE constant uuid := 'e3000000-0000-0000-0000-000000000001';
  T_EXIGE  constant uuid := 'e5000000-0000-0000-0000-0000000000a1';
  T_MOTIVO constant uuid := 'e5000000-0000-0000-0000-0000000000a2';
  T_HISTORICA constant uuid := 'e4000000-0000-0000-0000-000000000002';
  v uuid;
  n bigint;
BEGIN
  SET LOCAL ROLE insert_tester;
  PERFORM set_config('app.uid', 'e0000000-0000-0000-0000-00000000000b', true);  -- Beto

  -- Nacen pendientes, exigiendo comentario (las banderas del flujo normal sí
  -- se declaran al nacer: no son sellos).
  INSERT INTO public.tareas_bloque (id, bloque_id, titulo, requiere_comentario) VALUES
    (T_EXIGE,  BLOQUE, 'Cerrará con evidencia', true),
    (T_MOTIVO, BLOQUE, 'Cerrará con motivo',    true);

  -- Sin evidencia, el cierre se rechaza (el gate de la transición).
  BEGIN
    UPDATE public.tareas_bloque
       SET estado = 'completada', completada_en = now()
     WHERE id = T_EXIGE;
    RAISE EXCEPTION '6a: el cierre sin evidencia pasó — el gate de 20260907000400 se aflojó';
  EXCEPTION WHEN check_violation THEN NULL;
  END;

  -- Con la evidencia exigida, pasa — y el actor lo sella la BD, no el cliente.
  UPDATE public.tareas_bloque
     SET estado = 'completada', completada_en = now(),
         evidencia_texto = 'Quedó impecable'
   WHERE id = T_EXIGE;
  SELECT completado_por INTO v FROM public.tareas_bloque WHERE id = T_EXIGE;
  IF v IS DISTINCT FROM 'e0000000-0000-0000-0000-00000000000b' THEN
    RAISE EXCEPTION '6b: completado_por = % (debía sellarlo la BD con Beto)', v; END IF;

  -- La excepción DECLARADA al cerrar sigue disponible (es la de 20260907000400:
  -- se declara en el cierre, no se pre-carga en el alta).
  UPDATE public.tareas_bloque
     SET estado = 'completada', completada_en = now(),
         motivo_sin_evidencia = 'El proveedor retiró el equipo antes de la foto'
   WHERE id = T_MOTIVO;

  -- Y la fila HISTÓRICA cerrada sin evidencia no se re-valida en una edición
  -- no relacionada: el gate mira la transición, no la fila.
  UPDATE public.tareas_bloque SET notas_operativo = 'auditada 2026-08'
   WHERE id = T_HISTORICA;
  SELECT count(*) INTO n FROM public.tareas_bloque
   WHERE id = T_HISTORICA AND notas_operativo = 'auditada 2026-08';
  IF n <> 1 THEN
    RAISE EXCEPTION '6d: la edición no relacionada de la fila histórica no fluyó'; END IF;

  RAISE NOTICE 'OK 6  el cierre exige evidencia o su excepción declarada, sella al actor, y el histórico no se re-valida';
END;
$$;
