-- ============================================================================
-- VALIDACIÓN EN SANDBOX · PERMISOS POR ACCIÓN, SEPARACIÓN SOLICITANTE/APROBADOR Y NÚMEROS DE FACTURA (migración 20261027000900).
-- «API directa»: DML como `authenticated` con el sub del JWT fijado (lo que ejecuta PostgREST); sin RPC de ayuda (solo las reales:
-- compras_separacion_configurar y compras_factura_crear). UNA sola sentencia (DO) que TERMINA SIEMPRE con una excepción que REVIERTE todo
-- (también la separación que se enciende a mitad de camino): GUION_OK_REVERTIDO · GUION_FALLO (alguna comprobación no coincide) · otro (fallo del recorrido).
-- Sin DROP ni DELETE suelto: los DELETE/UPDATE/TRUNCATE sobre compras_config y la bitácora son INTENTOS que deben rechazarse, cada uno en su
-- subtransacción. Padrón de usar y tirar `5b71…` (empresas «ZZ Permisos C» y «ZZ Permisos D»). La fila AUSENTE de compras_config se simula con
-- ALTER TABLE … DISABLE TRIGGER dentro de la transacción (en el sandbox `postgres` no es superusuario: no puede usar session_replication_role).
-- ============================================================================
DO $guion$
DECLARE
  c   constant uuid := '5b710000-0000-0000-0000-00000000000c';
  d   constant uuid := '5b710000-0000-0000-0000-00000000000d';
  pj  constant uuid := '5b710000-0000-0000-0000-0000000000a1';  -- proyecto C1 (todos los que tienen proyecto, aquí)
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
  v_fn   text[];
  v_base constant text[] := ARRAY['platform.contabilidad.view', 'platform.contabilidad.create', 'platform.contabilidad.edit'];
  zw  constant text := convert_from(decode('e2808b', 'hex'), 'UTF8');   -- U+200B espacio de ancho cero
  rd  constant text := convert_from(decode('e28093', 'hex'), 'UTF8');   -- U+2013 raya (pegado desde un PDF)
  sq text[]; sqt text[] := ARRAY[]::text[]; vf text[]; ex text[];
  ev text[] := ARRAY[]::text[];
  stm text[]; stl text[];
  rj jsonb; r text; sql_ins text; pp uuid; n1 int; n2 int; n3 int;
  i int; j int; fallos int;
BEGIN
  CREATE FUNCTION pg_temp.ck(p_lbl text, p_o text, p_e text) RETURNS text LANGUAGE sql IMMUTABLE AS
    $f$ SELECT CASE WHEN $2 IS NOT DISTINCT FROM $3 THEN 'OK    ' ELSE 'FALLO ' END || $1 || ' · obtenido=' || coalesce($2, 'NULL') || ' esperado=' || coalesce($3, 'NULL') $f$;
  -- Sentencia que DEBE fallar; si NO falla informa «SIN ERROR» y REVIERTE su efecto.
  CREATE FUNCTION pg_temp.err(p text) RETURNS text LANGUAGE plpgsql AS
    $f$ BEGIN EXECUTE p; RAISE EXCEPTION 'SIN_ERROR_REVERTIDO';
        EXCEPTION WHEN OTHERS THEN IF SQLERRM = 'SIN_ERROR_REVERTIDO' THEN RETURN 'SIN ERROR'; END IF; RETURN split_part(SQLERRM, ':', 1); END $f$;
  -- Como err() con la sesión de otra persona (JWT + authenticated); vuelve al rol de partida y sin sub (= proceso de sistema).
  CREATE FUNCTION pg_temp.err_como(p_uid uuid, p text) RETURNS text LANGUAGE plpgsql AS
    $f$ DECLARE r text; BEGIN
        PERFORM set_config('request.jwt.claim.sub', p_uid::text, true);
        EXECUTE 'SET LOCAL ROLE authenticated';
        r := pg_temp.err(p);
        EXECUTE 'RESET ROLE';
        PERFORM set_config('request.jwt.claim.sub', '', true);
        RETURN r; END $f$;
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
  CREATE FUNCTION pg_temp.q_como(p_uid uuid, p text) RETURNS text LANGUAGE plpgsql AS
    $f$ DECLARE r text; BEGIN PERFORM pg_temp.entra(p_uid); EXECUTE p INTO r; PERFORM pg_temp.sale(); RETURN r; END $f$;
  CREATE FUNCTION pg_temp.id(p int) RETURNS uuid LANGUAGE sql IMMUTABLE AS $f$ SELECT ('5b710000-0000-0000-0000-' || lpad(to_hex(p), 12, '0'))::uuid $f$;
  CREATE FUNCTION pg_temp.d(n int, k int) RETURNS uuid LANGUAGE sql IMMUTABLE AS $f$ SELECT pg_temp.id(4096 + n * 16 + k) $f$;
  -- Una columna de la última fila de la bitácora de C.
  CREATE FUNCTION pg_temp.bit(p_col text) RETURNS text LANGUAGE sql AS
    $f$ SELECT pg_temp.q(format('SELECT %I::text FROM public.compras_config_separacion_bitacora WHERE company_id = %L ORDER BY id DESC LIMIT 1', p_col, '5b710000-0000-0000-0000-00000000000c')) $f$;
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
  -- Alta REAL de una factura de C1 («ALTA» o el rechazo; entonces no queda nada) y su sentencia como texto.
  CREATE FUNCTION pg_temp.nf(p_prov uuid, p_num text) RETURNS text LANGUAGE sql AS
    $f$ SELECT format('INSERT INTO public.facturas_proveedor (company_id, project_id, proveedor_id, numero_factura, concepto, monto_total) VALUES (%L,%L,%L,%L,%L,100)',
                      '5b710000-0000-0000-0000-00000000000c', '5b710000-0000-0000-0000-0000000000a1', p_prov, p_num, 'ZZ número') $f$;
  CREATE FUNCTION pg_temp.alta(p_prov uuid, p_num text) RETURNS text LANGUAGE plpgsql AS
    $f$ BEGIN EXECUTE pg_temp.nf(p_prov, p_num); RETURN 'ALTA'; EXCEPTION WHEN OTHERS THEN RETURN split_part(SQLERRM, ':', 1); END $f$;
  CREATE FUNCTION pg_temp.rpc(p_prov uuid, p_num text, p_clave text) RETURNS text LANGUAGE sql AS
    $f$ SELECT format('SELECT public.compras_factura_crear(%L, %L, jsonb_build_object(%L, %L::text, %L, %L::text, %L, %L, %L, 100, %L, %L::text), %L::jsonb)',
                      '5b710000-0000-0000-0000-00000000000c', '5b710000-0000-0000-0000-0000000000a1', 'proveedor_id', p_prov, 'numero_factura', p_num,
                      'concepto', 'ZZ RPC número', 'monto_total', 'clave_idempotencia', p_clave, '[]') $f$;

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

  -- ═══ 2 · SEPARACIÓN SOLICITANTE / APROBADOR ══════════════════════════════════════
  ev := ev || pg_temp.ck('2.1 · al empezar C no tiene fila de configuración ni bitácora', pg_temp.q(format('SELECT (SELECT count(*) FROM public.compras_config WHERE company_id = %L) || ''/'' || (SELECT count(*) FROM public.compras_config_separacion_bitacora WHERE company_id = %L)', c, c)), '0/0');
  -- 2.2 · quién puede usar la RPC
  FOR i IN 1..6 LOOP
    pp := (ARRAY[ue, ug, ud, ua, uo, usa])[i];
    ev := ev || pg_temp.ck(format('2.2.%s · compras_separacion_configurar(C, true) como %s', i, (ARRAY['editor', 'genéricos approve/change_status', 'administrador de OTRA empresa', 'administrador de C', 'propietario de C', 'superadministrador'])[i]),
      pg_temp.prueba(pp, format($q$SELECT public.compras_separacion_configurar(%L, true, 'ZZ Prueba del guion: encender')$q$, c)),
      (ARRAY['COMPRAS_CONFIG_SEPARACION_SOLO_ADMIN', 'COMPRAS_CONFIG_SEPARACION_SOLO_ADMIN', 'COMPRAS_ALCANCE_EMPRESA', 'PASA 1', 'PASA 1', 'PASA 1'])[i]);
  END LOOP;
  ev := ev || pg_temp.ck('2.2.7 · sin motivo útil: rechazada', pg_temp.prueba(ua, format($q$SELECT public.compras_separacion_configurar(%L, true, '..')$q$, c)), 'COMPRAS_SEPARACION_MOTIVO');
  ev := ev || pg_temp.ck('2.2.8 · apagar lo que ya está apagado: «sin cambio», no se finge éxito', pg_temp.prueba(ua, format($q$SELECT public.compras_separacion_configurar(%L, false, 'ZZ Prueba del guion: apagar')$q$, c)), 'COMPRAS_SEPARACION_SIN_CAMBIO');
  -- 2.3 · un editor puede crear la fila APAGADA (configuración normal) pero no ENCENDIDA a mano
  ev := ev || pg_temp.ck('2.3.1 · el editor crea la fila de configuración apagada (sin memoria que la contradiga)', pg_temp.prueba(ue, format($q$INSERT INTO public.compras_config (company_id, aprobacion_separada) VALUES (%L, false)$q$, c)), 'PASA 1');
  ev := ev || pg_temp.ck('2.3.2 · el editor no la crea ENCENDIDA (solo la RPC)', pg_temp.prueba(ue, format($q$INSERT INTO public.compras_config (company_id, aprobacion_separada) VALUES (%L, true)$q$, c)), 'COMPRAS_CONFIG_SEPARACION_SOLO_ADMIN');
  -- 2.4 · el administrador la enciende por la RPC (de verdad; se revierte al final)
  PERFORM pg_temp.entra(ua);
  rj := public.compras_separacion_configurar(c, true, 'ZZ Prueba del guion: encender la separación');
  PERFORM pg_temp.sale();
  ev := ev || pg_temp.ck('2.4.1 · la RPC devuelve el estado resultante: encendida', rj ->> 'aprobacion_separada', 'true');
  ev := ev || pg_temp.ck('2.4.2 · la fila de compras_config quedó encendida', pg_temp.q(format('SELECT aprobacion_separada::text FROM public.compras_config WHERE company_id = %L', c)), 'true');
  ev := ev || pg_temp.ck('2.4.3 · bitácora: una fila de esta empresa', pg_temp.q(format('SELECT count(*)::text FROM public.compras_config_separacion_bitacora WHERE company_id = %L', c)), '1');
  ev := ev || pg_temp.ck('2.4.4 · bitácora: empresa', pg_temp.bit('company_id'), c::text);
  ev := ev || pg_temp.ck('2.4.5 · bitácora: actor = la persona de la sesión (lo sella el servidor)', pg_temp.bit('actor_id'), ua::text);
  ev := ev || pg_temp.ck('2.4.6 · bitácora: valor anterior → valor nuevo', pg_temp.bit('valor_anterior') || '>' || pg_temp.bit('valor_nuevo'), 'false>true');
  ev := ev || pg_temp.ck('2.4.7 · bitácora: motivo', pg_temp.bit('motivo'), 'ZZ Prueba del guion: encender la separación');
  ev := ev || pg_temp.ck('2.4.8 · bitácora: origen', pg_temp.bit('origen'), 'usuario');
  ev := ev || pg_temp.ck('2.4.9 · bitácora: fecha (entre el inicio de la transacción y ahora)', pg_temp.q(format('SELECT (cambiado_at BETWEEN now() AND clock_timestamp())::text FROM public.compras_config_separacion_bitacora WHERE company_id = %L ORDER BY id DESC LIMIT 1', c)), 'true');
  ev := ev || pg_temp.ck('2.4.10 · los intentos rechazados de 2.2 no dejaron rastro (sigue 1 fila)', pg_temp.q(format('SELECT count(*)::text FROM public.compras_config_separacion_bitacora WHERE company_id = %L', c)), '1');
  -- 2.5 · intentos de evadirla por API directa, como editor Y como administrador, con la separación encendida
  stl := ARRAY['UPDATE por empresa', 'UPDATE sin filtro de fila', 'DELETE por empresa', 'DELETE sin filtro de fila', 'UPSERT (INSERT … ON CONFLICT DO UPDATE)', 'mover la fila a otra empresa', 'TRUNCATE'];
  stm := ARRAY[format('UPDATE public.compras_config SET aprobacion_separada = false WHERE company_id = %L', c),
    'UPDATE public.compras_config SET aprobacion_separada = false WHERE true',
    format('DELETE FROM public.compras_config WHERE company_id = %L', c),
    'DELETE FROM public.compras_config WHERE true',
    format('INSERT INTO public.compras_config (company_id, aprobacion_separada) VALUES (%L, false) ON CONFLICT (company_id) DO UPDATE SET aprobacion_separada = false', c),
    format('UPDATE public.compras_config SET company_id = %L WHERE company_id = %L', d, c),
    'TRUNCATE public.compras_config'];
  FOR i IN 1..7 LOOP
    ev := ev || pg_temp.ck(format('2.5.%s · editor: %s', i, stl[i]), pg_temp.prueba(ue, stm[i]), CASE WHEN i = 7 THEN 'permission denied for table compras_config' ELSE 'COMPRAS_CONFIG_SEPARACION_SOLO_ADMIN' END);
    ev := ev || pg_temp.ck(format('2.6.%s · administrador: %s', i, stl[i]), pg_temp.prueba(ua, stm[i]), CASE WHEN i = 7 THEN 'permission denied for table compras_config' ELSE 'COMPRAS_CONFIG_SEPARACION_VIA_RPC' END);
  END LOOP;
  ev := ev || pg_temp.ck('2.5.8 · el editor SÍ sigue editando lo demás (tolerancia de precio)', pg_temp.prueba(ue, format('UPDATE public.compras_config SET tolerancia_precio_pct = 7 WHERE company_id = %L', c)), 'PASA 1');
  ev := ev || pg_temp.ck('2.5.9 · tras los 14 intentos la separación sigue encendida y la bitácora en 1 fila', pg_temp.q(format('SELECT (SELECT aprobacion_separada FROM public.compras_config WHERE company_id = %L) || ''/'' || (SELECT count(*) FROM public.compras_config_separacion_bitacora WHERE company_id = %L)', c, c)), 'true/1');
  -- 2.7 · la AUSENCIA de la fila no apaga lo establecido: la fila desaparece SIN pasar por los triggers (carga manual, restauración parcial) y la bitácora lo recuerda
  PERFORM set_config('request.jwt.claim.sub', '', true);
  ALTER TABLE public.compras_config DISABLE TRIGGER trg_compras_00_config_separacion;
  ALTER TABLE public.compras_config DISABLE TRIGGER trg_zz_compras_config_separacion_bitacora;
  DELETE FROM public.compras_config WHERE company_id = c;
  ALTER TABLE public.compras_config ENABLE TRIGGER trg_compras_00_config_separacion;
  ALTER TABLE public.compras_config ENABLE TRIGGER trg_zz_compras_config_separacion_bitacora;
  ev := ev || pg_temp.ck('2.7.1 · (montaje) la fila ya no existe y la bitácora sigue diciendo «encendida»', pg_temp.q(format('SELECT (SELECT count(*) FROM public.compras_config WHERE company_id = %L) || ''/'' || (SELECT count(*) FROM public.compras_config_separacion_bitacora WHERE company_id = %L) || ''/'' || (SELECT valor_nuevo FROM public.compras_config_separacion_bitacora WHERE company_id = %L ORDER BY id DESC LIMIT 1)', c, c, c)), '0/1/true');
  ev := ev || pg_temp.ck('2.7.2 · el editor re-crea la fila «apagada» y nace ENCENDIDA',
    pg_temp.prueba(ue, format('INSERT INTO public.compras_config (company_id, aprobacion_separada) VALUES (%L, false)', c), format('SELECT aprobacion_separada::text FROM public.compras_config WHERE company_id = %L', c)), 'true');
  ev := ev || pg_temp.ck('2.7.3 · el administrador igual',
    pg_temp.prueba(ua, format('INSERT INTO public.compras_config (company_id, aprobacion_separada) VALUES (%L, false)', c), format('SELECT aprobacion_separada::text FROM public.compras_config WHERE company_id = %L', c)), 'true');
  ev := ev || pg_temp.ck('2.7.4 · el editor por UPSERT sobre la fila ausente: nace ENCENDIDA',
    pg_temp.prueba(ue, stm[5], format('SELECT aprobacion_separada::text FROM public.compras_config WHERE company_id = %L', c)), 'true');
  PERFORM pg_temp.entra(ua);
  rj := public.compras_separacion_configurar(c, true, 'ZZ Prueba del guion: restablecer la fila');
  PERFORM pg_temp.sale();
  ev := ev || pg_temp.ck('2.7.5 · la RPC restablece la fila ausente (no es un cambio nuevo: «restablecida»)', (rj ->> 'restablecida') || '/' || (rj ->> 'aprobacion_separada'), 'true/true');
  ev := ev || pg_temp.ck('2.7.6 · y la bitácora no ganó filas', pg_temp.q(format('SELECT count(*)::text FROM public.compras_config_separacion_bitacora WHERE company_id = %L', c)), '1');
  -- 2.8 · con la separación ENCENDIDA el solicitante no aprueba lo suyo (UPDATE ni INSERT ya aprobada); otra persona con la llave sí
  PERFORM pg_temp.entra(ucr);
  PERFORM pg_temp.cadena(4, 1, pj, pv);
  PERFORM pg_temp.sale();
  sql_ins := format($q$UPDATE public.ordenes_compra SET estado = 'aprobada' WHERE id = %L$q$, pg_temp.d(4, 0));
  ev := ev || pg_temp.ck('2.8.1 · encendida: el solicitante NO aprueba su propia orden (UPDATE), aunque tenga la llave', pg_temp.prueba(ucr, sql_ins), 'COMPRAS_OC_AUTOAPROBACION');
  ev := ev || pg_temp.ck('2.8.2 · encendida: tampoco inserta una orden ya aprobada a su nombre',
    pg_temp.prueba(ucr, format($q$INSERT INTO public.ordenes_compra (company_id, project_id, proveedor_id, proveedor_nombre, concepto, estado) VALUES (%L,%L,%L,'ZZ PP Proveedor C','ZZ nace aprobada','aprobada')$q$, c, pj, pv)), 'COMPRAS_OC_AUTOAPROBACION');
  ev := ev || pg_temp.ck('2.8.3 · encendida: otra persona con la llave SÍ la aprueba (y el servidor sella su firma)',
    pg_temp.prueba(pg_temp.id(257), sql_ins, format($q$SELECT estado || '/' || aprobada_por FROM public.ordenes_compra WHERE id = %L$q$, pg_temp.d(4, 0))), 'aprobada/' || pg_temp.id(257)::text);
  ev := ev || pg_temp.ck('2.8.4 · encendida: sin la llave sigue rechazada por permiso (la separación no cambia ese código)', pg_temp.prueba(ug, sql_ins), 'COMPRAS_PERMISO_ACCION');
  -- 2.9 · el administrador la apaga por la RPC; apagada, el mismo solicitante SÍ aprueba (la separación no es una prohibición permanente)
  PERFORM pg_temp.entra(ua);
  rj := public.compras_separacion_configurar(c, false, 'ZZ Prueba del guion: apagar la separación');
  PERFORM pg_temp.sale();
  ev := ev || pg_temp.ck('2.9.1 · la RPC devuelve valor anterior → resultado', (rj ->> 'valor_anterior') || '>' || (rj ->> 'aprobacion_separada'), 'true>false');
  ev := ev || pg_temp.ck('2.9.2 · bitácora: dos filas, la última true>false por el administrador, con su motivo',
    pg_temp.q(format('SELECT count(*) FROM public.compras_config_separacion_bitacora WHERE company_id = %L', c)) || '/' || pg_temp.bit('valor_anterior') || '>' || pg_temp.bit('valor_nuevo') || '/' || pg_temp.bit('actor_id') || '/' || pg_temp.bit('motivo'),
    '2/true>false/' || ua::text || '/ZZ Prueba del guion: apagar la separación');
  ev := ev || pg_temp.ck('2.9.3 · apagada: el solicitante SÍ aprueba su propia orden',
    pg_temp.prueba(ucr, sql_ins, format($q$SELECT estado || '/' || aprobada_por FROM public.ordenes_compra WHERE id = %L$q$, pg_temp.d(4, 0))), 'aprobada/' || ucr::text);
  ev := ev || pg_temp.ck('2.9.4 · apagada: el editor sigue sin poder encenderla a mano (UPDATE directo)', pg_temp.prueba(ue, format('UPDATE public.compras_config SET aprobacion_separada = true WHERE company_id = %L', c)), 'COMPRAS_CONFIG_SEPARACION_SOLO_ADMIN');
  -- 2.10 · la bitácora es append-only y nadie de la API escribe en ella
  FOR i IN 1..4 LOOP
    FOREACH pp IN ARRAY ARRAY[ue, ua] LOOP
      ev := ev || pg_temp.ck(format('2.10.%s · bitácora, %s como %s', i, (ARRAY['UPDATE', 'DELETE', 'TRUNCATE', 'INSERT con un actor inventado'])[i], CASE WHEN pp = ua THEN 'administrador' ELSE 'editor' END),
        pg_temp.prueba(pp, (ARRAY['UPDATE public.compras_config_separacion_bitacora SET motivo = ''ZZ reescrito''', 'DELETE FROM public.compras_config_separacion_bitacora WHERE true', 'TRUNCATE public.compras_config_separacion_bitacora',
          format('INSERT INTO public.compras_config_separacion_bitacora (company_id, actor_id, valor_anterior, valor_nuevo, motivo, origen) VALUES (%L, %L, true, false, ''ZZ falsificada por el cliente'', ''usuario'')', c, ue)])[i]),
        'permission denied for table compras_config_separacion_bitacora');
    END LOOP;
  END LOOP;
  ev := ev || pg_temp.ck('2.10.5 · incluso el dueño de la tabla: UPDATE rechazado por el trigger', pg_temp.err('UPDATE public.compras_config_separacion_bitacora SET motivo = ''ZZ reescrito'' WHERE company_id = ''' || c || ''''), 'COMPRAS_SEPARACION_BITACORA_INMUTABLE');
  ev := ev || pg_temp.ck('2.10.6 · incluso el dueño de la tabla: DELETE rechazado por el trigger', pg_temp.err('DELETE FROM public.compras_config_separacion_bitacora WHERE company_id = ''' || c || ''''), 'COMPRAS_SEPARACION_BITACORA_INMUTABLE');
  ev := ev || pg_temp.ck('2.10.7 · incluso el dueño de la tabla: TRUNCATE rechazado por el trigger', pg_temp.err('TRUNCATE public.compras_config_separacion_bitacora'), 'COMPRAS_SEPARACION_BITACORA_INMUTABLE');
  ev := ev || pg_temp.ck('2.10.8 · la bitácora sigue con sus 2 filas tras todos los intentos', pg_temp.q(format('SELECT count(*)::text FROM public.compras_config_separacion_bitacora WHERE company_id = %L', c)), '2');
  -- 2.11 · quién lee la bitácora (RLS)
  sql_ins := format('SELECT count(*)::text FROM public.compras_config_separacion_bitacora WHERE company_id = %L', c);
  ev := ev || pg_temp.ck('2.11.1 · la lee el administrador de C', pg_temp.q_como(ua, sql_ins), '2');
  ev := ev || pg_temp.ck('2.11.2 · la lee el superadministrador', pg_temp.q_como(usa, sql_ins), '2');
  ev := ev || pg_temp.ck('2.11.3 · no la lee un editor', pg_temp.q_como(ue, sql_ins), '0');
  ev := ev || pg_temp.ck('2.11.4 · no la lee el administrador de OTRA empresa', pg_temp.q_como(ud, sql_ins), '0');

  -- ═══ 3 · NÚMEROS DE FACTURA (alternativa A) ═════════════════════════════════════
  PERFORM pg_temp.entra(ua);
  ev := ev || pg_temp.ck('3.1 · «1-23» se registra', pg_temp.alta(pv, '1-23'), 'ALTA');
  ev := ev || pg_temp.ck('3.2 · «12-3» (serie y correlativo distintos) convive con «1-23»', pg_temp.alta(pv, '12-3'), 'ALTA');
  ev := ev || pg_temp.ck('3.3 · «123» (sin separador) frente a «1-23» y «12-3»: ambiguo, se rechaza', pg_temp.alta(pv, '123'), 'COMPRAS_FACTURA_NUMERO_DUPLICADO');
  ev := ev || pg_temp.ck('3.4 · «FAC-001» se registra', pg_temp.alta(pv, 'FAC-001'), 'ALTA');
  ev := ev || pg_temp.ck('3.5 · «FAC001» es la misma factura', pg_temp.alta(pv, 'FAC001'), 'COMPRAS_FACTURA_NUMERO_DUPLICADO');
  ev := ev || pg_temp.ck('3.6 · «fac 001» es la misma factura', pg_temp.alta(pv, 'fac 001'), 'COMPRAS_FACTURA_NUMERO_DUPLICADO');
  ev := ev || pg_temp.ck('3.7 · «FAC–001» (raya larga de un PDF) es la misma factura', pg_temp.alta(pv, 'FAC' || rd || '001'), 'COMPRAS_FACTURA_NUMERO_DUPLICADO');
  ev := ev || pg_temp.ck('3.8 · «F<U+200B>AC001» (carácter invisible entre letras) es la misma factura', pg_temp.alta(pv, 'F' || zw || 'AC001'), 'COMPRAS_FACTURA_NUMERO_DUPLICADO');
  ev := ev || pg_temp.ck('3.9 · «FAC-0<U+200B>01» (invisible tras el guion) es la misma factura', pg_temp.alta(pv, 'FAC-0' || zw || '01'), 'COMPRAS_FACTURA_NUMERO_DUPLICADO');
  ev := ev || pg_temp.ck('3.10 · el número idéntico lo rechaza el índice único de siempre', pg_temp.alta(pv, 'FAC-001'), 'duplicate key value violates unique constraint "uq_facturas_prov_numero"');
  ev := ev || pg_temp.ck('3.11 · el mismo número en OTRO proveedor se acepta', pg_temp.alta(pv2, 'FAC-001'), 'ALTA');
  ev := ev || pg_temp.ck('3.12 · «A-12» y «A1-2» conviven', pg_temp.alta(pv, 'A-12') || '/' || pg_temp.alta(pv, 'A1-2'), 'ALTA/ALTA');
  ev := ev || pg_temp.ck('3.13 · quedaron 5 facturas de prueba del proveedor C y 1 del otro', pg_temp.q(format('SELECT (SELECT count(*) FROM public.facturas_proveedor WHERE proveedor_id = %L AND concepto = ''ZZ número'') || ''/'' || (SELECT count(*) FROM public.facturas_proveedor WHERE proveedor_id = %L AND concepto = ''ZZ número'')', pv, pv2)), '5/1');
  -- 3.14 · UPDATE del número hacia uno equivalente
  ev := ev || pg_temp.ck('3.14.1 · (montaje) «OTRO-9» se registra', pg_temp.alta(pv, 'OTRO-9'), 'ALTA');
  FOR i IN 1..3 LOOP
    ev := ev || pg_temp.ck(format('3.14.%s · UPDATE del número de «OTRO-9» a «%s»', i + 1, (ARRAY['fac 001', '12 3', 'OTRO-10'])[i]),
      pg_temp.err(format('UPDATE public.facturas_proveedor SET numero_factura = %L WHERE proveedor_id = %L AND numero_factura = ''OTRO-9''', (ARRAY['fac 001', '12 3', 'OTRO-10'])[i], pv)),
      (ARRAY['COMPRAS_FACTURA_NUMERO_DUPLICADO', 'COMPRAS_FACTURA_NUMERO_DUPLICADO', 'SIN ERROR'])[i]);
  END LOOP;
  -- 3.15 · la RPC compras_factura_crear se comporta igual que el INSERT directo (mismo resultado para cada número; el idéntico se compara aparte)
  ev := ev || pg_temp.ck('3.15.1 · (montaje) la RPC acepta «3-45» (y se revierte)', pg_temp.err(pg_temp.rpc(pv, '3-45', 'zz-pp-clave-0001')), 'SIN ERROR');
  ev := ev || pg_temp.ck('3.15.2 · (montaje) «3-45» se registra por INSERT directo', pg_temp.alta(pv, '3-45'), 'ALTA');
  FOR i IN 1..7 LOOP
    r := (ARRAY['FAC001', 'fac 001', 'F' || zw || 'AC001', '345', '34 5', '34-5', '12 3'])[i];
    ev := ev || pg_temp.ck(format('3.15.%s · RPC = INSERT directo con «%s»', i + 2, replace(r, zw, '<U+200B>')),
      pg_temp.err(pg_temp.rpc(pv, r, 'zz-pp-clave-0002')), pg_temp.err(pg_temp.nf(pv, r)));
  END LOOP;
  ev := ev || pg_temp.ck('3.15.10 · la RPC con el número idéntico «3-45»: COMPRAS_FACTURA_NUMERO_DUPLICADO', pg_temp.err(pg_temp.rpc(pv, '3-45', 'zz-pp-clave-0003')), 'COMPRAS_FACTURA_NUMERO_DUPLICADO');
  ev := ev || pg_temp.ck('3.15.11 · la RPC con «34 5» (distinto de «3-45») la registra de verdad, sin tapar nada', pg_temp.q(format('SELECT public.compras_factura_crear(%L, %L, jsonb_build_object(''proveedor_id'', %L::text, ''numero_factura'', ''34 5'', ''concepto'', ''ZZ RPC número'', ''monto_total'', 100, ''clave_idempotencia'', ''zz-pp-clave-0004''), ''[]''::jsonb) -> ''factura'' ->> ''numero_factura''', c, pj, pv)), '34 5');
  PERFORM pg_temp.sale();

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
  RAISE EXCEPTION E'%\n— % comprobaciones, % con FALLO —\n%\nhuella_md5_del_guion=%', CASE WHEN fallos = 0 THEN 'GUION_OK_REVERTIDO' ELSE 'GUION_FALLO' END,
    cardinality(ev), fallos, array_to_string(ev, E'\n'),
    md5(regexp_replace(substr(current_query(), position('DO ' || chr(36) || 'guion' in current_query())), '[^$]*$', ''));
END
$guion$;
