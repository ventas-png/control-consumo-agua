\set ON_ERROR_STOP on
\pset tuples_only on
\pset format unaligned

-- Invariantes de la fusión de áreas duplicadas (20260907000000).
-- Estado de partida: P1 tenía TRES áreas que normalizan a 'lobby'
--   …0003 'Lobby'    (activa, con created_at por defecto)
--   …0004 ' lobby '  (activa, y es la que TIENE las 4 referencias)
--   …0006 'LOBBY'    (INACTIVA y la más antigua: 2020)
-- y un cuarto 'Lobby' (…0007) en OTRO proyecto de la misma empresa, que NO
-- debe fusionarse.

DO $$
DECLARE
  P1        uuid := '11111111-0000-0000-0000-000000000001';
  P1B       uuid := '11111111-0000-0000-0000-000000000003';
  CO_A      uuid := 'aaaaaaaa-0000-0000-0000-000000000001';
  ADMIN_A   uuid := 'e0000000-0000-0000-0000-00000000000a';
  A_PERDEDORA uuid := 'a0000000-0000-0000-0000-000000000004';
  A_INACTIVA  uuid := 'a0000000-0000-0000-0000-000000000006';
  A_OTRO_PROY uuid := 'a0000000-0000-0000-0000-000000000007';
  PROG_LOBBY  uuid := 'b0000000-0000-0000-0000-000000000003';
  PUNTO       uuid := 'e2000000-0000-0000-0000-000000000001';
  TAREA       uuid := 'e4000000-0000-0000-0000-000000000001';
  PL_LIMPIEZA uuid := 'd0000000-0000-0000-0000-000000000001';
  -- Las que colgaban de la INACTIVA (…0006) y la fusión tuvo que mover.
  PUNTO_PERD  uuid := 'e2000000-0000-0000-0000-000000000002';
  TAREA_PERD  uuid := 'e4000000-0000-0000-0000-000000000002';
  PL_PERD     uuid := 'd0000000-0000-0000-0000-000000000003';
  PROG_PERD   uuid := 'b0000000-0000-0000-0000-000000000009';
  v_ganadora uuid;
  v_area uuid;
  n bigint;
BEGIN
  PERFORM set_config('app.uid', ADMIN_A::text, false);

  -- ── 29. Queda UNA sola área 'lobby' en P1, y es la más referenciada ──────
  SELECT count(*) INTO n FROM public.areas_condominio
  WHERE project_id = P1 AND public.areas_normalizar_nombre(nombre) = 'lobby';
  IF n <> 1 THEN
    RAISE EXCEPTION '35a: P1 debía quedar con UNA área lobby y tiene %', n; END IF;
  SELECT id INTO v_ganadora FROM public.areas_condominio
  WHERE project_id = P1 AND public.areas_normalizar_nombre(nombre) = 'lobby';
  -- La regla es activo DESC → referencias DESC → created_at → id.
  -- ' lobby ' (…0004) está activa y tiene las 4 referencias: gana.
  IF v_ganadora IS DISTINCT FROM A_PERDEDORA THEN
    RAISE EXCEPTION '35b: la superviviente debía ser la más referenciada (%) y fue %', A_PERDEDORA, v_ganadora; END IF;
  -- La inactiva más antigua NO gana pese a ser la más vieja.
  SELECT count(*) INTO n FROM public.areas_condominio WHERE id = A_INACTIVA;
  IF n <> 0 THEN
    RAISE EXCEPTION '35c: el área INACTIVA sobrevivió a la fusión'; END IF;
  RAISE NOTICE 'OK 35 la fusión deja una sola área y elige por activa > referenciada > antigua';

  -- ── 30. Las CUATRO FKs entrantes quedaron re-apuntadas ───────────────────
  SELECT area_id INTO v_area FROM public.puntos_control_ruta WHERE id = PUNTO;
  IF v_area IS DISTINCT FROM v_ganadora THEN
    RAISE EXCEPTION '36a: puntos_control_ruta.area_id (NOT NULL) quedó en %', v_area; END IF;
  SELECT area_id INTO v_area FROM public.tareas_bloque WHERE id = TAREA;
  IF v_area IS DISTINCT FROM v_ganadora THEN
    RAISE EXCEPTION '36b: tareas_bloque.area_id quedó en %', v_area; END IF;
  SELECT area_id INTO v_area FROM public.plantillas_tarea_cargo WHERE id = PL_LIMPIEZA;
  IF v_area IS DISTINCT FROM v_ganadora THEN
    RAISE EXCEPTION '36c: plantillas_tarea_cargo.area_id quedó en %', v_area; END IF;

  -- Las de arriba ya apuntaban a la superviviente antes de la fusión —son las
  -- que la hacen ganar—, así que no distinguen un re-apuntado correcto de uno
  -- ausente. Éstas sí: colgaban de la INACTIVA y sólo llegan aquí si la
  -- migración las movió. Una por tabla, las cuatro FKs.
  SELECT area_id INTO v_area FROM public.puntos_control_ruta WHERE id = PUNTO_PERD;
  IF v_area IS DISTINCT FROM v_ganadora THEN
    RAISE EXCEPTION '36e: el punto de control sobre la perdedora quedó en %', v_area; END IF;
  SELECT area_id INTO v_area FROM public.tareas_bloque WHERE id = TAREA_PERD;
  IF v_area IS DISTINCT FROM v_ganadora THEN
    RAISE EXCEPTION '36f: la tarea de bloque sobre la perdedora quedó en %', v_area; END IF;
  SELECT area_id INTO v_area FROM public.plantillas_tarea_cargo WHERE id = PL_PERD;
  IF v_area IS DISTINCT FROM v_ganadora THEN
    RAISE EXCEPTION '36g: la plantilla sobre la perdedora quedó en %', v_area; END IF;
  SELECT area_id INTO v_area FROM public.programacion_limpieza WHERE id = PROG_PERD;
  IF v_area IS DISTINCT FROM v_ganadora THEN
    RAISE EXCEPTION '36h: la programación sobre la perdedora quedó en %', v_area; END IF;
  -- Ninguna referencia puede apuntar a un área que ya no existe.
  SELECT count(*) INTO n FROM public.puntos_control_ruta p
  WHERE NOT EXISTS (SELECT 1 FROM public.areas_condominio a WHERE a.id = p.area_id);
  IF n <> 0 THEN
    RAISE EXCEPTION '36d: % puntos de control quedaron huérfanos', n; END IF;
  RAISE NOTICE 'OK 36 las 4 FKs entrantes apuntan a la superviviente, sin huérfanas';

  -- ── 31. El duplicado de OTRO proyecto no se tocó ─────────────────────────
  SELECT count(*) INTO n FROM public.areas_condominio WHERE id = A_OTRO_PROY;
  IF n <> 1 THEN
    RAISE EXCEPTION '37a: se fusionó un área de otro proyecto de la misma empresa'; END IF;
  SELECT project_id INTO v_area FROM public.areas_condominio WHERE id = A_OTRO_PROY;
  IF v_area IS DISTINCT FROM P1B THEN
    RAISE EXCEPTION '37b: el área del 2º proyecto cambió de proyecto'; END IF;
  RAISE NOTICE 'OK 37 la fusión particiona por proyecto: no cruza dentro del tenant';

  -- ── 32. La programación antes AMBIGUA quedó cerrada ──────────────────────
  SELECT area_id INTO v_area FROM public.programacion_limpieza WHERE id = PROG_LOBBY;
  IF v_area IS DISTINCT FROM v_ganadora THEN
    RAISE EXCEPTION '38: la programación ambigua debía cerrarse contra la superviviente y quedó %', v_area; END IF;
  RAISE NOTICE 'OK 38 la fusión desbloquea y cierra las programaciones que quedaron pendientes';

  -- ── 33. El texto en blanco sigue sin vincular (no se inventa nada) ───────
  SELECT area_id INTO v_area FROM public.programacion_limpieza
  WHERE id = 'b0000000-0000-0000-0000-000000000006';
  IF v_area IS NOT NULL THEN
    RAISE EXCEPTION '39: la programación con área en blanco se vinculó a %', v_area; END IF;
  RAISE NOTICE 'OK 39 lo que no tiene nombre comparable sigue sin vincular';

  -- ── 34. El UNIQUE existe y bloquea nuevos duplicados ─────────────────────
  SELECT count(*) INTO n FROM pg_indexes
  WHERE schemaname = 'public' AND indexname = 'uq_areas_nombre_normalizado';
  IF n <> 1 THEN
    RAISE EXCEPTION '40a: falta el índice único de nombre normalizado'; END IF;
  BEGIN
    INSERT INTO public.areas_condominio (company_id, project_id, nombre)
    VALUES (CO_A, P1, '  LOBBY  ');
    RAISE EXCEPTION '40b: se creó un duplicado normalizado de un área existente';
  EXCEPTION WHEN unique_violation THEN
    NULL;
  END;
  -- …pero el MISMO nombre en otro proyecto sigue siendo legítimo.
  INSERT INTO public.areas_condominio (id, company_id, project_id, nombre)
  VALUES ('a0000000-0000-0000-0000-0000000000ff', CO_A, P1B, 'Piscina');
  DELETE FROM public.areas_condominio WHERE id = 'a0000000-0000-0000-0000-0000000000ff';
  RAISE NOTICE 'OK 40 un nombre normalizado por proyecto: bloquea el duplicado, no el homónimo ajeno';

  -- ── 35. El catálogo de P1 quedó en su tamaño correcto ────────────────────
  -- Antes de la fusión P1 tenía 7: las 5 del fixture (Piscina, Jardín, Lobby,
  -- ' lobby ', LOBBY), la Terraza que creó el backfill, y la 'Caseta de
  -- vigilancia' que deja el assert 25 de RLS (Gina la crea y su DELETE no la
  -- alcanza, que es justo lo que ese assert demuestra). Menos las 2 perdedoras
  -- de lobby = 5.
  SELECT count(*) INTO n FROM public.areas_condominio WHERE project_id = P1;
  IF n <> 5 THEN
    RAISE EXCEPTION '41: P1 debía quedar con 5 áreas tras la fusión y tiene %', n; END IF;
  RAISE NOTICE 'OK 41 el catálogo queda sin duplicados y sin pérdidas colaterales';

  RAISE NOTICE '── 7 invariantes de fusión OK ──';
END;
$$;
