-- ============================================================================
-- VALIDACIÓN DE PUNTA A PUNTA · BLOQUE C
-- importar orden → aprobar → recibir parcialmente → registrar rechazo →
-- completar recepción → facturar → consultar seguimiento, con insumo de
-- inventario, respaldos de recepción, permisos, aislamiento y reintentos.
--
-- SQL plano; UNA sola sentencia (DO) que TERMINA SIEMPRE con una excepción para
-- REVERTIR todo (no queda fila de prueba). La excepción es el canal de evidencia:
--   · GUION_OK_REVERTIDO  → todas las comprobaciones coinciden.
--   · GUION_FALLO         → alguna no coincide (líneas «FALLO»).
--   · cualquier otro mensaje → fallo real del recorrido.
-- Padrón de usar y tirar `5b5c…` (distinto del padrón de la UI `5b5b…`).
-- ============================================================================
DO $guion$
DECLARE
  c   constant uuid := '5b5c0000-0000-0000-0000-00000000000c';
  cz  constant uuid := '5b5c0000-0000-0000-0000-00000000000d';
  pj  constant uuid := '5b5c0000-0000-0000-0000-0000000000a1';
  pj2 constant uuid := '5b5c0000-0000-0000-0000-0000000000a2';
  pjz constant uuid := '5b5c0000-0000-0000-0000-0000000000a3';
  ua  constant uuid := '5b5c0000-0000-0000-0000-0000000000f1';  -- admin
  uo  constant uuid := '5b5c0000-0000-0000-0000-0000000000f2';  -- operador de compras (sin finanzas)
  uk  constant uuid := '5b5c0000-0000-0000-0000-0000000000f3';  -- contador
  uz  constant uuid := '5b5c0000-0000-0000-0000-0000000000f5';  -- admin de OTRA empresa
  pv  constant uuid := '5b5c0000-0000-0000-0000-0000000000b1';
  su  constant uuid := '5b5c0000-0000-0000-0000-0000000000d1';  -- insumo (litro) del proyecto
  su2 constant uuid := '5b5c0000-0000-0000-0000-0000000000d2';  -- insumo del OTRO proyecto
  oc  constant uuid := '5b5c0000-0000-0000-0000-0000000000e1';
  r1  constant uuid := '5b5c0000-0000-0000-0000-0000000000c1';
  ev  text[] := ARRAY[]::text[];
  t   text;
  j   jsonb;
  j2  jsonb;
  lote uuid;
  l_inv uuid; l_srv uuid;
  rid uuid; rid2 uuid; rsv uuid; fid uuid;
  ruta text; ruta2 text; ruta3 text;
  stock0 numeric; n_asi int; n_mov int;
  fallos int;
BEGIN
  CREATE FUNCTION pg_temp.ck(p_lbl text, p_o text, p_e text) RETURNS text LANGUAGE sql IMMUTABLE AS
    $f$ SELECT CASE WHEN $2 IS NOT DISTINCT FROM $3 THEN 'OK    ' ELSE 'FALLO ' END || $1 || ' · obtenido=' || coalesce($2, 'NULL') || ' esperado=' || coalesce($3, 'NULL') $f$;
  CREATE FUNCTION pg_temp.ckn(p_lbl text, p_o numeric, p_e numeric) RETURNS text LANGUAGE sql IMMUTABLE AS
    $f$ SELECT CASE WHEN $2 IS NOT DISTINCT FROM $3 THEN 'OK    ' ELSE 'FALLO ' END || $1 || ' · obtenido=' || coalesce(trim_scale($2)::text, 'NULL') || ' esperado=' || coalesce($3::text, 'NULL') $f$;

  IF EXISTS (SELECT 1 FROM public.companies WHERE id IN (c, cz)) THEN
    RAISE EXCEPTION 'ABORTA: la empresa de prueba ya existe; no se escribe nada.';
  END IF;

  -- ── Padrón de usar y tirar ────────────────────────────────────────────────
  INSERT INTO public.companies (id, nombre, default_currency) VALUES (c, 'ZZ Bloque C', 'gtq'), (cz, 'ZZ Otra empresa C', 'gtq');
  INSERT INTO public.projects (id, company_id, nombre) VALUES (pj, c, 'ZZ C Proyecto'), (pj2, c, 'ZZ C Otro proyecto'), (pjz, cz, 'ZZ C Proyecto otra empresa');
  INSERT INTO auth.users (id) VALUES (ua), (uo), (uk), (uz);
  INSERT INTO public.app_users (id, company_id, full_name, role) VALUES
    (ua, c, 'ZZ C Admin', 'admin'), (uo, c, 'ZZ C Operador', 'operator'), (uk, c, 'ZZ C Contador', 'operator'), (uz, cz, 'ZZ C Admin otra', 'admin');
  INSERT INTO public.user_project_assignments (user_id, project_id, permission_type) VALUES
    (ua, pj, 'total'), (uo, pj, 'total'), (uk, pj, 'total'), (uz, pjz, 'total');
  INSERT INTO public.roles (id, company_id, name) VALUES
    ('5b5c0000-0000-0000-0000-0000000000c9', c, 'ZZ C Contador'),
    ('5b5c0000-0000-0000-0000-0000000000c8', c, 'ZZ C Operador compras');
  INSERT INTO public.role_permissions (role_id, permission_key, effect) VALUES
    ('5b5c0000-0000-0000-0000-0000000000c9', 'platform.contabilidad.view',   'allow'),
    ('5b5c0000-0000-0000-0000-0000000000c9', 'platform.contabilidad.create', 'allow'),
    ('5b5c0000-0000-0000-0000-0000000000c9', 'platform.contabilidad.edit',   'allow'),
    ('5b5c0000-0000-0000-0000-0000000000c9', 'platform.contabilidad.delete', 'allow'),
    ('5b5c0000-0000-0000-0000-0000000000c8', 'condominios.tab.ordenes_compra', 'allow'),
    ('5b5c0000-0000-0000-0000-0000000000c8', 'condominios.tab.suministros',    'allow');
  INSERT INTO public.user_roles (user_id, role_id) VALUES
    (uk, '5b5c0000-0000-0000-0000-0000000000c9'), (uo, '5b5c0000-0000-0000-0000-0000000000c8');

  PERFORM public.conta_seed_catalogo(c, pj);
  PERFORM public.compras_seed_cuentas(c, pj);
  INSERT INTO public.proveedores (id, company_id, nombre, nit, pais, alcance)
    VALUES (pv, c, 'ZZ C Proveedor', '9999993-3', 'GT', 'empresa');
  INSERT INTO public.suministros_condominio (id, company_id, project_id, nombre, unidad_medida) VALUES
    (su,  c, pj,  'ZZ C Cloro', 'litro'),
    (su2, c, pj2, 'ZZ C Insumo de otro proyecto', 'litro');
  stock0 := (SELECT stock_actual FROM public.suministros_condominio WHERE id = su);

  PERFORM set_config('request.jwt.claim.sub', ua::text, true);
  SET LOCAL ROLE authenticated;
  UPDATE public.proveedores SET estado = 'autorizado' WHERE id = pv;

  -- ── 1 · IMPORTAR (borrador): vista previa con errores por fila ────────────
  PERFORM set_config('request.jwt.claim.sub', uo::text, true);
  INSERT INTO public.ordenes_compra (id, company_id, project_id, proveedor_id, proveedor_nombre, concepto)
    VALUES (oc, c, pj, pv, 'ZZ C Proveedor', 'Orden importada');
  j := public.compras_lineas_importar_previsualizar(oc, $f$[
    {"descripcion":"Cloro industrial","destino":"inventario","insumo":"ZZ C Cloro","categoria":"limpieza","cantidad":"100","precio_unitario":"10","iva":"120"},
    {"descripcion":"Mantenimiento mensual","destino":"servicio","categoria":"mantenimiento","cantidad":"1","precio_unitario":"300","iva":"36"},
    {"descripcion":"Insumo inexistente","destino":"inventario","insumo":"Fantasma","cantidad":"1","precio_unitario":"1"},
    {"descripcion":"Insumo de otro proyecto","destino":"inventario","insumo":"ZZ C Insumo de otro proyecto","cantidad":"1","precio_unitario":"1"},
    {"descripcion":"Unidad distinta","destino":"inventario","insumo":"ZZ C Cloro","cantidad":"1","unidad":"galón","precio_unitario":"1"},
    {"descripcion":"Con columna prohibida","destino":"gasto","cantidad":"1","precio_unitario":"1","proveedor":"Otro","estado":"aprobada"}
  ]$f$::jsonb, 'zz.csv');
  lote := (j->>'lote_id')::uuid;
  ev := ev || pg_temp.ck('1 vista previa · total/válidas/con error', (j->'resumen'->>'total') || '/' || (j->'resumen'->>'validas') || '/' || (j->'resumen'->>'con_error'), '6/2/4');
  ev := ev || pg_temp.ckn('1 la vista previa NO escribe renglones', (SELECT count(*) FROM public.orden_compra_lineas WHERE orden_compra_id = oc), 0);
  -- con errores: no se aplica nada (todo o nada)
  BEGIN PERFORM public.compras_lineas_importar_aplicar(lote); t := 'SIN ERROR';
  EXCEPTION WHEN OTHERS THEN t := split_part(SQLERRM, ':', 1); END;
  ev := ev || pg_temp.ck('1 aplicar con errores', t, 'COMPRAS_IMPORT_CON_ERRORES');
  ev := ev || pg_temp.ckn('1 …y no quedó ningún renglón', (SELECT count(*) FROM public.orden_compra_lineas WHERE orden_compra_id = oc), 0);
  PERFORM public.compras_lineas_importar_descartar(lote);
  -- archivo corregido (solo las 2 válidas)
  j := public.compras_lineas_importar_previsualizar(oc, $f$[
    {"descripcion":"Cloro industrial","destino":"inventario","insumo":"ZZ C Cloro","categoria":"limpieza","cantidad":"100","precio_unitario":"10","iva":"120"},
    {"descripcion":"Mantenimiento mensual","destino":"servicio","categoria":"mantenimiento","cantidad":"1","precio_unitario":"300","iva":"36"}
  ]$f$::jsonb, 'zz-ok.csv');
  lote := (j->>'lote_id')::uuid;
  ev := ev || pg_temp.ck('1 archivo corregido · válidas/con error', (j->'resumen'->>'validas') || '/' || (j->'resumen'->>'con_error'), '2/0');
  j := public.compras_lineas_importar_aplicar(lote);
  ev := ev || pg_temp.ck('1 confirmación · renglones creados', (j->>'renglones_creados') || '/' || ((j->>'reutilizada')::boolean)::text, '2/false');
  j2 := public.compras_lineas_importar_aplicar(lote);   -- reintento
  ev := ev || pg_temp.ck('1 reintento del mismo lote · reutiliza, no duplica', ((j2->>'reutilizada')::boolean)::text || '/' || (SELECT count(*) FROM public.orden_compra_lineas WHERE orden_compra_id = oc), 'true/2');
  -- mismo archivo otra vez con renglones ya existentes: se previsualiza pero NO se aplica
  j2 := public.compras_lineas_importar_previsualizar(oc, $f$[
      {"descripcion":"Cloro industrial","destino":"inventario","insumo":"ZZ C Cloro","categoria":"limpieza","cantidad":"100","precio_unitario":"10","iva":"120"},
      {"descripcion":"Mantenimiento mensual","destino":"servicio","categoria":"mantenimiento","cantidad":"1","precio_unitario":"300","iva":"36"}
    ]$f$::jsonb, 'zz-ok.csv');
  BEGIN PERFORM public.compras_lineas_importar_aplicar((j2->>'lote_id')::uuid); t := 'SIN ERROR';
  EXCEPTION WHEN OTHERS THEN t := split_part(SQLERRM, ':', 1); END;
  ev := ev || pg_temp.ck('1 reimportar el mismo archivo con sus renglones vivos', t, 'COMPRAS_IMPORT_DUPLICADO');
  ev := ev || pg_temp.ckn('1 …y siguen 2 renglones', (SELECT count(*) FROM public.orden_compra_lineas WHERE orden_compra_id = oc), 2);
  ev := ev || pg_temp.ckn('1 la importación no creó proveedores ni insumos', (SELECT count(*) FROM public.proveedores WHERE company_id = c) + (SELECT count(*) FROM public.suministros_condominio WHERE company_id = c), 3);
  SELECT id INTO l_inv FROM public.orden_compra_lineas WHERE orden_compra_id = oc AND destino_tipo = 'inventario';
  SELECT id INTO l_srv FROM public.orden_compra_lineas WHERE orden_compra_id = oc AND destino_tipo = 'servicio';
  ev := ev || pg_temp.ck('1 el renglón de inventario quedó con su insumo y la unidad del insumo', (SELECT (suministro_id = su)::text || '/' || unidad FROM public.orden_compra_lineas WHERE id = l_inv), 'true/litro');

  -- 1b · validación de insumo en la captura manual
  BEGIN INSERT INTO public.orden_compra_lineas (company_id, orden_compra_id, linea, descripcion, destino_tipo, suministro_id, categoria, cantidad, unidad, precio_unitario)
        VALUES (c, oc, 9, 'Insumo ajeno', 'inventario', su2, 'limpieza', 1, 'litro', 1); t := 'SIN ERROR';
  EXCEPTION WHEN OTHERS THEN t := split_part(SQLERRM, ':', 1); END;
  ev := ev || pg_temp.ck('1b insumo de otro proyecto', t, 'COMPRAS_LINEA_INSUMO_ALCANCE');
  BEGIN INSERT INTO public.orden_compra_lineas (company_id, orden_compra_id, linea, descripcion, destino_tipo, suministro_id, categoria, cantidad, unidad, precio_unitario)
        VALUES (c, oc, 9, 'Unidad distinta', 'inventario', su, 'limpieza', 1, 'galón', 1); t := 'SIN ERROR';
  EXCEPTION WHEN OTHERS THEN t := split_part(SQLERRM, ':', 1); END;
  ev := ev || pg_temp.ck('1b unidad distinta a la del insumo', t, 'COMPRAS_LINEA_INSUMO_UNIDAD');
  BEGIN INSERT INTO public.orden_compra_lineas (company_id, orden_compra_id, linea, descripcion, destino_tipo, suministro_id, categoria, cantidad, unidad, precio_unitario)
        VALUES (c, oc, 9, 'Insumo en un gasto', 'gasto', su, 'limpieza', 1, 'litro', 1); t := 'SIN ERROR';
  EXCEPTION WHEN OTHERS THEN t := split_part(SQLERRM, ':', 1); END;
  ev := ev || pg_temp.ck('1b insumo con destino distinto de inventario', t, 'COMPRAS_LINEA_INSUMO_DESTINO');
  -- aislamiento: el admin de OTRA empresa no importa ni ve la orden
  PERFORM set_config('request.jwt.claim.sub', uz::text, true);
  BEGIN PERFORM public.compras_lineas_importar_previsualizar(oc, '[{"descripcion":"Intruso","destino":"gasto","cantidad":"1","precio_unitario":"1"}]'::jsonb); t := 'SIN ERROR';
  EXCEPTION WHEN OTHERS THEN t := 'ERROR'; END;
  ev := ev || pg_temp.ck('1c otra empresa no importa en mi orden', t, 'ERROR');
  ev := ev || pg_temp.ckn('1c otra empresa no ve los lotes', (SELECT count(*) FROM public.compras_linea_importaciones), 0);

  -- ── 2 · APROBAR y emitir (el admin; la orden queda congelada) ─────────────
  PERFORM set_config('request.jwt.claim.sub', ua::text, true);
  UPDATE public.ordenes_compra SET estado = 'aprobada' WHERE id = oc;
  UPDATE public.ordenes_compra SET estado = 'emitida'  WHERE id = oc;
  ev := ev || pg_temp.ck('2 orden aprobada y emitida', (SELECT estado FROM public.ordenes_compra WHERE id = oc), 'emitida');
  BEGIN PERFORM public.compras_lineas_importar_previsualizar(oc, '[{"descripcion":"Tarde","destino":"gasto","cantidad":"1","precio_unitario":"1"}]'::jsonb); t := 'SIN ERROR';
  EXCEPTION WHEN OTHERS THEN t := split_part(SQLERRM, ':', 1); END;
  ev := ev || pg_temp.ck('2 una orden emitida ya no admite importar renglones', t, 'COMPRAS_IMPORT_ORDEN_NO_BORRADOR');

  -- ── 3 · RECEPCIÓN PARCIAL con rechazo: 40 aceptadas, 5 rechazadas ─────────
  PERFORM set_config('request.jwt.claim.sub', uo::text, true);
  j := public.compras_recepcion_crear(c, pj,
    format('{"orden_compra_id":"%s","tipo":"bienes","fecha":"%s","documento_referencia":"REM-ZZC-1","clave_idempotencia":"zzc-rec-1"}', oc, CURRENT_DATE)::jsonb,
    format('[{"orden_compra_linea_id":"%s","cantidad":40,"cantidad_rechazada":5,"motivo_rechazo":"Envases dañados","costo_unitario":10}]', l_inv)::jsonb);
  rid := (j->'recepcion'->>'id')::uuid;
  ev := ev || pg_temp.ckn('3 emitir/crear la recepción no mueve existencias', (SELECT stock_actual FROM public.suministros_condominio WHERE id = su) - stock0, 0);
  PERFORM set_config('request.jwt.claim.sub', ua::text, true);   -- registra el admin (el operador captura)
  UPDATE public.recepciones SET estado = 'registrada' WHERE id = rid;
  UPDATE public.recepciones SET estado = 'registrada' WHERE id = rid;   -- reintento
  PERFORM set_config('request.jwt.claim.sub', uo::text, true);
  ev := ev || pg_temp.ckn('3 existencia = solo lo ACEPTADO (40); los 5 rechazados no entran', (SELECT stock_actual FROM public.suministros_condominio WHERE id = su) - stock0, 40);
  ev := ev || pg_temp.ckn('3 una sola entrada de inventario tras el reintento', (SELECT count(*) FROM public.movimientos_suministro WHERE suministro_id = su AND tipo = 'entrada'), 1);
  ev := ev || pg_temp.ckn('3 un solo asiento tras el reintento', (SELECT count(*) FROM public.conta_asientos WHERE origen_tabla = 'recepciones' AND origen_id = rid), 1);
  ev := ev || pg_temp.ck('3 orden', (SELECT estado FROM public.ordenes_compra WHERE id = oc), 'recibida_parcial');

  -- ── 4 · RESPALDO de la recepción (evidencia de entrega) ───────────────────
  ruta := format('%s/%s/%s/remision-zzc.pdf', c, pj, rid);
  ruta2 := format('%s/%s/%s/foto-zzc.png', c, pj, rid);
  INSERT INTO storage.objects (bucket_id, name) VALUES ('recepciones-respaldo', ruta), ('recepciones-respaldo', ruta2);
  j := public.compras_recepcion_adjuntar(rid, ruta, 'Remisión 123.pdf', 'application/pdf', 52000, repeat('a', 64), 'entrega', 'Firmada por bodega');
  ev := ev || pg_temp.ck('4 adjuntar · nuevo', ((j->>'reutilizado')::boolean)::text, 'false');
  j := public.compras_recepcion_adjuntar(rid, ruta, 'Remisión 123.pdf', 'application/pdf', 52000, repeat('a', 64), 'entrega', 'Firmada por bodega');
  ev := ev || pg_temp.ck('4 adjuntar de nuevo · idempotente', ((j->>'reutilizado')::boolean)::text || '/' || (SELECT count(*) FROM public.recepcion_respaldos WHERE recepcion_id = rid), 'true/1');
  BEGIN PERFORM public.compras_recepcion_adjuntar(rid, ruta, 'Otro.pdf', 'application/pdf', 52000, repeat('b', 64)); t := 'SIN ERROR';
  EXCEPTION WHEN OTHERS THEN t := split_part(SQLERRM, ':', 1); END;
  ev := ev || pg_temp.ck('4 misma ruta con OTRO contenido', t, 'COMPRAS_RESPALDO_CONFLICTO');
  BEGIN PERFORM public.compras_recepcion_adjuntar(rid, ruta2, 'x.exe', 'application/x-msdownload', 10, repeat('c', 64)); t := 'SIN ERROR';
  EXCEPTION WHEN OTHERS THEN t := split_part(SQLERRM, ':', 1); END;
  ev := ev || pg_temp.ck('4 tipo de archivo no permitido', t, 'COMPRAS_RESPALDO_TIPO');
  BEGIN PERFORM public.compras_recepcion_adjuntar(rid, ruta2, 'g.png', 'image/png', 11 * 1024 * 1024, repeat('c', 64)); t := 'SIN ERROR';
  EXCEPTION WHEN OTHERS THEN t := split_part(SQLERRM, ':', 1); END;
  ev := ev || pg_temp.ck('4 más de 10 MB', t, 'COMPRAS_RESPALDO_TAMANO');
  BEGIN PERFORM public.compras_recepcion_adjuntar(rid, format('%s/%s/%s/no-subido.pdf', c, pj, rid), 'n.pdf', 'application/pdf', 10, repeat('d', 64)); t := 'SIN ERROR';
  EXCEPTION WHEN OTHERS THEN t := split_part(SQLERRM, ':', 1); END;
  ev := ev || pg_temp.ck('4 archivo que no está en el almacenamiento', t, 'COMPRAS_RESPALDO_OBJETO');
  -- evidencia ADICIONAL con la recepción ya contabilizada: no altera nada contable
  n_asi := (SELECT count(*) FROM public.conta_asientos WHERE origen_tabla = 'recepciones' AND origen_id = rid);
  n_mov := (SELECT count(*) FROM public.movimientos_suministro WHERE suministro_id = su);
  PERFORM public.compras_recepcion_adjuntar(rid, ruta2, 'foto.png', 'image/png', 80000, repeat('e', 64), 'entrega', NULL);
  ev := ev || pg_temp.ckn('4 respaldos de la recepción registrada', (SELECT count(*) FROM public.recepcion_respaldos WHERE recepcion_id = rid), 2);
  ev := ev || pg_temp.ckn('4 adjuntar no cambia asientos', (SELECT count(*) FROM public.conta_asientos WHERE origen_tabla = 'recepciones' AND origen_id = rid) - n_asi, 0);
  ev := ev || pg_temp.ckn('4 adjuntar no cambia movimientos', (SELECT count(*) FROM public.movimientos_suministro WHERE suministro_id = su) - n_mov, 0);
  ev := ev || pg_temp.ckn('4 adjuntar no cambia la existencia', (SELECT stock_actual FROM public.suministros_condominio WHERE id = su) - stock0, 40);
  -- la evidencia no se edita ni se borra con la recepción registrada
  BEGIN UPDATE public.recepcion_respaldos SET nombre = 'cambiado' WHERE recepcion_id = rid; t := 'SIN ERROR';
  EXCEPTION WHEN OTHERS THEN t := 'ERROR'; END;
  ev := ev || pg_temp.ck('4 editar un respaldo', t, 'ERROR');
  DELETE FROM public.recepcion_respaldos WHERE recepcion_id = rid;
  ev := ev || pg_temp.ckn('4 retirar un respaldo con la recepción registrada (nada se borra)', (SELECT count(*) FROM public.recepcion_respaldos WHERE recepcion_id = rid), 2);
  -- aislamiento: otra empresa no ve la evidencia
  PERFORM set_config('request.jwt.claim.sub', uz::text, true);
  ev := ev || pg_temp.ckn('4 otra empresa ve 0 respaldos', (SELECT count(*) FROM public.recepcion_respaldos), 0);
  BEGIN PERFORM public.compras_recepcion_adjuntar(rid, ruta2, 'f.png', 'image/png', 10, repeat('e', 64)); t := 'SIN ERROR';
  EXCEPTION WHEN OTHERS THEN t := split_part(SQLERRM, ':', 1); END;
  ev := ev || pg_temp.ck('4 otra empresa no adjunta a mi recepción', t, 'COMPRAS_RESPALDO_RECEPCION');

  -- ── 5 · COMPLETAR la recepción (60 restantes + conformidad del servicio) ──
  PERFORM set_config('request.jwt.claim.sub', uo::text, true);
  j := public.compras_recepcion_crear(c, pj,
    format('{"orden_compra_id":"%s","tipo":"bienes","fecha":"%s","clave_idempotencia":"zzc-rec-2"}', oc, CURRENT_DATE)::jsonb,
    format('[{"orden_compra_linea_id":"%s","cantidad":60,"cantidad_rechazada":0,"costo_unitario":10}]', l_inv)::jsonb);
  rid2 := (j->'recepcion'->>'id')::uuid;
  PERFORM set_config('request.jwt.claim.sub', ua::text, true);
  UPDATE public.recepciones SET estado = 'registrada' WHERE id = rid2;
  PERFORM set_config('request.jwt.claim.sub', uo::text, true);
  j := public.compras_recepcion_crear(c, pj,
    format('{"orden_compra_id":"%s","tipo":"servicio","fecha":"%s","clave_idempotencia":"zzc-rec-3"}', oc, CURRENT_DATE)::jsonb,
    format('[{"orden_compra_linea_id":"%s","cantidad":1,"cantidad_rechazada":0,"costo_unitario":300}]', l_srv)::jsonb);
  rsv := (j->'recepcion'->>'id')::uuid;
  PERFORM set_config('request.jwt.claim.sub', ua::text, true);
  UPDATE public.recepciones SET estado = 'registrada' WHERE id = rsv;
  PERFORM set_config('request.jwt.claim.sub', uo::text, true);
  ev := ev || pg_temp.ckn('5 existencia final = 100 aceptadas (40 + 60)', (SELECT stock_actual FROM public.suministros_condominio WHERE id = su) - stock0, 100);
  ev := ev || pg_temp.ckn('5 entradas de inventario = 2 (una por recepción de bienes)', (SELECT count(*) FROM public.movimientos_suministro WHERE suministro_id = su AND tipo = 'entrada'), 2);
  ev := ev || pg_temp.ckn('5 el servicio no movió inventario', (SELECT count(*) FROM public.movimientos_suministro WHERE suministro_id = su), 2);
  ruta3 := format('%s/%s/%s/acta-zzc.pdf', c, pj, rsv);
  INSERT INTO storage.objects (bucket_id, name) VALUES ('recepciones-respaldo', ruta3);
  j := public.compras_recepcion_adjuntar(rsv, ruta3, 'Acta.pdf', 'application/pdf', 30000, repeat('f', 64), 'conformidad', 'Hito octubre');
  ev := ev || pg_temp.ck('5 conformidad de servicio adjunta', (j->'respaldo'->>'tipo'), 'conformidad');
  BEGIN PERFORM public.compras_recepcion_adjuntar(rsv, ruta3, 'Acta.pdf', 'application/pdf', 30000, repeat('f', 64), 'entrega'); t := 'SIN ERROR';
  EXCEPTION WHEN OTHERS THEN t := split_part(SQLERRM, ':', 1); END;
  ev := ev || pg_temp.ck('5 «entrega» no vale como evidencia de un servicio', t, 'COMPRAS_RESPALDO_TIPO');
  PERFORM set_config('request.jwt.claim.sub', ua::text, true);
  ev := ev || pg_temp.ck('5 orden recibida', (SELECT estado FROM public.ordenes_compra WHERE id = oc), 'recibida');
  -- conciliación inventario ↔ contabilidad: 1106 = 100 × 10 = 1000
  ev := ev || pg_temp.ckn('5 CONCILIACIÓN · inventario contable (1106) = valor de entradas (1000)',
    (SELECT COALESCE(sum(al.debe - al.haber), 0) FROM public.conta_asientos a JOIN public.conta_asiento_lineas al ON al.asiento_id = a.id
       JOIN public.conta_cuentas cu ON cu.id = al.cuenta_id
      WHERE a.origen_tabla = 'recepciones' AND a.origen_id IN (rid, rid2) AND cu.codigo = '1106'), 1000);

  -- ── 6 · FACTURAR (contador) ───────────────────────────────────────────────
  PERFORM set_config('request.jwt.claim.sub', uk::text, true);
  j := public.compras_factura_crear(c, pj,
    format('{"proveedor_id":"%s","orden_compra_id":"%s","numero_factura":"ZZC-1","concepto":"Factura completa","clave_idempotencia":"zzc-fac-1"}', pv, oc)::jsonb,
    format('[{"orden_compra_linea_id":"%s","cantidad":100,"precio_unitario":10,"iva_monto":120},{"orden_compra_linea_id":"%s","cantidad":1,"precio_unitario":300,"iva_monto":36}]', l_inv, l_srv)::jsonb);
  fid := (j->'factura'->>'id')::uuid;
  ev := ev || pg_temp.ckn('6 total facturado (1000 + 300 + IVA 156)', (SELECT monto_total FROM public.facturas_proveedor WHERE id = fid), 1456);
  j2 := public.compras_factura_crear(c, pj,
    format('{"proveedor_id":"%s","orden_compra_id":"%s","numero_factura":"ZZC-1","concepto":"Factura completa","clave_idempotencia":"zzc-fac-1"}', pv, oc)::jsonb,
    format('[{"orden_compra_linea_id":"%s","cantidad":100,"precio_unitario":10,"iva_monto":120},{"orden_compra_linea_id":"%s","cantidad":1,"precio_unitario":300,"iva_monto":36}]', l_inv, l_srv)::jsonb);
  ev := ev || pg_temp.ck('6 reintento de la factura · la misma', ((j2->>'reutilizada')::boolean)::text || '/' || ((j2->'factura'->>'id')::uuid = fid)::text, 'true/true');

  PERFORM set_config('request.jwt.claim.sub', ua::text, true);
  UPDATE public.facturas_proveedor SET estado = 'aprobada' WHERE id = fid;
  ev := ev || pg_temp.ck('6 factura aprobada y contabilizada', (SELECT estado FROM public.facturas_proveedor WHERE id = fid), 'aprobada');
  PERFORM set_config('request.jwt.claim.sub', uk::text, true);

  -- ── 7 · SEGUIMIENTO: contador ve todo; operador NO ve lo financiero ───────
  j := public.compras_seguimiento_orden(oc);
  ev := ev || pg_temp.ck('7 contador · orden tiene facturas y respaldos visibles', (jsonb_array_length(COALESCE(j->'facturas', '[]'::jsonb)) > 0)::text, 'true');
  ev := ev || pg_temp.ckn('7 contador · lista: comprometido/facturado de la orden', (SELECT facturado FROM public.compras_seguimiento_lista(pj, NULL, NULL, NULL, NULL, false) WHERE orden_id = oc), 1456);
  ev := ev || pg_temp.ckn('7 contador · filtro por proveedor ajeno = 0 filas', (SELECT count(*) FROM public.compras_seguimiento_lista(pj, '5b5c0000-0000-0000-0000-0000000000ff'::uuid, NULL, NULL, NULL, false)), 0);
  PERFORM set_config('request.jwt.claim.sub', uo::text, true);
  ev := ev || pg_temp.ckn('7 operador · ve la orden en la lista', (SELECT count(*) FROM public.compras_seguimiento_lista(pj, NULL, NULL, NULL, NULL, false) WHERE orden_id = oc), 1);
  ev := ev || pg_temp.ck('7 operador · facturado/pagado/pendientes financieros = NULL',
    (SELECT (facturado IS NULL AND facturado_neto IS NULL AND pagado IS NULL AND pendiente_por_pagar IS NULL)::text FROM public.compras_seguimiento_lista(pj, NULL, NULL, NULL, NULL, false) WHERE orden_id = oc), 'true');
  j := public.compras_seguimiento_orden(oc);
  ev := ev || pg_temp.ck('7 operador · la orden no trae facturas ni pagos', (j->'facturas' IS NULL OR jsonb_typeof(j->'facturas') = 'null' OR jsonb_array_length(j->'facturas') = 0)::text, 'true');
  PERFORM set_config('request.jwt.claim.sub', uz::text, true);
  ev := ev || pg_temp.ckn('7 otra empresa · lista vacía', (SELECT count(*) FROM public.compras_seguimiento_lista(NULL, NULL, NULL, NULL, NULL, false)), 0);

  RESET ROLE;
  SELECT count(*) INTO fallos FROM unnest(ev) e WHERE e LIKE 'FALLO%';
  RAISE EXCEPTION '%', (CASE WHEN fallos = 0 THEN 'GUION_OK_REVERTIDO' ELSE 'GUION_FALLO' END)
    || ' · ' || array_length(ev, 1) || ' comprobaciones, ' || fallos || ' fallos' || E'\n' || array_to_string(ev, E'\n');
END;
$guion$;
