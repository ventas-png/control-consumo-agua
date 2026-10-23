-- ============================================================================
-- PADRÓN DE LA SUITE «asambleas_integridad» (20261106000100)
--
-- Se carga sobre la cadena REAL de migraciones, antes y después de la
-- migración: las asambleas siguen el ciclo real (nacen programadas o en curso,
-- reciben puntos y votos, y recién entonces se finalizan o cancelan).
--
-- Empresa A (plan condominios_only, con la feature), proyecto A1:
--   PROG    programada, con PUN_PROG (votación)
--   CUR     en curso, con PUN_CUR (votación) y V_CUR (U1 a favor)
--   FIN     finalizada, con acta, PUN_FIN (votación) y dos votos: V_FIN1 (U1,
--           registrado por REG) y V_FIN2 (U2)
--   CAN     cancelada, con PUN_CAN (votación) y V_CAN (U1)
--   FIN_B   finalizada, con PUN_FIN_B y V_FIN_B (U1): la que se borra entera
-- Unidades U1, U2, U3. ADM_A, admin de A, escribe como el staff (exento en
-- user_has_permission). REG es el usuario que registró V_FIN1 y luego se
-- borra (ON DELETE SET NULL).
-- Empresa B, proyecto B1: ADM_B y CUR_B (en curso) con PUN_B y V_B (UB), para
-- que el historial de una empresa no lo lea la otra.
--
-- Todo lo de la prueba vive en el esquema «ai».
-- ============================================================================
\set ON_ERROR_STOP on

CREATE SCHEMA ai;
GRANT USAGE ON SCHEMA ai TO PUBLIC;

CREATE TABLE ai.ids (alias text PRIMARY KEY, id uuid NOT NULL UNIQUE);
GRANT SELECT ON ai.ids TO PUBLIC;

CREATE FUNCTION ai.id(p_alias text) RETURNS uuid LANGUAGE sql STABLE AS
$$ SELECT id FROM ai.ids WHERE alias = p_alias $$;

INSERT INTO ai.ids (alias, id) VALUES
  ('A',        'd0000000-0000-0000-0000-00000000000a'),
  ('B',        'd0000000-0000-0000-0000-00000000000b'),
  ('A1',       'd1000000-0000-0000-0000-0000000000a1'),
  ('B1',       'd1000000-0000-0000-0000-0000000000b1'),
  ('ADM_A',    'd2000000-0000-0000-0000-00000000000a'),
  ('ADM_B',    'd2000000-0000-0000-0000-00000000000b'),
  ('REG',      'd2000000-0000-0000-0000-000000000001'),
  ('U1',       'd3000000-0000-0000-0000-000000000001'),
  ('U2',       'd3000000-0000-0000-0000-000000000002'),
  ('U3',       'd3000000-0000-0000-0000-000000000003'),
  ('UB',       'd3000000-0000-0000-0000-00000000000b'),
  ('PROG',     'd4000000-0000-0000-0000-000000000001'),
  ('CUR',      'd4000000-0000-0000-0000-000000000002'),
  ('FIN',      'd4000000-0000-0000-0000-000000000003'),
  ('CAN',      'd4000000-0000-0000-0000-000000000004'),
  ('FIN_B',    'd4000000-0000-0000-0000-000000000005'),
  ('CUR_B',    'd4000000-0000-0000-0000-00000000000b'),
  ('PUN_PROG', 'd5000000-0000-0000-0000-000000000001'),
  ('PUN_CUR',  'd5000000-0000-0000-0000-000000000002'),
  ('PUN_FIN',  'd5000000-0000-0000-0000-000000000003'),
  ('PUN_CAN',  'd5000000-0000-0000-0000-000000000004'),
  ('PUN_FIN_B','d5000000-0000-0000-0000-000000000005'),
  ('PUN_B',    'd5000000-0000-0000-0000-00000000000b'),
  ('V_CUR',    'd6000000-0000-0000-0000-000000000002'),
  ('V_FIN1',   'd6000000-0000-0000-0000-000000000031'),
  ('V_FIN2',   'd6000000-0000-0000-0000-000000000032'),
  ('V_CAN',    'd6000000-0000-0000-0000-000000000004'),
  ('V_FIN_B',  'd6000000-0000-0000-0000-000000000005'),
  ('V_B',      'd6000000-0000-0000-0000-00000000000b'),
  ('V_NUEVO',  'd6000000-0000-0000-0000-0000000000f1');

-- ── Comprobaciones ──────────────────────────────────────────────────────────
CREATE FUNCTION ai.chk(actual text, esperado text, msg text)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF actual IS DISTINCT FROM esperado THEN
    RAISE EXCEPTION '% — esperado %, recibido %', msg, esperado, actual;
  END IF;
  RAISE NOTICE '✓ %', msg;
END;
$$;

CREATE FUNCTION ai.como(p_alias text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('request.jwt.claim.sub', ai.id(p_alias)::text, false);
END;
$$;

-- Ejecuta la sentencia con el rol y la identidad de la sesión y la DESHACE
-- siempre. Devuelve 'ok:<filas>' o '<sqlstate>:<etiqueta>', donde la
-- etiqueta es el CHECK que falló o lo que el mensaje trae antes de «:»
-- (ASAMBLEA_CERRADA, ASAMBLEA_TRANSICION…). Así cada rechazo se distingue de
-- los demás y un fallo por otra causa no pasa por bueno.
CREATE FUNCTION ai.prueba(p_sql text, p_a uuid DEFAULT NULL, p_b uuid DEFAULT NULL)
RETURNS text LANGUAGE plpgsql AS $$
DECLARE
  n       int := 0;
  v_state text;
  v_msg   text;
  v_con   text;
BEGIN
  BEGIN
    EXECUTE p_sql USING p_a, p_b;
    GET DIAGNOSTICS n = ROW_COUNT;
    RAISE EXCEPTION USING ERRCODE = 'AI000', MESSAGE = 'deshacer';
  EXCEPTION
    WHEN SQLSTATE 'AI000' THEN RETURN 'ok:' || n;
    WHEN OTHERS THEN
      GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE, v_msg = MESSAGE_TEXT, v_con = CONSTRAINT_NAME;
      RETURN v_state || ':' || CASE WHEN coalesce(v_con, '') <> '' THEN v_con ELSE split_part(v_msg, ':', 1) END;
  END;
END;
$$;

-- Un cambio de estado de la asamblea `p_asamblea`, deshecho.
CREATE FUNCTION ai.transicion(p_asamblea text, p_estado text) RETURNS text
LANGUAGE sql AS $$
  SELECT ai.prueba(format('UPDATE public.asambleas SET estado = %L WHERE id = $1', p_estado), ai.id(p_asamblea))
$$;

GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA ai TO PUBLIC;

-- ── Empresas, proyectos, usuarios, unidades ─────────────────────────────────
INSERT INTO public.companies (id, nombre) VALUES
  (ai.id('A'), 'Empresa A (integridad de asambleas)'),
  (ai.id('B'), 'Empresa B (integridad de asambleas)');
UPDATE public.subscriptions s
   SET plan_id = (SELECT id FROM public.billing_plans WHERE code = 'condominios_only'), status = 'active'
 WHERE s.company_id = ai.id('A');

INSERT INTO public.projects (id, company_id, nombre, tipo) VALUES
  (ai.id('A1'), ai.id('A'), 'Condominio A1', 'condominios'),
  (ai.id('B1'), ai.id('B'), 'Condominio B1', 'condominios');

INSERT INTO auth.users (id) SELECT ai.id(a) FROM unnest(ARRAY['ADM_A', 'ADM_B', 'REG']) AS a;
INSERT INTO public.app_users (id, company_id, full_name, role) VALUES
  (ai.id('ADM_A'), ai.id('A'), 'Integridad ADM_A', 'admin'),
  (ai.id('ADM_B'), ai.id('B'), 'Integridad ADM_B', 'admin');

INSERT INTO public.unidades (id, project_id, company_id, nombre)
SELECT ai.id(u), ai.id(CASE u WHEN 'UB' THEN 'B1' ELSE 'A1' END), ai.id(CASE u WHEN 'UB' THEN 'B' ELSE 'A' END), 'Unidad ' || u
FROM unnest(ARRAY['U1', 'U2', 'U3', 'UB']) AS u;

-- ── Asambleas: el ciclo real ────────────────────────────────────────────────
INSERT INTO public.asambleas (id, company_id, project_id, titulo, fecha, hora_inicio, estado) VALUES
  (ai.id('PROG'),  ai.id('A'), ai.id('A1'), 'Programada',          CURRENT_DATE + 30, '18:00', 'programada'),
  (ai.id('CUR'),   ai.id('A'), ai.id('A1'), 'En curso',            CURRENT_DATE,      '18:00', 'en_curso'),
  (ai.id('FIN'),   ai.id('A'), ai.id('A1'), 'Finalizada',          CURRENT_DATE - 60, '18:00', 'en_curso'),
  (ai.id('CAN'),   ai.id('A'), ai.id('A1'), 'Cancelada',           CURRENT_DATE - 30, '18:00', 'en_curso'),
  (ai.id('FIN_B'), ai.id('A'), ai.id('A1'), 'Finalizada a borrar', CURRENT_DATE - 90, '18:00', 'en_curso'),
  (ai.id('CUR_B'), ai.id('B'), ai.id('B1'), 'En curso de B',       CURRENT_DATE,      '18:00', 'en_curso');

INSERT INTO public.puntos_asamblea (id, asamblea_id, orden, titulo, tipo) VALUES
  (ai.id('PUN_PROG'),  ai.id('PROG'),  1, 'Cambio de reglamento',  'votacion'),
  (ai.id('PUN_CUR'),   ai.id('CUR'),   1, 'Presupuesto',           'votacion'),
  (ai.id('PUN_FIN'),   ai.id('FIN'),   1, 'Pintura de fachadas',   'votacion'),
  (ai.id('PUN_CAN'),   ai.id('CAN'),   1, 'Portón eléctrico',      'votacion'),
  (ai.id('PUN_FIN_B'), ai.id('FIN_B'), 1, 'Jardinería',            'votacion'),
  (ai.id('PUN_B'),     ai.id('CUR_B'), 1, 'Presupuesto de B',      'votacion');

INSERT INTO public.votos_asamblea (id, punto_id, unidad_id, voto, registrado_por) VALUES
  (ai.id('V_CUR'),   ai.id('PUN_CUR'),   ai.id('U1'), 'a_favor',   NULL),
  (ai.id('V_FIN1'),  ai.id('PUN_FIN'),   ai.id('U1'), 'a_favor',   ai.id('REG')),
  (ai.id('V_FIN2'),  ai.id('PUN_FIN'),   ai.id('U2'), 'en_contra', NULL),
  (ai.id('V_CAN'),   ai.id('PUN_CAN'),   ai.id('U1'), 'a_favor',   NULL),
  (ai.id('V_FIN_B'), ai.id('PUN_FIN_B'), ai.id('U1'), 'abstencion', NULL),
  (ai.id('V_B'),     ai.id('PUN_B'),     ai.id('UB'), 'a_favor',   NULL);

UPDATE public.asambleas SET estado = 'finalizada', acta = 'Acta firmada' WHERE id IN (ai.id('FIN'), ai.id('FIN_B'));
UPDATE public.asambleas SET estado = 'cancelada' WHERE id = ai.id('CAN');

-- El historial del padrón no cuenta: las comprobaciones miran lo que pasa
-- DESPUÉS de cargarlo.
DELETE FROM public.audit_log WHERE table_name = 'votos_asamblea';
