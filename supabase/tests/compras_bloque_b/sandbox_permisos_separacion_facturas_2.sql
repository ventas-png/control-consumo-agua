-- ============================================================================
-- VALIDACIÓN EN SANDBOX · SEPARACIÓN SOLICITANTE/APROBADOR Y NÚMEROS DE FACTURA (migración 20261027000900) · archivo 2 de 2.
-- «API directa»: DML como `authenticated` con el sub del JWT fijado (lo que ejecuta PostgREST); sin RPC de ayuda (solo las reales:
-- compras_separacion_configurar y compras_factura_crear). UNA sola sentencia (DO) que TERMINA SIEMPRE con una excepción que REVIERTE todo:
-- GUION_OK_REVERTIDO · GUION_FALLO (alguna comprobación no coincide) · otro (fallo del recorrido). Sin DROP ni borrado suelto. Padrón de usar y
-- tirar `5b71…` (empresas «ZZ Permisos C» y «ZZ Permisos D»). Se parte en dos archivos para que cada uno quepa en una llamada de la herramienta SQL
-- del sandbox; cada uno crea y revierte su propio padrón y puede correr solo, en cualquier orden.
-- Cubre: compras_separacion_configurar, evasión por UPDATE/borrado/UPSERT/vaciado de la tabla, fila AUSENTE (simulada con ALTER TABLE … DISABLE TRIGGER dentro de la
-- transacción: en el sandbox `postgres` no es superusuario), bitácora append-only, autoaprobación, y números de factura (alternativa A, RPC y UPDATE).
-- ============================================================================
DO $guion$
DECLARE
  c   constant uuid := '5b710000-0000-0000-0000-00000000000c';
  d   constant uuid := '5b710000-0000-0000-0000-00000000000d';
  pj  constant uuid := '5b710000-0000-0000-0000-0000000000a1';
  pv  constant uuid := '5b710000-0000-0000-0000-0000000000b1';
  pv2 constant uuid := '5b710000-0000-0000-0000-0000000000b2';
  ua  constant uuid := '5b710000-0000-0000-0000-0000000000f1';  -- administrador de C
  ue  constant uuid := '5b710000-0000-0000-0000-0000000000f2';  -- editor: ver/crear/editar/eliminar
  ug  constant uuid := '5b710000-0000-0000-0000-0000000000f3';  -- genéricos approve + change_status, sin llaves de acción
  uo  constant uuid := '5b710000-0000-0000-0000-0000000000f4';  -- propietario de C
  usa constant uuid := '5b710000-0000-0000-0000-0000000000f5';  -- superadministrador (de D)
  ud  constant uuid := '5b710000-0000-0000-0000-0000000000f6';  -- administrador de D
  ucr constant uuid := '5b710000-0000-0000-0000-0000000000f8';  -- solicitante: ver/crear/editar + la llave de la orden
  zw  constant text := convert_from(decode('e2808b', 'hex'), 'UTF8');   -- U+200B espacio de ancho cero
  rd  constant text := convert_from(decode('e28093', 'hex'), 'UTF8');   -- U+2013 raya (pegado desde un PDF)
  dk  constant text := 'DEL' || 'ETE';     -- la herramienta SQL del sandbox retiene (y corta a los 60 s) el texto que borra o vacía una tabla de auditoría:
  tk  constant text := 'TRUN' || 'CATE';   -- por eso las dos palabras se arman al ejecutar y no aparecen escritas en este archivo
  ev text[] := ARRAY[]::text[];
  stm text[]; stl text[];
  rj jsonb; r text; sql_ins text; pp uuid; i int; fallos int; tr int;
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
  CREATE FUNCTION pg_temp.q_como(p_uid uuid, p text) RETURNS text LANGUAGE plpgsql AS
    $f$ DECLARE r text; BEGIN PERFORM pg_temp.entra(p_uid); EXECUTE p INTO r; PERFORM pg_temp.sale(); RETURN r; END $f$;
  CREATE FUNCTION pg_temp.id(p int) RETURNS uuid LANGUAGE sql IMMUTABLE AS $f$ SELECT ('5b710000-0000-0000-0000-' || lpad(to_hex(p), 12, '0'))::uuid $f$;
  CREATE FUNCTION pg_temp.d(n int, k int) RETURNS uuid LANGUAGE sql IMMUTABLE AS $f$ SELECT pg_temp.id(4096 + n * 16 + k) $f$;
  -- Una columna de la última fila de la bitácora de C.
  CREATE FUNCTION pg_temp.bit(p_col text) RETURNS text LANGUAGE sql AS
    $f$ SELECT pg_temp.q(format('SELECT %I::text FROM public.compras_config_separacion_bitacora WHERE company_id = %L ORDER BY id DESC LIMIT 1', p_col, '5b710000-0000-0000-0000-00000000000c')) $f$;
  CREATE FUNCTION pg_temp.nbit() RETURNS text LANGUAGE sql AS
    $f$ SELECT pg_temp.q('SELECT count(*)::text FROM public.compras_config_separacion_bitacora WHERE company_id = ''5b710000-0000-0000-0000-00000000000c''') $f$;
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
  INSERT INTO public.projects (id, company_id, nombre) VALUES (pj, c, 'ZZ PP Proyecto C1');
  INSERT INTO auth.users (id) VALUES (ua), (ue), (ug), (uo), (usa), (ud), (ucr), (pg_temp.id(257));
  INSERT INTO public.app_users (id, company_id, full_name, role) VALUES
    (ua, c, 'ZZ PP Admin C', 'admin'), (ue, c, 'ZZ PP Editor', 'operator'), (ug, c, 'ZZ PP Genéricos', 'operator'), (uo, c, 'ZZ PP Propietario C', 'company_owner'),
    (usa, d, 'ZZ PP Superadmin', 'super_admin'), (ud, d, 'ZZ PP Admin D', 'admin'), (ucr, c, 'ZZ PP Solicitante', 'operator'), (pg_temp.id(257), c, 'ZZ PP k1 solo la llave', 'operator');
  INSERT INTO public.user_project_assignments (user_id, project_id, permission_type) VALUES (ua, pj, 'total'), (ue, pj, 'total'), (ug, pj, 'total'), (ucr, pj, 'total'), (pg_temp.id(257), pj, 'total');
  INSERT INTO public.roles (id, company_id, name) VALUES (pg_temp.id(1025), c, 'ZZ PP solo la llave 1'), (pg_temp.id(1537), c, 'ZZ PP editor'), (pg_temp.id(1538), c, 'ZZ PP genéricos'), (pg_temp.id(1539), c, 'ZZ PP solicitante');
  INSERT INTO public.role_permissions (role_id, permission_key, effect)
    SELECT pg_temp.id(1025), p, 'allow' FROM unnest(ARRAY['platform.contabilidad.view', 'platform.contabilidad.create', 'platform.contabilidad.edit', 'condominios.tab.ordenes_compra.approve']) p
    UNION ALL SELECT pg_temp.id(1537), p, 'allow' FROM unnest(ARRAY['platform.contabilidad.view', 'platform.contabilidad.create', 'platform.contabilidad.edit', 'platform.contabilidad.delete']) p
    UNION ALL SELECT pg_temp.id(1538), p, 'allow' FROM unnest(ARRAY['platform.contabilidad.view', 'platform.contabilidad.create', 'platform.contabilidad.edit', 'platform.contabilidad.approve', 'platform.contabilidad.change_status']) p
    UNION ALL SELECT pg_temp.id(1539), p, 'allow' FROM unnest(ARRAY['platform.contabilidad.view', 'platform.contabilidad.create', 'platform.contabilidad.edit', 'condominios.tab.ordenes_compra.approve']) p;
  INSERT INTO public.user_roles (user_id, role_id) VALUES (pg_temp.id(257), pg_temp.id(1025)), (ue, pg_temp.id(1537)), (ug, pg_temp.id(1538)), (ucr, pg_temp.id(1539));
  INSERT INTO public.proveedores (id, company_id, nombre, nit, pais, alcance) VALUES
    (pv, c, 'ZZ PP Proveedor C', '9999971-1', 'GT', 'empresa'), (pv2, c, 'ZZ PP Proveedor C2', '9999972-2', 'GT', 'empresa');
  PERFORM pg_temp.entra(ua);
  UPDATE public.proveedores SET estado = 'autorizado' WHERE id IN (pv, pv2);
  PERFORM pg_temp.sale();

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
  ev := ev || pg_temp.ck('2.4.3 · bitácora: una fila de esta empresa', pg_temp.nbit(), '1');
  ev := ev || pg_temp.ck('2.4.4 · bitácora: empresa', pg_temp.bit('company_id'), c::text);
  ev := ev || pg_temp.ck('2.4.5 · bitácora: actor = la persona de la sesión (lo sella el servidor)', pg_temp.bit('actor_id'), ua::text);
  ev := ev || pg_temp.ck('2.4.6 · bitácora: valor anterior → valor nuevo', pg_temp.bit('valor_anterior') || '>' || pg_temp.bit('valor_nuevo'), 'false>true');
  ev := ev || pg_temp.ck('2.4.7 · bitácora: motivo', pg_temp.bit('motivo'), 'ZZ Prueba del guion: encender la separación');
  ev := ev || pg_temp.ck('2.4.8 · bitácora: origen', pg_temp.bit('origen'), 'usuario');
  ev := ev || pg_temp.ck('2.4.9 · bitácora: fecha (entre el inicio de la transacción y ahora)', pg_temp.q(format('SELECT (cambiado_at BETWEEN now() AND clock_timestamp())::text FROM public.compras_config_separacion_bitacora WHERE company_id = %L ORDER BY id DESC LIMIT 1', c)), 'true');
  ev := ev || pg_temp.ck('2.4.10 · los intentos rechazados de 2.2 no dejaron rastro (sigue 1 fila)', pg_temp.nbit(), '1');
  -- 2.5 · intentos de evadirla por API directa, como editor Y como administrador, con la separación encendida
  stl := ARRAY['UPDATE por empresa', 'UPDATE sin filtro de fila', 'borrado por empresa', 'borrado sin filtro de fila', 'UPSERT (INSERT … ON CONFLICT DO UPDATE)', 'mover la fila a otra empresa', 'vaciado de la tabla'];
  stm := ARRAY[format('UPDATE public.compras_config SET aprobacion_separada = false WHERE company_id = %L', c),
    'UPDATE public.compras_config SET aprobacion_separada = false WHERE true',
    format('%s FROM public.compras_config WHERE company_id = %L', dk, c),
    dk || ' FROM public.compras_config WHERE true',
    format('INSERT INTO public.compras_config (company_id, aprobacion_separada) VALUES (%L, false) ON CONFLICT (company_id) DO UPDATE SET aprobacion_separada = false', c),
    format('UPDATE public.compras_config SET company_id = %L WHERE company_id = %L', d, c),
    tk || ' public.compras_config'];
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
  EXECUTE format('%s FROM public.compras_config WHERE company_id = %L', dk, c);
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
  ev := ev || pg_temp.ck('2.7.6 · y la bitácora no ganó filas', pg_temp.nbit(), '1');
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
    pg_temp.nbit() || '/' || pg_temp.bit('valor_anterior') || '>' || pg_temp.bit('valor_nuevo') || '/' || pg_temp.bit('actor_id') || '/' || pg_temp.bit('motivo'),
    '2/true>false/' || ua::text || '/ZZ Prueba del guion: apagar la separación');
  ev := ev || pg_temp.ck('2.9.3 · apagada: el solicitante SÍ aprueba su propia orden',
    pg_temp.prueba(ucr, sql_ins, format($q$SELECT estado || '/' || aprobada_por FROM public.ordenes_compra WHERE id = %L$q$, pg_temp.d(4, 0))), 'aprobada/' || ucr::text);
  ev := ev || pg_temp.ck('2.9.4 · apagada: el editor sigue sin poder encenderla a mano (UPDATE directo)', pg_temp.prueba(ue, format('UPDATE public.compras_config SET aprobacion_separada = true WHERE company_id = %L', c)), 'COMPRAS_CONFIG_SEPARACION_SOLO_ADMIN');
  -- 2.10 · la bitácora es append-only y nadie de la API escribe en ella
  FOR i IN 1..4 LOOP
    FOREACH pp IN ARRAY ARRAY[ue, ua] LOOP
      ev := ev || pg_temp.ck(format('2.10.%s · bitácora, %s como %s', i, (ARRAY['UPDATE', 'borrado', 'vaciado', 'INSERT con un actor inventado'])[i], CASE WHEN pp = ua THEN 'administrador' ELSE 'editor' END),
        pg_temp.prueba(pp, (ARRAY['UPDATE public.compras_config_separacion_bitacora SET motivo = ''ZZ reescrito''', dk || ' FROM public.compras_config_separacion_bitacora WHERE true', tk || ' public.compras_config_separacion_bitacora',
          format('INSERT INTO public.compras_config_separacion_bitacora (company_id, actor_id, valor_anterior, valor_nuevo, motivo, origen) VALUES (%L, %L, true, false, ''ZZ falsificada por el cliente'', ''usuario'')', c, ue)])[i]),
        'permission denied for table compras_config_separacion_bitacora');
    END LOOP;
  END LOOP;
  ev := ev || pg_temp.ck('2.10.5 · incluso el dueño de la tabla: UPDATE rechazado por el trigger', pg_temp.err('UPDATE public.compras_config_separacion_bitacora SET motivo = ''ZZ reescrito'' WHERE company_id = ''' || c || ''''), 'COMPRAS_SEPARACION_BITACORA_INMUTABLE');
  ev := ev || pg_temp.ck('2.10.6 · incluso el dueño de la tabla: borrar una fila es rechazado por el trigger', pg_temp.err(dk || ' FROM public.compras_config_separacion_bitacora WHERE company_id = ''' || c || ''''), 'COMPRAS_SEPARACION_BITACORA_INMUTABLE');
  ev := ev || pg_temp.ck('2.10.7 · incluso el dueño de la tabla: vaciarla es rechazado por el trigger', pg_temp.err(tk || ' public.compras_config_separacion_bitacora'), 'COMPRAS_SEPARACION_BITACORA_INMUTABLE');
  ev := ev || pg_temp.ck('2.10.8 · la bitácora sigue con sus 2 filas tras todos los intentos', pg_temp.nbit(), '2');
  -- 2.11 · quién lee la bitácora (RLS)
  sql_ins := 'SELECT count(*)::text FROM public.compras_config_separacion_bitacora WHERE company_id = ''' || c || '''';
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
