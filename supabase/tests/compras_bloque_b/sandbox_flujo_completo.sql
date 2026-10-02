-- ============================================================================
-- VALIDACIÓN FUNCIONAL DE PUNTA A PUNTA · compra → recepción parcial/final →
-- factura → contabilización → seguimiento, con servicio y activo sobre CUENTAS
-- PERSONALIZADAS, más restricciones entre empresas/proyectos, duplicados,
-- recepción transaccional/idempotente y condiciones aprobadas inmutables.
--
-- SQL plano (sin variables de psql): se puede pegar tal cual en el editor SQL o
-- enviar por la API. Todo ocurre en UNA sola sentencia (DO) y TERMINA SIEMPRE con
-- una excepción para REVERTIR todo (no queda fila, función ni cuenta de prueba).
-- Esa excepción es el canal de la evidencia y hay que LEERLA, no ignorarla:
--
--   · mensaje que empieza por  GUION_OK_REVERTIDO   → todas las comprobaciones
--     coinciden con su valor esperado (cada línea «OK … obtenido=… esperado=…»).
--   · mensaje que empieza por  GUION_FALLO          → alguna comprobación NO
--     coincide (las líneas «FALLO» lo dicen). Es un fallo real.
--   · CUALQUIER OTRO mensaje (constraint, permiso, función inexistente…) → fallo
--     real del recorrido, no la excepción esperada.
--
-- Empresas, proyectos, usuarios y proveedor son de usar y tirar (UUID `5b5b…`);
-- si ya existieran el guion aborta ANTES de escribir.
-- ============================================================================
DO $guion$
DECLARE
  c   constant uuid := '5b5b0000-0000-0000-0000-00000000000c';  -- empresa
  cz  constant uuid := '5b5b0000-0000-0000-0000-00000000000d';  -- OTRA empresa
  pj  constant uuid := '5b5b0000-0000-0000-0000-0000000000a1';  -- proyecto (ledger propio)
  pj2 constant uuid := '5b5b0000-0000-0000-0000-0000000000a2';  -- otro proyecto de la misma empresa
  pjz constant uuid := '5b5b0000-0000-0000-0000-0000000000a3';  -- proyecto de la otra empresa
  ua  constant uuid := '5b5b0000-0000-0000-0000-0000000000f1';  -- admin
  uo  constant uuid := '5b5b0000-0000-0000-0000-0000000000f2';  -- operador de compras
  uk  constant uuid := '5b5b0000-0000-0000-0000-0000000000f3';  -- contador
  u2  constant uuid := '5b5b0000-0000-0000-0000-0000000000f4';  -- operador solo del OTRO proyecto
  uz  constant uuid := '5b5b0000-0000-0000-0000-0000000000f5';  -- admin de la OTRA empresa
  pv  constant uuid := '5b5b0000-0000-0000-0000-0000000000b1';  -- proveedor
  pv2 constant uuid := '5b5b0000-0000-0000-0000-0000000000b2';  -- otro proveedor
  su  constant uuid := '5b5b0000-0000-0000-0000-0000000000d1';  -- insumo
  oc  constant uuid := '5b5b0000-0000-0000-0000-0000000000e1';
  l1  constant uuid := '5b5b0000-0000-0000-0000-0000000000e2';  -- inventario
  l2  constant uuid := '5b5b0000-0000-0000-0000-0000000000e3';  -- servicio, cuenta explícita
  l3  constant uuid := '5b5b0000-0000-0000-0000-0000000000e4';  -- activo fijo, cuenta por mapeo
  r2  constant uuid := '5b5b0000-0000-0000-0000-0000000000c2';
  r3  constant uuid := '5b5b0000-0000-0000-0000-0000000000c3';
  f1  constant uuid := '5b5b0000-0000-0000-0000-0000000000a9';
  f2  constant uuid := '5b5b0000-0000-0000-0000-0000000000aa';
  ev  text[] := ARRAY[]::text[];
  v   numeric;
  t   text;
  j   jsonb;
  j2  jsonb;
  r1  uuid;
  cta_servicio uuid;
  cta_activo   uuid;
  fallos int;
BEGIN
  -- ── Comprobadores: valor OBTENIDO contra valor ESPERADO ───────────────────
  CREATE FUNCTION pg_temp.ck(p_lbl text, p_obtenido text, p_esperado text) RETURNS text LANGUAGE sql IMMUTABLE AS
    $f$ SELECT CASE WHEN $2 IS NOT DISTINCT FROM $3 THEN 'OK    ' ELSE 'FALLO ' END || $1 || ' · obtenido=' || coalesce($2, 'NULL') || ' esperado=' || coalesce($3, 'NULL') $f$;
  CREATE FUNCTION pg_temp.ckn(p_lbl text, p_obtenido numeric, p_esperado numeric) RETURNS text LANGUAGE sql IMMUTABLE AS
    $f$ SELECT CASE WHEN $2 IS NOT DISTINCT FROM $3 THEN 'OK    ' ELSE 'FALLO ' END || $1 || ' · obtenido=' || coalesce(trim_scale($2)::text, 'NULL') || ' esperado=' || coalesce($3::text, 'NULL') $f$;

  IF EXISTS (SELECT 1 FROM public.companies WHERE id IN (c, cz)) THEN
    RAISE EXCEPTION 'ABORTA: la empresa de prueba ya existe; no se escribe nada.';
  END IF;

  -- ── Padrón de usar y tirar ────────────────────────────────────────────────
  INSERT INTO public.companies (id, nombre, default_currency) VALUES (c, 'ZZ Validación Bloque B', 'gtq'), (cz, 'ZZ Otra empresa', 'gtq');
  INSERT INTO public.projects (id, company_id, nombre) VALUES (pj, c, 'ZZ Proyecto validación'), (pj2, c, 'ZZ Otro proyecto'), (pjz, cz, 'ZZ Proyecto otra empresa');
  INSERT INTO auth.users (id) VALUES (ua), (uo), (uk), (u2), (uz);
  INSERT INTO public.app_users (id, company_id, full_name, role) VALUES
    (ua, c, 'ZZ Admin', 'admin'), (uo, c, 'ZZ Operador compras', 'operator'), (uk, c, 'ZZ Contador', 'operator'),
    (u2, c, 'ZZ Operador otro proyecto', 'operator'), (uz, cz, 'ZZ Admin otra empresa', 'admin');
  INSERT INTO public.user_project_assignments (user_id, project_id, permission_type) VALUES
    (ua, pj, 'total'), (uo, pj, 'total'), (uk, pj, 'total'), (u2, pj2, 'total'), (uz, pjz, 'total');
  INSERT INTO public.roles (id, company_id, name) VALUES
    ('5b5b0000-0000-0000-0000-0000000000c9', c, 'ZZ Contador'),
    ('5b5b0000-0000-0000-0000-0000000000c8', c, 'ZZ Operador compras');
  INSERT INTO public.role_permissions (role_id, permission_key, effect) VALUES
    ('5b5b0000-0000-0000-0000-0000000000c9', 'platform.contabilidad.view',   'allow'),
    ('5b5b0000-0000-0000-0000-0000000000c9', 'platform.contabilidad.create', 'allow'),
    ('5b5b0000-0000-0000-0000-0000000000c9', 'platform.contabilidad.edit',   'allow'),
    ('5b5b0000-0000-0000-0000-0000000000c9', 'platform.contabilidad.delete', 'allow'),
    ('5b5b0000-0000-0000-0000-0000000000c8', 'condominios.tab.ordenes_compra', 'allow'),
    ('5b5b0000-0000-0000-0000-0000000000c8', 'condominios.tab.suministros',    'allow');
  INSERT INTO public.user_roles (user_id, role_id) VALUES
    (uk, '5b5b0000-0000-0000-0000-0000000000c9'), (uo, '5b5b0000-0000-0000-0000-0000000000c8'),
    (u2, '5b5b0000-0000-0000-0000-0000000000c8');

  -- ── Contabilidad PROPIA: catálogo sembrado + cuentas PERSONALIZADAS ───────
  PERFORM public.conta_seed_catalogo(c, pj);
  PERFORM public.compras_seed_cuentas(c, pj);
  PERFORM public.conta_seed_cuenta(c, pj, '6205', 'Servicios contratados propios', 'gasto',  'deudora', NULL, 1, true);
  PERFORM public.conta_seed_cuenta(c, pj, '9101', 'Equipo propio de la empresa',   'activo', 'deudora', NULL, 1, true);
  SELECT id INTO cta_servicio FROM public.conta_cuentas WHERE company_id = c AND project_id = pj AND codigo = '6205';
  SELECT id INTO cta_activo   FROM public.conta_cuentas WHERE company_id = c AND project_id = pj AND codigo = '9101';
  UPDATE public.conta_mapeo_cuentas SET cuenta_id = cta_activo WHERE company_id = c AND project_id = pj AND evento = 'activo_fijo';

  INSERT INTO public.proveedores (id, company_id, nombre, nit, pais, alcance) VALUES
    (pv,  c, 'ZZ Proveedor de validación', '9999991-1', 'GT', 'empresa'),
    (pv2, c, 'ZZ Otro proveedor',          '9999992-2', 'GT', 'empresa');
  INSERT INTO public.suministros_condominio (id, company_id, project_id, nombre, unidad_medida) VALUES (su, c, pj, 'ZZ Cloro', 'litro');
  INSERT INTO public.conta_tipos_cambio_mensual (company_id, moneda, moneda_base, periodo, tasa)
    VALUES (c, 'USD', 'GTQ', to_char(CURRENT_DATE, 'YYYY-MM'), 7.75);

  PERFORM set_config('request.jwt.claim.sub', ua::text, true);
  SET LOCAL ROLE authenticated;
  UPDATE public.proveedores SET estado = 'autorizado' WHERE id IN (pv, pv2);

  -- ── 1 · COMPRA: solicita el operador, aprueba y emite el admin ────────────
  PERFORM set_config('request.jwt.claim.sub', uo::text, true);
  INSERT INTO public.ordenes_compra (id, company_id, project_id, proveedor_id, proveedor_nombre, concepto)
    VALUES (oc, c, pj, pv, 'ZZ Proveedor de validación', 'Cloro, mantenimiento y bombas');
  INSERT INTO public.orden_compra_lineas (id, company_id, orden_compra_id, linea, descripcion, destino_tipo, suministro_id, categoria, cantidad, unidad, precio_unitario, iva_monto, cuenta_id) VALUES
    (l1, c, oc, 1, 'Cloro industrial',       'inventario',  su,   'limpieza',      100, 'litro',    10,  120, NULL),
    (l2, c, oc, 2, 'Mantenimiento mensual',  'servicio',    NULL, 'mantenimiento',   1, 'servicio', 300,  36, cta_servicio),
    (l3, c, oc, 3, 'Bombas de agua',         'activo_fijo', NULL, 'mantenimiento',   2, 'unidad',   500, 120, NULL);
  PERFORM set_config('request.jwt.claim.sub', ua::text, true);
  UPDATE public.ordenes_compra SET estado = 'aprobada' WHERE id = oc;
  UPDATE public.ordenes_compra SET estado = 'emitida'  WHERE id = oc;
  ev := ev || pg_temp.ck('1 orden aprobada y emitida · estado', (SELECT estado FROM public.ordenes_compra WHERE id = oc), 'emitida');
  ev := ev || pg_temp.ck('1 solicitante≠aprobador', (SELECT (created_by = uo AND aprobada_por = ua)::text FROM public.ordenes_compra WHERE id = oc), 'true');
  ev := ev || pg_temp.ck('1 cuenta del servicio (explícita)', (SELECT c2.codigo || '/' || x.cuenta_origen FROM public.orden_compra_lineas x JOIN public.conta_cuentas c2 ON c2.id = x.cuenta_id WHERE x.id = l2), '6205/linea_explicita');

  -- 1b · condiciones aprobadas INMUTABLES (también estando emitida)
  BEGIN UPDATE public.ordenes_compra SET proveedor_id = pv2 WHERE id = oc; t := 'SIN ERROR';
  EXCEPTION WHEN OTHERS THEN t := split_part(SQLERRM, ':', 1); END;
  ev := ev || pg_temp.ck('1b cambiar proveedor de una orden emitida', t, 'COMPRAS_OC_EMITIDA_CAMBIO');
  BEGIN UPDATE public.ordenes_compra SET moneda = 'USD' WHERE id = oc; t := 'SIN ERROR';
  EXCEPTION WHEN OTHERS THEN t := split_part(SQLERRM, ':', 1); END;
  ev := ev || pg_temp.ck('1b cambiar moneda de una orden emitida', t, 'COMPRAS_OC_EMITIDA_CAMBIO');
  BEGIN UPDATE public.ordenes_compra SET estado = 'recibida' WHERE id = oc; t := 'SIN ERROR';
  EXCEPTION WHEN OTHERS THEN t := split_part(SQLERRM, ':', 1); END;
  ev := ev || pg_temp.ck('1b marcar «recibida» a mano', t, 'COMPRAS_OC_RECIBIDA_MANUAL');

  -- ── 2 · RECEPCIÓN PARCIAL, creada de forma TRANSACCIONAL e IDEMPOTENTE ────
  PERFORM set_config('request.jwt.claim.sub', uo::text, true);
  j := public.compras_recepcion_crear(c, pj,
    format('{"orden_compra_id":"%s","tipo":"bienes","fecha":"%s","documento_referencia":"REM-ZZ-1","destino_fisico":"Bodega general","clave_idempotencia":"zz-rec-1"}', oc, CURRENT_DATE)::jsonb,
    format('[{"orden_compra_linea_id":"%s","cantidad":40,"cantidad_rechazada":5,"motivo_rechazo":"Envases dañados","costo_unitario":10},{"orden_compra_linea_id":"%s","cantidad":1,"cantidad_rechazada":0,"costo_unitario":500}]', l1, l3)::jsonb);
  r1 := (j->'recepcion'->>'id')::uuid;
  ev := ev || pg_temp.ck('2 creación transaccional · nueva, borrador y 2 líneas', ((j->>'reutilizada')::boolean)::text || '/' || (j->'recepcion'->>'estado') || '/' || jsonb_array_length(j->'lineas'), 'false/borrador/2');
  -- doble clic / respuesta perdida: MISMO documento, nada duplicado
  j2 := public.compras_recepcion_crear(c, pj,
    format('{"orden_compra_id":"%s","tipo":"bienes","fecha":"%s","documento_referencia":"REM-ZZ-1","destino_fisico":"Bodega general","clave_idempotencia":"zz-rec-1"}', oc, CURRENT_DATE)::jsonb,
    format('[{"orden_compra_linea_id":"%s","cantidad":40,"cantidad_rechazada":5,"motivo_rechazo":"Envases dañados","costo_unitario":10},{"orden_compra_linea_id":"%s","cantidad":1,"cantidad_rechazada":0,"costo_unitario":500}]', l1, l3)::jsonb);
  ev := ev || pg_temp.ck('2 reintento con misma clave y contenido · reutiliza el MISMO documento', ((j2->>'reutilizada')::boolean)::text || '/' || (j2->'recepcion'->>'id' = r1::text)::text, 'true/true');
  -- misma clave, OTRO contenido → conflicto
  BEGIN PERFORM public.compras_recepcion_crear(c, pj,
      format('{"orden_compra_id":"%s","tipo":"bienes","fecha":"%s","clave_idempotencia":"zz-rec-1"}', oc, CURRENT_DATE)::jsonb,
      format('[{"orden_compra_linea_id":"%s","cantidad":99,"cantidad_rechazada":0,"costo_unitario":10}]', l1)::jsonb);
    t := 'SIN ERROR';
  EXCEPTION WHEN OTHERS THEN t := split_part(SQLERRM, ':', 1); END;
  ev := ev || pg_temp.ck('2 misma clave con OTRO contenido', t, 'COMPRAS_RECEPCION_CLAVE_CONFLICTO');
  -- línea ajena → falla y NO deja cabecera huérfana
  BEGIN PERFORM public.compras_recepcion_crear(c, pj,
      format('{"orden_compra_id":"%s","tipo":"bienes","fecha":"%s","clave_idempotencia":"zz-rec-mala"}', oc, CURRENT_DATE)::jsonb,
      '[{"orden_compra_linea_id":"5b5b0000-0000-0000-0000-0000000000ff","cantidad":1,"cantidad_rechazada":0,"costo_unitario":1}]'::jsonb);
    t := 'SIN ERROR';
  EXCEPTION WHEN OTHERS THEN t := 'ERROR'; END;
  PERFORM set_config('request.jwt.claim.sub', ua::text, true);
  ev := ev || pg_temp.ck('2 línea ajena · falla', t, 'ERROR');
  ev := ev || pg_temp.ckn('2 sin cabecera huérfana tras el fallo (clave zz-rec-mala)', (SELECT count(*) FROM public.recepciones WHERE clave_idempotencia = 'zz-rec-mala'), 0);
  ev := ev || pg_temp.ckn('2 una sola recepción con la clave zz-rec-1', (SELECT count(*) FROM public.recepciones WHERE clave_idempotencia = 'zz-rec-1'), 1);
  ev := ev || pg_temp.ckn('2 crear (borrador) no contabiliza', (SELECT count(*) FROM public.conta_asientos WHERE origen_tabla = 'recepciones' AND origen_id = r1), 0);

  UPDATE public.recepciones SET estado = 'registrada' WHERE id = r1;
  UPDATE public.recepciones SET estado = 'registrada' WHERE id = r1;   -- reintento: no duplica
  ev := ev || pg_temp.ck('2 orden tras recepción parcial', (SELECT estado FROM public.ordenes_compra WHERE id = oc), 'recibida_parcial');
  ev := ev || pg_temp.ckn('2 recibido (aceptado) del cloro', (SELECT cantidad_recibida FROM public.orden_compra_lineas WHERE id = l1), 40);
  ev := ev || pg_temp.ckn('2 stock = lo aceptado', (SELECT stock_actual FROM public.suministros_condominio WHERE id = su), 40);
  ev := ev || pg_temp.ckn('2 activos dados de alta (1 bomba)', (SELECT count(*) FROM public.activos_fijos WHERE proveedor_id = pv), 1);
  ev := ev || pg_temp.ckn('2 asientos de la recepción (registrar dos veces no duplica)', (SELECT count(*) FROM public.conta_asientos WHERE origen_tabla = 'recepciones' AND origen_id = r1), 1);
  ev := ev || pg_temp.ck('2 cuentas del asiento (inventario 1106, por facturar 2105, activo personalizado 9101)', (SELECT string_agg(DISTINCT cu.codigo, ',' ORDER BY cu.codigo) FROM public.conta_asientos a JOIN public.conta_asiento_lineas al ON al.asiento_id = a.id JOIN public.conta_cuentas cu ON cu.id = al.cuenta_id WHERE a.origen_tabla = 'recepciones' AND a.origen_id = r1), '1106,2105,9101');
  -- cantidades pendientes a media recepción (vía seguimiento)
  j := public.compras_seguimiento_orden(oc);
  ev := ev || pg_temp.ck('2 pendientes por línea tras la parcial (cloro/servicio/bomba)',
        (SELECT string_agg(trim_scale((x->>'cantidad_pendiente')::numeric)::text, '/' ORDER BY (x->>'linea')::int) FROM jsonb_array_elements(j->'lineas') x), '60/1/1');
  ev := ev || pg_temp.ckn('2 rechazado del cloro (queda constancia, no cuenta como recibido)', (SELECT (x->>'cantidad_rechazada')::numeric FROM jsonb_array_elements(j->'lineas') x WHERE (x->>'linea')::int = 1), 5);

  -- ── 3 · CONFORMIDAD de servicio (sin inventario ni activo) ────────────────
  INSERT INTO public.recepciones (id, company_id, project_id, orden_compra_id, tipo, recibido_por, notas)
    VALUES (r2, c, pj, oc, 'servicio', uk, 'Hito: mantenimiento de octubre');
  INSERT INTO public.recepcion_lineas (company_id, recepcion_id, orden_compra_linea_id, cantidad) VALUES (c, r2, l2, 1);
  UPDATE public.recepciones SET estado = 'registrada' WHERE id = r2;
  ev := ev || pg_temp.ckn('3 conformidad · movimientos de inventario', (SELECT count(*) FROM public.movimientos_suministro WHERE origen_id IN (SELECT id FROM public.recepcion_lineas WHERE recepcion_id = r2)), 0);
  ev := ev || pg_temp.ckn('3 conformidad · activos', (SELECT count(*) FROM public.activos_fijos WHERE recepcion_linea_id IN (SELECT id FROM public.recepcion_lineas WHERE recepcion_id = r2)), 0);
  ev := ev || pg_temp.ck('3 conformidad · gasto en la cuenta explícita', (SELECT string_agg(DISTINCT cu.codigo, ',') FROM public.conta_asientos a JOIN public.conta_asiento_lineas al ON al.asiento_id = a.id JOIN public.conta_cuentas cu ON cu.id = al.cuenta_id WHERE a.origen_tabla = 'recepciones' AND a.origen_id = r2 AND cu.codigo = '6205'), '6205');

  -- ── 4 · FACTURA 1 (parcial) ───────────────────────────────────────────────
  PERFORM set_config('request.jwt.claim.sub', uk::text, true);
  INSERT INTO public.facturas_proveedor (id, company_id, project_id, proveedor_id, orden_compra_id, numero_factura, concepto, categoria, monto_total)
    VALUES (f1, c, pj, pv, oc, 'ZZ-0001', 'Facturación parcial', 'limpieza', 1);
  INSERT INTO public.factura_proveedor_lineas (company_id, factura_id, orden_compra_linea_id, linea, descripcion, cantidad, precio_unitario, iva_monto) VALUES
    (c, f1, l1, 1, 'Cloro industrial',      40, 10,  48),
    (c, f1, l2, 2, 'Mantenimiento mensual',  1, 300, 36),
    (c, f1, l3, 3, 'Bombas de agua',         1, 500, 60);
  ev := ev || pg_temp.ckn('4 cuadre factura 1 · renglones fuera de tolerancia', (SELECT count(*) FROM public.compras_validar_match(f1) WHERE NOT dentro_tolerancia), 0);
  -- duplicado: mismo proveedor y número
  BEGIN INSERT INTO public.facturas_proveedor (company_id, project_id, proveedor_id, orden_compra_id, numero_factura, concepto, categoria, monto_total)
      VALUES (c, pj, pv, oc, 'ZZ-0001', 'Duplicada', 'limpieza', 1);
    t := 'SIN ERROR';
  EXCEPTION WHEN unique_violation THEN t := 'unique_violation'; WHEN OTHERS THEN t := 'OTRO: ' || SQLERRM; END;
  ev := ev || pg_temp.ck('4 factura duplicada (mismo proveedor y número)', t, 'unique_violation');
  -- sin permisos de Contabilidad no se aprueba
  PERFORM set_config('request.jwt.claim.sub', uo::text, true);
  UPDATE public.facturas_proveedor SET estado = 'aprobada' WHERE id = f1;
  PERFORM set_config('request.jwt.claim.sub', uk::text, true);
  ev := ev || pg_temp.ck('4 operador sin permisos intenta aprobar · estado', (SELECT estado FROM public.facturas_proveedor WHERE id = f1), 'registrada');
  UPDATE public.facturas_proveedor SET estado = 'aprobada' WHERE id = f1;
  UPDATE public.facturas_proveedor SET estado = 'aprobada' WHERE id = f1;  -- reintento
  ev := ev || pg_temp.ck('4 factura 1 · estado/total', (SELECT estado || '/' || monto_total FROM public.facturas_proveedor WHERE id = f1), 'aprobada/1344.00');
  ev := ev || pg_temp.ckn('4 factura 1 · asientos publicados (reintento no duplica)', (SELECT count(*) FROM public.conta_asientos WHERE origen_tabla = 'facturas_proveedor' AND origen_id = f1 AND estado = 'publicado'), 1);
  ev := ev || pg_temp.ck('4 orden sigue abierta tras facturar lo recibido', (SELECT estado FROM public.ordenes_compra WHERE id = oc), 'recibida_parcial');

  -- ── 5 · RECEPCIÓN FINAL y FACTURA 2 ───────────────────────────────────────
  PERFORM set_config('request.jwt.claim.sub', ua::text, true);
  INSERT INTO public.recepciones (id, company_id, project_id, orden_compra_id, tipo) VALUES (r3, c, pj, oc, 'bienes');
  INSERT INTO public.recepcion_lineas (company_id, recepcion_id, orden_compra_linea_id, cantidad) VALUES (c, r3, l1, 60), (c, r3, l3, 1);
  UPDATE public.recepciones SET estado = 'registrada' WHERE id = r3;
  ev := ev || pg_temp.ck('5 recepción final · estado de la orden', (SELECT estado FROM public.ordenes_compra WHERE id = oc), 'recibida');
  ev := ev || pg_temp.ckn('5 stock final', (SELECT stock_actual FROM public.suministros_condominio WHERE id = su), 100);
  ev := ev || pg_temp.ckn('5 activos finales (uno por unidad)', (SELECT count(*) FROM public.activos_fijos WHERE proveedor_id = pv), 2);
  -- sobre-recepción: ya no cabe nada
  INSERT INTO public.recepciones (id, company_id, project_id, orden_compra_id, tipo) VALUES ('5b5b0000-0000-0000-0000-0000000000c4', c, pj, oc, 'bienes');
  BEGIN INSERT INTO public.recepcion_lineas (company_id, recepcion_id, orden_compra_linea_id, cantidad) VALUES (c, '5b5b0000-0000-0000-0000-0000000000c4', l1, 1);
    UPDATE public.recepciones SET estado = 'registrada' WHERE id = '5b5b0000-0000-0000-0000-0000000000c4';
    t := 'SIN ERROR';
  EXCEPTION WHEN OTHERS THEN t := split_part(SQLERRM, ':', 1); END;
  ev := ev || pg_temp.ck('5 recibir de más', t, 'COMPRAS_OC_NO_RECIBIBLE');
  PERFORM set_config('request.jwt.claim.sub', uk::text, true);
  INSERT INTO public.facturas_proveedor (id, company_id, project_id, proveedor_id, orden_compra_id, numero_factura, concepto, categoria, monto_total)
    VALUES (f2, c, pj, pv, oc, 'ZZ-0002', 'Saldo', 'limpieza', 1);
  INSERT INTO public.factura_proveedor_lineas (company_id, factura_id, orden_compra_linea_id, linea, descripcion, cantidad, precio_unitario, iva_monto) VALUES
    (c, f2, l1, 1, 'Cloro industrial', 60, 10, 72), (c, f2, l3, 2, 'Bombas de agua', 1, 500, 60);
  UPDATE public.facturas_proveedor SET estado = 'aprobada' WHERE id = f2;
  ev := ev || pg_temp.ck('5 factura 2 aprobada · estado de la orden', (SELECT estado FROM public.ordenes_compra WHERE id = oc), 'cerrada');

  -- ── 6 · Cifras contables que deben cuadrar ────────────────────────────────
  RESET ROLE;
  SELECT coalesce(sum(al.debe - al.haber), 0) INTO v FROM public.conta_asientos a JOIN public.conta_asiento_lineas al ON al.asiento_id = a.id JOIN public.conta_cuentas cu ON cu.id = al.cuenta_id
   WHERE cu.codigo = '2105' AND cu.company_id = c AND cu.project_id = pj AND a.estado <> 'anulado';
  ev := ev || pg_temp.ckn('6 «por facturar» (2105) tras recibir y facturar todo', v, 0);
  SELECT coalesce(sum(al.haber - al.debe), 0) INTO v FROM public.conta_asientos a JOIN public.conta_asiento_lineas al ON al.asiento_id = a.id JOIN public.conta_cuentas cu ON cu.id = al.cuenta_id
   WHERE cu.codigo = '2104' AND cu.company_id = c AND cu.project_id = pj AND a.estado <> 'anulado';
  ev := ev || pg_temp.ckn('6 Proveedores por pagar (2104) = 1344 + 1232', v, 2576);
  SELECT coalesce(sum(al.debe - al.haber), 0) INTO v FROM public.conta_asientos a JOIN public.conta_asiento_lineas al ON al.asiento_id = a.id JOIN public.conta_cuentas cu ON cu.id = al.cuenta_id
   WHERE cu.codigo = '9101' AND cu.company_id = c AND cu.project_id = pj AND a.estado <> 'anulado';
  ev := ev || pg_temp.ckn('6 activo en la cuenta personalizada 9101 (2 × 500)', v, 1000);
  SELECT coalesce(sum(al.debe - al.haber), 0) INTO v FROM public.conta_asientos a JOIN public.conta_asiento_lineas al ON al.asiento_id = a.id JOIN public.conta_cuentas cu ON cu.id = al.cuenta_id
   WHERE cu.codigo = '6205' AND cu.company_id = c AND cu.project_id = pj AND a.estado <> 'anulado';
  ev := ev || pg_temp.ckn('6 servicio en la cuenta explícita 6205', v, 300);
  ev := ev || pg_temp.ckn('6 asientos desbalanceados', (SELECT count(*) FROM public.conta_asientos WHERE company_id = c AND total_debe <> total_haber), 0);
  ev := ev || pg_temp.ckn('6 asientos sin publicar (borradores)', (SELECT count(*) FROM public.conta_asientos WHERE company_id = c AND estado = 'borrador'), 0);
  ev := ev || pg_temp.ckn('6 ausencia de duplicados · asientos de recepción (3 recepciones registradas)', (SELECT count(*) FROM public.conta_asientos WHERE company_id = c AND origen_tabla = 'recepciones'), 3);
  ev := ev || pg_temp.ckn('6 ausencia de duplicados · asientos de factura (2 facturas)', (SELECT count(*) FROM public.conta_asientos WHERE company_id = c AND origen_tabla = 'facturas_proveedor'), 2);
  ev := ev || pg_temp.ckn('6 eventos del historial de la orden', (SELECT count(*) FROM public.orden_compra_eventos WHERE orden_compra_id = oc), 6);
  ev := ev || pg_temp.ckn('6 facturado por línea = recibido por línea (cloro)', (SELECT cantidad_facturada - cantidad_recibida FROM public.orden_compra_lineas WHERE id = l1), 0);

  -- ── 7 · Seguimiento compartido (contador, operador) ───────────────────────
  PERFORM set_config('request.jwt.claim.sub', uk::text, true);
  SET LOCAL ROLE authenticated;
  j := public.compras_seguimiento_orden(oc);
  ev := ev || pg_temp.ck('7 seguimiento (contador) · comprometido/recibido/facturado/pagado/pend.recibir/pend.facturar',
        (j->'indicadores'->>'comprometido') || '/' || (j->'indicadores'->>'recibido') || '/' || (j->'indicadores'->>'facturado') || '/' || (j->'indicadores'->>'pagado') || '/' || (j->'indicadores'->>'pendiente_por_recibir') || '/' || (j->'indicadores'->>'pendiente_por_facturar'),
        '2576.00/2300.00/2576.00/0.00/0.00/0.00');
  PERFORM set_config('request.jwt.claim.sub', uo::text, true);
  j := public.compras_seguimiento_orden(oc);
  ev := ev || pg_temp.ck('7 seguimiento (operador) · sin facturas, sin facturado', ((j ? 'facturas'))::text || '/' || coalesce(j->'indicadores'->>'facturado', 'null'), 'false/null');

  -- ── 8 · RESTRICCIONES entre empresas y proyectos ──────────────────────────
  PERFORM set_config('request.jwt.claim.sub', uz::text, true);   -- admin de OTRA empresa
  ev := ev || pg_temp.ck('8 otra empresa no ve el seguimiento', coalesce((public.compras_seguimiento_orden(oc))::text, 'NULL'), 'NULL');
  BEGIN INSERT INTO public.recepciones (company_id, project_id, orden_compra_id, tipo) VALUES (cz, pjz, oc, 'bienes'); t := 'SIN ERROR';
  EXCEPTION WHEN OTHERS THEN t := split_part(SQLERRM, ':', 1); END;
  ev := ev || pg_temp.ck('8 otra empresa no recibe contra la orden', t, 'COMPRAS_RECEPCION_ORDEN_AJENA');
  BEGIN INSERT INTO public.facturas_proveedor (company_id, project_id, proveedor_id, orden_compra_id, numero_factura, concepto, categoria, monto_total)
      VALUES (cz, pjz, pv, oc, 'ZZ-AJENA', 'x', 'limpieza', 1); t := 'SIN ERROR';
  EXCEPTION WHEN OTHERS THEN t := split_part(SQLERRM, ':', 1); END;
  ev := ev || pg_temp.ck('8 otra empresa no factura contra la orden', t, 'COMPRAS_FACTURA_ORDEN_AJENA');
  PERFORM set_config('request.jwt.claim.sub', u2::text, true);   -- misma empresa, OTRO proyecto
  ev := ev || pg_temp.ck('8 otro proyecto de la misma empresa no ve el seguimiento', coalesce((public.compras_seguimiento_orden(oc))::text, 'NULL'), 'NULL');
  BEGIN PERFORM * FROM public.compras_seguimiento_lista(pj); t := 'SIN ERROR';
  EXCEPTION WHEN OTHERS THEN t := 'rechazada'; END;
  ev := ev || pg_temp.ck('8 listar el proyecto sin acceso', t, 'rechazada');
  RESET ROLE;

  -- ── Veredicto: la excepción SIEMPRE revierte; su prefijo dice si hubo fallo ─
  SELECT count(*) INTO fallos FROM unnest(ev) e WHERE e LIKE 'FALLO%';
  IF fallos > 0 THEN
    RAISE EXCEPTION E'GUION_FALLO: % comprobación(es) no coinciden (la transacción se revierte)\n%', fallos, array_to_string(ev, E'\n');
  END IF;
  RAISE EXCEPTION E'GUION_OK_REVERTIDO: % comprobaciones coinciden con lo esperado (la transacción se revierte; no queda nada)\n%', cardinality(ev), array_to_string(ev, E'\n');
END
$guion$;
