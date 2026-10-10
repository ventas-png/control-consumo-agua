\set ON_ERROR_STOP on
-- ============================================================================
-- PERM-4 · El ALCANCE (empresa y proyecto) rige TODA acción de estado sobre los documentos de compras —no solo las seis—,
--          mover un documento no es un atajo para aprobarlo, el texto del permiso genérico no cambió y la comprobación
--          de empresa es NULL-segura.
--
-- CAUSA RAÍZ (revisión del escéptico de la ronda 1: H-1, F-2, F-3, F-4)
--   · H-1 · Emitir / cancelar / cerrar la orden de compra y anular una recepción, una factura o una contraseña seguían con
--     `compras_exigir_accion('change_status')`, que NO mira la empresa ni el proyecto del documento: una persona asignada
--     solo al proyecto A, con `change_status`, anulaba la factura del proyecto B con un UPDATE sin WHERE o por una función
--     SECURITY DEFINER; y la de otra empresa, por la función definer.
--   · F-2 · La comprobación de proyecto solo corría al cambiar el ESTADO. La orden en borrador y la factura de gasto directo
--     pueden cambiar de `project_id`, la RLS de UPDATE no mira el proyecto, y un UPDATE que no lee columnas de la fila (o una
--     función definer) las movía «a mi proyecto» para aprobarlas después de forma legítima.
--   · F-3 · `p_company_id = get_my_company_id()` da NULL si la sesión no tiene empresa: el `IF NOT NULL` no entraba y un
--     administrador sin empresa pasaba por cualquier empresa vía una función definer.
--   · F-4 · La comprobación del proyecto NUEVO en el disparador de la factura no la cubría ninguna prueba.
--   · H2-2 / H2-3 (segundo escéptico) · Tres cláusulas del disparador de mover (el salto de eliminar un proyecto, el origen con destino NULL y el
--     cambio solo de empresa) y el orden empresa → permiso no las cubría ninguna prueba; y la orden de pago en borrador SÍ puede cambiar de
--     proyecto al anularse (borrador → anulada), así que su bloque NUEVO del permiso es alcanzable, no «defensa en profundidad inalcanzable».
--
-- COMPORTAMIENTO ESPERADO (E: empresa con proyectos A y B; ua/uab/uf/uo/cr: operadores asignados solo a A, o a A y B)
--   · Con la llave y la asignación solo a A, cada una de las seis acciones de H-1 sobre el documento de B muere con
--     COMPRAS_ALCANCE_PROYECTO (42501) —función definer, o UPDATE sin WHERE— y sobre el de A pasa; asignada a A y B, pasa en B.
--   · El administrador de OTRA empresa muere con COMPRAS_ALCANCE_EMPRESA en las seis acciones, por la función definer.
--   · Quien no tiene `change_status` recibe el texto de siempre: «… necesita el permiso «Cambiar estado — Contabilidad».»,
--     idéntico al de `compras_exigir_accion`.
--   · Mover un documento (project_id / company_id) exige la empresa de la sesión (origen y destino) y el acceso al proyecto de
--     origen y al de destino; sin eso muere con COMPRAS_ALCANCE_EMPRESA / COMPRAS_ALCANCE_PROYECTO por la función definer y por un
--     UPDATE sin WHERE; asignada a los dos proyectos, mueve. Un `SET project_id = <el mismo>` no mueve nada y no se toca.
--   · Mover Y cambiar el estado en la misma sentencia: el error es el del PERMISO (con el paso de la acción), no el de mover:
--     el disparador de mover dispara después de los de permiso, sellos y alcance de referencias.
--   · Sacar «sin proyecto» (destino NULL = de la empresa) el documento de un proyecto AJENO también muere con COMPRAS_ALCANCE_PROYECTO («en que
--     está hoy»), y mandar a OTRA empresa un documento sin proyecto (cambia solo la empresa) muere con COMPRAS_ALCANCE_EMPRESA.
--   · Una persona de OTRA empresa que ni siquiera tiene la llave recibe COMPRAS_ALCANCE_EMPRESA, no COMPRAS_PERMISO_ACCION (empresa → permiso → proyecto).
--   · Qué documentos pueden cambiar de proyecto en la misma sentencia que su estado (§5): la orden en borrador, la factura de gasto directo, la
--     contraseña sin partidas y —al ANULARSE— la orden de pago en borrador (su bloque NUEVO del permiso es alcanzable y se prueba); la recepción,
--     la orden de pago aprobada o pagada y las órdenes aprobadas / emitidas, no (otro control las frena antes).
--   · Eliminar un proyecto (acción referencial ON DELETE SET NULL) lo puede hacer un administrador con asignaciones sin que
--     mover lo frene; los documentos quedan sin proyecto.
--   · Un administrador SIN empresa no pasa por ninguna empresa.
--
-- Ids propios: md5('perm:PERM-4:…') (perm_id). Empresas E, F y M, y sus personas, propias de esta prueba.
--
-- ⚠ SOLO clúster local; nunca contra sandbox/producción. Crea funciones auxiliares perm_* (una es SECURITY DEFINER y
--   ejecutable por `authenticated`, para modelar una RPC) y empresas de prueba que NO se pueden borrar (los documentos de
--   compras no se borran). Las ayudas se borran al final (DROP FUNCTION IF EXISTS) y una comprobación final exige que no quede
--   ninguna; los datos 'PERM-…' sí quedan en la base. Lo corre run.sh sobre su clúster desechable.
-- ============================================================================

-- Espacio de nombres de los identificadores de esta prueba (ver perm_id)
SELECT set_config('perm.ns', 'PERM-4', false);
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
-- 0 · PADRÓN (superusuario)
--   Empresa E (proyectos A y B): ua [A] y uab [A,B] con view/create/edit + los genéricos · uf [A] con la llave de aprobar facturas
--   · uo [A] con la llave de la orden · cr [A] con view/create/edit y NADA más · documentos de cada tipo en A y en B.
--   Empresa F (su administrador FAD, exento de proyecto; fcr: persona de F sin ninguna llave) · empresa M (para las sentencias a ciegas, SOLO con sus documentos)
--   · nc: administrador SIN empresa · adm2: administrador de E con asignaciones a A y al proyecto G que se elimina (no es exento ni antes ni después)
--   · up [A] y upab [A, B]: con la llave de anular un pago · od_n: orden borrador de E SIN proyecto.
-- ═══════════════════════════════════════════════════════════════════════════
DO $padron$
DECLARE
  E constant uuid := public.perm_id('E', 'co');  A constant uuid := public.perm_id('A', 'pa');  B constant uuid := public.perm_id('B', 'pb');
  P constant uuid := public.perm_id('P', 'pv');  AD constant uuid := public.perm_id('AD', 'u');
  F constant uuid := public.perm_id('F', 'co');  FA constant uuid := public.perm_id('FA', 'pa'); FB constant uuid := public.perm_id('FB', 'pb');
  FP constant uuid := public.perm_id('FP', 'pv'); FAD constant uuid := public.perm_id('FAD', 'u');
  M constant uuid := public.perm_id('M', 'co');  MA constant uuid := public.perm_id('MA', 'pa'); MB constant uuid := public.perm_id('MB', 'pb');
  MP constant uuid := public.perm_id('MP', 'pv'); MAD constant uuid := public.perm_id('MAD', 'u');
  ua constant uuid := public.perm_id('ua', 'u');  uab constant uuid := public.perm_id('uab', 'u');  uf constant uuid := public.perm_id('uf', 'u');
  uo constant uuid := public.perm_id('uo', 'u');  cr constant uuid := public.perm_id('cr', 'u');   um constant uuid := public.perm_id('um', 'u');
  nc constant uuid := public.perm_id('nc', 'u');  adm2 constant uuid := public.perm_id('adm2', 'u');
  fcr constant uuid := public.perm_id('fcr', 'u');  up constant uuid := public.perm_id('up', 'u');  upab constant uuid := public.perm_id('upab', 'u');
  v_base text[] := ARRAY['platform.contabilidad.view', 'platform.contabilidad.create', 'platform.contabilidad.edit'];
  v_gen  text[] := ARRAY['platform.contabilidad.approve', 'platform.contabilidad.change_status'];
BEGIN
  PERFORM public.perm_como(NULL);
  PERFORM public.perm_empresa(E, A, B, P, AD, 'PERM-4 Empresa E');
  PERFORM public.perm_empresa(F, FA, FB, FP, FAD, 'PERM-4 Empresa F');
  PERFORM public.perm_empresa(M, MA, MB, MP, MAD, 'PERM-4 Empresa M');
  PERFORM public.perm_persona(ua,  E, 'PERM-4 ua (solo A)',          ARRAY[A]);    PERFORM public.perm_rol(ua,  E, 'base y genéricos', v_base || v_gen);
  PERFORM public.perm_persona(uab, E, 'PERM-4 uab (A y B)',          ARRAY[A, B]); PERFORM public.perm_rol(uab, E, 'base y genéricos', v_base || v_gen);
  PERFORM public.perm_persona(uf,  E, 'PERM-4 uf (A, aprueba facturas)', ARRAY[A]); PERFORM public.perm_rol(uf, E, 'solo factura_aprobar', v_base || ARRAY['platform.contabilidad.compras.factura_aprobar']);
  PERFORM public.perm_persona(uo,  E, 'PERM-4 uo (A, aprueba órdenes)',  ARRAY[A]); PERFORM public.perm_rol(uo, E, 'solo la llave de la orden', v_base || ARRAY['condominios.tab.ordenes_compra.approve']);
  PERFORM public.perm_persona(cr,  E, 'PERM-4 cr (A, sin nada)',     ARRAY[A]);    PERFORM public.perm_rol(cr,  E, 'solo base', v_base);
  PERFORM public.perm_persona(um,  M, 'PERM-4 um (solo MA)',         ARRAY[MA]);   PERFORM public.perm_rol(um,  M, 'base y genéricos', v_base || v_gen);
  -- fcr: persona de OTRA empresa (F), con view/create/edit y ninguna llave de acción · up / upab: de E con la llave de anular un pago, solo A / A y B
  PERFORM public.perm_persona(fcr, F, 'PERM-4 fcr (de F, sin llaves)', ARRAY[FA]);   PERFORM public.perm_rol(fcr, F, 'solo base', v_base);
  PERFORM public.perm_persona(up,  E, 'PERM-4 up (solo A, anula pagos)', ARRAY[A]);  PERFORM public.perm_rol(up,  E, 'solo pago_anular', v_base || ARRAY['platform.contabilidad.compras.pago_anular']);
  PERFORM public.perm_persona(upab, E, 'PERM-4 upab (A y B, anula pagos)', ARRAY[A, B]); PERFORM public.perm_rol(upab, E, 'solo pago_anular', v_base || ARRAY['platform.contabilidad.compras.pago_anular']);
  -- un administrador SIN empresa (app_users.company_id admite NULL)
  INSERT INTO auth.users (id) VALUES (nc);
  INSERT INTO public.app_users (id, company_id, full_name, role) VALUES (nc, NULL, 'PERM-4 administrador sin empresa', 'admin');
  -- un administrador de E con asignaciones a A y a un proyecto G que se eliminará (no es exento de proyecto, ni antes ni después de eliminarlo)
  PERFORM public.perm_persona(adm2, E, 'PERM-4 administrador de E (A y G)', ARRAY[A], 'admin');   -- con A además de G: al borrar G sigue sin ser exento
  SET LOCAL session_replication_role = replica;      -- sin el tope de proyectos del plan ni la siembra contable (no es lo que se prueba)
  INSERT INTO public.projects (id, company_id, nombre) VALUES (public.perm_id('G', 'pg'), E, 'PERM-4 E · G (se elimina)');
  SET LOCAL session_replication_role = origin;
  INSERT INTO public.user_project_assignments (user_id, project_id, permission_type) VALUES (adm2, public.perm_id('G', 'pg'), 'total');

  -- Documentos de E, en A y en B (los arma el administrador exento)
  PERFORM public.perm_como(AD);
  PERFORM public.perm_cadena('oa_a', E, A, P, 'oc_aprobada');    PERFORM public.perm_cadena('oa_b', E, B, P, 'oc_aprobada');     -- emitir
  PERFORM public.perm_cadena('od_a', E, A, P, 'oc_borrador');    PERFORM public.perm_cadena('od_b', E, B, P, 'oc_borrador');     -- cancelar / mover
  PERFORM public.perm_cadena('od2_a', E, A, P, 'oc_borrador');   PERFORM public.perm_cadena('od3_a', E, A, P, 'oc_borrador');   -- mover con éxito
  PERFORM public.perm_cadena('od4_a', E, A, P, 'oc_borrador');   PERFORM public.perm_cadena('od5_a', E, A, P, 'oc_borrador');   -- mover como proceso de sistema
  PERFORM public.perm_cadena('od_n', E, NULL, P, 'oc_borrador');                                                                 -- SIN proyecto: mover de empresa
  PERFORM public.perm_cadena('ce_a', E, A, P, 'oc_emitida');     PERFORM public.perm_cadena('ce_b', E, B, P, 'oc_emitida');      -- cerrar
  PERFORM public.perm_cadena('rb_a', E, A, P, 'rec_borrador');   PERFORM public.perm_cadena('rb_b', E, B, P, 'rec_borrador');    -- anular recepción
  PERFORM public.perm_cadena('fr_a', E, A, P, 'fac_registrada'); PERFORM public.perm_cadena('fr_b', E, B, P, 'fac_registrada');  -- anular factura
  PERFORM public.perm_cadena('fa_a', E, A, P, 'fac_aprobada');   PERFORM public.perm_cadena('fa_b', E, B, P, 'fac_aprobada');    -- contraseña con partida
  INSERT INTO public.contrasenas_pago (id, company_id, project_id, proveedor_id, fecha_pago_programada) VALUES
    (public.perm_id('fa_a', 'cp'), E, A, P, current_date + 30), (public.perm_id('fa_b', 'cp'), E, B, P, current_date + 30),
    (public.perm_id('cp0_a', 'cp'), E, A, P, current_date + 30), (public.perm_id('cp0_b', 'cp'), E, B, P, current_date + 30);   -- cp0_*: SIN partidas
  INSERT INTO public.contrasena_pago_facturas (company_id, contrasena_id, factura_id, monto) VALUES
    (E, public.perm_id('fa_a', 'cp'), public.perm_id('fa_a', 'fac'), 100), (E, public.perm_id('fa_b', 'cp'), public.perm_id('fa_b', 'fac'), 100);
  -- facturas de gasto directo (sin orden de compra que las ancle a su proyecto), registradas, en A y en B
  INSERT INTO public.facturas_proveedor (id, company_id, project_id, proveedor_id, numero_factura, concepto, monto_total) VALUES
    (public.perm_id('gd_a', 'fac'), E, A, P, 'GD-A', 'gasto directo A', 1), (public.perm_id('gd_b', 'fac'), E, B, P, 'GD-B', 'gasto directo B', 1);
  INSERT INTO public.factura_proveedor_lineas (company_id, factura_id, linea, descripcion, cantidad, precio_unitario, iva_monto) VALUES
    (E, public.perm_id('gd_a', 'fac'), 1, 'gasto', 1, 100, 0), (E, public.perm_id('gd_b', 'fac'), 1, 'gasto', 1, 100, 0);
  -- documentos para la alcanzabilidad (§5): cada uno solo lo toca el administrador
  PERFORM public.perm_cadena('u_rb', E, A, P, 'rec_borrador');   PERFORM public.perm_cadena('u_ob', E, A, P, 'op_borrador');
  PERFORM public.perm_cadena('u_oa', E, A, P, 'oc_aprobada');    PERFORM public.perm_cadena('u_ce', E, A, P, 'oc_emitida');
  PERFORM public.perm_cadena('u_ob2', E, A, P, 'op_borrador');   PERFORM public.perm_cadena('u_oap', E, A, P, 'op_aprobada');   -- orden de pago: anular en borrador / otros estados
  -- Documentos de F (los arma su administrador) y de M (para las sentencias a ciegas: solo estos)
  PERFORM public.perm_como(FAD);
  PERFORM public.perm_cadena('fo', F, FA, FP, 'oc_borrador');
  PERFORM public.perm_como(MAD);
  PERFORM public.perm_cadena('mo_a', M, MA, MP, 'oc_borrador');  PERFORM public.perm_cadena('mo_b', M, MB, MP, 'oc_borrador');
  INSERT INTO public.facturas_proveedor (id, company_id, project_id, proveedor_id, numero_factura, concepto, monto_total) VALUES
    (public.perm_id('mf_a', 'fac'), M, MA, MP, 'MF-A', 'gasto directo MA', 1), (public.perm_id('mf_b', 'fac'), M, MB, MP, 'MF-B', 'gasto directo MB', 1);
  INSERT INTO public.factura_proveedor_lineas (company_id, factura_id, linea, descripcion, cantidad, precio_unitario, iva_monto) VALUES
    (M, public.perm_id('mf_a', 'fac'), 1, 'gasto', 1, 100, 0), (M, public.perm_id('mf_b', 'fac'), 1, 'gasto', 1, 100, 0);
  PERFORM public.perm_como(NULL);
END;
$padron$;

-- ═══════════════════════════════════════════════════════════════════════════
-- 1 · H-1 · Las cinco acciones que NO son de las seis (más cerrar la orden) respetan el proyecto
--     (persona asignada SOLO a A, con change_status genérico; el documento de B lo alcanza una función definer o un UPDATE sin WHERE)
-- ═══════════════════════════════════════════════════════════════════════════
DO $h1$
DECLARE
  E constant uuid := public.perm_id('E', 'co');
  ua constant uuid := public.perm_id('ua', 'u');
  um constant uuid := public.perm_id('um', 'u');
  v_n bigint;
  ac record;
BEGIN
  PERFORM public.perm_como(ua);
  FOR ac IN
    SELECT * FROM (VALUES
      ('emitir la orden',      'ordenes_compra',     'oc',  'oa', 'emitida',   'emitir una orden de compra al proveedor'),
      ('cancelar la orden',    'ordenes_compra',     'oc',  'od', 'cancelada', 'cancelar una orden de compra'),
      ('cerrar la orden',      'ordenes_compra',     'oc',  'ce', 'cerrada',   'cerrar una orden de compra'),
      ('anular la recepción',  'recepciones',        'rec', 'rb', 'anulada',   'anular una recepción'),
      ('anular la factura',    'facturas_proveedor', 'fac', 'fr', 'anulada',   'anular una factura de proveedor'),
      ('anular la contraseña', 'contrasenas_pago',   'cp',  'fa', 'anulada',   'anular una contraseña de pago')
    ) AS v(nombre, tabla, tipo, pref, dest, paso)
  LOOP
    PERFORM public.perm_falla(format('SELECT public.perm_definer_estado(%L, %L, %L)', ac.tabla, public.perm_id(ac.pref || '_b', ac.tipo), ac.dest), '42501',
      format('^COMPRAS_ALCANCE_PROYECTO: para %s tu perfil necesita estar asignado al proyecto del documento\.$', ac.paso),
      format('[H-1 · %s] asignado SOLO a A: una función definer que llega al documento de B muere con COMPRAS_ALCANCE_PROYECTO', ac.nombre));
  END LOOP;
  PERFORM public.perm_como(NULL);

  -- UPDATE sin WHERE (no lee columnas: llega a TODA la empresa M): muere y no deja anulada ni la factura de MA, que sí podía
  PERFORM public.perm_como(um);
  PERFORM public.perm_falla('UPDATE public.facturas_proveedor SET estado = ''anulada''', '42501',
    '^COMPRAS_ALCANCE_PROYECTO: para anular una factura de proveedor tu perfil necesita estar asignado al proyecto del documento\.$',
    '[H-1 · anular la factura] el UPDATE sin WHERE alcanza la factura de MB y muere (no anula ni la de MA: es una sola sentencia)');
  PERFORM public.perm_como(NULL);
  SELECT count(*) INTO v_n FROM public.facturas_proveedor WHERE company_id = public.perm_id('M', 'co') AND estado = 'anulada';
  PERFORM public.chk(v_n, 0, '[H-1] ninguna factura de M quedó anulada');
END;
$h1$;

-- ═══════════════════════════════════════════════════════════════════════════
-- 2 · El texto de «falta el permiso» sigue siendo el del genérico de siempre
--     (cr: view/create/edit sin change_status; actúa sobre documentos de SU proyecto A)
-- ═══════════════════════════════════════════════════════════════════════════
DO $texto$
DECLARE
  E constant uuid := public.perm_id('E', 'co');  A constant uuid := public.perm_id('A', 'pa');  P constant uuid := public.perm_id('P', 'pv');
  cr constant uuid := public.perm_id('cr', 'u');  uo constant uuid := public.perm_id('uo', 'u');
  v_real text; v_viejo text;
  ac record;
BEGIN
  FOR ac IN
    SELECT * FROM (VALUES
      ('emitir la orden',      'UPDATE public.ordenes_compra SET estado = ''emitida''   WHERE id = ''' || public.perm_id('oa_a', 'oc')  || '''', 'emitir una orden de compra al proveedor'),
      ('cancelar la orden',    'UPDATE public.ordenes_compra SET estado = ''cancelada'' WHERE id = ''' || public.perm_id('od_a', 'oc')  || '''', 'cancelar una orden de compra'),
      ('cerrar la orden',      'UPDATE public.ordenes_compra SET estado = ''cerrada''   WHERE id = ''' || public.perm_id('ce_a', 'oc')  || '''', 'cerrar una orden de compra'),
      ('anular la recepción',  'UPDATE public.recepciones SET estado = ''anulada''      WHERE id = ''' || public.perm_id('rb_a', 'rec') || '''', 'anular una recepción'),
      ('anular la factura',    'UPDATE public.facturas_proveedor SET estado = ''anulada'' WHERE id = ''' || public.perm_id('fr_a', 'fac') || '''', 'anular una factura de proveedor'),
      ('anular la contraseña', 'UPDATE public.contrasenas_pago SET estado = ''anulada'' WHERE id = ''' || public.perm_id('fa_a', 'cp')  || '''', 'anular una contraseña de pago')
    ) AS v(nombre, sql, paso)
  LOOP
    PERFORM public.perm_como(NULL);
    PERFORM public.perm_sub(cr);                 -- la función interna la ejecuta el superusuario con el `sub` de la persona
    v_viejo := public.perm_error(format('SELECT public.compras_exigir_accion(%L, %L)', 'change_status', ac.paso));
    PERFORM public.perm_como(cr);
    v_real := public.perm_error(ac.sql);
    PERFORM public.perm_como(NULL);
    PERFORM public.chk_txt(v_real, format('42501 COMPRAS_PERMISO_ACCION: para %s tu perfil necesita el permiso «Cambiar estado — Contabilidad».', ac.paso),
      format('[texto · %s] sin change_status: el mensaje es el de siempre, con «Cambiar estado — Contabilidad»', ac.nombre));
    PERFORM public.chk_txt(v_real, v_viejo, format('[texto · %s] y es idéntico, letra por letra, al de compras_exigir_accion', ac.nombre));
  END LOOP;

  -- nacer «emitida»: la llave de la orden sola no alcanza, falta change_status (mismo texto de siempre)
  PERFORM public.perm_como(NULL);
  PERFORM public.perm_sub(uo);
  v_viejo := public.perm_error(format('SELECT public.compras_exigir_accion(%L, %L)', 'change_status', 'crear una orden de compra ya emitida'));
  PERFORM public.perm_como(uo);
  v_real := public.perm_error(format('INSERT INTO public.ordenes_compra (id, company_id, project_id, proveedor_id, proveedor_nombre, concepto, estado) VALUES (%L, %L, %L, %L, %L, %L, %L)',
                                     public.perm_id('t_ins', 'oc'), E, A, P, 'Proveedor PERM', 'PERM-4 nace emitida', 'emitida'));
  PERFORM public.perm_como(NULL);
  PERFORM public.chk_txt(v_real, v_viejo, '[texto · nacer emitida] con la llave de la orden pero sin change_status: el mismo texto de siempre');
  PERFORM public.chk_txt(v_real, '42501 COMPRAS_PERMISO_ACCION: para crear una orden de compra ya emitida tu perfil necesita el permiso «Cambiar estado — Contabilidad».',
    '[texto · nacer emitida] y dice «Cambiar estado — Contabilidad»');
END;
$texto$;

-- ═══════════════════════════════════════════════════════════════════════════
-- 3 · H-1 · de OTRA empresa: el administrador de F no toca los documentos de E por una función definer (las seis acciones)
-- ═══════════════════════════════════════════════════════════════════════════
DO $h1emp$
DECLARE
  FAD constant uuid := public.perm_id('FAD', 'u');
  ac record;
BEGIN
  PERFORM public.perm_como(FAD);
  FOR ac IN
    SELECT * FROM (VALUES
      ('cancelar la orden',    'ordenes_compra',     'oc',  'od', 'cancelada', 'cancelar una orden de compra'),
      ('cerrar la orden',      'ordenes_compra',     'oc',  'ce', 'cerrada',   'cerrar una orden de compra'),
      ('anular la recepción',  'recepciones',        'rec', 'rb', 'anulada',   'anular una recepción'),
      ('anular la factura',    'facturas_proveedor', 'fac', 'fr', 'anulada',   'anular una factura de proveedor'),
      ('anular la contraseña', 'contrasenas_pago',   'cp',  'fa', 'anulada',   'anular una contraseña de pago')
    ) AS v(nombre, tabla, tipo, pref, dest, paso)
  LOOP
    PERFORM public.perm_falla(format('SELECT public.perm_definer_estado(%L, %L, %L)', ac.tabla, public.perm_id(ac.pref || '_a', ac.tipo), ac.dest), '42501',
      format('^COMPRAS_ALCANCE_EMPRESA: para %s el documento tiene que ser de la empresa de tu sesión\.$', ac.paso),
      format('[H-1 · empresa · %s] el administrador de OTRA empresa muere con COMPRAS_ALCANCE_EMPRESA (función definer)', ac.nombre));
  END LOOP;
  -- Emitir la orden: antes del permiso actúa el control de proveedor autorizado, que desde la sesión de OTRA empresa no ve al
  -- proveedor de E (el mismo comportamiento que documenta PERM-1): se rechaza igual, por ese control (el alcance de empresa de
  -- emitir es el mismo código que el de cancelar y cerrar, que sí llegan a él).
  PERFORM public.perm_falla(format('SELECT public.perm_definer_estado(%L, %L, %L)', 'ordenes_compra', public.perm_id('oa_a', 'oc'), 'emitida'), '23514',
    '^COMPRAS_PROVEEDOR_NO_AUTORIZADO',
    '[H-1 · empresa · emitir la orden] el administrador de OTRA empresa tampoco emite la orden de E (la frena antes el control de proveedor autorizado)');
  PERFORM public.perm_como(NULL);

  -- Una persona de OTRA empresa SIN la llave de la acción recibe el error de EMPRESA, no el de permiso: el orden de las comprobaciones
  -- (empresa → permiso → proyecto) hace que no se averigüe nada de una empresa ajena ni siquiera para decir «te falta tal llave».
  -- (fcr: persona de F con view/create/edit y ninguna llave. Mutante S5: el permiso antes que la empresa.)
  PERFORM public.perm_como(public.perm_id('fcr', 'u'));
  FOR ac IN
    SELECT * FROM (VALUES
      ('aprobar una orden de pago',  'ordenes_pago',       'op',  'u_ob', 'aprobada', 'aprobar una orden de pago'),
      ('cancelar la orden',          'ordenes_compra',     'oc',  'od',   'cancelada', 'cancelar una orden de compra'),
      ('anular la factura',          'facturas_proveedor', 'fac', 'fr',   'anulada',   'anular una factura de proveedor')
    ) AS v(nombre, tabla, tipo, pref, dest, paso)
  LOOP
    PERFORM public.perm_falla(format('SELECT public.perm_definer_estado(%L, %L, %L)', ac.tabla,
                                     public.perm_id(CASE WHEN ac.pref = 'u_ob' THEN ac.pref ELSE ac.pref || '_a' END, ac.tipo), ac.dest), '42501',
      format('^COMPRAS_ALCANCE_EMPRESA: para %s el documento tiene que ser de la empresa de tu sesión\.$', ac.paso),
      format('[H-1 · empresa sin la llave · %s] una persona de OTRA empresa que tampoco tiene la llave recibe COMPRAS_ALCANCE_EMPRESA, no COMPRAS_PERMISO_ACCION', ac.nombre));
  END LOOP;
  PERFORM public.perm_como(NULL);
END;
$h1emp$;

-- ═══════════════════════════════════════════════════════════════════════════
-- 4 · Mover el documento de proyecto o de empresa (disparador trg_zzcompras_mover_alcance)
-- ═══════════════════════════════════════════════════════════════════════════
DO $mover$
DECLARE
  E constant uuid := public.perm_id('E', 'co');  A constant uuid := public.perm_id('A', 'pa');  B constant uuid := public.perm_id('B', 'pb');
  P constant uuid := public.perm_id('P', 'pv');
  M constant uuid := public.perm_id('M', 'co');  MA constant uuid := public.perm_id('MA', 'pa');
  F constant uuid := public.perm_id('F', 'co');  FAD constant uuid := public.perm_id('FAD', 'u');
  ua constant uuid := public.perm_id('ua', 'u');  uab constant uuid := public.perm_id('uab', 'u');  uf constant uuid := public.perm_id('uf', 'u');
  uo constant uuid := public.perm_id('uo', 'u');  cr constant uuid := public.perm_id('cr', 'u');   um constant uuid := public.perm_id('um', 'u');
  v_pat_ori constant text := '^COMPRAS_ALCANCE_PROYECTO: para mover un documento de compras tu perfil necesita estar asignado al proyecto en que está hoy\.$';
  v_pat_des constant text := '^COMPRAS_ALCANCE_PROYECTO: para mover un documento de compras tu perfil necesita estar asignado al proyecto de destino\.$';
  v_pat_emp constant text := '^COMPRAS_ALCANCE_EMPRESA: para mover un documento de compras el documento tiene que ser de la empresa de tu sesión, y seguir en ella\.$';
  v_pj uuid; v_est text;
BEGIN
  -- ── (a) función definer: de B a A (origen ajeno) y de A a B (destino ajeno), orden en borrador y factura de gasto directo ──
  PERFORM public.perm_como(ua);
  PERFORM public.perm_falla(format('SELECT public.perm_definer_estado(%L, %L, %L, %L)', 'ordenes_compra', public.perm_id('od_b', 'oc'), 'borrador', format(', project_id = %L', A)), '42501', v_pat_ori,
    '[mover] asignado solo a A: una función definer no mueve la orden borrador de B al proyecto A (origen ajeno)');
  PERFORM public.perm_falla(format('SELECT public.perm_definer_estado(%L, %L, %L, %L)', 'facturas_proveedor', public.perm_id('gd_b', 'fac'), 'registrada', format(', project_id = %L', A)), '42501', v_pat_ori,
    '[mover] ni la factura de gasto directo de B (no tiene orden que la ancle a su proyecto)');
  PERFORM public.perm_falla(format('SELECT public.perm_definer_estado(%L, %L, %L, %L)', 'ordenes_compra', public.perm_id('od_a', 'oc'), 'borrador', format(', project_id = %L', B)), '42501', v_pat_des,
    '[mover] ni su propia orden borrador de A al proyecto B (destino ajeno)');
  PERFORM public.perm_falla(format('SELECT public.perm_definer_estado(%L, %L, %L, %L)', 'facturas_proveedor', public.perm_id('gd_a', 'fac'), 'registrada', format(', project_id = %L', B)), '42501', v_pat_des,
    '[mover] ni su propia factura de gasto directo de A al proyecto B (destino ajeno)');
  -- ── (a2) destino «sin proyecto»: sacar del proyecto AJENO un documento no se permite aunque el destino (NULL = de la empresa) sea de todos ──
  -- Mutantes S1 (el salto de eliminar un proyecto sin comprobar que el proyecto YA NO existe) y S14 (sin mirar el origen si el destino es NULL):
  -- ambos dejaban a una persona asignada solo a A mandar «sin proyecto» (visible para toda la empresa) el documento de B.
  PERFORM public.perm_falla(format('SELECT public.perm_definer_estado(%L, %L, %L, %L)', 'ordenes_compra', public.perm_id('od_b', 'oc'), 'borrador', ', project_id = NULL'), '42501', v_pat_ori,
    '[mover] asignado solo a A: una función definer no manda «sin proyecto» la orden borrador de B (origen ajeno: el destino NULL no lo exime)');
  PERFORM public.perm_falla(format('SELECT public.perm_definer_estado(%L, %L, %L, %L)', 'facturas_proveedor', public.perm_id('gd_b', 'fac'), 'registrada', ', project_id = NULL'), '42501', v_pat_ori,
    '[mover] ni la factura de gasto directo de B');
  PERFORM public.perm_como(NULL);
  SELECT project_id INTO v_pj FROM public.ordenes_compra WHERE id = public.perm_id('od_b', 'oc');
  PERFORM public.chk_uuid(v_pj, B, '[mover] la orden de B sigue en B (no quedó sin proyecto)');
  SELECT project_id INTO v_pj FROM public.facturas_proveedor WHERE id = public.perm_id('gd_b', 'fac');
  PERFORM public.chk_uuid(v_pj, B, '[mover] y la factura de gasto directo de B también');

  -- ── (a3) cambio SOLO de empresa en un documento sin proyecto: el proyecto no cambia (NULL → NULL) y aun así la empresa se mira ──
  -- Mutante S3 (retornar si el proyecto no cambia, sin mirar la empresa): una función definer mandaba la orden sin proyecto de E a la empresa F.
  PERFORM public.perm_como(ua);
  PERFORM public.perm_falla(format('SELECT public.perm_definer_estado(%L, %L, %L, %L)', 'ordenes_compra', public.perm_id('od_n', 'oc'), 'borrador',
                                   format(', company_id = %L, proveedor_id = %L', F, public.perm_id('FP', 'pv'))), '42501', v_pat_emp,
    '[mover · empresa] asignado solo a A: una función definer no manda a la empresa F la orden SIN proyecto de E (cambia solo la empresa)');
  PERFORM public.perm_como(NULL);
  SELECT company_id INTO v_pj FROM public.ordenes_compra WHERE id = public.perm_id('od_n', 'oc');
  PERFORM public.chk_uuid(v_pj, E, '[mover · empresa] la orden sin proyecto sigue en la empresa E');

  -- ── (b) a ciegas: UPDATE sin WHERE (no lee columnas, la política SELECT no esconde nada) en una empresa con SOLO estos documentos ──
  PERFORM public.perm_como(um);
  PERFORM public.perm_falla(format('UPDATE public.ordenes_compra SET project_id = %L', MA), '42501', v_pat_ori,
    '[mover · a ciegas] asignado solo a MA: el UPDATE sin WHERE que «trae todo a mi proyecto» muere al llegar a la orden de MB');
  PERFORM public.perm_falla(format('UPDATE public.facturas_proveedor SET project_id = %L', MA), '42501', v_pat_ori,
    '[mover · a ciegas] y a la factura de gasto directo de MB');
  PERFORM public.perm_como(NULL);
  SELECT project_id INTO v_pj FROM public.ordenes_compra WHERE id = public.perm_id('mo_b', 'oc');
  PERFORM public.chk_uuid(v_pj, public.perm_id('MB', 'pb'), '[mover · a ciegas] la orden de MB sigue en MB');
  SELECT project_id INTO v_pj FROM public.facturas_proveedor WHERE id = public.perm_id('mf_b', 'fac');
  PERFORM public.chk_uuid(v_pj, public.perm_id('MB', 'pb'), '[mover · a ciegas] y la factura de MB sigue en MB');

  -- ── (c) mover Y cambiar de estado: el error es el del PERMISO, con el paso de la acción (dispara antes que mover) ──
  -- El documento está en A (origen permitido) y el mismo UPDATE lo manda a B: solo el bloque del proyecto NUEVO de cada disparador lo detiene.
  PERFORM public.perm_como(uo);
  PERFORM public.perm_falla(format('SELECT public.perm_definer_estado(%L, %L, %L, %L)', 'ordenes_compra', public.perm_id('od_a', 'oc'), 'aprobada', format(', project_id = %L', B)), '42501',
    '^COMPRAS_ALCANCE_PROYECTO: para aprobar una orden de compra tu perfil necesita estar asignado al proyecto del documento\.$',
    '[mover + estado · orden] aprobar la orden de A y mandarla a B en la misma sentencia: lo detiene el permiso de aprobar (proyecto NUEVO)');
  PERFORM public.perm_como(ua);
  PERFORM public.perm_falla(format('SELECT public.perm_definer_estado(%L, %L, %L, %L)', 'ordenes_compra', public.perm_id('od_a', 'oc'), 'cancelada', format(', project_id = %L', B)), '42501',
    '^COMPRAS_ALCANCE_PROYECTO: para cancelar una orden de compra tu perfil necesita estar asignado al proyecto del documento\.$',
    '[mover + estado · orden] cancelar la orden de A y mandarla a B: lo detiene el permiso de cancelar (proyecto NUEVO)');
  PERFORM public.perm_falla(format('SELECT public.perm_definer_estado(%L, %L, %L, %L)', 'facturas_proveedor', public.perm_id('gd_a', 'fac'), 'anulada', format(', project_id = %L', B)), '42501',
    '^COMPRAS_ALCANCE_PROYECTO: para anular una factura de proveedor tu perfil necesita estar asignado al proyecto del documento\.$',
    '[mover + estado · factura] anular la factura de gasto directo de A y mandarla a B: lo detiene el permiso de anular (proyecto NUEVO)');
  PERFORM public.perm_falla(format('SELECT public.perm_definer_estado(%L, %L, %L, %L)', 'contrasenas_pago', public.perm_id('cp0_a', 'cp'), 'anulada', format(', project_id = %L', B)), '42501',
    '^COMPRAS_ALCANCE_PROYECTO: para anular una contraseña de pago tu perfil necesita estar asignado al proyecto del documento\.$',
    '[mover + estado · contraseña] anular la contraseña (sin partidas) de A y mandarla a B: lo detiene el permiso de anular (proyecto NUEVO)');
  PERFORM public.perm_como(uf);
  PERFORM public.perm_falla(format('SELECT public.perm_definer_estado(%L, %L, %L, %L)', 'facturas_proveedor', public.perm_id('gd_a', 'fac'), 'aprobada', format(', project_id = %L', B)), '42501',
    '^COMPRAS_ALCANCE_PROYECTO: para aprobar \(contabilizar\) una factura de proveedor tu perfil necesita estar asignado al proyecto del documento\.$',
    '[mover + estado · factura] aprobar la factura de gasto directo de A y mandarla a B: lo detiene el permiso de aprobar (proyecto NUEVO)');
  PERFORM public.perm_como(NULL);
  SELECT project_id, estado INTO v_pj, v_est FROM public.facturas_proveedor WHERE id = public.perm_id('gd_a', 'fac');
  PERFORM public.chk_uuid(v_pj, A, '[mover + estado] la factura de gasto directo sigue en A…');
  PERFORM public.chk_txt(v_est, 'registrada', '[mover + estado] …y registrada (nada se aplicó a medias)');

  -- ── (d) el orden de disparo: sin la llave Y sin el proyecto, el error es el del PERMISO, no el de mover ──
  PERFORM public.perm_como(cr);
  PERFORM public.perm_falla(format('SELECT public.perm_definer_estado(%L, %L, %L, %L)', 'ordenes_compra', public.perm_id('od_b', 'oc'), 'aprobada', format(', project_id = %L', A)), '42501',
    '^COMPRAS_PERMISO_ACCION: para aprobar una orden de compra tu perfil necesita el permiso «Autorizar / Denegar — Órdenes compra»\.$',
    '[orden de disparo] quien no tiene la llave ni el proyecto B recibe el error del PERMISO (el permiso dispara antes que mover)');
  PERFORM public.perm_como(NULL);

  -- ── (e) el control positivo: con los dos proyectos asignados, mover y cambiar de estado funciona; y un SET al mismo valor no mueve nada ──
  PERFORM public.perm_como(uab);
  PERFORM public.perm_filas(format('SELECT 1 WHERE public.perm_definer_estado(%L, %L, %L, %L) = 1', 'ordenes_compra', public.perm_id('od2_a', 'oc'), 'cancelada', format(', project_id = %L', B)), 1,
    '[mover] asignado a A y B: cancelar la orden de A y mandarla a B en la misma sentencia sí pasa');
  PERFORM public.perm_filas(format('UPDATE public.ordenes_compra SET project_id = %L WHERE id = %L', B, public.perm_id('od3_a', 'oc')), 1,
    '[mover] asignado a A y B: mover la orden borrador de A a B sí pasa');
  PERFORM public.perm_como(ua);
  PERFORM public.perm_filas(format('UPDATE public.ordenes_compra SET project_id = %L, notas = ''PERM-4 sin mover'' WHERE id = %L', A, public.perm_id('od_a', 'oc')), 1,
    '[mover] asignado solo a A: un SET project_id al MISMO valor no mueve nada y no se toca');
  -- Decisión de alcance ESTRECHO (pendiente P-PERM-2 en el informe): el disparador mira SOLO los movimientos. Una función definer que
  -- escribe `project_id` con el MISMO valor en un documento del proyecto MB (que la persona, asignada solo a MA, no tiene) no mueve
  -- nada y hoy pasa; el «todo UPDATE» del escéptico lo cerraría. Si se adopta, esta comprobación cambia a un rechazo.
  PERFORM public.perm_como(um);
  PERFORM public.perm_filas(format('SELECT 1 WHERE public.perm_definer_estado(%L, %L, %L, %L) = 1', 'ordenes_compra', public.perm_id('mo_b', 'oc'), 'borrador', format(', project_id = %L', public.perm_id('MB', 'pb'))), 1,
    '[mover · alcance estrecho] escribir project_id con el MISMO valor en un documento de MB no mueve nada y no se toca (decisión P-PERM-2: cambiaría con el «todo UPDATE»)');
  PERFORM public.perm_como(NULL);
  SELECT project_id, estado INTO v_pj, v_est FROM public.ordenes_compra WHERE id = public.perm_id('od2_a', 'oc');
  PERFORM public.chk_uuid(v_pj, B, '[mover] la orden cancelada quedó en B…');
  PERFORM public.chk_txt(v_est, 'cancelada', '[mover] …y cancelada');

  -- ── (e2) los procesos de sistema no son una persona: sin usuario (mantenimiento) y el rol de servicio mueven sin que el disparador los frene ──
  PERFORM public.perm_como(NULL);
  PERFORM public.perm_filas(format('UPDATE public.ordenes_compra SET project_id = %L WHERE id = %L', B, public.perm_id('od4_a', 'oc')), 1,
    '[mover · sistema] sin usuario (mantenimiento): mover la orden borrador de A a B pasa');
  PERFORM public.perm_como(NULL, true);
  PERFORM public.perm_filas(format('UPDATE public.ordenes_compra SET project_id = %L WHERE id = %L', B, public.perm_id('od5_a', 'oc')), 1,
    '[mover · sistema] y con el rol de servicio (service_role, sin sub)');
  PERFORM public.perm_como(NULL);

  -- ── (f) empresa: el administrador de F no mueve un documento de E (origen) ni saca el suyo hacia E (destino) ──
  PERFORM public.perm_como(FAD);
  PERFORM public.perm_falla(format('SELECT public.perm_definer_estado(%L, %L, %L, %L)', 'ordenes_compra', public.perm_id('od_b', 'oc'), 'borrador', format(', project_id = %L', A)), '42501', v_pat_emp,
    '[mover · empresa] el administrador de OTRA empresa no mueve la orden borrador de E (empresa de origen ajena)');
  PERFORM public.perm_falla(format('SELECT public.perm_definer_estado(%L, %L, %L, %L)', 'ordenes_compra', public.perm_id('fo', 'oc'), 'borrador',
                                   format(', company_id = %L, proveedor_id = %L, project_id = NULL', E, P)), '42501', v_pat_emp,
    '[mover · empresa] ni saca su propia orden borrador de F hacia E (empresa de destino ajena)');
  PERFORM public.perm_falla(format('SELECT public.perm_definer_estado(%L, %L, %L, %L)', 'ordenes_compra', public.perm_id('od_b', 'oc'), 'borrador',
                                   format(', company_id = %L, proveedor_id = %L, project_id = NULL', F, public.perm_id('FP', 'pv'))), '42501', v_pat_emp,
    '[mover · empresa] ni «jala» hacia F la orden borrador de E (destino suyo, pero la empresa de ORIGEN es ajena)');
  PERFORM public.perm_como(NULL);
  SELECT company_id INTO v_pj FROM public.ordenes_compra WHERE id = public.perm_id('fo', 'oc');
  PERFORM public.chk_uuid(v_pj, F, '[mover · empresa] la orden de F sigue en F');
  SELECT company_id INTO v_pj FROM public.ordenes_compra WHERE id = public.perm_id('od_b', 'oc');
  PERFORM public.chk_uuid(v_pj, E, '[mover · empresa] y la orden de E sigue en E');
END;
$mover$;

-- ── (g) eliminar un proyecto: la acción referencial ON DELETE SET NULL de un administrador con asignaciones NO la frena mover ──
DO $purga$
DECLARE
  E constant uuid := public.perm_id('E', 'co');  P constant uuid := public.perm_id('P', 'pv');  AD constant uuid := public.perm_id('AD', 'u');
  G constant uuid := public.perm_id('G', 'pg');  adm2 constant uuid := public.perm_id('adm2', 'u');
  v_n bigint;
BEGIN
  PERFORM public.perm_como(AD);
  INSERT INTO public.facturas_proveedor (id, company_id, project_id, proveedor_id, numero_factura, concepto, monto_total) VALUES
    (public.perm_id('g1', 'fac'), E, G, P, 'GPURGA-1', 'gasto directo G', 1), (public.perm_id('g2', 'fac'), E, G, P, 'GPURGA-2', 'gasto directo G 2', 1);
  INSERT INTO public.factura_proveedor_lineas (company_id, factura_id, linea, descripcion, cantidad, precio_unitario, iva_monto) VALUES
    (E, public.perm_id('g1', 'fac'), 1, 'gasto', 1, 100, 0), (E, public.perm_id('g2', 'fac'), 1, 'gasto', 1, 100, 0);
  UPDATE public.facturas_proveedor SET estado = 'aprobada' WHERE id = public.perm_id('g2', 'fac');
  INSERT INTO public.ordenes_pago (id, company_id, project_id, proveedor_id, factura_id, monto)
  VALUES (public.perm_id('g2', 'op'), E, G, P, public.perm_id('g2', 'fac'), 100);
  INSERT INTO public.contrasenas_pago (id, company_id, project_id, proveedor_id, fecha_pago_programada)
  VALUES (public.perm_id('g3', 'cp'), E, G, P, current_date + 30);
  PERFORM public.perm_como(adm2);
  PERFORM public.chk_bool(public.user_is_project_exempt(), false, '[purga] montaje: el administrador tiene asignaciones, NO es exento de proyecto');
  PERFORM public.chk_bool(public.can_access_project(G), true, '[purga] montaje: y tiene acceso al proyecto G que va a eliminar');
  PERFORM public.perm_filas(format('DELETE FROM public.projects WHERE id = %L', G), 1,
    '[purga] el administrador con asignaciones elimina el proyecto G con facturas, orden de pago y contraseña: ningún control de mover lo frena');
  PERFORM public.perm_como(NULL);
  SELECT count(*) INTO v_n FROM public.projects WHERE id = G;
  PERFORM public.chk(v_n, 0, '[purga] el proyecto ya no existe');
  SELECT count(*) INTO v_n FROM public.facturas_proveedor WHERE id IN (public.perm_id('g1', 'fac'), public.perm_id('g2', 'fac')) AND project_id IS NULL;
  PERFORM public.chk(v_n, 2, '[purga] las dos facturas siguen ahí, solo sin proyecto');
  SELECT count(*) INTO v_n FROM public.ordenes_pago WHERE id = public.perm_id('g2', 'op') AND project_id IS NULL;
  PERFORM public.chk(v_n, 1, '[purga] la orden de pago sigue ahí, solo sin proyecto');
  SELECT count(*) INTO v_n FROM public.contrasenas_pago WHERE id = public.perm_id('g3', 'cp') AND project_id IS NULL;
  PERFORM public.chk(v_n, 1, '[purga] la contraseña sigue ahí, solo sin proyecto');
END;
$purga$;

-- ── (h) el catálogo: el disparador existe en las cinco tablas, es BEFORE UPDATE OF project_id, company_id y dispara DESPUÉS ──
--     (se localiza por su FUNCIÓN, no por su nombre: así un cambio de nombre que lo haga disparar antes también se ve)
DO $catalogo$
DECLARE
  t text; v_n bigint; v_tipo int; v_cols text; v_nombre text;
BEGIN
  FOREACH t IN ARRAY ARRAY['ordenes_compra', 'recepciones', 'facturas_proveedor', 'ordenes_pago', 'contrasenas_pago'] LOOP
    SELECT count(*) INTO v_n FROM pg_trigger g
     WHERE g.tgrelid = ('public.' || t)::regclass AND g.tgfoid = 'public.compras_tg_mover_alcance'::regproc AND g.tgenabled = 'O';
    PERFORM public.chk(v_n, 1, format('[catálogo · %s] hay UN disparador de mover, habilitado', t));
    SELECT g.tgname, g.tgtype, (SELECT string_agg(a.attname, ',' ORDER BY a.attname)
                                  FROM unnest(g.tgattr::int2[]) AS k(n) JOIN pg_attribute a ON a.attrelid = g.tgrelid AND a.attnum = k.n)
      INTO v_nombre, v_tipo, v_cols
      FROM pg_trigger g
     WHERE g.tgrelid = ('public.' || t)::regclass AND g.tgfoid = 'public.compras_tg_mover_alcance'::regproc;
    PERFORM public.chk_txt(v_nombre, 'trg_zzcompras_mover_alcance', format('[catálogo · %s] se llama trg_zzcompras_mover_alcance', t));
    PERFORM public.chk((v_tipo & 31)::bigint, 19, format('[catálogo · %s] y es BEFORE UPDATE de fila (no INSERT ni DELETE)', t));
    PERFORM public.chk_txt(v_cols, 'company_id,project_id', format('[catálogo · %s] y solo dispara con project_id o company_id en el SET', t));
    SELECT count(*) INTO v_n
      FROM pg_trigger g
     WHERE g.tgrelid = ('public.' || t)::regclass AND NOT g.tgisinternal
       AND (g.tgtype & 2) = 2 AND (g.tgtype & 16) = 16
       AND (g.tgname LIKE 'trg_compras_permiso%' OR g.tgname LIKE 'trg_compras_00_sellos%' OR g.tgname LIKE 'trg_compras_alcance%'
            OR g.tgname LIKE 'trg_00_%')
       AND g.tgname COLLATE "C" > v_nombre COLLATE "C";
    PERFORM public.chk(v_n, 0, format('[catálogo · %s] ningún disparador de permiso, sellos ni alcance de referencias dispara DESPUÉS de mover', t));
    SELECT count(*) INTO v_n
      FROM pg_trigger g
     WHERE g.tgrelid = ('public.' || t)::regclass AND NOT g.tgisinternal AND g.tgname LIKE 'trg_compras_permiso%'
       AND g.tgname COLLATE "C" < v_nombre COLLATE "C";
    PERFORM public.chk(CASE WHEN v_n >= 1 THEN 1 ELSE 0 END, 1, format('[catálogo · %s] y sí hay un disparador de permiso que dispara ANTES', t));
  END LOOP;
  -- El nombre no choca con los disparadores de alcance de 20261027000800: siguen siendo los suyos (compras_tg_alcance_documento)
  SELECT count(*) INTO v_n FROM pg_trigger g
   WHERE NOT g.tgisinternal AND g.tgfoid = 'public.compras_tg_alcance_documento'::regproc
     AND g.tgname IN ('trg_compras_alcance_orden', 'trg_compras_alcance_factura', 'trg_compras_alcance_contrasena', 'trg_compras_alcance_orden_pago');
  PERFORM public.chk(v_n, 4, '[catálogo] los cuatro disparadores trg_compras_alcance_* de 20261027000800 siguen intactos (no se reemplazaron)');
END;
$catalogo$;

-- ═══════════════════════════════════════════════════════════════════════════
-- 5 · ¿Qué documentos pueden CAMBIAR DE PROYECTO en la misma sentencia que cambia su estado? (alcanzabilidad de los bloques «NUEVOS»)
--     · La ORDEN DE PAGO EN BORRADOR sí, al ANULARSE (borrador → anulada): `compras_tg_orden_pago_controles` sale con RETURN NEW apenas
--       NEW.estado = 'anulada', antes de validar el proyecto contra la factura. Su bloque NUEVO es ALCANZABLE y lo prueba el caso (a):
--       quien solo tiene el proyecto A recibe el error del PERMISO (`… al proyecto del documento`), no el de mover.
--     · La recepción (registrar y anular), la orden de pago aprobada o pagada (aprobarse, pagarse, anularse), la orden de pago borrador →
--       aprobada y las órdenes aprobadas / emitidas NO: otro control las frena antes (caso (b)). Esta prueba avisa si algún día dejan de
--       estar ancladas y entonces su bloque NUEVO empieza a importar. El administrador exento tiene todas las llaves.
-- ═══════════════════════════════════════════════════════════════════════════
DO $alcanzable$
DECLARE
  A constant uuid := public.perm_id('A', 'pa');  B constant uuid := public.perm_id('B', 'pb');  AD constant uuid := public.perm_id('AD', 'u');
  up constant uuid := public.perm_id('up', 'u');  upab constant uuid := public.perm_id('upab', 'u');
  v_pj uuid;  v_est text;
BEGIN
  -- (a) orden de pago BORRADOR → ANULADA + proyecto nuevo: ALCANZABLE.
  PERFORM public.perm_como(up);
  PERFORM public.perm_falla(format('UPDATE public.ordenes_pago SET estado = ''anulada'', project_id = %L WHERE id = %L', B, public.perm_id('u_ob2', 'op')), '42501',
    '^COMPRAS_ALCANCE_PROYECTO: para anular una orden de pago tu perfil necesita estar asignado al proyecto del documento\.$',
    '[alcanzable] anular una orden de pago en borrador y mandarla a B (asignado solo a A): lo detiene el permiso de anular (proyecto NUEVO), no el de mover');
  PERFORM public.perm_como(NULL);
  SELECT project_id, estado INTO v_pj, v_est FROM public.ordenes_pago WHERE id = public.perm_id('u_ob2', 'op');
  PERFORM public.chk_uuid(v_pj, A, '[alcanzable] la orden de pago sigue en A…');
  PERFORM public.chk_txt(v_est, 'borrador', '[alcanzable] …y en borrador (nada se aplicó a medias)');
  -- con los dos proyectos asignados SÍ pasa en la misma sentencia (prueba de que la combinación es alcanzable): la orden queda anulada en B y su
  -- factura sigue en A (una inconsistencia de datos preexistente de `compras_tg_orden_pago_controles`, que no explota nada; ver INFORME §12.5)
  PERFORM public.perm_como(upab);
  PERFORM public.perm_filas(format('UPDATE public.ordenes_pago SET estado = ''anulada'', project_id = %L WHERE id = %L', B, public.perm_id('u_ob2', 'op')), 1,
    '[alcanzable] asignado a A y B: anular la orden de pago en borrador y mandarla a B en la misma sentencia SÍ pasa (la combinación existe)');
  PERFORM public.perm_como(NULL);
  SELECT project_id, estado INTO v_pj, v_est FROM public.ordenes_pago WHERE id = public.perm_id('u_ob2', 'op');
  PERFORM public.chk_uuid(v_pj, B, '[alcanzable] la orden de pago anulada quedó en B…');
  PERFORM public.chk_txt(v_est, 'anulada', '[alcanzable] …y anulada');

  -- (b) las que otro control frena antes (el administrador exento tiene todas las llaves, así que el error es el del control, no el del permiso)
  PERFORM public.perm_como(AD);
  PERFORM public.perm_falla(format('SELECT public.perm_definer_estado(%L, %L, %L, %L)', 'recepciones', public.perm_id('u_rb', 'rec'), 'registrada', format(', project_id = %L', B)), '23514',
    '^COMPRAS_RECEPCION_ORDEN_AJENA', '[inalcanzable] registrar una recepción y mandarla a otro proyecto: la ancla su orden (COMPRAS_RECEPCION_ORDEN_AJENA)');
  PERFORM public.perm_falla(format('SELECT public.perm_definer_estado(%L, %L, %L, %L)', 'recepciones', public.perm_id('u_rb', 'rec'), 'anulada', format(', project_id = %L', B)), '23514',
    '^COMPRAS_RECEPCION_ORDEN_AJENA', '[inalcanzable] anular una recepción y mandarla a otro proyecto: la ancla su orden (COMPRAS_RECEPCION_ORDEN_AJENA)');
  PERFORM public.perm_falla(format('SELECT public.perm_definer_estado(%L, %L, %L, %L)', 'ordenes_pago', public.perm_id('u_ob', 'op'), 'aprobada', format(', project_id = %L', B)), '23514',
    '^COMPRAS_PAGO_FACTURA_AJENA', '[inalcanzable] aprobar una orden de pago y mandarla a otro proyecto: la ancla su factura (COMPRAS_PAGO_FACTURA_AJENA)');
  PERFORM public.perm_falla(format('SELECT public.perm_definer_estado(%L, %L, %L, %L)', 'ordenes_pago', public.perm_id('u_oap', 'op'), 'pagada', format(', project_id = %L, fecha_pago = CURRENT_DATE', B)), '23514',
    '^COMPRAS_PAGO_INMUTABLE', '[inalcanzable] pagar una orden de pago aprobada y mandarla a otro proyecto: ya no admite cambios (COMPRAS_PAGO_INMUTABLE)');
  PERFORM public.perm_falla(format('SELECT public.perm_definer_estado(%L, %L, %L, %L)', 'ordenes_pago', public.perm_id('u_oap', 'op'), 'anulada', format(', project_id = %L', B)), '23514',
    '^COMPRAS_PAGO_INMUTABLE', '[inalcanzable] anular una orden de pago aprobada y mandarla a otro proyecto: ya no admite cambios (COMPRAS_PAGO_INMUTABLE)');
  PERFORM public.perm_falla(format('SELECT public.perm_definer_estado(%L, %L, %L, %L)', 'ordenes_compra', public.perm_id('u_oa', 'oc'), 'borrador', format(', project_id = %L', B)), '23514',
    '^COMPRAS_OC_APROBADA_CAMBIO', '[inalcanzable] devolver a borrador una orden aprobada y mandarla a otro proyecto: está congelada (COMPRAS_OC_APROBADA_CAMBIO)');
  PERFORM public.perm_falla(format('SELECT public.perm_definer_estado(%L, %L, %L, %L)', 'ordenes_compra', public.perm_id('u_oa', 'oc'), 'emitida', format(', project_id = %L', B)), '23514',
    '^COMPRAS_OC_APROBADA_CAMBIO', '[inalcanzable] emitir una orden aprobada y mandarla a otro proyecto: está congelada (COMPRAS_OC_APROBADA_CAMBIO)');
  PERFORM public.perm_falla(format('SELECT public.perm_definer_estado(%L, %L, %L, %L)', 'ordenes_compra', public.perm_id('u_ce', 'oc'), 'cerrada', format(', project_id = %L', B)), '23514',
    '^COMPRAS_OC_EMITIDA_CAMBIO', '[inalcanzable] cerrar una orden emitida y mandarla a otro proyecto: está congelada (COMPRAS_OC_EMITIDA_CAMBIO)');
  PERFORM public.perm_como(NULL);
END;
$alcanzable$;

-- ═══════════════════════════════════════════════════════════════════════════
-- 6 · La comprobación de empresa es NULL-segura: un administrador SIN empresa no pasa por ninguna
-- ═══════════════════════════════════════════════════════════════════════════
DO $nulo$
DECLARE
  E constant uuid := public.perm_id('E', 'co');  A constant uuid := public.perm_id('A', 'pa');  P constant uuid := public.perm_id('P', 'pv');
  AD constant uuid := public.perm_id('AD', 'u');  nc constant uuid := public.perm_id('nc', 'u');
BEGIN
  PERFORM public.perm_como(AD);
  PERFORM public.perm_cadena('nc1', E, A, P, 'op_aprobada');
  PERFORM public.perm_cadena('nc2', E, A, P, 'op_borrador');
  PERFORM public.perm_como(nc);
  PERFORM public.chk_bool(public.get_my_company_id() IS NULL, true, '[NULL] montaje: la sesión del administrador no tiene empresa');
  PERFORM public.perm_falla(format('SELECT public.perm_definer_estado(%L, %L, %L)', 'ordenes_pago', public.perm_id('nc1', 'op'), 'anulada'), '42501',
    '^COMPRAS_ALCANCE_EMPRESA: para anular una orden de pago el documento tiene que ser de la empresa de tu sesión\.$',
    '[NULL] un administrador SIN empresa no anula una orden de pago de E (función definer)');
  PERFORM public.perm_falla(format('SELECT public.perm_definer_estado(%L, %L, %L)', 'ordenes_pago', public.perm_id('nc2', 'op'), 'aprobada'), '42501',
    '^COMPRAS_ALCANCE_EMPRESA: para aprobar una orden de pago el documento tiene que ser de la empresa de tu sesión\.$',
    '[NULL] ni la aprueba');
  PERFORM public.perm_falla(format('SELECT public.perm_definer_estado(%L, %L, %L)', 'ordenes_compra', public.perm_id('od_b', 'oc'), 'cancelada'), '42501',
    '^COMPRAS_ALCANCE_EMPRESA: para cancelar una orden de compra el documento tiene que ser de la empresa de tu sesión\.$',
    '[NULL] ni cancela una orden de compra (acción de H-1)');
  PERFORM public.perm_falla(format('SELECT public.perm_definer_estado(%L, %L, %L, %L)', 'ordenes_compra', public.perm_id('od_b', 'oc'), 'borrador', format(', project_id = %L', A)), '42501',
    '^COMPRAS_ALCANCE_EMPRESA: para mover un documento de compras el documento tiene que ser de la empresa de tu sesión, y seguir en ella\.$',
    '[NULL] ni mueve un documento de proyecto');
  PERFORM public.perm_como(NULL);
END;
$nulo$;

-- ═══════════════════════════════════════════════════════════════════════════
-- 7 · Los controles positivos de H-1: con el proyecto asignado, las seis siguen funcionando (por id, UPDATE de la API)
--     (va al final: cambia el estado de los documentos que las pruebas anteriores necesitaban intactos)
-- ═══════════════════════════════════════════════════════════════════════════
DO $h1pos$
DECLARE
  ua constant uuid := public.perm_id('ua', 'u');  uab constant uuid := public.perm_id('uab', 'u');
  ac record;
  v_quien uuid;
  v_suf text;
BEGIN
  FOREACH v_suf IN ARRAY ARRAY['a', 'b'] LOOP
    v_quien := CASE v_suf WHEN 'a' THEN ua ELSE uab END;
    PERFORM public.perm_como(v_quien);
    FOR ac IN
      SELECT * FROM (VALUES
        ('emitir la orden',      'ordenes_compra',     'oc',  'oa', 'emitida'),
        ('cancelar la orden',    'ordenes_compra',     'oc',  'od', 'cancelada'),
        ('cerrar la orden',      'ordenes_compra',     'oc',  'ce', 'cerrada'),
        ('anular la recepción',  'recepciones',        'rec', 'rb', 'anulada'),
        ('anular la factura',    'facturas_proveedor', 'fac', 'fr', 'anulada'),
        ('anular la contraseña', 'contrasenas_pago',   'cp',  'fa', 'anulada')
      ) AS v(nombre, tabla, tipo, pref, dest)
    LOOP
      PERFORM public.perm_filas(format('UPDATE public.%I SET estado = %L WHERE id = %L', ac.tabla, ac.dest, public.perm_id(ac.pref || '_' || v_suf, ac.tipo)), 1,
        format('[H-1 · positivo] %s: %s del proyecto %s sigue funcionando', CASE v_suf WHEN 'a' THEN 'asignado solo a A' ELSE 'asignado a A y B' END, ac.nombre, upper(v_suf)));
    END LOOP;
  END LOOP;
  PERFORM public.perm_como(NULL);
END;
$h1pos$;

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
