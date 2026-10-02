-- ============================================================================
-- VALIDACIÓN FUNCIONAL DE PUNTA A PUNTA · compra → recepción parcial/final →
-- factura → contabilización, con servicio y activo sobre CUENTAS PERSONALIZADAS.
--
-- SQL plano (sin variables de psql): se puede pegar tal cual en el editor SQL o
-- enviar por la API. Todo ocurre en UNA sola sentencia (DO) y TERMINA con una
-- excepción que lleva la evidencia en su mensaje, de modo que la transacción se
-- REVIERTE y no queda ninguna fila, función ni cuenta de prueba. Es la única
-- forma de que un entorno compartido quede igual que antes.
--
-- Empresa, proyectos, usuarios y proveedor son de usar y tirar (UUID fijos con
-- prefijo `5b5b…`); si alguno ya existiera el guion aborta ANTES de escribir.
-- Para guardar los datos en lugar de revertirlos, quitar el RAISE final (no se
-- recomienda en el sandbox compartido).
-- ============================================================================
DO $guion$
DECLARE
  c   constant uuid := '5b5b0000-0000-0000-0000-00000000000c';  -- empresa
  pj  constant uuid := '5b5b0000-0000-0000-0000-0000000000a1';  -- proyecto (ledger propio)
  ua  constant uuid := '5b5b0000-0000-0000-0000-0000000000f1';  -- admin
  uo  constant uuid := '5b5b0000-0000-0000-0000-0000000000f2';  -- operador de compras
  uk  constant uuid := '5b5b0000-0000-0000-0000-0000000000f3';  -- contador
  pv  constant uuid := '5b5b0000-0000-0000-0000-0000000000b1';  -- proveedor
  su  constant uuid := '5b5b0000-0000-0000-0000-0000000000d1';  -- insumo
  oc  constant uuid := '5b5b0000-0000-0000-0000-0000000000e1';
  l1  constant uuid := '5b5b0000-0000-0000-0000-0000000000e2';  -- inventario
  l2  constant uuid := '5b5b0000-0000-0000-0000-0000000000e3';  -- servicio, cuenta explícita
  l3  constant uuid := '5b5b0000-0000-0000-0000-0000000000e4';  -- activo fijo, cuenta por mapeo
  r1  constant uuid := '5b5b0000-0000-0000-0000-0000000000c1';
  r2  constant uuid := '5b5b0000-0000-0000-0000-0000000000c2';
  r3  constant uuid := '5b5b0000-0000-0000-0000-0000000000c3';
  f1  constant uuid := '5b5b0000-0000-0000-0000-0000000000a9';
  f2  constant uuid := '5b5b0000-0000-0000-0000-0000000000aa';
  ev  text[] := ARRAY[]::text[];
  v   numeric;
  t   text;
  cta_servicio uuid;
  cta_activo   uuid;
BEGIN
  IF EXISTS (SELECT 1 FROM public.companies WHERE id = c) THEN
    RAISE EXCEPTION 'ABORTA: la empresa de prueba ya existe; no se escribe nada.';
  END IF;

  -- ── Padrón de usar y tirar ────────────────────────────────────────────────
  INSERT INTO public.companies (id, nombre, default_currency) VALUES (c, 'ZZ Validación Bloque B', 'gtq');
  INSERT INTO public.projects (id, company_id, nombre) VALUES (pj, c, 'ZZ Proyecto validación');
  INSERT INTO auth.users (id) VALUES (ua), (uo), (uk);
  INSERT INTO public.app_users (id, company_id, full_name, role) VALUES
    (ua, c, 'ZZ Admin', 'admin'), (uo, c, 'ZZ Operador compras', 'operator'), (uk, c, 'ZZ Contador', 'operator');
  INSERT INTO public.user_project_assignments (user_id, project_id, permission_type)
    SELECT u, pj, 'total' FROM unnest(ARRAY[ua, uo, uk]) u;
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
    (uk, '5b5b0000-0000-0000-0000-0000000000c9'), (uo, '5b5b0000-0000-0000-0000-0000000000c8');

  -- ── Contabilidad PROPIA: catálogo sembrado + cuentas PERSONALIZADAS ───────
  PERFORM public.conta_seed_catalogo(c, pj);
  PERFORM public.compras_seed_cuentas(c, pj);
  -- Cuentas con códigos que ninguna regla conoce de antemano.
  PERFORM public.conta_seed_cuenta(c, pj, '6205', 'Servicios contratados propios', 'gasto',  'deudora', NULL, 1, true);
  PERFORM public.conta_seed_cuenta(c, pj, '9101', 'Equipo propio de la empresa',   'activo', 'deudora', NULL, 1, true);
  SELECT id INTO cta_servicio FROM public.conta_cuentas WHERE company_id = c AND project_id = pj AND codigo = '6205';
  SELECT id INTO cta_activo   FROM public.conta_cuentas WHERE company_id = c AND project_id = pj AND codigo = '9101';
  -- El activo fijo se resuelve POR MAPEO DE EVENTO hacia la cuenta personalizada.
  UPDATE public.conta_mapeo_cuentas SET cuenta_id = cta_activo
   WHERE company_id = c AND project_id = pj AND evento = 'activo_fijo';
  ev := ev || format('padrón · ledger propio con cuentas 6205 (servicio) y 9101 (activo); mapeo activo_fijo→%s',
        (SELECT codigo FROM public.conta_cuentas WHERE id = (SELECT cuenta_id FROM public.conta_mapeo_cuentas WHERE company_id = c AND project_id = pj AND evento = 'activo_fijo')));

  INSERT INTO public.proveedores (id, company_id, nombre, nit, pais, alcance)
    VALUES (pv, c, 'ZZ Proveedor de validación', '9999991-1', 'GT', 'empresa');
  INSERT INTO public.suministros_condominio (id, company_id, project_id, nombre, unidad_medida) VALUES (su, c, pj, 'ZZ Cloro', 'litro');
  INSERT INTO public.conta_tipos_cambio_mensual (company_id, moneda, moneda_base, periodo, tasa)
    VALUES (c, 'USD', 'GTQ', to_char(CURRENT_DATE, 'YYYY-MM'), 7.75);

  -- ── Autorización del proveedor (admin, vía normal) ────────────────────────
  PERFORM set_config('request.jwt.claim.sub', ua::text, true);
  SET LOCAL ROLE authenticated;
  UPDATE public.proveedores SET estado = 'autorizado' WHERE id = pv;

  -- ── 1 · La COMPRA: solicita el operador, aprueba y emite el admin ─────────
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
  ev := ev || format('1 compra · orden %s, estado %s, solicitante ≠ aprobador: %s',
        (SELECT numero FROM public.ordenes_compra WHERE id = oc), (SELECT estado FROM public.ordenes_compra WHERE id = oc),
        (SELECT created_by = uo AND aprobada_por = ua FROM public.ordenes_compra WHERE id = oc));
  ev := ev || format('1 cuentas de línea · servicio→%s (%s) · activo→%s (%s) · inventario→%s',
        (SELECT c2.codigo FROM public.orden_compra_lineas x JOIN public.conta_cuentas c2 ON c2.id = x.cuenta_id WHERE x.id = l2),
        (SELECT cuenta_origen FROM public.orden_compra_lineas WHERE id = l2),
        coalesce((SELECT c2.codigo FROM public.orden_compra_lineas x JOIN public.conta_cuentas c2 ON c2.id = x.cuenta_id WHERE x.id = l3), 'por mapeo del evento'),
        coalesce((SELECT cuenta_origen FROM public.orden_compra_lineas WHERE id = l3), '—'),
        coalesce((SELECT c2.codigo FROM public.orden_compra_lineas x JOIN public.conta_cuentas c2 ON c2.id = x.cuenta_id WHERE x.id = l1), 'por mapeo del evento'));

  -- ── 2 · RECEPCIÓN PARCIAL de bienes (40 de 100 litros, 1 de 2 bombas; 5 rechazados)
  INSERT INTO public.recepciones (id, company_id, project_id, orden_compra_id, tipo, destino_fisico)
    VALUES (r1, c, pj, oc, 'bienes', 'Bodega general');
  INSERT INTO public.recepcion_lineas (company_id, recepcion_id, orden_compra_linea_id, cantidad, cantidad_rechazada, motivo_rechazo) VALUES
    (c, r1, l1, 40, 5, 'Envases dañados'), (c, r1, l3, 1, 0, NULL);
  UPDATE public.recepciones SET estado = 'registrada' WHERE id = r1;
  ev := ev || format('2 recepción parcial · orden %s · recibido cloro %s/100 · stock %s · activos %s',
        (SELECT estado FROM public.ordenes_compra WHERE id = oc),
        (SELECT cantidad_recibida FROM public.orden_compra_lineas WHERE id = l1),
        (SELECT stock_actual FROM public.suministros_condominio WHERE id = su),
        (SELECT count(*) FROM public.activos_fijos WHERE proveedor_id = pv));
  ev := ev || format('2 asiento de recepción · activo en %s · por facturar en %s',
        (SELECT string_agg(DISTINCT cu.codigo, ',') FROM public.conta_asientos a JOIN public.conta_asiento_lineas al ON al.asiento_id = a.id JOIN public.conta_cuentas cu ON cu.id = al.cuenta_id
          WHERE a.origen_tabla = 'recepciones' AND a.origen_id = r1 AND cu.codigo IN ('9101', '1401')),
        (SELECT string_agg(DISTINCT cu.codigo, ',') FROM public.conta_asientos a JOIN public.conta_asiento_lineas al ON al.asiento_id = a.id JOIN public.conta_cuentas cu ON cu.id = al.cuenta_id
          WHERE a.origen_tabla = 'recepciones' AND a.origen_id = r1 AND cu.codigo = '2105'));

  -- ── 3 · Conformidad de SERVICIO (sin inventario ni activo) ────────────────
  INSERT INTO public.recepciones (id, company_id, project_id, orden_compra_id, tipo, recibido_por, notas)
    VALUES (r2, c, pj, oc, 'servicio', uk, 'Hito: mantenimiento de octubre');
  INSERT INTO public.recepcion_lineas (company_id, recepcion_id, orden_compra_linea_id, cantidad) VALUES (c, r2, l2, 1);
  UPDATE public.recepciones SET estado = 'registrada' WHERE id = r2;
  ev := ev || format('3 conformidad de servicio · movimientos de inventario por la conformidad %s · activos por la conformidad %s · gasto en %s',
        (SELECT count(*) FROM public.movimientos_suministro WHERE origen_id IN (SELECT id FROM public.recepcion_lineas WHERE recepcion_id = r2)),
        (SELECT count(*) FROM public.activos_fijos WHERE recepcion_linea_id IN (SELECT id FROM public.recepcion_lineas WHERE recepcion_id = r2)),
        (SELECT string_agg(DISTINCT cu.codigo, ',') FROM public.conta_asientos a JOIN public.conta_asiento_lineas al ON al.asiento_id = a.id JOIN public.conta_cuentas cu ON cu.id = al.cuenta_id
          WHERE a.origen_tabla = 'recepciones' AND a.origen_id = r2 AND cu.codigo = '6205'));

  -- ── 4 · FACTURA 1 (parcial): lo ya recibido ───────────────────────────────
  PERFORM set_config('request.jwt.claim.sub', uk::text, true);
  INSERT INTO public.facturas_proveedor (id, company_id, project_id, proveedor_id, orden_compra_id, numero_factura, concepto, categoria, monto_total)
    VALUES (f1, c, pj, pv, oc, 'ZZ-0001', 'Facturación parcial', 'limpieza', 1);
  INSERT INTO public.factura_proveedor_lineas (company_id, factura_id, orden_compra_linea_id, linea, descripcion, cantidad, precio_unitario, iva_monto) VALUES
    (c, f1, l1, 1, 'Cloro industrial',      40, 10,  48),
    (c, f1, l2, 2, 'Mantenimiento mensual',  1, 300, 36),
    (c, f1, l3, 3, 'Bombas de agua',         1, 500, 60);
  ev := ev || format('4 cuadre factura 1 · renglones fuera de tolerancia: %s', (SELECT count(*) FROM public.compras_validar_match(f1) WHERE NOT dentro_tolerancia));
  UPDATE public.facturas_proveedor SET estado = 'aprobada' WHERE id = f1;
  ev := ev || format('4 factura 1 aprobada · estado %s · total %s · asiento publicado %s',
        (SELECT estado FROM public.facturas_proveedor WHERE id = f1), (SELECT monto_total FROM public.facturas_proveedor WHERE id = f1),
        (SELECT count(*) FROM public.conta_asientos WHERE origen_tabla = 'facturas_proveedor' AND origen_id = f1 AND estado = 'publicado'));

  -- ── 5 · RECEPCIÓN FINAL y FACTURA 2 ───────────────────────────────────────
  PERFORM set_config('request.jwt.claim.sub', ua::text, true);
  INSERT INTO public.recepciones (id, company_id, project_id, orden_compra_id, tipo) VALUES (r3, c, pj, oc, 'bienes');
  INSERT INTO public.recepcion_lineas (company_id, recepcion_id, orden_compra_linea_id, cantidad) VALUES (c, r3, l1, 60), (c, r3, l3, 1);
  UPDATE public.recepciones SET estado = 'registrada' WHERE id = r3;
  ev := ev || format('5 recepción final · orden %s · stock %s · activos %s', (SELECT estado FROM public.ordenes_compra WHERE id = oc),
        (SELECT stock_actual FROM public.suministros_condominio WHERE id = su), (SELECT count(*) FROM public.activos_fijos WHERE proveedor_id = pv));
  PERFORM set_config('request.jwt.claim.sub', uk::text, true);
  INSERT INTO public.facturas_proveedor (id, company_id, project_id, proveedor_id, orden_compra_id, numero_factura, concepto, categoria, monto_total)
    VALUES (f2, c, pj, pv, oc, 'ZZ-0002', 'Saldo', 'limpieza', 1);
  INSERT INTO public.factura_proveedor_lineas (company_id, factura_id, orden_compra_linea_id, linea, descripcion, cantidad, precio_unitario, iva_monto) VALUES
    (c, f2, l1, 1, 'Cloro industrial', 60, 10, 72), (c, f2, l3, 2, 'Bombas de agua', 1, 500, 60);
  UPDATE public.facturas_proveedor SET estado = 'aprobada' WHERE id = f2;
  ev := ev || format('5 factura 2 aprobada · orden %s', (SELECT estado FROM public.ordenes_compra WHERE id = oc));

  -- ── 6 · Las cifras que deben cuadrar ──────────────────────────────────────
  RESET ROLE;
  SELECT coalesce(sum(al.debe - al.haber), 0) INTO v FROM public.conta_asientos a JOIN public.conta_asiento_lineas al ON al.asiento_id = a.id
    JOIN public.conta_cuentas cu ON cu.id = al.cuenta_id
   WHERE cu.codigo = '2105' AND cu.company_id = c AND cu.project_id = pj AND a.estado <> 'anulado';
  ev := ev || format('6 «por facturar» (2105) tras recibir y facturar todo = %s (debe ser 0)', v);
  SELECT coalesce(sum(al.haber - al.debe), 0) INTO v FROM public.conta_asientos a JOIN public.conta_asiento_lineas al ON al.asiento_id = a.id
    JOIN public.conta_cuentas cu ON cu.id = al.cuenta_id
   WHERE cu.codigo = '2104' AND cu.company_id = c AND cu.project_id = pj AND a.estado <> 'anulado';
  ev := ev || format('6 Proveedores por pagar (2104) = %s (debe ser 2576 = 2 facturas)', v);
  SELECT coalesce(sum(al.debe - al.haber), 0) INTO v FROM public.conta_asientos a JOIN public.conta_asiento_lineas al ON al.asiento_id = a.id
    JOIN public.conta_cuentas cu ON cu.id = al.cuenta_id WHERE cu.codigo = '9101' AND cu.company_id = c AND cu.project_id = pj AND a.estado <> 'anulado';
  ev := ev || format('6 activo en la cuenta personalizada 9101 = %s (debe ser 1000: 2 bombas × 500)', v);
  SELECT coalesce(sum(al.debe - al.haber), 0) INTO v FROM public.conta_asientos a JOIN public.conta_asiento_lineas al ON al.asiento_id = a.id
    JOIN public.conta_cuentas cu ON cu.id = al.cuenta_id WHERE cu.codigo = '6205' AND cu.company_id = c AND cu.project_id = pj AND a.estado <> 'anulado';
  ev := ev || format('6 servicio en la cuenta explícita 6205 = %s (debe ser 300)', v);
  ev := ev || format('6 asientos desbalanceados = %s (debe ser 0)',
        (SELECT count(*) FROM public.conta_asientos WHERE company_id = c AND total_debe <> total_haber));
  ev := ev || format('6 estado final de la orden = %s · eventos de historial = %s',
        (SELECT estado FROM public.ordenes_compra WHERE id = oc), (SELECT count(*) FROM public.orden_compra_eventos WHERE orden_compra_id = oc));

  -- ── 7 · Seguimiento compartido (como contador y como operador) ────────────
  PERFORM set_config('request.jwt.claim.sub', uk::text, true);
  SET LOCAL ROLE authenticated;
  t := public.compras_seguimiento_orden(oc)::text;
  ev := ev || format('7 seguimiento (contador) · %s', (public.compras_seguimiento_orden(oc))->'indicadores');
  PERFORM set_config('request.jwt.claim.sub', uo::text, true);
  ev := ev || format('7 seguimiento (operador) · facturas visibles: %s · facturado: %s',
        (public.compras_seguimiento_orden(oc)) ? 'facturas', (public.compras_seguimiento_orden(oc))->'indicadores'->'facturado');
  RESET ROLE;

  -- Todo revertido: la evidencia viaja en el mensaje.
  RAISE EXCEPTION E'EVIDENCIA (la transacción se revierte; no queda nada)\n%', array_to_string(ev, E'\n');
END
$guion$;
