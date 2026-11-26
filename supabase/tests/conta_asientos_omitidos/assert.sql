\set ON_ERROR_STOP on
-- Invariantes de 20261230000100. Padrón: el de fail_open_sin_perfil. Empresa D,
-- proyecto D1; OPE_D operador con el rol «Finanzas / Contador» (asignado a D1);
-- VIS_D sin rol; OWN_C / OP_C de otra empresa.

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

CREATE OR REPLACE FUNCTION fos.gasto(p_concepto text, p_categoria text, p_metodo text, p_monto numeric) RETURNS uuid
LANGUAGE sql AS $$
  INSERT INTO public.gastos_condominio (company_id, project_id, concepto, categoria, monto, fecha, estado, metodo_pago)
  VALUES (fos.id('D'), fos.id('D1'), p_concepto, p_categoria, p_monto, CURRENT_DATE, 'pagado', p_metodo)
  RETURNING id
$$;
CREATE OR REPLACE FUNCTION fos.omisiones(p_id uuid) RETURNS int LANGUAGE sql AS
$$ SELECT count(*)::int FROM public.conta_asientos_omitidos WHERE origen_id = p_id $$;
CREATE OR REPLACE FUNCTION fos.asientos(p_id uuid) RETURNS int LANGUAGE sql AS
$$ SELECT count(*)::int FROM public.conta_asientos WHERE origen_id = p_id $$;

DO $$
DECLARE
  d  uuid := fos.id('D');  d1 uuid := fos.id('D1');
  cta_gasto uuid;  cta_banco uuid;
  g1 uuid; g2 uuid; g3 uuid; g4 uuid; x uuid := gen_random_uuid(); y uuid := gen_random_uuid();
  o  public.conta_asientos_omitidos;
  r  text; n int; v uuid; a public.conta_asientos;
BEGIN
  -- El proyecto D1 opera con catálogo y mapeo completos, salvo DOS eventos que se le quitan.
  IF NOT EXISTS (SELECT 1 FROM public.conta_cuentas WHERE company_id = d AND project_id = d1) THEN
    r := fos.como('OWN_D', format($q$SELECT count(*)::text FROM public.conta_inicializar_catalogo('basico', %L)$q$, d1));
    IF r LIKE '!%' THEN RAISE EXCEPTION 'no se pudo sembrar el catálogo de D1: %', r; END IF;
  END IF;
  SELECT id INTO cta_gasto FROM public.conta_cuentas WHERE company_id = d AND project_id = d1 AND tipo = 'gasto'  AND es_detalle AND activa ORDER BY codigo LIMIT 1;
  SELECT id INTO cta_banco FROM public.conta_cuentas WHERE company_id = d AND project_id = d1 AND tipo = 'activo' AND es_detalle AND activa AND moneda IS NULL ORDER BY codigo LIMIT 1;
  IF cta_gasto IS NULL OR cta_banco IS NULL THEN RAISE EXCEPTION 'D1 sin cuentas de detalle'; END IF;
  -- Mapeo conocido: todo método → banco, toda categoría de gasto → la cuenta de gasto…
  DELETE FROM public.conta_mapeo_cuentas WHERE company_id = d AND project_id = d1 AND (evento LIKE 'gasto_%' OR evento LIKE 'metodo_%');
  INSERT INTO public.conta_mapeo_cuentas (company_id, project_id, evento, cuenta_id)
  SELECT d, d1, e, CASE WHEN e LIKE 'gasto_%' THEN cta_gasto ELSE cta_banco END
    FROM unnest(ARRAY['gasto_limpieza','gasto_otros','gasto_servicios','metodo_transferencia','metodo_efectivo','metodo_otro']) e;
  -- …menos gasto_mantenimiento y metodo_cheque, que quedan SIN asignar.

  -- ── 1 · un documento real sin cuenta: no asienta, y queda a la vista ───────
  g1 := fos.gasto('Reparación de bomba', 'mantenimiento', 'transferencia', 500);
  IF fos.asientos(g1) <> 0 THEN RAISE EXCEPTION 'sin mapeo no debía asentarse'; END IF;
  SELECT * INTO o FROM public.conta_asientos_omitidos WHERE origen_id = g1;
  IF NOT FOUND THEN RAISE EXCEPTION 'el gasto sin cuenta debía quedar registrado como omisión'; END IF;
  IF o.codigo <> 'sin_mapeo' OR o.eventos_faltan <> ARRAY['gasto_mantenimiento'] OR o.importe <> 500
     OR o.origen_tabla <> 'gastos_condominio' OR o.evento <> 'gasto_pagado' OR o.project_id <> d1 OR o.intentos <> 1
     OR o.tipo <> 'egreso' OR o.fecha <> CURRENT_DATE THEN
    RAISE EXCEPTION 'omisión mal registrada: % % % % %', o.codigo, o.eventos_faltan, o.importe, o.evento, o.intentos; END IF;
  RAISE NOTICE '✓ 1 · un gasto pagado sin cuenta para su categoría: la operación se guarda, no hay asiento y queda la omisión (sin_mapeo: gasto_mantenimiento, 500)';

  -- ── 2 · la bandeja, por contabilidad ──────────────────────────────────────
  IF fos.como('OPE_D', format('SELECT count(*)::text FROM public.conta_omitidos_pendientes(%L)', d1)) <> '1'
     OR fos.como('OPE_D', 'SELECT count(*)::text FROM public.conta_omitidos_pendientes(NULL)') <> '0'
     OR fos.como('OWN_C', format('SELECT count(*)::text FROM public.conta_omitidos_pendientes(%L)', d1)) <> '0'
     OR fos.como('OP_C',  format('SELECT count(*)::text FROM public.conta_asientos_omitidos WHERE project_id = %L', d1)) <> '0'
     OR fos.como('CLI',   'SELECT count(*)::text FROM public.conta_asientos_omitidos') <> '0' THEN
    RAISE EXCEPTION 'bandeja: el contador de D ve 1 en D1 y 0 en la empresa; otra empresa y un cliente, 0'; END IF;
  RAISE NOTICE '✓ 2 · la bandeja lo muestra en SU contabilidad (D1), no en la de la empresa; otra empresa y un cliente no ven nada';

  -- ── 3 · reprocesar sin corregir: sigue pendiente ──────────────────────────
  r := fos.como('OPE_D', format('SELECT resultado || %L || codigo FROM public.conta_omitido_reprocesar(%L)', '|', o.id));
  IF r <> 'pendiente|sin_mapeo' THEN RAISE EXCEPTION 'reprocesar sin corregir debía seguir pendiente: %', r; END IF;
  IF (SELECT intentos FROM public.conta_asientos_omitidos WHERE id = o.id) <> 2 OR fos.asientos(g1) <> 0 THEN
    RAISE EXCEPTION 'el reintento debía contarse (2) y no asentar'; END IF;
  RAISE NOTICE '✓ 3 · reprocesar sin corregir la causa: sigue pendiente, mismo motivo, intento 2';

  -- ── 4 · corregido el mapeo: asienta y sale de la bandeja ──────────────────
  INSERT INTO public.conta_mapeo_cuentas (company_id, project_id, evento, cuenta_id) VALUES (d, d1, 'gasto_mantenimiento', cta_gasto);
  r := fos.como('OPE_D', format('SELECT resultado || %L || asiento_numero FROM public.conta_omitido_reprocesar(%L)', '|', o.id));
  IF r NOT LIKE 'contabilizado|%' THEN RAISE EXCEPTION 'con el mapeo corregido debía contabilizarse: %', r; END IF;
  SELECT * INTO a FROM public.conta_asientos WHERE origen_id = g1;
  IF a.estado <> 'publicado' OR a.total_debe <> 500 OR a.total_haber <> 500 OR a.origen_tabla <> 'gastos_condominio'
     OR a.origen_evento <> 'gasto_pagado' OR a.project_id <> d1 OR a.tipo <> 'egreso' THEN
    RAISE EXCEPTION 'el asiento reprocesado no es el del documento: % % %', a.estado, a.total_debe, a.origen_evento; END IF;
  IF fos.omisiones(g1) <> 0 THEN RAISE EXCEPTION 'asentado: la omisión debía desaparecer'; END IF;
  IF fos.como('OPE_D', format('SELECT resultado FROM public.conta_omitido_reprocesar(%L)', o.id)) <> 'ya_resuelto' OR fos.asientos(g1) <> 1 THEN
    RAISE EXCEPTION 'un segundo reproceso no debía asentar otra vez'; END IF;
  RAISE NOTICE '✓ 4 · corregido el mapeo, reprocesar asienta (publicada, 500 = 500, del documento) y la omisión desaparece; repetirlo no duplica';

  -- ── 5 · anular o borrar el documento retira su omisión ────────────────────
  g2 := fos.gasto('Pago con cheque', 'limpieza', 'cheque', 120);
  g3 := fos.gasto('Otro con cheque', 'limpieza', 'cheque', 80);
  IF fos.omisiones(g2) <> 1 OR fos.omisiones(g3) <> 1 THEN RAISE EXCEPTION 'los dos gastos con cheque debían quedar omitidos'; END IF;
  IF (SELECT eventos_faltan FROM public.conta_asientos_omitidos WHERE origen_id = g2) <> ARRAY['metodo_cheque'] THEN RAISE EXCEPTION 'debía faltar metodo_cheque'; END IF;
  UPDATE public.gastos_condominio SET estado = 'anulado' WHERE id = g2;
  DELETE FROM public.gastos_condominio WHERE id = g3;
  IF fos.omisiones(g2) <> 0 OR fos.omisiones(g3) <> 0 OR fos.asientos(g2) <> 0 OR fos.asientos(g3) <> 0 THEN
    RAISE EXCEPTION 'documento anulado o borrado: su omisión debía retirarse, sin asiento alguno'; END IF;
  RAISE NOTICE '✓ 5 · anular el gasto, o borrarlo, retira su omisión: una omisión viva es siempre de un documento vigente';

  -- ── 6 · lo que NO es una omisión ──────────────────────────────────────────
  g4 := fos.gasto('Limpieza del mes', 'limpieza', 'transferencia', 300);
  IF fos.asientos(g4) <> 1 OR fos.omisiones(g4) <> 0 THEN RAISE EXCEPTION 'un gasto con todo mapeado asienta y no deja omisión'; END IF;
  -- ya asentado (idempotencia): la misma llamada otra vez devuelve NULL y no registra nada
  v := public.conta_generar_asiento(d, d1, 'gastos_condominio', g4, 'gasto_pagado', CURRENT_DATE, 'Gasto: repetido', 'egreso', NULL,
         jsonb_build_array(jsonb_build_object('evento', 'gasto_mantenimiento_x', 'debe', 1), jsonb_build_object('evento', 'metodo_cheque', 'haber', 1)));
  IF v IS NOT NULL OR fos.omisiones(g4) <> 0 OR fos.asientos(g4) <> 1 THEN RAISE EXCEPTION 'lo ya asentado no es una omisión'; END IF;
  -- contabilidad sin catálogo: aún no opera
  v := public.conta_generar_asiento(fos.id('C'), '00000000-0000-0000-0000-0000000000aa', 'gastos_condominio', x, 'gasto_pagado', CURRENT_DATE, 'Sin catálogo', 'egreso', NULL,
         jsonb_build_array(jsonb_build_object('evento', 'metodo_cheque', 'debe', 1), jsonb_build_object('evento', 'metodo_cheque', 'haber', 1)));
  IF v IS NOT NULL OR fos.omisiones(x) <> 0 THEN RAISE EXCEPTION 'un ledger sin catálogo no acumula omisiones'; END IF;
  -- facturas de proveedor: su propia bandeja
  v := public.conta_generar_asiento(d, d1, 'facturas_proveedor', x, 'factura_prov_aprobada', CURRENT_DATE, 'Factura', 'diario', NULL,
         jsonb_build_array(jsonb_build_object('evento', 'metodo_cheque', 'debe', 1), jsonb_build_object('evento', 'metodo_cheque', 'haber', 1)));
  IF v IS NOT NULL OR fos.omisiones(x) <> 0 THEN RAISE EXCEPTION 'las facturas de proveedor no entran a esta bandeja'; END IF;
  RAISE NOTICE '✓ 6 · no dejan omisión: lo que asienta, lo ya asentado, un ledger sin catálogo y las facturas de proveedor';

  -- ── 7 · el rastro nunca rompe la operación ────────────────────────────────
  v := public.conta_generar_asiento(d, d1, 'gastos_condominio', y, 'gasto_pagado', CURRENT_DATE, 'Línea ilegible', 'egreso', NULL,
         jsonb_build_array(jsonb_build_object('cuenta_id', 'no-es-un-uuid', 'debe', 1), jsonb_build_object('evento', 'metodo_cheque', 'haber', 1)));
  IF v IS NOT NULL THEN RAISE EXCEPTION 'una línea ilegible no asienta'; END IF;
  v := public.conta_generar_asiento(d, d1, 'gastos_condominio', y, 'gasto_pagado', CURRENT_DATE, 'Cuenta de otra contabilidad', 'egreso', NULL,
         jsonb_build_array(jsonb_build_object('cuenta_id', (SELECT id FROM public.conta_cuentas WHERE company_id = d AND project_id IS NULL AND es_detalle LIMIT 1), 'debe', 1),
                           jsonb_build_object('evento', 'metodo_transferencia', 'haber', 1)));
  IF v IS NOT NULL OR (SELECT codigo FROM public.conta_asientos_omitidos WHERE origen_id = y) <> 'cuenta_invalida' THEN
    RAISE EXCEPTION 'una cuenta de otra contabilidad debía quedar como cuenta_invalida'; END IF;
  RAISE NOTICE '✓ 7 · una línea ilegible no lanza error (la operación sigue); una cuenta de otra contabilidad queda como cuenta_invalida';

  -- ── 8 · no repite lo que ya está en la bandeja de cargos ──────────────────
  PERFORM public.conta_generar_asiento(d, d1, 'pagos', x, 'pago_contabilizado', CURRENT_DATE, 'Pago', 'ingreso', NULL,
         jsonb_build_array(jsonb_build_object('evento', 'metodo_cheque', 'debe', 9), jsonb_build_object('evento', 'metodo_transferencia', 'haber', 9)));
  SELECT count(*) INTO n FROM public.conta_omitidos_pendientes(d1) p WHERE p.origen_id = x;  -- (como sistema: sin empresa → 0 filas; se mide como contador)
  IF fos.como('OPE_D', format('SELECT count(*)::text FROM public.conta_omitidos_pendientes(%L) p WHERE p.origen_id = %L', d1, x)) <> '1' THEN
    RAISE EXCEPTION 'el pago omitido debía verse antes de tener intentos'; END IF;
  INSERT INTO public.conta_intentos_contabilizacion (company_id, project_id, origen_tabla, origen_id, evento, disparo, resultado, codigo, motivo)
    VALUES (d, d1, 'pagos', x, 'pago_contabilizado', 'cobro', 'pendiente', 'sin_configuracion', 'Falta la configuración del tipo');
  IF fos.como('OPE_D', format('SELECT count(*)::text FROM public.conta_omitidos_pendientes(%L) p WHERE p.origen_id = %L', d1, x)) <> '0' THEN
    RAISE EXCEPTION 'un documento con intentos en la bandeja de cargos no se repite aquí'; END IF;
  RAISE NOTICE '✓ 8 · un documento que ya está en la bandeja de cargos (con intentos) no se repite en ésta';

  -- ── 9 · permisos, aislamiento y ACL ───────────────────────────────────────
  SELECT id INTO v FROM public.conta_asientos_omitidos WHERE origen_id = y;
  IF fos.como('VIS_D', format('SELECT resultado FROM public.conta_omitido_reprocesar(%L)', v)) NOT LIKE '!42501%'
     OR fos.como('SINAPP', format('SELECT resultado FROM public.conta_omitido_reprocesar(%L)', v)) NOT LIKE '!42501%'
     OR fos.como('CLI', format('SELECT resultado FROM public.conta_omitido_reprocesar(%L)', v)) NOT LIKE '!42501%' THEN
    RAISE EXCEPTION 'sin permiso, sin perfil o cliente: reprocesar debía dar 42501'; END IF;
  IF fos.como('OWN_C', format('SELECT resultado FROM public.conta_omitido_reprocesar(%L)', v)) <> 'ya_resuelto'
     OR (SELECT intentos FROM public.conta_asientos_omitidos WHERE id = v) <> 1 THEN
    RAISE EXCEPTION 'otra empresa: «ya no está pendiente» y la omisión intacta'; END IF;
  INSERT INTO public.role_permissions (role_id, permission_key, effect)
    VALUES ('f0520000-0000-0000-0000-000000000001', 'platform.contabilidad.change_status', 'deny');
  IF fos.como('OPE_D', format('SELECT resultado FROM public.conta_omitido_reprocesar(%L)', v)) NOT LIKE '!42501%' THEN
    RAISE EXCEPTION 'sin «Cambiar estado» no se reprocesa'; END IF;
  DELETE FROM public.role_permissions WHERE role_id = 'f0520000-0000-0000-0000-000000000001';
  IF fos.como('OPE_D', $q$INSERT INTO public.conta_asientos_omitidos (company_id, origen_tabla, origen_id, evento, concepto, tipo, lineas, codigo, motivo)
                          VALUES (fos.id('D'), 'x', gen_random_uuid(), 'e', 'c', 'diario', '[]', 'error', 'm') RETURNING 'ok'$q$) NOT LIKE '!42501%'
     OR fos.como('OPE_D', format('DELETE FROM public.conta_asientos_omitidos WHERE id = %L RETURNING %L', v, 'ok')) NOT LIKE '!42501%' THEN
    RAISE EXCEPTION 'la API no escribe ni borra omisiones'; END IF;
  IF has_function_privilege('anon', 'public.conta_omitidos_pendientes(uuid)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.conta_omitido_reprocesar(uuid)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.conta_generar_asiento(uuid,uuid,text,uuid,text,date,text,text,text,jsonb)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.conta_generar_asiento_nucleo(uuid,uuid,text,uuid,text,date,text,text,text,jsonb)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.conta_reversar_automatico(uuid,text,uuid,text,text)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.conta_reversar_automatico_nucleo(uuid,text,uuid,text,text)', 'EXECUTE')
     OR NOT has_function_privilege('service_role', 'public.conta_generar_asiento(uuid,uuid,text,uuid,text,date,text,text,text,jsonb)', 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'public.conta_omitido_reprocesar(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'ACL: el generador y el reverso (envoltura y núcleo) sólo para el sistema; las dos RPC nuevas, para authenticated y no para anon'; END IF;
  RAISE NOTICE '✓ 9 · reprocesar pide crear Y cambiar estado; otra empresa no toca nada; la API no escribe la tabla; generador y reverso siguen sólo para el sistema';
END $$;
