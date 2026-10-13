-- Actualización ADITIVA del padrón de PANTALLA 5b5b2000… (sandbox `control-agua-rls-sandbox`, NUNCA producción) para un
-- padrón ya sembrado con la versión anterior de `padron_ui_controles.sql.tpl`, que aborta si el padrón existe.
-- `__PW__` es la MISMA contraseña de prueba del padrón (no se guarda en el repositorio). Un padrón sembrado desde cero con
-- la versión actual de la plantilla NO la necesita: ya trae todo esto.
--
-- Qué añade (nada se borra ni se modifica):
--   1. La llave de la pestaña de órdenes de compra (`condominios.tab.ordenes_compra.approve`, «Autorizar / Denegar — Órdenes
--      compra») a los roles `rq` («Autorizar + Editar») y `rs` («Autorizar sin Editar»): aprobar una orden y devolver una
--      aprobada exigen ESA llave (D1), no el «Autorizar / Denegar» genérico de Contabilidad.
--   2. El cuarto perfil «solo genérico» (`u4` / `r4`): «Autorizar» genérico + «Editar» de Contabilidad y la pestaña de
--      órdenes, SIN la llave de la orden. La pantalla no le ofrece Aprobar ni Devolver (ver `ESPERADO.soloGenerico`).
-- El correo sale igual que en la plantilla completa ('zz-ui-' || etiqueta || '@example.com', etiqueta `soloGenerico`); el inicio
-- de sesión no distingue mayúsculas (el perfil `sinEditar` ya funcionaba así). Idempotente: se puede correr dos veces; la
-- segunda no cambia nada.
DO $actualizacion$
DECLARE
  c   constant uuid := '5b5b2000-0000-0000-0000-00000000000c';
  pj  constant uuid := '5b5b2000-0000-0000-0000-0000000000a1';
  u4  constant uuid := '5b5b2000-0000-0000-0000-0000000000f5';  -- solo genérico
  rq  constant uuid := '5b5b2000-0000-0000-0000-0000000000c1';
  rs  constant uuid := '5b5b2000-0000-0000-0000-0000000000c3';
  r4  constant uuid := '5b5b2000-0000-0000-0000-0000000000c4';
  pw  constant text := '__PW__';
  k text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.companies WHERE id = c) OR NOT EXISTS (SELECT 1 FROM public.roles WHERE id IN (rq, rs)) THEN
    RAISE EXCEPTION 'ABORTA: el padron 5b5b2 no existe; siembralo con padron_ui_controles.sql.tpl (la version actual ya trae todo esto).';
  END IF;

  -- 1 · la llave de la orden de compra para «Autorizar + Editar» y «Autorizar sin Editar»
  INSERT INTO public.role_permissions (role_id, permission_key, effect)
  SELECT r, 'condominios.tab.ordenes_compra.approve', 'allow' FROM unnest(ARRAY[rq, rs]) r
  WHERE NOT EXISTS (SELECT 1 FROM public.role_permissions x WHERE x.role_id = r AND x.permission_key = 'condominios.tab.ordenes_compra.approve');

  -- 2 · el cuarto perfil «solo genérico»
  IF NOT EXISTS (SELECT 1 FROM auth.users WHERE id = u4) THEN
    INSERT INTO auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, confirmation_token, recovery_token, email_change_token_new, email_change, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
    VALUES ('00000000-0000-0000-0000-000000000000', u4, 'authenticated', 'authenticated', 'zz-ui-soloGenerico@example.com', crypt(pw, gen_salt('bf')), now(), '', '', '', '', '{"provider":"email","providers":["email"]}', '{}', now(), now());
    INSERT INTO auth.identities (provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at, id)
    VALUES (u4::text, u4, jsonb_build_object('sub', u4::text, 'email', 'zz-ui-soloGenerico@example.com', 'email_verified', true), 'email', now(), now(), now(), gen_random_uuid());
  END IF;
  INSERT INTO public.app_users (id, company_id, full_name, role)
  SELECT u4, c, 'ZZ UI Solo generico', 'operator' WHERE NOT EXISTS (SELECT 1 FROM public.app_users WHERE id = u4);
  INSERT INTO public.user_project_assignments (user_id, project_id, permission_type)
  SELECT u4, pj, 'total' WHERE NOT EXISTS (SELECT 1 FROM public.user_project_assignments WHERE user_id = u4 AND project_id = pj);
  INSERT INTO public.roles (id, company_id, name)
  SELECT r4, c, 'ZZ UI Solo generico' WHERE NOT EXISTS (SELECT 1 FROM public.roles WHERE id = r4);
  -- Operaciones (pestaña de órdenes de compra con crear y editar) + módulo, y Contabilidad: ver, crear, editar y el «Autorizar» genérico
  FOREACH k IN ARRAY ARRAY['condominios.tab.ordenes_compra','condominios.tab.ordenes_compra.create','condominios.tab.ordenes_compra.edit','platform.condominios.view',
                           'platform.contabilidad.view','platform.contabilidad.create','platform.contabilidad.edit','platform.contabilidad.approve'] LOOP
    INSERT INTO public.role_permissions (role_id, permission_key, effect)
    SELECT r4, k, 'allow' WHERE NOT EXISTS (SELECT 1 FROM public.role_permissions x WHERE x.role_id = r4 AND x.permission_key = k);
  END LOOP;
  INSERT INTO public.user_roles (user_id, role_id)
  SELECT u4, r4 WHERE NOT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = u4 AND role_id = r4);
END
$actualizacion$;
