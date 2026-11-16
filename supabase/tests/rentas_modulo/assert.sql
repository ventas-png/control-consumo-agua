-- ════════════════════════════════════════════════════════════════════════════
-- Invariantes de 20261125000000_rentas_modulo, ejercidas COMO cada persona
-- (JWT emulado + rol authenticated/anon).
--   A · catálogo: 16 claves RBAC, RLS activa, ACL de tablas y funciones
--   B · propiedades: alta independiente y enlazada, coherencia del enlace, una
--       propiedad por unidad, alcance por proyecto, solo-ver, sin permiso, otra empresa
--   C · reservas: sólo corto plazo e independientes, fechas, empresa de la propiedad
--   D · contratos: no en corto plazo, un solo vigente, fechas y día de pago
--   E · inventario: la inventarista escribe sin ver propiedades, alcance por proyecto,
--       no borra, no toca reservas; cantidades y catálogos
--   F · borrados: la propiedad arrastra a sus hijas; borrar la unidad la deja independiente
--   G · servicio apagado, sin perfil, anon, otra empresa
--   H · sello creado_por y updated_at
-- ════════════════════════════════════════════════════════════════════════════
\set ON_ERROR_STOP on
\i ../housekeeping_evidencias/lib.sql

CREATE OR REPLACE FUNCTION hkt.n(p_tabla text) RETURNS int LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE v int; BEGIN EXECUTE format('SELECT count(*)::int FROM public.%I', p_tabla) INTO v; RETURN v; END $$;
CREATE OR REPLACE FUNCTION hkt.prop(p_id uuid) RETURNS public.rentas_propiedades LANGUAGE sql SECURITY DEFINER AS
  $$ SELECT * FROM public.rentas_propiedades WHERE id = p_id $$;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA hkt TO anon, authenticated, service_role;

-- La empresa A contrata el servicio; la B no (hasta el bloque G).
SELECT hkt.root();
UPDATE public.companies SET servicio_rentas = (id = hkt.ca());

-- ── A · catálogo ────────────────────────────────────────────────────────────
DO $$
BEGIN
  PERFORM hkt.ok('A1 16 claves rentas.* en el catálogo RBAC, todas de la categoría rentas',
    (SELECT count(*) = 16 AND bool_and(category = 'rentas') FROM public.permissions WHERE key LIKE 'rentas.%'));
  PERFORM hkt.ok('A2 el Administrador General recibe las 16',
    (SELECT count(*) = 16 FROM public.role_permissions
      WHERE role_id = '00000000-0000-0000-0000-000000000001' AND permission_key LIKE 'rentas.%' AND effect = 'allow'));
  PERFORM hkt.ok('A3 las cuatro tablas con RLS y 4 policies cada una',
    (SELECT count(*) = 4 AND bool_and(relrowsecurity) FROM pg_class
      WHERE relnamespace = 'public'::regnamespace AND relname LIKE 'rentas\_%' AND relkind = 'r')
    AND (SELECT count(*) = 16 FROM pg_policies WHERE tablename LIKE 'rentas\_%'));
  PERFORM hkt.ok('A4 anon no tiene ningún privilegio sobre las tablas',
    NOT has_table_privilege('anon', 'public.rentas_propiedades', 'SELECT')
    AND NOT has_table_privilege('anon', 'public.rentas_reservas', 'INSERT')
    AND NOT has_table_privilege('anon', 'public.rentas_contratos', 'UPDATE')
    AND NOT has_table_privilege('anon', 'public.rentas_inventario', 'DELETE'));
  PERFORM hkt.ok('A5 funciones: las de RLS, sólo authenticated; las de trigger, nadie por la API',
    has_function_privilege('authenticated', 'public.rentas_servicio_activo()', 'EXECUTE')
    AND NOT has_function_privilege('anon', 'public.rentas_servicio_activo()', 'EXECUTE')
    AND has_function_privilege('authenticated', 'public.rentas_propiedad_accesible(uuid)', 'EXECUTE')
    AND NOT has_function_privilege('anon', 'public.rentas_propiedad_accesible(uuid)', 'EXECUTE')
    AND NOT has_function_privilege('authenticated', 'public.rentas_propiedad_coherente()', 'EXECUTE')
    AND NOT has_function_privilege('authenticated', 'public.rentas_hija_coherente()', 'EXECUTE'));
  PERFORM hkt.ok('A6 el servicio nace apagado', (SELECT column_default = 'false' AND is_nullable = 'NO'
    FROM information_schema.columns WHERE table_name = 'companies' AND column_name = 'servicio_rentas'));
END $$;

-- ── B · propiedades ─────────────────────────────────────────────────────────
DO $$
DECLARE p public.rentas_propiedades;
BEGIN
  PERFORM hkt.como(hkt.uid(3));
  INSERT INTO public.rentas_propiedades (id, company_id, nombre, tipo_renta, tarifa_base)
    VALUES (hkt.pr(1), hkt.ca(), '  Casa Lago  ', 'corto_plazo', 850);
  p := hkt.prop(hkt.pr(1));
  PERFORM hkt.ok('B1 alta independiente: nombre recortado, activa, creado_por sellado',
    p.nombre = 'Casa Lago' AND p.estado = 'activa' AND p.project_id IS NULL AND p.creado_por = hkt.uid(3));
  INSERT INTO public.rentas_propiedades (id, company_id, project_id, unidad_id, nombre, tipo_renta)
    VALUES (hkt.pr(2), hkt.ca(), hkt.pa1(), hkt.un(1), 'Apto 1A', 'corto_plazo');
  PERFORM hkt.ok('B2 alta enlazada a una unidad de su proyecto', (hkt.prop(hkt.pr(2))).unidad_id = hkt.un(1));
  INSERT INTO public.rentas_propiedades (id, company_id, nombre, tipo_renta) VALUES
    (hkt.pr(3), hkt.ca(), 'Apto Zona 10', 'largo_plazo'),
    (hkt.pr(5), hkt.ca(), 'Local Centro', 'local_comercial');
  PERFORM hkt.ok('B3 unidad de OTRO proyecto de la misma empresa → RENTAS_UNIDAD_AJENA',
    hkt.mensaje_de(format('INSERT INTO public.rentas_propiedades (company_id, project_id, unidad_id, nombre) VALUES (%L, %L, %L, %L)',
      hkt.ca(), hkt.pa1(), hkt.un(3), 'x')) LIKE 'RENTAS_UNIDAD_AJENA%');
  PERFORM hkt.ok('B4 segunda propiedad sobre la misma unidad → 23505',
    hkt.estado_de(format('INSERT INTO public.rentas_propiedades (company_id, project_id, unidad_id, nombre) VALUES (%L, %L, %L, %L)',
      hkt.ca(), hkt.pa1(), hkt.un(1), 'dup')) = '23505');
  PERFORM hkt.ok('B5 unidad sin proyecto → 23514',
    hkt.estado_de(format('INSERT INTO public.rentas_propiedades (company_id, unidad_id, nombre) VALUES (%L, %L, %L)',
      hkt.ca(), hkt.un(2), 'x')) = '23514');
  PERFORM hkt.ok('B6 operadora de PA1 enlazando a PA2 → 42501',
    hkt.estado_de(format('INSERT INTO public.rentas_propiedades (company_id, project_id, unidad_id, nombre) VALUES (%L, %L, %L, %L)',
      hkt.ca(), hkt.pa2(), hkt.un(3), 'x')) = '42501');
  PERFORM hkt.ok('B7 alta a nombre de OTRA empresa → 42501',
    hkt.estado_de(format('INSERT INTO public.rentas_propiedades (company_id, nombre) VALUES (%L, %L)', hkt.cb(), 'x')) = '42501');
  PERFORM hkt.ok('B8 tipo y estado fuera de catálogo, nombre vacío → 23514',
    hkt.estado_de(format('INSERT INTO public.rentas_propiedades (company_id, nombre, tipo_renta) VALUES (%L, %L, %L)', hkt.ca(), 'x', 'hotel')) = '23514'
    AND hkt.estado_de(format('INSERT INTO public.rentas_propiedades (company_id, nombre, estado) VALUES (%L, %L, %L)', hkt.ca(), 'x', 'ocupada')) = '23514'
    AND hkt.estado_de(format('INSERT INTO public.rentas_propiedades (company_id, nombre) VALUES (%L, %L)', hkt.ca(), '   ')) = '23514');

  PERFORM hkt.como(hkt.uid(4));
  INSERT INTO public.rentas_propiedades (id, company_id, project_id, unidad_id, nombre, tipo_renta)
    VALUES (hkt.pr(4), hkt.ca(), hkt.pa2(), hkt.un(3), 'Casa 3', 'corto_plazo');
  PERFORM hkt.ok('B9 la operadora de PA2 ve las independientes y la de PA2, no la de PA1',
    (SELECT count(*) = 4 AND bool_and(id <> hkt.pr(2)) FROM public.rentas_propiedades));
  PERFORM hkt.ok('B10 … y no edita ni borra la de PA1',
    hkt.afectadas(format('UPDATE public.rentas_propiedades SET notas = %L WHERE id = %L', 'x', hkt.pr(2))) = 0
    AND hkt.afectadas(format('DELETE FROM public.rentas_propiedades WHERE id = %L', hkt.pr(2))) = 0);
  PERFORM hkt.como(hkt.uid(3));
  PERFORM hkt.ok('B11 la de PA1 ve las independientes y la de PA1, no la de PA2',
    (SELECT count(*) = 4 AND bool_and(id <> hkt.pr(4)) FROM public.rentas_propiedades));

  PERFORM hkt.como(hkt.uid(1));
  PERFORM hkt.ok('B12 la dueña ve las cinco', (SELECT count(*) = 5 FROM public.rentas_propiedades));
  PERFORM hkt.ok('B13 proyecto de OTRA empresa → RENTAS_PROYECTO_AJENO',
    hkt.mensaje_de(format('INSERT INTO public.rentas_propiedades (company_id, project_id, nombre) VALUES (%L, %L, %L)',
      hkt.ca(), hkt.pb1(), 'x')) LIKE 'RENTAS_PROYECTO_AJENO%');
  PERFORM hkt.como(hkt.uid(2));
  PERFORM hkt.ok('B14 admin acotado a PA1: independientes + PA1',
    (SELECT count(*) = 4 AND bool_and(id <> hkt.pr(4)) FROM public.rentas_propiedades));

  PERFORM hkt.como(hkt.uid(6));
  PERFORM hkt.ok('B15 solo-ver: lee, no crea, no edita, no borra',
    (SELECT count(*) = 4 FROM public.rentas_propiedades)
    AND hkt.estado_de(format('INSERT INTO public.rentas_propiedades (company_id, nombre) VALUES (%L, %L)', hkt.ca(), 'x')) = '42501'
    AND hkt.afectadas(format('UPDATE public.rentas_propiedades SET notas = %L WHERE id = %L', 'x', hkt.pr(1))) = 0
    AND hkt.afectadas(format('DELETE FROM public.rentas_propiedades WHERE id = %L', hkt.pr(1))) = 0);
  PERFORM hkt.como(hkt.uid(5));
  PERFORM hkt.ok('B16 sin permiso de Rentas: no ve ni crea',
    (SELECT count(*) = 0 FROM public.rentas_propiedades)
    AND hkt.estado_de(format('INSERT INTO public.rentas_propiedades (company_id, nombre) VALUES (%L, %L)', hkt.ca(), 'x')) = '42501');
  PERFORM hkt.como(hkt.uid(8));
  PERFORM hkt.ok('B17 un residente (cliente) no ve ni crea',
    (SELECT count(*) = 0 FROM public.rentas_propiedades)
    AND hkt.estado_de(format('INSERT INTO public.rentas_propiedades (company_id, nombre) VALUES (%L, %L)', hkt.ca(), 'x')) = '42501');

  PERFORM hkt.root();
  PERFORM hkt.ok('B18 una propiedad no cambia de empresa (ni fuera de la API)',
    hkt.mensaje_de(format('UPDATE public.rentas_propiedades SET company_id = %L WHERE id = %L', hkt.cb(), hkt.pr(1))) LIKE 'RENTAS_EMPRESA_INMUTABLE%');
END $$;

-- ── C · reservas ────────────────────────────────────────────────────────────
DO $$
DECLARE q constant text := 'INSERT INTO public.rentas_reservas (company_id, propiedad_id, huesped_nombre, fecha_entrada, fecha_salida) VALUES (%L, %L, %L, %L, %L)';
BEGIN
  PERFORM hkt.como(hkt.uid(3));
  INSERT INTO public.rentas_reservas (company_id, propiedad_id, huesped_nombre, fecha_entrada, fecha_salida, monto_noche, monto_total)
    VALUES (hkt.ca(), hkt.pr(1), 'Ana Pérez', '2026-12-10', '2026-12-13', 850, 2550);
  PERFORM hkt.ok('C1 reserva en una propiedad independiente de corto plazo',
    (SELECT count(*) = 1 AND bool_and(estado = 'confirmada' AND plataforma = 'directo' AND creado_por = hkt.uid(3)) FROM public.rentas_reservas));
  PERFORM hkt.ok('C2 en una propiedad ENLAZADA → RENTAS_RESERVA_ENLAZADA (van en reservas_str)',
    hkt.mensaje_de(format(q, hkt.ca(), hkt.pr(2), 'x', '2026-12-10', '2026-12-13')) LIKE 'RENTAS_RESERVA_ENLAZADA%');
  PERFORM hkt.ok('C3 en una de largo plazo → RENTAS_RESERVA_TIPO',
    hkt.mensaje_de(format(q, hkt.ca(), hkt.pr(3), 'x', '2026-12-10', '2026-12-13')) LIKE 'RENTAS_RESERVA_TIPO%');
  PERFORM hkt.ok('C4 salida no posterior a la entrada → 23514',
    hkt.estado_de(format(q, hkt.ca(), hkt.pr(1), 'x', '2026-12-13', '2026-12-13')) = '23514');
  PERFORM hkt.ok('C5 huésped vacío, plataforma o estado fuera de catálogo → 23514',
    hkt.estado_de(format(q, hkt.ca(), hkt.pr(1), '  ', '2026-12-10', '2026-12-13')) = '23514'
    AND hkt.estado_de(format('UPDATE public.rentas_reservas SET plataforma = %L', 'expedia')) = '23514'
    AND hkt.estado_de(format('UPDATE public.rentas_reservas SET estado = %L', 'pagada')) = '23514');
  PERFORM hkt.ok('C6 pasa a en curso y a completada',
    hkt.afectadas(format('UPDATE public.rentas_reservas SET estado = %L', 'en_curso')) = 1
    AND hkt.afectadas(format('UPDATE public.rentas_reservas SET estado = %L', 'completada')) = 1);
  PERFORM hkt.como(hkt.uid(4));
  PERFORM hkt.ok('C7 otra operadora de la empresa ve la reserva de la propiedad independiente',
    (SELECT count(*) = 1 FROM public.rentas_reservas));
  PERFORM hkt.como(hkt.uid(6));
  PERFORM hkt.ok('C8 solo-ver: lee, no crea ni edita',
    (SELECT count(*) = 1 FROM public.rentas_reservas)
    AND hkt.estado_de(format(q, hkt.ca(), hkt.pr(1), 'x', '2027-01-10', '2027-01-13')) = '42501'
    AND hkt.afectadas(format('UPDATE public.rentas_reservas SET notas = %L', 'x')) = 0);
  PERFORM hkt.root();
  PERFORM hkt.ok('C9 una reserva no cuelga de la propiedad de otra empresa (ni fuera de la API)',
    hkt.mensaje_de(format(q, hkt.cb(), hkt.pr(1), 'x', '2027-01-10', '2027-01-13')) LIKE 'RENTAS_PROPIEDAD_AJENA%');
END $$;

-- ── D · contratos ───────────────────────────────────────────────────────────
DO $$
DECLARE q constant text := 'INSERT INTO public.rentas_contratos (company_id, propiedad_id, inquilino_nombre, fecha_inicio, fecha_fin, renta_mensual, dia_pago) VALUES (%L, %L, %L, %L, %L, %s, %s)';
BEGIN
  PERFORM hkt.como(hkt.uid(3));
  EXECUTE format(q, hkt.ca(), hkt.pr(3), 'Luis Gómez', '2026-01-01', '2026-12-31', 4500, 5);
  PERFORM hkt.ok('D1 contrato vigente en una propiedad de largo plazo',
    (SELECT count(*) = 1 AND bool_and(estado = 'vigente') FROM public.rentas_contratos));
  PERFORM hkt.ok('D2 segundo contrato VIGENTE en la misma propiedad → 23505',
    hkt.estado_de(format(q, hkt.ca(), hkt.pr(3), 'Otro', '2027-01-01', '2027-12-31', 4800, 5)) = '23505');
  UPDATE public.rentas_contratos SET estado = 'finalizado' WHERE propiedad_id = hkt.pr(3);
  EXECUTE format(q, hkt.ca(), hkt.pr(3), 'Marta Ruiz', '2027-01-01', '2027-12-31', 4800, 1);
  PERFORM hkt.ok('D3 al finalizar el primero, la propiedad admite un contrato nuevo',
    (SELECT count(*) = 2 AND count(*) FILTER (WHERE estado = 'vigente') = 1 FROM public.rentas_contratos));
  PERFORM hkt.ok('D4 en una de corto plazo → RENTAS_CONTRATO_TIPO',
    hkt.mensaje_de(format(q, hkt.ca(), hkt.pr(1), 'x', '2027-01-01', '2027-12-31', 100, 1)) LIKE 'RENTAS_CONTRATO_TIPO%');
  EXECUTE 'INSERT INTO public.rentas_contratos (company_id, propiedad_id, inquilino_nombre, fecha_inicio, renta_mensual) VALUES ($1, $2, $3, $4, $5)'
    USING hkt.ca(), hkt.pr(5), 'Café Central', '2026-03-01'::date, 9000::numeric;
  PERFORM hkt.ok('D5 local comercial con plazo indefinido (sin fecha de fin)',
    (SELECT count(*) = 1 FROM public.rentas_contratos WHERE propiedad_id = hkt.pr(5) AND fecha_fin IS NULL));
  PERFORM hkt.ok('D6 fin no posterior al inicio, día de pago 32, renta negativa → 23514',
    hkt.estado_de(format('UPDATE public.rentas_contratos SET fecha_fin = %L WHERE propiedad_id = %L', '2026-03-01', hkt.pr(5))) = '23514'
    AND hkt.estado_de(format('UPDATE public.rentas_contratos SET dia_pago = 32 WHERE propiedad_id = %L', hkt.pr(5))) = '23514'
    AND hkt.estado_de(format('UPDATE public.rentas_contratos SET renta_mensual = -1 WHERE propiedad_id = %L', hkt.pr(5))) = '23514');
END $$;

-- ── E · inventario ──────────────────────────────────────────────────────────
DO $$
DECLARE q constant text := 'INSERT INTO public.rentas_inventario (company_id, propiedad_id, nombre, categoria, cantidad, valor_unitario) VALUES (%L, %L, %L, %L, %s, %s)';
BEGIN
  PERFORM hkt.como(hkt.uid(13));
  EXECUTE format(q, hkt.ca(), hkt.pr(1), 'Sofá 3 plazas', 'mobiliario', 1, 3200);
  EXECUTE format(q, hkt.ca(), hkt.pr(2), 'Juego de sábanas', 'blancos', 4, 180);
  PERFORM hkt.ok('E1 la inventarista (asignada a PA1) registra en una independiente y en la de PA1',
    (SELECT count(*) = 2 AND bool_and(estado = 'bueno' AND creado_por = hkt.uid(13)) FROM public.rentas_inventario));
  PERFORM hkt.ok('E2 … no en la de PA2 → 42501',
    hkt.estado_de(format(q, hkt.ca(), hkt.pr(4), 'TV', 'electronica', 1, 2500)) = '42501');
  PERFORM hkt.ok('E3 … lee el catálogo de propiedades de su alcance (para saber de cuál es cada artículo), pero no lo escribe, ni ve reservas ni contratos',
    (SELECT count(*) = 4 AND bool_and(id <> hkt.pr(4)) FROM public.rentas_propiedades)
    AND hkt.estado_de(format('INSERT INTO public.rentas_propiedades (company_id, nombre) VALUES (%L, %L)', hkt.ca(), 'x')) = '42501'
    AND hkt.afectadas(format('UPDATE public.rentas_propiedades SET notas = %L', 'x')) = 0
    AND (SELECT count(*) = 0 FROM public.rentas_reservas)
    AND (SELECT count(*) = 0 FROM public.rentas_contratos));
  PERFORM hkt.ok('E4 … edita el estado, pero no borra (no tiene .delete)',
    hkt.afectadas(format('UPDATE public.rentas_inventario SET estado = %L WHERE propiedad_id = %L', 'danado', hkt.pr(2))) = 1
    AND hkt.afectadas('DELETE FROM public.rentas_inventario') = 0);
  PERFORM hkt.ok('E5 … y no crea reservas → 42501',
    hkt.estado_de(format('INSERT INTO public.rentas_reservas (company_id, propiedad_id, huesped_nombre, fecha_entrada, fecha_salida) VALUES (%L, %L, %L, %L, %L)',
      hkt.ca(), hkt.pr(1), 'x', '2027-02-01', '2027-02-03')) = '42501');
  PERFORM hkt.ok('E6 cantidad negativa, categoría o estado fuera de catálogo, nombre vacío → 23514',
    hkt.estado_de(format(q, hkt.ca(), hkt.pr(1), 'x', 'mobiliario', -1, 0)) = '23514'
    AND hkt.estado_de(format(q, hkt.ca(), hkt.pr(1), 'x', 'vehiculo', 1, 0)) = '23514'
    AND hkt.estado_de(format(q, hkt.ca(), hkt.pr(1), ' ', 'mobiliario', 1, 0)) = '23514'
    AND hkt.estado_de(format('UPDATE public.rentas_inventario SET estado = %L', 'perdido')) = '23514');
  PERFORM hkt.como(hkt.uid(4));
  EXECUTE format(q, hkt.ca(), hkt.pr(4), 'Refrigeradora', 'electrodomestico', 1, 6500);
  PERFORM hkt.ok('E7 la operadora de PA2 ve el inventario de las independientes y de PA2, no el de PA1',
    (SELECT count(*) = 2 AND bool_and(propiedad_id <> hkt.pr(2)) FROM public.rentas_inventario));
  PERFORM hkt.como(hkt.uid(13));
  PERFORM hkt.ok('E8 … y la inventarista no ve el de PA2',
    (SELECT count(*) = 2 AND bool_and(propiedad_id <> hkt.pr(4)) FROM public.rentas_inventario));
  PERFORM hkt.ok('E9 mover un artículo a una propiedad fuera de su alcance → 42501',
    hkt.estado_de(format('UPDATE public.rentas_inventario SET propiedad_id = %L WHERE propiedad_id = %L', hkt.pr(4), hkt.pr(1))) = '42501');
END $$;

-- ── H · sello y updated_at ──────────────────────────────────────────────────
DO $$
DECLARE antes timestamptz;
BEGIN
  PERFORM hkt.como(hkt.uid(4));
  SELECT updated_at INTO antes FROM public.rentas_propiedades WHERE id = hkt.pr(1);
  PERFORM pg_sleep(0.02);
  UPDATE public.rentas_propiedades SET notas = 'vista al lago', creado_por = hkt.uid(4) WHERE id = hkt.pr(1);
  PERFORM hkt.ok('H1 editar otra persona: updated_at avanza y creado_por no cambia',
    (hkt.prop(hkt.pr(1))).creado_por = hkt.uid(3) AND (hkt.prop(hkt.pr(1))).updated_at > antes
    AND (hkt.prop(hkt.pr(1))).notas = 'vista al lago');
END $$;

-- ── G · servicio apagado, sin perfil, anon, otra empresa ────────────────────
DO $$
BEGIN
  PERFORM hkt.como(hkt.uid(7));
  PERFORM hkt.ok('G1 admin de una empresa SIN el servicio: no ve nada ni crea',
    (SELECT count(*) = 0 FROM public.rentas_propiedades)
    AND hkt.estado_de(format('INSERT INTO public.rentas_propiedades (company_id, nombre) VALUES (%L, %L)', hkt.cb(), 'x')) = '42501');
  PERFORM hkt.root();
  UPDATE public.companies SET servicio_rentas = true WHERE id = hkt.cb();
  PERFORM hkt.como(hkt.uid(7));
  INSERT INTO public.rentas_propiedades (id, company_id, project_id, unidad_id, nombre) VALUES (hkt.pr(9), hkt.cb(), hkt.pb1(), hkt.un(9), 'Loft B');
  PERFORM hkt.ok('G2 al contratarlo crea la suya y sólo ve la suya',
    (SELECT count(*) = 1 AND bool_and(company_id = hkt.cb()) FROM public.rentas_propiedades)
    AND (SELECT count(*) = 0 FROM public.rentas_inventario) AND (SELECT count(*) = 0 FROM public.rentas_reservas));
  PERFORM hkt.ok('G3 … y no cuelga inventario de una propiedad de A (ni a su nombre ni al de A)',
    hkt.mensaje_de(format('INSERT INTO public.rentas_inventario (company_id, propiedad_id, nombre) VALUES (%L, %L, %L)', hkt.cb(), hkt.pr(1), 'x')) LIKE 'RENTAS_PROPIEDAD_AJENA%'
    AND hkt.estado_de(format('INSERT INTO public.rentas_inventario (company_id, propiedad_id, nombre) VALUES (%L, %L, %L)', hkt.ca(), hkt.pr(1), 'x')) = '42501');

  PERFORM hkt.root();
  UPDATE public.companies SET servicio_rentas = false WHERE id = hkt.ca();
  PERFORM hkt.como(hkt.uid(1));
  PERFORM hkt.ok('G4 servicio apagado en A: ni la dueña lee ni escribe (los datos siguen ahí)',
    (SELECT count(*) = 0 FROM public.rentas_propiedades)
    AND (SELECT count(*) = 0 FROM public.rentas_reservas)
    AND (SELECT count(*) = 0 FROM public.rentas_contratos)
    AND (SELECT count(*) = 0 FROM public.rentas_inventario)
    AND hkt.estado_de(format('INSERT INTO public.rentas_propiedades (company_id, nombre) VALUES (%L, %L)', hkt.ca(), 'x')) = '42501'
    AND hkt.afectadas('UPDATE public.rentas_inventario SET notas = ''x''') = 0
    AND hkt.afectadas('DELETE FROM public.rentas_propiedades') = 0
    AND hkt.n('rentas_propiedades') = 6);
  PERFORM hkt.root();
  UPDATE public.companies SET servicio_rentas = true WHERE id = hkt.ca();

  PERFORM hkt.como('c0000000-0000-0000-0000-00000000ffff'::uuid);
  PERFORM hkt.ok('G5 sesión sin perfil: no ve nada ni crea',
    (SELECT count(*) = 0 FROM public.rentas_propiedades) AND (SELECT count(*) = 0 FROM public.rentas_inventario)
    AND NOT public.rentas_servicio_activo()
    AND hkt.estado_de(format('INSERT INTO public.rentas_propiedades (company_id, nombre) VALUES (%L, %L)', hkt.ca(), 'x')) = '42501');
  PERFORM hkt.como_anon();
  PERFORM hkt.ok('G6 anon: sin acceso a las tablas',
    hkt.estado_de('SELECT 1 FROM public.rentas_propiedades') = '42501'
    AND hkt.estado_de('SELECT 1 FROM public.rentas_inventario') = '42501');
  PERFORM hkt.root();
END $$;

-- ── F · borrados ────────────────────────────────────────────────────────────
DO $$
BEGIN
  PERFORM hkt.root();
  DELETE FROM public.unidades WHERE id = hkt.un(1);
  PERFORM hkt.ok('F1 borrar la unidad deja la propiedad (y su inventario) sin enlace a la unidad',
    (hkt.prop(hkt.pr(2))).id IS NOT NULL AND (hkt.prop(hkt.pr(2))).unidad_id IS NULL
    AND (SELECT count(*) = 1 FROM public.rentas_inventario WHERE propiedad_id = hkt.pr(2)));
  PERFORM hkt.como(hkt.uid(3));
  DELETE FROM public.rentas_propiedades WHERE id = hkt.pr(1);
  PERFORM hkt.ok('F2 la operadora borra una propiedad y se van sus reservas e inventario',
    (hkt.prop(hkt.pr(1))).id IS NULL
    AND hkt.n('rentas_reservas') = 0
    AND (SELECT count(*) = 0 FROM public.rentas_inventario WHERE propiedad_id = hkt.pr(1)));
  PERFORM hkt.root();
  DELETE FROM public.companies WHERE id = hkt.cb();
  PERFORM hkt.ok('F3 purgar la empresa B se lleva sus propiedades; las de A quedan',
    (SELECT count(*) = 4 AND bool_and(company_id = hkt.ca()) FROM public.rentas_propiedades));
END $$;
