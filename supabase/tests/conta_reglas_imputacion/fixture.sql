\set ON_ERROR_STOP on

-- ============================================================================
-- EL PADRÓN
--
-- DOS empresas, y la diferencia entre sus datos es el punto de la prueba de
-- aislamiento. Dentro de la empresa A, DOS ledgers —el de empresa
-- (project_id NULL) y el del proyecto— porque mezclarlos es el otro fallo que
-- este arnés tiene que poder detectar.
--
-- `auth.uid()` sale del GUC `request.jwt.claim.sub`, que es lo que ya hace
-- bootstrap.sql. No se redefine nada: se usa la cadena real.
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
      RAISE NOTICE '✓ % (%)', msg, left(SQLERRM, 60);
      RETURN;
    END IF;
    RAISE EXCEPTION '% — falló, pero por otra cosa: %', msg, SQLERRM;
  END;
  RAISE EXCEPTION '% — NO falló, y tenía que fallar', msg;
END;
$$;

-- ── Empresas, proyectos, usuarios ───────────────────────────────────────────
INSERT INTO public.companies (id, nombre) VALUES
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Empresa A'),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'Empresa B');

INSERT INTO public.projects (id, company_id, nombre) VALUES
  ('a1a1a1a1-0000-0000-0000-000000000001', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Proyecto A1'),
  ('b1b1b1b1-0000-0000-0000-000000000001', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'Proyecto B1');

INSERT INTO auth.users (id) VALUES
  ('a0a0a0a0-0000-0000-0000-00000000000a'),
  ('b0b0b0b0-0000-0000-0000-00000000000b');

INSERT INTO public.app_users (id, company_id, full_name, role) VALUES
  ('a0a0a0a0-0000-0000-0000-00000000000a', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Admin A', 'admin'),
  ('b0b0b0b0-0000-0000-0000-00000000000b', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'Admin B', 'admin');

-- ── Cuentas: empresa A tiene DOS ledgers ────────────────────────────────────
-- Las de nivel 1 son agrupadoras (es_detalle = false) a propósito: una de
-- ellas se usa para probar que una regla no puede apuntar a una agrupadora.
INSERT INTO public.conta_cuentas
  (id, company_id, project_id, codigo, nombre, tipo, naturaleza, nivel, es_detalle, activa) VALUES
  -- Ledger de EMPRESA de A
  ('c0000000-0000-0000-0000-00000000a001', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', NULL, '5',    'Gastos (agrupadora)', 'gasto', 'deudora', 1, false, true),
  ('c0000000-0000-0000-0000-00000000a002', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', NULL, '5101', 'Gasto general',       'gasto', 'deudora', 3, true,  true),
  ('c0000000-0000-0000-0000-00000000a003', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', NULL, '5102', 'Gasto proveedor X',   'gasto', 'deudora', 3, true,  true),
  ('c0000000-0000-0000-0000-00000000a004', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', NULL, '5103', 'Gasto desactivado',   'gasto', 'deudora', 3, true,  false),
  ('c0000000-0000-0000-0000-00000000a005', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', NULL, '5104', 'Cargo unidad',        'gasto', 'deudora', 3, true,  true),
  ('c0000000-0000-0000-0000-00000000a006', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', NULL, '5105', 'Cargo cliente',       'gasto', 'deudora', 3, true,  true),
  ('c0000000-0000-0000-0000-00000000a007', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', NULL, '5106', 'Cargo categoria',     'gasto', 'deudora', 3, true,  true),
  -- Ledger del PROYECTO A1: mismo código, otro ledger. Legal por el índice
  -- único por ledger, y necesario para probar que no se cruzan.
  ('c0000000-0000-0000-0000-00000000a101', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'a1a1a1a1-0000-0000-0000-000000000001', '5101', 'Gasto general (proyecto)', 'gasto', 'deudora', 3, true, true),
  -- La contrapartida: sin una cuenta de CxP mapeada, `conta_generar_asiento`
  -- omite el asiento entero y el recorrido documento → asiento no se puede
  -- medir. Es pasivo, acreedora, de detalle.
  ('c0000000-0000-0000-0000-00000000a008', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', NULL, '2101', 'Cuentas por pagar', 'pasivo', 'acreedora', 3, true, true),
  -- Empresa B
  ('c0000000-0000-0000-0000-00000000b001', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', NULL, '5101', 'Gasto general (B)', 'gasto', 'deudora', 3, true, true);

-- ── Proveedores, clientes, unidades ─────────────────────────────────────────
INSERT INTO public.proveedores (id, company_id, nombre) VALUES
  ('d0000000-0000-0000-0000-00000000a001', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Proveedor A'),
  ('d0000000-0000-0000-0000-00000000b001', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'Proveedor B');

INSERT INTO public.clientes (id, project_id, nombre, codigo) VALUES
  ('e0000000-0000-0000-0000-00000000a001', NULL, 'Cliente A', 'CLI-A-001');

INSERT INTO public.unidades (id, company_id, project_id, nombre) VALUES
  ('f0000000-0000-0000-0000-00000000a001', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'a1a1a1a1-0000-0000-0000-000000000001', 'Apto 101');

-- ── Mapeo general del evento, que es el escalón 4 ───────────────────────────
INSERT INTO public.conta_mapeo_cuentas (company_id, project_id, evento, cuenta_id) VALUES
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', NULL, 'gasto_otros',      'c0000000-0000-0000-0000-00000000a002'),
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', NULL, 'cxp_proveedores',  'c0000000-0000-0000-0000-00000000a008');

-- ── Documentos reales ───────────────────────────────────────────────────────
-- La bitácora exige que el documento EXISTA y sea de la empresa y el ledger
-- declarados, así que las pruebas de trazabilidad no pueden inventar UUIDs.
-- Nacen en `registrada`: el trigger contable es AFTER UPDATE OF estado, así
-- que cargarlas acá no dispara ningún asiento.
INSERT INTO public.facturas_proveedor
  (id, company_id, project_id, proveedor_id, concepto, categoria, monto_total, moneda, estado) VALUES
  ('aaaa0000-0000-0000-0000-000000000001', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', NULL,
   'd0000000-0000-0000-0000-00000000a001', 'Documento de trazabilidad 1', 'otros', 100, 'USD', 'registrada'),
  ('aaaa0000-0000-0000-0000-000000000002', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', NULL,
   'd0000000-0000-0000-0000-00000000a001', 'Documento de trazabilidad 2', 'otros', 100, 'USD', 'registrada'),
  ('aaaa0000-0000-0000-0000-000000000003', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', NULL,
   'd0000000-0000-0000-0000-00000000a001', 'Documento de trazabilidad 3', 'otros', 100, 'USD', 'registrada');
