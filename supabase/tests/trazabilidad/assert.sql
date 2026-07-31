\set ON_ERROR_STOP on
\pset tuples_only on
\pset format unaligned

-- Invariantes de la trazabilidad (20260731000000 + 20260731000100).
-- Cada bloque RAISE EXCEPTION si algo no se cumple.

DO $$
DECLARE
  A  uuid := 'e0000000-0000-0000-0000-00000000000a';
  B  uuid := 'e0000000-0000-0000-0000-00000000000b';
  CO uuid := 'aaaaaaaa-0000-0000-0000-000000000001';
  PR uuid := '11111111-0000-0000-0000-000000000001';
  v  uuid;
  v2 uuid;
  n  bigint;
  t  text;
  id1 uuid;
BEGIN
  -- ── 1. INSERT con sesión de A → creado_por = A ───────────────────────────
  PERFORM set_config('app.uid', A::text, false);
  INSERT INTO public.registros (project_id, cliente_nombre, consumo)
    VALUES (PR, 'Cliente 1', 10) RETURNING id INTO id1;
  SELECT creado_por INTO v FROM public.registros WHERE id = id1;
  IF v IS DISTINCT FROM A THEN
    RAISE EXCEPTION '1: creado_por=% (esperado A)', v; END IF;
  RAISE NOTICE 'OK 1  INSERT sella creado_por con el usuario de la sesión';

  -- ── 2. NO FALSIFICABLE: el cliente manda otro uuid y se ignora ───────────
  -- Es la invariante que justifica el trigger en vez de DEFAULT auth.uid():
  -- con DEFAULT, este INSERT habría guardado B.
  INSERT INTO public.registros (project_id, cliente_nombre, consumo, creado_por)
    VALUES (PR, 'Cliente falsificado', 5, B) RETURNING id INTO id1;
  SELECT creado_por INTO v FROM public.registros WHERE id = id1;
  IF v IS DISTINCT FROM A THEN
    RAISE EXCEPTION '2: el cliente logró sellar % (debía quedar A)', v; END IF;
  RAISE NOTICE 'OK 2  un creado_por enviado por el cliente NO se respeta';

  -- ── 3. INMUTABLE: un UPDATE no puede reescribirlo ───────────────────────
  PERFORM set_config('app.uid', B::text, false);
  UPDATE public.registros SET creado_por = B, notas = 'editado' WHERE id = id1;
  SELECT creado_por INTO v FROM public.registros WHERE id = id1;
  IF v IS DISTINCT FROM A THEN
    RAISE EXCEPTION '3: UPDATE reescribió creado_por a % (debía seguir A)', v; END IF;
  RAISE NOTICE 'OK 3  creado_por es inmutable ante UPDATE';

  -- ── 4. Escritura de SISTEMA (sin sesión) → NULL, y no revienta ──────────
  PERFORM set_config('app.uid', '', false);
  INSERT INTO public.registros (project_id, cliente_nombre, consumo)
    VALUES (PR, 'Cron', 1) RETURNING id INTO id1;
  SELECT creado_por INTO v FROM public.registros WHERE id = id1;
  IF v IS NOT NULL THEN
    RAISE EXCEPTION '4: escritura de sistema selló % (esperado NULL)', v; END IF;
  RAISE NOTICE 'OK 4  sin sesión queda NULL (= "Sistema"), sin fallar';

  -- ── 5. SELLO DE CIERRE: quién dio por hecha la limpieza ─────────────────
  -- El caso que `creado_por` no cubre: la fila la crea quien programa, y la
  -- completa —días después— otra persona.
  PERFORM set_config('app.uid', A::text, false);
  INSERT INTO public.programacion_limpieza (company_id, project_id, area, frecuencia)
    VALUES (CO, PR, 'Lobby', 'diaria') RETURNING id INTO id1;
  SELECT creado_por, ejecutado_por INTO v, v2 FROM public.programacion_limpieza WHERE id = id1;
  IF v IS DISTINCT FROM A THEN RAISE EXCEPTION '5a: creado_por=%', v; END IF;
  IF v2 IS NOT NULL THEN RAISE EXCEPTION '5b: ejecutado_por no debía estar sellado aún'; END IF;

  PERFORM set_config('app.uid', B::text, false);
  UPDATE public.programacion_limpieza SET ultima_ejecucion = CURRENT_DATE WHERE id = id1;
  SELECT creado_por, ejecutado_por INTO v, v2 FROM public.programacion_limpieza WHERE id = id1;
  IF v IS DISTINCT FROM A THEN
    RAISE EXCEPTION '5c: creado_por cambió a % al completar', v; END IF;
  IF v2 IS DISTINCT FROM B THEN
    RAISE EXCEPTION '5d: ejecutado_por=% (esperado B)', v2; END IF;
  RAISE NOTICE 'OK 5  quien CREA y quien COMPLETA se registran por separado';

  -- ── 6. El sello de cierre solo dispara en la TRANSICIÓN ─────────────────
  PERFORM set_config('app.uid', A::text, false);
  UPDATE public.programacion_limpieza SET area = 'Lobby principal' WHERE id = id1;
  SELECT ejecutado_por INTO v2 FROM public.programacion_limpieza WHERE id = id1;
  IF v2 IS DISTINCT FROM B THEN
    RAISE EXCEPTION '6: un UPDATE cualquiera reescribió ejecutado_por a %', v2; END IF;
  RAISE NOTICE 'OK 6  editar la fila después no reescribe quién la completó';

  -- ── 7. visitantes: modo si_nulo (no pisa lo que manda la UI) ────────────
  PERFORM set_config('app.uid', A::text, false);
  INSERT INTO public.visitantes (company_id, project_id, nombre, registrado_por)
    VALUES (CO, PR, 'Visita con autor explícito', B) RETURNING id INTO id1;
  SELECT registrado_por INTO v FROM public.visitantes WHERE id = id1;
  IF v IS DISTINCT FROM B THEN
    RAISE EXCEPTION '7a: si_nulo pisó el valor de la UI: %', v; END IF;

  INSERT INTO public.visitantes (company_id, project_id, nombre)
    VALUES (CO, PR, 'Visita sin autor') RETURNING id INTO id1;
  SELECT registrado_por INTO v FROM public.visitantes WHERE id = id1;
  IF v IS DISTINCT FROM A THEN
    RAISE EXCEPTION '7b: si_nulo no rellenó el hueco: %', v; END IF;
  RAISE NOTICE 'OK 7  visitantes.registrado_por: rellena si falta, respeta si viene';

  -- ── 8. Tablas con created_by: se sella ESA, sin columna duplicada ───────
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema='public' AND table_name='registros_calidad'
               AND column_name='creado_por') THEN
    RAISE EXCEPTION '8a: registros_calidad quedó con created_by Y creado_por'; END IF;
  INSERT INTO public.registros_calidad (company_id, observaciones)
    VALUES (CO, 'muestra') RETURNING id INTO id1;
  SELECT created_by INTO v FROM public.registros_calidad WHERE id = id1;
  IF v IS DISTINCT FROM A THEN
    RAISE EXCEPTION '8b: created_by=% (esperado A)', v; END IF;
  RAISE NOTICE 'OK 8  donde ya existía created_by se sella esa, sin duplicar';

  -- ── 9. COBERTURA: toda tabla del catálogo tiene columna Y trigger ───────
  -- Protege contra un typo silencioso entre las 88 entradas del array.
  SELECT count(*) INTO n
    FROM (VALUES ('registros'),('programacion_limpieza'),('checklist_areas'),
                 ('rondas_seguridad'),('visitas_control'),('tareas_condominio'),
                 ('gastos_condominio'),('tickets_mantenimiento')) AS x(tabla)
   WHERE NOT EXISTS (
     SELECT 1 FROM information_schema.columns c
      WHERE c.table_schema='public' AND c.table_name=x.tabla AND c.column_name='creado_por');
  IF n <> 0 THEN RAISE EXCEPTION '9a: % tablas del catálogo sin creado_por', n; END IF;

  SELECT count(*) INTO n
    FROM (VALUES ('registros'),('programacion_limpieza'),('checklist_areas'),
                 ('rondas_seguridad'),('visitas_control'),('tareas_condominio'),
                 ('visitantes'),('registros_calidad')) AS x(tabla)
   WHERE NOT EXISTS (
     SELECT 1 FROM pg_trigger tg JOIN pg_class cl ON cl.oid = tg.tgrelid
      WHERE cl.relname = x.tabla AND tg.tgname = 'trg_sellar_creado_por');
  IF n <> 0 THEN RAISE EXCEPTION '9b: % tablas sin trigger de sellado', n; END IF;
  RAISE NOTICE 'OK 9  cada tabla del catálogo terminó con columna y trigger';

  -- ── 10. BITÁCORA: se llena sola con la acción del usuario ───────────────
  DELETE FROM public.bitacora_acciones;
  PERFORM set_config('app.uid', A::text, false);
  INSERT INTO public.checklist_areas (company_id, project_id, area, notas)
    VALUES (CO, PR, 'Piscina', 'todo en orden') RETURNING id INTO id1;

  SELECT count(*) INTO n FROM public.bitacora_acciones
   WHERE entidad_id = id1 AND accion = 'crear' AND modulo = 'Limpieza';
  IF n <> 1 THEN RAISE EXCEPTION '10a: la bitácora no registró el alta (n=%)', n; END IF;

  SELECT usuario_nombre INTO t FROM public.bitacora_acciones WHERE entidad_id = id1;
  IF t <> 'Ana Lecturista' THEN
    RAISE EXCEPTION '10b: usuario_nombre=% (esperado el nombre desnormalizado)', t; END IF;

  SELECT entidad_desc INTO t FROM public.bitacora_acciones WHERE entidad_id = id1;
  IF t <> 'Piscina' THEN RAISE EXCEPTION '10c: entidad_desc=% (esperado el área)', t; END IF;
  RAISE NOTICE 'OK 10 la bitácora registra alta + usuario + descripción legible';

  -- ── 11. La bitácora IGNORA las escrituras de sistema ────────────────────
  -- Si no, un cron de mora que toca miles de filas la volvería inútil.
  DELETE FROM public.bitacora_acciones;
  PERFORM set_config('app.uid', '', false);
  INSERT INTO public.checklist_areas (company_id, project_id, area) VALUES (CO, PR, 'Cron');
  SELECT count(*) INTO n FROM public.bitacora_acciones;
  IF n <> 0 THEN RAISE EXCEPTION '11: la bitácora registró % filas de sistema', n; END IF;
  RAISE NOTICE 'OK 11 las escrituras automáticas no ensucian la bitácora';

  -- ── 12. Tabla hija sin scope propio: resuelve por el padre ──────────────
  DELETE FROM public.bitacora_acciones;
  PERFORM set_config('app.uid', B::text, false);
  INSERT INTO public.rondas_seguridad (company_id, project_id) VALUES (CO, PR) RETURNING id INTO id1;
  INSERT INTO public.visitas_control (ronda_id, estado) VALUES (id1, 'pendiente');
  SELECT count(*) INTO n FROM public.bitacora_acciones
   WHERE modulo = 'Seguridad' AND company_id = CO AND project_id = PR;
  IF n < 2 THEN
    RAISE EXCEPTION '12: visitas_control no resolvió company/project por la ronda (n=%)', n; END IF;
  RAISE NOTICE 'OK 12 las tablas hijas heredan el scope de su padre en la bitácora';

  -- ── 13. UPDATE: `detalles` guarda SOLO lo que cambió ────────────────────
  DELETE FROM public.bitacora_acciones;
  UPDATE public.rondas_seguridad SET notas = 'sin novedad' WHERE id = id1;
  SELECT detalles::text INTO t FROM public.bitacora_acciones WHERE entidad_id = id1;
  IF t IS NULL OR t NOT LIKE '%notas%' THEN
    RAISE EXCEPTION '13a: detalles no trae el campo cambiado: %', t; END IF;
  IF t LIKE '%company_id%' THEN
    RAISE EXCEPTION '13b: detalles trae campos que NO cambiaron: %', t; END IF;
  RAISE NOTICE 'OK 13 el delta de un UPDATE guarda solo las columnas modificadas';

  -- ── 14. Cambio de estado → acción semántica, no "editar" ───────────────
  DELETE FROM public.bitacora_acciones;
  UPDATE public.rondas_seguridad SET estado = 'completada' WHERE id = id1;
  SELECT accion INTO t FROM public.bitacora_acciones WHERE entidad_id = id1;
  IF t <> 'cerrar' THEN RAISE EXCEPTION '14: accion=% (esperado cerrar)', t; END IF;
  RAISE NOTICE 'OK 14 un cambio de estado se traduce a la acción que la UI pinta';
END;
$$;
