\set ON_ERROR_STOP on
-- ============================================================================
-- PERM-1 · Cada una de las SEIS decisiones del circuito de compras y pagos exige su PROPIO permiso,
--          en el servidor (escritura directa como `authenticated`), no los genéricos approve / change_status.
--
-- CAUSA RAÍZ
--   Hasta 20261027000800 las seis decisiones —aprobar la orden de compra, registrar la recepción, aprobar la
--   factura de proveedor, aprobar la orden de pago, ejecutar el pago y anular el pago— colgaban de DOS permisos
--   genéricos de Contabilidad (`approve` y `change_status`). Quien tenía uno recibía todas las de su grupo.
--
-- COMPORTAMIENTO ESPERADO (20261027000900, piezas/permisos)
--   Para CADA acción, por separado:
--     · una persona con SOLO esa llave (más ver/crear/editar, que exige la RLS) la ejerce y el servidor sella
--       lo que corresponde (aprobador, hora, existencias, asiento…);
--     · una persona con las OTRAS cinco llaves y con `approve` y `change_status` genéricos, pero SIN esa,
--       es rechazada con COMPRAS_PERMISO_ACCION (SQLSTATE 42501) que nombra la llave de la acción;
--     · el efecto «denegar» de un rol sobre la llave la quita aunque otro rol la conceda;
--       un rol VENCIDO (user_roles.expires_at pasado) no la concede y uno vigente sí;
--     · de OTRA empresa: el UPDATE por id afecta 0 filas (la RLS no lo deja ver) y la función SECURITY DEFINER
--       que lo alcanza se rechaza con COMPRAS_ALCANCE_EMPRESA;
--     · el propietario, el superadministrador y el administrador (con o sin asignaciones, en SUS proyectos)
--       siguen pasando; el administrador con asignaciones NO actúa en un proyecto que no tiene asignado;
--     · la sesión sin usuario (service_role) no cambia.
--   Y lo que NO cambió sigue con `change_status`: emitir/cancelar la orden, anular recepción y factura.
--
-- Ids propios: md5('perm:…') (perm_id) y fb010000-0000-0000-0000-0000000000XX. Crea sus propias empresas, proyectos, personas y
-- documentos (no toca compras_config ni datos de otras suites).
--
-- ⚠ SOLO clúster local; nunca contra sandbox/producción. Crea funciones auxiliares perm_* (una es SECURITY DEFINER y
--   ejecutable por `authenticated`, para modelar una RPC) y empresas de prueba que NO se pueden borrar (los documentos de
--   compras no se borran). Las ayudas se borran al final (DROP FUNCTION IF EXISTS) y una comprobación final exige que no quede
--   ninguna; los datos 'PERM-…' sí quedan en la base. Lo corre run.sh sobre su clúster desechable.
-- ============================================================================

-- Espacio de nombres de los identificadores de esta prueba (ver perm_id)
SELECT set_config('perm.ns', 'PERM-1', false);
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

-- ═══════════════════════════════════════════════════════════════════════════
-- 0 · PADRÓN (superusuario). Dos empresas propias, E y Z, cada una con dos proyectos, catálogo contable
--     sembrado por las funciones reales, un proveedor autorizado y un administrador SIN asignaciones.
--   Por cada acción i (1..6), cinco personas «operator» asignadas SOLO al proyecto A de E:
--     k_i  ver/crear/editar + SOLO la llave de la acción i
--     n_i  ver/crear/editar + approve y change_status genéricos + las OTRAS cinco llaves, SIN la i
--     d_i  como k_i, pero otro rol le DENIEGA la llave i
--     x_i  ver/crear/editar + la llave i en un rol VENCIDO (expires_at pasado)
--     f_i  ver/crear/editar + la llave i en un rol que vence MAÑANA (vigente)
--   Comunes: ow propietario de E · sa superadministrador (de la empresa Z) · aa administrador de E asignado SOLO a A
--            zk operador de Z con TODAS las llaves · cs ver/crear/editar + change_status genérico (solo)
-- ═══════════════════════════════════════════════════════════════════════════
DO $padron$
DECLARE
  E  constant uuid := 'fb010000-0000-0000-0000-0000000000e0';
  A  constant uuid := 'fb010000-0000-0000-0000-0000000000a1';
  B  constant uuid := 'fb010000-0000-0000-0000-0000000000b1';
  P  constant uuid := 'fb010000-0000-0000-0000-0000000000c1';
  AD constant uuid := 'fb010000-0000-0000-0000-0000000000ad';
  Z  constant uuid := 'fb010000-0000-0000-0000-0000000000f0';
  Z1 constant uuid := 'fb010000-0000-0000-0000-0000000000f1';
  Z2 constant uuid := 'fb010000-0000-0000-0000-0000000000f2';
  PZ constant uuid := 'fb010000-0000-0000-0000-0000000000f3';
  AZ constant uuid := 'fb010000-0000-0000-0000-0000000000f4';
  v_k    text[] := ARRAY['condominios.tab.ordenes_compra.approve', 'platform.contabilidad.compras.recepcion_registrar',
                         'platform.contabilidad.compras.factura_aprobar', 'platform.contabilidad.compras.orden_pago_aprobar',
                         'platform.contabilidad.compras.pago_ejecutar', 'platform.contabilidad.compras.pago_anular'];
  v_base text[] := ARRAY['platform.contabilidad.view', 'platform.contabilidad.create', 'platform.contabilidad.edit'];
  v_gen  text[] := ARRAY['platform.contabilidad.approve', 'platform.contabilidad.change_status'];
  i int;
BEGIN
  PERFORM public.perm_empresa(E, A, B, P, AD, 'PERM-1 Empresa E');
  PERFORM public.perm_empresa(Z, Z1, Z2, PZ, AZ, 'PERM-1 Empresa Z');
  FOR i IN 1..6 LOOP
    PERFORM public.perm_persona(public.perm_id('k' || i, 'u'), E, 'PERM-1 k' || i, ARRAY[A]);
    PERFORM public.perm_rol(public.perm_id('k' || i, 'u'), E, 'solo la llave', v_base || v_k[i]);

    PERFORM public.perm_persona(public.perm_id('n' || i, 'u'), E, 'PERM-1 n' || i, ARRAY[A]);
    PERFORM public.perm_rol(public.perm_id('n' || i, 'u'), E, 'las otras cinco y los genéricos',
                            v_base || v_gen || ARRAY(SELECT k FROM unnest(v_k) WITH ORDINALITY t(k, n) WHERE n <> i));

    PERFORM public.perm_persona(public.perm_id('d' || i, 'u'), E, 'PERM-1 d' || i, ARRAY[A]);
    PERFORM public.perm_rol(public.perm_id('d' || i, 'u'), E, 'concede', v_base || v_k[i]);
    PERFORM public.perm_rol(public.perm_id('d' || i, 'u'), E, 'deniega', ARRAY[v_k[i]], 'deny');

    PERFORM public.perm_persona(public.perm_id('x' || i, 'u'), E, 'PERM-1 x' || i, ARRAY[A]);
    PERFORM public.perm_rol(public.perm_id('x' || i, 'u'), E, 'base', v_base);
    PERFORM public.perm_rol(public.perm_id('x' || i, 'u'), E, 'llave vencida', ARRAY[v_k[i]], 'allow', now() - interval '1 day');

    PERFORM public.perm_persona(public.perm_id('f' || i, 'u'), E, 'PERM-1 f' || i, ARRAY[A]);
    PERFORM public.perm_rol(public.perm_id('f' || i, 'u'), E, 'base', v_base);
    PERFORM public.perm_rol(public.perm_id('f' || i, 'u'), E, 'llave vigente', ARRAY[v_k[i]], 'allow', now() + interval '1 day');
  END LOOP;
  PERFORM public.perm_persona(public.perm_id('ow', 'u'), E, 'PERM-1 propietario', ARRAY[]::uuid[], 'company_owner');
  PERFORM public.perm_persona(public.perm_id('sa', 'u'), Z, 'PERM-1 superadministrador (de Z)', ARRAY[]::uuid[], 'super_admin');
  PERFORM public.perm_persona(public.perm_id('aa', 'u'), E, 'PERM-1 administrador asignado solo a A', ARRAY[A], 'admin');
  PERFORM public.perm_persona(public.perm_id('zk', 'u'), Z, 'PERM-1 operador de Z con todo', ARRAY[Z1]);
  PERFORM public.perm_rol(public.perm_id('zk', 'u'), Z, 'todo', v_base || v_gen || v_k);
  PERFORM public.perm_persona(public.perm_id('cs', 'u'), E, 'PERM-1 solo cambiar estado', ARRAY[A]);
  PERFORM public.perm_rol(public.perm_id('cs', 'u'), E, 'solo change_status', v_base || ARRAY['platform.contabilidad.change_status']);
END;
$padron$;

-- ═══════════════════════════════════════════════════════════════════════════
-- 1 · CATÁLOGO Y COMPROBACIÓN COMÚN
-- ═══════════════════════════════════════════════════════════════════════════
SELECT public.chk((SELECT count(*) FROM public.permissions WHERE key IN (
    'platform.contabilidad.compras.recepcion_registrar', 'platform.contabilidad.compras.factura_aprobar',
    'platform.contabilidad.compras.orden_pago_aprobar', 'platform.contabilidad.compras.pago_ejecutar',
    'platform.contabilidad.compras.pago_anular')), 5, '[PERM-1a] las cinco llaves nuevas existen en el catálogo');
SELECT public.chk((SELECT count(*) FROM public.permissions WHERE key LIKE 'platform.contabilidad.compras.%' AND category = 'platform_contabilidad'), 5,
  '[PERM-1a] todas en la categoría platform_contabilidad (y no hay otras bajo ese prefijo)');
SELECT public.chk((SELECT count(*) FROM public.permissions WHERE key LIKE 'platform.contabilidad.compras.%' AND label ~ '^Compras y pagos — [^—]+$'), 5,
  '[PERM-1a] etiquetas «Compras y pagos — <acción>» con UN solo « — » (el editor de roles quita el prefijo hasta el primero)');
SELECT public.chk((SELECT count(*) FROM public.permissions WHERE key LIKE 'platform.contabilidad.compras.%' AND length(btrim(description)) >= 60), 5,
  '[PERM-1a] cada una con una descripción clara (qué hace y qué permisos vecinos NO incluye)');
SELECT public.chk((SELECT count(*) FROM public.permissions WHERE key LIKE 'platform.contabilidad.compras.%'
                      AND split_part(key, '.', 4) NOT IN ('view', 'create', 'edit', 'change_status', 'approve', 'delete')), 5,
  '[PERM-1a] el último segmento de cada llave NO es una acción conocida: el editor de roles le da su PROPIA fila');
SELECT public.chk_txt((SELECT label FROM public.permissions WHERE key = 'condominios.tab.ordenes_compra.approve'),
  'Autorizar / Denegar — Órdenes compra', '[PERM-1a] la llave de la orden de compra se REUTILIZA: ya era específica y no se crea otra');
SELECT public.chk((SELECT count(*) FROM public.role_permissions rp JOIN public.roles r ON r.id = rp.role_id
                    WHERE r.is_system AND rp.permission_key LIKE 'platform.contabilidad.compras.%'), 0,
  '[PERM-1a] ninguna plantilla de sistema (ni «Administrador General») recibió las llaves nuevas: nada se concede solo');
SELECT public.chk((SELECT count(*) FROM public.user_roles ur JOIN public.role_permissions rp ON rp.role_id = ur.role_id
                    WHERE ur.user_id = 'c0c0c0c0-0000-0000-0000-00000000000c'
                      AND (rp.permission_key LIKE 'platform.contabilidad.compras.%' OR rp.permission_key = 'condominios.tab.ordenes_compra.approve')), 0,
  '[PERM-1a] la persona «sin ellas» de la plantilla (UC, contador: ver/crear/editar/eliminar) no tiene NINGUNA de las seis llaves');
SELECT public.chk_bool(has_function_privilege('authenticated', 'public.compras_exigir_permiso(text,text,uuid,uuid)', 'EXECUTE')
                       OR has_function_privilege('anon', 'public.compras_exigir_permiso(text,text,uuid,uuid)', 'EXECUTE')
                       OR has_function_privilege('public', 'public.compras_exigir_permiso(text,text,uuid,uuid)', 'EXECUTE'), false,
  '[PERM-1b] compras_exigir_permiso no la ejecuta ni PUBLIC ni anon ni authenticated: solo los triggers');
SELECT public.chk_bool((SELECT prosecdef AND proconfig @> ARRAY['search_path=public, pg_temp'] FROM pg_proc WHERE oid = 'public.compras_exigir_permiso(text,text,uuid,uuid)'::regprocedure), true,
  '[PERM-1b] es SECURITY DEFINER con search_path fijo');

-- 1c · La comprobación directa: empresa → permiso → proyecto, solo para sesiones de usuario.
DO $unidad$
DECLARE
  E  constant uuid := 'fb010000-0000-0000-0000-0000000000e0';
  A  constant uuid := 'fb010000-0000-0000-0000-0000000000a1';
  B  constant uuid := 'fb010000-0000-0000-0000-0000000000b1';
  Z  constant uuid := 'fb010000-0000-0000-0000-0000000000f0';
  Z1 constant uuid := 'fb010000-0000-0000-0000-0000000000f1';
  k1 constant uuid := public.perm_id('k1', 'u');
  n1 constant uuid := public.perm_id('n1', 'u');
BEGIN
  PERFORM public.perm_sub(NULL);
  -- sin usuario (servicio, mantenimiento): no es una decisión de una persona
  PERFORM public.perm_pasa(format('SELECT public.compras_exigir_permiso(%L, %L, NULL, NULL)', 'condominios.tab.ordenes_compra.approve', 'probar'),
    '[PERM-1c] sin sesión de usuario la comprobación no se aplica (ni siquiera con empresa y proyecto nulos)');
  -- con el permiso de sistema (un trigger que mueve un estado derivado)
  PERFORM public.perm_sub(n1);
  PERFORM set_config('conta.allow_system_write', 'on', true);
  PERFORM public.perm_pasa(format('SELECT public.compras_exigir_permiso(%L, %L, %L, %L)', 'condominios.tab.ordenes_compra.approve', 'probar', Z, B),
    '[PERM-1c] con conta.allow_system_write la comprobación tampoco se aplica (camino de los triggers de sistema)');
  PERFORM set_config('conta.allow_system_write', 'off', true);
  PERFORM public.perm_sub(NULL);

  PERFORM public.perm_sub(k1);
  PERFORM public.perm_pasa(format('SELECT public.compras_exigir_permiso(%L, %L, %L, %L)', 'condominios.tab.ordenes_compra.approve', 'probar', E, A),
    '[PERM-1c] empresa propia + llave + proyecto asignado = pasa');
  PERFORM public.perm_pasa(format('SELECT public.compras_exigir_permiso(%L, %L, %L, NULL)', 'condominios.tab.ordenes_compra.approve', 'probar', E),
    '[PERM-1c] y un documento sin proyecto (es de la empresa) también');
  PERFORM public.perm_falla(format('SELECT public.compras_exigir_permiso(%L, %L, %L, %L)', 'condominios.tab.ordenes_compra.approve', 'probar', E, B),
    '42501', '^COMPRAS_ALCANCE_PROYECTO: para probar tu perfil necesita estar asignado al proyecto del documento', '[PERM-1c] con la llave pero sin el proyecto B: COMPRAS_ALCANCE_PROYECTO (42501)');
  PERFORM public.perm_falla(format('SELECT public.compras_exigir_permiso(%L, %L, %L, %L)', 'condominios.tab.ordenes_compra.approve', 'probar', Z, Z1),
    '42501', '^COMPRAS_ALCANCE_EMPRESA: para probar el documento tiene que ser de la empresa de tu sesión', '[PERM-1c] documento de otra empresa: COMPRAS_ALCANCE_EMPRESA (42501)');
  PERFORM public.perm_falla(format('SELECT public.compras_exigir_permiso(%L, %L, NULL, %L)', 'condominios.tab.ordenes_compra.approve', 'probar', A),
    '42501', '^COMPRAS_ALCANCE_EMPRESA', '[PERM-1c] un documento sin empresa no se acepta a nadie que no sea superadministrador');
  PERFORM public.perm_falla(format('SELECT public.compras_exigir_permiso(%L, %L, %L, %L)', 'platform.contabilidad.compras.pago_anular', 'probar', E, A),
    '42501', '^COMPRAS_PERMISO_ACCION: para probar tu perfil necesita el permiso «Compras y pagos — Anular un pago»\.$', '[PERM-1c] sin la llave: COMPRAS_PERMISO_ACCION con la ETIQUETA del catálogo (42501)');
  PERFORM public.perm_falla(format('SELECT public.compras_exigir_permiso(%L, %L, %L, %L)', 'llave.que.no.existe', 'probar', E, A),
    '42501', '^COMPRAS_PERMISO_ACCION: .*«llave\.que\.no\.existe»', '[PERM-1c] una llave fuera del catálogo se niega (y el mensaje cita la llave)');
  -- el permiso va ANTES que el proyecto: quien no tiene la llave no averigua nada del proyecto
  PERFORM public.perm_falla(format('SELECT public.compras_exigir_permiso(%L, %L, %L, %L)', 'platform.contabilidad.compras.pago_anular', 'probar', E, B),
    '42501', '^COMPRAS_PERMISO_ACCION', '[PERM-1c] sin la llave Y sin el proyecto: se informa el permiso, no el proyecto');
  PERFORM public.perm_sub(NULL);

  -- el superadministrador (de la empresa Z) actúa en E; el propietario también, sin asignaciones de proyecto
  PERFORM public.perm_sub(public.perm_id('sa', 'u'));
  PERFORM public.perm_pasa(format('SELECT public.compras_exigir_permiso(%L, %L, %L, %L)', 'platform.contabilidad.compras.pago_anular', 'probar', E, B),
    '[PERM-1c] el superadministrador (de la empresa Z) actúa en el proyecto B de E');
  PERFORM public.perm_sub(public.perm_id('ow', 'u'));
  PERFORM public.perm_pasa(format('SELECT public.compras_exigir_permiso(%L, %L, %L, %L)', 'platform.contabilidad.compras.pago_anular', 'probar', E, B),
    '[PERM-1c] el propietario de E, sin asignaciones de proyecto, actúa en el proyecto B');
  PERFORM public.perm_falla(format('SELECT public.compras_exigir_permiso(%L, %L, %L, %L)', 'platform.contabilidad.compras.pago_anular', 'probar', Z, Z1),
    '42501', '^COMPRAS_ALCANCE_EMPRESA', '[PERM-1c] el propietario sí es de UNA empresa: la de otra le es ajena');
  PERFORM public.perm_sub(NULL);
END;
$unidad$;

-- ═══════════════════════════════════════════════════════════════════════════
-- 2 · LAS SEIS ACCIONES, UNA POR UNA (el mismo guion para cada una; ningún permiso sirve de coartada a otro)
--   Cada acción tiene sus propios documentos, armados por el administrador con los pasos legítimos:
--     n negativos (no se consume) · p la persona con SOLO la llave · f la del rol vigente · o propietario · s superadministrador
--     w administrador sin asignaciones · q administrador asignado a A · v servicio (sin usuario) · b documento del proyecto B
-- ═══════════════════════════════════════════════════════════════════════════
DO $acciones$
DECLARE
  E  constant uuid := 'fb010000-0000-0000-0000-0000000000e0';
  A  constant uuid := 'fb010000-0000-0000-0000-0000000000a1';
  B  constant uuid := 'fb010000-0000-0000-0000-0000000000b1';
  P  constant uuid := 'fb010000-0000-0000-0000-0000000000c1';
  AD constant uuid := 'fb010000-0000-0000-0000-0000000000ad';
  ow constant uuid := public.perm_id('ow', 'u');
  sa constant uuid := public.perm_id('sa', 'u');
  aa constant uuid := public.perm_id('aa', 'u');
  zk constant uuid := public.perm_id('zk', 'u');
  ac record;
  ki uuid; ni uuid; di uuid; xi uuid; fi uuid;
  n  text;
  v_pat text; v_set text; v_id uuid; v_estado text; v_rot text;
BEGIN
  FOR ac IN
    SELECT * FROM (VALUES
      (1, 'aprobar_orden_compra', 'condominios.tab.ordenes_compra.approve',            'ordenes_compra',     'oc',  'aprobada',   '',                            'oc_borrador',    'borrador'),
      (2, 'registrar_recepcion',  'platform.contabilidad.compras.recepcion_registrar', 'recepciones',        'rec', 'registrada', '',                            'rec_borrador',   'borrador'),
      (3, 'aprobar_factura',      'platform.contabilidad.compras.factura_aprobar',     'facturas_proveedor', 'fac', 'aprobada',   '',                            'fac_registrada', 'registrada'),
      (4, 'aprobar_orden_pago',   'platform.contabilidad.compras.orden_pago_aprobar',  'ordenes_pago',       'op',  'aprobada',   '',                            'op_borrador',    'borrador'),
      (5, 'ejecutar_pago',        'platform.contabilidad.compras.pago_ejecutar',       'ordenes_pago',       'op',  'pagada',     ', fecha_pago = CURRENT_DATE', 'op_aprobada',    'aprobada'),
      (6, 'anular_pago',          'platform.contabilidad.compras.pago_anular',         'ordenes_pago',       'op',  'anulada',    '',                            'op_aprobada',    'aprobada')
    ) AS v(i, nombre, llave, tabla, tipo, dest, extra, src, estado0)
    WHERE COALESCE(NULLIF(current_setting('perm.solo', true), ''), v.i::text) = v.i::text   -- (opcional) PGOPTIONS='-c perm.solo=3' corre una sola acción
    ORDER BY i
  LOOP
    ki := public.perm_id('k' || ac.i, 'u'); ni := public.perm_id('n' || ac.i, 'u'); di := public.perm_id('d' || ac.i, 'u');
    xi := public.perm_id('x' || ac.i, 'u'); fi := public.perm_id('f' || ac.i, 'u');
    v_set := format('SET estado = %L%s', ac.dest, ac.extra);
    v_pat := 'COMPRAS_PERMISO_ACCION: para .* tu perfil necesita el permiso «'
             || (SELECT p.label FROM public.permissions p WHERE p.key = ac.llave) || '»';

    -- ── Documentos: los arma un administrador exento, por el camino normal ──
    PERFORM public.perm_como(AD);
    FOREACH n IN ARRAY ARRAY['n', 'p', 'f', 'o', 's', 'w', 'q', 'v'] LOOP
      PERFORM public.perm_cadena(ac.i || n, E, A, P, ac.src);
    END LOOP;
    PERFORM public.perm_cadena(ac.i || 'b', E, B, P, ac.src);
    PERFORM public.perm_como(NULL);

    -- ── NEGATIVOS: cinco maneras de NO tener la llave ───────────────────────
    v_id := public.perm_id(ac.i || 'n', ac.tipo);
    PERFORM public.perm_como(ni);
    PERFORM public.perm_falla(format('UPDATE public.%I %s WHERE id = %L', ac.tabla, v_set, v_id), '42501', v_pat,
      format('[%s] con las OTRAS cinco llaves y con approve y change_status genéricos, pero SIN «%s», se rechaza (COMPRAS_PERMISO_ACCION, 42501)', ac.nombre, ac.llave));
    PERFORM public.perm_como(di);
    PERFORM public.perm_falla(format('UPDATE public.%I %s WHERE id = %L', ac.tabla, v_set, v_id), '42501', v_pat,
      format('[%s] un rol que la CONCEDE y otro que la DENIEGA: gana denegar', ac.nombre));
    PERFORM public.perm_como(xi);
    PERFORM public.perm_falla(format('UPDATE public.%I %s WHERE id = %L', ac.tabla, v_set, v_id), '42501', v_pat,
      format('[%s] el rol que la concedía VENCIÓ (expires_at pasado): se rechaza', ac.nombre));
    -- otra empresa: la RLS no deja ver la fila (0 filas) y la función definer que la alcanza se rechaza por empresa
    PERFORM public.perm_como(zk);
    PERFORM public.perm_filas(format('UPDATE public.%I %s WHERE id = %L', ac.tabla, v_set, v_id), 0,
      format('[%s] persona de OTRA empresa con todas las llaves: el UPDATE por id afecta 0 filas', ac.nombre));
    -- (la orden de compra la frena ANTES el control del proveedor autorizado, que también mira la empresa de la sesión; las otras
    --  tres tablas llegan a compras_exigir_permiso y reciben COMPRAS_ALCANCE_EMPRESA)
    IF ac.i = 1 THEN
      PERFORM public.perm_falla(format('SELECT public.perm_definer_estado(%L, %L, %L, %L)', ac.tabla, v_id, ac.dest, ac.extra), '23514',
        '^COMPRAS_PROVEEDOR_NO_AUTORIZADO',
        format('[%s] persona de OTRA empresa por una función SECURITY DEFINER (sin RLS): se rechaza (el proveedor de E no es de su empresa)', ac.nombre));
    ELSE
      PERFORM public.perm_falla(format('SELECT public.perm_definer_estado(%L, %L, %L, %L)', ac.tabla, v_id, ac.dest, ac.extra), '42501',
        '^COMPRAS_ALCANCE_EMPRESA: para .* el documento tiene que ser de la empresa de tu sesión',
        format('[%s] persona de OTRA empresa por una función SECURITY DEFINER (sin RLS): COMPRAS_ALCANCE_EMPRESA (42501)', ac.nombre));
    END IF;
    PERFORM public.perm_como(NULL);
    EXECUTE format('SELECT estado FROM public.%I WHERE id = %L', ac.tabla, v_id) INTO v_estado;
    PERFORM public.chk_txt(v_estado, ac.estado0, format('[%s] ninguno de los cinco intentos rechazados movió el documento (sigue «%s»)', ac.nombre, ac.estado0));

    -- ── POSITIVO: SOLO esa llave (+ ver/crear/editar) ───────────────────────
    v_id := public.perm_id(ac.i || 'p', ac.tipo);
    PERFORM public.perm_como(ki);
    PERFORM public.perm_filas(
      format('UPDATE public.%I %s%s WHERE id = %L', ac.tabla, v_set,
             CASE WHEN ac.i = 1 THEN format(', aprobada_por = %L', ow) ELSE '' END, v_id), 1,
      format('[%s] quien tiene SOLO «%s» (más ver/crear/editar) la ejerce', ac.nombre, ac.llave));
    PERFORM public.perm_como(NULL);
    EXECUTE format('SELECT estado FROM public.%I WHERE id = %L', ac.tabla, v_id) INTO v_estado;
    PERFORM public.chk_txt(v_estado, ac.dest, format('[%s] y el documento quedó «%s»', ac.nombre, ac.dest));
    IF ac.i = 1 THEN
      PERFORM public.chk_uuid((SELECT o.aprobada_por FROM public.ordenes_compra o WHERE o.id = v_id), ki,
        '[aprobar_orden_compra] el aprobador lo sella el servidor: el navegador dijo otra persona y quedó quien ejecutó');
      PERFORM public.chk_bool((SELECT o.aprobada_at IS NOT NULL FROM public.ordenes_compra o WHERE o.id = v_id), true, '[aprobar_orden_compra] y la hora de aprobación quedó sellada');
    ELSIF ac.i = 2 THEN
      PERFORM public.chk_bool((SELECT r.registrada_at IS NOT NULL FROM public.recepciones r WHERE r.id = v_id), true, '[registrar_recepcion] la hora de registro quedó sellada');
      PERFORM public.chk_num((SELECT l.cantidad_recibida FROM public.orden_compra_lineas l WHERE l.id = public.perm_id(ac.i || 'p', 'ocl')), 1,
        '[registrar_recepcion] y lo recibido de la línea de la orden subió (el trigger de sistema corrió sin pedir otro permiso)');
      PERFORM public.chk((SELECT count(*) FROM public.conta_asientos WHERE origen_tabla = 'recepciones' AND origen_id = v_id), 1, '[registrar_recepcion] y se contabilizó UNA vez');
    ELSIF ac.i = 3 THEN
      PERFORM public.chk_uuid((SELECT f.aprobada_por FROM public.facturas_proveedor f WHERE f.id = v_id), ki, '[aprobar_factura] aprobada por quien ejecutó');
      PERFORM public.chk((SELECT count(*) FROM public.conta_asientos WHERE origen_tabla = 'facturas_proveedor' AND origen_id = v_id AND origen_evento = 'factura_prov_aprobada'), 1,
        '[aprobar_factura] y se contabilizó UNA vez (devengo)');
    ELSIF ac.i = 4 THEN
      PERFORM public.chk_uuid((SELECT o.aprobada_por FROM public.ordenes_pago o WHERE o.id = v_id), ki, '[aprobar_orden_pago] aprobada por quien ejecutó');
      PERFORM public.chk_bool((SELECT o.aprobada_at IS NOT NULL FROM public.ordenes_pago o WHERE o.id = v_id), true, '[aprobar_orden_pago] y la hora quedó sellada');
    ELSIF ac.i = 5 THEN
      PERFORM public.chk_bool((SELECT o.pagada_at IS NOT NULL FROM public.ordenes_pago o WHERE o.id = v_id), true, '[ejecutar_pago] la hora de pago quedó sellada');
      PERFORM public.chk_txt((SELECT f.estado FROM public.facturas_proveedor f WHERE f.id = public.perm_id(ac.i || 'p', 'fac')), 'pagada',
        '[ejecutar_pago] y la factura quedó «pagada» (el trigger de pago, de sistema, no pide otro permiso)');
    ELSIF ac.i = 6 THEN
      PERFORM public.chk_txt((SELECT f.estado FROM public.facturas_proveedor f WHERE f.id = public.perm_id(ac.i || 'p', 'fac')), 'aprobada',
        '[anular_pago] la factura sigue aprobada: anular una orden sin pagar no toca lo pagado');
    END IF;

    -- ── Rol VIGENTE que vence mañana: la llave rige ─────────────────────────
    v_id := public.perm_id(ac.i || 'f', ac.tipo);
    PERFORM public.perm_como(fi);
    PERFORM public.perm_filas(format('UPDATE public.%I %s WHERE id = %L', ac.tabla, v_set, v_id), 1,
      format('[%s] el rol que vence MAÑANA todavía concede la llave', ac.nombre));

    -- ── Quienes pasan sin la llave: propietario, superadministrador, administradores ──
    PERFORM public.perm_como(ow);
    PERFORM public.perm_filas(format('UPDATE public.%I %s WHERE id = %L', ac.tabla, v_set, public.perm_id(ac.i || 'o', ac.tipo)), 1,
      format('[%s] el propietario de la empresa sigue pasando (sin llave y sin asignaciones de proyecto)', ac.nombre));
    PERFORM public.perm_como(sa);
    PERFORM public.perm_filas(format('UPDATE public.%I %s WHERE id = %L', ac.tabla, v_set, public.perm_id(ac.i || 's', ac.tipo)), 1,
      format('[%s] el superadministrador (de otra empresa) sigue pasando', ac.nombre));
    PERFORM public.perm_como(AD);
    PERFORM public.perm_filas(format('UPDATE public.%I %s WHERE id = %L', ac.tabla, v_set, public.perm_id(ac.i || 'w', ac.tipo)), 1,
      format('[%s] el administrador SIN asignaciones (exento de proyecto) sigue pasando', ac.nombre));
    PERFORM public.perm_como(aa);
    PERFORM public.perm_filas(format('UPDATE public.%I %s WHERE id = %L', ac.tabla, v_set, public.perm_id(ac.i || 'q', ac.tipo)), 1,
      format('[%s] el administrador CON asignaciones pasa en SU proyecto (A)', ac.nombre));
    -- … pero no en el que no tiene asignado: por id no ve la fila; por una función definer, la comprobación de proyecto lo para
    v_id := public.perm_id(ac.i || 'b', ac.tipo);
    PERFORM public.perm_filas(format('UPDATE public.%I %s WHERE id = %L', ac.tabla, v_set, v_id), 0,
      format('[%s] el administrador asignado solo a A: el UPDATE por id de un documento de B afecta 0 filas', ac.nombre));
    PERFORM public.perm_falla(format('SELECT public.perm_definer_estado(%L, %L, %L, %L)', ac.tabla, v_id, ac.dest, ac.extra), '42501',
      '^COMPRAS_ALCANCE_PROYECTO: para .* tu perfil necesita estar asignado al proyecto del documento',
      format('[%s] y por una función SECURITY DEFINER sobre un documento de B: COMPRAS_ALCANCE_PROYECTO (el administrador con asignaciones no es exento)', ac.nombre));
    PERFORM public.perm_como(ki);
    PERFORM public.perm_falla(format('SELECT public.perm_definer_estado(%L, %L, %L, %L)', ac.tabla, v_id, ac.dest, ac.extra), '42501',
      '^COMPRAS_ALCANCE_PROYECTO: para .* tu perfil necesita estar asignado al proyecto del documento',
      format('[%s] con la llave pero asignado solo a A: sobre un documento de B, COMPRAS_ALCANCE_PROYECTO (42501)', ac.nombre));

    -- ── SERVICIO: sin usuario no se aplica ningún permiso de persona ────────
    PERFORM public.perm_como(NULL, true);
    PERFORM public.perm_filas(format('UPDATE public.%I %s WHERE id = %L', ac.tabla, v_set, public.perm_id(ac.i || 'v', ac.tipo)), 1,
      format('[%s] el rol de servicio (sin usuario) sigue pudiendo: las tareas de mantenimiento no cambian', ac.nombre));

    -- ── Lo rechazado no dejó rastro: n y b siguen como estaban ──────────────
    PERFORM public.perm_como(NULL);
    EXECUTE format('SELECT count(*) FROM public.%I WHERE id IN (%L, %L) AND estado = %L', ac.tabla, public.perm_id(ac.i || 'n', ac.tipo), public.perm_id(ac.i || 'b', ac.tipo), ac.estado0) INTO v_rot;
    PERFORM public.chk_txt(v_rot, '2', format('[%s] los documentos de los intentos rechazados (n y b) siguen «%s»', ac.nombre, ac.estado0));
  END LOOP;
END;
$acciones$;

-- ═══════════════════════════════════════════════════════════════════════════
-- 3 · LOS DOS CASOS CON MÁS DE UN ORIGEN
--   a. Devolver a borrador una orden APROBADA es de quien tiene la llave de la orden (no de quien cambia estado).
--   b. Anular un pago es la misma llave desde CUALQUIER estado: borrador, aprobada o pagada.
-- ═══════════════════════════════════════════════════════════════════════════
DO $origenes$
DECLARE
  E  constant uuid := 'fb010000-0000-0000-0000-0000000000e0';
  A  constant uuid := 'fb010000-0000-0000-0000-0000000000a1';
  P  constant uuid := 'fb010000-0000-0000-0000-0000000000c1';
  AD constant uuid := 'fb010000-0000-0000-0000-0000000000ad';
  cs constant uuid := public.perm_id('cs', 'u');
  o  text;
  v_id uuid;
  v_pat text;
BEGIN
  -- a · devolver
  PERFORM public.perm_como(AD);
  PERFORM public.perm_cadena('1d', E, A, P, 'oc_aprobada');
  PERFORM public.perm_como(NULL);
  v_pat := 'COMPRAS_PERMISO_ACCION: para devolver a borrador una orden aprobada tu perfil necesita el permiso «Autorizar / Denegar — Órdenes compra»';
  PERFORM public.perm_como(public.perm_id('n1', 'u'));
  PERFORM public.perm_falla(format('UPDATE public.ordenes_compra SET estado = %L, motivo_devolucion = %L WHERE id = %L', 'borrador', 'PERM-1 devolución', public.perm_id('1d', 'oc')),
    '42501', v_pat, '[devolver_orden] con las otras cinco llaves y approve genérico, SIN la llave de la orden: no puede devolverla');
  PERFORM public.perm_como(cs);
  PERFORM public.perm_falla(format('UPDATE public.ordenes_compra SET estado = %L, motivo_devolucion = %L WHERE id = %L', 'borrador', 'PERM-1 devolución', public.perm_id('1d', 'oc')),
    '42501', v_pat, '[devolver_orden] quien solo cambia estado (genérico) tampoco: es de quien autoriza');
  PERFORM public.perm_como(public.perm_id('k1', 'u'));
  PERFORM public.perm_filas(format('UPDATE public.ordenes_compra SET estado = %L, motivo_devolucion = %L WHERE id = %L', 'borrador', 'PERM-1 devolución', public.perm_id('1d', 'oc')), 1,
    '[devolver_orden] quien tiene SOLO la llave de la orden la devuelve a borrador');
  PERFORM public.perm_como(NULL);
  PERFORM public.chk_txt((SELECT estado FROM public.ordenes_compra WHERE id = public.perm_id('1d', 'oc')), 'borrador', '[devolver_orden] y quedó en borrador');

  -- b · anular desde borrador y desde pagada (desde aprobada ya lo cubre el bloque 2)
  PERFORM public.perm_como(AD);
  PERFORM public.perm_cadena('6g', E, A, P, 'op_borrador');
  PERFORM public.perm_cadena('6h', E, A, P, 'op_pagada');
  PERFORM public.perm_cadena('6i', E, A, P, 'op_borrador');
  PERFORM public.perm_cadena('6j', E, A, P, 'op_pagada');
  PERFORM public.perm_como(NULL);
  FOREACH o IN ARRAY ARRAY['g', 'h'] LOOP
    v_id := public.perm_id('6' || o, 'op');
    PERFORM public.perm_como(public.perm_id('n6', 'u'));
    PERFORM public.perm_falla(format('UPDATE public.ordenes_pago SET estado = %L WHERE id = %L', 'anulada', v_id), '42501',
      'COMPRAS_PERMISO_ACCION: para anular una orden de pago tu perfil necesita el permiso «Compras y pagos — Anular un pago»',
      format('[anular_pago · origen %s] con las otras cinco llaves y change_status genérico, SIN pago_anular: no puede', CASE o WHEN 'g' THEN 'borrador' ELSE 'pagada' END));
    PERFORM public.perm_como(NULL);
    PERFORM public.chk_txt((SELECT estado FROM public.ordenes_pago WHERE id = v_id), CASE o WHEN 'g' THEN 'borrador' ELSE 'pagada' END,
      format('[anular_pago · origen %s] y el rechazo no movió nada', CASE o WHEN 'g' THEN 'borrador' ELSE 'pagada' END));
  END LOOP;
  -- con la llave, desde borrador y desde pagada
  PERFORM public.perm_como(public.perm_id('k6', 'u'));
  PERFORM public.perm_filas(format('UPDATE public.ordenes_pago SET estado = %L WHERE id = %L', 'anulada', public.perm_id('6i', 'op')), 1,
    '[anular_pago · origen borrador] quien tiene SOLO pago_anular anula una orden en borrador');
  PERFORM public.perm_filas(format('UPDATE public.ordenes_pago SET estado = %L WHERE id = %L', 'anulada', public.perm_id('6j', 'op')), 1,
    '[anular_pago · origen pagada] y también una ya PAGADA');
  PERFORM public.perm_como(NULL);
  PERFORM public.chk_txt((SELECT estado FROM public.facturas_proveedor WHERE id = public.perm_id('6j', 'fac')), 'aprobada',
    '[anular_pago · origen pagada] la factura recuperó su saldo (volvió a «aprobada»): el trigger de sistema corrió sin pedir otro permiso');
  PERFORM public.chk_num((SELECT monto_pagado FROM public.facturas_proveedor WHERE id = public.perm_id('6j', 'fac')), 0, '[anular_pago · origen pagada] y lo pagado volvió a 0');
END;
$origenes$;

-- ═══════════════════════════════════════════════════════════════════════════
-- 4 · LO QUE NO CAMBIÓ: emitir/cancelar la orden y anular recepción y factura siguen con `change_status` genérico
--     (no están entre las seis); y tener la llave de una acción NO da ese genérico.
-- ═══════════════════════════════════════════════════════════════════════════
DO $nocambia$
DECLARE
  E  constant uuid := 'fb010000-0000-0000-0000-0000000000e0';
  A  constant uuid := 'fb010000-0000-0000-0000-0000000000a1';
  P  constant uuid := 'fb010000-0000-0000-0000-0000000000c1';
  AD constant uuid := 'fb010000-0000-0000-0000-0000000000ad';
  cs constant uuid := public.perm_id('cs', 'u');
BEGIN
  PERFORM public.perm_como(AD);
  PERFORM public.perm_cadena('x1', E, A, P, 'oc_aprobada');
  PERFORM public.perm_cadena('x2', E, A, P, 'oc_aprobada');
  PERFORM public.perm_cadena('x3', E, A, P, 'oc_aprobada');
  PERFORM public.perm_cadena('x4', E, A, P, 'rec_registrada');
  PERFORM public.perm_cadena('x5', E, A, P, 'rec_registrada');
  PERFORM public.perm_cadena('x6', E, A, P, 'fac_registrada');
  PERFORM public.perm_cadena('x7', E, A, P, 'fac_registrada');
  PERFORM public.perm_como(NULL);

  -- emitir
  PERFORM public.perm_como(public.perm_id('k1', 'u'));
  PERFORM public.perm_falla(format('UPDATE public.ordenes_compra SET estado = %L WHERE id = %L', 'emitida', public.perm_id('x1', 'oc')), '42501',
    'COMPRAS_PERMISO_ACCION: para emitir una orden de compra al proveedor tu perfil necesita el permiso «Cambiar estado — Contabilidad»',
    '[no cambia] aprobar la orden (su llave) NO es emitirla: emitir sigue con change_status');
  PERFORM public.perm_como(cs);
  PERFORM public.perm_filas(format('UPDATE public.ordenes_compra SET estado = %L WHERE id = %L', 'emitida', public.perm_id('x1', 'oc')), 1,
    '[no cambia] quien solo tiene change_status genérico EMITE la orden aprobada');
  -- cancelar
  PERFORM public.perm_como(public.perm_id('n1', 'u'));
  PERFORM public.perm_filas(format('UPDATE public.ordenes_compra SET estado = %L, motivo_anulacion = %L WHERE id = %L', 'cancelada', 'PERM-1', public.perm_id('x2', 'oc')), 1,
    '[no cambia] con change_status genérico (y sin la llave de la orden) se CANCELA una orden aprobada');
  PERFORM public.perm_como(public.perm_id('k1', 'u'));
  PERFORM public.perm_falla(format('UPDATE public.ordenes_compra SET estado = %L, motivo_anulacion = %L WHERE id = %L', 'cancelada', 'PERM-1', public.perm_id('x3', 'oc')), '42501',
    'COMPRAS_PERMISO_ACCION: para cancelar una orden de compra tu perfil necesita el permiso «Cambiar estado — Contabilidad»',
    '[no cambia] la llave de la orden no cancela: cancelar sigue con change_status');
  -- anular recepción
  PERFORM public.perm_como(public.perm_id('k2', 'u'));
  PERFORM public.perm_falla(format('UPDATE public.recepciones SET estado = %L, motivo_anulacion = %L WHERE id = %L', 'anulada', 'PERM-1', public.perm_id('x4', 'rec')), '42501',
    'COMPRAS_PERMISO_ACCION: para anular una recepción tu perfil necesita el permiso «Cambiar estado — Contabilidad»',
    '[no cambia] registrar la recepción (su llave) NO es anularla: anular sigue con change_status');
  PERFORM public.perm_como(cs);
  PERFORM public.perm_filas(format('UPDATE public.recepciones SET estado = %L, motivo_anulacion = %L WHERE id = %L', 'anulada', 'PERM-1', public.perm_id('x5', 'rec')), 1,
    '[no cambia] quien solo tiene change_status genérico ANULA una recepción registrada');
  -- anular factura
  PERFORM public.perm_como(public.perm_id('k3', 'u'));
  PERFORM public.perm_falla(format('UPDATE public.facturas_proveedor SET estado = %L WHERE id = %L', 'anulada', public.perm_id('x6', 'fac')), '42501',
    'COMPRAS_PERMISO_ACCION: para anular una factura de proveedor tu perfil necesita el permiso «Cambiar estado — Contabilidad»',
    '[no cambia] aprobar la factura (su llave) NO es anularla: anular sigue con change_status');
  PERFORM public.perm_como(cs);
  PERFORM public.perm_filas(format('UPDATE public.facturas_proveedor SET estado = %L WHERE id = %L', 'anulada', public.perm_id('x7', 'fac')), 1,
    '[no cambia] quien solo tiene change_status genérico ANULA una factura');
  -- y change_status genérico no da las acciones nuevas
  PERFORM public.perm_como(NULL);
  PERFORM public.perm_como(AD);
  PERFORM public.perm_cadena('x8', E, A, P, 'rec_borrador');
  PERFORM public.perm_como(cs);
  PERFORM public.perm_falla(format('UPDATE public.recepciones SET estado = %L WHERE id = %L', 'registrada', public.perm_id('x8', 'rec')), '42501',
    'COMPRAS_PERMISO_ACCION: para registrar una recepción .* «Compras y pagos — Registrar una recepción»',
    '[no cambia] y change_status genérico YA NO registra recepciones (era el efecto buscado)');
  PERFORM public.perm_como(NULL);
END;
$nocambia$;

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
SELECT public.chk((SELECT count(*) FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.prosecdef
                      AND p.proname LIKE 'perm\_%' AND has_function_privilege('authenticated', p.oid, 'EXECUTE')), 0,
  '[limpieza] tras la prueba no queda ninguna función perm_* SECURITY DEFINER ejecutable por authenticated');
SELECT public.chk((SELECT count(*) FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname ~ '^perm[0-9]*_'), 0,
  '[limpieza] ni ninguna otra ayuda perm_* / permN_*');
