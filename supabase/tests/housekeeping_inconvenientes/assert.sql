-- ════════════════════════════════════════════════════════════════════════════
-- Invariantes de 20261124000000_housekeeping_inconvenientes_por_item, ejercidas COMO
-- cada persona (JWT emulado + rol authenticated/anon).
--   A · el ítem: orden asignado, empresa/proyecto y creado_por sellados, texto del
--       servicio derivado (uno → tal cual; varios → numerado; vacío → «(sin descripción)»),
--       servicio inmutable, tope de 30
--   B · la foto: ligada a un inconveniente del MISMO servicio, sólo en su fase, tope de
--       20 por fase compartido
--   C · RLS: otra empresa y quien no tiene el permiso no ven ni escriben; anon nada
--   D · borrar por RPC: quien lo creó mientras no esté completado, dueño/admin siempre,
--       otra empresa «inexistente»; se van las fotos (a la cola), el texto se renumera
--   E · datos anteriores: texto y bolsa de fotos → ítem 1, texto intacto, sin duplicar
--   F · inventario: triggers, RLS, ACL, columna y CHECK de la foto, grants mínimos
-- ════════════════════════════════════════════════════════════════════════════
\set ON_ERROR_STOP on
\i ../housekeeping_evidencias/lib.sql

-- Lecturas como la base (DEFINER) para poder preguntar siendo `authenticated`.
CREATE OR REPLACE FUNCTION hkt.servicio(p_sv uuid) RETURNS public.servicios_housekeeping
LANGUAGE sql SECURITY DEFINER AS $$ SELECT * FROM public.servicios_housekeeping WHERE id = p_sv $$;
CREATE OR REPLACE FUNCTION hkt.texto(p_sv uuid) RETURNS text
LANGUAGE sql SECURITY DEFINER AS $$ SELECT inconvenientes FROM public.servicios_housekeeping WHERE id = p_sv $$;
CREATE OR REPLACE FUNCTION hkt.item(p_sv uuid, p_orden int) RETURNS public.servicio_housekeeping_inconvenientes
LANGUAGE sql SECURITY DEFINER AS $$ SELECT * FROM public.servicio_housekeeping_inconvenientes WHERE servicio_id = p_sv AND orden = p_orden $$;
CREATE OR REPLACE FUNCTION hkt.items_n(p_sv uuid) RETURNS integer
LANGUAGE sql SECURITY DEFINER AS $$ SELECT count(*)::int FROM public.servicio_housekeeping_inconvenientes WHERE servicio_id = p_sv $$;
CREATE OR REPLACE FUNCTION hkt.fotos_de(p_item uuid) RETURNS integer
LANGUAGE sql SECURITY DEFINER AS $$ SELECT count(*)::int FROM public.servicio_housekeeping_fotos WHERE inconveniente_id = p_item $$;
CREATE OR REPLACE FUNCTION hkt.fotos_fase(p_sv uuid, p_fase text) RETURNS integer
LANGUAGE sql SECURITY DEFINER AS $$ SELECT count(*)::int FROM public.servicio_housekeeping_fotos WHERE servicio_id = p_sv AND fase = p_fase $$;
CREATE OR REPLACE FUNCTION hkt.cola_n(p_sv uuid) RETURNS integer
LANGUAGE sql SECURITY DEFINER AS $$ SELECT count(*)::int FROM public.hk_limpieza_storage WHERE path LIKE '%/' || p_sv::text || '/%' $$;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA hkt TO anon, authenticated, service_role;

-- ── A · el ítem ─────────────────────────────────────────────────────────────
DO $$
DECLARE it1 uuid; it2 uuid; it3 uuid; i int;
BEGIN
  PERFORM hkt.como(hkt.uid(3));
  INSERT INTO public.servicios_housekeeping (id, company_id, project_id, unidad_id) VALUES
    (hkt.sv(41), hkt.ca(), hkt.pa1(), hkt.un(1)),
    (hkt.sv(42), hkt.ca(), hkt.pa1(), hkt.un(2)),
    (hkt.sv(43), hkt.ca(), hkt.pa1(), hkt.un(2));
  UPDATE public.servicios_housekeeping SET estado = 'en_proceso' WHERE id IN (hkt.sv(41), hkt.sv(42), hkt.sv(43));

  INSERT INTO public.servicio_housekeeping_inconvenientes (servicio_id, descripcion) VALUES (hkt.sv(41), 'Grifo roto') RETURNING id INTO it1;
  PERFORM hkt.ok('A1 el primer inconveniente toma orden 1, empresa y proyecto del servicio y creado_por del actor',
    (SELECT orden = 1 AND company_id = hkt.ca() AND project_id = hkt.pa1() AND creado_por = hkt.uid(3)
       FROM public.servicio_housekeeping_inconvenientes WHERE id = it1));
  PERFORM hkt.ok('A2 con un solo inconveniente el texto del servicio es su descripción tal cual', hkt.texto(hkt.sv(41)) = 'Grifo roto');

  INSERT INTO public.servicio_housekeeping_inconvenientes (servicio_id, descripcion) VALUES (hkt.sv(41), 'Vidrio quebrado') RETURNING id INTO it2;
  PERFORM hkt.ok('A3 el segundo toma orden 2 y el texto pasa a lista numerada',
    (SELECT orden FROM public.servicio_housekeeping_inconvenientes WHERE id = it2) = 2
    AND hkt.texto(hkt.sv(41)) = E'1. Grifo roto\n2. Vidrio quebrado');

  UPDATE public.servicio_housekeeping_inconvenientes SET descripcion = 'Grifo de la cocina roto' WHERE id = it1;
  PERFORM hkt.ok('A4 editar la descripción reescribe el texto y sella updated_at',
    hkt.texto(hkt.sv(41)) = E'1. Grifo de la cocina roto\n2. Vidrio quebrado'
    AND (SELECT updated_at >= created_at FROM public.servicio_housekeeping_inconvenientes WHERE id = it1));

  INSERT INTO public.servicio_housekeeping_inconvenientes (servicio_id) VALUES (hkt.sv(41)) RETURNING id INTO it3;
  PERFORM hkt.ok('A5 un inconveniente sin descripción se nombra «(sin descripción)»',
    hkt.texto(hkt.sv(41)) = E'1. Grifo de la cocina roto\n2. Vidrio quebrado\n3. (sin descripción)');

  PERFORM hkt.ok('A6 el inconveniente no se mueve de servicio → 23514',
    hkt.estado_de(format($f$UPDATE public.servicio_housekeeping_inconvenientes SET servicio_id = %L WHERE id = %L$f$, hkt.sv(42), it1)) = '23514');
  UPDATE public.servicio_housekeeping_inconvenientes SET creado_por = hkt.uid(1), company_id = hkt.cb() WHERE id = it1;
  PERFORM hkt.ok('A7 creado_por y la empresa son inmutables',
    (SELECT creado_por = hkt.uid(3) AND company_id = hkt.ca() FROM public.servicio_housekeeping_inconvenientes WHERE id = it1));
  PERFORM hkt.ok('A8 un servicio ajeno (inexistente para la RLS) → 23503',
    hkt.estado_de(format($f$INSERT INTO public.servicio_housekeeping_inconvenientes (servicio_id, descripcion) VALUES (%L, 'x')$f$, hkt.sv(99))) = '23503');

  FOR i IN 1..30 LOOP
    INSERT INTO public.servicio_housekeeping_inconvenientes (servicio_id, descripcion) VALUES (hkt.sv(43), 'Ítem ' || i);
  END LOOP;
  PERFORM hkt.ok('A9 tope: 30 por servicio, el 31 → 23514',
    hkt.items_n(hkt.sv(43)) = 30
    AND hkt.estado_de(format($f$INSERT INTO public.servicio_housekeeping_inconvenientes (servicio_id, descripcion) VALUES (%L, 'x')$f$, hkt.sv(43))) = '23514');
  PERFORM hkt.ok('A10 con 30 el texto va numerado del 1 al 30', hkt.texto(hkt.sv(43)) LIKE E'1. Ítem 1\n%' AND hkt.texto(hkt.sv(43)) LIKE E'%\n30. Ítem 30');
END $$;

-- ── B · la foto ─────────────────────────────────────────────────────────────
DO $$
DECLARE it1 uuid; it2 uuid; it_otro uuid; i int;
BEGIN
  PERFORM hkt.como(hkt.uid(3));
  it1 := (hkt.item(hkt.sv(41), 1)).id;
  it2 := (hkt.item(hkt.sv(41), 2)).id;
  INSERT INTO public.servicio_housekeeping_fotos (servicio_id, fase, path, inconveniente_id) VALUES
    (hkt.sv(41), 'inconvenientes', hkt.ruta(hkt.pa1(), 41, 'i1a.jpg'), it1),
    (hkt.sv(41), 'inconvenientes', hkt.ruta(hkt.pa1(), 41, 'i1b.jpg'), it1),
    (hkt.sv(41), 'inconvenientes', hkt.ruta(hkt.pa1(), 41, 'i2a.jpg'), it2);
  PERFORM hkt.ok('B1 cada foto queda con su inconveniente', hkt.fotos_de(it1) = 2 AND hkt.fotos_de(it2) = 1);
  PERFORM hkt.ok('B2 una foto de la fase sin inconveniente sigue admitida (compatibilidad)',
    hkt.estado_de(format($f$INSERT INTO public.servicio_housekeeping_fotos (servicio_id, fase, path) VALUES (%L, 'inconvenientes', %L)$f$, hkt.sv(41), hkt.ruta(hkt.pa1(), 41, 'suelta.jpg'))) = 'SIN_ERROR');

  INSERT INTO public.servicio_housekeeping_inconvenientes (servicio_id, descripcion) VALUES (hkt.sv(42), 'De otro servicio') RETURNING id INTO it_otro;
  PERFORM hkt.ok('B3 la foto no puede apuntar a un inconveniente de OTRO servicio → 23514',
    hkt.estado_de(format($f$INSERT INTO public.servicio_housekeeping_fotos (servicio_id, fase, path, inconveniente_id) VALUES (%L, 'inconvenientes', %L, %L)$f$, hkt.sv(41), hkt.ruta(hkt.pa1(), 41, 'x.jpg'), it_otro)) = '23514');
  PERFORM hkt.ok('B4 sólo la fase «inconvenientes» lleva inconveniente → 23514',
    hkt.estado_de(format($f$INSERT INTO public.servicio_housekeeping_fotos (servicio_id, fase, path, inconveniente_id) VALUES (%L, 'ingreso', %L, %L)$f$, hkt.sv(41), hkt.ruta(hkt.pa1(), 41, 'y.jpg'), it1)) = '23514');

  FOR i IN 4..20 LOOP
    INSERT INTO public.servicio_housekeeping_fotos (servicio_id, fase, path, inconveniente_id)
      VALUES (hkt.sv(41), 'inconvenientes', hkt.ruta(hkt.pa1(), 41, 'i' || i || '.jpg'), CASE WHEN i % 2 = 0 THEN it1 ELSE it2 END);
  END LOOP;
  PERFORM hkt.ok('B5 el tope de 20 por fase se comparte entre los inconvenientes: la 21 → 23514',
    hkt.fotos_fase(hkt.sv(41), 'inconvenientes') = 20
    AND hkt.estado_de(format($f$INSERT INTO public.servicio_housekeeping_fotos (servicio_id, fase, path, inconveniente_id) VALUES (%L, 'inconvenientes', %L, %L)$f$, hkt.sv(41), hkt.ruta(hkt.pa1(), 41, 'i21.jpg'), it1)) = '23514');
  PERFORM hkt.ok('B6 las otras fases siguen con su cupo propio',
    hkt.estado_de(format($f$INSERT INTO public.servicio_housekeeping_fotos (servicio_id, fase, path) VALUES (%L, 'cierre', %L)$f$, hkt.sv(41), hkt.ruta(hkt.pa1(), 41, 'ci1.jpg'))) = 'SIN_ERROR');
END $$;

-- ── C · RLS como cada persona ───────────────────────────────────────────────
DO $$
DECLARE it1 uuid;
BEGIN
  it1 := (hkt.item(hkt.sv(41), 1)).id;

  PERFORM hkt.como(hkt.uid(7));   -- admin de la empresa B
  PERFORM hkt.ok('C1 otra empresa no ve los inconvenientes',
    (SELECT count(*) FROM public.servicio_housekeeping_inconvenientes WHERE servicio_id = hkt.sv(41)) = 0);
  PERFORM hkt.ok('C2 otra empresa no crea (el servicio no existe para ella) → 23503',
    hkt.estado_de(format($f$INSERT INTO public.servicio_housekeeping_inconvenientes (servicio_id, descripcion) VALUES (%L, 'x')$f$, hkt.sv(41))) = '23503');
  PERFORM hkt.ok('C3 otra empresa no edita (0 filas)',
    hkt.afectadas(format($f$UPDATE public.servicio_housekeeping_inconvenientes SET descripcion = 'hackeado' WHERE id = %L$f$, it1)) = 0
    AND (hkt.item(hkt.sv(41), 1)).descripcion = 'Grifo de la cocina roto');

  PERFORM hkt.como(hkt.uid(5));   -- operador de A SIN permiso de housekeeping
  PERFORM hkt.ok('C4 sin el permiso del módulo no ve ni crea',
    (SELECT count(*) FROM public.servicio_housekeeping_inconvenientes WHERE servicio_id = hkt.sv(41)) = 0
    AND hkt.estado_de(format($f$INSERT INTO public.servicio_housekeeping_inconvenientes (servicio_id, descripcion) VALUES (%L, 'x')$f$, hkt.sv(41))) = '23503');

  PERFORM hkt.como(hkt.uid(6));   -- otro operador de PA1 CON permiso
  PERFORM hkt.ok('C5 un compañero con acceso sí los ve y puede completar la descripción',
    (SELECT count(*) FROM public.servicio_housekeeping_inconvenientes WHERE servicio_id = hkt.sv(41)) = 3
    AND hkt.afectadas(format($f$UPDATE public.servicio_housekeeping_inconvenientes SET descripcion = 'Vidrio del baño quebrado' WHERE id = %L$f$, (hkt.item(hkt.sv(41), 2)).id)) = 1);
  PERFORM hkt.ok('C6 los clientes no borran filas con DELETE → 42501',
    hkt.estado_de(format($f$DELETE FROM public.servicio_housekeeping_inconvenientes WHERE id = %L$f$, it1)) = '42501');

  PERFORM hkt.como_anon();
  PERFORM hkt.ok('C7 anon no lee la tabla → 42501',
    hkt.estado_de('SELECT count(*) FROM public.servicio_housekeeping_inconvenientes') = '42501');
  PERFORM hkt.ok('C8 anon no ejecuta hk_eliminar_inconveniente → 42501',
    hkt.estado_de(format($f$SELECT public.hk_eliminar_inconveniente(%L)$f$, it1)) = '42501');
  PERFORM hkt.ok('C9 hk_inconvenientes_texto (DEFINER) no se expone a los clientes → 42501',
    hkt.estado_de(format($f$SELECT public.hk_inconvenientes_texto(%L)$f$, hkt.sv(41))) = '42501');
END $$;

-- ── D · borrar por RPC ──────────────────────────────────────────────────────
DO $$
DECLARE it1 uuid; it2 uuid; it3 uuid; n int;
BEGIN
  it1 := (hkt.item(hkt.sv(41), 1)).id;
  it2 := (hkt.item(hkt.sv(41), 2)).id;
  it3 := (hkt.item(hkt.sv(41), 3)).id;

  PERFORM hkt.como(hkt.uid(6));   -- con acceso, pero no lo creó
  PERFORM hkt.ok('D1 otro operador no borra lo que no creó → 42501',
    hkt.estado_de(format($f$SELECT public.hk_eliminar_inconveniente(%L)$f$, it2)) = '42501');

  PERFORM hkt.como(hkt.uid(3));   -- quien lo creó, servicio en proceso
  n := public.hk_eliminar_inconveniente(it2);
  PERFORM hkt.ok('D2 quien lo creó lo borra en proceso: se van sus 9 fotos (a la cola), queda el resto',
    n = 9 AND hkt.items_n(hkt.sv(41)) = 2 AND hkt.fotos_de(it2) = 0
    AND hkt.fotos_fase(hkt.sv(41), 'inconvenientes') = 11 AND hkt.cola_n(hkt.sv(41)) = 9);
  PERFORM hkt.ok('D3 el texto se renumera sin el borrado',
    hkt.texto(hkt.sv(41)) = E'1. Grifo de la cocina roto\n2. (sin descripción)');

  UPDATE public.servicios_housekeeping SET estado = 'completado' WHERE id = hkt.sv(41);
  PERFORM hkt.ok('D4 completado el servicio, ni quien lo creó borra → 42501',
    hkt.estado_de(format($f$SELECT public.hk_eliminar_inconveniente(%L)$f$, it3)) = '42501');

  PERFORM hkt.como(hkt.uid(1));   -- dueño de la empresa
  n := public.hk_eliminar_inconveniente(it3);
  PERFORM hkt.ok('D5 el dueño sí, aun completado; sin fotos devuelve 0 y el texto vuelve a ser el único, tal cual',
    n = 0 AND hkt.items_n(hkt.sv(41)) = 1 AND hkt.texto(hkt.sv(41)) = 'Grifo de la cocina roto');

  PERFORM hkt.como(hkt.uid(7));   -- otra empresa
  PERFORM hkt.ok('D6 otra empresa: «inexistente» → P0002',
    hkt.estado_de(format($f$SELECT public.hk_eliminar_inconveniente(%L)$f$, it1)) = 'P0002');
  PERFORM hkt.ok('D7 un id inventado → P0002',
    hkt.estado_de($f$SELECT public.hk_eliminar_inconveniente('00000000-0000-0000-0000-000000000000')$f$) = 'P0002');

  PERFORM hkt.como(hkt.uid(1));
  PERFORM public.hk_eliminar_inconveniente(it1);
  PERFORM hkt.ok('D8 sin inconvenientes el texto del servicio queda NULL', hkt.items_n(hkt.sv(41)) = 0 AND hkt.texto(hkt.sv(41)) IS NULL);
  PERFORM public.hk_eliminar_servicio(hkt.sv(42));
  PERFORM hkt.ok('D9 borrar el servicio se lleva sus inconvenientes (cascada)', hkt.items_n(hkt.sv(42)) = 0);
END $$;

-- ── E · datos anteriores a la migración ─────────────────────────────────────
DO $$
BEGIN
  PERFORM hkt.como(hkt.uid(3));
  PERFORM hkt.ok('E1 texto + 2 fotos → un inconveniente con el texto, sus 2 fotos ligadas, creado_por = quien inició; la de ingreso no se toca',
    hkt.items_n(hkt.sv(31)) = 1
    AND (hkt.item(hkt.sv(31), 1)).descripcion = 'Grifo roto'
    AND (hkt.item(hkt.sv(31), 1)).creado_por = hkt.uid(3)
    AND hkt.fotos_de((hkt.item(hkt.sv(31), 1)).id) = 2
    AND (SELECT count(*) FROM public.servicio_housekeeping_fotos WHERE servicio_id = hkt.sv(31) AND fase = 'ingreso' AND inconveniente_id IS NULL) = 1);
  PERFORM hkt.ok('E2 el texto del servicio no cambió', hkt.texto(hkt.sv(31)) = 'Grifo roto');
  PERFORM hkt.ok('E3 sólo fotos → inconveniente sin descripción con la foto ligada; el texto sigue NULL',
    hkt.items_n(hkt.sv(32)) = 1 AND (hkt.item(hkt.sv(32), 1)).descripcion = ''
    AND hkt.fotos_de((hkt.item(hkt.sv(32), 1)).id) = 1 AND hkt.texto(hkt.sv(32)) IS NULL);
  PERFORM hkt.ok('E4 sólo texto → inconveniente con el texto recortado, y el texto del servicio recortado igual',
    hkt.items_n(hkt.sv(33)) = 1 AND (hkt.item(hkt.sv(33), 1)).descripcion = 'Solo texto' AND hkt.texto(hkt.sv(33)) = 'Solo texto');
  PERFORM hkt.ok('E5 sin nada → sin inconvenientes', hkt.items_n(hkt.sv(34)) = 0 AND hkt.texto(hkt.sv(34)) IS NULL);
  PERFORM hkt.ok('E6 la migración se aplicó dos veces y no duplicó ni desligó nada',
    (SELECT count(*) FROM public.servicio_housekeeping_inconvenientes WHERE servicio_id IN (hkt.sv(31), hkt.sv(32), hkt.sv(33), hkt.sv(34))) = 3
    AND (SELECT count(*) FROM public.servicio_housekeeping_fotos WHERE servicio_id IN (hkt.sv(31), hkt.sv(32)) AND fase = 'inconvenientes' AND inconveniente_id IS NULL) = 0);
END $$;

-- ── F · inventario ──────────────────────────────────────────────────────────
DO $$
BEGIN
  PERFORM hkt.root();
  PERFORM hkt.ok('F1 triggers del ítem: preparar, sellar creado_por, sincronizar el texto',
    (SELECT count(*) FROM pg_trigger WHERE tgrelid = 'public.servicio_housekeeping_inconvenientes'::regclass AND NOT tgisinternal
       AND tgname IN ('trg_hk_inconvenientes_preparar', 'trg_sellar_creado_por', 'trg_hk_inconvenientes_sincronizar')) = 3);
  PERFORM hkt.ok('F2 RLS activa con tres policies (select, insert, update)',
    (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.servicio_housekeeping_inconvenientes'::regclass)
    AND (SELECT count(*) FROM pg_policies WHERE tablename = 'servicio_housekeeping_inconvenientes') = 3);
  PERFORM hkt.ok('F3 grants mínimos: authenticated SELECT/INSERT/UPDATE y no DELETE; anon nada',
    has_table_privilege('authenticated', 'public.servicio_housekeeping_inconvenientes', 'SELECT')
    AND has_table_privilege('authenticated', 'public.servicio_housekeeping_inconvenientes', 'INSERT')
    AND has_table_privilege('authenticated', 'public.servicio_housekeeping_inconvenientes', 'UPDATE')
    AND NOT has_table_privilege('authenticated', 'public.servicio_housekeeping_inconvenientes', 'DELETE')
    AND NOT has_table_privilege('anon', 'public.servicio_housekeeping_inconvenientes', 'SELECT'));
  PERFORM hkt.ok('F4 ACL de funciones: la RPC sólo para authenticated; las DEFINER internas para nadie',
    has_function_privilege('authenticated', 'public.hk_eliminar_inconveniente(uuid)', 'EXECUTE')
    AND NOT has_function_privilege('anon', 'public.hk_eliminar_inconveniente(uuid)', 'EXECUTE')
    AND NOT has_function_privilege('authenticated', 'public.hk_inconvenientes_texto(uuid)', 'EXECUTE')
    AND NOT has_function_privilege('anon', 'public.hk_inconvenientes_texto(uuid)', 'EXECUTE')
    AND NOT has_function_privilege('authenticated', 'public.hk_inconvenientes_sincronizar()', 'EXECUTE'));
  PERFORM hkt.ok('F5 la foto: columna, FK ON DELETE SET NULL, CHECK de fase e índice',
    EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.servicio_housekeeping_fotos'::regclass AND conname = 'hk_fotos_inconveniente_fase' AND contype = 'c')
    AND EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.servicio_housekeeping_fotos'::regclass AND contype = 'f'
                  AND confrelid = 'public.servicio_housekeeping_inconvenientes'::regclass AND confdeltype = 'n')
    AND EXISTS (SELECT 1 FROM pg_indexes WHERE tablename = 'servicio_housekeeping_fotos' AND indexname = 'idx_hk_fotos_inconveniente'));
  PERFORM hkt.ok('F6 el texto del servicio queda documentado como derivado',
    col_description('public.servicios_housekeeping'::regclass,
      (SELECT attnum FROM pg_attribute WHERE attrelid = 'public.servicios_housekeeping'::regclass AND attname = 'inconvenientes')) LIKE 'DERIVADO%');
END $$;
