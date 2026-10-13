\set ON_ERROR_STOP on
-- ============================================================================
-- PERM-2 · La llave de cada acción NO alcanza proyectos que la persona no tiene asignados, ni documentos de otra empresa:
--          el trigger verifica el alcance (la RLS de ESCRITURA no lo hace) tanto en UPDATE sin WHERE como en una función
--          SECURITY DEFINER; y un UPDATE que la RLS deja en 0 filas devuelve 0 y no cambia nada.
--
-- CAUSA RAÍZ
--   Las políticas UPDATE/INSERT de ordenes_compra, recepciones, facturas_proveedor y ordenes_pago piden
--   `platform.contabilidad.edit`/`create` y la empresa, pero NO `can_access_project` (solo el SELECT lo trae). Un UPDATE
--   que no lee columnas de la fila (sin WHERE, `WHERE true`) o una función SECURITY DEFINER (el dueño no tiene RLS) llega
--   a documentos de OTRO proyecto de la empresa; con un WHERE por id la política SELECT esconde la fila y el UPDATE afecta 0.
--
-- COMPORTAMIENTO ESPERADO (para CADA una de las seis acciones, en su propia empresa con dos proyectos A y B)
--   · llave + asignado SOLO a A:  UPDATE sin WHERE, `WHERE true` y `WHERE now() IS NOT NULL` (no leen la fila) alcanzan el
--     documento de B y mueren con COMPRAS_ALCANCE_PROYECTO (42501), sin cambiar NINGUNO (ni el de A: es una sola sentencia);
--   · el mismo UPDATE con WHERE por id del documento de B afecta 0 filas y no cambia nada; la función definer que sí lo
--     alcanza (con su WHERE por id) muere con COMPRAS_ALCANCE_PROYECTO;
--   · un administrador CON asignaciones solo en A no es exento: el UPDATE sin WHERE tampoco pasa;
--   · sin la llave se informa el PERMISO (no el proyecto); de OTRA empresa, el UPDATE sin WHERE afecta 0 filas;
--   · con la llave y asignado a A y B, el UPDATE sin WHERE pasa y afecta las 2 filas; un UPDATE masivo con WHERE por columna
--     afecta SOLO las de A (las de B no se ven); con la llave y proyecto asignado, por id, pasa;
--   · el administrador sin asignaciones, el propietario y el superadministrador siguen actuando en B;
--   · la orden de compra, que en borrador puede cambiar de proyecto, no se aprueba MOVIÉNDOLA a un proyecto ajeno.
--
-- Las personas con llave de esta prueba conservan también approve y change_status genéricos (como las de hoy): así, sobre la
-- base SIN la pieza, lo que falla es el hueco de alcance mismo (el UPDATE sin WHERE llega al proyecto B) y no un rechazo de permiso.
--
-- Ids propios: md5('perm:…') (perm_id). Cada acción vive en su empresa (todas propias de esta prueba).
--
-- ⚠ SOLO clúster local; nunca contra sandbox/producción. Crea funciones auxiliares perm_* (una es SECURITY DEFINER y
--   ejecutable por `authenticated`, para modelar una RPC) y empresas de prueba que NO se pueden borrar (los documentos de
--   compras no se borran). Las ayudas se borran al final (DROP FUNCTION IF EXISTS) y una comprobación final exige que no quede
--   ninguna; los datos 'PERM-…' sí quedan en la base. Lo corre run.sh sobre su clúster desechable.
-- ============================================================================

-- Espacio de nombres de los identificadores de esta prueba (ver perm_id)
SELECT set_config('perm.ns', 'PERM-2', false);
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

-- Padrón compartido: la empresa Z (ajena a todas) con un superadministrador y una operadora con todo.
DO $padron_z$
DECLARE
  Z  constant uuid := 'fb020000-0000-0000-0000-0000000000f0';
  Z1 constant uuid := 'fb020000-0000-0000-0000-0000000000f1';
  Z2 constant uuid := 'fb020000-0000-0000-0000-0000000000f2';
  PZ constant uuid := 'fb020000-0000-0000-0000-0000000000f3';
  AZ constant uuid := 'fb020000-0000-0000-0000-0000000000f4';
BEGIN
  PERFORM public.perm_empresa(Z, Z1, Z2, PZ, AZ, 'PERM-2 Empresa Z');
  PERFORM public.perm_persona(public.perm_id('2zk', 'u'), Z, 'PERM-2 operador de Z con todo', ARRAY[Z1]);
  PERFORM public.perm_rol(public.perm_id('2zk', 'u'), Z, 'todo',
    ARRAY['platform.contabilidad.view', 'platform.contabilidad.create', 'platform.contabilidad.edit',
          'platform.contabilidad.approve', 'platform.contabilidad.change_status',
          'condominios.tab.ordenes_compra.approve', 'platform.contabilidad.compras.recepcion_registrar',
          'platform.contabilidad.compras.factura_aprobar', 'platform.contabilidad.compras.orden_pago_aprobar',
          'platform.contabilidad.compras.pago_ejecutar', 'platform.contabilidad.compras.pago_anular']);
  PERFORM public.perm_persona(public.perm_id('2sa', 'u'), Z, 'PERM-2 superadministrador (de Z)', ARRAY[]::uuid[], 'super_admin');
END;
$padron_z$;

DO $alcance$
DECLARE
  ac record;
  v_k    text[] := ARRAY['condominios.tab.ordenes_compra.approve', 'platform.contabilidad.compras.recepcion_registrar',
                         'platform.contabilidad.compras.factura_aprobar', 'platform.contabilidad.compras.orden_pago_aprobar',
                         'platform.contabilidad.compras.pago_ejecutar', 'platform.contabilidad.compras.pago_anular'];
  v_base text[] := ARRAY['platform.contabilidad.view', 'platform.contabilidad.create', 'platform.contabilidad.edit'];
  v_gen  text[] := ARRAY['platform.contabilidad.approve', 'platform.contabilidad.change_status'];
  zk constant uuid := public.perm_id('2zk', 'u');
  sa constant uuid := public.perm_id('2sa', 'u');
  E uuid; A uuid; B uuid; P uuid; AD uuid;
  ki uuid; kab uuid; ni uuid; aai uuid; ow uuid;
  v_set text; v_where text; v_estado text; v_n text; v_proj uuid;
  v_pat_al constant text := '^COMPRAS_ALCANCE_PROYECTO: para .* tu perfil necesita estar asignado al proyecto del documento';
BEGIN
  FOR ac IN
    SELECT * FROM (VALUES
      (1, 'aprobar_orden_compra', 'ordenes_compra',     'oc',  'aprobada',   '',                            'oc_borrador',    'borrador'),
      (2, 'registrar_recepcion',  'recepciones',        'rec', 'registrada', '',                            'rec_borrador',   'borrador'),
      (3, 'aprobar_factura',      'facturas_proveedor', 'fac', 'aprobada',   '',                            'fac_registrada', 'registrada'),
      (4, 'aprobar_orden_pago',   'ordenes_pago',       'op',  'aprobada',   '',                            'op_borrador',    'borrador'),
      (5, 'ejecutar_pago',        'ordenes_pago',       'op',  'pagada',     ', fecha_pago = CURRENT_DATE', 'op_aprobada',    'aprobada'),
      (6, 'anular_pago',          'ordenes_pago',       'op',  'anulada',    '',                            'op_aprobada',    'aprobada')
    ) AS v(i, nombre, tabla, tipo, dest, extra, src, estado0)
    WHERE COALESCE(NULLIF(current_setting('perm.solo', true), ''), v.i::text) = v.i::text   -- (opcional) PGOPTIONS='-c perm.solo=3'
    ORDER BY i
  LOOP
    E := public.perm_id('e' || ac.i, 'co'); A := public.perm_id('a' || ac.i, 'pa'); B := public.perm_id('b' || ac.i, 'pb');
    P := public.perm_id('p' || ac.i, 'pv'); AD := public.perm_id('ad' || ac.i, 'u');
    ki := public.perm_id('k' || ac.i, 'u'); kab := public.perm_id('kab' || ac.i, 'u'); ni := public.perm_id('n' || ac.i, 'u');
    aai := public.perm_id('aa' || ac.i, 'u'); ow := public.perm_id('ow' || ac.i, 'u');
    v_set := format('SET estado = %L%s', ac.dest, ac.extra);

    -- ── Padrón de la acción (superusuario): su empresa, dos proyectos y cinco personas ──
    PERFORM public.perm_como(NULL);
    PERFORM public.perm_empresa(E, A, B, P, AD, 'PERM-2 acción ' || ac.i);
    PERFORM public.perm_persona(ki,  E, 'PERM-2 k' || ac.i,   ARRAY[A]);        PERFORM public.perm_rol(ki,  E, 'la llave y los genéricos', v_base || v_gen || v_k[ac.i]);
    PERFORM public.perm_persona(kab, E, 'PERM-2 kab' || ac.i, ARRAY[A, B]);     PERFORM public.perm_rol(kab, E, 'la llave y los genéricos', v_base || v_gen || v_k[ac.i]);
    PERFORM public.perm_persona(ni,  E, 'PERM-2 n' || ac.i,   ARRAY[A, B]);
    PERFORM public.perm_rol(ni, E, 'las otras cinco y los genéricos', v_base || v_gen || ARRAY(SELECT k FROM unnest(v_k) WITH ORDINALITY t(k, n) WHERE n <> ac.i));
    PERFORM public.perm_persona(aai, E, 'PERM-2 admin de A' || ac.i, ARRAY[A], 'admin');
    PERFORM public.perm_persona(ow,  E, 'PERM-2 propietario' || ac.i, ARRAY[]::uuid[], 'company_owner');

    -- ── Fase 1: la tabla de esta empresa tiene SOLO dos documentos en el estado de origen: x1 en A y x2 en B ──
    PERFORM public.perm_como(AD);
    PERFORM public.perm_cadena(ac.i || 'x1', E, A, P, ac.src);
    PERFORM public.perm_cadena(ac.i || 'x2', E, B, P, ac.src);
    PERFORM public.perm_como(NULL);
    EXECUTE format('SELECT count(*) FROM public.%I WHERE company_id = %L', ac.tabla, E) INTO v_n;
    PERFORM public.chk_txt(v_n, '2', format('[%s] preparación: la empresa tiene exactamente 2 documentos en la tabla (x1 en A, x2 en B)', ac.nombre));

    -- UPDATE que NO lee la fila: alcanza el documento de B y el trigger lo para
    PERFORM public.perm_como(ki);
    PERFORM public.perm_falla(format('UPDATE public.%I %s', ac.tabla, v_set), '42501', v_pat_al,
      format('[%s] llave + asignado SOLO a A: el UPDATE sin WHERE alcanza el documento de B y muere con COMPRAS_ALCANCE_PROYECTO (42501)', ac.nombre));
    PERFORM public.perm_falla(format('UPDATE public.%I %s WHERE true', ac.tabla, v_set), '42501', v_pat_al,
      format('[%s] lo mismo con WHERE true', ac.nombre));
    PERFORM public.perm_falla(format('UPDATE public.%I %s WHERE now() IS NOT NULL', ac.tabla, v_set), '42501', v_pat_al,
      format('[%s] y con un WHERE que no lee ninguna columna de la fila', ac.nombre));
    PERFORM public.perm_como(aai);
    PERFORM public.perm_falla(format('UPDATE public.%I %s', ac.tabla, v_set), '42501', v_pat_al,
      format('[%s] el administrador asignado solo a A NO es exento: su UPDATE sin WHERE también muere en el documento de B', ac.nombre));
    PERFORM public.perm_como(ni);
    PERFORM public.perm_falla(format('UPDATE public.%I %s', ac.tabla, v_set), '42501',
      '^COMPRAS_PERMISO_ACCION: para .* tu perfil necesita el permiso',
      format('[%s] sin la llave (aunque vea A y B) se informa el PERMISO, no el proyecto', ac.nombre));
    -- UPDATE con WHERE por id del documento de B: la política SELECT lo esconde → 0 filas; y la función definer sí lo alcanza
    PERFORM public.perm_como(ki);
    PERFORM public.perm_filas(format('UPDATE public.%I %s WHERE id = %L', ac.tabla, v_set, public.perm_id(ac.i || 'x2', ac.tipo)), 0,
      format('[%s] CERO FILAS: el UPDATE por id de un documento de B (que no tiene asignado) afecta 0 filas', ac.nombre));
    PERFORM public.perm_falla(format('SELECT public.perm_definer_estado(%L, %L, %L, %L)', ac.tabla, public.perm_id(ac.i || 'x2', ac.tipo), ac.dest, ac.extra), '42501', v_pat_al,
      format('[%s] y una función SECURITY DEFINER con su WHERE por id, que sí llega a la fila de B, muere con COMPRAS_ALCANCE_PROYECTO', ac.nombre));
    -- otra empresa: la política UPDATE (empresa) deja fuera todas las filas
    PERFORM public.perm_como(zk);
    PERFORM public.perm_filas(format('UPDATE public.%I %s', ac.tabla, v_set), 0,
      format('[%s] CERO FILAS: persona de OTRA empresa con todas las llaves, UPDATE sin WHERE: la RLS no le deja ninguna fila', ac.nombre));
    PERFORM public.perm_como(NULL);
    EXECUTE format('SELECT count(*) FROM public.%I WHERE company_id = %L AND estado = %L', ac.tabla, E, ac.estado0) INTO v_n;
    PERFORM public.chk_txt(v_n, '2', format('[%s] los dos documentos siguen «%s»: ningún intento rechazado cambió nada', ac.nombre, ac.estado0));

    -- con la llave y asignado a A y B, el UPDATE sin WHERE pasa y afecta las DOS filas
    PERFORM public.perm_como(kab);
    PERFORM public.perm_filas(format('UPDATE public.%I %s', ac.tabla, v_set), 2,
      format('[%s] con la llave y asignado a A y B, el UPDATE sin WHERE pasa y afecta las 2 filas', ac.nombre));
    PERFORM public.perm_como(NULL);
    EXECUTE format('SELECT count(*) FROM public.%I WHERE company_id = %L AND estado = %L', ac.tabla, E, ac.dest) INTO v_n;
    PERFORM public.chk_txt(v_n, '2', format('[%s] y los dos quedaron «%s»', ac.nombre, ac.dest));

    -- ── Fase 2: documentos sueltos ──
    PERFORM public.perm_como(AD);
    PERFORM public.perm_cadena(ac.i || 'y1', E, A, P, ac.src);
    PERFORM public.perm_cadena(ac.i || 'y2', E, A, P, ac.src);
    PERFORM public.perm_cadena(ac.i || 'y3', E, B, P, ac.src);
    PERFORM public.perm_como(ki);
    -- UPDATE masivo con WHERE por columna: solo ve y toca los de A
    PERFORM public.perm_filas(format('UPDATE public.%I %s WHERE company_id = %L AND estado = %L', ac.tabla, v_set, E, ac.estado0), 2,
      format('[%s] UPDATE masivo con WHERE por columna: toca SOLO los 2 documentos de A (el de B no se ve)', ac.nombre));
    PERFORM public.perm_como(NULL);
    EXECUTE format('SELECT estado FROM public.%I WHERE id = %L', ac.tabla, public.perm_id(ac.i || 'y3', ac.tipo)) INTO v_estado;
    PERFORM public.chk_txt(v_estado, ac.estado0, format('[%s] y el documento de B quedó «%s»', ac.nombre, ac.estado0));

    PERFORM public.perm_como(AD);
    PERFORM public.perm_cadena(ac.i || 'y4', E, A, P, ac.src);
    PERFORM public.perm_cadena(ac.i || 'y5', E, B, P, ac.src);
    PERFORM public.perm_cadena(ac.i || 'y6', E, B, P, ac.src);
    PERFORM public.perm_cadena(ac.i || 'y7', E, B, P, ac.src);
    PERFORM public.perm_como(ki);
    PERFORM public.perm_filas(format('UPDATE public.%I %s WHERE id = %L', ac.tabla, v_set, public.perm_id(ac.i || 'y4', ac.tipo)), 1,
      format('[%s] con la llave y el proyecto asignado, por id, pasa', ac.nombre));
    PERFORM public.perm_como(AD);
    PERFORM public.perm_filas(format('UPDATE public.%I %s WHERE id = %L', ac.tabla, v_set, public.perm_id(ac.i || 'y5', ac.tipo)), 1,
      format('[%s] el administrador SIN asignaciones sigue actuando en B (exento de proyecto)', ac.nombre));
    PERFORM public.perm_como(ow);
    PERFORM public.perm_filas(format('UPDATE public.%I %s WHERE id = %L', ac.tabla, v_set, public.perm_id(ac.i || 'y6', ac.tipo)), 1,
      format('[%s] el propietario sigue actuando en B', ac.nombre));
    PERFORM public.perm_como(sa);
    PERFORM public.perm_filas(format('UPDATE public.%I %s WHERE id = %L', ac.tabla, v_set, public.perm_id(ac.i || 'y7', ac.tipo)), 1,
      format('[%s] el superadministrador (de otra empresa) sigue actuando en B', ac.nombre));
    PERFORM public.perm_como(NULL);

    -- ── Solo la orden de compra: en borrador puede cambiar de proyecto, y no se aprueba MOVIÉNDOLA a uno ajeno ──
    IF ac.i = 1 THEN
      PERFORM public.perm_como(AD);
      PERFORM public.perm_cadena('1m1', E, A, P, 'oc_borrador');
      PERFORM public.perm_cadena('1m2', E, A, P, 'oc_borrador');
      PERFORM public.perm_cadena('1m3', E, A, P, 'oc_borrador');
      PERFORM public.perm_como(ki);
      PERFORM public.perm_falla(format('UPDATE public.ordenes_compra SET project_id = %L, estado = %L WHERE id = %L', B, 'aprobada', public.perm_id('1m1', 'oc')), '42501', v_pat_al,
        '[aprobar_orden_compra] asignado solo a A: no aprueba una orden de A MOVIÉNDOLA al proyecto B en el mismo UPDATE (se verifica también el proyecto NUEVO)');
      PERFORM public.perm_como(NULL);
      SELECT project_id, estado INTO v_proj, v_estado FROM public.ordenes_compra WHERE id = public.perm_id('1m1', 'oc');
      PERFORM public.chk_uuid(v_proj, A, '[aprobar_orden_compra] y la orden sigue en el proyecto A');
      PERFORM public.chk_txt(v_estado, 'borrador', '[aprobar_orden_compra] y en borrador');
      PERFORM public.perm_como(kab);
      PERFORM public.perm_filas(format('UPDATE public.ordenes_compra SET project_id = %L, estado = %L WHERE id = %L', B, 'aprobada', public.perm_id('1m2', 'oc')), 1,
        '[aprobar_orden_compra] asignado a A y B sí puede moverla y aprobarla');
      -- una orden sin proyecto es de la empresa: quien tiene la llave la aprueba
      PERFORM public.perm_como(AD);
      UPDATE public.ordenes_compra SET project_id = NULL WHERE id = public.perm_id('1m3', 'oc');
      PERFORM public.perm_como(ki);
      PERFORM public.perm_filas(format('UPDATE public.ordenes_compra %s WHERE id = %L', v_set, public.perm_id('1m3', 'oc')), 1,
        '[aprobar_orden_compra] una orden SIN proyecto es de la empresa: quien tiene la llave la aprueba');
      PERFORM public.perm_como(NULL);
    END IF;
  END LOOP;
END;
$alcance$;

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
