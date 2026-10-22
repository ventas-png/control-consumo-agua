-- ============================================================================
-- PADRÓN DE LA SUITE «voto_residente_asambleas» (20261104000050)
--
-- Se carga sobre la cadena REAL de migraciones: lo que se prueba son las
-- policies que de verdad tiene el repositorio, con mis_unidades_ids(),
-- mis_proyectos_ids(), el candado de plan y los helpers de RBAC reales.
--
-- Empresas y condominios:
--   A   plan condominios_only (tiene asambleas_digitales): condominios A1 y A2
--   C   plan agua_only (NO la tiene): condominio C1
-- Unidades:
--   U1  A1, propietario PROP (unidades.cliente_id); INQ es su arrendatario
--   U2, U4, U5  A1, de otros
--   U3  A2, propietario PROP2 por membresía (unidad_residentes 'propietario')
--   U6  A2, propietario PROP3, que además es arrendatario de U5 en A1: ve los
--       dos condominios, así que sólo la regla «la unidad es del condominio
--       de la asamblea» le impide votar en A1 con U6
--   UC  C1, propietario PROPC
-- Personas:
--   PROP, INQ, PROP2, PROP3, PROPC  residentes («cliente»), con la empresa de su unidad
--   ADM_A  admin de A · STF_A  operator de A con Asambleas y Votaciones
--   NOP_A  operator de A sin ningún permiso
-- Asambleas (puntos):
--   ASA_CURSO  A1, en_curso    PUN_CV (votación), PUN_CI (informativo),
--                              PUN_CV2 (votación, U1 ya votó: VOT_PREVIO)
--   ASA_PROG   A1, programada  PUN_PV (votación)
--   ASA_FIN    A1, finalizada  PUN_FV (U2 y U4 a favor, U5 en contra),
--                              PUN_FV2 (U1 abstención, U2 en contra),
--                              PUN_FI (informativo)
--   ASA_A2     A2, en_curso    PUN_A2V
--   ASA_A2F    A2, finalizada  PUN_A2FV (U3 a favor)
--   ASA_C      C1, en_curso    PUN_CCV
-- Además U2 votó a favor en PUN_CV: el voto de OTRA unidad, en curso.
--
-- Todo lo de la prueba vive en el esquema «vr»: no toca el catálogo de public.
-- `auth.uid()` sale del GUC `request.jwt.claim.sub` (bootstrap.sql).
-- ============================================================================
\set ON_ERROR_STOP on

CREATE SCHEMA vr;
GRANT USAGE ON SCHEMA vr TO PUBLIC;

CREATE TABLE vr.ids (alias text PRIMARY KEY, id uuid NOT NULL UNIQUE);
GRANT SELECT ON vr.ids TO PUBLIC;

CREATE FUNCTION vr.id(p_alias text) RETURNS uuid LANGUAGE sql STABLE AS
$$ SELECT id FROM vr.ids WHERE alias = p_alias $$;

INSERT INTO vr.ids (alias, id) VALUES
  ('A',          'd0000000-0000-0000-0000-00000000000a'),
  ('C',          'd0000000-0000-0000-0000-00000000000c'),
  ('A1',         'd1000000-0000-0000-0000-0000000000a1'),
  ('A2',         'd1000000-0000-0000-0000-0000000000a2'),
  ('C1',         'd1000000-0000-0000-0000-0000000000c1'),
  ('PROP',       'd2000000-0000-0000-0000-000000000001'),
  ('INQ',        'd2000000-0000-0000-0000-000000000002'),
  ('PROP2',      'd2000000-0000-0000-0000-000000000003'),
  ('PROPC',      'd2000000-0000-0000-0000-000000000004'),
  ('PROP3',      'd2000000-0000-0000-0000-000000000005'),
  ('ADM_A',      'd2000000-0000-0000-0000-00000000000a'),
  ('STF_A',      'd2000000-0000-0000-0000-00000000000b'),
  ('NOP_A',      'd2000000-0000-0000-0000-00000000000c'),
  ('CLI_P',      'd3000000-0000-0000-0000-000000000001'),
  ('CLI_I',      'd3000000-0000-0000-0000-000000000002'),
  ('CLI_P2',     'd3000000-0000-0000-0000-000000000003'),
  ('CLI_PC',     'd3000000-0000-0000-0000-000000000004'),
  ('CLI_P3',     'd3000000-0000-0000-0000-000000000005'),
  ('R_STF',      'd3000000-0000-0000-0000-0000000000ff'),
  ('U1',         'd4000000-0000-0000-0000-000000000001'),
  ('U2',         'd4000000-0000-0000-0000-000000000002'),
  ('U3',         'd4000000-0000-0000-0000-000000000003'),
  ('U4',         'd4000000-0000-0000-0000-000000000004'),
  ('U5',         'd4000000-0000-0000-0000-000000000005'),
  ('U6',         'd4000000-0000-0000-0000-000000000006'),
  ('UC',         'd4000000-0000-0000-0000-00000000000c'),
  ('ASA_CURSO',  'd5000000-0000-0000-0000-000000000001'),
  ('ASA_PROG',   'd5000000-0000-0000-0000-000000000002'),
  ('ASA_FIN',    'd5000000-0000-0000-0000-000000000003'),
  ('ASA_A2',     'd5000000-0000-0000-0000-000000000004'),
  ('ASA_A2F',    'd5000000-0000-0000-0000-000000000005'),
  ('ASA_C',      'd5000000-0000-0000-0000-000000000006'),
  ('PUN_CV',     'd6000000-0000-0000-0000-000000000001'),
  ('PUN_CI',     'd6000000-0000-0000-0000-000000000002'),
  ('PUN_CV2',    'd6000000-0000-0000-0000-000000000003'),
  ('PUN_PV',     'd6000000-0000-0000-0000-000000000004'),
  ('PUN_FV',     'd6000000-0000-0000-0000-000000000005'),
  ('PUN_FV2',    'd6000000-0000-0000-0000-000000000006'),
  ('PUN_FI',     'd6000000-0000-0000-0000-000000000007'),
  ('PUN_A2V',    'd6000000-0000-0000-0000-000000000008'),
  ('PUN_A2FV',   'd6000000-0000-0000-0000-000000000009'),
  ('PUN_CCV',    'd6000000-0000-0000-0000-00000000000a'),
  ('VOT_PREVIO', 'd7000000-0000-0000-0000-000000000001');

-- ── Comprobaciones ──────────────────────────────────────────────────────────
CREATE FUNCTION vr.chk(actual anyelement, esperado anyelement, msg text)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF actual IS DISTINCT FROM esperado THEN
    RAISE EXCEPTION '% — esperado %, recibido %', msg, esperado, actual;
  END IF;
  RAISE NOTICE '✓ %', msg;
END;
$$;

CREATE FUNCTION vr.como(p_alias text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('request.jwt.claim.sub', vr.id(p_alias)::text, false);
END;
$$;

-- Filas que la sesión VE de una tabla (SECURITY INVOKER: la RLS aplica).
CREATE FUNCTION vr.ve(p_tabla text) RETURNS integer LANGUAGE plpgsql AS $$
DECLARE
  n integer;
BEGIN
  EXECUTE format('SELECT count(*) FROM public.%I', p_tabla) INTO n;
  RETURN n;
END;
$$;

-- Ejecuta la sentencia con la identidad de la sesión y la DESHACE siempre, así
-- que cada persona prueba sobre las mismas filas. Devuelve 'ok:<filas>' o el
-- SQLSTATE del error (42501 = la RLS, 23505 = el UNIQUE, 23514 = un CHECK).
CREATE FUNCTION vr.resultado(p_sql text, p_a uuid, p_b uuid DEFAULT NULL, p_c uuid DEFAULT NULL)
RETURNS text LANGUAGE plpgsql AS $$
DECLARE
  n int := 0;
BEGIN
  BEGIN
    EXECUTE p_sql USING p_a, p_b, p_c;
    GET DIAGNOSTICS n = ROW_COUNT;
    RAISE EXCEPTION USING ERRCODE = 'VR000', MESSAGE = 'deshacer';
  EXCEPTION
    WHEN SQLSTATE 'VR000' THEN RETURN 'ok:' || n;
    WHEN OTHERS THEN RETURN SQLSTATE;
  END;
END;
$$;

-- ¿La sentencia escribe exactamente una fila? Un 42501 (WITH CHECK de RLS)
-- cuenta como «no». Cualquier otro error SUBE: un rechazo por otra causa
-- (UNIQUE, CHECK, columna inexistente) sería un falso verde.
CREATE FUNCTION vr.escribe(p_sql text, p_a uuid, p_b uuid DEFAULT NULL, p_c uuid DEFAULT NULL)
RETURNS boolean LANGUAGE plpgsql AS $$
DECLARE
  r text := vr.resultado(p_sql, p_a, p_b, p_c);
BEGIN
  IF r = '42501' THEN RETURN false; END IF;
  IF r NOT LIKE 'ok:%' THEN
    RAISE EXCEPTION 'vr.escribe: error inesperado % en %', r, p_sql;
  END IF;
  RETURN r = 'ok:1';
END;
$$;

-- El voto del portal: insert directo, firmado por quien vota ('YO' =
-- auth.uid(); NULL = sin firma; otro alias = la firma de otra persona).
CREATE FUNCTION vr.vota(p_punto text, p_unidad text, p_firma text DEFAULT 'YO') RETURNS boolean
LANGUAGE sql AS $$
  SELECT vr.escribe(
    'INSERT INTO public.votos_asamblea (punto_id, unidad_id, voto, registrado_por) VALUES ($1, $2, ''a_favor'', $3)',
    vr.id(p_punto), vr.id(p_unidad),
    CASE WHEN p_firma = 'YO' THEN auth.uid() ELSE vr.id(p_firma) END)
$$;

-- AsambleasTab.registrarVoto: upsert de PostgREST con onConflict
-- 'punto_id,unidad_id'. Sobre una unidad que ya votó, es CAMBIAR el voto.
CREATE FUNCTION vr.vota_upsert(p_punto text, p_unidad text) RETURNS boolean
LANGUAGE sql AS $$
  SELECT vr.escribe(
    'INSERT INTO public.votos_asamblea (punto_id, unidad_id, voto, registrado_por)
     VALUES ($1, $2, ''en_contra'', auth.uid())
     ON CONFLICT (punto_id, unidad_id) DO UPDATE
       SET punto_id = EXCLUDED.punto_id, unidad_id = EXCLUDED.unidad_id,
           voto = EXCLUDED.voto, registrado_por = EXCLUDED.registrado_por',
    vr.id(p_punto), vr.id(p_unidad))
$$;

CREATE FUNCTION vr.cambia(p_punto text, p_unidad text) RETURNS boolean
LANGUAGE sql AS $$
  SELECT vr.escribe(
    'UPDATE public.votos_asamblea SET voto = ''en_contra'' WHERE punto_id = $1 AND unidad_id = $2',
    vr.id(p_punto), vr.id(p_unidad))
$$;

CREATE FUNCTION vr.borra(p_punto text, p_unidad text) RETURNS boolean
LANGUAGE sql AS $$
  SELECT vr.escribe(
    'DELETE FROM public.votos_asamblea WHERE punto_id = $1 AND unidad_id = $2',
    vr.id(p_punto), vr.id(p_unidad))
$$;

-- Insert con un valor de voto cualquiera: para el CHECK. Devuelve el resultado
-- crudo ('ok:1', '23514', …).
CREATE FUNCTION vr.vota_valor(p_punto text, p_unidad text, p_voto text) RETURNS text
LANGUAGE sql AS $$
  SELECT vr.resultado(
    format('INSERT INTO public.votos_asamblea (punto_id, unidad_id, voto) VALUES ($1, $2, %L)', p_voto),
    vr.id(p_punto), vr.id(p_unidad))
$$;

-- «+ Punto» del panel: el residente no debe poder.
CREATE FUNCTION vr.agrega_punto(p_asamblea text) RETURNS boolean
LANGUAGE sql AS $$
  SELECT vr.escribe(
    'INSERT INTO public.puntos_asamblea (asamblea_id, orden, titulo, tipo) VALUES ($1, 9, ''Punto de prueba'', ''votacion'')',
    vr.id(p_asamblea))
$$;

-- Conteos del portal, como texto ordenable: 'PUN_FV:2/1/0 PUN_FV2:0/1/1'.
CREATE FUNCTION vr.conteo(p_asambleas text[]) RETURNS text
LANGUAGE plpgsql AS $$
DECLARE
  r text;
BEGIN
  EXECUTE $q$
    SELECT coalesce(string_agg(i.alias || ':' || c.a_favor || '/' || c.en_contra || '/' || c.abstencion, ' ' ORDER BY i.alias), '')
    FROM public.portal_conteo_votos_asambleas($1) c
    JOIN vr.ids i ON i.id = c.punto_id
  $q$ INTO r USING (SELECT array_agg(vr.id(a)) FROM unnest(p_asambleas) AS a);
  RETURN r;
END;
$$;

GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA vr TO PUBLIC;

-- ── Empresas, planes y condominios ──────────────────────────────────────────
-- El alta de cada empresa le crea un trial por trigger; aquí pasan al plan de
-- su caso.
INSERT INTO public.companies (id, nombre) VALUES
  (vr.id('A'), 'Empresa A (condominios_only)'),
  (vr.id('C'), 'Empresa C (agua_only)');

UPDATE public.subscriptions s
SET plan_id = (SELECT id FROM public.billing_plans WHERE code = v.plan),
    status  = 'active'
FROM (VALUES (vr.id('A'), 'condominios_only'),
             (vr.id('C'), 'agua_only')) AS v(company_id, plan)
WHERE s.company_id = v.company_id;

INSERT INTO public.projects (id, company_id, nombre, tipo) VALUES
  (vr.id('A1'), vr.id('A'), 'Condominio A1', 'condominios'),
  (vr.id('A2'), vr.id('A'), 'Condominio A2', 'condominios'),
  (vr.id('C1'), vr.id('C'), 'Condominio C1', 'condominios');

-- ── Residentes y unidades ───────────────────────────────────────────────────
INSERT INTO public.clientes (id, nombre, codigo) VALUES
  (vr.id('CLI_P'),  'Propietaria de U1',        'VR-P'),
  (vr.id('CLI_I'),  'Arrendatario de U1',       'VR-I'),
  (vr.id('CLI_P2'), 'Propietario de U3 (A2)',   'VR-P2'),
  (vr.id('CLI_PC'), 'Propietaria de UC (C1)',   'VR-PC'),
  (vr.id('CLI_P3'), 'Propietario de U6 (A2)',   'VR-P3');

INSERT INTO public.unidades (id, project_id, company_id, nombre, cliente_id) VALUES
  (vr.id('U1'), vr.id('A1'), vr.id('A'), 'Unidad 1', vr.id('CLI_P')),
  (vr.id('U2'), vr.id('A1'), vr.id('A'), 'Unidad 2', NULL),
  (vr.id('U4'), vr.id('A1'), vr.id('A'), 'Unidad 4', NULL),
  (vr.id('U5'), vr.id('A1'), vr.id('A'), 'Unidad 5', NULL),
  (vr.id('U3'), vr.id('A2'), vr.id('A'), 'Unidad 3', NULL),
  (vr.id('U6'), vr.id('A2'), vr.id('A'), 'Unidad 6', vr.id('CLI_P3')),
  (vr.id('UC'), vr.id('C1'), vr.id('C'), 'Unidad C', vr.id('CLI_PC'));

-- INQ entra a U1 como arrendatario; PROP2 es propietario de U3 por membresía
-- (no por unidades.cliente_id): las dos vías de mis_unidad_roles(). PROP3 es
-- arrendatario de U5.
INSERT INTO public.unidad_residentes (unidad_id, cliente_id, company_id, project_id, tipo) VALUES
  (vr.id('U1'), vr.id('CLI_I'),  vr.id('A'), vr.id('A1'), 'arrendatario'),
  (vr.id('U3'), vr.id('CLI_P2'), vr.id('A'), vr.id('A2'), 'propietario'),
  (vr.id('U5'), vr.id('CLI_P3'), vr.id('A'), vr.id('A1'), 'arrendatario');

INSERT INTO auth.users (id)
SELECT vr.id(a) FROM unnest(ARRAY['PROP','INQ','PROP2','PROP3','PROPC','ADM_A','STF_A','NOP_A']) AS a;

INSERT INTO public.app_users (id, company_id, full_name, role, cliente_id) VALUES
  (vr.id('PROP'),  vr.id('A'), 'Voto PROP',  'cliente',  vr.id('CLI_P')),
  (vr.id('INQ'),   vr.id('A'), 'Voto INQ',   'cliente',  vr.id('CLI_I')),
  (vr.id('PROP2'), vr.id('A'), 'Voto PROP2', 'cliente',  vr.id('CLI_P2')),
  (vr.id('PROP3'), vr.id('A'), 'Voto PROP3', 'cliente',  vr.id('CLI_P3')),
  (vr.id('PROPC'), vr.id('C'), 'Voto PROPC', 'cliente',  vr.id('CLI_PC')),
  (vr.id('ADM_A'), vr.id('A'), 'Voto ADM_A', 'admin',    NULL),
  (vr.id('STF_A'), vr.id('A'), 'Voto STF_A', 'operator', NULL),
  (vr.id('NOP_A'), vr.id('A'), 'Voto NOP_A', 'operator', NULL);

-- STF_A: ve, crea y edita en Asambleas y Votaciones (el staff que en el panel
-- registra votos), con las claves de visibilidad y de acción, para que el
-- padrón no dependa de qué átomo exijan las permisivas del staff.
INSERT INTO public.roles (id, company_id, name) VALUES (vr.id('R_STF'), vr.id('A'), 'Asambleas y votaciones');
INSERT INTO public.role_permissions (role_id, permission_key, effect)
SELECT vr.id('R_STF'), 'condominios.tab.' || tab || accion, 'allow'
FROM unnest(ARRAY['asambleas', 'votaciones']) AS tab, unnest(ARRAY['', '.create', '.edit']) AS accion;
INSERT INTO public.user_roles (user_id, role_id) VALUES (vr.id('STF_A'), vr.id('R_STF'));

-- ── Asambleas, puntos y votos ───────────────────────────────────────────────
INSERT INTO public.asambleas (id, company_id, project_id, titulo, fecha, hora_inicio, estado)
SELECT vr.id(v.asa), vr.id(v.emp), vr.id(v.proy), v.asa, CURRENT_DATE, '18:00', v.estado
FROM (VALUES ('ASA_CURSO', 'A', 'A1', 'en_curso'),
             ('ASA_PROG',  'A', 'A1', 'programada'),
             ('ASA_FIN',   'A', 'A1', 'finalizada'),
             ('ASA_A2',    'A', 'A2', 'en_curso'),
             ('ASA_A2F',   'A', 'A2', 'finalizada'),
             ('ASA_C',     'C', 'C1', 'en_curso')) AS v(asa, emp, proy, estado);

INSERT INTO public.puntos_asamblea (id, asamblea_id, orden, titulo, tipo)
SELECT vr.id(v.pun), vr.id(v.asa), v.orden, v.pun, v.tipo
FROM (VALUES ('PUN_CV',   'ASA_CURSO', 1, 'votacion'),
             ('PUN_CI',   'ASA_CURSO', 2, 'informativo'),
             ('PUN_CV2',  'ASA_CURSO', 3, 'votacion'),
             ('PUN_PV',   'ASA_PROG',  1, 'votacion'),
             ('PUN_FV',   'ASA_FIN',   1, 'votacion'),
             ('PUN_FV2',  'ASA_FIN',   2, 'votacion'),
             ('PUN_FI',   'ASA_FIN',   3, 'informativo'),
             ('PUN_A2V',  'ASA_A2',    1, 'votacion'),
             ('PUN_A2FV', 'ASA_A2F',   1, 'votacion'),
             ('PUN_CCV',  'ASA_C',     1, 'votacion')) AS v(pun, asa, orden, tipo);

INSERT INTO public.votos_asamblea (punto_id, unidad_id, voto, registrado_por)
SELECT vr.id(v.pun), vr.id(v.uni), v.voto, vr.id(v.firma)
FROM (VALUES ('PUN_CV',   'U2', 'a_favor',    'STF_A'),
             ('PUN_FV',   'U2', 'a_favor',    'STF_A'),
             ('PUN_FV',   'U4', 'a_favor',    'STF_A'),
             ('PUN_FV',   'U5', 'en_contra',  'STF_A'),
             ('PUN_FV2',  'U1', 'abstencion', 'PROP'),
             ('PUN_FV2',  'U2', 'en_contra',  'STF_A'),
             ('PUN_A2FV', 'U3', 'a_favor',    'PROP2')) AS v(pun, uni, voto, firma);

-- El voto que PROP ya emitió en una asamblea en curso: base del append-only.
INSERT INTO public.votos_asamblea (id, punto_id, unidad_id, voto, registrado_por)
VALUES (vr.id('VOT_PREVIO'), vr.id('PUN_CV2'), vr.id('U1'), 'a_favor', vr.id('PROP'));

-- ── Precondiciones del padrón ───────────────────────────────────────────────
-- Si la cadena cambia planes o membresías, el padrón dejaría de probar lo que
-- dice: se exige el estado de partida en vez de suponerlo.
DO $$
BEGIN
  IF NOT public.company_has_feature(vr.id('A'), 'asambleas_digitales') THEN
    RAISE EXCEPTION 'padrón: A (condominios_only) debería tener asambleas_digitales';
  END IF;
  IF public.company_has_feature(vr.id('C'), 'asambleas_digitales') THEN
    RAISE EXCEPTION 'padrón: C (agua_only) no debería tener asambleas_digitales';
  END IF;

  PERFORM vr.como('PROP');
  IF ARRAY(SELECT public.mis_unidades_propietario_ids()) <> ARRAY[vr.id('U1')] THEN
    RAISE EXCEPTION 'padrón: PROP debería ser propietaria sólo de U1';
  END IF;
  PERFORM vr.como('INQ');
  IF ARRAY(SELECT public.mis_unidades_ids()) <> ARRAY[vr.id('U1')]
     OR EXISTS (SELECT public.mis_unidades_propietario_ids()) THEN
    RAISE EXCEPTION 'padrón: INQ debería residir en U1 sin ser propietario';
  END IF;
  PERFORM vr.como('PROP2');
  IF ARRAY(SELECT public.mis_unidades_propietario_ids()) <> ARRAY[vr.id('U3')] THEN
    RAISE EXCEPTION 'padrón: PROP2 debería ser propietario de U3 por membresía';
  END IF;
  PERFORM vr.como('PROP3');
  IF ARRAY(SELECT public.mis_unidades_propietario_ids()) <> ARRAY[vr.id('U6')]
     OR ARRAY(SELECT x FROM public.mis_proyectos_ids() x ORDER BY x) <> ARRAY[vr.id('A1'), vr.id('A2')] THEN
    RAISE EXCEPTION 'padrón: PROP3 debería ser propietario sólo de U6 y residir en A1 y A2';
  END IF;
  PERFORM set_config('request.jwt.claim.sub', '', false);
END $$;
