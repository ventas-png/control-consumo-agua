-- ============================================================================
-- VALIDACIÓN EN SANDBOX · CONTROLES DE SERVIDOR DEL CIRCUITO DE COMPRAS
-- (migraciones 20261027000000 … 20261027000700). Corre ANTES de aplicarlas (debe MOSTRAR las fallas:
-- es la prueba de que el defecto existe en el esquema desplegado) y DESPUÉS (todo OK).
--
-- «API directa»: DML como `authenticated` con el sub del JWT fijado, que es lo que ejecuta PostgREST.
-- SQL plano; UNA sola sentencia (DO) que TERMINA SIEMPRE con una excepción para REVERTIR todo:
--   GUION_OK_REVERTIDO → todo coincide · GUION_FALLO → alguna comprobación no coincide · otro → fallo del recorrido.
-- Sin DELETE ni DROP (la herramienta SQL del sandbox se cuelga con DELETE …; los casos de borrado se prueban en
-- el PostgreSQL desechable). Padrón de usar y tirar `5b70…`.
-- ============================================================================
DO $guion$
DECLARE
  c   constant uuid := '5b700000-0000-0000-0000-00000000000c';
  d   constant uuid := '5b700000-0000-0000-0000-00000000000d';
  pj  constant uuid := '5b700000-0000-0000-0000-0000000000a1';
  pjd constant uuid := '5b700000-0000-0000-0000-0000000000a2';
  ua  constant uuid := '5b700000-0000-0000-0000-0000000000f1';  -- admin de C
  uq  constant uuid := '5b700000-0000-0000-0000-0000000000f2';  -- autoriza (approve)
  us  constant uuid := '5b700000-0000-0000-0000-0000000000f3';  -- cambia estado (change_status)
  uc  constant uuid := '5b700000-0000-0000-0000-0000000000f4';  -- solo ver/crear/editar
  ud  constant uuid := '5b700000-0000-0000-0000-0000000000f5';  -- admin de D
  pv  constant uuid := '5b700000-0000-0000-0000-0000000000b1';
  pvd constant uuid := '5b700000-0000-0000-0000-0000000000b2';
  od  constant uuid := '5b700000-0000-0000-0000-0000000000d1';  -- orden en borrador de D
  fd  constant uuid := '5b700000-0000-0000-0000-0000000000d2';  -- factura registrada de D
  o1  constant uuid := '5b700000-0000-0000-0000-0000000000e1';
  l1  constant uuid := '5b700000-0000-0000-0000-0000000000e2';
  r1  constant uuid := '5b700000-0000-0000-0000-0000000000e3';
  f1  constant uuid := '5b700000-0000-0000-0000-0000000000e4';
  p1  constant uuid := '5b700000-0000-0000-0000-0000000000e5';
  p2  constant uuid := '5b700000-0000-0000-0000-0000000000e6';
  o2  constant uuid := '5b700000-0000-0000-0000-0000000000e7';
  ev  text[] := ARRAY[]::text[];
  cta_d uuid;
  fallos int;
BEGIN
  CREATE FUNCTION pg_temp.ck(p_lbl text, p_o text, p_e text) RETURNS text LANGUAGE sql IMMUTABLE AS
    $f$ SELECT CASE WHEN $2 IS NOT DISTINCT FROM $3 THEN 'OK    ' ELSE 'FALLO ' END || $1 || ' · obtenido=' || coalesce($2, 'NULL') || ' esperado=' || coalesce($3, 'NULL') $f$;
  -- Ejecuta una sentencia que DEBE fallar. Si NO falla, informa «SIN ERROR» y REVIERTE su efecto.
  CREATE FUNCTION pg_temp.err(p text) RETURNS text LANGUAGE plpgsql AS
    $f$ BEGIN EXECUTE p; RAISE EXCEPTION 'SIN_ERROR_REVERTIDO';
        EXCEPTION WHEN OTHERS THEN IF SQLERRM = 'SIN_ERROR_REVERTIDO' THEN RETURN 'SIN ERROR'; END IF; RETURN split_part(SQLERRM, ':', 1); END $f$;

  IF EXISTS (SELECT 1 FROM public.companies WHERE id IN (c, d)) THEN
    RAISE EXCEPTION 'ABORTA: las empresas de prueba ya existen; no se escribe nada.';
  END IF;

  INSERT INTO public.companies (id, nombre, default_currency) VALUES (c, 'ZZ Controles C', 'gtq'), (d, 'ZZ Controles D', 'gtq');
  INSERT INTO public.projects (id, company_id, nombre) VALUES (pj, c, 'ZZ CS Proyecto C'), (pjd, d, 'ZZ CS Proyecto D');
  INSERT INTO auth.users (id) VALUES (ua), (uq), (us), (uc), (ud);
  INSERT INTO public.app_users (id, company_id, full_name, role) VALUES
    (ua, c, 'ZZ CS Admin C', 'admin'), (uq, c, 'ZZ CS Autoriza', 'operator'), (us, c, 'ZZ CS Cambia estado', 'operator'),
    (uc, c, 'ZZ CS Contador', 'operator'), (ud, d, 'ZZ CS Admin D', 'admin');
  INSERT INTO public.user_project_assignments (user_id, project_id, permission_type) VALUES
    (ua, pj, 'total'), (uq, pj, 'total'), (us, pj, 'total'), (uc, pj, 'total'), (ud, pjd, 'total');
  INSERT INTO public.roles (id, company_id, name) VALUES
    ('5b700000-0000-0000-0000-0000000000a8', c, 'ZZ CS Autoriza'),
    ('5b700000-0000-0000-0000-0000000000a9', c, 'ZZ CS Cambia estado'),
    ('5b700000-0000-0000-0000-0000000000aa', c, 'ZZ CS Contador');
  INSERT INTO public.role_permissions (role_id, permission_key, effect) VALUES
    ('5b700000-0000-0000-0000-0000000000a8', 'platform.contabilidad.view', 'allow'),
    ('5b700000-0000-0000-0000-0000000000a8', 'platform.contabilidad.create', 'allow'),
    ('5b700000-0000-0000-0000-0000000000a8', 'platform.contabilidad.edit', 'allow'),
    ('5b700000-0000-0000-0000-0000000000a8', 'platform.contabilidad.approve', 'allow'),
    ('5b700000-0000-0000-0000-0000000000a9', 'platform.contabilidad.view', 'allow'),
    ('5b700000-0000-0000-0000-0000000000a9', 'platform.contabilidad.create', 'allow'),
    ('5b700000-0000-0000-0000-0000000000a9', 'platform.contabilidad.edit', 'allow'),
    ('5b700000-0000-0000-0000-0000000000a9', 'platform.contabilidad.change_status', 'allow'),
    ('5b700000-0000-0000-0000-0000000000aa', 'platform.contabilidad.view', 'allow'),
    ('5b700000-0000-0000-0000-0000000000aa', 'platform.contabilidad.create', 'allow'),
    ('5b700000-0000-0000-0000-0000000000aa', 'platform.contabilidad.edit', 'allow'),
    ('5b700000-0000-0000-0000-0000000000aa', 'platform.contabilidad.delete', 'allow');
  INSERT INTO public.user_roles (user_id, role_id) VALUES
    (uq, '5b700000-0000-0000-0000-0000000000a8'), (us, '5b700000-0000-0000-0000-0000000000a9'), (uc, '5b700000-0000-0000-0000-0000000000aa');
  PERFORM public.conta_seed_catalogo(c, pj);
  PERFORM public.compras_seed_cuentas(c, pj);
  PERFORM public.conta_seed_catalogo(d, pjd);
  PERFORM public.compras_seed_cuentas(d, pjd);
  INSERT INTO public.proveedores (id, company_id, nombre, nit, pais, alcance) VALUES
    (pv,  c, 'ZZ CS Proveedor C', '9999981-1', 'GT', 'empresa'),
    (pvd, d, 'ZZ CS Proveedor D', '9999982-2', 'GT', 'empresa');
  PERFORM set_config('request.jwt.claim.sub', ua::text, true);
  SET LOCAL ROLE authenticated;
  UPDATE public.proveedores SET estado = 'autorizado' WHERE id = pv;
  RESET ROLE;
  PERFORM set_config('request.jwt.claim.sub', ud::text, true);
  SET LOCAL ROLE authenticated;
  UPDATE public.proveedores SET estado = 'autorizado' WHERE id = pvd;
  INSERT INTO public.ordenes_compra (id, company_id, project_id, proveedor_id, proveedor_nombre, concepto) VALUES (od, d, pjd, pvd, 'ZZ CS Proveedor D', 'OC de D');
  INSERT INTO public.orden_compra_lineas (company_id, orden_compra_id, linea, descripcion, destino_tipo, categoria, cantidad, unidad, precio_unitario) VALUES (d, od, 1, 'Renglón de D', 'gasto', 'otros', 1, 'u', 50);
  INSERT INTO public.facturas_proveedor (id, company_id, project_id, proveedor_id, numero_factura, concepto, monto_total) VALUES (fd, d, pjd, pvd, 'ZZ-FD-1', 'Factura de D', 70);
  RESET ROLE;
  SELECT id INTO cta_d FROM public.conta_cuentas WHERE company_id = d AND tipo = 'gasto' AND es_detalle AND activa ORDER BY codigo LIMIT 1;

  -- ═══ 1 · AISLAMIENTO ═════════════════════════════════════════════════════════════
  PERFORM set_config('request.jwt.claim.sub', ua::text, true);
  SET LOCAL ROLE authenticated;
  ev := ev || pg_temp.ck('1a · orden de C con el proveedor de D: rechazada',
    pg_temp.err(format($q$INSERT INTO public.ordenes_compra (company_id, project_id, proveedor_id, proveedor_nombre, concepto) VALUES (%L,%L,%L,'x','x')$q$, c, pj, pvd)), 'COMPRAS_ALCANCE_PROVEEDOR');
  ev := ev || pg_temp.ck('1b · orden de C con el proyecto de D: rechazada',
    pg_temp.err(format($q$INSERT INTO public.ordenes_compra (company_id, project_id, proveedor_id, proveedor_nombre, concepto) VALUES (%L,%L,%L,'x','x')$q$, c, pjd, pv)), 'COMPRAS_ALCANCE_PROYECTO');
  ev := ev || pg_temp.ck('1c · factura de C con el proveedor de D: rechazada',
    pg_temp.err(format($q$INSERT INTO public.facturas_proveedor (company_id, project_id, proveedor_id, numero_factura, concepto, monto_total) VALUES (%L,%L,%L,'ZZ-X-1','x',10)$q$, c, pj, pvd)), 'COMPRAS_ALCANCE_PROVEEDOR');
  ev := ev || pg_temp.ck('1d · orden de pago de C contra la factura de D: rechazada',
    pg_temp.err(format($q$INSERT INTO public.ordenes_pago (company_id, project_id, proveedor_id, factura_id, monto) VALUES (%L,%L,%L,%L,70)$q$, c, pj, pv, fd)), 'COMPRAS_PAGO_FACTURA_AJENA');
  ev := ev || pg_temp.ck('1e · renglón de C dentro de la orden (borrador) de D: rechazado',
    pg_temp.err(format($q$INSERT INTO public.orden_compra_lineas (company_id, orden_compra_id, linea, descripcion, destino_tipo, categoria, cantidad, unidad, precio_unitario) VALUES (%L,%L,2,'intrusa','gasto','otros',1,'u',1)$q$, c, od)), 'COMPRAS_ALCANCE_RENGLON');
  ev := ev || pg_temp.ck('1f · renglón de C dentro de la factura (registrada) de D: rechazado',
    pg_temp.err(format($q$INSERT INTO public.factura_proveedor_lineas (company_id, factura_id, linea, descripcion, cantidad, precio_unitario) VALUES (%L,%L,1,'intrusa',1,1)$q$, c, fd)), 'COMPRAS_ALCANCE_RENGLON');
  RESET ROLE;
  ev := ev || pg_temp.ck('1e · el total de la orden de D no cambió', (SELECT total::text FROM public.ordenes_compra WHERE id = od), '50.00');
  ev := ev || pg_temp.ck('1f · el monto de la factura de D no cambió', (SELECT monto_total::text FROM public.facturas_proveedor WHERE id = fd), '70.00');
  PERFORM set_config('request.jwt.claim.sub', ua::text, true);
  SET LOCAL ROLE authenticated;
  INSERT INTO public.facturas_proveedor (id, company_id, project_id, proveedor_id, numero_factura, concepto, monto_total) VALUES ('5b700000-0000-0000-0000-0000000000e9', c, pj, pv, 'ZZ-CTA-1', 'cuentas', 1);
  ev := ev || pg_temp.ck('1g · renglón de factura con una cuenta de OTRA empresa: rechazado',
    pg_temp.err(format($q$INSERT INTO public.factura_proveedor_lineas (company_id, factura_id, linea, descripcion, cantidad, precio_unitario, cuenta_id) VALUES (%L,'5b700000-0000-0000-0000-0000000000e9',1,'x',1,10,%L)$q$, c, cta_d)), 'COMPRAS_LINEA_CUENTA_LEDGER');
  RESET ROLE;

  -- ═══ 2 · PAGOS ═══════════════════════════════════════════════════════════════════
  PERFORM set_config('request.jwt.claim.sub', ua::text, true);
  SET LOCAL ROLE authenticated;
  INSERT INTO public.ordenes_compra (id, company_id, project_id, proveedor_id, proveedor_nombre, concepto) VALUES (o1, c, pj, pv, 'ZZ CS Proveedor C', 'Servicio de prueba');
  INSERT INTO public.orden_compra_lineas (id, company_id, orden_compra_id, linea, descripcion, destino_tipo, categoria, cantidad, unidad, precio_unitario, iva_monto)
    VALUES (l1, c, o1, 1, 'Servicio', 'servicio', 'servicios', 10, 'servicio', 100, 120);
  UPDATE public.ordenes_compra SET estado = 'aprobada' WHERE id = o1;
  UPDATE public.ordenes_compra SET estado = 'emitida' WHERE id = o1;
  INSERT INTO public.recepciones (id, company_id, project_id, orden_compra_id, tipo, recibido_por) VALUES (r1, c, pj, o1, 'servicio', ua);
  INSERT INTO public.recepcion_lineas (company_id, recepcion_id, orden_compra_linea_id, cantidad) VALUES (c, r1, l1, 10);
  UPDATE public.recepciones SET estado = 'registrada' WHERE id = r1;
  INSERT INTO public.facturas_proveedor (id, company_id, project_id, proveedor_id, orden_compra_id, numero_factura, concepto, monto_total) VALUES (f1, c, pj, pv, o1, 'ZZ-PAGO-1', 'Factura', 1);
  INSERT INTO public.factura_proveedor_lineas (company_id, factura_id, orden_compra_linea_id, linea, descripcion, cantidad, precio_unitario, iva_monto) VALUES (c, f1, l1, 1, 'Servicio', 10, 100, 120);
  ev := ev || pg_temp.ck('2a · orden de pago contra una factura SIN APROBAR: rechazada',
    pg_temp.err(format($q$INSERT INTO public.ordenes_pago (company_id, project_id, proveedor_id, factura_id, monto) VALUES (%L,%L,%L,%L,100)$q$, c, pj, pv, f1)), 'COMPRAS_FACTURA_NO_PAGABLE');
  UPDATE public.facturas_proveedor SET estado = 'aprobada' WHERE id = f1;
  ev := ev || pg_temp.ck('2b · una orden de pago no nace «pagada»',
    pg_temp.err(format($q$INSERT INTO public.ordenes_pago (company_id, project_id, proveedor_id, factura_id, monto, estado) VALUES (%L,%L,%L,%L,100,'pagada')$q$, c, pj, pv, f1)), 'COMPRAS_PAGO_ESTADO_INICIAL');
  INSERT INTO public.ordenes_pago (id, company_id, project_id, proveedor_id, factura_id, monto, solicitada_por) VALUES (p1, c, pj, pv, f1, 600, uc);
  ev := ev || pg_temp.ck('2c · 5 000 sobre una factura de 1 120: rechazado',
    pg_temp.err(format($q$INSERT INTO public.ordenes_pago (company_id, project_id, proveedor_id, factura_id, monto) VALUES (%L,%L,%L,%L,5000)$q$, c, pj, pv, f1)), 'COMPRAS_PAGO_EXCEDE_SALDO');
  ev := ev || pg_temp.ck('2c · 600 + 600 sobre 1 120: rechazado',
    pg_temp.err(format($q$INSERT INTO public.ordenes_pago (company_id, project_id, proveedor_id, factura_id, monto) VALUES (%L,%L,%L,%L,600)$q$, c, pj, pv, f1)), 'COMPRAS_PAGO_EXCEDE_SALDO');
  ev := ev || pg_temp.ck('2d · de borrador no se salta a «pagada»',
    pg_temp.err(format($q$UPDATE public.ordenes_pago SET estado = 'pagada' WHERE id = %L$q$, p1)), 'COMPRAS_PAGO_TRANSICION_INVALIDA');
  INSERT INTO public.ordenes_pago (id, company_id, project_id, proveedor_id, factura_id, monto) VALUES (p2, c, pj, pv, f1, 520);
  UPDATE public.ordenes_pago SET estado = 'aprobada', aprobada_por = uc WHERE id = p1;
  UPDATE public.ordenes_pago SET estado = 'pagada', fecha_pago = CURRENT_DATE WHERE id = p1;
  UPDATE public.ordenes_pago SET estado = 'aprobada' WHERE id = p2;
  UPDATE public.ordenes_pago SET estado = 'pagada', fecha_pago = CURRENT_DATE WHERE id = p2;
  UPDATE public.ordenes_pago SET estado = 'pagada', fecha_pago = CURRENT_DATE WHERE id = p2;   -- doble clic
  RESET ROLE;
  ev := ev || pg_temp.ck('2e · «solicitada_por» lo sella el servidor (el navegador dijo el contador)', (SELECT solicitada_por::text FROM public.ordenes_pago WHERE id = p1), ua::text);
  ev := ev || pg_temp.ck('2e · «aprobada_por» lo sella el servidor', (SELECT aprobada_por::text FROM public.ordenes_pago WHERE id = p1), ua::text);
  ev := ev || pg_temp.ck('2f · 600 + 520: la factura queda pagada por 1 120', (SELECT estado || '/' || monto_pagado FROM public.facturas_proveedor WHERE id = f1), 'pagada/1120.00');
  ev := ev || pg_temp.ck('2f · dos pagos, dos asientos (el doble clic no duplicó)',
    (SELECT count(*)::text FROM public.conta_asientos WHERE company_id = c AND origen_tabla = 'ordenes_pago' AND origen_evento = 'orden_pago_pagada' AND estado = 'publicado'), '2');
  PERFORM set_config('request.jwt.claim.sub', ua::text, true);
  SET LOCAL ROLE authenticated;
  ev := ev || pg_temp.ck('2g · una factura ya pagada no admite otra orden de pago',
    pg_temp.err(format($q$INSERT INTO public.ordenes_pago (company_id, project_id, proveedor_id, factura_id, monto) VALUES (%L,%L,%L,%L,1)$q$, c, pj, pv, f1)), 'COMPRAS_FACTURA_NO_PAGABLE');
  RESET ROLE;

  -- ═══ 3 · PERMISOS POR ACCIÓN ═════════════════════════════════════════════════════
  PERFORM set_config('request.jwt.claim.sub', uc::text, true);
  SET LOCAL ROLE authenticated;
  INSERT INTO public.ordenes_compra (id, company_id, project_id, proveedor_id, proveedor_nombre, concepto) VALUES (o2, c, pj, pv, 'ZZ CS Proveedor C', 'Permisos por acción');
  INSERT INTO public.orden_compra_lineas (company_id, orden_compra_id, linea, descripcion, destino_tipo, categoria, cantidad, unidad, precio_unitario) VALUES (c, o2, 1, 'Servicio', 'servicio', 'servicios', 1, 'servicio', 100);
  ev := ev || pg_temp.ck('3a · el contador (solo editar) NO aprueba la orden que solicitó',
    pg_temp.err(format($q$UPDATE public.ordenes_compra SET estado = 'aprobada' WHERE id = %L$q$, o2)), 'COMPRAS_PERMISO_ACCION');
  RESET ROLE;
  PERFORM set_config('request.jwt.claim.sub', uq::text, true);
  SET LOCAL ROLE authenticated;
  UPDATE public.ordenes_compra SET estado = 'aprobada', aprobada_por = uc WHERE id = o2;
  ev := ev || pg_temp.ck('3b · quien tiene «Autorizar / Denegar» aprueba', (SELECT estado FROM public.ordenes_compra WHERE id = o2), 'aprobada');
  ev := ev || pg_temp.ck('3c · quien solo autoriza NO emite la orden',
    pg_temp.err(format($q$UPDATE public.ordenes_compra SET estado = 'emitida' WHERE id = %L$q$, o2)), 'COMPRAS_PERMISO_ACCION');
  RESET ROLE;
  ev := ev || pg_temp.ck('3b · el aprobador lo sella el servidor (el navegador dijo el contador)', (SELECT aprobada_por::text FROM public.ordenes_compra WHERE id = o2), uq::text);
  PERFORM set_config('request.jwt.claim.sub', us::text, true);
  SET LOCAL ROLE authenticated;
  UPDATE public.ordenes_compra SET estado = 'emitida' WHERE id = o2;
  ev := ev || pg_temp.ck('3d · quien tiene «Cambiar estado» emite', (SELECT estado FROM public.ordenes_compra WHERE id = o2), 'emitida');
  RESET ROLE;
  PERFORM set_config('request.jwt.claim.sub', uc::text, true);
  SET LOCAL ROLE authenticated;
  INSERT INTO public.recepciones (id, company_id, project_id, orden_compra_id, tipo, recibido_por) VALUES ('5b700000-0000-0000-0000-0000000000ea', c, pj, o2, 'servicio', uc);
  INSERT INTO public.recepcion_lineas (company_id, recepcion_id, orden_compra_linea_id, cantidad) SELECT c, '5b700000-0000-0000-0000-0000000000ea', id, 1 FROM public.orden_compra_lineas WHERE orden_compra_id = o2;
  ev := ev || pg_temp.ck('3e · quien captura la recepción NO la registra',
    pg_temp.err(format($q$UPDATE public.recepciones SET estado = 'registrada' WHERE id = %L$q$, '5b700000-0000-0000-0000-0000000000ea')), 'COMPRAS_PERMISO_ACCION');
  RESET ROLE;
  PERFORM set_config('request.jwt.claim.sub', us::text, true);
  SET LOCAL ROLE authenticated;
  UPDATE public.recepciones SET estado = 'registrada' WHERE id = '5b700000-0000-0000-0000-0000000000ea';
  RESET ROLE;
  PERFORM set_config('request.jwt.claim.sub', uc::text, true);
  SET LOCAL ROLE authenticated;
  INSERT INTO public.facturas_proveedor (id, company_id, project_id, proveedor_id, orden_compra_id, numero_factura, concepto, monto_total) VALUES ('5b700000-0000-0000-0000-0000000000eb', c, pj, pv, o2, 'ZZ-PERM-1', 'F', 1);
  INSERT INTO public.factura_proveedor_lineas (company_id, factura_id, orden_compra_linea_id, linea, descripcion, cantidad, precio_unitario) SELECT c, '5b700000-0000-0000-0000-0000000000eb', id, 1, 'Servicio', 1, 100 FROM public.orden_compra_lineas WHERE orden_compra_id = o2;
  ev := ev || pg_temp.ck('3f · quien captura la factura NO la aprueba ni la contabiliza',
    pg_temp.err(format($q$UPDATE public.facturas_proveedor SET estado = 'aprobada' WHERE id = %L$q$, '5b700000-0000-0000-0000-0000000000eb')), 'COMPRAS_PERMISO_ACCION');
  RESET ROLE;
  PERFORM set_config('request.jwt.claim.sub', uq::text, true);
  SET LOCAL ROLE authenticated;
  UPDATE public.facturas_proveedor SET estado = 'aprobada' WHERE id = '5b700000-0000-0000-0000-0000000000eb';
  ev := ev || pg_temp.ck('3g · quien autoriza aprueba la factura', (SELECT estado FROM public.facturas_proveedor WHERE id = '5b700000-0000-0000-0000-0000000000eb'), 'aprobada');
  ev := ev || pg_temp.ck('3h · anular la factura exige «Cambiar estado»',
    pg_temp.err(format($q$UPDATE public.facturas_proveedor SET estado = 'anulada' WHERE id = %L$q$, '5b700000-0000-0000-0000-0000000000eb')), 'COMPRAS_PERMISO_ACCION');
  RESET ROLE;
  PERFORM set_config('request.jwt.claim.sub', uc::text, true);
  SET LOCAL ROLE authenticated;
  INSERT INTO public.ordenes_pago (id, company_id, project_id, proveedor_id, factura_id, monto) VALUES ('5b700000-0000-0000-0000-0000000000ec', c, pj, pv, '5b700000-0000-0000-0000-0000000000eb', 100);
  ev := ev || pg_temp.ck('3i · quien solicita el pago NO lo aprueba',
    pg_temp.err(format($q$UPDATE public.ordenes_pago SET estado = 'aprobada' WHERE id = %L$q$, '5b700000-0000-0000-0000-0000000000ec')), 'COMPRAS_PERMISO_ACCION');
  RESET ROLE;
  PERFORM set_config('request.jwt.claim.sub', uq::text, true);
  SET LOCAL ROLE authenticated;
  UPDATE public.ordenes_pago SET estado = 'aprobada' WHERE id = '5b700000-0000-0000-0000-0000000000ec';
  ev := ev || pg_temp.ck('3j · quien aprueba el pago NO lo ejecuta',
    pg_temp.err(format($q$UPDATE public.ordenes_pago SET estado = 'pagada', fecha_pago = CURRENT_DATE WHERE id = %L$q$, '5b700000-0000-0000-0000-0000000000ec')), 'COMPRAS_PERMISO_ACCION');
  RESET ROLE;
  PERFORM set_config('request.jwt.claim.sub', us::text, true);
  SET LOCAL ROLE authenticated;
  UPDATE public.ordenes_pago SET estado = 'pagada', fecha_pago = CURRENT_DATE WHERE id = '5b700000-0000-0000-0000-0000000000ec';
  ev := ev || pg_temp.ck('3k · quien cambia estado paga', (SELECT estado FROM public.ordenes_pago WHERE id = '5b700000-0000-0000-0000-0000000000ec'), 'pagada');
  RESET ROLE;

  -- ═══ 4 · ESTADOS DE NACIMIENTO Y ESTADOS DE SISTEMA ══════════════════════════════
  PERFORM set_config('request.jwt.claim.sub', ua::text, true);
  SET LOCAL ROLE authenticated;
  ev := ev || pg_temp.ck('4a · una orden no nace «recibida»',
    pg_temp.err(format($q$INSERT INTO public.ordenes_compra (company_id, project_id, proveedor_id, proveedor_nombre, concepto, estado) VALUES (%L,%L,%L,'x','directa','recibida')$q$, c, pj, pv)), 'COMPRAS_ESTADO_INICIAL');
  RESET ROLE;
  PERFORM set_config('request.jwt.claim.sub', uc::text, true);
  SET LOCAL ROLE authenticated;
  ev := ev || pg_temp.ck('4a · quien solo crea NO inserta una orden ya «aprobada»',
    pg_temp.err(format($q$INSERT INTO public.ordenes_compra (company_id, project_id, proveedor_id, proveedor_nombre, concepto, estado) VALUES (%L,%L,%L,'x','directa','aprobada')$q$, c, pj, pv)), 'COMPRAS_PERMISO_ACCION');
  RESET ROLE;
  PERFORM set_config('request.jwt.claim.sub', ua::text, true);
  SET LOCAL ROLE authenticated;
  INSERT INTO public.ordenes_compra (id, company_id, project_id, proveedor_id, proveedor_nombre, concepto, estado, aprobada_por)
    VALUES ('5b700000-0000-0000-0000-0000000000ee', c, pj, pv, 'ZZ CS Proveedor C', 'nace aprobada', 'aprobada', uc);
  ev := ev || pg_temp.ck('4a · el administrador sí inserta una orden ya «aprobada» y el servidor sella SU firma (el navegador dijo el contador)',
    (SELECT aprobada_por::text FROM public.ordenes_compra WHERE id = '5b700000-0000-0000-0000-0000000000ee'), ua::text);
  ev := ev || pg_temp.ck('4b · una factura no se crea «aprobada»',
    pg_temp.err(format($q$INSERT INTO public.facturas_proveedor (company_id, project_id, proveedor_id, numero_factura, concepto, monto_total, estado) VALUES (%L,%L,%L,'ZZ-DIR-1','x',500,'aprobada')$q$, c, pj, pv)), 'COMPRAS_ESTADO_INICIAL');
  INSERT INTO public.facturas_proveedor (id, company_id, project_id, proveedor_id, numero_factura, concepto, monto_total) VALUES ('5b700000-0000-0000-0000-0000000000ed', c, pj, pv, 'ZZ-SIS-1', 'x', 500);
  ev := ev || pg_temp.ck('4c · una factura no se marca «pagada» a mano',
    pg_temp.err(format($q$UPDATE public.facturas_proveedor SET estado = 'pagada', monto_pagado = 500 WHERE id = %L$q$, '5b700000-0000-0000-0000-0000000000ed')), 'COMPRAS_ESTADO_SOLO_SISTEMA');

  -- ═══ 5 · DUPLICADOS ══════════════════════════════════════════════════════════════
  INSERT INTO public.proveedores (company_id, nombre) VALUES (c, 'ZZ CS Distribuidora Norte');
  INSERT INTO public.proveedores (company_id, nombre) VALUES (c, 'ZZ CS  DISTRIBUIDORA norte.');
  ev := ev || pg_temp.ck('5a · (decisión vigente de PR A) los nombres equivalentes sin identificación fiscal conviven: se listan, no se bloquean',
    (SELECT count(*)::text FROM public.proveedores WHERE company_id = c AND public.proveedor_normalizar_nombre(nombre) = 'zz cs distribuidora norte'), '2');
  INSERT INTO public.facturas_proveedor (company_id, project_id, proveedor_id, numero_factura, concepto, monto_total) VALUES (c, pj, pv, 'ZZ-FAC-100', 'primera', 100);
  ev := ev || pg_temp.ck('5b · el mismo número de factura con otro formato: rechazado',
    pg_temp.err(format($q$INSERT INTO public.facturas_proveedor (company_id, project_id, proveedor_id, numero_factura, concepto, monto_total) VALUES (%L,%L,%L,' zz fac 100 ','misma',100)$q$, c, pj, pv)), 'COMPRAS_FACTURA_NUMERO_DUPLICADO');

  -- ═══ 6 · CAMBIOS POSTERIORES A LA APROBACIÓN ═════════════════════════════════════
  UPDATE public.ordenes_compra SET notas = 'Entregar en portería' WHERE id = o2;
  RESET ROLE;
  ev := ev || pg_temp.ck('6a · cambiar las notas de una orden emitida deja un evento «modificacion»',
    (SELECT count(*)::text FROM public.orden_compra_eventos WHERE orden_compra_id = o2 AND tipo = 'modificacion'), '1');
  PERFORM set_config('request.jwt.claim.sub', ua::text, true);
  SET LOCAL ROLE authenticated;
  ev := ev || pg_temp.ck('6b · el número de la orden no cambia',
    pg_temp.err(format($q$UPDATE public.ordenes_compra SET numero = 'OC-999999' WHERE id = %L$q$, o2)), 'COMPRAS_OC_NUMERO_INMUTABLE');
  RESET ROLE;

  SELECT count(*) INTO fallos FROM unnest(ev) e WHERE e LIKE 'FALLO%';
  RAISE EXCEPTION E'%\n— % comprobaciones, % con FALLO —\n%', CASE WHEN fallos = 0 THEN 'GUION_OK_REVERTIDO' ELSE 'GUION_FALLO' END,
    cardinality(ev), fallos, array_to_string(ev, E'\n');
END
$guion$;
