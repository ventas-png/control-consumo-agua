\set ON_ERROR_STOP on
-- ============================================================================
-- PRJ-1 · Nadie captura en un proyecto que no tiene asignado ni amplía su alcance con «sin proyecto» (project_id = NULL)
--         en las tablas de compras y pagos: ordenes_compra, recepciones, facturas_proveedor, ordenes_pago, contrasenas_pago
--         y sus hijas (orden_compra_lineas, recepcion_lineas, factura_proveedor_lineas, contrasena_pago_facturas).
--
-- ⚠ PRUEBA DE UNA PROPUESTA QUE NO ESTÁ EN NINGUNA MIGRACIÓN DEL PR #926 (propuesta_alcance_proyecto.sql). NO copiarla a hallazgos/ sin
--   la propuesta aplicada como migración: run.sh la recogería por el glob y saldría ROJA (ese es justo su sentido). SOLO clúster local.
--   Una vez por base (como PERM-*): crea empresas y documentos de compras que no se pueden borrar; para repetirla, clonar la base
--   (CREATE DATABASE … TEMPLATE …). Las ayudas prj_* se borran al final.
--
-- CAUSA RAÍZ (reproducida con la cadena completa del PR #926, matriz en impacto.md)
--   · La política INSERT de las cinco tablas pide empresa y rol/llave, NO el proyecto; los disparadores de permiso por acción de la 0900
--     ignoran el borrador. Una persona acotada a A inserta un borrador en B por la API.
--   · can_access_project(NULL) es verdadero y user_is_project_exempt() solo lo es para superadministrador, propietario y administrador SIN
--     asignaciones. Un documento sin proyecto lo ve y lo aprueba cualquiera de la empresa con la llave: insertar con NULL o mover SU
--     documento de A a NULL (o reclamar uno sin proyecto para A) ensancha su alcance. El disparador de mover de la 0900 lo deja pasar.
--   · Las políticas de las hijas no miran el proyecto de la cabecera: se agregan renglones a un borrador de B.
--
-- COMPORTAMIENTO ESPERADO (la «especificación» está en prj_esperado(): una celda por tabla × brecha × vía × clase de persona)
--   a. ACOTADA (operador asignado solo a A, con TODAS las llaves; administrador CON asignaciones; operador sin llaves):
--        INSERT en A → pasa · INSERT en B → 42501 «necesita estar asignado al proyecto del documento» · INSERT sin proyecto → 42501
--        «sin proyecto … exenta»; A→NULL y NULL→A → 42501 (exención); A→B y NULL→B → 42501 (lo decide la 0900, sin cambio); B→A y B→NULL por la
--        API → 0 filas (la política SELECT lo esconde) y por una función definer → 42501; recepciones y órdenes de pago siguen cerradas por su
--        ancla (23514) como antes. Renglones en un borrador de B → 42501.
--   b. EXENTA (administrador sin asignaciones, propietario, superadministrador) y service_role / procesos de sistema: nada cambia (pasa).
--   c. OTRA EMPRESA y anon: igual que hoy (RLS 42501 por la API; COMPRAS_ALCANCE_EMPRESA de la 0900 al mover por una función definer).
--   d. LEGÍTIMO: la persona acotada crea (API y RPC) y mueve entre SUS proyectos; el ciclo completo orden→recepción→factura→pago en su
--      proyecto; el flujo de Contabilidad › Compras y Cuentas por pagar con su proyecto activo; la exenta crea sin proyecto («Empresa»);
--      eliminar un proyecto (ON DELETE SET NULL) no lo frena: lo elimina el administrador con asignaciones si no está la 0700 del PR #928, y el PRINCIPAL (propietario)
--      si está (con la 0700 el administrador obtiene CERO filas).
--   e. UN CERO NUNCA ES ÉXITO: cada celda dice si espera exactamente 1 fila, exactamente 0 filas o un error con SQLSTATE y mensaje;
--      la autoprueba del arnés (PRJ-0) comprueba que 0 filas no pasa por éxito y que un error por el motivo equivocado no pasa.
--   f. LÍMITES QUE QUEDAN (documentados con una comprobación; cambian solo si el dueño decide D-4 / D-6 / D-9 / D-10, o amplía el alcance a las
--      tablas vecinas, README.md §5 y §6):
--        D-4  un documento que YA está sin proyecto lo sigue pudiendo actuar quien tiene la llave, y user_has_project_access no lee permission_type;
--        D-5  la empresa del INSERT no se compara (funciones definer) · D-6 «todo UPDATE» · D-0 la firmeza de user_project_assignments (cerrada por la 0600 del PR #928);
--        D-9  «exento» = no tener filas de asignación. Con la 0600 de #928 de ANTES (el administrador escribía asignaciones) o sin ella: un administrador acotado puede dejar SIN
--             filas a otro y hacerlo exento [límite D-9]. Con la 0600 del PRINCIPAL (#928 desde 7bf85221: solo propietario y superadministrador escriben asignaciones) un
--             administrador obtiene CERO filas, el otro sigue acotado y rechazado, y SOLO el principal lo vuelve exento [límite D-9 · el principal]: la exención sigue siendo
--             «sin filas» y se da por decisión del principal, no se fabrica;
--        D-10 al eliminar un proyecto, sus facturas, contraseñas y órdenes de pago quedan «sin proyecto» y las ve y las actúa todo el que tenga la llave. Con la 0700 de #928 solo el
--             principal elimina un proyecto (el administrador: cero filas) y el límite sigue en pie para el principal;
--        F7   solo las 5 + 4 tablas del circuito: las tablas vecinas con project_id (suministros_condominio, proformas_condominio…) no se tocan.
--
-- Modo informe: PGOPTIONS="-c prj.continuar=si" cuenta las comprobaciones rojas sin detenerse (✗) y al final falla si hay alguna.
-- Ids propios: md5('prj:PRJ-1:…') (prj_id). Se ejecuta con:  psql -X -v ON_ERROR_STOP=1 -d <BD con la cadena completa y fixture.sql> -f PRJ-1.sql
-- ============================================================================

-- ═══════════════════════════════════════════════════════════════════════════
-- Ayudas (prefijo prj_; se borran al final)
-- ═══════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.prj_id(p_n text, p_tipo text)
RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT md5('prj:PRJ-1:' || p_n || ':' || p_tipo)::uuid $$;

-- Ejecuta p_sql como la sesión actual y devuelve «OK filas=N» o «ERR sqlstate mensaje»; SIEMPRE deshace lo que hizo (subtransacción).
CREATE OR REPLACE FUNCTION public.prj_intento(p_sql text)
RETURNS text LANGUAGE plpgsql AS $$
DECLARE
  n bigint;
  v text;
BEGIN
  BEGIN
    EXECUTE p_sql;
    GET DIAGNOSTICS n = ROW_COUNT;
    v := 'OK filas=' || n;
    RAISE EXCEPTION 'prj_deshacer' USING ERRCODE = 'P0999';
  EXCEPTION
    WHEN SQLSTATE 'P0999' THEN NULL;
    WHEN OTHERS THEN v := 'ERR ' || SQLSTATE || ' ' || left(replace(SQLERRM, E'\n', ' '), 400);
  END;
  RETURN v;
END;
$$;

-- Igual, pero CONSERVA lo que hizo (para los flujos legítimos que continúan con lo creado).
CREATE OR REPLACE FUNCTION public.prj_ejecuta(p_sql text)
RETURNS text LANGUAGE plpgsql AS $$
DECLARE
  n bigint;
BEGIN
  BEGIN
    EXECUTE p_sql;
    GET DIAGNOSTICS n = ROW_COUNT;
    RETURN 'OK filas=' || n;
  EXCEPTION WHEN OTHERS THEN
    RETURN 'ERR ' || SQLSTATE || ' ' || left(replace(SQLERRM, E'\n', ' '), 400);
  END;
END;
$$;

-- Compara lo esperado con lo obtenido. Devuelve NULL si coincide y la razón si no.
--   esperado:  'OK1' exactamente una fila · 'OK0' exactamente CERO filas (un cero NO es éxito: se pide a propósito) · 'OKN' una o más
--              · 'ERR:<sqlstate>:<regex del mensaje>' (sqlstate '*' = cualquiera)
CREATE OR REPLACE FUNCTION public.prj_evaluar(p_esperado text, p_obtenido text)
RETURNS text LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE
  v_n text;
  v_estado text;
  v_msg text;
BEGIN
  IF p_obtenido LIKE 'OK filas=%' THEN
    v_n := substr(p_obtenido, length('OK filas=') + 1);
    IF p_esperado = 'OK1' AND v_n = '1' THEN RETURN NULL; END IF;
    IF p_esperado = 'OK0' AND v_n = '0' THEN RETURN NULL; END IF;
    IF p_esperado = 'OKN' AND v_n::bigint >= 1 THEN RETURN NULL; END IF;
    RETURN format('se esperaba %s y salió «%s»', p_esperado, p_obtenido);
  END IF;
  IF p_esperado LIKE 'ERR:%' THEN
    v_estado := split_part(p_esperado, ':', 2);
    v_msg := substr(p_esperado, length('ERR:' || v_estado || ':') + 1);
    IF p_obtenido LIKE 'ERR %' AND (v_estado = '*' OR split_part(p_obtenido, ' ', 2) = v_estado)
       AND substr(p_obtenido, length('ERR ' || split_part(p_obtenido, ' ', 2) || ' ') + 1) ~ v_msg THEN RETURN NULL; END IF;
    RETURN format('se esperaba un error %s «%s» y salió «%s»', v_estado, v_msg, left(p_obtenido, 260));
  END IF;
  RETURN format('se esperaba %s y salió «%s»', p_esperado, left(p_obtenido, 260));
END;
$$;

-- Una comprobación: ✓ o ✗ (modo informe) o falla (modo estricto, el de run.sh). Cuenta en prj.ok / prj.rojo.
CREATE OR REPLACE FUNCTION public.prj_resultado(p_msg text, p_razon text)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF p_razon IS NULL THEN
    PERFORM set_config('prj.ok', (COALESCE(NULLIF(current_setting('prj.ok', true), ''), '0')::bigint + 1)::text, false);
    RAISE NOTICE '✓ %', p_msg;
  ELSIF COALESCE(current_setting('prj.continuar', true), '') = 'si' THEN
    PERFORM set_config('prj.rojo', (COALESCE(NULLIF(current_setting('prj.rojo', true), ''), '0')::bigint + 1)::text, false);
    RAISE NOTICE '✗ % — %', p_msg, p_razon;
  ELSE
    RAISE EXCEPTION '% — %', p_msg, p_razon;
  END IF;
END;
$$;

-- Ejecuta p_sql (deshaciéndolo, salvo p_persistir) y exige el resultado esperado.
CREATE OR REPLACE FUNCTION public.prj_verifica(p_sql text, p_esperado text, p_msg text, p_persistir boolean DEFAULT false)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE
  v_obt text := CASE WHEN p_persistir THEN public.prj_ejecuta(p_sql) ELSE public.prj_intento(p_sql) END;
BEGIN
  PERFORM public.prj_resultado(p_msg, public.prj_evaluar(p_esperado, v_obt));
END;
$$;

CREATE OR REPLACE FUNCTION public.prj_igual(p_actual text, p_esperado text, p_msg text)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM public.prj_resultado(p_msg, CASE WHEN p_actual IS NOT DISTINCT FROM p_esperado THEN NULL
                                           ELSE format('esperado «%s», recibido «%s»', p_esperado, p_actual) END);
END;
$$;

CREATE OR REPLACE FUNCTION public.prj_como(p_uid uuid, p_rol text DEFAULT 'authenticated')
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('request.jwt.claim.sub', COALESCE(p_uid::text, ''), false);
  IF p_rol = 'sistema' THEN RESET ROLE;
  ELSE EXECUTE format('SET LOCAL ROLE %I', p_rol);
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.prj_empresa(p_company uuid, p_a uuid, p_b uuid, p_prov uuid, p_admin uuid, p_nombre text)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('request.jwt.claim.sub', '', false);
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

CREATE OR REPLACE FUNCTION public.prj_persona(p_id uuid, p_company uuid, p_nombre text, p_proyectos uuid[], p_rol text DEFAULT 'operator')
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO auth.users (id) VALUES (p_id);
  INSERT INTO public.app_users (id, company_id, full_name, role) VALUES (p_id, p_company, p_nombre, p_rol);
  INSERT INTO public.user_project_assignments (user_id, project_id, permission_type)
  SELECT p_id, p, 'total' FROM unnest(COALESCE(p_proyectos, ARRAY[]::uuid[])) p;
END;
$$;

CREATE OR REPLACE FUNCTION public.prj_rol(p_user uuid, p_company uuid, p_nombre text, p_llaves text[])
RETURNS void LANGUAGE plpgsql AS $$
DECLARE
  v_rol uuid := md5('prj:rol:' || p_user::text || ':' || p_nombre)::uuid;
BEGIN
  INSERT INTO public.roles (id, company_id, name) VALUES (v_rol, p_company, p_nombre || ' · ' || left(p_user::text, 8) || right(p_user::text, 4));
  INSERT INTO public.role_permissions (role_id, permission_key, effect) SELECT v_rol, k, 'allow' FROM unnest(p_llaves) k;
  INSERT INTO public.user_roles (user_id, role_id) VALUES (p_user, v_rol);
END;
$$;

-- Cadena de documentos armada por la SESIÓN ACTUAL: orden → recepción → factura → orden de pago, hasta el estado pedido (1 servicio de 100).
CREATE OR REPLACE FUNCTION public.prj_cadena(p_n text, p_company uuid, p_project uuid, p_prov uuid, p_hasta text)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE
  v_orden text[] := ARRAY['oc_borrador','oc_aprobada','oc_emitida','rec_borrador','rec_registrada','fac_registrada','fac_aprobada','op_borrador','op_aprobada','op_pagada'];
  v_meta  int := array_position(v_orden, p_hasta);
  v_oc    uuid := public.prj_id(p_n, 'oc');
  v_rec   uuid := public.prj_id(p_n, 'rec');
  v_fac   uuid := public.prj_id(p_n, 'fac');
  v_op    uuid := public.prj_id(p_n, 'op');
BEGIN
  IF v_meta IS NULL THEN RAISE EXCEPTION 'prj_cadena: estado desconocido «%»', p_hasta; END IF;
  INSERT INTO public.ordenes_compra (id, company_id, project_id, proveedor_id, proveedor_nombre, concepto)
  VALUES (v_oc, p_company, p_project, p_prov, 'Proveedor PRJ', 'PRJ ' || p_n);
  INSERT INTO public.orden_compra_lineas (id, company_id, orden_compra_id, linea, descripcion, destino_tipo, categoria, cantidad, unidad, precio_unitario, iva_monto)
  VALUES (public.prj_id(p_n, 'ocl'), p_company, v_oc, 1, 'Servicio PRJ', 'servicio', 'servicios', 1, 'servicio', 100, 0);
  IF v_meta >= 2 THEN UPDATE public.ordenes_compra SET estado = 'aprobada' WHERE id = v_oc; END IF;
  IF v_meta >= 3 THEN UPDATE public.ordenes_compra SET estado = 'emitida'  WHERE id = v_oc; END IF;
  IF v_meta >= 4 THEN
    INSERT INTO public.recepciones (id, company_id, project_id, orden_compra_id, tipo, recibido_por)
    VALUES (v_rec, p_company, p_project, v_oc, 'servicio', auth.uid());
    INSERT INTO public.recepcion_lineas (company_id, recepcion_id, orden_compra_linea_id, cantidad)
    VALUES (p_company, v_rec, public.prj_id(p_n, 'ocl'), 1);
  END IF;
  IF v_meta >= 5 THEN UPDATE public.recepciones SET estado = 'registrada' WHERE id = v_rec; END IF;
  IF v_meta >= 6 THEN
    INSERT INTO public.facturas_proveedor (id, company_id, project_id, proveedor_id, orden_compra_id, numero_factura, concepto, monto_total)
    VALUES (v_fac, p_company, p_project, p_prov, v_oc, 'PF' || upper(p_n), 'Factura PRJ', 1);
    INSERT INTO public.factura_proveedor_lineas (company_id, factura_id, orden_compra_linea_id, linea, descripcion, cantidad, precio_unitario, iva_monto)
    VALUES (p_company, v_fac, public.prj_id(p_n, 'ocl'), 1, 'Servicio PRJ', 1, 100, 0);
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

-- Funciones SECURITY DEFINER de juguete (la RLS no rige para su dueño): modelan una RPC definer que mueve, inserta o edita un documento.
-- SOLO clúster local; solo las cinco tablas del circuito y solo documentos de las empresas de esta prueba (nombre 'PRJ-1…'). Se borran al final.
CREATE OR REPLACE FUNCTION public.prj_definer_mover(p_tabla text, p_id uuid, p_proyecto uuid)
RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $$
DECLARE n bigint;
BEGIN
  IF p_tabla NOT IN ('ordenes_compra', 'recepciones', 'facturas_proveedor', 'ordenes_pago', 'contrasenas_pago') THEN
    RAISE EXCEPTION 'prj_definer_mover: tabla fuera de la ayuda de prueba';
  END IF;
  EXECUTE format('UPDATE public.%I SET project_id = %L WHERE id = %L AND company_id IN (SELECT id FROM public.companies WHERE nombre LIKE %L)',
                 p_tabla, p_proyecto, p_id, 'PRJ-1%');
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END;
$$;
CREATE OR REPLACE FUNCTION public.prj_definer_editar(p_id uuid, p_concepto text)
RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $$
DECLARE n bigint;
BEGIN
  UPDATE public.ordenes_compra SET concepto = p_concepto
   WHERE id = p_id AND company_id IN (SELECT id FROM public.companies WHERE nombre LIKE 'PRJ-1%');
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END;
$$;
CREATE OR REPLACE FUNCTION public.prj_definer_mover_renglon(p_renglon uuid, p_orden uuid)
RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $$
DECLARE n bigint;
BEGIN
  UPDATE public.orden_compra_lineas SET orden_compra_id = p_orden, linea = 88
   WHERE id = p_renglon AND company_id IN (SELECT id FROM public.companies WHERE nombre LIKE 'PRJ-1%');
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END;
$$;
CREATE OR REPLACE FUNCTION public.prj_definer_insertar(p_company uuid, p_proyecto uuid, p_prov uuid)
RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.companies WHERE id = p_company AND nombre LIKE 'PRJ-1%') THEN
    RAISE EXCEPTION 'prj_definer_insertar: empresa fuera de la ayuda de prueba';
  END IF;
  INSERT INTO public.ordenes_compra (company_id, project_id, proveedor_id, proveedor_nombre, concepto) VALUES (p_company, p_proyecto, p_prov, 'P', 'definer');
  RETURN 1;
END;
$$;
-- Saca un renglón de la cabecera de B y lo pone en la de A por una función DEFINER, en las tres hijas que no son orden_compra_lineas. La de recepciones cambia TAMBIÉN el renglón
-- de la orden (p_ref; si no, COMPRAS_RECEPCION_LINEA_AJENA —que dispara antes— lo para por su cuenta) y la de partidas cambia TAMBIÉN la factura (p_ref; si no, la partida queda con una
-- factura de otra contabilidad y COMPRAS_CONTRASENA_OTRA_CONTABILIDAD lo para): en ambos casos el chequeo del ORIGEN de la propuesta no se ejercería.
CREATE OR REPLACE FUNCTION public.prj_definer_mover_hija(p_tabla text, p_renglon uuid, p_cabecera uuid, p_ref uuid DEFAULT NULL)
RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $$
DECLARE n bigint;
BEGIN
  IF p_tabla = 'recepcion_lineas' THEN
    UPDATE public.recepcion_lineas SET recepcion_id = p_cabecera, orden_compra_linea_id = COALESCE(p_ref, orden_compra_linea_id)
     WHERE id = p_renglon AND company_id IN (SELECT id FROM public.companies WHERE nombre LIKE 'PRJ-1%');
  ELSIF p_tabla = 'factura_proveedor_lineas' THEN
    UPDATE public.factura_proveedor_lineas SET factura_id = p_cabecera
     WHERE id = p_renglon AND company_id IN (SELECT id FROM public.companies WHERE nombre LIKE 'PRJ-1%');
  ELSIF p_tabla = 'contrasena_pago_facturas' THEN
    UPDATE public.contrasena_pago_facturas SET contrasena_id = p_cabecera, factura_id = COALESCE(p_ref, factura_id)
     WHERE id = p_renglon AND company_id IN (SELECT id FROM public.companies WHERE nombre LIKE 'PRJ-1%');
  ELSE
    RAISE EXCEPTION 'prj_definer_mover_hija: tabla fuera de la ayuda de prueba';
  END IF;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END;
$$;
-- Lo mismo, pero con UN disparador PREVIO desactivado dentro de una subtransacción que SIEMPRE se deshace: ejerce el chequeo del ORIGEN de la propuesta aislado de la protección que
-- dispara antes (hoy COMPRAS_CONTRASENA_PARTIDA_FIJA rechaza antes cualquier cambio de contraseña de una partida, así que sin esto ese chequeo es inalcanzable). Devuelve «OK filas=N» / «ERR sqlstate mensaje».
CREATE OR REPLACE FUNCTION public.prj_definer_mover_hija_aislada(p_tabla text, p_desactivar text, p_renglon uuid, p_cabecera uuid, p_ref uuid DEFAULT NULL)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $$
DECLARE
  n bigint;
  v text;
BEGIN
  BEGIN
    IF p_tabla NOT IN ('recepcion_lineas', 'factura_proveedor_lineas', 'contrasena_pago_facturas') THEN
      RAISE EXCEPTION 'prj_definer_mover_hija_aislada: tabla fuera de la ayuda de prueba';
    END IF;
    EXECUTE format('ALTER TABLE public.%I DISABLE TRIGGER %I', p_tabla, p_desactivar);
    n := public.prj_definer_mover_hija(p_tabla, p_renglon, p_cabecera, p_ref);
    v := 'OK filas=' || n;
    RAISE EXCEPTION 'prj_deshacer' USING ERRCODE = 'P0999';
  EXCEPTION
    WHEN SQLSTATE 'P0999' THEN NULL;
    WHEN OTHERS THEN v := 'ERR ' || SQLSTATE || ' ' || left(replace(SQLERRM, E'\n', ' '), 400);
  END;
  RETURN v;
END;
$$;
-- Mueve la CABECERA de proyecto (como prj_definer_mover) con el disparador de mover de la 0900 DESACTIVADO dentro de una subtransacción que SIEMPRE se deshace: ejerce el chequeo
-- «desde o hacia sin proyecto» de la propuesta aislado de la 0900 (que dispara antes y, para una sesión sin fila en app_users, rechaza primero por la empresa). Devuelve «OK filas=N» / «ERR sqlstate mensaje».
CREATE OR REPLACE FUNCTION public.prj_definer_mover_aislada(p_tabla text, p_desactivar text, p_id uuid, p_proyecto uuid)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $$
DECLARE
  n bigint;
  v text;
BEGIN
  BEGIN
    IF p_tabla NOT IN ('ordenes_compra', 'facturas_proveedor', 'contrasenas_pago') THEN
      RAISE EXCEPTION 'prj_definer_mover_aislada: tabla fuera de la ayuda de prueba';
    END IF;
    EXECUTE format('ALTER TABLE public.%I DISABLE TRIGGER %I', p_tabla, p_desactivar);
    n := public.prj_definer_mover(p_tabla, p_id, p_proyecto);
    v := 'OK filas=' || n;
    RAISE EXCEPTION 'prj_deshacer' USING ERRCODE = 'P0999';
  EXCEPTION
    WHEN SQLSTATE 'P0999' THEN NULL;
    WHEN OTHERS THEN v := 'ERR ' || SQLSTATE || ' ' || left(replace(SQLERRM, E'\n', ' '), 400);
  END;
  RETURN v;
END;
$$;
GRANT EXECUTE ON FUNCTION public.prj_definer_mover(text, uuid, uuid), public.prj_definer_editar(uuid, text),
  public.prj_definer_insertar(uuid, uuid, uuid), public.prj_definer_mover_renglon(uuid, uuid),
  public.prj_definer_mover_hija(text, uuid, uuid, uuid), public.prj_definer_mover_hija_aislada(text, text, uuid, uuid, uuid),
  public.prj_definer_mover_aislada(text, text, uuid, uuid) TO authenticated;

-- LA ESPECIFICACIÓN: qué se espera en cada celda.
--   clase:  'servicio' (service_role) · 'exenta' · 'acotada' (con permiso de editar) · 'acotada_sin_edit' (operador sin llaves) · 'otra' (otra empresa) · 'anon'
--   brecha: INS_A, INS_B, INS_N (insertar en A, en B, sin proyecto) · A>N, A>B, N>A, N>B, B>A, B>N (cambiar project_id)
--   via:    API (PostgREST: WHERE id = …) · DEF (función SECURITY DEFINER: no pasa por la RLS)
CREATE OR REPLACE FUNCTION public.prj_esperado(p_clase text, p_tabla text, p_brecha text, p_via text)
RETURNS text LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE
  v_anclada boolean := p_tabla IN ('recepciones', 'ordenes_pago');   -- su proyecto lo ata a su orden / factura (23514), antes y después
  v_ancla text := '(ORDEN_AJENA|FACTURA_AJENA)';
  v_ins boolean := p_brecha LIKE 'INS\_%';
BEGIN
  IF p_clase = 'anon' THEN                                    -- con el DML que se le concede SOLO en esta prueba (en producción no lo tiene): ninguna política es suya
    RETURN CASE WHEN v_ins THEN 'ERR:42501:(permission denied|row-level security)' ELSE 'OK0' END;
  END IF;
  IF p_clase = 'otra' THEN
    IF v_ins THEN RETURN 'ERR:42501:row-level security'; END IF;
    IF p_via = 'API' THEN RETURN 'OK0'; END IF;                                     -- no ve nada de otra empresa
    RETURN CASE WHEN v_anclada THEN 'ERR:23514:' || v_ancla ELSE 'ERR:42501:COMPRAS_ALCANCE_EMPRESA' END;
  END IF;
  IF p_clase IN ('servicio', 'exenta') THEN
    IF v_ins THEN RETURN 'OK1'; END IF;
    RETURN CASE WHEN v_anclada THEN 'ERR:23514:' || v_ancla ELSE 'OK1' END;
  END IF;
  -- acotada / acotada_sin_edit
  IF p_brecha = 'INS_A' THEN RETURN 'OK1'; END IF;
  IF p_brecha = 'INS_B' THEN RETURN 'ERR:42501:necesita estar asignado al proyecto del documento'; END IF;
  IF p_brecha = 'INS_N' THEN RETURN 'ERR:42501:sin proyecto \(la contabilidad de la Empresa\) solo lo crea una persona exenta de proyecto; si no lo eres, tu perfil necesita estar asignado al proyecto'; END IF;
  IF p_clase = 'acotada_sin_edit' AND p_via = 'API' THEN RETURN 'OK0'; END IF;      -- la política UPDATE pide editar: no alcanza ni una fila
  IF left(p_brecha, 1) = 'B' THEN                                                   -- el documento es de B, que no tiene asignado
    IF p_via = 'API' THEN RETURN 'OK0'; END IF;                                     -- la política SELECT lo esconde: 0 filas
    RETURN CASE WHEN v_anclada THEN 'ERR:23514:' || v_ancla ELSE 'ERR:42501:en que está hoy' END;
  END IF;
  IF v_anclada THEN RETURN 'ERR:23514:' || v_ancla; END IF;
  RETURN CASE p_brecha
    WHEN 'A>N' THEN 'ERR:42501:dejar un documento de compras sin proyecto \(la contabilidad de la Empresa\) solo lo hace una persona exenta de proyecto; si no lo eres, tu perfil necesita estar asignado al proyecto'
    WHEN 'N>A' THEN 'ERR:42501:ponerle proyecto a un documento de compras que no lo tiene solo lo hace una persona exenta de proyecto; si no lo eres, el documento se queda sin proyecto \(tu perfil necesita estar asignado al proyecto para capturar en él\)'
    ELSE 'ERR:42501:proyecto de destino'                                            -- A>B y N>B: lo decide la 0900, sin cambio
  END;
END;
$$;

GRANT EXECUTE ON FUNCTION public.prj_id(text, text), public.prj_intento(text), public.prj_ejecuta(text), public.prj_evaluar(text, text),
  public.prj_resultado(text, text), public.prj_verifica(text, text, text, boolean), public.prj_igual(text, text, text),
  public.prj_como(uuid, text), public.prj_esperado(text, text, text, text) TO authenticated, anon;

-- Una vez por base, y los contadores en cero (prj.ok / prj.rojo viven en la sesión)
DO $inicio$
BEGIN
  IF EXISTS (SELECT 1 FROM public.companies WHERE id = public.prj_id('E', 'co')) THEN
    RAISE EXCEPTION 'PRJ-1 ya se ejecutó en esta base (crea empresas y documentos que no se pueden borrar): usa una copia (CREATE DATABASE … TEMPLATE …).';
  END IF;
  PERFORM set_config('prj.ok', '0', false);
  PERFORM set_config('prj.rojo', '0', false);
END;
$inicio$;

-- ═══════════════════════════════════════════════════════════════════════════
-- PRJ-0 · AUTOPRUEBA DEL ARNÉS: un cero NO es éxito y un rechazo por el motivo equivocado NO es éxito
-- ═══════════════════════════════════════════════════════════════════════════
DO $autoprueba$
BEGIN
  PERFORM public.prj_igual(public.prj_evaluar('OK1', 'OK filas=1'), NULL, '[arnés] una fila donde se espera una fila: coincide');
  PERFORM public.prj_igual((public.prj_evaluar('OK1', 'OK filas=0') IS NOT NULL)::text, 'true', '[arnés] CERO filas donde se espera una fila NO es éxito');
  PERFORM public.prj_igual((public.prj_evaluar('OK0', 'OK filas=1') IS NOT NULL)::text, 'true', '[arnés] una fila donde se espera cero (la política debía esconderla) NO coincide');
  PERFORM public.prj_igual(public.prj_evaluar('OK0', 'OK filas=0'), NULL, '[arnés] cero filas donde se espera cero (dicho a propósito): coincide');
  PERFORM public.prj_igual((public.prj_evaluar('ERR:42501:abc', 'OK filas=1') IS NOT NULL)::text, 'true', '[arnés] éxito donde se espera un rechazo NO coincide');
  PERFORM public.prj_igual((public.prj_evaluar('ERR:42501:abc', 'ERR 23514 abc') IS NOT NULL)::text, 'true', '[arnés] rechazo con OTRO SQLSTATE NO coincide');
  PERFORM public.prj_igual((public.prj_evaluar('ERR:42501:abc', 'ERR 42501 xyz') IS NOT NULL)::text, 'true', '[arnés] rechazo por OTRO motivo (mensaje distinto) NO coincide');
  PERFORM public.prj_igual(public.prj_evaluar('ERR:42501:abc', 'ERR 42501 zabcz'), NULL, '[arnés] rechazo con el SQLSTATE y el mensaje esperados: coincide');
END;
$autoprueba$;

-- ═══════════════════════════════════════════════════════════════════════════
-- 0 · PADRÓN (superusuario)
--   Empresa E (proyectos A, B y G [se eliminará]) · empresa F (otra empresa, su administrador FAD, exento en F).
--   ua  operador SOLO A, con TODAS las llaves (permisos por acción, aprobar, cambiar estado): solo el proyecto lo limita
--   uab operador A y B, con todas las llaves · uo operador A SIN llaves · ua0 operador SIN asignaciones, con todas las llaves
--   uap operador cuyo proyecto está en app_users.project_id (A), sin asignaciones, con todas las llaves
--   adm2 administrador CON asignaciones (A y G): NO es exento · AD administrador SIN asignaciones (exento) · ow propietario · su superadministrador
--   su2 superadministrador cuya sesión es de la empresa F (actúa en cualquier empresa) · nc administrador SIN empresa (company_id NULL; exento por no tener asignaciones)
--   adm3 administrador asignado SOLO a A (NO exento; D-9: sin la regla del principal otro administrador acotado le borra la fila y lo vuelve exento; con ella solo el principal) · ol operador con asignación 'lectura' a A y todas las llaves
--   (permission_type no limita la captura; F10). fan sesión autenticada SIN fila en app_users (rol NULL: can_access_project() devuelve NULL, no false). ua tiene además un rol con las llaves de dos tablas VECINAS (suministros_condominio, proformas_condominio; F7).
--   Documentos de E en A, en B y SIN proyecto (los arma AD, exento): órdenes en borrador, recepciones en borrador, órdenes de pago en
--   borrador, facturas de gasto directo y contraseñas sin partidas; anclas emitidas / facturas aprobadas para insertar recepciones y pagos.
-- ═══════════════════════════════════════════════════════════════════════════
DO $padron$
DECLARE
  E constant uuid := public.prj_id('E', 'co');  A constant uuid := public.prj_id('A', 'pa');  B constant uuid := public.prj_id('B', 'pb');
  G constant uuid := public.prj_id('G', 'pg');  P constant uuid := public.prj_id('P', 'pv');  AD constant uuid := public.prj_id('AD', 'u');
  F constant uuid := public.prj_id('F', 'co');  FA constant uuid := public.prj_id('FA', 'pa'); FB constant uuid := public.prj_id('FB', 'pb');
  FP constant uuid := public.prj_id('FP', 'pv'); FAD constant uuid := public.prj_id('FAD', 'u');
  ua constant uuid := public.prj_id('ua', 'u'); uab constant uuid := public.prj_id('uab', 'u'); uo constant uuid := public.prj_id('uo', 'u');
  ua0 constant uuid := public.prj_id('ua0', 'u'); uap constant uuid := public.prj_id('uap', 'u');
  adm2 constant uuid := public.prj_id('adm2', 'u'); ow constant uuid := public.prj_id('ow', 'u'); su constant uuid := public.prj_id('su', 'u');
  su2 constant uuid := public.prj_id('su2', 'u'); nc constant uuid := public.prj_id('nc', 'u');
  adm3 constant uuid := public.prj_id('adm3', 'u'); ol constant uuid := public.prj_id('ol', 'u'); fan constant uuid := public.prj_id('fan', 'u');
  v_llaves text[] := ARRAY['platform.contabilidad.view', 'platform.contabilidad.create', 'platform.contabilidad.edit',
    'platform.contabilidad.approve', 'platform.contabilidad.change_status', 'condominios.tab.ordenes_compra.approve',
    'platform.contabilidad.compras.recepcion_registrar', 'platform.contabilidad.compras.factura_aprobar',
    'platform.contabilidad.compras.orden_pago_aprobar', 'platform.contabilidad.compras.pago_ejecutar', 'platform.contabilidad.compras.pago_anular'];
BEGIN
  PERFORM public.prj_como(NULL, 'sistema');
  PERFORM public.prj_empresa(E, A, B, P, AD, 'PRJ-1 Empresa E');
  PERFORM public.prj_empresa(F, FA, FB, FP, FAD, 'PRJ-1 Empresa F');
  SET LOCAL session_replication_role = replica;      -- sin el tope de proyectos del plan ni la siembra contable (no es lo que se prueba)
  INSERT INTO public.projects (id, company_id, nombre) VALUES (G, E, 'PRJ-1 Empresa E · G (se elimina)');
  SET LOCAL session_replication_role = origin;
  PERFORM public.prj_persona(ua,  E, 'PRJ-1 ua (operador solo A, todas las llaves)', ARRAY[A]);    PERFORM public.prj_rol(ua,  E, 'todas las llaves', v_llaves);
  PERFORM public.prj_persona(uab, E, 'PRJ-1 uab (operador A y B, todas las llaves)', ARRAY[A, B]); PERFORM public.prj_rol(uab, E, 'todas las llaves', v_llaves);
  PERFORM public.prj_persona(uo,  E, 'PRJ-1 uo (operador solo A, SIN llaves)', ARRAY[A]);
  PERFORM public.prj_persona(ua0, E, 'PRJ-1 ua0 (operador sin asignaciones, todas las llaves)', NULL); PERFORM public.prj_rol(ua0, E, 'todas las llaves', v_llaves);
  PERFORM public.prj_persona(uap, E, 'PRJ-1 uap (operador con proyecto en app_users, todas las llaves)', NULL); PERFORM public.prj_rol(uap, E, 'todas las llaves', v_llaves);
  UPDATE public.app_users SET project_id = A WHERE id = uap;
  PERFORM public.prj_persona(adm2, E, 'PRJ-1 adm2 (administrador A y G: NO exento)', ARRAY[A, G], 'admin');
  PERFORM public.prj_persona(ow,  E, 'PRJ-1 ow (propietario)', NULL, 'company_owner');
  PERFORM public.prj_persona(su,  E, 'PRJ-1 su (superadministrador)', NULL, 'super_admin');
  PERFORM public.prj_persona(su2, F, 'PRJ-1 su2 (superadministrador cuya sesión es de OTRA empresa, F)', NULL, 'super_admin');
  PERFORM public.prj_persona(nc,  NULL, 'PRJ-1 nc (administrador SIN empresa: app_users.company_id es NULL)', NULL, 'admin');
  PERFORM public.prj_persona(adm3, E, 'PRJ-1 adm3 (administrador solo A: NO exento, hasta que otro administrador acotado le borre la fila)', ARRAY[A], 'admin');
  PERFORM public.prj_persona(ol,  E, 'PRJ-1 ol (operador con asignación «lectura» a A, todas las llaves)', ARRAY[A]); PERFORM public.prj_rol(ol, E, 'todas las llaves', v_llaves);
  UPDATE public.user_project_assignments SET permission_type = 'lectura' WHERE user_id = ol;
  INSERT INTO auth.users (id) VALUES (fan);      -- «fan» (fantasma): una sesión autenticada SIN fila en app_users: su rol es NULL y can_access_project() le devuelve NULL, no false
  PERFORM public.prj_rol(ua, E, 'llaves de tablas vecinas', ARRAY['condominios.tab.suministros', 'condominios.tab.proformas']);
  -- documentos de E en A, en B y SIN proyecto, armados por el administrador exento AD
  PERFORM public.prj_como(AD);
  PERFORM public.prj_cadena('oc_a', E, A, P, 'oc_borrador');     PERFORM public.prj_cadena('oc_b', E, B, P, 'oc_borrador');     PERFORM public.prj_cadena('oc_n', E, NULL, P, 'oc_borrador');
  PERFORM public.prj_cadena('rec_a', E, A, P, 'rec_borrador');   PERFORM public.prj_cadena('rec_b', E, B, P, 'rec_borrador');   PERFORM public.prj_cadena('rec_n', E, NULL, P, 'rec_borrador');
  PERFORM public.prj_cadena('op_a', E, A, P, 'op_borrador');     PERFORM public.prj_cadena('op_b', E, B, P, 'op_borrador');     PERFORM public.prj_cadena('op_n', E, NULL, P, 'op_borrador');
  PERFORM public.prj_cadena('an_a', E, A, P, 'oc_emitida');      PERFORM public.prj_cadena('an_b', E, B, P, 'oc_emitida');      PERFORM public.prj_cadena('an_n', E, NULL, P, 'oc_emitida');
  PERFORM public.prj_cadena('fa_a', E, A, P, 'fac_aprobada');    PERFORM public.prj_cadena('fa_b', E, B, P, 'fac_aprobada');    PERFORM public.prj_cadena('fa_n', E, NULL, P, 'fac_aprobada');
  PERFORM public.prj_cadena('fl_a', E, A, P, 'oc_emitida');      PERFORM public.prj_cadena('fl_b', E, B, P, 'oc_emitida');      PERFORM public.prj_cadena('fl_n', E, NULL, P, 'oc_emitida');
  INSERT INTO public.facturas_proveedor (id, company_id, project_id, proveedor_id, numero_factura, concepto, monto_total) VALUES
    (public.prj_id('gd_a', 'fac'), E, A, P, 'GD-A', 'gasto directo A', 1),
    (public.prj_id('gd_b', 'fac'), E, B, P, 'GD-B', 'gasto directo B', 1),
    (public.prj_id('gd_n', 'fac'), E, NULL, P, 'GD-N', 'gasto directo sin proyecto', 1);
  INSERT INTO public.factura_proveedor_lineas (company_id, factura_id, linea, descripcion, cantidad, precio_unitario, iva_monto)
  SELECT E, public.prj_id(x, 'fac'), 1, 'gasto', 1, 100, 0 FROM unnest(ARRAY['gd_a', 'gd_b', 'gd_n']) x;
  INSERT INTO public.contrasenas_pago (id, company_id, project_id, proveedor_id, fecha_pago_programada) VALUES
    (public.prj_id('cp_a', 'cp'), E, A, P, current_date + 30),
    (public.prj_id('cp_b', 'cp'), E, B, P, current_date + 30),
    (public.prj_id('cp_n', 'cp'), E, NULL, P, current_date + 30);
  PERFORM public.prj_como(NULL, 'sistema');
  -- La numeración es por contabilidad (empresa/proyecto): las tres contraseñas nacen con el mismo número y mover una chocaría con la otra por el
  -- índice único del número, no por el alcance. El sistema (sin sesión de usuario) les fija números distintos: las pruebas miden solo el alcance.
  UPDATE public.contrasenas_pago SET numero = 'PRJ-CP-A' WHERE id = public.prj_id('cp_a', 'cp');
  UPDATE public.contrasenas_pago SET numero = 'PRJ-CP-B' WHERE id = public.prj_id('cp_b', 'cp');
  UPDATE public.contrasenas_pago SET numero = 'PRJ-CP-N' WHERE id = public.prj_id('cp_n', 'cp');
END;
$padron$;

-- ═══════════════════════════════════════════════════════════════════════════
-- a · CATÁLOGO: lo que añade la propuesta está, dispara en el momento y el orden correctos, y no se tocó lo de la 0900
-- ═══════════════════════════════════════════════════════════════════════════
DO $catalogo$
DECLARE
  t text; v_n bigint; v_tipo int; v_cols text; v_nombre text; v_mover text; v_fn text; v_col text;
BEGIN
  FOREACH t IN ARRAY ARRAY['ordenes_compra', 'recepciones', 'facturas_proveedor', 'ordenes_pago', 'contrasenas_pago'] LOOP
    SELECT count(*) INTO v_n
      FROM pg_trigger tg JOIN pg_proc p ON p.oid = tg.tgfoid
     WHERE tg.tgrelid = ('public.' || t)::regclass AND NOT tg.tgisinternal AND p.proname = 'compras_tg_alcance_captura';
    PERFORM public.prj_igual(v_n::text, '1', format('[catálogo] %s tiene UN disparador de alcance de captura', t));
    SELECT tg.tgtype, tg.tgname, (SELECT string_agg(a.attname, ',' ORDER BY a.attname) FROM unnest(tg.tgattr::int2[]) k JOIN pg_attribute a ON a.attrelid = tg.tgrelid AND a.attnum = k)
      INTO v_tipo, v_nombre, v_cols
      FROM pg_trigger tg JOIN pg_proc p ON p.oid = tg.tgfoid
     WHERE tg.tgrelid = ('public.' || t)::regclass AND NOT tg.tgisinternal AND p.proname = 'compras_tg_alcance_captura' LIMIT 1;
    -- tgtype: 1 = ROW, 2 = BEFORE, 4 = INSERT, 16 = UPDATE  →  ROW | BEFORE | INSERT | UPDATE = 23
    PERFORM public.prj_igual(v_tipo::text, '23', format('[catálogo] %s: es BEFORE, por fila, en INSERT y en UPDATE', t));
    PERFORM public.prj_igual(v_cols, 'project_id', format('[catálogo] %s: el UPDATE solo dispara por project_id', t));
    SELECT tg.tgname INTO v_mover FROM pg_trigger tg JOIN pg_proc p ON p.oid = tg.tgfoid
     WHERE tg.tgrelid = ('public.' || t)::regclass AND NOT tg.tgisinternal AND p.proname = 'compras_tg_mover_alcance';
    PERFORM public.prj_igual(v_mover, 'trg_zzcompras_mover_alcance', format('[catálogo] %s: el disparador de mover de la 0900 sigue ahí, con su nombre', t));
    PERFORM public.prj_igual((v_nombre > v_mover)::text, 'true', format('[catálogo] %s: el de captura dispara DESPUÉS del de mover (los mensajes de la 0900 no cambian)', t));
  END LOOP;
  FOR t, v_col IN VALUES ('orden_compra_lineas', 'orden_compra_id'), ('recepcion_lineas', 'recepcion_id'),
                         ('factura_proveedor_lineas', 'factura_id'), ('contrasena_pago_facturas', 'contrasena_id') LOOP
    SELECT count(*) INTO v_n
      FROM pg_trigger tg JOIN pg_proc p ON p.oid = tg.tgfoid
     WHERE tg.tgrelid = ('public.' || t)::regclass AND NOT tg.tgisinternal AND p.proname = 'compras_tg_alcance_hija';
    PERFORM public.prj_igual(v_n::text, '1', format('[catálogo] %s tiene UN disparador de alcance de la cabecera', t));
    SELECT tg.tgtype, (SELECT string_agg(a.attname, ',' ORDER BY a.attname) FROM unnest(tg.tgattr::int2[]) k JOIN pg_attribute a ON a.attrelid = tg.tgrelid AND a.attnum = k)
      INTO v_tipo, v_cols
      FROM pg_trigger tg JOIN pg_proc p ON p.oid = tg.tgfoid
     WHERE tg.tgrelid = ('public.' || t)::regclass AND NOT tg.tgisinternal AND p.proname = 'compras_tg_alcance_hija' LIMIT 1;
    PERFORM public.prj_igual(v_tipo::text, '23', format('[catálogo] %s: BEFORE, por fila, INSERT y UPDATE', t));
    PERFORM public.prj_igual(v_cols, v_col, format('[catálogo] %s: el UPDATE solo dispara si cambia %s', t, v_col));
  END LOOP;
  FOREACH v_fn IN ARRAY ARRAY['compras_puede_destinar_proyecto(uuid)', 'compras_tg_alcance_captura()', 'compras_tg_alcance_hija()'] LOOP
    PERFORM public.prj_igual((SELECT p.prosecdef AND p.proconfig::text LIKE '%search_path%' FROM pg_proc p WHERE p.oid = to_regprocedure('public.' || v_fn))::text, 'true',
      format('[catálogo] %s es SECURITY DEFINER con search_path fijo', v_fn));
    PERFORM public.prj_igual((SELECT EXISTS (SELECT 1 FROM aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) x
                                              WHERE x.privilege_type = 'EXECUTE'
                                                AND (x.grantee = 0 OR x.grantee IN (SELECT oid FROM pg_roles WHERE rolname IN ('anon', 'authenticated'))))
                                FROM pg_proc p WHERE p.oid = to_regprocedure('public.' || v_fn))::text, 'false',
      format('[catálogo] %s no la ejecuta ni anon, ni authenticated, ni PUBLIC (solo los disparadores)', v_fn));
  END LOOP;
  PERFORM public.prj_igual((SELECT (prosrc LIKE '%para mover un documento de compras tu perfil necesita estar asignado al proyecto de destino%'
                                    AND prosrc LIKE '%en que está hoy%') FROM pg_proc WHERE oid = 'public.compras_tg_mover_alcance()'::regprocedure)::text, 'true',
    '[catálogo] la función de mover de la 0900 conserva sus dos mensajes (la propuesta es aditiva: no la reemplaza)');
END;
$catalogo$;

-- ═══════════════════════════════════════════════════════════════════════════
-- b · LA MATRIZ: cinco tablas × (3 inserciones + 6 cambios de proyecto × 2 vías) × cada clase de persona
-- ═══════════════════════════════════════════════════════════════════════════
DO $matriz$
DECLARE
  E constant uuid := public.prj_id('E', 'co');  A constant uuid := public.prj_id('A', 'pa');  B constant uuid := public.prj_id('B', 'pb');
  P constant uuid := public.prj_id('P', 'pv');
  -- persona, rol de base de datos, clase
  v_pers text[][] := ARRAY[
    ['ua',  'authenticated', 'acotada'],  ['adm2', 'authenticated', 'acotada'], ['uo', 'authenticated', 'acotada_sin_edit'],
    ['AD',  'authenticated', 'exenta'],   ['ow',   'authenticated', 'exenta'],   ['su', 'authenticated', 'exenta'],
    ['FAD', 'authenticated', 'otra'],     ['anon', 'anon',          'anon'],     ['svc', 'service_role',  'servicio']];
  v_tablas text[] := ARRAY['ordenes_compra', 'recepciones', 'facturas_proveedor', 'ordenes_pago', 'contrasenas_pago'];
  v_doc    text[] := ARRAY['oc', 'rec', 'gd', 'op', 'cp'];
  v_idt    text[] := ARRAY['oc', 'rec', 'fac', 'op', 'cp'];
  v_pe int; v_t int; v_p text; v_rol text; v_clase text; v_uid uuid; v_tabla text; v_ins text; v_x text; v_g text; v_id uuid; v_proj text; v_via text;
  v_sql text; v_n bigint := 0;
BEGIN
  -- anon: en producción NO tiene SELECT, INSERT ni UPDATE sobre estas nueve tablas (verificado con SELECT sobre producción: 0 de 9), así que allí el rechazo es «permission denied»
  -- (42501) antes de llegar a la RLS. Aquí se le CONCEDE el DML a propósito, dentro de esta prueba, para comprobar lo más exigente: que aunque lo tuviera la RLS lo detiene.
  PERFORM public.prj_como(NULL, 'sistema');
  GRANT SELECT, INSERT, UPDATE ON public.ordenes_compra, public.recepciones, public.facturas_proveedor, public.ordenes_pago, public.contrasenas_pago TO anon;
  BEGIN
    FOR v_pe IN 1 .. array_length(v_pers, 1) LOOP
      v_p := v_pers[v_pe][1]; v_rol := v_pers[v_pe][2]; v_clase := v_pers[v_pe][3];
      v_uid := CASE WHEN v_p IN ('anon', 'svc') THEN NULL ELSE public.prj_id(v_p, 'u') END;
      PERFORM public.prj_como(v_uid, v_rol);
      FOR v_t IN 1 .. 5 LOOP
        v_tabla := v_tablas[v_t];
        FOREACH v_proj IN ARRAY ARRAY['A', 'B', 'N'] LOOP
          v_x := CASE v_proj WHEN 'A' THEN quote_literal(A) WHEN 'B' THEN quote_literal(B) ELSE 'NULL' END;
          v_ins := CASE v_tabla
            WHEN 'ordenes_compra' THEN format('INSERT INTO public.ordenes_compra (company_id, project_id, proveedor_id, proveedor_nombre, concepto) VALUES (%L, %s, %L, ''P'', ''x'')', E, v_x, P)
            WHEN 'recepciones' THEN format('INSERT INTO public.recepciones (company_id, project_id, orden_compra_id, tipo) VALUES (%L, %s, %L, ''servicio'')', E, v_x,
                public.prj_id(CASE v_proj WHEN 'A' THEN 'an_a' WHEN 'B' THEN 'an_b' ELSE 'an_n' END, 'oc'))
            WHEN 'facturas_proveedor' THEN format('INSERT INTO public.facturas_proveedor (company_id, project_id, proveedor_id, numero_factura, concepto, monto_total) VALUES (%L, %s, %L, ''ZZ-1'', ''x'', 1)', E, v_x, P)
            WHEN 'ordenes_pago' THEN format('INSERT INTO public.ordenes_pago (company_id, project_id, proveedor_id, factura_id, monto) VALUES (%L, %s, %L, %L, 10)', E, v_x, P,
                public.prj_id(CASE v_proj WHEN 'A' THEN 'fa_a' WHEN 'B' THEN 'fa_b' ELSE 'fa_n' END, 'fac'))
            ELSE format('INSERT INTO public.contrasenas_pago (company_id, project_id, proveedor_id, fecha_pago_programada) VALUES (%L, %s, %L, current_date + 30)', E, v_x, P)
          END;
          PERFORM public.prj_verifica(v_ins, public.prj_esperado(v_clase, v_tabla, 'INS_' || v_proj, 'API'),
            format('[%s · %s · INSERT %s · API]', v_p, v_tabla, CASE v_proj WHEN 'A' THEN 'en A' WHEN 'B' THEN 'en B (no asignado)' ELSE 'sin proyecto' END));
          v_n := v_n + 1;
        END LOOP;
        FOREACH v_g IN ARRAY ARRAY['A>N', 'A>B', 'N>A', 'N>B', 'B>A', 'B>N'] LOOP
          v_id := public.prj_id(v_doc[v_t] || '_' || lower(split_part(v_g, '>', 1)), v_idt[v_t]);
          v_x := CASE split_part(v_g, '>', 2) WHEN 'A' THEN quote_literal(A) WHEN 'B' THEN quote_literal(B) ELSE 'NULL' END;
          FOREACH v_via IN ARRAY ARRAY['API', 'DEF'] LOOP
            CONTINUE WHEN v_via = 'DEF' AND v_p IN ('anon', 'svc');
            v_sql := CASE v_via
              WHEN 'API' THEN format('UPDATE public.%I SET project_id = %s WHERE id = %L', v_tabla, v_x, v_id)
              ELSE format('SELECT 1 FROM (SELECT public.prj_definer_mover(%L, %L, %s) AS n) s WHERE s.n = 1', v_tabla, v_id, v_x)
            END;
            PERFORM public.prj_verifica(v_sql, public.prj_esperado(v_clase, v_tabla, v_g, v_via), format('[%s · %s · UPDATE %s · %s]', v_p, v_tabla, v_g, v_via));
            v_n := v_n + 1;
          END LOOP;
        END LOOP;
      END LOOP;
      PERFORM public.prj_como(NULL, 'sistema');
    END LOOP;
  EXCEPTION WHEN OTHERS THEN
    PERFORM public.prj_como(NULL, 'sistema');
    REVOKE ALL ON public.ordenes_compra, public.recepciones, public.facturas_proveedor, public.ordenes_pago, public.contrasenas_pago FROM anon;
    RAISE;
  END;
  REVOKE ALL ON public.ordenes_compra, public.recepciones, public.facturas_proveedor, public.ordenes_pago, public.contrasenas_pago FROM anon;
  PERFORM public.prj_igual(v_n::text, '615', '[matriz] se recorrieron las 615 celdas (7 clases de persona × 75 + 2 × 45)');
END;
$matriz$;

-- ═══════════════════════════════════════════════════════════════════════════
-- c · PERSONAS ACOTADAS DE OTRO TIPO: sin ninguna asignación y con el proyecto en app_users.project_id
-- ═══════════════════════════════════════════════════════════════════════════
DO $otros$
DECLARE
  E constant uuid := public.prj_id('E', 'co');  A constant uuid := public.prj_id('A', 'pa');  B constant uuid := public.prj_id('B', 'pb');
  P constant uuid := public.prj_id('P', 'pv');
  ua0 constant uuid := public.prj_id('ua0', 'u');  uap constant uuid := public.prj_id('uap', 'u');
  v_ins text := 'INSERT INTO public.ordenes_compra (company_id, project_id, proveedor_id, proveedor_nombre, concepto) VALUES (%L, %s, %L, ''P'', ''x'')';
BEGIN
  PERFORM public.prj_como(ua0);
  PERFORM public.prj_igual(public.user_is_project_exempt()::text, 'false', '[ua0] montaje: un operador sin asignaciones NO es exento de proyecto (solo lo es el administrador sin asignaciones)');
  PERFORM public.prj_verifica(format(v_ins, E, quote_literal(A), P), 'ERR:42501:necesita estar asignado al proyecto del documento', '[ua0 · operador sin asignaciones · ordenes_compra · INSERT en A] no tiene proyecto: rechazado');
  PERFORM public.prj_verifica(format(v_ins, E, 'NULL', P), 'ERR:42501:sin proyecto', '[ua0 · operador sin asignaciones · ordenes_compra · INSERT sin proyecto] rechazado');
  PERFORM public.prj_como(uap);
  PERFORM public.prj_verifica(format(v_ins, E, quote_literal(A), P), 'OK1', '[uap · proyecto en app_users.project_id · ordenes_compra · INSERT en A] su proyecto, aunque no tenga asignaciones: pasa');
  PERFORM public.prj_verifica(format(v_ins, E, quote_literal(B), P), 'ERR:42501:necesita estar asignado al proyecto del documento', '[uap · ordenes_compra · INSERT en B] rechazado');
  PERFORM public.prj_verifica(format(v_ins, E, 'NULL', P), 'ERR:42501:sin proyecto', '[uap · ordenes_compra · INSERT sin proyecto] rechazado');
  PERFORM public.prj_como(NULL, 'sistema');
END;
$otros$;

-- ═══════════════════════════════════════════════════════════════════════════
-- d · LAS HIJAS: renglones en la cabecera de un proyecto no asignado, y mover un renglón de documento
-- ═══════════════════════════════════════════════════════════════════════════
DO $hijas$
DECLARE
  E constant uuid := public.prj_id('E', 'co');
  v_pers text[][] := ARRAY[['ua', 'acotada'], ['adm2', 'acotada'], ['uo', 'acotada'], ['AD', 'exenta'], ['ow', 'exenta'], ['su', 'exenta']];
  v_pe int; v_p text; v_clase text; v_proj text; v_esp text; v_k int;
  v_cab text[] := ARRAY['oc', 'rec', 'gd', 'cp'];
  v_tab text[] := ARRAY['orden_compra_lineas', 'recepcion_lineas', 'factura_proveedor_lineas', 'contrasena_pago_facturas'];
  v_sql text;
BEGIN
  FOR v_pe IN 1 .. array_length(v_pers, 1) LOOP
    v_p := v_pers[v_pe][1]; v_clase := v_pers[v_pe][2];
    PERFORM public.prj_como(public.prj_id(v_p, 'u'));
    FOREACH v_proj IN ARRAY ARRAY['a', 'b', 'n'] LOOP
      -- acotada: renglón en A pasa; en B muere; en la cabecera ya sin proyecto pasa (D-4: lo existente sin proyecto sigue siendo «de la empresa»)
      v_esp := CASE WHEN v_clase = 'exenta' OR v_proj <> 'b' THEN 'OK1' ELSE 'ERR:42501:agregar o mover renglones de un documento de compras tu perfil necesita estar asignado al proyecto del documento' END;
      FOR v_k IN 1 .. 4 LOOP
        v_sql := CASE v_k
          WHEN 1 THEN format('INSERT INTO public.orden_compra_lineas (company_id, orden_compra_id, linea, descripcion, destino_tipo, categoria, cantidad, unidad, precio_unitario, iva_monto) VALUES (%L, %L, 9, ''x'', ''servicio'', ''servicios'', 1, ''servicio'', 5, 0)', E, public.prj_id('oc_' || v_proj, 'oc'))
          WHEN 2 THEN format('INSERT INTO public.recepcion_lineas (company_id, recepcion_id, orden_compra_linea_id, cantidad) VALUES (%L, %L, %L, 1)', E, public.prj_id('rec_' || v_proj, 'rec'), public.prj_id('rec_' || v_proj, 'ocl'))
          WHEN 3 THEN format('INSERT INTO public.factura_proveedor_lineas (company_id, factura_id, linea, descripcion, cantidad, precio_unitario, iva_monto) VALUES (%L, %L, 9, ''x'', 1, 5, 0)', E, public.prj_id('gd_' || v_proj, 'fac'))
          ELSE format('INSERT INTO public.contrasena_pago_facturas (company_id, contrasena_id, factura_id, monto) VALUES (%L, %L, %L, 10)', E, public.prj_id('cp_' || v_proj, 'cp'), public.prj_id('fa_' || v_proj, 'fac'))
        END;
        PERFORM public.prj_verifica(v_sql, v_esp, format('[%s · %s · INSERT en la cabecera %s]', v_p, v_tab[v_k], CASE v_proj WHEN 'a' THEN 'de A' WHEN 'b' THEN 'de B (no asignado)' ELSE 'sin proyecto' END));
      END LOOP;
    END LOOP;
    -- mover un renglón de su documento (de A) a un documento de B: solo lo hace quien tiene B (la acotada ve el renglón de A, no el de B)
    PERFORM public.prj_verifica(format('UPDATE public.orden_compra_lineas SET orden_compra_id = %L, linea = 77 WHERE orden_compra_id = %L',
        public.prj_id('oc_b', 'oc'), public.prj_id('oc_a', 'oc')),
      CASE WHEN v_clase = 'exenta' THEN 'OKN' WHEN v_p = 'uo' THEN 'OK0' ELSE 'ERR:42501:(agregar o mover renglones|row-level security)' END,
      format('[%s · orden_compra_lineas · mover un renglón del documento de A al de B]%s', v_p,
             CASE WHEN v_clase = 'exenta' OR v_p = 'uo' THEN '' ELSE ' (control: hoy ya lo para la RLS de UPDATE, que pide ver la cabecera nueva; con la propuesta lo para el disparador, antes)' END));
    PERFORM public.prj_como(NULL, 'sistema');
  END LOOP;
  -- renglones ajenos de B: ver / cambiar / borrar los renglones de un documento de B por la API sigue dando CERO filas a la acotada
  PERFORM public.prj_como(public.prj_id('ua', 'u'));
  PERFORM public.prj_verifica(format('UPDATE public.orden_compra_lineas SET descripcion = ''zz'' WHERE orden_compra_id = %L', public.prj_id('oc_b', 'oc')), 'OK0',
    '[ua · orden_compra_lineas · UPDATE de los renglones de B por la API] cero filas (la política SELECT los esconde)');
  PERFORM public.prj_verifica(format('DELETE FROM public.orden_compra_lineas WHERE orden_compra_id = %L', public.prj_id('oc_b', 'oc')), 'OK0',
    '[ua · orden_compra_lineas · DELETE de los renglones de B por la API] cero filas');
  -- service_role y los procesos de sistema no se bloquean
  PERFORM public.prj_como(NULL, 'service_role');
  PERFORM public.prj_verifica(format('INSERT INTO public.orden_compra_lineas (company_id, orden_compra_id, linea, descripcion, destino_tipo, categoria, cantidad, unidad, precio_unitario, iva_monto) VALUES (%L, %L, 9, ''x'', ''servicio'', ''servicios'', 1, ''servicio'', 5, 0)', E, public.prj_id('oc_b', 'oc')), 'OK1',
    '[service_role · orden_compra_lineas · renglón en la cabecera de B] no se bloquea');
  PERFORM public.prj_como(NULL, 'sistema');
END;
$hijas$;

-- ═══════════════════════════════════════════════════════════════════════════
-- d2 · «OF project_id» dispara también cuando el SET trae el MISMO valor: eso no mueve nada y no se rechaza (ni a la acotada, ni sobre un documento sin proyecto)
--      · y un renglón que SALE de un documento de B (origen ajeno) tampoco se mueve por una función definer
-- ═══════════════════════════════════════════════════════════════════════════
DO $mismo$
DECLARE
  A constant uuid := public.prj_id('A', 'pa');
  E constant uuid := public.prj_id('E', 'co');
BEGIN
  PERFORM public.prj_como(public.prj_id('ua', 'u'));
  PERFORM public.prj_verifica(format('UPDATE public.ordenes_compra SET project_id = %L WHERE id = %L', A, public.prj_id('oc_a', 'oc')), 'OK1',
    '[ua · ordenes_compra · SET project_id = el MISMO (A)] no mueve nada: pasa');
  PERFORM public.prj_verifica(format('UPDATE public.ordenes_compra SET project_id = NULL WHERE id = %L', public.prj_id('oc_n', 'oc')), 'OK1',
    '[ua · ordenes_compra · SET project_id = NULL sobre un documento que YA está sin proyecto] no mueve nada: pasa');
  PERFORM public.prj_verifica(format('UPDATE public.facturas_proveedor SET project_id = NULL WHERE id = %L', public.prj_id('gd_n', 'fac')), 'OK1',
    '[ua · facturas_proveedor · SET project_id = NULL sobre un documento ya sin proyecto] no mueve nada: pasa');
  PERFORM public.prj_verifica(format('UPDATE public.contrasenas_pago SET project_id = NULL WHERE id = %L', public.prj_id('cp_n', 'cp')), 'OK1',
    '[ua · contrasenas_pago · SET project_id = NULL sobre un documento ya sin proyecto] no mueve nada: pasa');
  PERFORM public.prj_verifica(format('SELECT 1 FROM (SELECT public.prj_definer_mover_renglon(%L, %L) AS n) s WHERE s.n = 1',
      public.prj_id('oc_b', 'ocl'), public.prj_id('oc_a', 'oc')),
    'ERR:42501:agregar o mover renglones', '[ua · función definer · sacar un renglón de un documento de B y ponerlo en uno de A] el documento de ORIGEN también tiene que estar a su alcance');
  -- «OF <llave a la cabecera>» con el MISMO valor sobre un renglón de B, por una función definer: no lo mueve y no se rechaza (es «todo UPDATE», D-6)
  PERFORM public.prj_verifica(format('SELECT 1 FROM (SELECT public.prj_definer_mover_renglon(%L, %L) AS n) s WHERE s.n = 1', public.prj_id('oc_b', 'ocl'), public.prj_id('oc_b', 'oc')), 'OK1',
    '[ua · función definer · SET orden_compra_id = el MISMO en un renglón de B] no mueve el renglón: pasa (límite D-6: editar sin mover sigue sin mirar el proyecto)');
  PERFORM public.prj_como(NULL, 'sistema');
END;
$mismo$;

-- ═══════════════════════════════════════════════════════════════════════════
-- e · FUNCIONES SECURITY DEFINER que INSERTAN (la RLS no rige para su dueño): el proyecto sí se mira; la EMPRESA no (límite D-5)
-- ═══════════════════════════════════════════════════════════════════════════
DO $empresa$
DECLARE
  E constant uuid := public.prj_id('E', 'co');  F constant uuid := public.prj_id('F', 'co');
  P constant uuid := public.prj_id('P', 'pv');  FP constant uuid := public.prj_id('FP', 'pv');
  A constant uuid := public.prj_id('A', 'pa');  B constant uuid := public.prj_id('B', 'pb');
BEGIN
  PERFORM public.prj_como(public.prj_id('ua', 'u'));
  PERFORM public.prj_verifica(format('SELECT 1 FROM (SELECT public.prj_definer_insertar(%L, %L, %L) AS n) s WHERE s.n = 1', E, B, P),
    'ERR:42501:necesita estar asignado al proyecto del documento', '[ua · función definer · INSERT en B] una función definer tampoco abre B');
  PERFORM public.prj_verifica(format('SELECT 1 FROM (SELECT public.prj_definer_insertar(%L, NULL, %L) AS n) s WHERE s.n = 1', E, P),
    'ERR:42501:sin proyecto', '[ua · función definer · INSERT sin proyecto] tampoco abre «sin proyecto»');
  PERFORM public.prj_verifica(format('SELECT 1 FROM (SELECT public.prj_definer_insertar(%L, %L, %L) AS n) s WHERE s.n = 1', E, A, P), 'OK1',
    '[ua · función definer · INSERT en A] el suyo pasa');
  -- D-5 · la empresa del INSERT no se compara con la de la sesión (en la API lo hacen la RLS y trg_00_compras_rls_empresa; una función definer no).
  --       Si el dueño decide que SÍ (D-5), las tres comprobaciones siguientes pasan a rechazo COMPRAS_ALCANCE_EMPRESA.
  PERFORM public.prj_como(public.prj_id('FAD', 'u'));
  PERFORM public.prj_verifica(format('SELECT 1 FROM (SELECT public.prj_definer_insertar(%L, NULL, %L) AS n) s WHERE s.n = 1', E, P), 'OK1',
    '[límite D-5 · FAD · función definer · INSERT en la empresa E, sin proyecto] el administrador de F (exento en F) inserta en E: la empresa no se compara (si D-5 = sí, se rechaza)');
  PERFORM public.prj_verifica(format('SELECT 1 FROM (SELECT public.prj_definer_insertar(%L, %L, %L) AS n) s WHERE s.n = 1', E, A, P), 'OK1',
    '[límite D-5 · FAD · función definer · INSERT en la empresa E, proyecto A] igual (si D-5 = sí, se rechaza)');
  PERFORM public.prj_verifica(format('SELECT 1 FROM (SELECT public.prj_definer_insertar(%L, NULL, %L) AS n) s WHERE s.n = 1', F, FP), 'OK1',
    '[FAD · función definer · INSERT en su propia empresa F, sin proyecto] es exento en F: pasa');
  PERFORM public.prj_como(public.prj_id('nc', 'u'));
  PERFORM public.prj_verifica(format('SELECT 1 FROM (SELECT public.prj_definer_insertar(%L, NULL, %L) AS n) s WHERE s.n = 1', E, P), 'OK1',
    '[límite D-5 · nc · función definer · INSERT en E] un administrador SIN empresa (company_id NULL, exento por no tener asignaciones) tampoco pasa por la empresa (si D-5 = sí, se rechaza)');
  PERFORM public.prj_como(public.prj_id('su2', 'u'));
  PERFORM public.prj_verifica(format('SELECT 1 FROM (SELECT public.prj_definer_insertar(%L, NULL, %L) AS n) s WHERE s.n = 1', E, P), 'OK1',
    '[su2 · función definer · INSERT en E, sin proyecto] el superadministrador (sesión de F) actúa en cualquier empresa');
  PERFORM public.prj_verifica(format('INSERT INTO public.ordenes_compra (company_id, project_id, proveedor_id, proveedor_nombre, concepto) VALUES (%L, %L, %L, ''P'', ''x'')', E, B, P), 'OK1',
    '[su2 · API · INSERT en el proyecto B de E] y por la API');
  PERFORM public.prj_como(NULL, 'sistema');
END;
$empresa$;

-- ═══════════════════════════════════════════════════════════════════════════
-- f · LO LEGÍTIMO
-- ═══════════════════════════════════════════════════════════════════════════
-- f1 · la persona acotada, en su proyecto: el ciclo completo orden → recepción → factura → orden de pago pagada, por la API (persistido)
DO $ciclo_a$
DECLARE
  E constant uuid := public.prj_id('E', 'co');  A constant uuid := public.prj_id('A', 'pa');  P constant uuid := public.prj_id('P', 'pv');
  ua constant uuid := public.prj_id('ua', 'u');
  v_r text;
BEGIN
  PERFORM public.prj_como(ua);
  v_r := public.prj_ejecuta(format('SELECT public.prj_cadena(%L, %L, %L, %L, ''op_pagada'')', 'ciclo_ua', E, A, P));
  PERFORM public.prj_resultado('[ua · ciclo completo en A] orden → aprobar → emitir → recepción → registrar → factura → aprobar → orden de pago → aprobar → pagar, todo en su proyecto',
    CASE WHEN v_r LIKE 'OK%' THEN NULL ELSE v_r END);
  PERFORM public.prj_como(NULL, 'sistema');
  PERFORM public.prj_igual((SELECT estado || '/' || COALESCE(project_id::text, 'NULL') FROM public.ordenes_pago WHERE id = public.prj_id('ciclo_ua', 'op')), 'pagada/' || A::text,
    '[ua · ciclo completo en A] la orden de pago quedó PAGADA y en A');
  PERFORM public.prj_igual((SELECT count(*)::text FROM public.conta_asientos WHERE origen_tabla = 'ordenes_pago' AND origen_id = public.prj_id('ciclo_ua', 'op') AND estado <> 'anulado'),
    '1', '[ua · ciclo completo en A] y generó su asiento contable');
END;
$ciclo_a$;

-- f2 · la persona exenta, en la contabilidad de la Empresa (sin proyecto): el ciclo completo
DO $ciclo_n$
DECLARE
  E constant uuid := public.prj_id('E', 'co');  P constant uuid := public.prj_id('P', 'pv');
  v_pers text[] := ARRAY['ow', 'AD', 'su'];
  v_p text; v_r text;
BEGIN
  FOREACH v_p IN ARRAY v_pers LOOP
    PERFORM public.prj_como(public.prj_id(v_p, 'u'));
    v_r := public.prj_ejecuta(format('SELECT public.prj_cadena(%L, %L, NULL, %L, ''op_pagada'')', 'ciclo_' || v_p, E, P));
    PERFORM public.prj_resultado(format('[%s · ciclo completo SIN proyecto (contabilidad de la Empresa)] el ciclo entero pasa para quien es exento', v_p),
      CASE WHEN v_r LIKE 'OK%' THEN NULL ELSE v_r END);
    PERFORM public.prj_como(NULL, 'sistema');
    PERFORM public.prj_igual((SELECT estado || '/' || (project_id IS NULL)::text FROM public.ordenes_pago WHERE id = public.prj_id('ciclo_' || v_p, 'op')), 'pagada/true',
      format('[%s · ciclo SIN proyecto] la orden de pago quedó pagada y sin proyecto', v_p));
  END LOOP;
END;
$ciclo_n$;

-- f3 · mover entre SUS proyectos (uab: A y B) y la exenta mueve desde y hacia «sin proyecto» (persistido, con ida y vuelta)
DO $mover$
DECLARE
  E constant uuid := public.prj_id('E', 'co');  A constant uuid := public.prj_id('A', 'pa');  B constant uuid := public.prj_id('B', 'pb');
  P constant uuid := public.prj_id('P', 'pv');  uab constant uuid := public.prj_id('uab', 'u');  ow constant uuid := public.prj_id('ow', 'u');
  v_r text;
BEGIN
  PERFORM public.prj_como(uab);
  INSERT INTO public.ordenes_compra (id, company_id, project_id, proveedor_id, proveedor_nombre, concepto) VALUES (public.prj_id('mv', 'oc'), E, A, P, 'P', 'mover');
  INSERT INTO public.facturas_proveedor (id, company_id, project_id, proveedor_id, numero_factura, concepto, monto_total) VALUES (public.prj_id('mv', 'fac'), E, A, P, 'MV-1', 'mover', 1);
  INSERT INTO public.contrasenas_pago (id, company_id, project_id, proveedor_id, fecha_pago_programada) VALUES (public.prj_id('mv', 'cp'), E, A, P, current_date + 30);
  PERFORM public.prj_como(NULL, 'sistema');
  UPDATE public.contrasenas_pago SET numero = 'PRJ-MV-1' WHERE id = public.prj_id('mv', 'cp');
  PERFORM public.prj_como(uab);
  PERFORM public.prj_verifica(format('UPDATE public.ordenes_compra SET project_id = %L WHERE id = %L', B, public.prj_id('mv', 'oc')), 'OK1', '[uab · ordenes_compra · de A a B] entre SUS proyectos pasa', true);
  PERFORM public.prj_verifica(format('UPDATE public.ordenes_compra SET project_id = %L WHERE id = %L', A, public.prj_id('mv', 'oc')), 'OK1', '[uab · ordenes_compra · de B a A] y de vuelta', true);
  PERFORM public.prj_verifica(format('UPDATE public.facturas_proveedor SET project_id = %L WHERE id = %L', B, public.prj_id('mv', 'fac')), 'OK1', '[uab · facturas_proveedor · de A a B] pasa', true);
  PERFORM public.prj_verifica(format('UPDATE public.contrasenas_pago SET project_id = %L WHERE id = %L', B, public.prj_id('mv', 'cp')), 'OK1', '[uab · contrasenas_pago · de A a B] pasa', true);
  PERFORM public.prj_verifica(format('UPDATE public.ordenes_compra SET project_id = NULL WHERE id = %L', public.prj_id('mv', 'oc')), 'ERR:42501:dejar un documento de compras sin proyecto',
    '[uab · ordenes_compra · de A a «sin proyecto»] aunque tenga A y B, sacar un documento de su proyecto es de quien es exento');
  PERFORM public.prj_como(ow);
  PERFORM public.prj_verifica(format('UPDATE public.ordenes_compra SET project_id = NULL WHERE id = %L', public.prj_id('mv', 'oc')), 'OK1', '[ow · ordenes_compra · a «sin proyecto»] el propietario puede', true);
  PERFORM public.prj_verifica(format('UPDATE public.ordenes_compra SET project_id = %L WHERE id = %L', B, public.prj_id('mv', 'oc')), 'OK1', '[ow · ordenes_compra · de «sin proyecto» a B] y de vuelta a un proyecto', true);
  PERFORM public.prj_verifica(format('UPDATE public.facturas_proveedor SET project_id = NULL WHERE id = %L', public.prj_id('mv', 'fac')), 'OK1', '[ow · facturas_proveedor · a «sin proyecto»] puede', true);
  PERFORM public.prj_verifica(format('UPDATE public.contrasenas_pago SET project_id = NULL WHERE id = %L', public.prj_id('mv', 'cp')), 'OK1', '[ow · contrasenas_pago · a «sin proyecto»] puede', true);
  PERFORM public.prj_como(NULL, 'sistema');
END;
$mover$;

-- f4 · LAS PANTALLAS de Contabilidad › Compras y Contabilidad › Cuentas por pagar (todo se DESHACE: run.sh comparte la base y VER-09 cuenta las claves de pagos de TODA ella): las mismas llamadas que hacen las mutaciones de src/domain/compras y src/domain/cxp
--      (RPC compras_orden_crear / compras_recepcion_crear / compras_factura_crear con el proyecto de la contabilidad activa; INSERT directo de contraseña, de
--      sus partidas y de la orden de pago). «Empresa» = project_id NULL; un proyecto = su id.
DO $pantalla$
DECLARE
  E constant uuid := public.prj_id('E', 'co');  A constant uuid := public.prj_id('A', 'pa');  B constant uuid := public.prj_id('B', 'pb');
  P constant uuid := public.prj_id('P', 'pv');
  v_cont text; v_p text; v_proj text; v_x text; v_pre text; v_esp text; v_q text; v_clase text; v_sufijo text;
  v_oc_cab text; v_lin text; v_rec_cab text; v_rec_lin text; v_fac_cab text; v_fac_lin text; v_rpc text;
BEGIN
  FOREACH v_p IN ARRAY ARRAY['ua', 'ow'] LOOP
    PERFORM public.prj_como(public.prj_id(v_p, 'u'));
    FOREACH v_proj IN ARRAY ARRAY['A', 'B', 'N'] LOOP
      -- v_proj = la contabilidad ACTIVA en el selector: A (su proyecto), B (otro proyecto) o N (🏢 Empresa)
      v_x := CASE v_proj WHEN 'A' THEN quote_literal(A) WHEN 'B' THEN quote_literal(B) ELSE 'NULL' END;
      v_pre := CASE v_proj WHEN 'A' THEN 'fl_a' WHEN 'B' THEN 'fl_b' ELSE 'fl_n' END;          -- orden emitida de esa contabilidad, para recibir y facturar
      v_sufijo := v_p || '-' || v_proj;
      v_cont := format('[%s · pantalla · contabilidad %s]', v_p, CASE v_proj WHEN 'A' THEN 'de su proyecto A' WHEN 'B' THEN 'del proyecto B (no asignado)' ELSE '«Empresa» (sin proyecto)' END);
      v_clase := CASE WHEN v_p = 'ow' OR v_proj = 'A' THEN 'OK' WHEN v_proj = 'N' THEN 'ERR:42501:sin proyecto' ELSE 'ERR:42501:necesita estar asignado al proyecto del documento' END;
      -- Con la contabilidad B (que la persona no tiene) las RPC se paran antes por su cuenta (no ven el proyecto ni la orden de B, o el RETURNING choca con la política SELECT): cualquier rechazo COMPRAS_* o de RLS; son controles, no brechas
      v_rpc := CASE WHEN v_p = 'ua' AND v_proj = 'B' THEN 'ERR:*:(COMPRAS_[A-Z_]+:|row-level security)' ELSE CASE v_clase WHEN 'OK' THEN 'OK1' ELSE v_clase END END;
      -- Compras › Nueva orden (RPC)
      v_oc_cab := jsonb_build_object('proveedor_id', P, 'concepto', 'Pantalla ' || v_sufijo, 'clave_idempotencia', 'pantalla-oc-' || v_sufijo)::text;
      v_lin := '[{"descripcion":"Servicio de pantalla","destino_tipo":"servicio","cantidad":1,"precio_unitario":50}]';
      PERFORM public.prj_verifica(format('SELECT public.compras_orden_crear(%L, %s, %L::jsonb, %L::jsonb)', E, v_x, v_oc_cab, v_lin),
        v_rpc, v_cont || ' Nueva orden de compra (RPC compras_orden_crear)');
      -- Compras › Registrar recepción (RPC) contra la orden emitida de esa contabilidad
      v_rec_cab := jsonb_build_object('orden_compra_id', public.prj_id(v_pre, 'oc'), 'tipo', 'servicio', 'clave_idempotencia', 'pantalla-rec-' || v_sufijo)::text;
      v_rec_lin := jsonb_build_array(jsonb_build_object('orden_compra_linea_id', public.prj_id(v_pre, 'ocl'), 'cantidad', 1))::text;
      PERFORM public.prj_verifica(format('SELECT public.compras_recepcion_crear(%L, %s, %L::jsonb, %L::jsonb)', E, v_x, v_rec_cab, v_rec_lin),
        v_rpc, v_cont || ' Registrar recepción (RPC compras_recepcion_crear)');
      -- Cuentas por pagar › Nueva factura (RPC) contra esa orden
      v_fac_cab := jsonb_build_object('proveedor_id', P, 'orden_compra_id', public.prj_id(v_pre, 'oc'), 'numero_factura', 'PANT-' || v_sufijo,
                                      'concepto', 'Pantalla', 'fecha_emision', '2026-10-02', 'clave_idempotencia', 'pantalla-fac-' || v_sufijo)::text;
      v_fac_lin := jsonb_build_array(jsonb_build_object('orden_compra_linea_id', public.prj_id(v_pre, 'ocl'), 'cantidad', 1, 'precio_unitario', 100))::text;
      PERFORM public.prj_verifica(format('SELECT public.compras_factura_crear(%L, %s, %L::jsonb, %L::jsonb)', E, v_x, v_fac_cab, v_fac_lin),
        v_rpc, v_cont || ' Nueva factura (RPC compras_factura_crear)');
      -- Compras › Emitir contraseña de pago (INSERT directo, como useCrearContrasenaMutation)
      v_q := format('INSERT INTO public.contrasenas_pago (company_id, project_id, proveedor_id, fecha_pago_programada, clave_idempotencia) VALUES (%L, %s, %L, current_date + 30, %L)', E, v_x, P, 'pantalla-cp-' || v_sufijo);
      PERFORM public.prj_verifica(v_q, CASE v_clase WHEN 'OK' THEN 'OK1' ELSE v_clase END, v_cont || ' Emitir contraseña de pago (INSERT directo)');
      -- Cuentas por pagar › Solicitar orden de pago (INSERT directo, como useCrearOrdenPagoMutation) sobre la factura aprobada de esa contabilidad
      v_q := format('INSERT INTO public.ordenes_pago (company_id, project_id, proveedor_id, factura_id, monto, estado, clave_idempotencia) VALUES (%L, %s, %L, %L, 10, ''borrador'', %L)',
                    E, v_x, P, public.prj_id('fa_' || lower(v_proj), 'fac'), 'pantalla-op-' || v_sufijo);
      PERFORM public.prj_verifica(v_q, CASE v_clase WHEN 'OK' THEN 'OK1' ELSE v_clase END, v_cont || ' Solicitar orden de pago (INSERT directo)');
    END LOOP;
    PERFORM public.prj_como(NULL, 'sistema');
  END LOOP;
  PERFORM public.prj_como(NULL, 'sistema');
  -- el reintento con la misma clave (doble clic) devuelve la MISMA orden sin volver a insertar (no pasa por la propuesta); todo se deshace
  PERFORM public.prj_como(public.prj_id('ua', 'u'));
  PERFORM public.prj_verifica(format('SELECT set_config(''prj.tmp'', (public.compras_orden_crear(%L, %L, %L::jsonb, %L::jsonb)->''orden'')->>''id'', true); '
      || 'SELECT 1 WHERE ((public.compras_orden_crear(%L, %L, %L::jsonb, %L::jsonb)->''orden'')->>''id'') = current_setting(''prj.tmp'')', E, A,
      jsonb_build_object('proveedor_id', P, 'concepto', 'Pantalla doble clic', 'clave_idempotencia', 'pantalla-oc-doble')::text, '[{"descripcion":"Servicio de pantalla","destino_tipo":"servicio","cantidad":1,"precio_unitario":50}]',
      E, A, jsonb_build_object('proveedor_id', P, 'concepto', 'Pantalla doble clic', 'clave_idempotencia', 'pantalla-oc-doble')::text, '[{"descripcion":"Servicio de pantalla","destino_tipo":"servicio","cantidad":1,"precio_unitario":50}]'),
    'OK1', '[ua · pantalla · Nueva orden] el reintento (doble clic) con la misma clave devuelve la MISMA orden, sin error');
  PERFORM public.prj_como(NULL, 'sistema');
END;
$pantalla$;

-- f5 · eliminar un proyecto (ON DELETE SET NULL de project_id): la propuesta no lo frena. Sin la 0700 del PR #928 lo elimina un administrador con asignaciones; CON la 0700
--      (projects_delete es del principal) lo elimina el propietario y el administrador obtiene CERO filas. La comprobación se adapta a la base (como D-0): el actor y la
--      redacción cambian, lo que se mide DESPUÉS (qué queda «sin proyecto» y quién lo ve) es lo mismo.
DO $purga$
DECLARE
  E constant uuid := public.prj_id('E', 'co');  P constant uuid := public.prj_id('P', 'pv');  AD constant uuid := public.prj_id('AD', 'u');
  G constant uuid := public.prj_id('G', 'pg');  adm2 constant uuid := public.prj_id('adm2', 'u');  ow constant uuid := public.prj_id('ow', 'u');
  -- ¿projects_delete ya es del principal (0700)? Por el texto de la política, no por el nombre de la migración.
  v_principal boolean := COALESCE((SELECT pg_get_expr(p.polqual, p.polrelid) ~ 'is_company_owner' FROM pg_policy p
                                    WHERE p.polrelid = 'public.projects'::regclass AND p.polname = 'projects_delete'), false);
BEGIN
  PERFORM public.prj_como(AD);
  INSERT INTO public.facturas_proveedor (id, company_id, project_id, proveedor_id, numero_factura, concepto, monto_total) VALUES
    (public.prj_id('g1', 'fac'), E, G, P, 'GPURGA-1', 'gasto directo G', 1), (public.prj_id('g2', 'fac'), E, G, P, 'GPURGA-2', 'gasto directo G 2', 1);
  INSERT INTO public.factura_proveedor_lineas (company_id, factura_id, linea, descripcion, cantidad, precio_unitario, iva_monto) VALUES
    (E, public.prj_id('g1', 'fac'), 1, 'gasto', 1, 100, 0), (E, public.prj_id('g2', 'fac'), 1, 'gasto', 1, 100, 0);
  UPDATE public.facturas_proveedor SET estado = 'aprobada' WHERE id = public.prj_id('g2', 'fac');
  INSERT INTO public.ordenes_pago (id, company_id, project_id, proveedor_id, factura_id, monto) VALUES (public.prj_id('g2', 'op'), E, G, P, public.prj_id('g2', 'fac'), 100);
  INSERT INTO public.contrasenas_pago (id, company_id, project_id, proveedor_id, fecha_pago_programada) VALUES (public.prj_id('g3', 'cp'), E, G, P, current_date + 30);
  INSERT INTO public.ordenes_compra (id, company_id, project_id, proveedor_id, proveedor_nombre, concepto) VALUES (public.prj_id('g4', 'oc'), E, G, P, 'P', 'G borrador');
  -- D-10 (antes): el proyecto G existe y ua (asignada solo a A) NO lo tiene: no ve ni toca las facturas de G
  PERFORM public.prj_como(public.prj_id('ua', 'u'));
  PERFORM public.prj_verifica(format('SELECT 1 FROM public.facturas_proveedor WHERE id = %L', public.prj_id('g1', 'fac')), 'OK0', '[D-10 · antes de eliminar G · ua] la factura de G no se ve (cero filas)');
  PERFORM public.prj_verifica(format('UPDATE public.facturas_proveedor SET concepto = ''editada por ua'' WHERE id = %L', public.prj_id('g1', 'fac')), 'OK0', '[D-10 · antes de eliminar G · ua] ni se edita (cero filas)');
  PERFORM public.prj_como(adm2);
  PERFORM public.prj_igual(public.user_is_project_exempt()::text, 'false', '[purga] montaje: el administrador tiene asignaciones, NO es exento de proyecto');
  IF v_principal THEN
    -- 0700: el administrador no elimina el proyecto (la RLS esconde la fila: CERO filas, no un error) y G sigue ahí con todo lo suyo
    PERFORM public.prj_verifica(format('DELETE FROM public.projects WHERE id = %L', G), 'OK0',
      '[purga · 0700 · adm2] el administrador con asignaciones NO elimina el proyecto G: cero filas (projects_delete es del principal de la empresa)');
    PERFORM public.prj_como(NULL, 'sistema');
    PERFORM public.prj_igual((SELECT count(*)::text FROM public.projects WHERE id = G), '1', '[purga · 0700 · adm2] el proyecto G sigue ahí tras el intento del administrador');
    PERFORM public.prj_igual((SELECT count(*)::text FROM public.facturas_proveedor WHERE id IN (public.prj_id('g1', 'fac'), public.prj_id('g2', 'fac')) AND project_id = G), '2',
      '[purga · 0700 · adm2] las dos facturas de G siguen en G');
    PERFORM public.prj_como(ow);
    PERFORM public.prj_igual(public.user_is_project_exempt()::text, 'true', '[purga · 0700] montaje: el propietario (el principal) es exento de proyecto');
    PERFORM public.prj_verifica(format('DELETE FROM public.projects WHERE id = %L', G), 'OK1',
      '[purga · 0700] el principal (propietario) elimina el proyecto G con facturas, orden de pago, contraseña y orden: ni la captura ni mover lo frenan', true);
  ELSE
    PERFORM public.prj_verifica(format('DELETE FROM public.projects WHERE id = %L', G), 'OK1',
      '[purga] el administrador con asignaciones elimina el proyecto G con facturas, orden de pago, contraseña y orden: ni la captura ni mover lo frenan', true);
  END IF;
  PERFORM public.prj_como(NULL, 'sistema');
  PERFORM public.prj_igual((SELECT count(*)::text FROM public.projects WHERE id = G), '0', '[purga] el proyecto ya no existe');
  PERFORM public.prj_igual((SELECT count(*)::text FROM public.facturas_proveedor WHERE id IN (public.prj_id('g1', 'fac'), public.prj_id('g2', 'fac')) AND project_id IS NULL), '2', '[purga] las dos facturas siguen ahí, solo sin proyecto');
  PERFORM public.prj_igual((SELECT count(*)::text FROM public.ordenes_pago WHERE id = public.prj_id('g2', 'op') AND project_id IS NULL), '1', '[purga] la orden de pago sigue ahí, solo sin proyecto');
  PERFORM public.prj_igual((SELECT count(*)::text FROM public.contrasenas_pago WHERE id = public.prj_id('g3', 'cp') AND project_id IS NULL), '1', '[purga] la contraseña sigue ahí, solo sin proyecto');
  -- ordenes_compra.project_id es ON DELETE CASCADE (previo, no de esta propuesta): el borrador de G se va con el proyecto; lo que importa es que nada lo frene
  PERFORM public.prj_igual((SELECT count(*)::text FROM public.ordenes_compra WHERE id = public.prj_id('g4', 'oc')), '0', '[purga] el borrador de orden de G se eliminó en cascada, como antes (FK ON DELETE CASCADE previa)');
  PERFORM public.prj_igual((SELECT string_agg(DISTINCT c.confdeltype::text, ',') FROM pg_constraint c JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ANY (c.conkey)
                             WHERE c.contype = 'f' AND c.confrelid = 'public.projects'::regclass AND a.attname = 'project_id'
                               AND c.conrelid = 'public.ordenes_compra'::regclass), 'c',
    '[purga · D-10] ordenes_compra.project_id es ON DELETE CASCADE (confdeltype c)');
  PERFORM public.prj_igual((SELECT string_agg(DISTINCT c.confdeltype::text, ',') FROM pg_constraint c JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ANY (c.conkey)
                             WHERE c.contype = 'f' AND c.confrelid = 'public.projects'::regclass AND a.attname = 'project_id'
                               AND c.conrelid IN ('public.recepciones'::regclass, 'public.facturas_proveedor'::regclass, 'public.ordenes_pago'::regclass, 'public.contrasenas_pago'::regclass)), 'n',
    '[purga · D-10] las otras cuatro tablas del circuito son ON DELETE SET NULL (confdeltype n)');
  -- D-10 (después): lo que era de G ya no tiene proyecto y por eso lo ve y lo actúa ua, que nunca tuvo G (no es una brecha NUEVA de esta propuesta: es lo que hace SET NULL con can_access_project(NULL)).
  --                  Con la 0700 sigue en pie: quien lo provoca es ahora el PRINCIPAL (el bloqueo de README §6.3 solo frenaría a un no exento, y un no exento ya no elimina proyectos).
  PERFORM public.prj_como(public.prj_id('ua', 'u'));
  PERFORM public.prj_verifica(format('SELECT 1 FROM public.facturas_proveedor WHERE id = %L', public.prj_id('g1', 'fac')), 'OK1',
    '[límite D-10 · ua] tras eliminar G, su factura quedó «sin proyecto» y ua, que nunca tuvo G, la VE (si se decide ON DELETE RESTRICT, o bloquear el borrado, esta comprobación pasa a cero filas)');
  PERFORM public.prj_verifica(format('UPDATE public.facturas_proveedor SET concepto = ''editada por ua'' WHERE id = %L', public.prj_id('g1', 'fac')), 'OK1',
    '[límite D-10 · ua] …y la EDITA (la llave de editar de Contabilidad basta: can_access_project(NULL) es verdadero)');
  PERFORM public.prj_verifica(format('SELECT 1 FROM public.contrasenas_pago WHERE id = %L', public.prj_id('g3', 'cp')), 'OK1',
    '[límite D-10 · ua] lo mismo con la contraseña de pago de G');
  PERFORM public.prj_como(NULL, 'sistema');
END;
$purga$;

-- ═══════════════════════════════════════════════════════════════════════════
-- g · SERVICE_ROLE Y PROCESOS DE SISTEMA: no se bloquean (misma guarda que la 0900)
-- ═══════════════════════════════════════════════════════════════════════════
DO $sistema$
DECLARE
  E constant uuid := public.prj_id('E', 'co');  A constant uuid := public.prj_id('A', 'pa');  B constant uuid := public.prj_id('B', 'pb');  P constant uuid := public.prj_id('P', 'pv');
  v_ins text := 'INSERT INTO public.ordenes_compra (company_id, project_id, proveedor_id, proveedor_nombre, concepto) VALUES (%L, %s, %L, ''P'', ''x'')';
BEGIN
  PERFORM public.prj_como(NULL, 'service_role');
  PERFORM public.prj_verifica(format(v_ins, E, 'NULL', P), 'OK1', '[service_role · INSERT sin proyecto] no se bloquea');
  PERFORM public.prj_verifica(format(v_ins, E, quote_literal(B), P), 'OK1', '[service_role · INSERT en B] no se bloquea');
  PERFORM public.prj_verifica(format('UPDATE public.ordenes_compra SET project_id = NULL WHERE id = %L', public.prj_id('oc_a', 'oc')), 'OK1', '[service_role · mover A a «sin proyecto»] no se bloquea');
  PERFORM public.prj_verifica(format('UPDATE public.ordenes_compra SET project_id = %L WHERE id = %L', A, public.prj_id('oc_n', 'oc')), 'OK1', '[service_role · reclamar un documento sin proyecto para A] no se bloquea');
  PERFORM public.prj_como(NULL, 'sistema');
  PERFORM public.prj_verifica(format(v_ins, E, 'NULL', P), 'OK1', '[sistema · INSERT sin proyecto, sin sesión de usuario] no se bloquea');
  -- un disparador de sistema (conta.allow_system_write = on) con la sesión de una persona acotada: es la guarda común de la 0900 (límite heredado, no de esta propuesta).
  -- El GUC lo puede fijar cualquier sesión authenticated con SQL directo (set_config); hoy NO es alcanzable por la API pública (ninguna función ejecutable por authenticated fija un GUC con
  -- clave/valor del llamador ni ejecuta SQL dinámico de parámetro; PostgREST solo expone tablas y funciones), pero es una puerta del diseño de la guarda: hardening APARTE (README §6, F6).
  PERFORM public.prj_como(public.prj_id('ua', 'u'));
  PERFORM public.prj_verifica(format('SELECT set_config(''conta.allow_system_write'', ''on'', true); ' || v_ins, E, 'NULL', P), 'OK1',
    '[límite F6 · ua con conta.allow_system_write = on] es un proceso de sistema, no una sesión de usuario: la misma guarda que ya usa la 0900 (límite heredado; fijable con SQL directo, no por la API pública hoy)');
  PERFORM public.prj_como(NULL, 'sistema');
END;
$sistema$;

-- ═══════════════════════════════════════════════════════════════════════════
-- g2 · EL ORIGEN DEL RENGLÓN QUE SE SACA DE UNA CABECERA AJENA: las tres hijas que no son orden_compra_lineas (F9)
--      (sacar un renglón de un documento de B y ponerlo en uno de A por una función definer; el documento de ORIGEN también tiene que estar al alcance)
-- ═══════════════════════════════════════════════════════════════════════════
DO $origen$
DECLARE
  E constant uuid := public.prj_id('E', 'co');  P constant uuid := public.prj_id('P', 'pv');
  ua constant uuid := public.prj_id('ua', 'u');  AD constant uuid := public.prj_id('AD', 'u');
  v_rl_b uuid; v_fl_b uuid; v_par_b uuid := public.prj_id('par_b', 'par');
  v_msg text := 'ERR:42501:agregar o mover renglones de un documento de compras tu perfil necesita estar asignado al proyecto del documento';
BEGIN
  PERFORM public.prj_como(NULL, 'sistema');
  SELECT id INTO v_rl_b FROM public.recepcion_lineas WHERE recepcion_id = public.prj_id('rec_b', 'rec') ORDER BY id LIMIT 1;
  SELECT id INTO v_fl_b FROM public.factura_proveedor_lineas WHERE factura_id = public.prj_id('gd_b', 'fac') ORDER BY id LIMIT 1;
  -- una partida en la contraseña de B (la siembra el sistema)
  INSERT INTO public.contrasena_pago_facturas (id, company_id, contrasena_id, factura_id, monto) VALUES (v_par_b, E, public.prj_id('cp_b', 'cp'), public.prj_id('fa_b', 'fac'), 10);
  PERFORM public.prj_igual(((v_rl_b IS NOT NULL) AND (v_fl_b IS NOT NULL))::text, 'true', '[montaje] existen un renglón de la recepción de B y uno de la factura de B');

  PERFORM public.prj_como(ua);
  -- recepcion_lineas: si solo se cambia la recepción, COMPRAS_RECEPCION_LINEA_AJENA (existente, dispara antes) lo rechaza por su cuenta; si TAMBIÉN se cambia el renglón de la orden por uno de la orden de A,
  -- el único que lo para es el chequeo del ORIGEN de la propuesta.
  PERFORM public.prj_verifica(format('SELECT 1 FROM (SELECT public.prj_definer_mover_hija(''recepcion_lineas'', %L, %L) AS n) s WHERE s.n = 1', v_rl_b, public.prj_id('rec_a', 'rec')),
    'ERR:23514:COMPRAS_RECEPCION_LINEA_AJENA', '[ua · recepcion_lineas · función definer · sacar el renglón de la recepción de B a la de A, SIN cambiar su renglón de orden] lo para antes la integridad existente (23514)');
  PERFORM public.prj_verifica(format('SELECT 1 FROM (SELECT public.prj_definer_mover_hija(''recepcion_lineas'', %L, %L, %L) AS n) s WHERE s.n = 1', v_rl_b, public.prj_id('rec_a', 'rec'), public.prj_id('rec_a', 'ocl')),
    v_msg, '[ua · recepcion_lineas · función definer · sacar el renglón de la recepción de B a la de A, cambiando también su renglón de orden] el ORIGEN (B) no está a su alcance: 42501');
  -- factura_proveedor_lineas: nada previo lo para
  PERFORM public.prj_verifica(format('SELECT 1 FROM (SELECT public.prj_definer_mover_hija(''factura_proveedor_lineas'', %L, %L) AS n) s WHERE s.n = 1', v_fl_b, public.prj_id('gd_a', 'fac')),
    v_msg, '[ua · factura_proveedor_lineas · función definer · sacar el renglón de la factura de B a la de A] el ORIGEN (B) no está a su alcance: 42501');
  -- contrasena_pago_facturas: COMPRAS_CONTRASENA_PARTIDA_FIJA (existente) rechaza ANTES cualquier cambio de contraseña de una partida …
  PERFORM public.prj_verifica(format('SELECT 1 FROM (SELECT public.prj_definer_mover_hija(''contrasena_pago_facturas'', %L, %L) AS n) s WHERE s.n = 1', v_par_b, public.prj_id('cp_a', 'cp')),
    'ERR:23514:COMPRAS_CONTRASENA_PARTIDA_FIJA', '[ua · contrasena_pago_facturas · función definer · pasar la partida de la contraseña de B a la de A] lo para antes COMPRAS_CONTRASENA_PARTIDA_FIJA (23514)');
  -- … así que el chequeo del ORIGEN de la propuesta es defensa en profundidad: se ejerce con ese disparador desactivado dentro de una subtransacción que se deshace
  PERFORM public.prj_resultado('[ua · contrasena_pago_facturas · función definer · la partida pasada a la contraseña Y a la factura de A, con trg_compras_bloqueo_partida_orden DESACTIVADO (se deshace)] el ORIGEN (B) no está a su alcance: 42501',
    public.prj_evaluar(v_msg, public.prj_definer_mover_hija_aislada('contrasena_pago_facturas', 'trg_compras_bloqueo_partida_orden', v_par_b, public.prj_id('cp_a', 'cp'), public.prj_id('fa_a', 'fac'))));
  -- y lo mismo para las otras dos, aisladas de sus protecciones previas: el ORIGEN decide
  PERFORM public.prj_resultado('[ua · recepcion_lineas · función definer · solo la recepción, con trg_compras_integridad_recepcion_linea DESACTIVADO (se deshace)] el ORIGEN (B) no está a su alcance: 42501',
    public.prj_evaluar(v_msg, public.prj_definer_mover_hija_aislada('recepcion_lineas', 'trg_compras_integridad_recepcion_linea', v_rl_b, public.prj_id('rec_a', 'rec'))));
  -- control: la persona EXENTA sí puede (nada cambia para ella), también con el disparador de partida desactivado
  PERFORM public.prj_como(AD);
  PERFORM public.prj_resultado('[AD (exento) · contrasena_pago_facturas · función definer · la misma partida y factura de A, con trg_compras_bloqueo_partida_orden DESACTIVADO (se deshace)] el exento pasa',
    public.prj_evaluar('OK1', public.prj_definer_mover_hija_aislada('contrasena_pago_facturas', 'trg_compras_bloqueo_partida_orden', v_par_b, public.prj_id('cp_a', 'cp'), public.prj_id('fa_a', 'fac'))));
  PERFORM public.prj_como(NULL, 'sistema');
END;
$origen$;

-- ═══════════════════════════════════════════════════════════════════════════
-- g3 · F7: LAS TABLAS VECINAS con project_id NO están cubiertas (alcance declarado: solo las 5 + 4 tablas del circuito de compras y pagos)
-- ═══════════════════════════════════════════════════════════════════════════
DO $vecinas$
DECLARE
  E constant uuid := public.prj_id('E', 'co');  A constant uuid := public.prj_id('A', 'pa');  B constant uuid := public.prj_id('B', 'pb');
BEGIN
  PERFORM public.prj_como(public.prj_id('ua', 'u'));
  PERFORM public.prj_verifica(format('INSERT INTO public.suministros_condominio (company_id, project_id, nombre) VALUES (%L, %L, ''PRJ vecina'')', E, A), 'OK1',
    '[F7 · ua · suministros_condominio · INSERT en A] el suyo pasa');
  PERFORM public.prj_verifica(format('INSERT INTO public.suministros_condominio (company_id, project_id, nombre) VALUES (%L, %L, ''PRJ vecina'')', E, B), 'OK1',
    '[límite F7 · ua · suministros_condominio · INSERT en B (no asignado)] FUERA DEL ALCANCE de la propuesta: su política INSERT no mira el proyecto y no hay disparador (hace falta otra pieza igual a esta)');
  PERFORM public.prj_verifica(format('INSERT INTO public.proformas_condominio (company_id, project_id, proveedor_nombre, concepto) VALUES (%L, %L, ''P'', ''PRJ vecina'')', E, B), 'OK1',
    '[límite F7 · ua · proformas_condominio · INSERT en B (no asignado)] ídem');
  PERFORM public.prj_como(NULL, 'sistema');
END;
$vecinas$;

-- ═══════════════════════════════════════════════════════════════════════════
-- g4 · F10: permission_type NO se lee (una asignación 'lectura' captura en su proyecto) · F1/D-9: «exento» = no tener filas de asignación
-- ═══════════════════════════════════════════════════════════════════════════
DO $permission_type$
DECLARE
  E constant uuid := public.prj_id('E', 'co');  A constant uuid := public.prj_id('A', 'pa');  B constant uuid := public.prj_id('B', 'pb');  P constant uuid := public.prj_id('P', 'pv');
  ol constant uuid := public.prj_id('ol', 'u');  adm3 constant uuid := public.prj_id('adm3', 'u');  ow constant uuid := public.prj_id('ow', 'u');
  v_ins text := 'INSERT INTO public.ordenes_compra (company_id, project_id, proveedor_id, proveedor_nombre, concepto) VALUES (%L, %s, %L, ''P'', ''x'')';
  v_borrar text;
  -- ¿asignacion_puede_administrar ya es la regla del PRINCIPAL (0600 de #928 desde 7bf85221)? Por el cuerpo de la función (usa is_company_owner() y no nombra al administrador), como su post-vuelo.
  v_principal boolean := COALESCE((SELECT p.prosrc ~ 'is_company_owner' AND p.prosrc !~ '''admin'''
                                     FROM pg_proc p WHERE p.oid = to_regprocedure('public.asignacion_puede_administrar(uuid,uuid)')), false);
BEGIN
  PERFORM public.prj_como(NULL, 'sistema');
  PERFORM public.prj_igual((SELECT permission_type FROM public.user_project_assignments WHERE user_id = ol AND project_id = A), 'lectura', '[montaje] ol tiene una asignación de tipo «lectura» a A');
  PERFORM public.prj_como(ol);
  PERFORM public.prj_verifica(format(v_ins, E, quote_literal(A), P), 'OK1',
    '[límite F10 · ol · asignación «lectura» · ordenes_compra · INSERT en A] user_has_project_access NO lee permission_type: una asignación de solo lectura captura en su proyecto (en producción las 43 filas son «total»)');
  PERFORM public.prj_verifica(format(v_ins, E, quote_literal(B), P), 'ERR:42501:necesita estar asignado al proyecto del documento', '[ol · ordenes_compra · INSERT en B] en el que no tiene asignación: rechazado');
  PERFORM public.prj_verifica(format(v_ins, E, 'NULL', P), 'ERR:42501:sin proyecto', '[ol · ordenes_compra · INSERT sin proyecto] rechazado');

  -- D-9: adm3 (administrador solo A) NO es exento. «Exento» = no tener filas de asignación. adm2 (administrador A y G, también acotado) intenta borrarle la fila.
  --       Sin la regla del principal lo logra y adm3 queda exento (crea sin proyecto y en B); CON ella (0600 de #928 desde 7bf85221) adm2 obtiene cero filas y adm3 sigue acotado;
  --       solo el principal (propietario ow) puede dejarlo sin filas, y entonces SÍ es exento: la regla «NULL solo para exentos» es tan firme como esa exención.
  PERFORM public.prj_como(adm3);
  PERFORM public.prj_igual(public.user_is_project_exempt()::text, 'false', '[D-9 · montaje] adm3 tiene una asignación (A): NO es exento');
  PERFORM public.prj_verifica(format(v_ins, E, 'NULL', P), 'ERR:42501:sin proyecto', '[D-9 · adm3 · antes] no puede crear sin proyecto');
  PERFORM public.prj_como(public.prj_id('adm2', 'u'));
  v_borrar := format('DELETE FROM public.user_project_assignments WHERE user_id = %L', adm3) || '; SELECT set_config(''request.jwt.claim.sub'', %L, true); ';
  IF v_principal THEN
    PERFORM public.prj_verifica(format('DELETE FROM public.user_project_assignments WHERE user_id = %L', adm3), 'OK0',
      '[D-9 · 0600 del principal · adm2 intenta borrar la fila de adm3] cero filas: un administrador no escribe asignaciones');
    PERFORM public.prj_verifica(format(v_borrar || v_ins, adm3, E, 'NULL', P), 'ERR:42501:sin proyecto',
      '[D-9 · 0600 del principal · adm2 intenta borrar la fila de adm3 y adm3 crea SIN proyecto] adm3 sigue acotado: rechazado');
    PERFORM public.prj_verifica(format(v_borrar || v_ins, adm3, E, quote_literal(B), P), 'ERR:42501:necesita estar asignado al proyecto del documento',
      '[D-9 · 0600 del principal · adm2 intenta borrar la fila de adm3 y adm3 crea en B] …y en un proyecto que nunca tuvo: rechazado');
    PERFORM public.prj_como(NULL, 'sistema');
    PERFORM public.prj_igual((SELECT count(*)::text FROM public.user_project_assignments WHERE user_id = adm3), '1', '[D-9 · 0600 del principal] adm3 conserva su asignación a A tras los intentos de adm2');
    PERFORM public.prj_como(ow);
    PERFORM public.prj_verifica(format(v_borrar || v_ins, adm3, E, 'NULL', P), 'OK1',
      '[límite D-9 · el principal borra la fila de adm3 y adm3 crea SIN proyecto] el propietario sí lo deja sin filas y por eso EXENTO: la exención sigue siendo «sin filas», ahora solo la da el principal (se deshace)');
    PERFORM public.prj_verifica(format(v_borrar || v_ins, adm3, E, quote_literal(B), P), 'OK1',
      '[límite D-9 · el principal borra la fila de adm3 y adm3 crea en B] …y en un proyecto que nunca tuvo (se deshace)');
  ELSE
    PERFORM public.prj_verifica(format(v_borrar || v_ins, adm3, E, 'NULL', P), 'OK1',
      '[límite D-9 · adm2 borra la fila de adm3 y adm3 crea SIN proyecto] otro administrador acotado lo deja sin filas y por eso EXENTO: la regla «NULL solo para exentos» es tan firme como esa exención (con o sin la 0600 del PR #928 de antes de la regla del principal, que cierra el borrarse las propias, no las de otro)');
    PERFORM public.prj_verifica(format(v_borrar || v_ins, adm3, E, quote_literal(B), P), 'OK1',
      '[límite D-9 · adm2 borra la fila de adm3 y adm3 crea en B] …y en un proyecto que nunca tuvo');
  END IF;
  PERFORM public.prj_como(NULL, 'sistema');
END;
$permission_type$;

-- ═══════════════════════════════════════════════════════════════════════════
-- g5 · UNA SESIÓN AUTENTICADA SIN FILA EN app_users (rol NULL): can_access_project() y user_is_project_exempt() le devuelven NULL, no false. La regla de la propuesta es NULL-segura
--      (COALESCE(…, false)): por una función definer (la RLS no rige) no abre ni un proyecto ni «sin proyecto», ni mueve renglones.
-- ═══════════════════════════════════════════════════════════════════════════
DO $fantasma$
DECLARE
  E constant uuid := public.prj_id('E', 'co');  A constant uuid := public.prj_id('A', 'pa');  B constant uuid := public.prj_id('B', 'pb');  P constant uuid := public.prj_id('P', 'pv');
  fan constant uuid := public.prj_id('fan', 'u');
BEGIN
  PERFORM public.prj_como(fan);
  PERFORM public.prj_igual((public.current_user_role() IS NULL AND public.user_is_project_exempt() IS NULL AND public.can_access_project(B) IS NULL)::text, 'true',
    '[fan · montaje] sin fila en app_users: el rol es NULL y can_access_project(B) / user_is_project_exempt() devuelven NULL (la lógica trivaluada es el punto)');
  PERFORM public.prj_verifica(format('SELECT 1 FROM (SELECT public.prj_definer_insertar(%L, %L, %L) AS n) s WHERE s.n = 1', E, B, P),
    'ERR:42501:necesita estar asignado al proyecto del documento', '[fan · función definer · INSERT en B] la propuesta es NULL-segura: rechazado');
  PERFORM public.prj_verifica(format('SELECT 1 FROM (SELECT public.prj_definer_insertar(%L, %L, %L) AS n) s WHERE s.n = 1', E, A, P),
    'ERR:42501:necesita estar asignado al proyecto del documento', '[fan · función definer · INSERT en A] no tiene ninguno: rechazado');
  PERFORM public.prj_verifica(format('SELECT 1 FROM (SELECT public.prj_definer_insertar(%L, NULL, %L) AS n) s WHERE s.n = 1', E, P),
    'ERR:42501:sin proyecto', '[fan · función definer · INSERT sin proyecto] rechazado');
  PERFORM public.prj_verifica(format('SELECT 1 FROM (SELECT public.prj_definer_mover_renglon(%L, %L) AS n) s WHERE s.n = 1', public.prj_id('oc_b', 'ocl'), public.prj_id('oc_a', 'oc')),
    'ERR:42501:agregar o mover renglones', '[fan · función definer · sacar un renglón de B y ponerlo en A] rechazado');
  -- La propuesta cierra «desde o hacia sin proyecto» POR SÍ SOLA, sin apoyarse en la 0900: con el disparador de mover de la 0900 desactivado (dentro de una subtransacción que se deshace),
  -- la persona acotada y la sesión sin fila en app_users siguen sin poder sacar un documento a «sin proyecto» ni reclamar uno sin proyecto (la lógica trivaluada: user_is_project_exempt() es NULL).
  PERFORM public.prj_resultado('[fan · función definer · A → sin proyecto, con trg_zzcompras_mover_alcance DESACTIVADO (se deshace)] la propuesta lo rechaza sola: NULL-segura',
    public.prj_evaluar('ERR:42501:dejar un documento de compras sin proyecto', public.prj_definer_mover_aislada('ordenes_compra', 'trg_zzcompras_mover_alcance', public.prj_id('oc_a', 'oc'), NULL)));
  PERFORM public.prj_resultado('[fan · función definer · sin proyecto → A, con trg_zzcompras_mover_alcance DESACTIVADO (se deshace)] la propuesta lo rechaza sola: NULL-segura',
    public.prj_evaluar('ERR:42501:ponerle proyecto a un documento de compras que no lo tiene', public.prj_definer_mover_aislada('ordenes_compra', 'trg_zzcompras_mover_alcance', public.prj_id('oc_n', 'oc'), A)));
  PERFORM public.prj_como(public.prj_id('ua', 'u'));
  PERFORM public.prj_resultado('[ua · función definer · A → sin proyecto, con trg_zzcompras_mover_alcance DESACTIVADO (se deshace)] la propuesta lo rechaza sola',
    public.prj_evaluar('ERR:42501:dejar un documento de compras sin proyecto', public.prj_definer_mover_aislada('ordenes_compra', 'trg_zzcompras_mover_alcance', public.prj_id('oc_a', 'oc'), NULL)));
  PERFORM public.prj_resultado('[ua · función definer · sin proyecto → A, con trg_zzcompras_mover_alcance DESACTIVADO (se deshace)] la propuesta lo rechaza sola',
    public.prj_evaluar('ERR:42501:ponerle proyecto a un documento de compras que no lo tiene', public.prj_definer_mover_aislada('ordenes_compra', 'trg_zzcompras_mover_alcance', public.prj_id('oc_n', 'oc'), A)));
  -- …y lo que NO cierra por sí sola: ENTRE proyectos lo decide la 0900 (la propuesta no lo repite); sin ella, A → B pasaría
  PERFORM public.prj_resultado('[límite · ua · función definer · A → B, con trg_zzcompras_mover_alcance DESACTIVADO (se deshace)] entre proyectos decide SOLO la 0900: sin ella pasa (la propuesta es aditiva, no la sustituye)',
    public.prj_evaluar('OK1', public.prj_definer_mover_aislada('ordenes_compra', 'trg_zzcompras_mover_alcance', public.prj_id('oc_a', 'oc'), B)));
  PERFORM public.prj_como(NULL, 'sistema');
END;
$fantasma$;

-- ═══════════════════════════════════════════════════════════════════════════
-- h · LÍMITES QUE QUEDAN (a propósito; cambian solo si el dueño decide D-4 o D-6, README.md §5)
-- ═══════════════════════════════════════════════════════════════════════════
DO $limites$
DECLARE
  E constant uuid := public.prj_id('E', 'co');  B constant uuid := public.prj_id('B', 'pb');
BEGIN
  PERFORM public.prj_como(public.prj_id('ua', 'u'));
  -- D-4 · un documento que YA está sin proyecto sigue siendo «de la empresa»: la persona acotada con la llave lo aprueba (hoy: 0 en producción)
  PERFORM public.prj_verifica(format('UPDATE public.ordenes_compra SET estado = ''aprobada'' WHERE id = %L', public.prj_id('oc_n', 'oc')), 'OK1',
    '[límite D-4 · ua] un documento que ya está sin proyecto lo puede aprobar quien tiene la llave aunque no esté asignada a ningún proyecto (si se decide «solo exentos», cambiar compras_exigir_permiso)');
  -- D-6 · P-PERM-2: editar columnas que NO mueven el documento, de un proyecto ajeno, por una función definer: sigue pasando
  PERFORM public.prj_verifica(format('SELECT 1 FROM (SELECT public.prj_definer_editar(%L, ''editado'') AS n) s WHERE s.n = 1', public.prj_id('oc_b', 'oc')), 'OK1',
    '[límite D-6 / P-PERM-2 · ua] una función definer que edita el concepto de un borrador de B sigue pasando: la propuesta cierra capturar y mover, no «todo UPDATE»');
  -- …y el UPDATE «a ciegas» (sin columnas en el WHERE: la política SELECT no entra) alcanza borradores de proyectos que no tiene asignados
  PERFORM public.prj_verifica('UPDATE public.ordenes_compra SET concepto = ''zz'' WHERE true', 'OKN',
    '[límite D-6 / P-PERM-2 · ua] un UPDATE sin columnas en el WHERE edita documentos de la empresa sin mirar el proyecto (también los de B): la propuesta cierra capturar y mover, no «todo UPDATE»');
  PERFORM public.prj_como(NULL, 'sistema');
END;
$limites$;

-- D-0 · la propuesta es tan firme como user_project_assignments (defecto PREVIO, con su corrección aparte en pendientes_decision/asignaciones/).
--       La comprobación se adapta: con la política actual (cada persona se asigna lo que quiera) documenta el límite; con la corrección aplicada exige el rechazo.
DO $dependencia$
DECLARE
  E constant uuid := public.prj_id('E', 'co');  B constant uuid := public.prj_id('B', 'pb');  P constant uuid := public.prj_id('P', 'pv');
  ua constant uuid := public.prj_id('ua', 'u');
  v_abierta boolean := EXISTS (SELECT 1 FROM pg_policy p WHERE p.polrelid = 'public.user_project_assignments'::regclass AND p.polcmd = 'a'
                                 AND COALESCE(pg_get_expr(p.polwithcheck, p.polrelid), '') ~ 'user_id = \( SELECT auth\.uid');
BEGIN
  PERFORM public.prj_como(ua);
  PERFORM public.prj_verifica(format('INSERT INTO public.user_project_assignments (user_id, project_id, permission_type) VALUES (%L, %L, ''total''); '
      || 'INSERT INTO public.ordenes_compra (company_id, project_id, proveedor_id, proveedor_nombre, concepto) VALUES (%L, %L, %L, ''P'', ''autoasignada'')', ua, B, E, B, P),
    CASE WHEN v_abierta THEN 'OK1' ELSE 'ERR:42501:(row-level security|ASIGNACION_PROPIA_NO_PERMITIDA)' END,
    CASE WHEN v_abierta
      THEN '[límite D-0 · ua] la política de user_project_assignments TODAVÍA deja a cada persona asignarse proyectos (defecto previo): se asigna B y captura en B; esta propuesta es tan firme como esa tabla (se deshace)'
      ELSE '[dependencia · ua] con la política de asignaciones cerrada (RLS o el disparador de autoasignación de la 0600 del PR #928), ua no puede asignarse B y no captura en B' END);
  PERFORM public.prj_como(NULL, 'sistema');
END;
$dependencia$;

-- ═══════════════════════════════════════════════════════════════════════════
-- i · ESTADO FINAL: ningún intento rechazado o de cero filas dejó rastro; los documentos del padrón siguen donde estaban
-- ═══════════════════════════════════════════════════════════════════════════
DO $final$
DECLARE
  A constant uuid := public.prj_id('A', 'pa');  B constant uuid := public.prj_id('B', 'pb');
  v_t text; v_d text; v_i text; v_donde text; v_esp text; v_real text;
BEGIN
  PERFORM public.prj_como(NULL, 'sistema');
  FOR v_t, v_d, v_i IN VALUES ('ordenes_compra', 'oc', 'oc'), ('recepciones', 'rec', 'rec'), ('facturas_proveedor', 'gd', 'fac'),
                              ('ordenes_pago', 'op', 'op'), ('contrasenas_pago', 'cp', 'cp') LOOP
    FOREACH v_donde IN ARRAY ARRAY['a', 'b', 'n'] LOOP
      v_esp := CASE v_donde WHEN 'a' THEN A::text WHEN 'b' THEN B::text ELSE 'NULL' END;
      EXECUTE format('SELECT COALESCE(project_id::text, ''NULL'') FROM public.%I WHERE id = %L', v_t, public.prj_id(v_d || '_' || v_donde, v_i)) INTO v_real;
      PERFORM public.prj_igual(v_real, v_esp, format('[estado final] %s_%s sigue %s: ningún intento rechazado, de cero filas o deshecho lo movió', v_d, v_donde,
        CASE v_donde WHEN 'a' THEN 'en A' WHEN 'b' THEN 'en B' ELSE 'sin proyecto' END));
    END LOOP;
  END LOOP;
  PERFORM public.prj_igual((SELECT count(*)::text FROM public.user_project_assignments WHERE user_id IN (public.prj_id('ua', 'u'), public.prj_id('uab', 'u'), public.prj_id('uo', 'u'))), '4',
    '[estado final] las asignaciones de proyecto de ua (1), uab (2) y uo (1) no cambiaron: la propuesta no escribe asignaciones');
  PERFORM public.prj_igual((SELECT string_agg(project_id::text, ',') FROM public.user_project_assignments WHERE user_id = public.prj_id('adm2', 'u')), A::text,
    '[estado final] adm2 conserva A (G se llevó la suya porque el proyecto se eliminó; no se tocó nada más)');
  -- las comprobaciones «aisladas» desactivan un disparador dentro de una subtransacción que se deshace: ninguno de los de las nueve tablas puede haber quedado desactivado
  PERFORM public.prj_igual((SELECT count(*)::text FROM pg_trigger tg JOIN pg_class c ON c.oid = tg.tgrelid
                             WHERE c.relnamespace = 'public'::regnamespace AND NOT tg.tgisinternal AND tg.tgenabled <> 'O'
                               AND c.relname IN ('ordenes_compra', 'recepciones', 'facturas_proveedor', 'ordenes_pago', 'contrasenas_pago',
                                                 'orden_compra_lineas', 'recepcion_lineas', 'factura_proveedor_lineas', 'contrasena_pago_facturas')), '0',
    '[estado final] ningún disparador de las nueve tablas quedó desactivado: las comprobaciones aisladas se deshicieron');
END;
$final$;

-- ═══════════════════════════════════════════════════════════════════════════
-- Limpieza y resumen
-- ═══════════════════════════════════════════════════════════════════════════
DO $resumen$
DECLARE
  v_ok bigint := COALESCE(NULLIF(current_setting('prj.ok', true), ''), '0')::bigint;
  v_rojo bigint := COALESCE(NULLIF(current_setting('prj.rojo', true), ''), '0')::bigint;
BEGIN
  RAISE NOTICE 'PRJ-1 · % comprobaciones en verde, % en rojo', v_ok, v_rojo;
  IF v_rojo > 0 THEN
    RAISE EXCEPTION 'PRJ-1 · % comprobaciones en ROJO (modo informe): la propuesta no está aplicada o está incompleta.', v_rojo;
  END IF;
END;
$resumen$;

-- (las ayudas se borran aunque haya rojo en modo informe: el DO anterior ya falló y psql se detiene; ver README para limpiar una corrida abortada)
DROP FUNCTION IF EXISTS public.prj_definer_mover(text, uuid, uuid);
DROP FUNCTION IF EXISTS public.prj_definer_editar(uuid, text);
DROP FUNCTION IF EXISTS public.prj_definer_insertar(uuid, uuid, uuid);
DROP FUNCTION IF EXISTS public.prj_definer_mover_renglon(uuid, uuid);
DROP FUNCTION IF EXISTS public.prj_definer_mover_aislada(text, text, uuid, uuid);
DROP FUNCTION IF EXISTS public.prj_definer_mover_hija_aislada(text, text, uuid, uuid, uuid);
DROP FUNCTION IF EXISTS public.prj_definer_mover_hija(text, uuid, uuid, uuid);
DROP FUNCTION IF EXISTS public.prj_cadena(text, uuid, uuid, uuid, text);
DROP FUNCTION IF EXISTS public.prj_rol(uuid, uuid, text, text[]);
DROP FUNCTION IF EXISTS public.prj_persona(uuid, uuid, text, uuid[], text);
DROP FUNCTION IF EXISTS public.prj_empresa(uuid, uuid, uuid, uuid, uuid, text);
DROP FUNCTION IF EXISTS public.prj_como(uuid, text);
DROP FUNCTION IF EXISTS public.prj_esperado(text, text, text, text);
DROP FUNCTION IF EXISTS public.prj_igual(text, text, text);
DROP FUNCTION IF EXISTS public.prj_verifica(text, text, text, boolean);
DROP FUNCTION IF EXISTS public.prj_resultado(text, text);
DROP FUNCTION IF EXISTS public.prj_evaluar(text, text);
DROP FUNCTION IF EXISTS public.prj_ejecuta(text);
DROP FUNCTION IF EXISTS public.prj_intento(text);
DROP FUNCTION IF EXISTS public.prj_id(text, text);
DO $limpieza$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND p.proname LIKE 'prj\_%') THEN
    RAISE EXCEPTION 'PRJ-1 · quedaron ayudas prj_* en la base';
  END IF;
  IF has_table_privilege('anon', 'public.ordenes_compra', 'INSERT') THEN
    RAISE EXCEPTION 'PRJ-1 · anon conservó el DML que se le dio para la prueba';
  END IF;
  RAISE NOTICE '✓ [limpieza] las ayudas prj_* se borraron y anon no conserva el DML que se le emuló';
END;
$limpieza$;
