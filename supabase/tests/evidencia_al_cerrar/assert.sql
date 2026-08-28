\set ON_ERROR_STOP on
\pset tuples_only on
\pset format unaligned

-- Invariantes de 20260907000400 (evidencia al cerrar), verificadas EJECUTANDO
-- los UPDATE contra Postgres. El punto de este trigger es que la base RECHACE,
-- y un rechazo no se comprueba leyendo el SQL: se comprueba intentándolo.

-- ════════════════════════════════════════════════════════════════════════════
-- A · LO QUE SE EXIGE
-- ════════════════════════════════════════════════════════════════════════════

DO $$
BEGIN
  -- 1 · Sin foto no se cierra la tarea que la exige.
  BEGIN
    UPDATE public.tareas_bloque SET estado = 'completada'
    WHERE id = '80000000-0000-0000-0000-0000000000f0';
    RAISE EXCEPTION '1a: se cerró una tarea que exige foto, sin foto';
  EXCEPTION WHEN check_violation THEN NULL;
  END;

  -- Con foto sí.
  UPDATE public.tareas_bloque
     SET estado = 'completada', foto_urls = '["evidencia/1.jpg"]'::jsonb
   WHERE id = '80000000-0000-0000-0000-0000000000f0';

  IF (SELECT estado FROM public.tareas_bloque
      WHERE id = '80000000-0000-0000-0000-0000000000f0') <> 'completada' THEN
    RAISE EXCEPTION '1b: con foto tampoco dejó cerrar'; END IF;

  RAISE NOTICE 'OK 1  la tarea que exige foto no se cierra sin ella';
END;
$$;

DO $$
BEGIN
  -- 2 · Sin comentario no se cierra la que lo exige. Y en blanco no cuenta como
  -- comentario: `btrim` decide, no la longitud.
  BEGIN
    UPDATE public.tareas_bloque SET estado = 'completada'
    WHERE id = '80000000-0000-0000-0000-0000000000c0';
    RAISE EXCEPTION '2a: se cerró sin el comentario exigido';
  EXCEPTION WHEN check_violation THEN NULL;
  END;

  BEGIN
    UPDATE public.tareas_bloque SET estado = 'completada', evidencia_texto = '    '
    WHERE id = '80000000-0000-0000-0000-0000000000c0';
    RAISE EXCEPTION '2b: un comentario en blanco pasó como comentario';
  EXCEPTION WHEN check_violation THEN NULL;
  END;

  UPDATE public.tareas_bloque
     SET estado = 'completada', evidencia_texto = 'Se cambió el filtro'
   WHERE id = '80000000-0000-0000-0000-0000000000c0';

  RAISE NOTICE 'OK 2  el comentario obligatorio se exige, y en blanco no cuenta';
END;
$$;

DO $$
BEGIN
  -- 3 · El checklist se exige COMPLETO: a medias no es evidencia de que la
  -- tarea se hizo, es evidencia de que se hizo una parte.
  BEGIN
    UPDATE public.tareas_bloque SET estado = 'completada'
    WHERE id = '80000000-0000-0000-0000-0000000000d0';
    RAISE EXCEPTION '3a: se cerró con el checklist vacío';
  EXCEPTION WHEN check_violation THEN NULL;
  END;

  BEGIN
    UPDATE public.tareas_bloque
       SET estado = 'completada', checklist_completado = '[0, 1]'::jsonb
     WHERE id = '80000000-0000-0000-0000-0000000000d0';
    RAISE EXCEPTION '3b: se cerró con 2 de 3 pasos';
  EXCEPTION WHEN check_violation THEN NULL;
  END;

  -- Marcar el mismo paso tres veces NO completa el checklist: se exige que
  -- estén TODAS las posiciones, no que haya tres marcas.
  BEGIN
    UPDATE public.tareas_bloque
       SET estado = 'completada', checklist_completado = '[0, 0, 0]'::jsonb
     WHERE id = '80000000-0000-0000-0000-0000000000d0';
    RAISE EXCEPTION '3c: tres marcas del mismo paso pasaron por checklist completo';
  EXCEPTION WHEN check_violation THEN NULL;
  END;

  UPDATE public.tareas_bloque
     SET estado = 'completada', checklist_completado = '[0, 1, 2]'::jsonb
   WHERE id = '80000000-0000-0000-0000-0000000000d0';

  RAISE NOTICE 'OK 3  el checklist se exige completo, y repetir un paso no lo completa';
END;
$$;

-- ════════════════════════════════════════════════════════════════════════════
-- B · LO QUE NO SE EXIGE
-- ════════════════════════════════════════════════════════════════════════════

DO $$
DECLARE
  v text;
BEGIN
  -- 4 · La tarea sin exigencias se cierra sin ceremonia; el control positivo.
  UPDATE public.tareas_bloque SET estado = 'completada'
  WHERE id = '80000000-0000-0000-0000-0000000000aa';

  IF (SELECT estado FROM public.tareas_bloque
      WHERE id = '80000000-0000-0000-0000-0000000000aa') <> 'completada' THEN
    RAISE EXCEPTION '4a: el trigger bloqueó una tarea que no exige nada'; END IF;

  RAISE NOTICE 'OK 4  la tarea que no exige nada se cierra sin ceremonia';
END;
$$;

DO $$
DECLARE
  v text;
BEGIN
  -- 5 · La salida declarada: con motivo se cierra, y la fila dice por qué.
  UPDATE public.tareas_bloque
     SET estado = 'completada',
         motivo_sin_evidencia = 'Cámara del teléfono rota; lo verificó el supervisor en sitio'
   WHERE id = '80000000-0000-0000-0000-0000000000b0';

  SELECT motivo_sin_evidencia INTO v FROM public.tareas_bloque
  WHERE id = '80000000-0000-0000-0000-0000000000b0';
  IF COALESCE(btrim(v), '') = '' THEN
    RAISE EXCEPTION '5a: se cerró con la salida de emergencia y no quedó el motivo'; END IF;

  -- Un motivo EN BLANCO no es una salida: sería el bypass silencioso que este
  -- diseño evita a propósito.
  BEGIN
    UPDATE public.tareas_bloque
       SET estado = 'completada', motivo_sin_evidencia = '   '
     WHERE id = '80000000-0000-0000-0000-0000000000e0';
    RAISE EXCEPTION '5b: un motivo en blanco funcionó como bypass';
  EXCEPTION WHEN check_violation THEN NULL;
  END;

  RAISE NOTICE 'OK 5  con motivo declarado se cierra; un motivo en blanco no es bypass';
END;
$$;

DO $$
BEGIN
  -- 6 · Reportar un problema no se castiga: `con_observacion` y `omitida` no
  -- pasan por el gate. Exigirles la evidencia completa empujaría a cerrar en
  -- falso, que es justo lo que el trigger viene a evitar.
  UPDATE public.tareas_bloque
     SET estado = 'con_observacion', notas_operativo = 'La llave no abre'
   WHERE id = '80000000-0000-0000-0000-00000000000b';

  UPDATE public.tareas_bloque SET estado = 'omitida'
  WHERE id = '80000000-0000-0000-0000-00000000000c';

  IF (SELECT count(*) FROM public.tareas_bloque
      WHERE id IN ('80000000-0000-0000-0000-00000000000b',
                   '80000000-0000-0000-0000-00000000000c')
        AND estado IN ('con_observacion', 'omitida')) <> 2 THEN
    RAISE EXCEPTION '6a: el gate bloqueó un reporte de problema'; END IF;

  RAISE NOTICE 'OK 6  reportar un problema u omitir no exige la evidencia del cierre';
END;
$$;

-- ════════════════════════════════════════════════════════════════════════════
-- C · LO QUE NO SE RE-VALIDA
-- ════════════════════════════════════════════════════════════════════════════

DO $$
DECLARE
  H uuid := '80000000-0000-0000-0000-0000000000ff';
BEGIN
  -- 7 · La fila HISTÓRICA —cerrada hace meses sin foto, como las que hay hoy en
  -- producción— se puede seguir tocando. El trigger gatea LA TRANSICIÓN, no la
  -- fila: si validara la fila, editar cualquier cosa de una tarea vieja
  -- reventaría, y migrar datos se volvería imposible.
  UPDATE public.tareas_bloque SET notas_operativo = 'anotación tardía' WHERE id = H;
  UPDATE public.tareas_bloque SET novedad = 'se revisó a posteriori' WHERE id = H;

  -- Incluso re-afirmar el mismo estado pasa: no hay transición.
  UPDATE public.tareas_bloque SET estado = 'completada' WHERE id = H;

  IF (SELECT estado FROM public.tareas_bloque WHERE id = H) <> 'completada' THEN
    RAISE EXCEPTION '7a: la fila histórica perdió su estado'; END IF;

  RAISE NOTICE 'OK 7  la tarea cerrada hace meses sin evidencia se sigue pudiendo editar';
END;
$$;

DO $$
DECLARE
  R uuid := '80000000-0000-0000-0000-0000000000f0';
BEGIN
  -- 8 · Pero REABRIR y volver a cerrar sí vuelve a exigir: es una transición
  -- nueva, y la evidencia que se quitó al reabrir ya no está.
  UPDATE public.tareas_bloque
     SET estado = 'pendiente', completada_en = NULL, foto_urls = '[]'::jsonb
   WHERE id = R;

  BEGIN
    UPDATE public.tareas_bloque SET estado = 'completada' WHERE id = R;
    RAISE EXCEPTION '8a: tras reabrir se pudo cerrar sin la foto otra vez';
  EXCEPTION WHEN check_violation THEN NULL;
  END;

  RAISE NOTICE 'OK 8  reabrir y volver a cerrar vuelve a exigir la evidencia';
END;
$$;

DO $$
DECLARE
  n bigint;
BEGIN
  -- 9 · El trigger no es SECURITY DEFINER: no lee nada fuera de la fila, así
  -- que no necesita saltarse ninguna RLS. Menos privilegio, menos superficie.
  SELECT count(*) INTO n
  FROM pg_proc p JOIN pg_namespace ns ON ns.oid = p.pronamespace
  WHERE ns.nspname = 'public'
    AND p.proname = 'exigir_evidencia_al_cerrar'
    AND p.prosecdef;
  IF n <> 0 THEN
    RAISE EXCEPTION '9a: el trigger se volvió SECURITY DEFINER sin necesitarlo'; END IF;

  -- Y está colgado de tareas_bloque, una sola vez.
  SELECT count(*) INTO n FROM pg_trigger t
  JOIN pg_class c ON c.oid = t.tgrelid
  WHERE NOT t.tgisinternal AND c.relname = 'tareas_bloque'
    AND t.tgname = 'trg_exigir_evidencia';
  IF n <> 1 THEN
    RAISE EXCEPTION '9b: hay % triggers de evidencia (esperado 1)', n; END IF;

  RAISE NOTICE 'OK 9  el control corre con el privilegio mínimo y está declarado una sola vez';
END;
$$;

-- ════════════════════════════════════════════════════════════════════════════
-- D · LA CONVIVENCIA CON LOS OTROS DOS TRIGGERS
-- ════════════════════════════════════════════════════════════════════════════

DO $$
DECLARE
  T   uuid := '80000000-0000-0000-0000-0000000000a1';
  UID uuid := 'a0000000-0000-0000-0000-00000000000a';
  r   record;
  n   bigint;
BEGIN
  -- 10 · `trg_exigir_evidencia` NO corre solo. 20260907000100 ya dejó
  -- `trg_sellar_cierre` y `trg_tareas_bloque_anulacion` sobre esta misma tabla,
  -- los tres son BEFORE UPDATE FOR EACH ROW, y PostgreSQL los dispara en ORDEN
  -- ALFABÉTICO: el de evidencia va PRIMERO, antes de que el sellado escriba
  -- completada_en/completado_por.
  --
  -- Sin esta invariante el sandbox mediría el trigger en un mundo que no
  -- existe: las nueve de arriba pasan igual con la tabla sin sellado, así que
  -- romper el orden —o que el rechazo dejara la fila a medio sellar— no se
  -- vería. Aquí se cierra con el gesto REAL de la app (estado + completada_en,
  -- TareasPersonalTab:214) y se exige que las dos cosas pasen a la vez.
  --
  -- NO se cuenta el total: producción lleva DOS MÁS que ningún sandbox puede
  -- montar —`trg_sellar_creado_por`, que crea el bucle dinámico de
  -- 20260731000000, y `trg_bitacora`, que es AFTER y por tanto no se
  -- interpone—, y ninguno toca las columnas en juego. Contar el total haría
  -- que este assert afirmara una equivalencia con producción que es falsa. Lo
  -- que sí tiene que valer es lo de abajo: que el par de sellado esté, y que
  -- el de evidencia ordene ANTES que él.
  SELECT count(*) INTO n FROM pg_trigger t
  JOIN pg_class c ON c.oid = t.tgrelid
  WHERE NOT t.tgisinternal AND c.relname = 'tareas_bloque'
    AND t.tgname IN ('trg_exigir_evidencia', 'trg_sellar_cierre', 'trg_tareas_bloque_anulacion');
  IF n <> 3 THEN
    RAISE EXCEPTION
      '10a: faltan triggers del escenario (hay % de 3): sin el par de sellado esto mide el gate en soledad', n;
  END IF;

  IF (SELECT min(t.tgname) FROM pg_trigger t
        JOIN pg_class c ON c.oid = t.tgrelid
       WHERE NOT t.tgisinternal AND c.relname = 'tareas_bloque'
         AND (t.tgtype & 2) <> 0        -- BEFORE
         AND (t.tgtype & 16) <> 0       -- UPDATE
     ) <> 'trg_exigir_evidencia' THEN
    RAISE EXCEPTION
      '10a-bis: el gate dejó de ser el PRIMER BEFORE UPDATE: el orden alfabético es lo único que garantiza que corra antes del sellado';
  END IF;

  PERFORM set_config('app.uid', UID::text, true);

  -- Rechazar no puede sellar a medias: sin foto, ni cierra ni deja rastro.
  BEGIN
    UPDATE public.tareas_bloque
       SET estado = 'completada', completada_en = now()
     WHERE id = T;
    RAISE EXCEPTION '10b: cerró sin foto pese a exigirla';
  EXCEPTION WHEN check_violation THEN NULL;
  END;

  SELECT estado, completada_en, completado_por INTO r
  FROM public.tareas_bloque WHERE id = T;
  IF r.estado <> 'pendiente' OR r.completada_en IS NOT NULL OR r.completado_por IS NOT NULL THEN
    RAISE EXCEPTION '10c: el rechazo dejó la fila tocada (estado=%, completada_en=%, completado_por=%)',
      r.estado, r.completada_en, r.completado_por;
  END IF;

  -- Con la foto: pasa el control Y queda sellada. Las dos, o ninguna sirve.
  UPDATE public.tareas_bloque
     SET estado = 'completada', completada_en = now(),
         foto_urls = '["evidencia/a1.jpg"]'::jsonb
   WHERE id = T;

  SELECT estado, completada_en, completado_por INTO r
  FROM public.tareas_bloque WHERE id = T;
  IF r.estado <> 'completada' THEN
    RAISE EXCEPTION '10d: con foto tampoco dejó cerrar'; END IF;
  IF r.completada_en IS NULL THEN
    RAISE EXCEPTION '10e: cerró sin fecha de cierre'; END IF;
  IF r.completado_por IS DISTINCT FROM UID THEN
    RAISE EXCEPTION '10f: pasó el control pero NO quedó sellada (completado_por=%, esperado %): trg_sellar_cierre no llegó a correr',
      r.completado_por, UID;
  END IF;

  RAISE NOTICE 'OK 10 convive con el sellado: rechazar no toca la fila, y cerrar sella';
END;
$$;
