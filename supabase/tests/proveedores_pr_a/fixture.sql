\set ON_ERROR_STOP on

-- ============================================================================
-- EL PADRÓN DEL PR A (proveedores · contratos · reglas de compra · carga masiva)
--
-- DOS empresas; la A con TRES contabilidades relevantes (empresa, proyecto A1
-- y proyecto A2) para poder probar que nada se cruza. Perfiles de usuario, uno
-- por cada frontera que el PR tiene que respetar:
--
--   UA  admin de A, asignado a A1 y A2          → todo, en A1 y A2
--   UP1 admin de A, asignado SOLO a A1          → no ve nada de A2
--   UP2 admin de A, asignado SOLO a A2          → no ve nada de A1
--   UC  contador de A (permiso contable view/create/edit/delete, SIN
--       change_status) + pestaña Proveedores, en A1 y A2
--   UCS contador con change_status también
--   UO  operador de A con SOLO la pestaña operativa Proveedores (contratos);
--       sin permiso contable → «consulta operativa»
--   UN  operador de A sin ningún permiso
--   UB  admin de B (otra empresa)
--
-- `auth.uid()` sale del GUC `request.jwt.claim.sub` (bootstrap.sql).
-- ============================================================================

CREATE OR REPLACE FUNCTION public.chk(actual bigint, esperado bigint, msg text)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF actual IS DISTINCT FROM esperado THEN
    RAISE EXCEPTION '% — esperado %, recibido %', msg, esperado, actual;
  END IF;
  RAISE NOTICE '✓ %', msg;
END;
$$;

CREATE OR REPLACE FUNCTION public.chk_txt(actual text, esperado text, msg text)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF actual IS DISTINCT FROM esperado THEN
    RAISE EXCEPTION '% — esperado «%», recibido «%»', msg, esperado, actual;
  END IF;
  RAISE NOTICE '✓ %', msg;
END;
$$;

CREATE OR REPLACE FUNCTION public.chk_uuid(actual uuid, esperado uuid, msg text)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF actual IS DISTINCT FROM esperado THEN
    RAISE EXCEPTION '% — esperado %, recibido %', msg, esperado, actual;
  END IF;
  RAISE NOTICE '✓ %', msg;
END;
$$;

CREATE OR REPLACE FUNCTION public.chk_bool(actual boolean, esperado boolean, msg text)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF actual IS DISTINCT FROM esperado THEN
    RAISE EXCEPTION '% — esperado %, recibido %', msg, esperado, actual;
  END IF;
  RAISE NOTICE '✓ %', msg;
END;
$$;

-- Exige que `sql` FALLE y que falle POR LO ESPERADO: un rechazo por el motivo
-- equivocado es un falso verde.
CREATE OR REPLACE FUNCTION public.chk_falla(sql text, patron text, msg text)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  BEGIN
    EXECUTE sql;
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM ~ patron THEN
      RAISE NOTICE '✓ % (%)', msg, left(SQLERRM, 70);
      RETURN;
    END IF;
    RAISE EXCEPTION '% — falló, pero por otra cosa: %', msg, SQLERRM;
  END;
  RAISE EXCEPTION '% — NO falló, y tenía que fallar', msg;
END;
$$;

-- Cambia la sesión a un usuario (y, opcionalmente, al rol `authenticated`).
CREATE OR REPLACE FUNCTION public.como(p_uid uuid)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('request.jwt.claim.sub', p_uid::text, false);
END;
$$;

-- ── Empresas, proyectos, usuarios ───────────────────────────────────────────
INSERT INTO public.companies (id, nombre) VALUES
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Empresa A'),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'Empresa B');

INSERT INTO public.projects (id, company_id, nombre) VALUES
  ('a1a1a1a1-0000-0000-0000-000000000001', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Proyecto A1'),
  ('a2a2a2a2-0000-0000-0000-000000000001', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Proyecto A2'),
  ('b1b1b1b1-0000-0000-0000-000000000001', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'Proyecto B1');

INSERT INTO auth.users (id) VALUES
  ('a0a0a0a0-0000-0000-0000-00000000000a'),
  ('a0a0a0a0-0000-0000-0000-00000000000f'),
  ('a0a0a0a0-0000-0000-0000-000000000012'),
  ('a0a0a0a0-0000-0000-0000-00000000000c'),
  ('a0a0a0a0-0000-0000-0000-000000000013'),
  ('a0a0a0a0-0000-0000-0000-00000000000d'),
  ('a0a0a0a0-0000-0000-0000-00000000000e'),
  ('b0b0b0b0-0000-0000-0000-00000000000b');

INSERT INTO public.app_users (id, company_id, full_name, role) VALUES
  ('a0a0a0a0-0000-0000-0000-00000000000a', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'PRV Admin A',        'admin'),
  ('a0a0a0a0-0000-0000-0000-00000000000f', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'PRV Admin A (solo A1)', 'admin'),
  ('a0a0a0a0-0000-0000-0000-000000000012', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'PRV Admin A (solo A2)', 'admin'),
  ('a0a0a0a0-0000-0000-0000-00000000000c', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'PRV Contador A',     'operator'),
  ('a0a0a0a0-0000-0000-0000-000000000013', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'PRV Contador A (cambia estado)', 'operator'),
  ('a0a0a0a0-0000-0000-0000-00000000000d', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'PRV Operador A (solo contratos)', 'operator'),
  ('a0a0a0a0-0000-0000-0000-00000000000e', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'PRV Operador A (nada)', 'operator'),
  ('b0b0b0b0-0000-0000-0000-00000000000b', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'PRV Admin B',        'admin');

INSERT INTO public.user_project_assignments (user_id, project_id, permission_type) VALUES
  ('a0a0a0a0-0000-0000-0000-00000000000a', 'a1a1a1a1-0000-0000-0000-000000000001', 'total'),
  ('a0a0a0a0-0000-0000-0000-00000000000a', 'a2a2a2a2-0000-0000-0000-000000000001', 'total'),
  ('a0a0a0a0-0000-0000-0000-00000000000f', 'a1a1a1a1-0000-0000-0000-000000000001', 'total'),
  ('a0a0a0a0-0000-0000-0000-000000000012', 'a2a2a2a2-0000-0000-0000-000000000001', 'total'),
  ('a0a0a0a0-0000-0000-0000-00000000000c', 'a1a1a1a1-0000-0000-0000-000000000001', 'total'),
  ('a0a0a0a0-0000-0000-0000-00000000000c', 'a2a2a2a2-0000-0000-0000-000000000001', 'total'),
  ('a0a0a0a0-0000-0000-0000-000000000013', 'a1a1a1a1-0000-0000-0000-000000000001', 'total'),
  ('a0a0a0a0-0000-0000-0000-000000000013', 'a2a2a2a2-0000-0000-0000-000000000001', 'total'),
  ('a0a0a0a0-0000-0000-0000-00000000000d', 'a1a1a1a1-0000-0000-0000-000000000001', 'total'),
  ('a0a0a0a0-0000-0000-0000-00000000000e', 'a1a1a1a1-0000-0000-0000-000000000001', 'total'),
  ('b0b0b0b0-0000-0000-0000-00000000000b', 'b1b1b1b1-0000-0000-0000-000000000001', 'total');

-- ── RBAC ────────────────────────────────────────────────────────────────────
INSERT INTO public.roles (id, company_id, name) VALUES
  ('9a000000-0000-0000-0000-00000000000c', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'PRV Contador'),
  ('9a000000-0000-0000-0000-000000000013', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'PRV Contador con estado'),
  ('9a000000-0000-0000-0000-00000000000d', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'PRV Operador contratos');

INSERT INTO public.role_permissions (role_id, permission_key, effect) VALUES
  ('9a000000-0000-0000-0000-00000000000c', 'platform.contabilidad.view',   'allow'),
  ('9a000000-0000-0000-0000-00000000000c', 'platform.contabilidad.create', 'allow'),
  ('9a000000-0000-0000-0000-00000000000c', 'platform.contabilidad.edit',   'allow'),
  ('9a000000-0000-0000-0000-00000000000c', 'platform.contabilidad.delete', 'allow'),
  ('9a000000-0000-0000-0000-00000000000c', 'condominios.tab.proveedores',  'allow'),
  ('9a000000-0000-0000-0000-000000000013', 'platform.contabilidad.view',   'allow'),
  ('9a000000-0000-0000-0000-000000000013', 'platform.contabilidad.create', 'allow'),
  ('9a000000-0000-0000-0000-000000000013', 'platform.contabilidad.edit',   'allow'),
  ('9a000000-0000-0000-0000-000000000013', 'platform.contabilidad.delete', 'allow'),
  ('9a000000-0000-0000-0000-000000000013', 'platform.contabilidad.change_status', 'allow'),
  ('9a000000-0000-0000-0000-000000000013', 'condominios.tab.proveedores',  'allow'),
  ('9a000000-0000-0000-0000-00000000000d', 'condominios.tab.proveedores',  'allow');

INSERT INTO public.user_roles (user_id, role_id) VALUES
  ('a0a0a0a0-0000-0000-0000-00000000000c', '9a000000-0000-0000-0000-00000000000c'),
  ('a0a0a0a0-0000-0000-0000-000000000013', '9a000000-0000-0000-0000-000000000013'),
  ('a0a0a0a0-0000-0000-0000-00000000000d', '9a000000-0000-0000-0000-00000000000d');

-- ── Cuentas por ledger ──────────────────────────────────────────────────────
INSERT INTO public.conta_cuentas
  (id, company_id, project_id, codigo, nombre, tipo, naturaleza, nivel, es_detalle, activa) VALUES
  -- Ledger del proyecto A1
  ('c1000000-0000-0000-0000-00000000a101', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'a1a1a1a1-0000-0000-0000-000000000001', '5101',   'Gasto general A1',        'gasto',   'deudora',   3, true,  true),
  ('c1000000-0000-0000-0000-00000000a102', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'a1a1a1a1-0000-0000-0000-000000000001', '5201',   'Gasto limpieza A1',       'gasto',   'deudora',   3, true,  true),
  ('c1000000-0000-0000-0000-00000000a103', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'a1a1a1a1-0000-0000-0000-000000000001', '5301',   'Gasto mantenimiento A1',  'gasto',   'deudora',   3, true,  true),
  ('c1000000-0000-0000-0000-00000000a104', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'a1a1a1a1-0000-0000-0000-000000000001', '1106',   'Inventario A1',           'activo',  'deudora',   3, true,  true),
  ('c1000000-0000-0000-0000-00000000a105', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'a1a1a1a1-0000-0000-0000-000000000001', '1107',   'Inventario herramientas A1','activo', 'deudora',   3, true,  true),
  ('c1000000-0000-0000-0000-00000000a106', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'a1a1a1a1-0000-0000-0000-000000000001', '1401',   'Activo fijo A1',          'activo',  'deudora',   3, true,  true),
  ('c1000000-0000-0000-0000-00000000a107', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'a1a1a1a1-0000-0000-0000-000000000001', '5999',   'Gasto desactivado A1',    'gasto',   'deudora',   3, true,  false),
  ('c1000000-0000-0000-0000-00000000a108', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'a1a1a1a1-0000-0000-0000-000000000001', '5',      'Gastos (agrupadora) A1',  'gasto',   'deudora',   1, false, true),
  ('c1000000-0000-0000-0000-00000000a109', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'a1a1a1a1-0000-0000-0000-000000000001', '4101',   'Ingreso A1',              'ingreso', 'acreedora', 3, true,  true),
  ('c1000000-0000-0000-0000-00000000a110', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'a1a1a1a1-0000-0000-0000-000000000001', '2101',   'Cuentas por pagar A1',    'pasivo',  'acreedora', 3, true,  true),
  ('c1000000-0000-0000-0000-00000000a111', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'a1a1a1a1-0000-0000-0000-000000000001', '5401',   'Gasto nuevo A1',          'gasto',   'deudora',   3, true,  true),
  -- Ledger del proyecto A2
  ('c1000000-0000-0000-0000-00000000a201', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'a2a2a2a2-0000-0000-0000-000000000001', '5101',   'Gasto general A2',        'gasto',   'deudora',   3, true,  true),
  ('c1000000-0000-0000-0000-00000000a202', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'a2a2a2a2-0000-0000-0000-000000000001', '5201',   'Gasto limpieza A2',       'gasto',   'deudora',   3, true,  true),
  -- Ledger de EMPRESA de A
  ('c1000000-0000-0000-0000-00000000c001', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', NULL, '5101', 'Gasto general (empresa)', 'gasto',  'deudora',   3, true,  true),
  ('c1000000-0000-0000-0000-00000000c002', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', NULL, '2101', 'Cuentas por pagar (empresa)', 'pasivo', 'acreedora', 3, true, true),
  -- Empresa B
  ('c1000000-0000-0000-0000-00000000b001', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', NULL, '5101', 'Gasto general (B)',      'gasto',   'deudora',   3, true,  true);

-- Mapeos de evento: A1 resuelve gasto, inventario y CxP; el ledger de empresa,
-- gasto y CxP; A2 NO tiene ninguno (configuración incompleta a propósito).
INSERT INTO public.conta_mapeo_cuentas (company_id, project_id, evento, cuenta_id) VALUES
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'a1a1a1a1-0000-0000-0000-000000000001', 'gasto_otros',     'c1000000-0000-0000-0000-00000000a101'),
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'a1a1a1a1-0000-0000-0000-000000000001', 'inventario',      'c1000000-0000-0000-0000-00000000a104'),
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'a1a1a1a1-0000-0000-0000-000000000001', 'cxp_proveedores', 'c1000000-0000-0000-0000-00000000a110'),
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', NULL,                                   'gasto_otros',     'c1000000-0000-0000-0000-00000000c001'),
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', NULL,                                   'cxp_proveedores', 'c1000000-0000-0000-0000-00000000c002');

-- ── Productos (suministros) ─────────────────────────────────────────────────
INSERT INTO public.suministros_condominio (id, company_id, project_id, nombre) VALUES
  ('50000000-0000-0000-0000-0000000000a1', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'a1a1a1a1-0000-0000-0000-000000000001', 'Cloro industrial A1'),
  ('50000000-0000-0000-0000-0000000000a2', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'a2a2a2a2-0000-0000-0000-000000000001', 'Cloro industrial A2');
