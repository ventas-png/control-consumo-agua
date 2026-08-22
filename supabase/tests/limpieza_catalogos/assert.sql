\set ON_ERROR_STOP on
\pset tuples_only on
\pset format unaligned

-- Invariantes de los catálogos operativos de limpieza
-- (20260904000000 · 000100 · 000200).
-- Cada bloque RAISE EXCEPTION si algo no se cumple.

DO $$
DECLARE
  ADMIN_A     uuid := 'e0000000-0000-0000-0000-00000000000a';
  CO_A        uuid := 'aaaaaaaa-0000-0000-0000-000000000001';
  CO_B        uuid := 'aaaaaaaa-0000-0000-0000-000000000002';
  P1          uuid := '11111111-0000-0000-0000-000000000001';
  P1B         uuid := '11111111-0000-0000-0000-000000000003';
  P2          uuid := '11111111-0000-0000-0000-000000000002';
  AREA_PISCINA uuid := 'a0000000-0000-0000-0000-000000000001';
  AREA_JARDIN  uuid := 'a0000000-0000-0000-0000-000000000002';
  AREA_PISC_B  uuid := 'a0000000-0000-0000-0000-000000000005';
  PROG_PISCINA uuid := 'b0000000-0000-0000-0000-000000000001';
  PROG_JARDIN  uuid := 'b0000000-0000-0000-0000-000000000002';
  PROG_LOBBY   uuid := 'b0000000-0000-0000-0000-000000000003';
  PROG_TERR_1  uuid := 'b0000000-0000-0000-0000-000000000004';
  PROG_TERR_2  uuid := 'b0000000-0000-0000-0000-000000000005';
  PROG_BLANCO  uuid := 'b0000000-0000-0000-0000-000000000006';
  PROG_VECINA  uuid := 'b0000000-0000-0000-0000-000000000007';
  PL_LIMPIEZA  uuid := 'd0000000-0000-0000-0000-000000000001';
  PL_JARDIN    uuid := 'd0000000-0000-0000-0000-000000000002';
  PL_POLIV     uuid := 'd0000000-0000-0000-0000-000000000003';
  SUM_CLORO    uuid := 'f0000000-0000-0000-0000-000000000001';
  SUM_OTRO_PROY uuid := 'f0000000-0000-0000-0000-000000000003';
  SUM_VECINO   uuid := 'f0000000-0000-0000-0000-000000000002';
  HER_HIDRO    uuid := 'f1000000-0000-0000-0000-000000000001';
  HER_VECINA   uuid := 'f1000000-0000-0000-0000-000000000002';
  v_area   uuid;
  v_terraza uuid;
  v_id     uuid;
  v_uuid   uuid;
  t        text;
  n        bigint;
BEGIN
  PERFORM set_config('app.uid', ADMIN_A::text, false);

  -- ══ A. Backfill de áreas ═══════════════════════════════════════════════════

  -- ── 1. Coincidencia única, con espacios y mayúsculas ─────────────────────
  SELECT area_id, area INTO v_area, t FROM public.programacion_limpieza WHERE id = PROG_PISCINA;
  IF v_area IS DISTINCT FROM AREA_PISCINA THEN
    RAISE EXCEPTION '1a: "  PISCINA " debía vincular al área Piscina y quedó %', v_area; END IF;
  IF t <> '  PISCINA ' THEN
    RAISE EXCEPTION '1b: el snapshot `area` se reescribió a "%" (debía quedar intacto)', t; END IF;
  RAISE NOTICE 'OK 1  coincidencia única vincula y el texto histórico queda intacto';

  -- ── 2. Coincidencia única con acentos, en minúscula y en MAYÚSCULA ───────
  SELECT area_id INTO v_area FROM public.programacion_limpieza WHERE id = PROG_JARDIN;
  IF v_area IS DISTINCT FROM AREA_JARDIN THEN
    RAISE EXCEPTION '2a: "jardin" debía vincular a "Jardín" y quedó %', v_area; END IF;
  -- 'JARDÍN': con lc_ctype=C, lower() deja la Í intacta; si el normalizador no
  -- la mapea, esta fila normaliza 'jardn', no matchea, y el backfill fabricaría
  -- un área duplicada (lo cazaría también el conteo del assert 5b).
  SELECT area_id INTO v_area FROM public.programacion_limpieza
  WHERE id = 'b0000000-0000-0000-0000-000000000008';
  IF v_area IS DISTINCT FROM AREA_JARDIN THEN
    RAISE EXCEPTION '2b: "JARDÍN" debía vincular a "Jardín" y quedó %', v_area; END IF;
  RAISE NOTICE 'OK 2  jardin y JARDÍN ↔ Jardín: los acentos no impiden el match';

  -- ── 3. Ambigua: dos áreas con el mismo nombre normalizado ────────────────
  SELECT area_id INTO v_area FROM public.programacion_limpieza WHERE id = PROG_LOBBY;
  IF v_area IS NOT NULL THEN
    RAISE EXCEPTION '3: "Lobby" es ambigua (Lobby / " lobby ") y aún así se vinculó a %', v_area; END IF;
  RAISE NOTICE 'OK 3  la coincidencia ambigua NO se resuelve sola: queda pendiente';

  -- ── 4. Inexistente: se crea UNA área para las dos variantes ──────────────
  SELECT count(*), min(id::text)::uuid INTO n, v_terraza
  FROM public.areas_condominio
  WHERE project_id = P1 AND public.areas_normalizar_nombre(nombre) = 'terrazabbq';
  IF n <> 1 THEN
    RAISE EXCEPTION '4a: debía existir UNA área terrazabbq en P1 y hay %', n; END IF;
  SELECT icono INTO t FROM public.areas_condominio WHERE id = v_terraza;
  IF t <> '🧹' THEN
    RAISE EXCEPTION '4b: el área creada por backfill debía llevar el ícono de limpieza y lleva %', t; END IF;
  SELECT count(*) INTO n FROM public.programacion_limpieza
  WHERE id IN (PROG_TERR_1, PROG_TERR_2) AND area_id = v_terraza;
  IF n <> 2 THEN
    RAISE EXCEPTION '4c: las dos variantes de Terraza BBQ debían vincular al área nueva (vinculadas: %)', n; END IF;
  RAISE NOTICE 'OK 4  el área inexistente se crea UNA sola vez y absorbe sus variantes';

  -- ── 5. El texto en blanco no crea nada ───────────────────────────────────
  SELECT area_id INTO v_area FROM public.programacion_limpieza WHERE id = PROG_BLANCO;
  IF v_area IS NOT NULL THEN
    RAISE EXCEPTION '5a: la programación con área en blanco se vinculó a %', v_area; END IF;
  SELECT count(*) INTO n FROM public.areas_condominio WHERE project_id = P1;
  IF n <> 5 THEN
    RAISE EXCEPTION '5b: P1 debía tener 5 áreas (4 del fixture + Terraza) y tiene %', n; END IF;
  RAISE NOTICE 'OK 5  el área en blanco se salta: ni vincula ni ensucia el catálogo';

  -- ── 6. El backfill respeta el tenant ─────────────────────────────────────
  SELECT area_id INTO v_area FROM public.programacion_limpieza WHERE id = PROG_VECINA;
  IF v_area IS DISTINCT FROM AREA_PISC_B THEN
    RAISE EXCEPTION '6: la " piscina" de la vecina debía vincular a SU área (%) y quedó %', AREA_PISC_B, v_area; END IF;
  RAISE NOTICE 'OK 6  cada empresa vincula contra su propio catálogo';

  -- ══ B. Protección del historial ════════════════════════════════════════════

  -- ── 7. La FK quedó en RESTRICT y no sobrevive ningún CASCADE ─────────────
  SELECT count(*) INTO n FROM pg_constraint
  WHERE conrelid = 'public.ejecuciones_limpieza'::regclass
    AND confrelid = 'public.programacion_limpieza'::regclass
    AND contype = 'f' AND confdeltype = 'r';
  IF n <> 1 THEN
    RAISE EXCEPTION '7a: la FK a programacion_limpieza debía ser RESTRICT (hay % RESTRICT)', n; END IF;
  SELECT count(*) INTO n FROM pg_constraint
  WHERE conrelid = 'public.ejecuciones_limpieza'::regclass
    AND confrelid = 'public.programacion_limpieza'::regclass
    AND contype = 'f' AND confdeltype = 'c';
  IF n <> 0 THEN
    RAISE EXCEPTION '7b: sobrevive una FK CASCADE hacia programacion_limpieza'; END IF;
  RAISE NOTICE 'OK 7  ejecuciones_limpieza.programacion_id es RESTRICT, no CASCADE';

  -- ── 8. Borrar una programación CON historial falla; sin historial procede ─
  BEGIN
    DELETE FROM public.programacion_limpieza WHERE id = PROG_PISCINA;
    RAISE EXCEPTION '8a: se borró una programación con ejecuciones (el historial cayó)';
  EXCEPTION WHEN foreign_key_violation THEN
    NULL;
  END;
  SELECT count(*) INTO n FROM public.ejecuciones_limpieza WHERE programacion_id = PROG_PISCINA;
  IF n <> 1 THEN
    RAISE EXCEPTION '8b: la ejecución histórica desapareció'; END IF;
  DELETE FROM public.programacion_limpieza WHERE id = PROG_JARDIN;
  SELECT count(*) INTO n FROM public.programacion_limpieza WHERE id = PROG_JARDIN;
  IF n <> 0 THEN
    RAISE EXCEPTION '8c: la programación sin historial debía poder borrarse'; END IF;
  -- Se restaura para que la re-aplicación (idempotencia) parta del mismo estado.
  INSERT INTO public.programacion_limpieza (id, company_id, project_id, area, area_id)
  VALUES (PROG_JARDIN, CO_A, P1, 'jardin', AREA_JARDIN);
  RAISE NOTICE 'OK 8  con historial no se borra; el borrador sin uso sí';

  -- ── 9. Borrar un área referenciada por una programación falla ────────────
  BEGIN
    DELETE FROM public.areas_condominio WHERE id = AREA_PISCINA;
    RAISE EXCEPTION '9: se borró un área con programaciones vinculadas';
  EXCEPTION WHEN foreign_key_violation THEN
    NULL;
  END;
  RAISE NOTICE 'OK 9  un área en uso no se borra: se desactiva';

  -- ══ C. Catálogo de actividades ═════════════════════════════════════════════

  -- ── 10. Backfill conservador de servicio ─────────────────────────────────
  SELECT servicio INTO t FROM public.plantillas_tarea_cargo WHERE id = PL_LIMPIEZA;
  IF t IS DISTINCT FROM 'limpieza' THEN
    RAISE EXCEPTION '10a: cargo "Limpieza" debía clasificarse limpieza y quedó %', t; END IF;
  SELECT servicio INTO t FROM public.plantillas_tarea_cargo WHERE id = PL_JARDIN;
  IF t IS DISTINCT FROM 'jardineria' THEN
    RAISE EXCEPTION '10b: cargo "Jardinería" debía clasificarse jardineria y quedó %', t; END IF;
  SELECT servicio INTO t FROM public.plantillas_tarea_cargo WHERE id = PL_POLIV;
  IF t IS NOT NULL THEN
    RAISE EXCEPTION '10c: cargo "Polivalente" es ambiguo y aún así se clasificó %', t; END IF;
  SELECT cargo INTO t FROM public.plantillas_tarea_cargo WHERE id = PL_JARDIN;
  IF t <> 'Jardinería' THEN
    RAISE EXCEPTION '10d: el backfill reescribió `cargo` a "%"', t; END IF;
  RAISE NOTICE 'OK 10 servicio se clasifica solo donde es inequívoco; cargo nunca se toca';

  -- ── 11. CHECK de dominio de servicio ─────────────────────────────────────
  BEGIN
    UPDATE public.plantillas_tarea_cargo SET servicio = 'cocina' WHERE id = PL_POLIV;
    RAISE EXCEPTION '11: se aceptó un servicio fuera del dominio';
  EXCEPTION WHEN check_violation THEN
    NULL;
  END;
  RAISE NOTICE 'OK 11 el servicio fuera de catálogo se rechaza en BD';

  -- ── 12. La duración debe ser positiva ────────────────────────────────────
  BEGIN
    UPDATE public.plantillas_tarea_cargo SET duracion_estimada_min = 0 WHERE id = PL_LIMPIEZA;
    RAISE EXCEPTION '12a: se aceptó duración 0';
  EXCEPTION WHEN check_violation THEN
    NULL;
  END;
  BEGIN
    UPDATE public.plantillas_tarea_cargo SET duracion_estimada_min = -30 WHERE id = PL_LIMPIEZA;
    RAISE EXCEPTION '12b: se aceptó duración negativa';
  EXCEPTION WHEN check_violation THEN
    NULL;
  END;
  UPDATE public.plantillas_tarea_cargo SET duracion_estimada_min = 45 WHERE id = PL_LIMPIEZA;
  RAISE NOTICE 'OK 12 la duración solo entra si es > 0';

  -- ── 13. El checklist debe ser un array JSON ──────────────────────────────
  BEGIN
    UPDATE public.plantillas_tarea_cargo SET checklist = '"un paso suelto"'::jsonb WHERE id = PL_LIMPIEZA;
    RAISE EXCEPTION '13: se aceptó un checklist que no es array';
  EXCEPTION WHEN check_violation THEN
    NULL;
  END;
  UPDATE public.plantillas_tarea_cargo
  SET checklist = '["Barrer", "Trapear", "Reponer jabón"]'::jsonb
  WHERE id = PL_LIMPIEZA;
  RAISE NOTICE 'OK 13 el checklist solo entra como array de pasos';

  -- ══ D. Puentes de recursos ═════════════════════════════════════════════════

  -- ── 14. El tenant lo sella la BD aunque el INSERT mienta ─────────────────
  INSERT INTO public.plantilla_tarea_suministros
    (company_id, project_id, plantilla_tarea_id, suministro_id, cantidad)
  VALUES (CO_B, P2, PL_LIMPIEZA, SUM_CLORO, 0.5)
  RETURNING id INTO v_id;
  SELECT company_id INTO v_uuid FROM public.plantilla_tarea_suministros WHERE id = v_id;
  IF v_uuid IS DISTINCT FROM CO_A THEN
    RAISE EXCEPTION '14a: el cliente logró sellar company_id = % (debía imponerse el de la plantilla)', v_uuid; END IF;
  SELECT project_id INTO v_uuid FROM public.plantilla_tarea_suministros WHERE id = v_id;
  IF v_uuid IS DISTINCT FROM P1 THEN
    RAISE EXCEPTION '14b: el cliente logró sellar project_id = %', v_uuid; END IF;
  SELECT creado_por INTO v_uuid FROM public.plantilla_tarea_suministros WHERE id = v_id;
  IF v_uuid IS DISTINCT FROM ADMIN_A THEN
    RAISE EXCEPTION '14c: creado_por = % (debía sellarse con el usuario de la sesión)', v_uuid; END IF;
  RAISE NOTICE 'OK 14 company/project/creado_por los sella la BD, no el cliente';

  -- ── 15. Recursos de otra empresa o de otro proyecto se rechazan ──────────
  BEGIN
    INSERT INTO public.plantilla_tarea_suministros
      (company_id, project_id, plantilla_tarea_id, suministro_id, cantidad)
    VALUES (CO_A, P1, PL_LIMPIEZA, SUM_VECINO, 1);
    RAISE EXCEPTION '15a: se vinculó un suministro de OTRA EMPRESA';
  EXCEPTION WHEN check_violation THEN
    NULL;
  END;
  BEGIN
    INSERT INTO public.plantilla_tarea_suministros
      (company_id, project_id, plantilla_tarea_id, suministro_id, cantidad)
    VALUES (CO_A, P1, PL_LIMPIEZA, SUM_OTRO_PROY, 1);
    RAISE EXCEPTION '15b: se vinculó un suministro de OTRO PROYECTO de la misma empresa';
  EXCEPTION WHEN check_violation THEN
    NULL;
  END;
  BEGIN
    INSERT INTO public.plantilla_tarea_herramientas
      (company_id, project_id, plantilla_tarea_id, inventario_id, cantidad)
    VALUES (CO_A, P1, PL_LIMPIEZA, HER_VECINA, 1);
    RAISE EXCEPTION '15c: se vinculó una herramienta de OTRA EMPRESA';
  EXCEPTION WHEN check_violation THEN
    NULL;
  END;
  RAISE NOTICE 'OK 15 actividad y recurso deben compartir empresa Y proyecto';

  -- ── 16. Sin duplicados y sin cantidades no positivas ─────────────────────
  BEGIN
    INSERT INTO public.plantilla_tarea_suministros
      (company_id, project_id, plantilla_tarea_id, suministro_id, cantidad)
    VALUES (CO_A, P1, PL_LIMPIEZA, SUM_CLORO, 2);
    RAISE EXCEPTION '16a: se duplicó el mismo suministro en la misma actividad';
  EXCEPTION WHEN unique_violation THEN
    NULL;
  END;
  BEGIN
    INSERT INTO public.plantilla_tarea_herramientas
      (company_id, project_id, plantilla_tarea_id, inventario_id, cantidad)
    VALUES (CO_A, P1, PL_LIMPIEZA, HER_HIDRO, 0);
    RAISE EXCEPTION '16b: se aceptó una herramienta con cantidad 0';
  EXCEPTION WHEN check_violation THEN
    NULL;
  END;
  INSERT INTO public.plantilla_tarea_herramientas
    (company_id, project_id, plantilla_tarea_id, inventario_id, cantidad, obligatoria)
  VALUES (CO_A, P1, PL_LIMPIEZA, HER_HIDRO, 1, true);
  BEGIN
    INSERT INTO public.plantilla_tarea_herramientas
      (company_id, project_id, plantilla_tarea_id, inventario_id, cantidad)
    VALUES (CO_A, P1, PL_LIMPIEZA, HER_HIDRO, 1);
    RAISE EXCEPTION '16c: se duplicó la misma herramienta en la misma actividad';
  EXCEPTION WHEN unique_violation THEN
    NULL;
  END;
  RAISE NOTICE 'OK 16 el mismo recurso no entra dos veces y la cantidad es > 0';

  -- ── 17. El recurso vinculado no se borra; la plantilla arrastra su receta ─
  BEGIN
    DELETE FROM public.suministros_condominio WHERE id = SUM_CLORO;
    RAISE EXCEPTION '17a: se borró un suministro vinculado a una actividad';
  EXCEPTION WHEN foreign_key_violation THEN
    NULL;
  END;
  -- Una plantilla desechable con su vínculo: borrarla debe llevarse el vínculo
  -- (la receta es parte de la definición, no historial).
  INSERT INTO public.plantillas_tarea_cargo (id, company_id, project_id, cargo, titulo)
  VALUES ('d0000000-0000-0000-0000-000000000099', CO_A, P1, 'Limpieza', 'Desechable');
  INSERT INTO public.plantilla_tarea_suministros
    (company_id, project_id, plantilla_tarea_id, suministro_id, cantidad)
  VALUES (CO_A, P1, 'd0000000-0000-0000-0000-000000000099', SUM_CLORO, 1);
  DELETE FROM public.plantillas_tarea_cargo WHERE id = 'd0000000-0000-0000-0000-000000000099';
  SELECT count(*) INTO n FROM public.plantilla_tarea_suministros
  WHERE plantilla_tarea_id = 'd0000000-0000-0000-0000-000000000099';
  IF n <> 0 THEN
    RAISE EXCEPTION '17b: quedaron % vínculos huérfanos tras borrar la plantilla', n; END IF;
  RAISE NOTICE 'OK 17 el catálogo de recursos queda protegido; la receta muere con su plantilla';

  RAISE NOTICE '── 17 invariantes de datos OK ──';
END;
$$;

-- ══ E. RLS y aislamiento ═════════════════════════════════════════════════════
-- En bloque aparte: las policies solo aplican a roles no privilegiados, y el
-- dueño de las tablas las salta.
CREATE ROLE limpieza_tester;
-- Membresía en `authenticated` obligatoria: TODAS las policies se declaran
-- `TO authenticated`. Sin esto no aplica ninguna policy y el test mediría otra
-- cosa (ver supabase/tests/turnos/assert.sql).
GRANT authenticated TO limpieza_tester;
GRANT USAGE ON SCHEMA public TO limpieza_tester;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO limpieza_tester;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO limpieza_tester;

DO $$
DECLARE
  CO_A      uuid := 'aaaaaaaa-0000-0000-0000-000000000001';
  P1        uuid := '11111111-0000-0000-0000-000000000001';
  PL_JARDIN uuid := 'd0000000-0000-0000-0000-000000000002';
  SUM_CLORO uuid := 'f0000000-0000-0000-0000-000000000001';
  n     bigint;
  v_id  uuid;
BEGIN
  SET LOCAL ROLE limpieza_tester;

  -- ── 18. Con el permiso del tab se leen y editan los puentes propios ──────
  PERFORM set_config('app.uid', 'e0000000-0000-0000-0000-00000000000d', true);  -- Diana: plantillas_cargo
  SELECT count(*) INTO n FROM public.plantilla_tarea_suministros;
  IF n = 0 THEN
    RAISE EXCEPTION '18a: con plantillas_cargo debía ver los insumos planificados y vio 0'; END IF;
  INSERT INTO public.plantilla_tarea_suministros
    (company_id, project_id, plantilla_tarea_id, suministro_id, cantidad)
  VALUES (CO_A, P1, PL_JARDIN, SUM_CLORO, 1)
  RETURNING id INTO v_id;
  DELETE FROM public.plantilla_tarea_suministros WHERE id = v_id;
  SELECT count(*) INTO n FROM public.plantilla_tarea_suministros WHERE id = v_id;
  IF n <> 0 THEN
    RAISE EXCEPTION '18b: el operador con el permiso no pudo quitar su propio insumo'; END IF;
  RAISE NOTICE 'OK 18 el permiso del tab abre lectura, alta y baja de recursos';

  -- ── 19. La empresa vecina ni ve ni escribe puentes ajenos ────────────────
  PERFORM set_config('app.uid', 'e0000000-0000-0000-0000-00000000000c', true);  -- Caro: admin de B
  SELECT count(*) INTO n FROM public.plantilla_tarea_suministros;
  IF n <> 0 THEN
    RAISE EXCEPTION '19a: la vecina vio % insumos planificados ajenos', n; END IF;
  BEGIN
    INSERT INTO public.plantilla_tarea_suministros
      (company_id, project_id, plantilla_tarea_id, suministro_id, cantidad)
    VALUES (CO_A, P1, PL_JARDIN, SUM_CLORO, 1);
    RAISE EXCEPTION '19b: la vecina insertó un puente sobre una plantilla ajena';
  EXCEPTION WHEN insufficient_privilege THEN
    NULL;
  END;
  RAISE NOTICE 'OK 19 el aislamiento por empresa se sostiene en los puentes';

  -- ── 20. Sin el permiso, ni lectura ni escritura ──────────────────────────
  PERFORM set_config('app.uid', 'e0000000-0000-0000-0000-00000000000e', true);  -- Elio: sin permisos
  SELECT count(*) INTO n FROM public.plantilla_tarea_suministros;
  IF n <> 0 THEN
    RAISE EXCEPTION '20a: sin permiso se vieron % insumos planificados', n; END IF;
  BEGIN
    INSERT INTO public.plantilla_tarea_suministros
      (company_id, project_id, plantilla_tarea_id, suministro_id, cantidad)
    VALUES (CO_A, P1, PL_JARDIN, SUM_CLORO, 1);
    RAISE EXCEPTION '20b: sin permiso se insertó un puente';
  EXCEPTION WHEN insufficient_privilege THEN
    NULL;
  END;
  RAISE NOTICE 'OK 20 sin el permiso del tab los puentes no existen para el usuario';

  -- ── 21. La escritura de áreas quedó en manos de los tres tabs ────────────
  -- Beto solo trae rutas_ronda: antes escribía áreas gracias a la legacy
  -- company_rw_areas; ahora escribe porque la policy lo acepta explícitamente.
  PERFORM set_config('app.uid', 'e0000000-0000-0000-0000-00000000000b', true);  -- Beto: rutas_ronda
  INSERT INTO public.areas_condominio (company_id, project_id, nombre)
  VALUES (CO_A, P1, 'Caseta de vigilancia')
  RETURNING id INTO v_id;
  -- …pero borrar sigue siendo de owner/admin: su DELETE no alcanza la fila.
  DELETE FROM public.areas_condominio WHERE id = v_id;
  SELECT count(*) INTO n FROM public.areas_condominio WHERE id = v_id;
  IF n <> 1 THEN
    RAISE EXCEPTION '21a: el DELETE de áreas debía seguir reservado a owner/admin'; END IF;
  -- Diana (plantillas_cargo) NO está en el conjunto de escritura de áreas.
  PERFORM set_config('app.uid', 'e0000000-0000-0000-0000-00000000000d', true);
  BEGIN
    INSERT INTO public.areas_condominio (company_id, project_id, nombre)
    VALUES (CO_A, P1, 'Área que no debería entrar');
    RAISE EXCEPTION '21b: plantillas_cargo no da derecho a crear áreas y aún así entró';
  EXCEPTION WHEN insufficient_privilege THEN
    NULL;
  END;
  -- Elio, sin ningún permiso, tampoco.
  PERFORM set_config('app.uid', 'e0000000-0000-0000-0000-00000000000e', true);
  BEGIN
    INSERT INTO public.areas_condominio (company_id, project_id, nombre)
    VALUES (CO_A, P1, 'Área sin permiso');
    RAISE EXCEPTION '21c: sin permisos se creó un área';
  EXCEPTION WHEN insufficient_privilege THEN
    NULL;
  END;
  RAISE NOTICE 'OK 21 áreas: escriben checklist_areas/rutas_ronda/prog_limpieza; borra owner/admin';

  RESET ROLE;

  -- ── 22. Las policies legacy quedaron retiradas ───────────────────────────
  SELECT count(*) INTO n FROM pg_policies
  WHERE policyname IN ('company_rw_areas', 'company_rw_plantillas_cargo');
  IF n <> 0 THEN
    RAISE EXCEPTION '22: siguen vivas % policies company_rw_* que anulan el gate RBAC', n; END IF;
  RAISE NOTICE 'OK 22 company_rw_areas y company_rw_plantillas_cargo ya no existen';

  RAISE NOTICE '── 5 invariantes de RLS OK ──';
END;
$$;
