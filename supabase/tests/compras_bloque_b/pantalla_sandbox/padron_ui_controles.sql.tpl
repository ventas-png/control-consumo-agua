-- Padrón de PANTALLA para los controles de compras (sandbox `control-agua-rls-sandbox`, NUNCA producción).
-- Prefijo 5b5b2000…; se siembra UNA vez (aborta si ya existe). `__PW__` se sustituye por una contraseña de prueba
-- que NO se guarda en el repositorio. Retiro: borrar solo filas 5b5b2000… (decisión del propietario).
--
-- Aprobar una orden de compra y devolver una aprobada a borrador exigen la llave de la pestaña
-- (`condominios.tab.ordenes_compra.approve`, D1) y NO el «Autorizar / Denegar» genérico de Contabilidad: por eso `rq`
-- y `rs` la reciben, y el cuarto perfil `r4` («solo genérico») tiene el genérico + «Editar» pero NO esa llave: la
-- pantalla no le ofrece Aprobar ni Devolver. Un padrón ya sembrado con la versión anterior se pone al día con
-- `padron_ui_controles_actualizacion.sql.tpl` (aditivo, idempotente). Lo que la pantalla debe ofrecer a cada perfil
-- está en `ESPERADO` de `pantalla_controles.mjs`, y una prueba de vitest (`padronSandbox.test.tsx`) lo contrasta con
-- estas mismas filas.
DO $padron$
DECLARE
  c   constant uuid := '5b5b2000-0000-0000-0000-00000000000c';
  pj  constant uuid := '5b5b2000-0000-0000-0000-0000000000a1';
  ua  constant uuid := '5b5b2000-0000-0000-0000-0000000000f1';  -- administrador
  uq  constant uuid := '5b5b2000-0000-0000-0000-0000000000f2';  -- Autorizar + Editar (sin Cambiar estado)
  ue  constant uuid := '5b5b2000-0000-0000-0000-0000000000f3';  -- Cambiar estado + Editar (sin Autorizar, sin Eliminar)
  us  constant uuid := '5b5b2000-0000-0000-0000-0000000000f4';  -- Autorizar SIN Editar
  u4  constant uuid := '5b5b2000-0000-0000-0000-0000000000f5';  -- solo genérico: Autorizar (genérico) + Editar, SIN la llave de la orden de compra
  rq  constant uuid := '5b5b2000-0000-0000-0000-0000000000c1';
  re  constant uuid := '5b5b2000-0000-0000-0000-0000000000c2';
  rs  constant uuid := '5b5b2000-0000-0000-0000-0000000000c3';
  r4  constant uuid := '5b5b2000-0000-0000-0000-0000000000c4';
  pv  constant uuid := '5b5b2000-0000-0000-0000-0000000000b1';
  pw  constant text := '__PW__';
  u record;
  k text;
  p text[];
BEGIN
  IF EXISTS (SELECT 1 FROM public.companies WHERE id = c) OR EXISTS (SELECT 1 FROM auth.users WHERE id::text LIKE '5b5b2000%') THEN
    RAISE EXCEPTION 'ABORTA: el padron 5b5b2 ya existe; no se escribe nada.';
  END IF;
  INSERT INTO public.companies (id, nombre, default_currency) VALUES (c, 'ZZ UI Controles de compras', 'gtq');
  INSERT INTO public.projects (id, company_id, nombre) VALUES (pj, c, 'ZZ UI Proyecto controles');
  FOR u IN SELECT * FROM (VALUES (ua,'admin'),(uq,'autoriza'),(ue,'estado'),(us,'sinEditar'),(u4,'soloGenerico')) v(id, tag) LOOP
    INSERT INTO auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, confirmation_token, recovery_token, email_change_token_new, email_change, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
    VALUES ('00000000-0000-0000-0000-000000000000', u.id, 'authenticated', 'authenticated', 'zz-ui-' || u.tag || '@example.com', crypt(pw, gen_salt('bf')), now(), '', '', '', '', '{"provider":"email","providers":["email"]}', '{}', now(), now());
    INSERT INTO auth.identities (provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at, id)
    VALUES (u.id::text, u.id, jsonb_build_object('sub', u.id::text, 'email', 'zz-ui-' || u.tag || '@example.com', 'email_verified', true), 'email', now(), now(), now(), gen_random_uuid());
  END LOOP;
  INSERT INTO public.app_users (id, company_id, full_name, role) VALUES
    (ua, c, 'ZZ UI Admin', 'admin'), (uq, c, 'ZZ UI Autoriza+Editar', 'operator'),
    (ue, c, 'ZZ UI CambiaEstado+Editar', 'operator'), (us, c, 'ZZ UI Autoriza sin Editar', 'operator'),
    (u4, c, 'ZZ UI Solo generico', 'operator');
  INSERT INTO public.user_project_assignments (user_id, project_id, permission_type) VALUES
    (ua, pj, 'total'), (uq, pj, 'total'), (ue, pj, 'total'), (us, pj, 'total'), (u4, pj, 'total');
  INSERT INTO public.roles (id, company_id, name) VALUES (rq, c, 'ZZ UI Autoriza+Editar'), (re, c, 'ZZ UI CambiaEstado+Editar'), (rs, c, 'ZZ UI Autoriza sin Editar'),
    (r4, c, 'ZZ UI Solo generico');
  -- Operaciones (pestaña de órdenes de compra con crear y editar) + módulo
  FOREACH k IN ARRAY ARRAY['condominios.tab.ordenes_compra','condominios.tab.ordenes_compra.create','condominios.tab.ordenes_compra.edit','platform.condominios.view'] LOOP
    INSERT INTO public.role_permissions (role_id, permission_key, effect) VALUES (rq, k, 'allow'), (re, k, 'allow'), (rs, k, 'allow'), (r4, k, 'allow');
  END LOOP;
  -- Contabilidad
  INSERT INTO public.role_permissions (role_id, permission_key, effect) VALUES
    (rq, 'platform.contabilidad.view', 'allow'), (rq, 'platform.contabilidad.create', 'allow'), (rq, 'platform.contabilidad.edit', 'allow'), (rq, 'platform.contabilidad.approve', 'allow'),
    (re, 'platform.contabilidad.view', 'allow'), (re, 'platform.contabilidad.create', 'allow'), (re, 'platform.contabilidad.edit', 'allow'), (re, 'platform.contabilidad.change_status', 'allow'),
    (rs, 'platform.contabilidad.view', 'allow'), (rs, 'platform.contabilidad.approve', 'allow'),
    (r4, 'platform.contabilidad.view', 'allow'), (r4, 'platform.contabilidad.create', 'allow'), (r4, 'platform.contabilidad.edit', 'allow'), (r4, 'platform.contabilidad.approve', 'allow');
  -- La llave de la orden de compra («Autorizar / Denegar — Órdenes compra»): lo que el servidor exige (D1) para aprobar una
  -- orden y devolver una aprobada. La tienen «Autorizar + Editar» y «Autorizar sin Editar»; «solo genérico» NO (a propósito).
  INSERT INTO public.role_permissions (role_id, permission_key, effect) VALUES
    (rq, 'condominios.tab.ordenes_compra.approve', 'allow'),
    (rs, 'condominios.tab.ordenes_compra.approve', 'allow');
  INSERT INTO public.user_roles (user_id, role_id) VALUES (uq, rq), (ue, re), (us, rs), (u4, r4);
  PERFORM public.conta_seed_catalogo(c, pj);
  PERFORM public.compras_seed_cuentas(c, pj);
  INSERT INTO public.proveedores (id, company_id, nombre, nit, pais, alcance) VALUES (pv, c, 'ZZ UI Proveedor', '9999971-1', 'GT', 'empresa');
  PERFORM set_config('request.jwt.claim.sub', ua::text, true);
  SET LOCAL ROLE authenticated;
  UPDATE public.proveedores SET estado = 'autorizado' WHERE id = pv;
  -- o1 borrador nuevo; o2 borrador DEVUELTO (numerado, revisión 1); o3 aprobada; o4 y o5 borradores para borrar
  INSERT INTO public.ordenes_compra (id, company_id, project_id, proveedor_id, proveedor_nombre, concepto) VALUES
    ('5b5b2000-0000-0000-0000-0000000000e1', c, pj, pv, 'ZZ UI Proveedor', 'ZZ UI borrador nuevo'),
    ('5b5b2000-0000-0000-0000-0000000000e2', c, pj, pv, 'ZZ UI Proveedor', 'ZZ UI borrador devuelto'),
    ('5b5b2000-0000-0000-0000-0000000000e3', c, pj, pv, 'ZZ UI Proveedor', 'ZZ UI orden aprobada'),
    ('5b5b2000-0000-0000-0000-0000000000e4', c, pj, pv, 'ZZ UI Proveedor', 'ZZ UI borrador para borrar (admin)'),
    ('5b5b2000-0000-0000-0000-0000000000e5', c, pj, pv, 'ZZ UI Proveedor', 'ZZ UI borrador para borrar (sin permiso)');
  FOR p IN SELECT ARRAY[x] FROM unnest(ARRAY['e1','e2','e3','e4','e5']) x LOOP
    INSERT INTO public.orden_compra_lineas (company_id, orden_compra_id, linea, descripcion, destino_tipo, categoria, cantidad, unidad, precio_unitario)
    VALUES (c, ('5b5b2000-0000-0000-0000-0000000000' || p[1])::uuid, 1, 'ZZ UI renglón', 'servicio', 'servicios', 1, 'servicio', 100);
  END LOOP;
  UPDATE public.ordenes_compra SET estado = 'aprobada' WHERE id IN ('5b5b2000-0000-0000-0000-0000000000e2', '5b5b2000-0000-0000-0000-0000000000e3');
  UPDATE public.ordenes_compra SET estado = 'borrador', motivo_devolucion = 'ZZ UI corregir precio' WHERE id = '5b5b2000-0000-0000-0000-0000000000e2';
END
$padron$;
