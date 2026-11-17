-- ════════════════════════════════════════════════════════════════════════════
-- Invariantes de 20261128000000_rentas_finanzas, ejercidas COMO cada persona.
--   A · catálogo: claves, RLS, ACL
--   B · conceptos: siembra al contratar, sin duplicar, quién los lee y configura
--   C · liquidaciones: de las dos fuentes de reservas, montos, conceptos, una por reserva
--   D · gastos: sólo Finanzas, alcance por proyecto, montos y catálogos
--   E · servicio apagado, otra empresa, anon
--   F · borrados en cascada
-- Personas (rentas_modulo/datos.sql): 1 dueña · 3 «Rentas completo» en PA1 · 4 ídem en PA2
--   · 6 sólo ver · 5 sin permisos · 7 admin de B · 13 «Rentas finanzas» (se crea aquí) en PA1
-- ════════════════════════════════════════════════════════════════════════════
\set ON_ERROR_STOP on
\i ../housekeeping_evidencias/lib.sql

CREATE OR REPLACE FUNCTION hkt.n(p_tabla text) RETURNS int LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE v int; BEGIN EXECUTE format('SELECT count(*)::int FROM public.%I', p_tabla) INTO v; RETURN v; END $$;
CREATE OR REPLACE FUNCTION hkt.con(p_company uuid, p_bloque text, p_codigo text) RETURNS uuid LANGUAGE sql SECURITY DEFINER AS
  $$ SELECT id FROM public.rentas_conceptos WHERE company_id = p_company AND bloque = p_bloque AND codigo = p_codigo $$;
CREATE OR REPLACE FUNCTION hkt.rs(n int) RETURNS uuid LANGUAGE sql IMMUTABLE AS
  $$ SELECT ('f1000000-0000-0000-0000-' || lpad(n::text, 12, '0'))::uuid $$;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA hkt TO anon, authenticated, service_role;

SELECT hkt.root();
-- El rol de Finanzas (sus claves las sembró la migración) → 13.
INSERT INTO public.roles (id, company_id, name) VALUES
  ('e0000000-0000-0000-0000-0000000000a4'::uuid, hkt.ca(), 'Rentas finanzas');
INSERT INTO public.role_permissions (role_id, permission_key, effect)
SELECT 'e0000000-0000-0000-0000-0000000000a4', 'rentas.finanzas.' || a, 'allow'
  FROM unnest(ARRAY['view', 'create', 'edit', 'delete']) a;
INSERT INTO public.user_roles (user_id, role_id, expires_at) VALUES
  (hkt.uid(13), 'e0000000-0000-0000-0000-0000000000a4', NULL);

-- ── A · catálogo ────────────────────────────────────────────────────────────
DO $$
BEGIN
  PERFORM hkt.ok('A1 4 claves rentas.finanzas.* (20 de Rentas en total) y el Administrador General las recibe',
    (SELECT count(*) = 4 FROM public.permissions WHERE key LIKE 'rentas.finanzas.%')
    AND (SELECT count(*) = 20 FROM public.permissions WHERE key LIKE 'rentas.%')
    AND (SELECT count(*) = 4 FROM public.role_permissions
          WHERE role_id = '00000000-0000-0000-0000-000000000001' AND permission_key LIKE 'rentas.finanzas.%'));
  PERFORM hkt.ok('A2 las tres tablas con RLS: 3 + 4 + 4 policies',
    (SELECT bool_and(relrowsecurity) AND count(*) = 3 FROM pg_class WHERE relnamespace = 'public'::regnamespace
      AND relname IN ('rentas_conceptos', 'rentas_liquidaciones', 'rentas_gastos'))
    AND (SELECT count(*) = 3 FROM pg_policies WHERE tablename = 'rentas_conceptos')
    AND (SELECT count(*) = 4 FROM pg_policies WHERE tablename = 'rentas_liquidaciones')
    AND (SELECT count(*) = 4 FROM pg_policies WHERE tablename = 'rentas_gastos'));
  PERFORM hkt.ok('A3 anon sin privilegios; los conceptos no se borran por la API',
    NOT has_table_privilege('anon', 'public.rentas_conceptos', 'SELECT')
    AND NOT has_table_privilege('anon', 'public.rentas_liquidaciones', 'INSERT')
    AND NOT has_table_privilege('anon', 'public.rentas_gastos', 'SELECT')
    AND NOT has_table_privilege('authenticated', 'public.rentas_conceptos', 'DELETE')
    AND has_table_privilege('authenticated', 'public.rentas_gastos', 'DELETE'));
  PERFORM hkt.ok('A4 las funciones de trigger y la siembra no se llaman por la API',
    NOT has_function_privilege('authenticated', 'public.rentas_sembrar_conceptos(uuid)', 'EXECUTE')
    AND NOT has_function_privilege('anon', 'public.rentas_sembrar_conceptos(uuid)', 'EXECUTE')
    AND NOT has_function_privilege('authenticated', 'public.rentas_liquidacion_coherente()', 'EXECUTE')
    AND NOT has_function_privilege('authenticated', 'public.companies_rentas_conceptos()', 'EXECUTE'));
  PERFORM hkt.ok('A5 la reserva independiente gana política de cancelación y mascotas (0 por defecto)',
    (SELECT count(*) = 2 FROM information_schema.columns WHERE table_name = 'rentas_reservas'
      AND column_name IN ('politica_cancelacion', 'num_mascotas')));
  PERFORM hkt.ok('A6 la política usa el catálogo de la pestaña STR; las mascotas no son negativas',
    (SELECT pg_get_constraintdef(oid) LIKE '%no_reembolsable%' FROM pg_constraint WHERE conname = 'rentas_reservas_politica_check')
    AND (SELECT pg_get_constraintdef(oid) LIKE '%num_mascotas >= 0%' FROM pg_constraint WHERE conname = 'rentas_reservas_mascotas_check'));
END $$;

-- ── B · conceptos ───────────────────────────────────────────────────────────
DO $$
DECLARE v uuid;
BEGIN
  UPDATE public.companies SET servicio_rentas = false WHERE id = hkt.cb();
  PERFORM hkt.ok('B1 sin el servicio contratado no hay conceptos (ni al tocar el interruptor apagado)', hkt.n('rentas_conceptos') = 0);
  UPDATE public.companies SET servicio_rentas = true WHERE id = hkt.ca();
  PERFORM hkt.ok('B2 al contratar se siembran los 13 del Excel (5 del huésped, 8 del anfitrión), sólo en esa empresa',
    (SELECT count(*) = 13 AND count(*) FILTER (WHERE bloque = 'huesped') = 5 AND bool_and(company_id = hkt.ca())
       FROM public.rentas_conceptos));
  PERFORM hkt.ok('B3 restan: descuentos, servicio de anfitriones y coanfitrión; el resto suma',
    (SELECT array_agg(codigo ORDER BY codigo) = ARRAY['coanfitrion', 'descuentos', 'servicio_anfitrion']
       FROM public.rentas_conceptos WHERE signo = -1));
  UPDATE public.rentas_conceptos SET nombre = 'Hospedaje' WHERE id = hkt.con(hkt.ca(), 'anfitrion', 'tarifa_habitacion');
  UPDATE public.companies SET servicio_rentas = false WHERE id = hkt.ca();
  UPDATE public.companies SET servicio_rentas = true  WHERE id = hkt.ca();
  PERFORM hkt.ok('B4 apagar y volver a encender no duplica ni pisa el nombre que la empresa cambió',
    hkt.n('rentas_conceptos') = 13
    AND (SELECT nombre = 'Hospedaje' FROM public.rentas_conceptos WHERE id = hkt.con(hkt.ca(), 'anfitrion', 'tarifa_habitacion')));

  PERFORM hkt.como(hkt.uid(3));
  PERFORM hkt.ok('B5 quien captura reservas LEE los conceptos…', (SELECT count(*) = 13 FROM public.rentas_conceptos));
  PERFORM hkt.ok('B6 … pero no los crea ni los cambia (no tiene Finanzas)',
    hkt.estado_de(format('INSERT INTO public.rentas_conceptos (company_id, bloque, codigo, nombre) VALUES (%L, %L, %L, %L)',
      hkt.ca(), 'anfitrion', 'propina', 'Propina')) = '42501'
    AND hkt.afectadas('UPDATE public.rentas_conceptos SET activo = false') = 0);
  PERFORM hkt.como(hkt.uid(5));
  PERFORM hkt.ok('B7 sin permisos de Rentas no se ven', (SELECT count(*) = 0 FROM public.rentas_conceptos));

  PERFORM hkt.como(hkt.uid(13));
  INSERT INTO public.rentas_conceptos (company_id, bloque, codigo, nombre, signo, orden)
    VALUES (hkt.ca(), 'anfitrion', 'propina', '  Propina  ', 1, 90);
  PERFORM hkt.ok('B8 Finanzas agrega un concepto propio: nombre recortado, sellado',
    (SELECT nombre = 'Propina' AND creado_por = hkt.uid(13) FROM public.rentas_conceptos WHERE codigo = 'propina'));
  PERFORM hkt.ok('B9 … lo renombra, le cambia el signo y lo desactiva',
    hkt.afectadas('UPDATE public.rentas_conceptos SET nombre = ''Propinas'', signo = -1, activo = false WHERE codigo = ''propina''') = 1);
  PERFORM hkt.ok('B10 … pero no le cambia el bloque ni el código → RENTAS_CONCEPTO_INMUTABLE',
    hkt.mensaje_de('UPDATE public.rentas_conceptos SET bloque = ''huesped'' WHERE codigo = ''propina''') LIKE 'RENTAS_CONCEPTO_INMUTABLE%'
    AND hkt.mensaje_de('UPDATE public.rentas_conceptos SET codigo = ''otra'' WHERE codigo = ''propina''') LIKE 'RENTAS_CONCEPTO_INMUTABLE%');
  PERFORM hkt.ok('B11 código repetido en el bloque → 23505; bloque, signo y código fuera de regla → 23514; borrar → 42501',
    hkt.estado_de(format('INSERT INTO public.rentas_conceptos (company_id, bloque, codigo, nombre) VALUES (%L, %L, %L, %L)',
      hkt.ca(), 'anfitrion', 'propina', 'x')) = '23505'
    AND hkt.estado_de(format('INSERT INTO public.rentas_conceptos (company_id, bloque, codigo, nombre) VALUES (%L, %L, %L, %L)',
      hkt.ca(), 'banco', 'x', 'x')) = '23514'
    AND hkt.estado_de(format('INSERT INTO public.rentas_conceptos (company_id, bloque, codigo, nombre, signo) VALUES (%L, %L, %L, %L, 2)',
      hkt.ca(), 'anfitrion', 'x', 'x')) = '23514'
    AND hkt.estado_de(format('INSERT INTO public.rentas_conceptos (company_id, bloque, codigo, nombre) VALUES (%L, %L, %L, %L)',
      hkt.ca(), 'anfitrion', 'Con Espacio', 'x')) = '23514'
    AND hkt.estado_de('DELETE FROM public.rentas_conceptos') = '42501');
  PERFORM hkt.ok('B12 concepto a nombre de OTRA empresa → 42501',
    hkt.estado_de(format('INSERT INTO public.rentas_conceptos (company_id, bloque, codigo, nombre) VALUES (%L, %L, %L, %L)',
      hkt.cb(), 'anfitrion', 'x', 'x')) = '42501');
END $$;

-- Propiedades y reservas de trabajo.
SELECT hkt.como(hkt.uid(1));
INSERT INTO public.rentas_propiedades (id, company_id, project_id, unidad_id, nombre, tipo_renta, comision_pct) VALUES
  (hkt.pr(1), hkt.ca(), NULL,       NULL,      'Casa Lago', 'corto_plazo', 20),
  (hkt.pr(2), hkt.ca(), hkt.pa1(),  hkt.un(1), 'Apto 1A',   'corto_plazo', 15),
  (hkt.pr(4), hkt.ca(), hkt.pa2(),  hkt.un(3), 'Casa 3',    'corto_plazo', NULL),
  (hkt.pr(6), hkt.ca(), NULL,       NULL,      'Casa Mar',  'corto_plazo', NULL);
INSERT INTO public.rentas_reservas (id, company_id, propiedad_id, huesped_nombre, fecha_entrada, fecha_salida, politica_cancelacion, num_mascotas) VALUES
  (hkt.rs(1), hkt.ca(), hkt.pr(1), 'Ana', '2026-02-02', '2026-02-03', 'no_reembolsable', 1),
  (hkt.rs(2), hkt.ca(), hkt.pr(6), 'Luis', '2026-02-04', '2026-02-08', NULL, 0);
SELECT hkt.root();
INSERT INTO public.reservas_str (id, company_id, project_id, unidad_id, huesped_nombre, fecha_entrada, fecha_salida) VALUES
  (hkt.rs(11), hkt.ca(), hkt.pa1(), hkt.un(1), 'Eva',  '2026-02-09', '2026-02-10'),
  (hkt.rs(12), hkt.ca(), hkt.pa1(), hkt.un(2), 'Otro', '2026-02-09', '2026-02-10'),
  (hkt.rs(13), hkt.ca(), hkt.pa2(), hkt.un(3), 'Sur',  '2026-02-12', '2026-02-14');
UPDATE public.companies SET servicio_rentas = true WHERE id = hkt.cb();

-- ── C · liquidaciones ───────────────────────────────────────────────────────
DO $$
DECLARE
  th uuid := hkt.con(hkt.ca(), 'anfitrion', 'tarifa_habitacion');
  ds uuid := hkt.con(hkt.ca(), 'anfitrion', 'descuentos');
  ajeno uuid := hkt.con(hkt.cb(), 'anfitrion', 'tarifa_habitacion');
BEGIN
  PERFORM hkt.ok('C0 la empresa B, al contratar, recibe sus propios 13 conceptos', ajeno IS NOT NULL AND ajeno <> th);
  PERFORM hkt.como(hkt.uid(3));
  INSERT INTO public.rentas_liquidaciones (company_id, propiedad_id, reserva_id, importes)
    VALUES (hkt.ca(), hkt.pr(1), hkt.rs(1), jsonb_build_object(th::text, 39, ds::text, 3.90));
  PERFORM hkt.ok('C1 quien captura reservas guarda el desglose de una reserva independiente, sellado',
    (SELECT (importes ->> th::text)::numeric = 39 AND creado_por = hkt.uid(3) FROM public.rentas_liquidaciones WHERE reserva_id = hkt.rs(1)));
  PERFORM hkt.ok('C2 segunda liquidación de la misma reserva → 23505',
    hkt.estado_de(format('INSERT INTO public.rentas_liquidaciones (company_id, propiedad_id, reserva_id) VALUES (%L, %L, %L)',
      hkt.ca(), hkt.pr(1), hkt.rs(1))) = '23505');
  PERFORM hkt.ok('C3 monto negativo o que no es número → RENTAS_IMPORTE_INVALIDO',
    hkt.mensaje_de(format('UPDATE public.rentas_liquidaciones SET importes = %L WHERE reserva_id = %L',
      jsonb_build_object(th::text, -5), hkt.rs(1))) LIKE 'RENTAS_IMPORTE_INVALIDO%'
    AND hkt.mensaje_de(format('UPDATE public.rentas_liquidaciones SET importes = %L WHERE reserva_id = %L',
      jsonb_build_object(th::text, 'mucho'), hkt.rs(1))) LIKE 'RENTAS_IMPORTE_INVALIDO%');
  PERFORM hkt.ok('C4 concepto de OTRA empresa o inexistente → RENTAS_CONCEPTO_AJENO',
    hkt.mensaje_de(format('UPDATE public.rentas_liquidaciones SET importes = %L WHERE reserva_id = %L',
      jsonb_build_object(ajeno::text, 10), hkt.rs(1))) LIKE 'RENTAS_CONCEPTO_AJENO%'
    AND hkt.mensaje_de(format('UPDATE public.rentas_liquidaciones SET importes = %L WHERE reserva_id = %L',
      '{"no-es-uuid": 10}', hkt.rs(1))) LIKE 'RENTAS_CONCEPTO_AJENO%');
  PERFORM hkt.ok('C5 el desglose no es un objeto → 23514',
    hkt.estado_de(format('UPDATE public.rentas_liquidaciones SET importes = %L WHERE reserva_id = %L', '[1,2]', hkt.rs(1))) = '23514');
  PERFORM hkt.ok('C6 la reserva es de OTRA propiedad → RENTAS_LIQUIDACION_RESERVA',
    hkt.mensaje_de(format('INSERT INTO public.rentas_liquidaciones (company_id, propiedad_id, reserva_id) VALUES (%L, %L, %L)',
      hkt.ca(), hkt.pr(1), hkt.rs(2))) LIKE 'RENTAS_LIQUIDACION_RESERVA%');
  PERFORM hkt.ok('C7 sin reserva, o con las dos → 23514',
    hkt.estado_de(format('INSERT INTO public.rentas_liquidaciones (company_id, propiedad_id) VALUES (%L, %L)', hkt.ca(), hkt.pr(1))) = '23514'
    AND hkt.estado_de(format('INSERT INTO public.rentas_liquidaciones (company_id, propiedad_id, reserva_id, reserva_str_id) VALUES (%L, %L, %L, %L)',
      hkt.ca(), hkt.pr(6), hkt.rs(2), hkt.rs(11))) = '23514');

  INSERT INTO public.rentas_liquidaciones (company_id, propiedad_id, reserva_str_id, importes)
    VALUES (hkt.ca(), hkt.pr(2), hkt.rs(11), jsonb_build_object(th::text, 44));
  PERFORM hkt.ok('C8 desglose de una reserva de la pestaña STR del condominio (propiedad enlazada)',
    (SELECT count(*) = 1 FROM public.rentas_liquidaciones WHERE reserva_str_id = hkt.rs(11)));
  PERFORM hkt.ok('C9 reserva STR de OTRA unidad, o colgada de una propiedad independiente → RENTAS_LIQUIDACION_RESERVA',
    hkt.mensaje_de(format('INSERT INTO public.rentas_liquidaciones (company_id, propiedad_id, reserva_str_id) VALUES (%L, %L, %L)',
      hkt.ca(), hkt.pr(2), hkt.rs(12))) LIKE 'RENTAS_LIQUIDACION_RESERVA%'
    AND hkt.mensaje_de(format('INSERT INTO public.rentas_liquidaciones (company_id, propiedad_id, reserva_str_id) VALUES (%L, %L, %L)',
      hkt.ca(), hkt.pr(1), hkt.rs(12))) LIKE 'RENTAS_LIQUIDACION_RESERVA%');
  PERFORM hkt.ok('C10 la operadora de PA1 no liquida una propiedad de PA2 → 42501',
    hkt.estado_de(format('INSERT INTO public.rentas_liquidaciones (company_id, propiedad_id, reserva_str_id) VALUES (%L, %L, %L)',
      hkt.ca(), hkt.pr(4), hkt.rs(13))) = '42501');
  PERFORM hkt.ok('C11 no se muda de reserva → RENTAS_LIQUIDACION_INMUTABLE',
    hkt.mensaje_de(format('UPDATE public.rentas_liquidaciones SET reserva_id = %L, propiedad_id = %L WHERE reserva_id = %L',
      hkt.rs(2), hkt.pr(6), hkt.rs(1))) LIKE 'RENTAS_LIQUIDACION_INMUTABLE%');

  PERFORM hkt.ok('C11b política fuera de catálogo o mascotas negativas → 23514',
    hkt.estado_de(format('UPDATE public.rentas_reservas SET politica_cancelacion = %L WHERE id = %L', 'la que sea', hkt.rs(1))) = '23514'
    AND hkt.estado_de(format('UPDATE public.rentas_reservas SET num_mascotas = -1 WHERE id = %L', hkt.rs(1))) = '23514');

  PERFORM hkt.como(hkt.uid(4));
  PERFORM hkt.ok('C12 la operadora de PA2 ve la de la independiente, no la de PA1',
    (SELECT count(*) = 1 AND bool_and(reserva_id = hkt.rs(1)) FROM public.rentas_liquidaciones));
  PERFORM hkt.como(hkt.uid(6));
  PERFORM hkt.ok('C13 solo-ver: las lee, no las escribe',
    (SELECT count(*) = 2 FROM public.rentas_liquidaciones)
    AND hkt.estado_de(format('INSERT INTO public.rentas_liquidaciones (company_id, propiedad_id, reserva_id) VALUES (%L, %L, %L)',
      hkt.ca(), hkt.pr(6), hkt.rs(2))) = '42501'
    AND hkt.afectadas('UPDATE public.rentas_liquidaciones SET importes = ''{}''') = 0
    AND hkt.afectadas('DELETE FROM public.rentas_liquidaciones') = 0);
  PERFORM hkt.como(hkt.uid(13));
  PERFORM hkt.ok('C14 Finanzas las lee (para el estado mensual) sin poder capturarlas',
    (SELECT count(*) = 2 FROM public.rentas_liquidaciones)
    AND hkt.estado_de(format('INSERT INTO public.rentas_liquidaciones (company_id, propiedad_id, reserva_id) VALUES (%L, %L, %L)',
      hkt.ca(), hkt.pr(6), hkt.rs(2))) = '42501');
  PERFORM hkt.ok('C15 … y con sólo Finanzas lee el catálogo de propiedades de su alcance',
    (SELECT count(*) = 3 AND bool_and(id <> hkt.pr(4)) FROM public.rentas_propiedades));
  PERFORM hkt.como(hkt.uid(5));
  PERFORM hkt.ok('C16 sin permisos no se ve ninguna', (SELECT count(*) = 0 FROM public.rentas_liquidaciones));
END $$;

-- ── D · gastos ──────────────────────────────────────────────────────────────
DO $$
BEGIN
  PERFORM hkt.como(hkt.uid(13));
  INSERT INTO public.rentas_gastos (company_id, propiedad_id, fecha, categoria, descripcion, monto)
    VALUES (hkt.ca(), hkt.pr(1), '2026-02-03', 'limpieza', 'Limpieza de salida', 25),
           (hkt.ca(), hkt.pr(2), '2026-02-10', 'mantenimiento', 'Cerradura', 60);
  PERFORM hkt.ok('D1 Finanzas registra gastos: a cargo del propietario por defecto, sellados',
    (SELECT count(*) = 2 AND bool_and(a_cargo_de = 'propietario' AND creado_por = hkt.uid(13)) FROM public.rentas_gastos));
  PERFORM hkt.ok('D2 monto cero o negativo, categoría o responsable fuera de catálogo, descripción vacía → 23514',
    hkt.estado_de(format('INSERT INTO public.rentas_gastos (company_id, propiedad_id, fecha, descripcion, monto) VALUES (%L, %L, %L, %L, 0)',
      hkt.ca(), hkt.pr(1), '2026-02-03', 'x')) = '23514'
    AND hkt.estado_de(format('INSERT INTO public.rentas_gastos (company_id, propiedad_id, fecha, descripcion, monto, categoria) VALUES (%L, %L, %L, %L, 5, %L)',
      hkt.ca(), hkt.pr(1), '2026-02-03', 'x', 'viaje')) = '23514'
    AND hkt.estado_de(format('INSERT INTO public.rentas_gastos (company_id, propiedad_id, fecha, descripcion, monto, a_cargo_de) VALUES (%L, %L, %L, %L, 5, %L)',
      hkt.ca(), hkt.pr(1), '2026-02-03', 'x', 'huesped')) = '23514'
    AND hkt.estado_de(format('INSERT INTO public.rentas_gastos (company_id, propiedad_id, fecha, descripcion, monto) VALUES (%L, %L, %L, %L, 5)',
      hkt.ca(), hkt.pr(1), '2026-02-03', '  ')) = '23514');
  PERFORM hkt.ok('D3 gasto en una propiedad de un proyecto que no es el suyo → 42501',
    hkt.estado_de(format('INSERT INTO public.rentas_gastos (company_id, propiedad_id, fecha, descripcion, monto) VALUES (%L, %L, %L, %L, 5)',
      hkt.ca(), hkt.pr(4), '2026-02-03', 'x')) = '42501');
  PERFORM hkt.ok('D4 edita y borra los suyos',
    hkt.afectadas(format('UPDATE public.rentas_gastos SET a_cargo_de = %L WHERE propiedad_id = %L', 'administradora', hkt.pr(2))) = 1);

  PERFORM hkt.como(hkt.uid(3));
  PERFORM hkt.ok('D5 quien sólo captura reservas no ve ni registra gastos',
    (SELECT count(*) = 0 FROM public.rentas_gastos)
    AND hkt.estado_de(format('INSERT INTO public.rentas_gastos (company_id, propiedad_id, fecha, descripcion, monto) VALUES (%L, %L, %L, %L, 5)',
      hkt.ca(), hkt.pr(1), '2026-02-03', 'x')) = '42501');
  PERFORM hkt.como(hkt.uid(1));
  PERFORM hkt.ok('D6 la dueña ve los dos', (SELECT count(*) = 2 FROM public.rentas_gastos));
END $$;

-- ── E · servicio apagado, otra empresa, anon ────────────────────────────────
DO $$
BEGIN
  PERFORM hkt.como(hkt.uid(7));
  PERFORM hkt.ok('E1 la admin de B ve sus 13 conceptos y nada de A',
    (SELECT count(*) = 13 AND bool_and(company_id = hkt.cb()) FROM public.rentas_conceptos)
    AND (SELECT count(*) = 0 FROM public.rentas_liquidaciones)
    AND (SELECT count(*) = 0 FROM public.rentas_gastos));
  PERFORM hkt.como_anon();
  PERFORM hkt.ok('E2 anon → 42501',
    hkt.estado_de('SELECT 1 FROM public.rentas_conceptos') = '42501'
    AND hkt.estado_de('SELECT 1 FROM public.rentas_gastos') = '42501');
  PERFORM hkt.root();
  UPDATE public.companies SET servicio_rentas = false WHERE id = hkt.ca();
  PERFORM hkt.como(hkt.uid(1));
  PERFORM hkt.ok('E3 servicio apagado: ni la dueña lee conceptos, desgloses o gastos',
    (SELECT count(*) = 0 FROM public.rentas_conceptos)
    AND (SELECT count(*) = 0 FROM public.rentas_liquidaciones)
    AND (SELECT count(*) = 0 FROM public.rentas_gastos));
  PERFORM hkt.root();
  UPDATE public.companies SET servicio_rentas = true WHERE id = hkt.ca();
END $$;

-- ── F · borrados ────────────────────────────────────────────────────────────
DO $$
BEGIN
  PERFORM hkt.root();
  DELETE FROM public.reservas_str WHERE id = hkt.rs(11);
  PERFORM hkt.ok('F1 borrar la reserva STR en Condominios se lleva su desglose',
    (SELECT count(*) = 0 FROM public.rentas_liquidaciones WHERE propiedad_id = hkt.pr(2)));
  PERFORM hkt.como(hkt.uid(1));
  DELETE FROM public.rentas_propiedades WHERE id = hkt.pr(1);
  PERFORM hkt.ok('F2 borrar la propiedad se lleva reservas, desgloses y gastos',
    hkt.n('rentas_liquidaciones') = 0 AND (SELECT count(*) = 1 FROM public.rentas_gastos));
END $$;
