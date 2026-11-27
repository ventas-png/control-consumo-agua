\set ON_ERROR_STOP on
-- Invariantes de 20261231000400 (conciliación en grupo, elección manual y saldo inicial del banco).
-- Padrón: el de fail_open_sin_perfil. Empresa D, proyecto D1. OPE_D lleva el rol
-- «Finanzas / Contador» (asignado a D1); VIS_D no tiene rol.

CREATE OR REPLACE FUNCTION fos.como(p_actor text, p_sql text) RETURNS text LANGUAGE plpgsql AS $$
DECLARE v text;
BEGIN
  PERFORM fos.poner_actor(p_actor);
  BEGIN
    EXECUTE p_sql INTO v;
  EXCEPTION WHEN OTHERS THEN
    v := '!' || SQLSTATE || ' ' || SQLERRM;
  END;
  PERFORM fos.poner_actor('SISTEMA');
  RETURN v;
END $$;
CREATE OR REPLACE FUNCTION fos.varios(p_actor text, p_mov uuid, VARIADIC p_docs uuid[]) RETURNS text LANGUAGE sql AS $$
  SELECT fos.como(p_actor, format('SELECT estado FROM public.banco_conciliar_varios(%L, %L::jsonb)', p_mov,
    (SELECT jsonb_agg(jsonb_build_object('id', x)) FROM unnest(p_docs) x)))
$$;
CREATE OR REPLACE FUNCTION fos.candidatos(p_actor text, p_mov uuid, p_buscar text DEFAULT NULL) RETURNS text LANGUAGE sql AS $$
  SELECT fos.como(p_actor, format(
    $q$SELECT COALESCE(string_agg(monto::text, ' ' ORDER BY monto), '-') FROM public.banco_candidatos_conciliacion(%L, %L)$q$, p_mov, p_buscar))
$$;

DO $$
DECLARE
  d uuid := fos.id('D'); d1 uuid := fos.id('D1'); d2 uuid := fos.id('D2'); cli uuid := fos.id('CLI_D');
  cta_cont uuid := gen_random_uuid(); cta uuid := gen_random_uuid();
  dep uuid := gen_random_uuid(); dep2 uuid := gen_random_uuid(); ret uuid := gen_random_uuid(); viejo uuid := gen_random_uuid();
  p1 uuid := gen_random_uuid(); p2 uuid := gen_random_uuid(); p3 uuid := gen_random_uuid(); p4 uuid := gen_random_uuid();
  pend uuid := gen_random_uuid(); ajeno uuid := gen_random_uuid();
  o1 uuid := gen_random_uuid(); o2 uuid := gen_random_uuid();
  r text; m public.banco_movimientos;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.conta_cuentas WHERE company_id = d AND project_id = d1) THEN
    r := fos.como('OWN_D', format($q$SELECT count(*)::text FROM public.conta_inicializar_catalogo('basico', %L)$q$, d1));
    IF r LIKE '!%' THEN RAISE EXCEPTION 'no se pudo sembrar el catálogo de D1: %', r; END IF;
  END IF;
  INSERT INTO public.conta_cuentas (id, company_id, project_id, codigo, nombre, tipo, naturaleza, nivel, es_detalle, activa)
    VALUES (cta_cont, d, d1, 'Z9-01', 'Banco de prueba', 'activo', 'deudora', 2, true, true);
  INSERT INTO public.cuentas_bancarias (id, company_id, project_id, nombre, banco, cuenta_contable_id)
    VALUES (cta, d, d1, 'Operativa', 'Banco de prueba', cta_cont);
  INSERT INTO public.banco_movimientos (id, company_id, project_id, cuenta_bancaria_id, fecha, descripcion, referencia, monto) VALUES
    (viejo, d, d1, cta, DATE '2026-05-20', 'Depósito anterior al saldo inicial', 'V-1', 900),
    (dep,   d, d1, cta, DATE '2026-06-10', 'Depósito del día',  'D-1', 1850),
    (dep2,  d, d1, cta, DATE '2026-06-12', 'Otro depósito',     'D-2', 600),
    (ret,   d, d1, cta, DATE '2026-06-15', 'Transferencia a proveedores', 'T-1', -700);

  -- Cobros y órdenes ya en firme. Aquí se prueba la conciliación, no cómo nacen: entran sin sus triggers.
  SET LOCAL session_replication_role = replica;
  INSERT INTO public.pagos (id, cliente_id, project_id, monto, metodo, referencia, estado, verified_at, created_at) VALUES
    (p1,    cli, d1, 600,  'deposito', 'B-101', 'verificado', TIMESTAMPTZ '2026-06-10 12:00+00', TIMESTAMPTZ '2026-06-10 12:00+00'),
    (p2,    cli, d1, 600,  'deposito', 'B-102', 'aplicado',   TIMESTAMPTZ '2026-06-10 12:00+00', TIMESTAMPTZ '2026-06-10 12:00+00'),
    (p3,    cli, d1, 650,  'deposito', 'B-103', 'verificado', TIMESTAMPTZ '2026-06-09 12:00+00', TIMESTAMPTZ '2026-06-09 12:00+00'),
    (p4,    cli, d1, 600,  'deposito', 'B-104', 'verificado', TIMESTAMPTZ '2026-06-12 12:00+00', TIMESTAMPTZ '2026-06-12 12:00+00'),
    (pend,  cli, d1, 75,   'deposito', 'B-105', 'pendiente',  NULL,                              TIMESTAMPTZ '2026-06-10 12:00+00'),
    (ajeno, cli, d2, 1850, 'deposito', 'B-106', 'verificado', TIMESTAMPTZ '2026-06-10 12:00+00', TIMESTAMPTZ '2026-06-10 12:00+00');
  INSERT INTO public.ordenes_pago (id, company_id, project_id, proveedor_id, factura_id, monto, fecha_pago, referencia, estado) VALUES
    (o1, d, d1, fos.id('PROV_D'), gen_random_uuid(), 300, DATE '2026-06-15', 'OP-1', 'pagada'),
    (o2, d, d1, fos.id('PROV_D'), gen_random_uuid(), 400, DATE '2026-06-15', 'OP-2', 'pagada');
  SET LOCAL session_replication_role = origin;

  -- ── 1 · candidatos: de la misma contabilidad, en firme y del signo del movimiento ──
  r := fos.candidatos('OPE_D', dep);
  IF r <> '600.00 600.00 600.00 650.00' THEN RAISE EXCEPTION 'candidatos del depósito: %', r; END IF;
  r := fos.candidatos('OPE_D', ret);
  IF r <> '300.00 400.00' THEN RAISE EXCEPTION 'candidatos del retiro: %', r; END IF;
  IF fos.candidatos('OPE_D', dep, 'B-103') <> '650.00' OR fos.candidatos('OPE_D', dep, 'no existe') <> '-' THEN
    RAISE EXCEPTION 'búsqueda de candidatos: % / %', fos.candidatos('OPE_D', dep, 'B-103'), fos.candidatos('OPE_D', dep, 'no existe'); END IF;
  IF fos.candidatos('OWN_C', dep) <> '-' THEN RAISE EXCEPTION 'otra empresa no ve candidatos: %', fos.candidatos('OWN_C', dep); END IF;
  RAISE NOTICE '✓ 1 · un depósito ofrece los cobros en firme de su contabilidad (no el pendiente ni el de otro proyecto); un retiro, las órdenes pagadas; se puede buscar; otra empresa no ve nada';

  -- ── 2 · la suma manda ─────────────────────────────────────────────────────
  r := fos.varios('OWN_D', dep, p1, p2);
  IF r NOT LIKE '!23514%suman 1200.00%1850.00%650.00%' THEN RAISE EXCEPTION 'suma que no cuadra: %', r; END IF;
  IF fos.varios('OWN_D', dep, p1, p2, pend) NOT LIKE '!23514%no está en firme%'
     OR fos.varios('OWN_D', dep, ajeno) NOT LIKE '!23514%otra contabilidad%'
     OR fos.varios('OWN_D', dep, o1, o2) NOT LIKE '!23514%'
     OR fos.como('OWN_D', format($q$SELECT estado FROM public.banco_conciliar_varios(%L, '[]'::jsonb)$q$, dep)) NOT LIKE '!22023%' THEN
    RAISE EXCEPTION 'documentos inválidos: alguno no se rechazó'; END IF;
  RAISE NOTICE '✓ 2 · rechaza la suma que no cuadra (dice cuánto falta), el cobro que no está en firme, el de otra contabilidad, órdenes para un depósito y la lista vacía';

  -- ── 3 · un depósito contra tres cobros ────────────────────────────────────
  r := fos.varios('OPE_D', dep, p1, p2, p3);
  IF r <> 'conciliado' THEN RAISE EXCEPTION 'depósito contra tres cobros: %', r; END IF;
  SELECT * INTO m FROM public.banco_movimientos WHERE id = dep;
  IF m.match_tipo <> 'pago' OR m.match_id NOT IN (p1, p2, p3) OR m.conciliado_at IS NULL
     OR (SELECT count(*) FROM public.banco_conciliacion_partidas WHERE movimiento_id = dep) <> 3
     OR (SELECT sum(monto) FROM public.banco_conciliacion_partidas WHERE movimiento_id = dep) <> 1850 THEN
    RAISE EXCEPTION 'el depósito debía quedar conciliado con sus tres partidas por 1,850'; END IF;
  -- ya no se ofrecen ni se sugieren
  IF fos.candidatos('OPE_D', dep2) <> '600.00' THEN RAISE EXCEPTION 'tras conciliar sólo debía ofrecerse p4: %', fos.candidatos('OPE_D', dep2); END IF;
  r := fos.como('OPE_D', format('SELECT string_agg(candidato_id::text, %L ORDER BY candidato_id) FROM public.banco_sugerencias_conciliacion(%L) WHERE movimiento_id = %L', ',', cta, dep2));
  IF r IS DISTINCT FROM p4::text THEN RAISE EXCEPTION 'la sugerencia para el depósito de 600 debía ser sólo p4 (p1 y p2 ya están en grupo): %', r; END IF;
  RAISE NOTICE '✓ 3 · un depósito de 1,850 se concilia contra tres cobros (600 + 600 + 650); esos cobros dejan de ofrecerse y de sugerirse para otros movimientos';

  -- ── 4 · un documento, una sola conciliación ───────────────────────────────
  IF fos.varios('OWN_D', dep2, p1) NOT LIKE '!23505%ya está conciliado%' THEN
    RAISE EXCEPTION 'un cobro ya conciliado en grupo no debía entrar a otro grupo: %', fos.varios('OWN_D', dep2, p1); END IF;
  r := fos.como('OWN_D', format($q$SELECT estado FROM public.banco_conciliar_movimiento(%L, 'pago', %L)$q$, dep2, p2));
  IF r NOT LIKE '!23505%' THEN RAISE EXCEPTION 'la conciliación uno-a-uno no debía tomar un cobro usado en grupo: %', r; END IF;
  IF fos.varios('OWN_D', dep, p4) NOT LIKE '!23514%pendiente%' THEN RAISE EXCEPTION 'un movimiento ya conciliado no se vuelve a conciliar'; END IF;
  -- elegir UN documento a mano también pasa por aquí
  IF fos.varios('OWN_D', dep2, p4) <> 'conciliado' THEN RAISE EXCEPTION 'elección manual de un documento'; END IF;
  RAISE NOTICE '✓ 4 · un cobro conciliado en grupo no entra a otro grupo ni a la conciliación uno-a-uno; elegir un solo documento a mano funciona igual';

  -- ── 5 · desconciliar libera todo el grupo ─────────────────────────────────
  r := fos.como('OWN_D', format('SELECT estado FROM public.banco_desconciliar_movimiento(%L)', dep));
  IF r <> 'pendiente' OR EXISTS (SELECT 1 FROM public.banco_conciliacion_partidas WHERE movimiento_id = dep) THEN
    RAISE EXCEPTION 'desconciliar debía soltar las tres partidas: %', r; END IF;
  IF fos.candidatos('OPE_D', dep) <> '600.00 600.00 650.00' THEN RAISE EXCEPTION 'tras desconciliar vuelven a ofrecerse: %', fos.candidatos('OPE_D', dep); END IF;
  RAISE NOTICE '✓ 5 · desconciliar el movimiento libera sus tres cobros, que vuelven a estar disponibles';

  -- ── 6 · un retiro contra dos órdenes de pago ──────────────────────────────
  r := fos.varios('OWN_D', ret, o1, o2);
  IF r <> 'conciliado'
     OR (SELECT count(*) FROM public.banco_conciliacion_partidas WHERE movimiento_id = ret AND match_tipo = 'orden_pago') <> 2 THEN
    RAISE EXCEPTION 'retiro contra dos órdenes: %', r; END IF;
  RAISE NOTICE '✓ 6 · un retiro de 700 se concilia contra dos órdenes de pago (300 + 400)';

  -- ── 7 · saldo inicial del banco ───────────────────────────────────────────
  -- Sin saldo inicial: el banco «empieza en cero» → 900 + 1,850 + 600 − 700 = 2,650.
  r := fos.como('OPE_D', format($q$SELECT saldo_banco::text FROM public.banco_estado_conciliacion(%L, '2026-06')$q$, cta));
  IF r <> '2650.00' THEN RAISE EXCEPTION 'saldo según banco sin saldo inicial: %', r; END IF;
  -- Con saldo inicial de 10,000 al 31-may: lo del 20-may ya está dentro → 10,000 + 1,850 + 600 − 700.
  UPDATE public.cuentas_bancarias SET saldo_inicial = 10000, saldo_inicial_fecha = DATE '2026-05-31' WHERE id = cta;
  r := fos.como('OPE_D', format($q$SELECT saldo_banco::text FROM public.banco_estado_conciliacion(%L, '2026-06')$q$, cta));
  IF r <> '11750.00' THEN RAISE EXCEPTION 'saldo según banco con saldo inicial: %', r; END IF;
  -- Un periodo anterior a la fecha del saldo inicial no lo incluye.
  r := fos.como('OPE_D', format($q$SELECT saldo_banco::text FROM public.banco_estado_conciliacion(%L, '2026-04')$q$, cta));
  IF r <> '0.00' THEN RAISE EXCEPTION 'antes del saldo inicial: %', r; END IF;
  RAISE NOTICE '✓ 7 · el saldo inicial (10,000 al 31-may) entra al «saldo según banco» de junio (11,750) y el movimiento anterior a esa fecha no se suma dos veces';

  -- ── 8 · permisos, RLS y ACL ───────────────────────────────────────────────
  IF fos.varios('VIS_D', dep, p1, p2, p3) NOT LIKE '!42501%' OR fos.varios('OWN_C', dep, p1, p2, p3) NOT LIKE '!42501%' THEN
    RAISE EXCEPTION 'sin permiso u otra empresa debía dar 42501'; END IF;
  IF fos.como('OWN_D', 'SELECT count(*)::text FROM public.banco_conciliacion_partidas') <> '3'
     OR fos.como('OWN_C', 'SELECT count(*)::text FROM public.banco_conciliacion_partidas') <> '0'
     OR fos.como('OWN_D', format($q$INSERT INTO public.banco_conciliacion_partidas (company_id, movimiento_id, match_tipo, match_id, monto) VALUES (%L, %L, 'pago', %L, 1) RETURNING id::text$q$, d, dep, p1)) NOT LIKE '!42501%' THEN
    RAISE EXCEPTION 'RLS de partidas: la empresa dueña lee; nadie escribe directo'; END IF;
  IF has_function_privilege('anon', 'public.banco_conciliar_varios(uuid, jsonb)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.banco_candidatos_conciliacion(uuid, text)', 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'public.banco_conciliar_varios(uuid, jsonb)', 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'public.banco_candidatos_conciliacion(uuid, text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'ACL: anon no ejecuta, authenticated sí'; END IF;
  RAISE NOTICE '✓ 8 · sin «cambiar estado» u otra empresa: 42501; las partidas se leen por empresa y sólo se escriben por la función; anon no ejecuta';
END $$;
