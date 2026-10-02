DO $padron$
DECLARE
  c   constant uuid := '5b5b1000-0000-0000-0000-00000000000c';
  cz  constant uuid := '5b5b1000-0000-0000-0000-00000000000d';
  pj  constant uuid := '5b5b1000-0000-0000-0000-0000000000a1';
  pj2 constant uuid := '5b5b1000-0000-0000-0000-0000000000a2';
  pjz constant uuid := '5b5b1000-0000-0000-0000-0000000000a3';
  ua  constant uuid := '5b5b1000-0000-0000-0000-0000000000f1';
  uo  constant uuid := '5b5b1000-0000-0000-0000-0000000000f2';
  uk  constant uuid := '5b5b1000-0000-0000-0000-0000000000f3';
  u2  constant uuid := '5b5b1000-0000-0000-0000-0000000000f4';
  uz  constant uuid := '5b5b1000-0000-0000-0000-0000000000f5';
  pv  constant uuid := '5b5b1000-0000-0000-0000-0000000000b1';
  pv2 constant uuid := '5b5b1000-0000-0000-0000-0000000000b2';
  su  constant uuid := '5b5b1000-0000-0000-0000-0000000000d1';
  rk  constant uuid := '5b5b1000-0000-0000-0000-0000000000c9';
  ro  constant uuid := '5b5b1000-0000-0000-0000-0000000000c8';
  pw  constant text := '__PW__';
  u record;
  cta_activo uuid;
BEGIN
  IF EXISTS (SELECT 1 FROM public.companies WHERE id IN (c, cz)) OR EXISTS (SELECT 1 FROM auth.users WHERE id::text LIKE '5b5b1000%') THEN
    RAISE EXCEPTION 'ABORTA: el padrón 5b5b1 ya existe; no se escribe nada.';
  END IF;
  INSERT INTO public.companies (id, nombre, default_currency) VALUES (c, 'ZZ Validación Bloque B', 'gtq'), (cz, 'ZZ Otra empresa (UI)', 'gtq');
  INSERT INTO public.projects (id, company_id, nombre) VALUES (pj, c, 'ZZ Proyecto validación'), (pj2, c, 'ZZ Otro proyecto'), (pjz, cz, 'ZZ Proyecto otra empresa');
  FOR u IN SELECT * FROM (VALUES (ua,'admin'),(uo,'operador'),(uk,'contador'),(u2,'otroproyecto'),(uz,'otraempresa')) v(id, tag) LOOP
    INSERT INTO auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, confirmation_token, recovery_token, email_change_token_new, email_change, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
    VALUES ('00000000-0000-0000-0000-000000000000', u.id, 'authenticated', 'authenticated', 'zz-bloqueb-' || u.tag || '@example.com', crypt(pw, gen_salt('bf')), now(), '', '', '', '', '{"provider":"email","providers":["email"]}', '{}', now(), now());
    INSERT INTO auth.identities (provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at, id)
    VALUES (u.id::text, u.id, jsonb_build_object('sub', u.id::text, 'email', 'zz-bloqueb-' || u.tag || '@example.com', 'email_verified', true), 'email', now(), now(), now(), gen_random_uuid());
  END LOOP;
  INSERT INTO public.app_users (id, company_id, full_name, role) VALUES
    (ua, c, 'ZZ Admin', 'admin'), (uo, c, 'ZZ Operador compras', 'operator'), (uk, c, 'ZZ Contador', 'operator'),
    (u2, c, 'ZZ Operador otro proyecto', 'operator'), (uz, cz, 'ZZ Admin otra empresa', 'admin');
  INSERT INTO public.user_project_assignments (user_id, project_id, permission_type) VALUES
    (ua, pj, 'total'), (uo, pj, 'total'), (uk, pj, 'total'), (u2, pj2, 'total'), (uz, pjz, 'total');
  INSERT INTO public.roles (id, company_id, name) VALUES (rk, c, 'ZZ Contador'), (ro, c, 'ZZ Operador compras');
  INSERT INTO public.role_permissions (role_id, permission_key, effect) VALUES
    (rk, 'platform.contabilidad.view', 'allow'), (rk, 'platform.contabilidad.create', 'allow'),
    (rk, 'platform.contabilidad.edit', 'allow'), (rk, 'platform.contabilidad.delete', 'allow'),
    (ro, 'condominios.tab.ordenes_compra', 'allow'), (ro, 'condominios.tab.suministros', 'allow');
  INSERT INTO public.user_roles (user_id, role_id) VALUES (uk, rk), (uo, ro), (u2, ro);
  PERFORM public.conta_seed_catalogo(c, pj);
  PERFORM public.compras_seed_cuentas(c, pj);
  PERFORM public.conta_seed_cuenta(c, pj, '6205', 'Servicios contratados propios', 'gasto', 'deudora', NULL, 1, true);
  PERFORM public.conta_seed_cuenta(c, pj, '9101', 'Equipo propio de la empresa', 'activo', 'deudora', NULL, 1, true);
  SELECT id INTO cta_activo FROM public.conta_cuentas WHERE company_id = c AND project_id = pj AND codigo = '9101';
  UPDATE public.conta_mapeo_cuentas SET cuenta_id = cta_activo WHERE company_id = c AND project_id = pj AND evento = 'activo_fijo';
  INSERT INTO public.proveedores (id, company_id, nombre, nit, pais, alcance) VALUES
    (pv, c, 'ZZ Proveedor de validación', '9999991-1', 'GT', 'empresa'), (pv2, c, 'ZZ Otro proveedor', '9999992-2', 'GT', 'empresa');
  INSERT INTO public.suministros_condominio (id, company_id, project_id, nombre, unidad_medida) VALUES (su, c, pj, 'ZZ Cloro', 'litro');
  INSERT INTO public.conta_tipos_cambio_mensual (company_id, moneda, moneda_base, periodo, tasa) VALUES (c, 'USD', 'GTQ', to_char(CURRENT_DATE, 'YYYY-MM'), 7.75);
  PERFORM set_config('request.jwt.claim.sub', ua::text, true);
  SET LOCAL ROLE authenticated;
  UPDATE public.proveedores SET estado = 'autorizado' WHERE id IN (pv, pv2);
END
$padron$;
