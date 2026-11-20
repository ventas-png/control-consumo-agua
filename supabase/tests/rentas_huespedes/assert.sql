-- ════════════════════════════════════════════════════════════════════════════
-- Invariantes de 20261207000000_rentas_huespedes, ejercidas COMO cada persona.
-- Storage se ejerce con las sentencias que la API ejecuta sobre storage.objects.
--   A · catálogo: columnas, tabla con RLS, bucket privado sólo JPEG, policies, ACL
--   C · fotos de la reserva: sólo en la carpeta de SU propiedad
--   H · personas del grupo: de la reserva y la propiedad correctas, RBAC de Reservas
--   S · subir y ver: empresa, alcance por proyecto, permiso, ruta exacta
--   D · borrar: sólo lo que ninguna reserva ni persona nombra
--   G · servicio apagado
-- Personas: 1 dueña · 3 «Rentas completo» (PA1) · 4 ídem (PA2) · 6 sólo ver ·
--   5 sin permisos · 7 admin de B · 14 plataforma
-- ════════════════════════════════════════════════════════════════════════════
\set ON_ERROR_STOP on
\i ../housekeeping_evidencias/lib.sql

CREATE OR REPLACE FUNCTION hkt.rs(n int) RETURNS uuid LANGUAGE sql IMMUTABLE AS
  $$ SELECT ('f1000000-0000-0000-0000-' || lpad(n::text, 12, '0'))::uuid $$;
CREATE OR REPLACE FUNCTION hkt.n(p_tabla text) RETURNS int LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE v int; BEGIN EXECUTE format('SELECT count(*)::int FROM public.%I', p_tabla) INTO v; RETURN v; END $$;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA hkt TO anon, authenticated, service_role;

-- Escenario: A y B con el servicio; en A dos independientes y una de PA2; una en B.
DO $$
BEGIN
  PERFORM hkt.root();
  UPDATE public.companies SET servicio_rentas = true;
  PERFORM hkt.como(hkt.uid(1));
  INSERT INTO public.rentas_propiedades (id, company_id, nombre) VALUES
    (hkt.pr(1), hkt.ca(), 'Casa Lago'), (hkt.pr(6), hkt.ca(), 'Casa Mar');
  INSERT INTO public.rentas_propiedades (id, company_id, project_id, unidad_id, nombre)
    VALUES (hkt.pr(4), hkt.ca(), hkt.pa2(), hkt.un(3), 'Casa 3');
  INSERT INTO public.rentas_reservas (id, company_id, propiedad_id, huesped_nombre, fecha_entrada, fecha_salida) VALUES
    (hkt.rs(1), hkt.ca(), hkt.pr(1), 'Ana', '2026-03-02', '2026-03-05'),
    (hkt.rs(2), hkt.ca(), hkt.pr(6), 'Luis', '2026-03-02', '2026-03-05');
  PERFORM hkt.como(hkt.uid(7));
  INSERT INTO public.rentas_propiedades (id, company_id, nombre) VALUES (hkt.pr(9), hkt.cb(), 'Loft B');
  INSERT INTO public.rentas_reservas (id, company_id, propiedad_id, huesped_nombre, fecha_entrada, fecha_salida)
    VALUES (hkt.rs(9), hkt.cb(), hkt.pr(9), 'Eva', '2026-03-02', '2026-03-05');
  PERFORM hkt.root();
END $$;

-- ── A · catálogo ────────────────────────────────────────────────────────────
DO $$
BEGIN
  PERFORM hkt.ok('A1 la reserva gana foto_url y foto_documento_url (opcionales)',
    (SELECT count(*) = 2 AND bool_and(is_nullable = 'YES') FROM information_schema.columns
      WHERE table_name = 'rentas_reservas' AND column_name IN ('foto_url', 'foto_documento_url')));
  PERFORM hkt.ok('A2 rentas_huespedes con RLS, 4 policies y sin privilegios para anon',
    (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.rentas_huespedes'::regclass)
    AND (SELECT count(*) = 4 FROM pg_policies WHERE tablename = 'rentas_huespedes')
    AND NOT has_table_privilege('anon', 'public.rentas_huespedes', 'SELECT'));
  PERFORM hkt.ok('A3 bucket rentas-huespedes privado, 5 MiB, sólo image/jpeg',
    (SELECT NOT public AND file_size_limit = 5242880 AND allowed_mime_types = ARRAY['image/jpeg']
       FROM storage.buckets WHERE id = 'rentas-huespedes'));
  PERFORM hkt.ok('A4 policies del bucket: select/insert/delete para authenticated, ninguna de UPDATE',
    (SELECT array_agg(cmd ORDER BY cmd) = ARRAY['DELETE', 'INSERT', 'SELECT'] AND bool_and(roles = '{authenticated}')
       FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname LIKE 'rentas\_huespedes\_fotos\_%'));
  PERFORM hkt.ok('A5 la función de la policy: authenticated sí, anon no; DEFINER con search_path vacío; el trigger, nadie',
    has_function_privilege('authenticated', 'public.rentas_huesped_foto_permitida(text, text)', 'EXECUTE')
    AND NOT has_function_privilege('anon', 'public.rentas_huesped_foto_permitida(text, text)', 'EXECUTE')
    AND (SELECT prosecdef AND proconfig = ARRAY['search_path=""'] FROM pg_proc
          WHERE oid = 'public.rentas_huesped_foto_permitida(text, text)'::regprocedure)
    AND NOT has_function_privilege('authenticated', 'public.rentas_huesped_coherente()', 'EXECUTE'));
END $$;

-- ── C · fotos de la reserva ─────────────────────────────────────────────────
DO $$
DECLARE upd text := 'UPDATE public.rentas_reservas SET foto_url = %L WHERE id = %L';
BEGIN
  PERFORM hkt.como(hkt.uid(3));
  UPDATE public.rentas_reservas SET foto_url = hkt.rf(hkt.ca(), hkt.pr(1), 'ana.jpg'),
         foto_documento_url = hkt.rf(hkt.ca(), hkt.pr(1), 'ana-dpi.jpg') WHERE id = hkt.rs(1);
  PERFORM hkt.ok('C1 la reserva guarda las dos fotos en la carpeta de su propiedad',
    (SELECT foto_url LIKE '%/ana.jpg' AND foto_documento_url LIKE '%/ana-dpi.jpg' FROM public.rentas_reservas WHERE id = hkt.rs(1)));
  PERFORM hkt.ok('C2 foto en la carpeta de OTRA propiedad, de otra empresa, o con subcarpeta → 23514',
    hkt.estado_de(format(upd, hkt.rf(hkt.ca(), hkt.pr(6), 'x.jpg'), hkt.rs(1))) = '23514'
    AND hkt.estado_de(format(upd, hkt.rf(hkt.cb(), hkt.pr(9), 'x.jpg'), hkt.rs(1))) = '23514'
    AND hkt.estado_de(format(upd, hkt.rf(hkt.ca(), hkt.pr(1), 'sub/x.jpg'), hkt.rs(1))) = '23514'
    AND hkt.estado_de(format(upd, 'https://ejemplo.test/x.jpg', hkt.rs(1))) = '23514');
END $$;

-- ── H · personas del grupo ──────────────────────────────────────────────────
DO $$
DECLARE ins text := 'INSERT INTO public.rentas_huespedes (company_id, propiedad_id, reserva_id, nombre) VALUES (%L, %L, %L, %L)';
BEGIN
  PERFORM hkt.como(hkt.uid(3));
  INSERT INTO public.rentas_huespedes (company_id, propiedad_id, reserva_id, nombre, identificacion, foto_documento_url)
    VALUES (hkt.ca(), hkt.pr(1), hkt.rs(1), '  Beto  ', '  ', hkt.rf(hkt.ca(), hkt.pr(1), 'beto-dpi.jpg'));
  PERFORM hkt.ok('H1 quien captura reservas agrega una persona: nombre recortado, identificación vacía → NULL, sellada',
    (SELECT nombre = 'Beto' AND identificacion IS NULL AND creado_por = hkt.uid(3) FROM public.rentas_huespedes WHERE reserva_id = hkt.rs(1)));
  PERFORM hkt.ok('H2 la reserva es de OTRA propiedad → RENTAS_HUESPED_RESERVA',
    hkt.mensaje_de(format(ins, hkt.ca(), hkt.pr(1), hkt.rs(2), 'x')) LIKE 'RENTAS_HUESPED_RESERVA%'
    AND hkt.mensaje_de(format(ins, hkt.ca(), hkt.pr(6), hkt.rs(1), 'x')) LIKE 'RENTAS_HUESPED_RESERVA%');
  PERFORM hkt.ok('H3 no se muda de reserva → RENTAS_HUESPED_INMUTABLE',
    hkt.mensaje_de(format('UPDATE public.rentas_huespedes SET reserva_id = %L, propiedad_id = %L', hkt.rs(2), hkt.pr(6))) LIKE 'RENTAS_HUESPED_INMUTABLE%');
  PERFORM hkt.ok('H4 nombre vacío o foto fuera de su carpeta → 23514',
    hkt.estado_de(format(ins, hkt.ca(), hkt.pr(1), hkt.rs(1), '   ')) = '23514'
    AND hkt.estado_de(format('UPDATE public.rentas_huespedes SET foto_url = %L', hkt.rf(hkt.ca(), hkt.pr(6), 'x.jpg'))) = '23514');
  PERFORM hkt.ok('H5 a nombre de OTRA empresa → 42501',
    hkt.estado_de(format(ins, hkt.cb(), hkt.pr(9), hkt.rs(9), 'x')) = '42501');

  PERFORM hkt.como(hkt.uid(6));
  PERFORM hkt.ok('H6 solo-ver: la lee, no la escribe',
    (SELECT count(*) = 1 FROM public.rentas_huespedes)
    AND hkt.estado_de(format(ins, hkt.ca(), hkt.pr(1), hkt.rs(1), 'x')) = '42501'
    AND hkt.afectadas('UPDATE public.rentas_huespedes SET nombre = ''x''') = 0
    AND hkt.afectadas('DELETE FROM public.rentas_huespedes') = 0);
  PERFORM hkt.como(hkt.uid(5));
  PERFORM hkt.ok('H7 sin permisos de Rentas no ve a nadie', (SELECT count(*) = 0 FROM public.rentas_huespedes));
  PERFORM hkt.como(hkt.uid(7));
  PERFORM hkt.ok('H8 la admin de B no ve a las personas de A', (SELECT count(*) = 0 FROM public.rentas_huespedes));
END $$;

-- ── S · subir y ver ─────────────────────────────────────────────────────────
DO $$
DECLARE
  f1 text := hkt.rf(hkt.ca(), hkt.pr(1), 'ana.jpg');
  f2 text := hkt.rf(hkt.ca(), hkt.pr(1), 'beto-dpi.jpg');
  f3 text := hkt.rf(hkt.ca(), hkt.pr(1), 'suelta.jpg');
BEGIN
  PERFORM hkt.como(hkt.uid(3));
  PERFORM hkt.ok('S1 quien captura reservas sube a la carpeta de una propiedad a su alcance',
    hkt.afectadas(hkt.subir_sql(f1)) = 1 AND hkt.afectadas(hkt.subir_sql(f2)) = 1 AND hkt.afectadas(hkt.subir_sql(f3)) = 1);
  PERFORM hkt.ok('S2 … pero no a una propiedad de un proyecto ajeno, a otra empresa, ni con otra forma de ruta → 42501',
    hkt.estado_de(hkt.subir_sql(hkt.rf(hkt.ca(), hkt.pr(4), 'x.jpg'))) = '42501'
    AND hkt.estado_de(hkt.subir_sql(hkt.rf(hkt.cb(), hkt.pr(9), 'x.jpg'))) = '42501'
    AND hkt.estado_de(hkt.subir_sql(hkt.ca()::text || '/x.jpg')) = '42501'
    AND hkt.estado_de(hkt.subir_sql(hkt.rf(hkt.ca(), hkt.pr(1), 'sub/x.jpg'))) = '42501'
    AND hkt.estado_de(hkt.subir_sql('x/y/z.jpg')) = '42501');
  PERFORM hkt.ok('S3 una foto no se sustituye (sin policy de UPDATE)',
    hkt.afectadas(format('UPDATE storage.objects SET name = %L WHERE bucket_id = %L AND name = %L',
      hkt.rf(hkt.ca(), hkt.pr(1), 'otra.jpg'), 'rentas-huespedes', f3)) = 0);
  PERFORM hkt.como(hkt.uid(6));
  PERFORM hkt.ok('S4 solo-ver las ve y no sube', cardinality(hkt.visibles()) = 3 AND hkt.estado_de(hkt.subir_sql(hkt.rf(hkt.ca(), hkt.pr(1), 'y.jpg'))) = '42501');
  PERFORM hkt.como(hkt.uid(5));
  PERFORM hkt.ok('S5 sin permisos de Rentas no ve ninguna', cardinality(hkt.visibles()) = 0);
  PERFORM hkt.como(hkt.uid(7));
  PERFORM hkt.ok('S6 la admin de B no ve las de A ni sube ahí',
    cardinality(hkt.visibles()) = 0 AND hkt.estado_de(hkt.subir_sql(hkt.rf(hkt.ca(), hkt.pr(1), 'z.jpg'))) = '42501');
  PERFORM hkt.como(hkt.uid(14));
  PERFORM hkt.ok('S7 la plataforma las lee y no sube', cardinality(hkt.visibles()) = 3
    AND hkt.estado_de(hkt.subir_sql(hkt.rf(hkt.ca(), hkt.pr(1), 'p.jpg'))) = '42501');
  PERFORM hkt.como_anon();
  PERFORM hkt.ok('S8 anon no ve nada', cardinality(hkt.visibles()) = 0);
END $$;

-- ── D · borrar ──────────────────────────────────────────────────────────────
DO $$
DECLARE
  f1 text := hkt.rf(hkt.ca(), hkt.pr(1), 'ana.jpg');        -- la nombra la reserva
  f2 text := hkt.rf(hkt.ca(), hkt.pr(1), 'beto-dpi.jpg');   -- la nombra una persona del grupo
  f3 text := hkt.rf(hkt.ca(), hkt.pr(1), 'suelta.jpg');     -- nadie la nombra
BEGIN
  PERFORM hkt.como(hkt.uid(6));
  PERFORM hkt.ok('D1 solo-ver no borra ni una huérfana', hkt.afectadas(hkt.borrar_sql(f3)) = 0 AND hkt.existe(f3));
  PERFORM hkt.como(hkt.uid(3));
  PERFORM hkt.ok('D2 la foto que nombra una reserva no se borra', hkt.afectadas(hkt.borrar_sql(f1)) = 0 AND hkt.existe(f1));
  PERFORM hkt.ok('D3 la que nombra una persona del grupo tampoco', hkt.afectadas(hkt.borrar_sql(f2)) = 0 AND hkt.existe(f2));
  PERFORM hkt.ok('D4 la huérfana sí', hkt.afectadas(hkt.borrar_sql(f3)) = 1 AND NOT hkt.existe(f3));
  UPDATE public.rentas_reservas SET foto_url = NULL WHERE id = hkt.rs(1);
  DELETE FROM public.rentas_huespedes WHERE reserva_id = hkt.rs(1);
  PERFORM hkt.ok('D5 en cuanto la fila las suelta, se retiran',
    hkt.afectadas(hkt.borrar_sql(f1)) = 1 AND hkt.afectadas(hkt.borrar_sql(f2)) = 1);
END $$;

-- ── G · servicio apagado y borrado en cascada ───────────────────────────────
DO $$
BEGIN
  PERFORM hkt.como(hkt.uid(3));
  INSERT INTO public.rentas_huespedes (company_id, propiedad_id, reserva_id, nombre) VALUES (hkt.ca(), hkt.pr(6), hkt.rs(2), 'Caro');
  PERFORM hkt.afectadas(hkt.subir_sql(hkt.rf(hkt.ca(), hkt.pr(6), 'caro.jpg')));
  PERFORM hkt.root();
  UPDATE public.companies SET servicio_rentas = false WHERE id = hkt.ca();
  PERFORM hkt.como(hkt.uid(1));
  PERFORM hkt.ok('G1 servicio apagado: ni la dueña ve personas o fotos, ni sube',
    (SELECT count(*) = 0 FROM public.rentas_huespedes) AND cardinality(hkt.visibles()) = 0
    AND hkt.estado_de(hkt.subir_sql(hkt.rf(hkt.ca(), hkt.pr(6), 'n.jpg'))) = '42501');
  PERFORM hkt.root();
  UPDATE public.companies SET servicio_rentas = true WHERE id = hkt.ca();
  PERFORM hkt.como(hkt.uid(1));
  DELETE FROM public.rentas_reservas WHERE id = hkt.rs(2);
  PERFORM hkt.ok('G2 borrar la reserva se lleva a las personas de su grupo', hkt.n('rentas_huespedes') = 0);
END $$;
