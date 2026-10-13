-- Padrón de PANTALLA para Contabilidad › Compras y Contabilidad › Cuentas por pagar (sandbox `control-agua-rls-sandbox`,
-- NUNCA producción). Prefijo 5b5b3000…; se siembra UNA vez (aborta si ya existe). `__PW__` se sustituye por una contraseña de
-- prueba que NO se guarda en el repositorio. Retiro: `retiro_padron_ui_contabilidad.sql` (borra SOLO filas 5b5b3000…).
--
-- Qué siembra (todo simulado, con textos «ZZ …»):
--   · la empresa «ZZ UI Contabilidad» con DOS proyectos: A (donde se opera) y B (donde solo está la persona «sin asignación a A»);
--   · el catálogo contable de la empresa y de cada proyecto (`conta_seed_catalogo`, `compras_seed_cuentas`), con sus mapeos de
--     devengo, de cuentas por pagar y de método de pago (transferencia), y UN proveedor AUTORIZADO;
--   · las personas que SEPARAN las acciones: cada una tiene SOLO la llave de su paso (más ver/editar —y crear donde captura—,
--     que la RLS y la pantalla exigen) y nada más. Los documentos (orden, recepción, factura, órdenes de pago) NO se siembran:
--     los crea el guion por las pantallas, cada paso con la persona que lo tiene.
--
--   perfil          correo                       llaves (todas con «Ver» de Contabilidad)                       proyectos
--   admin           zz-uc-admin@…                (administrador de la empresa: solo prepara y verifica)         ninguno (exento)
--   solicitante     zz-uc-solicitante@…          crear + editar                                                 A
--   apruebaoc       zz-uc-apruebaoc@…            editar + condominios.tab.ordenes_compra.approve                A
--   emisor          zz-uc-emisor@…               editar + change_status (emitir/cancelar la orden)              A
--   receptor        zz-uc-receptor@…             crear + editar + compras.recepcion_registrar                   A
--   apruebafac      zz-uc-apruebafac@…           editar + compras.factura_aprobar                               A
--   apruebaop       zz-uc-apruebaop@…            editar + compras.orden_pago_aprobar                            A
--   pagador         zz-uc-pagador@…              editar + compras.pago_ejecutar                                 A
--   anulador        zz-uc-anulador@…             editar + compras.pago_anular                                   A
--   sinasig         zz-uc-sinasig@…              crear + editar + approve + change_status + LAS SEIS llaves     SOLO B (no A)
--   genericos       zz-uc-genericos@…            crear + editar + approve + change_status, SIN ninguna llave    A
--   revoca          zz-uc-revoca@…               crear + editar + compras.pago_anular (a esta se le quita el     A
--                                                permiso con la sesión abierta, para probar «cero filas»)
--
-- Las llaves nuevas NO las tiene ningún rol real: aquí solo las reciben los roles «ZZ UC …» de esta empresa de prueba.
DO $padron$
DECLARE
  c   constant uuid := '5b5b3000-0000-0000-0000-00000000000c';
  pa  constant uuid := '5b5b3000-0000-0000-0000-0000000000a1';   -- proyecto A (donde se opera)
  pb  constant uuid := '5b5b3000-0000-0000-0000-0000000000b2';   -- proyecto B
  pv  constant uuid := '5b5b3000-0000-0000-0000-0000000000b1';   -- proveedor autorizado
  ua  constant uuid := '5b5b3000-0000-0000-0000-0000000000f1';   -- administrador
  pw  constant text := '__PW__';
  k_oc  constant text := 'condominios.tab.ordenes_compra.approve';
  k_rec constant text := 'platform.contabilidad.compras.recepcion_registrar';
  k_fac constant text := 'platform.contabilidad.compras.factura_aprobar';
  k_opa constant text := 'platform.contabilidad.compras.orden_pago_aprobar';
  k_pag constant text := 'platform.contabilidad.compras.pago_ejecutar';
  k_anu constant text := 'platform.contabilidad.compras.pago_anular';
  v_ver constant text := 'platform.contabilidad.view';
  v_cre constant text := 'platform.contabilidad.create';
  v_edi constant text := 'platform.contabilidad.edit';
  v_apr constant text := 'platform.contabilidad.approve';
  v_est constant text := 'platform.contabilidad.change_status';
  u record;
  k text;
  n int;
BEGIN
  IF EXISTS (SELECT 1 FROM public.companies WHERE id = c) OR EXISTS (SELECT 1 FROM auth.users WHERE id::text LIKE '5b5b3000%') THEN
    RAISE EXCEPTION 'ABORTA: el padron 5b5b3 ya existe; no se escribe nada.';
  END IF;
  -- Las cinco llaves por acción y la de la pestaña de órdenes deben existir en el catálogo (las pone la migración 0900).
  SELECT count(*) INTO n FROM public.permissions WHERE key IN (k_oc, k_rec, k_fac, k_opa, k_pag, k_anu, v_ver, v_cre, v_edi, v_apr, v_est);
  IF n <> 11 THEN
    RAISE EXCEPTION 'ABORTA: faltan llaves en el catalogo (hay % de 11); ¿esta aplicada la migracion 20261027000900?', n;
  END IF;

  INSERT INTO public.companies (id, nombre, default_currency) VALUES (c, 'ZZ UI Contabilidad', 'gtq');
  INSERT INTO public.projects (id, company_id, nombre) VALUES (pa, c, 'ZZ UC Proyecto A'), (pb, c, 'ZZ UC Proyecto B');

  -- Personas: (id, etiqueta del correo, nombre, rol de plataforma)
  FOR u IN SELECT * FROM (VALUES
    (ua,                                                'admin',       'ZZ UC Administrador',                      'admin'),
    ('5b5b3000-0000-0000-0000-0000000000f2'::uuid,      'solicitante', 'ZZ UC Solicitante',                        'operator'),
    ('5b5b3000-0000-0000-0000-0000000000f3'::uuid,      'apruebaoc',   'ZZ UC Aprueba orden de compra',            'operator'),
    ('5b5b3000-0000-0000-0000-0000000000f4'::uuid,      'emisor',      'ZZ UC Emite la orden',                     'operator'),
    ('5b5b3000-0000-0000-0000-0000000000f5'::uuid,      'receptor',    'ZZ UC Registra la recepcion',              'operator'),
    ('5b5b3000-0000-0000-0000-0000000000f6'::uuid,      'apruebafac',  'ZZ UC Aprueba factura',                    'operator'),
    ('5b5b3000-0000-0000-0000-0000000000f7'::uuid,      'apruebaop',   'ZZ UC Aprueba orden de pago',              'operator'),
    ('5b5b3000-0000-0000-0000-0000000000f8'::uuid,      'pagador',     'ZZ UC Ejecuta el pago',                    'operator'),
    ('5b5b3000-0000-0000-0000-0000000000f9'::uuid,      'anulador',    'ZZ UC Anula el pago',                      'operator'),
    ('5b5b3000-0000-0000-0000-0000000000fa'::uuid,      'sinasig',     'ZZ UC Con llaves SIN proyecto A',          'operator'),
    ('5b5b3000-0000-0000-0000-0000000000fb'::uuid,      'genericos',   'ZZ UC Solo permisos genericos',            'operator'),
    ('5b5b3000-0000-0000-0000-0000000000fc'::uuid,      'revoca',      'ZZ UC A quien se le revoca en caliente',   'operator')
  ) v(id, tag, nombre, rol) LOOP
    INSERT INTO auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, confirmation_token, recovery_token, email_change_token_new, email_change, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
    VALUES ('00000000-0000-0000-0000-000000000000', u.id, 'authenticated', 'authenticated', 'zz-uc-' || u.tag || '@example.com', crypt(pw, gen_salt('bf')), now(), '', '', '', '', '{"provider":"email","providers":["email"]}', '{}', now(), now());
    INSERT INTO auth.identities (provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at, id)
    VALUES (u.id::text, u.id, jsonb_build_object('sub', u.id::text, 'email', 'zz-uc-' || u.tag || '@example.com', 'email_verified', true), 'email', now(), now(), now(), gen_random_uuid());
    INSERT INTO public.app_users (id, company_id, full_name, role) VALUES (u.id, c, u.nombre, u.rol);
  END LOOP;

  -- Proyectos: todos al A, salvo «sinasig» (solo B). El administrador no tiene asignaciones (exento de proyecto).
  INSERT INTO public.user_project_assignments (user_id, project_id, permission_type)
  SELECT id, pa, 'total' FROM auth.users WHERE id::text LIKE '5b5b3000%' AND id <> ua AND id <> '5b5b3000-0000-0000-0000-0000000000fa';
  INSERT INTO public.user_project_assignments (user_id, project_id, permission_type) VALUES ('5b5b3000-0000-0000-0000-0000000000fa', pb, 'total');

  -- Roles de empresa, uno por perfil (id explícito: 5b5b3000-…-0c2 a 0c9 y 0d1 a 0d3).
  INSERT INTO public.roles (id, company_id, name) VALUES
    ('5b5b3000-0000-0000-0000-0000000000c2', c, 'ZZ UC Solicitante'),
    ('5b5b3000-0000-0000-0000-0000000000c3', c, 'ZZ UC Aprueba orden de compra'),
    ('5b5b3000-0000-0000-0000-0000000000c4', c, 'ZZ UC Emite la orden'),
    ('5b5b3000-0000-0000-0000-0000000000c5', c, 'ZZ UC Registra la recepcion'),
    ('5b5b3000-0000-0000-0000-0000000000c6', c, 'ZZ UC Aprueba factura'),
    ('5b5b3000-0000-0000-0000-0000000000c7', c, 'ZZ UC Aprueba orden de pago'),
    ('5b5b3000-0000-0000-0000-0000000000c8', c, 'ZZ UC Ejecuta el pago'),
    ('5b5b3000-0000-0000-0000-0000000000c9', c, 'ZZ UC Anula el pago'),
    ('5b5b3000-0000-0000-0000-0000000000d1', c, 'ZZ UC Con llaves sin proyecto A'),
    ('5b5b3000-0000-0000-0000-0000000000d2', c, 'ZZ UC Solo genericos'),
    ('5b5b3000-0000-0000-0000-0000000000d3', c, 'ZZ UC Revocable');

  -- Llaves por rol. Todos con «Ver» de Contabilidad; cada paso con SU llave y «Editar» (la RLS de UPDATE lo pide).
  INSERT INTO public.role_permissions (role_id, permission_key, effect) VALUES
    -- solicitante: captura (crear + editar), sin ninguna decisión
    ('5b5b3000-0000-0000-0000-0000000000c2', v_ver, 'allow'), ('5b5b3000-0000-0000-0000-0000000000c2', v_cre, 'allow'), ('5b5b3000-0000-0000-0000-0000000000c2', v_edi, 'allow'),
    -- aprueba la orden de compra: SOLO la llave de la pestaña de órdenes (D1)
    ('5b5b3000-0000-0000-0000-0000000000c3', v_ver, 'allow'), ('5b5b3000-0000-0000-0000-0000000000c3', v_edi, 'allow'), ('5b5b3000-0000-0000-0000-0000000000c3', k_oc, 'allow'),
    -- emite/cancela la orden: «Cambiar estado» genérico
    ('5b5b3000-0000-0000-0000-0000000000c4', v_ver, 'allow'), ('5b5b3000-0000-0000-0000-0000000000c4', v_edi, 'allow'), ('5b5b3000-0000-0000-0000-0000000000c4', v_est, 'allow'),
    -- receptor: crea el borrador de la recepción y la registra
    ('5b5b3000-0000-0000-0000-0000000000c5', v_ver, 'allow'), ('5b5b3000-0000-0000-0000-0000000000c5', v_cre, 'allow'), ('5b5b3000-0000-0000-0000-0000000000c5', v_edi, 'allow'), ('5b5b3000-0000-0000-0000-0000000000c5', k_rec, 'allow'),
    -- aprueba la factura
    ('5b5b3000-0000-0000-0000-0000000000c6', v_ver, 'allow'), ('5b5b3000-0000-0000-0000-0000000000c6', v_edi, 'allow'), ('5b5b3000-0000-0000-0000-0000000000c6', k_fac, 'allow'),
    -- aprueba la orden de pago
    ('5b5b3000-0000-0000-0000-0000000000c7', v_ver, 'allow'), ('5b5b3000-0000-0000-0000-0000000000c7', v_edi, 'allow'), ('5b5b3000-0000-0000-0000-0000000000c7', k_opa, 'allow'),
    -- ejecuta el pago
    ('5b5b3000-0000-0000-0000-0000000000c8', v_ver, 'allow'), ('5b5b3000-0000-0000-0000-0000000000c8', v_edi, 'allow'), ('5b5b3000-0000-0000-0000-0000000000c8', k_pag, 'allow'),
    -- anula el pago
    ('5b5b3000-0000-0000-0000-0000000000c9', v_ver, 'allow'), ('5b5b3000-0000-0000-0000-0000000000c9', v_edi, 'allow'), ('5b5b3000-0000-0000-0000-0000000000c9', k_anu, 'allow'),
    -- sinasig: genéricos + las seis llaves, pero asignada solo al proyecto B
    ('5b5b3000-0000-0000-0000-0000000000d1', v_ver, 'allow'), ('5b5b3000-0000-0000-0000-0000000000d1', v_cre, 'allow'), ('5b5b3000-0000-0000-0000-0000000000d1', v_edi, 'allow'),
    ('5b5b3000-0000-0000-0000-0000000000d1', v_apr, 'allow'), ('5b5b3000-0000-0000-0000-0000000000d1', v_est, 'allow'),
    ('5b5b3000-0000-0000-0000-0000000000d1', k_oc, 'allow'), ('5b5b3000-0000-0000-0000-0000000000d1', k_rec, 'allow'), ('5b5b3000-0000-0000-0000-0000000000d1', k_fac, 'allow'),
    ('5b5b3000-0000-0000-0000-0000000000d1', k_opa, 'allow'), ('5b5b3000-0000-0000-0000-0000000000d1', k_pag, 'allow'), ('5b5b3000-0000-0000-0000-0000000000d1', k_anu, 'allow'),
    -- genericos: approve y change_status de siempre, SIN ninguna llave por acción
    ('5b5b3000-0000-0000-0000-0000000000d2', v_ver, 'allow'), ('5b5b3000-0000-0000-0000-0000000000d2', v_cre, 'allow'), ('5b5b3000-0000-0000-0000-0000000000d2', v_edi, 'allow'),
    ('5b5b3000-0000-0000-0000-0000000000d2', v_apr, 'allow'), ('5b5b3000-0000-0000-0000-0000000000d2', v_est, 'allow'),
    -- revoca: ver/crear/editar + anular el pago
    ('5b5b3000-0000-0000-0000-0000000000d3', v_ver, 'allow'), ('5b5b3000-0000-0000-0000-0000000000d3', v_cre, 'allow'), ('5b5b3000-0000-0000-0000-0000000000d3', v_edi, 'allow'),
    ('5b5b3000-0000-0000-0000-0000000000d3', k_anu, 'allow');
  INSERT INTO public.user_roles (user_id, role_id) VALUES
    ('5b5b3000-0000-0000-0000-0000000000f2', '5b5b3000-0000-0000-0000-0000000000c2'),
    ('5b5b3000-0000-0000-0000-0000000000f3', '5b5b3000-0000-0000-0000-0000000000c3'),
    ('5b5b3000-0000-0000-0000-0000000000f4', '5b5b3000-0000-0000-0000-0000000000c4'),
    ('5b5b3000-0000-0000-0000-0000000000f5', '5b5b3000-0000-0000-0000-0000000000c5'),
    ('5b5b3000-0000-0000-0000-0000000000f6', '5b5b3000-0000-0000-0000-0000000000c6'),
    ('5b5b3000-0000-0000-0000-0000000000f7', '5b5b3000-0000-0000-0000-0000000000c7'),
    ('5b5b3000-0000-0000-0000-0000000000f8', '5b5b3000-0000-0000-0000-0000000000c8'),
    ('5b5b3000-0000-0000-0000-0000000000f9', '5b5b3000-0000-0000-0000-0000000000c9'),
    ('5b5b3000-0000-0000-0000-0000000000fa', '5b5b3000-0000-0000-0000-0000000000d1'),
    ('5b5b3000-0000-0000-0000-0000000000fb', '5b5b3000-0000-0000-0000-0000000000d2'),
    ('5b5b3000-0000-0000-0000-0000000000fc', '5b5b3000-0000-0000-0000-0000000000d3');

  -- Catálogo contable de la empresa y de CADA proyecto, y las cuentas del circuito de compras (puente «por facturar», etc.)
  PERFORM public.conta_seed_catalogo(c, NULL);
  PERFORM public.compras_seed_cuentas(c, NULL);
  PERFORM public.conta_seed_catalogo(c, pa);
  PERFORM public.compras_seed_cuentas(c, pa);
  PERFORM public.conta_seed_catalogo(c, pb);
  PERFORM public.compras_seed_cuentas(c, pb);
  -- El pago debe poder generar su asiento: mapeos de método de pago (transferencia), de cuentas por pagar, del puente de
  -- compras y de gasto, EN EL PROYECTO A (donde se opera). Si falta uno, el guion no probaría nada del asiento: se aborta.
  FOREACH k IN ARRAY ARRAY['metodo_transferencia', 'cxp_proveedores', 'compras_por_facturar'] LOOP
    IF NOT EXISTS (SELECT 1 FROM public.conta_mapeo_cuentas m WHERE m.company_id = c AND m.project_id = pa AND m.evento = k) THEN
      RAISE EXCEPTION 'ABORTA: falta el mapeo contable «%» del proyecto A; el pago/devengo no generaria asiento.', k;
    END IF;
  END LOOP;

  -- Proveedor AUTORIZADO (lo autoriza el administrador, como lo exige el servidor)
  INSERT INTO public.proveedores (id, company_id, nombre, nit, pais, alcance) VALUES (pv, c, 'ZZ UC Proveedor', '9999972-1', 'GT', 'empresa');
  PERFORM set_config('request.jwt.claim.sub', ua::text, true);
  SET LOCAL ROLE authenticated;
  UPDATE public.proveedores SET estado = 'autorizado' WHERE id = pv;
  RESET ROLE;
  PERFORM set_config('request.jwt.claim.sub', '', true);
  IF NOT EXISTS (SELECT 1 FROM public.proveedores WHERE id = pv AND estado = 'autorizado') THEN
    RAISE EXCEPTION 'ABORTA: el proveedor no quedo autorizado.';
  END IF;
END
$padron$;
