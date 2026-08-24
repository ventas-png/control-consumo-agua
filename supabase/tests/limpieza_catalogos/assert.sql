\set ON_ERROR_STOP on
\pset tuples_only on
\pset format unaligned

-- Invariantes de los catálogos operativos de limpieza
-- (20260904000100 · 000200 · 000300).
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

  -- ── 3. Ambigua: tres áreas con el mismo nombre normalizado ───────────────
  SELECT area_id INTO v_area FROM public.programacion_limpieza WHERE id = PROG_LOBBY;
  IF v_area IS NOT NULL THEN
    RAISE EXCEPTION '3: "Lobby" es ambigua (Lobby / " lobby " / LOBBY) y aún así se vinculó a %', v_area; END IF;
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
  IF n <> 6 THEN
    RAISE EXCEPTION '5b: P1 debía tener 6 áreas (5 del fixture + Terraza) y tiene %', n; END IF;
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
  -- (la receta es parte de la definición, no historial). Cargo del catálogo:
  -- el trigger de 20260904000200 ya no admite texto libre en INSERT.
  INSERT INTO public.plantillas_tarea_cargo (id, company_id, project_id, cargo, titulo)
  VALUES ('d0000000-0000-0000-0000-000000000099', CO_A, P1, 'conserje', 'Desechable');
  INSERT INTO public.plantilla_tarea_suministros
    (company_id, project_id, plantilla_tarea_id, suministro_id, cantidad)
  VALUES (CO_A, P1, 'd0000000-0000-0000-0000-000000000099', SUM_CLORO, 1);
  DELETE FROM public.plantillas_tarea_cargo WHERE id = 'd0000000-0000-0000-0000-000000000099';
  SELECT count(*) INTO n FROM public.plantilla_tarea_suministros
  WHERE plantilla_tarea_id = 'd0000000-0000-0000-0000-000000000099';
  IF n <> 0 THEN
    RAISE EXCEPTION '17b: quedaron % vínculos huérfanos tras borrar la plantilla', n; END IF;
  RAISE NOTICE 'OK 17 el catálogo de recursos queda protegido; la receta muere con su plantilla';

  -- ── 18. El tenant de un padre relacionado es INMÓVIL (FKs compuestas) ────
  -- PL_LIMPIEZA tiene vínculos vivos (Cloro e Hidrolavadora): moverla de
  -- proyecto o de empresa debe chocar con la FK compuesta del hijo. Ídem
  -- mover el recurso.
  BEGIN
    UPDATE public.plantillas_tarea_cargo SET project_id = P1B WHERE id = PL_LIMPIEZA;
    RAISE EXCEPTION '18a: una plantilla con recursos se movió de proyecto';
  EXCEPTION WHEN foreign_key_violation THEN
    NULL;
  END;
  BEGIN
    UPDATE public.suministros_condominio SET company_id = CO_B WHERE id = SUM_CLORO;
    RAISE EXCEPTION '18b: un suministro relacionado se movió de empresa';
  EXCEPTION WHEN foreign_key_violation THEN
    NULL;
  END;
  BEGIN
    UPDATE public.inventario_condominio SET project_id = P1B WHERE id = HER_HIDRO;
    RAISE EXCEPTION '18c: una herramienta relacionada se movió de proyecto';
  EXCEPTION WHEN foreign_key_violation THEN
    NULL;
  END;
  RAISE NOTICE 'OK 18 plantilla y recursos relacionados no pueden cambiar de empresa/proyecto';

  -- ── 19. Cargo controlado en capturas nuevas; el legado sigue operable ────
  BEGIN
    INSERT INTO public.plantillas_tarea_cargo (company_id, project_id, cargo, titulo)
    VALUES (CO_A, P1, 'Cocinero', 'Cargo fuera de catálogo');
    RAISE EXCEPTION '19a: se insertó un cargo fuera del catálogo';
  EXCEPTION WHEN check_violation THEN
    NULL;
  END;
  INSERT INTO public.plantillas_tarea_cargo (id, company_id, project_id, cargo, titulo)
  VALUES ('d0000000-0000-0000-0000-000000000098', CO_A, P1, ' Conserje ', 'Mayúscula y espacios pasan');
  DELETE FROM public.plantillas_tarea_cargo WHERE id = 'd0000000-0000-0000-0000-000000000098';
  -- El legado con cargo libre ('Polivalente') se puede seguir operando.
  UPDATE public.plantillas_tarea_cargo SET activo = false WHERE id = PL_POLIV;
  UPDATE public.plantillas_tarea_cargo SET activo = true  WHERE id = PL_POLIV;
  RAISE NOTICE 'OK 19 el cargo nuevo va controlado; el histórico no se toca y sigue operable';

  -- ── 20. Checklist obligatorio = checklist con contenido real ─────────────
  BEGIN
    UPDATE public.plantillas_tarea_cargo
    SET requiere_checklist = true, checklist = '[]'::jsonb WHERE id = PL_POLIV;
    RAISE EXCEPTION '20a: checklist obligatorio aceptó un checklist vacío';
  EXCEPTION WHEN check_violation THEN
    NULL;
  END;
  BEGIN
    UPDATE public.plantillas_tarea_cargo
    SET requiere_checklist = true, checklist = '["   "]'::jsonb WHERE id = PL_POLIV;
    RAISE EXCEPTION '20b: checklist obligatorio aceptó pasos en blanco';
  EXCEPTION WHEN check_violation THEN
    NULL;
  END;
  UPDATE public.plantillas_tarea_cargo
  SET requiere_checklist = true WHERE id = PL_LIMPIEZA;  -- tiene 3 pasos reales
  UPDATE public.plantillas_tarea_cargo
  SET requiere_checklist = false WHERE id = PL_LIMPIEZA;
  RAISE NOTICE 'OK 20 requiere_checklist exige al menos un paso de texto no vacío (en BD)';

  -- ── 21. Anular exige motivo, la BD sella al autor, restaurar limpia ──────
  BEGIN
    UPDATE public.ejecuciones_limpieza SET anulada_en = now() WHERE id = 'c0000000-0000-0000-0000-000000000001';
    RAISE EXCEPTION '21a: se anuló sin motivo';
  EXCEPTION WHEN check_violation THEN
    NULL;
  END;
  UPDATE public.ejecuciones_limpieza
  SET anulada_en = now(), motivo_anulacion = 'Cargada al área equivocada'
  WHERE id = 'c0000000-0000-0000-0000-000000000001';
  SELECT anulada_por::text INTO t FROM public.ejecuciones_limpieza
  WHERE id = 'c0000000-0000-0000-0000-000000000001';
  IF t IS DISTINCT FROM ADMIN_A::text THEN
    RAISE EXCEPTION '21b: anulada_por = % (debía sellarse con el usuario de la sesión)', t; END IF;
  UPDATE public.ejecuciones_limpieza
  SET anulada_en = NULL, anulada_por = NULL, motivo_anulacion = NULL
  WHERE id = 'c0000000-0000-0000-0000-000000000001';
  RAISE NOTICE 'OK 21 la anulación lógica exige motivo, sella al autor y es restaurable';

  RAISE NOTICE '── 21 invariantes de datos OK ──';
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
  EJEC_HIST uuid := 'c0000000-0000-0000-0000-000000000001';
  n     bigint;
  v_id  uuid;
BEGIN
  SET LOCAL ROLE limpieza_tester;

  -- ── 22. Con el permiso del tab se leen y editan los puentes propios ──────
  PERFORM set_config('app.uid', 'e0000000-0000-0000-0000-00000000000d', true);  -- Diana: plantillas_cargo
  SELECT count(*) INTO n FROM public.plantilla_tarea_suministros;
  IF n = 0 THEN
    RAISE EXCEPTION '22a: con plantillas_cargo debía ver los insumos planificados y vio 0'; END IF;
  INSERT INTO public.plantilla_tarea_suministros
    (company_id, project_id, plantilla_tarea_id, suministro_id, cantidad)
  VALUES (CO_A, P1, PL_JARDIN, SUM_CLORO, 1)
  RETURNING id INTO v_id;
  DELETE FROM public.plantilla_tarea_suministros WHERE id = v_id;
  SELECT count(*) INTO n FROM public.plantilla_tarea_suministros WHERE id = v_id;
  IF n <> 0 THEN
    RAISE EXCEPTION '22b: el operador con el permiso no pudo quitar su propio insumo'; END IF;
  RAISE NOTICE 'OK 22 el permiso del tab abre lectura, alta y baja de recursos';

  -- ── 23. La empresa vecina ni ve ni escribe puentes ajenos ────────────────
  PERFORM set_config('app.uid', 'e0000000-0000-0000-0000-00000000000c', true);  -- Caro: admin de B
  SELECT count(*) INTO n FROM public.plantilla_tarea_suministros;
  IF n <> 0 THEN
    RAISE EXCEPTION '23a: la vecina vio % insumos planificados ajenos', n; END IF;
  BEGIN
    INSERT INTO public.plantilla_tarea_suministros
      (company_id, project_id, plantilla_tarea_id, suministro_id, cantidad)
    VALUES (CO_A, P1, PL_JARDIN, SUM_CLORO, 1);
    RAISE EXCEPTION '23b: la vecina insertó un puente sobre una plantilla ajena';
  EXCEPTION WHEN insufficient_privilege THEN
    NULL;
  END;
  RAISE NOTICE 'OK 23 el aislamiento por empresa se sostiene en los puentes';

  -- ── 24. Sin el permiso, ni lectura ni escritura ──────────────────────────
  PERFORM set_config('app.uid', 'e0000000-0000-0000-0000-00000000000e', true);  -- Elio: sin permisos
  SELECT count(*) INTO n FROM public.plantilla_tarea_suministros;
  IF n <> 0 THEN
    RAISE EXCEPTION '24a: sin permiso se vieron % insumos planificados', n; END IF;
  BEGIN
    INSERT INTO public.plantilla_tarea_suministros
      (company_id, project_id, plantilla_tarea_id, suministro_id, cantidad)
    VALUES (CO_A, P1, PL_JARDIN, SUM_CLORO, 1);
    RAISE EXCEPTION '24b: sin permiso se insertó un puente';
  EXCEPTION WHEN insufficient_privilege THEN
    NULL;
  END;
  RAISE NOTICE 'OK 24 sin el permiso del tab los puentes no existen para el usuario';

  -- ── 25. Administrar áreas exige AUTORIZACIÓN ESPECÍFICA ──────────────────
  -- Beto (rutas_ronda a secas) escribía gracias a la legacy company_rw_areas;
  -- ver un tab consumidor ya no basta para administrar el catálogo canónico.
  PERFORM set_config('app.uid', 'e0000000-0000-0000-0000-00000000000b', true);  -- Beto: solo rutas_ronda
  BEGIN
    INSERT INTO public.areas_condominio (company_id, project_id, nombre)
    VALUES (CO_A, P1, 'Área que Beto no debería crear');
    RAISE EXCEPTION '25a: rutas_ronda a secas creó un área del catálogo canónico';
  EXCEPTION WHEN insufficient_privilege THEN
    NULL;
  END;
  -- Gina trae el permiso específico (condominios.areas.manage, el que la
  -- migración concede a los roles de sistema Seguridad y Operaciones).
  PERFORM set_config('app.uid', 'e0000000-0000-0000-0000-00000000000f', true);  -- Gina: areas.manage
  INSERT INTO public.areas_condominio (company_id, project_id, nombre)
  VALUES (CO_A, P1, 'Caseta de vigilancia')
  RETURNING id INTO v_id;
  UPDATE public.areas_condominio SET activo = false WHERE id = v_id;
  UPDATE public.areas_condominio SET activo = true  WHERE id = v_id;
  -- …pero borrar sigue siendo de owner/admin: su DELETE no alcanza la fila.
  DELETE FROM public.areas_condominio WHERE id = v_id;
  SELECT count(*) INTO n FROM public.areas_condominio WHERE id = v_id;
  IF n <> 1 THEN
    RAISE EXCEPTION '25b: el DELETE de áreas debía seguir reservado a owner/admin'; END IF;
  -- Diana (plantillas_cargo) y Elio (nada) tampoco entran.
  PERFORM set_config('app.uid', 'e0000000-0000-0000-0000-00000000000d', true);
  BEGIN
    INSERT INTO public.areas_condominio (company_id, project_id, nombre)
    VALUES (CO_A, P1, 'Área que no debería entrar');
    RAISE EXCEPTION '25c: plantillas_cargo no da derecho a crear áreas y aún así entró';
  EXCEPTION WHEN insufficient_privilege THEN
    NULL;
  END;
  PERFORM set_config('app.uid', 'e0000000-0000-0000-0000-00000000000e', true);
  BEGIN
    INSERT INTO public.areas_condominio (company_id, project_id, nombre)
    VALUES (CO_A, P1, 'Área sin permiso');
    RAISE EXCEPTION '25d: sin permisos se creó un área';
  EXCEPTION WHEN insufficient_privilege THEN
    NULL;
  END;
  RAISE NOTICE 'OK 25 áreas: administra quien trae checklist_areas o areas.manage; borra owner/admin';

  -- ── 26. Limpieza lee el catálogo de actividades sin permisos de Seguridad ─
  PERFORM set_config('app.uid', 'e0000000-0000-0000-0000-000000000010', true);  -- Hugo: solo prog_limpieza
  SELECT count(*) INTO n FROM public.plantillas_tarea_cargo;
  IF n = 0 THEN
    RAISE EXCEPTION '26a: con prog_limpieza debía leer las actividades y vio 0'; END IF;
  SELECT count(*) INTO n FROM public.plantilla_tarea_suministros;
  IF n = 0 THEN
    RAISE EXCEPTION '26b: con prog_limpieza debía leer los insumos planificados y vio 0'; END IF;
  SELECT count(*) INTO n FROM public.plantilla_tarea_herramientas;
  IF n = 0 THEN
    RAISE EXCEPTION '26c: con prog_limpieza debía leer las herramientas planificadas y vio 0'; END IF;
  -- …pero leer no es escribir:
  BEGIN
    INSERT INTO public.plantilla_tarea_suministros
      (company_id, project_id, plantilla_tarea_id, suministro_id, cantidad)
    VALUES (CO_A, P1, PL_JARDIN, SUM_CLORO, 1);
    RAISE EXCEPTION '26d: prog_limpieza pudo escribir un puente';
  EXCEPTION WHEN insufficient_privilege THEN
    NULL;
  END;
  RAISE NOTICE 'OK 26 prog_limpieza lee actividades y recursos; no los edita';

  -- ── 27. El historial no se borra desde la aplicación: ni el admin ────────
  PERFORM set_config('app.uid', 'e0000000-0000-0000-0000-00000000000a', true);  -- Ana: admin del condominio
  SELECT count(*) INTO n FROM public.ejecuciones_limpieza WHERE id = EJEC_HIST;
  IF n <> 1 THEN
    RAISE EXCEPTION '27a: el admin debía VER la ejecución histórica'; END IF;
  DELETE FROM public.ejecuciones_limpieza WHERE id = EJEC_HIST;
  SELECT count(*) INTO n FROM public.ejecuciones_limpieza WHERE id = EJEC_HIST;
  IF n <> 1 THEN
    RAISE EXCEPTION '27b: el admin borró físicamente una ejecución histórica'; END IF;
  -- La corrección legítima es la anulación lógica, y esa sí puede:
  UPDATE public.ejecuciones_limpieza
  SET anulada_en = now(), motivo_anulacion = 'Prueba RLS: corrección por anulación'
  WHERE id = EJEC_HIST;
  SELECT count(*) INTO n FROM public.ejecuciones_limpieza
  WHERE id = EJEC_HIST AND anulada_en IS NOT NULL;
  IF n <> 1 THEN
    RAISE EXCEPTION '27c: el admin no pudo anular lógicamente'; END IF;
  UPDATE public.ejecuciones_limpieza
  SET anulada_en = NULL, anulada_por = NULL, motivo_anulacion = NULL
  WHERE id = EJEC_HIST;
  RAISE NOTICE 'OK 27 el DELETE físico del historial queda fuera del alcance del condominio';

  RESET ROLE;

  -- ── 28. Las policies legacy quedaron retiradas ───────────────────────────
  SELECT count(*) INTO n FROM pg_policies
  WHERE policyname IN ('company_rw_areas', 'company_rw_plantillas_cargo');
  IF n <> 0 THEN
    RAISE EXCEPTION '28: siguen vivas % policies company_rw_* que anulan el gate RBAC', n; END IF;
  RAISE NOTICE 'OK 28 company_rw_areas y company_rw_plantillas_cargo ya no existen';

  RAISE NOTICE '── 7 invariantes de RLS OK ──';
END;
$$;

-- ════════════════════════════════════════════════════════════════════════════
-- D · INTEGRIDAD FINAL (20260904000400)
-- ════════════════════════════════════════════════════════════════════════════
-- Los dos huecos que la serie declaraba cerrar y no cerraba. Ninguno de los dos
-- se ve leyendo el SQL: uno es un motor de FK y el otro es qué eventos disparan
-- un trigger. Hay que intentar la escritura ilegal y ver que rebota.

DO $$
DECLARE v_id uuid;
BEGIN
  -- ── 29. El área de OTRA EMPRESA se rechaza ───────────────────────────────
  -- a0000000-…0005 es de la empresa vecina. Con la FK simple de 20260904000100
  -- esto pasaba: el área existe, y eso era todo lo que se comprobaba.
  BEGIN
    INSERT INTO public.programacion_limpieza (company_id, project_id, area, area_id)
    VALUES ('aaaaaaaa-0000-0000-0000-000000000001',
            '11111111-0000-0000-0000-000000000001',
            'Piscina', 'a0000000-0000-0000-0000-000000000005');
    RAISE EXCEPTION '29: se vinculó un área de OTRA EMPRESA';
  EXCEPTION WHEN foreign_key_violation THEN NULL;
  END;
  RAISE NOTICE 'OK 29 el área de otra empresa se rechaza en la BD';
END;
$$;

DO $$
BEGIN
  -- ── 30. El área de OTRO PROYECTO de la MISMA empresa se rechaza ──────────
  -- El caso que una FK por company_id sola dejaría pasar, y por el que la FK
  -- lleva el trío completo. El área se crea aquí (el fixture no siembra
  -- ninguna en el 2º proyecto de A) para que la prueba no dependa de datos
  -- que existen para otra cosa.
  INSERT INTO public.areas_condominio (id, company_id, project_id, nombre) VALUES
    ('a0000000-0000-0000-0000-000000000009', 'aaaaaaaa-0000-0000-0000-000000000001',
     '11111111-0000-0000-0000-000000000003', 'Piscina del otro proyecto')
  ON CONFLICT (id) DO NOTHING;

  BEGIN
    INSERT INTO public.programacion_limpieza (company_id, project_id, area, area_id)
    VALUES ('aaaaaaaa-0000-0000-0000-000000000001',
            '11111111-0000-0000-0000-000000000001',
            'Piscina', 'a0000000-0000-0000-0000-000000000009');
    RAISE EXCEPTION '30: se vinculó un área de otro PROYECTO de la misma empresa';
  EXCEPTION WHEN foreign_key_violation THEN NULL;
  END;
  RAISE NOTICE 'OK 30 el área de otro proyecto se rechaza aunque la empresa coincida';
END;
$$;

DO $$
DECLARE v_id uuid; n int;
BEGIN
  -- ── 31. Lo legítimo sigue pasando, en las dos formas ─────────────────────
  -- Si la FK compuesta rechazara de más, este PR habría roto el alta normal.
  INSERT INTO public.programacion_limpieza (company_id, project_id, area, area_id)
  VALUES ('aaaaaaaa-0000-0000-0000-000000000001',
          '11111111-0000-0000-0000-000000000001',
          'Piscina', 'a0000000-0000-0000-0000-000000000001')
  RETURNING id INTO v_id;
  IF v_id IS NULL THEN
    RAISE EXCEPTION '31a: no se pudo vincular un área del MISMO tenant'; END IF;
  DELETE FROM public.programacion_limpieza WHERE id = v_id;

  -- Y la fila legada sin área tampoco se rompe: con area_id NULL la FK
  -- compuesta no se evalúa (MATCH SIMPLE). Es la mitad del diseño.
  INSERT INTO public.programacion_limpieza (company_id, project_id, area, area_id)
  VALUES ('aaaaaaaa-0000-0000-0000-000000000001',
          '11111111-0000-0000-0000-000000000001',
          'Área sin vincular', NULL)
  RETURNING id INTO v_id;
  IF v_id IS NULL THEN
    RAISE EXCEPTION '31b: la FK compuesta rompió el alta sin área'; END IF;
  DELETE FROM public.programacion_limpieza WHERE id = v_id;

  -- Y el RESTRICT del borrado sigue en pie tras cambiar la FK.
  SELECT count(*) INTO n FROM pg_constraint
   WHERE conname = 'prog_limpieza_area_tenant_fk' AND confdeltype = 'r';
  IF n <> 1 THEN
    RAISE EXCEPTION '31c: la FK nueva perdió el ON DELETE RESTRICT'; END IF;

  RAISE NOTICE 'OK 31 el área del mismo tenant entra, la fila sin área también, y sigue RESTRICT';
END;
$$;

DO $$
DECLARE v_cargo text;
BEGIN
  -- ── 32. UPDATE a un cargo INVÁLIDO se rechaza ────────────────────────────
  -- El bypass entero: con BEFORE INSERT a secas, esto pasaba sin mirar y el
  -- catálogo quedaba en nada.
  BEGIN
    UPDATE public.plantillas_tarea_cargo
       SET cargo = 'lo que se me ocurra'
     WHERE id = 'd0000000-0000-0000-0000-000000000001';
    RAISE EXCEPTION '32: un UPDATE metió un cargo fuera del catálogo';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  RAISE NOTICE 'OK 32 el UPDATE a un cargo fuera del catálogo se rechaza';
END;
$$;

DO $$
DECLARE v_cargo text;
BEGIN
  -- ── 33. UPDATE a un cargo VÁLIDO se acepta ───────────────────────────────
  -- El reverso: cerrar el bypass no puede impedir corregir un cargo legado.
  UPDATE public.plantillas_tarea_cargo
     SET cargo = 'conserje'
   WHERE id = 'd0000000-0000-0000-0000-000000000001';

  SELECT cargo INTO v_cargo FROM public.plantillas_tarea_cargo
   WHERE id = 'd0000000-0000-0000-0000-000000000001';
  IF v_cargo <> 'conserje' THEN
    RAISE EXCEPTION '33: no se pudo corregir el cargo a un valor del catálogo (quedó %)', v_cargo; END IF;

  RAISE NOTICE 'OK 33 el UPDATE a un cargo del catálogo se acepta';
END;
$$;

DO $$
DECLARE v_cargo text; v_activo boolean;
BEGIN
  -- ── 34. La fila HISTÓRICA con cargo libre se sigue editando ──────────────
  -- d0000000-…0003 tiene cargo 'Polivalente', que NO está en el catálogo y que
  -- a propósito no se reescribe. Este invariante es el que obliga a las dos
  -- defensas: `UPDATE OF cargo` para el UPDATE que ni menciona la columna, y
  -- `IS DISTINCT FROM` para el que la menciona sin cambiarla.
  SELECT cargo INTO v_cargo FROM public.plantillas_tarea_cargo
   WHERE id = 'd0000000-0000-0000-0000-000000000003';
  IF lower(btrim(v_cargo)) IN
     ('conserje','guardia','jardinero','mantenimiento','administrador','otro') THEN
    RAISE EXCEPTION '34-setup: la fila de control dejó de tener cargo libre (%)', v_cargo; END IF;

  -- 34a · UPDATE que NO menciona `cargo`.
  UPDATE public.plantillas_tarea_cargo SET activo = false
   WHERE id = 'd0000000-0000-0000-0000-000000000003';
  SELECT activo INTO v_activo FROM public.plantillas_tarea_cargo
   WHERE id = 'd0000000-0000-0000-0000-000000000003';
  IF v_activo THEN
    RAISE EXCEPTION '34a: no se pudo desactivar una fila legada con cargo libre'; END IF;

  -- 34b · UPDATE que SÍ lo menciona pero no lo cambia (lo que hace un ORM que
  -- reescribe la fila entera). Sin el IS DISTINCT FROM, esto reventaría.
  UPDATE public.plantillas_tarea_cargo SET activo = true, cargo = cargo
   WHERE id = 'd0000000-0000-0000-0000-000000000003';
  SELECT activo, cargo INTO v_activo, v_cargo FROM public.plantillas_tarea_cargo
   WHERE id = 'd0000000-0000-0000-0000-000000000003';
  IF NOT v_activo OR v_cargo <> 'Polivalente' THEN
    RAISE EXCEPTION '34b: reescribir la fila legada sin cambiar el cargo falló (activo=%, cargo=%)', v_activo, v_cargo; END IF;

  RAISE NOTICE 'OK 34 la fila legada con cargo libre se sigue editando, mencione o no la columna';
  RAISE NOTICE '── 6 invariantes de integridad final OK ──';
END;
$$;
