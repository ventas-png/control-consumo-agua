-- ============================================================================
-- PADRÓN DE LA SUITE «portal_pestanas» (20261106000000)
--
-- Se carga sobre la cadena REAL de migraciones ANTES de aplicar la nuestra: así
-- los proyectos ya existen cuando llega la columna y la suite prueba también
-- que los condominios de siempre quedan con «nada apagado».
--
-- Empresas y condominios:
--   A  →  A1      B  →  B1
-- Personas (app_users):
--   OWN_A  company_owner de A      ADM_A  admin de A
--   OPE_A  operator de A           OWN_B  company_owner de B
--   SUP    super_admin (sin empresa)
--   RES_A  cliente de A (company_clientes), propietario de U_A en A1
--   RES_B  cliente de B, propietario de U_B en B1
--
-- Todo lo de la prueba vive en el esquema «pp». `auth.uid()` sale del GUC
-- `request.jwt.claim.sub` (bootstrap.sql).
-- ============================================================================
\set ON_ERROR_STOP on

CREATE SCHEMA pp;
GRANT USAGE ON SCHEMA pp TO PUBLIC;

CREATE TABLE pp.ids (alias text PRIMARY KEY, id uuid NOT NULL UNIQUE);
GRANT SELECT ON pp.ids TO PUBLIC;

CREATE FUNCTION pp.id(p_alias text) RETURNS uuid LANGUAGE sql STABLE AS
$$ SELECT id FROM pp.ids WHERE alias = p_alias $$;

INSERT INTO pp.ids (alias, id) VALUES
  ('A',      'e0000000-0000-0000-0000-00000000000a'),
  ('B',      'e0000000-0000-0000-0000-00000000000b'),
  ('A1',     'e1000000-0000-0000-0000-0000000000a1'),
  ('B1',     'e1000000-0000-0000-0000-0000000000b1'),
  ('OWN_A',  'e2000000-0000-0000-0000-000000000001'),
  ('ADM_A',  'e2000000-0000-0000-0000-000000000002'),
  ('OPE_A',  'e2000000-0000-0000-0000-000000000003'),
  ('OWN_B',  'e2000000-0000-0000-0000-000000000004'),
  ('SUP',    'e2000000-0000-0000-0000-000000000005'),
  ('RES_A',  'e2000000-0000-0000-0000-000000000006'),
  ('RES_B',  'e2000000-0000-0000-0000-000000000007'),
  ('CLI_A',  'e3000000-0000-0000-0000-000000000001'),
  ('CLI_B',  'e3000000-0000-0000-0000-000000000002'),
  ('U_A',    'e4000000-0000-0000-0000-000000000001'),
  ('U_B',    'e4000000-0000-0000-0000-000000000002');

-- ── Comprobaciones ──────────────────────────────────────────────────────────
CREATE FUNCTION pp.chk(actual anyelement, esperado anyelement, msg text)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF actual IS DISTINCT FROM esperado THEN
    RAISE EXCEPTION '% — esperado %, recibido %', msg, esperado, actual;
  END IF;
  RAISE NOTICE '✓ %', msg;
END;
$$;

CREATE FUNCTION pp.como(p_alias text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('request.jwt.claim.sub', COALESCE(pp.id(p_alias)::text, ''), false);
END;
$$;

-- Ejecuta una sentencia con la identidad de la sesión y la DESHACE siempre.
-- Devuelve 'ok:<filas>' o el SQLSTATE: distingue «el RLS no la deja tocar»
-- (ok:0), «el CHECK la rechaza» (23514) y «sin privilegio» (42501).
CREATE FUNCTION pp.intenta(p_sql text, p_a uuid DEFAULT NULL)
RETURNS text LANGUAGE plpgsql AS $$
DECLARE
  n int := 0;
BEGIN
  BEGIN
    EXECUTE p_sql USING p_a;
    GET DIAGNOSTICS n = ROW_COUNT;
    RAISE EXCEPTION USING ERRCODE = 'PP000', MESSAGE = n::text;
  EXCEPTION
    WHEN SQLSTATE 'PP000' THEN RETURN 'ok:' || SQLERRM;
    WHEN OTHERS THEN RETURN SQLSTATE;
  END;
END;
$$;

-- Apagar pestañas del condominio, como lo hace la pantalla (UPDATE por id).
CREATE FUNCTION pp.apaga(p_proyecto text, p_tabs text[]) RETURNS text LANGUAGE sql AS $$
  SELECT pp.intenta(format('UPDATE public.projects SET portal_tabs_ocultos = %L::text[] WHERE id = $1', p_tabs), pp.id(p_proyecto))
$$;

-- Lo que lee el portal del residente (fetchCondominiosPortalData).
CREATE FUNCTION pp.lee(p_proyecto text) RETURNS text[] LANGUAGE plpgsql AS $$
DECLARE v text[];
BEGIN
  EXECUTE 'SELECT portal_tabs_ocultos FROM public.projects WHERE id = $1' INTO v USING pp.id(p_proyecto);
  RETURN v;
END;
$$;

CREATE FUNCTION pp.ve(p_proyecto text) RETURNS boolean LANGUAGE sql AS
$$ SELECT EXISTS (SELECT 1 FROM public.projects WHERE id = pp.id(p_proyecto)) $$;

GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA pp TO PUBLIC;

-- ── Empresas y condominios ──────────────────────────────────────────────────
INSERT INTO public.companies (id, nombre) VALUES
  (pp.id('A'), 'Empresa A'),
  (pp.id('B'), 'Empresa B');

INSERT INTO public.projects (id, company_id, nombre, tipo) VALUES
  (pp.id('A1'), pp.id('A'), 'Condominio A1', 'condominios'),
  (pp.id('B1'), pp.id('B'), 'Condominio B1', 'condominios');

-- ── Personas ────────────────────────────────────────────────────────────────
INSERT INTO public.clientes (id, nombre, codigo) VALUES
  (pp.id('CLI_A'), 'Residente A', 'PP-A'),
  (pp.id('CLI_B'), 'Residente B', 'PP-B');

INSERT INTO public.company_clientes (company_id, cliente_id) VALUES
  (pp.id('A'), pp.id('CLI_A')),
  (pp.id('B'), pp.id('CLI_B'));

INSERT INTO auth.users (id)
SELECT pp.id(a) FROM unnest(ARRAY['OWN_A','ADM_A','OPE_A','OWN_B','SUP','RES_A','RES_B']) AS a;

INSERT INTO public.app_users (id, company_id, full_name, role) VALUES
  (pp.id('OWN_A'), pp.id('A'), 'Propietario A', 'company_owner'),
  (pp.id('ADM_A'), pp.id('A'), 'Admin A',       'admin'),
  (pp.id('OPE_A'), pp.id('A'), 'Operador A',    'operator'),
  (pp.id('OWN_B'), pp.id('B'), 'Propietario B', 'company_owner'),
  (pp.id('SUP'),   NULL,       'Super',         'super_admin');
INSERT INTO public.app_users (id, company_id, full_name, role, cliente_id) VALUES
  (pp.id('RES_A'), NULL, 'Residente A', 'cliente', pp.id('CLI_A')),
  (pp.id('RES_B'), NULL, 'Residente B', 'cliente', pp.id('CLI_B'));

INSERT INTO public.unidades (id, project_id, company_id, nombre, cliente_id) VALUES
  (pp.id('U_A'), pp.id('A1'), pp.id('A'), 'Unidad A', pp.id('CLI_A')),
  (pp.id('U_B'), pp.id('B1'), pp.id('B'), 'Unidad B', pp.id('CLI_B'));
