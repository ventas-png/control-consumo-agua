-- ============================================================================
-- VALIDACIÓN EN SANDBOX · COHERENCIA ORDEN ↔ CONTRATO AL EDITAR, Y EXCEPCIÓN NO REUTILIZABLE
-- (migración 20261025000000). Corre ANTES de aplicarla (debe MOSTRAR las fallas) y DESPUÉS (todo OK).
--
-- «API directa»: DML como `authenticated` con el sub del JWT fijado, que es lo que ejecuta PostgREST.
-- SQL plano; UNA sola sentencia (DO) que TERMINA SIEMPRE con una excepción para REVERTIR todo:
--   GUION_OK_REVERTIDO → todo coincide · GUION_FALLO → alguna comprobación no coincide · otro → fallo del recorrido.
-- Sin DELETE ni DROP. Padrón de usar y tirar `5b60…`.
-- ============================================================================
DO $guion$
DECLARE
  c   constant uuid := '5b600000-0000-0000-0000-00000000000c';
  pj  constant uuid := '5b600000-0000-0000-0000-0000000000a1';
  pj2 constant uuid := '5b600000-0000-0000-0000-0000000000a2';
  ua  constant uuid := '5b600000-0000-0000-0000-0000000000f1';  -- admin
  ub  constant uuid := '5b600000-0000-0000-0000-0000000000f2';  -- admin 2 (autoriza excepciones)
  uo  constant uuid := '5b600000-0000-0000-0000-0000000000f3';  -- operador de compras (solicita)
  pv  constant uuid := '5b600000-0000-0000-0000-0000000000b1';
  pv2 constant uuid := '5b600000-0000-0000-0000-0000000000b2';
  ka  constant uuid := '5b600000-0000-0000-0000-0000000000c1';  -- GTQ, máx 1000
  ku  constant uuid := '5b600000-0000-0000-0000-0000000000c2';  -- USD
  ke  constant uuid := '5b600000-0000-0000-0000-0000000000c3';  -- GTQ, máx 1000
  kf  constant uuid := '5b600000-0000-0000-0000-0000000000c4';  -- GTQ, máx 500
  kv1 constant uuid := '5b600000-0000-0000-0000-0000000000c5';  -- por vencer
  kv2 constant uuid := '5b600000-0000-0000-0000-0000000000c6';
  ox  constant uuid := '5b600000-0000-0000-0000-0000000000e1';
  oe  constant uuid := '5b600000-0000-0000-0000-0000000000e2';
  ov  constant uuid := '5b600000-0000-0000-0000-0000000000e3';
  ev  text[] := ARRAY[]::text[];
  id1 uuid; id2 uuid; id3 uuid;
  fallos int;
BEGIN
  CREATE FUNCTION pg_temp.ck(p_lbl text, p_o text, p_e text) RETURNS text LANGUAGE sql IMMUTABLE AS
    $f$ SELECT CASE WHEN $2 IS NOT DISTINCT FROM $3 THEN 'OK    ' ELSE 'FALLO ' END || $1 || ' · obtenido=' || coalesce($2, 'NULL') || ' esperado=' || coalesce($3, 'NULL') $f$;
  CREATE FUNCTION pg_temp.ex(p_orden uuid, p_etapa text, p_motivo text) RETURNS uuid LANGUAGE plpgsql AS
    $f$ BEGIN RETURN public.compras_oc_excepcion_contrato(p_orden, p_etapa, p_motivo); EXCEPTION WHEN OTHERS THEN RETURN NULL; END $f$;
  -- Ejecuta una sentencia que DEBE fallar. Si NO falla, informa «SIN ERROR» y REVIERTE su efecto (así una falla
  -- de la regla no corrompe el resto del recorrido y el guion puede contar todas las comprobaciones).
  CREATE FUNCTION pg_temp.err(p text) RETURNS text LANGUAGE plpgsql AS
    $f$ BEGIN EXECUTE p; RAISE EXCEPTION 'SIN_ERROR_REVERTIDO';
        EXCEPTION WHEN OTHERS THEN IF SQLERRM = 'SIN_ERROR_REVERTIDO' THEN RETURN 'SIN ERROR'; END IF; RETURN split_part(SQLERRM, ':', 1); END $f$;

  IF EXISTS (SELECT 1 FROM public.companies WHERE id = c) THEN
    RAISE EXCEPTION 'ABORTA: la empresa de prueba ya existe; no se escribe nada.';
  END IF;

  INSERT INTO public.companies (id, nombre, default_currency) VALUES (c, 'ZZ Coherencia', 'gtq');
  INSERT INTO public.projects (id, company_id, nombre) VALUES (pj, c, 'ZZ CH Proyecto'), (pj2, c, 'ZZ CH Otro proyecto');
  INSERT INTO auth.users (id) VALUES (ua), (ub), (uo);
  INSERT INTO public.app_users (id, company_id, full_name, role) VALUES
    (ua, c, 'ZZ CH Admin', 'admin'), (ub, c, 'ZZ CH Admin 2', 'admin'), (uo, c, 'ZZ CH Operador', 'operator');
  INSERT INTO public.user_project_assignments (user_id, project_id, permission_type) VALUES
    (ua, pj, 'total'), (ua, pj2, 'total'), (ub, pj, 'total'), (uo, pj, 'total');
  INSERT INTO public.roles (id, company_id, name) VALUES ('5b600000-0000-0000-0000-0000000000a8', c, 'ZZ CH Operador compras');
  INSERT INTO public.role_permissions (role_id, permission_key, effect) VALUES ('5b600000-0000-0000-0000-0000000000a8', 'condominios.tab.ordenes_compra', 'allow');
  INSERT INTO public.user_roles (user_id, role_id) VALUES (uo, '5b600000-0000-0000-0000-0000000000a8');
  PERFORM public.conta_seed_catalogo(c, pj);
  PERFORM public.compras_seed_cuentas(c, pj);
  INSERT INTO public.proveedores (id, company_id, nombre, nit, pais, alcance) VALUES
    (pv,  c, 'ZZ CH Proveedor',     '9999971-1', 'GT', 'empresa'),
    (pv2, c, 'ZZ CH Proveedor USD', '9999972-2', 'GT', 'empresa');
  PERFORM set_config('request.jwt.claim.sub', ua::text, true);
  SET LOCAL ROLE authenticated;
  UPDATE public.proveedores SET estado = 'autorizado' WHERE id IN (pv, pv2);
  INSERT INTO public.contratos_proveedores
    (id, company_id, project_id, proveedor_id, proveedor_nombre, referencia, fecha_inicio, fecha_fin, modalidad, periodicidad, moneda, importe_periodico, monto_maximo, responsable_id) VALUES
    (ka,  c, pj, pv,  'x', 'ZZ-CH-KA',  CURRENT_DATE - 30, CURRENT_DATE + 300, 'por_demanda', NULL, 'GTQ', NULL, 1000, ua),
    (ku,  c, pj, pv2, 'x', 'ZZ-CH-KU',  CURRENT_DATE - 30, CURRENT_DATE + 300, 'por_demanda', NULL, 'USD', NULL, NULL, ua),
    (ke,  c, pj, pv,  'x', 'ZZ-CH-KE',  CURRENT_DATE - 30, CURRENT_DATE + 300, 'por_demanda', NULL, 'GTQ', NULL, 1000, ua),
    (kf,  c, pj, pv,  'x', 'ZZ-CH-KF',  CURRENT_DATE - 30, CURRENT_DATE + 300, 'por_demanda', NULL, 'GTQ', NULL, 500,  ua),
    (kv1, c, pj, pv,  'x', 'ZZ-CH-KV1', CURRENT_DATE - 30, CURRENT_DATE + 5,   'por_demanda', NULL, 'GTQ', NULL, NULL, ua),
    (kv2, c, pj, pv,  'x', 'ZZ-CH-KV2', CURRENT_DATE - 30, CURRENT_DATE + 5,   'por_demanda', NULL, 'GTQ', NULL, NULL, ua);
  UPDATE public.contratos_proveedores SET estado = 'activo' WHERE id IN (ka, ku, ke, kf, kv1, kv2);
  RESET ROLE;

  -- ═══ 10 · EDITAR UNA ORDEN EN BORRADOR CONSERVANDO EL CONTRATO ═══════════════════
  PERFORM set_config('request.jwt.claim.sub', uo::text, true);
  SET LOCAL ROLE authenticated;
  INSERT INTO public.ordenes_compra (id, company_id, project_id, proveedor_id, proveedor_nombre, concepto, contrato_id)
    VALUES (ox, c, pj, pv, 'ZZ CH Proveedor', 'OX en borrador al amparo de KA', ka);
  INSERT INTO public.orden_compra_lineas (company_id, orden_compra_id, linea, descripcion, destino_tipo, categoria, cantidad, unidad, precio_unitario)
    VALUES (c, ox, 1, 'Material', 'gasto', 'mantenimiento', 1, 'u', 100);
  RESET ROLE;
  PERFORM set_config('request.jwt.claim.sub', ua::text, true);   -- editar un borrador: administrador (el operador no tiene UPDATE)
  SET LOCAL ROLE authenticated;
  ev := ev || pg_temp.ck('10a · cambiar el proveedor conservando el contrato: rechazado',
    pg_temp.err(format($q$UPDATE public.ordenes_compra SET proveedor_id = %L WHERE id = %L$q$, pv2, ox)), 'COMPRAS_CONTRATO_PROVEEDOR');
  ev := ev || pg_temp.ck('10b · cambiar la moneda conservando el contrato (GTQ): rechazado',
    pg_temp.err(format($q$UPDATE public.ordenes_compra SET moneda = 'USD' WHERE id = %L$q$, ox)), 'COMPRAS_CONTRATO_MONEDA');
  ev := ev || pg_temp.ck('10c · cambiar el proyecto conservando el contrato: rechazado',
    pg_temp.err(format($q$UPDATE public.ordenes_compra SET project_id = %L WHERE id = %L$q$, pj2, ox)), 'COMPRAS_CONTRATO_PROYECTO');
  RESET ROLE;
  ev := ev || pg_temp.ck('10d · la orden conserva proveedor, moneda y proyecto', (SELECT proveedor_id::text || '|' || COALESCE(upper(moneda), '-') || '|' || project_id::text FROM public.ordenes_compra WHERE id = ox), pv::text || '|-|' || pj::text);
  PERFORM set_config('request.jwt.claim.sub', ua::text, true);
  SET LOCAL ROLE authenticated;
  UPDATE public.ordenes_compra SET proveedor_id = pv2, moneda = 'USD', contrato_id = ku WHERE id = ox;
  ev := ev || pg_temp.ck('10e · proveedor, moneda y contrato cambiados juntos y coherentes: permitido', (SELECT proveedor_id::text || '|' || contrato_id::text FROM public.ordenes_compra WHERE id = ox), pv2::text || '|' || ku::text);
  UPDATE public.ordenes_compra SET proveedor_id = pv, moneda = 'GTQ', contrato_id = ka WHERE id = ox;
  UPDATE public.ordenes_compra SET concepto = 'OX con el concepto corregido' WHERE id = ox;
  ev := ev || pg_temp.ck('10f · editar el concepto sigue permitido', (SELECT concepto FROM public.ordenes_compra WHERE id = ox), 'OX con el concepto corregido');
  RESET ROLE;

  -- ═══ 11 · UNA EXCEPCIÓN NO SE REUTILIZA SI CAMBIAN LAS CONDICIONES ═══════════════
  PERFORM set_config('request.jwt.claim.sub', uo::text, true);
  SET LOCAL ROLE authenticated;
  INSERT INTO public.ordenes_compra (id, company_id, project_id, proveedor_id, proveedor_nombre, concepto, contrato_id)
    VALUES (oe, c, pj, pv, 'ZZ CH Proveedor', 'OE sobre el máximo de KE', ke);
  INSERT INTO public.orden_compra_lineas (company_id, orden_compra_id, linea, descripcion, destino_tipo, categoria, cantidad, unidad, precio_unitario)
    VALUES (c, oe, 1, 'Material', 'gasto', 'mantenimiento', 1, 'u', 1200);
  RESET ROLE;
  PERFORM set_config('request.jwt.claim.sub', ua::text, true);
  SET LOCAL ROLE authenticated;
  ev := ev || pg_temp.ck('11a · 1200 sobre un máximo de 1000: no se aprueba sin excepción',
    pg_temp.err(format($q$UPDATE public.ordenes_compra SET estado = 'aprobada' WHERE id = %L$q$, oe)), 'COMPRAS_CONTRATO_NO_VIGENTE');
  RESET ROLE;
  PERFORM set_config('request.jwt.claim.sub', ub::text, true);
  SET LOCAL ROLE authenticated;
  id1 := pg_temp.ex(oe, 'aprobar', 'Compra urgente autorizada por la gerencia (1200)');
  RESET ROLE;
  PERFORM set_config('request.jwt.claim.sub', ua::text, true);
  SET LOCAL ROLE authenticated;
  UPDATE public.orden_compra_lineas SET precio_unitario = 5000 WHERE orden_compra_id = oe;
  RESET ROLE;
  PERFORM set_config('request.jwt.claim.sub', ua::text, true);
  SET LOCAL ROLE authenticated;
  ev := ev || pg_temp.ck('11b · la excepción dada para 1200 NO sirve cuando el importe pasa a 5000',
    pg_temp.err(format($q$UPDATE public.ordenes_compra SET estado = 'aprobada' WHERE id = %L$q$, oe)), 'COMPRAS_CONTRATO_NO_VIGENTE');
  RESET ROLE;
  PERFORM set_config('request.jwt.claim.sub', ua::text, true);
  SET LOCAL ROLE authenticated;
  UPDATE public.orden_compra_lineas SET precio_unitario = 1200 WHERE orden_compra_id = oe;
  UPDATE public.ordenes_compra SET contrato_id = kf WHERE id = oe;
  RESET ROLE;
  PERFORM set_config('request.jwt.claim.sub', ua::text, true);
  SET LOCAL ROLE authenticated;
  ev := ev || pg_temp.ck('11c · la excepción dada para KE NO cubre a KF (otro contrato, mismo importe y causa)',
    pg_temp.err(format($q$UPDATE public.ordenes_compra SET estado = 'aprobada' WHERE id = %L$q$, oe)), 'COMPRAS_CONTRATO_NO_VIGENTE');
  RESET ROLE;
  PERFORM set_config('request.jwt.claim.sub', ub::text, true);
  SET LOCAL ROLE authenticated;
  id2 := pg_temp.ex(oe, 'aprobar', 'Se amplía la compra: ahora contra el contrato KF (1200)');
  id3 := pg_temp.ex(oe, 'aprobar', 'Se amplía la compra: ahora contra el contrato KF (1200)');
  RESET ROLE;
  ev := ev || pg_temp.ck('11d · la autorización para KF es otra, y reintentarla devuelve la misma', (coalesce((id2 <> id1)::text, 'null') || '|' || coalesce((id2 = id3)::text, 'null')), 'true|true');
  ev := ev || pg_temp.ck('11e · quedan DOS excepciones en el historial', (SELECT count(*)::text FROM public.orden_compra_excepciones WHERE orden_compra_id = oe), '2');
  PERFORM set_config('request.jwt.claim.sub', ua::text, true);
  SET LOCAL ROLE authenticated;
  UPDATE public.ordenes_compra SET estado = 'aprobada' WHERE id = oe;
  ev := ev || pg_temp.ck('11f · con la autorización vigente para ESAS condiciones, la orden se aprueba', (SELECT estado FROM public.ordenes_compra WHERE id = oe), 'aprobada');
  INSERT INTO public.ordenes_compra (id, company_id, project_id, proveedor_id, proveedor_nombre, concepto, contrato_id)
    VALUES (ov, c, pj, pv, 'ZZ CH Proveedor', 'OV en KV1 (vence)', kv1);
  INSERT INTO public.orden_compra_lineas (company_id, orden_compra_id, linea, descripcion, destino_tipo, categoria, cantidad, unidad, precio_unitario)
    VALUES (c, ov, 1, 'Material', 'gasto', 'mantenimiento', 1, 'u', 100);
  UPDATE public.contratos_proveedores SET fecha_fin = CURRENT_DATE - 1 WHERE id = kv1;
  RESET ROLE;
  PERFORM set_config('request.jwt.claim.sub', ub::text, true);
  SET LOCAL ROLE authenticated;
  id1 := pg_temp.ex(ov, 'aprobar', 'Contrato KV1 en renovación; no se puede parar el servicio');
  RESET ROLE;
  PERFORM set_config('request.jwt.claim.sub', ua::text, true);
  SET LOCAL ROLE authenticated;
  UPDATE public.ordenes_compra SET contrato_id = kv2 WHERE id = ov;                       -- KV2 aún vigente: se liga
  UPDATE public.contratos_proveedores SET fecha_fin = CURRENT_DATE - 1 WHERE id = kv2;   -- …y vence después
  ev := ev || pg_temp.ck('11g · la excepción por vigencia de KV1 NO cubre a KV2 (venció después de ligarse)',
    pg_temp.err(format($q$UPDATE public.ordenes_compra SET estado = 'aprobada' WHERE id = %L$q$, ov)), 'COMPRAS_CONTRATO_NO_VIGENTE');
  RESET ROLE;
  PERFORM set_config('request.jwt.claim.sub', ub::text, true);
  SET LOCAL ROLE authenticated;
  id2 := pg_temp.ex(ov, 'aprobar', 'Contrato KV2 también en renovación; el servicio sigue');
  RESET ROLE;
  PERFORM set_config('request.jwt.claim.sub', ua::text, true);
  SET LOCAL ROLE authenticated;
  UPDATE public.ordenes_compra SET estado = 'aprobada' WHERE id = ov;
  ev := ev || pg_temp.ck('11h · con la autorización para KV2 la orden se aprueba', (SELECT estado FROM public.ordenes_compra WHERE id = ov), 'aprobada');
  ev := ev || pg_temp.ck('11i · una excepción no se inserta a mano por la API',
    pg_temp.err(format($q$INSERT INTO public.orden_compra_excepciones (company_id, project_id, orden_compra_id, contrato_id, revision, etapa, causas, motivo, autorizado_por) VALUES (%L,%L,%L,%L,9,'aprobar','monto','Excepción fabricada a mano',%L)$q$, c, pj, oe, kf, ua)), 'permission denied for table orden_compra_excepciones');
  RESET ROLE;

  SELECT count(*) INTO fallos FROM unnest(ev) e WHERE e LIKE 'FALLO%';
  RAISE EXCEPTION '%', (CASE WHEN fallos = 0 THEN 'GUION_OK_REVERTIDO' ELSE 'GUION_FALLO' END)
    || ' · ' || array_length(ev, 1) || ' comprobaciones, ' || fallos || ' fallos' || E'\n' || array_to_string(ev, E'\n');
END;
$guion$;
