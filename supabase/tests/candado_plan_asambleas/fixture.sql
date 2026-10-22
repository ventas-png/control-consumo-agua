-- ============================================================================
-- PADRÓN DE LA SUITE «candado_plan_asambleas» (20261104000120)
--
-- Se carga sobre la cadena REAL de migraciones: lo que se prueba son las
-- policies que de verdad tiene el repositorio, con company_has_feature, los
-- planes sembrados y los helpers de RBAC reales.
--
-- Cuatro empresas, cada una con una asamblea clásica, un punto y unidades:
--   A   plan condominios_only, activo          → tiene asambleas_digitales
--   B   el trial que crea el alta de la empresa (bundle, trialing) → la tiene
--   C   plan agua_only, activo                 → NO la tiene
--   D   plan condominios_only, CANCELADO       → NO la tiene
-- Personas:
--   ADM_A … ADM_D  admin de cada empresa (exento en user_has_permission)
--   STF_A          operator de A que ve Asambleas y Votaciones (staff con permiso)
--   NOP_A          operator de A sin ningún permiso
--   SUP            super_admin, de la empresa A: entra en cualquier empresa, así
--                  que separa «el plan de la empresa de la ASAMBLEA» de «el plan
--                  de la empresa de QUIEN inserta»
-- VOT_A es un voto ya registrado (PUN_A, U_A2): el re-voto del panel es un
-- upsert que choca con él.
--
-- Todo lo de la prueba vive en el esquema «cp»: no toca el catálogo de public.
-- `auth.uid()` sale del GUC `request.jwt.claim.sub` (bootstrap.sql).
-- ============================================================================
\set ON_ERROR_STOP on

CREATE SCHEMA cp;
GRANT USAGE ON SCHEMA cp TO PUBLIC;

CREATE TABLE cp.ids (alias text PRIMARY KEY, id uuid NOT NULL UNIQUE);
GRANT SELECT ON cp.ids TO PUBLIC;

CREATE FUNCTION cp.id(p_alias text) RETURNS uuid LANGUAGE sql STABLE AS
$$ SELECT id FROM cp.ids WHERE alias = p_alias $$;

INSERT INTO cp.ids (alias, id) VALUES
  ('A',      'c0000000-0000-0000-0000-00000000000a'),
  ('B',      'c0000000-0000-0000-0000-00000000000b'),
  ('C',      'c0000000-0000-0000-0000-00000000000c'),
  ('D',      'c0000000-0000-0000-0000-00000000000d'),
  ('A1',     'c1000000-0000-0000-0000-0000000000a1'),
  ('B1',     'c1000000-0000-0000-0000-0000000000b1'),
  ('C1',     'c1000000-0000-0000-0000-0000000000c1'),
  ('D1',     'c1000000-0000-0000-0000-0000000000d1'),
  ('ADM_A',  'c2000000-0000-0000-0000-00000000000a'),
  ('ADM_B',  'c2000000-0000-0000-0000-00000000000b'),
  ('ADM_C',  'c2000000-0000-0000-0000-00000000000c'),
  ('ADM_D',  'c2000000-0000-0000-0000-00000000000d'),
  ('STF_A',  'c2000000-0000-0000-0000-000000000001'),
  ('NOP_A',  'c2000000-0000-0000-0000-000000000002'),
  ('SUP',    'c2000000-0000-0000-0000-000000000003'),
  ('R_STF',  'c3000000-0000-0000-0000-000000000001'),
  ('ASA_A',  'c4000000-0000-0000-0000-00000000000a'),
  ('ASA_B',  'c4000000-0000-0000-0000-00000000000b'),
  ('ASA_C',  'c4000000-0000-0000-0000-00000000000c'),
  ('ASA_D',  'c4000000-0000-0000-0000-00000000000d'),
  ('PUN_A',  'c5000000-0000-0000-0000-00000000000a'),
  ('PUN_B',  'c5000000-0000-0000-0000-00000000000b'),
  ('PUN_C',  'c5000000-0000-0000-0000-00000000000c'),
  ('PUN_D',  'c5000000-0000-0000-0000-00000000000d'),
  ('U_A',    'c6000000-0000-0000-0000-00000000000a'),
  ('U_A2',   'c6000000-0000-0000-0000-0000000000a2'),
  ('U_B',    'c6000000-0000-0000-0000-00000000000b'),
  ('U_C',    'c6000000-0000-0000-0000-00000000000c'),
  ('U_D',    'c6000000-0000-0000-0000-00000000000d'),
  ('VOT_A',  'c7000000-0000-0000-0000-00000000000a');

-- ── Comprobaciones ──────────────────────────────────────────────────────────
CREATE FUNCTION cp.chk(actual boolean, esperado boolean, msg text)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF actual IS DISTINCT FROM esperado THEN
    RAISE EXCEPTION '% — esperado %, recibido %', msg, esperado, actual;
  END IF;
  RAISE NOTICE '✓ %', msg;
END;
$$;

CREATE FUNCTION cp.como(p_alias text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('request.jwt.claim.sub', cp.id(p_alias)::text, false);
END;
$$;

-- ¿La sentencia da de alta (o, en el upsert, escribe) exactamente una fila? Se
-- ejecuta con el rol y la identidad de la sesión (SECURITY INVOKER: la RLS
-- aplica) y se DESHACE siempre, así que cada persona prueba sobre las mismas
-- filas. Un 42501 es el rechazo de un WITH CHECK de RLS: cuenta como «no».
-- Cualquier otro error SUBE —un rechazo por otra causa sería un falso verde—.
CREATE FUNCTION cp.escribe(p_sql text, p_a uuid, p_b uuid DEFAULT NULL) RETURNS boolean
LANGUAGE plpgsql AS $$
DECLARE
  n int := 0;
BEGIN
  BEGIN
    EXECUTE p_sql USING p_a, p_b;
    GET DIAGNOSTICS n = ROW_COUNT;
    RAISE EXCEPTION USING ERRCODE = 'CP000', MESSAGE = 'deshacer';
  EXCEPTION
    WHEN SQLSTATE 'CP000' THEN RETURN n = 1;
    WHEN insufficient_privilege THEN RETURN false;
  END;
END;
$$;

-- «+ Punto» de AsambleasTab.agregarPunto: insert en puntos_asamblea.
CREATE FUNCTION cp.agrega_punto(p_asamblea text) RETURNS boolean
LANGUAGE sql AS $$
  SELECT cp.escribe(
    'INSERT INTO public.puntos_asamblea (asamblea_id, orden, titulo, tipo) VALUES ($1, 2, ''Punto de prueba'', ''votacion'')',
    cp.id(p_asamblea))
$$;

-- Un voto por insert directo (lo que hace el portal del residente).
CREATE FUNCTION cp.vota(p_punto text, p_unidad text) RETURNS boolean
LANGUAGE sql AS $$
  SELECT cp.escribe(
    'INSERT INTO public.votos_asamblea (punto_id, unidad_id, voto) VALUES ($1, $2, ''a_favor'')',
    cp.id(p_punto), cp.id(p_unidad))
$$;

-- AsambleasTab.registrarVoto: upsert de PostgREST con onConflict
-- 'punto_id,unidad_id' (el SET repite cada columna del payload). Sobre una
-- unidad que ya votó es el RE-VOTO: el WITH CHECK de INSERT se evalúa igual.
CREATE FUNCTION cp.vota_upsert(p_punto text, p_unidad text) RETURNS boolean
LANGUAGE sql AS $$
  SELECT cp.escribe(
    'INSERT INTO public.votos_asamblea (punto_id, unidad_id, voto, registrado_por)
     VALUES ($1, $2, ''en_contra'', auth.uid())
     ON CONFLICT (punto_id, unidad_id) DO UPDATE
       SET punto_id = EXCLUDED.punto_id, unidad_id = EXCLUDED.unidad_id,
           voto = EXCLUDED.voto, registrado_por = EXCLUDED.registrado_por',
    cp.id(p_punto), cp.id(p_unidad))
$$;

-- Control: convocar una asamblea (asambleas no tiene candado de plan).
CREATE FUNCTION cp.convoca(p_empresa text) RETURNS boolean
LANGUAGE sql AS $$
  SELECT cp.escribe(
    'INSERT INTO public.asambleas (company_id, project_id, titulo, fecha, hora_inicio) VALUES ($1, $2, ''Alta de prueba'', CURRENT_DATE, ''18:00'')',
    cp.id(p_empresa), cp.id(p_empresa || '1'))
$$;

GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA cp TO PUBLIC;

-- ── Empresas, proyectos y planes ────────────────────────────────────────────
-- El alta de cada empresa le crea un trial (bundle, trialing) por trigger: B
-- se queda con él; A, C y D pasan al plan y estado de su caso.
INSERT INTO public.companies (id, nombre) VALUES
  (cp.id('A'), 'Empresa A (condominios_only)'),
  (cp.id('B'), 'Empresa B (trial)'),
  (cp.id('C'), 'Empresa C (agua_only)'),
  (cp.id('D'), 'Empresa D (cancelada)');

UPDATE public.subscriptions s
SET plan_id = (SELECT id FROM public.billing_plans WHERE code = v.plan),
    status  = v.status
FROM (VALUES (cp.id('A'), 'condominios_only', 'active'),
             (cp.id('C'), 'agua_only',        'active'),
             (cp.id('D'), 'condominios_only', 'canceled')) AS v(company_id, plan, status)
WHERE s.company_id = v.company_id;

INSERT INTO public.projects (id, company_id, nombre, tipo)
SELECT cp.id(e || '1'), cp.id(e), 'Condominio ' || e || '1', 'condominios'
FROM unnest(ARRAY['A','B','C','D']) AS e;

-- ── Usuarios y RBAC ─────────────────────────────────────────────────────────
INSERT INTO auth.users (id)
SELECT cp.id(a) FROM unnest(ARRAY['ADM_A','ADM_B','ADM_C','ADM_D','STF_A','NOP_A','SUP']) AS a;

INSERT INTO public.app_users (id, company_id, full_name, role)
SELECT cp.id(a), cp.id(CASE WHEN a LIKE 'ADM\__' THEN right(a, 1) ELSE 'A' END), 'Candado ' || a,
       CASE WHEN a LIKE 'ADM\__' THEN 'admin' WHEN a = 'SUP' THEN 'super_admin' ELSE 'operator' END
FROM unnest(ARRAY['ADM_A','ADM_B','ADM_C','ADM_D','STF_A','NOP_A','SUP']) AS a;

-- STF_A: ve, crea y edita en Asambleas y Votaciones, como el staff que en el
-- panel ve «+ Punto» y los botones de voto (canEdit). Con la visibilidad las
-- policies de hoy ya le dejan; las acciones lo mantienen dentro cuando las
-- permisivas pasan a pedir «Crear»/«Editar» del tab: este padrón prueba el
-- candado de plan, no las permisivas.
INSERT INTO public.roles (id, company_id, name) VALUES (cp.id('R_STF'), cp.id('A'), 'Asambleas y votaciones');
INSERT INTO public.role_permissions (role_id, permission_key, effect)
SELECT cp.id('R_STF'), 'condominios.tab.' || tab || accion, 'allow'
FROM unnest(ARRAY['asambleas', 'votaciones']) AS tab, unnest(ARRAY['', '.create', '.edit']) AS accion;
INSERT INTO public.user_roles (user_id, role_id) VALUES (cp.id('STF_A'), cp.id('R_STF'));

-- ── Asambleas, puntos, unidades y el voto previo ────────────────────────────
INSERT INTO public.asambleas (id, company_id, project_id, titulo, fecha, hora_inicio)
SELECT cp.id('ASA_' || e), cp.id(e), cp.id(e || '1'), 'Asamblea ordinaria ' || e, CURRENT_DATE, '18:00'
FROM unnest(ARRAY['A','B','C','D']) AS e;

INSERT INTO public.puntos_asamblea (id, asamblea_id, orden, titulo, tipo)
SELECT cp.id('PUN_' || e), cp.id('ASA_' || e), 1, 'Aprobación del presupuesto', 'votacion'
FROM unnest(ARRAY['A','B','C','D']) AS e;

INSERT INTO public.unidades (id, project_id, company_id, nombre)
SELECT cp.id('U_' || e), cp.id(e || '1'), cp.id(e), 'Unidad ' || e
FROM unnest(ARRAY['A','B','C','D']) AS e;
INSERT INTO public.unidades (id, project_id, company_id, nombre)
VALUES (cp.id('U_A2'), cp.id('A1'), cp.id('A'), 'Unidad A2');

INSERT INTO public.votos_asamblea (id, punto_id, unidad_id, voto)
VALUES (cp.id('VOT_A'), cp.id('PUN_A'), cp.id('U_A2'), 'a_favor');

-- ── Precondiciones del padrón ───────────────────────────────────────────────
-- Si la cadena cambia los planes o el trial, el padrón dejaría de probar lo que
-- dice: se exige el estado de partida en vez de suponerlo.
DO $$
DECLARE
  v_empresa text;
  v_espera  boolean;
BEGIN
  FOR v_empresa, v_espera IN VALUES ('A', true), ('B', true), ('C', false), ('D', false) LOOP
    IF public.company_has_feature(cp.id(v_empresa), 'asambleas_digitales') IS DISTINCT FROM v_espera THEN
      RAISE EXCEPTION 'padrón: company_has_feature(%, asambleas_digitales) debería ser %', v_empresa, v_espera;
    END IF;
  END LOOP;
  IF NOT public.company_has_feature(cp.id('C'), 'cobranza_judicial') THEN
    RAISE EXCEPTION 'padrón: el plan agua_only de C debería incluir cobranza_judicial';
  END IF;
  IF (SELECT status FROM public.subscriptions WHERE company_id = cp.id('B')) <> 'trialing' THEN
    RAISE EXCEPTION 'padrón: B debería estar en el trial que crea el alta de la empresa';
  END IF;
END $$;
