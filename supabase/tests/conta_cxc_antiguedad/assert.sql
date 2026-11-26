\set ON_ERROR_STOP on
-- Invariantes de 20261231000000 (conta_cxc_antiguedad).
-- Padrón: el de fail_open_sin_perfil. Empresa D, proyecto D1, unidad UNI_D1 y su
-- residente CLI_D. OPE_D lleva el rol «Finanzas / Contador» (asignado a D1).

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

-- Una póliza PUBLICADA en la cuenta por cobrar del residente, como las deja el motor.
CREATE OR REPLACE FUNCTION fos.poliza(
  p_n bigint, p_fecha date, p_tabla text, p_origen uuid, p_evento text, p_debe numeric, p_haber numeric,
  p_unidad uuid, p_reversa uuid DEFAULT NULL
) RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE v uuid; v_cxc uuid; v_otra uuid;
BEGIN
  SELECT id INTO v_cxc  FROM public.conta_cuentas WHERE company_id = fos.id('D') AND project_id = fos.id('D1') AND tipo = 'activo'  AND es_detalle AND activa AND moneda IS NULL ORDER BY codigo DESC LIMIT 1;
  SELECT id INTO v_otra FROM public.conta_cuentas WHERE company_id = fos.id('D') AND project_id = fos.id('D1') AND tipo = 'ingreso' AND es_detalle AND activa ORDER BY codigo LIMIT 1;
  PERFORM set_config('conta.allow_system_write', 'on', true);
  INSERT INTO public.conta_asientos (company_id, project_id, numero, fecha, tipo, concepto, estado, origen,
                                     origen_tabla, origen_id, origen_evento, moneda_base, total_debe, total_haber,
                                     reversa_de_id, publicado_at)
  VALUES (fos.id('D'), fos.id('D1'), 9000 + p_n, p_fecha, 'diario', 'Prueba ' || p_evento, 'publicado', 'automatico',
          p_tabla, p_origen, p_evento, 'GTQ', p_debe + p_haber, p_debe + p_haber, p_reversa, now())
  RETURNING id INTO v;
  INSERT INTO public.conta_asiento_lineas (asiento_id, company_id, cuenta_id, orden, debe, haber, auxiliar_cliente_id, unidad_id, tipo_cargo)
  VALUES (v, fos.id('D'), v_cxc, 1, p_debe, p_haber, fos.id('CLI_D'), p_unidad, 'mantenimiento'),
         (v, fos.id('D'), v_otra, 2, p_haber, p_debe, NULL, NULL, NULL);
  PERFORM set_config('conta.allow_system_write', 'off', true);
  RETURN v;
END $$;

-- Una fila de la función, como texto comparable.
CREATE OR REPLACE FUNCTION fos.fila(p_actor text, p_corte date, p_unidad uuid) RETURNS text LANGUAGE sql AS $$
  SELECT fos.como(p_actor, format(
    $q$SELECT concat_ws('|', por_vencer, d1_30, d31_60, d61_90, d90_mas, sin_asignar, total, vencimiento_mas_antiguo)
         FROM public.conta_cxc_antiguedad(%L, %L) WHERE unidad_id IS NOT DISTINCT FROM %L$q$,
    fos.id('D1'), p_corte, p_unidad))
$$;

DO $$
DECLARE
  d uuid := fos.id('D'); d1 uuid := fos.id('D1'); uni uuid := fos.id('UNI_D1');
  cuota uuid := gen_random_uuid(); cargo uuid := gen_random_uuid(); mora uuid;
  r text; v_libros numeric; v_reporte numeric;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.conta_cuentas WHERE company_id = d AND project_id = d1) THEN
    r := fos.como('OWN_D', format($q$SELECT count(*)::text FROM public.conta_inicializar_catalogo('basico', %L)$q$, d1));
    IF r LIKE '!%' THEN RAISE EXCEPTION 'no se pudo sembrar el catálogo de D1: %', r; END IF;
  END IF;

  -- Los documentos con vencimiento propio (sin disparar su contabilidad: aquí se prueba el reporte, no el motor).
  ALTER TABLE public.cuotas_condominio DISABLE TRIGGER USER;
  ALTER TABLE public.cargos_adicionales_unidad DISABLE TRIGGER USER;
  INSERT INTO public.cuotas_condominio (id, company_id, project_id, unidad_id, monto, periodo, fecha_vencimiento)
    VALUES (cuota, d, d1, uni, 600, '2026-02', DATE '2026-02-15');
  INSERT INTO public.cargos_adicionales_unidad (id, company_id, project_id, unidad_id, concepto, monto, fecha_cargo, fecha_vencimiento)
    VALUES (cargo, d, d1, uni, 'Reparación', 200, DATE '2026-06-25', DATE '2026-07-15');
  ALTER TABLE public.cuotas_condominio ENABLE TRIGGER USER;
  ALTER TABLE public.cargos_adicionales_unidad ENABLE TRIGGER USER;

  -- A: cuota de febrero (vence 15-feb, aunque su póliza es del 1-feb)        600
  -- B: cuota de abril, sin vencimiento propio → fecha de la póliza (20-abr)  600
  -- C: mora (10-jun)                                                          30
  -- D: cargo adicional que vence el 15-jul                                   200
  -- cobro de 700 el 1-may
  PERFORM fos.poliza(1, DATE '2026-02-01', 'cuotas_condominio', cuota, 'cuota_emitida', 600, 0, uni);
  PERFORM fos.poliza(2, DATE '2026-04-20', 'cuotas_condominio', gen_random_uuid(), 'cuota_emitida', 600, 0, uni);
  mora := fos.poliza(3, DATE '2026-06-10', 'cuotas_condominio', gen_random_uuid(), 'cuota_mora', 30, 0, uni);
  PERFORM fos.poliza(4, DATE '2026-06-25', 'cargos_adicionales_unidad', cargo, 'cargo_adicional_emitido', 200, 0, uni);
  PERFORM fos.poliza(5, DATE '2026-05-01', 'pagos', gen_random_uuid(), 'pago_contabilizado', 0, 700, uni);

  -- ── 1 · PEPS al 30 de junio ───────────────────────────────────────────────
  -- 700 de abono: cubre A (600) y 100 de B → B queda en 500 (71 días: 61–90);
  -- C 30 (20 días: 1–30); D 200 (vence después: por vencer).
  r := fos.fila('OPE_D', DATE '2026-06-30', uni);
  IF r <> '200.00|30.00|0.00|500.00|0.00|0.00|730.00|2026-04-20' THEN RAISE EXCEPTION 'PEPS al 30-jun: %', r; END IF;
  RAISE NOTICE '✓ 1 · PEPS: el cobro cubre la cuota más antigua y parte de la siguiente; el resto cae en su tramo (por vencer 200 · 1–30: 30 · 61–90: 500 · total 730)';

  -- ── 2 · el vencimiento manda sobre la fecha de la póliza; el corte ignora lo posterior ──
  -- Al 30-abr no hay cobro: A vence 15-feb → 74 días (61–90); B del 20-abr → 10 días (1–30).
  r := fos.fila('OPE_D', DATE '2026-04-30', uni);
  IF r <> '0.00|600.00|0.00|600.00|0.00|0.00|1200.00|2026-02-15' THEN RAISE EXCEPTION 'corte 30-abr: %', r; END IF;
  -- Al 10-feb la cuota A ya está en libros (póliza del 1-feb) pero aún no vence.
  r := fos.fila('OPE_D', DATE '2026-02-10', uni);
  IF r <> '600.00|0.00|0.00|0.00|0.00|0.00|600.00|2026-02-15' THEN RAISE EXCEPTION 'corte 10-feb: %', r; END IF;
  RAISE NOTICE '✓ 2 · usa el vencimiento del documento (o la fecha de la póliza si no tiene) y un corte anterior ignora lo posterior';

  -- ── 3 · un reverso cuenta como abono ──────────────────────────────────────
  PERFORM fos.poliza(6, DATE '2026-06-20', 'cuotas_condominio', gen_random_uuid(), 'cuota_mora_revertido', 0, 30, uni, mora);
  r := fos.fila('OPE_D', DATE '2026-06-30', uni);
  IF r <> '200.00|30.00|0.00|470.00|0.00|0.00|700.00|2026-04-20' THEN RAISE EXCEPTION 'con reverso: %', r; END IF;
  RAISE NOTICE '✓ 3 · un reverso entra como abono: el total baja a 700 y sigue repartido sin residuo';

  -- ── 4 · más abonos que cargos: a la vista, no escondido en un tramo ───────
  -- Mismo residente SIN unidad: cargo de 100 y cobro de 150.
  PERFORM fos.poliza(7, DATE '2026-03-01', 'cuotas_condominio', gen_random_uuid(), 'cuota_emitida', 100, 0, NULL);
  PERFORM fos.poliza(8, DATE '2026-03-05', 'pagos', gen_random_uuid(), 'pago_contabilizado', 0, 150, NULL);
  r := fos.fila('OPE_D', DATE '2026-06-30', NULL);
  IF r <> '0.00|0.00|0.00|0.00|0.00|-50.00|-50.00' THEN RAISE EXCEPTION 'sobrepago: %', r; END IF;
  RAISE NOTICE '✓ 4 · más abonos que cargos: tramos en cero y −50 en «sin asignar» (total −50)';

  -- ── 5 · cuadra con los libros ─────────────────────────────────────────────
  SELECT sum(l.debe - l.haber) INTO v_libros
    FROM public.conta_ec_lineas(d, d1, NULL, NULL) l WHERE l.fecha <= DATE '2026-06-30';
  v_reporte := fos.como('OPE_D', format(
    'SELECT sum(total)::text FROM public.conta_cxc_antiguedad(%L, %L)', d1, DATE '2026-06-30'))::numeric;
  IF v_libros IS DISTINCT FROM v_reporte OR v_reporte <> 650 THEN
    RAISE EXCEPTION 'no cuadra con los libros: libros %, reporte %', v_libros, v_reporte; END IF;
  IF fos.como('OPE_D', format(
       'SELECT count(*)::text FROM public.conta_cxc_antiguedad(%L, %L) WHERE por_vencer + d1_30 + d31_60 + d61_90 + d90_mas + sin_asignar <> total',
       d1, DATE '2026-06-30')) <> '0' THEN
    RAISE EXCEPTION 'alguna fila no suma su total'; END IF;
  IF fos.como('OPE_D', format(
       $q$SELECT cliente_nombre || '|' || unidad_nombre FROM public.conta_cxc_antiguedad(%L, %L) WHERE unidad_id = %L$q$,
       d1, DATE '2026-06-30', uni)) <> 'Residente de D|Casa 1' THEN
    RAISE EXCEPTION 'la fila debe traer el nombre del residente y de la unidad'; END IF;
  RAISE NOTICE '✓ 5 · la suma del reporte (650) ES el saldo de la cuenta por cobrar en libros, y cada fila suma su total';

  -- ── 6 · quién lo ve ───────────────────────────────────────────────────────
  IF fos.como('VIS_D', format('SELECT count(*)::text FROM public.conta_cxc_antiguedad(%L, NULL)', d1)) NOT LIKE '!42501%'
     OR fos.como('SINAPP', format('SELECT count(*)::text FROM public.conta_cxc_antiguedad(%L, NULL)', d1)) NOT LIKE '!42501%'
     OR fos.como('CLI', format('SELECT count(*)::text FROM public.conta_cxc_antiguedad(%L, NULL)', d1)) NOT LIKE '!42501%'
     OR fos.como('OWN_C', format('SELECT count(*)::text FROM public.conta_cxc_antiguedad(%L, NULL)', d1)) NOT LIKE '!42501%'
     OR fos.como('OPE_D', format('SELECT count(*)::text FROM public.conta_cxc_antiguedad(%L, NULL)', fos.id('D2'))) NOT LIKE '!42501%' THEN
    RAISE EXCEPTION 'sin permiso de ver, sin perfil, cliente, otra empresa o proyecto sin alcance: 42501'; END IF;
  -- La contabilidad de la EMPRESA (sin proyecto) no ve los saldos del proyecto.
  IF fos.como('OWN_D', 'SELECT count(*)::text FROM public.conta_cxc_antiguedad(NULL, NULL)') <> '0' THEN
    RAISE EXCEPTION 'la contabilidad de la empresa no mezcla los saldos de un proyecto'; END IF;
  IF has_function_privilege('anon', 'public.conta_cxc_antiguedad(uuid,date)', 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'public.conta_cxc_antiguedad(uuid,date)', 'EXECUTE') THEN
    RAISE EXCEPTION 'ACL: anon sin EXECUTE, authenticated con EXECUTE'; END IF;
  RAISE NOTICE '✓ 6 · pide ver Contabilidad y alcance al proyecto; otra empresa, un cliente o anon no lo ven; cada contabilidad ve solo lo suyo';
END $$;
