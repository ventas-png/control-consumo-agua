\set ON_ERROR_STOP on

-- ============================================================================
-- EL PADRÓN
--
-- Empresa A con DOS contabilidades (la de empresa y la del proyecto A1) y un
-- segundo proyecto A2; empresa B aparte. Cinco usuarios, uno por cada
-- frontera que el reproceso y la bandeja tienen que respetar:
--
--   UA  admin de A, sin asignaciones → ve todos los proyectos de A
--   UB  admin de B                   → otra empresa
--   UV  operador de A con SÓLO platform.contabilidad.view
--   UN  operador de A sin ningún permiso contable
--   UP  admin de A ASIGNADO sólo a A2 → no ve A1
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

CREATE OR REPLACE FUNCTION public.chk_num(actual numeric, esperado numeric, msg text)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF actual IS DISTINCT FROM esperado THEN
    RAISE EXCEPTION '% — esperado %, recibido %', msg, esperado, actual;
  END IF;
  RAISE NOTICE '✓ %', msg;
END;
$$;

-- Exige que `sql` FALLE y que falle por lo esperado: un rechazo por el motivo
-- equivocado es un falso verde.
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

GRANT EXECUTE ON FUNCTION public.chk(bigint, bigint, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.chk_txt(text, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.chk_num(numeric, numeric, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.chk_falla(text, text, text) TO authenticated;

-- ── Empresas, proyectos, usuarios ───────────────────────────────────────────
INSERT INTO public.companies (id, nombre) VALUES
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Empresa A'),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'Empresa B');

INSERT INTO public.projects (id, company_id, nombre) VALUES
  ('a1a1a1a1-0000-0000-0000-000000000001', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Proyecto A1'),
  ('a2a2a2a2-0000-0000-0000-000000000002', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Proyecto A2'),
  ('b1b1b1b1-0000-0000-0000-000000000001', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'Proyecto B1');

INSERT INTO auth.users (id) VALUES
  ('a0a0a0a0-0000-0000-0000-00000000000a'),
  ('b0b0b0b0-0000-0000-0000-00000000000b'),
  ('a0a0a0a0-0000-0000-0000-0000000000f1'),
  ('a0a0a0a0-0000-0000-0000-0000000000f2'),
  ('a0a0a0a0-0000-0000-0000-0000000000f3');

INSERT INTO public.app_users (id, company_id, full_name, role) VALUES
  ('a0a0a0a0-0000-0000-0000-00000000000a', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Admin A',       'admin'),
  ('b0b0b0b0-0000-0000-0000-00000000000b', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'Admin B',       'admin'),
  ('a0a0a0a0-0000-0000-0000-0000000000f1', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Solo lectura',  'operator'),
  ('a0a0a0a0-0000-0000-0000-0000000000f2', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Sin permiso',   'operator'),
  ('a0a0a0a0-0000-0000-0000-0000000000f3', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Admin de A2',   'admin');

-- UP: admin CON asignación explícita deja de ser exento (user_is_project_exempt).
INSERT INTO public.user_project_assignments (user_id, project_id)
VALUES ('a0a0a0a0-0000-0000-0000-0000000000f3', 'a2a2a2a2-0000-0000-0000-000000000002');

-- UV: rol de empresa con SÓLO la vista de contabilidad.
INSERT INTO public.permissions (key, category, label)
VALUES ('platform.contabilidad.view', 'platform', 'Ver contabilidad')
ON CONFLICT (key) DO NOTHING;
INSERT INTO public.roles (id, company_id, name, is_system)
VALUES ('70000000-0000-0000-0000-00000000000a', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Consulta contable', false);
INSERT INTO public.role_permissions (role_id, permission_key, effect)
VALUES ('70000000-0000-0000-0000-00000000000a', 'platform.contabilidad.view', 'allow');
INSERT INTO public.user_roles (user_id, role_id)
VALUES ('a0a0a0a0-0000-0000-0000-0000000000f1', '70000000-0000-0000-0000-00000000000a');

-- ── Cuentas ─────────────────────────────────────────────────────────────────
INSERT INTO public.conta_cuentas
  (id, company_id, project_id, codigo, nombre, tipo, naturaleza, nivel, es_detalle, activa) VALUES
  -- Ledger de EMPRESA de A
  ('c0000000-0000-0000-0000-00000000a001', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', NULL, '5',    'Gastos (agrupadora)', 'gasto',  'deudora',   1, false, true),
  ('c0000000-0000-0000-0000-00000000a002', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', NULL, '5101', 'Gasto general',       'gasto',  'deudora',   3, true,  true),
  ('c0000000-0000-0000-0000-00000000a003', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', NULL, '5102', 'Gasto proveedor',     'gasto',  'deudora',   3, true,  true),
  ('c0000000-0000-0000-0000-00000000a004', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', NULL, '5103', 'Gasto desactivado',   'gasto',  'deudora',   3, true,  false),
  ('c0000000-0000-0000-0000-00000000a005', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', NULL, '5104', 'Gasto elegido 1',     'gasto',  'deudora',   3, true,  true),
  ('c0000000-0000-0000-0000-00000000a006', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', NULL, '5105', 'Gasto elegido 2',     'gasto',  'deudora',   3, true,  true),
  ('c0000000-0000-0000-0000-00000000a008', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', NULL, '2101', 'Cuentas por pagar',   'pasivo', 'acreedora', 3, true,  true),
  ('c0000000-0000-0000-0000-00000000a009', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', NULL, '2105', 'Compras por facturar','pasivo', 'acreedora', 3, true,  true),
  ('c0000000-0000-0000-0000-00000000a010', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', NULL, '1105', 'IVA crédito fiscal',  'activo', 'deudora',   3, true,  true),
  -- Ledger del PROYECTO A1
  ('c0000000-0000-0000-0000-00000000a101', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'a1a1a1a1-0000-0000-0000-000000000001', '5101', 'Gasto general (A1)',      'gasto',  'deudora',   3, true, true),
  ('c0000000-0000-0000-0000-00000000a108', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'a1a1a1a1-0000-0000-0000-000000000001', '2101', 'Cuentas por pagar (A1)',  'pasivo', 'acreedora', 3, true, true),
  -- Empresa B
  ('c0000000-0000-0000-0000-00000000b001', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', NULL, '5101', 'Gasto general (B)',  'gasto',  'deudora',   3, true, true),
  ('c0000000-0000-0000-0000-00000000b008', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', NULL, '2101', 'Cuentas por pagar (B)', 'pasivo', 'acreedora', 3, true, true);

-- ── Proveedores ─────────────────────────────────────────────────────────────
INSERT INTO public.proveedores (id, company_id, nombre, estado) VALUES
  ('d0000000-0000-0000-0000-00000000a001', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Proveedor A', 'autorizado'),
  ('d0000000-0000-0000-0000-00000000b001', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'Proveedor B', 'autorizado');

-- ── Mapeo: SÓLO la contrapartida (CxP). Sin mapeo de gasto: las facturas
--    nacen PENDIENTES por «sin cuenta», que es el caso que motiva el PR.
INSERT INTO public.conta_mapeo_cuentas (company_id, project_id, evento, cuenta_id) VALUES
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', NULL, 'cxp_proveedores', 'c0000000-0000-0000-0000-00000000a008'),
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'a1a1a1a1-0000-0000-0000-000000000001', 'cxp_proveedores', 'c0000000-0000-0000-0000-00000000a108'),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', NULL, 'cxp_proveedores', 'c0000000-0000-0000-0000-00000000b008');

-- ── Ayudas: documento, línea, aprobación ────────────────────────────────────
-- Se aprueba con el trigger DE VERDAD (UPDATE de estado), no llamando a la
-- función: es el camino que recorre la aplicación.
CREATE OR REPLACE FUNCTION public.factura(
  p_id uuid, p_concepto text, p_total numeric, p_iva numeric DEFAULT 0,
  p_oc uuid DEFAULT NULL, p_project uuid DEFAULT NULL, p_fecha date DEFAULT DATE '2026-09-10',
  p_company uuid DEFAULT 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  p_proveedor uuid DEFAULT 'd0000000-0000-0000-0000-00000000a001')
RETURNS void LANGUAGE plpgsql AS $fn$
BEGIN
  INSERT INTO public.facturas_proveedor
    (id, company_id, project_id, proveedor_id, concepto, categoria,
     monto_total, iva_monto, moneda, estado, orden_compra_id, fecha_emision, numero_factura)
  VALUES (p_id, p_company, p_project, p_proveedor, p_concepto, 'otros',
          p_total, p_iva, 'USD', 'registrada', p_oc, p_fecha, 'F-' || p_id::text);
END;
$fn$;

-- Con líneas, la cabecera la recalcula 20260821000300 desde los renglones.
CREATE OR REPLACE FUNCTION public.linea(
  p_factura uuid, p_linea int, p_cant numeric, p_precio numeric,
  p_cuenta uuid DEFAULT NULL, p_ocl uuid DEFAULT NULL, p_iva numeric DEFAULT 0)
RETURNS void LANGUAGE plpgsql AS $fn$
BEGIN
  INSERT INTO public.factura_proveedor_lineas
    (company_id, factura_id, linea, descripcion, cuenta_id, cantidad,
     precio_unitario, iva_monto, total, orden_compra_linea_id)
  SELECT f.company_id, p_factura, p_linea, 'Línea ' || p_linea, p_cuenta, p_cant, p_precio, p_iva,
         round(p_cant * p_precio, 2) + p_iva, p_ocl
    FROM public.facturas_proveedor f WHERE f.id = p_factura;
END;
$fn$;

CREATE OR REPLACE FUNCTION public.aprobar_id(p_id uuid)
RETURNS void LANGUAGE plpgsql AS $fn$
BEGIN
  UPDATE public.facturas_proveedor SET estado = 'aprobada' WHERE id = p_id;
END;
$fn$;

-- Asientos de DEVENGO de una factura (el evento que el reproceso genera).
CREATE OR REPLACE FUNCTION public.n_asientos(p_factura uuid)
RETURNS bigint LANGUAGE sql STABLE AS $fn$
  SELECT count(*) FROM public.conta_asientos
   WHERE origen_tabla = 'facturas_proveedor' AND origen_id = p_factura
     AND origen_evento = 'factura_prov_aprobada';
$fn$;

CREATE OR REPLACE FUNCTION public.n_lineas_asiento(p_factura uuid)
RETURNS bigint LANGUAGE sql STABLE AS $fn$
  SELECT count(*) FROM public.conta_asiento_lineas l
    JOIN public.conta_asientos a ON a.id = l.asiento_id
   WHERE a.origen_tabla = 'facturas_proveedor' AND a.origen_id = p_factura;
$fn$;

CREATE OR REPLACE FUNCTION public.debe_en(p_factura uuid, p_cuenta uuid)
RETURNS numeric LANGUAGE sql STABLE AS $fn$
  SELECT COALESCE(SUM(l.debe), 0) FROM public.conta_asiento_lineas l
    JOIN public.conta_asientos a ON a.id = l.asiento_id
   WHERE a.origen_id = p_factura AND a.origen_evento = 'factura_prov_aprobada'
     AND l.cuenta_id = p_cuenta;
$fn$;

CREATE OR REPLACE FUNCTION public.haber_en(p_factura uuid, p_cuenta uuid)
RETURNS numeric LANGUAGE sql STABLE AS $fn$
  SELECT COALESCE(SUM(l.haber), 0) FROM public.conta_asiento_lineas l
    JOIN public.conta_asientos a ON a.id = l.asiento_id
   WHERE a.origen_id = p_factura AND a.origen_evento = 'factura_prov_aprobada'
     AND l.cuenta_id = p_cuenta;
$fn$;

-- El reproceso COMO LO LLAMA LA APLICACIÓN: rol authenticated, con el sub del
-- usuario indicado. Vuelve a postgres al terminar para que el arnés siga
-- pudiendo preparar datos. Devuelve la fila completa como jsonb.
CREATE OR REPLACE FUNCTION public.reprocesar_como(p_user uuid, p_factura uuid)
RETURNS jsonb LANGUAGE plpgsql AS $fn$
DECLARE
  v jsonb;
BEGIN
  PERFORM set_config('request.jwt.claim.sub', p_user::text, true);
  SET LOCAL ROLE authenticated;
  SELECT to_jsonb(r) INTO v FROM public.conta_reprocesar_factura_proveedor(p_factura) r;
  RESET ROLE;
  RETURN v;
EXCEPTION WHEN OTHERS THEN
  RESET ROLE;
  RAISE;
END;
$fn$;

-- La bandeja como la ve un usuario.
CREATE OR REPLACE FUNCTION public.bandeja_como(
  p_user uuid, p_project uuid DEFAULT NULL, p_codigo text DEFAULT NULL,
  p_busqueda text DEFAULT NULL, p_limite int DEFAULT 25, p_offset int DEFAULT 0)
RETURNS SETOF jsonb LANGUAGE plpgsql AS $fn$
BEGIN
  PERFORM set_config('request.jwt.claim.sub', p_user::text, true);
  SET LOCAL ROLE authenticated;
  RETURN QUERY SELECT to_jsonb(b) FROM public.conta_facturas_pendientes(
    p_project, p_codigo, p_busqueda, p_limite, p_offset) b;
  RESET ROLE;
EXCEPTION WHEN OTHERS THEN
  RESET ROLE;
  RAISE;
END;
$fn$;
