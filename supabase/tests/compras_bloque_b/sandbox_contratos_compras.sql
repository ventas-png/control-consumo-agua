-- ============================================================================
-- VALIDACIÓN EN SANDBOX · CONTRATOS CONECTADOS A LAS COMPRAS (migraciones 20261024000000 … 20261024000300)
-- Ligar una orden a un contrato (proveedor, proyecto, empresa y moneda), aprobar/emitir con contrato
-- vigente y dentro de su monto, excepción auditada, ampliación documentada, renovación con historial,
-- seguimiento del contrato (contratado ≠ comprometido ≠ recibido ≠ facturado ≠ pagado, por moneda),
-- evaluaciones ligadas al proveedor compartido y aislamiento entre empresas y proyectos.
--
-- SQL plano; UNA sola sentencia (DO) que TERMINA SIEMPRE con una excepción para REVERTIR todo
-- (no queda ninguna fila de prueba):
--   · GUION_OK_REVERTIDO → todo coincide · GUION_FALLO → alguna comprobación no coincide ·
--   · cualquier otro mensaje → fallo real del recorrido.
-- Sin DELETE ni DROP (la herramienta SQL del sandbox no los ejecuta). Padrón de usar y tirar `5b5e…`.
-- La concurrencia con sesiones reales NO se puede hacer aquí (una sentencia = una transacción): se prueba en
-- el arnés local (run.sh, escenarios Q, R y S).
-- ============================================================================
DO $guion$
DECLARE
  c   constant uuid := '5b5e0000-0000-0000-0000-00000000000c';
  cz  constant uuid := '5b5e0000-0000-0000-0000-00000000000d';
  pj  constant uuid := '5b5e0000-0000-0000-0000-0000000000a1';
  pj2 constant uuid := '5b5e0000-0000-0000-0000-0000000000a2';
  pjz constant uuid := '5b5e0000-0000-0000-0000-0000000000a3';
  ua  constant uuid := '5b5e0000-0000-0000-0000-0000000000f1';  -- admin (solicita y autoriza)
  ub  constant uuid := '5b5e0000-0000-0000-0000-0000000000f2';  -- admin 2
  uo  constant uuid := '5b5e0000-0000-0000-0000-0000000000f3';  -- operador de compras (sin contratos ni Contabilidad)
  uk  constant uuid := '5b5e0000-0000-0000-0000-0000000000f4';  -- contador (sin cambio de estado)
  uq  constant uuid := '5b5e0000-0000-0000-0000-0000000000f5';  -- Operaciones con la pestaña de contratos
  ur  constant uuid := '5b5e0000-0000-0000-0000-0000000000f6';  -- solo el proyecto 2
  uz  constant uuid := '5b5e0000-0000-0000-0000-0000000000f7';  -- admin de OTRA empresa
  pv  constant uuid := '5b5e0000-0000-0000-0000-0000000000b1';
  pv2 constant uuid := '5b5e0000-0000-0000-0000-0000000000b2';
  pvs constant uuid := '5b5e0000-0000-0000-0000-0000000000b3';
  pvz constant uuid := '5b5e0000-0000-0000-0000-0000000000b4';
  k1  constant uuid := '5b5e0000-0000-0000-0000-0000000000c1';  -- GTQ, máximo 1000
  k2  constant uuid := '5b5e0000-0000-0000-0000-0000000000c2';  -- GTQ, recurrente, sin límite
  k3  constant uuid := '5b5e0000-0000-0000-0000-0000000000c3';  -- USD
  k4  constant uuid := '5b5e0000-0000-0000-0000-0000000000c4';  -- vence después de ligar
  k5  constant uuid := '5b5e0000-0000-0000-0000-0000000000c5';  -- de un proveedor que se suspende
  oa  constant uuid := '5b5e0000-0000-0000-0000-0000000000e1';  -- 600 en K1
  oc  constant uuid := '5b5e0000-0000-0000-0000-0000000000e2';  -- 300 en K1
  ob  constant uuid := '5b5e0000-0000-0000-0000-0000000000e3';  -- 500 en K1 (rebasa)
  ov  constant uuid := '5b5e0000-0000-0000-0000-0000000000e4';  -- en K4 (vence)
  of_ constant uuid := '5b5e0000-0000-0000-0000-0000000000e5';  -- flujo completo en K2
  ou  constant uuid := '5b5e0000-0000-0000-0000-0000000000e6';  -- flujo completo en K3 (USD)
  op  constant uuid := '5b5e0000-0000-0000-0000-0000000000e7';  -- en K5
  oz  constant uuid := '5b5e0000-0000-0000-0000-0000000000e8';  -- sin contrato
  lf  constant uuid := '5b5e0000-0000-0000-0000-0000000000d5';
  lu  constant uuid := '5b5e0000-0000-0000-0000-0000000000d6';
  rf  constant uuid := '5b5e0000-0000-0000-0000-0000000000a5';
  ru  constant uuid := '5b5e0000-0000-0000-0000-0000000000a6';
  ev  text[] := ARRAY[]::text[];
  t   text;
  j   jsonb;
  id1 uuid; id2 uuid;
  fallos int;
  n0 bigint; n1 bigint; n2 bigint; n3 bigint;
BEGIN
  CREATE FUNCTION pg_temp.ck(p_lbl text, p_o text, p_e text) RETURNS text LANGUAGE sql IMMUTABLE AS
    $f$ SELECT CASE WHEN $2 IS NOT DISTINCT FROM $3 THEN 'OK    ' ELSE 'FALLO ' END || $1 || ' · obtenido=' || coalesce($2, 'NULL') || ' esperado=' || coalesce($3, 'NULL') $f$;
  CREATE FUNCTION pg_temp.ckn(p_lbl text, p_o numeric, p_e numeric) RETURNS text LANGUAGE sql IMMUTABLE AS
    $f$ SELECT CASE WHEN $2 IS NOT DISTINCT FROM $3 THEN 'OK    ' ELSE 'FALLO ' END || $1 || ' · obtenido=' || coalesce(trim_scale($2)::text, 'NULL') || ' esperado=' || coalesce($3::text, 'NULL') $f$;
  CREATE FUNCTION pg_temp.err(p text) RETURNS text LANGUAGE plpgsql AS
    $f$ BEGIN EXECUTE p; RETURN 'SIN ERROR'; EXCEPTION WHEN OTHERS THEN RETURN split_part(SQLERRM, ':', 1); END $f$;

  IF EXISTS (SELECT 1 FROM public.companies WHERE id IN (c, cz)) THEN
    RAISE EXCEPTION 'ABORTA: la empresa de prueba ya existe; no se escribe nada.';
  END IF;

  INSERT INTO public.companies (id, nombre, default_currency) VALUES (c, 'ZZ Contratos', 'gtq'), (cz, 'ZZ Otra empresa CT', 'gtq');
  INSERT INTO public.projects (id, company_id, nombre) VALUES (pj, c, 'ZZ CT Proyecto'), (pj2, c, 'ZZ CT Otro proyecto'), (pjz, cz, 'ZZ CT Proyecto otra empresa');
  INSERT INTO auth.users (id) VALUES (ua), (ub), (uo), (uk), (uq), (ur), (uz);
  INSERT INTO public.app_users (id, company_id, full_name, role) VALUES
    (ua, c, 'ZZ CT Admin', 'admin'), (ub, c, 'ZZ CT Admin 2', 'admin'), (uo, c, 'ZZ CT Operador', 'operator'),
    (uk, c, 'ZZ CT Contador', 'operator'), (uq, c, 'ZZ CT Operaciones contratos', 'operator'),
    (ur, c, 'ZZ CT Solo proyecto 2', 'operator'), (uz, cz, 'ZZ CT Admin otra', 'admin');
  INSERT INTO public.user_project_assignments (user_id, project_id, permission_type) VALUES
    (ua, pj, 'total'), (ua, pj2, 'total'), (ub, pj, 'total'), (uo, pj, 'total'), (uk, pj, 'total'), (uq, pj, 'total'), (ur, pj2, 'total'), (uz, pjz, 'total');
  INSERT INTO public.roles (id, company_id, name) VALUES
    ('5b5e0000-0000-0000-0000-0000000000a9', c, 'ZZ CT Contador'), ('5b5e0000-0000-0000-0000-0000000000a8', c, 'ZZ CT Operador compras'),
    ('5b5e0000-0000-0000-0000-0000000000a7', c, 'ZZ CT Operaciones contratos'), ('5b5e0000-0000-0000-0000-0000000000a4', c, 'ZZ CT Solo proyecto 2');
  INSERT INTO public.role_permissions (role_id, permission_key, effect) VALUES
    ('5b5e0000-0000-0000-0000-0000000000a9', 'platform.contabilidad.view',   'allow'),
    ('5b5e0000-0000-0000-0000-0000000000a9', 'platform.contabilidad.create', 'allow'),
    ('5b5e0000-0000-0000-0000-0000000000a9', 'platform.contabilidad.edit',   'allow'),
    ('5b5e0000-0000-0000-0000-0000000000a9', 'platform.contabilidad.delete', 'allow'),
    ('5b5e0000-0000-0000-0000-0000000000a8', 'condominios.tab.ordenes_compra', 'allow'),
    ('5b5e0000-0000-0000-0000-0000000000a7', 'condominios.tab.proveedores',    'allow'),
    ('5b5e0000-0000-0000-0000-0000000000a7', 'condominios.tab.ordenes_compra', 'allow'),
    ('5b5e0000-0000-0000-0000-0000000000a4', 'condominios.tab.proveedores',    'allow'),
    ('5b5e0000-0000-0000-0000-0000000000a4', 'condominios.tab.eval_proveedor', 'allow');
  INSERT INTO public.user_roles (user_id, role_id) VALUES
    (uk, '5b5e0000-0000-0000-0000-0000000000a9'), (uo, '5b5e0000-0000-0000-0000-0000000000a8'),
    (uq, '5b5e0000-0000-0000-0000-0000000000a7'), (ur, '5b5e0000-0000-0000-0000-0000000000a4');
  PERFORM public.conta_seed_catalogo(c, pj);
  PERFORM public.compras_seed_cuentas(c, pj);
  PERFORM public.conta_seed_catalogo(cz, pjz);
  PERFORM public.compras_seed_cuentas(cz, pjz);
  INSERT INTO public.proveedores (id, company_id, nombre, nit, pais, alcance) VALUES
    (pv,  c,  'ZZ CT Proveedor',        '9999951-1', 'GT', 'empresa'),
    (pv2, c,  'ZZ CT Proveedor USD',    '9999952-2', 'GT', 'empresa'),
    (pvs, c,  'ZZ CT Proveedor a suspender', '9999953-3', 'GT', 'empresa'),
    (pvz, cz, 'ZZ CT Proveedor otra empresa', '9999954-4', 'GT', 'empresa');
  PERFORM set_config('request.jwt.claim.sub', ua::text, true);
  SET LOCAL ROLE authenticated;
  UPDATE public.proveedores SET estado = 'autorizado' WHERE id IN (pv, pv2, pvs);
  RESET ROLE;
  PERFORM set_config('request.jwt.claim.sub', uz::text, true);
  SET LOCAL ROLE authenticated;
  UPDATE public.proveedores SET estado = 'autorizado' WHERE id = pvz;
  RESET ROLE;

  -- Contratos por las vías normales.
  PERFORM set_config('request.jwt.claim.sub', ua::text, true);
  SET LOCAL ROLE authenticated;
  INSERT INTO public.contratos_proveedores
    (id, company_id, project_id, proveedor_id, proveedor_nombre, referencia, fecha_inicio, fecha_fin, modalidad, periodicidad, moneda, importe_periodico, monto_maximo, responsable_id) VALUES
    (k1, c, pj, pv,  'x', 'ZZ-K1', CURRENT_DATE - 30, CURRENT_DATE + 300, 'por_demanda', NULL,      'GTQ', NULL, 1000, ua),
    (k2, c, pj, pv,  'x', 'ZZ-K2', CURRENT_DATE - 30, NULL,                'recurrente',  'mensual', 'GTQ', 500,  NULL, ua),
    (k3, c, pj, pv2, 'x', 'ZZ-K3', CURRENT_DATE - 30, CURRENT_DATE + 300, 'por_demanda', NULL,      'USD', NULL, NULL, ua),
    (k4, c, pj, pv,  'x', 'ZZ-K4', CURRENT_DATE - 30, CURRENT_DATE + 5,   'por_demanda', NULL,      'GTQ', NULL, NULL, ua),
    (k5, c, pj, pvs, 'x', 'ZZ-K5', CURRENT_DATE - 30, CURRENT_DATE + 300, 'por_demanda', NULL,      'GTQ', NULL, NULL, ua);
  UPDATE public.contratos_proveedores SET estado = 'activo' WHERE id IN (k1, k2, k3, k4, k5);
  RESET ROLE;

  -- ═══ 1 · LIGAR UNA ORDEN: proveedor, proyecto, empresa y moneda ═════════════════
  PERFORM set_config('request.jwt.claim.sub', uo::text, true);
  SET LOCAL ROLE authenticated;
  INSERT INTO public.ordenes_compra (id, company_id, project_id, proveedor_id, proveedor_nombre, concepto, contrato_id) VALUES
    (oa, c, pj, pv, 'ZZ CT Proveedor', 'OA 600', k1), (oc, c, pj, pv, 'ZZ CT Proveedor', 'OC 300', k1), (ob, c, pj, pv, 'ZZ CT Proveedor', 'OB 500', k1);
  INSERT INTO public.orden_compra_lineas (company_id, orden_compra_id, linea, descripcion, destino_tipo, categoria, cantidad, unidad, precio_unitario) VALUES
    (c, oa, 1, 'Material', 'gasto', 'mantenimiento', 1, 'u', 600), (c, oc, 1, 'Material', 'gasto', 'mantenimiento', 1, 'u', 300),
    (c, ob, 1, 'Material', 'gasto', 'mantenimiento', 1, 'u', 500);
  ev := ev || pg_temp.ck('1a · un contrato de otro proveedor no ampara la orden',
    pg_temp.err(format($q$INSERT INTO public.ordenes_compra (company_id, project_id, proveedor_id, proveedor_nombre, concepto, contrato_id) VALUES (%L,%L,%L,'x','otro proveedor',%L)$q$, c, pj, pv2, k1)), 'COMPRAS_CONTRATO_PROVEEDOR');
  ev := ev || pg_temp.ck('1b · el contrato es del proyecto 1: no ampara una orden del proyecto 2',
    pg_temp.err(format($q$INSERT INTO public.ordenes_compra (company_id, project_id, proveedor_id, proveedor_nombre, concepto, contrato_id) VALUES (%L,%L,%L,'x','otro proyecto',%L)$q$, c, pj2, pv, k1)), 'COMPRAS_CONTRATO_PROYECTO');
  ev := ev || pg_temp.ck('1c · contrato GTQ, orden USD: no se mezclan monedas',
    pg_temp.err(format($q$INSERT INTO public.ordenes_compra (company_id, project_id, proveedor_id, proveedor_nombre, concepto, contrato_id, moneda) VALUES (%L,%L,%L,'x','moneda',%L,'USD')$q$, c, pj, pv, k1)), 'COMPRAS_CONTRATO_MONEDA');
  RESET ROLE;
  PERFORM set_config('request.jwt.claim.sub', uz::text, true);
  SET LOCAL ROLE authenticated;
  ev := ev || pg_temp.ck('1d · otra empresa no ampara una orden suya en un contrato de la empresa C',
    pg_temp.err(format($q$INSERT INTO public.ordenes_compra (company_id, project_id, proveedor_id, proveedor_nombre, concepto, contrato_id) VALUES (%L,%L,%L,'x','ajeno',%L)$q$, cz, pjz, pvz, k1)), 'COMPRAS_CONTRATO_AJENO');
  RESET ROLE;

  -- ═══ 2 y 3 · VIGENCIA, MONTO Y AMPLIACIÓN ═══════════════════════════════════════
  PERFORM set_config('request.jwt.claim.sub', ua::text, true);
  SET LOCAL ROLE authenticated;
  UPDATE public.ordenes_compra SET estado = 'aprobada' WHERE id IN (oa, oc);          -- 600 + 300 = 900 ≤ 1000
  UPDATE public.ordenes_compra SET estado = 'emitida'  WHERE id = oa;
  ev := ev || pg_temp.ck('2a · con contrato vigente la orden se aprueba y se emite', (SELECT string_agg(estado, ',' ORDER BY concepto) FROM public.ordenes_compra WHERE id IN (oa, oc)), 'emitida,aprobada');
  ev := ev || pg_temp.ck('3a · 900 + 500 rebasa el máximo de 1000: bloqueado',
    pg_temp.err(format($q$UPDATE public.ordenes_compra SET estado = 'aprobada' WHERE id = %L$q$, ob)), 'COMPRAS_CONTRATO_NO_VIGENTE');
  ev := ev || pg_temp.ck('3b · …y queda en borrador', (SELECT estado FROM public.ordenes_compra WHERE id = ob), 'borrador');
  ev := ev || pg_temp.ck('3c · un contrato sin monto máximo no se «amplía»',
    pg_temp.err(format($q$SELECT public.contrato_ampliar_monto(%L, 100, 'Ampliar un contrato sin límite', 'zz-clave-sinlimite')$q$, k2)), 'CONTRATO_SIN_LIMITE');
  id1 := public.contrato_ampliar_monto(k1, 1000, 'Ampliación autorizada por el comité', 'zz-clave-amp-1', 'ADENDA-1');
  id2 := public.contrato_ampliar_monto(k1, 1000, 'Ampliación autorizada por el comité', 'zz-clave-amp-1', 'ADENDA-1');
  ev := ev || pg_temp.ck('3d · reintentar la ampliación con la misma clave devuelve la misma', (id1 = id2)::text, 'true');
  ev := ev || pg_temp.ck('3e · la misma clave con otro contenido se rechaza',
    pg_temp.err(format($q$SELECT public.contrato_ampliar_monto(%L, 2000, 'Otro contenido, misma clave', 'zz-clave-amp-1')$q$, k1)), 'CONTRATO_AMPLIACION_CLAVE');
  UPDATE public.ordenes_compra SET estado = 'aprobada' WHERE id = ob;                  -- 900 + 500 = 1400 ≤ 2000
  ev := ev || pg_temp.ck('3f · con la ampliación documentada, OB cabe (1400 de 2000)', (SELECT estado FROM public.ordenes_compra WHERE id = ob), 'aprobada');
  RESET ROLE;
  ev := ev || pg_temp.ckn('3g · una sola ampliación registrada', (SELECT count(*) FROM public.contrato_ampliaciones WHERE contrato_id = k1), 1);
  ev := ev || pg_temp.ckn('3h · la condición ORIGINAL (1000) no se sobrescribió', (SELECT monto_maximo FROM public.contratos_proveedores WHERE id = k1), 1000);
  PERFORM set_config('request.jwt.claim.sub', uo::text, true);
  SET LOCAL ROLE authenticated;
  ev := ev || pg_temp.ck('3i · quien no tiene la pestaña de contratos no amplía',
    pg_temp.err(format($q$SELECT public.contrato_ampliar_monto(%L, 10, 'Operador sin pestaña de contratos', 'zz-clave-op-1')$q$, k1)), 'CONTRATO_AMPLIACION_AJENA');
  RESET ROLE;

  -- ═══ 4 · EXCEPCIÓN AUDITADA (vigencia) ═══════════════════════════════════════════
  PERFORM set_config('request.jwt.claim.sub', ua::text, true);
  SET LOCAL ROLE authenticated;
  INSERT INTO public.ordenes_compra (id, company_id, project_id, proveedor_id, proveedor_nombre, concepto, contrato_id)
    VALUES (ov, c, pj, pv, 'ZZ CT Proveedor', 'OV en K4', k4);
  INSERT INTO public.orden_compra_lineas (company_id, orden_compra_id, linea, descripcion, destino_tipo, categoria, cantidad, unidad, precio_unitario)
    VALUES (c, ov, 1, 'Material', 'gasto', 'mantenimiento', 1, 'u', 100);
  UPDATE public.contratos_proveedores SET fecha_fin = CURRENT_DATE - 1 WHERE id = k4;    -- reducir el plazo es libre
  ev := ev || pg_temp.ck('4a · contrato vencido por fechas: no se aprueba',
    pg_temp.err(format($q$UPDATE public.ordenes_compra SET estado = 'aprobada' WHERE id = %L$q$, ov)), 'COMPRAS_CONTRATO_NO_VIGENTE');
  ev := ev || pg_temp.ck('4b · …ni se ligan órdenes nuevas',
    pg_temp.err(format($q$INSERT INTO public.ordenes_compra (company_id, project_id, proveedor_id, proveedor_nombre, concepto, contrato_id) VALUES (%L,%L,%L,'x','nueva',%L)$q$, c, pj, pv, k4)), 'COMPRAS_CONTRATO_FUERA_DE_VIGENCIA');
  RESET ROLE;
  PERFORM set_config('request.jwt.claim.sub', uk::text, true);
  SET LOCAL ROLE authenticated;
  ev := ev || pg_temp.ck('4c · el contador sin cambio de estado no autoriza la excepción',
    pg_temp.err(format($q$SELECT public.compras_oc_excepcion_contrato(%L, 'aprobar', 'Autorización sin permiso de cambio de estado')$q$, ov)), 'COMPRAS_EXCEPCION_PERMISO');
  RESET ROLE;
  PERFORM set_config('request.jwt.claim.sub', uz::text, true);
  SET LOCAL ROLE authenticated;
  ev := ev || pg_temp.ck('4d · otra empresa no ve la orden: no autoriza nada',
    pg_temp.err(format($q$SELECT public.compras_oc_excepcion_contrato(%L, 'aprobar', 'Otra empresa autorizando una excepción')$q$, ov)), 'COMPRAS_EXCEPCION_ORDEN');
  RESET ROLE;
  INSERT INTO public.compras_config (company_id, aprobacion_separada) VALUES (c, true) ON CONFLICT (company_id) DO UPDATE SET aprobacion_separada = true;
  PERFORM set_config('request.jwt.claim.sub', ua::text, true);
  SET LOCAL ROLE authenticated;
  ev := ev || pg_temp.ck('4e · con separación activada, quien solicitó la orden no autoriza su excepción',
    pg_temp.err(format($q$SELECT public.compras_oc_excepcion_contrato(%L, 'aprobar', 'Quien solicitó autoriza su propia excepción')$q$, ov)), 'COMPRAS_EXCEPCION_AUTOAUTORIZACION');
  RESET ROLE;
  PERFORM set_config('request.jwt.claim.sub', ub::text, true);
  SET LOCAL ROLE authenticated;
  id1 := public.compras_oc_excepcion_contrato(ov, 'aprobar', 'Contrato en renovación; el servicio no puede parar');
  id2 := public.compras_oc_excepcion_contrato(ov, 'aprobar', 'Contrato en renovación; el servicio no puede parar');
  ev := ev || pg_temp.ck('4f · reintentar la excepción devuelve la misma', (id1 = id2)::text, 'true');
  RESET ROLE;
  UPDATE public.compras_config SET aprobacion_separada = false WHERE company_id = c;
  ev := ev || pg_temp.ckn('4g · una sola excepción registrada, a nombre de quien la autorizó', (SELECT count(*) FROM public.orden_compra_excepciones WHERE orden_compra_id = ov AND autorizado_por = ub), 1);
  ev := ev || pg_temp.ckn('4h · queda en el historial de la orden', (SELECT count(*) FROM public.orden_compra_eventos WHERE orden_compra_id = ov AND tipo = 'excepcion_contrato'), 1);
  PERFORM set_config('request.jwt.claim.sub', ua::text, true);
  SET LOCAL ROLE authenticated;
  UPDATE public.ordenes_compra SET estado = 'aprobada' WHERE id = ov;
  ev := ev || pg_temp.ck('4i · con la excepción la orden se aprueba', (SELECT estado FROM public.ordenes_compra WHERE id = ov), 'aprobada');
  ev := ev || pg_temp.ck('4j · la excepción de aprobar no cubre emitir',
    pg_temp.err(format($q$UPDATE public.ordenes_compra SET estado = 'emitida' WHERE id = %L$q$, ov)), 'COMPRAS_CONTRATO_NO_VIGENTE');
  PERFORM public.compras_oc_excepcion_contrato(ov, 'emitir', 'Se emite hoy; la renovación se firma esta semana');
  UPDATE public.ordenes_compra SET estado = 'emitida' WHERE id = ov;
  ev := ev || pg_temp.ck('4k · con su propia excepción se emite', (SELECT estado FROM public.ordenes_compra WHERE id = ov), 'emitida');
  RESET ROLE;

  -- ═══ 5 · contrato suspendido, proveedor suspendido, cancelación ═════════════════
  PERFORM set_config('request.jwt.claim.sub', uo::text, true);
  SET LOCAL ROLE authenticated;
  INSERT INTO public.ordenes_compra (id, company_id, project_id, proveedor_id, proveedor_nombre, concepto, contrato_id)
    VALUES (op, c, pj, pvs, 'ZZ CT Proveedor a suspender', 'OP en K5', k5);
  INSERT INTO public.orden_compra_lineas (company_id, orden_compra_id, linea, descripcion, destino_tipo, categoria, cantidad, unidad, precio_unitario)
    VALUES (c, op, 1, 'Material', 'gasto', 'mantenimiento', 1, 'u', 100);
  RESET ROLE;
  UPDATE public.proveedores SET estado = 'suspendido', motivo_estado = 'Papelería vencida' WHERE id = pvs;
  PERFORM set_config('request.jwt.claim.sub', ua::text, true);
  SET LOCAL ROLE authenticated;
  ev := ev || pg_temp.ck('5a · proveedor suspendido: aprobar sigue bloqueado aunque el contrato esté vigente',
    pg_temp.err(format($q$UPDATE public.ordenes_compra SET estado = 'aprobada' WHERE id = %L$q$, op)), 'COMPRAS_PROVEEDOR_NO_AUTORIZADO');
  ev := ev || pg_temp.ck('5b · y la excepción de contrato no lo tapa',
    pg_temp.err(format($q$SELECT public.compras_oc_excepcion_contrato(%L, 'aprobar', 'No se exceptúa al proveedor suspendido')$q$, op)), 'COMPRAS_EXCEPCION_INNECESARIA');
  UPDATE public.ordenes_compra SET estado = 'cancelada', motivo_anulacion = 'Ya no se necesita' WHERE id = oc;
  ev := ev || pg_temp.ck('5c · cancelar una orden amparada en contrato sigue permitido', (SELECT estado FROM public.ordenes_compra WHERE id = oc), 'cancelada');
  RESET ROLE;

  -- ═══ 6 · RENOVACIÓN y PRÓRROGA ═══════════════════════════════════════════════════
  SELECT count(*) INTO n0 FROM public.facturas_proveedor WHERE company_id = c;
  SELECT count(*) INTO n1 FROM public.ordenes_pago WHERE company_id = c;
  SELECT count(*) INTO n2 FROM public.conta_asientos WHERE company_id = c;
  SELECT count(*) INTO n3 FROM public.ordenes_compra WHERE company_id = c;
  PERFORM set_config('request.jwt.claim.sub', ua::text, true);
  SET LOCAL ROLE authenticated;
  id1 := public.contrato_renovar(k2, CURRENT_DATE + 10, CURRENT_DATE + 375, 'Renovación anual del servicio');
  id2 := public.contrato_renovar(k2, CURRENT_DATE + 10, CURRENT_DATE + 375, 'Renovación anual del servicio');
  ev := ev || pg_temp.ck('6a · reintentar la renovación devuelve el mismo contrato', (id1 = id2)::text, 'true');
  UPDATE public.contratos_proveedores SET estado = 'activo' WHERE id = id1;
  ev := ev || pg_temp.ck('6b · la renovación nace en borrador y activarla es explícito (queda activa)', (SELECT estado FROM public.contratos_proveedores WHERE id = id1), 'activo');
  ev := ev || pg_temp.ck('6c · un INSERT directo con renovado_de se rechaza',
    pg_temp.err(format($q$INSERT INTO public.contratos_proveedores (company_id, project_id, proveedor_id, proveedor_nombre, fecha_inicio, modalidad, periodicidad, renovado_de) VALUES (%L,%L,%L,'x',CURRENT_DATE+99,'recurrente','mensual',%L)$q$, c, pj, pv, k2)), 'CONTRATO_RENOVACION_POR_RPC');
  ev := ev || pg_temp.ck('6d · ampliar la vigencia con un UPDATE directo, sin motivo, se rechaza',
    pg_temp.err(format($q$UPDATE public.contratos_proveedores SET fecha_fin = CURRENT_DATE + 900 WHERE id = %L$q$, k1)), 'CONTRATO_AMPLIACION_MOTIVO');
  PERFORM public.contrato_prorrogar(k1, CURRENT_DATE + 900, 'Se amplía la vigencia por la adenda 2');
  RESET ROLE;
  ev := ev || pg_temp.ckn('6e · una sola renovación del original', (SELECT count(*) FROM public.contratos_proveedores WHERE renovado_de = k2), 1);
  ev := ev || pg_temp.ck('6f · el original conserva estado e importe', (SELECT estado || '|' || importe_periodico::text || '|' || coalesce(fecha_fin::text, 'indef') FROM public.contratos_proveedores WHERE id = k2), 'activo|500.00|indef');
  ev := ev || pg_temp.ckn('6g · el original registra «renovado por»', (SELECT count(*) FROM public.contrato_proveedor_eventos WHERE contrato_id = k2 AND tipo = 'renovado_por'), 1);
  ev := ev || pg_temp.ck('6h · la prórroga deja su motivo en el historial', (SELECT detalle ->> 'motivo' FROM public.contrato_proveedor_eventos WHERE contrato_id = k1 AND tipo = 'prorroga' ORDER BY created_at DESC LIMIT 1), 'Se amplía la vigencia por la adenda 2');
  ev := ev || pg_temp.ckn('6i · renovar y activar no generó facturas', (SELECT count(*) FROM public.facturas_proveedor WHERE company_id = c), n0);
  ev := ev || pg_temp.ckn('6j · …ni pagos', (SELECT count(*) FROM public.ordenes_pago WHERE company_id = c), n1);
  ev := ev || pg_temp.ckn('6k · …ni asientos', (SELECT count(*) FROM public.conta_asientos WHERE company_id = c), n2);
  ev := ev || pg_temp.ckn('6l · …ni órdenes', (SELECT count(*) FROM public.ordenes_compra WHERE company_id = c), n3);

  -- ═══ 7 · SEGUIMIENTO DEL CONTRATO ═══════════════════════════════════════════════
  PERFORM set_config('request.jwt.claim.sub', uo::text, true);
  SET LOCAL ROLE authenticated;
  INSERT INTO public.ordenes_compra (id, company_id, project_id, proveedor_id, proveedor_nombre, concepto, contrato_id) VALUES (of_, c, pj, pv, 'ZZ CT Proveedor', 'OF flujo GTQ', k2);
  INSERT INTO public.ordenes_compra (id, company_id, project_id, proveedor_id, proveedor_nombre, concepto, moneda, contrato_id) VALUES (ou, c, pj, pv2, 'ZZ CT Proveedor USD', 'OU flujo USD', 'USD', k3);
  INSERT INTO public.orden_compra_lineas (id, company_id, orden_compra_id, linea, descripcion, destino_tipo, categoria, cantidad, unidad, precio_unitario, iva_monto) VALUES
    (lf, c, of_, 1, 'Material', 'gasto', 'mantenimiento', 10, 'u', 100, 120), (lu, c, ou, 1, 'Servicio en dólares', 'gasto', 'servicios', 5, 'u', 20, 12);
  PERFORM set_config('request.jwt.claim.sub', ua::text, true);
  UPDATE public.ordenes_compra SET estado = 'aprobada' WHERE id IN (of_, ou);
  UPDATE public.ordenes_compra SET estado = 'emitida'  WHERE id IN (of_, ou);
  INSERT INTO public.recepciones (id, company_id, project_id, orden_compra_id, tipo) VALUES (rf, c, pj, of_, 'bienes'), (ru, c, pj, ou, 'bienes');
  INSERT INTO public.recepcion_lineas (company_id, recepcion_id, orden_compra_linea_id, cantidad, costo_unitario) VALUES (c, rf, lf, 6, 100), (c, ru, lu, 5, 20);
  UPDATE public.recepciones SET estado = 'registrada' WHERE id IN (rf, ru);
  RESET ROLE;
  PERFORM set_config('request.jwt.claim.sub', uk::text, true);
  SET LOCAL ROLE authenticated;
  PERFORM public.compras_factura_crear(c, pj, jsonb_build_object('proveedor_id', pv, 'orden_compra_id', of_, 'numero_factura', 'ZZCT-1', 'concepto', 'Factura de 6', 'clave_idempotencia', 'zzct-clave-1'),
    jsonb_build_array(jsonb_build_object('orden_compra_linea_id', lf, 'cantidad', 6, 'precio_unitario', 100, 'iva_monto', 72)));
  PERFORM public.compras_factura_crear(c, pj, jsonb_build_object('proveedor_id', pv2, 'orden_compra_id', ou, 'numero_factura', 'ZZCT-2', 'concepto', 'Factura USD', 'clave_idempotencia', 'zzct-clave-2'),
    jsonb_build_array(jsonb_build_object('orden_compra_linea_id', lu, 'cantidad', 5, 'precio_unitario', 20, 'iva_monto', 12)));
  PERFORM set_config('request.jwt.claim.sub', ua::text, true);
  UPDATE public.facturas_proveedor SET estado = 'aprobada' WHERE numero_factura IN ('ZZCT-1', 'ZZCT-2') AND company_id = c;
  RESET ROLE;

  PERFORM set_config('request.jwt.claim.sub', uk::text, true);
  SET LOCAL ROLE authenticated;
  j := public.compras_contrato_seguimiento(k2);
  ev := ev || pg_temp.ck('7a · K2 solo tiene GTQ (no se mezclan monedas)', (jsonb_array_length(j->'por_moneda'))::text || '|' || (j->'por_moneda'->0->>'moneda'), '1|GTQ');
  ev := ev || pg_temp.ckn('7b · comprometido de K2 = 1120 (la orden cancelada/borrador no cuenta)', (j->'por_moneda'->0->>'comprometido')::numeric, 1120);
  ev := ev || pg_temp.ckn('7c · facturado de K2 = 672 (≠ comprometido)', (j->'por_moneda'->0->>'facturado')::numeric, 672);
  ev := ev || pg_temp.ckn('7d · pendiente por recibir de K2 = 4 × 100', (j->'por_moneda'->0->>'pendiente_por_recibir')::numeric, 400);
  ev := ev || pg_temp.ck('7e · K2 no tiene monto máximo: sin límite total, y no se inventa uno', (j->'contrato'->>'sin_limite_total') || '|' || ((j->'contrato'->'monto_maximo_vigente') = 'null'::jsonb)::text, 'true|true');
  j := public.compras_contrato_seguimiento(k3);
  ev := ev || pg_temp.ck('7f · K3 solo tiene USD', (j->'por_moneda'->0->>'moneda'), 'USD');
  ev := ev || pg_temp.ckn('7g · facturado de K3 = 112 USD', (j->'por_moneda'->0->>'facturado')::numeric, 112);
  j := public.compras_contrato_seguimiento(k1);
  ev := ev || pg_temp.ckn('7h · K1 contratado original', (j->'contrato'->>'monto_maximo_original')::numeric, 1000);
  ev := ev || pg_temp.ckn('7i · K1 monto máximo vigente (original + ampliación documentada)', (j->'contrato'->>'monto_maximo_vigente')::numeric, 2000);
  ev := ev || pg_temp.ckn('7j · K1 comprometido 1100 (600 emitida + 500 aprobada; la de 300 cancelada no cuenta)', (j->'por_moneda'->0->>'comprometido')::numeric, 1100);
  ev := ev || pg_temp.ckn('7k · K1 disponible = vigente − comprometido', (j->'por_moneda'->0->>'disponible')::numeric, 900);
  RESET ROLE;
  PERFORM set_config('request.jwt.claim.sub', uq::text, true);
  SET LOCAL ROLE authenticated;
  j := public.compras_contrato_seguimiento(k2);
  ev := ev || pg_temp.ck('8a · Operaciones no tiene Contabilidad visible', (j->>'contabilidad_visible'), 'false');
  ev := ev || pg_temp.ck('8b · …no recibe lo facturado ni lo pagado (NULL desde el servidor)', ((j->'por_moneda'->0->>'facturado') IS NULL)::text || '|' || ((j->'por_moneda'->0->>'pagado') IS NULL)::text, 'true|true');
  ev := ev || pg_temp.ckn('8c · …ni facturas ni pagos', jsonb_array_length(j->'facturas') + jsonb_array_length(j->'pagos'), 0);
  ev := ev || pg_temp.ckn('8d · sí ve lo que falta por recibir', (j->'por_moneda'->0->>'pendiente_por_recibir')::numeric, 400);
  RESET ROLE;
  PERFORM set_config('request.jwt.claim.sub', ur::text, true);
  SET LOCAL ROLE authenticated;
  ev := ev || pg_temp.ck('8e · quien solo tiene el proyecto 2 no ve el seguimiento de un contrato del proyecto 1', (public.compras_contrato_seguimiento(k1) IS NULL)::text, 'true');
  ev := ev || pg_temp.ckn('8f · …ni lee los contratos del proyecto 1', (SELECT count(*) FROM public.contratos_proveedores WHERE id = k1), 0);
  RESET ROLE;
  PERFORM set_config('request.jwt.claim.sub', uz::text, true);
  SET LOCAL ROLE authenticated;
  ev := ev || pg_temp.ck('8g · otra empresa no ve el seguimiento', (public.compras_contrato_seguimiento(k1) IS NULL)::text, 'true');
  RESET ROLE;
  PERFORM set_config('request.jwt.claim.sub', uo::text, true);
  SET LOCAL ROLE authenticated;
  ev := ev || pg_temp.ck('8h · un operador de órdenes sin la pestaña de contratos no lo ve', (public.compras_contrato_seguimiento(k1) IS NULL)::text, 'true');
  RESET ROLE;

  -- ═══ 9 · EVALUACIONES ═══════════════════════════════════════════════════════════
  PERFORM set_config('request.jwt.claim.sub', ua::text, true);
  SET LOCAL ROLE authenticated;
  ev := ev || pg_temp.ck('9a · no se evalúa a «alguien» en texto libre',
    pg_temp.err(format($q$INSERT INTO public.evaluaciones_proveedor (company_id, project_id, nombre_proveedor, calificacion) VALUES (%L,%L,'Alguien',4)$q$, c, pj)), 'EVALUACION_PROVEEDOR_REQUERIDO');
  INSERT INTO public.evaluaciones_proveedor (id, company_id, project_id, proveedor_catalogo_id, calificacion, evaluado_por_id, evaluado_por)
    VALUES ('5b5e0000-0000-0000-0000-0000000000f8', c, pj, pv, 4, ub, 'Otra persona');
  RESET ROLE;
  ev := ev || pg_temp.ck('9b · el evaluador lo sella el servidor (no se firma a nombre de otra persona)', (SELECT evaluado_por_id::text FROM public.evaluaciones_proveedor WHERE id = '5b5e0000-0000-0000-0000-0000000000f8'), ua::text);
  PERFORM set_config('request.jwt.claim.sub', ua::text, true);
  SET LOCAL ROLE authenticated;
  ev := ev || pg_temp.ck('9c · el contrato debe ser del proveedor evaluado',
    pg_temp.err(format($q$INSERT INTO public.evaluaciones_proveedor (company_id, project_id, proveedor_catalogo_id, contrato_id, calificacion) VALUES (%L,%L,%L,%L,3)$q$, c, pj, pv2, k1)), 'EVALUACION_PROVEEDOR_CONTRATO');
  ev := ev || pg_temp.ck('9d · no se evalúa a un proveedor de otra empresa',
    pg_temp.err(format($q$INSERT INTO public.evaluaciones_proveedor (company_id, project_id, proveedor_catalogo_id, calificacion) VALUES (%L,%L,%L,3)$q$, c, pj, pvz)), 'EVALUACION_PROVEEDOR_AJENO');
  INSERT INTO public.evaluaciones_proveedor (id, company_id, project_id, proveedor_catalogo_id, contrato_id, calificacion, comentarios)
    VALUES ('5b5e0000-0000-0000-0000-0000000000f9', c, pj, pv, k1, 1, 'Entregas tardías');
  RESET ROLE;
  ev := ev || pg_temp.ck('9e · una evaluación NEGATIVA no suspende al proveedor ni toca el contrato', (SELECT p.estado || '|' || k.estado FROM public.proveedores p, public.contratos_proveedores k WHERE p.id = pv AND k.id = k1), 'autorizado|activo');
  PERFORM set_config('request.jwt.claim.sub', ur::text, true);
  SET LOCAL ROLE authenticated;
  ev := ev || pg_temp.ckn('9f · quien solo tiene el proyecto 2 no lee las evaluaciones del proyecto 1', (SELECT count(*) FROM public.evaluaciones_proveedor WHERE company_id = c AND project_id = pj), 0);
  RESET ROLE;

  SELECT count(*) INTO fallos FROM unnest(ev) e WHERE e LIKE 'FALLO%';
  RAISE EXCEPTION '%', (CASE WHEN fallos = 0 THEN 'GUION_OK_REVERTIDO' ELSE 'GUION_FALLO' END)
    || ' · ' || array_length(ev, 1) || ' comprobaciones, ' || fallos || ' fallos' || E'\n' || array_to_string(ev, E'\n');
END;
$guion$;
