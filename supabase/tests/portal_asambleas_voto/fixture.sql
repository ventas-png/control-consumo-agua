-- ============================================================================
-- PADRÓN DE LA SUITE «portal_asambleas_voto» (20261105000000)
--
-- Se carga sobre la cadena REAL de migraciones: mis_unidades_propietario_ids,
-- company_has_feature, los planes sembrados y las policies de asambleas,
-- puntos y votos son los del repositorio.
--
-- Empresas y proyectos:
--   A   plan condominios_only, activo → tiene asambleas_digitales
--       A1  el condominio de los residentes
--       A2  otro condominio de la misma empresa
--   C   plan agua_only, activo        → NO la tiene
--       C1
-- Residentes (app_users role 'cliente', sin empresa, como los crea
-- create-cliente-account):
--   PROP    propietario de U_P por unidades.cliente_id (el alta legacy)
--   PROP2   propietario de U_P2 por unidad_residentes.tipo = 'propietario'
--   INQ     arrendatario de U_P (unidad_residentes)
--   OTRO    propietario de U_O (A1)
--   PROPC   propietario de U_C (C1)
-- Staff:  ADM_A, admin de A.
-- Asambleas de A1:
--   ASA_CUR   en_curso    PUN_V (votacion) · PUN_I (informativo) · acta en borrador
--   ASA_PROG  programada  PUN_PROG (votacion)
--   ASA_FIN   finalizada  PUN_FIN (votacion) con votos de U_O (a_favor) y
--                         U_P2 (en_contra), acta publicada
--   ASA_CAN   cancelada
-- ASA_A2 (A2) y ASA_C (C1), en_curso, con un punto de votación cada una.
-- ASA_DIG es una asamblea DIGITAL de A1: lo que listaba el portal viejo.
-- VOT_O: U_O ya votó en PUN_V (el conteo parcial no debe salir).
--
-- Todo lo de la prueba vive en el esquema «pv». `auth.uid()` sale del GUC
-- `request.jwt.claim.sub` (bootstrap.sql).
-- ============================================================================
\set ON_ERROR_STOP on

CREATE SCHEMA pv;
GRANT USAGE ON SCHEMA pv TO PUBLIC;

CREATE TABLE pv.ids (alias text PRIMARY KEY, id uuid NOT NULL UNIQUE);
GRANT SELECT ON pv.ids TO PUBLIC;

CREATE FUNCTION pv.id(p_alias text) RETURNS uuid LANGUAGE sql STABLE AS
$$ SELECT id FROM pv.ids WHERE alias = p_alias $$;

INSERT INTO pv.ids (alias, id) VALUES
  ('A',        'd0000000-0000-0000-0000-00000000000a'),
  ('C',        'd0000000-0000-0000-0000-00000000000c'),
  ('A1',       'd1000000-0000-0000-0000-0000000000a1'),
  ('A2',       'd1000000-0000-0000-0000-0000000000a2'),
  ('C1',       'd1000000-0000-0000-0000-0000000000c1'),
  ('ADM_A',    'd2000000-0000-0000-0000-00000000000a'),
  ('PROP',     'd2000000-0000-0000-0000-000000000001'),
  ('PROP2',    'd2000000-0000-0000-0000-000000000002'),
  ('INQ',      'd2000000-0000-0000-0000-000000000003'),
  ('OTRO',     'd2000000-0000-0000-0000-000000000004'),
  ('PROPC',    'd2000000-0000-0000-0000-000000000005'),
  ('CLI_PROP', 'd3000000-0000-0000-0000-000000000001'),
  ('CLI_PROP2','d3000000-0000-0000-0000-000000000002'),
  ('CLI_INQ',  'd3000000-0000-0000-0000-000000000003'),
  ('CLI_OTRO', 'd3000000-0000-0000-0000-000000000004'),
  ('CLI_PROPC','d3000000-0000-0000-0000-000000000005'),
  ('U_P',      'd4000000-0000-0000-0000-000000000001'),
  ('U_P2',     'd4000000-0000-0000-0000-000000000002'),
  ('U_O',      'd4000000-0000-0000-0000-000000000004'),
  ('U_C',      'd4000000-0000-0000-0000-000000000005'),
  ('ASA_CUR',  'd5000000-0000-0000-0000-000000000001'),
  ('ASA_PROG', 'd5000000-0000-0000-0000-000000000002'),
  ('ASA_FIN',  'd5000000-0000-0000-0000-000000000003'),
  ('ASA_CAN',  'd5000000-0000-0000-0000-000000000004'),
  ('ASA_A2',   'd5000000-0000-0000-0000-0000000000a2'),
  ('ASA_C',    'd5000000-0000-0000-0000-0000000000c1'),
  ('ASA_DIG',  'd5000000-0000-0000-0000-0000000000dd'),
  ('PUN_V',    'd6000000-0000-0000-0000-000000000001'),
  ('PUN_I',    'd6000000-0000-0000-0000-000000000002'),
  ('PUN_PROG', 'd6000000-0000-0000-0000-000000000003'),
  ('PUN_FIN',  'd6000000-0000-0000-0000-000000000004'),
  ('PUN_A2',   'd6000000-0000-0000-0000-0000000000a2'),
  ('PUN_C',    'd6000000-0000-0000-0000-0000000000c1'),
  ('VOT_O',    'd7000000-0000-0000-0000-000000000001');

-- ── Comprobaciones ──────────────────────────────────────────────────────────
CREATE FUNCTION pv.chk(actual anyelement, esperado anyelement, msg text)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF actual IS DISTINCT FROM esperado THEN
    RAISE EXCEPTION '% — esperado %, recibido %', msg, esperado, actual;
  END IF;
  RAISE NOTICE '✓ %', msg;
END;
$$;

CREATE FUNCTION pv.como(p_alias text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('request.jwt.claim.sub', pv.id(p_alias)::text, false);
END;
$$;

-- Ejecuta una sentencia con la identidad de la sesión y la DESHACE siempre.
-- Devuelve 'ok' (y cuántas filas tocó) o el SQLSTATE del error: así cada caso
-- distingue «RLS lo rechaza» (42501) de «la columna no existe» (42703).
CREATE FUNCTION pv.intenta(p_sql text, p_a uuid DEFAULT NULL, p_b uuid DEFAULT NULL, p_c text DEFAULT NULL)
RETURNS text LANGUAGE plpgsql AS $$
DECLARE
  n int := 0;
BEGIN
  BEGIN
    EXECUTE p_sql USING p_a, p_b, p_c;
    GET DIAGNOSTICS n = ROW_COUNT;
    RAISE EXCEPTION USING ERRCODE = 'PV000', MESSAGE = n::text;
  EXCEPTION
    WHEN SQLSTATE 'PV000' THEN RETURN 'ok:' || SQLERRM;
    WHEN OTHERS THEN RETURN SQLSTATE;
  END;
END;
$$;

-- El voto del portal, de verdad (persiste): 'ok' o el SQLSTATE.
CREATE FUNCTION pv.vota(p_punto text, p_unidad text, p_voto text) RETURNS text
LANGUAGE plpgsql AS $$
BEGIN
  PERFORM public.portal_votar_punto(pv.id(p_punto), pv.id(p_unidad), p_voto);
  RETURN 'ok';
EXCEPTION WHEN OTHERS THEN
  RETURN SQLSTATE;
END;
$$;

-- Lo que el portal recibe para una unidad. plpgsql a propósito: el padrón se
-- carga también ANTES de la migración, cuando el RPC todavía no existe.
CREATE FUNCTION pv.asambleas(p_unidad text) RETURNS SETOF jsonb LANGUAGE plpgsql AS
$$ BEGIN RETURN QUERY SELECT public.portal_asambleas_unidad(pv.id(p_unidad)); END $$;

CREATE FUNCTION pv.asamblea(p_unidad text, p_asamblea text) RETURNS jsonb LANGUAGE sql AS
$$ SELECT a FROM pv.asambleas(p_unidad) a WHERE (a->>'id')::uuid = pv.id(p_asamblea) $$;

CREATE FUNCTION pv.punto(p_unidad text, p_punto text) RETURNS jsonb LANGUAGE sql AS $$
  SELECT p FROM pv.asambleas(p_unidad) a, jsonb_array_elements(a->'puntos') p
  WHERE (p->>'id')::uuid = pv.id(p_punto)
$$;

GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA pv TO PUBLIC;

-- ── Empresas, proyectos y planes ────────────────────────────────────────────
INSERT INTO public.companies (id, nombre) VALUES
  (pv.id('A'), 'Empresa A (condominios_only)'),
  (pv.id('C'), 'Empresa C (agua_only)');

UPDATE public.subscriptions s
SET plan_id = (SELECT id FROM public.billing_plans WHERE code = v.plan),
    status  = 'active'
FROM (VALUES (pv.id('A'), 'condominios_only'),
             (pv.id('C'), 'agua_only')) AS v(company_id, plan)
WHERE s.company_id = v.company_id;

INSERT INTO public.projects (id, company_id, nombre, tipo) VALUES
  (pv.id('A1'), pv.id('A'), 'Condominio A1', 'condominios'),
  (pv.id('A2'), pv.id('A'), 'Condominio A2', 'condominios'),
  (pv.id('C1'), pv.id('C'), 'Condominio C1', 'condominios');

-- ── Personas ────────────────────────────────────────────────────────────────
INSERT INTO public.clientes (id, nombre, codigo)
SELECT pv.id('CLI_' || a), 'Residente ' || a, 'PV-' || a
FROM unnest(ARRAY['PROP','PROP2','INQ','OTRO','PROPC']) AS a;

INSERT INTO public.company_clientes (company_id, cliente_id)
SELECT CASE WHEN a = 'PROPC' THEN pv.id('C') ELSE pv.id('A') END, pv.id('CLI_' || a)
FROM unnest(ARRAY['PROP','PROP2','INQ','OTRO','PROPC']) AS a;

INSERT INTO auth.users (id)
SELECT pv.id(a) FROM unnest(ARRAY['ADM_A','PROP','PROP2','INQ','OTRO','PROPC']) AS a;

INSERT INTO public.app_users (id, company_id, full_name, role) VALUES
  (pv.id('ADM_A'), pv.id('A'), 'Admin A', 'admin');
INSERT INTO public.app_users (id, company_id, full_name, role, cliente_id)
SELECT pv.id(a), NULL, 'Residente ' || a, 'cliente', pv.id('CLI_' || a)
FROM unnest(ARRAY['PROP','PROP2','INQ','OTRO','PROPC']) AS a;

-- ── Unidades y membresías ───────────────────────────────────────────────────
INSERT INTO public.unidades (id, project_id, company_id, nombre, cliente_id) VALUES
  (pv.id('U_P'),  pv.id('A1'), pv.id('A'), 'Unidad P',  pv.id('CLI_PROP')),
  (pv.id('U_P2'), pv.id('A1'), pv.id('A'), 'Unidad P2', NULL),
  (pv.id('U_O'),  pv.id('A1'), pv.id('A'), 'Unidad O',  pv.id('CLI_OTRO')),
  (pv.id('U_C'),  pv.id('C1'), pv.id('C'), 'Unidad C',  pv.id('CLI_PROPC'));

INSERT INTO public.unidad_residentes (unidad_id, cliente_id, company_id, project_id, tipo) VALUES
  (pv.id('U_P2'), pv.id('CLI_PROP2'), pv.id('A'), pv.id('A1'), 'propietario'),
  (pv.id('U_P'),  pv.id('CLI_INQ'),   pv.id('A'), pv.id('A1'), 'arrendatario');

-- ── Asambleas, puntos y votos ───────────────────────────────────────────────
-- ASA_FIN sigue el ciclo real: nace en curso, recibe su punto y sus votos, y
-- recién entonces se finaliza (20261106000100 congela la agenda y los votos
-- de una asamblea cerrada, así que no se le pueden cargar después).
INSERT INTO public.asambleas (id, company_id, project_id, titulo, fecha, hora_inicio, estado, acta) VALUES
  (pv.id('ASA_CUR'),  pv.id('A'), pv.id('A1'), 'Ordinaria en curso',  CURRENT_DATE,      '18:00', 'en_curso',   'Borrador del acta'),
  (pv.id('ASA_PROG'), pv.id('A'), pv.id('A1'), 'Extraordinaria',      CURRENT_DATE + 30, '18:00', 'programada', NULL),
  (pv.id('ASA_FIN'),  pv.id('A'), pv.id('A1'), 'Ordinaria anterior',  CURRENT_DATE - 60, '18:00', 'en_curso',   'Acta firmada'),
  (pv.id('ASA_CAN'),  pv.id('A'), pv.id('A1'), 'Cancelada',           CURRENT_DATE - 30, '18:00', 'cancelada',  NULL),
  (pv.id('ASA_A2'),   pv.id('A'), pv.id('A2'), 'Asamblea de A2',      CURRENT_DATE,      '18:00', 'en_curso',   NULL),
  (pv.id('ASA_C'),    pv.id('C'), pv.id('C1'), 'Asamblea de C1',      CURRENT_DATE,      '18:00', 'en_curso',   NULL);

INSERT INTO public.puntos_asamblea (id, asamblea_id, orden, titulo, tipo, resultado) VALUES
  (pv.id('PUN_V'),    pv.id('ASA_CUR'),  2, 'Aprobación del presupuesto', 'votacion',    NULL),
  (pv.id('PUN_I'),    pv.id('ASA_CUR'),  1, 'Informe de la administración', 'informativo', NULL),
  (pv.id('PUN_PROG'), pv.id('ASA_PROG'), 1, 'Cambio de reglamento',       'votacion',    NULL),
  (pv.id('PUN_FIN'),  pv.id('ASA_FIN'),  1, 'Pintura de fachadas',        'votacion',    'Rechazado'),
  (pv.id('PUN_A2'),   pv.id('ASA_A2'),   1, 'Punto de A2',                'votacion',    NULL),
  (pv.id('PUN_C'),    pv.id('ASA_C'),    1, 'Punto de C1',                'votacion',    NULL);

INSERT INTO public.votos_asamblea (id, punto_id, unidad_id, voto) VALUES
  (pv.id('VOT_O'), pv.id('PUN_V'),   pv.id('U_O'),  'a_favor'),
  (DEFAULT,        pv.id('PUN_FIN'), pv.id('U_O'),  'a_favor'),
  (DEFAULT,        pv.id('PUN_FIN'), pv.id('U_P2'), 'en_contra');

UPDATE public.asambleas SET estado = 'finalizada' WHERE id = pv.id('ASA_FIN');

INSERT INTO public.asambleas_digital (id, company_id, project_id, titulo, fecha_hora, estado, created_by)
VALUES (pv.id('ASA_DIG'), pv.id('A'), pv.id('A1'), 'Asamblea digital', now(), 'en_curso', pv.id('ADM_A'));

-- ── Precondiciones del padrón ───────────────────────────────────────────────
DO $$
BEGIN
  IF NOT public.company_has_feature(pv.id('A'), 'asambleas_digitales') THEN
    RAISE EXCEPTION 'padrón: A (condominios_only) debería tener asambleas_digitales';
  END IF;
  IF public.company_has_feature(pv.id('C'), 'asambleas_digitales') THEN
    RAISE EXCEPTION 'padrón: C (agua_only) no debería tener asambleas_digitales';
  END IF;
END $$;
