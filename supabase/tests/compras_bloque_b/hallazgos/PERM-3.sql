\set ON_ERROR_STOP on
-- ============================================================================
-- PERM-3 · Escritura DIRECTA por la API (INSERT / UPSERT / UPDATE como `authenticated` con claim sub, no solo la RPC):
--          nacer ya aprobada o emitida, ON CONFLICT, y la regla de CERO FILAS (nunca hay «éxito» si no hubo operación).
--
-- CAUSA RAÍZ
--   Ocultar el botón no basta: la API REST escribe las tablas directamente. Un INSERT puede crear una orden de compra YA
--   aprobada o emitida (20261027000700), y un UPSERT (`INSERT … ON CONFLICT DO UPDATE SET estado = …`) dispara a la vez el
--   trigger de INSERT y el de UPDATE. Y un UPDATE que la RLS deja sin filas NO falla: devuelve 0, y una pantalla que lo toma
--   por éxito miente («aprobada» sin haber aprobado nada).
--
-- COMPORTAMIENTO ESPERADO
--   · INSERT de una orden ya «aprobada»: exige la llave de la orden (+ proyecto asignado); ya «emitida»: la llave de la
--     orden Y change_status; recibida/cerrada/cancelada: COMPRAS_ESTADO_INICIAL aun para el administrador; el aprobador y
--     la hora los sella el servidor; de otra empresa, el mismo error de la RLS; sin rastro cuando se rechaza.
--   · INSERT de factura ya «aprobada» o con pagos, de recepción ya «registrada» y de orden de pago ya «aprobada»/«pagada»:
--     rechazados con el código de estado inicial aunque se tenga la llave de la acción y aunque sea el administrador.
--   · UPSERT: el DO UPDATE SET estado exige la llave de la acción igual que un UPDATE; un ON CONFLICT DO NOTHING con un
--     estado propuesto no permitido también se rechaza (el trigger BEFORE INSERT corre antes de detectar el conflicto).
--   · CERO FILAS (GET DIAGNOSTICS ROW_COUNT = 0), sin error y sin cambiar nada (la fila queda byte a byte igual): documento
--     de otro proyecto, de otra empresa, inexistente, o que ya salió del estado de origen (doble clic, carrera perdida); un
--     UPDATE … RETURNING sin filas no devuelve nada.
--
-- Ids propios: md5('perm:…') (perm_id). Empresas, proyectos y personas propios de esta prueba.
--
-- ⚠ SOLO clúster local; nunca contra sandbox/producción. Crea funciones auxiliares perm_* (una es SECURITY DEFINER y
--   ejecutable por `authenticated`, para modelar una RPC) y empresas de prueba que NO se pueden borrar (los documentos de
--   compras no se borran). Las ayudas se borran al final (DROP FUNCTION IF EXISTS) y una comprobación final exige que no quede
--   ninguna; los datos 'PERM-…' sí quedan en la base. Lo corre run.sh sobre su clúster desechable.
-- ============================================================================

-- Espacio de nombres de los identificadores de esta prueba (ver perm_id)
SELECT set_config('perm.ns', 'PERM-3', false);
-- ── Ayudas de esta prueba (prefijo perm_; no tocan nada de la plantilla) ────
-- Ejecuta un SQL y exige que falle CON ese SQLSTATE y ese mensaje. Un rechazo por el motivo equivocado es un falso verde.
CREATE OR REPLACE FUNCTION public.perm_falla(p_sql text, p_estado text, p_patron text, p_msg text)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  BEGIN
    EXECUTE p_sql;
  EXCEPTION WHEN OTHERS THEN
    IF SQLSTATE = p_estado AND SQLERRM ~ p_patron THEN
      RAISE NOTICE '✓ % (%)', p_msg, left(SQLERRM, 80);
      RETURN;
    END IF;
    RAISE EXCEPTION '% — falló con % «%», y se esperaba % «%»', p_msg, SQLSTATE, left(SQLERRM, 240), p_estado, p_patron;
  END;
  RAISE EXCEPTION '% — NO falló, y tenía que fallar', p_msg;
END;
$$;

-- Ejecuta un UPDATE/INSERT y exige que afecte EXACTAMENTE `p_filas` filas (GET DIAGNOSTICS ROW_COUNT); no es éxito si no hubo operación.
CREATE OR REPLACE FUNCTION public.perm_filas(p_sql text, p_filas bigint, p_msg text)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE
  n bigint;
BEGIN
  EXECUTE p_sql;
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n IS DISTINCT FROM p_filas THEN
    RAISE EXCEPTION '% — se esperaban % filas afectadas y fueron %', p_msg, p_filas, n;
  END IF;
  RAISE NOTICE '✓ % (% fila(s))', p_msg, n;
END;
$$;

-- Ejecuta un SQL que DEBE pasar: si falla, dice cuál era la prueba y por qué falló (en vez de abortar con el error pelado).
CREATE OR REPLACE FUNCTION public.perm_pasa(p_sql text, p_msg text)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  BEGIN
    EXECUTE p_sql;
  EXCEPTION WHEN OTHERS THEN
    RAISE EXCEPTION '% — FALLÓ y tenía que pasar: % «%»', p_msg, SQLSTATE, left(SQLERRM, 240);
  END;
  RAISE NOTICE '✓ %', p_msg;
END;
$$;

-- Identificador determinista de un documento o persona: perm_id('a01', 'oc'). El espacio de nombres lo fija CADA archivo de prueba
-- (set_config('perm.ns', …)), de modo que PERM-1, PERM-2 y PERM-3 puedan correr en la MISMA base sin chocar.
CREATE OR REPLACE FUNCTION public.perm_id(p_n text, p_tipo text)
RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT md5('perm:' || COALESCE(current_setting('perm.ns', true), '') || ':' || p_n || ':' || p_tipo)::uuid $$;

-- Empresa propia con dos proyectos, catálogo contable sembrado por las funciones reales, un proveedor autorizado
-- y un administrador SIN asignaciones (exento de proyecto) que arma los documentos. Corre como superusuario.
CREATE OR REPLACE FUNCTION public.perm_empresa(p_company uuid, p_a uuid, p_b uuid, p_prov uuid, p_admin uuid, p_nombre text)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('request.jwt.claim.sub', '', false);    -- el sembrado es de sistema: sin sesión de nadie
  INSERT INTO public.companies (id, nombre, default_currency) VALUES (p_company, p_nombre, 'gtq');
  INSERT INTO public.projects (id, company_id, nombre) VALUES (p_a, p_company, p_nombre || ' · A'), (p_b, p_company, p_nombre || ' · B');
  PERFORM public.conta_seed_catalogo(p_company, NULL);
  PERFORM public.compras_seed_cuentas(p_company, NULL);
  PERFORM public.conta_seed_catalogo(p_company, p_a);
  PERFORM public.compras_seed_cuentas(p_company, p_a);
  PERFORM public.conta_seed_catalogo(p_company, p_b);
  PERFORM public.compras_seed_cuentas(p_company, p_b);
  INSERT INTO auth.users (id) VALUES (p_admin);
  INSERT INTO public.app_users (id, company_id, full_name, role) VALUES (p_admin, p_company, p_nombre || ' · administrador', 'admin');
  INSERT INTO public.proveedores (id, company_id, nombre, nit, pais, alcance)
  VALUES (p_prov, p_company, 'Proveedor ' || p_nombre, '9' || substr(md5(p_prov::text), 1, 6) || '-1', 'GT', 'empresa');
  PERFORM set_config('request.jwt.claim.sub', p_admin::text, false);
  SET LOCAL ROLE authenticated;
  UPDATE public.proveedores SET estado = 'autorizado' WHERE id = p_prov;
  RESET ROLE;
  PERFORM set_config('request.jwt.claim.sub', '', false);
END;
$$;

-- Una persona: usuario, perfil (operator por omisión) y asignaciones de proyecto. Sin roles todavía. Corre como superusuario.
CREATE OR REPLACE FUNCTION public.perm_persona(p_id uuid, p_company uuid, p_nombre text, p_proyectos uuid[], p_rol text DEFAULT 'operator')
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO auth.users (id) VALUES (p_id);
  INSERT INTO public.app_users (id, company_id, full_name, role) VALUES (p_id, p_company, p_nombre, p_rol);
  INSERT INTO public.user_project_assignments (user_id, project_id, permission_type)
  SELECT p_id, p, 'total' FROM unnest(COALESCE(p_proyectos, ARRAY[]::uuid[])) p;
END;
$$;

-- Un rol de empresa con esas llaves (todas con el mismo efecto), asignado a la persona; opcionalmente vencido o por vencer.
CREATE OR REPLACE FUNCTION public.perm_rol(p_user uuid, p_company uuid, p_nombre text, p_llaves text[], p_efecto text DEFAULT 'allow', p_vence timestamptz DEFAULT NULL)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE
  v_rol uuid := md5('perm:rol:' || p_user::text || ':' || p_nombre)::uuid;
BEGIN
  INSERT INTO public.roles (id, company_id, name) VALUES (v_rol, p_company, p_nombre || ' · ' || left(p_user::text, 8) || right(p_user::text, 4));
  INSERT INTO public.role_permissions (role_id, permission_key, effect) SELECT v_rol, k, p_efecto FROM unnest(p_llaves) k;
  INSERT INTO public.user_roles (user_id, role_id, expires_at) VALUES (p_user, v_rol, p_vence);
END;
$$;

-- Cadena de documentos armada por la SESIÓN ACTUAL (un administrador): orden → recepción → factura → orden de pago,
-- hasta el estado pedido. Un servicio de 1 × 100 sin IVA; la factura y la orden de pago son por 100.
-- p_hasta: oc_borrador | oc_aprobada | oc_emitida | rec_borrador | rec_registrada | fac_registrada | fac_aprobada
--          | op_borrador | op_aprobada | op_pagada
CREATE OR REPLACE FUNCTION public.perm_cadena(p_n text, p_company uuid, p_project uuid, p_prov uuid, p_hasta text)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE
  v_orden text[] := ARRAY['oc_borrador','oc_aprobada','oc_emitida','rec_borrador','rec_registrada','fac_registrada','fac_aprobada','op_borrador','op_aprobada','op_pagada'];
  v_meta  int := array_position(v_orden, p_hasta);
  v_oc    uuid := public.perm_id(p_n, 'oc');
  v_rec   uuid := public.perm_id(p_n, 'rec');
  v_fac   uuid := public.perm_id(p_n, 'fac');
  v_op    uuid := public.perm_id(p_n, 'op');
BEGIN
  IF v_meta IS NULL THEN
    RAISE EXCEPTION 'perm_cadena: estado desconocido «%»', p_hasta;
  END IF;
  INSERT INTO public.ordenes_compra (id, company_id, project_id, proveedor_id, proveedor_nombre, concepto)
  VALUES (v_oc, p_company, p_project, p_prov, 'Proveedor PERM', 'PERM ' || p_n);
  INSERT INTO public.orden_compra_lineas (id, company_id, orden_compra_id, linea, descripcion, destino_tipo, categoria, cantidad, unidad, precio_unitario, iva_monto)
  VALUES (public.perm_id(p_n, 'ocl'), p_company, v_oc, 1, 'Servicio PERM', 'servicio', 'servicios', 1, 'servicio', 100, 0);
  IF v_meta >= 2 THEN UPDATE public.ordenes_compra SET estado = 'aprobada' WHERE id = v_oc; END IF;
  IF v_meta >= 3 THEN UPDATE public.ordenes_compra SET estado = 'emitida'  WHERE id = v_oc; END IF;
  IF v_meta >= 4 THEN
    INSERT INTO public.recepciones (id, company_id, project_id, orden_compra_id, tipo, recibido_por)
    VALUES (v_rec, p_company, p_project, v_oc, 'servicio', auth.uid());
    INSERT INTO public.recepcion_lineas (company_id, recepcion_id, orden_compra_linea_id, cantidad)
    VALUES (p_company, v_rec, public.perm_id(p_n, 'ocl'), 1);
  END IF;
  IF v_meta >= 5 THEN UPDATE public.recepciones SET estado = 'registrada' WHERE id = v_rec; END IF;
  IF v_meta >= 6 THEN
    INSERT INTO public.facturas_proveedor (id, company_id, project_id, proveedor_id, orden_compra_id, numero_factura, concepto, monto_total)
    VALUES (v_fac, p_company, p_project, p_prov, v_oc, 'PF' || upper(p_n), 'Factura PERM', 1);
    INSERT INTO public.factura_proveedor_lineas (company_id, factura_id, orden_compra_linea_id, linea, descripcion, cantidad, precio_unitario, iva_monto)
    VALUES (p_company, v_fac, public.perm_id(p_n, 'ocl'), 1, 'Servicio PERM', 1, 100, 0);
  END IF;
  IF v_meta >= 7 THEN UPDATE public.facturas_proveedor SET estado = 'aprobada' WHERE id = v_fac; END IF;
  IF v_meta >= 8 THEN
    INSERT INTO public.ordenes_pago (id, company_id, project_id, proveedor_id, factura_id, monto)
    VALUES (v_op, p_company, p_project, p_prov, v_fac, 100);
  END IF;
  IF v_meta >= 9 THEN UPDATE public.ordenes_pago SET estado = 'aprobada' WHERE id = v_op; END IF;
  IF v_meta >= 10 THEN UPDATE public.ordenes_pago SET estado = 'pagada', fecha_pago = CURRENT_DATE WHERE id = v_op; END IF;
END;
$$;

-- Cambia de sesión DENTRO de un bloque DO: con p_uid, `authenticated` con ese `sub`; con NULL, el superusuario sin usuario
-- (para leer el resultado sin RLS); con 'servicio', el rol service_role (sin `sub`, como una función de borde).
CREATE OR REPLACE FUNCTION public.perm_como(p_uid uuid, p_servicio boolean DEFAULT false)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('request.jwt.claim.sub', COALESCE(p_uid::text, ''), false);
  IF p_uid IS NOT NULL THEN
    SET LOCAL ROLE authenticated;
  ELSIF p_servicio THEN
    SET LOCAL ROLE service_role;
  ELSE
    RESET ROLE;
  END IF;
END;
$$;

-- Solo fija el `sub` de la sesión (sin cambiar de rol): para llamar directamente a las funciones internas, que `authenticated` no ejecuta.
CREATE OR REPLACE FUNCTION public.perm_sub(p_uid uuid)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('request.jwt.claim.sub', COALESCE(p_uid::text, ''), false);
END;
$$;

-- Ejecuta un SQL y devuelve «SQLSTATE mensaje» de su error (NULL si no falló): para comparar el TEXTO exacto de un rechazo.
CREATE OR REPLACE FUNCTION public.perm_error(p_sql text)
RETURNS text LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE p_sql;
  RETURN NULL;
EXCEPTION WHEN OTHERS THEN
  RETURN SQLSTATE || ' ' || SQLERRM;
END;
$$;

-- Una RPC SECURITY DEFINER de juguete (dueño: el que corre la prueba, sin RLS): hace el UPDATE «con WHERE de fila» que la
-- RLS de la API no dejaría llegar a un documento ajeno. Modela cualquier función definer que mueva un estado.
-- SOLO clúster local; nunca contra sandbox/producción: es una función SECURITY DEFINER ejecutable por `authenticated`.
-- Por si una corrida abortada la dejara puesta, no es un cambiador universal: solo las cinco tablas del circuito, solo estas
-- columnas en `p_extra` y solo documentos de las empresas de estas pruebas (nombre 'PERM-…'). Cada archivo la BORRA al final.
CREATE OR REPLACE FUNCTION public.perm_definer_estado(p_tabla text, p_id uuid, p_estado text, p_extra text DEFAULT '')
RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $$
DECLARE
  n bigint;
BEGIN
  IF p_tabla NOT IN ('ordenes_compra', 'recepciones', 'facturas_proveedor', 'ordenes_pago', 'contrasenas_pago')
     OR p_extra !~ '^(, (fecha_pago = CURRENT_DATE|(project_id|company_id|proveedor_id) = ''[0-9a-f-]{36}''|project_id = NULL))*$' THEN
    RAISE EXCEPTION 'perm_definer_estado: tabla o columnas fuera de la ayuda de prueba';
  END IF;
  EXECUTE format('UPDATE public.%I SET estado = %L%s WHERE id = %L AND company_id IN (SELECT id FROM public.companies WHERE nombre LIKE %L)',
                 p_tabla, p_estado, p_extra, p_id, 'PERM-%');
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END;
$$;
GRANT EXECUTE ON FUNCTION public.perm_definer_estado(text, uuid, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.perm_falla(text, text, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.perm_filas(text, bigint, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.perm_error(text) TO authenticated;

-- Constructor del INSERT directo de una orden de compra (texto SQL), para no repetir columnas.
CREATE OR REPLACE FUNCTION public.perm3_ins_oc(p_id uuid, p_company uuid, p_project uuid, p_prov uuid, p_estado text, p_extra_cols text DEFAULT '', p_extra_vals text DEFAULT '')
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT format('INSERT INTO public.ordenes_compra (id, company_id, project_id, proveedor_id, proveedor_nombre, concepto, estado%s) VALUES (%L, %L, %s, %L, %L, %L, %L%s)',
                p_extra_cols, p_id, p_company, COALESCE(quote_literal(p_project), 'NULL'), p_prov, 'Proveedor PERM', 'PERM-3 ' || p_estado, p_estado, p_extra_vals)
$$;
GRANT EXECUTE ON FUNCTION public.perm3_ins_oc(uuid, uuid, uuid, uuid, text, text, text) TO authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- 0 · PADRÓN. Empresa E (proyectos A y B) y empresa Z. Personas de E, todas «operator» asignadas SOLO a A:
--   ok  ver/crear/editar + SOLO la llave de la orden      · ng  ver/crear/editar + genéricos + las otras cinco, SIN la de la orden
--   ck  ver/crear/editar + change_status genérico         · okc llave de la orden + change_status genérico
--   cr  ver/crear/editar y NADA más (la persona «sin ellas») · gen genéricos (approve + change_status) y SIN ninguna llave nueva
--   kr  recepcion_registrar · kf factura_aprobar · kp las tres de la orden de pago · aa administrador asignado solo a A
-- ═══════════════════════════════════════════════════════════════════════════
DO $padron$
DECLARE
  E  constant uuid := 'fb030000-0000-0000-0000-0000000000e0';
  A  constant uuid := 'fb030000-0000-0000-0000-0000000000a1';
  B  constant uuid := 'fb030000-0000-0000-0000-0000000000b1';
  P  constant uuid := 'fb030000-0000-0000-0000-0000000000c1';
  AD constant uuid := 'fb030000-0000-0000-0000-0000000000ad';
  Z  constant uuid := 'fb030000-0000-0000-0000-0000000000f0';
  Z1 constant uuid := 'fb030000-0000-0000-0000-0000000000f1';
  Z2 constant uuid := 'fb030000-0000-0000-0000-0000000000f2';
  PZ constant uuid := 'fb030000-0000-0000-0000-0000000000f3';
  AZ constant uuid := 'fb030000-0000-0000-0000-0000000000f4';
  v_base text[] := ARRAY['platform.contabilidad.view', 'platform.contabilidad.create', 'platform.contabilidad.edit'];
  v_gen  text[] := ARRAY['platform.contabilidad.approve', 'platform.contabilidad.change_status'];
  v_oc   constant text := 'condominios.tab.ordenes_compra.approve';
  v_rec  constant text := 'platform.contabilidad.compras.recepcion_registrar';
  v_fac  constant text := 'platform.contabilidad.compras.factura_aprobar';
  v_opa  constant text := 'platform.contabilidad.compras.orden_pago_aprobar';
  v_opp  constant text := 'platform.contabilidad.compras.pago_ejecutar';
  v_opn  constant text := 'platform.contabilidad.compras.pago_anular';
BEGIN
  PERFORM public.perm_empresa(E, A, B, P, AD, 'PERM-3 Empresa E');
  PERFORM public.perm_empresa(Z, Z1, Z2, PZ, AZ, 'PERM-3 Empresa Z');
  PERFORM public.perm_persona(public.perm_id('ok', 'u'),  E, 'PERM-3 llave de la orden', ARRAY[A]);  PERFORM public.perm_rol(public.perm_id('ok', 'u'),  E, 'r', v_base || v_oc);
  PERFORM public.perm_persona(public.perm_id('ng', 'u'),  E, 'PERM-3 sin la de la orden', ARRAY[A]); PERFORM public.perm_rol(public.perm_id('ng', 'u'),  E, 'r', v_base || v_gen || ARRAY[v_rec, v_fac, v_opa, v_opp, v_opn]);
  PERFORM public.perm_persona(public.perm_id('ck', 'u'),  E, 'PERM-3 change_status', ARRAY[A]);      PERFORM public.perm_rol(public.perm_id('ck', 'u'),  E, 'r', v_base || ARRAY['platform.contabilidad.change_status']);
  PERFORM public.perm_persona(public.perm_id('okc', 'u'), E, 'PERM-3 orden + change_status', ARRAY[A]); PERFORM public.perm_rol(public.perm_id('okc', 'u'), E, 'r', v_base || ARRAY[v_oc, 'platform.contabilidad.change_status']);
  PERFORM public.perm_persona(public.perm_id('cr', 'u'),  E, 'PERM-3 solo crear y editar', ARRAY[A]); PERFORM public.perm_rol(public.perm_id('cr', 'u'),  E, 'r', v_base);
  PERFORM public.perm_persona(public.perm_id('gen', 'u'), E, 'PERM-3 genéricos sin llaves nuevas', ARRAY[A]); PERFORM public.perm_rol(public.perm_id('gen', 'u'), E, 'r', v_base || v_gen);
  PERFORM public.perm_persona(public.perm_id('kr', 'u'),  E, 'PERM-3 registrar recepción', ARRAY[A]); PERFORM public.perm_rol(public.perm_id('kr', 'u'),  E, 'r', v_base || v_rec);
  PERFORM public.perm_persona(public.perm_id('kf', 'u'),  E, 'PERM-3 aprobar factura', ARRAY[A]);     PERFORM public.perm_rol(public.perm_id('kf', 'u'),  E, 'r', v_base || v_fac);
  PERFORM public.perm_persona(public.perm_id('kp', 'u'),  E, 'PERM-3 las tres del pago', ARRAY[A]);   PERFORM public.perm_rol(public.perm_id('kp', 'u'),  E, 'r', v_base || ARRAY[v_opa, v_opp, v_opn]);
  PERFORM public.perm_persona(public.perm_id('aa', 'u'),  E, 'PERM-3 admin asignado a A', ARRAY[A], 'admin');
  PERFORM public.perm_persona(public.perm_id('zk', 'u'),  Z, 'PERM-3 operador de Z con todo', ARRAY[Z1]);
  PERFORM public.perm_rol(public.perm_id('zk', 'u'), Z, 'r', v_base || v_gen || ARRAY[v_oc, v_rec, v_fac, v_opa, v_opp, v_opn]);
END;
$padron$;

-- ═══════════════════════════════════════════════════════════════════════════
-- 1 · INSERT DIRECTO DE LA ORDEN DE COMPRA ya aprobada / emitida
-- ═══════════════════════════════════════════════════════════════════════════
DO $oc_insert$
DECLARE
  E  constant uuid := 'fb030000-0000-0000-0000-0000000000e0';
  A  constant uuid := 'fb030000-0000-0000-0000-0000000000a1';
  B  constant uuid := 'fb030000-0000-0000-0000-0000000000b1';
  P  constant uuid := 'fb030000-0000-0000-0000-0000000000c1';
  AD constant uuid := 'fb030000-0000-0000-0000-0000000000ad';
  Z  constant uuid := 'fb030000-0000-0000-0000-0000000000f0';
  ok  constant uuid := public.perm_id('ok', 'u');  ng  constant uuid := public.perm_id('ng', 'u');
  ck  constant uuid := public.perm_id('ck', 'u');  okc constant uuid := public.perm_id('okc', 'u');
  cr  constant uuid := public.perm_id('cr', 'u');  aa  constant uuid := public.perm_id('aa', 'u');
  zk  constant uuid := public.perm_id('zk', 'u');
  v_lbl_oc constant text := 'Autorizar / Denegar — Órdenes compra';
  v_id uuid; v_n text;
BEGIN
  -- ya APROBADA ─────────────────────────────────────────────────────────────
  PERFORM public.perm_como(ok);
  v_id := public.perm_id('i1', 'oc');
  PERFORM public.perm_filas(public.perm3_ins_oc(v_id, E, A, P, 'aprobada', ', created_by, aprobada_por, aprobada_at', format(', %L, %L, now() - interval ''30 days''', ng, ng)), 1,
    '[INSERT oc aprobada] quien tiene SOLO la llave de la orden y el proyecto A nace una orden ya «aprobada» (con firmas falsas en el cuerpo)');
  PERFORM public.perm_como(NULL);
  PERFORM public.chk_uuid((SELECT aprobada_por FROM public.ordenes_compra WHERE id = v_id), ok, '[INSERT oc aprobada] el aprobador lo sella el servidor (el cuerpo decía otra persona)');
  PERFORM public.chk_uuid((SELECT created_by FROM public.ordenes_compra WHERE id = v_id), ok, '[INSERT oc aprobada] y el solicitante también');
  PERFORM public.chk_bool((SELECT aprobada_at > now() - interval '1 hour' FROM public.ordenes_compra WHERE id = v_id), true, '[INSERT oc aprobada] y la hora es la del servidor, no la falsificada');
  PERFORM public.chk_bool((SELECT numero IS NOT NULL FROM public.ordenes_compra WHERE id = v_id), true, '[INSERT oc aprobada] y queda numerada');

  v_id := public.perm_id('i2', 'oc');
  PERFORM public.perm_como(ng);
  PERFORM public.perm_falla(public.perm3_ins_oc(v_id, E, A, P, 'aprobada'), '42501', 'COMPRAS_PERMISO_ACCION: para crear una orden de compra ya aprobada tu perfil necesita el permiso «' || v_lbl_oc || '»',
    '[INSERT oc aprobada] con approve genérico y las otras cinco llaves, pero SIN la de la orden: rechazado (42501)');
  PERFORM public.perm_como(cr);
  PERFORM public.perm_falla(public.perm3_ins_oc(v_id, E, A, P, 'aprobada'), '42501', 'COMPRAS_PERMISO_ACCION: .*«' || v_lbl_oc || '»',
    '[INSERT oc aprobada] quien solo crea y edita (la persona «sin ellas»): rechazado');
  PERFORM public.perm_como(ok);
  v_id := public.perm_id('i3', 'oc');
  PERFORM public.perm_falla(public.perm3_ins_oc(v_id, E, B, P, 'aprobada'), '42501', '^COMPRAS_ALCANCE_PROYECTO: para crear una orden de compra ya aprobada tu perfil necesita estar asignado al proyecto del documento',
    '[INSERT oc aprobada] con la llave pero SIN el proyecto B asignado: COMPRAS_ALCANCE_PROYECTO (el INSERT directo no lo detenía la RLS)');
  PERFORM public.perm_como(aa);
  PERFORM public.perm_falla(public.perm3_ins_oc(v_id, E, B, P, 'aprobada'), '42501', '^COMPRAS_ALCANCE_PROYECTO',
    '[INSERT oc aprobada] el administrador con asignaciones solo en A tampoco nace una orden aprobada en B');
  PERFORM public.perm_como(ok);
  v_id := public.perm_id('i4', 'oc');
  PERFORM public.perm_filas(public.perm3_ins_oc(v_id, E, NULL, P, 'aprobada'), 1, '[INSERT oc aprobada] una orden SIN proyecto es de la empresa: con la llave nace aprobada');
  -- otra empresa: el mismo error de la RLS, no el de permisos
  PERFORM public.perm_falla(public.perm3_ins_oc(public.perm_id('i5', 'oc'), Z, NULL, P, 'aprobada'), '42501', 'row-level security',
    '[INSERT oc aprobada] con la empresa de OTRO en el cuerpo: el mismo error de la RLS (new row violates row-level security policy)');
  PERFORM public.perm_como(zk);
  PERFORM public.perm_falla(public.perm3_ins_oc(public.perm_id('i5', 'oc'), E, A, P, 'aprobada'), '42501', 'row-level security',
    '[INSERT oc aprobada] persona de Z con todas las llaves escribiendo en E: error de la RLS');
  PERFORM public.perm_como(AD);
  PERFORM public.perm_filas(public.perm3_ins_oc(public.perm_id('i6', 'oc'), E, B, P, 'aprobada'), 1, '[INSERT oc aprobada] el administrador sin asignaciones sigue pudiendo (en B también)');

  -- ya EMITIDA: la llave de la orden Y change_status ────────────────────────
  PERFORM public.perm_como(ok);
  PERFORM public.perm_falla(public.perm3_ins_oc(public.perm_id('i7', 'oc'), E, A, P, 'emitida'), '42501',
    'COMPRAS_PERMISO_ACCION: para crear una orden de compra ya emitida tu perfil necesita el permiso «Cambiar estado — Contabilidad»',
    '[INSERT oc emitida] con la llave de la orden pero SIN change_status: rechazado por el segundo permiso');
  PERFORM public.perm_como(ck);
  PERFORM public.perm_falla(public.perm3_ins_oc(public.perm_id('i7', 'oc'), E, A, P, 'emitida'), '42501', 'COMPRAS_PERMISO_ACCION: .*«' || v_lbl_oc || '»',
    '[INSERT oc emitida] con change_status pero SIN la llave de la orden: rechazado por el primero');
  PERFORM public.perm_como(okc);
  PERFORM public.perm_filas(public.perm3_ins_oc(public.perm_id('i8', 'oc'), E, A, P, 'emitida'), 1, '[INSERT oc emitida] con la llave de la orden Y change_status nace emitida');
  PERFORM public.perm_como(NULL);
  PERFORM public.chk_txt((SELECT estado FROM public.ordenes_compra WHERE id = public.perm_id('i8', 'oc')), 'emitida', '[INSERT oc emitida] y quedó emitida');
  PERFORM public.chk_uuid((SELECT aprobada_por FROM public.ordenes_compra WHERE id = public.perm_id('i8', 'oc')), okc, '[INSERT oc emitida] con el aprobador sellado por el servidor');

  -- ningún otro estado nace, ni para el administrador ──────────────────────
  PERFORM public.perm_como(AD);
  PERFORM public.perm_falla(public.perm3_ins_oc(public.perm_id('i9', 'oc'), E, A, P, 'recibida'), '23514', '^COMPRAS_ESTADO_INICIAL', '[INSERT oc recibida] no nace «recibida» (ni el administrador)');
  PERFORM public.perm_falla(public.perm3_ins_oc(public.perm_id('i9', 'oc'), E, A, P, 'cerrada'),  '23514', '^COMPRAS_ESTADO_INICIAL', '[INSERT oc cerrada] no nace «cerrada»');
  PERFORM public.perm_falla(public.perm3_ins_oc(public.perm_id('i9', 'oc'), E, A, P, 'cancelada'), '23514', '^COMPRAS_ESTADO_INICIAL', '[INSERT oc cancelada] no nace «cancelada»');
  PERFORM public.perm_como(NULL);
  SELECT count(*)::text INTO v_n FROM public.ordenes_compra WHERE id IN (public.perm_id('i2', 'oc'), public.perm_id('i3', 'oc'), public.perm_id('i5', 'oc'), public.perm_id('i7', 'oc'), public.perm_id('i9', 'oc'));
  PERFORM public.chk_txt(v_n, '0', '[INSERT oc] los INSERT rechazados no dejaron ninguna orden');
END;
$oc_insert$;

-- ═══════════════════════════════════════════════════════════════════════════
-- 2 · INSERT DIRECTO de factura, recepción y orden de pago en un estado que solo debe dejar el sistema o una decisión posterior:
--     la llave de la acción NO permite nacer ya aprobada / registrada / pagada (se saltaría cuadre, existencias y asiento)
-- ═══════════════════════════════════════════════════════════════════════════
DO $nacer$
DECLARE
  E  constant uuid := 'fb030000-0000-0000-0000-0000000000e0';
  A  constant uuid := 'fb030000-0000-0000-0000-0000000000a1';
  P  constant uuid := 'fb030000-0000-0000-0000-0000000000c1';
  AD constant uuid := 'fb030000-0000-0000-0000-0000000000ad';
  kr constant uuid := public.perm_id('kr', 'u'); kf constant uuid := public.perm_id('kf', 'u'); kp constant uuid := public.perm_id('kp', 'u');
  v_n text;
BEGIN
  PERFORM public.perm_como(AD);
  PERFORM public.perm_cadena('n1', E, A, P, 'op_borrador');   -- trae la orden, la recepción registrada y la factura aprobada
  PERFORM public.perm_como(kf);
  PERFORM public.perm_falla(format('INSERT INTO public.facturas_proveedor (company_id, project_id, proveedor_id, numero_factura, concepto, monto_total, estado) VALUES (%L, %L, %L, %L, %L, 500, %L)', E, A, P, 'PERM3-FA1', 'x', 'aprobada'),
    '23514', '^COMPRAS_ESTADO_INICIAL', '[INSERT factura] aun con la llave de aprobar facturas no nace «aprobada»: se saltaría el cuadre y el devengo');
  PERFORM public.perm_falla(format('INSERT INTO public.facturas_proveedor (company_id, project_id, proveedor_id, numero_factura, concepto, monto_total, monto_pagado) VALUES (%L, %L, %L, %L, %L, 500, 500)', E, A, P, 'PERM3-FA2', 'x'),
    '23514', '^COMPRAS_ESTADO_INICIAL', '[INSERT factura] ni con pagos puestos a mano');
  PERFORM public.perm_como(AD);
  PERFORM public.perm_falla(format('INSERT INTO public.facturas_proveedor (company_id, project_id, proveedor_id, numero_factura, concepto, monto_total, estado) VALUES (%L, %L, %L, %L, %L, 500, %L)', E, A, P, 'PERM3-FA3', 'x', 'aprobada'),
    '23514', '^COMPRAS_ESTADO_INICIAL', '[INSERT factura] ni el administrador');
  PERFORM public.perm_como(kr);
  PERFORM public.perm_falla(format('INSERT INTO public.recepciones (company_id, project_id, orden_compra_id, tipo, estado) VALUES (%L, %L, %L, %L, %L)', E, A, public.perm_id('n1', 'oc'), 'servicio', 'registrada'),
    '23514', '^COMPRAS_ESTADO_INICIAL', '[INSERT recepción] aun con la llave de registrar recepciones no nace «registrada»: se saltaría existencias y asiento');
  PERFORM public.perm_como(AD);
  PERFORM public.perm_falla(format('INSERT INTO public.recepciones (company_id, project_id, orden_compra_id, tipo, estado) VALUES (%L, %L, %L, %L, %L)', E, A, public.perm_id('n1', 'oc'), 'servicio', 'registrada'),
    '23514', '^COMPRAS_ESTADO_INICIAL', '[INSERT recepción] ni el administrador');
  PERFORM public.perm_como(kp);
  PERFORM public.perm_falla(format('INSERT INTO public.ordenes_pago (company_id, project_id, proveedor_id, factura_id, monto, estado) VALUES (%L, %L, %L, %L, 100, %L)', E, A, P, public.perm_id('n1', 'fac'), 'aprobada'),
    '23514', '^COMPRAS_PAGO_ESTADO_INICIAL', '[INSERT orden de pago] aun con las tres llaves del pago no nace «aprobada»');
  PERFORM public.perm_falla(format('INSERT INTO public.ordenes_pago (company_id, project_id, proveedor_id, factura_id, monto, estado) VALUES (%L, %L, %L, %L, 100, %L)', E, A, P, public.perm_id('n1', 'fac'), 'pagada'),
    '23514', '^COMPRAS_PAGO_ESTADO_INICIAL', '[INSERT orden de pago] ni «pagada»');
  PERFORM public.perm_como(AD);
  PERFORM public.perm_falla(format('INSERT INTO public.ordenes_pago (company_id, project_id, proveedor_id, factura_id, monto, estado) VALUES (%L, %L, %L, %L, 100, %L)', E, A, P, public.perm_id('n1', 'fac'), 'pagada'),
    '23514', '^COMPRAS_PAGO_ESTADO_INICIAL', '[INSERT orden de pago] ni el administrador');
  PERFORM public.perm_como(NULL);
  SELECT (SELECT count(*) FROM public.facturas_proveedor WHERE numero_factura LIKE 'PERM3-FA%')::text INTO v_n;
  PERFORM public.chk_txt(v_n, '0', '[INSERT] los rechazados no dejaron factura alguna');
END;
$nacer$;

-- ═══════════════════════════════════════════════════════════════════════════
-- 3 · UPSERT (INSERT … ON CONFLICT): dispara el trigger de INSERT con la fila propuesta y el de UPDATE con el DO UPDATE
-- ═══════════════════════════════════════════════════════════════════════════
DO $upsert$
DECLARE
  E  constant uuid := 'fb030000-0000-0000-0000-0000000000e0';
  A  constant uuid := 'fb030000-0000-0000-0000-0000000000a1';
  P  constant uuid := 'fb030000-0000-0000-0000-0000000000c1';
  AD constant uuid := 'fb030000-0000-0000-0000-0000000000ad';
  ok  constant uuid := public.perm_id('ok', 'u');  ng  constant uuid := public.perm_id('ng', 'u');
  gen constant uuid := public.perm_id('gen', 'u');
  kr  constant uuid := public.perm_id('kr', 'u');  kf  constant uuid := public.perm_id('kf', 'u'); kp constant uuid := public.perm_id('kp', 'u');
  v_up text;
BEGIN
  PERFORM public.perm_como(AD);
  PERFORM public.perm_cadena('u1', E, A, P, 'oc_borrador');
  PERFORM public.perm_cadena('u2', E, A, P, 'oc_borrador');
  PERFORM public.perm_cadena('u3', E, A, P, 'rec_borrador');
  PERFORM public.perm_cadena('u4', E, A, P, 'fac_registrada');
  PERFORM public.perm_cadena('u5', E, A, P, 'op_borrador');
  -- orden de compra
  PERFORM public.perm_como(ng);
  PERFORM public.perm_falla(public.perm3_ins_oc(public.perm_id('u1', 'oc'), E, A, P, 'borrador') || ' ON CONFLICT (id) DO UPDATE SET estado = ''aprobada''', '42501',
    'COMPRAS_PERMISO_ACCION: para aprobar una orden de compra .*«Autorizar / Denegar — Órdenes compra»', '[UPSERT oc] DO UPDATE SET estado = aprobada sin la llave de la orden: rechazado (corre el trigger de UPDATE)');
  PERFORM public.perm_falla(public.perm3_ins_oc(public.perm_id('u1', 'oc'), E, A, P, 'aprobada') || ' ON CONFLICT (id) DO NOTHING', '42501',
    'COMPRAS_PERMISO_ACCION: para crear una orden de compra ya aprobada', '[UPSERT oc] ON CONFLICT DO NOTHING con un estado propuesto «aprobada» sin la llave: rechazado (el trigger de INSERT corre antes del conflicto)');
  PERFORM public.perm_como(ok);
  PERFORM public.perm_filas(public.perm3_ins_oc(public.perm_id('u1', 'oc'), E, A, P, 'borrador') || ' ON CONFLICT (id) DO UPDATE SET estado = ''aprobada''', 1,
    '[UPSERT oc] con la llave de la orden el DO UPDATE aprueba (1 fila)');
  PERFORM public.perm_como(NULL);
  PERFORM public.chk_txt((SELECT estado FROM public.ordenes_compra WHERE id = public.perm_id('u1', 'oc')), 'aprobada', '[UPSERT oc] y quedó aprobada');
  PERFORM public.chk_uuid((SELECT aprobada_por FROM public.ordenes_compra WHERE id = public.perm_id('u1', 'oc')), ok, '[UPSERT oc] con el aprobador sellado');
  PERFORM public.perm_como(ok);
  PERFORM public.perm_filas(public.perm3_ins_oc(public.perm_id('u2', 'oc'), E, A, P, 'borrador') || ' ON CONFLICT (id) DO NOTHING', 0,
    '[UPSERT oc] ON CONFLICT DO NOTHING con la fila ya existente: CERO filas, sin error y sin cambiar nada');
  PERFORM public.perm_como(NULL);
  PERFORM public.chk_txt((SELECT estado FROM public.ordenes_compra WHERE id = public.perm_id('u2', 'oc')), 'borrador', '[UPSERT oc] y la orden existente sigue en borrador');
  -- recepción
  v_up := format('INSERT INTO public.recepciones (id, company_id, project_id, orden_compra_id, tipo) VALUES (%L, %L, %L, %L, %L) ON CONFLICT (id) DO UPDATE SET estado = %L',
                 public.perm_id('u3', 'rec'), E, A, public.perm_id('u3', 'oc'), 'servicio', 'registrada');
  PERFORM public.perm_como(gen);
  PERFORM public.perm_falla(v_up, '42501', 'COMPRAS_PERMISO_ACCION: .*«Compras y pagos — Registrar una recepción»', '[UPSERT recepción] con los genéricos pero sin la llave: rechazado');
  PERFORM public.perm_como(kr);
  PERFORM public.perm_filas(v_up, 1, '[UPSERT recepción] con la llave de registrar recepciones: pasa (1 fila)');
  -- factura
  v_up := format('INSERT INTO public.facturas_proveedor (id, company_id, project_id, proveedor_id, orden_compra_id, numero_factura, concepto, monto_total) VALUES (%L, %L, %L, %L, %L, %L, %L, 100) ON CONFLICT (id) DO UPDATE SET estado = %L',
                 public.perm_id('u4', 'fac'), E, A, P, public.perm_id('u4', 'oc'), 'PFU4', 'x', 'aprobada');
  PERFORM public.perm_como(gen);
  PERFORM public.perm_falla(v_up, '42501', 'COMPRAS_PERMISO_ACCION: .*«Compras y pagos — Aprobar una factura de proveedor»', '[UPSERT factura] con los genéricos pero sin la llave: rechazado');
  PERFORM public.perm_como(kf);
  PERFORM public.perm_filas(v_up, 1, '[UPSERT factura] con la llave de aprobar facturas: pasa (1 fila)');
  -- orden de pago
  v_up := format('INSERT INTO public.ordenes_pago (id, company_id, project_id, proveedor_id, factura_id, monto) VALUES (%L, %L, %L, %L, %L, 100) ON CONFLICT (id) DO UPDATE SET estado = %L',
                 public.perm_id('u5', 'op'), E, A, P, public.perm_id('u5', 'fac'), 'aprobada');
  PERFORM public.perm_como(gen);
  PERFORM public.perm_falla(v_up, '42501', 'COMPRAS_PERMISO_ACCION: .*«Compras y pagos — Aprobar una orden de pago»', '[UPSERT orden de pago] con los genéricos pero sin la llave: rechazado');
  PERFORM public.perm_como(kp);
  PERFORM public.perm_filas(v_up, 1, '[UPSERT orden de pago] con la llave de aprobar órdenes de pago: pasa (1 fila)');
  PERFORM public.perm_como(NULL);
  PERFORM public.chk_txt((SELECT estado FROM public.recepciones WHERE id = public.perm_id('u3', 'rec')) || '/' || (SELECT estado FROM public.facturas_proveedor WHERE id = public.perm_id('u4', 'fac'))
                         || '/' || (SELECT estado FROM public.ordenes_pago WHERE id = public.perm_id('u5', 'op')), 'registrada/aprobada/aprobada', '[UPSERT] los tres UPSERT autorizados dejaron registrada / aprobada / aprobada');
END;
$upsert$;

-- ═══════════════════════════════════════════════════════════════════════════
-- 4 · CERO FILAS: un UPDATE amparado por la RLS que no afecta ninguna fila NO es un error ni un éxito. Se comprueba con
--     GET DIAGNOSTICS ROW_COUNT (la pantalla debe tratarlo como «no se hizo nada»), y que la fila no cambió NI UN BYTE.
--     Causas: documento de otro proyecto · de otra empresa · inexistente · que ya salió del estado de origen (doble clic).
-- ═══════════════════════════════════════════════════════════════════════════
DO $cero$
DECLARE
  E  constant uuid := 'fb030000-0000-0000-0000-0000000000e0';
  A  constant uuid := 'fb030000-0000-0000-0000-0000000000a1';
  B  constant uuid := 'fb030000-0000-0000-0000-0000000000b1';
  P  constant uuid := 'fb030000-0000-0000-0000-0000000000c1';
  AD constant uuid := 'fb030000-0000-0000-0000-0000000000ad';
  Z  constant uuid := 'fb030000-0000-0000-0000-0000000000f0';
  Z1 constant uuid := 'fb030000-0000-0000-0000-0000000000f1';
  PZ constant uuid := 'fb030000-0000-0000-0000-0000000000f3';
  AZ constant uuid := 'fb030000-0000-0000-0000-0000000000f4';
  ac record;
  v_quien uuid; v_set text; v_id uuid; v_n bigint; v_antes text; v_despues text; v_ret uuid;
BEGIN
  FOR ac IN
    SELECT * FROM (VALUES
      (1, 'aprobar_orden_compra', 'ordenes_compra',     'oc',  'aprobada',   '',                            'oc_borrador',    'borrador',   'ok'),
      (2, 'registrar_recepcion',  'recepciones',        'rec', 'registrada', '',                            'rec_borrador',   'borrador',   'kr'),
      (3, 'aprobar_factura',      'facturas_proveedor', 'fac', 'aprobada',   '',                            'fac_registrada', 'registrada', 'kf'),
      (4, 'aprobar_orden_pago',   'ordenes_pago',       'op',  'aprobada',   '',                            'op_borrador',    'borrador',   'kp'),
      (5, 'ejecutar_pago',        'ordenes_pago',       'op',  'pagada',     ', fecha_pago = CURRENT_DATE', 'op_aprobada',    'aprobada',   'kp'),
      (6, 'anular_pago',          'ordenes_pago',       'op',  'anulada',    '',                            'op_aprobada',    'aprobada',   'kp')
    ) AS v(i, nombre, tabla, tipo, dest, extra, src, estado0, persona)
    WHERE COALESCE(NULLIF(current_setting('perm.solo', true), ''), v.i::text) = v.i::text   -- (opcional) PGOPTIONS='-c perm.solo=3'
    ORDER BY i
  LOOP
    v_quien := public.perm_id(ac.persona, 'u');
    v_set := format('SET estado = %L%s', ac.dest, ac.extra);
    -- documentos: b en el proyecto B · d en A y YA movido al destino por el administrador · p en A, vivo · z en la empresa Z
    PERFORM public.perm_como(AD);
    PERFORM public.perm_cadena('c' || ac.i || 'b', E, B, P, ac.src);
    PERFORM public.perm_cadena('c' || ac.i || 'd', E, A, P, ac.src);
    PERFORM public.perm_cadena('c' || ac.i || 'p', E, A, P, ac.src);
    EXECUTE format('UPDATE public.%I %s WHERE id = %L', ac.tabla, v_set, public.perm_id('c' || ac.i || 'd', ac.tipo));
    PERFORM public.perm_como(AZ);
    PERFORM public.perm_cadena('c' || ac.i || 'z', Z, Z1, PZ, ac.src);
    PERFORM public.perm_como(NULL);

    -- (1) otro proyecto, (2) otra empresa, (3) inexistente, (4) ya salió del estado de origen
    FOR v_id, v_despues IN
      SELECT public.perm_id('c' || ac.i || 'b', ac.tipo), 'de OTRO proyecto (B): la política SELECT lo esconde'
      UNION ALL SELECT public.perm_id('c' || ac.i || 'z', ac.tipo), 'de OTRA empresa'
      UNION ALL SELECT public.perm_id('c' || ac.i || 'nunca', ac.tipo), 'inexistente'
    LOOP
      PERFORM public.perm_como(NULL);
      EXECUTE format('SELECT md5(t::text) FROM public.%I t WHERE id = %L', ac.tabla, v_id) INTO v_antes;
      PERFORM public.perm_como(v_quien);
      EXECUTE format('UPDATE public.%I %s WHERE id = %L', ac.tabla, v_set, v_id);
      GET DIAGNOSTICS v_n = ROW_COUNT;
      PERFORM public.chk(v_n, 0, format('[%s] CERO FILAS: UPDATE por id de un documento %s → ROW_COUNT = 0 (sin error)', ac.nombre, v_despues));
      PERFORM public.perm_como(NULL);
      EXECUTE format('SELECT md5(t::text) FROM public.%I t WHERE id = %L', ac.tabla, v_id) INTO v_despues;
      PERFORM public.chk_bool(v_antes IS NOT DISTINCT FROM v_despues, true, format('[%s] y la fila quedó byte a byte igual (nada cambió)', ac.nombre));
    END LOOP;

    -- RETURNING sin filas no devuelve nada
    PERFORM public.perm_como(v_quien);
    EXECUTE format('UPDATE public.%I %s WHERE id = %L RETURNING id', ac.tabla, v_set, public.perm_id('c' || ac.i || 'b', ac.tipo)) INTO v_ret;
    PERFORM public.chk_bool(v_ret IS NULL, true, format('[%s] UPDATE … RETURNING id sobre una fila que no ve: no devuelve nada', ac.nombre));

    -- carrera perdida / doble clic: el documento 'd' ya salió del origen
    PERFORM public.perm_como(NULL);
    EXECUTE format('SELECT md5(t::text) FROM public.%I t WHERE id = %L', ac.tabla, public.perm_id('c' || ac.i || 'd', ac.tipo)) INTO v_antes;
    PERFORM public.perm_como(v_quien);
    EXECUTE format('UPDATE public.%I %s WHERE id = %L AND estado = %L', ac.tabla, v_set, public.perm_id('c' || ac.i || 'd', ac.tipo), ac.estado0);
    GET DIAGNOSTICS v_n = ROW_COUNT;
    PERFORM public.chk(v_n, 0, format('[%s] CERO FILAS: el documento ya salió de «%s» (otro lo movió antes): UPDATE … AND estado = origen → ROW_COUNT = 0', ac.nombre, ac.estado0));
    PERFORM public.perm_como(NULL);
    EXECUTE format('SELECT md5(t::text) FROM public.%I t WHERE id = %L', ac.tabla, public.perm_id('c' || ac.i || 'd', ac.tipo)) INTO v_despues;
    PERFORM public.chk_bool(v_antes IS NOT DISTINCT FROM v_despues, true, format('[%s] y no se volvió a ejecutar nada (misma fila, mismos sellos)', ac.nombre));

    -- el éxito real afecta UNA fila; repetirlo (reintento) afecta CERO
    PERFORM public.perm_como(v_quien);
    EXECUTE format('UPDATE public.%I %s WHERE id = %L AND estado = %L', ac.tabla, v_set, public.perm_id('c' || ac.i || 'p', ac.tipo), ac.estado0);
    GET DIAGNOSTICS v_n = ROW_COUNT;
    PERFORM public.chk(v_n, 1, format('[%s] la operación real afecta 1 fila', ac.nombre));
    EXECUTE format('UPDATE public.%I %s WHERE id = %L AND estado = %L', ac.tabla, v_set, public.perm_id('c' || ac.i || 'p', ac.tipo), ac.estado0);
    GET DIAGNOSTICS v_n = ROW_COUNT;
    PERFORM public.chk(v_n, 0, format('[%s] y el mismo UPDATE repetido (reintento, doble clic) afecta 0: idempotente, no repite el efecto', ac.nombre));
    PERFORM public.perm_como(NULL);
    EXECUTE format('SELECT estado FROM public.%I WHERE id = %L', ac.tabla, public.perm_id('c' || ac.i || 'p', ac.tipo)) INTO v_despues;
    PERFORM public.chk_txt(v_despues, ac.dest, format('[%s] y el documento está «%s» una sola vez', ac.nombre, ac.dest));
  END LOOP;
END;
$cero$;

-- ═══════════════════════════════════════════════════════════════════════════
-- LIMPIEZA · las ayudas de esta prueba no se quedan en la base. Sobre todo `perm_definer_estado`, que es SECURITY DEFINER y
-- ejecutable por `authenticated`: tras la prueba no puede quedar ninguna función perm_* (los datos PERM-… sí quedan: los
-- documentos de compras no se pueden borrar).
-- ═══════════════════════════════════════════════════════════════════════════
DROP FUNCTION IF EXISTS public.perm_definer_estado(text, uuid, text, text);
DROP FUNCTION IF EXISTS public.perm_error(text);
DROP FUNCTION IF EXISTS public.perm_falla(text, text, text, text);
DROP FUNCTION IF EXISTS public.perm_filas(text, bigint, text);
DROP FUNCTION IF EXISTS public.perm_pasa(text, text);
DROP FUNCTION IF EXISTS public.perm_empresa(uuid, uuid, uuid, uuid, uuid, text);
DROP FUNCTION IF EXISTS public.perm_persona(uuid, uuid, text, uuid[], text);
DROP FUNCTION IF EXISTS public.perm_rol(uuid, uuid, text, text[], text, timestamptz);
DROP FUNCTION IF EXISTS public.perm_cadena(text, uuid, uuid, uuid, text);
DROP FUNCTION IF EXISTS public.perm_como(uuid, boolean);
DROP FUNCTION IF EXISTS public.perm_sub(uuid);
DROP FUNCTION IF EXISTS public.perm_id(text, text);
DROP FUNCTION IF EXISTS public.perm3_ins_oc(uuid, uuid, uuid, uuid, text, text, text);
SELECT public.chk((SELECT count(*) FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.prosecdef
                      AND p.proname LIKE 'perm\_%' AND has_function_privilege('authenticated', p.oid, 'EXECUTE')), 0,
  '[limpieza] tras la prueba no queda ninguna función perm_* SECURITY DEFINER ejecutable por authenticated');
SELECT public.chk((SELECT count(*) FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname ~ '^perm[0-9]*_'), 0,
  '[limpieza] ni ninguna otra ayuda perm_* / permN_*');
