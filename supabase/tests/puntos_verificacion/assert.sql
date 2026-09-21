\set ON_ERROR_STOP on
\pset tuples_only on
\pset format unaligned

-- Invariantes de 20260921000100, verificadas EJECUTANDO las escrituras contra
-- Postgres. Lo que esta migración promete son RECHAZOS —sin foto no se cierra,
-- un punto de otro proyecto no se cuelga de la ruta— y un rechazo no se
-- comprueba leyendo el SQL: se comprueba intentándolo.

-- ════════════════════════════════════════════════════════════════════════════
-- A · LA EVIDENCIA SE EXIGE
-- ════════════════════════════════════════════════════════════════════════════

DO $$
BEGIN
  -- 1 · El punto que hereda `requiere_foto = true` del catálogo no cierra sin foto.
  BEGIN
    UPDATE public.visitas_control SET estado = 'ok'
    WHERE id = 'a0000000-0000-0000-0000-000000000041';
    RAISE EXCEPTION '1a: se cerró sin foto un punto que la exige';
  EXCEPTION WHEN check_violation THEN NULL;
  END;

  -- Con foto sí.
  UPDATE public.visitas_control
     SET estado = 'ok', foto_urls = '["p1/rondas/tablero.jpg"]'::jsonb
   WHERE id = 'a0000000-0000-0000-0000-000000000041';

  IF (SELECT estado FROM public.visitas_control
      WHERE id = 'a0000000-0000-0000-0000-000000000041') <> 'ok' THEN
    RAISE EXCEPTION '1b: con foto tampoco dejó cerrar'; END IF;

  RAISE NOTICE 'OK 1  la exigencia del catálogo se hereda y se aplica';
END;
$$;

DO $$
BEGIN
  -- 2 · La NOVEDAD tampoco escapa: es el caso donde más importa la prueba.
  BEGIN
    UPDATE public.visitas_control SET estado = 'novedad', notas = 'Tablero abierto'
    WHERE id = 'a0000000-0000-0000-0000-000000000043';
    RAISE EXCEPTION '2a: se registró una novedad sin la foto exigida';
  EXCEPTION WHEN check_violation THEN NULL;
  END;

  UPDATE public.visitas_control
     SET estado = 'novedad', notas = 'Bomba con fuga', foto_urls = '["p1/rondas/bomba.jpg"]'::jsonb
   WHERE id = 'a0000000-0000-0000-0000-000000000043';

  RAISE NOTICE 'OK 2  el override de la ruta exige foto donde el catálogo no la pedía';
END;
$$;

DO $$
DECLARE v_estado text;
BEGIN
  -- 3 · `omitido` queda FUERA del gate. Es el estado de NO haber pasado:
  -- exigirle foto lo volvería inalcanzable y dejaría rondas sin poder cerrarse.
  UPDATE public.visitas_control SET estado = 'omitido'
  WHERE id = 'a0000000-0000-0000-0000-000000000041';

  SELECT estado INTO v_estado FROM public.visitas_control
   WHERE id = 'a0000000-0000-0000-0000-000000000041';
  IF v_estado <> 'omitido' THEN
    RAISE EXCEPTION '3: omitir un punto que exige foto fue rechazado'; END IF;

  -- Y volver a cerrarlo SÍ vuelve a exigir: el gate mira la fila que queda, no
  -- lo que la fila fue.
  BEGIN
    UPDATE public.visitas_control SET estado = 'ok', foto_urls = '[]'::jsonb
    WHERE id = 'a0000000-0000-0000-0000-000000000041';
    RAISE EXCEPTION '3b: re-cerrar sin foto pasó el gate';
  EXCEPTION WHEN check_violation THEN NULL;
  END;

  RAISE NOTICE 'OK 3  omitir no pide foto; volver a cerrar sí';
END;
$$;

-- ════════════════════════════════════════════════════════════════════════════
-- B · LA EVIDENCIA NO SE EXIGE DONDE NADIE LA PIDIÓ
-- ════════════════════════════════════════════════════════════════════════════

DO $$
BEGIN
  -- 4 · El punto que hereda false cierra de un clic, como siempre.
  UPDATE public.visitas_control SET estado = 'ok'
  WHERE id = 'a0000000-0000-0000-0000-000000000042';

  -- 5 · Y la parada LEGADA (sin punto del catálogo) también: la migración no
  -- convierte nada, y una ronda sobre rutas viejas tiene que seguir cerrándose.
  UPDATE public.visitas_control SET estado = 'ok'
  WHERE id = 'a0000000-0000-0000-0000-000000000049';

  IF (SELECT count(*) FROM public.visitas_control
      WHERE estado = 'ok'
        AND id IN ('a0000000-0000-0000-0000-000000000042',
                   'a0000000-0000-0000-0000-000000000049')) <> 2 THEN
    RAISE EXCEPTION '4/5: el gate bloqueó puntos que no exigen nada'; END IF;

  RAISE NOTICE 'OK 4  el punto sin exigencia y la parada legada cierran sin ceremonia';
END;
$$;

DO $$
DECLARE v_exige boolean;
BEGIN
  -- 6 · La ruta puede AFLOJAR, no solo apretar: el override es un COALESCE en
  -- los dos sentidos, y `puntoExigeFoto` en cliente lo replica. Si esto fuera
  -- "solo se puede apretar", la UI mostraría un 📷 que el trigger no exige.
  UPDATE public.puntos_control_ruta SET requiere_foto = false
  WHERE id = 'f0000000-0000-0000-0000-000000000021';

  SELECT public.punto_ruta_requiere_foto('f0000000-0000-0000-0000-000000000021') INTO v_exige;
  IF v_exige THEN RAISE EXCEPTION '6a: el override a false no aflojó la exigencia'; END IF;

  UPDATE public.visitas_control SET estado = 'ok', foto_urls = '[]'::jsonb
  WHERE id = 'a0000000-0000-0000-0000-000000000041';

  -- Y se devuelve a herencia para no contaminar el resto.
  UPDATE public.puntos_control_ruta SET requiere_foto = NULL
  WHERE id = 'f0000000-0000-0000-0000-000000000021';

  SELECT public.punto_ruta_requiere_foto('f0000000-0000-0000-0000-000000000021') INTO v_exige;
  IF NOT v_exige THEN RAISE EXCEPTION '6b: al volver a NULL no reheredó el true del catálogo'; END IF;

  RAISE NOTICE 'OK 5  el override va en los dos sentidos y NULL vuelve a heredar';
END;
$$;

-- ════════════════════════════════════════════════════════════════════════════
-- C · EL CATÁLOGO NO SE DUPLICA NI SE MEZCLA ENTRE PROYECTOS
-- ════════════════════════════════════════════════════════════════════════════

DO $$
BEGIN
  -- 7 · Un punto por nombre normalizado dentro del área: es el guard de la
  -- carga masiva (pegar la misma lista dos veces).
  BEGIN
    INSERT INTO public.puntos_verificacion (company_id, project_id, area_id, nombre)
    VALUES ('aaaaaaaa-0000-0000-0000-000000000001', 'a1111111-0000-0000-0000-000000000001',
            'c0000000-0000-0000-0000-0000000000a1', '  TABLERO ELECTRICO ');
    RAISE EXCEPTION '7a: se creó un duplicado que difiere solo en acentos/mayúsculas';
  EXCEPTION WHEN unique_violation THEN NULL;
  END;

  -- El mismo nombre en OTRA área sí: "Puerta peatonal" existe en casi toda área,
  -- y ya está en el Estacionamiento. (No se reusa "Tablero eléctrico" a
  -- propósito: la invariante 10 mueve ESE punto de área y chocaría con la copia
  -- antes de llegar a la FK, tapando lo que quiere probar.)
  INSERT INTO public.puntos_verificacion (company_id, project_id, area_id, nombre)
  VALUES ('aaaaaaaa-0000-0000-0000-000000000001', 'a1111111-0000-0000-0000-000000000001',
          'c0000000-0000-0000-0000-0000000000a2', 'Puerta peatonal');

  RAISE NOTICE 'OK 6  el único por nombre normalizado es POR ÁREA, no global';
END;
$$;

DO $$
BEGIN
  -- 8 · Un nombre en blanco no entra (CHECK puntos_verif_nombre_check).
  BEGIN
    INSERT INTO public.puntos_verificacion (company_id, project_id, area_id, nombre)
    VALUES ('aaaaaaaa-0000-0000-0000-000000000001', 'a1111111-0000-0000-0000-000000000001',
            'c0000000-0000-0000-0000-0000000000a1', '   ');
    RAISE EXCEPTION '8: se creó un punto sin nombre';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  RAISE NOTICE 'OK 7  el nombre en blanco no pasa';
END;
$$;

DO $$
BEGIN
  -- 9 · El guard de tenant: un punto del proyecto A2 no se cuelga de una ruta
  -- del A1. Es el cruce que una RLS por EMPRESA no ve, porque ambos proyectos
  -- son de la misma.
  BEGIN
    INSERT INTO public.puntos_control_ruta (ruta_id, area_id, punto_id, orden)
    VALUES ('e0000000-0000-0000-0000-000000000011',
            'c0000000-0000-0000-0000-0000000000b1', 'd0000000-0000-0000-0000-0000000000b1', 9);
    RAISE EXCEPTION '9a: se colgó de la ruta un punto de otro proyecto';
  EXCEPTION WHEN check_violation THEN NULL;
  END;

  -- Y tampoco un ÁREA de otro proyecto, ni siquiera sin punto del catálogo: el
  -- agujero existía antes de esta migración y se cierra para las filas nuevas.
  BEGIN
    INSERT INTO public.puntos_control_ruta (ruta_id, area_id, orden)
    VALUES ('e0000000-0000-0000-0000-000000000011',
            'c0000000-0000-0000-0000-0000000000b1', 9);
    RAISE EXCEPTION '9b: se colgó de la ruta un área de otro proyecto';
  EXCEPTION WHEN check_violation THEN NULL;
  END;

  RAISE NOTICE 'OK 8  ruta, área y punto tienen que ser del mismo proyecto';
END;
$$;

DO $$
BEGIN
  -- 10 · La FK COMPUESTA: la parada no puede apuntar a un punto y declarar OTRA
  -- área. Es lo que sostiene el filtro de proyecto de sectionData (el área es el
  -- único que tiene esta tabla).
  BEGIN
    INSERT INTO public.puntos_control_ruta (ruta_id, area_id, punto_id, orden)
    VALUES ('e0000000-0000-0000-0000-000000000011',
            'c0000000-0000-0000-0000-0000000000a2',  -- Piscina
            'd0000000-0000-0000-0000-0000000000f1',  -- punto del Estacionamiento
            9);
    RAISE EXCEPTION '10a: la parada declaró un área distinta a la de su punto';
  EXCEPTION WHEN foreign_key_violation THEN NULL;
  END;

  -- Y mover el punto de área con una ruta encima queda bloqueado por el motor.
  BEGIN
    UPDATE public.puntos_verificacion SET area_id = 'c0000000-0000-0000-0000-0000000000a2'
    WHERE id = 'd0000000-0000-0000-0000-0000000000f1';
    RAISE EXCEPTION '10b: se movió de área un punto ya asignado a una ruta';
  EXCEPTION WHEN foreign_key_violation THEN NULL;
  END;

  RAISE NOTICE 'OK 9  la FK compuesta ata la parada al área de su punto';
END;
$$;

-- ════════════════════════════════════════════════════════════════════════════
-- D · LO QUE NO SE PUEDE ROMPER AL REORDENAR NI AL EDITAR
-- ════════════════════════════════════════════════════════════════════════════

DO $$
BEGIN
  -- 11 · Reordenar una parada (el gesto de las flechas ▲▼) no pasa por el guard
  -- de tenant. Sin `UPDATE OF …` + guardia de cambio real, una fila legada que
  -- ya violara la regla quedaría inmovible.
  UPDATE public.puntos_control_ruta SET orden = 7
  WHERE id = 'f0000000-0000-0000-0000-000000000029';

  -- Reescribir la fila entera con los MISMOS valores tampoco (es lo que hace
  -- cualquier ORM que persista el registro completo).
  UPDATE public.puntos_control_ruta
     SET ruta_id = ruta_id, area_id = area_id, punto_id = punto_id, orden = 3
   WHERE id = 'f0000000-0000-0000-0000-000000000029';

  RAISE NOTICE 'OK 10 reordenar y reescribir una parada no tropieza con el guard';
END;
$$;

DO $$
DECLARE v_creador uuid;
BEGIN
  -- 12 · Trazabilidad: `creado_por` lo sella la BD y es inmutable, igual que en
  -- las 88 tablas de 20260731000000.
  PERFORM set_config('app.uid', '11111111-0000-0000-0000-000000000001', true);

  INSERT INTO public.puntos_verificacion (id, company_id, project_id, area_id, nombre, creado_por)
  VALUES ('d0000000-0000-0000-0000-0000000000c9',
          'aaaaaaaa-0000-0000-0000-000000000001', 'a1111111-0000-0000-0000-000000000001',
          'c0000000-0000-0000-0000-0000000000a1', 'Cámara norte', NULL);

  SELECT creado_por INTO v_creador FROM public.puntos_verificacion
   WHERE id = 'd0000000-0000-0000-0000-0000000000c9';
  IF v_creador <> '11111111-0000-0000-0000-000000000001' THEN
    RAISE EXCEPTION '12a: no selló creado_por al insertar'; END IF;

  UPDATE public.puntos_verificacion SET creado_por = NULL
  WHERE id = 'd0000000-0000-0000-0000-0000000000c9';

  SELECT creado_por INTO v_creador FROM public.puntos_verificacion
   WHERE id = 'd0000000-0000-0000-0000-0000000000c9';
  IF v_creador IS NULL THEN
    RAISE EXCEPTION '12b: creado_por resultó mutable'; END IF;

  PERFORM set_config('app.uid', '', true);
  RAISE NOTICE 'OK 11 creado_por se sella al crear y no se puede reescribir';
END;
$$;

DO $$
DECLARE v_paradas int;
BEGIN
  -- 13 · Borrar un punto del catálogo se lleva sus paradas (ON DELETE CASCADE),
  -- pero borrar un ÁREA con puntos NO pasa: se desactiva, no se borra.
  BEGIN
    DELETE FROM public.areas_condominio WHERE id = 'c0000000-0000-0000-0000-0000000000a1';
    RAISE EXCEPTION '13a: se borró un área con puntos de catálogo colgando';
  EXCEPTION WHEN foreign_key_violation THEN NULL;
  END;

  DELETE FROM public.puntos_verificacion WHERE id = 'd0000000-0000-0000-0000-0000000000f2';
  SELECT count(*) INTO v_paradas FROM public.puntos_control_ruta
   WHERE id = 'f0000000-0000-0000-0000-000000000022';
  IF v_paradas <> 0 THEN
    RAISE EXCEPTION '13b: borrar el punto dejó su parada huérfana en la ruta'; END IF;

  RAISE NOTICE 'OK 12 el área no se borra por debajo; el punto sí arrastra sus paradas';
END;
$$;

-- ════════════════════════════════════════════════════════════════════════════
-- E · EL VOCABULARIO DE `estado` (20260920000000)
-- ════════════════════════════════════════════════════════════════════════════

DO $$
DECLARE v_def text;
BEGIN
  -- 14 · El CHECK admite lo que la aplicación escribe, y ya no lo que no.
  --
  -- Esta es LA invariante del arreglo: el fixture crea la tabla con el
  -- vocabulario viejo ('visitado'/'con_novedad'), que es como la deja la
  -- convergencia y como estaba en producción. Todo lo que se cerró más arriba
  -- con 'ok' y 'novedad' ya demostró que la migración corrió; acá se comprueba
  -- también el otro lado, que es el que se olvida: que el dominio viejo QUEDÓ
  -- FUERA y nadie pueda volver a escribirlo.
  SELECT pg_get_constraintdef(con.oid) INTO v_def
  FROM pg_constraint con WHERE con.conname = 'visitas_control_estado_check';

  IF v_def IS NULL THEN
    RAISE EXCEPTION '14a: el CHECK de estado desapareció en vez de cambiar'; END IF;
  IF v_def LIKE '%''visitado''%' OR v_def LIKE '%''con_novedad''%' THEN
    RAISE EXCEPTION '14b: el CHECK todavía admite el vocabulario viejo: %', v_def; END IF;

  -- Se usa la parada LEGADA, que ninguna invariante anterior borra. Y se
  -- comprueba que la fila EXISTE antes de intentarlo: un UPDATE que no casa
  -- ninguna fila no viola ningún CHECK, así que sin este guard la prueba
  -- pasaría por vacía — que es justo como falló al escribirla (la invariante 12
  -- se lleva en cascada la visita que usaba antes).
  IF NOT EXISTS (SELECT 1 FROM public.visitas_control
                 WHERE id = 'a0000000-0000-0000-0000-000000000049') THEN
    RAISE EXCEPTION '14c: la fila de prueba ya no existe; esta invariante no probaría nada'; END IF;

  BEGIN
    UPDATE public.visitas_control SET estado = 'visitado'
    WHERE id = 'a0000000-0000-0000-0000-000000000049';
    RAISE EXCEPTION '14d: se pudo escribir el estado viejo "visitado"';
  EXCEPTION WHEN check_violation THEN NULL;
  END;

  RAISE NOTICE 'OK 13 el estado usa el vocabulario de la app y el viejo quedó fuera';
END;
$$;
