-- ============================================================================
-- VALIDACIÓN EN SANDBOX · PERMISOS POR ACCIÓN, CATÁLOGO Y PRIVILEGIOS (migración 20261027000900) · archivo 1 de 2.
-- «API directa»: DML como `authenticated` con el sub del JWT fijado (lo que ejecuta PostgREST); sin RPC de ayuda (solo las reales:
-- compras_separacion_configurar y compras_factura_crear). UNA sola sentencia (DO) que TERMINA SIEMPRE con una excepción que REVIERTE todo:
-- GUION_OK_REVERTIDO · GUION_FALLO (alguna comprobación no coincide) · otro (fallo del recorrido). Sin DROP ni DELETE suelto. Padrón de usar y
-- tirar `5b71…` (empresas «ZZ Permisos C» y «ZZ Permisos D»). Se parte en dos archivos para que cada uno quepa en una llamada de la herramienta SQL
-- del sandbox; cada uno crea y revierte su propio padrón y puede correr solo, en cualquier orden.
-- Cubre: las seis acciones una por una (con y sin proyecto, genéricos sin la llave, otra empresa, INSERT de orden ya aprobada), cero filas, catálogo y privilegios.
-- ============================================================================
DO $guion$
DECLARE
  c   constant uuid := '5b710000-0000-0000-0000-00000000000c';
  d   constant uuid := '5b710000-0000-0000-0000-00000000000d';
  pj  constant uuid := '5b710000-0000-0000-0000-0000000000a1';  -- proyecto C1
  pj2 constant uuid := '5b710000-0000-0000-0000-0000000000a2';  -- proyecto C2 (solo el administrador está asignado)
  pjd constant uuid := '5b710000-0000-0000-0000-0000000000a3';
  pv  constant uuid := '5b710000-0000-0000-0000-0000000000b1';
  pv2 constant uuid := '5b710000-0000-0000-0000-0000000000b2';
  pvd constant uuid := '5b710000-0000-0000-0000-0000000000b3';
  ua  constant uuid := '5b710000-0000-0000-0000-0000000000f1';  -- administrador de C (asignado a C1 y C2)
  ue  constant uuid := '5b710000-0000-0000-0000-0000000000f2';  -- editor: ver/crear/editar/eliminar, ninguna llave de acción
  ug  constant uuid := '5b710000-0000-0000-0000-0000000000f3';  -- «Autorizar» y «Cambiar estado» genéricos, SIN las llaves nuevas
  uo  constant uuid := '5b710000-0000-0000-0000-0000000000f4';  -- propietario de C
  usa constant uuid := '5b710000-0000-0000-0000-0000000000f5';  -- superadministrador (de D)
  ud  constant uuid := '5b710000-0000-0000-0000-0000000000f6';  -- administrador de D
  uz  constant uuid := '5b710000-0000-0000-0000-0000000000f7';  -- operador de D con TODAS las llaves y los genéricos
  ucr constant uuid := '5b710000-0000-0000-0000-0000000000f8';  -- solicitante: ver/crear/editar + la llave de la orden
  v_k    constant text[] := ARRAY['condominios.tab.ordenes_compra.approve', 'platform.contabilidad.compras.recepcion_registrar',
    'platform.contabilidad.compras.factura_aprobar', 'platform.contabilidad.compras.orden_pago_aprobar',
    'platform.contabilidad.compras.pago_ejecutar', 'platform.contabilidad.compras.pago_anular'];
  v_cl   constant text[] := ARRAY['oc.approve', 'recepcion_registrar', 'factura_aprobar', 'orden_pago_aprobar', 'pago_ejecutar', 'pago_anular'];
  v_nom  constant text[] := ARRAY['aprobar la OC', 'registrar la recepción', 'aprobar la factura', 'aprobar la orden de pago', 'ejecutar el pago', 'anular el pago'];
  v_base constant text[] := ARRAY['platform.contabilidad.view', 'platform.contabilidad.create', 'platform.contabilidad.edit'];
  v_fn   text[];
  sq text[]; sqt text[] := ARRAY[]::text[]; vf text[]; ex text[];
  ev text[] := ARRAY[]::text[];
  r text; sql_ins text; i int; j int; fallos int; tr int; n1 int; n2 int; n3 int;
BEGIN
  CREATE FUNCTION pg_temp.ck(p_lbl text, p_o text, p_e text) RETURNS text LANGUAGE sql IMMUTABLE AS
    $f$ SELECT CASE WHEN $2 IS NOT DISTINCT FROM $3 THEN 'OK    ' || $1 || ' · obtenido=esperado=' || coalesce($2, 'NULL')
                    ELSE 'FALLO ' || $1 || ' · obtenido=' || coalesce($2, 'NULL') || ' esperado=' || coalesce($3, 'NULL') END $f$;
  -- Sentencia que DEBE fallar; si NO falla informa «SIN ERROR» y REVIERTE su efecto.
  CREATE FUNCTION pg_temp.err(p text) RETURNS text LANGUAGE plpgsql AS
    $f$ BEGIN EXECUTE p; RAISE EXCEPTION 'SIN_ERROR_REVERTIDO';
        EXCEPTION WHEN OTHERS THEN IF SQLERRM = 'SIN_ERROR_REVERTIDO' THEN RETURN 'SIN ERROR'; END IF; RETURN split_part(SQLERRM, ':', 1); END $f$;
  -- Sentencia como esa persona, REVIERTE siempre. Devuelve el rechazo («COMPRAS_…»), «0 FILAS» si no afectó ninguna (ROW_COUNT: la pantalla
  -- no debe mostrar éxito), lo que lea p_verif DESPUÉS de la sentencia, o «PASA n».
  CREATE FUNCTION pg_temp.prueba(p_uid uuid, p text, p_verif text DEFAULT NULL) RETURNS text LANGUAGE plpgsql AS
    $f$ DECLARE r text; n bigint; BEGIN
        PERFORM set_config('request.jwt.claim.sub', p_uid::text, true);
        BEGIN
          EXECUTE 'SET LOCAL ROLE authenticated';
          EXECUTE p;
          GET DIAGNOSTICS n = ROW_COUNT;
          EXECUTE 'RESET ROLE';
          r := CASE WHEN n = 0 THEN '0 FILAS' ELSE 'PASA ' || n END;
          IF n > 0 AND p_verif IS NOT NULL THEN EXECUTE p_verif INTO r; END IF;
          RAISE EXCEPTION 'REVERTIDO_PRUEBA';
        EXCEPTION WHEN OTHERS THEN
          IF SQLERRM <> 'REVERTIDO_PRUEBA' THEN r := split_part(SQLERRM, ':', 1); END IF;
        END;
        PERFORM set_config('request.jwt.claim.sub', '', true);
        RETURN r; END $f$;
  CREATE FUNCTION pg_temp.entra(p_uid uuid) RETURNS void LANGUAGE plpgsql AS
    $f$ BEGIN PERFORM set_config('request.jwt.claim.sub', p_uid::text, true); EXECUTE 'SET LOCAL ROLE authenticated'; END $f$;
  CREATE FUNCTION pg_temp.sale() RETURNS void LANGUAGE plpgsql AS
    $f$ BEGIN EXECUTE 'RESET ROLE'; PERFORM set_config('request.jwt.claim.sub', '', true); END $f$;
  CREATE FUNCTION pg_temp.q(p text) RETURNS text LANGUAGE plpgsql AS $f$ DECLARE r text; BEGIN EXECUTE p INTO r; RETURN r; END $f$;
  CREATE FUNCTION pg_temp.id(p int) RETURNS uuid LANGUAGE sql IMMUTABLE AS $f$ SELECT ('5b710000-0000-0000-0000-' || lpad(to_hex(p), 12, '0'))::uuid $f$;
  CREATE FUNCTION pg_temp.d(n int, k int) RETURNS uuid LANGUAGE sql IMMUTABLE AS $f$ SELECT pg_temp.id(4096 + n * 16 + k) $f$;
  -- Cadena de documentos de C hasta el paso pedido (1 orden en borrador · 2 emitida · 3 recepción en borrador · 4 registrada · 5 factura
  -- registrada · 6 factura aprobada), armada por la sesión actual (un administrador). Un servicio de 1 × 100.
  CREATE FUNCTION pg_temp.cadena(n int, hasta int, p_pj uuid, p_pv uuid) RETURNS void LANGUAGE plpgsql AS
    $f$ DECLARE c constant uuid := '5b710000-0000-0000-0000-00000000000c';
        oc uuid := pg_temp.d(n, 0); lin uuid := pg_temp.d(n, 1); rc uuid := pg_temp.d(n, 2); fc uuid := pg_temp.d(n, 3);
    BEGIN
      INSERT INTO public.ordenes_compra (id, company_id, project_id, proveedor_id, proveedor_nombre, concepto) VALUES (oc, c, p_pj, p_pv, 'ZZ PP Proveedor C', 'ZZ cadena ' || n);
      INSERT INTO public.orden_compra_lineas (id, company_id, orden_compra_id, linea, descripcion, destino_tipo, categoria, cantidad, unidad, precio_unitario, iva_monto)
        VALUES (lin, c, oc, 1, 'Servicio', 'servicio', 'servicios', 1, 'servicio', 100, 0);
      IF hasta >= 2 THEN UPDATE public.ordenes_compra SET estado = 'aprobada' WHERE id = oc; UPDATE public.ordenes_compra SET estado = 'emitida' WHERE id = oc; END IF;
      IF hasta >= 3 THEN
        INSERT INTO public.recepciones (id, company_id, project_id, orden_compra_id, tipo, recibido_por) VALUES (rc, c, p_pj, oc, 'servicio', auth.uid());
        INSERT INTO public.recepcion_lineas (company_id, recepcion_id, orden_compra_linea_id, cantidad) VALUES (c, rc, lin, 1);
      END IF;
      IF hasta >= 4 THEN UPDATE public.recepciones SET estado = 'registrada' WHERE id = rc; END IF;
      IF hasta >= 5 THEN
        INSERT INTO public.facturas_proveedor (id, company_id, project_id, proveedor_id, orden_compra_id, numero_factura, concepto, monto_total) VALUES (fc, c, p_pj, p_pv, oc, 'ZZ-PP-' || n, 'ZZ factura', 1);
        INSERT INTO public.factura_proveedor_lineas (company_id, factura_id, orden_compra_linea_id, linea, descripcion, cantidad, precio_unitario, iva_monto) VALUES (c, fc, lin, 1, 'Servicio', 1, 100, 0);
      END IF;
      IF hasta >= 6 THEN UPDATE public.facturas_proveedor SET estado = 'aprobada' WHERE id = fc; END IF;
    END $f$;

  IF EXISTS (SELECT 1 FROM public.companies WHERE id IN (c, d)) THEN
    RAISE EXCEPTION 'ABORTA: las empresas de prueba ya existen; no se escribe nada.';
  END IF;

  -- ═══ 0 · PADRÓN (de usar y tirar) ════════════════════════════════════════════════
  INSERT INTO public.companies (id, nombre, default_currency) VALUES (c, 'ZZ Permisos C', 'gtq'), (d, 'ZZ Permisos D', 'gtq');
  INSERT INTO public.projects (id, company_id, nombre) VALUES (pj, c, 'ZZ PP Proyecto C1'), (pj2, c, 'ZZ PP Proyecto C2'), (pjd, d, 'ZZ PP Proyecto D');
  INSERT INTO auth.users (id) SELECT pg_temp.id(g) FROM (SELECT generate_series(241, 248) g UNION ALL SELECT generate_series(257, 262) UNION ALL SELECT generate_series(513, 518)) s;
  INSERT INTO public.app_users (id, company_id, full_name, role) VALUES
    (ua, c, 'ZZ PP Admin C', 'admin'), (ue, c, 'ZZ PP Editor', 'operator'), (ug, c, 'ZZ PP Genéricos', 'operator'), (uo, c, 'ZZ PP Propietario C', 'company_owner'),
    (usa, d, 'ZZ PP Superadmin', 'super_admin'), (ud, d, 'ZZ PP Admin D', 'admin'), (uz, d, 'ZZ PP Operador D', 'operator'), (ucr, c, 'ZZ PP Solicitante', 'operator');
  INSERT INTO public.app_users (id, company_id, full_name, role) SELECT pg_temp.id(256 + g), c, 'ZZ PP k' || g || ' solo la llave', 'operator' FROM generate_series(1, 6) g;
  INSERT INTO public.app_users (id, company_id, full_name, role) SELECT pg_temp.id(512 + g), c, 'ZZ PP x' || g || ' llave sin proyecto', 'operator' FROM generate_series(1, 6) g;
  INSERT INTO public.user_project_assignments (user_id, project_id, permission_type) VALUES
    (ua, pj, 'total'), (ua, pj2, 'total'), (ue, pj, 'total'), (ug, pj, 'total'), (ucr, pj, 'total'), (ud, pjd, 'total'), (uz, pjd, 'total');
  INSERT INTO public.user_project_assignments (user_id, project_id, permission_type) SELECT pg_temp.id(256 + g), pj, 'total' FROM generate_series(1, 6) g;   -- los x no tienen ninguna
  INSERT INTO public.roles (id, company_id, name) SELECT pg_temp.id(1024 + g), c, 'ZZ PP solo la llave ' || g FROM generate_series(1, 6) g;
  INSERT INTO public.roles (id, company_id, name) SELECT pg_temp.id(1280 + g), c, 'ZZ PP llave sin proyecto ' || g FROM generate_series(1, 6) g;
  INSERT INTO public.roles (id, company_id, name) VALUES (pg_temp.id(1537), c, 'ZZ PP editor'), (pg_temp.id(1538), c, 'ZZ PP genéricos'),
    (pg_temp.id(1539), c, 'ZZ PP solicitante'), (pg_temp.id(1540), d, 'ZZ PP operador D');
  INSERT INTO public.role_permissions (role_id, permission_key, effect)
    SELECT pg_temp.id(1024 + g), p, 'allow' FROM generate_series(1, 6) g, unnest(v_base || v_k[g]) p
    UNION ALL SELECT pg_temp.id(1280 + g), p, 'allow' FROM generate_series(1, 6) g, unnest(v_base || v_k[g]) p
    UNION ALL SELECT pg_temp.id(1537), p, 'allow' FROM unnest(v_base || 'platform.contabilidad.delete'::text) p
    UNION ALL SELECT pg_temp.id(1538), p, 'allow' FROM unnest(v_base || ARRAY['platform.contabilidad.approve', 'platform.contabilidad.change_status']) p
    UNION ALL SELECT pg_temp.id(1539), p, 'allow' FROM unnest(v_base || v_k[1]) p
    UNION ALL SELECT pg_temp.id(1540), p, 'allow' FROM unnest(v_base || ARRAY['platform.contabilidad.approve', 'platform.contabilidad.change_status'] || v_k) p;
  INSERT INTO public.user_roles (user_id, role_id)
    SELECT pg_temp.id(256 + g), pg_temp.id(1024 + g) FROM generate_series(1, 6) g
    UNION ALL SELECT pg_temp.id(512 + g), pg_temp.id(1280 + g) FROM generate_series(1, 6) g
    UNION ALL VALUES (ue, pg_temp.id(1537)), (ug, pg_temp.id(1538)), (ucr, pg_temp.id(1539)), (uz, pg_temp.id(1540));
  PERFORM public.conta_seed_catalogo(c, pj);
  PERFORM public.compras_seed_cuentas(c, pj);
  PERFORM public.conta_seed_catalogo(d, pjd);
  PERFORM public.compras_seed_cuentas(d, pjd);
  INSERT INTO public.proveedores (id, company_id, nombre, nit, pais, alcance) VALUES
    (pv, c, 'ZZ PP Proveedor C', '9999971-1', 'GT', 'empresa'), (pv2, c, 'ZZ PP Proveedor C2', '9999972-2', 'GT', 'empresa'), (pvd, d, 'ZZ PP Proveedor D', '9999973-3', 'GT', 'empresa');
  PERFORM pg_temp.entra(ua);
  UPDATE public.proveedores SET estado = 'autorizado' WHERE id IN (pv, pv2);
  PERFORM pg_temp.sale();
  PERFORM pg_temp.entra(ud);
  UPDATE public.proveedores SET estado = 'autorizado' WHERE id = pvd;
  PERFORM pg_temp.sale();

  -- Las seis acciones: sentencia por id, la misma SIN filtro de fila, qué leer después y qué se espera. Documentos: d(0,0) orden en borrador de C1
  -- · d(1,2) recepción en borrador · d(2,3) factura registrada · d(3,4) orden de pago aprobada · d(3,5) orden de pago en borrador · d(9,0) orden de C2.
  sq := ARRAY[
    format($q$UPDATE public.ordenes_compra SET estado = 'aprobada' WHERE id = %L$q$, pg_temp.d(0, 0)),
    format($q$UPDATE public.recepciones SET estado = 'registrada' WHERE id = %L$q$, pg_temp.d(1, 2)),
    format($q$UPDATE public.facturas_proveedor SET estado = 'aprobada' WHERE id = %L$q$, pg_temp.d(2, 3)),
    format($q$UPDATE public.ordenes_pago SET estado = 'aprobada' WHERE id = %L$q$, pg_temp.d(3, 5)),
    format($q$UPDATE public.ordenes_pago SET estado = 'pagada', fecha_pago = CURRENT_DATE WHERE id = %L$q$, pg_temp.d(3, 4)),
    format($q$UPDATE public.ordenes_pago SET estado = 'anulada' WHERE id = %L$q$, pg_temp.d(3, 4))];
  FOR j IN 1..6 LOOP sqt := sqt || regexp_replace(sq[j], ' WHERE id = .*$', ' WHERE true'); END LOOP;
  vf := ARRAY[
    format($q$SELECT estado || '/' || coalesce(aprobada_por::text, '') FROM public.ordenes_compra WHERE id = %L$q$, pg_temp.d(0, 0)),
    format($q$SELECT estado FROM public.recepciones WHERE id = %L$q$, pg_temp.d(1, 2)),
    format($q$SELECT estado FROM public.facturas_proveedor WHERE id = %L$q$, pg_temp.d(2, 3)),
    format($q$SELECT estado || '/' || coalesce(aprobada_por::text, '') FROM public.ordenes_pago WHERE id = %L$q$, pg_temp.d(3, 5)),
    format($q$SELECT o.estado || '/' || f.monto_pagado FROM public.ordenes_pago o JOIN public.facturas_proveedor f ON f.id = o.factura_id WHERE o.id = %L$q$, pg_temp.d(3, 4)),
    format($q$SELECT estado FROM public.ordenes_pago WHERE id = %L$q$, pg_temp.d(3, 4))];
  ex := ARRAY['aprobada/{u}', 'registrada', 'aprobada', 'aprobada/{u}', 'pagada/30.00', 'anulada'];

  -- ═══ 1 · PERMISOS POR ACCIÓN · armado de los documentos y alcance de proyecto (UPDATE sin filtro de fila) ═══
  -- 1.3 · la llave SIN asignación al proyecto: el UPDATE que no lee columnas de la fila (no pasa por la política SELECT) llega a documentos de
  --       C1 y solo el servidor lo frena. Cada prueba va cuando la tabla solo tiene filas que dan el MISMO rechazo (orden de la fila indiferente).
  PERFORM pg_temp.entra(ua);
  PERFORM pg_temp.cadena(0, 1, pj, pv);
  PERFORM pg_temp.cadena(9, 1, pj2, pv);
  PERFORM pg_temp.sale();
  ev := ev || pg_temp.ck('1.3.1 · llave sin asignación al proyecto, UPDATE sin filtro de fila: ' || v_nom[1], pg_temp.prueba(pg_temp.id(513), sqt[1]), 'COMPRAS_ALCANCE_PROYECTO');
  PERFORM pg_temp.entra(ua);
  PERFORM pg_temp.cadena(1, 3, pj, pv);                                  -- orden emitida + recepción en borrador
  PERFORM pg_temp.cadena(2, 5, pj, pv);                                  -- ... + factura registrada
  PERFORM pg_temp.cadena(3, 6, pj, pv);                                  -- ... + factura aprobada
  INSERT INTO public.ordenes_pago (id, company_id, project_id, proveedor_id, factura_id, monto) VALUES (pg_temp.d(3, 4), c, pj, pv, pg_temp.d(3, 3), 30);
  UPDATE public.ordenes_pago SET estado = 'aprobada' WHERE id = pg_temp.d(3, 4);
  PERFORM pg_temp.sale();
  FOREACH j IN ARRAY ARRAY[2, 3, 5, 6] LOOP
    ev := ev || pg_temp.ck(format('1.3.%s · llave sin asignación al proyecto, UPDATE sin filtro de fila: %s', j, v_nom[j]), pg_temp.prueba(pg_temp.id(512 + j), sqt[j]), 'COMPRAS_ALCANCE_PROYECTO');
  END LOOP;
  PERFORM pg_temp.entra(ua);
  INSERT INTO public.ordenes_pago (id, company_id, project_id, proveedor_id, factura_id, monto) VALUES (pg_temp.d(3, 5), c, pj, pv, pg_temp.d(3, 3), 30);
  PERFORM pg_temp.sale();
  ev := ev || pg_temp.ck('1.3.4 · llave sin asignación al proyecto, UPDATE sin filtro de fila: ' || v_nom[4], pg_temp.prueba(pg_temp.id(516), sqt[4]), 'COMPRAS_ALCANCE_PROYECTO');

  -- 1.1 · la matriz: la persona con SOLO la llave i (más ver/crear/editar, asignada al proyecto) hace la acción i y NINGUNA de las otras cinco
  FOR j IN 1..6 LOOP
    FOR i IN 1..6 LOOP
      ev := ev || pg_temp.ck(format('1.1.%s.%s · solo «%s»: %s', j, i, v_cl[i], v_nom[j]), pg_temp.prueba(pg_temp.id(256 + i), sq[j], vf[j]),
        CASE WHEN i = j THEN replace(ex[j], '{u}', pg_temp.id(256 + i)::text) ELSE 'COMPRAS_PERMISO_ACCION' END);
    END LOOP;
  END LOOP;
  FOR j IN 1..6 LOOP
    -- 1.2 · «Autorizar» y «Cambiar estado» genéricos (más ver/crear/editar) sin la llave nueva: ninguna de las seis
    ev := ev || pg_temp.ck(format('1.2.%s · genéricos approve + change_status, sin la llave: %s', j, v_nom[j]), pg_temp.prueba(ug, sq[j], vf[j]), 'COMPRAS_PERMISO_ACCION');
    -- 1.4 · la llave sin asignación al proyecto, UPDATE por id: la política SELECT no le muestra la fila → 0 filas, nada cambia
    ev := ev || pg_temp.ck(format('1.4.%s · llave sin asignación al proyecto, UPDATE por id: %s', j, v_nom[j]), pg_temp.prueba(pg_temp.id(512 + j), sq[j], vf[j]), '0 FILAS');
    -- 1.5/1.6 · persona de OTRA empresa (con todas las llaves; administrador): ni siquiera ve la fila → 0 filas
    ev := ev || pg_temp.ck(format('1.5.%s · otra empresa (D), operador con las seis llaves y los genéricos: %s', j, v_nom[j]), pg_temp.prueba(uz, sq[j], vf[j]), '0 FILAS');
    ev := ev || pg_temp.ck(format('1.6.%s · otra empresa (D), administrador: %s', j, v_nom[j]), pg_temp.prueba(ud, sq[j], vf[j]), '0 FILAS');
    -- 1.8 · el propietario de C y el superadministrador siguen pudiendo
    ev := ev || pg_temp.ck(format('1.8.%s · el propietario de C: %s', j, v_nom[j]), pg_temp.prueba(uo, sq[j], vf[j]), replace(ex[j], '{u}', uo::text));
    ev := ev || pg_temp.ck(format('1.9.%s · el superadministrador (de D): %s', j, v_nom[j]), pg_temp.prueba(usa, sq[j], vf[j]), replace(ex[j], '{u}', usa::text));
  END LOOP;
  -- 1.7 · INSERT de una orden ya aprobada
  sql_ins := format($q$INSERT INTO public.ordenes_compra (company_id, project_id, proveedor_id, proveedor_nombre, concepto, estado) VALUES (%L,%L,%L,'ZZ PP Proveedor C','ZZ OC ya aprobada','aprobada')$q$, c, pj, pv);
  ev := ev || pg_temp.ck('1.7.1 · INSERT orden ya «aprobada» sin la llave (editor): rechazado', pg_temp.prueba(ue, sql_ins), 'COMPRAS_PERMISO_ACCION');
  ev := ev || pg_temp.ck('1.7.2 · INSERT orden ya «aprobada» con los genéricos approve + change_status y sin la llave: rechazado', pg_temp.prueba(ug, sql_ins), 'COMPRAS_PERMISO_ACCION');
  ev := ev || pg_temp.ck('1.7.3 · INSERT orden ya «aprobada» con solo la llave de la orden, y el servidor sella SU firma',
    pg_temp.prueba(pg_temp.id(257), sql_ins, $q$SELECT aprobada_por::text FROM public.ordenes_compra WHERE concepto = 'ZZ OC ya aprobada'$q$), pg_temp.id(257)::text);
  ev := ev || pg_temp.ck('1.7.4 · INSERT orden ya «aprobada» con la llave pero sin asignación al proyecto: rechazado', pg_temp.prueba(pg_temp.id(513), sql_ins), 'COMPRAS_ALCANCE_PROYECTO');
  ev := ev || pg_temp.ck('1.7.5 · INSERT orden ya «aprobada» desde otra empresa (D) con todas las llaves: rechazado por la RLS', pg_temp.prueba(uz, sql_ins), 'new row violates row-level security policy for table "ordenes_compra"');
  ev := ev || pg_temp.ck('1.7.6 · INSERT orden ya «emitida» con solo la llave de la orden (falta «Cambiar estado»): rechazado',
    pg_temp.prueba(pg_temp.id(257), replace(sql_ins, '''aprobada'')', '''emitida'')')), 'COMPRAS_PERMISO_ACCION');
  -- 1.10 · cero filas: un proyecto al que la persona no está asignada (C2) y nada cambió en ninguno de los seis documentos
  ev := ev || pg_temp.ck('1.10.1 · con la llave y asignada a C1: UPDATE por id de la orden de C2 afecta 0 filas',
    pg_temp.prueba(pg_temp.id(257), format($q$UPDATE public.ordenes_compra SET estado = 'aprobada' WHERE id = %L$q$, pg_temp.d(9, 0))), '0 FILAS');
  ev := ev || pg_temp.ck('1.10.2 · tras todo lo anterior los seis documentos siguen como estaban',
    pg_temp.q(format($q$SELECT (SELECT estado FROM public.ordenes_compra WHERE id = %L) || '/' || (SELECT estado FROM public.recepciones WHERE id = %L) || '/' || (SELECT estado FROM public.facturas_proveedor WHERE id = %L) || '/' ||
      (SELECT estado FROM public.ordenes_pago WHERE id = %L) || '/' || (SELECT estado FROM public.ordenes_pago WHERE id = %L) || '/' || (SELECT estado FROM public.ordenes_compra WHERE id = %L)$q$,
      pg_temp.d(0, 0), pg_temp.d(1, 2), pg_temp.d(2, 3), pg_temp.d(3, 5), pg_temp.d(3, 4), pg_temp.d(9, 0))), 'borrador/borrador/registrada/borrador/aprobada/borrador');

  -- ═══ 4 · CATÁLOGO, LLAVES CONCEDIDAS Y PRIVILEGIOS ══════════════════════════════
  ev := ev || pg_temp.ck('4.1 · las cinco llaves nuevas existen en el catálogo', pg_temp.q($q$SELECT count(*)::text FROM public.permissions WHERE key = ANY (ARRAY['platform.contabilidad.compras.recepcion_registrar', 'platform.contabilidad.compras.factura_aprobar', 'platform.contabilidad.compras.orden_pago_aprobar', 'platform.contabilidad.compras.pago_ejecutar', 'platform.contabilidad.compras.pago_anular'])$q$), '5');
  ev := ev || pg_temp.ck('4.2 · todas con categoría platform_contabilidad y no hay otras bajo ese prefijo', pg_temp.q($q$SELECT count(*) FILTER (WHERE category = 'platform_contabilidad') || '/' || count(*) FROM public.permissions WHERE key LIKE 'platform.contabilidad.compras.%'$q$), '5/5');
  ev := ev || pg_temp.ck('4.3 · la llave de la orden se reutiliza (existe, no se creó otra)', pg_temp.q($q$SELECT count(*)::text FROM public.permissions WHERE key = 'condominios.tab.ordenes_compra.approve'$q$), '1');
  ev := ev || pg_temp.ck('4.4 · ninguna plantilla de sistema recibió las llaves nuevas', pg_temp.q($q$SELECT count(*)::text FROM public.role_permissions rp JOIN public.roles r ON r.id = rp.role_id WHERE r.is_system AND rp.permission_key LIKE 'platform.contabilidad.compras.%'$q$), '0');
  ev := ev || pg_temp.ck('4.5 · ningún rol real las tiene (fuera de los padrones de prueba 5b…)', pg_temp.q($q$SELECT count(*)::text FROM public.role_permissions rp JOIN public.roles r ON r.id = rp.role_id WHERE rp.permission_key LIKE 'platform.contabilidad.compras.%' AND (r.company_id IS NULL OR r.company_id::text NOT LIKE '5b%')$q$), '0');
  ev := ev || pg_temp.ck('4.6 · las únicas concesiones de este guion son las de su padrón (5 + 5 + 5)', pg_temp.q(format('SELECT count(*)::text FROM public.role_permissions rp JOIN public.roles r ON r.id = rp.role_id WHERE rp.permission_key LIKE ''platform.contabilidad.compras.%%'' AND r.company_id IN (%L, %L)', c, d)), '15');
  v_fn := ARRAY['compras_exigir_permiso', 'compras_tg_permiso_orden', 'compras_tg_permiso_recepcion', 'compras_tg_permiso_factura', 'compras_tg_permiso_orden_pago',
    'compras_tg_permiso_contrasena', 'compras_tg_mover_alcance', 'compras_separacion_memoria', 'compras_separacion_via_rpc', 'compras_separacion_rechazar',
    'compras_separacion_registrar', 'compras_tg_config_separacion', 'compras_tg_config_separacion_truncate', 'compras_tg_config_separacion_bitacora',
    'compras_tg_config_separacion_bitacora_inmutable', 'compras_numero_separadores', 'compras_numeros_equivalentes', 'compras_tg_factura_numero_equivalente',
    'compras_separacion_configurar', 'compras_factura_crear'];
  SELECT count(*), count(*) FILTER (WHERE has_function_privilege('anon', f.oid, 'EXECUTE')), count(*) FILTER (WHERE has_function_privilege('authenticated', f.oid, 'EXECUTE')) INTO n3, n1, n2
    FROM pg_proc f WHERE f.pronamespace = 'public'::regnamespace AND f.proname = ANY (v_fn);
  ev := ev || pg_temp.ck('4.7 · de las 20 funciones nuevas o reescritas existen 20 (una por nombre) y anon no ejecuta ninguna', n3 || '/' || n1, '20/0');
  ev := ev || pg_temp.ck('4.8 · authenticated ejecuta solo las dos RPC (compras_separacion_configurar y compras_factura_crear)', n2::text, '2');
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    ev := ev || pg_temp.ck(format('4.9 · privilegios de %s sobre la bitácora', r), pg_temp.q(format('SELECT string_agg(p || ''='' || has_table_privilege(%L, ''public.compras_config_separacion_bitacora'', p)::text, '' '' ORDER BY p) FROM unnest(ARRAY[''DELETE'', ''INSERT'', ''REFERENCES'', ''SELECT'', ''TRIGGER'', ''TRUNCATE'', ''UPDATE'']) p', r)),
      CASE WHEN r = 'anon' THEN 'DELETE=false INSERT=false REFERENCES=false SELECT=false TRIGGER=false TRUNCATE=false UPDATE=false' ELSE 'DELETE=false INSERT=false REFERENCES=false SELECT=true TRIGGER=false TRUNCATE=false UPDATE=false' END);
  END LOOP;
  ev := ev || pg_temp.ck('4.10 · authenticated no tiene TRUNCATE, TRIGGER ni REFERENCES sobre compras_config; anon, ningún privilegio', pg_temp.q($q$SELECT has_table_privilege('authenticated', 'public.compras_config', 'TRUNCATE')::text || '/' || has_table_privilege('authenticated', 'public.compras_config', 'TRIGGER')::text || '/' || has_table_privilege('authenticated', 'public.compras_config', 'REFERENCES')::text || '/' || has_table_privilege('anon', 'public.compras_config', 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE')::text$q$), 'false/false/false/false');
  ev := ev || pg_temp.ck('4.11 · la bitácora tiene RLS y la secuencia de su id no es de la API', pg_temp.q($q$SELECT (SELECT relrowsecurity::text FROM pg_class WHERE oid = 'public.compras_config_separacion_bitacora'::regclass) || '/' || has_sequence_privilege('authenticated', 'public.compras_config_separacion_bitacora_id_seq', 'USAGE')::text$q$), 'true/false');
  ev := ev || pg_temp.ck('4.12 · triggers de la protección: 3 en compras_config y 2 en la bitácora, todos habilitados', pg_temp.q($q$SELECT (SELECT count(*) FROM pg_trigger WHERE tgrelid = 'public.compras_config'::regclass AND tgname IN ('trg_compras_00_config_separacion', 'trg_compras_00_config_separacion_truncate', 'trg_zz_compras_config_separacion_bitacora') AND tgenabled = 'O') || '/' || (SELECT count(*) FROM pg_trigger WHERE tgrelid = 'public.compras_config_separacion_bitacora'::regclass AND NOT tgisinternal AND tgenabled = 'O')$q$), '3/2');

  SELECT count(*) INTO fallos FROM unnest(ev) e WHERE e LIKE 'FALLO%';
  -- La herramienta SQL del sandbox recorta el centro de un mensaje largo: con `SELECT set_config('guion.tramo', '1' | '2', true);` delante se
  -- imprime la primera o la segunda mitad de las líneas (los FALLO salen siempre completos); sin él, todas. La huella es la del DO, igual en los tres.
  tr := COALESCE(NULLIF(current_setting('guion.tramo', true), ''), '0')::int;
  RAISE EXCEPTION E'%\n— % comprobaciones, % con FALLO — (tramo %)\n%\nhuella_md5_del_guion=%', CASE WHEN fallos = 0 THEN 'GUION_OK_REVERTIDO' ELSE 'GUION_FALLO' END,
    cardinality(ev), fallos, tr,
    CASE tr WHEN 1 THEN array_to_string(ev[1:cardinality(ev) / 2], E'\n') WHEN 2 THEN array_to_string(ev[cardinality(ev) / 2 + 1:cardinality(ev)], E'\n') ELSE array_to_string(ev, E'\n') END
    || CASE WHEN fallos > 0 AND tr > 0 THEN E'\nTODOS LOS FALLOS:\n' || array_to_string(ARRAY(SELECT e FROM unnest(ev) e WHERE e LIKE 'FALLO%'), E'\n') ELSE '' END,
    md5(regexp_replace(substr(current_query(), position('DO ' || chr(36) || 'guion' in current_query())), '[^$]*$', ''));
END
$guion$;
