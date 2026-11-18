-- ════════════════════════════════════════════════════════════════════════════
-- Invariantes de 20261202000000_rentas_inventario_fotos, ejercidas COMO cada
-- persona (JWT emulado + rol authenticated/anon). Storage se ejerce con las
-- sentencias que la API ejecuta: INSERT / SELECT / DELETE sobre storage.objects.
--   A · catálogo: columna, bucket privado sólo JPEG, 3 policies sin UPDATE, ACL
--   C · columna: hasta 6 fotos, todas en la carpeta de SU propiedad
--   S · subir y ver: empresa, servicio, alcance por proyecto, permiso, ruta exacta
--   D · borrar: sólo lo que ninguna fila nombra, y con permiso de escribir
--   G · servicio apagado
-- ════════════════════════════════════════════════════════════════════════════
\set ON_ERROR_STOP on
\i ../housekeeping_evidencias/lib.sql

CREATE OR REPLACE FUNCTION hkt.ar(n int) RETURNS uuid LANGUAGE sql IMMUTABLE AS
  $$ SELECT ('0a000000-0000-0000-0000-' || lpad(n::text, 12, '0'))::uuid $$;
CREATE OR REPLACE FUNCTION hkt.fotos_de(p_id uuid) RETURNS text[] LANGUAGE sql SECURITY DEFINER AS
  $$ SELECT fotos FROM public.rentas_inventario WHERE id = p_id $$;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA hkt TO anon, authenticated, service_role;

-- ── Escenario: A y B con el servicio; propiedades independiente, PA1 y PA2 en A; una en B
DO $$
BEGIN
  PERFORM hkt.root();
  UPDATE public.companies SET servicio_rentas = true;
  PERFORM hkt.como(hkt.uid(1));
  INSERT INTO public.rentas_propiedades (id, company_id, nombre) VALUES (hkt.pr(1), hkt.ca(), 'Casa Lago');
  INSERT INTO public.rentas_propiedades (id, company_id, project_id, unidad_id, nombre)
    VALUES (hkt.pr(2), hkt.ca(), hkt.pa1(), hkt.un(1), 'Apto 1A'),
           (hkt.pr(4), hkt.ca(), hkt.pa2(), hkt.un(3), 'Casa 3');
  PERFORM hkt.como(hkt.uid(7));
  INSERT INTO public.rentas_propiedades (id, company_id, nombre) VALUES (hkt.pr(9), hkt.cb(), 'Loft B');
  PERFORM hkt.root();
END $$;

-- ── A · catálogo ────────────────────────────────────────────────────────────
DO $$
BEGIN
  PERFORM hkt.ok('A1 rentas_inventario.fotos: text[] NOT NULL, vacío por defecto',
    (SELECT data_type = 'ARRAY' AND udt_name = '_text' AND is_nullable = 'NO' AND column_default = '''{}''::text[]'
       FROM information_schema.columns WHERE table_name = 'rentas_inventario' AND column_name = 'fotos'));
  PERFORM hkt.ok('A2 bucket rentas-inventario privado, 5 MiB, sólo image/jpeg',
    (SELECT NOT public AND file_size_limit = 5242880 AND allowed_mime_types = ARRAY['image/jpeg']
       FROM storage.buckets WHERE id = 'rentas-inventario'));
  PERFORM hkt.ok('A3 policies del bucket: select/insert/delete para authenticated, ninguna de UPDATE',
    (SELECT array_agg(cmd ORDER BY cmd) = ARRAY['DELETE', 'INSERT', 'SELECT'] AND bool_and(roles = '{authenticated}')
       FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname LIKE 'rentas\_inventario\_fotos\_%'));
  PERFORM hkt.ok('A4 la función de la policy: authenticated sí, anon no; DEFINER con search_path vacío',
    has_function_privilege('authenticated', 'public.rentas_inventario_foto_permitida(text, text)', 'EXECUTE')
    AND NOT has_function_privilege('anon', 'public.rentas_inventario_foto_permitida(text, text)', 'EXECUTE')
    AND (SELECT prosecdef AND proconfig = ARRAY['search_path=""'] FROM pg_proc
          WHERE oid = 'public.rentas_inventario_foto_permitida(text, text)'::regprocedure));
END $$;

-- ── C · la columna ──────────────────────────────────────────────────────────
DO $$
DECLARE
  f1 text := hkt.rf(hkt.ca(), hkt.pr(1), 'f1.jpg');
  seis text[] := ARRAY(SELECT hkt.rf(hkt.ca(), hkt.pr(1), 'g' || n || '.jpg') FROM generate_series(1, 6) n);
  ins text := 'INSERT INTO public.rentas_inventario (company_id, propiedad_id, nombre, fotos) VALUES (%L, %L, %L, %L)';
BEGIN
  PERFORM hkt.como(hkt.uid(3));
  INSERT INTO public.rentas_inventario (id, company_id, propiedad_id, nombre) VALUES (hkt.ar(1), hkt.ca(), hkt.pr(1), 'Sofá');
  PERFORM hkt.ok('C1 un artículo sin fotos nace con la lista vacía', hkt.fotos_de(hkt.ar(1)) = '{}');
  INSERT INTO public.rentas_inventario (id, company_id, propiedad_id, nombre, fotos)
    VALUES (hkt.ar(2), hkt.ca(), hkt.pr(1), 'Refrigeradora', ARRAY[f1, hkt.rf(hkt.ca(), hkt.pr(1), 'f2.jpg')]);
  PERFORM hkt.ok('C2 alta con dos fotos de la carpeta de su propiedad', cardinality(hkt.fotos_de(hkt.ar(2))) = 2);
  PERFORM hkt.ok('C3 una foto de la carpeta de OTRA propiedad → fotos_check',
    hkt.mensaje_de(format(ins, hkt.ca(), hkt.pr(1), 'x', ARRAY[hkt.rf(hkt.ca(), hkt.pr(2), 'x.jpg')])) LIKE '%rentas_inventario_fotos_check%');
  PERFORM hkt.ok('C4 una foto bajo la carpeta de OTRA empresa → fotos_check',
    hkt.mensaje_de(format(ins, hkt.ca(), hkt.pr(1), 'x', ARRAY[hkt.rf(hkt.cb(), hkt.pr(1), 'x.jpg')])) LIKE '%rentas_inventario_fotos_check%');
  PERFORM hkt.ok('C5 seis fotos entran; siete no',
    hkt.estado_de(format(ins, hkt.ca(), hkt.pr(1), 'x', seis)) = 'SIN_ERROR'
    AND hkt.mensaje_de(format(ins, hkt.ca(), hkt.pr(1), 'x', seis || f1)) LIKE '%rentas_inventario_fotos_check%');
  PERFORM hkt.ok('C6 subcarpeta, archivo vacío o elemento nulo → fotos_check',
    hkt.mensaje_de(format(ins, hkt.ca(), hkt.pr(1), 'x', ARRAY[hkt.rf(hkt.ca(), hkt.pr(1), 'sub/x.jpg')])) LIKE '%rentas_inventario_fotos_check%'
    AND hkt.mensaje_de(format(ins, hkt.ca(), hkt.pr(1), 'x', ARRAY[hkt.rf(hkt.ca(), hkt.pr(1), '')])) LIKE '%rentas_inventario_fotos_check%'
    AND hkt.mensaje_de(format(ins, hkt.ca(), hkt.pr(1), 'x', ARRAY[NULL]::text[])) LIKE '%rentas_inventario_fotos_check%');
  PERFORM hkt.ok('C7 un artículo CON fotos no se muda de propiedad; uno sin fotos, sí',
    hkt.mensaje_de(format('UPDATE public.rentas_inventario SET propiedad_id = %L WHERE id = %L', hkt.pr(2), hkt.ar(2))) LIKE '%rentas_inventario_fotos_check%'
    AND hkt.estado_de(format('UPDATE public.rentas_inventario SET propiedad_id = %L WHERE id = %L', hkt.pr(2), hkt.ar(1))) = 'SIN_ERROR');
END $$;

-- ── S · subir y ver ─────────────────────────────────────────────────────────
DO $$
DECLARE
  r1 text := hkt.rf(hkt.ca(), hkt.pr(1), 'r1.jpg');   -- independiente
  r2 text := hkt.rf(hkt.ca(), hkt.pr(2), 'r2.jpg');   -- PA1
  r4 text := hkt.rf(hkt.ca(), hkt.pr(4), 'r4.jpg');   -- PA2
  r9 text := hkt.rf(hkt.cb(), hkt.pr(9), 'r9.jpg');   -- empresa B
  v  text[];
BEGIN
  PERFORM hkt.como(hkt.uid(3));
  INSERT INTO storage.objects (bucket_id, name) VALUES ('rentas-inventario', r1), ('rentas-inventario', r2);
  PERFORM hkt.ok('S1 la operadora de PA1 sube a la independiente y a la de PA1', hkt.existe(r1) AND hkt.existe(r2));
  PERFORM hkt.ok('S2 … no a la de PA2 (sin acceso a ese proyecto) → 42501', hkt.estado_de(hkt.subir_sql(r4)) = '42501');
  PERFORM hkt.ok('S3 rutas fabricadas se NIEGAN (42501), no revientan: sin carpetas, ajenas, 4 niveles, propiedad inexistente o de B',
    hkt.estado_de(hkt.subir_sql('x/y/z.jpg')) = '42501'
    AND hkt.estado_de(hkt.subir_sql('z.jpg')) = '42501'
    AND hkt.estado_de(hkt.subir_sql(hkt.rf(hkt.ca(), hkt.pr(1), 'sub/z.jpg'))) = '42501'
    AND hkt.estado_de(hkt.subir_sql(hkt.rf(hkt.ca(), hkt.pr(77), 'z.jpg'))) = '42501'
    AND hkt.estado_de(hkt.subir_sql(hkt.rf(hkt.ca(), hkt.pr(9), 'z.jpg'))) = '42501'
    AND hkt.estado_de(hkt.subir_sql(r9)) = '42501');
  PERFORM hkt.ok('S4 una foto no se sustituye: UPDATE afecta 0 filas',
    hkt.afectadas(format('UPDATE storage.objects SET name = %L WHERE bucket_id = %L AND name = %L',
      hkt.rf(hkt.ca(), hkt.pr(1), 'otra.jpg'), 'rentas-inventario', r1)) = 0);

  PERFORM hkt.como(hkt.uid(4));
  INSERT INTO storage.objects (bucket_id, name) VALUES ('rentas-inventario', r4);
  v := hkt.visibles();
  PERFORM hkt.ok('S5 la operadora de PA2 sube a la de PA2 y ve la independiente y la suya, no la de PA1',
    v = ARRAY[r1, r4] OR v = ARRAY[r4, r1]);

  PERFORM hkt.como(hkt.uid(13));
  PERFORM hkt.ok('S6 la inventarista (asignada a PA1, sin ver propiedades) ve y sube',
    hkt.visibles() @> ARRAY[r1, r2] AND NOT hkt.visibles() @> ARRAY[r4]
    AND hkt.estado_de(hkt.subir_sql(hkt.rf(hkt.ca(), hkt.pr(2), 'inv.jpg'))) = 'SIN_ERROR');

  PERFORM hkt.como(hkt.uid(6));
  PERFORM hkt.ok('S7 solo-ver: ve, no sube',
    hkt.visibles() @> ARRAY[r1, r2] AND hkt.estado_de(hkt.subir_sql(hkt.rf(hkt.ca(), hkt.pr(1), 'sv.jpg'))) = '42501');

  PERFORM hkt.como(hkt.uid(5));
  PERFORM hkt.ok('S8 sin permiso de Rentas: no ve ni sube',
    hkt.visibles() = '{}' AND hkt.estado_de(hkt.subir_sql(hkt.rf(hkt.ca(), hkt.pr(1), 'np.jpg'))) = '42501');
  PERFORM hkt.como(hkt.uid(8));
  PERFORM hkt.ok('S9 un residente: no ve ni sube',
    hkt.visibles() = '{}' AND hkt.estado_de(hkt.subir_sql(hkt.rf(hkt.ca(), hkt.pr(1), 'res.jpg'))) = '42501');

  PERFORM hkt.como(hkt.uid(7));
  INSERT INTO storage.objects (bucket_id, name) VALUES ('rentas-inventario', r9);
  PERFORM hkt.ok('S10 la admin de B sube a la suya, no ve las de A ni sube a una carpeta de A',
    hkt.visibles() = ARRAY[r9] AND hkt.estado_de(hkt.subir_sql(hkt.rf(hkt.ca(), hkt.pr(1), 'b.jpg'))) = '42501');

  PERFORM hkt.como(hkt.uid(14));
  PERFORM hkt.ok('S11 la plataforma lee las de todas las empresas y no sube',
    hkt.visibles() @> ARRAY[r1, r2, r4, r9] AND hkt.estado_de(hkt.subir_sql(hkt.rf(hkt.ca(), hkt.pr(1), 'sa.jpg'))) = '42501');

  PERFORM hkt.como_anon();
  PERFORM hkt.ok('S12 anon: no ve ni sube',
    hkt.visibles() = '{}' AND hkt.estado_de(hkt.subir_sql(r1)) <> 'SIN_ERROR');
  PERFORM hkt.root();
END $$;

-- ── D · borrar ──────────────────────────────────────────────────────────────
DO $$
DECLARE
  d1 text := hkt.rf(hkt.ca(), hkt.pr(1), 'd1.jpg');
  d2 text := hkt.rf(hkt.ca(), hkt.pr(2), 'd2.jpg');
  d3 text := hkt.rf(hkt.ca(), hkt.pr(2), 'd3.jpg');
BEGIN
  PERFORM hkt.como(hkt.uid(3));
  INSERT INTO storage.objects (bucket_id, name)
    VALUES ('rentas-inventario', d1), ('rentas-inventario', d2), ('rentas-inventario', d3);
  INSERT INTO public.rentas_inventario (id, company_id, propiedad_id, nombre, fotos)
    VALUES (hkt.ar(10), hkt.ca(), hkt.pr(1), 'Mesa', ARRAY[d1]),
           (hkt.ar(11), hkt.ca(), hkt.pr(2), 'TV', ARRAY[d3]);
  PERFORM hkt.ok('D1 una foto que una fila nombra NO se borra (0 filas), ni con todos los permisos',
    hkt.afectadas(hkt.borrar_sql(d1)) = 0 AND hkt.existe(d1));
  UPDATE public.rentas_inventario SET fotos = '{}' WHERE id = hkt.ar(10);
  PERFORM hkt.ok('D2 en cuanto la fila la suelta, se borra', hkt.afectadas(hkt.borrar_sql(d1)) = 1 AND NOT hkt.existe(d1));

  PERFORM hkt.como(hkt.uid(6));
  PERFORM hkt.ok('D3 solo-ver no borra ni una huérfana', hkt.afectadas(hkt.borrar_sql(d2)) = 0 AND hkt.existe(d2));
  PERFORM hkt.como(hkt.uid(4));
  PERFORM hkt.ok('D4 la operadora de PA2 no borra una huérfana de PA1', hkt.afectadas(hkt.borrar_sql(d2)) = 0 AND hkt.existe(d2));

  PERFORM hkt.como(hkt.uid(13));
  PERFORM hkt.ok('D5 la inventarista (sin .delete) retira la huérfana de un alta cancelada',
    hkt.afectadas(hkt.borrar_sql(d2)) = 1 AND NOT hkt.existe(d2));
  PERFORM hkt.ok('D6 … pero no la foto de un artículo guardado', hkt.afectadas(hkt.borrar_sql(d3)) = 0 AND hkt.existe(d3));

  PERFORM hkt.como(hkt.uid(3));
  DELETE FROM public.rentas_inventario WHERE id = hkt.ar(11);
  PERFORM hkt.ok('D7 borrado el artículo, sus fotos se pueden retirar', hkt.afectadas(hkt.borrar_sql(d3)) = 1 AND NOT hkt.existe(d3));
  PERFORM hkt.root();
END $$;

-- ── G · servicio apagado ────────────────────────────────────────────────────
DO $$
BEGIN
  PERFORM hkt.root();
  UPDATE public.companies SET servicio_rentas = false WHERE id = hkt.ca();
  PERFORM hkt.como(hkt.uid(3));
  PERFORM hkt.ok('G1 servicio apagado: ni ve ni sube (los archivos siguen ahí)',
    hkt.visibles() = '{}'
    AND hkt.estado_de(hkt.subir_sql(hkt.rf(hkt.ca(), hkt.pr(1), 'off.jpg'))) = '42501'
    AND hkt.existe(hkt.rf(hkt.ca(), hkt.pr(1), 'r1.jpg')));
  PERFORM hkt.root();
  UPDATE public.companies SET servicio_rentas = true WHERE id = hkt.ca();
END $$;
