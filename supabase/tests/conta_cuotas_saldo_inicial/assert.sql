\set ON_ERROR_STOP on
-- Invariantes de 20261231000200 (conta_cuotas_saldo_inicial).
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

-- La carga, como texto: una línea «fila:resultado» por fila.
CREATE OR REPLACE FUNCTION fos.cargar(p_actor text, p_fecha date, p_filas jsonb, p_aplicar boolean, p_contra uuid DEFAULT NULL)
RETURNS text LANGUAGE sql AS $$
  SELECT fos.como(p_actor, format(
    $q$SELECT string_agg(fila || ':' || resultado, ' ' ORDER BY fila)
         FROM public.conta_cuotas_saldo_inicial(%L, %L, %L::jsonb, %L, %L)$q$,
    fos.id('D1'), p_fecha, p_filas, p_aplicar, p_contra))
$$;
CREATE OR REPLACE FUNCTION fos.saldo(p_cuenta uuid) RETURNS numeric LANGUAGE sql AS $$
  SELECT COALESCE(sum(l.debe - l.haber), 0) FROM public.conta_asiento_lineas l
    JOIN public.conta_asientos a ON a.id = l.asiento_id
   WHERE l.cuenta_id = p_cuenta AND a.estado = 'publicado'
$$;

DO $$
DECLARE
  d uuid := fos.id('D'); d1 uuid := fos.id('D1'); uni uuid := fos.id('UNI_D1'); cli uuid := fos.id('CLI_D');
  uni2 uuid := gen_random_uuid();
  cxc uuid; ingreso uuid; ra uuid; otra uuid;
  r text; q public.cuotas_condominio; x public.conta_asientos; v_ing_antes numeric; v_n int;
  f_feb jsonb; f_todo jsonb;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.conta_cuentas WHERE company_id = d AND project_id = d1) THEN
    r := fos.como('OWN_D', format($q$SELECT count(*)::text FROM public.conta_inicializar_catalogo('basico', %L)$q$, d1));
    IF r LIKE '!%' THEN RAISE EXCEPTION 'no se pudo sembrar el catálogo de D1: %', r; END IF;
  END IF;
  SELECT id INTO cxc     FROM public.conta_cuentas WHERE company_id = d AND project_id = d1 AND tipo = 'activo'  AND es_detalle AND activa AND moneda IS NULL ORDER BY codigo DESC LIMIT 1;
  SELECT id INTO ingreso FROM public.conta_cuentas WHERE company_id = d AND project_id = d1 AND tipo = 'ingreso' AND es_detalle AND activa ORDER BY codigo LIMIT 1;
  SELECT id INTO otra    FROM public.conta_cuentas WHERE company_id = d AND project_id = d1 AND tipo = 'pasivo'  AND es_detalle AND activa ORDER BY codigo LIMIT 1;
  ra := public.conta_cuenta_especial(d, d1, 'resultados_acumulados');
  IF ra IS NULL THEN
    SELECT id INTO ra FROM public.conta_cuentas WHERE company_id = d AND project_id = d1 AND tipo = 'patrimonio' AND es_detalle AND activa ORDER BY codigo LIMIT 1;
    INSERT INTO public.conta_mapeo_cuentas (company_id, project_id, evento, cuenta_id) VALUES (d, d1, 'resultados_acumulados', ra)
      ON CONFLICT DO NOTHING;
  END IF;
  IF cxc IS NULL OR ingreso IS NULL OR ra IS NULL OR otra IS NULL THEN RAISE EXCEPTION 'faltan cuentas en el catálogo de prueba'; END IF;

  -- Tipos de cargo de D1: mantenimiento sí; mora todavía no.
  DELETE FROM public.conta_config_tipo_cargo WHERE company_id = d AND project_id = d1;
  INSERT INTO public.conta_config_tipo_cargo (company_id, project_id, tipo_cargo, cuenta_cxc_id, cuenta_ingreso_id)
    VALUES (d, d1, 'mantenimiento', cxc, ingreso);
  -- El residente es el responsable de pago de la casa 1; la casa 2 no tiene a nadie.
  INSERT INTO public.unidad_residentes (unidad_id, cliente_id, company_id, project_id, tipo, responsable_pago)
    VALUES (uni, cli, d, d1, 'propietario', true)
    ON CONFLICT (unidad_id, cliente_id) DO UPDATE SET responsable_pago = true, activo = true;
  -- (el padrón tiene el plan topado en 1 unidad: la segunda entra sin pasar por ese límite, que no es lo que se prueba)
  ALTER TABLE public.unidades DISABLE TRIGGER USER;
  INSERT INTO public.unidades (id, project_id, company_id, nombre) VALUES (uni2, d1, d, 'Casa 2');
  ALTER TABLE public.unidades ENABLE TRIGGER USER;

  f_feb := jsonb_build_array(jsonb_build_object('unidad_id', uni, 'periodo', '2026-02', 'monto', 600, 'fecha_vencimiento', '2026-02-15'));
  v_ing_antes := fos.saldo(ingreso);

  -- ── 1 · previsualizar valida y no escribe ─────────────────────────────────
  r := fos.cargar('OWN_D', DATE '2026-06-30', f_feb, false);
  IF r <> '1:previsualizacion' THEN RAISE EXCEPTION 'vista previa: %', r; END IF;
  IF EXISTS (SELECT 1 FROM public.cuotas_condominio WHERE unidad_id = uni AND periodo = '2026-02')
     OR EXISTS (SELECT 1 FROM public.conta_asientos WHERE company_id = d AND concepto LIKE 'Saldo inicial%') THEN
    RAISE EXCEPTION 'previsualizar no debía crear cuotas ni pólizas'; END IF;
  RAISE NOTICE '✓ 1 · previsualizar valida la fila (unidad, responsable, tipo de cargo) y no crea ni cuota ni póliza';

  -- ── 2 · aplicar: la cuota con su periodo y vencimiento, y UNA póliza contra la contrapartida ──
  r := fos.cargar('OWN_D', DATE '2026-06-30', f_feb, true);
  IF r <> '1:cargada' THEN RAISE EXCEPTION 'aplicar: %', r; END IF;
  SELECT * INTO q FROM public.cuotas_condominio WHERE unidad_id = uni AND periodo = '2026-02' AND deleted_at IS NULL;
  IF q.monto <> 600 OR q.fecha_vencimiento <> DATE '2026-02-15' OR q.concepto <> 'mantenimiento' OR q.tipo_cargo <> 'mantenimiento'
     OR q.responsable_cliente_id <> cli OR q.cuota_estado <> 'vencida' OR q.estado <> 'pendiente'
     OR q.mora_aplicada_at IS NULL OR COALESCE(q.mora_monto, 0) <> 0 OR q.total_a_pagar <> 600 THEN
    RAISE EXCEPTION 'la cuota cargada no es la esperada: % % % % % %', q.monto, q.fecha_vencimiento, q.cuota_estado, q.responsable_cliente_id, q.mora_aplicada_at, q.total_a_pagar; END IF;
  SELECT count(*) INTO v_n FROM public.conta_asientos WHERE origen_tabla = 'cuotas_condominio' AND origen_id = q.id;
  IF v_n <> 1 THEN RAISE EXCEPTION 'debía quedar UNA póliza de la cuota y hay %', v_n; END IF;
  SELECT * INTO x FROM public.conta_asientos WHERE origen_tabla = 'cuotas_condominio' AND origen_id = q.id;
  IF x.estado <> 'publicado' OR x.fecha <> DATE '2026-06-30' OR x.origen_evento <> 'cuota_emitida' OR x.total_debe <> 600
     OR x.concepto NOT LIKE 'Saldo inicial — cuota mantenimiento 2026-02%' THEN
    RAISE EXCEPTION 'la póliza no es la esperada: % % % %', x.estado, x.fecha, x.origen_evento, x.concepto; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.conta_asiento_lineas WHERE asiento_id = x.id AND cuenta_id = cxc AND debe = 600
                    AND auxiliar_cliente_id = cli AND unidad_id = uni AND tipo_cargo = 'mantenimiento')
     OR NOT EXISTS (SELECT 1 FROM public.conta_asiento_lineas WHERE asiento_id = x.id AND cuenta_id = ra AND haber = 600) THEN
    RAISE EXCEPTION 'debe = por cobrar con el auxiliar del residente; haber = resultados acumulados'; END IF;
  IF fos.saldo(ingreso) <> v_ing_antes THEN RAISE EXCEPTION 'la cuenta de ingreso no debía moverse: % → %', v_ing_antes, fos.saldo(ingreso); END IF;
  RAISE NOTICE '✓ 2 · la cuota entra con su periodo, vencimiento y responsable, y su única póliza es Dr por cobrar (auxiliar) / Cr resultados acumulados al 30-jun: el ingreso no se mueve';

  -- ── 3 · el motor la reconoce como cualquier cuota ─────────────────────────
  IF (SELECT princ_monto FROM public.conta_cuota_saldo_cobro(q.id)) <> 600
     OR (SELECT princ_estado FROM public.conta_cuota_saldo_cobro(q.id)) <> 'publicado' THEN
    RAISE EXCEPTION 'el saldo por cobrar de la cuota debía leerse de su póliza (600, publicada)'; END IF;
  IF EXISTS (SELECT 1 FROM public.conta_intentos_contabilizacion i
              WHERE i.origen_tabla = 'cuotas_condominio' AND i.origen_id = q.id AND i.resultado = 'pendiente') THEN
    RAISE EXCEPTION 'la cuota no debía quedar como pendiente de contabilizar'; END IF;
  r := fos.como('OPE_D', format($q$SELECT concat_ws('|', d90_mas, total, vencimiento_mas_antiguo)
                                     FROM public.conta_cxc_antiguedad(%L, %L) WHERE unidad_id = %L$q$, d1, DATE '2026-06-30', uni));
  IF r <> '600.00|600.00|2026-02-15' THEN RAISE EXCEPTION 'antigüedad de la cuota inicial: %', r; END IF;
  RAISE NOTICE '✓ 3 · el motor la trata como cualquier cuota: saldo por cobrar 600 desde su póliza, nada pendiente de contabilizar, y la antigüedad la fecha por su vencimiento (+90 días)';

  -- ── 4 · repetir no duplica; filas inválidas no detienen a las demás ───────
  f_todo := jsonb_build_array(
    jsonb_build_object('unidad_id', uni, 'periodo', '2026-02', 'monto', 600),                       -- 1 ya existe
    jsonb_build_object('unidad_id', uni, 'periodo', '2026-03', 'monto', 650),                       -- 2 ok, sin vencimiento
    jsonb_build_object('unidad_id', uni, 'periodo', '2026-03', 'monto', 650),                       -- 3 repetida en la carga
    jsonb_build_object('unidad_id', uni, 'periodo', '2026-07', 'monto', 650),                       -- 4 posterior a la fecha
    jsonb_build_object('unidad_id', uni, 'periodo', '2026-13', 'monto', 650),                       -- 5 periodo inválido
    jsonb_build_object('unidad_id', uni, 'periodo', '2026-04', 'monto', 0),                         -- 6 sin monto
    jsonb_build_object('unidad_id', uni2, 'periodo', '2026-04', 'monto', 650),                      -- 7 sin responsable
    jsonb_build_object('unidad_id', gen_random_uuid(), 'periodo', '2026-04', 'monto', 650),         -- 8 unidad ajena
    jsonb_build_object('unidad_id', uni, 'periodo', '2026-04', 'monto', 650, 'tipo_cargo', 'cuota_extraordinaria'), -- 9 sin configuración
    jsonb_build_object('unidad_id', uni, 'periodo', '2026-05', 'monto', 650, 'mora', 25),           -- 10 mora sin configuración
    jsonb_build_object('unidad_id', 'no-es-uuid', 'periodo', '2026-05', 'monto', 'abc'));           -- 11 ilegible
  r := fos.cargar('OWN_D', DATE '2026-06-30', f_todo, true);
  IF r <> '1:ya_existe 2:cargada 3:rechazada 4:rechazada 5:rechazada 6:rechazada 7:rechazada 8:rechazada 9:rechazada 10:rechazada 11:rechazada' THEN
    RAISE EXCEPTION 'carga mixta: %', r; END IF;
  SELECT count(*) INTO v_n FROM public.cuotas_condominio WHERE project_id = d1 AND notas LIKE 'Saldo inicial%' AND deleted_at IS NULL;
  IF v_n <> 2 THEN RAISE EXCEPTION 'debían quedar 2 cuotas iniciales y hay %', v_n; END IF;
  SELECT * INTO q FROM public.cuotas_condominio WHERE unidad_id = uni AND periodo = '2026-03' AND deleted_at IS NULL;
  IF q.fecha_vencimiento <> DATE '2026-03-31' THEN RAISE EXCEPTION 'sin vencimiento → fin del mes del periodo: %', q.fecha_vencimiento; END IF;
  RAISE NOTICE '✓ 4 · repetir no duplica («ya existe»); de 11 filas entra la única válida y cada rechazo lleva su motivo; sin vencimiento toma el fin de mes del periodo';

  -- ── 5 · mora histórica y contrapartida elegida ────────────────────────────
  INSERT INTO public.conta_config_tipo_cargo (company_id, project_id, tipo_cargo, cuenta_cxc_id, cuenta_ingreso_id)
    VALUES (d, d1, 'recargo_mora', cxc, ingreso);
  r := fos.cargar('OWN_D', DATE '2026-06-30',
        jsonb_build_array(jsonb_build_object('unidad_id', uni, 'periodo', '2026-05', 'monto', 650, 'mora', 25, 'fecha_vencimiento', '2026-05-31')),
        true, otra);
  IF r <> '1:cargada' THEN RAISE EXCEPTION 'cuota con mora: %', r; END IF;
  SELECT * INTO q FROM public.cuotas_condominio WHERE unidad_id = uni AND periodo = '2026-05' AND deleted_at IS NULL;
  IF q.mora_monto <> 25 OR q.total_a_pagar <> 675 OR q.mora_aplicada_at IS NULL THEN
    RAISE EXCEPTION 'mora de la cuota: % % %', q.mora_monto, q.total_a_pagar, q.mora_aplicada_at; END IF;
  IF (SELECT count(*) FROM public.conta_asientos WHERE origen_id = q.id AND estado = 'publicado') <> 2
     OR (SELECT mora_monto FROM public.conta_cuota_saldo_cobro(q.id)) <> 25
     OR (SELECT sum(l.haber) FROM public.conta_asiento_lineas l JOIN public.conta_asientos a ON a.id = l.asiento_id
          WHERE a.origen_id = q.id AND l.cuenta_id = otra) <> 675 THEN
    RAISE EXCEPTION 'la cuota con mora debía dejar dos pólizas (650 y 25) contra la contrapartida elegida'; END IF;
  IF fos.saldo(ingreso) <> v_ing_antes THEN RAISE EXCEPTION 'la mora inicial tampoco va contra ingreso'; END IF;
  PERFORM public.aplicar_mora_cuotas_vencidas();
  IF (SELECT count(*) FROM public.cuotas_condominio WHERE project_id = d1 AND notas LIKE 'Saldo inicial%' AND COALESCE(mora_monto, 0) > 0) <> 1 THEN
    RAISE EXCEPTION 'la mora automática no debía recalcularse sobre lo que entró vencido'; END IF;
  RAISE NOTICE '✓ 5 · la mora histórica entra con su póliza (650 + 25) contra la contrapartida elegida, sin tocar ingreso, y la mora automática no se recalcula sobre lo cargado';

  -- ── 6 · eliminar la cuota reversa su póliza ───────────────────────────────
  SELECT * INTO q FROM public.cuotas_condominio WHERE unidad_id = uni AND periodo = '2026-03' AND deleted_at IS NULL;
  PERFORM set_config('conta.allow_system_write', 'on', true);
  ALTER TABLE public.cuotas_condominio DISABLE TRIGGER trg_cuota_solo_por_solicitud;
  UPDATE public.cuotas_condominio SET deleted_at = now() WHERE id = q.id;
  ALTER TABLE public.cuotas_condominio ENABLE TRIGGER trg_cuota_solo_por_solicitud;
  IF fos.saldo(cxc) <> 600 + 675 OR fos.saldo(ra) <> -600 THEN
    RAISE EXCEPTION 'tras eliminar la cuota de marzo: por cobrar % (1,275), resultados acumulados % (−600)', fos.saldo(cxc), fos.saldo(ra); END IF;
  RAISE NOTICE '✓ 6 · eliminar una cuota inicial reversa su póliza: por cobrar y contrapartida vuelven a su saldo';

  -- ── 7 · fecha, ejercicio y contrapartida ──────────────────────────────────
  r := fos.cargar('OWN_D', CURRENT_DATE + 1, f_feb, false);
  IF r NOT LIKE '!23514%futura%' THEN RAISE EXCEPTION 'fecha futura: %', r; END IF;
  r := fos.cargar('OWN_D', DATE '2026-06-30', '[]'::jsonb, false);
  IF r NOT LIKE '!22023%' THEN RAISE EXCEPTION 'sin filas: %', r; END IF;
  r := fos.cargar('OWN_D', DATE '2026-06-30', f_feb, false, gen_random_uuid());
  IF r NOT LIKE '!23514%contrapartida%' THEN RAISE EXCEPTION 'contrapartida ajena: %', r; END IF;
  PERFORM set_config('conta.allow_system_write', 'on', true);
  INSERT INTO public.conta_cierres_anuales (company_id, project_id, anio, asiento_id)
    SELECT d, d1, 2025, id FROM public.conta_asientos WHERE company_id = d AND project_id = d1 AND estado = 'publicado' LIMIT 1;
  PERFORM set_config('conta.allow_system_write', 'off', true);
  r := fos.cargar('OWN_D', DATE '2025-12-31', f_feb, false);
  IF r NOT LIKE '!23514%cerrado%' THEN RAISE EXCEPTION 'ejercicio cerrado: %', r; END IF;
  RAISE NOTICE '✓ 7 · rechaza fecha futura, carga vacía, contrapartida que no es de esta contabilidad y ejercicio cerrado';

  -- ── 8 · permisos, alcance y ACL ───────────────────────────────────────────
  r := fos.cargar('VIS_D', DATE '2026-06-30', f_feb, false);
  IF r NOT LIKE '!42501%' THEN RAISE EXCEPTION 'sin permiso de ver: %', r; END IF;
  r := fos.cargar('OWN_C', DATE '2026-06-30', f_feb, false);
  IF r NOT LIKE '!42501%' THEN RAISE EXCEPTION 'otra empresa: %', r; END IF;
  -- El contador ve la vista previa; aplicar exige además crear cuotas en Condominios.
  r := fos.cargar('OPE_D', DATE '2026-06-30', f_feb, false);
  IF r <> '1:ya_existe' THEN RAISE EXCEPTION 'el contador debía poder previsualizar: %', r; END IF;
  INSERT INTO public.role_permissions (role_id, permission_key, effect)
    VALUES ('f0520000-0000-0000-0000-000000000001', 'platform.contabilidad.change_status', 'deny');
  r := fos.cargar('OPE_D', DATE '2026-06-30', f_feb, true);
  IF r NOT LIKE '!42501%' THEN RAISE EXCEPTION 'sin «cambiar estado» no se aplica: %', r; END IF;
  DELETE FROM public.role_permissions WHERE role_id = 'f0520000-0000-0000-0000-000000000001';
  IF has_function_privilege('anon', 'public.conta_cuotas_saldo_inicial(uuid, date, jsonb, boolean, uuid)', 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'public.conta_cuotas_saldo_inicial(uuid, date, jsonb, boolean, uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'ACL: anon no ejecuta, authenticated sí'; END IF;
  RAISE NOTICE '✓ 8 · sin ver Contabilidad u otra empresa: 42501; el contador previsualiza pero sin «cambiar estado» no aplica; anon no ejecuta';
END $$;
