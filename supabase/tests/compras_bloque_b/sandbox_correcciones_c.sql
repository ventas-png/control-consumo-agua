-- ============================================================================
-- VALIDACIÓN EN SANDBOX · CORRECCIONES DEL BLOQUE C (migraciones 20261023000000, …0100 y …0200)
-- Pendientes por renglón (descuento, sobreprecio autorizado, facturación parcial), respaldos validados
-- en el servidor (INSERT directo y RPC), retiro del principal, inmutabilidad, aislamiento y reintentos.
--
-- SQL plano; UNA sola sentencia (DO) que TERMINA SIEMPRE con una excepción para REVERTIR todo
-- (no queda ninguna fila de prueba; los objetos de storage que inserta también se revierten):
--   · GUION_OK_REVERTIDO → todo coincide · GUION_FALLO → alguna comprobación no coincide ·
--   · cualquier otro mensaje → fallo real del recorrido.
-- Padrón de usar y tirar `5b5d…`. La concurrencia con sesiones reales NO se puede hacer aquí (una
-- sentencia = una transacción): se prueba en el arnés local (run.sh, escenarios O y P).
-- ============================================================================
DO $guion$
DECLARE
  c   constant uuid := '5b5d0000-0000-0000-0000-00000000000c';
  cz  constant uuid := '5b5d0000-0000-0000-0000-00000000000d';
  pj  constant uuid := '5b5d0000-0000-0000-0000-0000000000a1';
  pj2 constant uuid := '5b5d0000-0000-0000-0000-0000000000a2';
  pjz constant uuid := '5b5d0000-0000-0000-0000-0000000000a3';
  ua  constant uuid := '5b5d0000-0000-0000-0000-0000000000f1';  -- admin
  ub  constant uuid := '5b5d0000-0000-0000-0000-0000000000f6';  -- admin 2 (autorizador de excepciones)
  uo  constant uuid := '5b5d0000-0000-0000-0000-0000000000f2';  -- operador de compras (sin finanzas)
  uk  constant uuid := '5b5d0000-0000-0000-0000-0000000000f3';  -- contador
  un  constant uuid := '5b5d0000-0000-0000-0000-0000000000f4';  -- operador SIN permisos de compras
  uz  constant uuid := '5b5d0000-0000-0000-0000-0000000000f5';  -- admin de OTRA empresa
  pv  constant uuid := '5b5d0000-0000-0000-0000-0000000000b1';
  o1  constant uuid := '5b5d0000-0000-0000-0000-0000000000e1';  -- 3 renglones, recibidos por completo
  o2  constant uuid := '5b5d0000-0000-0000-0000-0000000000e2';  -- un renglón, solo descuento
  r1  constant uuid := '5b5d0000-0000-0000-0000-0000000000c1';
  r2  constant uuid := '5b5d0000-0000-0000-0000-0000000000c2';
  l11 constant uuid := '5b5d0000-0000-0000-0000-0000000000e3';
  l12 constant uuid := '5b5d0000-0000-0000-0000-0000000000e4';
  l13 constant uuid := '5b5d0000-0000-0000-0000-0000000000e5';
  l21 constant uuid := '5b5d0000-0000-0000-0000-0000000000e6';
  ob  constant uuid := '5b5d0000-0000-0000-0000-0000000000e7';  -- orden para respaldos
  lb  constant uuid := '5b5d0000-0000-0000-0000-0000000000e8';
  os  constant uuid := '5b5d0000-0000-0000-0000-0000000000e9';  -- servicio
  ls  constant uuid := '5b5d0000-0000-0000-0000-0000000000ea';
  rb  constant uuid := '5b5d0000-0000-0000-0000-0000000000c3';  -- recepción de bienes (borrador)
  rs  constant uuid := '5b5d0000-0000-0000-0000-0000000000c4';  -- recepción de servicio (borrador)
  rr  constant uuid := '5b5d0000-0000-0000-0000-0000000000c5';  -- recepción que se registrará
  ev  text[] := ARRAY[]::text[];
  t   text;
  j   jsonb;
  n   numeric;
  rt1 text; rt2 text; rt3 text;
  fallos int;
  carpeta text;
BEGIN
  CREATE FUNCTION pg_temp.ck(p_lbl text, p_o text, p_e text) RETURNS text LANGUAGE sql IMMUTABLE AS
    $f$ SELECT CASE WHEN $2 IS NOT DISTINCT FROM $3 THEN 'OK    ' ELSE 'FALLO ' END || $1 || ' · obtenido=' || coalesce($2, 'NULL') || ' esperado=' || coalesce($3, 'NULL') $f$;
  CREATE FUNCTION pg_temp.ckn(p_lbl text, p_o numeric, p_e numeric) RETURNS text LANGUAGE sql IMMUTABLE AS
    $f$ SELECT CASE WHEN $2 IS NOT DISTINCT FROM $3 THEN 'OK    ' ELSE 'FALLO ' END || $1 || ' · obtenido=' || coalesce(trim_scale($2)::text, 'NULL') || ' esperado=' || coalesce($3::text, 'NULL') $f$;

  IF EXISTS (SELECT 1 FROM public.companies WHERE id IN (c, cz)) THEN
    RAISE EXCEPTION 'ABORTA: la empresa de prueba ya existe; no se escribe nada.';
  END IF;

  INSERT INTO public.companies (id, nombre, default_currency) VALUES (c, 'ZZ Correcciones C', 'gtq'), (cz, 'ZZ Otra empresa K', 'gtq');
  INSERT INTO public.projects (id, company_id, nombre) VALUES (pj, c, 'ZZ K Proyecto'), (pj2, c, 'ZZ K Otro proyecto'), (pjz, cz, 'ZZ K Proyecto otra empresa');
  INSERT INTO auth.users (id) VALUES (ua), (ub), (uo), (uk), (un), (uz);
  INSERT INTO public.app_users (id, company_id, full_name, role) VALUES
    (ua, c, 'ZZ K Admin', 'admin'), (ub, c, 'ZZ K Admin 2', 'admin'), (uo, c, 'ZZ K Operador', 'operator'),
    (uk, c, 'ZZ K Contador', 'operator'), (un, c, 'ZZ K Operador sin permisos', 'operator'), (uz, cz, 'ZZ K Admin otra', 'admin');
  INSERT INTO public.user_project_assignments (user_id, project_id, permission_type) VALUES
    (ua, pj, 'total'), (ub, pj, 'total'), (uo, pj, 'total'), (uk, pj, 'total'), (un, pj, 'total'), (uz, pjz, 'total');
  INSERT INTO public.roles (id, company_id, name) VALUES
    ('5b5d0000-0000-0000-0000-0000000000c9', c, 'ZZ K Contador'),
    ('5b5d0000-0000-0000-0000-0000000000c8', c, 'ZZ K Operador compras');
  INSERT INTO public.role_permissions (role_id, permission_key, effect) VALUES
    ('5b5d0000-0000-0000-0000-0000000000c9', 'platform.contabilidad.view',   'allow'),
    ('5b5d0000-0000-0000-0000-0000000000c9', 'platform.contabilidad.create', 'allow'),
    ('5b5d0000-0000-0000-0000-0000000000c9', 'platform.contabilidad.edit',   'allow'),
    ('5b5d0000-0000-0000-0000-0000000000c9', 'platform.contabilidad.delete', 'allow'),
    ('5b5d0000-0000-0000-0000-0000000000c8', 'condominios.tab.ordenes_compra', 'allow'),
    ('5b5d0000-0000-0000-0000-0000000000c8', 'condominios.tab.suministros',    'allow');
  INSERT INTO public.user_roles (user_id, role_id) VALUES
    (uk, '5b5d0000-0000-0000-0000-0000000000c9'), (uo, '5b5d0000-0000-0000-0000-0000000000c8');
  PERFORM public.conta_seed_catalogo(c, pj);
  PERFORM public.compras_seed_cuentas(c, pj);
  INSERT INTO public.proveedores (id, company_id, nombre, nit, pais, alcance)
    VALUES (pv, c, 'ZZ K Proveedor', '9999994-4', 'GT', 'empresa');

  PERFORM set_config('request.jwt.claim.sub', ua::text, true);
  SET LOCAL ROLE authenticated;
  UPDATE public.proveedores SET estado = 'autorizado' WHERE id = pv;

  -- ═══ A · PENDIENTES POR RENGLÓN ═════════════════════════════════════════════════════════
  INSERT INTO public.ordenes_compra (id, company_id, project_id, proveedor_id, proveedor_nombre, concepto) VALUES
    (o1, c, pj, pv, 'ZZ K Proveedor', 'Pendientes por renglón'), (o2, c, pj, pv, 'ZZ K Proveedor', 'Solo descuento');
  INSERT INTO public.orden_compra_lineas (id, company_id, orden_compra_id, linea, descripcion, destino_tipo, categoria, cantidad, unidad, precio_unitario, iva_monto) VALUES
    (l11, c, o1, 1, 'Renglón 1', 'gasto', 'mantenimiento', 10, 'u', 100, 0),
    (l12, c, o1, 2, 'Renglón 2', 'gasto', 'mantenimiento', 10, 'u', 100, 0),
    (l13, c, o1, 3, 'Renglón 3', 'gasto', 'mantenimiento', 10, 'u', 100, 0),
    (l21, c, o2, 1, 'Renglón único', 'gasto', 'mantenimiento', 10, 'u', 100, 0);
  UPDATE public.ordenes_compra SET estado = 'aprobada' WHERE id IN (o1, o2);
  UPDATE public.ordenes_compra SET estado = 'emitida'  WHERE id IN (o1, o2);
  INSERT INTO public.recepciones (id, company_id, project_id, orden_compra_id, tipo) VALUES (r1, c, pj, o1, 'bienes'), (r2, c, pj, o2, 'bienes');
  INSERT INTO public.recepcion_lineas (company_id, recepcion_id, orden_compra_linea_id, cantidad) VALUES
    (c, r1, l11, 10), (c, r1, l12, 10), (c, r1, l13, 10), (c, r2, l21, 10);
  UPDATE public.recepciones SET estado = 'registrada' WHERE id IN (r1, r2);

  PERFORM set_config('request.jwt.claim.sub', uk::text, true);
  j := public.compras_seguimiento_orden(o1);
  ev := ev || pg_temp.ckn('A1 · todo recibido y sin facturar: pendiente por facturar', (j->'indicadores'->>'pendiente_por_facturar')::numeric, 3000);
  -- DESCUENTO: todo el renglón de o2 facturado a 90 → pendiente 0 (antes quedaba 100).
  PERFORM public.compras_factura_crear(c, pj, jsonb_build_object('proveedor_id', pv, 'orden_compra_id', o2, 'numero_factura', 'ZZK-2', 'concepto', 'Descuento', 'clave_idempotencia', 'zzk-clave-2'),
    jsonb_build_array(jsonb_build_object('orden_compra_linea_id', l21, 'cantidad', 10, 'precio_unitario', 90, 'iva_monto', 0)));
  PERFORM set_config('request.jwt.claim.sub', ub::text, true);
  UPDATE public.facturas_proveedor SET estado = 'aprobada', match_forzado_por = ub, match_justificacion = 'Descuento por pronto pago pactado.' WHERE numero_factura = 'ZZK-2' AND company_id = c;
  PERFORM set_config('request.jwt.claim.sub', uk::text, true);
  j := public.compras_seguimiento_orden(o2);
  ev := ev || pg_temp.ckn('A2 · DESCUENTO con todas las cantidades facturadas: pendiente por facturar', (j->'indicadores'->>'pendiente_por_facturar')::numeric, 0);
  ev := ev || pg_temp.ckn('A2 · la diferencia de precio va aparte (90−100)×10', (j->'indicadores'->>'diferencia_precio_facturada')::numeric, -100);
  -- o1: renglón 1 con descuento y renglón 2 con sobreprecio autorizado, renglón 3 sin facturar.
  PERFORM public.compras_factura_crear(c, pj, jsonb_build_object('proveedor_id', pv, 'orden_compra_id', o1, 'numero_factura', 'ZZK-1', 'concepto', 'Renglón 1', 'clave_idempotencia', 'zzk-clave-1'),
    jsonb_build_array(jsonb_build_object('orden_compra_linea_id', l11, 'cantidad', 10, 'precio_unitario', 90, 'iva_monto', 0)));
  PERFORM public.compras_factura_crear(c, pj, jsonb_build_object('proveedor_id', pv, 'orden_compra_id', o1, 'numero_factura', 'ZZK-3', 'concepto', 'Renglón 2', 'clave_idempotencia', 'zzk-clave-3'),
    jsonb_build_array(jsonb_build_object('orden_compra_linea_id', l12, 'cantidad', 10, 'precio_unitario', 120, 'iva_monto', 0)));
  PERFORM set_config('request.jwt.claim.sub', ub::text, true);
  UPDATE public.facturas_proveedor SET estado = 'aprobada', match_forzado_por = ub, match_justificacion = 'Alza pactada por escrito con el proveedor.' WHERE numero_factura IN ('ZZK-1', 'ZZK-3') AND company_id = c;
  PERFORM set_config('request.jwt.claim.sub', uk::text, true);
  j := public.compras_seguimiento_orden(o1);
  ev := ev || pg_temp.ckn('A3 · SOBREPRECIO autorizado: el renglón 3 sigue pendiente completo (no se compensa)', (j->'indicadores'->>'pendiente_por_facturar')::numeric, 1000);
  ev := ev || pg_temp.ckn('A3 · diferencia de precio aparte (−100 + 200)', (j->'indicadores'->>'diferencia_precio_facturada')::numeric, 100);
  -- FACTURACIÓN PARCIAL del renglón 3: 4 de 10.
  PERFORM public.compras_factura_crear(c, pj, jsonb_build_object('proveedor_id', pv, 'orden_compra_id', o1, 'numero_factura', 'ZZK-4', 'concepto', 'Renglón 3 parcial', 'clave_idempotencia', 'zzk-clave-4'),
    jsonb_build_array(jsonb_build_object('orden_compra_linea_id', l13, 'cantidad', 4, 'precio_unitario', 100, 'iva_monto', 0)));
  PERFORM set_config('request.jwt.claim.sub', ua::text, true);
  UPDATE public.facturas_proveedor SET estado = 'aprobada' WHERE numero_factura = 'ZZK-4' AND company_id = c;
  PERFORM set_config('request.jwt.claim.sub', uk::text, true);
  j := public.compras_seguimiento_orden(o1);
  ev := ev || pg_temp.ckn('A4 · FACTURACIÓN PARCIAL: faltan 6 × 100', (j->'indicadores'->>'pendiente_por_facturar')::numeric, 600);
  SELECT s.pendiente_por_facturar INTO n FROM public.compras_seguimiento_lista(pj, NULL, NULL, NULL, NULL, false) s WHERE s.orden_id = o1;
  ev := ev || pg_temp.ckn('A4 · la lista coincide con el detalle', n, 600);
  -- Se factura el resto: pendiente CERO.
  PERFORM public.compras_factura_crear(c, pj, jsonb_build_object('proveedor_id', pv, 'orden_compra_id', o1, 'numero_factura', 'ZZK-5', 'concepto', 'Renglón 3 resto', 'clave_idempotencia', 'zzk-clave-5'),
    jsonb_build_array(jsonb_build_object('orden_compra_linea_id', l13, 'cantidad', 6, 'precio_unitario', 100, 'iva_monto', 0)));
  PERFORM set_config('request.jwt.claim.sub', ua::text, true);
  UPDATE public.facturas_proveedor SET estado = 'aprobada' WHERE numero_factura = 'ZZK-5' AND company_id = c;
  PERFORM set_config('request.jwt.claim.sub', uk::text, true);
  j := public.compras_seguimiento_orden(o1);
  ev := ev || pg_temp.ckn('A5 · todas las cantidades facturadas: pendiente por facturar', (j->'indicadores'->>'pendiente_por_facturar')::numeric, 0);
  ev := ev || pg_temp.ck('A5 · la orden se cierra sola', (SELECT estado FROM public.ordenes_compra WHERE id = o1), 'cerrada');
  -- Operaciones: nada financiero, ni en la lista ni en el detalle.
  PERFORM set_config('request.jwt.claim.sub', uo::text, true);
  j := public.compras_seguimiento_orden(o1);
  ev := ev || pg_temp.ck('A6 · Operaciones: pendiente por facturar y diferencia de precio NULL (detalle)',
    ((j->'indicadores'->'pendiente_por_facturar') = 'null'::jsonb AND (j->'indicadores'->'diferencia_precio_facturada') = 'null'::jsonb)::text, 'true');
  ev := ev || pg_temp.ck('A6 · Operaciones: lo mismo en la lista',
    (SELECT (s.pendiente_por_facturar IS NULL AND s.diferencia_precio_facturada IS NULL)::text FROM public.compras_seguimiento_lista(pj, NULL, NULL, NULL, NULL, false) s WHERE s.orden_id = o1), 'true');
  -- Otra empresa: nada.
  PERFORM set_config('request.jwt.claim.sub', uz::text, true);
  ev := ev || pg_temp.ck('A7 · otra empresa no ve la orden', (public.compras_seguimiento_orden(o1) IS NULL)::text, 'true');

  -- ═══ B · RESPALDOS: VALIDACIÓN EN SERVIDOR ══════════════════════════════════════════════
  PERFORM set_config('request.jwt.claim.sub', ua::text, true);
  INSERT INTO public.ordenes_compra (id, company_id, project_id, proveedor_id, proveedor_nombre, concepto) VALUES
    (ob, c, pj, pv, 'ZZ K Proveedor', 'Respaldos bienes'), (os, c, pj, pv, 'ZZ K Proveedor', 'Respaldos servicio');
  INSERT INTO public.orden_compra_lineas (id, company_id, orden_compra_id, linea, descripcion, destino_tipo, categoria, cantidad, unidad, precio_unitario, iva_monto) VALUES
    (lb, c, ob, 1, 'Renglón', 'gasto', 'mantenimiento', 5, 'u', 10, 0), (ls, c, os, 1, 'Servicio', 'servicio', 'mantenimiento', 1, 'servicio', 300, 0);
  UPDATE public.ordenes_compra SET estado = 'aprobada' WHERE id IN (ob, os);
  UPDATE public.ordenes_compra SET estado = 'emitida'  WHERE id IN (ob, os);
  INSERT INTO public.recepciones (id, company_id, project_id, orden_compra_id, tipo, recibido_por) VALUES
    (rb, c, pj, ob, 'bienes', NULL), (rs, c, pj, os, 'servicio', uk), (rr, c, pj, ob, 'bienes', NULL);
  INSERT INTO public.recepcion_lineas (company_id, recepcion_id, orden_compra_linea_id, cantidad) VALUES
    (c, rb, lb, 1), (c, rs, ls, 1), (c, rr, lb, 1);
  RESET ROLE;

  carpeta := c::text || '/' || pj::text || '/';
  rt1 := carpeta || rb::text || '/'; rt2 := carpeta || rs::text || '/'; rt3 := carpeta || rr::text || '/';
  -- Objetos que Storage habría guardado, con sus metadatos reales (se insertan como dueño y se revierten).
  INSERT INTO storage.objects (bucket_id, name, metadata) VALUES
    ('recepciones-respaldo', rt1  || 'ok-1.pdf', '{"size": 52000, "mimetype": "application/pdf"}'::jsonb),
    ('recepciones-respaldo', rt1  || 'ok-2.png', '{"size": 80000, "mimetype": "image/png"}'::jsonb),
    ('recepciones-respaldo', rt1  || 'ok-3.pdf', '{"size": 1000,  "mimetype": "application/pdf"}'::jsonb),
    ('recepciones-respaldo', rt2 || 'acta.pdf', '{"size": 30000, "mimetype": "application/pdf"}'::jsonb),
    ('recepciones-respaldo', rt3 || 'rem.pdf',  '{"size": 20000, "mimetype": "application/pdf"}'::jsonb),
    ('recepciones-respaldo', rt3 || 'rem-2.pdf','{"size": 20001, "mimetype": "application/pdf"}'::jsonb);

  PERFORM set_config('request.jwt.claim.sub', uo::text, true);
  SET LOCAL ROLE authenticated;
  -- B1 · INSERT directo de evidencia inexistente: rechazado. También por la RPC.
  BEGIN INSERT INTO public.recepcion_respaldos (recepcion_id, ruta, nombre, tipo, mime, bytes, sha256)
        VALUES (rb, rt1 || 'fantasma.pdf', 'fantasma.pdf', 'entrega', 'application/pdf', 100, repeat('a', 64)); t := 'SIN ERROR';
  EXCEPTION WHEN OTHERS THEN t := split_part(SQLERRM, ':', 1); END;
  ev := ev || pg_temp.ck('B1 · INSERT directo de un archivo que no existe en el almacenamiento', t, 'COMPRAS_RESPALDO_OBJETO');
  BEGIN PERFORM public.compras_recepcion_adjuntar(rb, rt1 || 'fantasma.pdf', 'fantasma.pdf', 'application/pdf', 100, repeat('a', 64), 'entrega'); t := 'SIN ERROR';
  EXCEPTION WHEN OTHERS THEN t := split_part(SQLERRM, ':', 1); END;
  ev := ev || pg_temp.ck('B1 · la RPC: el mismo rechazo', t, 'COMPRAS_RESPALDO_OBJETO');
  -- B3 · metadatos.
  BEGIN INSERT INTO public.recepcion_respaldos (recepcion_id, ruta, nombre, tipo, mime, bytes, sha256)
        VALUES (rb, rt1 || 'ok-1.pdf', 'ok-1.pdf', 'entrega', 'application/pdf', 99999, repeat('a', 64)); t := 'SIN ERROR';
  EXCEPTION WHEN OTHERS THEN t := split_part(SQLERRM, ':', 1); END;
  ev := ev || pg_temp.ck('B3 · tamaño declarado distinto del almacenado', t, 'COMPRAS_RESPALDO_METADATOS');
  BEGIN INSERT INTO public.recepcion_respaldos (recepcion_id, ruta, nombre, tipo, mime, bytes, sha256)
        VALUES (rb, rt1 || 'ok-1.pdf', 'ok-1.pdf', 'entrega', 'image/png', 52000, repeat('a', 64)); t := 'SIN ERROR';
  EXCEPTION WHEN OTHERS THEN t := split_part(SQLERRM, ':', 1); END;
  ev := ev || pg_temp.ck('B3 · tipo MIME declarado distinto del almacenado', t, 'COMPRAS_RESPALDO_METADATOS');
  -- B4 · rutas.
  BEGIN INSERT INTO public.recepcion_respaldos (recepcion_id, ruta, nombre, tipo, mime, bytes, sha256)
        VALUES (rb, rt3 || 'rem.pdf', 'rem.pdf', 'entrega', 'application/pdf', 20000, repeat('a', 64)); t := 'SIN ERROR';
  EXCEPTION WHEN OTHERS THEN t := split_part(SQLERRM, ':', 1); END;
  ev := ev || pg_temp.ck('B4 · la ruta es de OTRA recepción (aunque el objeto exista)', t, 'COMPRAS_RESPALDO_RUTA');
  BEGIN INSERT INTO public.recepcion_respaldos (recepcion_id, ruta, nombre, tipo, mime, bytes, sha256)
        VALUES (rb, rt1 || '../' || rr::text || '/rem.pdf', 'x.pdf', 'entrega', 'application/pdf', 100, repeat('a', 64)); t := 'SIN ERROR';
  EXCEPTION WHEN OTHERS THEN t := split_part(SQLERRM, ':', 1); END;
  ev := ev || pg_temp.ck('B4 · recorrido de directorios (..)', t, 'COMPRAS_RESPALDO_RUTA');
  -- B5 · tipos.
  BEGIN INSERT INTO public.recepcion_respaldos (recepcion_id, ruta, nombre, tipo, mime, bytes, sha256)
        VALUES (rb, rt1 || 'ok-1.pdf', 'ok-1.pdf', 'conformidad', 'application/pdf', 52000, repeat('a', 64)); t := 'SIN ERROR';
  EXCEPTION WHEN OTHERS THEN t := split_part(SQLERRM, ':', 1); END;
  ev := ev || pg_temp.ck('B5 · «conformidad» en bienes, por INSERT directo', t, 'COMPRAS_RESPALDO_TIPO');
  BEGIN INSERT INTO public.recepcion_respaldos (recepcion_id, ruta, nombre, tipo, mime, bytes, sha256)
        VALUES (rs, rt2 || 'acta.pdf', 'acta.pdf', 'entrega', 'application/pdf', 30000, repeat('a', 64)); t := 'SIN ERROR';
  EXCEPTION WHEN OTHERS THEN t := split_part(SQLERRM, ':', 1); END;
  ev := ev || pg_temp.ck('B5 · «entrega» en un servicio, por INSERT directo', t, 'COMPRAS_RESPALDO_TIPO');
  -- B6 · camino feliz por INSERT directo: el servidor fija quién, cuándo y la empresa.
  INSERT INTO public.recepcion_respaldos (recepcion_id, ruta, nombre, tipo, mime, bytes, sha256, created_by, company_id)
  VALUES (rb, rt1 || 'ok-1.pdf', 'Remisión 1.pdf', 'entrega', 'application/pdf', 52000, repeat('a', 64), ub, cz);
  ev := ev || pg_temp.ck('B6 · INSERT directo válido: quién y empresa los fija el servidor', (SELECT (created_by = uo AND company_id = c)::text FROM public.recepcion_respaldos WHERE recepcion_id = rb), 'true');
  ev := ev || pg_temp.ck('B6 · el primer archivo pasa a ser el respaldo principal', (SELECT (respaldo_path = rt1 || 'ok-1.pdf')::text FROM public.recepciones WHERE id = rb), 'true');
  -- B7 · alcance: operador sin permiso y otra empresa.
  PERFORM set_config('request.jwt.claim.sub', un::text, true);
  BEGIN INSERT INTO public.recepcion_respaldos (recepcion_id, ruta, nombre, tipo, mime, bytes, sha256)
        VALUES (rb, rt1 || 'ok-2.png', 'ok-2.png', 'entrega', 'image/png', 80000, repeat('b', 64)); t := 'SIN ERROR';
  EXCEPTION WHEN OTHERS THEN t := 'RECHAZADO'; END;
  ev := ev || pg_temp.ck('B7 · un operador SIN permiso de órdenes no registra evidencia', t, 'RECHAZADO');
  ev := ev || pg_temp.ckn('B7 · y no ve la evidencia', (SELECT count(*) FROM public.recepcion_respaldos), 0);
  PERFORM set_config('request.jwt.claim.sub', uz::text, true);
  BEGIN INSERT INTO public.recepcion_respaldos (recepcion_id, ruta, nombre, tipo, mime, bytes, sha256)
        VALUES (rb, rt1 || 'ok-2.png', 'ok-2.png', 'entrega', 'image/png', 80000, repeat('b', 64)); t := 'SIN ERROR';
  EXCEPTION WHEN OTHERS THEN t := 'RECHAZADO'; END;
  ev := ev || pg_temp.ck('B7 · el admin de OTRA empresa tampoco (INSERT directo)', t, 'RECHAZADO');
  BEGIN PERFORM public.compras_recepcion_adjuntar(rb, rt1 || 'ok-2.png', 'ok-2.png', 'image/png', 80000, repeat('b', 64), 'entrega'); t := 'SIN ERROR';
  EXCEPTION WHEN OTHERS THEN t := split_part(SQLERRM, ':', 1); END;
  ev := ev || pg_temp.ck('B7 · ni por la RPC', t, 'COMPRAS_RESPALDO_RECEPCION');
  -- B8 · la referencia principal.
  PERFORM set_config('request.jwt.claim.sub', uo::text, true);
  BEGIN PERFORM public.compras_recepcion_crear(c, pj,
          jsonb_build_object('orden_compra_id', ob, 'tipo', 'bienes', 'clave_idempotencia', 'zzk-ref', 'respaldo_path', carpeta || 'inexistente/x.pdf'),
          jsonb_build_array(jsonb_build_object('orden_compra_linea_id', lb, 'cantidad', 1))); t := 'SIN ERROR';
  EXCEPTION WHEN OTHERS THEN t := split_part(SQLERRM, ':', 1); END;
  ev := ev || pg_temp.ck('B8 · crear una recepción con respaldo_path (RPC)', t, 'COMPRAS_RESPALDO_REFERENCIA');
  PERFORM set_config('request.jwt.claim.sub', ua::text, true);
  BEGIN UPDATE public.recepciones SET respaldo_path = 'cualquier/cosa.pdf' WHERE id = rb; t := 'SIN ERROR';
  EXCEPTION WHEN OTHERS THEN t := split_part(SQLERRM, ':', 1); END;
  ev := ev || pg_temp.ck('B8 · UPDATE del borrador hacia una ruta no registrada', t, 'COMPRAS_RESPALDO_REFERENCIA');
  -- B9 · adjuntar varios archivos: el principal es el PRIMERO. El retiro del principal se prueba en
  -- el arnés local (run.sh, B9/B10/P) y por pantalla en el sandbox: el ejecutor de SQL de este entorno pide
  -- confirmación humana para los borrados, así que este guion no los emite.
  PERFORM set_config('request.jwt.claim.sub', uo::text, true);
  PERFORM public.compras_recepcion_adjuntar(rb, rt1 || 'ok-2.png', 'Foto.png', 'image/png', 80000, repeat('b', 64), 'entrega');
  PERFORM public.compras_recepcion_adjuntar(rb, rt1 || 'ok-3.pdf', 'Otra.pdf', 'application/pdf', 1000, repeat('c', 64), 'entrega');
  ev := ev || pg_temp.ck('B9 · con tres archivos el principal sigue siendo el primero', (SELECT (respaldo_path = rt1 || 'ok-1.pdf')::text FROM public.recepciones WHERE id = rb), 'true');
  ev := ev || pg_temp.ckn('B9 · y los tres están registrados', (SELECT count(*) FROM public.recepcion_respaldos WHERE recepcion_id = rb), 3);
  PERFORM public.compras_recepcion_adjuntar(rr, rt3 || 'rem.pdf', 'Rem.pdf', 'application/pdf', 20000, repeat('d', 64), 'entrega');
  PERFORM set_config('request.jwt.claim.sub', ua::text, true);
  UPDATE public.recepciones SET estado = 'registrada' WHERE id = rr;
  PERFORM set_config('request.jwt.claim.sub', uo::text, true);
  PERFORM public.compras_recepcion_adjuntar(rr, rt3 || 'rem-2.pdf', 'Rem 2.pdf', 'application/pdf', 20001, repeat('e', 64), 'entrega');
  ev := ev || pg_temp.ckn('B10 · con la recepción registrada se puede AÑADIR evidencia', (SELECT count(*) FROM public.recepcion_respaldos WHERE recepcion_id = rr), 2);
  BEGIN UPDATE public.recepcion_respaldos SET nombre = 'cambiado' WHERE recepcion_id = rr; t := 'SIN ERROR';
  EXCEPTION WHEN OTHERS THEN t := 'RECHAZADO'; END;
  ev := ev || pg_temp.ck('B10 · editar una evidencia', t, 'RECHAZADO');
  PERFORM set_config('request.jwt.claim.sub', ua::text, true);
  BEGIN UPDATE public.recepciones SET respaldo_path = NULL WHERE id = rr; t := 'SIN ERROR';
  EXCEPTION WHEN OTHERS THEN t := split_part(SQLERRM, ':', 1); END;
  ev := ev || pg_temp.ck('B10 · limpiar la referencia de una recepción registrada', t, 'COMPRAS_RECEPCION_RESPALDO_CONGELADO');
  RESET ROLE;
  -- B11 · reintentos.
  PERFORM set_config('request.jwt.claim.sub', uo::text, true);
  SET LOCAL ROLE authenticated;
  ev := ev || pg_temp.ck('B11 · reintentar el mismo archivo devuelve el existente',
    (public.compras_recepcion_adjuntar(rr, rt3 || 'rem.pdf', 'Rem.pdf', 'application/pdf', 20000, repeat('d', 64), 'entrega')->>'reutilizado'), 'true');
  BEGIN PERFORM public.compras_recepcion_adjuntar(rr, rt3 || 'rem.pdf', 'Rem.pdf', 'application/pdf', 20000, repeat('9', 64), 'entrega'); t := 'SIN ERROR';
  EXCEPTION WHEN OTHERS THEN t := split_part(SQLERRM, ':', 1); END;
  ev := ev || pg_temp.ck('B11 · la misma ruta con otro contenido', t, 'COMPRAS_RESPALDO_CONFLICTO');
  ev := ev || pg_temp.ckn('B11 · los reintentos no duplican', (SELECT count(*) FROM public.recepcion_respaldos WHERE recepcion_id = rr), 2);
  -- B12 · conformidad de servicio.
  ev := ev || pg_temp.ck('B12 · la conformidad de un servicio se registra con su tipo',
    public.compras_recepcion_adjuntar(rs, rt2 || 'acta.pdf', 'Acta.pdf', 'application/pdf', 30000, repeat('a', 64), 'conformidad')->'respaldo'->>'tipo', 'conformidad');

  RESET ROLE;
  -- C · el índice de inventario existe, es único y válido (la migración 0200 lo exige).
  ev := ev || pg_temp.ck('C1 · índice de inventario único, válido y listo',
    (SELECT (i.indisvalid AND i.indisready AND i.indisunique)::text FROM pg_index i WHERE i.indexrelid = 'public.uq_mov_suministro_origen_recepcion'::regclass), 'true');

  SELECT count(*) INTO fallos FROM unnest(ev) e WHERE e LIKE 'FALLO%';
  RAISE EXCEPTION '%', (CASE WHEN fallos = 0 THEN 'GUION_OK_REVERTIDO' ELSE 'GUION_FALLO' END)
    || ' · ' || array_length(ev, 1) || ' comprobaciones, ' || fallos || ' fallos' || E'\n' || array_to_string(ev, E'\n');
END;
$guion$;
