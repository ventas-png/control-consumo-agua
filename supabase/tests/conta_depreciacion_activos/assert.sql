\set ON_ERROR_STOP on
-- Invariantes de 20261231000100 (conta_depreciar_activos).
-- Padrón: el de fail_open_sin_perfil. Empresa D, proyecto D1. OPE_D lleva el rol
-- «Finanzas / Contador» (asignado a D1, no a D2); VIS_D no tiene rol.

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

-- La fila de un activo para un mes, como texto: acumulada_antes|depreciacion|valor_en_libros|previos|resultado
CREATE OR REPLACE FUNCTION fos.dep(p_actor text, p_periodo text, p_aplicar boolean, p_codigo text) RETURNS text LANGUAGE sql AS $$
  SELECT fos.como(p_actor, format(
    $q$SELECT concat_ws('|', acumulada_antes, depreciacion, valor_en_libros, meses_previos_sin_depreciar, resultado)
         FROM public.conta_depreciar_activos(%L, %L, %L) WHERE codigo = %L$q$,
    p_periodo, p_aplicar, fos.id('D1'), p_codigo))
$$;
CREATE OR REPLACE FUNCTION fos.polizas(p_activo uuid) RETURNS int LANGUAGE sql AS
$$ SELECT count(*)::int FROM public.conta_asientos WHERE origen_tabla = 'activos_fijos' AND origen_id = p_activo $$;

DO $$
DECLARE
  d uuid := fos.id('D'); d1 uuid := fos.id('D1');
  gasto uuid; acum uuid;
  a uuid := gen_random_uuid(); b uuid := gen_random_uuid(); c uuid := gen_random_uuid(); e uuid := gen_random_uuid();
  z uuid := gen_random_uuid();
  r text; x public.conta_asientos; m text; v_suma numeric; v_ultimo numeric;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.conta_cuentas WHERE company_id = d AND project_id = d1) THEN
    r := fos.como('OWN_D', format($q$SELECT count(*)::text FROM public.conta_inicializar_catalogo('basico', %L)$q$, d1));
    IF r LIKE '!%' THEN RAISE EXCEPTION 'no se pudo sembrar el catálogo de D1: %', r; END IF;
  END IF;
  SELECT id INTO gasto FROM public.conta_cuentas WHERE company_id = d AND project_id = d1 AND tipo = 'gasto'  AND es_detalle AND activa ORDER BY codigo LIMIT 1;
  SELECT id INTO acum  FROM public.conta_cuentas WHERE company_id = d AND project_id = d1 AND tipo = 'activo' AND es_detalle AND activa AND moneda IS NULL ORDER BY codigo DESC LIMIT 1;
  -- Sin cuentas especiales de depreciación en D1: el activo E, que no trae las suyas, no tiene de dónde tomarlas.
  DELETE FROM public.conta_mapeo_cuentas WHERE company_id = d AND project_id = d1 AND evento IN ('gasto_depreciacion', 'depreciacion_acumulada');

  INSERT INTO public.activos_fijos (id, company_id, project_id, codigo, nombre, fecha_alta, costo, valor_residual, vida_util_meses, cuenta_gasto_dep_id, cuenta_dep_acum_id, estado) VALUES
    (a, d, d1, 'AF-A', 'Bomba de agua',     DATE '2026-01-15', 1200, 0,   12, gasto, acum, 'activo'),
    (b, d, d1, 'AF-B', 'Generador',         DATE '2026-01-31', 1000, 100, 7,  gasto, acum, 'activo'),
    (c, d, d1, 'AF-C', 'Equipo retirado',   DATE '2026-01-10', 500,  0,   10, gasto, acum, 'dado_de_baja'),
    (e, d, d1, 'AF-E', 'Sin cuentas',       DATE '2026-01-10', 600,  0,   6,  NULL,  NULL, 'activo'),
    (z, d, d1, 'AF-Z', 'Sin nada que depreciar', DATE '2026-01-10', 300, 300, 6, gasto, acum, 'activo');

  -- ── 1 · previsualizar no asienta ──────────────────────────────────────────
  r := fos.dep('OPE_D', '2026-02', false, 'AF-A');
  IF r <> '0.00|100.00|1100.00|0|previsualizacion' THEN RAISE EXCEPTION 'vista previa de febrero: %', r; END IF;
  IF fos.dep('OPE_D', '2026-01', false, 'AF-A') <> '0.00|0|1200.00|0|no_iniciado' THEN
    RAISE EXCEPTION 'el mes del alta no se deprecia: %', fos.dep('OPE_D', '2026-01', false, 'AF-A'); END IF;
  IF fos.polizas(a) <> 0 THEN RAISE EXCEPTION 'previsualizar no debía asentar'; END IF;
  RAISE NOTICE '✓ 1 · previsualiza Q100 (1,200 / 12) para febrero; enero, el mes del alta, aún no se deprecia; nada se asentó';

  -- ── 2 · aplicar: una póliza por activo, cuadrada, al último día del mes; no duplica ──
  r := fos.dep('OPE_D', '2026-02', true, 'AF-A');
  IF r <> '0.00|100.00|1100.00|0|aplicado' THEN RAISE EXCEPTION 'aplicar febrero: %', r; END IF;
  SELECT * INTO x FROM public.conta_asientos WHERE origen_id = a AND origen_evento = 'depreciacion_2026-02';
  IF x.estado <> 'publicado' OR x.fecha <> DATE '2026-02-28' OR x.total_debe <> 100 OR x.total_haber <> 100
     OR x.project_id <> d1 OR x.numero IS NULL OR x.concepto NOT LIKE 'Depreciación 2026-02 · AF-A%' THEN
    RAISE EXCEPTION 'la póliza de febrero no es la esperada: % % % %', x.estado, x.fecha, x.total_debe, x.concepto; END IF;
  IF (SELECT cuenta_id FROM public.conta_asiento_lineas WHERE asiento_id = x.id AND debe = 100) <> gasto
     OR (SELECT cuenta_id FROM public.conta_asiento_lineas WHERE asiento_id = x.id AND haber = 100) <> acum THEN
    RAISE EXCEPTION 'debe = gasto por depreciación, haber = depreciación acumulada'; END IF;
  IF fos.dep('OPE_D', '2026-02', true, 'AF-A') <> '0.00|100.00|1100.00|0|ya_depreciado' OR fos.polizas(a) <> 1 THEN
    RAISE EXCEPTION 'repetir el mes no debía duplicar: %', fos.dep('OPE_D', '2026-02', true, 'AF-A'); END IF;
  -- la misma llamada depreció también el otro activo en regla, y sólo ése
  IF fos.polizas(b) <> 1 OR fos.polizas(c) <> 0 OR fos.polizas(e) <> 0 OR fos.polizas(z) <> 0 THEN
    RAISE EXCEPTION 'febrero debía dejar una póliza en A y B, y ninguna en el de baja, el sin cuentas y el sin depreciable'; END IF;
  RAISE NOTICE '✓ 2 · aplicar genera una póliza por activo (publicada, 100 = 100, fechada 28-feb, gasto contra acumulada) y repetir el mes no duplica';

  -- ── 3 · saltarse un mes se ve; la acumulada avanza ────────────────────────
  r := fos.dep('OPE_D', '2026-04', false, 'AF-A');
  IF r <> '100.00|100.00|1000.00|1|previsualizacion' THEN RAISE EXCEPTION 'abril sin haber depreciado marzo: %', r; END IF;
  RAISE NOTICE '✓ 3 · al depreciar abril sin marzo avisa 1 mes previo sin depreciar (acumulada 100, valor en libros 1,000)';

  -- ── 4 · el último mes lleva el resto: la acumulada cierra EXACTA ──────────
  -- B: 900 depreciables en 7 meses → 128.57 × 6 = 771.42 y el séptimo 128.58.
  FOREACH m IN ARRAY ARRAY['2026-03', '2026-04', '2026-05', '2026-06', '2026-07', '2026-08'] LOOP
    r := fos.dep('OPE_D', m, true, 'AF-B');
    IF r NOT LIKE '%|aplicado' THEN RAISE EXCEPTION 'B en %: %', m, r; END IF;
  END LOOP;
  SELECT sum(total_debe), max(total_debe) FILTER (WHERE origen_evento = 'depreciacion_2026-08') INTO v_suma, v_ultimo
    FROM public.conta_asientos WHERE origen_id = b AND estado = 'publicado';
  IF v_suma <> 900 OR v_ultimo <> 128.58 OR fos.polizas(b) <> 7 THEN
    RAISE EXCEPTION 'B debía cerrar en 900 con 7 pólizas y la última de 128.58: suma %, última %', v_suma, v_ultimo; END IF;
  IF fos.dep('OPE_D', '2026-09', true, 'AF-B') <> '900.00|0|100.00|0|totalmente_depreciado' OR fos.polizas(b) <> 7 THEN
    RAISE EXCEPTION 'tras su vida útil no se deprecia más: %', fos.dep('OPE_D', '2026-09', true, 'AF-B'); END IF;
  RAISE NOTICE '✓ 4 · 900 depreciables en 7 meses: seis de 128.57 y el último de 128.58; acumulada exacta 900, valor en libros = residual 100, y después nada';

  -- ── 5 · reversar la póliza de un mes ───────────────────────────────────────
  -- (Cada llamada deprecia TODOS los activos del mes: con las de arriba, A lleva feb–sep = 800.)
  IF fos.dep('OPE_D', '2026-10', false, 'AF-A') <> '800.00|100.00|300.00|0|previsualizacion' THEN
    RAISE EXCEPTION 'A antes del reverso: %', fos.dep('OPE_D', '2026-10', false, 'AF-A'); END IF;
  SELECT * INTO x FROM public.conta_asientos WHERE origen_id = a AND origen_evento = 'depreciacion_2026-02';
  r := fos.como('OPE_D', format('SELECT (public.conta_anular_asiento(%L, %L)).id::text', x.id, 'Vida útil mal capturada'));
  IF r LIKE '!%' THEN RAISE EXCEPTION 'no se pudo reversar la póliza de febrero: %', r; END IF;
  -- la acumulada baja (se lee de las pólizas vivas) y se avisa el mes que quedó sin depreciar
  IF fos.dep('OPE_D', '2026-10', false, 'AF-A') <> '700.00|100.00|400.00|1|previsualizacion' THEN
    RAISE EXCEPTION 'A tras el reverso: %', fos.dep('OPE_D', '2026-10', false, 'AF-A'); END IF;
  -- febrero no se vuelve a asentar: queda «reversado», sin error y sin póliza nueva
  SELECT count(*) INTO v_suma FROM public.conta_asientos WHERE origen_id = a;
  IF fos.dep('OPE_D', '2026-02', true, 'AF-A') <> '0.00|0|1200.00|0|reversado'
     OR (SELECT count(*) FROM public.conta_asientos WHERE origen_id = a) <> v_suma THEN
    RAISE EXCEPTION 'el mes reversado no se re-asienta: %', fos.dep('OPE_D', '2026-02', true, 'AF-A'); END IF;
  RAISE NOTICE '✓ 5 · reversar la póliza de un mes baja la acumulada (800 → 700) y ese mes queda «reversado»: no se re-asienta ni da error';

  -- ── 6 · lo que no se deprecia ─────────────────────────────────────────────
  IF fos.dep('OPE_D', '2026-02', true, 'AF-E') NOT LIKE '%|sin_cuentas' OR fos.polizas(e) <> 0 THEN
    RAISE EXCEPTION 'sin cuentas no se asienta: %', fos.dep('OPE_D', '2026-02', true, 'AF-E'); END IF;
  IF fos.como('OPE_D', format($q$SELECT motivo FROM public.conta_depreciar_activos('2026-02', false, %L) WHERE codigo = 'AF-E'$q$, d1))
       NOT LIKE 'Falta la cuenta de Gasto por depreciación y la de Depreciación acumulada%' THEN
    RAISE EXCEPTION 'el motivo debe decir qué cuentas faltan'; END IF;
  IF fos.dep('OPE_D', '2026-02', true, 'AF-C') IS NOT NULL THEN RAISE EXCEPTION 'un activo dado de baja no aparece'; END IF;
  IF fos.dep('OPE_D', '2026-02', true, 'AF-Z') NOT LIKE '%|sin_cambio' THEN RAISE EXCEPTION 'costo = residual: sin cambio'; END IF;
  -- con las cuentas especiales asignadas, el activo sin cuentas propias las toma de ahí
  INSERT INTO public.conta_mapeo_cuentas (company_id, project_id, evento, cuenta_id) VALUES
    (d, d1, 'gasto_depreciacion', gasto), (d, d1, 'depreciacion_acumulada', acum);
  IF fos.dep('OPE_D', '2026-02', true, 'AF-E') <> '0.00|100.00|500.00|0|aplicado' THEN
    RAISE EXCEPTION 'con cuentas especiales debía depreciarse: %', fos.dep('OPE_D', '2026-02', true, 'AF-E'); END IF;
  RAISE NOTICE '✓ 6 · sin cuentas no asienta y dice cuáles faltan; con las cuentas especiales asignadas sí; dado de baja y costo = residual no se deprecian';

  -- ── 7 · meses que no se aceptan ───────────────────────────────────────────
  IF fos.como('OPE_D', format('SELECT count(*)::text FROM public.conta_depreciar_activos(%L, false, %L)',
       to_char(CURRENT_DATE + interval '1 month', 'YYYY-MM'), d1)) NOT LIKE '!23514 No se deprecia un mes futuro%'
     OR fos.como('OPE_D', format($q$SELECT count(*)::text FROM public.conta_depreciar_activos('2026-13', false, %L)$q$, d1)) NOT LIKE '!22023%'
     OR fos.como('OPE_D', format($q$SELECT count(*)::text FROM public.conta_depreciar_activos('febrero', false, %L)$q$, d1)) NOT LIKE '!22023%' THEN
    RAISE EXCEPTION 'mes futuro o mal escrito: debía rechazarse'; END IF;
  -- ejercicio cerrado: se puede previsualizar, no aplicar
  PERFORM set_config('conta.allow_system_write', 'on', true);
  INSERT INTO public.conta_cierres_anuales (company_id, project_id, anio, asiento_id)
    SELECT d, d1, 2025, id FROM public.conta_asientos WHERE origen_id = b LIMIT 1;
  PERFORM set_config('conta.allow_system_write', 'off', true);
  IF fos.como('OPE_D', format($q$SELECT count(*)::text FROM public.conta_depreciar_activos('2025-12', true, %L)$q$, d1)) NOT LIKE '!23514 El ejercicio 2025%'
     OR fos.como('OPE_D', format($q$SELECT count(*)::text FROM public.conta_depreciar_activos('2025-12', false, %L)$q$, d1)) LIKE '!%' THEN
    RAISE EXCEPTION 'ejercicio cerrado: se previsualiza pero no se aplica'; END IF;
  RAISE NOTICE '✓ 7 · rechaza un mes futuro o mal escrito; sobre un ejercicio cerrado se previsualiza pero no se aplica';

  -- ── 8 · quién ─────────────────────────────────────────────────────────────
  IF fos.como('VIS_D', format($q$SELECT count(*)::text FROM public.conta_depreciar_activos('2026-02', false, %L)$q$, d1)) NOT LIKE '!42501%'
     OR fos.como('SINAPP', format($q$SELECT count(*)::text FROM public.conta_depreciar_activos('2026-02', false, %L)$q$, d1)) NOT LIKE '!42501%'
     OR fos.como('CLI', format($q$SELECT count(*)::text FROM public.conta_depreciar_activos('2026-02', false, %L)$q$, d1)) NOT LIKE '!42501%'
     OR fos.como('OWN_C', format($q$SELECT count(*)::text FROM public.conta_depreciar_activos('2026-02', false, %L)$q$, d1)) NOT LIKE '!42501%'
     OR fos.como('OPE_D', format($q$SELECT count(*)::text FROM public.conta_depreciar_activos('2026-02', false, %L)$q$, fos.id('D2'))) NOT LIKE '!42501%' THEN
    RAISE EXCEPTION 'sin ver Contabilidad, sin perfil, cliente, otra empresa o proyecto sin alcance: 42501'; END IF;
  INSERT INTO public.role_permissions (role_id, permission_key, effect)
    VALUES ('f0520000-0000-0000-0000-000000000001', 'platform.contabilidad.change_status', 'deny');
  IF fos.como('OPE_D', format($q$SELECT count(*)::text FROM public.conta_depreciar_activos('2026-05', true, %L)$q$, d1)) NOT LIKE '!42501 No autorizado para depreciar%'
     OR fos.como('OPE_D', format($q$SELECT count(*)::text FROM public.conta_depreciar_activos('2026-05', false, %L)$q$, d1)) LIKE '!%' THEN
    RAISE EXCEPTION 'sin «Cambiar estado» se previsualiza pero no se aplica'; END IF;
  DELETE FROM public.role_permissions WHERE role_id = 'f0520000-0000-0000-0000-000000000001';
  IF has_function_privilege('anon', 'public.conta_depreciar_activos(text,boolean,uuid)', 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'public.conta_depreciar_activos(text,boolean,uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'ACL: anon sin EXECUTE, authenticated con EXECUTE'; END IF;
  RAISE NOTICE '✓ 8 · previsualizar pide ver Contabilidad; aplicar pide crear Y cambiar estado; otra empresa, proyecto sin alcance y anon, fuera';
END $$;
