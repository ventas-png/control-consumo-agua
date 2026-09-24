\set ON_ERROR_STOP on

-- ============================================================================
-- EL PADRÓN
--
-- DOS empresas. Dentro de A, DOS proyectos con ledger propio (A1 con un
-- catálogo «normal», A2 con códigos deliberadamente raros para probar que
-- nada depende de códigos predeterminados) y el ledger de EMPRESA.
--
-- Usuarios de APLICACIÓN, no de base de datos:
--   admin A      rol legacy admin
--   contador A   rol operator + rol RBAC con platform.contabilidad.create/edit/delete
--   visor A      rol operator + rol RBAC SÓLO con platform.contabilidad.view
--   operador A   rol operator sin ningún permiso contable
--   admin B      admin de la OTRA empresa
--
-- `auth.uid()` sale del GUC `request.jwt.claim.sub`, como en bootstrap.sql.
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

-- Ejecuta `sql` y exige que FALLE con un mensaje que case `patron`. Que falle
-- no alcanza: tiene que fallar POR LO QUE SE ESPERA.
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

-- Cuenta filas AFECTADAS: con RLS, un UPDATE/DELETE sin permiso no falla,
-- afecta cero filas. Medirlo es la única forma de probarlo.
CREATE OR REPLACE FUNCTION public.filas_afectadas(sql text)
RETURNS bigint LANGUAGE plpgsql AS $$
DECLARE n bigint;
BEGIN
  EXECUTE sql;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END;
$$;

GRANT EXECUTE ON FUNCTION public.chk(bigint, bigint, text), public.chk_txt(text, text, text),
  public.chk_uuid(uuid, uuid, text), public.chk_falla(text, text, text),
  public.filas_afectadas(text) TO authenticated;

-- ── Empresas, proyectos, usuarios ───────────────────────────────────────────
INSERT INTO public.companies (id, nombre) VALUES
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'SINT-AUX Empresa A'),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'SINT-AUX Empresa B');

INSERT INTO public.projects (id, company_id, nombre) VALUES
  ('a1a1a1a1-0000-0000-0000-000000000001', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'SINT-AUX Proyecto A1'),
  ('a2a2a2a2-0000-0000-0000-000000000001', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'SINT-AUX Proyecto A2'),
  ('b1b1b1b1-0000-0000-0000-000000000001', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'SINT-AUX Proyecto B1');

INSERT INTO auth.users (id) VALUES
  ('a0a0a0a0-0000-0000-0000-00000000000a'),
  ('a0a0a0a0-0000-0000-0000-00000000000c'),
  ('a0a0a0a0-0000-0000-0000-00000000000d'),
  ('a0a0a0a0-0000-0000-0000-00000000000e'),
  ('b0b0b0b0-0000-0000-0000-00000000000b');

INSERT INTO public.app_users (id, company_id, full_name, role) VALUES
  ('a0a0a0a0-0000-0000-0000-00000000000a', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'SINT-AUX Admin A',    'admin'),
  ('a0a0a0a0-0000-0000-0000-00000000000c', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'SINT-AUX Contador A', 'operator'),
  ('a0a0a0a0-0000-0000-0000-00000000000d', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'SINT-AUX Operador A', 'operator'),
  ('a0a0a0a0-0000-0000-0000-00000000000e', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'SINT-AUX Visor A',    'operator'),
  ('b0b0b0b0-0000-0000-0000-00000000000b', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'SINT-AUX Admin B',    'admin');

-- El admin opera los proyectos de A como en la aplicación: con asignación.
-- Sin ella, las policies de unidad_residentes (has_admin_project_access) lo
-- dejan fuera, y eso es correcto.
INSERT INTO public.user_project_assignments (user_id, project_id, permission_type) VALUES
  ('a0a0a0a0-0000-0000-0000-00000000000a', 'a1a1a1a1-0000-0000-0000-000000000001', 'total'),
  ('a0a0a0a0-0000-0000-0000-00000000000a', 'a2a2a2a2-0000-0000-0000-000000000001', 'total');

-- RBAC: el contador escribe contabilidad por PERMISO, no por rol legacy; el
-- visor sólo la ve.
INSERT INTO public.roles (id, company_id, name) VALUES
  ('9a000000-0000-0000-0000-00000000000c', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'SINT-AUX Contador'),
  ('9a000000-0000-0000-0000-00000000000e', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'SINT-AUX Visor contable');

INSERT INTO public.role_permissions (role_id, permission_key, effect) VALUES
  ('9a000000-0000-0000-0000-00000000000c', 'platform.contabilidad.view',   'allow'),
  ('9a000000-0000-0000-0000-00000000000c', 'platform.contabilidad.create', 'allow'),
  ('9a000000-0000-0000-0000-00000000000c', 'platform.contabilidad.edit',   'allow'),
  ('9a000000-0000-0000-0000-00000000000c', 'platform.contabilidad.delete', 'allow'),
  ('9a000000-0000-0000-0000-00000000000e', 'platform.contabilidad.view',   'allow');

INSERT INTO public.user_roles (user_id, role_id) VALUES
  ('a0a0a0a0-0000-0000-0000-00000000000c', '9a000000-0000-0000-0000-00000000000c'),
  ('a0a0a0a0-0000-0000-0000-00000000000e', '9a000000-0000-0000-0000-00000000000e');

-- ── Cuentas ─────────────────────────────────────────────────────────────────
INSERT INTO public.conta_cuentas
  (id, company_id, project_id, codigo, nombre, tipo, naturaleza, nivel, es_detalle, activa) VALUES
  -- Ledger del proyecto A1
  ('11000000-0000-0000-0000-00000000a106', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'a1a1a1a1-0000-0000-0000-000000000001', '1',         'Activo (agrupadora)',      'activo',  'deudora',   1, false, true),
  ('11000000-0000-0000-0000-00000000a101', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'a1a1a1a1-0000-0000-0000-000000000001', '1-CXC-RES', 'CxC residentes',           'activo',  'deudora',   3, true,  true),
  ('11000000-0000-0000-0000-00000000a107', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'a1a1a1a1-0000-0000-0000-000000000001', 'CXC-OLD',   'CxC desactivada',          'activo',  'deudora',   3, true,  false),
  ('11000000-0000-0000-0000-00000000a102', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'a1a1a1a1-0000-0000-0000-000000000001', 'ING-MANT',  'Ingreso mantenimiento',    'ingreso', 'acreedora', 3, true,  true),
  ('11000000-0000-0000-0000-00000000a103', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'a1a1a1a1-0000-0000-0000-000000000001', 'ING-EXTRA', 'Ingreso extraordinario',   'ingreso', 'acreedora', 3, true,  true),
  ('11000000-0000-0000-0000-00000000a104', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'a1a1a1a1-0000-0000-0000-000000000001', 'ING-AGUA',  'Ingreso agua',             'ingreso', 'acreedora', 3, true,  true),
  ('11000000-0000-0000-0000-00000000a105', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'a1a1a1a1-0000-0000-0000-000000000001', 'IVA-X',     'IVA por pagar',            'pasivo',  'acreedora', 3, true,  true),
  ('11000000-0000-0000-0000-00000000a108', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'a1a1a1a1-0000-0000-0000-000000000001', 'GTO',       'Un gasto',                 'gasto',   'deudora',   3, true,  true),
  -- Ledger de EMPRESA de A
  ('11000000-0000-0000-0000-00000000a001', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', NULL,                                   '1-CXC-RES', 'CxC residentes (empresa)', 'activo',  'deudora',   3, true,  true),
  -- Ledger del proyecto A2: códigos que ningún catálogo predeterminado usa.
  ('11000000-0000-0000-0000-00000000a201', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'a2a2a2a2-0000-0000-0000-000000000001', 'Z-COBRAR',  'Por cobrar a vecinos',     'activo',  'deudora',   2, true,  true),
  ('11000000-0000-0000-0000-00000000a202', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'a2a2a2a2-0000-0000-0000-000000000001', 'Z-VENTAS',  'Ventas de servicios',      'ingreso', 'acreedora', 2, true,  true),
  -- Ledger del proyecto B1
  ('11000000-0000-0000-0000-00000000b101', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'b1b1b1b1-0000-0000-0000-000000000001', '1-CXC-RES', 'CxC residentes (B)',       'activo',  'deudora',   3, true,  true),
  ('11000000-0000-0000-0000-00000000b102', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'b1b1b1b1-0000-0000-0000-000000000001', 'ING-MANT',  'Ingreso mantenimiento (B)','ingreso', 'acreedora', 3, true,  true);

-- ── Clientes y su pertenencia a cada empresa ────────────────────────────────
INSERT INTO public.clientes (id, project_id, nombre, codigo) VALUES
  ('e0000000-0000-0000-0000-00000000a001', 'a1a1a1a1-0000-0000-0000-000000000001', 'SINT-AUX Cliente Uno',  'SINT-AUX-C1'),
  ('e0000000-0000-0000-0000-00000000a002', 'a1a1a1a1-0000-0000-0000-000000000001', 'SINT-AUX Cliente Dos',  'SINT-AUX-C2'),
  ('e0000000-0000-0000-0000-00000000a003', 'a1a1a1a1-0000-0000-0000-000000000001', 'SINT-AUX Cliente Tres', 'SINT-AUX-C3'),
  ('e0000000-0000-0000-0000-00000000b001', 'b1b1b1b1-0000-0000-0000-000000000001', 'SINT-AUX Cliente B',    'SINT-AUX-CB');

INSERT INTO public.company_clientes (company_id, cliente_id) VALUES
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'e0000000-0000-0000-0000-00000000a001'),
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'e0000000-0000-0000-0000-00000000a002'),
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'e0000000-0000-0000-0000-00000000a003'),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'e0000000-0000-0000-0000-00000000b001');

-- ── Unidades ────────────────────────────────────────────────────────────────
INSERT INTO public.unidades (id, company_id, project_id, nombre) VALUES
  ('f0000000-0000-0000-0000-00000000a001', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'a1a1a1a1-0000-0000-0000-000000000001', 'SINT-AUX Apto 101'),
  ('f0000000-0000-0000-0000-00000000a002', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'a1a1a1a1-0000-0000-0000-000000000001', 'SINT-AUX Apto 102'),
  ('f0000000-0000-0000-0000-00000000a201', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'a2a2a2a2-0000-0000-0000-000000000001', 'SINT-AUX Local 1'),
  ('f0000000-0000-0000-0000-00000000b001', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'b1b1b1b1-0000-0000-0000-000000000001', 'SINT-AUX Apto B');
