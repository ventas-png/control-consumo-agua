\set ON_ERROR_STOP on

-- ============================================================================
-- PADRÓN DEL BLOQUE B (compras · recepción · factura · seguimiento)
--
-- DOS empresas. La C con TRES contabilidades (empresa, proyecto C1 y proyecto
-- C2), todas con el catálogo y los mapeos sembrados por las funciones reales
-- (conta_seed_catalogo + compras_seed_cuentas). La D, para probar que nada se
-- cruza. Perfiles:
--
--   UA  admin de C (C1 y C2)          → todo
--   UB  admin de C (C1 y C2)          → segundo aprobador (separación)
--   UC  contador de C                 → ve y escribe Contabilidad
--   UO  operador de C, SIN permiso contable → solicita y recibe, no ve facturación
--   UN  operador de C sin permisos
--   UD  admin de D
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


CREATE OR REPLACE FUNCTION public.chk_num(actual numeric, esperado numeric, msg text)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF actual IS DISTINCT FROM esperado THEN
    RAISE EXCEPTION '% — esperado %, recibido %', msg, esperado, actual;
  END IF;
  RAISE NOTICE '✓ %', msg;
END;
$$;

-- ── Empresas, proyectos, usuarios ───────────────────────────────────────────
INSERT INTO public.companies (id, nombre, default_currency) VALUES
  ('cccccccc-cccc-cccc-cccc-cccccccccccc', 'Empresa C', 'gtq'),
  ('dddddddd-dddd-dddd-dddd-dddddddddddd', 'Empresa D', 'gtq');
INSERT INTO public.projects (id, company_id, nombre) VALUES
  ('c1c1c1c1-0000-0000-0000-000000000001', 'cccccccc-cccc-cccc-cccc-cccccccccccc', 'Proyecto C1'),
  ('c2c2c2c2-0000-0000-0000-000000000001', 'cccccccc-cccc-cccc-cccc-cccccccccccc', 'Proyecto C2'),
  ('d1d1d1d1-0000-0000-0000-000000000001', 'dddddddd-dddd-dddd-dddd-dddddddddddd', 'Proyecto D1');

INSERT INTO auth.users (id) VALUES
  ('c0c0c0c0-0000-0000-0000-00000000000a'), ('c0c0c0c0-0000-0000-0000-00000000000b'),
  ('c0c0c0c0-0000-0000-0000-00000000000c'), ('c0c0c0c0-0000-0000-0000-00000000000d'),
  ('c0c0c0c0-0000-0000-0000-00000000000e'), ('d0d0d0d0-0000-0000-0000-00000000000d');
INSERT INTO public.app_users (id, company_id, full_name, role) VALUES
  ('c0c0c0c0-0000-0000-0000-00000000000a', 'cccccccc-cccc-cccc-cccc-cccccccccccc', 'BB Admin C',      'admin'),
  ('c0c0c0c0-0000-0000-0000-00000000000b', 'cccccccc-cccc-cccc-cccc-cccccccccccc', 'BB Admin C (2)',  'admin'),
  ('c0c0c0c0-0000-0000-0000-00000000000c', 'cccccccc-cccc-cccc-cccc-cccccccccccc', 'BB Contador C',   'operator'),
  ('c0c0c0c0-0000-0000-0000-00000000000d', 'cccccccc-cccc-cccc-cccc-cccccccccccc', 'BB Operador C',   'operator'),
  ('c0c0c0c0-0000-0000-0000-00000000000e', 'cccccccc-cccc-cccc-cccc-cccccccccccc', 'BB Operador C (sin permisos)', 'operator'),
  ('d0d0d0d0-0000-0000-0000-00000000000d', 'dddddddd-dddd-dddd-dddd-dddddddddddd', 'BB Admin D',      'admin');
INSERT INTO public.user_project_assignments (user_id, project_id, permission_type)
SELECT u, p, 'total'
  FROM unnest(ARRAY['c0c0c0c0-0000-0000-0000-00000000000a','c0c0c0c0-0000-0000-0000-00000000000b',
                    'c0c0c0c0-0000-0000-0000-00000000000c','c0c0c0c0-0000-0000-0000-00000000000d',
                    'c0c0c0c0-0000-0000-0000-00000000000e']::uuid[]) u,
       unnest(ARRAY['c1c1c1c1-0000-0000-0000-000000000001','c2c2c2c2-0000-0000-0000-000000000001']::uuid[]) p;
INSERT INTO public.user_project_assignments (user_id, project_id, permission_type)
VALUES ('d0d0d0d0-0000-0000-0000-00000000000d', 'd1d1d1d1-0000-0000-0000-000000000001', 'total');

INSERT INTO public.roles (id, company_id, name) VALUES
  ('9b000000-0000-0000-0000-00000000000c', 'cccccccc-cccc-cccc-cccc-cccccccccccc', 'BB Contador'),
  ('9b000000-0000-0000-0000-00000000000d', 'cccccccc-cccc-cccc-cccc-cccccccccccc', 'BB Operador compras');
INSERT INTO public.role_permissions (role_id, permission_key, effect) VALUES
  ('9b000000-0000-0000-0000-00000000000c', 'platform.contabilidad.view',   'allow'),
  ('9b000000-0000-0000-0000-00000000000c', 'platform.contabilidad.create', 'allow'),
  ('9b000000-0000-0000-0000-00000000000c', 'platform.contabilidad.edit',   'allow'),
  ('9b000000-0000-0000-0000-00000000000c', 'platform.contabilidad.delete', 'allow'),
  ('9b000000-0000-0000-0000-00000000000d', 'condominios.tab.ordenes_compra', 'allow'),
  ('9b000000-0000-0000-0000-00000000000d', 'condominios.tab.suministros',    'allow'),
  ('9b000000-0000-0000-0000-00000000000d', 'condominios.tab.proformas',      'allow');
INSERT INTO public.user_roles (user_id, role_id) VALUES
  ('c0c0c0c0-0000-0000-0000-00000000000c', '9b000000-0000-0000-0000-00000000000c'),
  ('c0c0c0c0-0000-0000-0000-00000000000d', '9b000000-0000-0000-0000-00000000000d');

-- ── Catálogos contables SEMBRADOS por las funciones reales ──────────────────
SELECT public.conta_seed_catalogo('cccccccc-cccc-cccc-cccc-cccccccccccc', NULL);
SELECT public.compras_seed_cuentas('cccccccc-cccc-cccc-cccc-cccccccccccc', NULL);
SELECT public.conta_seed_catalogo('cccccccc-cccc-cccc-cccc-cccccccccccc', 'c1c1c1c1-0000-0000-0000-000000000001');
SELECT public.compras_seed_cuentas('cccccccc-cccc-cccc-cccc-cccccccccccc', 'c1c1c1c1-0000-0000-0000-000000000001');
SELECT public.conta_seed_catalogo('cccccccc-cccc-cccc-cccc-cccccccccccc', 'c2c2c2c2-0000-0000-0000-000000000001');
SELECT public.compras_seed_cuentas('cccccccc-cccc-cccc-cccc-cccccccccccc', 'c2c2c2c2-0000-0000-0000-000000000001');
SELECT public.conta_seed_catalogo('dddddddd-dddd-dddd-dddd-dddddddddddd', 'd1d1d1d1-0000-0000-0000-000000000001');
SELECT public.compras_seed_cuentas('dddddddd-dddd-dddd-dddd-dddddddddddd', 'd1d1d1d1-0000-0000-0000-000000000001');

-- ── Proveedores del catálogo (por las vías normales: admin autoriza) ────────
INSERT INTO public.proveedores (id, company_id, nombre, nit, pais, alcance) VALUES
  ('e3000000-0000-0000-0000-000000000001', 'cccccccc-cccc-cccc-cccc-cccccccccccc', 'Ferretería Bloque B', '8100001-1', 'GT', 'empresa'),
  ('e3000000-0000-0000-0000-000000000002', 'cccccccc-cccc-cccc-cccc-cccccccccccc', 'Servicios Bloque B',   '8100002-2', 'GT', 'empresa'),
  ('e3000000-0000-0000-0000-000000000003', 'cccccccc-cccc-cccc-cccc-cccccccccccc', 'Proveedor a suspender','8100003-3', 'GT', 'empresa'),
  ('e3000000-0000-0000-0000-0000000000d1', 'dddddddd-dddd-dddd-dddd-dddddddddddd', 'Proveedor de D',       '8100009-9', 'GT', 'empresa');
SELECT public.como('c0c0c0c0-0000-0000-0000-00000000000a'::uuid);
SET ROLE authenticated;
UPDATE public.proveedores SET estado = 'autorizado'
 WHERE id IN ('e3000000-0000-0000-0000-000000000001', 'e3000000-0000-0000-0000-000000000002', 'e3000000-0000-0000-0000-000000000003');
RESET ROLE;
SELECT public.como('d0d0d0d0-0000-0000-0000-00000000000d'::uuid);
SET ROLE authenticated;
UPDATE public.proveedores SET estado = 'autorizado' WHERE id = 'e3000000-0000-0000-0000-0000000000d1';
RESET ROLE;

-- ── Productos (suministros) de C1 ───────────────────────────────────────────
INSERT INTO public.suministros_condominio (id, company_id, project_id, nombre, unidad_medida) VALUES
  ('50000000-0000-0000-0000-0000000000c1', 'cccccccc-cccc-cccc-cccc-cccccccccccc', 'c1c1c1c1-0000-0000-0000-000000000001', 'Cloro industrial', 'litro');

-- ── Tipo de cambio MENSUAL (decisión #904): USD del mes en curso ────────────
INSERT INTO public.conta_tipos_cambio_mensual (company_id, moneda, moneda_base, periodo, tasa)
VALUES ('cccccccc-cccc-cccc-cccc-cccccccccccc', 'USD', 'GTQ',
        extract(year from CURRENT_DATE)::text || '-' || lpad(extract(month from CURRENT_DATE)::text, 2, '0'), 7.750000);
