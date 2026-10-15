\set ON_ERROR_STOP on

-- ============================================================================
-- PADRÓN DE LA SUITE «fail_open_sin_perfil»
--
-- Dos empresas: C (la del «forastero» OP_C) y D (la víctima). D está EN SU TOPE de
-- proyectos (2 de 2) y de unidades (1 de 1): es la condición exacta en la que el
-- trigger del tope respondía con el límite y el conteo de otra empresa.
--
-- Personas (todas con auth.users; las de app_users con su rol):
--   SA       superadministrador (sin empresa)
--   OWN_D    propietario de D            ADM_D  administrador de D (exento)
--   OPE_D    operador de D (D1)          VIS_D  visor de D (D1)
--   OWN_C    propietario de C            OP_C   operador de C (C1) — el FORASTERO de referencia
--   CLI      cliente (sin empresa, como los deja trg_cliente_sin_company_id), residente de D
--   SINAPP   sesión `authenticated` SIN fila en app_users
-- Más tres sesiones sin persona: ANON (rol anon), SERVICIO (service_role) y SISTEMA
-- (el propietario sin JWT: migraciones, SQL Editor, pg_cron).
--
-- Todo lo de la prueba vive en el esquema «fos»: no toca el catálogo de public.
-- ============================================================================

CREATE SCHEMA fos;
GRANT USAGE ON SCHEMA fos TO PUBLIC;

CREATE TABLE fos.ids (alias text PRIMARY KEY, id uuid NOT NULL UNIQUE, tipo text NOT NULL);
GRANT SELECT ON fos.ids TO PUBLIC;

CREATE FUNCTION fos.id(p_alias text) RETURNS uuid LANGUAGE sql STABLE AS
$$ SELECT id FROM fos.ids WHERE alias = p_alias $$;
GRANT EXECUTE ON FUNCTION fos.id(text) TO PUBLIC;

INSERT INTO fos.ids (alias, id, tipo) VALUES
  ('C',      'f0500000-0000-0000-0000-00000000000c', 'empresa'),
  ('D',      'f0500000-0000-0000-0000-00000000000d', 'empresa'),
  ('C1',     'f05c0000-0000-0000-0000-000000000001', 'proyecto'),
  ('C2',     'f05c0000-0000-0000-0000-000000000002', 'proyecto'),
  ('D1',     'f05d0000-0000-0000-0000-000000000001', 'proyecto'),
  ('D2',     'f05d0000-0000-0000-0000-000000000002', 'proyecto'),
  ('UNI_D1', 'f05e0000-0000-0000-0000-0000000000d1', 'unidad'),
  ('CLI_D',  'f05f0000-0000-0000-0000-0000000000d1', 'cliente'),
  ('SA',     'f0510000-0000-0000-0000-000000000001', 'persona'),
  ('OWN_D',  'f0510000-0000-0000-0000-000000000002', 'persona'),
  ('ADM_D',  'f0510000-0000-0000-0000-000000000003', 'persona'),
  ('OPE_D',  'f0510000-0000-0000-0000-000000000004', 'persona'),
  ('VIS_D',  'f0510000-0000-0000-0000-000000000005', 'persona'),
  ('OWN_C',  'f0510000-0000-0000-0000-000000000006', 'persona'),
  ('OP_C',   'f0510000-0000-0000-0000-000000000007', 'persona'),
  ('CLI',    'f0510000-0000-0000-0000-000000000008', 'persona'),
  ('SINAPP', 'f0510000-0000-0000-0000-000000000009', 'persona');

-- ── empresas, proyectos, unidad ──────────────────────────────────────────────
INSERT INTO public.companies (id, nombre, max_projects, max_units) VALUES
  (fos.id('C'), 'Empresa C (forastero)', 5, 50),
  (fos.id('D'), 'Empresa D (víctima)',   2, 1);

INSERT INTO public.projects (id, company_id, nombre, tipo) VALUES
  (fos.id('C1'), fos.id('C'), 'C1', 'condominio'),
  (fos.id('C2'), fos.id('C'), 'C2', 'condominio'),
  (fos.id('D1'), fos.id('D'), 'D1', 'condominio'),
  (fos.id('D2'), fos.id('D'), 'D2', 'condominio');

INSERT INTO public.unidades (id, project_id, company_id, nombre) VALUES
  (fos.id('UNI_D1'), fos.id('D1'), fos.id('D'), 'Casa 1');

INSERT INTO public.clientes (id, nombre, codigo) VALUES (fos.id('CLI_D'), 'Residente de D', 'CLI-D-1');
INSERT INTO public.company_clientes (company_id, cliente_id) VALUES (fos.id('D'), fos.id('CLI_D'));

-- ── personas ─────────────────────────────────────────────────────────────────
INSERT INTO auth.users (id, email)
SELECT id, lower(alias) || '@fos.test' FROM fos.ids WHERE tipo = 'persona';

INSERT INTO public.app_users (id, full_name, role, company_id, cliente_id) VALUES
  (fos.id('SA'),    'Superadmin',     'super_admin',   NULL,        NULL),
  (fos.id('OWN_D'), 'Propietario D',  'company_owner', fos.id('D'), NULL),
  (fos.id('ADM_D'), 'Admin D',        'admin',         fos.id('D'), NULL),
  (fos.id('OPE_D'), 'Operador D',     'operator',      fos.id('D'), NULL),
  (fos.id('VIS_D'), 'Visor D',        'viewer',        fos.id('D'), NULL),
  (fos.id('OWN_C'), 'Propietario C',  'company_owner', fos.id('C'), NULL),
  (fos.id('OP_C'),  'Operador C',     'operator',      fos.id('C'), NULL),
  (fos.id('CLI'),   'Cliente de D',   'cliente',       NULL,        fos.id('CLI_D'));
-- SINAPP: sólo auth.users (sin perfil).

INSERT INTO public.user_project_assignments (user_id, project_id, permission_type) VALUES
  (fos.id('OPE_D'), fos.id('D1'), 'total'),
  (fos.id('VIS_D'), fos.id('D1'), 'total'),
  (fos.id('OP_C'),  fos.id('C1'), 'total');

-- ── Sesiones simuladas: SET ROLE + los GUC del JWT que leen auth.uid() y las guardas ──
CREATE FUNCTION fos.poner_actor(p_actor text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE v_uid uuid;
BEGIN
  IF p_actor = 'SISTEMA' THEN
    -- '{}' y no '': una sesión de sistema no trae JWT, y `''::jsonb` no es «sin claims», es un error de sintaxis.
    PERFORM set_config('request.jwt.claim.sub', '', true);
    PERFORM set_config('request.jwt.claims', '{}', true);
    PERFORM set_config('role', 'none', true);
  ELSIF p_actor = 'ANON' THEN
    PERFORM set_config('request.jwt.claim.sub', '', true);
    PERFORM set_config('request.jwt.claims', '{"role":"anon"}', true);
    PERFORM set_config('role', 'anon', true);
  ELSIF p_actor = 'SERVICIO' THEN
    PERFORM set_config('request.jwt.claim.sub', '', true);
    PERFORM set_config('request.jwt.claims', '{"role":"service_role"}', true);
    PERFORM set_config('role', 'service_role', true);
  ELSE
    v_uid := fos.id(p_actor);
    IF v_uid IS NULL THEN RAISE EXCEPTION 'actor desconocido «%»', p_actor; END IF;
    PERFORM set_config('request.jwt.claim.sub', v_uid::text, true);
    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_uid, 'role', 'authenticated')::text, true);
    PERFORM set_config('role', 'authenticated', true);
  END IF;
END $$;
GRANT EXECUTE ON FUNCTION fos.poner_actor(text) TO PUBLIC;

-- Comprobaciones
CREATE FUNCTION fos.chk_txt(actual text, esperado text, msg text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF actual IS DISTINCT FROM esperado THEN RAISE EXCEPTION '% — esperado «%», recibido «%»', msg, esperado, actual; END IF;
  RAISE NOTICE '✓ %', msg;
END $$;
CREATE FUNCTION fos.chk(actual bigint, esperado bigint, msg text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF actual IS DISTINCT FROM esperado THEN RAISE EXCEPTION '% — esperado %, recibido %', msg, esperado, actual; END IF;
  RAISE NOTICE '✓ %', msg;
END $$;
-- Veredicto fallido: aborta (modo normal) o se anota y sigue (fos.continuar = on), para
-- CONTAR los casos rojos del control negativo en vez de pararse en el primero.
CREATE TABLE fos.fallos (n serial PRIMARY KEY, msg text NOT NULL);
GRANT ALL ON fos.fallos TO PUBLIC;
GRANT USAGE ON SEQUENCE fos.fallos_n_seq TO PUBLIC;
CREATE FUNCTION fos.falla(p_msg text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF current_setting('fos.continuar', true) = 'on' THEN
    INSERT INTO fos.fallos (msg) VALUES (p_msg);
    RAISE NOTICE '✗ %', p_msg;
    RETURN;
  END IF;
  RAISE EXCEPTION '%', p_msg;
END $$;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA fos TO PUBLIC;

-- ── Objetos de D con los que se prueban las RPC que reciben un id (no una empresa) ──
-- Se crean como SISTEMA con `conta.allow_system_write`: es el camino de las RPC internas.
INSERT INTO fos.ids (alias, id, tipo) VALUES
  ('ASI_D',  'f0560000-0000-0000-0000-0000000000a1', 'asiento'),
  ('CTA_BD', 'f0560000-0000-0000-0000-0000000000b1', 'cuenta_bancaria'),
  ('MOV_D',  'f0560000-0000-0000-0000-0000000000b2', 'movimiento'),
  ('PROV_D', 'f0560000-0000-0000-0000-0000000000c1', 'proveedor'),
  ('OC_D',   'f0560000-0000-0000-0000-0000000000c2', 'orden'),
  ('OCL_D',  'f0560000-0000-0000-0000-0000000000c3', 'orden_linea'),
  ('FAC_D',  'f0560000-0000-0000-0000-0000000000c4', 'factura'),
  ('SOL_D',  'f0560000-0000-0000-0000-0000000000d1', 'solicitud_renta'),
  ('PER_D',  'f0560000-0000-0000-0000-0000000000e1', 'personal');

SELECT set_config('conta.allow_system_write', 'on', false);

-- El catálogo contable de D (empresa), sembrado por las funciones reales como lo hace el alta de contabilidad.
SELECT public.conta_seed_catalogo(fos.id('D'), NULL);
SELECT public.compras_seed_cuentas(fos.id('D'), NULL);

INSERT INTO public.conta_asientos (id, company_id, concepto)
VALUES (fos.id('ASI_D'), fos.id('D'), 'Asiento borrador de D');

INSERT INTO public.cuentas_bancarias (id, company_id, nombre, banco, cuenta_contable_id)
SELECT fos.id('CTA_BD'), fos.id('D'), 'Cuenta de D', 'Banco', c.id
  FROM public.conta_cuentas c
 WHERE c.company_id = fos.id('D') AND c.project_id IS NULL AND c.es_detalle AND c.activa
 ORDER BY c.codigo LIMIT 1;

INSERT INTO public.banco_movimientos (id, company_id, cuenta_bancaria_id, fecha, monto)
VALUES (fos.id('MOV_D'), fos.id('D'), fos.id('CTA_BD'), current_date, 100);

INSERT INTO public.proveedores (id, company_id, nombre, estado)
VALUES (fos.id('PROV_D'), fos.id('D'), 'Proveedor de D', 'autorizado');

INSERT INTO public.ordenes_compra (id, company_id, proveedor_id, proveedor_nombre, concepto)
VALUES (fos.id('OC_D'), fos.id('D'), fos.id('PROV_D'), 'Proveedor de D', 'Orden de D sin proyecto');
INSERT INTO public.orden_compra_lineas (id, company_id, orden_compra_id, descripcion, cantidad, precio_unitario, total)
VALUES (fos.id('OCL_D'), fos.id('D'), fos.id('OC_D'), 'Material secreto de D', 3, 10, 30);

INSERT INTO public.facturas_proveedor (id, company_id, proveedor_id, concepto, monto_total, orden_compra_id)
VALUES (fos.id('FAC_D'), fos.id('D'), fos.id('PROV_D'), 'Factura de D', 30, fos.id('OC_D'));
INSERT INTO public.factura_proveedor_lineas (company_id, factura_id, descripcion, cantidad, precio_unitario, total, orden_compra_linea_id)
VALUES (fos.id('D'), fos.id('FAC_D'), 'Material secreto de D', 3, 10, 30, fos.id('OCL_D'));

INSERT INTO public.solicitud_renta_unidad (id, company_id, project_id, unidad_id, arrendatario_nombre, monto_renta, fecha_inicio,
                                          resp_mantenimiento, resp_agua, resp_electricidad, resp_basura, resp_telefonia, resp_internet)
VALUES (fos.id('SOL_D'), fos.id('D'), fos.id('D1'), fos.id('UNI_D1'), 'Inquilino de D', 1000, current_date,
        'propietario', 'inquilino', 'inquilino', 'propietario', 'inquilino', 'inquilino');

INSERT INTO public.personal_condominio (id, company_id, project_id, nombre)
VALUES (fos.id('PER_D'), fos.id('D'), fos.id('D1'), 'Conserje de D');

SELECT set_config('conta.allow_system_write', '', false);
