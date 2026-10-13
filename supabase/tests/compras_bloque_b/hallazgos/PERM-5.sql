\set ON_ERROR_STOP on
-- ============================================================================
-- PERM-5 · El PRINCIPAL de la empresa (la cuenta propietaria, `company_owner`) asigna las llaves nuevas de compras
--         DESDE EL PANEL «Roles y permisos» —por el mismo camino de tablas y políticas que usa `RolPermisosModal.handleSave`—,
--         la bitácora lo deja como actor y el servidor pasa a aceptar EXACTAMENTE las llaves concedidas.
--
-- DECISIÓN DEL DUEÑO DEL NEGOCIO (2026-10-11): paquete A. La migración 20261027000900 NO concede ninguna llave (ni por script, ni por
--   Marco Santos Godoy, ni con el PR): las asigna el principal de la empresa desde el panel, cuando decida a quién. Esta prueba
--   demuestra que ese procedimiento funciona y que sin él el servidor sigue rechazando.
--
-- EL PROCEDIMIENTO QUE SE REPRODUCE (docs/COMPRAS_PROPUESTA_ASIGNACION_PERMISOS.md §6.2). `handleSave` (RolPermisosModal.tsx), cuando la
--   persona no tiene todavía un rol de ajustes y se marcaron casillas, hace TRES escrituras con la sesión del propietario:
--     1. INSERT en `roles` (createOverrideRole): is_system = false, color '#7E9389', user_override_for = la persona, nombre
--        «Ajustes individuales — <nombre> (<8 primeros del id>)», y pide el id de vuelta;
--     2. INSERT en `user_roles` (insertUserRoles): la persona, ese rol, expires_at = NULL (sin assigned_by);
--     3. INSERT en `role_permissions` (insertRolePermissions): una fila `allow` por casilla marcada.
--   Desmarcar todo borra el rol (deleteRole) y la cascada se lleva la asignación y las filas.
--   Aquí se hace con `SET ROLE authenticated` y el `sub` del propietario: las políticas RLS de producción rigen de verdad.
--
-- COMPORTAMIENTO ESPERADO
--   a. ANTES (sin conceder): el operador con el rol de «Finanzas / Contador» (aprobar/cambiar estado genéricos y la llave de la pestaña
--      de órdenes) conserva SOLO «aprobar orden de compra»; las otras cinco acciones se rechazan con COMPRAS_PERMISO_ACCION
--      (user_has_permission = false en las cinco llaves). El propietario y el administrador pasan por su perfil.
--   b. EL PROCEDIMIENTO: el propietario crea el rol de ajustes, se lo asigna al operador y concede las cinco llaves. Quedan 1 rol,
--      1 asignación sin vencimiento y 5 filas `allow`; el rol de empresa «Finanzas / Contador» NO se toca. `permission_audit_log`
--      registra create_role, assign_role y 5 grant_permission, TODAS con el propietario como actor.
--   c. DESPUÉS: user_has_permission pasa a true en las cinco llaves (y SOLO en esas); la comprobación común del servidor
--      (compras_exigir_permiso) y las cinco acciones reales (UPDATE como `authenticated`) pasan, y el servidor sella al operador.
--   d. SOLO LO CONCEDIDO (rojo con una llave menos): a otra persona se le conceden cuatro de las cinco; la quinta se rechaza con
--      COMPRAS_PERMISO_ACCION y las cuatro pasan. La concesión es de la PERSONA: otro operador con el mismo rol de empresa no la tiene.
--   e. REVERSIÓN: desmarcar (borrar el rol de ajustes) devuelve a la persona al estado de antes y la bitácora conserva el rastro.
--   f. QUIÉN NO PUEDE: un operador no escribe roles, llaves ni asignaciones (RLS) ni puede concederse nada a sí mismo; el propietario de
--      OTRA empresa tampoco puede crear un rol de ajustes en esta.
--   g. EL ADMINISTRADOR (Marco): conserva por perfil las seis acciones, solo en SUS proyectos; el principal asigna llaves a operadores,
--      visores y roles personalizados pero NO se las quita al nivel administrador (user_has_permission lo deja pasar antes de mirar un
--      `deny`): es una decisión abierta, medida aquí.
--   h. LÍMITE CONOCIDO HASTA LA MIGRACIÓN 20261026000700 DE #928: las políticas de roles / role_permissions / user_roles admiten hoy a
--      `company_owner` Y a `admin`. Un administrador todavía puede escribir roles y llaves por la API (la interfaz nunca se lo ofreció:
--      la pantalla es solo del propietario). Esta prueba NO depende de la 0700: mide la escritura del administrador y exige que el
--      resultado coincida con el texto de la política que hay en la cadena —admite `admin`: pasa y se revierte (límite conocido); ya
--      no lo admite: 42501—, de modo que pasa CON y SIN la 0700 y deja a la vista en qué estado está la cadena.
--   i. HALLAZGO LATERAL: no hay política UPDATE en user_roles ni en role_permissions: cambiar el vencimiento de un rol asignado afecta 0 filas sin error.
--
-- Ids propios: md5('perm:PERM-5:…') (perm_id) y fb050000-0000-0000-0000-0000000000XX. Crea sus propias empresas, proyectos, personas y
-- documentos (no toca compras_config ni datos de otras suites).
--
-- ⚠ SOLO clúster local; nunca contra sandbox/producción. Crea funciones auxiliares perm_* / perm5_* (ninguna SECURITY DEFINER) y
--   empresas de prueba que NO se pueden borrar (los documentos de compras no se borran). Las ayudas se borran al final y una
--   comprobación final exige que no quede ninguna; los datos 'PERM-5…' sí quedan en la base. Lo corre run.sh sobre su clúster desechable.
-- ============================================================================

SELECT set_config('perm.ns', 'PERM-5', false);

-- ── Ayudas (prefijo perm_ / perm5_; ninguna SECURITY DEFINER) ───────────────────────────────────────────────
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

CREATE OR REPLACE FUNCTION public.perm_id(p_n text, p_tipo text)
RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT md5('perm:' || COALESCE(current_setting('perm.ns', true), '') || ':' || p_n || ':' || p_tipo)::uuid $$;

-- Empresa propia con dos proyectos, catálogo contable sembrado por las funciones reales, un proveedor autorizado y un administrador SIN
-- asignaciones (exento de proyecto) que arma los documentos. Corre como superusuario.
CREATE OR REPLACE FUNCTION public.perm_empresa(p_company uuid, p_a uuid, p_b uuid, p_prov uuid, p_admin uuid, p_nombre text)
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

-- Cadena de documentos armada por la SESIÓN ACTUAL (un administrador): orden → recepción → factura → orden de pago, hasta el estado pedido.
-- p_hasta: oc_borrador | oc_aprobada | oc_emitida | rec_borrador | rec_registrada | fac_registrada | fac_aprobada | op_borrador | op_aprobada | op_pagada
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

-- Cambia de sesión DENTRO de un bloque DO: con p_uid, `authenticated` con ese `sub`; con NULL, el superusuario sin usuario.
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

-- Solo fija el `sub` de la sesión (sin cambiar de rol): para llamar a la función interna, que `authenticated` no ejecuta.
CREATE OR REPLACE FUNCTION public.perm_sub(p_uid uuid)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('request.jwt.claim.sub', COALESCE(p_uid::text, ''), false);
END;
$$;

-- LO QUE HACE EL PANEL AL GUARDAR casillas nuevas de una persona sin rol de ajustes (RolPermisosModal.handleSave → createOverrideRole,
-- insertUserRoles, insertRolePermissions), en la SESIÓN ACTUAL y SIN privilegios propios (función INVOKER: rige la RLS de quien llama).
-- Devuelve el id del rol de ajustes. p_efecto = 'allow' (conceder) o 'deny' (bloquear).
CREATE OR REPLACE FUNCTION public.perm5_panel(p_empresa uuid, p_persona uuid, p_nombre text, p_llaves text[], p_efecto text DEFAULT 'allow')
RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE
  v_rol uuid;
BEGIN
  INSERT INTO public.roles (company_id, name, description, is_system, color, user_override_for)
  VALUES (p_empresa, 'Ajustes individuales — ' || p_nombre || ' (' || left(p_persona::text, 8) || ')',
          'Ajustes finos asignados directamente al usuario', false, '#7E9389', p_persona)
  RETURNING id INTO v_rol;
  INSERT INTO public.user_roles (user_id, role_id, expires_at) VALUES (p_persona, v_rol, NULL);
  INSERT INTO public.role_permissions (role_id, permission_key, effect) SELECT v_rol, k, p_efecto FROM unnest(p_llaves) k;
  RETURN v_rol;
END;
$$;

-- user_has_permission(llave) tal como lo ve la persona (sesión authenticated con su `sub`); devuelve a la sesión del sistema.
CREATE OR REPLACE FUNCTION public.perm5_tiene(p_uid uuid, p_llave text)
RETURNS boolean LANGUAGE plpgsql AS $$
DECLARE
  v boolean;
BEGIN
  PERFORM public.perm_como(p_uid);
  SELECT public.user_has_permission(p_llave) INTO v;
  PERFORM public.perm_como(NULL);
  RETURN v;
END;
$$;

GRANT EXECUTE ON FUNCTION public.perm_falla(text, text, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.perm_filas(text, bigint, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.perm_pasa(text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.perm5_panel(uuid, uuid, text, text[], text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.perm5_tiene(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.perm_como(uuid, boolean) TO authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- 0 · PADRÓN (superusuario)
--   Empresa E (proyectos A y B, proveedor autorizado, administrador AD SIN asignaciones que arma los documentos) y empresa Z (solo su propietario).
--   Personas de E:  ow propietario (sin asignaciones) · op «Alexander» operador (A) · oq y or operadores (A) · aa administrador asignado SOLO a A
--   op, oq y or comparten UN rol de empresa «Finanzas / Contador» (ver/crear/editar + approve y change_status genéricos + la llave de la pestaña
--   de órdenes): es lo que tiene Alexander. Ninguno tiene las cinco llaves nuevas.
-- ═══════════════════════════════════════════════════════════════════════════
DO $padron$
DECLARE
  E  constant uuid := 'fb050000-0000-0000-0000-0000000000e0';
  A  constant uuid := 'fb050000-0000-0000-0000-0000000000a1';
  B  constant uuid := 'fb050000-0000-0000-0000-0000000000b1';
  P  constant uuid := 'fb050000-0000-0000-0000-0000000000c1';
  AD constant uuid := 'fb050000-0000-0000-0000-0000000000ad';
  Z  constant uuid := 'fb050000-0000-0000-0000-0000000000f0';
  ROL constant uuid := 'fb050000-0000-0000-0000-0000000000f1';
BEGIN
  PERFORM public.perm_empresa(E, A, B, P, AD, 'PERM-5 Empresa E');
  PERFORM public.perm_persona(public.perm_id('ow', 'u'), E, 'PERM-5 propietario', ARRAY[]::uuid[], 'company_owner');
  PERFORM public.perm_persona(public.perm_id('op', 'u'), E, 'PERM-5 Alexander', ARRAY[A]);
  PERFORM public.perm_persona(public.perm_id('oq', 'u'), E, 'PERM-5 operador Q', ARRAY[A]);
  PERFORM public.perm_persona(public.perm_id('or', 'u'), E, 'PERM-5 operador R', ARRAY[A]);
  PERFORM public.perm_persona(public.perm_id('aa', 'u'), E, 'PERM-5 Marco (administrador de A)', ARRAY[A], 'admin');
  INSERT INTO public.roles (id, company_id, name) VALUES (ROL, E, 'PERM-5 Finanzas / Contador');
  INSERT INTO public.role_permissions (role_id, permission_key, effect)
  SELECT ROL, k, 'allow' FROM unnest(ARRAY['platform.contabilidad.view', 'platform.contabilidad.create', 'platform.contabilidad.edit',
                                           'platform.contabilidad.approve', 'platform.contabilidad.change_status',
                                           'condominios.tab.ordenes_compra.approve']) k;
  INSERT INTO public.user_roles (user_id, role_id) VALUES
    (public.perm_id('op', 'u'), ROL), (public.perm_id('oq', 'u'), ROL), (public.perm_id('or', 'u'), ROL);
  -- otra empresa con su propietario
  INSERT INTO public.companies (id, nombre, default_currency) VALUES (Z, 'PERM-5 Empresa Z', 'gtq');
  PERFORM public.perm_persona(public.perm_id('zc', 'u'), Z, 'PERM-5 propietario de Z', ARRAY[]::uuid[], 'company_owner');
END;
$padron$;

-- ═══════════════════════════════════════════════════════════════════════════
-- 1 · ANTES: nada concedido (paquete A). Las seis acciones, de las cuales el operador conserva una.
--   Documentos armados por el administrador exento (los pasos legítimos). Acción i: 1 aprobar OC · 2 recepción · 3 factura · 4 orden de pago
--   · 5 ejecutar pago · 6 anular pago. Sufijos: a (la persona op) · q (la persona oq) · w (el administrador aa) · r (la persona or)
-- ═══════════════════════════════════════════════════════════════════════════
DO $antes$
DECLARE
  E  constant uuid := 'fb050000-0000-0000-0000-0000000000e0';
  A  constant uuid := 'fb050000-0000-0000-0000-0000000000a1';
  B  constant uuid := 'fb050000-0000-0000-0000-0000000000b1';
  P  constant uuid := 'fb050000-0000-0000-0000-0000000000c1';
  AD constant uuid := 'fb050000-0000-0000-0000-0000000000ad';
  ROL constant uuid := 'fb050000-0000-0000-0000-0000000000f1';
  op constant uuid := public.perm_id('op', 'u');
  oq constant uuid := public.perm_id('oq', 'u');
  orr constant uuid := public.perm_id('or', 'u');
  ow constant uuid := public.perm_id('ow', 'u');
  aa constant uuid := public.perm_id('aa', 'u');
  ac record;
  n text;
  v_pat text;
  v_estado text;
BEGIN
  PERFORM public.chk((SELECT count(*) FROM public.permissions WHERE key LIKE 'platform.contabilidad.compras.%'), 5,
    '[PERM-5a] las cinco llaves nuevas existen en el catálogo (la 0900 las siembra y no las concede)');
  PERFORM public.chk((SELECT count(*) FROM public.role_permissions rp JOIN public.roles r ON r.id = rp.role_id
                       WHERE r.company_id = E AND rp.permission_key LIKE 'platform.contabilidad.compras.%'), 0,
    '[PERM-5a] la empresa E parte sin NINGUNA concesión de las cinco llaves (paquete A: no se concede nada)');
  PERFORM public.chk((SELECT count(*) FROM public.user_roles ur JOIN public.role_permissions rp ON rp.role_id = ur.role_id
                       WHERE ur.user_id IN (op, oq, orr) AND rp.permission_key LIKE 'platform.contabilidad.compras.%'), 0,
    '[PERM-5a] y las tres personas operadoras no tienen ninguna por ningún rol');

  FOR ac IN
    SELECT * FROM (VALUES
      (1, 'aprobar_orden_compra', 'condominios.tab.ordenes_compra.approve',            'ordenes_compra',     'oc',  'aprobada',   '',                            'oc_borrador',    'borrador'),
      (2, 'registrar_recepcion',  'platform.contabilidad.compras.recepcion_registrar', 'recepciones',        'rec', 'registrada', '',                            'rec_borrador',   'borrador'),
      (3, 'aprobar_factura',      'platform.contabilidad.compras.factura_aprobar',     'facturas_proveedor', 'fac', 'aprobada',   '',                            'fac_registrada', 'registrada'),
      (4, 'aprobar_orden_pago',   'platform.contabilidad.compras.orden_pago_aprobar',  'ordenes_pago',       'op',  'aprobada',   '',                            'op_borrador',    'borrador'),
      (5, 'ejecutar_pago',        'platform.contabilidad.compras.pago_ejecutar',       'ordenes_pago',       'op',  'pagada',     ', fecha_pago = CURRENT_DATE', 'op_aprobada',    'aprobada'),
      (6, 'anular_pago',          'platform.contabilidad.compras.pago_anular',         'ordenes_pago',       'op',  'anulada',    '',                            'op_aprobada',    'aprobada')
    ) AS v(i, nombre, llave, tabla, tipo, dest, extra, src, estado0)
    ORDER BY i
  LOOP
    -- los documentos de TODO el archivo, por acción: a (op) · q · w (administrador) · r · b (proyecto B) · z (de reserva)
    PERFORM public.perm_como(AD);
    FOREACH n IN ARRAY ARRAY['a', 'q', 'w', 'r'] LOOP
      PERFORM public.perm_cadena(ac.i || n, E, A, P, ac.src);
    END LOOP;
    PERFORM public.perm_cadena(ac.i || 'b', E, B, P, ac.src);      -- del proyecto B, que ni op ni aa tienen asignado
    PERFORM public.perm_cadena(ac.i || 'z', E, A, P, ac.src);      -- de reserva (revocación)
    PERFORM public.perm_como(NULL);

    v_pat := 'COMPRAS_PERMISO_ACCION: para .* tu perfil necesita el permiso «' || (SELECT p.label FROM public.permissions p WHERE p.key = ac.llave) || '»';

    -- user_has_permission ANTES, por la llave: el operador solo tiene la de la orden de compra
    PERFORM public.chk_bool(public.perm5_tiene(op, ac.llave), ac.i = 1,
      format('[PERM-5a] ANTES: user_has_permission(«%s») del operador = %s', ac.llave, (ac.i = 1)::text));
    -- la propietaria y el administrador pasan toda llave por su perfil
    PERFORM public.chk_bool(public.perm5_tiene(ow, ac.llave), true, format('[PERM-5a] el propietario pasa «%s» por su perfil (sin ninguna concesión)', ac.llave));
    PERFORM public.chk_bool(public.perm5_tiene(aa, ac.llave), true, format('[PERM-5a] el administrador pasa «%s» por su perfil (sin ninguna concesión)', ac.llave));

    IF ac.i = 1 THEN
      -- conserva SOLO esta: la aprueba
      PERFORM public.perm_como(op);
      PERFORM public.perm_filas(format('UPDATE public.%I SET estado = %L WHERE id = %L', ac.tabla, ac.dest, public.perm_id(ac.i || 'a', ac.tipo)), 1,
        format('[PERM-5a] ANTES: el operador conserva «%s» y la ejerce (la llave de la pestaña de órdenes ya existía)', ac.nombre));
      PERFORM public.perm_como(NULL);
    ELSE
      PERFORM public.perm_como(op);
      PERFORM public.perm_falla(format('UPDATE public.%I SET estado = %L%s WHERE id = %L', ac.tabla, ac.dest, ac.extra, public.perm_id(ac.i || 'a', ac.tipo)), '42501', v_pat,
        format('[PERM-5a] ANTES: sin conceder, «%s» se rechaza al operador aunque tenga approve y change_status genéricos (COMPRAS_PERMISO_ACCION, 42501)', ac.nombre));
      PERFORM public.perm_como(NULL);
      EXECUTE format('SELECT estado FROM public.%I WHERE id = %L', ac.tabla, public.perm_id(ac.i || 'a', ac.tipo)) INTO v_estado;
      PERFORM public.chk_txt(v_estado, ac.estado0, format('[PERM-5a] y el documento no se movió (sigue «%s»)', ac.estado0));
    END IF;
  END LOOP;
  PERFORM public.chk((SELECT count(*) FROM public.role_permissions WHERE role_id = ROL), 6,
    '[PERM-5a] el rol de empresa «Finanzas / Contador» tiene sus 6 llaves de siempre (ninguna de las cinco nuevas)');
END;
$antes$;

-- ═══════════════════════════════════════════════════════════════════════════
-- 2 · EL PROCEDIMIENTO DEL PRINCIPAL: el propietario concede las cinco llaves a «Alexander» desde el panel
-- ═══════════════════════════════════════════════════════════════════════════
DO $procedimiento$
DECLARE
  E  constant uuid := 'fb050000-0000-0000-0000-0000000000e0';
  ROL constant uuid := 'fb050000-0000-0000-0000-0000000000f1';
  ow constant uuid := public.perm_id('ow', 'u');
  op constant uuid := public.perm_id('op', 'u');
  v_cinco text[] := ARRAY['platform.contabilidad.compras.recepcion_registrar', 'platform.contabilidad.compras.factura_aprobar',
                          'platform.contabilidad.compras.orden_pago_aprobar', 'platform.contabilidad.compras.pago_ejecutar',
                          'platform.contabilidad.compras.pago_anular'];
  v_ov uuid;
  v_n  int;
BEGIN
  SELECT COALESCE(max(id), 0) INTO v_n FROM public.permission_audit_log;      -- referencia: solo se mira lo que genera el procedimiento

  PERFORM public.perm_como(ow);
  SELECT public.perm5_panel(E, op, 'PERM-5 Alexander', v_cinco) INTO v_ov;
  PERFORM public.perm_como(NULL);
  PERFORM set_config('perm5.ov_op', v_ov::text, false);

  PERFORM public.chk_bool(v_ov IS NOT NULL, true, '[PERM-5b] el propietario crea el rol de ajustes por el camino del panel y recibe su id (INSERT … RETURNING bajo RLS)');
  PERFORM public.chk((SELECT count(*) FROM public.roles WHERE id = v_ov AND company_id = E AND is_system = false AND user_override_for = op
                         AND color = '#7E9389' AND name = 'Ajustes individuales — PERM-5 Alexander (' || left(op::text, 8) || ')'), 1,
    '[PERM-5b] es un rol de la empresa, no de sistema, de ajustes individuales de Alexander, con el nombre y el color del panel');
  PERFORM public.chk((SELECT count(*) FROM public.user_roles WHERE user_id = op AND role_id = v_ov AND expires_at IS NULL AND assigned_by IS NULL), 1,
    '[PERM-5b] se lo asigna sin vencimiento (la expiración no aplica a los ajustes)');
  PERFORM public.chk((SELECT count(*) FROM public.role_permissions WHERE role_id = v_ov AND effect = 'allow' AND permission_key = ANY (v_cinco)), 5,
    '[PERM-5b] y concede las cinco llaves con effect = allow (una fila por casilla marcada)');
  PERFORM public.chk((SELECT count(*) FROM public.role_permissions WHERE role_id = v_ov), 5, '[PERM-5b] ni una llave más: exactamente las cinco');
  PERFORM public.chk((SELECT count(*) FROM public.role_permissions WHERE role_id = ROL), 6, '[PERM-5b] el rol de empresa «Finanzas / Contador» NO se tocó (sigue con 6 llaves)');
  PERFORM public.chk((SELECT count(*) FROM public.user_roles WHERE user_id = op), 2, '[PERM-5b] Alexander tiene ahora 2 roles: el de la empresa, intacto, y el de ajustes');
  -- bitácora: el propietario como actor, en cada paso
  PERFORM public.chk((SELECT count(*) FROM public.permission_audit_log WHERE details->>'role_id' = v_ov::text), 7,
    '[PERM-5b] la bitácora registra 7 eventos del rol de ajustes (create_role, assign_role y 5 grant_permission)');
  PERFORM public.chk((SELECT count(*) FROM public.permission_audit_log WHERE details->>'role_id' = v_ov::text AND actor_id = ow), 7,
    '[PERM-5b] los 7 con el PROPIETARIO como actor (por SQL el actor quedaría vacío)');
  PERFORM public.chk((SELECT count(*) FROM public.permission_audit_log WHERE details->>'role_id' = v_ov::text AND action = 'create_role'), 1, '[PERM-5b] un create_role');
  PERFORM public.chk((SELECT count(*) FROM public.permission_audit_log WHERE details->>'role_id' = v_ov::text AND action = 'assign_role' AND target_user_id = op), 1,
    '[PERM-5b] un assign_role sobre Alexander');
  PERFORM public.chk((SELECT count(*) FROM public.permission_audit_log WHERE details->>'role_id' = v_ov::text AND action = 'grant_permission'
                         AND details->>'effect' = 'allow' AND details->>'permission_key' = ANY (v_cinco)), 5,
    '[PERM-5b] y un grant_permission allow por cada una de las cinco llaves');
  PERFORM public.chk((SELECT count(*) FROM public.permission_audit_log WHERE id > v_n AND actor_id IS DISTINCT FROM ow), 0,
    '[PERM-5b] ningún evento nuevo de la bitácora quedó sin el propietario como actor');
END;
$procedimiento$;

-- ═══════════════════════════════════════════════════════════════════════════
-- 3 · DESPUÉS: el servidor acepta EXACTAMENTE lo concedido
-- ═══════════════════════════════════════════════════════════════════════════
DO $despues$
DECLARE
  E  constant uuid := 'fb050000-0000-0000-0000-0000000000e0';
  A  constant uuid := 'fb050000-0000-0000-0000-0000000000a1';
  B  constant uuid := 'fb050000-0000-0000-0000-0000000000b1';
  op constant uuid := public.perm_id('op', 'u');
  oq constant uuid := public.perm_id('oq', 'u');
  orr constant uuid := public.perm_id('or', 'u');
  ac record;
  v_id uuid;
BEGIN
  FOR ac IN
    SELECT * FROM (VALUES
      (1, 'aprobar_orden_compra', 'condominios.tab.ordenes_compra.approve',            'ordenes_compra',     'oc',  'aprobada',   ''),
      (2, 'registrar_recepcion',  'platform.contabilidad.compras.recepcion_registrar', 'recepciones',        'rec', 'registrada', ''),
      (3, 'aprobar_factura',      'platform.contabilidad.compras.factura_aprobar',     'facturas_proveedor', 'fac', 'aprobada',   ''),
      (4, 'aprobar_orden_pago',   'platform.contabilidad.compras.orden_pago_aprobar',  'ordenes_pago',       'op',  'aprobada',   ''),
      (5, 'ejecutar_pago',        'platform.contabilidad.compras.pago_ejecutar',       'ordenes_pago',       'op',  'pagada',     ', fecha_pago = CURRENT_DATE'),
      (6, 'anular_pago',          'platform.contabilidad.compras.pago_anular',         'ordenes_pago',       'op',  'anulada',    '')
    ) AS v(i, nombre, llave, tabla, tipo, dest, extra)
    ORDER BY i
  LOOP
    PERFORM public.chk_bool(public.perm5_tiene(op, ac.llave), true, format('[PERM-5c] DESPUÉS: user_has_permission(«%s») de Alexander = true', ac.llave));
    -- la comprobación común del servidor: empresa → permiso → proyecto (la función interna, con el sub de Alexander)
    PERFORM public.perm_sub(op);
    PERFORM public.perm_pasa(format('SELECT public.compras_exigir_permiso(%L, %L, %L, %L)', ac.llave, 'probar', E, A),
      format('[PERM-5c] compras_exigir_permiso(«%s») pasa en su proyecto A', ac.llave));
    IF ac.i > 1 THEN
      -- y el proyecto sigue rigiendo: la llave no le da el B
      PERFORM public.perm_falla(format('SELECT public.compras_exigir_permiso(%L, %L, %L, %L)', ac.llave, 'probar', E, B),
        '42501', '^COMPRAS_ALCANCE_PROYECTO', format('[PERM-5c] con la llave concedida, el proyecto B (no asignado) sigue vedado para «%s»', ac.nombre));
    END IF;
    PERFORM public.perm_sub(NULL);
    IF ac.i > 1 THEN
      -- LA MISMA acción que ANTES se rechazó, sobre el MISMO documento, ahora pasa
      v_id := public.perm_id(ac.i || 'a', ac.tipo);
      PERFORM public.perm_como(op);
      PERFORM public.perm_filas(format('UPDATE public.%I SET estado = %L%s WHERE id = %L', ac.tabla, ac.dest, ac.extra, v_id), 1,
        format('[PERM-5c] DESPUÉS: «%s» pasa sobre el mismo documento que antes se rechazó', ac.nombre));
      PERFORM public.perm_como(NULL);
    END IF;
  END LOOP;
  -- lo que sella el servidor: la persona que ejecutó
  PERFORM public.chk_uuid((SELECT f.aprobada_por FROM public.facturas_proveedor f WHERE f.id = public.perm_id('3a', 'fac')), op, '[PERM-5c] la factura quedó aprobada por Alexander (el servidor sella al que ejecutó)');
  PERFORM public.chk_uuid((SELECT o.aprobada_por FROM public.ordenes_pago o WHERE o.id = public.perm_id('4a', 'op')), op, '[PERM-5c] la orden de pago quedó aprobada por Alexander');
  PERFORM public.chk_txt((SELECT estado FROM public.ordenes_pago WHERE id = public.perm_id('5a', 'op')), 'pagada', '[PERM-5c] el pago quedó ejecutado');
  PERFORM public.chk_txt((SELECT estado FROM public.ordenes_pago WHERE id = public.perm_id('6a', 'op')), 'anulada', '[PERM-5c] y la otra orden de pago, anulada');
  -- SOLO a Alexander: las otras dos personas con el MISMO rol de empresa siguen sin ellas
  PERFORM public.chk_bool(public.perm5_tiene(oq, 'platform.contabilidad.compras.pago_ejecutar'), false,
    '[PERM-5c] la concesión es de la PERSONA: otro operador con el mismo rol de empresa «Finanzas / Contador» NO tiene «pago_ejecutar»');
  PERFORM public.chk_bool(public.perm5_tiene(orr, 'platform.contabilidad.compras.recepcion_registrar'), false,
    '[PERM-5c] ni «recepcion_registrar» (el rol de empresa no cambió)');
END;
$despues$;

-- ═══════════════════════════════════════════════════════════════════════════
-- 4 · ROJO CON UNA LLAVE MENOS: al operador Q se le conceden CUATRO de las cinco (todas menos «anular un pago»)
-- ═══════════════════════════════════════════════════════════════════════════
DO $una_menos$
DECLARE
  E  constant uuid := 'fb050000-0000-0000-0000-0000000000e0';
  ow constant uuid := public.perm_id('ow', 'u');
  oq constant uuid := public.perm_id('oq', 'u');
  v_cuatro text[] := ARRAY['platform.contabilidad.compras.recepcion_registrar', 'platform.contabilidad.compras.factura_aprobar',
                           'platform.contabilidad.compras.orden_pago_aprobar', 'platform.contabilidad.compras.pago_ejecutar'];
  v_ov uuid;
  ac record;
BEGIN
  PERFORM public.perm_como(ow);
  SELECT public.perm5_panel(E, oq, 'PERM-5 operador Q', v_cuatro) INTO v_ov;
  PERFORM public.perm_como(NULL);
  PERFORM set_config('perm5.ov_oq', v_ov::text, false);
  PERFORM public.chk((SELECT count(*) FROM public.role_permissions WHERE role_id = v_ov AND effect = 'allow'), 4, '[PERM-5d] el propietario le concede 4 llaves a la persona Q');
  FOR ac IN
    SELECT * FROM (VALUES
      (2, 'registrar_recepcion', 'platform.contabilidad.compras.recepcion_registrar', 'recepciones',        'rec', 'registrada', '',                            true),
      (3, 'aprobar_factura',     'platform.contabilidad.compras.factura_aprobar',     'facturas_proveedor', 'fac', 'aprobada',   '',                            true),
      (4, 'aprobar_orden_pago',  'platform.contabilidad.compras.orden_pago_aprobar',  'ordenes_pago',       'op',  'aprobada',   '',                            true),
      (5, 'ejecutar_pago',       'platform.contabilidad.compras.pago_ejecutar',       'ordenes_pago',       'op',  'pagada',     ', fecha_pago = CURRENT_DATE', true),
      (6, 'anular_pago',         'platform.contabilidad.compras.pago_anular',         'ordenes_pago',       'op',  'anulada',    '',                            false)
    ) AS v(i, nombre, llave, tabla, tipo, dest, extra, concedida)
    ORDER BY i
  LOOP
    PERFORM public.chk_bool(public.perm5_tiene(oq, ac.llave), ac.concedida,
      format('[PERM-5d] user_has_permission(«%s») de la persona Q = %s', ac.llave, ac.concedida::text));
    PERFORM public.perm_como(oq);
    IF ac.concedida THEN
      PERFORM public.perm_filas(format('UPDATE public.%I SET estado = %L%s WHERE id = %L', ac.tabla, ac.dest, ac.extra, public.perm_id(ac.i || 'q', ac.tipo)), 1,
        format('[PERM-5d] «%s» (concedida) pasa', ac.nombre));
    ELSE
      PERFORM public.perm_falla(format('UPDATE public.%I SET estado = %L%s WHERE id = %L', ac.tabla, ac.dest, ac.extra, public.perm_id(ac.i || 'q', ac.tipo)), '42501',
        'COMPRAS_PERMISO_ACCION: para .* tu perfil necesita el permiso «Compras y pagos — Anular un pago»',
        format('[PERM-5d] «%s» (la que falta) se rechaza con COMPRAS_PERMISO_ACCION aunque tenga las otras cuatro y approve/change_status genéricos', ac.nombre));
    END IF;
    PERFORM public.perm_como(NULL);
  END LOOP;
  PERFORM public.chk_txt((SELECT estado FROM public.ordenes_pago WHERE id = public.perm_id('6q', 'op')), 'aprobada', '[PERM-5d] y la orden de pago que no se pudo anular sigue aprobada');
  -- la tercera persona (R) no recibió nada de lo concedido a Alexander ni a Q
  PERFORM public.chk((SELECT count(*) FROM public.user_roles ur JOIN public.role_permissions rp ON rp.role_id = ur.role_id
                       WHERE ur.user_id = public.perm_id('or', 'u') AND rp.permission_key LIKE 'platform.contabilidad.compras.%'), 0,
    '[PERM-5d] la persona R, con el mismo rol de empresa, sigue sin ninguna de las cinco');
  PERFORM public.perm_como(public.perm_id('or', 'u'));
  PERFORM public.perm_falla(format('UPDATE public.recepciones SET estado = %L WHERE id = %L', 'registrada', public.perm_id('2r', 'rec')), '42501',
    'COMPRAS_PERMISO_ACCION: para .* «Compras y pagos — Registrar una recepción»', '[PERM-5d] y la persona R sigue rechazada en «registrar_recepcion»');
  PERFORM public.perm_como(NULL);
END;
$una_menos$;

-- ═══════════════════════════════════════════════════════════════════════════
-- 5 · REVERSIÓN: desmarcar todo borra el rol de ajustes (deleteRole) y la persona vuelve a lo de antes; la bitácora conserva el rastro
-- ═══════════════════════════════════════════════════════════════════════════
DO $reversion$
DECLARE
  ow constant uuid := public.perm_id('ow', 'u');
  oq constant uuid := public.perm_id('oq', 'u');
  v_ov uuid := current_setting('perm5.ov_oq')::uuid;
  v_k text;
BEGIN
  PERFORM public.perm_como(ow);
  PERFORM public.perm_filas(format('DELETE FROM public.roles WHERE id = %L', v_ov), 1, '[PERM-5e] el propietario desmarca todo: se borra el rol de ajustes de la persona Q (1 fila)');
  PERFORM public.perm_como(NULL);
  PERFORM public.chk((SELECT count(*) FROM public.role_permissions WHERE role_id = v_ov), 0, '[PERM-5e] sus cuatro filas de role_permissions cayeron en cascada');
  PERFORM public.chk((SELECT count(*) FROM public.user_roles WHERE role_id = v_ov), 0, '[PERM-5e] y su asignación');
  PERFORM public.chk((SELECT count(*) FROM public.user_roles WHERE user_id = oq), 1, '[PERM-5e] la persona Q conserva solo el rol de empresa');
  FOREACH v_k IN ARRAY ARRAY['platform.contabilidad.compras.recepcion_registrar', 'platform.contabilidad.compras.factura_aprobar',
                             'platform.contabilidad.compras.orden_pago_aprobar', 'platform.contabilidad.compras.pago_ejecutar',
                             'platform.contabilidad.compras.pago_anular'] LOOP
    PERFORM public.chk_bool(public.perm5_tiene(oq, v_k), false, format('[PERM-5e] user_has_permission(«%s») de la persona Q vuelve a false', v_k));
  END LOOP;
  PERFORM public.perm_como(oq);
  PERFORM public.perm_falla(format('UPDATE public.recepciones SET estado = %L WHERE id = %L', 'registrada', public.perm_id('2z', 'rec')), '42501',
    'COMPRAS_PERMISO_ACCION: para .* «Compras y pagos — Registrar una recepción»', '[PERM-5e] y el servidor vuelve a rechazarle «registrar_recepcion»');
  PERFORM public.perm_como(NULL);
  PERFORM public.chk((SELECT count(*) FROM public.permission_audit_log WHERE action = 'delete_role' AND details->>'role_id' = v_ov::text AND actor_id = ow), 1,
    '[PERM-5e] la bitácora registra el delete_role con el propietario como actor');
  PERFORM public.chk((SELECT count(*) FROM public.permission_audit_log WHERE action = 'grant_permission' AND details->>'role_id' = v_ov::text AND actor_id = ow), 4,
    '[PERM-5e] y conserva el rastro de las 4 concesiones (la bitácora no se borra)');
  PERFORM public.chk((SELECT count(*) FROM public.permission_audit_log WHERE action = 'revoke_permission' AND details->>'role_id' = v_ov::text AND actor_id = ow), 4,
    '[PERM-5e] y registra las 4 revocaciones de la cascada, también del propietario');
  -- la concesión de Alexander NO se tocó
  PERFORM public.chk_bool(public.perm5_tiene(public.perm_id('op', 'u'), 'platform.contabilidad.compras.pago_anular'), true,
    '[PERM-5e] revertir a la persona Q no toca la concesión de Alexander');
END;
$reversion$;

-- ═══════════════════════════════════════════════════════════════════════════
-- 6 · QUIÉN NO PUEDE conceder: un operador (aunque tenga las llaves), y el propietario de OTRA empresa
-- ═══════════════════════════════════════════════════════════════════════════
DO $nadie$
DECLARE
  E  constant uuid := 'fb050000-0000-0000-0000-0000000000e0';
  ROL constant uuid := 'fb050000-0000-0000-0000-0000000000f1';
  op constant uuid := public.perm_id('op', 'u');
  orr constant uuid := public.perm_id('or', 'u');
  zc constant uuid := public.perm_id('zc', 'u');
  v_llaves text[] := ARRAY['platform.contabilidad.compras.recepcion_registrar', 'platform.contabilidad.compras.factura_aprobar'];
  v_roles bigint; v_rp bigint; v_ur bigint;
BEGIN
  SELECT count(*) INTO v_roles FROM public.roles;
  SELECT count(*) INTO v_rp FROM public.role_permissions;
  SELECT count(*) INTO v_ur FROM public.user_roles;

  -- un operador (aunque tenga LAS CINCO llaves) no escribe roles, llaves ni asignaciones: se las intenta dar a otra persona y a sí mismo
  PERFORM public.perm_como(op);
  PERFORM public.perm_falla(format('SELECT public.perm5_panel(%L, %L, %L, %L)', E, orr, 'PERM-5 operador R', v_llaves), '42501',
    'row-level security', '[PERM-5f] un operador (con las cinco llaves) NO puede crear un rol de ajustes para otra persona (RLS en roles)');
  PERFORM public.perm_falla(format('SELECT public.perm5_panel(%L, %L, %L, %L)', E, op, 'PERM-5 Alexander', v_llaves), '42501',
    'row-level security', '[PERM-5f] ni para sí mismo (RLS en roles)');
  PERFORM public.perm_falla(format('INSERT INTO public.role_permissions (role_id, permission_key, effect) VALUES (%L, %L, %L)', ROL,
                                   'platform.contabilidad.compras.pago_ejecutar', 'allow'), '42501',
    'row-level security', '[PERM-5f] ni añadir una llave al rol de empresa compartido (RLS en role_permissions)');
  PERFORM public.perm_falla(format('INSERT INTO public.user_roles (user_id, role_id) VALUES (%L, %L)', orr, ROL), '42501',
    'row-level security', '[PERM-5f] ni asignar un rol a otra persona (RLS en user_roles)');
  -- ni quitar: los DELETE los filtra la RLS (0 filas, sin error)
  PERFORM public.perm_filas(format('DELETE FROM public.user_roles WHERE user_id = %L AND role_id = %L', op, ROL), 0,
    '[PERM-5f] ni quitarse a sí mismo su rol de empresa (el DELETE sobre user_roles, que sí ve, afecta 0 filas)');
  PERFORM public.perm_filas(format('DELETE FROM public.role_permissions WHERE role_id = %L', ROL), 0,
    '[PERM-5f] ni quitarle llaves al rol de empresa (el DELETE sobre role_permissions afecta 0 filas)');
  PERFORM public.perm_filas(format('DELETE FROM public.roles WHERE id = %L', ROL), 0,
    '[PERM-5f] ni borrar el rol de empresa (el DELETE sobre roles afecta 0 filas)');
  PERFORM public.perm_como(NULL);

  -- el propietario de OTRA empresa no crea un rol de ajustes en la empresa E
  PERFORM public.perm_como(zc);
  PERFORM public.perm_falla(format('SELECT public.perm5_panel(%L, %L, %L, %L)', E, orr, 'PERM-5 operador R', v_llaves), '42501',
    'row-level security', '[PERM-5f] el propietario de OTRA empresa no puede crear un rol en la empresa E (RLS en roles)');
  PERFORM public.perm_como(NULL);

  PERFORM public.chk((SELECT count(*) FROM public.roles), v_roles, '[PERM-5f] los intentos rechazados no crearon ningún rol');
  PERFORM public.chk((SELECT count(*) FROM public.role_permissions), v_rp, '[PERM-5f] ni ninguna fila de role_permissions');
  PERFORM public.chk((SELECT count(*) FROM public.user_roles), v_ur, '[PERM-5f] ni ninguna asignación');
  PERFORM public.chk_bool(public.perm5_tiene(orr, 'platform.contabilidad.compras.recepcion_registrar'), false, '[PERM-5f] y la persona R sigue sin la llave');
END;
$nadie$;

-- ═══════════════════════════════════════════════════════════════════════════
-- 7 · EL ADMINISTRADOR (Marco): conserva por perfil las seis acciones en SUS proyectos; el principal no se las quita
-- ═══════════════════════════════════════════════════════════════════════════
DO $administrador$
DECLARE
  E  constant uuid := 'fb050000-0000-0000-0000-0000000000e0';
  ow constant uuid := public.perm_id('ow', 'u');
  aa constant uuid := public.perm_id('aa', 'u');
  ac record;
  v_ov uuid;
BEGIN
  FOR ac IN
    SELECT * FROM (VALUES
      (1, 'aprobar_orden_compra', 'condominios.tab.ordenes_compra.approve',            'ordenes_compra',     'oc',  'aprobada',   ''),
      (2, 'registrar_recepcion',  'platform.contabilidad.compras.recepcion_registrar', 'recepciones',        'rec', 'registrada', ''),
      (3, 'aprobar_factura',      'platform.contabilidad.compras.factura_aprobar',     'facturas_proveedor', 'fac', 'aprobada',   ''),
      (4, 'aprobar_orden_pago',   'platform.contabilidad.compras.orden_pago_aprobar',  'ordenes_pago',       'op',  'aprobada',   ''),
      (5, 'ejecutar_pago',        'platform.contabilidad.compras.pago_ejecutar',       'ordenes_pago',       'op',  'pagada',     ', fecha_pago = CURRENT_DATE'),
      (6, 'anular_pago',          'platform.contabilidad.compras.pago_anular',         'ordenes_pago',       'op',  'anulada',    '')
    ) AS v(i, nombre, llave, tabla, tipo, dest, extra)
    ORDER BY i
  LOOP
    -- sin ninguna concesión a su nombre, en su proyecto A
    PERFORM public.perm_como(aa);
    PERFORM public.perm_filas(format('UPDATE public.%I SET estado = %L%s WHERE id = %L', ac.tabla, ac.dest, ac.extra, public.perm_id(ac.i || 'w', ac.tipo)), 1,
      format('[PERM-5g] el administrador asignado a A ejerce «%s» SIN ninguna llave concedida (su perfil las pasa)', ac.nombre));
    PERFORM public.perm_como(NULL);
  END LOOP;
  PERFORM public.chk((SELECT count(*) FROM public.user_roles WHERE user_id = aa), 0, '[PERM-5g] el administrador no tiene ningún rol asignado: lo hizo todo por su perfil');
  -- pero solo en SUS proyectos: el B no
  PERFORM public.perm_como(aa);
  PERFORM public.perm_filas(format('UPDATE public.recepciones SET estado = %L WHERE id = %L', 'registrada', public.perm_id('2b', 'rec')), 0,
    '[PERM-5g] pero NO en el proyecto B, que no tiene asignado: por la API el UPDATE por id afecta 0 filas (la RLS no se lo deja ver)');
  PERFORM public.perm_como(NULL);
  PERFORM public.chk_txt((SELECT estado FROM public.recepciones WHERE id = public.perm_id('2b', 'rec')), 'borrador', '[PERM-5g] y la recepción de B sigue en borrador');
  PERFORM public.perm_sub(aa);
  PERFORM public.perm_falla(format('SELECT public.compras_exigir_permiso(%L, %L, %L, %L)', 'platform.contabilidad.compras.recepcion_registrar', 'probar', E,
                                   'fb050000-0000-0000-0000-0000000000b1'::uuid),
    '42501', '^COMPRAS_ALCANCE_PROYECTO', '[PERM-5g] y la comprobación común lo confirma para el proyecto B: COMPRAS_ALCANCE_PROYECTO (el administrador con asignaciones no es exento)');
  PERFORM public.perm_sub(NULL);

  -- el principal asigna llaves a otros niveles, pero NO se las quita al administrador: un `deny` no cuenta para el nivel admin
  PERFORM public.perm_como(ow);
  SELECT public.perm5_panel(E, aa, 'PERM-5 Marco', ARRAY['platform.contabilidad.compras.pago_ejecutar'], 'deny') INTO v_ov;
  PERFORM public.perm_como(NULL);
  PERFORM public.chk((SELECT count(*) FROM public.role_permissions WHERE role_id = v_ov AND effect = 'deny'), 1,
    '[PERM-5g] el propietario BLOQUEA «pago_ejecutar» al administrador desde el panel (queda un deny en su rol de ajustes)');
  PERFORM public.chk_bool(public.perm5_tiene(aa, 'platform.contabilidad.compras.pago_ejecutar'), true,
    '[PERM-5g] DECISIÓN ABIERTA: user_has_permission sigue en true para el administrador (el perfil va antes que el deny): el principal no se la quita');
  PERFORM public.perm_como(aa);
  PERFORM public.perm_filas(format('UPDATE public.ordenes_pago SET estado = %L, fecha_pago = CURRENT_DATE WHERE id = %L', 'pagada', public.perm_id('5z', 'op')), 1,
    '[PERM-5g] y el administrador sigue ejecutando pagos en su proyecto aunque el principal le haya bloqueado la llave');
  PERFORM public.perm_como(NULL);
END;
$administrador$;

-- ═══════════════════════════════════════════════════════════════════════════
-- 7b · HALLAZGO LATERAL: no existe política UPDATE en user_roles ni en role_permissions. Cambiar el vencimiento de un rol ya asignado
--      (updateUserRoleExpiration, que RolPermisosModal.handleSave ejecuta) afecta 0 filas SIN error, aun para el propietario.
--      No afecta a las llaves de compras (el rol de ajustes se asigna sin vencimiento), pero la pantalla dice «guardado».
-- ═══════════════════════════════════════════════════════════════════════════
DO $lateral$
DECLARE
  ROL constant uuid := 'fb050000-0000-0000-0000-0000000000f1';
  ow constant uuid := public.perm_id('ow', 'u');
  op constant uuid := public.perm_id('op', 'u');
BEGIN
  PERFORM public.chk((SELECT count(*) FROM pg_policy WHERE polrelid IN ('public.user_roles'::regclass, 'public.role_permissions'::regclass) AND polcmd = 'w'), 0,
    '[PERM-5i] el catálogo no tiene ninguna política UPDATE en user_roles ni en role_permissions');
  PERFORM public.perm_como(ow);
  PERFORM public.perm_filas(format('UPDATE public.user_roles SET expires_at = now() + interval ''1 day'' WHERE user_id = %L AND role_id = %L', op, ROL), 0,
    '[PERM-5i] el propietario cambia el vencimiento del rol de Alexander: el UPDATE afecta 0 filas y NO da error (la pantalla diría «guardado»)');
  PERFORM public.perm_como(NULL);
  PERFORM public.chk((SELECT count(*) FROM public.user_roles WHERE user_id = op AND role_id = ROL AND expires_at IS NULL), 1,
    '[PERM-5i] y el vencimiento sigue sin fijarse');
END;
$lateral$;

-- ═══════════════════════════════════════════════════════════════════════════
-- 8 · LÍMITE CONOCIDO HASTA LA 0700 DE #928: ¿puede un administrador escribir roles y llaves POR LA API?
--     No depende de la 0700: mide la escritura (en una subtransacción que SIEMPRE se deshace) y exige que coincida con el texto de las tres
--     políticas de la cadena. Admiten `admin` → pasa (límite conocido; la interfaz nunca se lo ofreció). No lo admiten → 42501.
-- ═══════════════════════════════════════════════════════════════════════════
DO $limite$
DECLARE
  E  constant uuid := 'fb050000-0000-0000-0000-0000000000e0';
  aa constant uuid := public.perm_id('aa', 'u');
  orr constant uuid := public.perm_id('or', 'u');
  v_admite boolean;
  v_pasa boolean := false;
  v_estado text; v_roles bigint; v_rp bigint; v_ur bigint;
BEGIN
  SELECT bool_and(pg_get_expr(COALESCE(p.polwithcheck, p.polqual), p.polrelid) ~ '''admin''') INTO v_admite
    FROM pg_policy p
   WHERE (p.polrelid, p.polname) IN (('public.roles'::regclass, 'roles_insert'), ('public.role_permissions'::regclass, 'role_permissions_insert'),
                                     ('public.user_roles'::regclass, 'user_roles_insert'));
  PERFORM public.chk_bool(v_admite IS NOT NULL, true, '[PERM-5h] las tres políticas de escritura (roles, role_permissions y user_roles) existen en la cadena');
  SELECT count(*) INTO v_roles FROM public.roles;
  SELECT count(*) INTO v_rp FROM public.role_permissions;
  SELECT count(*) INTO v_ur FROM public.user_roles;

  PERFORM public.perm_como(aa);
  BEGIN
    PERFORM public.perm5_panel(E, orr, 'PERM-5 operador R (por un administrador)', ARRAY['platform.contabilidad.compras.pago_ejecutar']);
    v_pasa := true;
    RAISE EXCEPTION 'PERM5_REVERTIR';             -- deshace las tres escrituras: esta prueba no concede nada a nadie
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'PERM5_REVERTIR' THEN
      NULL;
    ELSIF SQLSTATE = '42501' AND SQLERRM ~ 'row-level security' THEN
      v_pasa := false;
    ELSE
      RAISE;
    END IF;
  END;
  PERFORM public.perm_como(NULL);

  PERFORM public.chk_bool(v_pasa, v_admite,
    '[PERM-5h] lo que el administrador consigue por la API coincide con el texto de las políticas de la cadena (admiten `admin`: ' || v_admite::text || ')');
  v_estado := CASE WHEN v_admite
    THEN 'LÍMITE CONOCIDO: hasta la migración 20261026000700 de #928, las políticas admiten al administrador y este SÍ pudo crear el rol, asignarlo y conceder la llave por la API (se deshizo); la interfaz nunca se lo ofreció'
    ELSE 'con la 0700 en la cadena, el administrador YA NO escribe roles ni llaves: 42501 por RLS' END;
  RAISE NOTICE '✓ [PERM-5h] %', v_estado;
  PERFORM public.chk((SELECT count(*) FROM public.roles), v_roles, '[PERM-5h] la escritura medida se deshizo: ningún rol de más');
  PERFORM public.chk((SELECT count(*) FROM public.role_permissions), v_rp, '[PERM-5h] ninguna fila de role_permissions de más');
  PERFORM public.chk((SELECT count(*) FROM public.user_roles), v_ur, '[PERM-5h] ninguna asignación de más');
  PERFORM public.chk_bool(public.perm5_tiene(orr, 'platform.contabilidad.compras.pago_ejecutar'), false, '[PERM-5h] y la persona R sigue sin la llave');
END;
$limite$;

-- ═══════════════════════════════════════════════════════════════════════════
-- LIMPIEZA · ninguna ayuda se queda en la base (los datos PERM-5… sí: los documentos de compras no se borran).
-- ═══════════════════════════════════════════════════════════════════════════
DROP FUNCTION IF EXISTS public.perm5_panel(uuid, uuid, text, text[], text);
DROP FUNCTION IF EXISTS public.perm5_tiene(uuid, text);
DROP FUNCTION IF EXISTS public.perm_falla(text, text, text, text);
DROP FUNCTION IF EXISTS public.perm_filas(text, bigint, text);
DROP FUNCTION IF EXISTS public.perm_pasa(text, text);
DROP FUNCTION IF EXISTS public.perm_empresa(uuid, uuid, uuid, uuid, uuid, text);
DROP FUNCTION IF EXISTS public.perm_persona(uuid, uuid, text, uuid[], text);
DROP FUNCTION IF EXISTS public.perm_cadena(text, uuid, uuid, uuid, text);
DROP FUNCTION IF EXISTS public.perm_como(uuid, boolean);
DROP FUNCTION IF EXISTS public.perm_sub(uuid);
DROP FUNCTION IF EXISTS public.perm_id(text, text);
SELECT public.chk((SELECT count(*) FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname ~ '^perm[0-9]*_'), 0,
  '[limpieza] tras la prueba no queda ninguna ayuda perm_* / perm5_*');
